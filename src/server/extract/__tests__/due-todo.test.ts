/**
 * 到期待办与提醒（mod-006 §7「待办与提醒」行；§4 API-018、§5.1、§8 决策 3；TASK-021）：
 *
 * - 提醒状态 = 待办未处理 ∧ 距 DDL ≤ 1 天（含已过期）；读取时计算、不落库；
 * - DDL > 1 天不提醒；已完成 / 忽略不提醒；DDL 为空不提醒；
 * - 清单按 DDL 升序、上限 200 条 + 总数 + 截断标记；纯只读（不写「已读」）；
 * - 会话级去重不落库：「关闭重开」= 清空会话状态后重新检查 → 仍满足条件的条目补出（AC-088）。
 */

import { describe, expect, it } from 'vitest'

import type { DueTodo, ExtractedItem, Timestamp, TodoStatus } from '@shared'

import { DUE_TODO_CAP } from '../constants'
import { pickNewBubbles, queryDueTodos, remindStateOf } from '../reminder/due-todo'
import { EntryRepository } from '../store/entry-repository'
import { DAY_MS, NOW, FakeStore, entry } from './harness'

function remindInput(
  deadline: Timestamp | null,
  todoStatus: TodoStatus = '未处理',
): Pick<ExtractedItem, 'deadline' | 'todoStatus'> {
  return { deadline, todoStatus }
}

function dueEntry(id: string, deadline: Timestamp | null, todoStatus: TodoStatus = '未处理'): ExtractedItem {
  return entry({ entryId: id, deadline, todoStatus, topic: `主题-${id}` })
}

function dueTodo(id: string, deadline: Timestamp): DueTodo {
  return { entryId: id, topic: `主题-${id}`, groupId: 'g1', deadline, sourceMessageIds: [`m-${id}`] }
}

describe('提醒状态计算（§5.1；纯函数、不落库）', () => {
  it('距 DDL ≤ 1 天（含恰好 1 天与已过期）→ 待提醒；> 1 天 → 不提醒', () => {
    expect(remindStateOf(remindInput(NOW + DAY_MS), NOW)).toBe('待提醒')
    expect(remindStateOf(remindInput(NOW + DAY_MS - 1), NOW)).toBe('待提醒')
    expect(remindStateOf(remindInput(NOW - 1), NOW)).toBe('待提醒')
    expect(remindStateOf(remindInput(NOW + DAY_MS + 1), NOW)).toBe('不提醒')
  })

  it('DDL 为空 / 已完成 / 已忽略 → 不提醒（完成与忽略退出提醒清单）', () => {
    expect(remindStateOf(remindInput(null), NOW)).toBe('不提醒')
    expect(remindStateOf(remindInput(NOW + 1000, '完成'), NOW)).toBe('不提醒')
    expect(remindStateOf(remindInput(NOW + 1000, '忽略'), NOW)).toBe('不提醒')
  })

  it('到期窗口可注入（默认 1 天）', () => {
    expect(remindStateOf(remindInput(NOW + 2000), NOW, 1000)).toBe('不提醒')
    expect(remindStateOf(remindInput(NOW + 2000), NOW, 2000)).toBe('待提醒')
  })
})

describe('查询到期待办（§4 API-018）', () => {
  const seed = [
    dueEntry('e-b', NOW + 2 * 60 * 60 * 1000),
    dueEntry('e-a', NOW + 10 * 60 * 1000),
    dueEntry('e-tomorrow', NOW + DAY_MS),
    dueEntry('e-far', NOW + 2 * DAY_MS),
    dueEntry('e-done', NOW + 1000, '完成'),
    dueEntry('e-ignored', NOW + 1000, '忽略'),
    dueEntry('e-null', null),
  ]

  it('只取未处理且 ≤ 1 天者，按 DDL 升序（同值稳定）；字段随条目返回', async () => {
    const page = await queryDueTodos(new EntryRepository(new FakeStore({ entries: seed })), { now: NOW })
    expect(page.todos.map((todo) => todo.entryId)).toEqual(['e-a', 'e-b', 'e-tomorrow'])
    expect(page.total).toBe(3)
    expect(page.truncated).toBe(false)
    expect(page.todos[0]).toEqual({
      entryId: 'e-a',
      topic: '主题-e-a',
      groupId: 'g1',
      deadline: NOW + 10 * 60 * 1000,
      sourceMessageIds: [],
    })
  })

  it('上限 200 条：超出即截断并标注总数', async () => {
    const many = Array.from({ length: DUE_TODO_CAP + 2 }, (_, index) => dueEntry(`e${index}`, NOW + index))
    const page = await queryDueTodos(new EntryRepository(new FakeStore({ entries: many })), { now: NOW })
    expect(page.todos).toHaveLength(DUE_TODO_CAP)
    expect(page.total).toBe(DUE_TODO_CAP + 2)
    expect(page.truncated).toBe(true)
    expect(page.todos[0]?.entryId).toBe('e0')
    expect(page.todos[DUE_TODO_CAP - 1]?.entryId).toBe(`e${DUE_TODO_CAP - 1}`)
  })

  it('存储不可用：原样上抛统一信封（不静默失败，§6）', async () => {
    const store = new FakeStore()
    store.failReads = true
    await expect(queryDueTodos(new EntryRepository(store), { now: NOW })).rejects.toMatchObject({
      envelope: { code: 'STORAGE_UNAVAILABLE' },
    })
  })
})

describe('会话级提醒去重（§8 决策 3；不落库）', () => {
  const todos = [dueTodo('e1', NOW + 1000), dueTodo('e2', NOW + 2000)]

  it('同一会话同一条目只提示一次；待办清单本身随时可查', () => {
    const seen = new Set<string>()
    expect(pickNewBubbles(todos, seen)).toHaveLength(2)
    for (const todo of todos) seen.add(todo.entryId) // 提示成功后由页面会话登记
    expect(pickNewBubbles(todos, seen)).toEqual([])
    expect(pickNewBubbles(todos, new Set(['e1']))).toEqual([todos[1]])
  })

  it('关闭重开（清空会话状态后重新检查）：仍满足条件的条目再次提示，不漏', () => {
    expect(pickNewBubbles(todos, new Set())).toHaveLength(2)
  })
})
