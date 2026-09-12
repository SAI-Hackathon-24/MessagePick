/**
 * 主题 / 优先级 / 待办状态修改（mod-006 §3.1「edit/entry-edit.ts —— API-016 / API-017」、
 * §4 API-016 / API-017、§5.1、§5.3、§8 决策 2 / 6、§7「通知总览」「待办与提醒」「失败路径」行）。
 *
 * - 流程（§4）：入参校验（主题与优先级至少一项、优先级 ∈ 三档、待办标记 ∈ {完成, 忽略}）
 *   → 经 `API-004` 确认条目存在（不存在 → `NOT_FOUND`）→ 经 `API-003` 写入 → 返回更新后的值。
 * - `DM-010` 的 upsert 只覆盖变异白名单（主题 / 优先级 / 待办状态 / 提醒状态），身份与其余字段
 *   永不覆盖（`MOD-002` 注册表口径）——因此写回「读取 + 合并」的记录是安全的。
 * - 改后立即生效（`REQ-008`）：写成功即返回新值，后续查询直读库（§8 决策 6，无缓存层）。
 * - 幂等：同一新值重复提交结果一致（重复写不产生副作用）；存储拒绝 / 不可用 → `STORAGE_UNAVAILABLE`，
 *   原值不变、可原样重试（§4）。
 * - 待办流转单向（§5.3）：只接受「完成 / 忽略」，契约未提供回到「未处理」的入参，不实现该流转。
 * - `remindState` 每次写入按注入时钟重算（§5.1：待办未处理 ∧ 距 DDL ≤ 1 天）；不递增 dataEpoch
 *   （模块无权威缓存，「立即生效」由直读保证；与管线落库同为 `bumpEpoch: false`）。
 */

import { TODO_MARKS, type Api016Response, type Api017Response, type ExtractedItem, type Id, type Priority, type TodoMark } from '@shared'

import { PRIORITIES } from '../constants'
import { invalidInput, notFound, storageUnavailable, type ExtractLogger } from '../errors'
import { remindStateOf } from '../reminder/due-todo'
import type { EntryRepository } from '../store/entry-repository'

// ---------------------------------------------------------------------------
// 入参 / 出参（§3.3：`updateEntryAttr` / `setTodoState`；形状对齐契约，外壳直通）
// ---------------------------------------------------------------------------

/** `API-016` 入参：主题与优先级至少给出一项（契约 `Api016Request`）。 */
export interface EntryAttrUpdateInput {
  entryId: Id
  topic?: string | null
  priority?: Priority | null
}

/** `API-016` 出参：更新后的条目（契约 `Api016Response`；§3.3 的签名简写即本出参）。 */
export type EntryDetail = Api016Response

/** `API-017` 入参：只接受「完成 / 忽略」（契约 `Api017Request`）。 */
export interface TodoStateInput {
  entryId: Id
  todoStatus: TodoMark
}

/** `API-017` 出参：标记立即生效后的状态（契约 `Api017Response`；§3.3 的签名简写即本出参）。 */
export type TodoState = Api017Response

/** 编辑路径可注入项：时钟用于 `remindState` 重算（§5.1，缺省取真实时钟）；日志口记存储拒绝。 */
export interface EntryEditOptions {
  clock?: () => number
  logger?: ExtractLogger
}

// ---------------------------------------------------------------------------
// API-016 修改主题 / 优先级
// ---------------------------------------------------------------------------

/**
 * `API-016`：修改条目的主题与 / 或优先级，返回更新后的条目。
 * 校验通过且条目存在才写库；存储拒绝 → `STORAGE_UNAVAILABLE`（原值不变，可原样重试）。
 */
export async function updateEntryAttr(
  repository: EntryRepository,
  input: EntryAttrUpdateInput,
  options: EntryEditOptions = {},
): Promise<EntryDetail> {
  const entryId = requireEntryId(input.entryId)
  const hasTopic = input.topic !== undefined && input.topic !== null
  const hasPriority = input.priority !== undefined && input.priority !== null
  // 「主题与优先级均未给出」直接拒绝：不进入读取，更不写库（AC-085 的口径）。
  if (!hasTopic && !hasPriority) throw invalidInput('主题与优先级至少给出一项', { entryId })
  const topic = hasTopic ? requireTopic(input.topic) : null
  const priority = hasPriority ? requirePriority(input.priority) : null

  const entry = findOrThrow(repository, entryId)
  const merged: ExtractedItem = {
    ...entry,
    ...(topic === null ? {} : { topic }),
    ...(priority === null ? {} : { priority }),
  }
  const updated: ExtractedItem = { ...merged, remindState: remindStateOf(merged, nowOf(options)) }
  writeEdited(repository, updated, options)
  return { item: updated }
}

