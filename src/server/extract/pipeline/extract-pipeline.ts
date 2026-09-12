/**
 * 批次管线（mod-006 §3.1「pipeline/extract-pipeline.ts —— 批次编排」、§3.4、§5.3、§4）。
 *
 * 职责：窗口 → 识别 → 抽取 → 聚类 → 落库 → 汇总。全模块唯一发起模型任务的路径，也是唯一
 * 需要串行化的写路径（§3.4）：
 * - 批内按群分片；子任务并发交给 `MOD-003` 的信号量排队，本模块不自建并发池；
 * - 同一时刻只跑一批：批次运行期间的新触发顺延到下一批，只保留最新一次（不堆积）；
 * - 分项失败落在 `failures`（含任务引用），经 `retry(scope)` 分项重试（任务引用交 `API-008`）；
 * - 聚类失败时本批不落库（主题非空约束），已完成阶段的草稿保留任务引用、仅重跑聚类（决策 2）。
 *
 * 触发与预期（§5.2）：`run()` 缺省按水位推导窗口（重启后重扫一个有界的重叠窗口，幂等吸收重复）；
 * 采集成功后由外壳（MOD-004）触发，非 HTTP、非 `API-###`。
 */

import type { ErrorCode, ExtractedItem, Id, RawMessage, TaskOutcome, TaskRef, Timestamp } from '@shared'

import { DUE_TODO_WINDOW_MS, FALLBACK_TOPIC, MAX_UNITS_PER_TASK, OVERLAP_WINDOW_MS } from '../constants'
import { analysisFailed, envelopeOf, type ExtractLogger } from '../errors'
import { remindStateOf } from '../reminder/due-todo'
import type { EntryRepository } from '../store/entry-repository'
import {
  buildEntryId,
  buildExtractionRequest,
  buildRecognitionRequest,
  createEngineTaskGateway,
  MemberNameIndex,
  parseExtractedDraft,
  parseRecognizedItems,
  taskRefOf,
  type ExtractedDraft,
  type RecognizedItem,
  type TaskGateway,
} from './recognition'
import {
  assignTopics,
  buildClusterRequest,
  clusterUnits,
  distinctTopics,
  parseClusterAssignments,
  sliceClusterCalls,
} from './topic-cluster'
import { deriveWatermark, scanWindow, type ExtractWindow } from './watermark'

export type { ExtractWindow } from './watermark'

// ---------------------------------------------------------------------------
// 对外类型（§3.3）
// ---------------------------------------------------------------------------

/** 批次分项失败（含任务引用；`API-008` 重试凭它归属）。 */
export interface ExtractBatchFailure {
  /** 失败边界（群标识；批次级失败为空串）。 */
  group: Id
  code: ErrorCode
  taskRef: TaskRef | null
  reason?: string
}

/** 批次计数（汇总口径，供外壳展示）。 */
export interface BatchCounts {
  groups: number
  messages: number
  recognized: number
  extracted: number
  written: number
  failedTasks: number
}

/** 批次结果（§5.3 状态机：`idle → running → succeeded | partial | failed`，此处给出终态）。 */
export interface BatchResult {
  status: 'succeeded' | 'partial' | 'failed'
  counts: BatchCounts
  failures: ExtractBatchFailure[]
  window: ExtractWindow | null
}

/** 分项重试范围：按群（重跑该群分片）或按任务引用（交 `API-008`）。 */
export interface GroupScope {
  groupId: Id
  /** 重跑窗口；缺省取本进程最近一次批次窗口，再缺省按水位推导。 */
  window?: ExtractWindow
}

/** 管线可注入项（测试注入替身：不真调模型、不真开库）。 */
export interface ExtractPipelineOptions {
  repository: EntryRepository
  gateway?: TaskGateway
  clock?: () => number
  logger?: ExtractLogger
  /** 失败任务记录容量（LRU；供 `API-008` 重试归属，默认 200）。 */
  failureCapacity?: number
}

/** 清洗后的登记项：条目 + 主题。 */
interface EntryWrite extends ExtractedDraft {
  topic: string
}

/** 失败任务记录（重试时可继续走完「识别 / 抽取 → 聚类 → 落库」）。 */
interface FailedTaskRecord {
  stage: '识别' | '抽取' | '聚类'
  groupId: Id | null
  window: ExtractWindow
  /** 该任务当时的输入消息（识别 / 抽取重跑与后续阶段共用）。 */
  messages: RawMessage[]
  recognitionType?: string
  sourceMessageIds?: Id[]
  /** 聚类重试用：已完成识别 / 抽取的草稿。 */
  drafts?: ExtractedDraft[]
}

