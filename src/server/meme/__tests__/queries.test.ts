/**
 * MOD-005 §7「app/* 查询」测试面（mock 存储）：
 *
 * - API-009：NO_DATA / EMPTY_RESULT 分界（AC-079）、默认累计口径与窗口口径切换、频率值与表格一致、
 *   布局词序（AC-042 / AC-046）、图例 ≤ 3 类与悬停四项（AC-041 / AC-047）、截断标记与总数（AC-043）、
 *   可见性折叠（AC-065）；
 * - API-010：NOT_FOUND 三情形（AC-045）、解读 / 首现 / 最近 / 度量 / 生命周期 / 梗王（AC-049~AC-057）、
 *   精华默认集合与截断 / 媒体引用 / 已删消息跳过（AC-058 / AC-059）、相关变体（AC-060 / AC-061）、
 *   不完整月份（AC-054）、隐藏梗可直访（§5.3）；
 * - API-011：NO_DATA、行结构 / 月度强度 / 领跑梗 / 排序 / 截断（AC-048）；
 * - API-013：IDENTITY_NOT_READY（AC-019）、两视角谓词与不互斥（AC-017）、EMPTY_RESULT、截断、身份筛选透传。
 */

import { describe, expect, it } from 'vitest'
import type { Meme } from '@shared'

import { MemeError } from '../app/errors'
import { queryCell, queryCloud, queryLifecycle, queryMine } from '../app/queries'
import { LIFECYCLE_MAX_ROWS, MINE_MAX_TERMS, WORDCLOUD_MAX_TERMS } from '../constants'
import {
  createStore,
  daysBefore,
  makeDeps,
  makeEdge,
  makeHighlight,
  makeMeme,
  makeMember,
  makeMessage,
  makeOccurrence,
  NOW_MS,
  type FakeStore,
} from './harness'

const GROUP = 'g1'

// ---------------------------------------------------------------------------
// 主夹具：一个群；A（折叠 B）、F 可见；C（不是梗）与 D（并入 C）排除；E 不感兴趣
// ---------------------------------------------------------------------------

interface Fixture {
  port: FakeStore
  deps: ReturnType<typeof makeDeps>
}

function setupCloudFixture(): Fixture {
  const { port, store } = createStore()
  const A = makeMeme({
    memeId: 'A',
    groupId: GROUP,
    name: 'yyds',
    occurrenceCount: 4,
    firstSeenAt: daysBefore(40),
    lastUsedAt: daysBefore(2),
    monthlyCounts: { '2026-08': 1, '2026-09': 3 },
  })
  const B = makeMeme({
    memeId: 'B',
    groupId: GROUP,
    name: 'yyds 变体',
    correction: '已合并至',
    mergedIntoId: 'A',
    occurrenceCount: 1,
    firstSeenAt: daysBefore(5),
    lastUsedAt: daysBefore(5),
    monthlyCounts: { '2026-09': 1 },
  })
  const C = makeMeme({ memeId: 'C', groupId: GROUP, name: '不是梗的梗', correction: '不是梗' })
  const D = makeMeme({ memeId: 'D', groupId: GROUP, name: '并入不是梗', correction: '已合并至', mergedIntoId: 'C' })
  const E = makeMeme({ memeId: 'E', groupId: GROUP, name: '隐藏梗', correction: '不感兴趣' })
  const F = makeMeme({
    memeId: 'F',
    groupId: GROUP,
    name: 'emmm',
    kind: '内部梗',
    occurrenceCount: 1,
    firstSeenAt: daysBefore(30),
    lastUsedAt: daysBefore(30),
    monthlyCounts: { '2026-08': 1 },
  })
  port.seed('DM-006', [A, B, C, D, E, F])

  const at = (memeId: string, messageId: string, occurredAt: number, speakerMemberId: string): void => {
    port.seed('DM-003', [makeMessage({ messageId, groupId: GROUP, senderMemberId: speakerMemberId, sentAt: occurredAt })])
    port.seed('DM-007', [makeOccurrence({ memeId, sourceMessageId: messageId, occurredAt, speakerMemberId })])
  }
  at('A', 'a1', daysBefore(2), 'u_a')
  port.seed('DM-003', [
    makeMessage({
      messageId: 'a2',
      groupId: GROUP,
      senderMemberId: 'u_a',
      sentAt: daysBefore(3),
      kind: '图片',
      text: null,
      mediaRef: 'media/a2.png',
    }),
  ])
  port.seed('DM-007', [
    makeOccurrence({ memeId: 'A', sourceMessageId: 'a2', occurredAt: daysBefore(3), speakerMemberId: 'u_a' }),
  ])
  at('A', 'a3', daysBefore(8), 'u_b')
  at('A', 'a4', daysBefore(40), 'u_b')
  at('B', 'b1', daysBefore(5), 'u_b')
  at('C', 'c1', daysBefore(4), 'u_c')
  at('D', 'd1', daysBefore(6), 'u_c')
  at('E', 'e1', daysBefore(1), 'u_a')
  at('F', 'x1', daysBefore(30), 'u_c')

  port.seed('DM-008', [makeEdge('A', 'F'), makeEdge('A', 'C'), makeEdge('A', 'E', '已失效'), makeEdge('E', 'F')])
  port.seed('DM-009', [
    makeHighlight('A', 'a2', 2),
    makeHighlight('A', 'a3', 1),
    makeHighlight('A', 'a1', 3),
    makeHighlight('A', 'gone', 4),
    makeHighlight('B', 'b1', 1),
  ])
  return { port, deps: makeDeps(store) }
}

