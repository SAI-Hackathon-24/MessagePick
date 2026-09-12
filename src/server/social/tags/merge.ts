/**
 * 同义标签归并（mod-007 §3.4 阶段 4、§5.1 DM-015；`REQ-055`、`AC-099`）。
 *
 * - 输入 = 聚类任务的产出（一组组同义标签标识）；
 * - 代表标签 = 组内首现最早者（并列按标识升序）——确定性、可复算；
 * - 归并组标识 = 组内标签集合的规范化哈希（同集合重复生成得到同一标识，幂等）；
 * - 归并**不改变证据与置信度**，只改变呈现与聚合口径（DM-015 计算口径）。
 */

import type { InterestTag, TagMergeGroup } from '@shared'

import { fnv1aHex } from '../hash'

/** 解析聚类任务的产出：条目形如 `{ tags: [tagId, ...] }`；无效项与单标签组丢弃。 */
export function parseClusterGroups(result: { items: readonly Record<string, unknown>[] }): string[][] {
  const groups: string[][] = []
  for (const item of result.items) {
    const raw = item.tags ?? item.tagIds
    if (!Array.isArray(raw)) continue
    const tagIds = raw.filter((value): value is string => typeof value === 'string' && value !== '')
    const unique = [...new Set(tagIds)]
    if (unique.length >= 2) groups.push(unique.sort())
  }
  return groups.sort((left, right) => (left.join('\u0001') < right.join('\u0001') ? -1 : 1))
}

/** 归并组标识派生。 */
export function mergeGroupIdOf(tagIds: readonly string[]): string {
  return `mg:${fnv1aHex([...tagIds].sort().join('\u0001'))}`
}

/**
 * 由聚类结果与现有标签规划归并组：
 * - 一个标签只进一个组（按组键顺序，先到先得）；
 * - 组内至少两个**已存在**的标签，否则丢弃；
 * - 代表标签 = 首现最早（并列按标识升序）。
 */
export function planMergeGroups(
  groups: readonly (readonly string[])[],
  tagById: ReadonlyMap<string, InterestTag>,
): TagMergeGroup[] {
  const assigned = new Set<string>()
  const plans: TagMergeGroup[] = []
  for (const group of groups) {
    const tagIds = [...new Set(group)]
      .filter((tagId) => tagById.has(tagId) && !assigned.has(tagId))
      .sort()
    if (tagIds.length < 2) continue
    for (const tagId of tagIds) assigned.add(tagId)
    const representative = [...tagIds].sort((left, right) => {
      const leftTag = tagById.get(left) as InterestTag
      const rightTag = tagById.get(right) as InterestTag
      if (leftTag.firstSeenAt !== rightTag.firstSeenAt) return leftTag.firstSeenAt - rightTag.firstSeenAt
      return left < right ? -1 : 1
    })[0] as string
    plans.push({
      mergeGroupId: mergeGroupIdOf(tagIds),
      representativeTagId: representative,
      mergedTagIds: tagIds.filter((tagId) => tagId !== representative),
    })
  }
  return plans
}

/** 把归并组写回标签行（组外标签的归并组清空；保持其它字段不变）。 */
export function applyMergeGroups(
  tags: readonly InterestTag[],
  groups: readonly TagMergeGroup[],
): InterestTag[] {
  const groupOfTag = new Map<string, string>()
  for (const group of groups) {
    groupOfTag.set(group.representativeTagId, group.mergeGroupId)
    for (const tagId of group.mergedTagIds) groupOfTag.set(tagId, group.mergeGroupId)
  }
  return tags.map((tag) => {
    const mergeGroupId = groupOfTag.get(tag.tagId) ?? null
    return mergeGroupId === tag.mergeGroupId ? tag : { ...tag, mergeGroupId }
  })
}

/** 标签的归并键：归并组内取代表标签；未归并取自身。 */
export function representativeOf(tagId: string, groups: readonly TagMergeGroup[]): string {
  for (const group of groups) {
    if (group.representativeTagId === tagId) return group.representativeTagId
    if (group.mergedTagIds.includes(tagId)) return group.representativeTagId
  }
  return tagId
}

/** 归并后「代表标签 → 成员标签」的展开表。 */
export function expandMergeGroups(groups: readonly TagMergeGroup[]): Map<string, string[]> {
  const expanded = new Map<string, string[]>()
  for (const group of groups) {
    expanded.set(group.representativeTagId, [group.representativeTagId, ...group.mergedTagIds].sort())
  }
  return expanded
}
