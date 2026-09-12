/**
 * 到期待办与提醒（mod-006 §3.1「reminder/due-todo.ts —— API-018：到期计算 + 会话级提醒去重」）。
 *
 * 口径（§4 API-018、§5.1、§8 决策 3）：
 * - 提醒状态 = 待办未处理 ∧ 距 DDL ≤ 1 天（含已过期）；**读取时计算、不落库**，`now` 由调用方给出；
 * - 到期待办 = DDL 非空、待办状态 ≠ 完成 / 忽略、距到期 ≤ 1 天者，按 DDL 升序；上限 200 条 + 总数 + 截断标记；
 * - 纯只读：不写「已读」、不落库任何会话状态；触发仅限页面打开期间（浏览器侧定时器 / 进入待办视图），
 *   服务侧不注册任何调度（无后台常驻）；
 * - 会话级去重（`pickNewBubbles`）只作用于页面内存的 `seen` 集合：同一条目同会话只弹一次，页面关闭
 *   即归零 → 下次会话中仍满足条件的条目会「补出」（保证不漏）。
 *
 * 提醒判定全部走纯函数（`remindStateOf`）：时钟与到期窗口由调用方注入，便于单测（§7）。
 * 读取经 `API-004`（`EntryRepository`）；存储失败原样上抛（`STORAGE_UNAVAILABLE`，§6）。
 */

import type { DueTodo, ExtractedItem, Id, RemindState, Timestamp } from '@shared'

import { DUE_TODO_CAP, DUE_TODO_WINDOW_MS } from '../constants'
import type { EntryRepository } from '../store/entry-repository'

/** 到期待办查询入参（`API-018` 的模块内形态；`now` 由调用方给出）。 */
export interface DueTodoQueryInput {
  /** 当前时间（用于计算距到期时长；服务侧不看时钟） */
  now: Timestamp
}

/** 到期待办清单（`API-018` 实现层扩展：上限 200 条 + 总数 + 截断标记，§4）。 */
export interface DueTodoPage {
  todos: DueTodo[]
  total: number
  truncated: boolean
}

/**
 * 提醒状态计算（§5.1）：待办未处理 ∧ 距 DDL ≤ 1 天 → 「待提醒」；否则「不提醒」。
 * 纯函数：不落库、不看时钟；`windowMs` 缺省取模块常量（`DUE_TODO_WINDOW_MS`）。
 */
export function remindStateOf(
  item: Pick<ExtractedItem, 'deadline' | 'todoStatus'>,
  now: Timestamp,
  windowMs: number = DUE_TODO_WINDOW_MS,
): RemindState {
  if (item.todoStatus !== '未处理') return '不提醒'
  if (item.deadline === null) return '不提醒'
  return item.deadline - now <= windowMs ? '待提醒' : '不提醒'
}

/**
 * 查询到期待办（`API-018`）：DDL 非空、待办状态 ≠ 完成 / 忽略、距到期 ≤ 1 天（含已过期），
 * 按 DDL 升序（同值按条目标识稳定排序）返回。
 * 上限 `DUE_TODO_CAP`（200）条，超出即截断并标注；`total` 为全部命中数。
 */
export async function queryDueTodos(repository: EntryRepository, input: DueTodoQueryInput): Promise<DueTodoPage> {
  const due: Array<{ entry: ExtractedItem; deadline: Timestamp }> = []
  for (const entry of repository.readEntries(null).records) {
    const { deadline } = entry
    if (deadline === null || remindStateOf(entry, input.now) !== '待提醒') continue
    due.push({ entry, deadline })
  }
  due.sort((a, b) => a.deadline - b.deadline || compareIds(a.entry.entryId, b.entry.entryId))
  const todos = due.slice(0, DUE_TODO_CAP).map(({ entry, deadline }) => toDueTodo(entry, deadline))
  return { todos, total: due.length, truncated: due.length > DUE_TODO_CAP }
}

/**
 * 会话级提醒去重（§8 决策 3）：只返回 `seen` 中尚未出现过的到期待办。
 * `seen` 由页面会话持有（本模块不落库、不保存任何会话状态）；提示成功后由调用方把条目加入 `seen`。
 */
export function pickNewBubbles(todos: readonly DueTodo[], seen: ReadonlySet<Id>): DueTodo[] {
  return todos.filter((todo) => !seen.has(todo.entryId))
}

/** 条目 → 到期待办项（只携带提醒展示所需字段；不写库）。 */
function toDueTodo(entry: ExtractedItem, deadline: Timestamp): DueTodo {
  return {
    entryId: entry.entryId,
    topic: entry.topic,
    groupId: entry.groupId,
    deadline,
    sourceMessageIds: [...entry.sourceMessageIds],
  }
}

function compareIds(a: Id, b: Id): number {
  return a < b ? -1 : a > b ? 1 : 0
}