function expectMemeError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(MemeError)
  expect((error as MemeError).envelope.code).toBe(code)
}

/** 断言 promise 抛出指定 code 的模块错误（并保留信封现场）。 */
async function catchMemeError(promise: Promise<unknown>, code: string): Promise<MemeError> {
  const error = await promise.then(
    () => {
      throw new Error(`预期抛出 ${code}，但成功返回`)
    },
    (reason: unknown) => reason,
  )
  expectMemeError(error, code)
  return error as MemeError
}

// ---------------------------------------------------------------------------
// API-009 查询梗词云
// ---------------------------------------------------------------------------

describe('MOD-005 queryCloud：空态与筛选分界（AC-079）', () => {
  it('忽略筛选时 DM-003 为空 → NO_DATA（词云与生命周期一致）', async () => {
    const { store } = createStore()
    const deps = makeDeps(store)
    await catchMemeError(queryCloud(deps, { layout: '按热度' }), 'NO_DATA')
    await catchMemeError(queryLifecycle(deps, { months: { from: '2026-08', to: '2026-09' } }), 'NO_DATA')
  })

  it('有数据但筛选无命中 → EMPTY_RESULT（不是 NO_DATA）', async () => {
    const { deps } = setupCloudFixture()
    await catchMemeError(queryCloud(deps, { layout: '按热度', filter: { keyword: '不存在的词' } }), 'EMPTY_RESULT')
  })
})

