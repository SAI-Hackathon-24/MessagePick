/**
 * MOD-006 模块内错误与公共小类型（mod-006 §6）：
 * 内部统一以 `ErrorEnvelope` 表达；`code` 只取契约层既有标识（不新增、不复述含义）。
 *
 * 映射表（§6）：
 * - `NO_DATA`              尚无任何条目（API-014 / API-015 空态；引导完成首次更新）
 * - `EMPTY_RESULT`         筛选命中为空（空态 + 一键清除筛选）
 * - `NOT_FOUND`            条目标识不存在（含查询与写入竞态中被删）
 * - `INVALID_INPUT`        主题与优先级均未给出、页码 / 每页非法、枚举越界
 * - `ANALYSIS_FAILED` / `TIMEOUT`  识别 / 抽取 / 聚类失败或超时（可重试；`taskRef` 进 context）
 * - `STORAGE_UNAVAILABLE`  读 / 写存储失败（不静默失败）；原样透传 `MOD-002` 的信封
 *
 * 模块内未知异常**不在此新增标识**：原样上抛，由外壳归「未知失败」并记录日志（详设 §2.2）。
 *
 * 本文件同时承载模块内公共小类型：日志口 `ExtractLogger`（字段口径对齐详设 §6.1；不记消息正文）。
 */

import { isErrorCode, type ErrorEnvelope } from '@shared'

/** 结构化日志口（字段口径对齐详设 §6.1；不记消息正文、联系人与凭据）。 */
export interface ExtractLogger {
  debug?(event: string, fields?: Record<string, unknown>): void
  info?(event: string, fields?: Record<string, unknown>): void
  warn?(event: string, fields?: Record<string, unknown>): void
  error?(event: string, fields?: Record<string, unknown>): void
}

/** 带统一信封的模块错误（调用方只处理 `envelope`，详设 §2.2）。 */
export class ExtractError extends Error {
  readonly envelope: ErrorEnvelope

  constructor(envelope: ErrorEnvelope) {
    super(`${envelope.code}: ${envelope.message}`)
    this.name = 'ExtractError'
    this.envelope = envelope
  }
}

/** 运行期守卫。 */
export function isExtractError(value: unknown): value is ExtractError {
  return value instanceof ExtractError
}

/** `NO_DATA`：尚无任何条目（空态；引导完成首次更新）。 */
export function noData(scope: string): ExtractError {
  return new ExtractError({
    code: 'NO_DATA',
    message: '尚无提取结果，请先完成一次数据更新',
    retryable: false,
    scope,
    context: { action: '首次更新' },
  })
}

/** `EMPTY_RESULT`：有数据但筛选无命中（空态 + 一键清除筛选）。 */
export function emptyResult(scope: string, context?: Record<string, unknown>): ExtractError {
  return new ExtractError({
    code: 'EMPTY_RESULT',
    message: '当前筛选条件下没有结果',
    retryable: false,
    scope,
    context: { action: '清除筛选', ...context },
  })
}

/** `NOT_FOUND`：条目标识不存在（含查询与写入竞态中被删）。 */
export function notFound(scope: string, message: string, context?: Record<string, unknown>): ExtractError {
  return new ExtractError({ code: 'NOT_FOUND', message, retryable: false, scope, context })
}

/** `INVALID_INPUT`：入参非法（schema 层拒绝，不进入业务层）。 */
export function invalidInput(message: string, context?: Record<string, unknown>): ExtractError {
  return new ExtractError({ code: 'INVALID_INPUT', message, retryable: false, scope: 'extract:input', context })
}

/** `ANALYSIS_FAILED`：识别 / 抽取 / 聚类失败（可重试；`taskRef` 进 context）。 */
export function analysisFailed(scope: string, message: string, context?: Record<string, unknown>): ExtractError {
  return new ExtractError({ code: 'ANALYSIS_FAILED', message, retryable: true, scope, context })
}

/** `TIMEOUT`：任务超时（可重试；`taskRef` 进 context）。 */
export function timeout(scope: string, message: string, context?: Record<string, unknown>): ExtractError {
  return new ExtractError({ code: 'TIMEOUT', message, retryable: true, scope, context })
}

/** `STORAGE_UNAVAILABLE`：读 / 写存储失败（透传 `MOD-002` 信封时优先用其原值）。 */
export function storageUnavailable(scope: string, message: string, context?: Record<string, unknown>): ExtractError {
  return new ExtractError({ code: 'STORAGE_UNAVAILABLE', message, retryable: true, scope, context })
}

/**
 * 按结构取统一信封（跨模块错误互通口径：不 `instanceof` 对方错误类，先例见 `meme/app/orchestrator.ts`）。
 * `code` 必须落在 14 个契约标识内，否则视为未知异常（返回 null，原样上抛）。
 */
export function envelopeOf(error: unknown): ErrorEnvelope | null {
  if (typeof error !== 'object' || error === null || !('envelope' in error)) return null
  const candidate = (error as { envelope?: unknown }).envelope
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return null
  const envelope = candidate as Partial<ErrorEnvelope>
  if (typeof envelope.code !== 'string' || !isErrorCode(envelope.code)) return null
  return {
    code: envelope.code,
    message: typeof envelope.message === 'string' ? envelope.message : '',
    retryable: envelope.retryable === true,
    scope: typeof envelope.scope === 'string' ? envelope.scope : '',
    ...(envelope.context === undefined ? {} : { context: envelope.context }),
  }
}

/** 失败分项 / 批次摘要用的错误标识（未知异常归 `ANALYSIS_FAILED`，细节只进日志）。 */
export function failureCodeOf(error: unknown): ErrorEnvelope['code'] {
  return envelopeOf(error)?.code ?? 'ANALYSIS_FAILED'
}
