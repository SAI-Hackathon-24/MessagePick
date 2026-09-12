/**
 * 群消息来源适配器（mod-001 §7「运行编排」/「写入与幂等」行；§5.1、§5.4）：
 *
 * - 部分失败不阻塞：单群失败进 `subFailures`，其余群继续；来源状态 = 全部子分项成功才 `succeeded`；
 * - 分项重试：带断点重跑时跳过已完成群、从失败分页的 offset 继续（`AC-008` 的断点口径）；
 * - 写入顺序受立即外键约束：`DM-002` → `DM-004`（含占位成员）→ `DM-003`；
 * - 重复采集按记录身份去重（同一范围重采不产生副本）；
 * - `me` 在多个群出现时「全库至多一条」`isMe`。
 *
 * CLI 子进程一律 mock（`FakeCliRunner`）；解析走真实代码。
 */

import { describe, expect, it } from 'vitest'

import { ME_MEMBER_ID } from '../mapping/identity'

import {
  FakeCliRunner,
  FakeStore,
  ManualClock,
  NOW,
  cmd,
  cmdFor,
  collectContext,
  failReply,
  historyJson,
  makeGroupAdapter,
  makeMessageLine,
  membersJson,
  okReply,
  sessionsJson,
  timeoutReply,
} from './harness'

const GROUP_A = 'g1@chatroom'
const GROUP_B = 'g2@chatroom'

function sessionsWithBothGroups(): string {
  return sessionsJson([
    { chat: '群一', username: GROUP_A, isGroup: true },
    { chat: '群二', username: GROUP_B, isGroup: true },
  ])
}

describe('完整成功：写入顺序、完成时间与断点', () => {
  it('sessions → members → history；`DM-002` / `DM-004` / `DM-003` 依次落库', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsJson([{ chat: '群一', username: GROUP_A, isGroup: true }])))
      .on(cmd('members'), okReply(membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '张三' }] })))
      .on(
        cmd('history'),
        okReply(historyJson({ username: GROUP_A, messages: [makeMessageLine('2026-09-01 10:30', '张三', '晚上吃啥')] })),
      )

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())

    // `written` = 经 API-003 成功写入的记录数（§3.3）：DM-002 群 1 + DM-004 成员 1 + DM-003 消息 1
    expect(outcome).toMatchObject({ source: '群消息', status: 'succeeded', written: 3, completedAt: NOW })
    expect(outcome.subFailures).toEqual([])
    expect(outcome.checkpoint?.doneGroups).toEqual([GROUP_A])
    expect(store.groups.get(GROUP_A)).toEqual({ groupId: GROUP_A, groupName: '群一' })
    expect([...store.messages.values()][0]).toMatchObject({
      groupId: GROUP_A,
      senderMemberId: 'wxid_a',
      kind: '文字',
      text: '晚上吃啥',
      mediaRef: null,
    })
    // 首次全量：不带时间窗（增量窗口只在指定来源重试 / 后续运行时给出）
    expect(runner.callsOf('history')[0]?.args).toEqual(['history', GROUP_A, '--limit', '100', '--offset', '0'])
    expect(runner.callsOf('sessions')[0]?.args).toEqual(['sessions', '--limit', '200'])
  })

  it('增量窗口：`--start-time` / `--end-time` 采用 CLI 的秒级本机时区格式', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsJson([{ chat: '群一', username: GROUP_A, isGroup: true }])))
      .on(cmd('members'), okReply(membersJson({ group: '群一', username: GROUP_A, members: [] })))
      .on(cmd('history'), okReply(historyJson({ username: GROUP_A, messages: [] })))

    const from = new Date(2026, 8, 1, 9, 0, 0).getTime()
    const to = new Date(2026, 8, 1, 10, 0, 0).getTime()
    await makeGroupAdapter(store, runner, clock).collect(collectContext({ window: { from, to } }))

    const args = runner.callsOf('history')[0]!.args
    expect(args).toContain('--start-time')
    expect(args[args.indexOf('--start-time') + 1]).toBe('2026-09-01 09:00:00')
    expect(args[args.indexOf('--end-time') + 1]).toBe('2026-09-01 10:00:00')
  })

  it('重复采集按记录身份去重：同一范围重采不产生副本', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    const script = () =>
      runner
        .on(cmd('sessions'), okReply(sessionsJson([{ chat: '群一', username: GROUP_A, isGroup: true }])))
        .on(cmd('members'), okReply(membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '张三' }] })))
        .on(cmd('history'), okReply(historyJson({ username: GROUP_A, messages: [makeMessageLine('2026-09-01 10:30', '张三', '晚上吃啥')] })))
    script()
    const adapter = makeGroupAdapter(store, runner, clock)
    await adapter.collect(collectContext())
    const messagesAfterFirst = store.messages.size
    const membersAfterFirst = store.members.size

    const second = await adapter.collect(collectContext())
    expect(second.status).toBe('succeeded')
    expect(store.messages.size).toBe(messagesAfterFirst)
    expect(store.members.size).toBe(membersAfterFirst)
  })
})

