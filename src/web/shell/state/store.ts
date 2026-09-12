/**
 * 最小可订阅状态容器（页面侧四个 store 的共同实现；mod-004 §5.1）。
 *
 * - 无框架依赖：纯逻辑可在 Node 环境直接单测（§7 的口径）。
 * - React 侧经 `state/use-store.ts` 的 `useStore` 绑定（`useSyncExternalStore`）。
 */

/** 可订阅状态容器。 */
export interface Store<T> {
  /** 读取当前值（必须与 `subscribe` 的调用时机配合，保持引用稳定）。 */
  get(): T
  /** 整体或按函数替换当前值。 */
  set(next: T | ((prev: T) => T)): void
  /** 订阅变化（返回值用于取消订阅）。 */
  subscribe(listener: () => void): () => void
}

/** 创建状态容器。 */
export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(value) : next
      if (Object.is(resolved, value)) return
      value = resolved
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
