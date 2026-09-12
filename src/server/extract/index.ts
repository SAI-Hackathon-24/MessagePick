/**
 * MOD-006 信息提取（模块二）—— 模块出口（mod-006 §3.1「index.ts」、§3.3、§4）。
 *
 * 供外壳（MOD-004）与其它装配方消费：模块外只经本文件取用 `extract/` 的实现，不深入子目录。
 * - `constants.ts`（§3.3「契约级口径」）：识别类型九类、优先级 / 待办闭集、分页与响应上限；
 * - `pipeline/extract-pipeline.ts`（§3.3、§3.4）：`ExtractPipeline`（`run` / `retry`）与批次结果类型
 *   —— 采集成功后由外壳触发，非 HTTP、非 `API-###`；
 * - `query/entry-query.ts`（`API-014`，§4）：时间轴 / 归档（含分组）；
 * - `query/notify-query.ts`（`API-015`，§4）：通知总览四维度分组；
 * - `edit/entry-edit.ts`（`API-016` / `API-017`，§4）：主题、优先级、待办状态；
 * - `reminder/due-todo.ts`（`API-018`，§4、§8 决策 3）：到期待办查询与会话级提醒去重（纯只读、不落库）；
 * - `detail/message-detail.ts`（`API-019`，§4）：heading / 正文组装（超阈值走 worker）；
 * - `store/entry-repository.ts`（§3.1）：装配 `ExtractPipeline` 所需的 `API-003` / `API-004` 适配器；
 * - `errors.ts`（§6）：统一信封工具与日志口（未知异常归「未知失败」，不新增标识）；
 * - 本文件的 `createExtractModule`（§3.1「index.ts —— 装配」）：把 6 条 API 与管线 `run` / `retry`
 *   注册为模块出口，供外壳（MOD-004）接线。
 */

import type { MessageDetail, TaskRef } from '@shared'

import { queryMessageDetail, type MessageDetailQueryInput } from './detail/message-detail'
import {
  setTodoState,
  updateEntryAttr,
  type EntryAttrUpdateInput,
  type EntryDetail,
  type EntryEditOptions,
  type TodoState,
  type TodoStateInput,
} from './edit/entry-edit'
import type { ExtractLogger } from './errors'
import { ExtractPipeline } from './pipeline/extract-pipeline'
import type { BatchResult, GroupScope } from './pipeline/extract-pipeline'
import type { TaskGateway } from './pipeline/recognition'
import type { ExtractWindow } from './pipeline/watermark'
import { queryEntries, type EntryListPage, type EntryQueryInput } from './query/entry-query'
import { queryNotifications, type NotifyGroupPage, type NotifyQueryInput } from './query/notify-query'
import { queryDueTodos } from './reminder/due-todo'
import type { DueTodoPage, DueTodoQueryInput } from './reminder/due-todo'
import { EntryRepository } from './store/entry-repository'
import type { EntryRepositoryOptions, ExtractStorePort } from './store/entry-repository'

// ---------------------------------------------------------------------------
// 取值与阈值的唯一来源（§3.3「constants.ts」；契约级闭集与上限）
// ---------------------------------------------------------------------------

export {
  DUE_TODO_CAP,
  DUE_TODO_WINDOW_MS,
  LIST_CAP,
  NOTIFY_GROUP_PAGE_SIZE,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PRIORITIES,
  RECOGNITION_TYPES,
  TODO_STATUSES,
} from './constants'

// ---------------------------------------------------------------------------
// 批次管线（§3.3「ExtractPipeline」、§3.4、§5.3）：全模块唯一发起模型任务的路径
// ---------------------------------------------------------------------------

export { ExtractPipeline } from './pipeline/extract-pipeline'
export type {
  BatchCounts,
  BatchResult,
  ExtractBatchFailure,
  ExtractPipelineOptions,
  GroupScope,
} from './pipeline/extract-pipeline'
export type { ExtractWindow } from './pipeline/watermark'

// ---------------------------------------------------------------------------
// `API-014` ~ `API-019`（§3.3 签名级声明的实现面；查询 / 编辑 / 提醒 / 详情）
// ---------------------------------------------------------------------------

export { entryViewOf, groupByMonth, groupByTopic, queryEntries, sortTimeOf } from './query/entry-query'
export type { EntryListPage, EntryQueryInput, EntrySummary, MonthGroup, TopicGroup } from './query/entry-query'

export { queryNotifications } from './query/notify-query'
export type { NotifyGroup, NotifyGroupPage, NotifyQueryInput } from './query/notify-query'

export { setTodoState, updateEntryAttr } from './edit/entry-edit'
export type { EntryAttrUpdateInput, EntryDetail, EntryEditOptions, TodoState, TodoStateInput } from './edit/entry-edit'

export { assembleDetail, createWorkerDetailRunner, queryMessageDetail } from './detail/message-detail'
export type { DetailAssemblyInput, DetailRunner, MessageDetailOptions, MessageDetailQueryInput } from './detail/message-detail'