interface PendingRun {
  window: ExtractWindow
  waiters: Array<(result: BatchResult) => void>
}

// ---------------------------------------------------------------------------
// 管线
// ---------------------------------------------------------------------------

/** 提取管线（单飞 + 顺延；详见文件头）。 */
export class ExtractPipeline {
  readonly #repository: EntryRepository
  readonly #gateway: TaskGateway
  readonly #clock: () => number
  readonly #logger: ExtractLogger
  readonly #failureCapacity: number

  /** 串行链：`run` 与 `retry` 共用，同一时刻只跑一个批次 / 分项重试单元。 */
  #lock: Promise<unknown> = Promise.resolve()
  /** 是否有批次在跑（含已登记、尚未出队的批次单元）。 */
  #running = false
  /** 顺延的下一批（只保留最新一次触发）。 */
  #pending: PendingRun | null = null
  /** 本进程上次成功批次的终点（不持久化，§5.2）。 */
  #lastBatchEnd: Timestamp | null = null
  /** 最近一次批次窗口（分项重试的缺省范围）。 */
  #lastWindow: ExtractWindow | null = null
  /** 失败任务记录（LRU；键 = 任务引用）。 */
  #failedTasks = new Map<TaskRef, FailedTaskRecord>()

  constructor(options: ExtractPipelineOptions) {
    this.#repository = options.repository
    this.#gateway = options.gateway ?? createEngineTaskGateway()
    this.#clock = options.clock ?? Date.now
    this.#logger = options.logger ?? {}
    this.#failureCapacity = Math.max(1, options.failureCapacity ?? 200)
  }

  /** 本进程最近一次批次窗口（无则 null）。 */
  lastWindow(): ExtractWindow | null {
    return this.#lastWindow
  }

  /** 按水位推导下一次扫描窗口（§5.2；`run()` 缺省触发时使用）。 */
  nextWindow(now: Timestamp = this.#clock()): ExtractWindow {
    const facts = this.#repository.watermarkFacts()
    const derivation = deriveWatermark({
      lastBatchEnd: this.#lastBatchEnd,
      latestEntrySourceTime: facts.latestEntrySourceTime,
      hasEntries: facts.hasEntries,
    })
    return scanWindow(derivation, now, OVERLAP_WINDOW_MS)
  }

