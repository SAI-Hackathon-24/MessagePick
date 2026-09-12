/**
 * 分析批次编排（mod-005 §3.3 `AnalysisOrchestrator`、§3.5 状态机 A、§3.6、决策 5）。
 *
 * - 进程内入口（非 HTTP、非 `API-###`）：`MOD-004` 采集完成后调 `startBatch('ingestDone', scope)`
 *   （HLD 决策 9；空 scope = 不限）。
 * - 批次按「任务类型 × 分批窗口」切成分项（item），每项携带 `taskRef`；只有 `succeeded` 的
 *   分项才落库（`API-003`），失败分项不留半成品。
 * - 重复触发按「读库查缺块」判定：识别用出现记录水位，变体用 DM-008 是否为空，
 *   精华用 DM-009 是否缺行；缺块才重算，不写进度台账。
 * - 自动重试：仅后台分项适用（详设 §2.3 的统一退避，最多 3 次）；手动重试入口 `retryItem`。
 */

import type {
  Api007Request,
  ErrorEnvelope,
  Id,
  Meme,
  MemeHighlight,
  MemeOccurrence,
  MemeVariantLink,
  MonthlyCounts,
  RawMessage,
  SharedFilter,
  TaskOutcome,
  TaskRef,
  TaskType,
  TaskUnit,
  Timestamp,
} from '@shared'

import { ESSENCE_CANDIDATE_MESSAGES } from '../constants'
import {
  computeMemeKing,
  deriveLifecycle,
  fillMonthlyCounts,
  monthOf,
  weekOverWeekOf,
} from '../domain/metrics'
import { parseEssencePicks, parseRecognition, parseVariantClusters, type MemeTaskKind } from '../domain/tasks'
import { taskRefFromEnvelope } from '../engine/analysisGateway'
import { buildTaskParams } from '../engine/taskParams'
import { buildEssenceRecord, buildMemeRecord, buildOccurrenceRecord, mergeOccurrences, type DerivedMemeFields } from '../store/mappers'
import { collectRead } from '../store/paging'
import type { BatchCause, ScopeFilter } from '../types'
import type { MemeDeps, RetryPolicy } from './context'
import { analysisFailed, fromEnvelope, isMemeError } from './errors'

/** 任务类型绑定（本模块的三个分项 → MOD-003 的五类任务）。 */
const TASK_TYPE_BY_KIND: Readonly<Record<MemeTaskKind, TaskType>> = {
  识别: '识别',
  变体: '聚类',
  精华: '抽取',
}

/** 批次运行期状态（§3.5 状态机 A）。 */
export type BatchStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed'
export type BatchItemStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** 分项状态（对外快照）。 */
export interface BatchItemState {
  itemId: Id
  kind: MemeTaskKind
  status: BatchItemStatus
  /** 任务引用（失败分项凭它手动重试 `API-008`）。 */
  taskRef: TaskRef | null
  error: ErrorEnvelope | null
  /** 已落库条数（梗 + 出现记录 / 变体边 / 精华条）。 */
  written: number
}

/** 批次结果。 */
export interface BatchResult {
  status: Exclude<BatchStatus, 'queued' | 'running'>
  items: BatchItemState[]
  /** 批次级错误（读库失败等；分项级错误在 items[].error）。 */
  error?: ErrorEnvelope
}

/** 批次句柄（外壳登记 warmup 操作用）。 */
export interface BatchHandle {
  readonly batchId: Id
  readonly cause: BatchCause
  status(): BatchStatus
  items(): readonly BatchItemState[]
  readonly done: Promise<BatchResult>
}

interface RecognitionPlan {
  kind: '识别'
  groupId: Id
  units: TaskUnit[]
  messagesById: Map<Id, RawMessage>
  existingByName: Map<string, Meme>
  occurrencesByMeme: Map<Id, MemeOccurrence[]>
  meId: Id | null
}

interface VariantPlan {
  kind: '变体'
  groupId: Id
  units: TaskUnit[]
  memesById: Map<Id, Meme>
}

interface EssencePlan {
  kind: '精华'
  meme: Meme
  units: TaskUnit[]
  messageIds: Set<Id>
}

type BatchPlan = RecognitionPlan | VariantPlan | EssencePlan

