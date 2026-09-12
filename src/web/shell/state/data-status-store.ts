/**
 * 数据状态 store（「是否有数据」「记录更新至 X」、来源状态、当前用户；mod-004 §5.1 / §5.4）。
 *
 * 口径：
 * - 每次 `API-002` 返回**整体替换**本 store 的状态；`X` 不由本地推算（`AC-003`）：
 *   更新完成只负责重新拉取 `API-002`，页面不拿「本次完成时间」自己推 X（`AC-004`）。
 * - `API-002` 失败 → `unavailable` 态（提示 + 重试），**不落到**引导态；`STORAGE_UNAVAILABLE`
 *   不得呈现为「无数据」（`AC-038`）。
 */

import type { Timestamp, UpdateStatus } from '@shared'

import type { ShellFailure } from '../api/envelope'
import { TERMS } from '../terminology'
import { createStore, type Store } from './store'

/** 数据状态阶段。 */
export type DataStatusPhase = 'bootstrapping' | 'ready' | 'unavailable'

/** 数据状态。 */
export interface DataStatusState {
  phase: DataStatusPhase
  status: UpdateStatus | null
  failure: ShellFailure | null
}

/** 首屏视图判定（`AC-001` / `AC-029` / `AC-038`）。 */
export type ShellView = 'loading' | 'onboarding' | 'main' | 'unavailable'

/** 状态 → 首屏视图（纯函数，`mod-004` §5.4）。 */
export function resolveShellView(state: DataStatusState): ShellView {
  if (state.phase === 'bootstrapping') return 'loading'
  if (state.phase === 'unavailable') return 'unavailable'
  if (!state.status) return 'loading'
  return state.status.hasData ? 'main' : 'onboarding'
}

/** 存储不可用（区别于「无数据」；顶栏 / 引导区据此提示而不是给空态）。 */
export function isStorageUnavailable(state: DataStatusState): boolean {
  return state.phase === 'unavailable' && state.failure?.envelope?.code === 'STORAGE_UNAVAILABLE'
}

/** 时间戳 → 本地中文可读格式（不引入英文月份 / 时区名）。 */
export function formatTimestamp(ts: Timestamp): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return TERMS.dataStatus.updatedNever
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

/** 「记录更新至 X」的取值文案；无值显示「尚未更新」，标签本身常驻不隐藏（`AC-002` / `AC-003`）。 */
export function updatedUntilText(x: Timestamp | null): string {
  return x === null || x === undefined ? TERMS.dataStatus.updatedNever : formatTimestamp(x)
}

/** 数据状态 store。 */
export interface DataStatusStore extends Store<DataStatusState> {
  /** `API-002` 成功 → 整体替换。 */
  apply(status: UpdateStatus): void
  /** `API-002` / 查询失败 → 不可用态（保留失败对象用于提示 + 重试）。 */
  fail(failure: ShellFailure): void
  /** 回到引导前的初始态（删除完成后重判走 `apply`，不直接用它代替刷新）。 */
  reset(): void
}

/** 创建数据状态 store。 */
export function createDataStatusStore(): DataStatusStore {
  const store = createStore<DataStatusState>({ phase: 'bootstrapping', status: null, failure: null })
  return {
    get: store.get,
    set: store.set,
    subscribe: store.subscribe,
    apply: (status) => store.set({ phase: 'ready', status, failure: null }),
    fail: (failure) => store.set({ phase: 'unavailable', status: null, failure }),
    reset: () => store.set({ phase: 'bootstrapping', status: null, failure: null }),
  }
}
