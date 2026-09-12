/**
 * 置信度（mod-007 §5.4）：
 * - 语义标签：`clamp01(抽取强度)`；
 * - 社交维度标签：`clamp01(抽取强度) × min(1, sqrt((活跃度 + 1) / 50))`（与活跃度同源、同步变化，`REQ-057`）。
 *
 * 保留 3 位小数（`SCORE_DIGITS`），保证维度分求和可复算。
 */

import { clamp01, roundTo, SOCIAL_CONFIDENCE_REFERENCE, SOCIAL_DIMENSION } from './constants'
import type { TagKind } from './types'

/** 计算标签置信度；`kind` = 标签的一级维度。 */
export function confidenceOf(rawStrength: number, kind: TagKind, activity: number): number {
  const base = clamp01(rawStrength)
  if (kind !== SOCIAL_DIMENSION) {
    return roundTo(base)
  }
  const factor = Math.min(1, Math.sqrt((Math.max(0, activity) + 1) / SOCIAL_CONFIDENCE_REFERENCE))
  return roundTo(base * clamp01(factor))
}

/** 社交维度置信度的活跃度因子（供测试与视图解释口径；取值 ∈ [0, 1]）。 */
export function socialActivityFactor(activity: number): number {
  return roundTo(Math.min(1, Math.sqrt((Math.max(0, activity) + 1) / SOCIAL_CONFIDENCE_REFERENCE)))
}
