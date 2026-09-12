/**
 * 外壳运行期装配（浏览器侧组合根；mod-004 §3.1 / §4）。
 *
 * 把 store、取数客户端与进度通道装在一起，并向 `app/root.tsx` 暴露动作：
 * 读状态、读群清单、读 / 写设置、触发更新、删除预检与执行、启动 / 停止进度通道。
 *
 * - 令牌：启动时从 URL fragment 读取（内存持有）；无令牌 → 只读模式，写入口由界面置灰。
 * - 缓存失效：群清单按 `dataEpoch` 失效（代际前进即清空并重取）。
 * - 更新完成：进度快照里数据更新操作从在途变为结束 → 重新拉取 `API-002`（`AC-002` / `AC-004`）。
 */

import type {
  Api001Response,
  DeletionResult,
  DeletionScope,
  Group,
  IngestSource,
  PreflightResult,
  ReadResult,
  UpdateStatus,
} from '@shared'

import { createApiClient, type ApiClient } from '../api/client'
import type { ApiResult, ShellFailure } from '../api/envelope'
import { isGuardRejection } from '../api/envelope'
import { ENDPOINTS } from '../api/endpoints'
import { createEpochGate } from '../api/epoch'
import {
  createEventSourceTransport,
  createOperationsChannel,
  type EventSourceLike,
  type OperationsChannel,
} from '../api/events'
import type { ClientSettings, SettingsPatch } from '../api/settings'
import { coerceSettings } from '../api/settings'
import { createLaunchToken, hashWithoutToken, parseLaunchToken, type LaunchToken } from '../api/token'
import { createDataStatusStore, type DataStatusStore } from '../state/data-status-store'
import { createFilterStore, type FilterStore } from '../state/filter-store'
import { isIngestActive, parseOperationsPayload, type ShellOperation } from '../state/operations'
import { createOperationsStore, type OperationsStore } from '../state/operations-store'
import { createSessionStore, type SessionStore } from '../state/session-store'
import { createStore, type Store } from '../state/store'
import { retryRequest } from '../state/update-flow'

/** 群清单状态。 */
export interface GroupsState {
  phase: 'idle' | 'loading' | 'ready' | 'failed'
  groups: readonly Group[]
  failure: ShellFailure | null
}

/** 设置状态。 */
export interface SettingsState {
  phase: 'idle' | 'loading' | 'ready' | 'failed'
  settings: ClientSettings | null
  failure: ShellFailure | null
}

/** 运行期（页面上下文）。 */
export interface ShellRuntime {
  filter: FilterStore
  dataStatus: DataStatusStore
  operations: OperationsStore
  session: SessionStore
  groups: Store<GroupsState>
  settings: Store<SettingsState>
  client: ApiClient
  /** 拉取 `API-002`（首屏、更新完成后、删除完成后）。 */
  loadStatus(): Promise<void>
  /** 拉取群清单（`API-004` 的群读；带内存缓存，按代际失效）。 */
  loadGroups(): Promise<void>
  /** 拉取设置。 */
  loadSettings(): Promise<void>
  /** 保存设置（写操作，带令牌）。 */
  saveSettings(patch: SettingsPatch): Promise<ApiResult<unknown>>
  /** 触发更新 / 分来源重试（写操作）。 */
  triggerUpdate(source: IngestSource | null): Promise<ApiResult<Api001Response>>
  /** 删除预检（写操作）。 */
  runPreflight(scope: DeletionScope): Promise<ApiResult<PreflightResult>>
  /** 执行删除（写操作；二次确认由调用方保证）。 */
  runDeletion(scope: DeletionScope): Promise<ApiResult<DeletionResult>>
  /** 启动进度通道（事件流 + 轮询降级）。 */
  start(): void
  /** 停止进度通道（页面关闭即停）。 */
  stop(): void
}

/** 装配选项（测试可注入假取数 / 假事件流 / 假地址栏）。 */
export interface ShellRuntimeOptions {
  fetch?: typeof fetch
  eventSource?: (url: string) => EventSourceLike
  /** 地址栏（读取启动令牌；默认取全局 `window`）。 */
  location?: { hash: string; pathname?: string; search?: string }
  /** 历史记录（脱敏地址栏；默认取全局 `window.history`）。 */
  history?: { replaceState(data: unknown, unused: string, url?: string): void }
}

