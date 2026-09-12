/**
 * 任务规格：识别（mod-003 §3.3 表）。
 *
 * 典型输入 = 消息集合；结果条目 = 每条消息一个；来源引用 = 该消息；**可分块**。
 * 条目字段由调用方 `outputSchema` 约束；这里只做协议层浅校验。
 */

import type { TaskParams } from '@shared'

import { validateItemShape, validateTaskParams, type Issue } from './schema'
import type { TaskSpec } from './index'

export const recognizeSpec: TaskSpec = {
  taskType: '识别',
  chunkable: true,
  validateParams(params: TaskParams): Issue[] {
    return validateTaskParams(params)
  },
  validateItem(item: unknown, params: TaskParams): Issue[] {
    return validateItemShape(item, params.outputSchema)
  },
}
