/**
 * MOD-002 读取（API-004；mod-002 §4.2、§7.1 / §7.2）：
 *
 * - 空条件 = 不限、单项为空只放开该项（AC-014）；
 * - 关键词按登记列命中、不跨列（AC-013、决策 6）；
 * - 分页默认 1 / 50、越界即拒（AC-020、决策 7）；排序稳定（翻页不重不漏）；
 * - 身份条件：声明绑定的实体施加；信息提取模块实体不施加（REQ-006、§5.2）；
 * - 来源消息引用装配（AC-021）；命中空集不是错误（§6）。
 */

import { afterEach, describe, expect, it } from 'vitest'

import type { EntityType, ReadResult } from '@shared'

import type { Store } from '../index'

import {
  CLOCK,
  StoreHarness,
  candidateRecord,
  generationRecord,
  groupRecord,
  itemRecord,
  memberRecord,
  memeRecord,
  messageRecord,
  personTagRecord,
  storeErrorCode,
  tagRecord,
} from './harness'

const harness = new StoreHarness()
afterEach(() => harness.dispose())

/** 读取夹具：两个群、三条群 A 消息、一条群 B 消息。 */
function seedMessages(store: Store): void {
  store.write('DM-002', [groupRecord('grp-a', '甲群'), groupRecord('grp-b', '乙群')])
  store.write('DM-004', [
    memberRecord('grp-a', 'me', { isMe: true, displayName: '我' }),
    memberRecord('grp-a', 'alice', { displayName: '爱丽丝' }),
    memberRecord('grp-b', 'bob', { displayName: '鲍勃' }),
  ])
  store.write('DM-003', [
    messageRecord('grp-a', 'm1', { senderMemberId: 'me', text: 'Hello 苹果', sentAt: CLOCK }),
    messageRecord('grp-a', 'm2', {
      senderMemberId: 'alice',
      text: '100% 甜',
      sentAt: CLOCK + 1,
      mentionedMemberIds: ['me'],
    }),
    messageRecord('grp-a', 'm3', { senderMemberId: 'alice', text: 'a_b 苦', sentAt: CLOCK + 2 }),
    messageRecord('grp-b', 'm4', { senderMemberId: 'bob', text: '香蕉', sentAt: CLOCK + 3 }),
  ])
}

function messageIds(result: ReadResult<'DM-003'>): string[] {
  return result.records.map((record) => record.messageId)
}

describe('空条件 = 不限（AC-014）', () => {
  it('省略 / 空对象 / 各项为空均返回不受限集合；单项为空只放开该项', () => {
    const { store } = harness.create()
    seedMessages(store)

    expect(store.read('DM-003').pageInfo.total).toBe(4)
    expect(store.read('DM-003', {}).pageInfo.total).toBe(4)
    expect(
      store.read('DM-003', { groupIds: [], timeRange: null, keyword: '', identity: null }).pageInfo
        .total,
    ).toBe(4)

    // 群条件收窄：群 A 三条
    expect(store.read('DM-003', { groupIds: ['grp-a'] }).pageInfo.total).toBe(3)
    // 其他项仍为不限：群 A + 关键词（群 A 中没有「香蕉」→ 0）
    expect(store.read('DM-003', { groupIds: ['grp-a'], keyword: '香蕉' }).pageInfo.total).toBe(0)
    // 时间范围闭区间
    expect(store.read('DM-003', { timeRange: { from: CLOCK + 1, to: CLOCK + 3 } }).pageInfo.total).toBe(3)
  })
})

describe('关键词按登记列命中（AC-013）', () => {
  it('消息文本 / 梗名与解读 / 标签名 / 群昵称 / AI 总结与来源文本；不跨列', () => {
    const { store } = harness.create()
    seedMessages(store)
    store.write('DM-006', [memeRecord('grp-a', 'mem-1', { name: '吃瓜', interpretation: '看热闹' })])
    store.write('DM-013', [tagRecord('tag-1', { name: '追番' })])
    store.write('DM-010', [
      itemRecord('grp-b', 'item-1', ['m4'], { aiSummary: '含总结词的内容' }),
    ])

    // DM-003：文本列命中；ASCII 大小写不敏感；LIKE 元字符按字面匹配
    expect(messageIds(store.read('DM-003', { keyword: 'hello' }))).toEqual(['m1'])
    expect(messageIds(store.read('DM-003', { keyword: '100%' }))).toEqual(['m2'])
    expect(messageIds(store.read('DM-003', { keyword: 'a_b' }))).toEqual(['m3'])

    // 不跨列：媒体引用 / 群标识不是 DM-003 的关键词列
    store.write('DM-003', [
      messageRecord('grp-a', 'm5', { senderMemberId: 'me', kind: '图片', mediaRef: 'media/香蕉.png' }),
    ])
    expect(messageIds(store.read('DM-003', { keyword: '香蕉' }))).toEqual(['m4'])
    expect(messageIds(store.read('DM-003', { keyword: 'grp-a' }))).toEqual([])

    // DM-006：梗名 + 解读；归属群不是关键词列
    expect(store.read('DM-006', { keyword: '吃瓜' }).pageInfo.total).toBe(1)
    expect(store.read('DM-006', { keyword: '看热闹' }).pageInfo.total).toBe(1)
    expect(store.read('DM-006', { keyword: 'grp-a' }).pageInfo.total).toBe(0)

    // DM-013 标签名；DM-004 群昵称
    expect(store.read('DM-013', { keyword: '追番' }).pageInfo.total).toBe(1)
    expect(store.read('DM-004', { keyword: '爱丽丝' }).pageInfo.total).toBe(1)

    // DM-010：AI 总结 + 来源消息文本
    expect(store.read('DM-010', { keyword: '总结词' }).pageInfo.total).toBe(1)
    expect(store.read('DM-010', { keyword: '香蕉' }).pageInfo.total).toBe(1)
  })
})