describe('部分失败不阻塞 + 分项重试', () => {
  it('单群失败不阻塞其余群；重试只跑失败群并跳过已完成分项', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsWithBothGroups()))
      .on(cmdFor('members', GROUP_A), okReply(membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '张三' }] })))
      .on(cmdFor('members', GROUP_B), okReply(membersJson({ group: '群二', username: GROUP_B, members: [{ username: 'wxid_b', displayName: '李四' }] })))
      .on(cmdFor('history', GROUP_A), failReply(2), { once: true }) // 参数非法：不重试、也不阻塞 g2；仅首次运行生效
      .on(
        cmdFor('history', GROUP_B),
        okReply(historyJson({ username: GROUP_B, messages: [makeMessageLine('2026-09-01 10:30', '李四', '收到')] })),
      )

    const adapter = makeGroupAdapter(store, runner, clock)
    const first = await adapter.collect(collectContext())

    expect(first.status).toBe('failed')
    // `written` = 经 API-003 成功写入的记录数（§3.3）：DM-002×2 + DM-004×2 + DM-003×1（g2 的消息）
    expect(first.written).toBe(5)
    expect(first.failure).toMatchObject({ code: 'SOURCE_UNAVAILABLE', scope: `群消息:${GROUP_A}` })
    expect(first.subFailures.map((item) => item.scope)).toContain(`群消息:${GROUP_A}`)
    expect(store.groups.size).toBe(2) // 两个群的 DM-002 都已写入（失败不阻塞前置结构）
    expect(store.messages.size).toBe(1) // 只有 g2 的消息
    expect(first.checkpoint?.doneGroups).toEqual([GROUP_B])
    expect(first.checkpoint?.offsets).toEqual({ [GROUP_A]: 0 })

    // 分项重试：带断点重跑 → 只补 g1
    runner.on(
      cmdFor('history', GROUP_A),
      okReply(historyJson({ username: GROUP_A, messages: [makeMessageLine('2026-09-01 10:31', '张三', '我来了')] })),
    )
    const retried = await adapter.collect(collectContext({ checkpoint: first.checkpoint }))

    expect(retried.status).toBe('succeeded')
    // 只重跑 g1：DM-002 + DM-004 + DM-003 各 1 条（upsert 不失败 → 仍计入 written）
    expect(retried.written).toBe(3)
    expect(store.messages.size).toBe(2)
    // 已完成分项 g2 不再执行（members / history 都只调用过一次）
    expect(runner.callsOf('members').filter((call) => call.args[1] === GROUP_B)).toHaveLength(1)
    expect(runner.callsOf('history').filter((call) => call.args[1] === GROUP_B)).toHaveLength(1)
  })

  it('分页中断：从失败分页的 offset 继续，不重拉已入库分页', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsJson([{ chat: '群一', username: GROUP_A, isGroup: true }])))
      .on(cmd('members'), okReply(membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '张三' }] })))
      .on(
        cmd('history'),
        okReply(
          historyJson({
            username: GROUP_A,
            messages: [makeMessageLine('2026-09-01 10:30', '张三', '第一页甲'), makeMessageLine('2026-09-01 10:31', '张三', '第一页乙')],
          }),
        ),
        { once: true },
      )
      .on(cmd('history'), failReply(3), { once: true })
      .on(
        cmd('history'),
        okReply(historyJson({ username: GROUP_A, messages: [makeMessageLine('2026-09-01 11:00', '张三', '第二页')] })),
        { once: true },
      )

    const adapter = makeGroupAdapter(store, runner, clock, { pageSize: 2 })
    const first = await adapter.collect(collectContext())
    expect(first.status).toBe('failed')
    expect(first.checkpoint?.offsets).toEqual({ [GROUP_A]: 2 })
    expect(store.messages.size).toBe(2) // 第一页已入库，不重复拉取

    const retried = await adapter.collect(collectContext({ checkpoint: first.checkpoint }))
    expect(retried.status).toBe('succeeded')
    expect(runner.callsOf('history').map((call) => call.args[call.args.indexOf('--offset') + 1])).toEqual([
      '0',
      '2',
      '2',
    ])
    expect(store.messages.size).toBe(3)
  })

  it('CLI 逐条失败（`failures`）进分项明细：已成功行照常返回、不静默', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsJson([{ chat: '群一', username: GROUP_A, isGroup: true }])))
      .on(cmd('members'), okReply(membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '张三' }] })))
      .on(
        cmd('history'),
        okReply(
          historyJson({
            username: GROUP_A,
            messages: [makeMessageLine('2026-09-01 10:30', '张三', '好的')],
            failures: ['id=12: 解密失败'],
          }),
        ),
      )

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())
    expect(outcome.status).toBe('failed')
    // 已成功行照常写入（群 / 成员 / 消息共 3 条）；CLI 逐条失败只进 subFailures，不静默
    expect(outcome.written).toBe(3)
    expect(outcome.subFailures.map((item) => item.code)).toContain('SOURCE_UNAVAILABLE')
    expect(outcome.subFailures.some((item) => item.reason.includes('逐条失败 1 条'))).toBe(true)
  })
})

