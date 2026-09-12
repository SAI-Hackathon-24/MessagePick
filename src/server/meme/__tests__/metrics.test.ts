/**
 * MOD-005 §7「domain/Metrics」测试面（纯函数单测）：
 *
 * 热度四边界（AC-052）、自然日差（AC-055）、周环比三态与边界（AC-051）、
 * 峰值并列取最早月、梗王并列与占比复算（AC-056/057）、月度分布补 0（AC-053）、
 * 不完整月份三类判定（AC-054）、词云字号映射与口径 / 布局切换（AC-041/042/046）、
 * 生命周期与当月领跑梗（AC-048）、精华默认与上限（AC-058/059）。
 */

import { describe, expect, it } from 'vitest'
import type { Id, MonthlyCounts } from '@shared'

import { ESSENCE_DEFAULT, ESSENCE_MAX, TREND_NEW, WORDCLOUD_SIZE_RANGE, isTrendNew } from '../constants'
import {
  buildCloudTerms,
  calendarDayDiff,
  computeCellMetrics,
  computeCloudTerms,
  computeLifecycle,
  computeMemeKing,
  dayOfMonth,
  daysInMonth,
  deriveLifecycle,
  fillMonthlyCounts,
  heatOf,
  incompleteMonths,
  kingsFromCounts,
  listMonths,
  monthOf,
  nextMonth,
  peakMonthOf,
  pickHighlights,
  pickLeadingMemes,
  prevMonth,
  sortTermsByLayout,
  weekOverWeekOf,
  type CloudTermSource,
  type LifecycleSource,
} from '../domain/metrics'
import type { CloudTermView } from '../types'
import { NOW_MS, daysBefore, makeOccurrence } from './harness'

/** 本地时间第 `days` 天前的中午（与 `NOW_MS` 同为 12:00，日差精确可算）。 */
const noon = (days: number): number => daysBefore(days, 12)

const source = (memeId: Id, occurrenceCount: number, overrides: Partial<CloudTermSource> = {}): CloudTermSource => ({
  memeId,
  name: memeId,
  kind: '口头禅',
  firstSeenAt: daysBefore(30),
  lastUsedAt: daysBefore(1),
  occurrenceCount,
  ...overrides,
})

function term(memeId: Id, frequency: number, firstSeenAt: number): CloudTermView {
  return {
    memeId,
    name: memeId,
    kind: '口头禅',
    frequency,
    occurrenceCount: frequency,
    firstSeenAt,
    lastUsedAt: firstSeenAt,
    fontSize: WORDCLOUD_SIZE_RANGE.min,
  }
}

