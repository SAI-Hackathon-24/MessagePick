/**
 * MOD-007 评分常量（mod-007 §5.4 与 §8 的全部取值集中在此；缓存键含 `SCORING_VERSION`）。
 *
 * 变更口径（改动任一公式或常量）= 递增 `SCORING_VERSION`：DM-018 / DM-019 / 热度分的
 * 进程内缓存键含版本号，旧缓存不命中即重算（§5.6、§8 决策 2）。
 */

import type { Dimension, Id } from '@shared'

/** 评分口径版本：公式 / 常量变更时递增（缓存键组成部分，§5.6）。 */
export const SCORING_VERSION = 'social-scoring-v1'

/** 一级维度闭集（固定五类，不增不减；`REQ-052`）。 */
export const SOCIAL_DIMENSIONS: readonly Dimension[] = ['运动', '艺术', '游戏', '娱乐', '社交']

/** 「社交」维度：与活跃度同源（`REQ-057`；§8 决策 1）。 */
export const SOCIAL_DIMENSION: Dimension = '社交'

/** 契合度「共同标签 / 置信度加权」两项只取的四个语义维度（§8 决策 1）。 */
export const SEMANTIC_DIMENSIONS: readonly Dimension[] = ['运动', '艺术', '游戏', '娱乐']

/** 社交维度置信度的活跃度参考量：`min(1, sqrt((活跃度 + 1) / 50))` 中的 50（§5.4）。 */
export const SOCIAL_CONFIDENCE_REFERENCE = 50

/** 未知成员阈值：活跃度 < 5 → 未知（§5.4、§8 决策 4）。 */
export const UNKNOWN_ACTIVITY_THRESHOLD = 5

/** 契合度权重：`100 × (0.35·T + 0.25·C + 0.25·I + 0.15·V)`（§5.4）。 */
export const AFFINITY_WEIGHTS = {
  /** 共同标签数量因子 */
  tagCount: 0.35,
  /** 置信度加权因子 */
  confidence: 0.25,
  /** 实际互动因子 */
  interaction: 0.25,
  /** 活跃度因子（活跃度在契合度中只出现这一次） */
  activity: 0.15,
} as const

/** T = `min(1, 共同标签数 / 5)` 的参考量。 */
export const AFFINITY_TAG_COUNT_REFERENCE = 5
/** I = `min(1, 双向互动条数 / 10)` 的参考量。 */
export const AFFINITY_INTERACTION_REFERENCE = 10
/** V = `min(1, min(活跃度A, 活跃度B) / 100)` 的参考量。 */
export const AFFINITY_ACTIVITY_REFERENCE = 100
/** 契合度满分（0 ~ 100）。 */
export const AFFINITY_SCALE = 100

/** 人工增改标签的置信度（DM-014 未规定人工值；取 1 = 使用者标注视为完全可信）。 */
export const HUMAN_TAG_CONFIDENCE = 1
/** 墓碑行的置信度：`origin = '人工增改'` 且置信度为 0 → 视为「已删除」，不进任何产物（见 tags/edits.ts）。 */
export const TOMBSTONE_CONFIDENCE = 0

/** 取数护栏（详设 §5.4；mod-007 §5.4）：图谱节点 / 标签批量取数 / 个人标签词云。 */
export const GRAPH_NODE_LIMIT = 200
export const TAG_BATCH_LIMIT = 200
export const TAG_CLOUD_LIMIT = 100

/** 画像证据「打开更多」的每标签证据上限（展示口径由视图决定，模块只做护栏）。 */
export const EVIDENCE_LIMIT = 200

/** 置信度与分值的保留位数（§5.4：「保留 3 位小数」）。 */
export const SCORE_DIGITS = 3

/** 数值下界收敛到 [0, 1]。 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

/** 按位数四舍五入（消除浮点噪声，保证结果可复算与可比较）。 */
export function roundTo(value: number, digits: number = SCORE_DIGITS): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** 无序对的规范键：两人标识按字典序排列后相连（DM-018 记录身份键）。 */
export function pairKeyOf(a: Id, b: Id): string {
  return a <= b ? `${a}+${b}` : `${b}+${a}`
}