describe('发送者解析与「我」的唯一性', () => {
  it('解析不到的发送者补占位成员，消息不因立即外键丢失', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsJson([{ chat: '群一', username: GROUP_A, isGroup: true }])))
      .on(cmd('members'), okReply(membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '张三' }] })))
      .on(
        cmd('history'),
        okReply(
          historyJson({
            username: GROUP_A,
            messages: [makeMessageLine('2026-09-01 10:30', '野生陌生人', '你们好')],
          }),
        ),
      )

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())
    expect(outcome.status).toBe('succeeded')
    expect(store.members.has(`野生陌生人`)).toBe(false) // 键是 群 + 成员
    expect([...store.members.values()].some((member) => member.memberId === '野生陌生人')).toBe(true)
    expect(store.messages.size).toBe(1)
    expect([...store.messages.values()][0]?.senderMemberId).toBe('野生陌生人')
  })

  it('`me` 跨群出现：每群一行、全库只有一行 isMe', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsWithBothGroups()))
      .on(cmdFor('members', GROUP_A), okReply(membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '张三' }] })))
      .on(cmdFor('members', GROUP_B), okReply(membersJson({ group: '群二', username: GROUP_B, members: [{ username: 'wxid_b', displayName: '李四' }] })))
      .on(
        cmdFor('history', GROUP_A),
        okReply(historyJson({ username: GROUP_A, messages: [makeMessageLine('2026-09-01 10:30', 'me', '我先说')] })),
      )
      .on(
        cmdFor('history', GROUP_B),
        okReply(historyJson({ username: GROUP_B, messages: [makeMessageLine('2026-09-01 10:31', 'me', '我也说')] })),
      )

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())
    expect(outcome.status).toBe('succeeded')
    expect(store.meMembers()).toHaveLength(1)
    expect([...store.members.values()].filter((member) => member.memberId === ME_MEMBER_ID)).toHaveLength(2)
  })
})

describe('来源级失败与指定来源重试（回归 §6.1 表）', () => {
  it('sessions 退出码 1（未初始化）→ 无授权，不写入任何记录', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner.on(cmd('sessions'), failReply(1))

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())
    expect(outcome).toMatchObject({ status: 'noAuth', written: 0 })
    expect(outcome.failure).toMatchObject({ code: 'NO_AUTH', retryable: false })
    expect(store.writeCalls).toEqual([])
    expect(outcome.checkpoint).toBeUndefined()
  })

  it('history 超时 → 来源状态 = 超时（TIMEOUT 可重试）', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('sessions'), okReply(sessionsJson([{ chat: '群一', username: GROUP_A, isGroup: true }])))
      .on(cmd('members'), okReply(membersJson({ group: '群一', username: GROUP_A, members: [{ username: 'wxid_a', displayName: '张三' }] })))
      .on(cmd('history'), timeoutReply())

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())
    expect(outcome).toMatchObject({ status: 'timeout' })
    expect(outcome.failure).toMatchObject({ code: 'TIMEOUT', retryable: true })
  })

  it('非群会话（私聊）不进入群消息来源', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner.on(cmd('sessions'), okReply(sessionsJson([{ chat: '张三', username: 'wxid_zhang' }])))

    const outcome = await makeGroupAdapter(store, runner, clock).collect(collectContext())
    expect(outcome).toMatchObject({ status: 'succeeded', written: 0 })
    expect(runner.callsOf('members')).toHaveLength(0)
    expect(runner.callsOf('history')).toHaveLength(0)
  })
})