describe('MOD-005 Metrics：时间与月份口径', () => {
  it('自然日差：同日 = 0（跨小时不算跨天）、次日 = 1、反向为负（AC-055 口径）', () => {
    expect(calendarDayDiff(new Date(2026, 8, 15, 0, 5).getTime(), new Date(2026, 8, 15, 23, 55).getTime())).toBe(0)
    expect(calendarDayDiff(new Date(2026, 8, 15, 23, 55).getTime(), new Date(2026, 8, 16, 0, 5).getTime())).toBe(1)
    expect(calendarDayDiff(new Date(2026, 8, 16).getTime(), new Date(2026, 8, 15).getTime())).toBe(-1)
  })

  it('monthOf / nextMonth / prevMonth / daysInMonth / listMonths：本地月份与跨年', () => {
    expect(monthOf(new Date(2026, 8, 15).getTime())).toBe('2026-09')
    expect(nextMonth('2026-12')).toBe('2027-01')
    expect(prevMonth('2026-01')).toBe('2025-12')
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2024-02')).toBe(29)
    expect(dayOfMonth(new Date(2026, 8, 6).getTime())).toBe(6)
    expect(listMonths('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(listMonths('2026-03', '2026-01')).toEqual([])
  })
})

describe('MOD-005 Metrics：热度与周环比（AC-051 / AC-052）', () => {
  it('热度三档四边界：7 活跃 / 8 衰减中 / 30 衰减中 / 31 已沉寂', () => {
    const now = new Date(NOW_MS)
    expect(heatOf(noon(7), now)).toBe('活跃')
    expect(heatOf(noon(8), now)).toBe('衰减中')
    expect(heatOf(noon(30), now)).toBe('衰减中')
    expect(heatOf(noon(31), now)).toBe('已沉寂')
    expect(heatOf(new Date(2026, 8, 15, 0, 5).getTime(), now)).toBe('活跃')
  })

  it('周环比三态：正 / 负 / 零基（上期 0 本期 >0 → 新增；两期都 0 → 0）', () => {
    const now = new Date(NOW_MS)
    expect(weekOverWeekOf([{ occurredAt: noon(2) }, { occurredAt: noon(3) }, { occurredAt: noon(8) }], now)).toBe(1)
    expect(weekOverWeekOf([{ occurredAt: noon(2) }, { occurredAt: noon(8) }, { occurredAt: noon(9) }], now)).toBe(-0.5)
    expect(weekOverWeekOf([{ occurredAt: noon(2) }], now)).toBe(TREND_NEW)
    expect(isTrendNew(weekOverWeekOf([{ occurredAt: noon(2) }], now))).toBe(true)
    expect(weekOverWeekOf([], now)).toBe(0)
    expect(weekOverWeekOf([{ occurredAt: noon(20) }], now)).toBe(0)
  })

  it('周环比窗口边界：恰 7 天前计入上期；恰 14 天前与未来时间不计', () => {
    const now = new Date(NOW_MS)
    // 恰 7 天前 = 当前窗口下界（归上期）；恰 14 天前 = 上期下界（不计）。
    expect(weekOverWeekOf([{ occurredAt: noon(7) }], now)).toBe(-1)
    expect(weekOverWeekOf([{ occurredAt: noon(14) }, { occurredAt: now.getTime() + 1000 }], now)).toBe(0)
  })

  it('computeCellMetrics：距今 / 热度 / 周环比按读取时刻求值（AC-051 复算）', () => {
    const now = new Date(NOW_MS)
    const occurrences = [noon(2), noon(3), noon(8)].map((at, index) =>
      makeOccurrence({ memeId: 'm1', sourceMessageId: `msg${index}`, occurredAt: at }),
    )
    const metrics = computeCellMetrics({ lastUsedAt: noon(2) }, occurrences, now)
    expect(metrics.elapsed).toBe(NOW_MS - noon(2))
    expect(metrics.heat).toBe('活跃')
    expect(metrics.weekOverWeek).toBe(1)
  })
})

describe('MOD-005 Metrics：月度分布 / 峰值 / 梗王（AC-053 / AC-056 / AC-057）', () => {
  it('月度分布补 0：只补区间内空洞，不改区间外月份', () => {
    expect(fillMonthlyCounts({ '2026-06': 1, '2026-09': 2 })).toEqual({
      '2026-06': 1,
      '2026-07': 0,
      '2026-08': 0,
      '2026-09': 2,
    })
    expect(fillMonthlyCounts({})).toEqual({})
  })

  it('峰值月并列时取最早月份（PEAK_TIE_BREAK）', () => {
    expect(peakMonthOf({ '2026-06': 3, '2026-07': 3, '2026-08': 1 })).toBe('2026-06')
    expect(peakMonthOf({ '2026-07': 1, '2026-09': 1 })).toBe('2026-07')
    expect(peakMonthOf({})).toBeNull()
  })

  it('梗王与占比：占比 = 次数 ÷ 累计次数，其余按次数取前 5 稳定排序', () => {
    const entries = kingsFromCounts(
      new Map([
        ['u_b', 3],
        ['u_a', 2],
      ]),
      5,
    )
    expect(entries).toEqual([
      { memberId: 'u_b', count: 3, share: 0.6 },
      { memberId: 'u_a', count: 2, share: 0.4 },
    ])

    const counts = new Map<Id, number>([
      ['u_x', 9],
      ['m1', 6],
      ['m2', 5],
      ['m3', 4],
      ['m4', 3],
      ['m5', 2],
      ['m6', 1],
    ])
    const ranked = kingsFromCounts(counts, 30)
    expect(ranked.map((entry) => entry.memberId)).toEqual(['u_x', 'm1', 'm2', 'm3', 'm4', 'm5'])
    expect(ranked.every((entry) => Math.abs(entry.share - entry.count / 30) < 1e-12)).toBe(true)
    expect(kingsFromCounts(new Map(), 0)).toEqual([])
  })

  it('梗王并列全部列出（各自附次数与占比，AC-057）', () => {
    const entries = kingsFromCounts(
      new Map([
        ['u_c', 3],
        ['u_a', 3],
        ['u_b', 1],
      ]),
      7,
    )
    expect(entries[0]).toEqual({ memberId: 'u_a', count: 3, share: 3 / 7 })
    expect(entries[1]).toEqual({ memberId: 'u_c', count: 3, share: 3 / 7 })
    expect(entries[2]).toEqual({ memberId: 'u_b', count: 1, share: 1 / 7 })
  })

  it('computeMemeKing 由出现记录复算（并列 4 人全部列出）', () => {
    const occurrences = ['u_a', 'u_a', 'u_b'].map((speaker, index) =>
      makeOccurrence({ memeId: 'm1', sourceMessageId: `msg${index}`, occurredAt: noon(1), speakerMemberId: speaker }),
    )
    expect(computeMemeKing(occurrences)).toEqual([
      { memberId: 'u_a', count: 2, share: 2 / 3 },
      { memberId: 'u_b', count: 1, share: 1 / 3 },
    ])
    const tied = ['u_a', 'u_b', 'u_c', 'u_d'].map((speaker, index) =>
      makeOccurrence({ memeId: 'm1', sourceMessageId: `msg${index}`, occurredAt: noon(1), speakerMemberId: speaker }),
    )
    const entries = computeMemeKing(tied)
    expect(entries.map((entry) => entry.memberId)).toEqual(['u_a', 'u_b', 'u_c', 'u_d'])
    expect(entries.every((entry) => entry.share === 0.25)).toBe(true)
  })

  it('deriveLifecycle：峰值 = 出现最多的月份；沉寂点 = 最近出现；活跃天数 = 自然日跨度', () => {
    const lifecycle = deriveLifecycle(noon(40), noon(2), { '2026-08': 1, '2026-09': 4 })
    expect(lifecycle).toEqual({
      firstSeenAt: noon(40),
      peakMonth: '2026-09',
      silentAt: noon(2),
      activeDays: 38,
    })
    const fallback = deriveLifecycle(noon(10), noon(1), {})
    expect(fallback.peakMonth).toBe(monthOf(noon(10)))
    expect(fallback.activeDays).toBe(9)
  })
})

describe('MOD-005 Metrics：词云字号 / 口径 / 布局（AC-041 / AC-042 / AC-046）', () => {
  it('字号 = 频率的 sqrt 单调映射（14–72px）：频率最高取上限、最低取下限', () => {
    const terms = buildCloudTerms([source('A', 4), source('B', 1), source('C', 0)], null)
    expect(terms.map((item) => item.memeId)).toEqual(['A', 'B', 'C'])
    expect(terms[0]?.fontSize).toBe(WORDCLOUD_SIZE_RANGE.max)
    expect(terms[1]?.fontSize).toBe(43)
    expect(terms[2]?.fontSize).toBe(WORDCLOUD_SIZE_RANGE.min)
    expect(terms[0]?.fontSize).toBeGreaterThan(terms[1]?.fontSize ?? Number.POSITIVE_INFINITY)
    expect(terms[1]?.fontSize).toBeGreaterThan(terms[2]?.fontSize ?? Number.POSITIVE_INFINITY)
  })

  it('字号映射：空集合 / 全零频率时取下限，不除零', () => {
    expect(buildCloudTerms([], null)).toEqual([])
    const terms = buildCloudTerms([source('A', 0), source('B', 0)], null)
    expect(terms.every((item) => item.fontSize === WORDCLOUD_SIZE_RANGE.min)).toBe(true)
  })

  it('口径切换：默认累计出现次数；指定时间窗用窗口内频次；窗口为空回退累计', () => {
    const sources = [source('A', 5), source('B', 2)]
    const windowRecords = [
      makeOccurrence({ memeId: 'A', sourceMessageId: 'w1', occurredAt: noon(1) }),
      makeOccurrence({ memeId: 'A', sourceMessageId: 'w2', occurredAt: noon(2) }),
      makeOccurrence({ memeId: 'B', sourceMessageId: 'w3', occurredAt: noon(1) }),
    ]
    const cumulative = computeCloudTerms(sources, windowRecords, '累计出现次数', new Date(NOW_MS))
    expect(cumulative.map((item) => [item.memeId, item.frequency])).toEqual([
      ['A', 5],
      ['B', 2],
    ])

    const windowed = computeCloudTerms(sources, windowRecords, '指定时间窗内出现频次', new Date(NOW_MS))
    expect(windowed.map((item) => [item.memeId, item.frequency])).toEqual([
      ['A', 2],
      ['B', 1],
    ])
    // 时间窗为空 = 全量（等同累计口径）。
    const fallback = computeCloudTerms(sources, null, '指定时间窗内出现频次', new Date(NOW_MS))
    expect(fallback.map((item) => [item.memeId, item.frequency])).toEqual([
      ['A', 5],
      ['B', 2],
    ])
  })

  it('布局切换：按热度 = 频率降序；按首次出现时间 = 首现升序（并列按频率降序、标识升序）', () => {
    const terms = [term('b', 5, 100), term('a', 5, 200), term('c', 1, 50)]
    expect(sortTermsByLayout(terms, '按热度').map((item) => item.memeId)).toEqual(['b', 'a', 'c'])
    expect(sortTermsByLayout(terms, '按首次出现时间').map((item) => item.memeId)).toEqual(['c', 'b', 'a'])
  })

  it('assignFontSizes 对已构建条目就地生效且幂等', () => {
    const terms = buildCloudTerms([source('A', 10), source('B', 10)], null)
    const before = terms.map((item) => item.fontSize)
    expect(before[0]).toBe(WORDCLOUD_SIZE_RANGE.max)
    expect(before[0]).toBe(before[1])
  })
})

describe('MOD-005 Metrics：生命周期视图（AC-048 / AC-053）', () => {
  it('computeLifecycle：条带只含请求范围内月份，强度 = 当月次数 ÷ 峰值月次数', () => {
    const rows = computeLifecycle(
      [
        {
          memeId: 'A',
          name: 'A',
          firstSeenAt: noon(40),
          lastUsedAt: noon(2),
          occurrenceCount: 5,
          monthlyCounts: { '2026-08': 2, '2026-09': 3 },
        },
      ],
      { from: '2026-07', to: '2026-09' },
    )
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.peakMonth).toBe('2026-09')
    expect(row?.silentAt).toBe(noon(2))
    expect(row?.activeDays).toBe(38)
    expect(Object.keys(row?.monthlyStrength ?? {}).sort()).toEqual(['2026-07', '2026-08', '2026-09'])
    expect(row?.monthlyStrength['2026-07']).toBe(0)
    expect(row?.monthlyStrength['2026-08']).toBeCloseTo(2 / 3, 10)
    expect(row?.monthlyStrength['2026-09']).toBe(1)
  })

  it('computeLifecycle：最近调用降序，并列按累计次数降序、标识升序', () => {
    const sources: LifecycleSource[] = [
      { memeId: 'B', name: 'B', firstSeenAt: noon(20), lastUsedAt: noon(10), occurrenceCount: 2, monthlyCounts: { '2026-09': 2 } },
      { memeId: 'A', name: 'A', firstSeenAt: noon(20), lastUsedAt: noon(2), occurrenceCount: 5, monthlyCounts: { '2026-09': 5 } },
      { memeId: 'C', name: 'C', firstSeenAt: noon(20), lastUsedAt: noon(10), occurrenceCount: 9, monthlyCounts: { '2026-09': 9 } },
    ]
    const rows = computeLifecycle(sources, { from: '2026-08', to: '2026-09' })
    expect(rows.map((row) => row.memeId)).toEqual(['A', 'C', 'B'])
  })

  it('computeLifecycle：无月度数据时峰值回退首现月、强度全 0', () => {
    const rows = computeLifecycle(
      [{ memeId: 'A', name: 'A', firstSeenAt: noon(10), lastUsedAt: noon(1), occurrenceCount: 1, monthlyCounts: {} }],
      { from: '2026-08', to: '2026-09' },
    )
    expect(rows[0]?.peakMonth).toBe(monthOf(noon(10)))
    expect(rows[0]?.monthlyStrength).toEqual({ '2026-08': 0, '2026-09': 0 })
  })

  it('pickLeadingMemes：每月取最大者、并列全部列出、无数据月份不产生条目', () => {
    const sources: LifecycleSource[] = [
      { memeId: 'A', name: 'A', firstSeenAt: noon(40), lastUsedAt: noon(2), occurrenceCount: 5, monthlyCounts: { '2026-07': 2, '2026-08': 0, '2026-09': 3 } },
      { memeId: 'B', name: 'B', firstSeenAt: noon(40), lastUsedAt: noon(5), occurrenceCount: 2, monthlyCounts: { '2026-07': 2 } },
      { memeId: 'C', name: 'C', firstSeenAt: noon(40), lastUsedAt: noon(5), occurrenceCount: 1, monthlyCounts: {} },
    ]
    expect(pickLeadingMemes(sources, { from: '2026-07', to: '2026-09' })).toEqual([
      { month: '2026-07', memeIds: ['A', 'B'] },
      { month: '2026-09', memeIds: ['A'] },
    ])
  })
})

describe('MOD-005 Metrics：精华消息（AC-058 / AC-059）', () => {
  const rows = (count: number): Array<{ memeId: string; sourceMessageId: string; displayOrder: number }> =>
    Array.from({ length: count }, (_, index) => ({ memeId: 'm1', sourceMessageId: `msg${index}`, displayOrder: index + 1 }))

  it('默认展示 3 条（ESSENCE_DEFAULT）、展开上限 20（ESSENCE_MAX）', () => {
    expect(ESSENCE_DEFAULT).toBe(3)
    expect(ESSENCE_MAX).toBe(20)
    const pageDefault = pickHighlights(rows(5), ESSENCE_DEFAULT)
    expect(pageDefault.page).toHaveLength(3)
    expect(pageDefault.truncated).toBe(true)
    const expanded = pickHighlights(rows(25))
    expect(expanded.page).toHaveLength(ESSENCE_MAX)
    expect(expanded.truncated).toBe(true)
    const complete = pickHighlights(rows(20))
    expect(complete.page).toHaveLength(ESSENCE_MAX)
    expect(complete.truncated).toBe(false)
  })

  it('剩余不足 3 条按实际返回（不补位、不占位，AC-059）', () => {
    const two = pickHighlights(rows(2), ESSENCE_DEFAULT)
    expect(two.page.map((row) => row.sourceMessageId)).toEqual(['msg0', 'msg1'])
    expect(two.truncated).toBe(false)
    expect(pickHighlights([], ESSENCE_DEFAULT)).toEqual({ page: [], truncated: false })
  })

  it('按展示序号升序，并列按消息标识稳定排序', () => {
    const selected = pickHighlights(
      [
        { sourceMessageId: 'msg_b', displayOrder: 2 },
        { sourceMessageId: 'msg_a', displayOrder: 2 },
        { sourceMessageId: 'msg_c', displayOrder: 1 },
      ],
      ESSENCE_DEFAULT,
    )
    expect(selected.page.map((row) => row.sourceMessageId)).toEqual(['msg_c', 'msg_a', 'msg_b'])
  })
})

describe('MOD-005 Metrics：不完整月份三类判定（AC-054）', () => {
  const now = new Date(NOW_MS)

  it('判定一：当前自然月一律标注', () => {
    expect(incompleteMonths(['2026-08', '2026-09', '2026-10'], null, now)).toEqual(['2026-09'])
  })

  it('判定二 / 三：起始月起始日 > 1、结束月结束日 < 月末日', () => {
    expect(
      incompleteMonths(['2026-08'], { first: new Date(2026, 7, 6).getTime(), last: new Date(2026, 7, 20).getTime() }, now),
    ).toEqual(['2026-08'])
    expect(
      incompleteMonths(['2026-07'], { first: new Date(2026, 7, 6).getTime(), last: new Date(2026, 7, 20).getTime() }, now),
    ).toEqual([])
  })

  it('例外：起始日为 1 号、结束日为月末日、覆盖区间之外、无覆盖窗口', () => {
    const full = { first: new Date(2026, 7, 1).getTime(), last: new Date(2026, 7, 31).getTime() }
    expect(incompleteMonths(['2026-08'], full, now)).toEqual([])
    expect(incompleteMonths(['2026-06', '2026-07'], full, now)).toEqual([])
    expect(incompleteMonths(['2026-08'], null, now)).toEqual([])
  })

  it('多个标注去重且按月份升序返回（区间中间月不标注）', () => {
    const flagged = incompleteMonths(
      ['2026-09', '2026-07', '2026-08'],
      { first: new Date(2026, 6, 6).getTime(), last: new Date(2026, 8, 13).getTime() },
      now,
    )
    expect(flagged).toEqual(['2026-07', '2026-09'])
  })
})

describe('MOD-005 Metrics：月度分布补 0 边界（AC-053）', () => {
  it('补 0 只发生在既有区间内（首尾之外不造月份）', () => {
    const counts: MonthlyCounts = { '2026-01': 1, '2026-12': 1 }
    const filled = fillMonthlyCounts(counts)
    expect(Object.keys(filled)).toHaveLength(12)
    expect(filled['2026-06']).toBe(0)
    expect(filled['2025-12']).toBeUndefined()
  })
})
