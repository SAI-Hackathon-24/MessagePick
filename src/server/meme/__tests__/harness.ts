/**
 * MOD-005 测试支撑（mod-005 §7 交付口径）：
 *
 * - `FakeStore`：内存实现的 `StorePort`（`API-003` / `API-004` 替身），按契约语义做基础筛选
 *   （群 / 时间范围 / 关键词 / 身份）与分页；记录全部读 / 写调用，供「筛选透传」「拆批」断言。
 * - `FakeGateway`：`API-007` / `API-008` 替身（脚本化成功 / 失败 / 抛出），记录任务请求与重试。
 * - 记录工厂给最小合法记录（字段照 `src/shared/entities.ts`）；时间经注入时钟固定（`NOW_MS`）。
 *
 * 约束：不真调存储与模型；模型任务全部走脚本响应。
 */

import type {
  Api007Request,
  EntityRecord,
  EntityType,
  ErrorEnvelope,
  GroupMember,
  Id,
  Meme,
  MemeHighlight,
  MemeOccurrence,
  MemeVariantLink,
  PageRequest,
  RawMessage,
  ReadResult,
  SharedFilter,
  TaskOutcome,
  TaskResultItem,
  Timestamp,
  VariantLinkStatus,
  WriteFailureDetail,
  WriteResult,
} from '@shared'

import { resolveDeps, type MemeDeps, type MemeDepsOptions, type MemeLimits, type MemeLogger } from '../app/context'
import { taskErrorEnvelope, type AnalysisGateway } from '../engine/analysisGateway'
import type { AggregateOptions } from '../worker/aggregate'
import { calendarDayDiff, monthOf } from '../domain/metrics'
import { MemeStore } from '../store/memeStore'
import type { StorePort, StoreWriteOptions } from '../store/port'

// ---------------------------------------------------------------------------
// 固定时钟与时间工具（本地自然日口径）
// ---------------------------------------------------------------------------

/** 固定「当前时刻」：2026-09-15 12:00 本地时间（与设计文档示例月份一致）。 */
export const NOW_MS: Timestamp = new Date(2026, 8, 15, 12, 0, 0).getTime()

export const DAY_MS = 24 * 60 * 60 * 1000

/** NOW 之前第 `days` 天的 `hour` 点（本地时间）。 */
export function daysBefore(days: number, hour = 10): Timestamp {
  const date = new Date(NOW_MS)
  date.setDate(date.getDate() - days)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}

// ---------------------------------------------------------------------------
// 记录工厂
// ---------------------------------------------------------------------------

export function makeMessage(
  partial: Partial<RawMessage> & { messageId: Id; groupId: Id; senderMemberId: Id; sentAt: Timestamp },
): RawMessage {
  return {
    kind: '文字',
    text: `消息 ${partial.messageId}`,
    mediaRef: null,
    mentionedMemberIds: null,
    quotedMessageId: null,
    ...partial,
  }
}

export function makeMember(partial: Partial<GroupMember> & { memberId: Id; groupId: Id }): GroupMember {
  return {
    displayName: partial.memberId,
    isMe: false,
    personId: `person_${partial.memberId}`,
    ...partial,
  }
}

/** 最小合法 `DM-006` 行；缺省派生字段按「仅一条记录」的形态给值，调用方可覆盖。 */
export function makeMeme(partial: Partial<Meme> & { memeId: Id; groupId: Id; name: string }): Meme {
  const firstSeenAt = partial.firstSeenAt ?? daysBefore(10)
  const lastUsedAt = partial.lastUsedAt ?? daysBefore(1)
  const occurrenceCount = partial.occurrenceCount ?? 1
  const monthlyCounts = partial.monthlyCounts ?? { [monthOf(firstSeenAt)]: occurrenceCount }
  const base: Meme = {
    memeId: partial.memeId,
    groupId: partial.groupId,
    name: partial.name,
    kind: '口头禅',
    interpretation: `解读-${partial.name}：什么意思 / 从哪来 / 现在怎么用`,
    correction: '无',
    mergedIntoId: null,
    sourceCandidateId: null,
    firstSeenAt,
    firstSeenGroupId: partial.groupId,
    lastUsedAt,
    elapsed: Math.max(0, NOW_MS - lastUsedAt),
    occurrenceCount,
    weekOverWeek: 0,
    heat: '活跃',
    monthlyCounts,
    lifecycle: {
      firstSeenAt,
      peakMonth: monthOf(firstSeenAt),
      silentAt: lastUsedAt,
      activeDays: calendarDayDiff(firstSeenAt, lastUsedAt),
    },
    memeKing: [],
  }
  return { ...base, ...partial }
}

export function makeOccurrence(
  partial: Partial<MemeOccurrence> & { memeId: Id; sourceMessageId: Id; occurredAt: Timestamp },
): MemeOccurrence {
  return {
    occurrenceId: `occ_${partial.memeId}_${partial.sourceMessageId}`,
    speakerMemberId: 'u_other',
    mineRelated: false,
    ...partial,
  }
}

