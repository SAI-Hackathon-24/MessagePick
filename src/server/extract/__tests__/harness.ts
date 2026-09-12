/**
 * MOD-006 测试支撑（mod-006 §7「单测边界」）：
 *
 * - **不真调模型**：`ScriptedGateway` 按任务类型给脚本化结果（记录全部请求，供断言）；任务失败用
 *   统一信封表达（`scope = task:<ref>`，与引擎真实口径一致）；
 * - **不真开库**：`FakeStore` 是 `API-003` / `API-004` 的进程内替身（群 / 时间范围筛选按替身实现；
 *   关键词与身份**不**在替身内模拟 —— 本模块必须原样透传、不得自行过滤，正是测试要锁的口径）；
 * - **时钟注入**：`fixedClock`（提醒与 DDL 判定不看真实时间）；
 * - 「应用未运行期间到期」用「清空会话状态后重新检查」模拟（§7）。
 */

import type {
  Api007Request,
  EntityRecord,
  EntityType,
  ErrorCode,
  ExtractedItem,
  Group,
  GroupMember,
  Id,
  PageRequest,
  RawMessage,
  ReadResult,
  SharedFilter,
  TaskOutcome,
  TaskRef,
  TaskResultItem,
  TaskType,
  Timestamp,
  WriteResult,
} from '@shared'

import { storageUnavailable } from '../errors'
import type { ExtractedDraft, TaskGateway } from '../pipeline/recognition'
import type { ExtractStorePort } from '../store/entry-repository'

// ---------------------------------------------------------------------------
// 常量与时钟
// ---------------------------------------------------------------------------

/** 固定基准时刻（2026-09-12T10:00:00Z）；提醒与 DDL 判定全部以它为 now。 */
export const NOW: Timestamp = Date.UTC(2026, 8, 12, 10, 0, 0)

/** 一天（毫秒）。 */
export const DAY_MS = 24 * 60 * 60 * 1000

/** 固定时钟（不注入真实时间）。 */
export function fixedClock(now: Timestamp = NOW): () => number {
  return () => now
}

/** 可手动放行的挂起点（批锁 / 顺延测试用）。 */
export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

// ---------------------------------------------------------------------------
// 存储替身（API-003 / API-004）
// ---------------------------------------------------------------------------

export interface FakeStoreSeed {
  groups?: Group[]
  messages?: RawMessage[]
  members?: GroupMember[]
  entries?: ExtractedItem[]
}

/** 一次读取调用的记录（断言「筛选组装」与「不另做筛选」用）。 */
export interface FakeReadCall {
  type: EntityType
  filter: SharedFilter | null
  page: PageRequest | null
}

/** 进程内存储替身：按实体类型分派到种子表；DM-010 写入按条目标识去重（重放不产生副本）。 */
export class FakeStore implements ExtractStorePort {
  readonly groups: Group[]
  readonly messages: RawMessage[]
  readonly members: GroupMember[]
  readonly entries: ExtractedItem[]
  readonly readCalls: FakeReadCall[] = []
  readonly writeCalls: Array<{ type: EntityType; count: number }> = []
  /** 置真时读取抛 `STORAGE_UNAVAILABLE`（模拟存储不可用，§6）。 */
  failReads = false

  constructor(seed: FakeStoreSeed = {}) {
    this.groups = [...(seed.groups ?? [])]
    this.messages = [...(seed.messages ?? [])]
    this.members = [...(seed.members ?? [])]
    this.entries = [...(seed.entries ?? [])]
  }

  read<T extends EntityType>(type: T, filter?: SharedFilter | null, page?: PageRequest | null): ReadResult<T> {
    this.readCalls.push({ type, filter: filter ?? null, page: page ?? null })
    if (this.failReads) throw storageUnavailable('store:read', '存储不可用（FakeStore 注入）')
    const matched = this.#table(type).filter((record) => matchesFilter(record, filter ?? null))
    const pageNumber = Math.max(1, page?.page ?? 1)
    const pageSize = Math.max(1, page?.pageSize ?? 50)
    const start = (pageNumber - 1) * pageSize
    return {
      // 测试替身：表已按 `type` 分派，此处把联合记录收窄回泛型记录（运行期正确性由分派保证）
      records: matched.slice(start, start + pageSize) as unknown as EntityRecord<T>[],
      pageInfo: { page: pageNumber, pageSize, total: matched.length },
    }
  }

  write<T extends EntityType>(
    type: T,
    records: readonly EntityRecord<T>[],
    _options?: { bumpEpoch?: boolean },
  ): WriteResult {
    this.writeCalls.push({ type, count: records.length })
    if (type !== 'DM-010') return { written: 0, failures: [{ identity: [], reason: `FakeStore 不支持写入 ${type}` }] }
    let written = 0
    for (const record of records as unknown as readonly ExtractedItem[]) {
      if (this.entries.some((entry) => entry.entryId === record.entryId)) continue // 记录身份去重
      this.entries.push({ ...record })
      written += 1
    }
    return { written, failures: [] }
  }

  #table(type: EntityType): EntityRecord<EntityType>[] {
    switch (type) {
      case 'DM-002':
        return this.groups
      case 'DM-003':
        return this.messages
      case 'DM-004':
        return this.members
      case 'DM-010':
        return this.entries
      default:
        return []
    }
  }
}

