/**
 * React 绑定（mod-004 §5.1）：把 `state/store.ts` 的可订阅容器接进组件树。
 *
 * `useSyncExternalStore` 的三个参数都传（含服务端快照），保证 React 19 下引用稳定、无额外渲染。
 */

import { useSyncExternalStore } from 'react'

import type { Store } from './store'

/** 订阅状态容器。 */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
