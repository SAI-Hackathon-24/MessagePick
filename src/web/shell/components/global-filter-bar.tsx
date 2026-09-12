/**
 * 全局筛选条（全应用唯一筛选控件；`REQ-004` / `REQ-049`、`AC-011` ~ `AC-016`）。
 *
 * - 四项：群多选（`API-004` 的群清单）、时间范围、关键词、身份（只读，取自当前用户）。
 * - 只做展示与事件上报；取值与归一化在 `state/filter-store.ts`，下发在 `api/filter-query.ts`。
 * - 各模块视图不得再出现同类控件（`AC-012` 的实现侧护栏在 `__tests__/module-boundaries.test.ts`）。
 */

import type { Group, Id, SharedFilter, TimeRange } from '@shared'

import { activeFilterCount, isEmptyFilter, timeRangeFromInputs, toDateInputValue } from '../api/filter-query'
import { TERMS } from '../terminology'

/** 群清单加载状态。 */
export type GroupsPhase = 'idle' | 'loading' | 'ready' | 'failed'

/** 筛选条入参。 */
export interface GlobalFilterBarProps {
  filter: SharedFilter
  groups: readonly Group[]
  groupsPhase: GroupsPhase
  onToggleGroup(id: Id): void
  onTimeRangeChange(range: TimeRange | null): void
  onKeywordChange(keyword: string): void
  onClear(): void
  onReloadGroups(): void
}

/** 全局筛选条。 */
export function GlobalFilterBar({
  filter,
  groups,
  groupsPhase,
  onToggleGroup,
  onTimeRangeChange,
  onKeywordChange,
  onClear,
  onReloadGroups,
}: GlobalFilterBarProps) {
  const selected = filter.groupIds ?? []
  const from = toDateInputValue(filter.timeRange?.from)
  const to = toDateInputValue(filter.timeRange?.to)
  const count = activeFilterCount(filter)
  const cleared = isEmptyFilter(filter)

  return (
    <section className="shell-filter" aria-label="全局筛选">
      <header className="shell-filter__head">
        <h2 className="shell-filter__title">筛选条件</h2>
        <p className="shell-filter__summary">
          {count === 0 ? '当前不限范围；该筛选条件作用于全部模块。' : `已应用 ${count} 项，作用于全部模块。`}
        </p>
      </header>

      <div className="shell-filter__field">
        <span className="shell-filter__label">群</span>
        {groupsPhase === 'loading' || groupsPhase === 'idle' ? (
          <p className="shell-filter__hint">正在读取群清单…</p>
        ) : null}
        {groupsPhase === 'failed' ? (
          <p className="shell-filter__hint">
            群清单读取失败。
            <button type="button" className="shell-button shell-button--link" onClick={onReloadGroups}>
              {TERMS.actions.retry}
            </button>
          </p>
        ) : null}
        {groupsPhase === 'ready' && groups.length === 0 ? <p className="shell-filter__hint">尚未采集到群。</p> : null}
        {groupsPhase === 'ready' && groups.length > 0 ? (
          <ul className="shell-filter__groups">
            {groups.map((group) => (
              <li key={group.groupId}>
                <label className="shell-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(group.groupId)}
                    onChange={() => onToggleGroup(group.groupId)}
                  />
                  <span>{group.groupName}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="shell-filter__field">
        <span className="shell-filter__label">时间范围</span>
        <div className="shell-filter__range">
          <input
            type="date"
            aria-label="时间范围开始"
            value={from}
            onChange={(event) => onTimeRangeChange(timeRangeFromInputs(event.target.value, to))}
          />
          <span className="shell-filter__sep">至</span>
          <input
            type="date"
            aria-label="时间范围结束"
            value={to}
            onChange={(event) => onTimeRangeChange(timeRangeFromInputs(from, event.target.value))}
          />
        </div>
      </div>

      <div className="shell-filter__field">
        <label className="shell-filter__label" htmlFor="shell-filter-keyword">
          关键词
        </label>
        <input
          id="shell-filter-keyword"
          type="search"
          value={filter.keyword ?? ''}
          placeholder="匹配对象随当前模块而定"
          onChange={(event) => onKeywordChange(event.target.value)}
        />
      </div>

      <div className="shell-filter__field">
        <span className="shell-filter__label">身份</span>
        <p className="shell-filter__hint">
          {filter.identity ? '「我」（自动取自当前用户）' : '尚未就绪（数据更新后自动识别）'}
        </p>
      </div>

      <button type="button" className="shell-button" onClick={onClear} disabled={cleared}>
        {TERMS.actions.clearFilter}
      </button>
    </section>
  )
}