/** 创建运行期。 */
export function createShellRuntime(options: ShellRuntimeOptions = {}): ShellRuntime {
  const location = options.location ?? (typeof window === 'undefined' ? undefined : window.location)
  const history = options.history ?? (typeof window === 'undefined' ? undefined : window.history)
  const token: LaunchToken = createLaunchToken(location ? parseLaunchToken(location.hash) : null)
  if (location && history && token.get()) {
    // 地址栏脱敏：令牌只留在内存（避免出现在可见地址与截图中）。
    const cleaned = hashWithoutToken(location.hash)
    history.replaceState(null, '', `${location.pathname ?? ''}${location.search ?? ''}${cleaned}`)
  }

  const epochGate = createEpochGate()
  const client = createApiClient({ fetch: options.fetch, token, epoch: epochGate })
  const filter = createFilterStore()
  const dataStatus = createDataStatusStore()
  const operations = createOperationsStore()
  const session = createSessionStore(token.get() === null)
  const groups = createStore<GroupsState>({ phase: 'idle', groups: [], failure: null })
  const settings = createStore<SettingsState>({ phase: 'idle', settings: null, failure: null })

  function markGuardFailure(failure: ShellFailure): void {
    if (isGuardRejection(failure)) session.setReadOnly(true)
  }

  async function loadStatus(): Promise<void> {
    const result = await client.get<UpdateStatus>(ENDPOINTS.updateStatus)
    if (result.ok) {
      dataStatus.apply(result.data)
      filter.setIdentity(result.data.meMemberId)
    } else {
      dataStatus.fail(result.failure)
      markGuardFailure(result.failure)
    }
  }

  async function loadGroups(): Promise<void> {
    groups.set((prev) => ({ phase: 'loading', groups: prev.groups, failure: null }))
    const result = await client.get<ReadResult<'DM-002'>>(ENDPOINTS.filterGroups)
    if (!result.ok) {
      groups.set((prev) => ({ phase: 'failed', groups: prev.groups, failure: result.failure }))
      return
    }
    groups.set({ phase: 'ready', groups: result.data.records ?? [], failure: null })
  }

  async function loadSettings(): Promise<void> {
    settings.set((prev) => ({ phase: 'loading', settings: prev.settings, failure: null }))
    const result = await client.get<unknown>(ENDPOINTS.settings)
    if (!result.ok) {
      settings.set((prev) => ({ phase: 'failed', settings: prev.settings, failure: result.failure }))
      return
    }
    settings.set({ phase: 'ready', settings: coerceSettings(result.data), failure: null })
  }

  async function saveSettings(patch: SettingsPatch): Promise<ApiResult<unknown>> {
    const result = await client.put<unknown>(ENDPOINTS.settings, patch)
    if (!result.ok) markGuardFailure(result.failure)
    else await loadSettings()
    return result
  }

  async function triggerUpdate(source: IngestSource | null): Promise<ApiResult<Api001Response>> {
    const result = await client.post<Api001Response>(ENDPOINTS.update, retryRequest(source))
    if (!result.ok) markGuardFailure(result.failure)
    else await loadStatus()
    return result
  }

  async function runPreflight(scope: DeletionScope): Promise<ApiResult<PreflightResult>> {
    const result = await client.post<PreflightResult>(ENDPOINTS.deletionPreflight, { scope })
    if (!result.ok) markGuardFailure(result.failure)
    return result
  }

  async function runDeletion(scope: DeletionScope): Promise<ApiResult<DeletionResult>> {
    const result = await client.post<DeletionResult>(ENDPOINTS.deletions, { scope, confirmed: true })
    if (!result.ok) markGuardFailure(result.failure)
    else {
      // 删除成功：清空筛选与页面缓存，刷新数据状态回落引导（`AC-029`）。
      filter.clear()
      groups.set({ phase: 'idle', groups: [], failure: null })
      await Promise.all([loadStatus(), loadGroups()])
    }
    return result
  }

  let ingestWasActive = false
  function observeSnapshot(snapshot: readonly ShellOperation[]): void {
    const active = isIngestActive(snapshot)
    if (ingestWasActive && !active) void loadStatus()
    ingestWasActive = active
  }

  const channel: OperationsChannel = createOperationsChannel({
    readSnapshot: async () => {
      const result = await client.get<{ operations: ShellOperation[] }>(ENDPOINTS.operations)
      if (!result.ok) return null
      return parseOperationsPayload(result.data)
    },
    transport: createEventSourceTransport(ENDPOINTS.events, options.eventSource),
    onSnapshot: (snapshot) => {
      operations.applySnapshot(snapshot.operations)
      observeSnapshot(snapshot.operations)
    },
    onState: (state) => operations.setConnection(state),
  })

  // 代际前进 → 群清单缓存失效并重取（决策 2）。
  epochGate.onAdvance(() => {
    groups.set({ phase: 'idle', groups: [], failure: null })
    void loadGroups()
  })

  return {
    filter,
    dataStatus,
    operations,
    session,
    groups,
    settings,
    client,
    loadStatus,
    loadGroups,
    loadSettings,
    saveSettings,
    triggerUpdate,
    runPreflight,
    runDeletion,
    start: () => channel.start(),
    stop: () => channel.stop(),
  }
}
