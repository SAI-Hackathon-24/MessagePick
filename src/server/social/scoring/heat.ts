/**
 * 整体融入度与兴趣热度分（mod-007 §5.4；`REQ-078`、`REQ-079`）。
 *
 * - 整体融入度 = `Σ(契合度 × max(1, 活跃度)) / Σ(max(1, 活跃度))`，遍历「我的群友」
 *   （去重到人、排除「我」）；无群友返回空（不显示 0 或猜测值）；
 * - 兴趣热度分 = `Σ 置信度 × sqrt(1 + 活跃度)`，遍历该标签（归并后）下全部人；阻尼防止高活跃者独占。
 */

import type { PairScore } from '@shared'

import { roundTo } from './constants'
import type { EffectiveTag, FriendStats, PersonStats } from './types'

/** 整体融入度（单一分数；无群友 = `null`）。 */
export function overallIntegration(
  pairs: readonly PairScore[],
  friends: readonly FriendStats[],
): number | null {
  const seen = new Set<string>()
  let weighted = 0
  let weight = 0
  for (const friend of friends) {
    if (friend.isMe === true) continue
    if (seen.has(friend.personId)) continue
    seen.add(friend.personId)
    const pair = pairs.find(
      (candidate) => candidate.personAId === friend.personId || candidate.personBId === friend.personId,
    )
    const fit = pair === undefined ? 0 : pair.fitScore
    const friendWeight = Math.max(1, Math.max(0, friend.activity))
    weighted += fit * friendWeight
    weight += friendWeight
  }
  if (weight === 0) return null
  return roundTo(weighted / weight)
}

/**
 * 兴趣热度分：传入**某一标签（归并后）下全部人的有效置信度**；
 * `people` 提供人的活跃度（同一个人只计一次，重复项按最大值取一次）。
 */
export function interestHeat(tags: readonly EffectiveTag[], people: readonly PersonStats[]): number {
  const activityOf = new Map(people.map((person) => [person.personId, Math.max(0, person.activity)]))
  const seen = new Set<string>()
  let total = 0
  for (const tag of tags) {
    if (seen.has(tag.personId)) continue
    seen.add(tag.personId)
    const activity = activityOf.get(tag.personId) ?? 0
    total += tag.confidence * Math.sqrt(1 + activity)
  }
  return roundTo(total)
}
