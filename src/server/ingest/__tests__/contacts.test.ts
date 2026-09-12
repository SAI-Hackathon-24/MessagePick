/**
 * 通讯录与好友列表来源适配器（mod-001 §7「运行编排」/「写入与幂等」行；`REQ-082`）：
 *
 * - 两个子项：`contacts` → 通讯录；`sessions` 里的私聊 → 好友列表（都写 `DM-005`，来源字段区分）；
 * - 子项失败不阻塞另一子项；带断点重试只补失败子项；
 * - 按批写入（单批上限 1000 行，详设 §3.2）；
 * - 本来源不推进「记录更新至 X」——由执行器的状态写入保证（本文件只验证适配器结果，X 口径见 state 测试）。
 */

import { describe, expect, it } from 'vitest'

import {
  FakeCliRunner,
  FakeStore,
  ManualClock,
  NOW,
  cmd,
  collectContext,
  contactsJson,
  failReply,
  makeContactsAdapter,
  okReply,
  sessionsJson,
} from './harness'

const GROUP = 'g1@chatroom'
const FRIEND = 'wxid_zhang'

function sessionsPayload(): string {
  return sessionsJson([
    { chat: '群一', username: GROUP, isGroup: true },
    { chat: '张三', username: FRIEND },
  ])
}

describe('两个子项与来源标注', () => {
  it('通讯录与好友列表分别写入 DM-005；群条目不进好友列表', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('contacts'), okReply(contactsJson([{ username: 'wxid_c', remark: '备注C' }])))
      .on(cmd('sessions'), okReply(sessionsPayload()))

    const outcome = await makeContactsAdapter(store, runner, clock).collect(collectContext())

    expect(outcome).toMatchObject({ source: '通讯录与好友列表', status: 'succeeded', written: 2, completedAt: NOW })
    const byKey = new Map([...store.contacts.values()].map((record) => [`${record.contactId}:${record.source}`, record]))
    expect(byKey.get('wxid_c:通讯录')).toEqual({ contactId: 'wxid_c', displayName: '备注C', source: '通讯录' })
    expect(byKey.get('wxid_zhang:好友列表')).toEqual({ contactId: FRIEND, displayName: '张三', source: '好友列表' })
    expect(byKey.size).toBe(2)
    expect(store.groups.size).toBe(0) // 群不会作为联系人写入
    expect(runner.callsOf('contacts')[0]?.args).toEqual(['contacts', '--limit', '1000'])
  })

  it('子项失败不阻塞另一子项；带断点重试只补失败子项', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner
      .on(cmd('contacts'), failReply(2), { once: true }) // 参数非法：不重试
      .on(cmd('sessions'), okReply(sessionsPayload()))

    const adapter = makeContactsAdapter(store, runner, clock)
    const first = await adapter.collect(collectContext())

    expect(first.status).toBe('failed')
    expect(first.written).toBe(1) // 好友列表照常完成
    expect(first.failure?.code).toBe('SOURCE_UNAVAILABLE')
    expect([...store.contacts.values()]).toEqual([
      { contactId: FRIEND, displayName: '张三', source: '好友列表' },
    ])
    expect(first.checkpoint?.doneGroups).toEqual(['friends'])

    runner.on(cmd('contacts'), okReply(contactsJson([{ username: 'wxid_c', remark: '备注C' }])))
    const retried = await adapter.collect(collectContext({ checkpoint: first.checkpoint }))

    expect(retried.status).toBe('succeeded')
    // `written` = **本次运行**经 API-003 成功写入的记录数（§3.3）：只补「通讯录」1 条；
    // 好友列表的 1 条是上一轮写入的，不在本次计数内（库里累计 = store.contacts.size = 2）
    expect(retried.written).toBe(1)
    expect(runner.callsOf('sessions')).toHaveLength(1) // 已完成子项不再执行
    expect(store.contacts.size).toBe(2)
  })

  it('两子项都失败 → 来源失败，失败明细含两个子项', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    runner.on(cmd('contacts'), failReply(2)).on(cmd('sessions'), failReply(2))

    const outcome = await makeContactsAdapter(store, runner, clock).collect(collectContext())
    expect(outcome.status).toBe('failed')
    expect(outcome.subFailures).toHaveLength(2)
    expect(outcome.written).toBe(0)
  })
})

describe('按批写入（单批 ≤ 1000 行）', () => {
  it('1001 条联系人拆成 1000 + 1 两批', async () => {
    const store = new FakeStore()
    const runner = new FakeCliRunner()
    const clock = new ManualClock()
    const many = Array.from({ length: 1001 }, (_, index) => ({ username: `wxid_${index}` }))
    runner.on(cmd('contacts'), okReply(contactsJson(many))).on(cmd('sessions'), okReply('[]'))

    const outcome = await makeContactsAdapter(store, runner, clock).collect(collectContext())
    expect(outcome).toMatchObject({ status: 'succeeded', written: 1001 })
    expect(store.writeCalls).toEqual([
      { type: 'DM-005', count: 1000 },
      { type: 'DM-005', count: 1 },
    ])
  })
})
