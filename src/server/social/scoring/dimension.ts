/**
 * 一级维度分与逐维度差值（mod-007 §5.4、`REQ-059`、`REQ-080`）。
 *
 * - 一级维度分 = 该维度下全部有效标签置信度之和；性格侧只统计「已确认」记录（在 personality/ 侧过滤后传入）；
 * - 逐维度差值 = 两人五个一级维度分逐轴相减（A − B）。
 */

import { DIMENSIONS, PERSONALITY_DIMENSIONS, type DimensionDiffs, type DimensionScores, type PersonalityScores } from '@shared'

import { roundTo } from './constants'
import type { EffectiveTag } from './types'

/** 零值维度分（五轴全 0）。 */
export function emptyDimensionScores(): DimensionScores {
  return zeroScores(DIMENSIONS)
}

/** 零值性格维度分（六轴全 0）。 */
export function emptyPersonalityScores(): PersonalityScores {
  return zeroScores(PERSONALITY_DIMENSIONS)
}

/** 一级维度分 = 该维度下全部有效标签置信度之和。 */
export function dimensionScores(tags: readonly EffectiveTag[]): DimensionScores {
  const scores = emptyDimensionScores()
  for (const tag of tags) {
    scores[tag.dimension] = scores[tag.dimension] + tag.confidence
  }
  for (const dimension of DIMENSIONS) {
    scores[dimension] = roundTo(scores[dimension])
  }
  return scores
}

/** 逐维度差值（五轴，A − B）。 */
export function dimensionDiffs(a: DimensionScores, b: DimensionScores): DimensionDiffs {
  const diffs = {} as DimensionDiffs
  for (const dimension of DIMENSIONS) {
    diffs[dimension] = roundTo(a[dimension] - b[dimension])
  }
  return diffs
}

function zeroScores<K extends string>(keys: readonly K[]): Record<K, number> {
  const scores = {} as Record<K, number>
  for (const key of keys) {
    scores[key] = 0
  }
  return scores
}
