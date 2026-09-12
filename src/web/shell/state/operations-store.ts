/**
 * 操作快照 store（长任务进度的页面侧状态；mod-004 §5.1 / §4.8）。
 *
 * - 只承载外壳发起操作的快照与连接状态；快照来自事件流或 5 s 轮询（同一份数据）。
 * - 断连时保留最近快照（不清空），避免页面在重连窗口里闪烁为「无操作」。
 */

import type { OperationsConnection } from '../api/events'
import { createStore, type Store } from './store'
import type { ShellOperation } from './operations'

/** 操作 store 状态。 */
export interface OperationsState {
  operations: readonly ShellOperation[]
  connection: OperationsConnection
}

/** 操作 store。 */
export interface OperationsStore extends Store<OperationsState> {
  /** 整体替换快照（事件流与轮询共用）。 */
  applySnapshot(operations: readonly ShellOperation[]): void
  /** 更新连接状态（不动快照）。 */
  setConnection(connection: OperationsConnection): void
}

/** 创建操作 store。 */
export function createOperationsStore(): OperationsStore {
  const store = createStore<OperationsState>({ operations: [], connection: 'offline' })
  return {
    get: store.get,
    set: store.set,
    subscribe: store.subscribe,
    applySnapshot: (operations) => store.set((prev) => ({ ...prev, operations })),
    setConnection: (connection) => store.set((prev) => ({ ...prev, connection })),
  }
}