describe('分页与排序', () => {
  it('默认 1 / 50 回显；页码 / 每页条数越界 → INVALID_INPUT；越界页返回空页不报错（AC-020）', () => {
    const { store } = harness.create()
    seedMessages(store)

    expect(store.read('DM-003').pageInfo).toEqual({ page: 1, pageSize: 50, total: 4 })
    expect(store.read('DM-003', null, { page: 2, pageSize: 2 }).pageInfo).toEqual({
      page: 2,
      pageSize: 2,
      total: 4,
    })

    expect(storeErrorCode(() => store.read('DM-003', null, { page: 0 }))).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.read('DM-003', null, { pageSize: 0 }))).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.read('DM-003', null, { pageSize: 1001 }))).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.read('DM-003', null, { pageSize: 1.5 }))).toBe('INVALID_INPUT')

    const beyond = store.read('DM-003', null, { page: 10, pageSize: 10 })
    expect(beyond.records).toEqual([])
    expect(beyond.pageInfo.total).toBe(4)
  })

  it('排序稳定：同时间键翻页不重不漏（§4.2）', () => {
    const { store } = harness.create()
    store.write('DM-002', [groupRecord('grp-a')])
    store.write('DM-004', [memberRecord('grp-a', 'me', { isMe: true })])
    store.write('DM-003', [
      ...Array.from({ length: 5 }, (_, index) =>
        messageRecord('grp-a', `m${index + 1}`, { senderMemberId: 'me', sentAt: CLOCK }),
      ),
    ])

    const pages = [1, 2, 3].map((page) =>
      messageIds(store.read('DM-003', null, { page, pageSize: 2 })),
    )
    expect(pages[0]).toEqual(['m5', 'm4'])
    expect(pages[1]).toEqual(['m3', 'm2'])
    expect(pages[2]).toEqual(['m1'])
    expect(new Set(pages.flat()).size).toBe(5)
  })
})

describe('身份条件（REQ-006）', () => {
  it('声明绑定的实体施加（消息 / 成员 / 人）；信息提取模块实体不施加', () => {
    const { store } = harness.create()
    seedMessages(store)
    store.write('DM-010', [itemRecord('grp-a', 'item-1', ['m1'])])

    // DM-003：发送者为「我」或提及含「我」
    expect(messageIds(store.read('DM-003', { identity: 'me' }))).toEqual(['m2', 'm1'])
    // DM-004：成员标识直连
    expect(store.read('DM-004', { identity: 'me' }).records.map((record) => record.memberId)).toEqual([
      'me',
    ])
    // DM-010（信息提取模块实体）未声明身份绑定 → 条件不施加
    expect(store.read('DM-010', { identity: 'me' }).pageInfo.total).toBe(1)
    // DM-002 同样未声明身份绑定 → 不施加
    expect(store.read('DM-002', { identity: 'me' }).pageInfo.total).toBe(2)
  })
})

describe('来源引用装配与空集', () => {
  it('读回连接表字段：条目来源 / 生成产出 / 候选出处 / 标签证据（AC-021）', () => {
    const { store } = harness.create()
    seedMessages(store)

    store.write('DM-010', [itemRecord('grp-a', 'item-1', ['m1', 'm2'])])
    expect(store.read('DM-010').records[0]?.sourceMessageIds).toEqual(['m1', 'm2'])

    store.write('DM-020', [
      generationRecord('gen-1', { outputRefs: ['gen/1/a.png', 'gen/1/b.png'] }),
    ])
    expect(store.read('DM-020').records[0]?.outputRefs).toEqual(['gen/1/a.png', 'gen/1/b.png'])

    store.write('DM-021', [candidateRecord('cand-1', ['m1'])])
    expect(store.read('DM-021').records[0]?.sourceMessageIds).toEqual(['m1'])

    store.write('DM-013', [tagRecord('tag-1')])
    store.write('DM-014', [personTagRecord('person-grp-a-me', 'tag-1', ['m1', 'm2'])])
    expect(store.read('DM-014').records[0]?.evidenceMessageIds).toEqual(['m1', 'm2'])
  })

  it('命中空集不是错误：返回空数组与 total 0（§4.3 / §6）', () => {
    const { store } = harness.create()
    seedMessages(store)
    expect(store.read('DM-003', { groupIds: ['不存在的群'] })).toEqual({
      records: [],
      pageInfo: { page: 1, pageSize: 50, total: 0 },
    })
  })

  it('未知实体类型 / 非法筛选结构整次拒绝（INVALID_INPUT）', () => {
    const { store } = harness.create()
    expect(storeErrorCode(() => store.read('DM-099' as EntityType))).toBe('INVALID_INPUT')
    expect(
      storeErrorCode(() => store.read('DM-003', { groupIds: 'grp-a' as unknown as string[] })),
    ).toBe('INVALID_INPUT')
    expect(
      storeErrorCode(() => store.read('DM-003', { timeRange: { from: CLOCK + 5, to: CLOCK } })),
    ).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.read('DM-003', { keyword: 7 as unknown as string }))).toBe(
      'INVALID_INPUT',
    )
  })
})