/** 分项（对外的状态 + 内部执行计划）。 */
export interface TaskItem extends BatchItemState {
  plan: BatchPlan
}

/** 批次运行时（`BatchHandle` 实现）。 */
class BatchRuntime implements BatchHandle {
  readonly batchId: Id
  readonly cause: BatchCause
  /** 执行中的分项（含内部计划；对外只经 `items()` 暴露快照）。 */
  readonly taskItems: TaskItem[] = []
  readonly done: Promise<BatchResult>

  #status: BatchStatus = 'queued'
  #resolve!: (result: BatchResult) => void

  constructor(batchId: Id, cause: BatchCause) {
    this.batchId = batchId
    this.cause = cause
    this.done = new Promise((resolve) => {
      this.#resolve = resolve
    })
  }

  get settled(): boolean {
    return this.#status === 'succeeded' || this.#status === 'partial' || this.#status === 'failed'
  }

  status(): BatchStatus {
    return this.#status
  }

  items(): readonly BatchItemState[] {
    return this.snapshots()
  }

  snapshots(): BatchItemState[] {
    return this.taskItems.map((item) => ({
      itemId: item.itemId,
      kind: item.kind,
      status: item.status,
      taskRef: item.taskRef,
      error: item.error,
      written: item.written,
    }))
  }

  setRunning(): void {
    if (this.#status === 'queued') this.#status = 'running'
  }

  settle(error?: ErrorEnvelope): void {
    if (this.settled) return
    const items = this.taskItems
    if (error !== undefined) this.#status = 'failed'
    else if (items.length === 0 || items.every((item) => item.status === 'succeeded')) this.#status = 'succeeded'
    else if (items.every((item) => item.status === 'failed')) this.#status = 'failed'
    else this.#status = 'partial'
    this.#resolve({ status: this.#status as BatchResult['status'], items: this.snapshots(), ...(error ? { error } : {}) })
  }
}

/** 分析编排（进程内单例，随模块装配创建）。 */
export class AnalysisOrchestrator {
  readonly #deps: MemeDeps
  #active: BatchRuntime | null = null

  constructor(deps: MemeDeps) {
    this.#deps = deps
  }

