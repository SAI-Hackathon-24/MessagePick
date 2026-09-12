/**
 * 首屏引导（`AC-001` / `AC-030`；`TASK-008`、`TASK-010`）。
 *
 * 无数据时首屏只出现引导与「更新数据」入口：不出现空白分析视图、不出现 0 值占位统计，
 * 三个模块入口也指向本引导（`AC-001`）；引导内可直接看到「数据去向」说明（`AC-030`）。
 */

import { DataDirectionNotice } from './data-direction'
import type { UpdateEntryProps } from './update-entry'
import { UpdateEntry } from './update-entry'
import { TERMS } from '../terminology'

/** 首屏引导入参。 */
export interface OnboardingProps {
  /** 更新入口（引导页与主界面共用同一份数据来源入口）。 */
  update: UpdateEntryProps
  onOpenSettings(): void
}

/** 首屏引导。 */
export function Onboarding({ update, onOpenSettings }: OnboardingProps) {
  return (
    <section className="shell-onboarding">
      <h2 className="shell-onboarding__title">首次使用</h2>
      <p className="shell-onboarding__lead">
        本机还没有可用的聊天记录。完成一次数据更新后，{TERMS.moduleNames.meme}、{TERMS.moduleNames.extract} 与
        {TERMS.moduleNames.social} 会基于真实记录给出结果；在更新完成前不会展示任何分析视图。
      </p>
      <UpdateEntry {...update} />
      <DataDirectionNotice compact />
      <button type="button" className="shell-button shell-button--link" onClick={onOpenSettings}>
        打开{TERMS.actions.settings}
      </button>
    </section>
  )
}
