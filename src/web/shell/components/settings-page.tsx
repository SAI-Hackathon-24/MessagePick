/**
 * 设置页（`TASK-010` / `TASK-011`；`AC-025` ~ `AC-030`）。
 *
 * 内容分区：数据去向说明、更新来源状态与更新入口、进行中的操作、删除交互、设置项。
 * 只做组合与展示，取数与状态推进由使用方（`app/root.tsx`）注入。
 */

import type { Group, UpdateStatus } from '@shared'

import type { ClientSettings, SettingsPatch } from '../api/settings'
import type { OperationsConnection } from '../api/events'
import type { FailureLike } from '../present/error-presentation'
import { updatedUntilText } from '../state/data-status-store'
import type { DeleteFlowEvent, DeleteFlowState } from '../state/delete-flow'
import type { ShellOperation } from '../state/operations'
import { TERMS } from '../terminology'
import { DataDirectionNotice } from './data-direction'
import { DeleteFlow } from './delete-flow'
import type { GroupsPhase } from './global-filter-bar'
import { ProgressPanel } from './progress-panel'
import { SettingsForm } from './settings-form'
import { UpdateEntry, type UpdateEntryProps } from './update-entry'

/** 设置页入参。 */
export interface SettingsPageProps {
  status: UpdateStatus | null
  readOnly: boolean
  update: UpdateEntryProps
  deleteState: DeleteFlowState
  deleteNote: string | null
  onDeleteEvent(event: DeleteFlowEvent): void
  groups: readonly Group[]
  groupsPhase: GroupsPhase
  onReloadGroups(): void
  operations: readonly ShellOperation[]
  connection: OperationsConnection
  onRetryOperation(operation: ShellOperation): void
  settings: ClientSettings | null
  settingsPhase: 'idle' | 'loading' | 'ready' | 'failed'
  settingsFailure: FailureLike | null
  onReloadSettings(): void
  onSaveSettings(patch: SettingsPatch): void
  onBack(): void
}

/** 设置页。 */
export function SettingsPage(props: SettingsPageProps) {
  return (
    <section className="shell-settings">
      <header className="shell-settings__head">
        <h2 className="shell-settings__title">{TERMS.actions.settings}</h2>
        <button type="button" className="shell-button" onClick={props.onBack}>
          {TERMS.actions.backToMain}
        </button>
      </header>

      <section className="shell-settings__section">
        <h3>数据更新</h3>
        <p className="shell-settings__hint">
          {TERMS.dataStatus.updatedUntilLabel} {updatedUntilText(props.status?.updatedUntilX ?? null)}
        </p>
        <UpdateEntry {...props.update} />
      </section>

      <section className="shell-settings__section">
        <DataDirectionNotice />
      </section>

      <section className="shell-settings__section">
        <ProgressPanel
          operations={props.operations}
          connection={props.connection}
          onRetry={props.onRetryOperation}
        />
      </section>

      <section className="shell-settings__section">
        <DeleteFlow
          state={props.deleteState}
          groups={props.groups}
          groupsPhase={props.groupsPhase}
          note={props.deleteNote}
          onEvent={props.onDeleteEvent}
          onReloadGroups={props.onReloadGroups}
        />
      </section>

      <section className="shell-settings__section">
        <h3>设置项</h3>
        <SettingsForm
          settings={props.settings}
          phase={props.settingsPhase}
          failure={props.settingsFailure}
          readOnly={props.readOnly}
          onReload={props.onReloadSettings}
          onSave={props.onSaveSettings}
        />
      </section>
    </section>
  )
}
