/**
 * `DM-006` ~ `DM-009` ↔ 内部 DTO 的映射（mod-005 §3.1「store/mappers.ts」、§5.1）。
 *
 * 内部 DTO 与契约实体字段一一对应（§5.1：字段与契约字段一一对应），因此这里是
 * 类型别名 + 记录构造器：派生字段由调用方（`AnalysisOrchestrator`）用 `domain/Metrics`
 * 在写入前重算后传入。
 */

import type {
  Id,
  Meme,
  MemeCorrection,
  MemeHighlight,
  MemeKind,
  MemeKingEntry,
  MemeLifecycle,
  MemeOccurrence,
  MemeVariantLink,
  MonthlyCounts,
  Timestamp,
  VariantLinkStatus,
} from '@shared'

import { heatOf } from '../domain/metrics'

/** `DM-006` 行。 */
export type MemeRow = Meme
/** `DM-007` 行。 */
export type OccurrenceRow = MemeOccurrence
/** `DM-008` 行。 */
export type VariantEdge = MemeVariantLink
/** `DM-009` 行。 */
export type EssenceRow = MemeHighlight

/** 出现记录标识（确定性编码 ⇒ 重复写入按身份去重，§2.4 幂等键）。 */
export function occurrenceIdOf(memeId: Id, messageId: Id): Id {
  return `occ_${memeId}_${messageId}`
}

/** 写入前重算的派生字段（§5.2：由 Metrics 从出现记录重算后随写入提交）。 */
export interface DerivedMemeFields {
  firstSeenAt: Timestamp
  firstSeenGroupId: Id
  lastUsedAt: Timestamp
  occurrenceCount: number
  weekOverWeek: number
  monthlyCounts: MonthlyCounts
  lifecycle: MemeLifecycle
  memeKing: MemeKingEntry[]
}

/** 组装 `DM-006` 记录（「距今 / 热度状态」随写入按写入时刻落库，§5.2）。 */
export function buildMemeRecord(input: {
  memeId: Id
  groupId: Id
  name: string
  kind: MemeKind
  interpretation: string
  correction?: MemeCorrection
  mergedIntoId?: Id | null
  sourceCandidateId?: Id | null
  derived: DerivedMemeFields
  now: Timestamp
}): Meme {
  const { derived } = input
  return {
    memeId: input.memeId,
    groupId: input.groupId,
    name: input.name,
    kind: input.kind,
    interpretation: input.interpretation,
    correction: input.correction ?? '无',
    mergedIntoId: input.mergedIntoId ?? null,
    sourceCandidateId: input.sourceCandidateId ?? null,
    firstSeenAt: derived.firstSeenAt,
    firstSeenGroupId: derived.firstSeenGroupId,
    lastUsedAt: derived.lastUsedAt,
    elapsed: Math.max(0, input.now - derived.lastUsedAt),
    occurrenceCount: derived.occurrenceCount,
    weekOverWeek: derived.weekOverWeek,
    heat: heatOf(derived.lastUsedAt, new Date(input.now)),
    monthlyCounts: derived.monthlyCounts,
    lifecycle: derived.lifecycle,
    memeKing: derived.memeKing,
  }
}

/** 改判后的 `DM-006` 记录（只改「纠正标记 / 合并目标」，§5.1）。 */
export function withCorrection(meme: Meme, correction: MemeCorrection, mergedIntoId: Id | null): Meme {
  return { ...meme, correction, mergedIntoId: mergedIntoId }
}

/** 组装 `DM-007` 记录（出现时间 = 来源消息发送时间；`mineRelated` 按并集口径在落库时算好）。 */
export function buildOccurrenceRecord(input: {
  memeId: Id
  messageId: Id
  occurredAt: Timestamp
  speakerMemberId: Id
  mineRelated: boolean
}): MemeOccurrence {
  return {
    occurrenceId: occurrenceIdOf(input.memeId, input.messageId),
    memeId: input.memeId,
    sourceMessageId: input.messageId,
    occurredAt: input.occurredAt,
    speakerMemberId: input.speakerMemberId,
    mineRelated: input.mineRelated,
  }
}

/** 组装 `DM-008` 记录（只连接同群梗；默认「生效」）。 */
export function buildVariantEdge(sourceMemeId: Id, derivedMemeId: Id, status: VariantLinkStatus = '生效'): MemeVariantLink {
  return { sourceMemeId, derivedMemeId, status }
}

/** 组装 `DM-009` 记录（展示序号决定顺序；默认展示序号最小的 3 条）。 */
export function buildEssenceRecord(memeId: Id, sourceMessageId: Id, displayOrder: number): MemeHighlight {
  return { memeId, sourceMessageId, displayOrder }
}

/** 出现记录合并去重（按出现记录标识；重复写入 no-op，§2.4）。 */
export function mergeOccurrences(
  existing: readonly MemeOccurrence[],
  incoming: readonly MemeOccurrence[],
): MemeOccurrence[] {
  const byId = new Map<Id, MemeOccurrence>()
  for (const record of existing) byId.set(record.occurrenceId, record)
  for (const record of incoming) byId.set(record.occurrenceId, record)
  return [...byId.values()]
}
