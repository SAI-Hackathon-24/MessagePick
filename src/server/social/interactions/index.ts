/**
 * 互动扫描与回复时长（mod-007 §8 决策 3；DM-017、`REQ-058`、`REQ-066`、`AC-111`、`AC-112`）。
 *
 * 扫描口径（文档原话 + 决策 3 的裁定）：
 * - **每条触发消息只落一条记录**：取最早的有效响应；并列时按 引用回复 > @ 提及 > 紧随接话 取一；
 * - **紧随接话**：响应消息之前「最近一条来自其他成员的消息」即触发消息（即两者之间只有响应者自己发言）；
 * - **@ 提及**：响应消息提及的成员 = 触发消息的发送者，触发消息 = 该成员在响应消息之前最近的一条消息；
 * - **引用回复**：响应消息引用的消息即触发消息；
 * - **纯表情回复（仅图片 / 表情包）与跨天响应（自然日不同）在扫描阶段剔除，不落库**；
 * - 记录身份 = 触发消息 + 响应消息（`interactionId` 由两者派生，重放不产生副本）。
 */

import type { InteractionRecord, RawMessage } from '@shared'

/** 扫描输入的消息行（= DM-003 记录）。 */
export type MessageRow = RawMessage

/** 引用索引：消息标识 → 记录，以及群 → 按时间序的记录。 */
export interface ReplyIndex {
  /** 消息标识 → 消息记录（解析引用回复与触发者用） */
  readonly byId: ReadonlyMap<string, MessageRow>
  /** 群 → 按 (sentAt, messageId) 升序排列的记录 */
  readonly byGroup: ReadonlyMap<string, readonly MessageRow[]>
}

/** 扫描选项：自然日判定（跨天排除与事件流分箱共用注入口径）。 */
export interface ScanOptions {
  /** 把时间点映射为自然日键（默认按本地时区 `YYYY-MM-DD`）。 */
  dayKey?: (at: number) => string
}