  /** 采集成功后由外壳触发（window 缺省 = 按水位推导；顺延语义见文件头）。 */
  run(window?: ExtractWindow): Promise<BatchResult> {
    const resolved = window ?? this.nextWindow()
    if (this.#running) {
      const pending = this.#pending ?? { window: resolved, waiters: [] }
      pending.window = resolved
      this.#pending = pending
      this.#logger.info?.('extract.batch.deferred', { module: 'MOD-006', from: resolved.from, to: resolved.to })
      return new Promise<BatchResult>((resolve) => {
        pending.waiters.push(resolve)
      })
    }
    this.#running = true
    return this.#enqueue(async () => {
      try {
        const first = await this.#execute(resolved)
        let result = first
        for (let next = this.#takePending(); next !== null; next = this.#takePending()) {
          result = await this.#execute(next.window)
          for (const waiter of next.waiters) waiter(result)
        }
        return first
      } finally {
        this.#running = false
      }
    })
  }

  /** 分项重试（§4）：按群重跑该群分片；任务引用交 `API-008` 并接续后续阶段。 */
  retry(scope: GroupScope | TaskRef): Promise<BatchResult> {
    return this.#enqueue(async () =>
      typeof scope === 'string' ? await this.#retryByRef(scope) : await this.#retryGroup(scope),
    )
  }

  // -------------------------------------------------------------------------
  // 批次执行
  // -------------------------------------------------------------------------

  async #execute(window: ExtractWindow): Promise<BatchResult> {
    const startedAt = this.#clock()
    const counts = emptyCounts()
    const failures: ExtractBatchFailure[] = []
    this.#lastWindow = window
    this.#logger.info?.('extract.batch.start', { module: 'MOD-006', from: window.from, to: window.to })

    let messages: RawMessage[]
    try {
      messages = this.#repository.readWindowMessages(window)
    } catch (error) {
      const failure = failureFromError(error, '')
      this.#logger.error?.('extract.batch.failed', { module: 'MOD-006', code: failure.code })
      return { status: 'failed', counts, failures: [failure], window }
    }
    counts.messages = messages.length
    if (messages.length === 0) {
      this.#lastBatchEnd = window.to
      return { status: 'succeeded', counts, failures, window }
    }

    const byGroup = groupMessages(messages)
    counts.groups = byGroup.size
    const drafts: ExtractedDraft[] = []
    await Promise.all(
      [...byGroup.entries()].map(([groupId, groupMessages]) =>
        this.#processGroup(groupId, groupMessages, window, drafts, failures, counts),
      ),
    )
    counts.extracted = drafts.length
    counts.recognized = counts.recognized

    if (drafts.length > 0) {
      counts.written = (await this.#finalize(window, drafts, failures)).written
    }
    counts.failedTasks = failures.length
    const status = statusOf(counts, failures)
    if (failures.length === 0) this.#lastBatchEnd = window.to
    this.#logger.info?.('extract.batch.done', {
      module: 'MOD-006',
      status,
      counts: { ...counts },
      durationMs: this.#clock() - startedAt,
    })
    return { status, counts, failures, window }
  }

  /** 群分片：识别（按输入单元上限切片）→ 逐条抽取。 */
  async #processGroup(
    groupId: Id,
    messages: readonly RawMessage[],
    window: ExtractWindow,
    drafts: ExtractedDraft[],
    failures: ExtractBatchFailure[],
    counts: BatchCounts,
  ): Promise<void> {
    const ordered = sortBySentAt(messages)
    for (const slice of chunkUnits(ordered, MAX_UNITS_PER_TASK)) {
      const outcome = await this.#runTask(buildRecognitionRequest(slice))
      if (!outcome.ok) {
        failures.push(failureFromEnvelope(outcome.error, groupId))
        this.#rememberFailed(taskRefOf(outcome.error), { stage: '识别', groupId, window, messages: slice })
        continue
      }
      const items = parseRecognizedItems(outcome.result.items, slice)
      counts.recognized += items.length
      drafts.push(...(await this.#extractItems(groupId, slice, items, window, failures)))
    }
  }

  /** 识别结果 → 抽取草稿（并发发起；单条失败不影响同组其余条目）。 */
  async #extractItems(
    groupId: Id,
    messages: readonly RawMessage[],
    items: readonly RecognizedItem[],
    window: ExtractWindow,
    failures: ExtractBatchFailure[],
  ): Promise<ExtractedDraft[]> {
    if (items.length === 0) return []
    const byId = new Map(messages.map((message) => [message.messageId, message]))
    const members = new MemberNameIndex(this.#repository.readMembers(groupId))
    const results = await Promise.all(
      items.map(async (item): Promise<ExtractedDraft | null> => {
        const sources = item.sourceMessageIds
          .map((messageId) => byId.get(messageId))
          .filter((message): message is RawMessage => message !== undefined)
        const outcome = await this.#runTask(buildExtractionRequest(item.recognitionType, sources))
        if (!outcome.ok) {
          failures.push(failureFromEnvelope(outcome.error, groupId))
          this.#rememberFailed(taskRefOf(outcome.error), {
            stage: '抽取',
            groupId,
            window,
            messages: sources,
            recognitionType: item.recognitionType,
            sourceMessageIds: item.sourceMessageIds,
          })
          return null
        }
        const draft = parseExtractedDraft(outcome.result.items[0] ?? {}, {
          groupId,
          recognitionType: item.recognitionType,
          sourceMessageIds: item.sourceMessageIds,
          members,
        })
        if (draft === null) {
          failures.push({
            group: groupId,
            code: 'ANALYSIS_FAILED',
            taskRef: outcome.taskRef,
            reason: '抽取结果缺少必填字段（headline / aiSummary）',
          })
          return null
        }
        return { ...draft, entryId: draft.entryId || buildEntryId(groupId, item.recognitionType, item.sourceMessageIds) }
      }),
    )
    return results.filter((draft): draft is ExtractedDraft => draft !== null)
  }

  /** 聚类 → 落库（聚类失败 = 本批不落库；草稿保留任务引用供重跑）。 */
  async #finalize(
    window: ExtractWindow,
    drafts: readonly ExtractedDraft[],
    failures: ExtractBatchFailure[],
  ): Promise<{ ok: boolean; written: number }> {
    if (drafts.length === 0) return { ok: true, written: 0 }

    const existing = distinctTopics(this.#repository.readEntries(null).records.map((entry) => entry.topic))
    const assignments: Map<Id, string>[] = []
    let pool: string[] = [...existing]
    for (const slice of sliceClusterCalls(clusterUnits(drafts))) {
      const outcome = await this.#runTask(buildClusterRequest(slice, pool))
      if (!outcome.ok) {
        failures.push(failureFromEnvelope(outcome.error, ''))
        this.#rememberFailed(taskRefOf(outcome.error), {
          stage: '聚类',
          groupId: null,
          window,
          messages: [],
          drafts: [...drafts],
        })
        this.#logger.warn?.('extract.batch.cluster.failed', { module: 'MOD-006', entries: drafts.length })
        return { ok: false, written: 0 }
      }
      const assignment = parseClusterAssignments(outcome.result.items, slice)
      assignments.push(assignment)
      pool = distinctTopics([...pool, ...assignment.values()])
    }

    const topics = assignTopics(
      drafts.map((draft) => draft.entryId),
      assignments,
    )
    const now = this.#clock()
    const records: ExtractedItem[] = drafts.map((draft) => toItem(draft, topics.get(draft.entryId) ?? FALLBACK_TOPIC, now))
    const writeResult = this.#repository.writeEntries(records, { bumpEpoch: false })
    if (writeResult.failures.length > 0) {
      failures.push({
        group: '',
        code: 'STORAGE_UNAVAILABLE',
        taskRef: null,
        reason: `${writeResult.failures.length} 条条目写入被存储拒绝`,
      })
      this.#logger.error?.('extract.batch.write.failed', {
        module: 'MOD-006',
        written: writeResult.written,
        rejected: writeResult.failures.length,
      })
      return { ok: false, written: writeResult.written }
    }
    this.#logger.info?.('extract.batch.written', { module: 'MOD-006', written: writeResult.written })
    return { ok: true, written: writeResult.written }
  }

  // -------------------------------------------------------------------------
  // 分项重试
  // -------------------------------------------------------------------------

  /** 按任务引用重试（识别 → 抽取 → 聚类 → 落库；聚类失败记录保留全部草稿）。 */
  async #retryByRef(ref: TaskRef): Promise<BatchResult> {
    const record = this.#failedTasks.get(ref)
    if (record === undefined) {
      // 引用未登记（多为进程重启后）：仍交 API-008 试一次，但结果无法归属到批次，只能上报结论。
      const outcome = await this.#runRetry(ref)
      this.#logger.warn?.('extract.retry.unbound', { module: 'MOD-006', taskRef: ref, ok: outcome.ok })
      return outcome.ok
        ? { status: 'succeeded', counts: emptyCounts(), failures: [], window: this.#lastWindow }
        : { status: 'failed', counts: emptyCounts(), failures: [failureFromEnvelope(outcome.error, '')], window: this.#lastWindow }
    }
    this.#failedTasks.delete(ref)

    const failures: ExtractBatchFailure[] = []
    const counts = emptyCounts()
    let drafts: ExtractedDraft[] = []
    switch (record.stage) {
      case '识别': {
        const outcome = await this.#runRetry(ref)
        if (!outcome.ok) return this.#retryFailedAgain(record, outcome, failures)
        const items = parseRecognizedItems(outcome.result.items, record.messages)
        counts.recognized = items.length
        drafts = await this.#extractItems(record.groupId ?? '', record.messages, items, record.window, failures)
        break
      }
      case '抽取': {
        const outcome = await this.#runRetry(ref)
        if (!outcome.ok) return this.#retryFailedAgain(record, outcome, failures)
        const groupId = record.groupId ?? ''
        const members = new MemberNameIndex(this.#repository.readMembers(groupId))
        const draft = parseExtractedDraft(outcome.result.items[0] ?? {}, {
          groupId,
          recognitionType: record.recognitionType ?? '',
          sourceMessageIds: record.sourceMessageIds ?? [],
          members,
        })
        if (draft === null) {
          failures.push({
            group: groupId,
            code: 'ANALYSIS_FAILED',
            taskRef: outcome.taskRef,
            reason: '抽取结果缺少必填字段（headline / aiSummary）',
          })
          return this.#retryFailedAgain(record, outcome, failures)
        }
        drafts = [draft]
        break
      }
      case '聚类': {
        drafts = record.drafts ?? []
        const failure = await this.#reclusterFailure(record, ref, drafts, failures)
        if (failure !== null) return failure
        break
      }
    }

    if (drafts.length > 0) {
      counts.extracted = drafts.length
      counts.written = (await this.#finalize(record.window, drafts, failures)).written
    }
    counts.failedTasks = failures.length
    return { status: statusOf(counts, failures), counts, failures, window: record.window }
  }

  /** 聚类重试：仅重跑聚类（不重跑识别 / 抽取），随后补一次落库。 */
  async #reclusterFailure(
    record: FailedTaskRecord,
    ref: TaskRef,
    drafts: readonly ExtractedDraft[],
    failures: ExtractBatchFailure[],
  ): Promise<BatchResult | null> {
    if (drafts.length === 0) return null
    const existing = distinctTopics(this.#repository.readEntries(null).records.map((entry) => entry.topic))
    const assignments: Map<Id, string>[] = []
    let pool: string[] = [...existing]
    for (const slice of sliceClusterCalls(clusterUnits(drafts))) {
      const outcome = await this.#runTask(buildClusterRequest(slice, pool))
      if (!outcome.ok) {
        failures.push(failureFromEnvelope(outcome.error, ''))
        this.#rememberFailed(taskRefOf(outcome.error) ?? ref, record)
        const counts = emptyCounts()
        counts.failedTasks = failures.length
        return { status: 'failed', counts, failures, window: record.window }
      }
      const assignment = parseClusterAssignments(outcome.result.items, slice)
      assignments.push(assignment)
      pool = distinctTopics([...pool, ...assignment.values()])
    }
    const topics = assignTopics(
      drafts.map((draft) => draft.entryId),
      assignments,
    )
    const now = this.#clock()
    const records: ExtractedItem[] = drafts.map((draft) => toItem(draft, topics.get(draft.entryId) ?? FALLBACK_TOPIC, now))
    const writeResult = this.#repository.writeEntries(records, { bumpEpoch: false })
    if (writeResult.failures.length > 0) {
      failures.push({
        group: '',
        code: 'STORAGE_UNAVAILABLE',
        taskRef: null,
        reason: `${writeResult.failures.length} 条条目写入被存储拒绝`,
      })
      return null
    }
    return null
  }

  #retryFailedAgain(record: FailedTaskRecord, outcome: ExtractTaskOutcome, failures: ExtractBatchFailure[]): BatchResult {
    failures.push(failureFromEnvelope(outcome.ok ? null : outcome.error, record.groupId ?? ''))
    if (!outcome.ok) this.#rememberFailed(taskRefOf(outcome.error), record)
    const counts = emptyCounts()
    counts.failedTasks = failures.length
    return { status: 'failed', counts, failures, window: record.window }
  }

  /** 按群重跑一个分片（窗口缺省 = 最近批次窗口，再缺省 = 水位推导）。 */
  async #retryGroup(scope: GroupScope): Promise<BatchResult> {
    const window = scope.window ?? this.#lastWindow ?? this.nextWindow()
    const failures: ExtractBatchFailure[] = []
    const counts = emptyCounts()
    let messages: RawMessage[]
    try {
      messages = this.#repository.readWindowMessages(window).filter((message) => message.groupId === scope.groupId)
    } catch (error) {
      return { status: 'failed', counts, failures: [failureFromError(error, scope.groupId)], window }
    }
    counts.messages = messages.length
    counts.groups = messages.length > 0 ? 1 : 0
    const drafts: ExtractedDraft[] = []
    await this.#processGroup(scope.groupId, messages, window, drafts, failures, counts)
    counts.extracted = drafts.length
    if (drafts.length > 0) {
      counts.written = (await this.#finalize(window, drafts, failures)).written
    }
    counts.failedTasks = failures.length
    return { status: statusOf(counts, failures), counts, failures, window }
  }

  // -------------------------------------------------------------------------
  // 内部工具
  // -------------------------------------------------------------------------

  /** 任务执行：异常统一折叠为失败信封（不让批次 promise 挂起）。 */
  async #runTask(request: Parameters<TaskGateway['execute']>[0]): Promise<ExtractTaskOutcome> {
    try {
      return await this.#gateway.execute(request)
    } catch (error) {
      return { ok: false, error: unknownErrorEnvelope(error) }
    }
  }

  /** `API-008` 重试执行：与 `#runTask` 同一异常折叠口径（不让批次 promise 挂起）。 */
  async #runRetry(ref: TaskRef): Promise<ExtractTaskOutcome> {
    try {
      return await this.#gateway.retry(ref)
    } catch (error) {
      return { ok: false, error: unknownErrorEnvelope(error) }
    }
  }

  #rememberFailed(ref: TaskRef | null, record: FailedTaskRecord): void {
    if (ref === null || ref.length === 0) return
    this.#failedTasks.set(ref, record)
    while (this.#failedTasks.size > this.#failureCapacity) {
      const oldest = this.#failedTasks.keys().next().value
      if (oldest === undefined) break
      this.#failedTasks.delete(oldest)
    }
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#lock.then(task)
    this.#lock = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  #takePending(): PendingRun | null {
    const pending = this.#pending
    this.#pending = null
    return pending
  }
}

