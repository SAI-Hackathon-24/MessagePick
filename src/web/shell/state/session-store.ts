/**
 * 会话内瞬态状态（mod-004 §5.1：全部运行期，不持久化）。
 *
 * - 启动令牌只在内存（见 `api/token.ts`，本 store 只记「是否只读」）。
 * - 生成面板上下文（梗标识、解读、变体、精华图片引用）来自 `API-010` 结果，
 *   打开面板时写入、关闭即丢，不落库、不缓存、不改写（§4.7 / 决策 6）。
 */

import type { MemeGenerationContext } from '@shared'

import { createStore, type Store } from './store'

/** 会话状态。 */
export interface SessionState {
  /** 只读模式（缺 / 失效启动令牌；写操作置灰并提示重新打开页面）。 */
  readOnly: boolean
  /** 生成面板上下文（瞬态）。 */
  generationContext: MemeGenerationContext | null
}

/** 会话 store。 */
export interface SessionStore extends Store<SessionState> {
  setReadOnly(readOnly: boolean): void
  /** 打开生成面板：写入上下文（不复制数据、只持有引用）。 */
  openGenerationPanel(context: MemeGenerationContext): void
  /** 关闭生成面板：上下文丢弃。 */
  closeGenerationPanel(): void
}

/** 创建会话 store。 */
export function createSessionStore(readOnly = false): SessionStore {
  const store = createStore<SessionState>({ readOnly, generationContext: null })
  return {
    get: store.get,
    set: store.set,
    subscribe: store.subscribe,
    setReadOnly: (value) => store.set((prev) => (prev.readOnly === value ? prev : { ...prev, readOnly: value })),
    openGenerationPanel: (context) => store.set((prev) => ({ ...prev, generationContext: context })),
    closeGenerationPanel: () =>
      store.set((prev) => (prev.generationContext === null ? prev : { ...prev, generationContext: null })),
  }
}
