/**
 * 消息详情的页面侧组装视图（`TASK-036` / `AC-116`；mod-004 §4.6 / 决策 5）。
 *
 * 服务端已按 `REQ-070` 组装好 `{ detail, hints, hintStatus }`；页面侧只做两件事：
 * - 正文与提示分开呈现，任一失败不牵连另一方（`hintStatus='degraded'` → 正文照常 + 提示区重试）；
 * - 无成员兴趣数据 → 不显示提示、不弹错误（`NO_DATA` 不落到错误提示）。
 */

import type { MemberHint, MessageDetail } from '@shared'

/** 服务端组合端点的载荷（`assembleDetail` 的返回；mod-004 §3.3）。 */
export interface DetailPayload {
  detail: MessageDetail
  hints: MemberHint[]
  hintStatus: 'ok' | 'degraded'
}

/** 页面侧渲染视图。 */
export interface DetailView {
  body: MessageDetail
  hints: MemberHint[]
  /** 是否显示提示区的重试入口（仅降级时显示；正文不受影响）。 */
  showHintRetry: boolean
}

/** 解析为渲染视图（纯函数）。 */
export function resolveDetailView(payload: DetailPayload): DetailView {
  return {
    body: payload.detail,
    hints: payload.hints,
    showHintRetry: payload.hintStatus === 'degraded',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 校验并归一化服务端载荷（结构不符返回 `null`，不猜、不补）。 */
export function coerceDetailPayload(raw: unknown): DetailPayload | null {
  if (!isRecord(raw)) return null
  const detail = raw['detail']
  if (!isRecord(detail)) return null
  const heading = detail['heading']
  const body = detail['body']
  if (!isRecord(heading) || !isRecord(body)) return null
  const hints = Array.isArray(raw['hints']) ? (raw['hints'] as MemberHint[]) : []
  return {
    detail: detail as unknown as MessageDetail,
    hints,
    hintStatus: raw['hintStatus'] === 'degraded' ? 'degraded' : 'ok',
  }
}
