/**
 * 模块内错误（mod-005 §6）：内部统一以 `ErrorEnvelope` 表达；`code` 只取契约层既有标识。
 *
 * 映射表（§6）：
 * - `NO_DATA`            忽略筛选时 DM-003 为空（API-009 / API-011）
 * - `EMPTY_RESULT`       有数据但筛选无命中（API-009 / API-013）
 * - `NOT_FOUND`          梗不存在 / 已删除 / 已合并 / 被判「不是梗」；合并目标各类拒绝
 * - `INVALID_INPUT`      入参非法（schema 层）
 * - `IDENTITY_NOT_READY` Me 标识未就绪（API-013；可手动重试）
 * - `ANALYSIS_FAILED` / `TIMEOUT` 分析分项失败 / 超时（可重试）
 */

import type { ErrorEnvelope } from '@shared'

/** 带统一信封的模块错误。 */
export class MemeError extends Error {
  readonly envelope: ErrorEnvelope

  constructor(envelope: ErrorEnvelope) {
    super(`${envelope.code}: ${envelope.message}`)
    this.name = 'MemeError'
    this.envelope = envelope
  }
}

/** 运行期守卫。 */
export function isMemeError(value: unknown): value is MemeError {
  return value instanceof MemeError
}

/** 构造带 `ErrorEnvelope` 的错误（内部使用；导出便于上层与测试构造同形错误）。 */
export function memeError(envelope: ErrorEnvelope): MemeError {
  return new MemeError(envelope)
}

/** `NO_DATA`：尚无可用数据（空态；引导完成首次更新）。 */
export function noData(scope: string): MemeError {
  return new MemeError({
    code: 'NO_DATA',
    message: '尚无可用数据，请先完成一次数据更新',
    retryable: false,
    scope,
    context: { action: '首次更新' },
  })
}

/** `EMPTY_RESULT`：有数据但筛选无命中（空态 + 一键清除筛选）。 */
export function emptyResult(scope: string, context?: Record<string, unknown>): MemeError {
  return new MemeError({
    code: 'EMPTY_RESULT',
    message: '当前筛选条件下没有结果',
    retryable: false,
    scope,
    context: { action: '清除筛选', ...context },
  })
}

/** `NOT_FOUND`：目标不存在 / 不可直访 / 合并目标被拒（原因写 message / context）。 */
export function notFound(scope: string, message: string, context?: Record<string, unknown>): MemeError {
  return new MemeError({
    code: 'NOT_FOUND',
    message,
    retryable: false,
    scope,
    context,
  })
}

/** `INVALID_INPUT`：入参非法（schema 层拒绝，不进入业务层）。 */
export function invalidInput(message: string, context?: Record<string, unknown>): MemeError {
  return new MemeError({
    code: 'INVALID_INPUT',
    message,
    retryable: false,
    scope: 'meme:input',
    context,
  })
}

/** `IDENTITY_NOT_READY`：Me 标识未就绪（提示 + 手动重试）。 */
export function identityNotReady(): MemeError {
  return new MemeError({
    code: 'IDENTITY_NOT_READY',
    message: '「我」的身份尚未就绪，请完成一次数据更新后重试',
    retryable: true,
    scope: 'meme:mine',
  })
}

/** `ANALYSIS_FAILED`：分析失败（可重试；`taskRef` 透传进 context）。 */
export function analysisFailed(scope: string, message: string, context?: Record<string, unknown>): MemeError {
  return new MemeError({
    code: 'ANALYSIS_FAILED',
    message,
    retryable: true,
    scope,
    context,
  })
}

/** `TIMEOUT`：任务超时（可重试；`taskRef` 透传进 context）。 */
export function timeout(scope: string, message: string, context?: Record<string, unknown>): MemeError {
  return new MemeError({
    code: 'TIMEOUT',
    message,
    retryable: true,
    scope,
    context,
  })
}

/** 从既有信封构造错误（引擎 / 存储透传原样保留 code / retryable / context）。 */
export function fromEnvelope(envelope: ErrorEnvelope): MemeError {
  return new MemeError(envelope)
}
