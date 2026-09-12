/**
 * 成员兴趣提示渲染（`REQ-070` / `AC-116`；mod-004 §3.1 的 `compose/MemberHints`）。
 *
 * - 只渲染服务端给的已确认数据（`API-029` 的结果）；无数据 = 不渲染。
 * - 降级（提示子调用失败 / 超时）→ 提示区给重试入口，正文由调用方照常渲染。
 */

import type { MemberHint } from '@shared'

/** 成员提示入参。 */
export interface MemberHintsProps {
  hints: readonly MemberHint[]
  /** 是否显示重试入口（`hintStatus='degraded'`）。 */
  showRetry: boolean
  onRetry(): void
}

/** 成员兴趣提示。 */
export function MemberHints({ hints, showRetry, onRetry }: MemberHintsProps) {
  if (hints.length === 0 && !showRetry) return null
  return (
    <aside className="shell-hints" data-degraded={showRetry ? 'true' : 'false'}>
      <h4 className="shell-hints__title">成员兴趣提示</h4>
      {hints.length === 0 ? (
        <p className="shell-hints__empty">暂无可展示的成员兴趣提示。</p>
      ) : (
        <ul className="shell-hints__list">
          {hints.map((hint) => (
            <li key={hint.memberId} className="shell-hints__item">
              <span className="shell-hints__member">{hint.memberId}</span>
              <span className="shell-hints__tags">
                {hint.tags.map((tag) => (
                  <span key={tag.tagId} className="shell-hints__tag">
                    {tag.name}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {showRetry ? (
        <button type="button" className="shell-button shell-button--link" onClick={onRetry}>
          重试兴趣提示
        </button>
      ) : null}
    </aside>
  )
}
