/**
 * 消息详情容器（`TASK-036`；mod-004 §4.6 的呈现侧、决策 5）。
 *
 * 组装结果由服务端一次给出（`GET /api/message-detail/:entryId`）；本容器：
 * - 正文用 `MOD-006` 的详情视图——模块视图尚未接入，先经 `renderBody` 注入（挂载点）；
 * - 提示由外壳的 `MemberHints` 渲染在正文内；
 * - `NOT_FOUND` → 返回上一视图；失败 / 超时 → 提示 + 重试，已取到的正文保持可浏览。
 */

import type { ReactNode } from 'react'

import type { MessageDetail } from '@shared'

import type { FailureLike } from '../present/error-presentation'
import { ErrorNotice } from '../present/notice'
import { resolveDetailView, type DetailPayload } from './detail-view'
import { MemberHints } from './member-hints'

/** 详情容器入参。 */
export interface MessageDetailContainerProps {
  payload: DetailPayload | null
  failure: FailureLike | null
  loading: boolean
  /** 正文渲染插槽（`MOD-006` 的详情视图接入点；缺省给纯文本摘要）。 */
  renderBody?: (detail: MessageDetail) => ReactNode
  onRetryHints(): void
  onRetryAll(): void
  onBack(): void
}

function DefaultBody({ detail }: { detail: MessageDetail }) {
  return (
    <article className="shell-detail__body">
      <h3 className="shell-detail__headline">{detail.heading.headline}</h3>
      <p className="shell-detail__summary">{detail.body.aiSummary}</p>
      <ol className="shell-detail__messages">
        {detail.body.sourceMessages.map((message) => (
          <li key={message.messageId}>{message.text ?? '（图片或表情包消息）'}</li>
        ))}
      </ol>
    </article>
  )
}

/** 消息详情容器。 */
export function MessageDetailContainer({
  payload,
  failure,
  loading,
  renderBody,
  onRetryHints,
  onRetryAll,
  onBack,
}: MessageDetailContainerProps) {
  if (loading && !payload) return <p className="shell-detail__hint">正在读取消息详情…</p>
  if (!payload) {
    return (
      <section className="shell-detail">
        {failure ? <ErrorNotice failure={failure} onAction={onRetryAll} /> : null}
        <button type="button" className="shell-button" onClick={onBack}>
          返回上一视图
        </button>
      </section>
    )
  }
  const view = resolveDetailView(payload)
  return (
    <section className="shell-detail">
      {renderBody ? renderBody(view.body) : <DefaultBody detail={view.body} />}
      {failure && view.showHintRetry ? <ErrorNotice failure={failure} onAction={onRetryHints} compact /> : null}
      <MemberHints hints={view.hints} showRetry={view.showHintRetry && !failure} onRetry={onRetryHints} />
      <button type="button" className="shell-button" onClick={onBack}>
        返回上一视图
      </button>
    </section>
  )
}
