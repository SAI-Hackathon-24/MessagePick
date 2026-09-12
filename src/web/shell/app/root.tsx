/**
 * 应用外壳根组件（`TASK-008` ~ `TASK-011`；mod-004 §3.1 / §5）。
 *
 * 结构：顶栏（标题 + 「记录更新至 X」常驻）→ 模块导航 → 视图容器（引导 / 主界面 / 设置）。
 * 主界面：全局筛选条（唯一筛选控件）+ 模块视图挂载点 + 进度面板。
 * 所有取数与状态推进都经 `runtime`（`app/runtime.ts`），本文件只做组合与事件接线。
 */

import { useEffect, useState } from 'react'

import type { Api001Response, DeletionScope, IngestSource } from '@shared'

import { DataStatusHeader } from '../components/data-status-header'
import { GlobalFilterBar } from '../components/global-filter-bar'
import { Onboarding } from '../components/onboarding'
import { ProgressPanel } from '../components/progress-panel'
import { SettingsPage } from '../components/settings-page'
import { UpdateEntry, type UpdateEntryProps } from '../components/update-entry'
import type { FailureLike } from '../present/error-presentation'
import { ErrorNotice } from '../present/notice'
import { isStorageUnavailable, resolveShellView } from '../state/data-status-store'
import { deleteFlowReducer, deleteProgressNote, INITIAL_DELETE_FLOW, type DeleteFlowEvent } from '../state/delete-flow'
import { isIngestActive, operationSummary, updateBlockedReason } from '../state/operations'
import type { ShellOperation } from '../state/operations'
import type { SettingsPatch } from '../api/settings'
import { useStore } from '../state/use-store'
import { TERMS } from '../terminology'
import { MODULE_VIEW_SLOTS, ModuleOutlet } from './module-views'
import { DEFAULT_ROUTE, viewFor, type ShellRoute } from './route'
import { createShellRuntime, type ShellRuntimeOptions } from './runtime'

/** 根组件入参（测试 / 嵌入可注入取数与事件流实现）。 */
export type ShellRootProps = ShellRuntimeOptions

