/**
 * MOD-006 信息提取（模块二）—— 模块出口（mod-006 §3.1「index.ts」、§3.3、§4）。
 *
 * 供外壳（MOD-004）与其它装配方消费：模块外只经本文件取用 `extract/` 的实现，不深入子目录。
 * - `constants.ts`（§3.3「契约级口径」）：识别类型九类、优先级 / 待办闭集、分页与响应上限；
 * - `pipeline/extract-pipeline.ts`（§3.3、§3.4）：`ExtractPipeline`（`run` / `retry`）与批次结果类型
 *   —— 采集成功后由外壳触发，非 HTTP、非 `API-###`；
 * - `reminder/due-todo.ts`（`API-018`，§4、§8 决策 3）：到期待办查询与会话级提醒去重（纯只读、不落库）；
 * - `store/entry-repository.ts`（§3.1）：装配 `ExtractPipeline` 所需的 `API-003` / `API-004` 适配器；
 * - `errors.ts`（§6）：统一信封工具与日志口（未知异常归「未知失败」，不新增标识）。
 *
 * 设计声明但尚未落盘的入口（本文件不补实现，勿在其它文件私自补齐）：
 * `API-014` `queryEntries` / `groupByTopic` / `groupByMonth`（`query/entry-query.ts`）、
 * `API-015` `queryNotifications`（`query/notify-query.ts`）、
 * `API-016` / `API-017` `updateEntryAttr` / `setTodoState`（`edit/entry-edit.ts`）、
 * `API-019` `queryMessageDetail`（`detail/message-detail.ts`）。
 */

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
