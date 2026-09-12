/**
 * MOD-005 §7「store/paging」测试面（mock `API-003` / `API-004`）：
 *
 * 分页拼接与硬上限截断、单时间点窄窗读取与一次容错扩窗、写批 1 000 行 / 2 MB 拆批、
 * `STORAGE_UNAVAILABLE` 原样透传（不静默吞错）。
 */

import { describe, expect, it } from 'vitest'
import type { ErrorEnvelope } from '@shared'

import { REF_READ_EXPAND_MS, REF_READ_WINDOW_MS, WRITE_BATCH_BYTES, WRITE_BATCH_ROWS } from '../constants'
import { MemeStore, splitWriteBatches } from '../store/memeStore'
import { collectRead } from '../store/paging'
import { FakeStore, ForeignModuleError, createStore, daysBefore, makeMeme, makeMessage } from './harness'

const GROUP = 'g1'

function seedMemes(port: FakeStore, count: number): void {
  port.seed(
    'DM-006',
    Array.from({ length: count }, (_, index) =>
      makeMeme({ memeId: `m${index + 1}`, groupId: GROUP, name: `梗${index + 1}` }),
    ),
  )
}

const STORAGE_ERROR: ErrorEnvelope = {
  code: 'STORAGE_UNAVAILABLE',
  message: '存储不可用',
  retryable: true,
  scope: 'store',
}

describe('MOD-005 paging：分页拼接与硬上限截断', () => {
  it('默认页 1 000：逐页拼接取全量、翻页不重不漏', async () => {
    const port = new FakeStore()
    seedMemes(port, 2_500)
    const store = new MemeStore(port)

    const read = await collectRead(store.readAll('DM-006', null))
    expect(read.records).toHaveLength(2_500)
    expect(new Set(read.records.map((record) => record.memeId)).size).toBe(2_500)
    expect(read.total).toBe(2_500)
    expect(read.truncated).toBe(false)
    expect(port.reads.map((call) => call.page.page)).toEqual([1, 2, 3])
  })

  it('触达硬上限：截断并标记，已读条数恰好等于上限（截断信息随响应可返回）', async () => {
    const port = new FakeStore()
    seedMemes(port, 2_500)
    const store = new MemeStore(port)

    const read = await collectRead(store.readAll('DM-006', null, 1_500))
    expect(read.records).toHaveLength(1_500)
    expect(read.total).toBe(2_500)
    expect(read.truncated).toBe(true)
    expect(port.reads.map((call) => call.page.page)).toEqual([1, 2])
  })

  it('hardCap = 1（hasAnyData 口径）：只读 1 条即停，仍带总数与截断标记', async () => {
    const port = new FakeStore()
    port.seed(
      'DM-003',
      Array.from({ length: 5 }, (_, index) =>
        makeMessage({ messageId: `msg${index}`, groupId: GROUP, senderMemberId: 'u_a', sentAt: index }),
      ),
    )
    const store = new MemeStore(port)
    const read = await collectRead(store.readAll('DM-003', null, 1))
    expect(read.records).toHaveLength(1)
    expect(read.total).toBe(5)
    expect(read.truncated).toBe(true)
  })

  it('筛选条件原样透传给存储通道', async () => {
    const port = new FakeStore()
    seedMemes(port, 2)
    const store = new MemeStore(port)
    const filter = { groupIds: [GROUP], keyword: '梗1' }
    await collectRead(store.readAll('DM-006', filter))
    expect(port.reads[0]?.filter).toEqual(filter)
  })
})

