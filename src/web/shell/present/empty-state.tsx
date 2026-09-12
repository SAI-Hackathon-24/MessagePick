/**
 * 空态组件（`AC-001` / `AC-015`；mod-004 §6.1 的「空状态」两行）。
 *
 * - 尚无数据（`NO_DATA`）→ 引导完成首次更新（`AC-001`）。
 * - 筛选无结果（`EMPTY_RESULT`）→ 一键清除筛选，点击后恢复清除前的完整结果（`AC-015`）。
 * 空态不是错误：不弹失败提示、不给重试按钮。
 */

import type { ErrorCode } from '@shared'

import { emptyStateFor } from './error-presentation'

/** 空态组件入参。 */
export interface EmptyStateViewProps {
  code: Extract<ErrorCode, 'NO_DATA' | 'EMPTY_RESULT'>
  /** 动作回调：`update-data` → 触发更新；`clear-filter` → 一键清除筛选。 */
  onAction: (action: 'update-data' | 'clear-filter') => void
}

/** 空态视图。 */
export function EmptyStateView({ code, onAction }: EmptyStateViewProps) {
  const definition = emptyStateFor(code)
  if (!definition) return null
  return (
    <section className="shell-empty" data-empty-code={code}>
      <p className="shell-empty__title">{definition.title}</p>
      <p className="shell-empty__hint">{definition.hint}</p>
      <button
        type="button"
        className="shell-button"
        onClick={() => onAction(definition.action)}
        data-action={definition.action}
      >
        {definition.action === 'update-data' ? '更新数据' : '一键清除筛选'}
      </button>
    </section>
  )
}
