/**
 * 通知总览四维分组（mod-006 §7「通知总览」「护栏」「空态」「筛选契约」行；
 * §4 API-015、§5.2、§8 决策 4 / 5；AC-084、AC-024、AC-093）：
 *
 * - 组序：优先级 / 待办 = 闭集三值固定序（空组也返回）；来源 / 类型 = 实际出现值、
 *   按组内最新条目时间倒序（首现序）；
 * - 组内：排序时间倒序、同值按条目标识倒序；组头 = 组名 + 组内总数 + 组内截断标记；
 * - 组内分页：缺省每组第一页 50 条；跨组合计上限 LIST_CAP（超出即截断并标注）；
 * - 维度越界 / 页码非法 → INVALID_INPUT；无条目 → NO_DATA；命中 0 → EMPTY_RESULT。
 */

import { describe, expect, it } from 'vitest'

import type { NotificationDimension } from '@shared'

import { LIST_CAP, NOTIFY_GROUP_PAGE_SIZE } from '../constants'
import { queryNotifications } from '../query/notify-query'
import { EntryRepository } from '../store/entry-repository'
import { FakeStore, entry, message } from './harness'

describe('组序与组头（§4 API-015）', () => {
  it('来源维度：实际出现值、组序 = 组内最新条目时间倒序；label 取群名（群已删回退群标识）', async () => {
    const store = new FakeStore({
      groups: [{ groupId: 'g1', groupName: '甲群' }], // g2 已删：缺群名
      messages: [message('m-g2', 'g2', 900), message('m-g1a', 'g1', 500), message('m-g1b', 'g1', 300)],
      entries: [
        entry({ entryId: 'e-g1a', groupId: 'g1', sourceMessageIds: ['m-g1a'], recognitionType: '会议', priority: '高' }),
        entry({ entryId: 'e-g2', groupId: 'g2', sourceMessageIds: ['m-g2'], recognitionType: '缴费' }),
        entry({ entryId: 'e-g1b', groupId: 'g1', sourceMessageIds: ['m-g1b'], recognitionType: '会议', priority: '低' }),
      ],
    })
    const page = await queryNotifications(new EntryRepository(store), { dimension: '来源' })

    expect(page.groups.map((group) => [group.key, group.label, group.total])).toEqual([
      ['g2', 'g2', 1],
      ['g1', '甲群', 2],
    ])
    expect(page.groups[1]?.notifications.map((item) => item.entryId)).toEqual(['e-g1a', 'e-g1b'])
    expect(page.groups[0]?.notifications[0]).toEqual({
      entryId: 'e-g2',
      groupId: 'g2',
      recognitionType: '缴费',
      priority: '中',
      todoStatus: '未处理',
      sourceMessageIds: ['m-g2'],
    })
    expect(page.pageInfo).toEqual({ page: 1, pageSize: NOTIFY_GROUP_PAGE_SIZE, total: 3 })
    expect(page.truncated).toBe(false)
  })

  it('优先级维度：三档固定序、空组也返回（默认「中」）', async () => {
    const store = new FakeStore({
      entries: [
        entry({ entryId: 'e-mid', priority: '中', sourceMessageIds: [] }),
        entry({ entryId: 'e-low', priority: '低', sourceMessageIds: [] }),
      ],
    })
    const page = await queryNotifications(new EntryRepository(store), { dimension: '优先级' })

    expect(page.groups.map((group) => [group.key, group.total])).toEqual([
      ['高', 0],
      ['中', 1],
      ['低', 1],
    ])
    expect(page.groups[0]?.notifications).toEqual([])
    expect(page.groups[0]?.truncated).toBe(false)
  })

  it('待办维度：未处理 / 完成 / 忽略 三值固定序', async () => {
    const store = new FakeStore({
      entries: [
        entry({ entryId: 'e-done', todoStatus: '完成', sourceMessageIds: [] }),
        entry({ entryId: 'e-open', todoStatus: '未处理', sourceMessageIds: [] }),
      ],
    })
    const page = await queryNotifications(new EntryRepository(store), { dimension: '待办' })

    expect(page.groups.map((group) => [group.key, group.total])).toEqual([
      ['未处理', 1],
      ['完成', 1],
      ['忽略', 0],
    ])
  })

  it('类型维度：实际出现值、按组内最新条目时间倒序；闭集外识别类型透传为独立组（§8 决策 7）', async () => {
    const store = new FakeStore({
      messages: [message('m1', 'g1', 100), message('m2', 'g1', 200)],
      entries: [
        entry({ entryId: 'e1', recognitionType: '会议', sourceMessageIds: ['m1'] }),
        entry({ entryId: 'e2', recognitionType: '自定义类型', sourceMessageIds: ['m2'] }),
      ],
    })
    const page = await queryNotifications(new EntryRepository(store), { dimension: '类型' })

    expect(page.groups.map((group) => [group.key, group.label, group.total])).toEqual([
      ['自定义类型', '自定义类型', 1],
      ['会议', '会议', 1],
    ])
  })
})

