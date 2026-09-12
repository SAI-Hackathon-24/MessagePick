/**
 * MOD-003 测试支撑（进程内假 OpenAI 兼容端点 + 假时钟 + 引擎装配）。
 *
 * 设计文档 §7 交付口径：**全部单测 mock 模型服务，禁止真调云端**。这里提供的假端点
 * 记录每个请求（URL / 模型名 / 凭据头 / messages），支持挂起（配合假时钟测超时）与一次性脚本响应。
 */

import type { TaskInput, TaskOutcome, TaskParams, TaskType, TaskUnit } from '@shared'

import { type ManualClock, createManualClock } from '../clock'
import { createEngineConfig, type EngineConfigPatch, type EngineConfigStore } from '../config'
import { EngineEventChannel, type EngineLogEntry, type EngineTaskEvent } from '../events'
import { createEngine, type Engine, type EngineOptions } from '../index'
import type { FetchLike } from '../model/client'
import { decodeResponseText, type DecodePayload, type DecodeResult } from '../parse/decode'
import type { EngineLimits } from '../policy/limits'
import { WorkerCrashError, type DecodeRunner } from '../worker/pool'

// ---------------------------------------------------------------------------
// 假端点
// ---------------------------------------------------------------------------

/** 一次模型请求的记录。 */
export interface FakeCall {
  url: string
  model: string
  authorization: string | null
  messages: Array<{ role: string; content: string }>
  at: number
}

/** 脚本化响应。 */
export interface FakeReply {
  /** 200 时的助手内容（缺省 `{"items": []}`）。 */
  content?: string | ((call: FakeCall) => string)
  status?: number
  headers?: Record<string, string>
  /** 非 200 时的响应体（缺省给通用错误体）。 */
  rawBody?: string
  /** 挂起不响应（配合假时钟测超时；不占命令返回）。 */
  hang?: boolean
  /** 抛出网络异常（DNS / TLS / 连接失败）。 */
  networkError?: boolean
  /** 完成原因（如 `content_filter` 测拒答）。 */
  finishReason?: string
  /** 拒答字段（OpenAI 兼容的 message.refusal）。 */
  refusal?: string
}

interface PendingCall {
  call: FakeCall
  reply: FakeReply
  done: boolean
  resolve: (response: Response) => void
  reject: (error: unknown) => void
}

/** 进程内假 OpenAI 兼容服务（不发起任何真实请求）。 */
export class FakeModelService {
  readonly calls: FakeCall[] = []
  /** 开始调用即计数、响应送达才递减（用于并发断言）。 */
  concurrent = 0
  maxConcurrent = 0
  /** 打开后所有请求挂起，等待 `releaseOne` / `releaseAll`。 */
  hold = false
  /** 未给出脚本时的缺省响应。 */
  defaultReply: FakeReply = { content: '{"items": []}' }

  #clock: ManualClock
  #replies: FakeReply[] = []
  #pending: PendingCall[] = []

  constructor(clock: ManualClock) {
    this.#clock = clock
  }

  /** 排入一条脚本响应（FIFO）。 */
  reply(reply: FakeReply): void {
    this.#replies.push(reply)
  }

  /** 便捷：一条成功响应 `{"items": items}`。 */
  replyItems(items: unknown[]): void {
    this.reply({ content: JSON.stringify({ items }) })
  }

  /** 便捷：一条失败响应。 */
  replyStatus(status: number, headers: Record<string, string> = {}): void {
    this.reply({ status, headers })
  }

  get pendingCount(): number {
    return this.#pending.filter((entry) => !entry.done).length
  }

