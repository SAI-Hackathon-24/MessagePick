/**
 * 群消息来源的「写失败不得记为完成」回归护栏（P0）。
 *
 * 缺陷回顾：`collectGroup` 内部用 `write()` 落库，落库失败只把明细推进 `subFailures`，
 * 而 `collectGroup` 自身仍正常返回。调用处只看 `result.failure`，于是写失败的群被
 * `doneGroups.add(groupId)` 记为「已完成」并**删掉断点**；用户按来源重试时
 * `if (doneGroups.has(groupId)) continue` 直接跳过该群 → 来源报成功、
 * `updatedUntilX` 照常推进，而消息一条没入库：**假成功 + 数据永久缺失，重试无法补救**。
 *
 * 修复后的口径：
 * - 该群本轮出现过写失败 → 不加入 `doneGroups`、**保留断点**（`offsets[groupId]`）；
 * - 来源状态因 `subFailures` 非空而不为 `succeeded`；
 * - 带断点重试时该群会**重新采集**（而非跳过），且从断点 offset 续采。
 */
import { describe, expect, it } from 'vitest'

import {
  FakeCliRunner,
  FakeStore,
  ManualClock,
  cmd,
  collectContext,
  historyJson,
  makeGroupAdapter,
  makeMessageLine,
  membersJson,
  okReply,
  sessionsJson,
} from './harness'

const GROUP_A = 'g1@chatroom'

const sessionsOne = sessionsJson([{ chat: '群一', username: GROUP_A, isGroup: true }])
const membersOne = membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '阿黎' }] })
const historyOne = historyJson({ username: GROUP_A, messages: [makeMessageLine('2026-01-01 10:00:00', 'wxid_a', '你好')] })

describe('写失败不得记为「该群已完成」（P0 护栏）', () => {
  it('DM-003 写失败 → 来源非 succeeded，且该群不进入 doneGroups、断点保留', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsOne))
      .on(cmd('members'), okReply(membersOne))
      .on(cmd('history'), okReply(historyOne))

    // 注入：消息表整体写失败
    store.failWrites.add('DM-003')

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())

    // 来源必须有失败明细（不能报成功）
    expect(outcome.status).not.toBe('succeeded')
    expect(outcome.subFailures.length).toBeGreaterThan(0)
    expect(outcome.subFailures.some((f) => f.code === 'STORAGE_UNAVAILABLE')).toBe(true)

    // 关键：该群**不得**被记为已完成，否则重试会跳过它
    expect(outcome.checkpoint?.doneGroups ?? []).not.toContain(GROUP_A)
  })

  it('恢复存储后按来源重试：该群被重新采集，消息补齐', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    const reply = () => {
      runner
        .on(cmd('sessions'), okReply(sessionsOne))
        .on(cmd('members'), okReply(membersOne))
        .on(cmd('history'), okReply(historyOne))
    }
    reply()
    store.failWrites.add('DM-003')

    const adapter = makeGroupAdapter(store, runner, clock)
    const first = await adapter.collect(collectContext())
    expect(first.status).not.toBe('succeeded')
    expect(store.messages.size).toBe(0)

    // 存储恢复；带本轮断点重试（用新的 runner 记录本次调用）
    store.failWrites.delete('DM-003')
    const retryRunner = new FakeCliRunner()
    retryRunner
      .on(cmd('sessions'), okReply(sessionsOne))
      .on(cmd('members'), okReply(membersOne))
      .on(cmd('history'), okReply(historyOne))

    const retried = await makeGroupAdapter(store, retryRunner, clock).collect(collectContext({ checkpoint: first.checkpoint }))

    // 重试必须真的重新拉取该群（而不是因 doneGroups 跳过）
    expect(retryRunner.callsOf('history').length).toBeGreaterThan(0)
    expect(store.messages.size).toBe(1)
    expect(retried.status).toBe('succeeded')
    expect(retried.written).toBeGreaterThan(0)
  })

  it('无写失败时照常标记完成（护栏不误伤正常路径）', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsOne))
      .on(cmd('members'), okReply(membersOne))
      .on(cmd('history'), okReply(historyOne))

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())

    expect(outcome.status).toBe('succeeded')
    expect(outcome.checkpoint?.doneGroups ?? []).toContain(GROUP_A)
    expect(store.messages.size).toBe(1)
  })
})
