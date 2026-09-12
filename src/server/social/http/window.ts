/**
 * 筛选窗口的按次重算（mod-007 §4「筛选语义」：群与时间范围 = **重算窗口**）。
 *
 * - 窗口非空（群或时间范围至少一项）时，本次返回的**活跃度 / 维度分**按窗口内的消息重算
 *   （同一批纯函数；结果只用于本次返回，**不覆盖库内全量派生值**）；
 * - 证据不在窗口内的标签剔除；人工增改的标签（无证据）是使用者显式输入，保留；
 * - 社交维度标签的置信度按活跃度因子比值**近似**回算（存储值已按全量活跃度吸附过一次，
 *   这里用 `置信度 ÷ 因子(全量活跃度) × 因子(窗口活跃度)` 还原与再吸附）；
 * - 窗口消息经 `API-004` 带筛选条件分页读回（模块侧不重复过滤；本模块不自行扩展契约字段）。
 */

import type { Id, SharedFilter } from '@shared'

import { storageUnavailable } from '../errors'
import type { SocialIndex } from '../build/index-store'
import { SOCIAL_DIMENSION, clamp01, roundTo, socialActivityFactor, type EffectiveTag } from '../scoring'
import { readMessages, type SocialStorePort } from '../store'

/** 一次查询的窗口上下文（`active = false` 时窗口不限，全部读取退回库内全量派生值）。 */
export interface FilterWindow {
  active: boolean
  /** 窗口内的消息标识（证据剔除用） */
  messageIds: ReadonlySet<Id>
  /** 人 → 窗口内的活跃度（该人作为发送者的消息条数） */
  activityByPerson: ReadonlyMap<Id, number>
}

const EMPTY_WINDOW: FilterWindow = { active: false, messageIds: new Set(), activityByPerson: new Map() }

/** 窗口是否非空（群标识非空或时间范围非空）。 */
export function hasWindow(filter: SharedFilter | null): boolean {
  if (filter === null) return false
  const groups = filter.groupIds
  const hasGroups = groups !== undefined && groups !== null && groups.length > 0
  const hasRange = filter.timeRange !== undefined && filter.timeRange !== null
  return hasGroups || hasRange
}

/** 构造窗口上下文：读回窗口内的消息并统计逐人活跃度（未命中「人」的发送者不计）。 */
export function filterWindowOf(
  port: SocialStorePort,
  index: SocialIndex,
  filter: SharedFilter | null,
): FilterWindow {
  if (!hasWindow(filter)) return EMPTY_WINDOW
  let messages: { messageId: Id; senderMemberId: Id }[]
  try {
    messages = readMessages(port, filter)
  } catch (error) {
    throw storageUnavailable(error, 'social.query.window.messages')
  }
  const messageIds = new Set<Id>()
  const activityByPerson = new Map<Id, number>()
  for (const message of messages) {
    messageIds.add(message.messageId)
    const personId = index.personOfMember(message.senderMemberId)
    if (personId === undefined) continue
    activityByPerson.set(personId, (activityByPerson.get(personId) ?? 0) + 1)
  }
  return { active: true, messageIds, activityByPerson }
}

/** 窗口内的活跃度（窗口不限时取库内全量派生值）。 */
export function windowActivityOf(person: { personId: Id; activity: number }, window: FilterWindow): number {
  if (!window.active) return person.activity
  return window.activityByPerson.get(person.personId) ?? 0
}

/**
 * 窗口内的有效标签：
 * - 证据不在窗口内的标签剔除（无证据 = 人工增改，保留）；
 * - 社交维度标签按活跃度因子比值近似重算置信度。
 */
export function windowTagsOf(
  person: { personId: Id; activity: number },
  tags: readonly EffectiveTag[],
  window: FilterWindow,
): EffectiveTag[] {
  if (!window.active) return [...tags]
  const activity = windowActivityOf(person, window)
  return tags
    .filter(
      (tag) =>
        tag.evidenceMessageIds.length === 0 ||
        tag.evidenceMessageIds.some((messageId) => window.messageIds.has(messageId)),
    )
    .map((tag) =>
      tag.dimension === SOCIAL_DIMENSION
        ? { ...tag, confidence: scaledSocialConfidence(tag.confidence, person.activity, activity) }
        : tag,
    )
}

/** 社交维度置信度的近似回算（存储值已按全量活跃度吸附）。 */
function scaledSocialConfidence(confidence: number, fromActivity: number, toActivity: number): number {
  const from = socialActivityFactor(fromActivity)
  if (!(from > 0)) return confidence
  return roundTo(clamp01((confidence / from) * socialActivityFactor(toActivity)))
}