export function makeHighlight(memeId: Id, sourceMessageId: Id, displayOrder: number): MemeHighlight {
  return { memeId, sourceMessageId, displayOrder }
}

export function makeEdge(sourceMemeId: Id, derivedMemeId: Id, status: VariantLinkStatus = '生效'): MemeVariantLink {
  return { sourceMemeId, derivedMemeId, status }
}

// ---------------------------------------------------------------------------
// 存储替身（API-003 / API-004）
// ---------------------------------------------------------------------------

export interface ReadCall {
  type: EntityType
  filter: SharedFilter | null
  page: PageRequest
}

export interface WriteCall {
  type: EntityType
  records: EntityRecord<EntityType>[]
  opts?: StoreWriteOptions
}

/** 其它模块（MOD-002）抛出的错误形态：带统一信封的领域错误。 */
export class ForeignModuleError extends Error {
  readonly envelope: ErrorEnvelope

  constructor(envelope: ErrorEnvelope) {
    super(`${envelope.code}: ${envelope.message}`)
    this.name = 'ForeignModuleError'
    this.envelope = envelope
  }
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 1_000

/** 记录身份键字段（写入去重口径；未列出的类型用整条 JSON 作键）。 */
const IDENTITY_FIELDS: Partial<Record<EntityType, readonly string[]>> = {
  'DM-002': ['groupId'],
  'DM-003': ['messageId'],
  'DM-004': ['groupId', 'memberId'],
  'DM-006': ['memeId'],
  'DM-007': ['occurrenceId'],
  'DM-008': ['sourceMemeId', 'derivedMemeId'],
  'DM-009': ['memeId', 'sourceMessageId'],
  'DM-021': ['candidateId'],
}

export class FakeStore implements StorePort {
  readonly data = new Map<EntityType, EntityRecord<EntityType>[]>()
  readonly reads: ReadCall[] = []
  readonly writes: WriteCall[] = []
  /** 打开后读取一律抛该信封（模拟 STORAGE_UNAVAILABLE）。 */
  failReadWith: ErrorEnvelope | null = null
  /** 打开后写入一律抛该信封。 */
  failWriteWith: ErrorEnvelope | null = null
  /** 让指定批次的写入以「失败明细」返回（不抛错）。 */
  writeFailures: ((type: EntityType, batch: readonly EntityRecord<EntityType>[]) => WriteFailureDetail[] | null) | null =
    null

  seed<T extends EntityType>(type: T, records: readonly EntityRecord<T>[]): void {
    const bucket = this.data.get(type) ?? []
    bucket.push(...(records as readonly EntityRecord<EntityType>[]))
    this.data.set(type, bucket)
  }

  all<T extends EntityType>(type: T): EntityRecord<T>[] {
    return [...(this.data.get(type) ?? [])] as EntityRecord<T>[]
  }

  read<T extends EntityType>(type: T, filter?: SharedFilter | null, page?: PageRequest | null): ReadResult<T> {
    const requested: PageRequest = { page: page?.page, pageSize: page?.pageSize }
    this.reads.push({ type, filter: filter ?? null, page: requested })
    if (this.failReadWith !== null) throw new ForeignModuleError(this.failReadWith)
    const filtered = this.all(type).filter((record) => this.#matches(type, record, filter ?? null))
    const pageNumber = Math.max(1, page?.page ?? 1)
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, page?.pageSize ?? DEFAULT_PAGE_SIZE))
    const start = (pageNumber - 1) * pageSize
    return {
      records: filtered.slice(start, start + pageSize),
      pageInfo: { page: pageNumber, pageSize, total: filtered.length },
    }
  }

  write<T extends EntityType>(type: T, records: readonly EntityRecord<T>[], opts?: StoreWriteOptions): WriteResult {
    const batch: EntityRecord<EntityType>[] = [...records]
    this.writes.push({ type, records: batch, opts })
    if (this.failWriteWith !== null) throw new ForeignModuleError(this.failWriteWith)
    const failures = this.writeFailures?.(type, batch) ?? []
    if (failures.length > 0) return { written: 0, failures }
    const bucket = this.data.get(type) ?? []
    let written = 0
    for (const record of records) {
      const identity = identityOf(type, record)
      const existing = bucket.findIndex((candidate) => identityOf(type, candidate) === identity)
      if (existing >= 0) bucket[existing] = record
      else bucket.push(record)
      written += 1
    }
    this.data.set(type, bucket)
    return { written, failures: [] }
  }

