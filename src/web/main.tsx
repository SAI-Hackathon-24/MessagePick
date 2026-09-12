/**
 * 前端入口（Wave 0 脚手架占位）。
 *
 * 只负责挂载 React 根节点；真实的应用外壳（引导 / 主界面 / 路由 / 筛选条 / 进度）由 MOD-004
 * 在 `src/web/shell/` 落地后由本文件接线（设计：docs/design/impl/mod-004-app-shell.md §3.1）。
 *
 * 这里顺带从 `@shared` 引入一个常量，用于验证别名在 vite / tsc 两条链路上都可用。
 */

import { ENTITY_TYPES } from '@shared'
import { createRoot } from 'react-dom/client'

const container = document.getElementById('root')

if (!container) {
  throw new Error('未找到 #root 容器：请检查 src/web/index.html')
}

createRoot(container).render(
  <main>
    <h1>MessagePick</h1>
    <p>Wave 0 脚手架占位页面 —— 应用外壳与各模块视图由 MOD-004 ~ MOD-008 实现。</p>
    <p>共享契约已就绪：{ENTITY_TYPES.length} 个实体类型（DM-001 ~ DM-022）。</p>
  </main>,
)
