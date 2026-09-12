/**
 * 错误标识映射与批次级汇总（mod-001 §6；标识闭集 = `api-contract.md` §1.2）。
 *
 * 本模块可能出现的标识只有：`NO_AUTH`、`TIMEOUT`、`PARTIAL_FAILURE`、`SOURCE_UNAVAILABLE`、
 * `STORAGE_UNAVAILABLE`、`INVALID_INPUT`（防御性入参校验）—— **不新增、不改含义**（详设 §2.2）。
 */

import type { ErrorCode, ErrorEnvelope } from '@shared'
import { isErrorCode } from '@shared'

/** 来源 / 分项失败明细（`retryable` 供 `MOD-004` 决定是否给「重试」入口；出参只带前四项）。 */
export interface IngestFailure {
  code: ErrorCode
  reason: string
  /** 失败边界：来源（群消息 / 通讯录与好友列表）、单群、单分页、单写入批 */
  scope: string
  /** 按详设 §2.1 判定：同一输入重放一次可能成功 → true */
  retryable: boolean
}

/** 批次级标识（`API-001` 声明的三个 + 全失败时可能出现的两个分项标识）。 */
export type OverallCode = 'NO_AUTH' | 'TIMEOUT' | 'PARTIAL_FAILURE' | 'STORAGE_UNAVAILABLE' | 'SOURCE_UNAVAILABLE'

/** §6.2 规则 3 的优先级：取首个作为批次级标识，其余进分项明细。 */
export const OVERALL_CODE_PRIORITY: readonly OverallCode[] = [
  'NO_AUTH',
  'TIMEOUT',
  'STORAGE_UNAVAILABLE',
  'SOURCE_UNAVAILABLE',
]

/** 结构化日志口（字段口径 = 详设 §6.1 / §6.2；不记消息原文与联系人姓名）。 */
export interface IngestLogger {
  debug?(event: string, fields?: Record<string, unknown>): void
  info?(event: string, fields?: Record<string, unknown>): void
  warn?(event: string, fields?: Record<string, unknown>): void
  error?(event: string, fields?: Record<string, unknown>): void
}

/** 日志事件名（复用详设 §6.2 清单，不新增）。 */
export const INGEST_LOG_EVENTS = {
  start: 'ingest.start',
  sourceDone: 'ingest.source.done',
  sourceFailed: 'ingest.source.failed',
  finish: 'ingest.finish',
} as const

/** 构造失败明细（只接受闭集内的标识）。 */
export function failure(code: ErrorCode, reason: string, scope: string, retryable: boolean): IngestFailure {
  if (!isErrorCode(code)) {
    // 编译期已限定 ErrorCode；此处只防运行期外部传入未知字符串。
    throw new RangeError(`未知错误标识：${String(code)}`)
  }
  return { code, reason, scope, retryable }
}

/** 失败明细 → 统一错误信封（详设 §2.2；`context` 不放原文 / 姓名 / 凭据）。 */
export function envelopeOf(f: IngestFailure, context?: Record<string, unknown>): ErrorEnvelope {
  return {
    code: f.code,
    message: f.reason,
    retryable: f.retryable,
    scope: f.scope,
    ...(context === undefined ? {} : { context }),
  }
}

/** 来源状态 → 批次级标识（§6.2 规则 3 的输入）。 */
export interface SourceOutcomeLike {
  status: 'succeeded' | 'failed' | 'noAuth' | 'timeout'
  failure?: IngestFailure
}

/**
 * §6.2 批次级汇总：
 * 1. 全部成功 → 无标识；2. 部分成功 → `PARTIAL_FAILURE`；3. 全部未成功 → 按优先级取首个。
 */
export function overallCodeOf(outcomes: readonly SourceOutcomeLike[]): OverallCode | undefined {
  if (outcomes.length === 0) return undefined
  const succeeded = outcomes.filter((outcome) => outcome.status === 'succeeded')
  if (succeeded.length === outcomes.length) return undefined
  if (succeeded.length > 0) return 'PARTIAL_FAILURE'
  for (const code of OVERALL_CODE_PRIORITY) {
    if (outcomes.some((outcome) => outcome.failure?.code === code)) return code
  }
  return 'SOURCE_UNAVAILABLE'
}

/**
 * 批次级标识 → 错误信封（`context.sources` 给出分项明细，供 `MOD-004` 分项展示）。
 *
 * `OverallCode` 闭集里只有 `NO_AUTH` 不可手动重试（§6.1 表：无授权需先改变外部状态）；
 * `INVALID_INPUT` 不在此函数的定义域内（防御性入参校验走 `invalidInputEnvelope`，恒 `retryable = false`）。
 */
export function overallEnvelope(
  code: OverallCode,
  details: readonly { source: string; status: string; code?: ErrorCode; reason?: string }[],
): ErrorEnvelope {
  const retryable = code !== 'NO_AUTH'
  return {
    code,
    message: code === 'PARTIAL_FAILURE' ? '部分来源未完成' : '本次更新未完成',
    retryable,
    scope: 'source',
    context: { sources: details.map((detail) => ({ ...detail })) },
  }
}

/** 防御性入参校验失败（`API-001` 的 `目标来源` 不在闭集内）。 */
export function invalidInputEnvelope(message: string, context?: Record<string, unknown>): ErrorEnvelope {
  return { code: 'INVALID_INPUT', message, retryable: false, scope: 'source', ...(context === undefined ? {} : { context }) }
}
