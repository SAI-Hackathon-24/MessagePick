/**
 * 模块视图挂载点（`AC-040`；mod-004 §3.1 的「模块视图懒加载 + 错误边界」）。
 *
 * - 四个模块视图（梗分析 / 信息提取 / 社交画像 / 再创作生成）各自一个 slot：
 *   `load()` 是唯一的接入点——模块视图落地后把 `load` 换成动态导入即可，本文件其余部分不动。
 * - 外壳不依赖任何模块的具体实现：slot 的组件接口只有筛选条件、只读标记与清除筛选回调
 *   （`REQ-004` 的「唯一筛选入参」由此传递）。
 * - 懒加载 + `Suspense` + 每槽独立错误边界：单个模块失败不影响其余（`AC-040`）。
 */

import { lazy, Suspense, useMemo, type ComponentType } from 'react'

import type { SharedFilter } from '@shared'

import { activeFilterCount } from '../api/filter-query'
import { TERMS } from '../terminology'
import { ModuleErrorBoundary } from './error-boundary'

/** 模块标识（与四个模块视图一一对应）。 */
export const MODULE_IDS = ['meme', 'extract', 'social', 'regen'] as const
/** 模块标识类型。 */
export type ModuleId = (typeof MODULE_IDS)[number]

/** 模块视图的统一接口（外壳注入的唯一入参是全局筛选条件）。 */
export interface ModuleViewProps {
  filter: SharedFilter
  readOnly: boolean
  onClearFilter(): void
}

/** 模块视图挂载点。 */
export interface ModuleViewSlot {
  id: ModuleId
  /** 入口名（模块一 ~ 三、再创作生成） */
  name: string
  summary: string
  load(): Promise<{ default: ComponentType<ModuleViewProps> }>
}

/** 模块简述（占位视图使用）。 */
export const MODULE_SUMMARIES: Record<ModuleId, string> = {
  meme: '梗词云、梗单元与梗生命周期。',
  extract: '消息归档、通知总览、待办与消息详情。',
  social: '人物画像、兴趣检索与契合度。',
  regen: '表情包、文字变体与新梗候选的创作。',
}

/** 模块视图未接入时的占位（显示该模块名与当前生效的筛选项数）。 */
export function ModulePlaceholder({ slot, filter }: { slot: ModuleViewSlot; filter: SharedFilter }) {
  const count = activeFilterCount(filter)
  return (
    <section className="shell-module-placeholder" data-module={slot.id}>
      <h2 className="shell-module-placeholder__title">{slot.name}</h2>
      <p className="shell-module-placeholder__summary">{slot.summary}</p>
      <p className="shell-module-placeholder__hint">该模块的视图尚未接入，接入后此处显示模块内容。</p>
      <p className="shell-module-placeholder__filter">
        {count === 0 ? '当前筛选条件：不限。' : `当前筛选条件：已应用 ${count} 项，随本视图一同下发。`}
      </p>
    </section>
  )
}

/** 生成占位组件（绑定到具体 slot）。 */
function createPlaceholderView(slot: ModuleViewSlot): ComponentType<ModuleViewProps> {
  return function PlaceholderView(props: ModuleViewProps) {
    return ModulePlaceholder({ slot, filter: props.filter })
  }
}

/** 创建四个挂载点（顺序 = 导航顺序）。 */
export function createModuleSlots(): readonly ModuleViewSlot[] {
  return MODULE_IDS.map((id) => {
    const slot: ModuleViewSlot = {
      id,
      name: TERMS.moduleNames[id],
      summary: MODULE_SUMMARIES[id],
      // 接入点：模块视图落地后改为动态导入，例如
      //   load: () => import('@web/meme/view')
      // 本行是外壳与模块视图之间的唯一耦合点。
      load: async () => ({ default: createPlaceholderView(slot) }),
    }
    return slot
  })
}

/** 默认挂载点集合（应用根使用；测试可用 `createModuleSlots()` 另起一份）。 */
export const MODULE_VIEW_SLOTS: readonly ModuleViewSlot[] = createModuleSlots()

/** 单个模块区域（懒加载 + 独立错误边界）。 */
export function ModuleOutlet({
  slot,
  filter,
  readOnly,
  onClearFilter,
}: {
  slot: ModuleViewSlot
  filter: SharedFilter
  readOnly: boolean
  onClearFilter(): void
}) {
  const View = useMemo(() => lazy(slot.load), [slot])
  return (
    <ModuleErrorBoundary moduleName={slot.name}>
      <Suspense fallback={<p className="shell-module-loading">正在载入{slot.name}…</p>}>
        <View filter={filter} readOnly={readOnly} onClearFilter={onClearFilter} />
      </Suspense>
    </ModuleErrorBoundary>
  )
}
