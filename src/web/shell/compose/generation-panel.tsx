/**
 * 生成面板容器（`TASK-037`；mod-004 §4.7、决策 6 / 决策 8）。
 *
 * - 四个入口：表情包（G1）/ 文字变体（G2）/ 新梗候选（G3）/ 生成历史。
 * - 上下文转交：从当前梗单元的 `API-010` 结果组装 `MemeGenerationContext`，会话内瞬态、
 *   不落库、不缓存；面板关闭即丢（刷新页面后重开梗单元即可）。
 * - G3 的「近期消息范围」= 全局筛选的时间范围；为空时取默认窗口（近 30 天），**不新增第二组时间控件**。
 * - 实际生成逻辑属 `MOD-008`：本容器只提供挂载点（`renderEntry`），模块视图接入后填充。
 */

import type { ReactNode } from 'react'

import { DEFAULT_RECENT_WINDOW_DAYS, type MemeGenerationContext, type SharedFilter, type TimeRange } from '@shared'

import { toDateInputValue } from '../api/filter-query'
import { TERMS } from '../terminology'

/** 默认窗口毫秒数（近 30 天；常量取自共享层）。 */
export const DEFAULT_RECENT_WINDOW_MS = DEFAULT_RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** 生成入口标识。 */
export type GenerationEntryId = 'g1' | 'g2' | 'g3' | 'history'

/** 四个入口（文案不使用内部编号）。 */
export const GENERATION_ENTRIES: readonly { id: GenerationEntryId; label: string }[] = [
  { id: 'g1', label: '表情包' },
  { id: 'g2', label: '文字变体' },
  { id: 'g3', label: '新梗候选' },
  { id: 'history', label: '生成历史' },
]

/** G3 的「近期消息范围」：优先全局筛选的时间范围，为空取近 30 天默认窗口（决策 8）。 */
export function resolveRecentRange(filter: SharedFilter | null | undefined, now: number): TimeRange {
  const range = filter?.timeRange
  if (range) return range
  return { from: now - DEFAULT_RECENT_WINDOW_MS, to: now }
}

/** 生成面板入参。 */
export interface GenerationPanelContainerProps {
  context: MemeGenerationContext | null
  filter: SharedFilter
  /** 当前时间（用于默认窗口；由调用方给出，便于测试）。 */
  now: number
  readOnly: boolean
  /** 入口内容插槽（`MOD-008` 的接入点）；缺省显示占位说明。 */
  renderEntry?: (entry: GenerationEntryId, context: MemeGenerationContext | null) => ReactNode
  onClose(): void
}

/** 生成面板容器。 */
export function GenerationPanelContainer({
  context,
  filter,
  now,
  readOnly,
  renderEntry,
  onClose,
}: GenerationPanelContainerProps) {
  const recentRange = resolveRecentRange(filter, now)
  const rangeLabel = `${toDateInputValue(recentRange.from)} 起`
  return (
    <section className="shell-generation" data-has-context={context ? 'true' : 'false'}>
      <header className="shell-generation__head">
        <h3 className="shell-generation__title">生成</h3>
        <span className="shell-generation__mark">{TERMS.creationMark}</span>
        <button type="button" className="shell-button" onClick={onClose}>
          关闭
        </button>
      </header>
      {context ? (
        <p className="shell-generation__context">
          当前梗：{context.interpretation || context.memeId}；变体 {context.variantMemeIds.length} 个；精华图片{' '}
          {context.highlightMediaRefs.length} 张。
        </p>
      ) : (
        <p className="shell-generation__context">尚未选择梗单元；请先在梗分析中打开一个梗。</p>
      )}
      <p className="shell-generation__range">近期消息范围复用全局筛选的时间范围，当前为：{rangeLabel}</p>
      {readOnly ? (
        <p className="shell-generation__hint">
          {TERMS.dataStatus.readOnly}：{TERMS.dataStatus.readOnlyHint}
        </p>
      ) : null}
      <div className="shell-generation__entries">
        {GENERATION_ENTRIES.map((entry) => (
          <section key={entry.id} className="shell-generation__entry" data-entry={entry.id}>
            <h4>{entry.label}</h4>
            {renderEntry ? renderEntry(entry.id, context) : <p className="shell-generation__hint">等待接入。</p>}
          </section>
        ))}
      </div>
      <p className="shell-generation__hint">
        产出均带「{TERMS.creationMark}」标注，可复制或下载；生成结果不会自动发布到任何地方。
      </p>
    </section>
  )
}
