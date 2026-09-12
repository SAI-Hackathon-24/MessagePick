/**
 * 存储访问层（mod-006 §7「筛选契约」「护栏」行；§3.3、§4、§8 决策 4 / 5；REQ-006、REQ-049）：
 *
 * - 筛选组装只保留群 / 时间 / 关键词：身份字段显式剔除（模块二不使用身份）；
 * - 关键词只经 `API-004` 执行一次（模块内不做二次过滤 —— 替身不做关键词过滤，模块也不得过滤）；
 * - 分页：缺省 1 / 100、每页 ≤ 500、页码 ≥ 1；越界 → `INVALID_INPUT`；
 * - 读取一律带显式上限（硬上限截断 + 截断标记）；写入按 1000 行拆批。
 */

import { describe, expect, it } from 'vitest'

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '../constants'
import { EntryRepository } from '../store/entry-repository'
import { FakeStore, entry, message } from './harness'

describe('筛选组装（REQ-006 / REQ-049；§8 决策 5）', () => {
  it('只保留群 / 时间 / 关键词；身份字段显式剔除', () => {
    const repository = new EntryRepository(new FakeStore())
    const filter = { groupIds: ['g1'], timeRange: { from: 1, to: 2 }, keyword: '缴费', identity: 'me-1' }
    expect(repository.moduleFilter(filter)).toEqual({ groupIds: ['g1'], timeRange: { from: 1, to: 2 }, keyword: '缴费' })
    expect(repository.moduleFilter(null)).toBeNull()
    expect(repository.moduleFilter(undefined)).toBeNull()
  })

  it('关键词原样透传、模块内不再二次过滤（替身不过滤也不应被模块过滤）', () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', headline: '不含关键词的标题' })] })
    const repository = new EntryRepository(store)
    const result = repository.readEntries({ keyword: '缴费', identity: 'me-1' })
    expect(result.total).toBe(1)
    expect(result.records).toHaveLength(1)
    const call = store.readCalls.at(-1)
    expect(call?.filter).toEqual({ groupIds: null, timeRange: null, keyword: '缴费' })
  })

  it('readEntryPage：模块页参数原样交 API-004', () => {
    const store = new FakeStore({ entries: [entry({ entryId: 'e1' })] })
    const repository = new EntryRepository(store)
    repository.readEntryPage({ keyword: 'x' }, { page: 2, pageSize: 50 })
    expect(store.readCalls.at(-1)).toEqual({
      type: 'DM-010',
      filter: { groupIds: null, timeRange: null, keyword: 'x' },
      page: { page: 2, pageSize: 50 },
    })
  })
})

describe('分页护栏（§8 决策 4；详设 §5.3）', () => {
  const repository = new EntryRepository(new FakeStore())

  it('缺省调用 = 第一页 / 默认每页（不传即兼容契约声明）', () => {
    expect(repository.normalizePage(null, PAGE_SIZE_DEFAULT)).toEqual({ page: 1, pageSize: PAGE_SIZE_DEFAULT })
    expect(repository.normalizePage({}, PAGE_SIZE_DEFAULT)).toEqual({ page: 1, pageSize: PAGE_SIZE_DEFAULT })
  })

  it('可显式传页码与每页；每页到上限仍合法', () => {
    expect(repository.normalizePage({ page: 3, pageSize: PAGE_SIZE_MAX }, PAGE_SIZE_DEFAULT)).toEqual({
      page: 3,
      pageSize: PAGE_SIZE_MAX,
    })
  })

  it('页码 < 1 / 每页 > 上限 / 非整数 → INVALID_INPUT', () => {
    expect(() => repository.normalizePage({ page: 0 }, PAGE_SIZE_DEFAULT)).toThrowError('页码非法')
    expect(() => repository.normalizePage({ page: -1 }, PAGE_SIZE_DEFAULT)).toThrowError('页码非法')
    expect(() => repository.normalizePage({ pageSize: PAGE_SIZE_MAX + 1 }, PAGE_SIZE_DEFAULT)).toThrowError(
      '每页条数超出上限',
    )
    expect(() => repository.normalizePage({ pageSize: 1.5 }, PAGE_SIZE_DEFAULT)).toThrowError('每页条数非法')
  })
})

