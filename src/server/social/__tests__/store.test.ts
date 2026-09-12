/**
 * MOD-007 存储适配层（mod-007 §3.1「store/」、§5.6；`REQ-016`）。
 *
 * 全部读写经假端口（`FakeStore`）验证**调用形态**：显式分页、按批写入（≤ 1000 行 / 批）、
 * `dataEpoch` 观测触发全量失效——不真开库（§7「mock 边界」）。
 */

import { describe, expect, it } from 'vitest'

import {
  PAGE_SIZE_MAX,
  WRITE_BATCH_MAX,
  createEpochWatcher,
  createStorePort,
  readAll,
  readMembers,
  writeAll,
  writeMyFit,
} from '../store'

import { FakeStore, interestTag, member, personRecord } from './fixtures'

describe('分页读取（API-004 适配）', () => {
  it('按页读尽：3 条记录 / 每页 2 条 → 两次读取、结果完整', () => {
    const store = new FakeStore()
    store.seed('DM-004', [member('m1', 'g1'), member('m2', 'g1'), member('m3', 'g2')])

    const records = readAll(store, 'DM-004', null, 2)

    expect(records.map((row) => row.memberId)).toEqual(['m1', 'm2', 'm3'])
    expect(store.readCalls.map((call) => [call.page, call.pageSize])).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  it('空表一次调用即返回空集（不无限翻页）', () => {
    const store = new FakeStore()

    expect(readAll(store, 'DM-011')).toEqual([])
    expect(store.readCalls).toHaveLength(1)
  })

  it('翻页不重不漏：恰好整除时在第二页停止', () => {
    const store = new FakeStore()
    store.seed('DM-004', [member('m1', 'g1'), member('m2', 'g1'), member('m3', 'g1'), member('m4', 'g1')])

    const records = readAll(store, 'DM-004', null, 2)
    expect(records).toHaveLength(4)
    expect(store.readCalls).toHaveLength(2)
  })

  it('默认每页取上限 1000（显式分页护栏），筛选条件原样透传', () => {
    const store = new FakeStore()
    const filter = { groupIds: ['g1'], keyword: '羽毛球' }

    readAll(store, 'DM-003', filter)

    expect(store.readCalls[0]).toMatchObject({ page: 1, pageSize: PAGE_SIZE_MAX, filter })
  })

  it('读取器指定实体类型（按实体键读取，不自行扩展契约）', () => {
    const store = new FakeStore()
    store.seed('DM-004', [member('m1', 'g1', '爱丽丝')])

    expect(readMembers(store).map((row) => row.displayName)).toEqual(['爱丽丝'])
    expect(store.readCalls[0]?.type).toBe('DM-004')
  })
})

describe('批量写入（API-003 适配）', () => {
  it('单批写入：不足 1000 行一次提交', () => {
    const store = new FakeStore()
    const people = [personRecord('p1'), personRecord('p2')]

    const result = writeAll(store, 'DM-011', people)

    expect(result.written).toBe(2)
    expect(store.writeCalls).toEqual([{ type: 'DM-011', count: 2, bumpEpoch: undefined }])
  })

  it('按批拆分：2500 行 → 1000 / 1000 / 500 三批提交', () => {
    const store = new FakeStore()
    const people = Array.from({ length: 2500 }, (_, index) => personRecord(`p${index}`))

    const result = writeAll(store, 'DM-011', people)

    expect(store.writeCalls.map((call) => call.count)).toEqual([1000, 1000, 500])
    expect(result.written).toBe(2500)
    expect(Math.max(...store.writeCalls.map((call) => call.count))).toBeLessThanOrEqual(WRITE_BATCH_MAX)
  })

  it('失败明细跨批合并返回（单条失败不升级为契约错误码）', () => {
    const store = new FakeStore()
    store.failures = [{ identity: ['p1'], reason: '约束拒绝' }]

    const result = writeAll(store, 'DM-011', [
      personRecord('p1'),
      personRecord('p2'),
    ])

    expect(result.written).toBe(2)
    expect(result.failures).toHaveLength(1)
  })

  it('bumpEpoch 选项透传（epoch 推进由调用方声明）', () => {
    const store = new FakeStore()

    writeAll(store, 'DM-013', [interestTag('运动:羽毛球', '羽毛球', '运动')], { bumpEpoch: true })

    expect(store.writeCalls).toEqual([{ type: 'DM-013', count: 1, bumpEpoch: true }])
  })

  it('writeMyFit 写入单条 DM-019', () => {
    const store = new FakeStore()

    writeMyFit(store, { pairIds: ['p1+p2'], overallFit: 70 })

    expect(store.writeCalls).toEqual([{ type: 'DM-019', count: 1, bumpEpoch: undefined }])
  })
})

describe('dataEpoch 观测（§5.2 失效口径）', () => {
  it('首次观测视为变化；同 epoch 不失效；epoch 推进触发全量失效', () => {
    const store = new FakeStore()
    const watcher = createEpochWatcher(store)

    expect(watcher.sync()).toEqual({ epoch: 1, bumped: true })
    expect(watcher.sync()).toEqual({ epoch: 1, bumped: false })
    expect(watcher.peek()).toBe(1)

    store.epoch = 2
    expect(watcher.sync()).toEqual({ epoch: 2, bumped: true })
    expect(watcher.sync()).toEqual({ epoch: 2, bumped: false })
  })
})

describe('端口装配', () => {
  it('createStorePort 是恒等装配（真实实现由 @server/store 注入）', () => {
    const store = new FakeStore()
    expect(createStorePort(store)).toBe(store)
  })

  it('护栏常量：单页 / 单批上限均为 1000（mod-002 §4）', () => {
    expect(PAGE_SIZE_MAX).toBe(1000)
    expect(WRITE_BATCH_MAX).toBe(1000)
  })
})
