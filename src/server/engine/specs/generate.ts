/**
 * 任务规格：生成（mod-003 §3.3 表）。
 *
 * 典型输入 = 上下文；结果条目 = 每个变体一个；来源引用 = 上下文标识；
 * **不可分块**（整入单次调用；超限 → `INVALID_INPUT` / `INPUT_TOO_LARGE`）。
 * 生成物的落盘 / 模板 / 文案口径属调用方（本引擎不产出面向使用者的内容）。
 */

import type { TaskParams } from '@shared'

import { validateItemShape, validateTaskParams, type Issue } from './schema'
import type { TaskSpec } from './index'

export const generateSpec: TaskSpec = {
  taskType: '生成',
  chunkable: false,
  validateParams(params: TaskParams): Issue[] {
    return validateTaskParams(params)
  },
  validateItem(item: unknown, params: TaskParams): Issue[] {
    return validateItemShape(item, params.outputSchema)
  },
}
