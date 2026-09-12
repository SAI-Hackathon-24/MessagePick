/**
 * 执行编排（mod-003 §3.1「executor.ts」、§4.1 / §4.2、§5、§6）。
 *
 * 职责：入参校验 → 归一化输入 → 建记录（任务引用 / `queued`）→ 入队等待信号量 →
 * 按规格分块逐块串行「装配 → 调用 → 解析 → 来源引用回填」（块内自动重试）→ 汇总并终结记录。
 *
 * 边界：不读写任何持久化；任务语义与判定口径全部来自调用方（`params`）；不产生业务空态语义。
 */

import {
  TASK_TYPES,
  type Api007Request,
  type TaskOutcome,
  type TaskParams,
  type TaskRef,
  type TaskType,
} from '@shared'

import { systemClock, type Clock } from './clock'
import { engineConfig, type EngineConfigStore } from './config'
import { asEngineFailure, EngineFailure, requestErrorEnvelope, toEnvelope, type FailureReason } from './errors'
import {
  createNoopLogSink,
  engineEvents,
  EngineEventChannel,
  type EngineCounters,
  type EngineEventCounts,
  type EngineLogEntry,
  type EngineLogSink,
  type EngineTaskEvent,
} from './events'
import { ModelClient, type FetchLike } from './model/client'
import { decodeResponseText, OutputInvalidError, type DecodePayload, type DecodeResult } from './parse/decode'
import { ENGINE_LIMITS, type EngineLimits } from './policy/limits'
import { CircuitBreaker, runWithAutoRetry } from './policy/retry'
import { buildMessages } from './prompt/assemble'
import { TaskQueue } from './queue'
import {
  cloneSettledRecord,
  createRetryRecord,
  TaskRegistry,
  type ChunkRecord,
  type NormalizedInput,
  type NormalizedUnit,
  type TaskRecord,
} from './registry'
import { getTaskSpec } from './specs/index'
import { isPlainObject } from './specs/schema'
import { isValidTaskRef, newTaskRef, taskRefFromEnvelope, taskScope } from './task-ref'
import { createWorkerPool, WorkerCrashError, type DecodeRunner } from './worker/pool'

/** 引擎依赖注入项（全部可缺省；测试据此替换边界）。 */
export interface EngineOptions {
  /** 配置存储（默认进程级 `engineConfig`，外壳把 `config.json` 灌进去）。 */
  config?: EngineConfigStore
  /** 事件通道（默认进程级 `engineEvents`，外壳 SSE 订阅）。 */
  events?: EngineEventChannel
  /** 时钟（默认系统时钟；测试注入假时钟）。 */
  clock?: Clock
  /** 出站 fetch（默认全局 fetch；测试注入假 OpenAI 兼容端点）。 */
  fetchImpl?: FetchLike
  /** 抖动随机源（默认 `Math.random`；测试注入定值）。 */
  random?: () => number
  /** 日志出口（默认 no-op；日志格式与落点由外壳接线）。 */
  logger?: EngineLogSink
  /** 注册表容量覆盖（默认取 `ENGINE_LIMITS.registryCapacity`）。 */
  registryCapacity?: number
  /** 模块常数局部覆盖（测试可缩小分块 / worker 阈值等规模）。 */
  limits?: Partial<EngineLimits>
  /** 解析执行器（默认 worker 池；测试可注入假实现模拟崩溃）。 */
  decodeWorker?: DecodeRunner
}

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init)

/** 智能分析引擎（`API-007` / `API-008` 的实现）。 */
export class Engine {
  readonly events: EngineEventChannel
  readonly config: EngineConfigStore

  #clock: Clock
  #random: () => number
  #limits: EngineLimits
  #registry: TaskRegistry
  #queue: TaskQueue
  #modelClient: ModelClient
  #breaker: CircuitBreaker
  #decodeRunner: DecodeRunner
  #logger: EngineLogSink
  #closed = false

