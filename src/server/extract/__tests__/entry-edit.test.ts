/**
 * 主题 / 优先级 / 待办状态修改（mod-006 §7「通知总览」「待办与提醒」「失败路径」行；
 * §4 API-016 / API-017、§5.1 / §5.3、§8 决策 2 / 6；AC-084、AC-085、AC-086）：
 *
 * - 校验：主题与优先级至少一项；优先级 ∈ 三档；待办标记 ∈ {完成, 忽略}（单向流转、无回退入参）；
 * - 存在性：条目不存在 → NOT_FOUND；写入被拒绝 / 存储不可用 → STORAGE_UNAVAILABLE（原值不变）；
 * - 幂等：同一新值重复提交结果一致、不产生副本；改后立即生效（写成功即返回新值，查询直读）；
 * - remindState 随写入按注入时钟重算（未处理 ∧ 距 DDL ≤ 1 天；完成 / 忽略 → 不提醒）。
 */

import { describe, expect, it } from 'vitest'

import type { Priority, TodoMark } from '@shared'

import { updateEntryAttr, setTodoState } from '../edit/entry-edit'
import { queryDueTodos } from '../reminder/due-todo'
import { EntryRepository } from '../store/entry-repository'
import { DAY_MS, NOW, FakeStore, entry, fixedClock } from './harness'

const editOptions = { clock: fixedClock() }

describe('API-016 修改主题 / 优先级（§4；AC-084）', () => {
  it('改主题：写库立即生效、返回更新后的条目、其余字段不变（REQ-008）', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', topic: '旧主题', priority: '中' })] })
    const repository = new EntryRepository(store)

    const detail = await updateEntryAttr(repository, { entryId: 'e1', topic: '新主题' }, editOptions)

    expect(detail.item.topic).toBe('新主题')
    expect(detail.item.priority).toBe('中') // 未给项保持原值
    expect(detail.item.headline).toBe('一句话总结')
    expect(store.entries).toHaveLength(1) // upsert：不产生副本
    expect(store.entries[0]?.topic).toBe('新主题') // 查询直读（无缓存层，§8 决策 6）
    expect(store.writeCalls).toEqual([{ type: 'DM-010', count: 1 }])
  })

  it('改优先级：三档闭集可改；主题前后空白修剪后落库', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', topic: '旧主题', priority: '中' })] })
    const repository = new EntryRepository(store)

    await updateEntryAttr(repository, { entryId: 'e1', priority: '高' }, editOptions)
    expect(store.entries[0]?.priority).toBe('高')

    await updateEntryAttr(repository, { entryId: 'e1', topic: '  缴费通知  ' }, editOptions)
    expect(store.entries[0]?.topic).toBe('缴费通知')
    expect(store.entries[0]?.priority).toBe('高') // 上一次修改保持在位
  })

  it('双空提交 → INVALID_INPUT 且原值不变（AC-085）', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', topic: '旧主题', priority: '低' })] })
    const repository = new EntryRepository(store)

    await expect(updateEntryAttr(repository, { entryId: 'e1' }, editOptions)).rejects.toMatchObject({
      envelope: { code: 'INVALID_INPUT' },
    })
    await expect(
      updateEntryAttr(repository, { entryId: 'e1', topic: null, priority: null }, editOptions),
    ).rejects.toMatchObject({ envelope: { code: 'INVALID_INPUT' } })
    expect(store.entries[0]).toMatchObject({ topic: '旧主题', priority: '低' })
    expect(store.writeCalls).toHaveLength(0)
  })

  it('优先级越界 / 主题空文本 → INVALID_INPUT（不进入写库）', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', topic: '旧主题' })] })
    const repository = new EntryRepository(store)

    await expect(
      updateEntryAttr(repository, { entryId: 'e1', priority: '紧急' as Priority }, editOptions),
    ).rejects.toMatchObject({ envelope: { code: 'INVALID_INPUT' } })
    await expect(updateEntryAttr(repository, { entryId: 'e1', topic: '   ' }, editOptions)).rejects.toMatchObject({
      envelope: { code: 'INVALID_INPUT' },
    })
    expect(store.entries[0]?.topic).toBe('旧主题')
    expect(store.writeCalls).toHaveLength(0)
  })

  it('条目不存在 → NOT_FOUND（含查询与写入竞态中被删）', async () => {
    const store = new FakeStore()
    await expect(
      updateEntryAttr(new EntryRepository(store), { entryId: 'missing', topic: '新主题' }, editOptions),
    ).rejects.toMatchObject({ envelope: { code: 'NOT_FOUND' } })
    expect(store.writeCalls).toHaveLength(0)
  })

  it('幂等：同一新值重复提交结果一致、条目不产生副本', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', topic: '旧主题' })] })
    const repository = new EntryRepository(store)

    const first = await updateEntryAttr(repository, { entryId: 'e1', topic: '新主题' }, editOptions)
    const second = await updateEntryAttr(repository, { entryId: 'e1', topic: '新主题' }, editOptions)

    expect(second).toEqual(first)
    expect(store.entries).toHaveLength(1)
  })
})

