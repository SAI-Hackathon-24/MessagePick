/**
 * MOD-008 入库字段派生（mod-008 §3.1「domain/derive.ts —— 派生」）。
 *
 * 纯函数、无 IO：把已校验的输入派生成 `DM-020` / `DM-021` / `DM-022` / `DM-007` 的记录值。
 *
 * 口径：
 * - 产物引用 = `gen/<记录标识>/<变体序号>`（§5.1；本模块补扩展名，供存储侧按扩展名判 MIME）。
 * - `DM-020` 的成员素材引用以 `consent:<确认标识>` 形式携带（存储侧约定，见 `dm020_consent`）。
 * - `DM-006` 的派生指标（heat / 月度分布 / 生命周期 / 梗王）为**确认入库时的初值**：
 *   该表全部派生列在存储侧属于可变字段，`MOD-005` 的后续写入会以权威口径重算覆盖（mod-005 §5）。
 * - `DM-007` 出现记录：出现时间 = 来源消息发送时间、发言成员 = 发送者（§8 决策 5）。
 */

import type {
  ArtifactRef,
  GenerationRecord,
  Id,
  MaterialConsent,
  MaterialTier,
  MaterialConsentStatus,
  MediaRef,
  Meme,
  MemeCandidate,
  MemeOccurrence,
  MemeKind,
  RawMessage,
  Timestamp,
} from '@shared'

import { DAY_MS } from '../constants'
import type { MaterialItem } from '../materials/manifest'
import { consentIdOf, occurrenceIdOf } from './dedupe'

/** `DM-020.产出引用` 里承载成员素材确认引用的前缀（存储侧登记到 `dm020_consent`）。 */
export const CONSENT_REF_PREFIX = 'consent:'

/** 产物扩展名 → 产物类别（G1 位图 / G2 文本）。 */
export type ArtifactExtension = 'png' | 'txt'

/** 产物引用：`gen/<记录标识>/<变体序号>.<扩展名>`（§5.1；序号 1 起）。 */
export function artifactRefOf(
  generationId: string,
  variantIndex: number,
  extension: ArtifactExtension,
): ArtifactRef {
  return `gen/${generationId}/${variantIndex}.${extension}`
}

/** `DM-020` 记录（G1 表情包）。 */
export function generationRecordForEmoji(input: {
  generationId: Id
  memeId: Id
  tier: MaterialTier
  templateId: Id
  templateVersion: number
  outputRefs: readonly ArtifactRef[]
  consentIds: readonly Id[]
  generatedAt: Timestamp
}): GenerationRecord {
  return {
    generationId: input.generationId,
    kind: 'G1',
    memeId: input.memeId,
    materialTier: input.tier,
    template: `${input.templateId}@${input.templateVersion}`,
    outputRefs: [...input.outputRefs, ...input.consentIds.map(consentRefOf)],
    creationMark: true,
    generatedAt: input.generatedAt,
  }
}

/** `DM-020` 记录（G2 文字变体）。 */
export function generationRecordForTexts(input: {
  generationId: Id
  memeId: Id
  outputRefs: readonly ArtifactRef[]
  generatedAt: Timestamp
}): GenerationRecord {
  return {
    generationId: input.generationId,
    kind: 'G2',
    memeId: input.memeId,
    materialTier: null,
    template: null,
    outputRefs: [...input.outputRefs],
    creationMark: true,
    generatedAt: input.generatedAt,
  }
}

/** `DM-020` 记录（G3 新梗候选；梗引用由确认入库后回填）。 */
export function generationRecordForCandidates(input: {
  generationId: Id
  candidateIds: readonly Id[]
  generatedAt: Timestamp
}): GenerationRecord {
  return {
    generationId: input.generationId,
    kind: 'G3',
    memeId: null,
    materialTier: null,
    template: null,
    outputRefs: [...input.candidateIds],
    creationMark: true,
    generatedAt: input.generatedAt,
  }
}

/** `DM-021` 记录（候选：状态 = 候选、入库梗为空）。 */
export function candidateRecordOf(input: {
  candidateId: Id
  meaningGuess: string
  usageExample: string
  sourceMessageIds: readonly Id[]
}): MemeCandidate {
  return {
    candidateId: input.candidateId,
    meaningGuess: input.meaningGuess,
    sourceMessageIds: [...input.sourceMessageIds],
    usageExample: input.usageExample,
    status: '候选',
    memeId: null,
  }
}

/** `DM-022` 记录（确认动作写入；未确认时 `confirmedAt` 为空）。 */
export function consentRecordOf(input: {
  kind: MaterialItem['kind']
  ref: string
  memberId: Id | null
  status: MaterialConsentStatus
  confirmedAt: Timestamp | null
}): MaterialConsent {
  return {
    consentId: consentIdOf(input.kind, input.ref, input.memberId),
    materialRef: input.ref,
    memberIds: input.memberId === null ? [] : [input.memberId],
    status: input.status,
    confirmedAt: input.confirmedAt,
  }
}

