/**
 * 页面路由（引导 / 主界面 / 设置；mod-004 §5.4、`AC-001` / `AC-029` / `AC-030`）。
 *
 * - 路由是页面内的轻量状态（无对外 URL 通道，筛选值不落地址栏）。
 * - 模块入口在无数据 / 不可用时不进入视图：模块路由落回引导（`AC-001` ③）；
 *   设置页在任意状态下可达（首次使用流程能看到「数据去向」，`AC-030`）。
 */

import type { ModuleId } from './module-views'

/** 页面路由。 */
export type ShellRoute = { kind: 'main'; module: ModuleId } | { kind: 'settings' }

/** 数据状态推出的首屏视图。 */
export type ShellViewName = 'loading' | 'unavailable' | 'onboarding' | 'main' | 'settings'

/** 默认路由：主界面的梗分析。 */
export const DEFAULT_ROUTE: Extract<ShellRoute, { kind: 'main' }> = { kind: 'main', module: 'meme' }

/** 路由 + 数据状态 → 实际渲染的视图。 */
export function viewFor(route: ShellRoute, dataView: 'loading' | 'unavailable' | 'onboarding' | 'main'): ShellViewName {
  if (dataView === 'loading' || dataView === 'unavailable') return dataView
  if (route.kind === 'settings') return 'settings'
  if (dataView === 'onboarding') return 'onboarding'
  return 'main'
}

/** 该视图下是否允许写操作（引导 / 设置都可写；加载与不可用不可写）。 */
export function allowsWrite(view: ShellViewName): boolean {
  return view === 'main' || view === 'onboarding' || view === 'settings'
}