describe('MOD-005 queryCloud：字号 / 口径 / 布局 / 悬停四项（AC-041 / AC-042 / AC-046 / AC-047）', () => {
  it('默认累计口径：频率 = 累计出现次数（含合并折叠），字号随频率单调', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCloud(deps, { layout: '按热度' })
    expect(output.terms.map((term) => [term.memeId, term.frequency, term.occurrenceCount])).toEqual([
      ['A', 5, 5],
      ['F', 1, 1],
    ])
    expect(output.terms[0]?.fontSize).toBeGreaterThan(output.terms[1]?.fontSize ?? 0)
    expect(output.total).toBe(2)
    expect(output.truncated).toBe(false)
  })

  it('悬停四项字段齐全：频率 / 出现次数 / 首现时间 / 最近调用 + 类型（AC-047）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCloud(deps, { layout: '按热度' })
    for (const term of output.terms) {
      expect(typeof term.frequency).toBe('number')
      expect(typeof term.occurrenceCount).toBe('number')
      expect(typeof term.firstSeenAt).toBe('number')
      expect(typeof term.lastUsedAt).toBe('number')
      expect(['口头禅', '内部梗', '表情包梗']).toContain(term.kind)
    }
    expect(output.terms[0]?.firstSeenAt).toBe(daysBefore(40))
    expect(output.terms[0]?.lastUsedAt).toBe(daysBefore(2))
  })

  it('图例 ≤ 3 类且每类带颜色 + 文字标签（AC-041）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCloud(deps, { layout: '按热度' })
    expect(output.legend.map((item) => item.label)).toEqual(['口头禅', '内部梗'])
    expect(output.legend.every((item) => typeof item.color === 'string' && item.color.length > 0)).toBe(true)
    expect(output.legend.length).toBeLessThanOrEqual(3)
  })

  it('切换窗口口径：频率 = 窗口内出现次数（与表格同值），窗口外的梗不出现（AC-042）', async () => {
    const { port, deps } = setupCloudFixture()
    const from = daysBefore(10)
    const output = await queryCloud(deps, {
      layout: '按热度',
      sizeBasis: '指定时间窗内出现频次',
      filter: { timeRange: { from, to: NOW_MS } },
    })
    // 手工复算窗口内出现次数：A 的 a1/a2/a3 + 合并来源 b1 = 4；F 的 x1 在窗口外。
    expect(output.terms.map((term) => [term.memeId, term.frequency])).toEqual([['A', 4]])
    // 时间窗沿用全局筛选（不新增第二组控件）：读取带 timeRange。
    expect(
      port.reads.some((call) => call.type === 'DM-007' && call.filter?.timeRange?.from === from),
    ).toBe(true)
  })

  it('布局切换：按热度 = 频率降序；按首次出现时间 = 首现升序（AC-046）', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [
      makeMeme({ memeId: 'P', groupId: GROUP, name: 'P', occurrenceCount: 1, firstSeenAt: daysBefore(60), lastUsedAt: daysBefore(60), monthlyCounts: { '2026-07': 1 } }),
      makeMeme({ memeId: 'Q', groupId: GROUP, name: 'Q', occurrenceCount: 3, firstSeenAt: daysBefore(10), lastUsedAt: daysBefore(1), monthlyCounts: { '2026-09': 3 } }),
    ])
    port.seed('DM-003', [makeMessage({ messageId: 'p1', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(60) })])
    port.seed('DM-007', [makeOccurrence({ memeId: 'P', sourceMessageId: 'p1', occurredAt: daysBefore(60) })])
    const deps = makeDeps(store)

    expect((await queryCloud(deps, { layout: '按热度' })).terms.map((term) => term.memeId)).toEqual(['Q', 'P'])
    expect((await queryCloud(deps, { layout: '按首次出现时间' })).terms.map((term) => term.memeId)).toEqual(['P', 'Q'])
  })
})