  constructor(options: EngineOptions = {}) {
    this.config = options.config ?? engineConfig
    this.events = options.events ?? engineEvents
    this.#clock = options.clock ?? systemClock
    this.#random = options.random ?? Math.random

    const provided = options.limits
    this.#limits = {
      ...ENGINE_LIMITS,
      ...(provided ?? {}),
      retry: { ...ENGINE_LIMITS.retry, ...(provided?.retry ?? {}) },
    }

    this.#registry = new TaskRegistry(options.registryCapacity ?? this.#limits.registryCapacity)
    this.#queue = new TaskQueue(this.config.get().model.taskConcurrency)
    this.config.subscribe((config) => this.#queue.setCapacity(config.model.taskConcurrency))

    this.#modelClient = new ModelClient({
      getConfig: () => this.config.get(),
      fetchImpl: options.fetchImpl ?? defaultFetch,
      clock: this.#clock,
    })
    this.#breaker = new CircuitBreaker({
      threshold: this.#limits.retry.breakerThreshold,
      pauseMs: this.#limits.retry.breakerPauseMs,
      clock: this.#clock,
    })
    this.#decodeRunner = options.decodeWorker ?? createWorkerPool({ size: this.#limits.workerPoolSize })
    this.#logger = options.logger ?? createNoopLogSink()
  }

  // -------------------------------------------------------------------------
  // API-007 执行任务
  // -------------------------------------------------------------------------

  async executeTask(req: Api007Request): Promise<TaskOutcome> {
    if (this.#closed) {
      return { ok: false, error: requestErrorEnvelope(new EngineFailure('CANCELED', '引擎已收尾，不再受理新任务')) }
    }

    const failure = this.#validateRequest(req as unknown)
    if (failure) {
      this.#log('warn', 'task.rejected', { reason: failure.reason, code: failure.code })
      return { ok: false, error: requestErrorEnvelope(failure) }
    }

    const input = normalizeInput(req.input)
    const record = this.#createRecord(req, input)
    this.#registry.set(record)
    this.#emit('task.enqueue', record)
    this.#log('info', 'task.enqueue', { taskRef: record.taskRef, taskType: record.taskType, chunks: record.chunks.length })

    return await this.#enqueue(record, false)
  }

  // -------------------------------------------------------------------------
  // API-008 重试任务
  // -------------------------------------------------------------------------

  async retryTask(ref: TaskRef): Promise<TaskOutcome> {
    if (!isValidTaskRef(ref)) {
      return { ok: false, error: requestErrorEnvelope(new EngineFailure('REF_UNKNOWN', '任务引用缺失或格式非法')) }
    }
    const record = this.#registry.get(ref)
    if (!record) {
      return { ok: false, error: requestErrorEnvelope(new EngineFailure('REF_UNKNOWN', '任务引用未登记或已失效')) }
    }

    // queued / running：单飞等待既有执行（不重复调用模型，§4.2）。
    const inFlight = record.state === 'queued' || record.state === 'running' ? record.done : record.pendingRetry
    if (inFlight) {
      const outcome = await inFlight
      const settledRef = outcome.ok ? outcome.taskRef : taskRefFromEnvelope(outcome.error)
      const settled = settledRef === null ? null : this.#registry.get(settledRef)
      return this.#mirror(settled ?? record)
    }

    // succeeded / canceled：直接返回缓存结果 / 既有失败（不发新调用）。
    if (record.state === 'succeeded' || record.state === 'canceled') return this.#mirror(record)

    // failed：只重跑失败块，已成功块复用记录内结果（详设 §2.4）。
    const clone = createRetryRecord(record, newTaskRef(), this.#clock.now())
    this.#registry.set(clone)
    const run = this.#enqueue(clone, true)
    record.pendingRetry = run
    return await run
  }

  // -------------------------------------------------------------------------
  // 生命周期与可见性（非契约，进程内）
  // -------------------------------------------------------------------------

  /** 队列长度与进行中数量（只读；展示归外壳）。 */
  getCounters(): EngineCounters {
    return this.#queue.stats
  }

  /** 订阅 dataEpoch（详设 §3.3）：递增即清空注册表并让旧引用失效为 `INVALID_INPUT`。 */
  notifyDataEpoch(epoch: number): void {
    if (this.#registry.notifyEpoch(epoch)) {
      this.#log('info', 'engine.registry.cleared', { epoch })
    }
  }

  /** 进程收尾：`queued` 的任务转 `canceled`（§5.2；运行中的任务不打断，靠超时兜底）。 */
  shutdown(): void {
    this.#closed = true
    for (const record of this.#registry.list()) {
      if (record.state !== 'queued') continue
      const failure = new EngineFailure('CANCELED', '进程收尾，任务未执行')
      record.state = 'canceled'
      record.failure = { reason: failure.reason, message: failure.message }
      record.finishedAt = this.#clock.now()
      this.#emit('task.failed', record, { code: failure.code, reason: failure.reason, counts: this.#counts(record) })
      record.settle?.({ ok: false, error: toEnvelope(failure, taskScope(record.taskRef)) })
    }
    this.#registry.clear()
  }

  // -------------------------------------------------------------------------
  // 内部：入参校验 / 归一化 / 建记录
  // -------------------------------------------------------------------------

  #validateRequest(req: unknown): EngineFailure | null {
    if (!isPlainObject(req)) return new EngineFailure('VALIDATION', '请求必须是对象')

    const taskType = req.taskType
    if (typeof taskType !== 'string' || !(TASK_TYPES as readonly string[]).includes(taskType)) {
      return new EngineFailure('VALIDATION', '任务类型非法')
    }
    const spec = getTaskSpec(taskType as TaskType)

    const input = req.input
    if (!isPlainObject(input)) return new EngineFailure('VALIDATION', '输入内容缺失')
    const kind = input.kind
    if (kind !== '消息集合' && kind !== '文本' && kind !== '上下文') {
      return new EngineFailure('VALIDATION', '输入形状非法（消息集合 / 文本 / 上下文）')
    }

    const rawUnits: unknown[] =
      kind === '文本'
        ? input.unit === undefined || input.unit === null
          ? []
          : [input.unit]
        : Array.isArray(input.units)
          ? input.units
          : []

    if (rawUnits.length === 0) return new EngineFailure('VALIDATION', '输入缺失或为空')

    let totalChars = 0
    for (const [index, rawUnit] of rawUnits.entries()) {
      if (!isPlainObject(rawUnit)) return new EngineFailure('VALIDATION', `输入单元 #${index + 1} 不是对象`)
      if (typeof rawUnit.id !== 'string' || rawUnit.id.trim().length === 0) {
        return new EngineFailure('VALIDATION', `输入单元 #${index + 1} 缺少标识`)
      }
      if (typeof rawUnit.text !== 'string') return new EngineFailure('VALIDATION', `输入单元 #${index + 1} 缺少文本`)
      totalChars += rawUnit.text.length
    }

    if (rawUnits.length > this.#limits.maxUnitsPerTask) {
      return new EngineFailure('INPUT_TOO_LARGE', `输入单元数超过上限（${this.#limits.maxUnitsPerTask}）`)
    }
    if (!spec.chunkable && (rawUnits.length > this.#limits.singleCallMaxUnits || totalChars > this.#limits.singleCallMaxChars)) {
      return new EngineFailure('INPUT_TOO_LARGE', '该任务类型整入单次调用，输入超过单次调用上限')
    }

    const params = req.params
    if (!isPlainObject(params)) return new EngineFailure('VALIDATION', '任务参数缺失')
    const issues = spec.validateParams(params as unknown as TaskParams)
    if (issues.length > 0) {
      const first = issues[0]
      return new EngineFailure('VALIDATION', `任务参数非法（${first.path}：${first.message}）`)
    }

    return null
  }

  #createRecord(req: Api007Request, input: NormalizedInput): TaskRecord {
    const spec = getTaskSpec(req.taskType)
    return {
      taskRef: newTaskRef(),
      retriedFrom: null,
      taskType: req.taskType,
      input,
      params: req.params,
      state: 'queued',
      chunks: planChunks(spec.chunkable, input, this.#limits),
      autoRetries: 0,
      result: null,
      sourceRefs: [],
      failure: null,
      createdAt: this.#clock.now(),
      startedAt: null,
      finishedAt: null,
      settle: null,
      done: null,
      pendingRetry: null,
    }
  }

  // -------------------------------------------------------------------------
  // 内部：入队与执行
  // -------------------------------------------------------------------------

  #enqueue(record: TaskRecord, isRetry: boolean): Promise<TaskOutcome> {
    const outcome = new Promise<TaskOutcome>((resolve) => {
      record.settle = resolve
    })

    void this.#queue
      .run(async () => {
        await this.#runQueued(record, isRetry)
      })
      .catch((error: unknown) => {
        if (record.state === 'succeeded' || record.state === 'failed' || record.state === 'canceled') return
        record.settle?.(this.#failRecord(record, asEngineFailure(error)))
      })

    record.done = outcome
    return outcome
  }

  async #runQueued(record: TaskRecord, isRetry: boolean): Promise<void> {
    // 排队期间被收尾（§5.2 `queued → canceled`）：不执行，调用方已被 shutdown 兑现。
    if (record.state === 'canceled') return
    const outcome = await this.#runRecord(record, isRetry)
    record.settle?.(outcome)
  }

  async #runRecord(record: TaskRecord, isRetry: boolean): Promise<TaskOutcome> {
    record.state = 'running'
    record.startedAt = this.#clock.now()

    if (isRetry) {
      this.#emit('task.retry', record, { retryKind: 'manual', attempt: 1, counts: this.#counts(record) })
      this.#log('info', 'task.retry', { taskRef: record.taskRef, taskType: record.taskType, retriedFrom: record.retriedFrom })
    } else {
      this.#emit('task.start', record, { counts: this.#counts(record) })
      this.#log('info', 'task.start', { taskRef: record.taskRef, taskType: record.taskType, chunks: record.chunks.length })
    }

    try {
      for (const chunk of record.chunks) {
        if (chunk.state === 'succeeded') continue
        chunk.state = 'running'
        chunk.failureReason = null
        try {
          const decoded = await this.#executeChunkWithRetry(record, chunk)
          if (decoded.dropped > 0 || decoded.unknownRefs > 0) {
            this.#log('warn', 'task.decode.refs', {
              taskRef: record.taskRef,
              taskType: record.taskType,
              dropped: decoded.dropped,
              unknownRefs: decoded.unknownRefs,
              refSamples: decoded.droppedRefs.slice(0, 2),
            })
          }
          chunk.items = decoded.items.map((entry) => entry.item)
          chunk.refs = [...new Set(decoded.items.flatMap((entry) => entry.refs))]
          chunk.dropped = decoded.dropped
          chunk.unknownRefs = decoded.unknownRefs
          chunk.state = 'succeeded'
        } catch (error) {
          const failure = asEngineFailure(error)
          chunk.state = 'failed'
          chunk.failureReason = failure.reason
          return this.#failRecord(record, failure, chunk)
        }
      }
      return this.#succeedRecord(record)
    } catch (error) {
      return this.#failRecord(record, asEngineFailure(error))
    }
  }

  /** 单块执行：装配 → 调用 → 解析，包在调用级自动重试内（§4.1、§6.1、决策 6）。 */
  async #executeChunkWithRetry(record: TaskRecord, chunk: ChunkRecord): Promise<DecodeResult> {
    const units = this.#unitsOfChunk(record, chunk)
    return await runWithAutoRetry(
      async () => {
        const messages = buildMessages({ taskType: record.taskType, params: record.params, units })
        const call = await this.#modelClient.call(messages)
        return await this.#decode(record, call.text)
      },
      {
        maxAttempts: () => this.config.get().retry.maxAttempts,
        clock: this.#clock,
        random: this.#random,
        breaker: this.#breaker,
        target: this.#breakerTarget(),
        backoff: this.#limits.retry,
        onRetry: ({ retries, delayMs, reason }) => {
          record.autoRetries += 1
          this.#emit('task.retry', record, {
            retryKind: 'auto',
            attempt: retries,
            delayMs,
            chunkIndex: chunk.index + 1,
            counts: this.#counts(record),
            reason,
          })
          this.#log('warn', 'task.retry', {
            taskRef: record.taskRef,
            chunkIndex: chunk.index + 1,
            attempt: retries,
            delayMs,
            reason,
          })
        },
      },
    )
  }

  /** 解析：超过阈值走 worker（决策 7），否则主线程；错误按 §6.1 归类。 */
  async #decode(record: TaskRecord, text: string): Promise<DecodeResult> {
    const payload: DecodePayload = {
      text,
      schema: record.params.outputSchema,
      units: record.input.units.map((unit) => ({ marker: unit.marker, id: unit.id })),
    }
    const heavy = text.length >= this.#limits.workerDecodeMinChars || record.input.units.length >= this.#limits.workerDecodeMinUnits

    try {
      return heavy ? await this.#decodeRunner(payload) : decodeResponseText(payload)
    } catch (error) {
      if (error instanceof OutputInvalidError) throw new EngineFailure('OUTPUT_INVALID', error.message)
      if (error instanceof WorkerCrashError) throw new EngineFailure('WORKER_CRASH', '解析 worker 崩溃')
      throw error
    }
  }

  #unitsOfChunk(record: TaskRecord, chunk: ChunkRecord): NormalizedUnit[] {
    const wanted = new Set(chunk.unitMarkers)
    return record.input.units.filter((unit) => wanted.has(unit.marker))
  }

  #succeedRecord(record: TaskRecord): TaskOutcome {
    record.state = 'succeeded'
    record.result = { items: record.chunks.flatMap((chunk) => chunk.items) }
    record.sourceRefs = [...new Set(record.chunks.flatMap((chunk) => chunk.refs))]
    record.finishedAt = this.#clock.now()

    const counts = this.#counts(record)
    this.#emit('task.done', record, { counts, durationMs: this.#duration(record) })
    this.#log('info', 'task.done', { taskRef: record.taskRef, taskType: record.taskType, counts })

    return { ok: true, result: record.result, sourceRefs: record.sourceRefs, taskRef: record.taskRef }
  }

  #failRecord(record: TaskRecord, failure: EngineFailure, chunk?: ChunkRecord): TaskOutcome {
    const boundary = chunk ? `（块 ${chunk.index + 1}/${record.chunks.length}）` : ''
    const presented = new EngineFailure(failure.reason, `${failure.message}${boundary}`, {
      retryAfterMs: failure.retryAfterMs,
      cause: failure,
    })

    record.state = 'failed'
    record.failure = { reason: presented.reason, message: presented.message }
    record.finishedAt = this.#clock.now()

    const counts = this.#counts(record)
    this.#emit('task.failed', record, {
      code: presented.code,
      reason: presented.reason,
      chunkIndex: chunk ? chunk.index + 1 : undefined,
      counts,
      durationMs: this.#duration(record),
    })
    this.#log(presented.code === 'TIMEOUT' ? 'warn' : 'error', 'task.failed', {
      taskRef: record.taskRef,
      taskType: record.taskType,
      code: presented.code,
      reason: presented.reason,
      counts,
    })

    return { ok: false, error: toEnvelope(presented, taskScope(record.taskRef)) }
  }

  /** 返回新任务引用的「镜像」记录：API-008 无论结果如何都给出新引用（§4.2 ③）。 */
  #mirror(source: TaskRecord): TaskOutcome {
    const ref = newTaskRef()
    const clone = cloneSettledRecord(source, ref, this.#clock.now())
    this.#registry.set(clone)

    if (source.state === 'succeeded' && source.result) {
      return { ok: true, result: clone.result ?? source.result, sourceRefs: [...clone.sourceRefs], taskRef: ref }
    }

    const summary = source.failure ?? { reason: 'UNKNOWN' as FailureReason, message: '任务未成功完成' }
    return { ok: false, error: toEnvelope(new EngineFailure(summary.reason, summary.message), taskScope(ref)) }
  }

  // -------------------------------------------------------------------------
  // 内部：计数 / 事件 / 日志
  // -------------------------------------------------------------------------

  #counts(record: TaskRecord): EngineEventCounts {
    return {
      chunks: record.chunks.length,
      succeededChunks: record.chunks.filter((chunk) => chunk.state === 'succeeded').length,
      failedChunks: record.chunks.filter((chunk) => chunk.state === 'failed').length,
      items: record.chunks.reduce((sum, chunk) => sum + chunk.items.length, 0),
      dropped: record.chunks.reduce((sum, chunk) => sum + chunk.dropped, 0),
      unknownRefs: record.chunks.reduce((sum, chunk) => sum + chunk.unknownRefs, 0),
      autoRetries: record.autoRetries,
    }
  }

  #duration(record: TaskRecord): number {
    if (record.startedAt === null || record.finishedAt === null) return 0
    return record.finishedAt - record.startedAt
  }

  #emit(
    event: EngineTaskEvent['event'],
    record: TaskRecord,
    extra: Partial<Omit<EngineTaskEvent, 'event' | 'ts' | 'taskRef' | 'taskType' | 'state'>> = {},
  ): void {
    this.events.publish({
      event,
      ts: this.#clock.now(),
      taskRef: record.taskRef,
      taskType: record.taskType,
      state: record.state,
      ...extra,
    })
  }

  #log(level: EngineLogEntry['level'], event: string, fields: Record<string, unknown>): void {
    this.#logger({ level, event, ts: this.#clock.now(), fields })
  }

  #breakerTarget(): string {
    const baseUrl = this.config.get().model.baseUrl.trim()
    return baseUrl.length > 0 ? baseUrl : 'model:unconfigured'
  }
}