  /**
   * 启动批次（非 HTTP）。已有批次在途时返回既有句柄（防重复触发的幂等防护；
   * 正常路径下重复触发由缺块判定收敛为空批次）。
   */
  startBatch(cause: BatchCause, scope: ScopeFilter = {}): BatchHandle {
    if (this.#active !== null && !this.#active.settled) return this.#active
    const runtime = new BatchRuntime(this.#deps.newId('batch'), cause)
    this.#active = runtime
    void this.#run(runtime, scope)
    return runtime
  }

  /** 手动重试失败分项（`API-008`）；成功后立即落库（§4 API-012 之外的批次重试路径）。 */
  async retryItem(item: TaskItem, taskRef: string): Promise<void> {
    const outcome = await this.#deps.gateway.retry(taskRef)
    if (!outcome.ok) {
      item.status = 'failed'
      item.error = outcome.error
      item.taskRef = taskRefFromEnvelope(outcome.error) ?? taskRef
      throw fromEnvelope(outcome.error)
    }
    item.taskRef = outcome.taskRef
    try {
      item.written = await this.#persist(item, outcome)
      item.status = 'succeeded'
      item.error = null
    } catch (error) {
      item.status = 'failed'
      item.error = envelopeOf(error)
      throw error
    }
  }

  // -------------------------------------------------------------------------
  // 批次执行
  // -------------------------------------------------------------------------

  async #run(runtime: BatchRuntime, scope: ScopeFilter): Promise<void> {
    runtime.setRunning()
    try {
      const items = await this.#plan(scope)
      runtime.taskItems.push(...items)
      for (const item of runtime.taskItems) {
        await this.#runItem(item)
      }
      runtime.settle()
    } catch (error) {
      runtime.settle(envelopeOf(error))
    }
  }

  /** 读库查缺块并切分分项（§3.6「重复触发按读库查缺块判定」）。 */
  async #plan(scope: ScopeFilter): Promise<TaskItem[]> {
    const deps = this.#deps
    const filter: SharedFilter = { groupIds: scope.groupIds ?? null, timeRange: scope.timeRange ?? null }

    const messages = await collectRead(deps.store.readAll('DM-003', filter, deps.limits.readHardCap))
    const memes = await collectRead(deps.store.readAll('DM-006', { groupIds: filter.groupIds }, deps.limits.readHardCap))
    const occurrences = await collectRead(deps.store.readAll('DM-007', { groupIds: filter.groupIds }, deps.limits.readHardCap))
    const edges = await collectRead(deps.store.readAll('DM-008', { groupIds: filter.groupIds }, deps.limits.readHardCap))
    const highlights = await collectRead(deps.store.readAll('DM-009', { groupIds: filter.groupIds }, deps.limits.readHardCap))
    const members = await collectRead(deps.store.readAll('DM-004', { groupIds: filter.groupIds }, deps.limits.readHardCap))
    const meId = members.records.find((member) => member.isMe === true)?.memberId ?? null

    const messagesById = new Map<Id, RawMessage>()
    for (const message of messages.records) messagesById.set(message.messageId, message)

    const occurrencesByMeme = new Map<Id, MemeOccurrence[]>()
    for (const occurrence of occurrences.records) {
      const bucket = occurrencesByMeme.get(occurrence.memeId)
      if (bucket === undefined) occurrencesByMeme.set(occurrence.memeId, [occurrence])
      else bucket.push(occurrence)
    }

    const items: TaskItem[] = []
    items.push(
      ...this.#planRecognition(
        messages.records,
        memes.records,
        occurrences.records,
        occurrencesByMeme,
        messagesById,
        meId,
      ),
    )
    items.push(...this.#planVariants(memes.records, edges.records))
    items.push(...this.#planEssence(memes.records, highlights.records, occurrencesByMeme, messagesById))
    return items
  }

  #planRecognition(
    messages: readonly RawMessage[],
    memes: readonly Meme[],
    occurrences: readonly MemeOccurrence[],
    occurrencesByMeme: Map<Id, MemeOccurrence[]>,
    messagesById: Map<Id, RawMessage>,
    meId: Id | null,
  ): TaskItem[] {
    const textMessages = messages.filter((message) => typeof message.text === 'string' && message.text.trim().length > 0)
    if (textMessages.length === 0) return []

    // 水位 = 已有出现记录的最大出现时间（无梗时分析窗口内全部消息；不写进度台账，§3.6）
    let watermark: Timestamp | null = null
    for (const occurrence of occurrences) {
      watermark = watermark === null ? occurrence.occurredAt : Math.max(watermark, occurrence.occurredAt)
    }
    const pending =
      memes.length === 0 ? textMessages : textMessages.filter((message) => watermark !== null && message.sentAt > watermark)
    if (pending.length === 0) return []

    const existingByName = new Map<string, Meme>()
    for (const meme of memes) existingByName.set(memeKey(meme.groupId, meme.name), meme)

    const byGroup = new Map<Id, RawMessage[]>()
    for (const message of pending) {
      const bucket = byGroup.get(message.groupId)
      if (bucket === undefined) byGroup.set(message.groupId, [message])
      else bucket.push(message)
    }

    const items: TaskItem[] = []
    for (const [groupId, groupMessages] of byGroup) {
      const sorted = [...groupMessages].sort((a, b) => a.sentAt - b.sentAt || (a.messageId < b.messageId ? -1 : 1))
      for (let offset = 0; offset < sorted.length; offset += this.#deps.limits.recognizeWindowMessages) {
        const window = sorted.slice(offset, offset + this.#deps.limits.recognizeWindowMessages)
        const units: TaskUnit[] = window.map((message) => ({ id: message.messageId, text: message.text ?? '' }))
        items.push({
          itemId: this.#deps.newId('item'),
          kind: '识别',
          status: 'queued',
          taskRef: null,
          error: null,
          written: 0,
          plan: {
            kind: '识别',
            groupId,
            units,
            messagesById,
            existingByName,
            occurrencesByMeme,
            meId,
          },
        })
      }
    }
    return items
  }

  #planVariants(memes: readonly Meme[], edges: readonly MemeVariantLink[]): TaskItem[] {
    if (memes.length < 2 || edges.length > 0) return []
    const byGroup = new Map<Id, Meme[]>()
    for (const meme of memes) {
      const bucket = byGroup.get(meme.groupId)
      if (bucket === undefined) byGroup.set(meme.groupId, [meme])
      else bucket.push(meme)
    }
    const items: TaskItem[] = []
    for (const [groupId, groupMemes] of byGroup) {
      if (groupMemes.length < 2) continue
      const memesById = new Map<Id, Meme>()
      const units: TaskUnit[] = groupMemes.map((meme) => {
        memesById.set(meme.memeId, meme)
        return { id: meme.memeId, text: `${meme.name}：${meme.interpretation}` }
      })
      items.push({
        itemId: this.#deps.newId('item'),
        kind: '变体',
        status: 'queued',
        taskRef: null,
        error: null,
        written: 0,
        plan: { kind: '变体', groupId, units, memesById },
      })
    }
    return items
  }