/** 应用外壳根组件。 */
export function ShellRoot(props: ShellRootProps = {}) {
  const [runtime] = useState(() => createShellRuntime(props))
  const filter = useStore(runtime.filter)
  const dataStatusState = useStore(runtime.dataStatus)
  const operationsState = useStore(runtime.operations)
  const sessionState = useStore(runtime.session)
  const groupsState = useStore(runtime.groups)
  const settingsState = useStore(runtime.settings)

  const [route, setRoute] = useState<ShellRoute>(DEFAULT_ROUTE)
  const [updateResult, setUpdateResult] = useState<Api001Response | null>(null)
  const [updateFailure, setUpdateFailure] = useState<FailureLike | null>(null)
  const [deleteState, setDeleteState] = useState(INITIAL_DELETE_FLOW)

  useEffect(() => {
    void runtime.loadStatus()
    void runtime.loadGroups()
    void runtime.loadSettings()
    runtime.start()
    return () => runtime.stop()
  }, [runtime])

  const operations = operationsState.operations
  const view = viewFor(route, resolveShellView(dataStatusState))
  const activeModuleId = route.kind === 'main' ? route.module : DEFAULT_ROUTE.module
  const activeSlot = MODULE_VIEW_SLOTS.find((slot) => slot.id === activeModuleId) ?? MODULE_VIEW_SLOTS[0]

  const triggerUpdate = (source: IngestSource | null): void => {
    setUpdateFailure(null)
    void runtime.triggerUpdate(source).then((result) => {
      if (result.ok) setUpdateResult(result.data)
      else setUpdateFailure(result.failure)
    })
  }

  const updateProps: UpdateEntryProps = {
    blockedReason: updateBlockedReason(operations, sessionState.readOnly, TERMS.dataStatus.readOnlyHint),
    running: isIngestActive(operations),
    result: updateResult,
    failure: updateFailure,
    onTrigger: triggerUpdate,
  }

  const handleDeleteEvent = (event: DeleteFlowEvent): void => {
    const current = deleteState
    setDeleteState((previous) => deleteFlowReducer(previous, event))

    if (event.type === 'preflightStart' && current.step === 'choose' && current.scope) {
      const scope = current.scope
      void runtime.runPreflight(scope).then((result) => {
        setDeleteState((previous) =>
          result.ok
            ? deleteFlowReducer(previous, { type: 'preflightDone', preflight: result.data })
            : deleteFlowReducer(previous, { type: 'preflightFailed', failure: result.failure }),
        )
      })
    }

    if (event.type === 'confirm' && current.step === 'confirm') {
      const scope: DeletionScope = current.scope
      void runtime.runDeletion(scope).then((result) => {
        if (result.ok) {
          setDeleteState((previous) => deleteFlowReducer(previous, { type: 'executeDone', result: result.data }))
          setUpdateResult(null)
          return
        }
        if (result.failure.envelope?.code === 'DELETION_INTERRUPTED') {
          setDeleteState((previous) =>
            deleteFlowReducer(previous, {
              type: 'executeInterrupted',
              result: null,
              failure: result.failure.envelope ?? undefined,
            }),
          )
          return
        }
        setDeleteState((previous) => deleteFlowReducer(previous, { type: 'executeFailed', failure: result.failure }))
      })
    }
  }

  const handleRetryOperation = (operation: ShellOperation): void => {
    // 目前只有数据更新有「同参数重试」的公开入口；其余类别的重试入口待服务端路由补齐。
    if (operation.kind === 'ingest') triggerUpdate(null)
  }

  const handleSaveSettings = (patch: SettingsPatch): void => {
    void runtime.saveSettings(patch)
  }

  const nav =
    view === 'main' || view === 'onboarding' ? (
      <nav className="shell-nav" aria-label="模块导航">
        {MODULE_VIEW_SLOTS.map((slot) => (
          <button
            key={slot.id}
            type="button"
            className="shell-nav__item"
            aria-current={view === 'main' && route.kind === 'main' && route.module === slot.id ? 'page' : undefined}
            onClick={() => setRoute({ kind: 'main', module: slot.id })}
          >
            {slot.name}
          </button>
        ))}
        <button
          type="button"
          className="shell-nav__item"
          aria-current={route.kind === 'settings' ? 'page' : undefined}
          onClick={() => setRoute({ kind: 'settings' })}
        >
          {TERMS.actions.settings}
        </button>
      </nav>
    ) : null

  return (
    <div className="shell-root">
      <DataStatusHeader
        view={view}
        status={dataStatusState.status}
        readOnly={sessionState.readOnly}
        storageUnavailable={isStorageUnavailable(dataStatusState)}
        counts={operationSummary(operations)}
        connection={operationsState.connection}
      />

      {nav}

      {view === 'loading' ? <p className="shell-loading">正在读取本机数据状态…</p> : null}

      {view === 'unavailable' ? (
        <section className="shell-unavailable">
          <ErrorNotice
            failure={dataStatusState.failure ?? { envelope: null, requestId: null }}
            onAction={() => {
              void runtime.loadStatus()
            }}
          />
          <button type="button" className="shell-button" onClick={() => setRoute({ kind: 'settings' })}>
            {TERMS.actions.settings}
          </button>
        </section>
      ) : null}

      {view === 'onboarding' ? (
        <Onboarding update={updateProps} onOpenSettings={() => setRoute({ kind: 'settings' })} />
      ) : null}

      {view === 'main' ? (
        <div className="shell-layout">
          <GlobalFilterBar
            filter={filter}
            groups={groupsState.groups}
            groupsPhase={groupsState.phase}
            onToggleGroup={(id) => runtime.filter.toggleGroup(id)}
            onTimeRangeChange={(range) => runtime.filter.setTimeRange(range)}
            onKeywordChange={(keyword) => runtime.filter.setKeyword(keyword)}
            onClear={() => runtime.filter.clear()}
            onReloadGroups={() => {
              void runtime.loadGroups()
            }}
          />
          <main className="shell-content" aria-label="模块视图">
            <UpdateEntry {...updateProps} />
            <ModuleOutlet
              slot={activeSlot}
              filter={filter}
              readOnly={sessionState.readOnly}
              onClearFilter={() => runtime.filter.clear()}
            />
          </main>
          <aside className="shell-sidebar" aria-label="进度">
            <ProgressPanel
              operations={operations}
              connection={operationsState.connection}
              onRetry={handleRetryOperation}
            />
          </aside>
        </div>
      ) : null}

      {view === 'settings' ? (
        <SettingsPage
          status={dataStatusState.status}
          readOnly={sessionState.readOnly}
          update={updateProps}
          deleteState={deleteState}
          deleteNote={deleteProgressNote(deleteState, operations)}
          onDeleteEvent={handleDeleteEvent}
          groups={groupsState.groups}
          groupsPhase={groupsState.phase}
          onReloadGroups={() => {
            void runtime.loadGroups()
          }}
          operations={operations}
          connection={operationsState.connection}
          onRetryOperation={handleRetryOperation}
          settings={settingsState.settings}
          settingsPhase={settingsState.phase}
          settingsFailure={settingsState.failure}
          onReloadSettings={() => {
            void runtime.loadSettings()
          }}
          onSaveSettings={handleSaveSettings}
          onBack={() => setRoute(DEFAULT_ROUTE)}
        />
      ) : null}
    </div>
  )
}
