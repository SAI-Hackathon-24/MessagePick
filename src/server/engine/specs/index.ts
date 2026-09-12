/**
 * 五类任务的执行规格注册表（mod-003 §3.1「specs/index.ts —— 任务类型 → TaskSpec 注册表」）。
 *
 * 差异只有「是否可分块」（§3.3 表；决策 4）；其余流程完全共用，条目校验按调用方
 * `outputSchema` 做浅校验（决策 2）。
 */

import type { TaskParams, TaskType } from '@shared'

import { clusterSpec } from './cluster'
import { extractSpec } from './extract'
import { generateSpec } from './generate'
import { inferSpec } from './infer'
import { recognizeSpec } from './recognize'
import type { Issue } from './schema'

/** 一类任务的执行规格。 */
export interface TaskSpec {
  readonly taskType: TaskType
  /** 是否可分块（识别 / 抽取 / 推断 = 是；聚类 / 生成 = 否）。 */
  readonly chunkable: boolean
  /** 任务参数校验（存在性与形状）。 */
  validateParams(params: TaskParams): Issue[]
  /** 结果条目浅校验（required / 类型 / 枚举；多余字段忽略）。 */
  validateItem(item: unknown, params: TaskParams): Issue[]
}

/** 任务类型 → 规格。 */
export const TASK_SPECS: Readonly<Record<TaskType, TaskSpec>> = {
  识别: recognizeSpec,
  抽取: extractSpec,
  聚类: clusterSpec,
  生成: generateSpec,
  推断: inferSpec,
}

/** 取任务规格（任务类型已在入口校验）。 */
export function getTaskSpec(taskType: TaskType): TaskSpec {
  return TASK_SPECS[taskType]
}

export type { Issue } from './schema'
