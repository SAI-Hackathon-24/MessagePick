/**
 * 任务引用：生成 / 格式校验 / 信封解析（mod-003 决策 1、§5、§6.1）。
 *
 * - 引用是**随机不透明字符串**，只做格式与登记校验，不解析出语义（决策 1）。
 * - 失败 / 超时的信封 `scope` 携带引用：共享契约里 `ErrorEnvelope.scope` 为字符串，
 *   故编码为 `task:<ref>`（mod-003 §6.1 的「scope 为 { kind: 'task', taskRef }」在本实现中的落点）。
 */

import { randomBytes } from 'node:crypto'

import type { ErrorEnvelope, TaskRef } from '@shared'

/** 引用前缀（仅便于日志辨认，不承载语义）。 */
export const TASK_REF_PREFIX = 'tk_'

const TASK_REF_PATTERN = /^tk_[0-9a-f]{32}$/
const TASK_SCOPE_PREFIX = 'task:'

/** 生成新的任务引用（128 位随机）。 */
export function newTaskRef(): TaskRef {
  return `${TASK_REF_PREFIX}${randomBytes(16).toString('hex')}`
}

/** 格式守卫：引用是否形如 `tk_` + 32 位十六进制。 */
export function isValidTaskRef(value: unknown): value is TaskRef {
  return typeof value === 'string' && TASK_REF_PATTERN.test(value)
}

/** 任务失败信封的 `scope` 编码。 */
export function taskScope(ref: TaskRef): string {
  return `${TASK_SCOPE_PREFIX}${ref}`
}

/** 从 `scope` 取回任务引用；非任务作用域或格式非法时返回 `null`。 */
export function parseTaskScope(scope: unknown): TaskRef | null {
  if (typeof scope !== 'string' || !scope.startsWith(TASK_SCOPE_PREFIX)) return null
  const ref = scope.slice(TASK_SCOPE_PREFIX.length)
  return isValidTaskRef(ref) ? ref : null
}

/** 从错误信封取回任务引用（供调用方 / 使用者凭它调 `API-008` 重试）。 */
export function taskRefFromEnvelope(error: ErrorEnvelope): TaskRef | null {
  return parseTaskScope(error.scope)
}