/** 默认自然日键：本机时区。 */
export function defaultDayKey(at: number): string {
  const date = new Date(at)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** 建立引用索引（供扫描与查询路径复用）。 */
export function buildReplyIndex(rows: readonly MessageRow[]): ReplyIndex {
  const byId = new Map<string, MessageRow>()
  const grouped = new Map<string, MessageRow[]>()
  for (const row of rows) {
    if (!byId.has(row.messageId)) byId.set(row.messageId, row)
    const bucket = grouped.get(row.groupId)
    if (bucket === undefined) grouped.set(row.groupId, [row])
    else bucket.push(row)
  }
  for (const bucket of grouped.values()) {
    bucket.sort(compareRows)
  }
  return { byId, byGroup: grouped }
}

/** 「纯表情回复」= 仅含表情包 / 图片的消息（无文字内容）。 */
export function isPureExpression(row: MessageRow): boolean {
  return row.kind === '图片' || row.kind === '表情包'
}

/** 互动记录标识：触发消息 + 响应消息（记录身份键）。 */
export function interactionIdOf(triggerMessageId: string, responseMessageId: string): string {
  return `ix:${triggerMessageId}::${responseMessageId}`
}

/**
 * 扫描互动记录（DM-017）。
 *
 * 返回记录按（触发消息 → 响应消息）唯一；同一触发消息的多候选取最早，并列按类型优先级取一。
 */
export function scanInteractions(
  rows: readonly MessageRow[],
  replies: ReplyIndex,
  options: ScanOptions = {},
): InteractionRecord[] {
  const dayKey = options.dayKey ?? defaultDayKey
  const index = replies.byGroup.size === 0 && rows.length > 0 ? buildReplyIndex(rows) : replies
  /** 触发消息标识 → 该触发消息选中的唯一响应。 */
  const chosen = new Map<string, { kind: InteractionRecord['kind']; trigger: MessageRow; response: MessageRow }>()

  for (const bucket of index.byGroup.values()) {
    const lastBySender = new Map<string, MessageRow>()
    for (const response of bucket) {
      // ---- 引用回复：被引用的消息即触发消息 ----
      const quotedId = response.quotedMessageId
      if (quotedId !== null) {
        const trigger = index.byId.get(quotedId)
        if (trigger !== undefined && isEligibleResponse(trigger, response, dayKey)) {
          offer(chosen, trigger, response, '引用回复')
        }
      }

      // ---- @ 提及：触发消息 = 被提及成员在响应消息之前最近的一条消息 ----
      for (const memberId of response.mentionedMemberIds ?? []) {
        const trigger = lastBySender.get(memberId)
        if (trigger !== undefined && isEligibleResponse(trigger, response, dayKey)) {
          offer(chosen, trigger, response, '@提及')
        }
      }

      // ---- 紧随接话：响应消息之前最近一条来自其他成员的消息 ----
      const followUpTrigger = previousOtherSpeaker(bucket, response)
      if (followUpTrigger !== undefined && isEligibleResponse(followUpTrigger, response, dayKey)) {
        offer(chosen, followUpTrigger, response, '紧随接话')
      }

      lastBySender.set(response.senderMemberId, response)
    }
  }

  return [...chosen.values()]
    .map(({ kind, trigger, response }) => buildRecord(trigger, response, kind))
    .sort((left, right) => (left.interactionId < right.interactionId ? -1 : 1))
}

function offer(
  chosen: Map<string, { kind: InteractionRecord['kind']; trigger: MessageRow; response: MessageRow }>,
  trigger: MessageRow,
  response: MessageRow,
  kind: InteractionRecord['kind'],
): void {
  const existing = chosen.get(trigger.messageId)
  if (existing === undefined) {
    chosen.set(trigger.messageId, { kind, trigger, response })
    return
  }
  const order = compareRows(response, existing.response)
  if (order < 0 || (order === 0 && kindPriority(kind) < kindPriority(existing.kind))) {
    chosen.set(trigger.messageId, { kind, trigger, response })
  }
}

function buildRecord(trigger: MessageRow, response: MessageRow, kind: InteractionRecord['kind']): InteractionRecord {
  return {
    interactionId: interactionIdOf(trigger.messageId, response.messageId),
    triggerMessageId: trigger.messageId,
    triggerMemberId: trigger.senderMemberId,
    responseMessageId: response.messageId,
    responseMemberId: response.senderMemberId,
    kind,
    intervalMs: Math.max(0, response.sentAt - trigger.sentAt),
  }
}

/** 响应是否有效：非纯表情、跨天剔除、方向正确、非自触发。 */
function isEligibleResponse(trigger: MessageRow, response: MessageRow, dayKey: (at: number) => string): boolean {
  if (trigger.messageId === response.messageId) return false
  if (trigger.groupId !== response.groupId) return false
  if (trigger.senderMemberId === response.senderMemberId) return false
  if (!isLater(trigger, response)) return false
  if (isPureExpression(response)) return false
  return dayKey(trigger.sentAt) === dayKey(response.sentAt)
}

function isLater(trigger: MessageRow, response: MessageRow): boolean {
  if (response.sentAt > trigger.sentAt) return true
  return response.sentAt === trigger.sentAt && response.messageId > trigger.messageId
}

/** 响应之前最近一条来自其他成员的消息（两者之间只有响应者自己发言）。 */
function previousOtherSpeaker(bucket: readonly MessageRow[], response: MessageRow): MessageRow | undefined {
  let previous: MessageRow | undefined
  for (const row of bucket) {
    if (compareRows(row, response) >= 0) break
    // 其他成员的每条消息都会成为新的触发候选：因此「之间无其他成员发言」由本循环自动保证。
    if (row.senderMemberId !== response.senderMemberId) previous = row
  }
  return previous
}

/** 类型优先级：数值小者优先（引用回复 > @ 提及 > 紧随接话）。 */
function kindPriority(kind: InteractionRecord['kind']): number {
  switch (kind) {
    case '引用回复':
      return 0
    case '@提及':
      return 1
    case '紧随接话':
      return 2
    default:
      return 3
  }
}

function compareRows(left: MessageRow, right: MessageRow): number {
  if (left.sentAt !== right.sentAt) return left.sentAt - right.sentAt
  return left.messageId < right.messageId ? -1 : left.messageId > right.messageId ? 1 : 0
}

/**
 * 回复时长 = 该人作为响应成员的互动记录间隔时长的中位数（毫秒）。
 * 无样本返回 `null`（不显示 0 或猜测值，`AC-111`）；偶数样本取中间两条的均值并取整。
 */
export function replyLatencyMedian(rows: readonly InteractionRecord[]): number | null {
  if (rows.length === 0) return null
  const values = rows.map((row) => row.intervalMs).sort((left, right) => left - right)
  const middle = Math.floor(values.length / 2)
  if (values.length % 2 === 1) {
    return values[middle]
  }
  return Math.round((values[middle - 1] + values[middle]) / 2)
}

/** 人的互动计数：作为响应成员的双向互动条数（DM-018 的 I 项）。 */
export function interactionCountBetween(
  rows: readonly InteractionRecord[],
  memberA: ReadonlySet<string>,
  memberB: ReadonlySet<string>,
): number {
  let count = 0
  for (const row of rows) {
    const forward = memberA.has(row.triggerMemberId) && memberB.has(row.responseMemberId)
    const backward = memberB.has(row.triggerMemberId) && memberA.has(row.responseMemberId)
    if (forward || backward) count += 1
  }
  return count
}

/** 事件流分箱（DM-013「按自然月分箱的该标签证据条数」；不参与任何分值，`REQ-087`）。 */
export function binEventsByMonth(
  events: readonly { at: number }[],
  options: ScanOptions = {},
): { month: string; count: number }[] {
  const monthKey = (at: number): string => {
    if (options.dayKey !== undefined) {
      const key = options.dayKey(at)
      return key.slice(0, 7)
    }
    const date = new Date(at)
    return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`
  }
  const counts = new Map<string, number>()
  for (const event of events) {
    const month = monthKey(event.at)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([month, count]) => ({ month, count }))
}
