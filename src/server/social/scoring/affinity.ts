/**
 * 契合度（mod-007 §5.4、§8 决策 2；`REQ-057`、`REQ-058`、`REQ-102`/`AC-102`、`AC-103`、`AC-135`）。
 *
 * `100 × (0.35·T + 0.25·C + 0.25·I + 0.15·V)`
 * - T = `min(1, 共同标签数 / 5)`；
 * - C = 共同标签上 `min(置信度A, 置信度B)` 的均值；
 * - I = `min(1, 双向互动条数 / 10)`；
 * - V = `min(1, min(活跃度A, 活跃度B) / 100)`。
 *
 * 口径约束：
 * - **T 与 C 只取运动 / 艺术 / 游戏 / 娱乐四维**（社交维度与活跃度同源，其贡献由 V 承担，只计一次）；
 * - **公式无时间项**：证据时间前移不影响结果（`REQ-086`）。
 */

import {
  AFFINITY_ACTIVITY_REFERENCE,
  AFFINITY_INTERACTION_REFERENCE,
  AFFINITY_SCALE,
  AFFINITY_TAG_COUNT_REFERENCE,
  AFFINITY_WEIGHTS,
  SEMANTIC_DIMENSIONS,
  roundTo,
} from './constants'
import type { CommonTag, PersonStats } from './types'

/** 计算契合度分（0 ~ 100，保留 3 位小数）。 */
export function affinity(
  a: PersonStats,
  b: PersonStats,
  common: readonly CommonTag[],
  interactions: number,
): number {
  const semantic = common.filter((tag) => SEMANTIC_DIMENSIONS.includes(tag.dimension))

  const tagFactor = Math.min(1, semantic.length / AFFINITY_TAG_COUNT_REFERENCE)
  const confidenceFactor =
    semantic.length === 0
      ? 0
      : semantic.reduce((sum, tag) => sum + Math.min(tag.confidenceA, tag.confidenceB), 0) /
        semantic.length
  const interactionFactor = Math.min(1, Math.max(0, interactions) / AFFINITY_INTERACTION_REFERENCE)
  const activityFactor = Math.min(
    1,
    Math.min(Math.max(0, a.activity), Math.max(0, b.activity)) / AFFINITY_ACTIVITY_REFERENCE,
  )

  const score =
    AFFINITY_SCALE *
    (AFFINITY_WEIGHTS.tagCount * tagFactor +
      AFFINITY_WEIGHTS.confidence * confidenceFactor +
      AFFINITY_WEIGHTS.interaction * interactionFactor +
      AFFINITY_WEIGHTS.activity * activityFactor)

  return roundTo(score)
}

/** 两列有效标签求共同标签（含社交维度：展示与图谱连线用五维，见 §5.4「共同爱好」）。 */
export function commonTagsOf(a: readonly { tagId: string; name: string; dimension: CommonTag['dimension']; confidence: number }[], b: readonly { tagId: string; name: string; dimension: CommonTag['dimension']; confidence: number }[]): CommonTag[] {
  const byTag = new Map(b.map((tag) => [tag.tagId, tag]))
  const common: CommonTag[] = []
  for (const tag of a) {
    const other = byTag.get(tag.tagId)
    if (other === undefined) continue
    common.push({
      tagId: tag.tagId,
      name: tag.name,
      dimension: tag.dimension,
      confidenceA: tag.confidence,
      confidenceB: other.confidence,
    })
  }
  return common.sort((left, right) => (left.tagId < right.tagId ? -1 : 1))
}
