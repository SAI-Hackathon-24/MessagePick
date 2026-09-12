/**
 * 任务规格：推断（mod-003 §3.3 表）。
 *
 * 典型输入 = 消息集合 / 上下文；结果条目 = 每条推断一个（属性 + 可选分数）；
 * 来源引用 = 证据消息；**可分块**。条目字段由调用方 `outputSchema` 约束。
 */

import type { TaskParams } from '@shared'

import { validateItemShape, validateTaskParams, type Issue } from './schema'
import type { TaskSpec } from './index'

export const inferSpec: TaskSpec = {
  taskType: '推断',
  chunkable: true,
  validateParams(params: TaskParams): Issue[] {
    return validateTaskParams(params)
  },
  validateItem(item: unknown, params: TaskParams): Issue[] {
    return validateItemShape(item, params.outputSchema)
  },
}
