/**
 * MOD-007 社交画像测试支撑（mod-007 §7「mock 边界」）：
 *
 * - **存储全部 mock**：读写只经假端口 `FakeStore`（内存表 + 显式分页），不真开库；
 * - **模型调用**：本模块的实现里没有直接调用 MOD-003 的代码路径（引擎桥接在 build/ 层，
 *   本轮实现未含），`analysisFailure` 的测试只在「任务引用 + 错误标识」层面验证，不触网；
 * - **时钟注入**：`T0` 为固定基准时刻；一切「自然日 / 自然月」判定用注入的确定性 `dayKeyOf`，
 *   不依赖本机时区；
 * - 工厂只造最小合法记录，字段约束照 `src/shared/entities.ts`（不造文档没定的字段）。
 */

import {
  DIMENSIONS,
  PERSONALITY_DIMENSIONS,
  type ContactRecord,
  type ContactSource,
  type Dimension,
  type DimensionScores,
  type EntityRecord,
  type EntityType,
  type GroupMember,
  type IdentityCandidate,
  type IdentityCandidateStatus,
  type InteractionRecord,
  type InterestTag,
  type PageRequest,
  type Person,
  type PersonalityScores,
  type RawMessage,
  type ReadResult,
  type SharedFilter,
  type TagMergeGroup,
  type TagOrigin,
  type Timestamp,
  type WriteResult,
} from '@shared'

import type { CommonTag, EffectiveTag, FriendStats, PersonStats, PersonTagLink } from '../scoring'
import type { SocialStorePort } from '../store'

/** 固定基准时刻（2023-11-14T22:13:20Z）。 */
export const T0: Timestamp = 1_700_000_000_000
/** 一天（毫秒）。 */
export const DAY = 86_400_000
/** 一分钟（毫秒）。 */
export const MINUTE = 60_000
/** 一小时（毫秒）。 */
export const HOUR = 3_600_000

/** 确定性自然日键（跨天判定用；不依赖本机时区）。 */
export function dayKeyOf(at: Timestamp): string {
  return `D${Math.floor(at / DAY)}`
}

// ---------------------------------------------------------------------------
// DM 实体工厂
// ---------------------------------------------------------------------------

/** DM-003 消息（默认「文字」、无提及、无引用）。 */
export function msg(
  messageId: string,
  groupId: string,
  senderMemberId: string,
  sentAt: Timestamp,
  overrides: Partial<RawMessage> = {},
): RawMessage {
  return {
    messageId,
    groupId,
    senderMemberId,
    sentAt,
    kind: '文字',
    text: null,
    mediaRef: null,
    mentionedMemberIds: null,
    quotedMessageId: null,
    ...overrides,
  }
}

/** 消息索引（证据解析用）。 */
export function messageMap(rows: readonly RawMessage[]): Map<string, RawMessage> {
  return new Map(rows.map((row) => [row.messageId, row]))
}

/** DM-004 群成员。 */
export function member(
  memberId: string,
  groupId: string,
  displayName?: string,
  overrides: Partial<GroupMember> = {},
): GroupMember {
  return {
    memberId,
    groupId,
    displayName: displayName ?? memberId,
    isMe: false,
    personId: memberId,
    ...overrides,
  }
}

/** DM-005 联系人。 */
export function contact(
  contactId: string,
  displayName: string,
  source: ContactSource = '通讯录',
): ContactRecord {
  return { contactId, displayName, source }
}

/** DM-011 人（默认：单人、非我、未知假、派生字段零值）。 */
export function personRecord(personId: string, overrides: Partial<Person> = {}): Person {
  return {
    personId,
    memberIds: [personId],
    isMe: false,
    unknown: false,
    activity: 0,
    replyMedianMs: null,
    dimensionScores: zeroDimensionScores(),
    personalityScores: zeroPersonalityScores(),
    ...overrides,
  }
}

/** 五维零值。 */
export function zeroDimensionScores(): DimensionScores {
  const scores = {} as DimensionScores
  for (const dimension of DIMENSIONS) scores[dimension] = 0
  return scores
}

/** 性格六维零值。 */
export function zeroPersonalityScores(): PersonalityScores {
  const scores = {} as PersonalityScores
  for (const dimension of PERSONALITY_DIMENSIONS) scores[dimension] = 0
  return scores
}

/** DM-012 身份对齐候选。 */
export function candidate(
  candidateId: string,
  memberIds: string[],
  status: IdentityCandidateStatus = '未确认',
  overrides: Partial<IdentityCandidate> = {},
): IdentityCandidate {
  return {
    candidateId,
    sourceContactId: `contact-${candidateId}`,
    memberIds,
    status,
    confirmedAt: status === '已确认' ? T0 : null,
    ...overrides,
  }
}

/** DM-013 兴趣标签。 */
export function interestTag(
  tagId: string,
  name: string,
  dimension: Dimension,
  overrides: Partial<InterestTag> = {},
): InterestTag {
  return {
    tagId,
    name,
    dimension,
    mergeGroupId: null,
    firstSeenAt: T0,
    eventStream: [],
    heatScore: 0,
    ...overrides,
  }
}