  #matches(type: EntityType, record: EntityRecord<EntityType>, filter: SharedFilter | null): boolean {
    if (filter === null) return true
    if (filter.groupIds != null && filter.groupIds.length > 0) {
      const groupId = this.#groupOf(type, record)
      if (groupId === null || !filter.groupIds.includes(groupId)) return false
    }
    if (filter.keyword != null && filter.keyword.length > 0 && type === 'DM-006') {
      const meme = record as Meme
      if (!meme.name.includes(filter.keyword) && !meme.interpretation.includes(filter.keyword)) return false
    }
    if (filter.timeRange != null) {
      const at = this.#timeOf(type, record)
      if (at === null || at < filter.timeRange.from || at > filter.timeRange.to) return false
    }
    if (filter.identity != null) {
      if (type === 'DM-007') {
        const occurrence = record as MemeOccurrence
        if (occurrence.speakerMemberId !== filter.identity && !occurrence.mineRelated) return false
      } else if (type === 'DM-003') {
        const message = record as RawMessage
        if (message.senderMemberId !== filter.identity && !(message.mentionedMemberIds ?? []).includes(filter.identity)) {
          return false
        }
      } else if (type === 'DM-004') {
        if ((record as GroupMember).memberId !== filter.identity) return false
      }
    }
    return true
  }

  #groupOf(type: EntityType, record: EntityRecord<EntityType>): Id | null {
    switch (type) {
      case 'DM-003':
      case 'DM-004':
      case 'DM-006':
        return (record as { groupId: Id }).groupId
      case 'DM-007':
        return this.#memeGroup((record as MemeOccurrence).memeId)
      case 'DM-008': {
        const edge = record as MemeVariantLink
        return this.#memeGroup(edge.sourceMemeId) ?? this.#memeGroup(edge.derivedMemeId)
      }
      case 'DM-009':
        return this.#memeGroup((record as MemeHighlight).memeId)
      default:
        return null
    }
  }

  #timeOf(type: EntityType, record: EntityRecord<EntityType>): Timestamp | null {
    if (type === 'DM-003') return (record as RawMessage).sentAt
    if (type === 'DM-007') return (record as MemeOccurrence).occurredAt
    return null
  }

  #memeGroup(memeId: Id): Id | null {
    const meme = this.all('DM-006').find((record) => (record as Meme).memeId === memeId)
    return meme === undefined ? null : (meme as Meme).groupId
  }
}

function identityOf(type: EntityType, record: EntityRecord<EntityType>): string {
  const fields = IDENTITY_FIELDS[type]
  if (fields === undefined) return JSON.stringify(record)
  return fields.map((field) => String((record as unknown as Record<string, unknown>)[field])).join('\u0000')
}

/** 组装 `MemeStore`（`MemeDeps.store` 的类型是类，而非端口）。 */
export function createStore(port: FakeStore = new FakeStore()): { port: FakeStore; store: MemeStore } {
  return { port, store: new MemeStore(port) }
}

// ---------------------------------------------------------------------------
// 引擎替身（API-007 / API-008）
// ---------------------------------------------------------------------------

export type GatewayScript = TaskOutcome | (() => TaskOutcome | Promise<TaskOutcome>) | Error

export class FakeGateway implements AnalysisGateway {
  readonly executions: Api007Request[] = []
  readonly retries: string[] = []
  readonly executeQueue: GatewayScript[] = []
  readonly retryQueue: GatewayScript[] = []

  async execute(req: Api007Request): Promise<TaskOutcome> {
    this.executions.push(req)
    return await this.#shift(this.executeQueue, 'execute')
  }

  async retry(taskRef: string): Promise<TaskOutcome> {
    this.retries.push(taskRef)
    return await this.#shift(this.retryQueue, 'retry')
  }

  async #shift(queue: GatewayScript[], kind: string): Promise<TaskOutcome> {
    const script = queue.shift()
    if (script === undefined) throw new Error(`FakeGateway：未编排 ${kind} 响应`)
    if (script instanceof Error) throw script
    if (typeof script === 'function') return await script()
    return script
  }
}

/** 成功结果（`items` 为任务结果条目）。 */
export function okOutcome(taskRef: string, items: TaskResultItem[]): TaskOutcome {
  return { ok: true, result: { items }, sourceRefs: [], taskRef }
}

/** 失败结果（`scope = task:<ref>`，供自动 / 手动重试取回任务引用）。 */
export function failOutcome(code: ErrorEnvelope['code'], taskRef: string): TaskOutcome {
  return { ok: false, error: taskErrorEnvelope(code, `测试注入失败（${code}）`, taskRef) }
}

// ---------------------------------------------------------------------------
// 依赖组装
// ---------------------------------------------------------------------------

export interface HarnessOptions {
  gateway?: AnalysisGateway
  clock?: () => number
  logger?: MemeLogger
  limits?: Partial<MemeLimits>
  retry?: MemeDepsOptions['retry']
  aggregate?: AggregateOptions
}

/** 组装模块依赖（固定时钟、无等待重试、确定性标识）。 */
export function makeDeps(store: MemeStore, options: HarnessOptions = {}): MemeDeps {
  let sequence = 0
  return resolveDeps({
    store,
    gateway: options.gateway,
    clock: options.clock ?? (() => NOW_MS),
    logger: options.logger ?? {},
    limits: options.limits,
    retry: { sleep: async () => {}, random: () => 0.5, ...options.retry },
    newId: (prefix) => `${prefix}_h${(sequence += 1)}`,
    aggregate: options.aggregate,
  })
}

/** 取 promise 的拒绝原因（未知类型；测试自行断言具体错误形态）。 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error('预期 promise 被拒绝，但它成功返回了')
    },
    (reason: unknown) => reason,
  )
}
