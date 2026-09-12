/**
 * 有效标签（mod-007 §5.4「有效标签」+ `REQ-053` / `REQ-054` / `REQ-055` / DM-015）。
 *
 * 规则：
 * - 归并组内取**代表标签**，置信度取组内最大值；每组只计一次（同义标签不重复出现）；
 * - 无证据的标签不进入画像（`REQ-054`）——仅对**模型产出**成立；
 *   人工增改的标签没有证据消息，属使用者显式输入，照常生效（`REQ-056`、`AC-100`）；
 * - 人工增改的零置信度行 = 「删」的墓碑（MOD-002 无记录级删除能力，见 `tags/edits.ts`），不进任何产物。
 */

import { TOMBSTONE_CONFIDENCE } from './constants'
import type { EffectiveTag, PersonTagLink } from './types'

/**
 * 标签连接是否生效（进入画像 / 匹配 / 分值）：
 * - 置信度必须 > 0；
 * - 模型产出的标签必须有证据消息（无证据不入画像）；
 * - 人工增改的标签不需要证据（使用者显式输入）。
 */
export function isActiveLink(link: PersonTagLink): boolean {
  if (!(link.confidence > TOMBSTONE_CONFIDENCE)) return false
  if (link.origin === '人工增改') return true
  return link.evidenceMessageIds.length > 0
}

/**
 * 归并后的有效标签（每人每组一条）。
 *
 * - `groups` 未覆盖的标签按「自成一组」处理；
 * - 组内全部连接都失效时该组不产出（例如人工删除后只剩模型行）。
 */
export function effectiveTags(
  links: readonly PersonTagLink[],
  groups: readonly { mergeGroupId: string; representativeTagId: string; mergedTagIds: string[] }[],
): EffectiveTag[] {
  const groupByTag = new Map<string, { representativeTagId: string; mergeGroupId: string }>()
  for (const group of groups) {
    for (const tagId of [group.representativeTagId, ...group.mergedTagIds]) {
      if (!groupByTag.has(tagId)) {
        groupByTag.set(tagId, {
          representativeTagId: group.representativeTagId,
          mergeGroupId: group.mergeGroupId,
        })
      }
    }
  }

  const buckets = new Map<string, PersonTagLink[]>()
  for (const link of links) {
    if (!isActiveLink(link)) continue
    const group = groupByTag.get(link.tagId)
    const key = group === undefined ? `tag:${link.tagId}` : `group:${group.mergeGroupId}`
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, [link])
    } else {
      bucket.push(link)
    }
  }

  const result: EffectiveTag[] = []
  for (const [key, bucket] of [...buckets.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1))) {
    const group = key.startsWith('group:') ? groupByTag.get(bucket[0].tagId) : undefined
    const representativeTagId = group?.representativeTagId ?? bucket[0].tagId
    const sorted = [...bucket].sort((left, right) => (left.tagId < right.tagId ? -1 : 1))
    const representative = sorted.find((link) => link.tagId === representativeTagId) ?? sorted[0]
    const evidence = new Set<string>()
    let confidence = 0
    for (const link of sorted) {
      confidence = Math.max(confidence, link.confidence)
      for (const messageId of link.evidenceMessageIds) evidence.add(messageId)
    }
    result.push({
      personId: representative.personId,
      tagId: representativeTagId,
      name: representative.name,
      dimension: representative.dimension,
      confidence,
      evidenceMessageIds: [...evidence].sort(),
      mergedTagIds: sorted.map((link) => link.tagId).filter((tagId) => tagId !== representativeTagId).sort(),
    })
  }
  return result
}