describe('MOD-005 queryCloud：可见性与截断（AC-043 / AC-065）', () => {
  it('折叠与排除：合并来源计入目标、「不是梗」/「不感兴趣」不进入词云', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCloud(deps, { layout: '按热度' })
    expect(output.terms.map((term) => term.memeId)).toEqual(['A', 'F'])
    expect(output.terms.find((term) => term.memeId === 'A')?.occurrenceCount).toBe(5)
    expect(output.terms.some((term) => ['B', 'C', 'D', 'E'].includes(term.memeId))).toBe(false)

    // 来源引用：可见根的消息全部可回溯；被排除链的消息不出现。
    const messageIds = output.sourceMessageIds
    for (const messageId of ['a1', 'a2', 'a3', 'a4', 'b1', 'x1']) expect(messageIds).toContain(messageId)
    expect(messageIds).not.toContain('c1')
    expect(messageIds).not.toContain('d1')
    expect(new Set(messageIds).size).toBe(messageIds.length)
  })

  it('词云渲染上限：条目超过 200 时返回截断标记与总数，但条目集合仍全量（表格等价口径）', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [
      ...Array.from({ length: WORDCLOUD_MAX_TERMS + 1 }, (_, index) =>
        makeMeme({ memeId: `m${index + 1}`, groupId: GROUP, name: `梗${index + 1}` }),
      ),
    ])
    port.seed('DM-003', [makeMessage({ messageId: 'msg1', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(1) })])
    const deps = makeDeps(store)

    const output = await queryCloud(deps, { layout: '按热度' })
    expect(output.total).toBe(WORDCLOUD_MAX_TERMS + 1)
    expect(output.terms).toHaveLength(WORDCLOUD_MAX_TERMS + 1)
    expect(output.truncated).toBe(true)
  })

  it('读取触达 hardCap：截断标记为真', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [
      makeMeme({ memeId: 'm1', groupId: GROUP, name: '梗1' }),
      makeMeme({ memeId: 'm2', groupId: GROUP, name: '梗2' }),
      makeMeme({ memeId: 'm3', groupId: GROUP, name: '梗3' }),
    ])
    port.seed('DM-003', [makeMessage({ messageId: 'msg1', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(1) })])
    const { port: okPort, store: okStore } = createStore()
    okPort.seed('DM-006', port.all('DM-006'))
    okPort.seed('DM-003', port.all('DM-003'))

    const limited = await queryCloud(makeDeps(store, { limits: { readHardCap: 2 } }), { layout: '按热度' })
    expect(limited.truncated).toBe(true)
    const full = await queryCloud(makeDeps(okStore), { layout: '按热度' })
    expect(full.truncated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// API-010 查询梗单元
// ---------------------------------------------------------------------------

describe('MOD-005 queryCell：NOT_FOUND 三情形（AC-045）', () => {
  it('不存在 / 已合并至 / 不是梗（含链端）均返回 NOT_FOUND，不过滤空态', async () => {
    const { deps } = setupCloudFixture()
    for (const memeId of ['ghost', 'B', 'C', 'D']) {
      const error = await queryCell(deps, { memeId }).catch((reason: unknown) => reason)
      expectMemeError(error, 'NOT_FOUND')
      expect((error as MemeError).envelope.retryable).toBe(false)
    }
  })

  it('「不感兴趣」不进视图但允许直访（显示改判标记由前端带入，§5.3 矩阵）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCell(deps, { memeId: 'E' })
    expect(output.memeId).toBe('E')
    expect(output.occurrenceCount).toBe(1)
    expect(output.highlights).toEqual([])
  })
})