// ---------------------------------------------------------------------------
// `API-018` 到期待办（§4、§5.1、§8 决策 3；`now` 由调用方给出，服务侧无调度）
// ---------------------------------------------------------------------------

export { pickNewBubbles, queryDueTodos, remindStateOf } from './reminder/due-todo'
export type { DueTodoPage, DueTodoQueryInput } from './reminder/due-todo'

// ---------------------------------------------------------------------------
// 存储适配（§3.1「store/entry-repository.ts —— 全部读写封装」；不绕开 MOD-002）
// ---------------------------------------------------------------------------

export { EntryRepository } from './store/entry-repository'
export type {
  EntryRepositoryOptions,
  ExtractStorePort,
  ModulePage,
  ReadAllResult,
  WatermarkFacts,
} from './store/entry-repository'

// ---------------------------------------------------------------------------
// 错误与日志（§6：统一信封；`message` 只进日志，面向使用者的文案由外壳映射）
// ---------------------------------------------------------------------------

export { envelopeOf, ExtractError, isExtractError } from './errors'
export type { ExtractLogger } from './errors'

// ---------------------------------------------------------------------------
// 模块装配（§3.1「index.ts —— 装配：向外壳注册 6 条 API 的服务端实现」；供 MOD-004 接线）
// ---------------------------------------------------------------------------

/** 装配选项：`MOD-002` 门面必填；其余为可注入点（测试注入替身：不真调模型、不真开库）。 */
export interface ExtractModuleOptions {
  /** `MOD-002` 门面（`API-003` / `API-004`）；结构化满足 `ExtractStorePort`，模块内不打开数据库。 */
  store: ExtractStorePort
  /** 仓库层护栏参数（读取硬上限 / 分页拼接页大小）。 */
  repositoryOptions?: EntryRepositoryOptions
  /** `MOD-003` 任务网关（缺省绑定进程级引擎；测试注入替身）。 */
  gateway?: TaskGateway
  /** 时钟（提醒状态重算等；缺省 `Date.now`）。 */
  clock?: () => number
  /** 日志口（缺省静默）。 */
  logger?: ExtractLogger
  /** 失败任务记录容量（LRU；供 `API-008` 重试归属，默认 200）。 */
  failureCapacity?: number
}

/** 模块出口（`MOD-004` 只依赖这些成员；签名与 §3.3 一致：6 条 API + 管线 `run` / `retry`）。 */
export interface ExtractModule {
  /** `API-014` 查询提取条目（时间轴 / 归档）。 */
  queryEntries(input?: EntryQueryInput): Promise<EntryListPage>
  /** `API-015` 查询通知总览（四维度分组）。 */
  queryNotifications(input: NotifyQueryInput): Promise<NotifyGroupPage>
  /** `API-016` 修改主题 / 优先级（写；改后立即生效）。 */
  updateEntryAttr(input: EntryAttrUpdateInput): Promise<EntryDetail>
  /** `API-017` 标记待办状态（写；完成 / 忽略单向流转）。 */
  setTodoState(input: TodoStateInput): Promise<TodoState>
  /** `API-018` 查询到期待办（纯只读；`now` 由调用方给出）。 */
  queryDueTodos(input: DueTodoQueryInput): Promise<DueTodoPage>
  /** `API-019` 查询消息详情（heading / 正文）。 */
  queryMessageDetail(input: MessageDetailQueryInput): Promise<MessageDetail>
  /** 进程内批次入口（非 `API-###`）：采集成功后由外壳触发（§5.2；窗口缺省按水位推导）。 */
  run(window?: ExtractWindow): Promise<BatchResult>
  /** 分项重试（按群或任务引用；任务引用交 `API-008`）。 */
  retry(scope: GroupScope | TaskRef): Promise<BatchResult>
}

/** 装配模块：存储经 `EntryRepository` 适配，模型经 `TaskGateway`（缺省绑定 MOD-003 引擎）。 */
export function createExtractModule(options: ExtractModuleOptions): ExtractModule {
  const repository = new EntryRepository(options.store, options.repositoryOptions ?? {})
  const pipeline = new ExtractPipeline({
    repository,
    gateway: options.gateway,
    clock: options.clock,
    logger: options.logger,
    failureCapacity: options.failureCapacity,
  })
  const editOptions: EntryEditOptions = {
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  }
  return {
    queryEntries: (input = {}) => queryEntries(repository, input),
    queryNotifications: (input) => queryNotifications(repository, input),
    updateEntryAttr: (input) => updateEntryAttr(repository, input, editOptions),
    setTodoState: (input) => setTodoState(repository, input, editOptions),
    queryDueTodos: (input) => queryDueTodos(repository, input),
    queryMessageDetail: (input) => queryMessageDetail(repository, input),
    run: (window) => pipeline.run(window),
    retry: (scope) => pipeline.retry(scope),
  }
}