/** 归一化输入单元并编号标记（§4.1 ②；编号全任务唯一，来源引用据此回填）。 */
export function normalizeInput(input: Api007Request['input']): NormalizedInput {
  const rawUnits = input.kind === '文本' ? [input.unit] : input.units
  return {
    kind: input.kind,
    units: rawUnits.map((unit, index) => ({ marker: index + 1, id: unit.id, text: unit.text })),
  }
}

/** 分块计划（决策 4：可分块类型按上限切块；不可分块类型整入单次调用）。 */
export function planChunks(chunkable: boolean, input: NormalizedInput, limits: EngineLimits): ChunkRecord[] {
  const size = chunkable ? Math.max(1, limits.chunkMaxUnits) : Math.max(1, input.units.length)
  const chunks: ChunkRecord[] = []
  for (let start = 0; start < input.units.length; start += size) {
    chunks.push({
      index: chunks.length,
      unitMarkers: input.units.slice(start, start + size).map((unit) => unit.marker),
      state: 'pending',
      items: [],
      refs: [],
      dropped: 0,
      unknownRefs: 0,
      failureReason: null,
    })
  }
  return chunks
}

/** 创建引擎实例（默认使用进程级配置 / 事件通道；外壳与测试可注入）。 */
export function createEngine(options: EngineOptions = {}): Engine {
  return new Engine(options)
}