/** 替身筛选口径：群 / 时间范围（与 `API-004` 入参一致）；关键词与身份不在此模拟（见文件头）。 */
function matchesFilter(record: EntityRecord<EntityType>, filter: SharedFilter | null): boolean {
  if (filter === null) return true
  const groupIds = filter.groupIds
  if (groupIds != null && groupIds.length > 0 && 'groupId' in record && !groupIds.includes(record.groupId)) {
    return false
  }
  const timeRange = filter.timeRange
  if (timeRange != null && 'sentAt' in record && (record.sentAt < timeRange.from || record.sentAt > timeRange.to)) {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// 任务网关替身（API-007 / API-008）
// ---------------------------------------------------------------------------

export type TaskHandler = (request: Api007Request) => TaskOutcome | Promise<TaskOutcome>

/** 任务脚本：按任务类型给出结果；`retry` 给出 `API-008` 重试结果。 */
export type GatewayScript = Partial<Record<TaskType, TaskHandler>> & {
  retry?: (ref: TaskRef) => TaskOutcome | Promise<TaskOutcome>
}

/** 进程内任务网关替身：未编排的类型直接抛错（暴露测试遗漏，不静默）。 */
export class ScriptedGateway implements TaskGateway {
  readonly executeCalls: Api007Request[] = []
  readonly retryCalls: TaskRef[] = []
  readonly #script: GatewayScript

  constructor(script: GatewayScript = {}) {
    this.#script = script
  }

  async execute(request: Api007Request): Promise<TaskOutcome> {
    this.executeCalls.push(request)
    const handler = this.#script[request.taskType]
    if (handler === undefined) throw new Error(`ScriptedGateway 未编排任务类型：${request.taskType}`)
    return handler(request)
  }

  async retry(ref: TaskRef): Promise<TaskOutcome> {
    this.retryCalls.push(ref)
    const handler = this.#script.retry
    if (handler === undefined) throw new Error('ScriptedGateway 未编排重试结果')
    return handler(ref)
  }

  /** 某任务类型的全部请求（按发生顺序）。 */
  requestsOf(type: TaskType): Api007Request[] {
    return this.executeCalls.filter((request) => request.taskType === type)
  }
}

/** 成功结果。 */
export function okOutcome(items: TaskResultItem[], taskRef: TaskRef = 'task-ok'): TaskOutcome {
  return { ok: true, result: { items }, sourceRefs: [], taskRef }
}

/** 失败结果（统一信封；`scope = task:<ref>`，与引擎口径一致）。 */
export function failureOutcome(taskRef: TaskRef, code: ErrorCode = 'ANALYSIS_FAILED'): TaskOutcome {
  return { ok: false, error: { code, message: `任务失败（${taskRef}）`, retryable: true, scope: `task:${taskRef}` } }
}

/** 从任务请求取输入单元标识（消息集合 / 上下文 / 文本三种形状统一）。 */
export function unitIdsOf(request: Api007Request): Id[] {
  const { input } = request
  if (input.kind === '消息集合') return input.units.map((unit) => unit.id)
  if (input.kind === '上下文') return input.units.map((unit) => unit.id)
  return [input.unit.id]
}

/** 取统一信封的 `code`（断言错误标识用；未知异常返回 null）。 */
export function envelopeCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('envelope' in error)) return null
  const envelope = (error as { envelope?: { code?: unknown } }).envelope
  return typeof envelope?.code === 'string' ? envelope.code : null
}

// ---------------------------------------------------------------------------
// 记录工厂
// ---------------------------------------------------------------------------

/** 原始消息（DM-003）。 */
export function message(messageId: Id, groupId: Id, sentAt: Timestamp, text: string | null = messageId): RawMessage {
  return {
    messageId,
    groupId,
    senderMemberId: `member-${messageId}`,
    sentAt,
    kind: '文字',
    text,
    mediaRef: null,
    mentionedMemberIds: null,
    quotedMessageId: null,
  }
}

/** 群成员（DM-004）。 */
export function member(memberId: Id, groupId: Id, displayName: string): GroupMember {
  return { memberId, groupId, displayName, isMe: false, personId: `person-${memberId}` }
}

/** 提取条目（DM-010）：字段全给默认值，按需覆盖。 */
export function entry(overrides: Partial<ExtractedItem> & Pick<ExtractedItem, 'entryId'>): ExtractedItem {
  return {
    recognitionType: '会议',
    timeElement: null,
    locationElement: null,
    personElementMemberIds: null,
    subjectElement: null,
    deadline: null,
    groupId: 'g1',
    sourceMessageIds: [],
    headline: '一句话总结',
    aiSummary: 'AI 总结',
    topic: '主题',
    priority: '中',
    todoStatus: '未处理',
    remindState: '不提醒',
    ...overrides,
  }
}

/** 抽取草稿（写库前的 DM-010 要素；主题由聚类阶段补齐）。 */
export function extractedDraft(entryId: Id, overrides: Partial<ExtractedDraft> = {}): ExtractedDraft {
  return {
    entryId,
    groupId: 'g1',
    recognitionType: '会议',
    sourceMessageIds: ['m1'],
    timeElement: null,
    locationElement: null,
    personElementMemberIds: [],
    subjectElement: null,
    deadline: null,
    headline: '一句话总结',
    aiSummary: 'AI 总结',
    priority: '中',
    ...overrides,
  }
}
