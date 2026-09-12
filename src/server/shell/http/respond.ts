/**
 * 统一响应与错误信封（mod-004 §3.1「respond.ts」、§4.2、§6.1 / §6.2、详设 §2.2）。
 *
 * - 成功：`{ data, epoch, requestId }`；失败：`{ error: { code, message, retryable, scope, context }, epoch, requestId }`。
 *   `epoch` 用于页面丢弃过期响应（详设 §3.3），`requestId` 是跨模块追踪的唯一载体（详设 §6.3）。
 * - **错误映射的唯一实现**（§6.1）：模块抛出的异常（`StoreError` / `MemeError` / `ExtractError` / `SocialError` /
 *   `RegenError` / 引擎）都带 `.envelope`，原样转发；未映射的内部异常归「未知失败」——`code` 取闭集内既有标识
 *   （与 `extract` / `social` 的既有映射一致：`ANALYSIS_FAILED`），`message` 不给使用者看（只进日志）。
 * - **HTTP 状态只表达传输层结果**：业务结果一律在信封里。显式状态：守卫 403、门控 409、路由不存在 404、
 *   未映射异常 500（§6.2 只钉了前三种，其余按此口径）。
 */

import { ErrorCode, isErrorCode, type ErrorEnvelope } from '@shared'

/** 响应附带的元信息（mod-004 §3.1：`{ data, epoch, requestId }`）。 */
export interface ResponseMeta {
  /** `dataEpoch`（详设 §3.3；外壳从 `MOD-002` 现取） */
  epoch: number
  /** 请求标识（外壳在入口生成，透传到任务、worker 与日志） */
  requestId: string
}

/** 成功响应体。 */
export interface ShellSuccess<T> {
  data: T
  epoch: number
  requestId: string
}

/** 失败响应体。 */
export interface ShellFailure {
  error: ErrorEnvelope
  epoch: number
  requestId: string
}

/** 构造成功响应体。 */
export function success<T>(meta: ResponseMeta, data: T): ShellSuccess<T> {
  return { data, epoch: meta.epoch, requestId: meta.requestId }
}

/** 构造失败响应体。 */
export function failure(meta: ResponseMeta, error: ErrorEnvelope): ShellFailure {
  return { error, epoch: meta.epoch, requestId: meta.requestId }
}

/** 映射结果：信封 + 传输层状态码。 */
export interface MappedError {
  envelope: ErrorEnvelope
  status: number
}

/** 运行期守卫：判断值是否形如完整信封（各模块的 `.envelope` 与自建信封共用）。 */
export function isEnvelopeLike(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<ErrorEnvelope>
  return typeof candidate.code === 'string' && isErrorCode(candidate.code)
}

/** 把任意异常归一成契约信封（已带信封的原样转发；未映射的归「未知失败」）。 */
export function envelopeOf(error: unknown, scope: string): ErrorEnvelope {
  if (isEnvelopeLike(error)) return normalizeEnvelope(error, scope)
  if (typeof error === 'object' && error !== null && 'envelope' in error) {
    const envelope = (error as { envelope?: unknown }).envelope
    if (isEnvelopeLike(envelope)) return normalizeEnvelope(envelope, scope)
  }
  // 未映射的内部异常：细节只进日志（详设 §2.2），面向使用者只给通用提示。
  return {
    code: ErrorCode.ANALYSIS_FAILED,
    message: '未知失败',
    retryable: true,
    scope,
  }
}

/** 归一信封（补 `scope` / `retryable` 缺省；不改变既有字段语义）。 */
function normalizeEnvelope(envelope: ErrorEnvelope, scope: string): ErrorEnvelope {
  return {
    code: envelope.code,
    message: typeof envelope.message === 'string' ? envelope.message : '',
    retryable: envelope.retryable === true,
    scope: typeof envelope.scope === 'string' && envelope.scope.length > 0 ? envelope.scope : scope,
    ...(envelope.context === undefined ? {} : { context: envelope.context }),
  }
}

/** 未映射异常（或已映射但需要 500 的）判定：调用方据此决定状态码与日志级别。 */
export function isUnmapped(error: unknown): boolean {
  if (isEnvelopeLike(error)) return false
  if (typeof error === 'object' && error !== null && 'envelope' in error) {
    return !isEnvelopeLike((error as { envelope?: unknown }).envelope)
  }
  return true
}

/**
 * 映射异常 → 信封 + 状态码（`http/*` 的唯一错误出口）。
 *
 * 状态码口径：业务失败一律 200（信封承载语义）；未映射异常 500。
 */
export function mapError(error: unknown, scope: string): MappedError {
  return { envelope: envelopeOf(error, scope), status: isUnmapped(error) ? 500 : 200 }
}

/** 构造闭集内的自建信封（守卫 / 门控 / 入参校验用；不新增标识）。 */
export function shellEnvelope(
  code: ErrorEnvelope['code'],
  message: string,
  scope: string,
  options: { retryable?: boolean; context?: Record<string, unknown> } = {},
): ErrorEnvelope {
  return {
    code,
    message,
    retryable: options.retryable ?? false,
    scope,
    ...(options.context === undefined ? {} : { context: options.context }),
  }
}

/** 守卫拒绝（写操作缺 / 错启动令牌、Host / Origin 不合法）：HTTP 403（§6.2）。 */
export const GUARD_STATUS = 403
/** 门控拒绝（删除期间触发更新）：HTTP 409（§6.2）。 */
export const GATE_STATUS = 409
/** 路由 / 资源不存在：HTTP 404（§6.2）。 */
export const NOT_FOUND_STATUS = 404