describe('MOD-005 queryCell：梗单元装配（AC-049 ~ AC-057）', () => {
  it('解读 / 首现 / 最近 / 度量 / 月度分布 / 生命周期按折叠链与读取时刻求值', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCell(deps, { memeId: 'A' })

    expect(output.memeId).toBe('A')
    expect(output.interpretation).toContain('什么意思')
    expect(output.firstSeenAt).toBe(daysBefore(40))
    expect(output.firstSeenGroupId).toBe(GROUP)
    expect(output.lastUsedAt).toBe(daysBefore(2))
    expect(output.elapsed).toBe(NOW_MS - daysBefore(2))
    expect(output.heat).toBe('活跃')
    // 手工复算：最近 7 天 3 次（a1/a2/b1），上一 7 天 1 次（a3）→ (3-1)/1 = 2。
    expect(output.weekOverWeek).toBe(2)
    expect(output.occurrenceCount).toBe(5)
    expect(output.monthlyCounts).toEqual({ '2026-08': 1, '2026-09': 4 })
    expect(output.lifecycle).toEqual({
      firstSeenAt: daysBefore(40),
      peakMonth: '2026-09',
      silentAt: daysBefore(2),
      activeDays: 38,
    })
  })

  it('梗王与占比复算、并列全部列出（AC-056 / AC-057）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCell(deps, { memeId: 'A' })
    // 出现记录发言者：u_a 2 次、u_b 3 次；占比 = 次数 ÷ 累计 5。
    expect(output.memeKing).toEqual([
      { memberId: 'u_b', count: 3, share: 0.6 },
      { memberId: 'u_a', count: 2, share: 0.4 },
    ])
  })

  it('精华消息：默认集合按展示序号、已删消息跳过、图片媒体引用随出参返回（AC-058 / AC-059）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCell(deps, { memeId: 'A' })
    expect(output.highlights).toEqual([
      { messageId: 'a3', kind: '文字', displayOrder: 1 },
      { messageId: 'a2', kind: '图片', displayOrder: 2 },
      { messageId: 'a1', kind: '文字', displayOrder: 3 },
    ])
    expect(output.highlightsTruncated).toBe(false)
    expect(output.highlightMediaRefs).toEqual(['media/a2.png'])
  })

  it('精华超过展开上限（20）时截断并标记', async () => {
    const { port, store } = createStore()
    // 梗行首现与出现记录一致（21 天）：DM-007 读取窗从 firstSeenAt 起（§8 决策 1 收敛读量）
    port.seed('DM-006', [makeMeme({ memeId: 'A', groupId: GROUP, name: 'A', firstSeenAt: daysBefore(21) })])
    const messages = Array.from({ length: 21 }, (_, index) =>
      makeMessage({ messageId: `h${index + 1}`, groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(index + 1) }),
    )
    port.seed('DM-003', messages)
    port.seed(
      'DM-007',
      messages.map((message) => makeOccurrence({ memeId: 'A', sourceMessageId: message.messageId, occurredAt: message.sentAt })),
    )
    port.seed(
      'DM-009',
      messages.map((message, index) => makeHighlight('A', message.messageId, index + 1)),
    )
    const output = await queryCell(makeDeps(store), { memeId: 'A' })
    expect(output.highlights).toHaveLength(20)
    expect(output.highlightsTruncated).toBe(true)
  })

  it('相关变体：只列出生效边且链端可见；失效边与链端不可见边不出现（AC-060 / AC-061）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCell(deps, { memeId: 'A' })
    expect(output.variantMemeIds).toEqual(['F'])
  })

  it('来源引用：首现 / 最近 / 各精华消息可回溯且去重（AC-050）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCell(deps, { memeId: 'A' })
    expect(output.sourceMessageIds).toEqual(['a4', 'a1', 'a3', 'a2'])
  })

  it('不完整月份标注：首月起始日 > 1 与当月（数据结束日在月末前）（AC-054）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCell(deps, { memeId: 'A' })
    expect(output.incompleteMonths).toEqual(['2026-08', '2026-09'])
  })
})