type ExtractTaskOutcome = TaskOutcome | { ok: false; error: ReturnType<typeof unknownErrorEnvelope> }

// ---------------------------------------------------------------------------
// 纯函数（导出供单测与复用）
// ---------------------------------------------------------------------------

/** 按来源群分组。 */
export function groupMessages(messages: readonly RawMessage[]): Map<Id, RawMessage[]> {
  const byGroup = new Map<Id, RawMessage[]>()
  for (const message of messages) {
    const list = byGroup.get(message.groupId)
    if (list === undefined) byGroup.set(message.groupId, [message])
    else list.push(message)
  }
  return byGroup
}

/** 按发送时间升序（同值按消息标识稳定排序）。 */
export function sortBySentAt(messages: readonly RawMessage[]): RawMessage[] {
  return [...messages].sort((a, b) => a.sentAt - b.sentAt || compareIds(a.messageId, b.messageId))
}

/** 按单元上限切片（保持时间顺序；切片只影响单次调用规模，不改变幂等键）。 */
export function chunkUnits<T>(records: readonly T[], maxUnits: number): T[][] {
  const slices: T[][] = []
  for (let start = 0; start < records.length; start += maxUnits) {
    slices.push(records.slice(start, start + maxUnits))
  }
  return slices
}

/** 草稿 + 主题 → `DM-010` 记录（提醒状态随写入重算；`now` 由注入时钟给出）。 */
export function toItem(draft: ExtractedDraft, topic: string, now: Timestamp): ExtractedItem {
  return {
    entryId: draft.entryId,
    recognitionType: draft.recognitionType,
    timeElement: draft.timeElement,
    locationElement: draft.locationElement,
    personElementMemberIds: draft.personElementMemberIds.length === 0 ? null : draft.personElementMemberIds,
    subjectElement: draft.subjectElement,
    deadline: draft.deadline,
    groupId: draft.groupId,
    sourceMessageIds: [...draft.sourceMessageIds],
    headline: draft.headline,
    aiSummary: draft.aiSummary,
    topic,
    priority: draft.priority,
    todoStatus: '未处理',
    remindState: remindStateOf(
      { deadline: draft.deadline, todoStatus: '未处理' },
      now,
      DUE_TODO_WINDOW_MS,
    ),
  }
}