describe('读取与截断（详设 §5.4）', () => {
  const entries = Array.from({ length: 5 }, (_, index) => entry({ entryId: `e${index}` }))

  it('分页拼接读尽：翻页直至 total，无截断', () => {
    const store = new FakeStore({ entries })
    const repository = new EntryRepository(store, { readPageSize: 2 })
    const result = repository.readEntries(null)
    expect(result.records.map((record) => record.entryId)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
    expect(result.total).toBe(5)
    expect(result.truncated).toBe(false)
    expect(
      store.readCalls.filter((call) => call.type === 'DM-010').map((call) => call.page?.page),
    ).toEqual([1, 2, 3])
  })

  it('硬上限截断：超出即带 truncated 标记，不静默吞掉事实', () => {
    const repository = new EntryRepository(new FakeStore({ entries }), { readPageSize: 2, entryHardCap: 3 })
    const result = repository.readEntries(null)
    expect(result.records).toHaveLength(3)
    expect(result.total).toBe(5)
    expect(result.truncated).toBe(true)
  })

  it('单条查找 / 空态判定 / 总数直读', () => {
    const repository = new EntryRepository(new FakeStore({ entries }))
    expect(repository.findEntry('e3', null)?.entryId).toBe('e3')
    expect(repository.findEntry('missing', null)).toBeNull()
    expect(repository.hasAnyEntry()).toBe(true)
    expect(repository.countEntries(null).total).toBe(5)
    expect(new EntryRepository(new FakeStore()).hasAnyEntry()).toBe(false)
  })

  it('窗口消息读取：按时间范围（`API-004`）取数，由管线按群分片', () => {
    const store = new FakeStore({
      messages: [message('m1', 'g1', 1000), message('m2', 'g1', 2000), message('m3', 'g2', 3000)],
    })
    const repository = new EntryRepository(store)
    expect(repository.readWindowMessages({ from: 1000, to: 2000 }).map((item) => item.messageId)).toEqual(['m1', 'm2'])
  })
})

describe('写入（§5.1；详设 §3.2）', () => {
  it('写批拆分：单批 ≤ 1000 行、批间以身份幂等可重放', () => {
    const store = new FakeStore()
    const repository = new EntryRepository(store)
    const records = Array.from({ length: 1001 }, (_, index) => entry({ entryId: `w${index}` }))
    const result = repository.writeEntries(records, { bumpEpoch: false })
    expect(result).toEqual({ written: 1001, failures: [] })
    expect(store.writeCalls).toEqual([
      { type: 'DM-010', count: 1000 },
      { type: 'DM-010', count: 1 },
    ])
  })
})

describe('水位事实（§5.2；排序时间 = 最早来源消息发送时间）', () => {
  it('取最新条目的排序时间（来源消息中最早的发送时间）', () => {
    const store = new FakeStore({
      messages: [message('m1', 'g1', 1000), message('m2', 'g1', 3000)],
      entries: [entry({ entryId: 'e-new', groupId: 'g1', sourceMessageIds: ['m1', 'm2'] })],
    })
    expect(new EntryRepository(store).watermarkFacts()).toEqual({ hasEntries: true, latestEntrySourceTime: 1000 })
  })

  it('无条目 → 冷启动事实；来源全部不可解析 → 保守回退（null）', () => {
    expect(new EntryRepository(new FakeStore()).watermarkFacts()).toEqual({
      hasEntries: false,
      latestEntrySourceTime: null,
    })
    const store = new FakeStore({ entries: [entry({ entryId: 'e1', groupId: 'g1', sourceMessageIds: ['gone'] })] })
    expect(new EntryRepository(store).watermarkFacts()).toEqual({ hasEntries: true, latestEntrySourceTime: null })
  })
})