// ---------------------------------------------------------------------------
// API-017 标记待办状态
// ---------------------------------------------------------------------------

/**
 * `API-017`：标记待办为「完成 / 忽略」，返回标记后的状态（单向流转，无回退入参）。
 * 幂等与错误口径同 `API-016`。
 */
export async function setTodoState(
  repository: EntryRepository,
  input: TodoStateInput,
  options: EntryEditOptions = {},
): Promise<TodoState> {
  const entryId = requireEntryId(input.entryId)
  const todoStatus = requireTodoMark(input.todoStatus)

  const entry = findOrThrow(repository, entryId)
  const merged: ExtractedItem = { ...entry, todoStatus }
  // 完成 / 忽略即退出提醒清单：remindState 随写入重算为「不提醒」（§5.1）。
  const updated: ExtractedItem = { ...merged, remindState: remindStateOf(merged, nowOf(options)) }
  writeEdited(repository, updated, options)
  return { todoStatus: updated.todoStatus }
}

// ---------------------------------------------------------------------------
// 内部：校验、查找与写库
// ---------------------------------------------------------------------------

/** 条目标识护栏：非空字符串（更细的 schema 校验属外壳，详设 §4.4）。 */
function requireEntryId(value: unknown): Id {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidInput('条目标识非法：应为非空字符串', { entryId: value })
  }
  return value
}

/** 主题护栏：非空文本；前后空白修剪后为空 → `INVALID_INPUT`（主题非空是 DM-010 的硬约束）。 */
function requireTopic(value: unknown): string {
  if (typeof value !== 'string') throw invalidInput('主题非法：应为文本', { topic: value })
  const topic = value.trim()
  if (topic.length === 0) throw invalidInput('主题不能为空', { topic: value })
  return topic
}

/** 优先级护栏：三档闭集（`高 / 中 / 低`），越界 → `INVALID_INPUT`（§8 决策 7；不会出现第四档）。 */
function requirePriority(value: unknown): Priority {
  if (typeof value !== 'string' || !(PRIORITIES as readonly string[]).includes(value)) {
    throw invalidInput('优先级越界：应为「高 / 中 / 低」之一', { priority: value })
  }
  return value as Priority
}

/** 待办标记护栏：只接受「完成 / 忽略」（未处理为初始状态，§5.3 单向流转）。 */
function requireTodoMark(value: unknown): TodoMark {
  if (typeof value !== 'string' || !(TODO_MARKS as readonly string[]).includes(value)) {
    throw invalidInput('待办标记越界：应为「完成」或「忽略」', { todoStatus: value })
  }
  return value as TodoMark
}

/** 存在性确认（§4）：不存在（含查询与写入竞态中被删）→ `NOT_FOUND`。 */
function findOrThrow(repository: EntryRepository, entryId: Id): ExtractedItem {
  const entry = repository.findEntry(entryId)
  if (entry === null) throw notFound('extract:entry', `条目不存在（${entryId}）`, { entryId })
  return entry
}

/** 写库（经 `API-003`）：存储拒绝即 `STORAGE_UNAVAILABLE`，不静默失败（§6）。 */
function writeEdited(repository: EntryRepository, record: ExtractedItem, options: EntryEditOptions): void {
  const result = repository.writeEntries([record], { bumpEpoch: false })
  if (result.failures.length > 0) {
    options.logger?.error?.('extract.entry-edit.rejected', {
      module: 'MOD-006',
      entryId: record.entryId,
      rejected: result.failures.length,
    })
    throw storageUnavailable('extract:entry-edit', '条目更新被存储拒绝', {
      entryId: record.entryId,
      rejected: result.failures.length,
    })
  }
}

function nowOf(options: EntryEditOptions): number {
  return (options.clock ?? Date.now)()
}