describe('remindState 随写入重算（§5.1；时钟注入）', () => {
  it('同一编辑、不同时钟 → 不同提醒状态（距 DDL ≤ 1 天临界）', async () => {
    const store = new FakeStore({
      entries: [entry({ entryId: 'e1', deadline: NOW + 2 * DAY_MS, todoStatus: '未处理' })],
    })
    const repository = new EntryRepository(store)

    await updateEntryAttr(repository, { entryId: 'e1', topic: '新主题' }, { clock: fixedClock(NOW) })
    expect(store.entries[0]?.remindState).toBe('不提醒') // 距 DDL > 1 天

    await updateEntryAttr(
      repository,
      { entryId: 'e1', topic: '新主题' },
      { clock: fixedClock(NOW + DAY_MS + DAY_MS / 2) },
    )
    expect(store.entries[0]?.remindState).toBe('待提醒') // 距 DDL ≤ 1 天
  })
})

describe('API-017 标记待办状态（§4、§5.3；AC-086）', () => {
  it('完成 / 忽略：返回标记后的状态，remindState 重算为「不提醒」并退出到期清单', async () => {
    const store = new FakeStore({
      entries: [entry({ entryId: 'e1', deadline: NOW + 60 * 60 * 1000, todoStatus: '未处理' })],
    })
    const repository = new EntryRepository(store)

    const state = await setTodoState(repository, { entryId: 'e1', todoStatus: '完成' }, editOptions)
    expect(state).toEqual({ todoStatus: '完成' })
    expect(store.entries[0]?.remindState).toBe('不提醒')
    expect((await queryDueTodos(repository, { now: NOW })).todos).toEqual([])

    await setTodoState(repository, { entryId: 'e1', todoStatus: '忽略' }, editOptions)
    expect(store.entries[0]?.todoStatus).toBe('忽略')
  })

  it('回退「未处理」/ 越界值 → INVALID_INPUT（单向流转，契约无回退入参，§5.3）', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', todoStatus: '未处理' })] })
    const repository = new EntryRepository(store)

    await expect(
      setTodoState(repository, { entryId: 'e1', todoStatus: '未处理' as unknown as TodoMark }, editOptions),
    ).rejects.toMatchObject({ envelope: { code: 'INVALID_INPUT' } })
    await expect(
      setTodoState(repository, { entryId: 'e1', todoStatus: '已读' as TodoMark }, editOptions),
    ).rejects.toMatchObject({ envelope: { code: 'INVALID_INPUT' } })
    expect(store.entries[0]?.todoStatus).toBe('未处理')
    expect(store.writeCalls).toHaveLength(0)
  })

  it('条目不存在 / 写入被拒绝 / 存储不可用 → 统一信封、原值不变（§6）', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', todoStatus: '未处理' })] })
    const repository = new EntryRepository(store)

    await expect(
      setTodoState(repository, { entryId: 'missing', todoStatus: '完成' }, editOptions),
    ).rejects.toMatchObject({ envelope: { code: 'NOT_FOUND' } })

    store.rejectWrites = true
    await expect(
      setTodoState(repository, { entryId: 'e1', todoStatus: '完成' }, editOptions),
    ).rejects.toMatchObject({ envelope: { code: 'STORAGE_UNAVAILABLE' } })

    store.rejectWrites = false
    store.failWrites = true
    await expect(
      setTodoState(repository, { entryId: 'e1', todoStatus: '完成' }, editOptions),
    ).rejects.toMatchObject({ envelope: { code: 'STORAGE_UNAVAILABLE' } })

    expect(store.entries[0]?.todoStatus).toBe('未处理') // 原值不变，可原样重试
  })

  it('幂等：同一状态重复提交结果一致', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', todoStatus: '未处理' })] })
    const repository = new EntryRepository(store)

    const first = await setTodoState(repository, { entryId: 'e1', todoStatus: '完成' }, editOptions)
    const second = await setTodoState(repository, { entryId: 'e1', todoStatus: '完成' }, editOptions)

    expect(second).toEqual(first)
    expect(store.entries).toHaveLength(1)
  })
})
