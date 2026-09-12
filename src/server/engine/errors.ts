/**
 * MOD-003 内部失败分类 → 契约错误信封（mod-003 §6.1 映射表）。
 *
 * 边界（mod-003 §6.1 / 详设 §2.2）：
 * - 本模块只产生 `INVALID_INPUT` / `TIMEOUT` / `ANALYSIS_FAILED` 三个标识；不新增标识。
 * - `retryable` = 是否可**手动**重试（详设 §2.1 判定规则）；`autoRetry` = 是否允许**自动**重试（§2.3 预算内）。
 * - `message` 只给日志与诊断：一句原因 + 失败边界，不含消息文本、凭据与原始报文。
 */

import type { ErrorCode, ErrorEnvelope } from '@shared'

/** 内部失败原因（`context.reason` 的取值集合）。 */
export type FailureReason =
  | 'VALIDATION'
  | 'INPUT_TOO_LARGE'
  | 'REF_UNKNOWN'
  | 'CALL_TIMEOUT'
  | 'NETWORK'
  | 'RATE_LIMIT'
  | 'UPSTREAM_5XX'
  | 'OUTPUT_INVALID'
  | 'CREDENTIAL'
  | 'MODEL_NOT_CONFIGURED'
  | 'REQUEST_REJECTED'
  | 'REFUSAL'
  | 'WORKER_CRASH'
  | 'BREAKER_OPEN'
  | 'CANCELED'
  | 'UNKNOWN'

/** 全部分类（顺序与 §6.1 表格一致；`CANCELED` 见下）。 */
export const FAILURE_REASONS: readonly FailureReason[] = [
  'VALIDATION',
  'INPUT_TOO_LARGE',
  'REF_UNKNOWN',
  'CALL_TIMEOUT',
  'NETWORK',
  'RATE_LIMIT',
  'UPSTREAM_5XX',
  'OUTPUT_INVALID',
  'CREDENTIAL',
  'MODEL_NOT_CONFIGURED',
  'REQUEST_REJECTED',
  'REFUSAL',
  'WORKER_CRASH',
  'BREAKER_OPEN',
  'CANCELED',
  'UNKNOWN',
]

/** 分类到信封字段的映射（mod-003 §6.1）。 */
export interface FailureSpec {
  readonly code: ErrorCode
  /** 是否可手动重试（详设 §2.1）。 */
  readonly retryable: boolean
  /** 自动重试预算内是否允许重试（详设 §2.3；熔断打开时暂停）。 */
  readonly autoRetry: boolean
}

/** §6.1 映射表；`CANCELED` 只用于 §5.2 的 `queued → canceled`（进程收尾），不是新错误标识。 */
export const FAILURE_SPECS: Readonly<Record<FailureReason, FailureSpec>> = {
  VALIDATION: { code: 'INVALID_INPUT', retryable: false, autoRetry: false },
  INPUT_TOO_LARGE: { code: 'INVALID_INPUT', retryable: false, autoRetry: false },
  REF_UNKNOWN: { code: 'INVALID_INPUT', retryable: false, autoRetry: false },
  CALL_TIMEOUT: { code: 'TIMEOUT', retryable: true, autoRetry: true },
  NETWORK: { code: 'ANALYSIS_FAILED', retryable: true, autoRetry: true },
  RATE_LIMIT: { code: 'ANALYSIS_FAILED', retryable: true, autoRetry: true },
  UPSTREAM_5XX: { code: 'ANALYSIS_FAILED', retryable: true, autoRetry: true },
  OUTPUT_INVALID: { code: 'ANALYSIS_FAILED', retryable: true, autoRetry: true },
  CREDENTIAL: { code: 'ANALYSIS_FAILED', retryable: false, autoRetry: false },
  MODEL_NOT_CONFIGURED: { code: 'ANALYSIS_FAILED', retryable: false, autoRetry: false },
  REQUEST_REJECTED: { code: 'ANALYSIS_FAILED', retryable: false, autoRetry: false },
  REFUSAL: { code: 'ANALYSIS_FAILED', retryable: false, autoRetry: false },
  WORKER_CRASH: { code: 'ANALYSIS_FAILED', retryable: true, autoRetry: true },
  BREAKER_OPEN: { code: 'ANALYSIS_FAILED', retryable: true, autoRetry: false },
  CANCELED: { code: 'ANALYSIS_FAILED', retryable: false, autoRetry: false },
  UNKNOWN: { code: 'ANALYSIS_FAILED', retryable: false, autoRetry: false },
}

/** 引擎内部失败（在 executor 边界统一映射为 `ErrorEnvelope`）。 */
export class EngineFailure extends Error {
  readonly reason: FailureReason
  readonly code: ErrorCode
  readonly retryable: boolean
  readonly autoRetry: boolean
  /** 服务端给出的 `Retry-After`（毫秒）；仅限流类失败可能非空。 */
  readonly retryAfterMs: number | null

  constructor(reason: FailureReason, message: string, options: { retryAfterMs?: number | null; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    const spec = FAILURE_SPECS[reason]
    this.name = 'EngineFailure'
    this.reason = reason
    this.code = spec.code
    this.retryable = spec.retryable
    this.autoRetry = spec.autoRetry
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

/** 运行期守卫。 */
export function isEngineFailure(value: unknown): value is EngineFailure {
  return value instanceof EngineFailure
}

/** 任意异常 → 引擎内部分类（未映射的一律归入 `UNKNOWN`，不吞错）。 */
export function asEngineFailure(value: unknown): EngineFailure {
  if (value instanceof EngineFailure) return value
  if (value instanceof Error) return new EngineFailure('UNKNOWN', `未映射的内部异常（${value.name}）`, { cause: value })
  return new EngineFailure('UNKNOWN', '未映射的内部异常')
}

/** 任务失败 / 超时的信封：`scope` 携带任务引用（mod-003 §6.1；`task:<ref>`，见 task-ref.ts）。 */
export function toEnvelope(failure: EngineFailure, scope: string): ErrorEnvelope {
  return {
    code: failure.code,
    message: failure.message,
    retryable: failure.retryable,
    scope,
    context: { reason: failure.reason },
  }
}

/** `INVALID_INPUT` 的信封：未建立任务记录、不产生执行，因此没有任务引用（§6.1）。 */
export function requestErrorEnvelope(failure: EngineFailure): ErrorEnvelope {
  return { ...toEnvelope(failure, 'request') }
}