describe('组内分页与跨组上限（§4；详设 §5.4）', () => {
  it('组内分页：缺省 50；带 page 返回第 k 页；组内总数与截断标记随组头返回', async () => {
    const count = 120
    const store = new FakeStore({
      // 时间倒序：e000 最新 → 组内顺序即 e000、e001……
      messages: Array.from({ length: count }, (_, index) => message(`m${index}`, 'g1', 10_000 - index)),
      entries: Array.from({ length: count }, (_, index) =>
        entry({
          entryId: `e${String(index).padStart(3, '0')}`,
          priority: '中',
          sourceMessageIds: [`m${index}`],
        }),
      ),
    })
    const repository = new EntryRepository(store)

    const first = await queryNotifications(repository, { dimension: '优先级' })
    const second = await queryNotifications(repository, { dimension: '优先级', page: { page: 2 } })
    const last = await queryNotifications(repository, { dimension: '优先级', page: { page: 3 } })

    const firstMid = first.groups.find((group) => group.key === '中')
    expect(firstMid?.total).toBe(count) // 组头计数 = 组内总数（不受分页影响）
    expect(firstMid?.notifications).toHaveLength(NOTIFY_GROUP_PAGE_SIZE)
    expect(firstMid?.notifications[0]?.entryId).toBe('e000')
    expect(firstMid?.truncated).toBe(true) // 本页之后仍有条目

    const secondMid = second.groups.find((group) => group.key === '中')
    expect(secondMid?.notifications).toHaveLength(NOTIFY_GROUP_PAGE_SIZE)
    expect(secondMid?.notifications[0]?.entryId).toBe('e050')

    const lastMid = last.groups.find((group) => group.key === '中')
    expect(lastMid?.notifications).toHaveLength(20)
    expect(lastMid?.notifications[0]?.entryId).toBe('e100')
    expect(lastMid?.truncated).toBe(false)

    expect(first.truncated).toBe(true)
    expect(last.truncated).toBe(false)
  })

  it(`跨组合计上限（LIST_CAP = ${LIST_CAP}）：按组序分配预算，超出即截断并标注`, async () => {
    const groupCount = 41
    const perGroup = 50
    const entries = Array.from({ length: groupCount * perGroup }, (_, index) => {
      const group = Math.floor(index / perGroup)
      const slot = index % perGroup
      return entry({
        entryId: `e${String(group).padStart(2, '0')}-${String(slot).padStart(2, '0')}`,
        recognitionType: `类型${String(group).padStart(2, '0')}`,
        sourceMessageIds: [],
      })
    })
    const page = await queryNotifications(new EntryRepository(new FakeStore({ entries })), { dimension: '类型' })

    expect(page.groups).toHaveLength(groupCount)
    // 条目标识倒序（同时间值稳定排序）→ 组序 = 类型40、类型39……
    expect(page.groups[0]?.key).toBe('类型40')
    expect(page.groups.slice(0, 40).every((group) => group.notifications.length === perGroup)).toBe(true)
    const cut = page.groups[40]
    expect(cut?.key).toBe('类型00')
    expect(cut?.notifications).toEqual([]) // 预算耗尽：组头保留、条目不再随响应带出
    expect(cut?.total).toBe(perGroup)
    expect(cut?.truncated).toBe(true)
    expect(page.truncated).toBe(true)
  })
})

describe('护栏与空态（§6；AC-093）', () => {
  it('维度越界 / 页码非法 → INVALID_INPUT；无条目 → NO_DATA；命中 0 → EMPTY_RESULT', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', groupId: 'g1' })] })
    const repository = new EntryRepository(store)

    await expect(
      queryNotifications(repository, { dimension: '未知维度' as NotificationDimension }),
    ).rejects.toMatchObject({ envelope: { code: 'INVALID_INPUT' } })
    await expect(queryNotifications(repository, { dimension: '来源', page: { page: 0 } })).rejects.toMatchObject({
      envelope: { code: 'INVALID_INPUT' },
    })
    await expect(
      queryNotifications(repository, { dimension: '来源', filter: { groupIds: ['g-other'] } }),
    ).rejects.toMatchObject({ envelope: { code: 'EMPTY_RESULT' } })
    await expect(queryNotifications(new EntryRepository(new FakeStore()), { dimension: '来源' })).rejects.toMatchObject({
      envelope: { code: 'NO_DATA' },
    })
  })

  it('存储不可用：原样上抛统一信封（不静默失败，§6）', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1' })] })
    store.failReads = true
    await expect(queryNotifications(new EntryRepository(store), { dimension: '来源' })).rejects.toMatchObject({
      envelope: { code: 'STORAGE_UNAVAILABLE' },
    })
  })
})
