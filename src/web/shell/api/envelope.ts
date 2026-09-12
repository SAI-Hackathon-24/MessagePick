/**
 * 统一响应信封与失败解析（mod-004 §4.1、详设 §2.2 / §3.3）。
 *
 * 成功：`{ data, epoch, requestId }`（mod-004 §4.1 的统一响应）。
 * 失败：`{ code, message, retryable, scope, context }`（详设 §2.2 的统一错误信封），
 *       直接作为响应体或包在 `error` 字段下都兼容。
 * 传输失败（网络断、响应不是 JSON、非 2xx 且无合法信封）→ 页面按「未知失败」呈现（不新增标识）。
 */

import { isErrorCode, type ErrorEnvelope } from '@shared'

import { defaultRetryable } from '../present/error-presentation'

/** 成功响应的载荷。 */
export interface ShellEnvelope<T> {
  data: T
  /** 数据代际（用于丢弃过期响应、失效页面缓存） */
  epoch: number
  /** 请求标识（外壳在服务端入口生成；页面用于日志检索） */
  requestId: string
}

/** 页面侧看到的失败：HTTP 状态 + 可选信封 + 请求标识。 */
export interface ShellFailure {
  /** HTTP 状态码；0 = 请求未到达（网络失败） */
  status: number
  /** 服务端统一错误信封；结构不合法 / 无信封时为 `null` → 「未知失败」 */
  envelope: ErrorEnvelope | null
  requestId: string | null
  /** 原始异常（只进控制台日志） */
  cause?: unknown
}

/** 取数结果（成功携带代际与是否过期；失败携带失败对象）。 */
export type ApiResult<T> =
  | { ok: true; data: T; epoch: number; requestId: string; stale: boolean }
  | { ok: false; failure: ShellFailure }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 从任意载荷里取请求标识（成功 / 失败响应都可能在顶层带）。 */
export function readRequestId(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const value = payload['requestId']
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 把任意载荷归口为统一错误信封；不合法时返回 `null`（→ 未映射兜底）。 */
export function coerceErrorEnvelope(payload: unknown): ErrorEnvelope | null {
  const candidate = isRecord(payload) && isRecord(payload['error']) ? payload['error'] : payload
  if (!isRecord(candidate)) return null
  const code = candidate['code']
  if (!isErrorCode(code)) return null
  const message = typeof candidate['message'] === 'string' ? candidate['message'] : ''
  const scope = typeof candidate['scope'] === 'string' ? candidate['scope'] : ''
  const retryable = typeof candidate['retryable'] === 'boolean' ? candidate['retryable'] : defaultRetryable(code)
  const context = isRecord(candidate['context']) ? (candidate['context'] as Record<string, unknown>) : undefined
  return context ? { code, message, retryable, scope, context } : { code, message, retryable, scope }
}

/** 网络层失败（请求未到达）。 */
export function networkFailure(cause: unknown): ShellFailure {
  return { status: 0, envelope: null, requestId: null, cause }
}

/** 守卫拒绝（缺 / 错启动令牌、Host / Origin 不合法）：页面据此转只读模式。 */
export function isGuardRejection(failure: ShellFailure): boolean {
  return failure.status === 403
}

/**
 * 解析一次 HTTP 响应（纯函数，便于用假响应单测）。
 *
 * @param status  HTTP 状态码
 * @param payload 已解析的 JSON 载荷（解析失败时由调用方传 `null`）
 */
export function parseShellResponse<T>(status: number, payload: unknown): ApiResult<T> {
  const requestId = readRequestId(payload)
  if (status >= 200 && status < 300) {
    if (isRecord(payload) && 'data' in payload) {
      const epoch = typeof payload['epoch'] === 'number' ? payload['epoch'] : 0
      return {
        ok: true,
        data: payload['data'] as T,
        epoch,
        requestId: requestId ?? '',
        stale: false,
      }
    }
    return { ok: true, data: payload as T, epoch: 0, requestId: requestId ?? '', stale: false }
  }
  return { ok: false, failure: { status, envelope: coerceErrorEnvelope(payload), requestId, cause: undefined } }
}

/** 生成一个页面侧请求标识（仅用于「请求未到达」这类服务端无从生成的情形）。 */
export function createRequestId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
