/**
 * 任务规格：聚类（mod-003 §3.3 表）。
 *
 * 典型输入 = 消息集合 / 文本集合；结果条目 = 每个簇一个（名称 + 成员）；来源引用 = 簇内全部成员；
 * **不可分块**（整入单次调用；超限 → `INVALID_INPUT` / `INPUT_TOO_LARGE`）。
 */

import type { TaskParams } from '@shared'

import { validateItemShape, validateTaskParams, type Issue } from './schema'
import type { TaskSpec } from './index'

export const clusterSpec: TaskSpec = {
  taskType: '聚类',
  chunkable: false,
  validateParams(params: TaskParams): Issue[] {
    return validateTaskParams(params)
  },
  validateItem(item: unknown, params: TaskParams): Issue[] {
    return validateItemShape(item, params.outputSchema)
  },
}
