/**
 * MOD-007 互动扫描与回复时长（mod-007 §8 决策 3；`REQ-058`、`REQ-066`、`AC-111`、`AC-112`）。
 *
 * 覆盖重点（§7「重点断言」②③）：
 * - 扫描：引用回复 / @ 提及 / 紧随接话三类；同一触发只落一条记录（最早优先，并列按类型优先级）；
 *   纯表情响应与跨天响应在扫描阶段剔除；自触发与跨群不构成互动；
 * - 回复时长 = 响应成员的中位数；**跨群合并**到人、无样本返回空；
 * - 时间整体前移后数值不变（公式无时间项，`REQ-086`）。
 *
 * 自然日判定一律注入确定性 `dayKeyOf`，不依赖本机时区（§7「时钟注入」）。
 */

import { describe, expect, it } from 'vitest'

import {
  buildReplyIndex,
  binEventsByMonth,
  defaultDayKey,
  interactionCountBetween,
  interactionIdOf,
  isPureExpression,
  replyLatencyMedian,
  scanInteractions,
} from '../interactions'
import { affinity } from '../scoring'

import { DAY, HOUR, MINUTE, T0, commonTag, dayKeyOf, msg, personStats } from './fixtures'

// ---------------------------------------------------------------------------
// 扫描口径（DM-017）
// ---------------------------------------------------------------------------

