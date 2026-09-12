/**
 * 全局筛选状态（全应用唯一筛选源；mod-004 §5.1 / 决策 2、`AC-011` ~ `AC-016`）。
 *
 * - 组件的取值 / 变更都经这一个 store；切模块不重置、不丢失（`AC-011`）。
 * - 「身份」为只读项：由数据状态刷新（`API-002` 的当前用户）写入，不提供手工设置（`AC-016`）。
 * - 每次写入都归一化（去空白 / 去重 / 空项省略），保证「空 = 不限」在请求层一致（`AC-014`）。
 */

import type { Id, SharedFilter, TimeRange } from '@shared'

import { normalizeFilter } from '../api/filter-query'
import { createStore, type Store } from './store'

/** 全局筛选 store。 */
export interface FilterStore extends Store<SharedFilter> {
  /** 整体替换群多选（空数组 = 不限）。 */
  setGroups(ids: readonly Id[]): void
  /** 勾选 / 取消一个群。 */
  toggleGroup(id: Id): void
  /** 设置时间范围（`null` = 不限）。 */
  setTimeRange(range: TimeRange | null): void
  /** 设置关键词（空串 = 不限）。 */
  setKeyword(keyword: string): void
  /** 更新只读身份项（由 `API-002` 的当前用户驱动）。 */
  setIdentity(identity: Id | null): void
  /** 一键清除筛选（空态动作；清除后即恢复不限范围的完整结果，`AC-015`）。 */
  clear(): void
}

/** 创建全局筛选 store。 */
export function createFilterStore(initial: SharedFilter = {}): FilterStore {
  const store = createStore<SharedFilter>(normalizeFilter(initial))
  const update = (patch: SharedFilter): void => {
    store.set(normalizeFilter({ ...store.get(), ...patch }))
  }
  return {
    get: store.get,
    set: store.set,
    subscribe: store.subscribe,
    setGroups: (ids) => update({ groupIds: [...ids] }),
    toggleGroup: (id) => {
      const current = store.get().groupIds ?? []
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
      update({ groupIds: next })
    },
    setTimeRange: (range) => update({ timeRange: range }),
    setKeyword: (keyword) => update({ keyword }),
    setIdentity: (identity) => update({ identity }),
    clear: () => {
      // 身份是只读项（来自当前用户），不随「一键清除筛选」被清掉。
      update({ groupIds: [], timeRange: null, keyword: '' })
    },
  }
}
