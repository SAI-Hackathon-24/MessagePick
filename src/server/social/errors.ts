/**
 * MOD-007 模块内错误与统一信封映射（mod-007 §6；详设 §2.2）。
 *
 * - 只复用 `@shared` 的 14 个错误标识，**不新增**；未映射的内部异常由外壳归入「未知失败」。
 * - `message` 只进日志与调用方诊断，不给使用者直接看（面向使用者的文案由 MOD-004 统一映射）。
 * - `context` 不放消息原文、成员昵称与凭据（详设 §4.3）；本模块特别地**不把昵称写进错误**。
 */

import { ErrorCode, type ErrorEnvelope } from '@shared'

/** 模块内错误：携带契约错误标识 + 失败边界 + 是否可重试。 */
export class SocialError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean
  readonly scope: string
  readonly context?: Record<string, unknown>

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; scope: string; context?: Record<string, unknown> },
  ) {
    super(message)
    this.name = 'SocialError'
    this.code = code
    this.retryable = options.retryable ?? defaultRetryable(code)
    this.scope = options.scope
    this.context = options.context
  }
}

/** 可重试判定（详设 §2.1）：同一输入重放一次可能成功 → 可重试。 */
function defaultRetryable(code: ErrorCode): boolean {
  switch (code) {
    case ErrorCode.TIMEOUT:
    case ErrorCode.ANALYSIS_FAILED:
    case ErrorCode.STORAGE_UNAVAILABLE:
    case ErrorCode.SOURCE_UNAVAILABLE:
      return true
    default:
      return false
  }
}

export function isSocialError(value: unknown): value is SocialError {
  return value instanceof SocialError
}

/** 构造模块内错误（语法糖）。 */
export function socialError(
  code: ErrorCode,
  message: string,
  options: { retryable?: boolean; scope: string; context?: Record<string, unknown> },
): SocialError {
  return new SocialError(code, message, options)
}

/** 转统一错误信封（跨进程 / 跨模块边界用；外壳据此呈现）。 */
export function toErrorEnvelope(error: unknown, scope: string): ErrorEnvelope {
  if (isSocialError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      scope: error.scope,
      ...(error.context === undefined ? {} : { context: error.context }),
    }
  }
  if (error instanceof Error) {
    // 未映射的内部异常：归入「未知失败」的通用提示（只进日志），不新增标识（详设 §2.2）。
    return {
      code: ErrorCode.ANALYSIS_FAILED,
      message: error.message,
      retryable: true,
      scope,
    }
  }
  return {
    code: ErrorCode.ANALYSIS_FAILED,
    message: `未识别的内部异常：${String(error)}`,
    retryable: true,
    scope,
  }
}

/** MOD-002 读 / 写失败的透传口径（`REQ-016`：不静默失败）。 */
export function storageUnavailable(error: unknown, scope: string): SocialError {
  return socialError(ErrorCode.STORAGE_UNAVAILABLE, describe(error, '存储不可用'), {
    scope,
  })
}

/** 任务失败（`API-007` 失败 / 超时）→ `ANALYSIS_FAILED` / `TIMEOUT`（保存任务引用供 `API-008` 重试）。 */
export function analysisFailure(code: ErrorCode, message: string, scope: string, taskRef?: string): SocialError {
  return socialError(code, message, {
    scope,
    ...(taskRef === undefined ? {} : { context: { taskRef } }),
  })
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message !== '') return error.message
  return fallback
}
