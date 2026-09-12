/**
 * 时间轴与归档查询（mod-006 §7「时间轴」「归档与主题」「空态」「筛选契约」「护栏」行；
 * §4 API-014、§5.2、§8 决策 4 / 5；AC-013、AC-018、AC-024、AC-089、AC-093）：
 *
 * - 排序键 = 最早来源消息发送时间（读取时解析；部分缺失取剩余最早、全缺 null —— 不猜、不填）；
 * - 分页：缺省 1 / 100；页码 < 1 或每页 > 500 → INVALID_INPUT；截断标记与总数正确；
 * - 空态区分：无任何条目 → NO_DATA；筛选命中 0 条 → EMPTY_RESULT；
 * - 筛选契约：身份字段剔除；关键词只经 API-004 一次（替身不过滤 → 模块也不得过滤）；
 * - 归档：主题 = 首现序（组头 = 主题 + 条目数）；月份 = UTC 自然月、倒序、「不可解析」殿后。
 */

import { describe, expect, it } from 'vitest'

import type { Timestamp } from '@shared'

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../constants'
import {
  entryViewOf,
  groupByMonth,
  groupByTopic,
  monthOf,
  queryEntries,
  sortTimeOf,
  type EntrySummary,
} from '../query/entry-query'
import { EntryRepository } from '../store/entry-repository'
import { FakeStore, entry, message } from './harness'

/** 归档分组用的最小条目视图（字段齐全、只关心主题 / 时间）。 */
function summary(entryId: string, topic: string, time: Timestamp | null): EntrySummary {
  return {
    entryId,
    recognitionType: '会议',
    timeElement: null,
    locationElement: null,
    personElementMemberIds: [],
    subjectElement: null,
    deadline: null,
    groupId: 'g1',
    time,
    topic,
    sourceMessageIds: [],
  }
}

/** 模块页读取（排除 `hasAnyEntry` 的探测读取）。 */
function pageReads(store: FakeStore) {
  return store.readCalls.filter((call) => call.type === 'DM-010' && call.page?.pageSize === PAGE_SIZE_DEFAULT)
}

describe('查询时间轴（§4 API-014；排序时间 §5.2；AC-089）', () => {
  it('随来源引用解析排序时间：取全部来源消息中最早者；来源缺项不猜', async () => {
    const store = new FakeStore({
      entries: [
        entry({ entryId: 'e1', groupId: 'g1', sourceMessageIds: ['m1', 'm2'] }),
        entry({ entryId: 'e2', groupId: 'g1', sourceMessageIds: ['m-gone'] }),
      ],
      messages: [message('m1', 'g1', 300), message('m2', 'g1', 100)],
    })
    const page = await queryEntries(new EntryRepository(store))

    expect(page.items.map((item) => item.entryId)).toEqual(['e1', 'e2'])
    expect(page.items[0]?.time).toBe(100) // 最早来源消息发送时间
    expect(page.items[1]?.time).toBeNull() // 来源缺失（被删）→ null，不填猜测值
    expect(page.pageInfo).toEqual({ page: 1, pageSize: PAGE_SIZE_DEFAULT, total: 2 })
    expect(page.truncated).toBe(false)
  })

  it('条目视图：人物要素空数组口径、来源引用原样回带（可回跳原文，REQ-007）', () => {
    const view = entryViewOf(
      entry({ entryId: 'e1', groupId: 'g1', personElementMemberIds: null, sourceMessageIds: ['m1', 'm2'] }),
      new Map(),
    )
    expect(view.personElementMemberIds).toEqual([])
    expect(view.sourceMessageIds).toEqual(['m1', 'm2'])
  })

  it('sortTimeOf：来源全部缺失 / 无来源 → null（派生量读取时解析，不落库）', () => {
    const messages = new Map([
      ['m1', message('m1', 'g1', 200)],
      ['m2', message('m2', 'g1', 100)],
    ])
    expect(sortTimeOf(entry({ entryId: 'e1', sourceMessageIds: ['m1', 'm2'] }), messages)).toBe(100)
    expect(sortTimeOf(entry({ entryId: 'e2', sourceMessageIds: ['gone'] }), messages)).toBeNull()
    expect(sortTimeOf(entry({ entryId: 'e3', sourceMessageIds: [] }), messages)).toBeNull()
  })

  it('分页：缺省 1 / 100；页参数原样交 API-004；截断标记 = 本页之后仍有命中（AC-024）', async () => {
    const entries = Array.from({ length: 250 }, (_, index) =>
      entry({ entryId: `e${String(index).padStart(3, '0')}` }),
    )
    const store = new FakeStore({ entries })
    const repository = new EntryRepository(store)

    const second = await queryEntries(repository, { page: { page: 2, pageSize: 100 } })
    expect(second.items).toHaveLength(100)
    expect(second.items[0]?.entryId).toBe('e100')
    expect(second.pageInfo).toEqual({ page: 2, pageSize: 100, total: 250 })
    expect(second.truncated).toBe(true) // 200 < 250

    const last = await queryEntries(repository, { page: { page: 3, pageSize: 100 } })
    expect(last.items).toHaveLength(50)
    expect(last.truncated).toBe(false) // 300 ≥ 250

    expect(
      store.readCalls.filter((call) => call.page?.pageSize === 100).map((call) => call.page?.page),
    ).toEqual([2, 3])
  })

  it('护栏：页码 < 1 / 每页 > 500 → INVALID_INPUT（不进入任何读取，§8 决策 4）', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1' })] })
    const repository = new EntryRepository(store)

    await expect(queryEntries(repository, { page: { page: 0 } })).rejects.toMatchObject({
      envelope: { code: 'INVALID_INPUT' },
    })
    await expect(queryEntries(repository, { page: { pageSize: PAGE_SIZE_MAX + 1 } })).rejects.toMatchObject({
      envelope: { code: 'INVALID_INPUT' },
    })
    expect(store.readCalls).toHaveLength(0)
  })
})