/** 确认引用（`consent:<确认标识>`）。 */
export function consentRefOf(consentId: Id): string {
  return `${CONSENT_REF_PREFIX}${consentId}`
}

/** 从产出引用集里剔除存储侧结构引用（对外的产出引用只含产物句柄）。 */
export function visibleOutputRefs(refs: readonly string[]): ArtifactRef[] {
  return refs.filter((ref) => !ref.startsWith(CONSENT_REF_PREFIX))
}

/** 从产出引用集里取出成员素材确认引用。 */
export function consentRefsIn(refs: readonly string[]): Id[] {
  return refs
    .filter((ref) => ref.startsWith(CONSENT_REF_PREFIX))
    .map((ref) => ref.slice(CONSENT_REF_PREFIX.length))
}

/** 月份键 `YYYY-MM`（UTC）。 */
export function monthOf(timestamp: Timestamp): string {
  const date = new Date(timestamp)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

/** 热度状态：活跃（≤7 天）/ 衰减中（8–30 天）/ 已沉寂（>30 天）（DM-006 口径）。 */
export function heatOf(elapsedMs: number): Meme['heat'] {
  if (elapsedMs <= 7 * DAY_MS) return '活跃'
  if (elapsedMs <= 30 * DAY_MS) return '衰减中'
  return '已沉寂'
}

/** 自然日跨度（首现 → 最近调用；至少 1 天）。 */
export function naturalDaySpan(firstSeenAt: Timestamp, lastUsedAt: Timestamp): number {
  const span = Math.ceil((lastUsedAt - firstSeenAt) / DAY_MS)
  return Math.max(1, span)
}

/**
 * 入库梗记录（`DM-006`）：归属群 = 出处消息所属群（§8 决策 5 的确定性口径）；
 * 全部派生指标为确认时初值，`MOD-005` 的后续写入按权威口径重算。
 */
export function memeRecordOfCandidate(input: {
  memeId: Id
  candidateId: Id
  name: string
  kind: MemeKind
  interpretation: string
  /** 出处消息（按发送时间升序；至少一条） */
  messages: readonly RawMessage[]
  now: Timestamp
}): Meme {
  const ordered = [...input.messages].sort((left, right) =>
    left.sentAt - right.sentAt || (left.messageId < right.messageId ? -1 : 1),
  )
  const first = ordered[0]!
  const last = ordered[ordered.length - 1]!
  const elapsed = Math.max(0, input.now - last.sentAt)
  const speakerCounts = new Map<Id, number>()
  for (const message of ordered) {
    speakerCounts.set(message.senderMemberId, (speakerCounts.get(message.senderMemberId) ?? 0) + 1)
  }

  return {
    memeId: input.memeId,
    groupId: first.groupId,
    name: input.name,
    kind: input.kind,
    interpretation: input.interpretation,
    correction: '无',
    mergedIntoId: null,
    sourceCandidateId: input.candidateId,
    firstSeenAt: first.sentAt,
    firstSeenGroupId: first.groupId,
    lastUsedAt: last.sentAt,
    elapsed,
    occurrenceCount: ordered.length,
    weekOverWeek: 1,
    heat: heatOf(elapsed),
    monthlyCounts: { [monthOf(first.sentAt)]: ordered.length },
    lifecycle: {
      firstSeenAt: first.sentAt,
      peakMonth: monthOf(first.sentAt),
      silentAt: last.sentAt,
      activeDays: naturalDaySpan(first.sentAt, last.sentAt),
    },
    memeKing: [...speakerCounts.entries()]
      .map(([memberId, count]) => ({ memberId, count, share: count / ordered.length }))
      .sort((left, right) => right.count - left.count || (left.memberId < right.memberId ? -1 : 1)),
  }
}

/** `DM-007` 出现记录（按「梗 + 来源消息」去重，见 §8 决策 5）。 */
export function occurrenceRecordOf(input: {
  memeId: Id
  message: RawMessage
  mineRelated: boolean
}): MemeOccurrence {
  return {
    occurrenceId: occurrenceIdOf(input.memeId, input.message.messageId),
    memeId: input.memeId,
    sourceMessageId: input.message.messageId,
    occurredAt: input.message.sentAt,
    speakerMemberId: input.message.senderMemberId,
    mineRelated: input.mineRelated,
  }
}

/** 素材引用（媒体类素材用媒体引用；头像 / 原话用确定性句柄，见 §5.1）。 */
export type MaterialRefHandle = MediaRef | string
