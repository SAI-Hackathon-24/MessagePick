/**
 * MOD-008 内部失败类型与错误信封构造（mod-008 §6「错误处理」）。
 *
 * - `code` 只取 `api-contract.md` §1.2 的既有标识（14 个）：不新增、不复述（详设 §2.2）。
 * - 本模块产生的标识仅限：`MATERIAL_NOT_CONFIRMED`、`SOURCE_UNAVAILABLE`、`INVALID_INPUT`、
 *   `ANALYSIS_FAILED`、`TIMEOUT`、`EMPTY_RESULT`、`NOT_FOUND`、`STORAGE_UNAVAILABLE`；
 *   其余六个标识不由本模块产生（mod-008 §6 末节）。
 * - `scope` 口径：生成请求 ID（受理后的编排语义）或 `task:<任务引用>`（模型任务失败时原样透传，
 *   外壳 / 使用者凭它调用 `API-008` 重试 —— 与 MOD-003 的信封口径一致）。
 * - 面向使用者的文案由外壳统一映射（mod-004 §6.1）；此处 `message` 只作日志与排障口径。
 */

import type { ErrorEnvelope } from '@shared'
import { isErrorCode } from '@shared'

/** 携带统一错误信封的内部失败（用例层用 throw 表达失败，`api/` 层转成出参）。 */
export class RegenError extends Error {
  readonly envelope: ErrorEnvelope

  constructor(envelope: ErrorEnvelope) {
    super(`${envelope.code}: ${envelope.message}`)
    this.name = 'RegenError'
    this.envelope = envelope
  }
}

/** 运行期守卫：判断异常是否为 `RegenError`。 */
export function isRegenError(value: unknown): value is RegenError {
  return value instanceof RegenError
}

/** 抛 `INVALID_INPUT`（档位值不在闭集 / 模板标识不在清单 / 筛选结构非法；不触库）。 */
export function failInvalidInput(message: string, context?: Record<string, unknown>): never {
  throw new RegenError({
    code: 'INVALID_INPUT',
    message,
    retryable: false,
    scope: 'regen:input',
    context,
  })
}

/** 抛 `SOURCE_UNAVAILABLE`（来源素材缺失 / 媒体不可用；提示并可切换档位后重试）。 */
export function failSourceUnavailable(message: string, context?: Record<string, unknown>): never {
  throw new RegenError({
    code: 'SOURCE_UNAVAILABLE',
    message,
    retryable: true,
    scope: 'regen:materials',
    context,
  })
}

/** 抛 `MATERIAL_NOT_CONFIRMED`（scope = 本次生成请求；`context.items` = 待确认素材清单）。 */
export function failMaterialNotConfirmed(
  generationId: string,
  items: readonly Record<string, unknown>[],
): never {
  throw new RegenError({
    code: 'MATERIAL_NOT_CONFIRMED',
    message: '使用成员素材（头像 / 照片 / 原话）前需先确认',
    retryable: false,
    scope: generationId,
    context: { requestId: generationId, items: [...items] },
  })
}

/** 抛任务类失败（`ANALYSIS_FAILED`；`scope` = 任务引用作用域，便于经 `API-008` 重试）。 */
export function failAnalysis(
  message: string,
  options: { scope?: string; retryable?: boolean; context?: Record<string, unknown>; taskRef?: string } = {},
): never {
  throw new RegenError({
    code: 'ANALYSIS_FAILED',
    message,
    retryable: options.retryable ?? true,
    scope: options.taskRef ? `task:${options.taskRef}` : (options.scope ?? 'regen:generation'),
    context: options.context,
  })
}

/** 抛 `TIMEOUT`（任务 / 渲染超时；`scope` 口径同 `failAnalysis`）。 */
export function failTimeout(
  message: string,
  options: { scope?: string; retryable?: boolean; context?: Record<string, unknown>; taskRef?: string } = {},
): never {
  throw new RegenError({
    code: 'TIMEOUT',
    message,
    retryable: options.retryable ?? true,
    scope: options.taskRef ? `task:${options.taskRef}` : (options.scope ?? 'regen:generation'),
    context: options.context,
  })
}

/** 抛 `EMPTY_RESULT`（空态：无候选 / 历史无记录；不写占位）。 */
export function failEmptyResult(message: string, context?: Record<string, unknown>): never {
  throw new RegenError({
    code: 'EMPTY_RESULT',
    message,
    retryable: false,
    scope: 'regen:empty',
    context,
  })
}

/** 抛 `NOT_FOUND`（候选 / 产物不存在）。 */
export function failNotFound(message: string, context?: Record<string, unknown>): never {
  throw new RegenError({
    code: 'NOT_FOUND',
    message,
    retryable: false,
    scope: 'regen:lookup',
    context,
  })
}

/** 抛 `STORAGE_UNAVAILABLE`（批次整体失败、状态不变、可原样重试；不静默失败）。 */
export function failStorageUnavailable(message: string, context?: Record<string, unknown>): never {
  throw new RegenError({
    code: 'STORAGE_UNAVAILABLE',
    message,
    retryable: true,
    scope: 'regen:store',
    context,
  })
}

/**
 * 运行期守卫：异常是否携带契约信封（详设 §2.2 统一结构，`MOD-002` / `MOD-003` 的异常）。
 * 只按信封字段做结构校验，不断言具体错误类。
 */
function isEnvelopedError(value: unknown): value is { envelope: ErrorEnvelope } {
  if (value === null || typeof value !== 'object' || !('envelope' in value)) return false
  const envelope = (value as { envelope?: unknown }).envelope
  if (envelope === null || typeof envelope !== 'object') return false
  const fields = envelope as { code?: unknown; message?: unknown; retryable?: unknown; scope?: unknown }
  return (
    isErrorCode(fields.code) &&
    typeof fields.message === 'string' &&
    typeof fields.retryable === 'boolean' &&
    typeof fields.scope === 'string'
  )
}

/**
 * 把跨模块异常还原为信封（`MOD-002` / `MOD-003` 等已携带契约信封者原样透传）；
 * 无法识别的异常不与具体类型绑定，按调用方给出的兜底消息归入 `STORAGE_UNAVAILABLE`。
 */
export function envelopeOf(error: unknown, fallbackMessage: string): ErrorEnvelope {
  if (isRegenError(error)) return error.envelope
  if (isEnvelopedError(error)) return error.envelope
  return {
    code: 'STORAGE_UNAVAILABLE',
    message: fallbackMessage,
    retryable: true,
    scope: 'regen:store',
  }
}