  #planEssence(
    memes: readonly Meme[],
    highlights: readonly MemeHighlight[],
    occurrencesByMeme: ReadonlyMap<Id, MemeOccurrence[]>,
    messagesById: ReadonlyMap<Id, RawMessage>,
  ): TaskItem[] {
    const covered = new Set<Id>()
    for (const row of highlights) covered.add(row.memeId)
    const items: TaskItem[] = []
    for (const meme of memes) {
      if (covered.has(meme.memeId)) continue
      const candidates = [...(occurrencesByMeme.get(meme.memeId) ?? [])]
        .sort((a, b) => b.occurredAt - a.occurredAt || (a.occurrenceId < b.occurrenceId ? -1 : 1))
        .slice(0, this.#deps.limits.essenceCandidateMessages)
        .sort((a, b) => a.occurredAt - b.occurredAt || (a.occurrenceId < b.occurrenceId ? -1 : 1))
      const units: TaskUnit[] = []
      const messageIds = new Set<Id>()
      for (const occurrence of candidates) {
        const message = messagesById.get(occurrence.sourceMessageId)
        if (message === undefined) continue
        messageIds.add(message.messageId)
        units.push({ id: message.messageId, text: message.text ?? `〔${message.kind}消息〕` })
      }
      if (units.length === 0) continue
      items.push({
        itemId: this.#deps.newId('item'),
        kind: '精华',
        status: 'queued',
        taskRef: null,
        error: null,
        written: 0,
        plan: { kind: '精华', meme, units, messageIds },
      })
      if (items.length >= this.#deps.limits.essenceItemsPerBatchMax) break
    }
    return items
  }

  // -------------------------------------------------------------------------
  // 执行与落库
  // -------------------------------------------------------------------------

  async #runItem(item: TaskItem): Promise<void> {
    const deps = this.#deps
    item.status = 'running'
    const request: Api007Request = {
      taskType: TASK_TYPE_BY_KIND[item.kind],
      input: { kind: '消息集合', units: item.plan.units },
      params: buildTaskParams(item.kind),
    }

    let outcome: TaskOutcome
    try {
      outcome = await deps.gateway.execute(request)
    } catch (error) {
      item.status = 'failed'
      item.error = envelopeOf(error)
      return
    }

    // 自动重试（仅后台分项；统一退避，最多 `maxAttempts` 次）
    let attempts = 0
    let ref = outcome.ok ? outcome.taskRef : taskRefFromEnvelope(outcome.error)
    while (!outcome.ok && ref !== null && attempts < deps.retry.maxAttempts) {
      attempts += 1
      try {
        await deps.retry.sleep(backoffDelay(attempts, deps.retry))
      } catch {
        break
      }
      try {
        outcome = await deps.gateway.retry(ref)
      } catch (error) {
        outcome = { ok: false, error: envelopeOf(error) }
      }
      ref = outcome.ok ? outcome.taskRef : taskRefFromEnvelope(outcome.error)
    }

    if (!outcome.ok) {
      item.status = 'failed'
      item.taskRef = ref
      item.error = outcome.error
      return
    }

    item.taskRef = outcome.taskRef
    try {
      item.written = await this.#persist(item, outcome)
      item.status = 'succeeded'
      deps.logger.info?.('meme.batch.item.done', {
        module: 'MOD-005',
        itemId: item.itemId,
        kind: item.kind,
        written: item.written,
      })
    } catch (error) {
      item.status = 'failed'
      item.error = envelopeOf(error)
    }
  }

  async #persist(item: TaskItem, outcome: TaskOutcome): Promise<number> {
    if (!outcome.ok) throw analysisFailed('meme:batch', '任务未成功，不落库')
    switch (item.plan.kind) {
      case '识别':
        return await this.#persistRecognition(item.plan, outcome)
      case '变体':
        return await this.#persistVariants(item.plan, outcome)
      case '精华':
        return await this.#persistEssence(item.plan, outcome)
    }
  }