describe('MOD-005 queryCell：合并链多跳折叠（§5.3）', () => {
  it('聚合单位为链端根：来源的出现次数 / 月度分布并入根，来源直访 NOT_FOUND', async () => {
    const { port, store } = createStore()
    port.seed('DM-006', [
      makeMeme({ memeId: 'R', groupId: GROUP, name: 'R', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
      makeMeme({ memeId: 'M', groupId: GROUP, name: 'M', correction: '已合并至', mergedIntoId: 'R', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
      makeMeme({ memeId: 'N', groupId: GROUP, name: 'N', correction: '已合并至', mergedIntoId: 'M', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
    ])
    port.seed(
      'DM-003',
      ['r1', 'm1', 'n1'].map((messageId, index) =>
        makeMessage({ messageId, groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(3 - index) }),
      ),
    )
    port.seed('DM-007', [
      makeOccurrence({ memeId: 'R', sourceMessageId: 'r1', occurredAt: daysBefore(3), speakerMemberId: 'u_a' }),
      makeOccurrence({ memeId: 'M', sourceMessageId: 'm1', occurredAt: daysBefore(2), speakerMemberId: 'u_a' }),
      makeOccurrence({ memeId: 'N', sourceMessageId: 'n1', occurredAt: daysBefore(1), speakerMemberId: 'u_a' }),
    ])
    const deps = makeDeps(store)

    const output = await queryCell(deps, { memeId: 'R' })
    expect(output.occurrenceCount).toBe(3)
    expect(output.monthlyCounts).toEqual({ '2026-09': 3 })
    // 多跳来源与其链上成员均不可直访。
    await catchMemeError(queryCell(deps, { memeId: 'N' }), 'NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// API-011 查询生命周期视图
// ---------------------------------------------------------------------------

describe('MOD-005 queryLifecycle：行结构与派生值（AC-048 / AC-053）', () => {
  it('每梗一行：峰值 / 沉寂点 / 活跃天数 / 月度强度（当月次数 ÷ 峰值月次数）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryLifecycle(deps, { months: { from: '2026-07', to: '2026-09' } })
    expect(output.rows.map((row) => row.memeId)).toEqual(['A', 'F'])
    const row = output.rows[0]
    expect(row?.name).toBe('yyds')
    expect(row?.peakMonth).toBe('2026-09')
    expect(row?.silentAt).toBe(daysBefore(2))
    expect(row?.activeDays).toBe(38)
    expect(row?.monthlyStrength).toEqual({ '2026-07': 0, '2026-08': 0.25, '2026-09': 1 })
    // 表格可直接复制：视图行不携带内部排序字段。
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'activeDays',
      'firstSeenAt',
      'memeId',
      'monthlyStrength',
      'name',
      'peakMonth',
      'silentAt',
    ])
  })

  it('当月领跑梗：并列全部列出、无数据月份不产生条目', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryLifecycle(deps, { months: { from: '2026-07', to: '2026-09' } })
    expect(output.leadingMemes).toEqual([
      { month: '2026-08', memeIds: ['A', 'F'] },
      { month: '2026-09', memeIds: ['A'] },
    ])
  })

  it('排序：最近调用降序；关键词筛选只按筛选透传', async () => {
    const { deps } = setupCloudFixture()
    const all = await queryLifecycle(deps, { months: { from: '2026-07', to: '2026-09' } })
    expect(all.rows.map((row) => row.silentAt)).toEqual([daysBefore(2), daysBefore(30)])
    const filtered = await queryLifecycle(deps, {
      months: { from: '2026-07', to: '2026-09' },
      filter: { keyword: 'yyds' },
    })
    expect(filtered.rows.map((row) => row.memeId)).toEqual(['A'])
  })

  it(`行数超过 ${LIFECYCLE_MAX_ROWS} 时截断并返回总数`, async () => {
    const { port, store } = createStore()
    port.seed(
      'DM-006',
      Array.from({ length: LIFECYCLE_MAX_ROWS + 1 }, (_, index) =>
        makeMeme({ memeId: `m${index + 1}`, groupId: GROUP, name: `梗${index + 1}`, lastUsedAt: daysBefore(index + 1) }),
      ),
    )
    port.seed('DM-003', [makeMessage({ messageId: 'msg1', groupId: GROUP, senderMemberId: 'u_a', sentAt: daysBefore(1) })])
    const output = await queryLifecycle(makeDeps(store), { months: { from: '2026-08', to: '2026-09' } })
    expect(output.rows).toHaveLength(LIFECYCLE_MAX_ROWS)
    expect(output.total).toBe(LIFECYCLE_MAX_ROWS + 1)
    expect(output.truncated).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// API-013 查询「我相关」梗
// ---------------------------------------------------------------------------

describe('MOD-005 queryMine：身份与两视角（AC-017 / AC-019）', () => {
  function setupMineFixture(): { port: FakeStore } & Fixture {
    const { port, store } = createStore()
    port.seed('DM-004', [
      makeMember({ memberId: 'u_me', groupId: GROUP, isMe: true }),
      makeMember({ memberId: 'u_b', groupId: GROUP }),
    ])
    port.seed('DM-006', [
      makeMeme({ memeId: 'M1', groupId: GROUP, name: 'M1', occurrenceCount: 2, monthlyCounts: { '2026-09': 2 } }),
      makeMeme({ memeId: 'M4', groupId: GROUP, name: 'M4', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
      makeMeme({ memeId: 'M5', groupId: GROUP, name: 'M5', occurrenceCount: 1, monthlyCounts: { '2026-09': 1 } }),
      makeMeme({ memeId: 'MX', groupId: GROUP, name: 'MX', correction: '不是梗' }),
    ])
    port.seed('DM-003', [
      makeMessage({ messageId: 'm1', groupId: GROUP, senderMemberId: 'u_me', sentAt: daysBefore(3) }),
      makeMessage({ messageId: 'm2', groupId: GROUP, senderMemberId: 'u_b', sentAt: daysBefore(2), mentionedMemberIds: ['u_me'] }),
      makeMessage({ messageId: 'm5', groupId: GROUP, senderMemberId: 'u_b', sentAt: daysBefore(2), mentionedMemberIds: ['u_me'] }),
      makeMessage({ messageId: 'm6', groupId: GROUP, senderMemberId: 'u_b', sentAt: daysBefore(2) }),
      makeMessage({ messageId: 'm7', groupId: GROUP, senderMemberId: 'u_me', sentAt: daysBefore(1) }),
    ])
    port.seed('DM-007', [
      makeOccurrence({ memeId: 'M1', sourceMessageId: 'm1', occurredAt: daysBefore(3), speakerMemberId: 'u_me' }),
      makeOccurrence({ memeId: 'M1', sourceMessageId: 'm2', occurredAt: daysBefore(2), speakerMemberId: 'u_b', mineRelated: true }),
      makeOccurrence({ memeId: 'M4', sourceMessageId: 'm5', occurredAt: daysBefore(2), speakerMemberId: 'u_b', mineRelated: true }),
      makeOccurrence({ memeId: 'M5', sourceMessageId: 'm6', occurredAt: daysBefore(2), speakerMemberId: 'u_b' }),
      makeOccurrence({ memeId: 'MX', sourceMessageId: 'm7', occurredAt: daysBefore(1), speakerMemberId: 'u_me' }),
    ])
    return { port, deps: makeDeps(store) }
  }

  it('Me 缺失 → IDENTITY_NOT_READY（可手动重试）', async () => {
    const { port, store } = createStore()
    port.seed('DM-004', [makeMember({ memberId: 'u_a', groupId: GROUP })])
    const error = await queryMine(makeDeps(store), { view: '我用过的' }).catch((reason: unknown) => reason)
    expectMemeError(error, 'IDENTITY_NOT_READY')
    expect((error as MemeError).envelope.retryable).toBe(true)
  })

  it('视角一 = 发送者为「我」；视角二 = 提及成员含「我」；同一梗可在两个视角都出现（AC-017）', async () => {
    const { deps } = setupMineFixture()
    const used = await queryMine(deps, { view: '我用过的' })
    expect(used.terms.map((term) => term.memeId)).toEqual(['M1'])

    const participated = await queryMine(deps, { view: '我参与消息里的' })
    expect(participated.terms.map((term) => term.memeId)).toEqual(['M1', 'M4'])
    expect(participated.sourceMessageIds).toEqual(['m2', 'm5'])

    // 被排除的梗（不是梗）不进入任何视角。
    expect([...used.terms, ...participated.terms].some((term) => term.memeId === 'MX')).toBe(false)
  })

  it('两批读取都带身份筛选（§8 决策 8）', async () => {
    const { port, deps } = setupMineFixture()
    await queryMine(deps, { view: '我用过的' })
    expect(port.reads.some((call) => call.type === 'DM-007' && call.filter?.identity === 'u_me')).toBe(true)
    expect(port.reads.some((call) => call.type === 'DM-003' && call.filter?.identity === 'u_me')).toBe(true)
  })

  it('无相关记录 → EMPTY_RESULT', async () => {
    const { port, store } = createStore()
    port.seed('DM-004', [makeMember({ memberId: 'u_me', groupId: GROUP, isMe: true })])
    port.seed('DM-006', [makeMeme({ memeId: 'M1', groupId: GROUP, name: 'M1' })])
    port.seed('DM-003', [makeMessage({ messageId: 'm1', groupId: GROUP, senderMemberId: 'u_b', sentAt: daysBefore(1) })])
    port.seed('DM-007', [makeOccurrence({ memeId: 'M1', sourceMessageId: 'm1', occurredAt: daysBefore(1), speakerMemberId: 'u_b' })])
    await catchMemeError(queryMine(makeDeps(store), { view: '我用过的' }), 'EMPTY_RESULT')
  })

  it(`结果截断 ≤ ${MINE_MAX_TERMS} 条并返回总数`, async () => {
    const { port, store } = createStore()
    port.seed('DM-004', [makeMember({ memberId: 'u_me', groupId: GROUP, isMe: true })])
    port.seed('DM-003', [makeMessage({ messageId: 'm1', groupId: GROUP, senderMemberId: 'u_me', sentAt: daysBefore(1) })])
    port.seed(
      'DM-006',
      Array.from({ length: MINE_MAX_TERMS + 1 }, (_, index) => makeMeme({ memeId: `m${index + 1}`, groupId: GROUP, name: `梗${index + 1}` })),
    )
    port.seed(
      'DM-007',
      Array.from({ length: MINE_MAX_TERMS + 1 }, (_, index) =>
        makeOccurrence({ memeId: `m${index + 1}`, sourceMessageId: 'm1', occurredAt: daysBefore(1), speakerMemberId: 'u_me' }),
      ),
    )
    const output = await queryMine(makeDeps(store), { view: '我用过的' })
    expect(output.terms).toHaveLength(MINE_MAX_TERMS)
    expect(output.total).toBe(MINE_MAX_TERMS + 1)
    expect(output.truncated).toBe(true)
  })
})

describe('MOD-005 查询：加载与类型约束', () => {
  it('查询可重入：相同入参 + 相同快照 → 相同结果', async () => {
    const { deps } = setupCloudFixture()
    const first = await queryCloud(deps, { layout: '按热度' })
    const second = await queryCloud(deps, { layout: '按热度' })
    expect(second).toEqual(first)
  })

  it('词云条目字段白名单：只含契约字段 + 字号（无情感 / 立场类扩展）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCloud(deps, { layout: '按热度' })
    const term = output.terms[0]
    expect(Object.keys(term ?? {}).sort()).toEqual([
      'firstSeenAt',
      'fontSize',
      'frequency',
      'kind',
      'lastUsedAt',
      'memeId',
      'name',
      'occurrenceCount',
    ])
  })

  it('CellOutput 装配后名称 / 类型字段不外泄额外画像（仅梗王条目保留成员维度）', async () => {
    const { deps } = setupCloudFixture()
    const output = await queryCell(deps, { memeId: 'A' })
    expect(Object.keys(output).sort()).toEqual(
      [
        'elapsed',
        'firstSeenAt',
        'firstSeenGroupId',
        'heat',
        'highlightMediaRefs',
        'highlights',
        'highlightsTruncated',
        'incompleteMonths',
        'interpretation',
        'lastUsedAt',
        'lifecycle',
        'memeId',
        'memeKing',
        'monthlyCounts',
        'occurrenceCount',
        'sourceMessageIds',
        'variantMemeIds',
        'weekOverWeek',
      ].sort(),
    )
    const king = output.memeKing[0]
    expect(Object.keys(king ?? {}).sort()).toEqual(['count', 'memberId', 'share'])
  })
})
