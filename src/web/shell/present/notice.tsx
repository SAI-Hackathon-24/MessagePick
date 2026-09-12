/**
 * 统一异常呈现组件（`TASK-038`、`AC-035`；mod-004 §6.1）。
 *
 * 纯展示：只接收失败对象与动作回调，不取数、不读外壳状态（决策 7 的组件约束）。
 * 错误标识只作 `data-code` 属性与日志检索用，可见文案只有中文（`REQ-017` 的 `AC-039` 裁定）。
 */

import type { ResolvedFailure } from './error-presentation'
import { resolveFailure, type FailureLike, type PresentationAction } from './error-presentation'
import { TERMS } from '../terminology'

/** 动作 → 按钮文案（`null` = 该动作没有按钮，属解释性提示）。 */
export const ACTION_LABELS: Record<PresentationAction, string | null> = {
  retry: TERMS.actions.retry,
  'retry-source': '重试失败来源',
  'clear-filter': TERMS.actions.clearFilter,
  'update-data': TERMS.actions.updateData,
  back: TERMS.actions.backToMain,
  'fix-input': null,
  confirm: '返回二次确认',
  'confirm-material': '确认素材',
  resume: '继续删除剩余数据',
  refresh: '刷新',
  none: null,
}

/** 异常提示组件入参。 */
export interface ErrorNoticeProps {
  failure: FailureLike
  /** 动作回调（按钮文案由 `ACTION_LABELS` 决定）。 */
  onAction?: (action: PresentationAction) => void
  /** 紧凑模式（用于视图内嵌提示）。 */
  compact?: boolean
}

/** 统一异常提示（失败 / 超时 / 无授权 / 前置条件共用一套结构）。 */
export function ErrorNotice({ failure, onAction, compact = false }: ErrorNoticeProps) {
  const resolved: ResolvedFailure = resolveFailure(failure)
  const { presentation, reason, hint, requestId, code } = resolved
  const label = ACTION_LABELS[presentation.action]
  return (
    <section
      className={compact ? 'shell-notice shell-notice--compact' : 'shell-notice'}
      data-kind={presentation.kind}
      data-code={code ?? 'unknown'}
      role="alert"
    >
      <p className="shell-notice__title">{presentation.title}</p>
      <p className="shell-notice__reason">{reason}</p>
      {hint ? <p className="shell-notice__hint">{hint}</p> : null}
      {requestId ? <p className="shell-notice__meta">请求标识：{requestId}</p> : null}
      {label && onAction ? (
        <button type="button" className="shell-button" onClick={() => onAction(presentation.action)}>
          {label}
        </button>
      ) : null}
    </section>
  )
}