  releaseOne(): boolean {
    const entry = this.#pending.find((candidate) => !candidate.done)
    if (!entry) return false
    entry.resolve(this.#respond(entry.call, entry.reply))
    return true
  }

  releaseAll(): void {
    while (this.releaseOne()) {
      /* 逐个放行 */
    }
  }

  fetch: FetchLike = (url, init) => {
    const call = this.#recordCall(url, init)
    this.concurrent += 1
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent)

    const reply = this.#replies.length > 0 ? this.#replies.shift() ?? this.defaultReply : this.defaultReply

    if (reply.networkError) {
      this.concurrent -= 1
      return Promise.reject(new TypeError('fetch failed（测试模拟：网络不可达）'))
    }

    if (reply.hang || this.hold) {
      return this.#park(call, reply, init.signal ?? null)
    }

    this.concurrent -= 1
    return Promise.resolve(this.#respond(call, reply))
  }

  #recordCall(url: string, init: RequestInit): FakeCall {
    const body = typeof init.body === 'string' ? init.body : ''
    let parsed: { model?: unknown; messages?: unknown } = {}
    try {
      parsed = JSON.parse(body) as { model?: unknown; messages?: unknown }
    } catch {
      /* 保持空对象即可 */
    }
    const call: FakeCall = {
      url,
      model: typeof parsed.model === 'string' ? parsed.model : '',
      authorization: headerValue(init.headers, 'authorization'),
      messages: Array.isArray(parsed.messages)
        ? (parsed.messages as Array<{ role?: unknown; content?: unknown }>).map((message) => ({
            role: String(message.role ?? ''),
            content: String(message.content ?? ''),
          }))
        : [],
      at: this.#clock.now(),
    }
    this.calls.push(call)
    return call
  }

  #park(call: FakeCall, reply: FakeReply, signal: AbortSignal | null): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const entry: PendingCall = {
        call,
        reply,
        done: false,
        resolve: (response) => {
          if (entry.done) return
          entry.done = true
          this.concurrent -= 1
          resolve(response)
        },
        reject: (error) => {
          if (entry.done) return
          entry.done = true
          this.concurrent -= 1
          reject(error)
        },
      }
      this.#pending.push(entry)

      if (signal) {
        if (signal.aborted) {
          entry.reject(abortError())
        } else {
          signal.addEventListener('abort', () => entry.reject(abortError()), { once: true })
        }
      }
    })
  }

  #respond(call: FakeCall, reply: FakeReply): Response {
    const status = reply.status ?? 200
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(reply.headers ?? {}) }

    if (status >= 400) {
      const raw = reply.rawBody ?? JSON.stringify({ error: { message: 'mock failure' } })
      return new Response(raw, { status, headers })
    }

    const content = typeof reply.content === 'function' ? reply.content(call) : (reply.content ?? '{"items": []}')
    const message: Record<string, unknown> = { role: 'assistant', content }
    if (reply.refusal !== undefined) message.refusal = reply.refusal

    return new Response(
      JSON.stringify({
        id: 'mock-completion',
        object: 'chat.completion',
        choices: [{ index: 0, message, finish_reason: reply.finishReason ?? 'stop' }],
      }),
      { status, headers },
    )
  }
}

function headerValue(headers: RequestInit['headers'], name: string): string | null {
  if (!headers) return null
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const entry = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
    return entry ? entry[1] : null
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (key.toLowerCase() === name.toLowerCase()) return value
  }
  return null
}

function abortError(): Error {
  const error = new Error('This operation was aborted')
  error.name = 'AbortError'
  return error
}

// ---------------------------------------------------------------------------
// 引擎装配
// ---------------------------------------------------------------------------

/** 测试装配选项。 */
export interface HarnessOptions {
  /** 配置覆盖（默认已给可用的假模型服务配置；`retry.maxAttempts` 默认 3 与生产一致）。 */
  config?: EngineConfigPatch
  limits?: Partial<EngineLimits>
  registryCapacity?: number
  decodeWorker?: DecodeRunner
  random?: () => number
  clock?: ManualClock
}

/** 测试装配产物。 */
export interface Harness {
  engine: Engine
  clock: ManualClock
  service: FakeModelService
  events: EngineTaskEvent[]
  logs: EngineLogEntry[]
  config: EngineConfigStore
}

export const TEST_BASE_URL = 'https://model.test/v1'
export const TEST_API_KEY = 'test-api-key'
export const TEST_MODEL = 'test-model'

/** 装配一个隔离的引擎（假端点 + 假时钟 + 事件 / 日志采集）。 */
export function createHarness(options: HarnessOptions = {}): Harness {
  const clock = options.clock ?? createManualClock(0)
  const service = new FakeModelService(clock)
  const events: EngineTaskEvent[] = []
  const logs: EngineLogEntry[] = []
  const overrides = options.config ?? {}
  const config = createEngineConfig({
    model: { baseUrl: TEST_BASE_URL, apiKey: TEST_API_KEY, name: TEST_MODEL, taskConcurrency: 4, ...(overrides.model ?? {}) },
    timeouts: { modelCallMs: 90_000, ...(overrides.timeouts ?? {}) },
    retry: { maxAttempts: 3, ...(overrides.retry ?? {}) },
  })

  const engineOptions: EngineOptions = {
    config,
    clock,
    fetchImpl: service.fetch,
    random: options.random ?? (() => 0.5),
    logger: (entry) => logs.push(entry),
    events: new EngineEventChannel(),
  }
  if (options.limits) engineOptions.limits = options.limits
  if (options.registryCapacity !== undefined) engineOptions.registryCapacity = options.registryCapacity
  if (options.decodeWorker) engineOptions.decodeWorker = options.decodeWorker

  const engine = createEngine(engineOptions)
  engine.events.subscribe((event) => events.push(event))
  return { engine, clock, service, events, logs, config }
}