/** DM-014 人物兴趣标签的「连接后视图」（带解析出的标签名与一级维度）。 */
export function tagLink(options: {
  personId?: string
  tag: InterestTag
  confidence: number
  evidenceMessageIds?: string[]
  origin?: TagOrigin
}): PersonTagLink {
  return {
    personId: options.personId ?? 'p1',
    tagId: options.tag.tagId,
    name: options.tag.name,
    dimension: options.tag.dimension,
    confidence: options.confidence,
    evidenceMessageIds: options.evidenceMessageIds ?? [],
    origin: options.origin ?? '模型抽取',
  }
}

/** DM-015 归并组。 */
export function mergeGroup(
  representativeTagId: string,
  mergedTagIds: string[],
  mergeGroupId?: string,
): TagMergeGroup {
  return {
    mergeGroupId: mergeGroupId ?? `mg-${representativeTagId}`,
    representativeTagId,
    mergedTagIds,
  }
}

/** DM-017 互动记录（记录标识默认由触发 / 响应派生）。 */
export function interactionRecord(
  triggerMemberId: string,
  responseMemberId: string,
  intervalMs: number,
  overrides: Partial<InteractionRecord> = {},
): InteractionRecord {
  return {
    interactionId: overrides.interactionId ?? `ix:${triggerMemberId}::${responseMemberId}:${intervalMs}`,
    triggerMessageId: `tm-${triggerMemberId}`,
    triggerMemberId,
    responseMessageId: `rm-${responseMemberId}`,
    responseMemberId,
    kind: '紧随接话',
    intervalMs,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 评分层输入工厂
// ---------------------------------------------------------------------------

/** 有效标签（评分纯函数输入；默认未归并、无证据）。 */
export function effectiveTag(
  tagId: string,
  dimension: Dimension,
  confidence: number,
  overrides: Partial<EffectiveTag> = {},
): EffectiveTag {
  return {
    personId: 'p1',
    tagId,
    name: tagId,
    dimension,
    confidence,
    evidenceMessageIds: [],
    mergedTagIds: [],
    ...overrides,
  }
}

/** 人的评分输入。 */
export function personStats(personId: string, activity: number): PersonStats {
  return { personId, activity }
}

/** 群友评分输入。 */
export function friendStats(personId: string, activity: number, isMe = false): FriendStats {
  return { personId, activity, isMe }
}

/** 两人共同标签。 */
export function commonTag(
  tagId: string,
  dimension: Dimension,
  confidenceA: number,
  confidenceB: number,
): CommonTag {
  return { tagId, name: tagId, dimension, confidenceA, confidenceB }
}

// ---------------------------------------------------------------------------
// 假存储端口（API-003 / API-004 的最小面）
// ---------------------------------------------------------------------------

/** 一次假读取调用的记录。 */
export interface FakeReadCall {
  type: EntityType
  page: number
  pageSize: number
  filter: SharedFilter | null
}

/** 一次假写入调用的记录。 */
export interface FakeWriteCall {
  type: EntityType
  count: number
  bumpEpoch: boolean | undefined
}

/**
 * 内存假端口：按页返回 seed 进去的记录；写入只记录调用并返回可注入的失败明细。
 * 测试对 `readAll` / `writeAll` 的断言只看**调用形态**与返回聚合，不模拟真实约束。
 */
export class FakeStore implements SocialStorePort {
  epoch = 1
  readonly readCalls: FakeReadCall[] = []
  readonly writeCalls: FakeWriteCall[] = []
  /** 注入的写入失败明细（每次 write 原样返回）。 */
  failures: WriteResult['failures'] = []
  readonly #tables = new Map<EntityType, EntityRecord[]>()

  /** 预置某实体类型的记录（按写入顺序分页）。 */
  seed<T extends EntityType>(type: T, records: readonly EntityRecord<T>[]): void {
    this.#tables.set(type, [...(records as readonly EntityRecord[])])
  }

  currentEpoch(): number {
    return this.epoch
  }

  read<T extends EntityType>(
    type: T,
    filter?: SharedFilter | null,
    page?: PageRequest | null,
  ): ReadResult<T> {
    const all = (this.#tables.get(type) ?? []) as EntityRecord<T>[]
    const pageNumber = page?.page ?? 1
    const pageSize = page?.pageSize ?? 50
    this.readCalls.push({ type, page: pageNumber, pageSize, filter: filter ?? null })
    const start = (pageNumber - 1) * pageSize
    return {
      records: all.slice(start, start + pageSize),
      pageInfo: { page: pageNumber, pageSize, total: all.length },
    }
  }

  write<T extends EntityType>(
    type: T,
    records: readonly EntityRecord<T>[],
    opts?: { bumpEpoch?: boolean },
  ): WriteResult {
    this.writeCalls.push({ type, count: records.length, bumpEpoch: opts?.bumpEpoch })
    return { written: records.length, failures: this.failures }
  }
}