  async #persistRecognition(plan: RecognitionPlan, outcome: TaskOutcome & { ok: true }): Promise<number> {
    const deps = this.#deps
    const units = plan.units.map((unit, index) => ({ marker: index + 1, id: unit.id }))
    const parsed = parseRecognition(outcome.result, units, plan.messagesById)
    if (!parsed.ok) {
      throw analysisFailed('meme:batch', parsed.reason, { taskRef: outcome.taskRef, kind: '识别' })
    }

    let written = 0
    const nowMs = deps.clock()
    for (const draft of parsed.items) {
      const key = memeKey(plan.groupId, draft.name)
      const existing = plan.existingByName.get(key)
      const memeId = existing?.memeId ?? deps.newId('meme')
      const incoming: MemeOccurrence[] = []
      for (const messageId of draft.messageIds) {
        const message = plan.messagesById.get(messageId)
        if (message === undefined) continue
        incoming.push(
          buildOccurrenceRecord({
            memeId,
            messageId,
            occurredAt: message.sentAt,
            speakerMemberId: message.senderMemberId,
            mineRelated: mineRelatedOf(message, plan.meId),
          }),
        )
      }
      if (incoming.length === 0) continue

      const existingOccurrences = plan.occurrencesByMeme.get(memeId) ?? []
      const combined = mergeOccurrences(existingOccurrences, incoming)
      const derived = deriveFromOccurrences(combined, plan.groupId, nowMs)
      const record = buildMemeRecord({
        memeId,
        groupId: plan.groupId,
        name: draft.name,
        kind: draft.kind,
        interpretation: draft.interpretation,
        correction: existing?.correction ?? '无',
        mergedIntoId: existing?.mergedIntoId ?? null,
        sourceCandidateId: existing?.sourceCandidateId ?? null,
        derived,
        now: nowMs,
      })

      const memeResult = await deps.store.upsertEntities('DM-006', [record])
      if (memeResult.failures.length > 0) {
        throw analysisFailed('meme:batch', '梗行写入被存储拒绝', { failures: memeResult.failures, memeId })
      }
      const known = new Set(existingOccurrences.map((occurrence) => occurrence.occurrenceId))
      const fresh = combined.filter((occurrence) => !known.has(occurrence.occurrenceId))
      let occurrencesWritten = 0
      if (fresh.length > 0) {
        const occurrenceResult = await deps.store.upsertEntities('DM-007', fresh)
        if (occurrenceResult.failures.length > 0) {
          throw analysisFailed('meme:batch', '出现记录写入被存储拒绝', { failures: occurrenceResult.failures, memeId })
        }
        occurrencesWritten = occurrenceResult.written
      }

      written += 1 + occurrencesWritten
      plan.existingByName.set(key, record)
      plan.occurrencesByMeme.set(memeId, combined)
    }
    return written
  }

  async #persistVariants(plan: VariantPlan, outcome: TaskOutcome & { ok: true }): Promise<number> {
    const deps = this.#deps
    const units = plan.units.map((unit, index) => ({ marker: index + 1, id: unit.id }))
    const parsed = parseVariantClusters(outcome.result, units, plan.memesById)
    if (!parsed.ok) {
      throw analysisFailed('meme:batch', parsed.reason, { taskRef: outcome.taskRef, kind: '变体' })
    }

    const edges: MemeVariantLink[] = []
    const seen = new Set<string>()
    for (const cluster of parsed.items) {
      const [representative, ...rest] = cluster.memberIds
      if (representative === undefined) continue
      for (const derived of rest) {
        if (derived === representative) continue
        const key = `${representative}->${derived}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ sourceMemeId: representative, derivedMemeId: derived, status: '生效' })
      }
    }
    if (edges.length === 0) return 0

    const result = await deps.store.upsertEntities('DM-008', edges)
    if (result.failures.length > 0) {
      throw analysisFailed('meme:batch', '变体关系写入被存储拒绝', { failures: result.failures })
    }
    return result.written
  }

  async #persistEssence(plan: EssencePlan, outcome: TaskOutcome & { ok: true }): Promise<number> {
    const deps = this.#deps
    const units = plan.units.map((unit, index) => ({ marker: index + 1, id: unit.id }))
    const parsed = parseEssencePicks(outcome.result, units, plan.messageIds)
    if (!parsed.ok) {
      throw analysisFailed('meme:batch', parsed.reason, { taskRef: outcome.taskRef, kind: '精华' })
    }

    const rows: MemeHighlight[] = []
    const seen = new Set<Id>()
    let order = 1
    for (const pick of parsed.items) {
      for (const messageId of pick.messageIds) {
        if (seen.has(messageId)) continue
        seen.add(messageId)
        rows.push(buildEssenceRecord(plan.meme.memeId, messageId, order))
        order += 1
      }
    }
    if (rows.length === 0) return 0

    const result = await deps.store.upsertEntities('DM-009', rows)
    if (result.failures.length > 0) {
      throw analysisFailed('meme:batch', '精华消息写入被存储拒绝', { failures: result.failures })
    }
    return result.written
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function memeKey(groupId: Id, name: string): string {
  return `${groupId}\u0000${name}`
}

/** 「我相关」并集口径（落库时计算；Me 缺失时保守取 false，API-013 会按 `IDENTITY_NOT_READY` 处理）。 */
function mineRelatedOf(message: RawMessage, meId: Id | null): boolean {
  if (meId === null) return false
  if (message.senderMemberId === meId) return true
  return (message.mentionedMemberIds ?? []).includes(meId)
}

/** 由出现记录重算派生字段（§5.2：写入前重算、随写入提交）。 */
export function deriveFromOccurrences(occurrences: readonly MemeOccurrence[], groupId: Id, nowMs: number): DerivedMemeFields {
  let first: MemeOccurrence | null = null
  let last: MemeOccurrence | null = null
  const monthlyCounts: MonthlyCounts = {}
  for (const occurrence of occurrences) {
    if (first === null || occurrence.occurredAt < first.occurredAt) first = occurrence
    if (last === null || occurrence.occurredAt > last.occurredAt) last = occurrence
    const month = monthOf(occurrence.occurredAt)
    monthlyCounts[month] = (monthlyCounts[month] ?? 0) + 1
  }
  if (first === null || last === null) {
    throw analysisFailed('meme:batch', '出现记录为空，无法计算派生字段')
  }
  const filled = fillMonthlyCounts(monthlyCounts)
  return {
    firstSeenAt: first.occurredAt,
    firstSeenGroupId: groupId,
    lastUsedAt: last.occurredAt,
    occurrenceCount: occurrences.length,
    weekOverWeek: weekOverWeekOf(occurrences, new Date(nowMs)),
    monthlyCounts: filled,
    lifecycle: deriveLifecycle(first.occurredAt, last.occurredAt, filled),
    memeKing: computeMemeKing(occurrences),
  }
}

/** 退避：指数 1 s → 2 s → 4 s，上限 30 s，叠加 ±20% 抖动（详设 §2.3）。 */
export function backoffDelay(attempt: number, policy: Pick<RetryPolicy, 'baseDelayMs' | 'maxDelayMs' | 'jitterRatio' | 'random'>): number {
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1))
  const jitter = 1 + (policy.random() * 2 - 1) * policy.jitterRatio
  return Math.max(0, Math.round(base * jitter))
}

/** 任意异常 → 错误信封（未知内部异常归入 `ANALYSIS_FAILED`，不新造标识）。 */
function envelopeOf(error: unknown): ErrorEnvelope {
  if (isMemeError(error)) return error.envelope
  if (error !== null && typeof error === 'object' && 'envelope' in error) {
    const envelope = (error as { envelope?: unknown }).envelope
    if (envelope !== null && typeof envelope === 'object' && 'code' in envelope && 'retryable' in envelope) {
      return envelope as ErrorEnvelope
    }
  }
  return {
    code: 'ANALYSIS_FAILED',
    message: error instanceof Error ? error.message : '未知失败',
    retryable: true,
    scope: 'meme:batch',
  }
}