/** 换个引擎实例但共用假端点（模拟「进程重启后引用失效」时也方便复用组件）。 */
export function createSiblingEngine(harness: Harness): Engine {
  return createEngine({ config: harness.config, clock: harness.clock, fetchImpl: harness.service.fetch, events: new EngineEventChannel() })
}

// ---------------------------------------------------------------------------
// 数据便捷构造
// ---------------------------------------------------------------------------

export function unit(id: string, text = `内容 ${id}`): TaskUnit {
  return { id, text }
}

export function messagesInput(...ids: string[]): TaskInput {
  return { kind: '消息集合', units: ids.map((id) => unit(id)) }
}

export function contextInput(...ids: string[]): TaskInput {
  return { kind: '上下文', units: ids.map((id) => unit(id)) }
}

export function textInput(id: string, text = `内容 ${id}`): TaskInput {
  return { kind: '文本', unit: unit(id, text) }
}

export function defaultParams(overrides: Partial<TaskParams> = {}): TaskParams {
  return {
    instruction: '从输入单元中识别要点。',
    outputSchema: { type: 'object', required: ['label'], properties: { label: { type: 'string' } } },
    ...overrides,
  }
}

export function request(taskType: TaskType, input: TaskInput, params: TaskParams = defaultParams()) {
  return { taskType, input, params }
}

/** 结果条目便捷构造。 */
export function item(label: string, refs: Array<string | number>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { label, sourceRefs: refs, ...extra }
}

// ---------------------------------------------------------------------------
// 断言与推进工具
// ---------------------------------------------------------------------------

export function expectOk(outcome: TaskOutcome): Extract<TaskOutcome, { ok: true }> {
  if (!outcome.ok) {
    throw new Error(`预期成功，实际失败：${outcome.error.code} / ${String(outcome.error.context?.reason ?? '')}`)
  }
  return outcome
}

export function expectFailed(outcome: TaskOutcome): Extract<TaskOutcome, { ok: false }> {
  if (outcome.ok) throw new Error('预期失败，实际成功')
  return outcome
}

/** 让出宏任务队列（队列排水 / 事件派发在微任务里完成）。 */
export async function tick(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

/** 轮询等待条件成立（并发 / 排队类断言的同步点）。 */
export async function waitFor(predicate: () => boolean, maxTicks = 500): Promise<void> {
  for (let index = 0; index < maxTicks; index += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  throw new Error('等待条件超时')
}

/** 推进假时钟直到 promise 落定（自动重试的退避等待靠它驱动）。 */
export async function drive<T>(clock: ManualClock, promise: Promise<T>, options: { stepMs?: number; maxMs?: number } = {}): Promise<T> {
  const stepMs = options.stepMs ?? 250
  const maxMs = options.maxMs ?? 120_000
  let settled = false
  let value: T | undefined
  let failure: unknown

  void promise.then(
    (result) => {
      settled = true
      value = result
    },
    (error: unknown) => {
      settled = true
      failure = error
    },
  )

  for (let elapsed = 0; !settled && elapsed <= maxMs; elapsed += stepMs) {
    await clock.advance(stepMs)
  }
  if (!settled) throw new Error('任务未在假时钟预算内落定（自动重试未被推进？）')
  if (failure !== undefined) throw failure
  return value as T
}

/** 假解析 worker：前 `crashTimes` 次抛崩溃，之后走主线程解析。 */
export function createCrashingDecoder(options: { crashTimes: number }): DecodeRunner {
  let remaining = options.crashTimes
  return async (payload: DecodePayload): Promise<DecodeResult> => {
    if (remaining > 0) {
      remaining -= 1
      throw new WorkerCrashError('测试模拟的解析 worker 崩溃')
    }
    return decodeResponseText(payload)
  }
}
