/**
 * 未知标记（mod-007 §5.4、§8 决策 4；`REQ-081`、`AC-127`）。
 *
 * 活跃度 < 5 → 未知：不推断、仍列出、图谱中零连线。阈值是模块内常量（DM-011 明写由实现层确定）。
 */

import { UNKNOWN_ACTIVITY_THRESHOLD } from './constants'

/** 是否标记为「未知」（发言不足，不足以推断兴趣）。 */
export function isUnknown(activity: number): boolean {
  return activity < UNKNOWN_ACTIVITY_THRESHOLD
}
