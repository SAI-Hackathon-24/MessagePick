/**
 * 页面侧取数客户端（mod-004 §4.1 / 详设 §4.1、§3.3）。
 *
 * - 读请求不带令牌；写请求带启动令牌头（无令牌的页面 = 只读模式，写入口由界面置灰）。
 * - 统一信封解析：成功取 `{ data, epoch, requestId }`，失败归口统一错误信封；
 *   过期响应（`epoch` 落后）不覆盖页面数据，由 `stale` 标记交给调用方丢弃。
 * - `fetch` 可注入：单测直接给假实现，不启真实服务（mod-004 §7）。
 */

import type { SharedFilter } from '@shared'

import { createEpochGate, type EpochGate } from './epoch'
import {
  createRequestId,
  networkFailure,
  parseShellResponse,
  type ApiResult,
  type ShellFailure,
} from './envelope'
import { applyFilterParams, buildFilterParams } from './filter-query'
import type { LaunchToken } from './token'
import { writeHeaders } from './token'

/** 请求选项。 */
export interface RequestOptions {
  /** 额外的查询参数。 */
  params?: Array<[string, string]>
  /** 全局筛选条件（作为唯一筛选入参随请求下发）。 */
  filter?: SharedFilter | null
}

/** 页面侧接口客户端。 */
export interface ApiClient {
  /** 是否处于只读模式（无启动令牌）。 */
  readonly readOnly: boolean
  /** 代际闸门（群清单缓存等按它失效）。 */
  readonly epoch: EpochGate
  get<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>>
  post<T>(path: string, body?: unknown, options?: { readOnlyHint?: boolean }): Promise<ApiResult<T>>
  put<T>(path: string, body?: unknown): Promise<ApiResult<T>>
  /** 最近一次请求标识（失败提示用）。 */
  lastRequestId(): string | null
}

/** 创建选项（测试注入假 fetch / 假令牌）。 */
export interface ApiClientOptions {
  fetch?: typeof fetch
  token: LaunchToken
  epoch?: EpochGate
}

/** 创建页面侧客户端。 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  const epoch = options.epoch ?? createEpochGate()
  let lastRequestId: string | null = null

  async function send<T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {}
    if (method !== 'GET') {
      Object.assign(headers, writeHeaders(options.token.get()))
      headers['content-type'] = 'application/json'
    }
    let response: Response
    try {
      response = await doFetch(url, {
        method,
        headers,
        body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (cause) {
      lastRequestId = createRequestId()
      return { ok: false, failure: { ...networkFailure(cause), requestId: lastRequestId } satisfies ShellFailure }
    }
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    const result = parseShellResponse<T>(response.status, payload)
    lastRequestId = result.ok ? result.requestId || null : result.failure.requestId
    if (result.ok) {
      const accepted = epoch.accept(result.epoch)
      return accepted ? result : { ...result, stale: true }
    }
    return result
  }

  function withParams(path: string, request?: RequestOptions): string {
    const params: Array<[string, string]> = [...(request?.params ?? [])]
    params.push(...buildFilterParams(request?.filter))
    if (params.length === 0) return path
    const search = new URLSearchParams(params).toString()
    return path.includes('?') ? `${path}&${search}` : `${path}?${search}`
  }

  return {
    get readOnly() {
      return options.token.get() === null
    },
    epoch,
    get: <T>(path: string, request?: RequestOptions) => send<T>('GET', withParams(path, request)),
    post: <T>(path: string, body?: unknown) => send<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => send<T>('PUT', path, body),
    lastRequestId: () => lastRequestId,
  }
}

/** 把筛选条件附加到路径（供需要在客户端外拼 URL 的场景复用）。 */
export { applyFilterParams }