describe('MOD-005 paging：单时间点窄窗读取（§8 决策 1）', () => {
  it('窄窗命中：窗宽 ≤ 2 s（±1 s）一次读取即返回', async () => {
    const port = new FakeStore()
    const target = daysBefore(2)
    port.seed('DM-003', [
      makeMessage({ messageId: 'hit', groupId: GROUP, senderMemberId: 'u_a', sentAt: target }),
      makeMessage({ messageId: 'far', groupId: GROUP, senderMemberId: 'u_a', sentAt: target + 5_000 }),
    ])
    const store = new MemeStore(port)

    const records = await store.readAt('DM-003', { groupIds: [GROUP] }, target)
    expect(records.map((record) => record.messageId)).toEqual(['hit'])
    expect(port.reads).toHaveLength(1)
    expect(port.reads[0]?.filter?.timeRange).toEqual({
      from: target - REF_READ_WINDOW_MS,
      to: target + REF_READ_WINDOW_MS,
    })
  })

  it('窄窗未命中：做一次容错扩窗（±15 s）；扩窗仍空则不再重试', async () => {
    const port = new FakeStore()
    const target = daysBefore(2)
    port.seed('DM-003', [
      makeMessage({ messageId: 'nearby', groupId: GROUP, senderMemberId: 'u_a', sentAt: target + 5_000 }),
    ])
    const store = new MemeStore(port)

    const records = await store.readAt('DM-003', { groupIds: [GROUP] }, target)
    expect(records.map((record) => record.messageId)).toEqual(['nearby'])
    expect(port.reads).toHaveLength(2)
    expect(port.reads[1]?.filter?.timeRange).toEqual({
      from: target - REF_READ_EXPAND_MS,
      to: target + REF_READ_EXPAND_MS,
    })

    const missing = await store.readAt('DM-003', { groupIds: [GROUP] }, target + 100_000_000)
    expect(missing).toEqual([])
    expect(port.reads).toHaveLength(4)
  })
})

describe('MOD-005 写批拆分（详设 §3.2：1 000 行 / 2 MB 先到者为限）', () => {
  it('按行数拆批：2 500 行 → 1 000 / 1 000 / 500；空数组不产生批次', () => {
    const rows = Array.from({ length: 2_500 }, (_, index) => ({ id: index }))
    expect(splitWriteBatches(rows).map((batch) => batch.length)).toEqual([1_000, 1_000, 500])
    expect(splitWriteBatches([])).toEqual([])
  })

  it('按字节拆批：单批不超过 2 MB，先到者为限', () => {
    const big = Array.from({ length: 4 }, (_, index) => ({ id: index, text: 'x'.repeat(600_000) }))
    const batches = splitWriteBatches(big)
    expect(batches.map((batch) => batch.length)).toEqual([3, 1])
    expect(batches.flat()).toHaveLength(4)
    expect(big.every((row) => JSON.stringify(row).length < WRITE_BATCH_BYTES / 2)).toBe(true)
  })

  it('upsertEntities 逐批提交并聚合写入结果', async () => {
    const { port, store } = createStore()
    const rows = Array.from({ length: 2_500 }, (_, index) =>
      makeMeme({ memeId: `m${index + 1}`, groupId: GROUP, name: `梗${index + 1}` }),
    )
    const result = await store.upsertEntities('DM-006', rows)
    expect(port.writes.map((call) => call.records.length)).toEqual([1_000, 1_000, 500])
    expect(result).toEqual({ written: 2_500, failures: [] })
  })

  it('upsertEntities 聚合失败明细，不吞掉成功批次', async () => {
    const { port, store } = createStore()
    const rows = Array.from({ length: 2_500 }, (_, index) =>
      makeMeme({ memeId: `m${index + 1}`, groupId: GROUP, name: index === 1_200 ? 'bad' : `梗${index + 1}` }),
    )
    port.writeFailures = (_type, batch) =>
      batch.some((record) => (record as { name: string }).name === 'bad')
        ? [{ identity: ['bad'], reason: '测试注入：拒绝写入' }]
        : null
    const result = await store.upsertEntities('DM-006', rows)
    expect(result.failures).toEqual([{ identity: ['bad'], reason: '测试注入：拒绝写入' }])
    expect(result.written).toBe(1_500)
    expect(WRITE_BATCH_ROWS).toBe(1_000)
  })
})

describe('MOD-005 store：STORAGE_UNAVAILABLE 透传（§6）', () => {
  it('读取失败：错误实例原样上抛（不被包装、不静默）', async () => {
    const port = new FakeStore()
    seedMemes(port, 1)
    port.failReadWith = STORAGE_ERROR
    const store = new MemeStore(port)

    const error = await collectRead(store.readAll('DM-006', null)).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ForeignModuleError)
    expect((error as ForeignModuleError).envelope.code).toBe('STORAGE_UNAVAILABLE')
  })

  it('写入失败：错误实例原样上抛', async () => {
    const { port, store } = createStore()
    port.failWriteWith = STORAGE_ERROR
    const error = await store
      .upsertEntities('DM-006', [makeMeme({ memeId: 'm1', groupId: GROUP, name: '梗' })])
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ForeignModuleError)
    expect((error as ForeignModuleError).envelope).toEqual(STORAGE_ERROR)
  })
})