/** 批次状态：无失败 = succeeded；有产出 = partial；全失败 = failed。 */
export function statusOf(counts: BatchCounts, failures: readonly ExtractBatchFailure[]): BatchResult['status'] {
  if (failures.length === 0) return 'succeeded'
  if (counts.written > 0 || counts.extracted > 0 || counts.recognized > 0) return 'partial'
  return 'failed'
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function emptyCounts(): BatchCounts {
  return { groups: 0, messages: 0, recognized: 0, extracted: 0, written: 0, failedTasks: 0 }
}

function failureFromEnvelope(error: { code: ErrorCode; message: string; scope: string } | null, group: Id): ExtractBatchFailure {
  if (error === null) {
    return { group, code: 'ANALYSIS_FAILED', taskRef: null, reason: '任务无结果且无错误信息' }
  }
  return { group, code: error.code, taskRef: taskRefOf({ ...error, retryable: true, context: undefined } as never), reason: error.message }
}

function failureFromError(error: unknown, group: Id): ExtractBatchFailure {
  const envelope = envelopeOf(error)
  return {
    group,
    code: envelope?.code ?? 'ANALYSIS_FAILED',
    taskRef: envelope === null ? null : taskRefOf(envelope),
    reason: envelope?.message ?? (error instanceof Error ? error.message : '未知异常'),
  }
}

function unknownErrorEnvelope(error: unknown): { code: ErrorCode; message: string; retryable: boolean; scope: string } {
  const envelope = envelopeOf(error)
  if (envelope !== null) return envelope
  return {
    code: 'ANALYSIS_FAILED',
    message: error instanceof Error ? error.message : '未知异常',
    retryable: true,
    scope: 'extract:task',
  }
}

export { analysisFailed }
