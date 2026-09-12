/**
 * 前端入口：挂载应用外壳（mod-004 §3.1）。
 *
 * 目录边界：
 * - `src/web/shell/`  应用外壳（骨架 / 筛选 / 状态 / 路由 / 异常呈现 / 进度），由 MOD-004 维护；
 * - `src/web/<模块>/` 各模块自己的视图，经 `src/web/shell/app/module-views.tsx` 的挂载点接入。
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ShellRoot } from './shell/app/root'
import './shell/styles.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('未找到 #root 容器：请检查 src/web/index.html')
}

createRoot(container).render(
  <StrictMode>
    <ShellRoot />
  </StrictMode>,
)