describe('互动扫描（DM-017 / §8 决策 3）', () => {
  it('引用回复：被引用消息为触发，间隔 = 响应时间 − 触发时间', () => {
    const quoted = msg('q1', 'g1', 'alice', T0)
    const response = msg('r1', 'g1', 'bob', T0 + 5 * MINUTE, { quotedMessageId: 'q1' })
    const rows = [quoted, response]

    const records = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      interactionId: interactionIdOf('q1', 'r1'),
      triggerMessageId: 'q1',
      triggerMemberId: 'alice',
      responseMessageId: 'r1',
      responseMemberId: 'bob',
      kind: '引用回复',
      intervalMs: 5 * MINUTE,
    })
  })

  it('@ 提及：被提及成员在响应之前最近的一条消息为触发', () => {
    const earlier = msg('m1', 'g1', 'alice', T0)
    const later = msg('m2', 'g1', 'alice', T0 + MINUTE)
    const response = msg('r1', 'g1', 'bob', T0 + 10 * MINUTE, { mentionedMemberIds: ['alice'] })
    const rows = [earlier, later, response]

    const records = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })

    const record = records.find((row) => row.responseMessageId === 'r1')
    expect(record).toMatchObject({ triggerMessageId: 'm2', kind: '@提及', intervalMs: 9 * MINUTE })
  })

  it('紧随接话：响应之前最近一条其他成员消息为触发（之间无第三者发言）', () => {
    const trigger = msg('m1', 'g1', 'alice', T0)
    const response = msg('m2', 'g1', 'bob', T0 + 2 * MINUTE)
    const rows = [trigger, response]

    const records = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: '紧随接话', triggerMessageId: 'm1', intervalMs: 2 * MINUTE })
  })

  it('同一响应同时命中引用与紧随：并列按 引用回复 > @提及 > 紧随接话 取一', () => {
    const quoted = msg('q1', 'g1', 'alice', T0)
    const response = msg('r1', 'g1', 'bob', T0 + MINUTE, { quotedMessageId: 'q1' })
    const rows = [quoted, response]

    const records = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })

    expect(records).toHaveLength(1)
    expect(records[0]?.kind).toBe('引用回复')
  })

  it('同一触发消息只落一条记录：多个候选按响应时间取最早', () => {
    const trigger = msg('t1', 'g1', 'alice', T0)
    const first = msg('r1', 'g1', 'bob', T0 + MINUTE)
    const quotedLater = msg('r2', 'g1', 'carol', T0 + 2 * MINUTE, { quotedMessageId: 't1' })
    const rows = [trigger, first, quotedLater]

    const records = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })

    const triggered = records.filter((row) => row.triggerMessageId === 't1')
    expect(triggered).toHaveLength(1)
    expect(triggered[0]).toMatchObject({ responseMessageId: 'r1', kind: '紧随接话' })
  })

  it('纯表情响应在扫描阶段剔除（不落库）', () => {
    const trigger = msg('t1', 'g1', 'alice', T0)
    const sticker = msg('r1', 'g1', 'bob', T0 + MINUTE, { kind: '表情包' })
    const rows = [trigger, sticker]

    expect(isPureExpression(sticker)).toBe(true)
    expect(scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })).toEqual([])
  })

  it('跨天响应在扫描阶段剔除（自然日不同）', () => {
    const crossNightTrigger = msg('t1', 'g1', 'alice', 10 * DAY - HOUR)
    const crossNightResponse = msg('r1', 'g1', 'bob', 10 * DAY + HOUR)
    const sameDayTrigger = msg('t2', 'g1', 'alice', 20 * DAY)
    const sameDayResponse = msg('r2', 'g1', 'bob', 20 * DAY + 2 * HOUR)
    const rows = [crossNightTrigger, crossNightResponse, sameDayTrigger, sameDayResponse]

    const records = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })
    const ids = records.map((row) => row.responseMessageId)

    expect(ids).not.toContain('r1')
    expect(ids).toContain('r2')
  })

  it('自触发（同一发送者）与跨群消息不构成互动', () => {
    const selfTrigger = msg('t1', 'g1', 'alice', T0)
    const selfResponse = msg('r1', 'g1', 'alice', T0 + MINUTE, { quotedMessageId: 't1' })
    const crossGroupTrigger = msg('t2', 'g1', 'alice', T0)
    const crossGroupResponse = msg('r2', 'g2', 'bob', T0 + MINUTE, { quotedMessageId: 't2' })
    const rows = [selfTrigger, selfResponse, crossGroupTrigger, crossGroupResponse]

    expect(scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })).toEqual([])
  })

  it('相同输入重复扫描结果一致（可重算、无随机性）', () => {
    const rows = [
      msg('m1', 'g1', 'alice', T0),
      msg('m2', 'g1', 'bob', T0 + MINUTE),
      msg('m3', 'g1', 'carol', T0 + 2 * MINUTE, { mentionedMemberIds: ['bob'] }),
    ]

    const first = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })
    const second = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })
    expect(second).toEqual(first)
  })

  it('空引用索引由扫描自行重建（调用方不必预热）', () => {
    const rows = [msg('m1', 'g1', 'alice', T0), msg('m2', 'g1', 'bob', T0 + MINUTE)]
    const empty = { byId: new Map(), byGroup: new Map() }

    expect(scanInteractions(rows, empty, { dayKey: dayKeyOf })).toEqual(
      scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf }),
    )
  })

  it('互动记录标识 = 触发消息 + 响应消息（重放不产生副本）', () => {
    expect(interactionIdOf('a', 'b')).toBe('ix:a::b')
    expect(interactionIdOf('a', 'b')).not.toBe(interactionIdOf('b', 'a'))
  })

  it('buildReplyIndex：按群分组并按 (时间, 标识) 稳定排序', () => {
    const later = msg('m2', 'g1', 'alice', T0 + MINUTE)
    const sameTimeA = msg('m1', 'g1', 'alice', T0)
    const sameTimeB = msg('m0', 'g1', 'bob', T0)
    const other = msg('m9', 'g2', 'carol', T0)

    const index = buildReplyIndex([later, sameTimeA, sameTimeB, other])

    expect(index.byGroup.get('g1')?.map((row) => row.messageId)).toEqual(['m0', 'm1', 'm2'])
    expect(index.byGroup.get('g2')?.map((row) => row.messageId)).toEqual(['m9'])
    expect(index.byId.get('m1')?.messageId).toBe('m1')
  })

  it('默认自然日键按本机时区生成 YYYY-MM-DD（形状校验）', () => {
    expect(defaultDayKey(T0)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ---------------------------------------------------------------------------
// 回复时长（AC-111 / AC-112；重点断言③）
// ---------------------------------------------------------------------------

describe('回复时长中位数（AC-111 / AC-112）', () => {
  it('无样本返回 null（不显示 0 或猜测值）', () => {
    expect(replyLatencyMedian([])).toBeNull()
  })

  it('奇数样本取中间值；偶数样本取中间两条均值并取整', () => {
    const record = (intervalMs: number, index: number) => ({
      interactionId: `ix-${index}`,
      triggerMessageId: `t-${index}`,
      triggerMemberId: 'alice',
      responseMessageId: `r-${index}`,
      responseMemberId: 'bob',
      kind: '紧随接话' as const,
      intervalMs,
    })

    expect(replyLatencyMedian([record(3000, 1)])).toBe(3000)
    expect(replyLatencyMedian([record(3000, 1), record(1000, 2), record(2000, 3)])).toBe(2000)
    expect(replyLatencyMedian([record(2000, 1), record(1000, 2)])).toBe(1500)
    expect(replyLatencyMedian([record(2001, 1), record(1000, 2)])).toBe(1501)
  })

  it('链路复算：排除纯表情与跨天后的中位数与手工复算一致（重点断言③）', () => {
    const base = 100 * DAY
    // 群 g1：b1（bob）→ alice 纯表情响应（+1m，剔除）→ b2（bob）→ alice 文字响应（+1m，保留）
    //        b3（bob）→ alice 跨天响应（+2h，剔除）
    const b1 = msg('b1', 'g1', 'bob', base)
    const a1 = msg('a1', 'g1', 'alice', base + MINUTE, { kind: '表情包' })
    const b2 = msg('b2', 'g1', 'bob', base + 2 * MINUTE)
    const a2 = msg('a2', 'g1', 'alice', base + 3 * MINUTE)
    const b3 = msg('b3', 'g1', 'bob', 101 * DAY - HOUR)
    const a3 = msg('a3', 'g1', 'alice', 101 * DAY + HOUR)
    // 群 g2：跨群合并到人（另一条有效样本，+20m）
    const b4 = msg('b4', 'g2', 'bob2', base + HOUR)
    const a4 = msg('a4', 'g2', 'alice', base + HOUR + 20 * MINUTE)
    const rows = [b1, a1, b2, a2, b3, a3, b4, a4]

    const records = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })
    const forAlice = records.filter((row) => row.responseMemberId === 'alice')

    // 有效样本 = [1 分钟（g1），20 分钟（g2）]；纯表情与跨天样本被剔除。
    expect(forAlice.map((row) => row.intervalMs).sort((left, right) => left - right)).toEqual([
      MINUTE,
      20 * MINUTE,
    ])
    // 中位数 = (60000 + 1200000) / 2 = 630000（跨群合并同一个人）
    expect(replyLatencyMedian(forAlice)).toBe(630_000)
  })
})

// ---------------------------------------------------------------------------
// 互动计数与「时间前移不变」（AC-102 / AC-135；重点断言②）
// ---------------------------------------------------------------------------

describe('互动计数与时间不变性', () => {
  it('双向互动都计入、无关成员不计（DM-018 的 I 项）', () => {
    const rows = [
      { interactionId: 'ix1', triggerMemberId: 'alice', responseMemberId: 'bob', triggerMessageId: '', responseMessageId: '', kind: '紧随接话' as const, intervalMs: 1 },
      { interactionId: 'ix2', triggerMemberId: 'bob', responseMemberId: 'alice', triggerMessageId: '', responseMessageId: '', kind: '紧随接话' as const, intervalMs: 1 },
      { interactionId: 'ix3', triggerMemberId: 'alice', responseMemberId: 'carol', triggerMessageId: '', responseMessageId: '', kind: '紧随接话' as const, intervalMs: 1 },
      { interactionId: 'ix4', triggerMemberId: 'carol', responseMemberId: 'dave', triggerMessageId: '', responseMessageId: '', kind: '紧随接话' as const, intervalMs: 1 },
    ]

    expect(interactionCountBetween(rows, new Set(['alice']), new Set(['bob']))).toBe(2)
    expect(interactionCountBetween(rows, new Set(['alice']), new Set(['carol']))).toBe(1)
    expect(interactionCountBetween(rows, new Set(['dave']), new Set(['alice']))).toBe(0)
  })

  it('证据时间整体前移 100 天：间隔、互动计数与契合度均不变（不做时效衰减，AC-135）', () => {
    const base = 100 * DAY
    const trigger = msg('m1', 'g1', 'alice', base)
    const response = msg('m2', 'g1', 'bob', base + 3 * MINUTE, { quotedMessageId: 'm1' })
    const rows = [trigger, response]

    const before = scanInteractions(rows, buildReplyIndex(rows), { dayKey: dayKeyOf })
    const shiftedRows = rows.map((row) => ({ ...row, sentAt: row.sentAt + 100 * DAY }))
    const after = scanInteractions(shiftedRows, buildReplyIndex(shiftedRows), { dayKey: dayKeyOf })

    expect(after.map((row) => row.intervalMs)).toEqual(before.map((row) => row.intervalMs))

    const tags = [commonTag('运动:羽毛球', '运动', 0.8, 0.8)]
    const a = personStats('alice', 50)
    const b = personStats('bob', 80)
    const countBefore = interactionCountBetween(before, new Set(['alice']), new Set(['bob']))
    const countAfter = interactionCountBetween(after, new Set(['alice']), new Set(['bob']))

    expect(countAfter).toBe(countBefore)
    expect(affinity(a, b, tags, countAfter)).toBe(affinity(a, b, tags, countBefore))
  })
})

// ---------------------------------------------------------------------------
// 事件流分箱（REQ-067 / REQ-087：只被视图读取，不进任何分值）
// ---------------------------------------------------------------------------

describe('事件流分箱（展示口径，不参与权重）', () => {
  it('按注入的月份键分箱计数并按月份升序返回', () => {
    const events = [
      { at: Date.UTC(2026, 0, 5) },
      { at: Date.UTC(2026, 0, 20) },
      { at: Date.UTC(2026, 1, 2) },
    ]
    const utcMonth = (at: number): string => {
      const date = new Date(at)
      return `${date.getUTCFullYear()}-${`${date.getUTCMonth() + 1}`.padStart(2, '0')}`
    }

    const bins = binEventsByMonth(events, { dayKey: utcMonth })

    expect(bins).toEqual([
      { month: '2026-01', count: 2 },
      { month: '2026-02', count: 1 },
    ])
  })

  it('同月事件合并计数；月键升序稳定', () => {
    const january = Date.UTC(2026, 0, 10)
    const bins = binEventsByMonth([{ at: january }, { at: january + HOUR }])

    expect(bins).toEqual([expect.objectContaining({ count: 2 })])
  })

  it('空事件流返回空数组', () => {
    expect(binEventsByMonth([])).toEqual([])
  })
})