describe('空态（§4、AC-093）', () => {
  it('无任何条目 → NO_DATA；筛选命中 0 条 → EMPTY_RESULT（两态可区分）', async () => {
    await expect(queryEntries(new EntryRepository(new FakeStore()))).rejects.toMatchObject({
      envelope: { code: 'NO_DATA' },
    })

    const store = new FakeStore({ entries: [entry({ entryId: 'e1', groupId: 'g1' })] })
    await expect(
      queryEntries(new EntryRepository(store), { filter: { groupIds: ['g-other'] } }),
    ).rejects.toMatchObject({ envelope: { code: 'EMPTY_RESULT' } })
  })
})

describe('筛选契约（REQ-006 / REQ-049；§8 决策 5；AC-013、AC-018）', () => {
  it('身份字段显式剔除；关键词只经 API-004 一次、模块内不二次过滤', async () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', groupId: 'g1', headline: '不含关键词的标题' })] })
    const page = await queryEntries(new EntryRepository(store), {
      filter: { groupIds: ['g1'], timeRange: { from: 1, to: 2 }, keyword: '缴费', identity: 'me-1' },
    })

    expect(page.items).toHaveLength(1) // 替身不做关键词过滤 → 模块也不得过滤
    expect(pageReads(store).at(-1)?.filter).toEqual({ groupIds: ['g1'], timeRange: { from: 1, to: 2 }, keyword: '缴费' })
  })
})

describe('归档分组（§4：组头 = 组名 + 条目数）', () => {
  it('主题维度：按主题值分组、组序 = 首现序（输入为排序时间倒序时即「最近分组在前」）', () => {
    const groups = groupByTopic([
      summary('e1', '会议', 300),
      summary('e2', '缴费', 200),
      summary('e3', '会议', 100),
    ])
    expect(groups.map((group) => [group.topic, group.count])).toEqual([
      ['会议', 2],
      ['缴费', 1],
    ])
    expect(groups[0]?.entries.map((item) => item.entryId)).toEqual(['e1', 'e3'])
  })

  it('时间维度：UTC 自然月、月份倒序、「不可解析」殿后（原样保留、不丢弃条目）', () => {
    const groups = groupByMonth([
      summary('e1', '会议', Date.UTC(2026, 8, 12)),
      summary('e2', '缴费', Date.UTC(2026, 7, 31)),
      summary('e3', '活动', null),
      summary('e4', '会议', Date.UTC(2026, 8, 1) - 1), // UTC 8 月最后 1 ms
    ])
    expect(groups.map((group) => [group.month, group.count])).toEqual([
      ['2026-09', 1],
      ['2026-08', 2],
      [null, 1],
    ])
  })

  it('monthOf：UTC 边界（全库时间口径 = UTC epoch 毫秒）', () => {
    expect(monthOf(Date.UTC(2026, 0, 1))).toBe('2026-01')
    expect(monthOf(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12')
  })
})
