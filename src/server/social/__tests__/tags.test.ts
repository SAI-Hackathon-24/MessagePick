/**
 * MOD-007 标签体系（mod-007 §5.1 / §5.4、§3.4 阶段 3~4、tags/ 目录；`REQ-052` ~ `REQ-056`、`AC-094` ~ `AC-100`）。
 *
 * 覆盖重点：
 * - 一级维度固定五类闭集（越界条目丢弃）；二级标签可自由创建；
 * - 每条标签必须有证据、无证据不入画像（人工显式输入除外）；墓碑行不进任何产物；
 * - 同义标签归并为同一条（代表标签 + 最大置信度 + 证据并集），归并组标识幂等；
 * - 人工增 / 删 / 改的规划：增补标签、删走墓碑、改 = 墓碑 + 新增，定位失败给契约错误码。
 */

import { describe, expect, it } from 'vitest'

import type { Dimension, TaskResult } from '@shared'

import { isSocialError } from '../errors'
import {
  binEvidenceByMonth,
  isDimension,
  mergeEventStreams,
  mergeTagRows,
  parseExtraction,
} from '../tags/extract'
import { isTombstone, planInterestTagEdit } from '../tags/edits'
import {
  applyMergeGroups,
  expandMergeGroups,
  mergeGroupIdOf,
  parseClusterGroups,
  planMergeGroups,
  representativeOf,
} from '../tags/merge'
import { normalizeTagName, tagIdOf } from '../tags/normalize'

import { DAY, T0, interestTag, mergeGroup, messageMap, msg, tagLink } from './fixtures'

/** 断言调用抛出 `SocialError` 并返回其错误标识。 */
function errorCodeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (isSocialError(error)) return error.code
    throw error
  }
  throw new Error('期望抛出 SocialError，但调用未抛错')
}

function taskResult(items: Record<string, unknown>[]): TaskResult {
  return { items }
}

// ---------------------------------------------------------------------------
// 规范化与标识（§5.1）
// ---------------------------------------------------------------------------

describe('标签名规范化与标识', () => {
  it('NFKC 全角转半角、去首尾空白、折叠内部空白、小写化', () => {
    expect(normalizeTagName(' 羽毛球 ')).toBe('羽毛球')
    expect(normalizeTagName('ＡＢＣ')).toBe('abc')
    expect(normalizeTagName('全职   高手')).toBe('全职 高手')
    expect(normalizeTagName('ＭＴＧ')).toBe('mtg')
  })

  it('标签标识 = 一级维度 + 规范化标签名（同义写法同标识）', () => {
    expect(tagIdOf('运动', ' 羽毛球 ')).toBe('运动:羽毛球')
    expect(tagIdOf('运动', '羽毛球')).toBe(tagIdOf('运动', ' 羽毛球 '))
    expect(tagIdOf('艺术', '羽毛球')).not.toBe(tagIdOf('运动', '羽毛球'))
  })
})

// ---------------------------------------------------------------------------
// 一级维度闭集（REQ-052 / AC-094）
// ---------------------------------------------------------------------------

describe('一级维度闭集（固定五类，不增不减）', () => {
  it('isDimension 接受五类、拒绝越界值', () => {
    for (const dimension of ['运动', '艺术', '游戏', '娱乐', '社交']) {
      expect(isDimension(dimension)).toBe(true)
    }
    expect(isDimension('美食')).toBe(false)
    expect(isDimension('')).toBe(false)
    expect(isDimension('sport')).toBe(false)
  })

  it('抽取条目的一级维度越界 → 丢弃并计入报告，不产出标签', () => {
    const rows = [msg('m1', 'g1', 'u1', T0)]
    const context = { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 }

    const result = parseExtraction(
      taskResult([{ name: '探店', dimension: '美食', strength: 0.9, evidence: ['m1'] }]),
      context,
    )

    expect(result.tags).toEqual([])
    expect(result.links).toEqual([])
    expect(result.dropped).toBe(1)
  })

  it('二级标签可自由创建（归属五类之一即可）', () => {
    const rows = [msg('m1', 'g1', 'u1', T0)]
    const context = { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 }

    const result = parseExtraction(
      taskResult([{ name: '科幻小说', dimension: '娱乐', strength: 0.7, evidence: ['m1'] }]),
      context,
    )

    expect(result.tags[0]).toMatchObject({ tagId: '娱乐:科幻小说', name: '科幻小说', dimension: '娱乐' })
  })
})

// ---------------------------------------------------------------------------
// 抽取落点（REQ-053 / REQ-054 / REQ-057 / AC-095）
// ---------------------------------------------------------------------------

describe('抽取结果落点（证据口径与置信度）', () => {
  const rows = [msg('m1', 'g1', 'u1', T0), msg('m2', 'g1', 'u1', T0 + 40 * DAY)]

  it('正常条目产出标签连接：置信度、证据、首现时间取最早证据', () => {
    const result = parseExtraction(
      taskResult([{ name: '羽毛球', dimension: '运动', strength: 0.5, evidence: ['m2', 'm1'] }]),
      { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 + 60 * DAY },
    )

    expect(result.dropped).toBe(0)
    expect(result.tags).toHaveLength(1)
    expect(result.tags[0]).toMatchObject({ tagId: '运动:羽毛球', firstSeenAt: T0 })
    expect(result.links).toHaveLength(1)
    expect(result.links[0]).toMatchObject({
      personId: 'p1',
      tagId: '运动:羽毛球',
      confidence: 0.5,
      evidenceMessageIds: ['m1', 'm2'],
      origin: '模型抽取',
    })
  })

  it('无证据的条目不入画像（REQ-054）', () => {
    const result = parseExtraction(
      taskResult([{ name: '攀岩', dimension: '运动', strength: 0.9, evidence: [] }]),
      { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 },
    )

    expect(result.tags).toEqual([])
    expect(result.links).toEqual([])
    expect(result.dropped).toBe(1)
  })

  it('证据消息标识以本地索引核对：悬空引用剔除；全悬空 → 条目丢弃（REQ-011）', () => {
    const partial = parseExtraction(
      taskResult([{ name: '羽毛球', dimension: '运动', strength: 0.5, evidence: ['m1', 'ghost'] }]),
      { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 },
    )
    expect(partial.links).toHaveLength(1)
    expect(partial.links[0]?.evidenceMessageIds).toEqual(['m1'])

    const allDangling = parseExtraction(
      taskResult([{ name: '羽毛球', dimension: '运动', strength: 0.5, evidence: ['ghost'] }]),
      { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 },
    )
    expect(allDangling.links).toEqual([])
    expect(allDangling.dropped).toBe(1)
  })

  it('同标签重复条目合并：置信度取最大、证据并集、首现取最早、事件流合并', () => {
    const result = parseExtraction(
      taskResult([
        { name: '羽毛球', dimension: '运动', strength: 0.5, evidence: ['m1'] },
        { name: '羽毛球', dimension: '运动', strength: 0.9, evidence: ['m2'] },
      ]),
      { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 },
    )

    expect(result.tags).toHaveLength(1)
    expect(result.tags[0]?.firstSeenAt).toBe(T0)
    expect(result.tags[0]?.eventStream).toHaveLength(2)
    expect(result.links).toHaveLength(1)
    expect(result.links[0]?.confidence).toBe(0.9)
    expect(result.links[0]?.evidenceMessageIds).toEqual(['m1', 'm2'])
  })

  it('社交维度置信度随活跃度联动；语义维度不联动（§8 决策 1）', () => {
    const item = [{ name: '群聊活跃', dimension: '社交', strength: 0.8, evidence: ['m1'] }]

    const low = parseExtraction(taskResult(item), {
      personId: 'p1',
      activity: 24,
      messages: messageMap(rows),
      now: T0,
    })
    const high = parseExtraction(taskResult(item), {
      personId: 'p1',
      activity: 49,
      messages: messageMap(rows),
      now: T0,
    })
    const semantic = parseExtraction(
      taskResult([{ name: '羽毛球', dimension: '运动', strength: 0.8, evidence: ['m1'] }]),
      { personId: 'p1', activity: 49, messages: messageMap(rows), now: T0 },
    )

    expect(low.links[0]?.confidence).toBe(0.566) // 0.8 × sqrt(25/50) = 0.565685… → 0.566
    expect(high.links[0]?.confidence).toBe(0.8)
    expect(semantic.links[0]?.confidence).toBe(0.8) // 语义维度与活跃度无关
  })

  it('强度越界按 clamp01 收敛（> 1 → 1）', () => {
    const result = parseExtraction(
      taskResult([{ name: '羽毛球', dimension: '运动', strength: 3, evidence: ['m1'] }]),
      { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 },
    )
    expect(result.links[0]?.confidence).toBe(1)
  })

  it('结构非法条目（缺名 / 非法强度 / 非数组证据）一律丢弃', () => {
    const result = parseExtraction(
      taskResult([
        { name: '', dimension: '运动', strength: 0.5, evidence: ['m1'] },
        { name: '羽毛球', dimension: '运动', strength: 'high', evidence: ['m1'] },
        { name: '羽毛球', dimension: '运动', strength: 0.5, evidence: 'm1' },
      ]),
      { personId: 'p1', activity: 10, messages: messageMap(rows), now: T0 },
    )

    expect(result.tags).toEqual([])
    expect(result.links).toEqual([])
    expect(result.dropped).toBe(3)
  })

  it('事件流 = 按自然月分箱的证据条数（月内合并、升序）', () => {
    const evidenceRows = [
      msg('m1', 'g1', 'u1', Date.UTC(2025, 0, 15)),
      msg('m2', 'g1', 'u1', Date.UTC(2025, 0, 20)),
      msg('m3', 'g1', 'u1', Date.UTC(2025, 1, 10)),
    ]
    const result = parseExtraction(
      taskResult([{ name: '羽毛球', dimension: '运动', strength: 0.5, evidence: ['m1', 'm2', 'm3'] }]),
      { personId: 'p1', activity: 10, messages: messageMap(evidenceRows), now: T0 },
    )

    const stream = result.tags[0]?.eventStream ?? []
    expect(stream.map((point) => point.strength)).toEqual([2, 1])
    expect(stream[0]?.at).toBeLessThan(stream[1]?.at as number)
  })

  it('mergeTagRows：首现取更早、事件流按月合并、热度分取更大', () => {
    const existing = interestTag('运动:羽毛球', '羽毛球', '运动', {
      firstSeenAt: T0,
      eventStream: [{ at: Date.UTC(2025, 0, 1), strength: 1 }],
      heatScore: 0.3,
    })
    const incoming = interestTag('运动:羽毛球', '羽毛球', '运动', {
      firstSeenAt: T0 + 40 * DAY,
      eventStream: [{ at: Date.UTC(2025, 1, 1), strength: 2 }],
      heatScore: 0.9,
    })

    const merged = mergeTagRows(existing, incoming)
    expect(merged.firstSeenAt).toBe(T0)
    expect(merged.eventStream).toHaveLength(2)
    expect(merged.heatScore).toBe(0.9)
  })

  it('binEvidenceByMonth / mergeEventStreams：同月求和、跨月保留、升序输出', () => {
    const january = Date.UTC(2025, 0, 10)
    const february = Date.UTC(2025, 1, 10)
    const bins = binEvidenceByMonth([
      msg('m1', 'g1', 'u1', january),
      msg('m2', 'g1', 'u1', january + DAY),
      msg('m3', 'g1', 'u1', february),
    ])
    expect(bins.map((point) => point.strength)).toEqual([2, 1])

    const merged = mergeEventStreams(
      [{ at: january, strength: 1 }],
      [
        { at: january, strength: 2 },
        { at: february, strength: 1 },
      ],
    )
    expect(merged.map((point) => point.strength)).toEqual([3, 1])
  })
})

// ---------------------------------------------------------------------------
// 同义归并（DM-015 / REQ-055 / AC-099）
// ---------------------------------------------------------------------------

describe('同义标签归并（归并为同一条）', () => {
  it('parseClusterGroups：解析 tags / tagIds 两种键，单标签组与非法项丢弃、去重、排序', () => {
    const groups = parseClusterGroups({
      items: [
        { tags: ['b', 'a'] },
        { tagIds: ['d', 'c'] },
        { tags: ['e'] },
        { tags: 'x' },
        { tags: ['g', 'f', 'f'] },
        {},
      ],
    })

    expect(groups).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['f', 'g'],
    ])
  })

  it('planMergeGroups：代表 = 首现最早（并列按标识升序）；不足两个已有标签丢弃；一标签只进一组', () => {
    const tagById = new Map([
      ['运动:a', interestTag('运动:a', 'a', '运动', { firstSeenAt: T0 })],
      ['运动:b', interestTag('运动:b', 'b', '运动', { firstSeenAt: T0 })],
      ['运动:c', interestTag('运动:c', 'c', '运动', { firstSeenAt: T0 + DAY })],
      ['运动:d', interestTag('运动:d', 'd', '运动', { firstSeenAt: T0 - DAY })],
    ])

    const plans = planMergeGroups([['运动:a', '运动:b'], ['运动:b', '运动:c']], tagById)

    expect(plans).toHaveLength(1)
    expect(plans[0]?.representativeTagId).toBe('运动:a')
    expect(plans[0]?.mergedTagIds).toEqual(['运动:b'])

    // 未知 tagId 与单成员组被丢弃
    expect(planMergeGroups([['运动:x', '运动:y'], ['运动:d']], tagById)).toEqual([])
  })

  it('mergeGroupIdOf 幂等：同一集合（顺序无关）得到同一标识', () => {
    expect(mergeGroupIdOf(['b', 'a'])).toBe(mergeGroupIdOf(['a', 'b']))
    expect(mergeGroupIdOf(['a'])).not.toBe(mergeGroupIdOf(['a', 'b']))
  })

  it('applyMergeGroups：组内写组标识、组外清空，其它字段不变', () => {
    const a = interestTag('运动:a', 'a', '运动')
    const b = interestTag('运动:b', 'b', '运动')
    const c = interestTag('运动:c', 'c', '运动')
    const group = mergeGroup('运动:a', ['运动:b'])

    const applied = applyMergeGroups([a, b, c], [group])

    expect(applied[0]?.mergeGroupId).toBe(group.mergeGroupId)
    expect(applied[1]?.mergeGroupId).toBe(group.mergeGroupId)
    expect(applied[2]?.mergeGroupId).toBeNull()
    expect(applied[0]?.name).toBe('a')
  })

  it('representativeOf / expandMergeGroups：代表 → 成员展开（含自身、排序）', () => {
    const group = mergeGroup('运动:a', ['运动:b', '运动:c'])

    expect(representativeOf('运动:b', [group])).toBe('运动:a')
    expect(representativeOf('运动:z', [group])).toBe('运动:z')
    expect(expandMergeGroups([group]).get('运动:a')).toEqual(['运动:a', '运动:b', '运动:c'])
  })
})

// ---------------------------------------------------------------------------
// 人工增删改（REQ-008 / REQ-056 / AC-100）
// ---------------------------------------------------------------------------

describe('人工增删改兴趣标签（规划层）', () => {
  const badminton = interestTag('运动:羽毛球', '羽毛球', '运动', { firstSeenAt: T0 - DAY })
  const links = [
    tagLink({ personId: 'p1', tag: badminton, confidence: 0.8, evidenceMessageIds: ['m1'] }),
  ]

  it('增：新标签落标签本体 + 人工连接（置信度 1、无证据）', () => {
    const plan = planInterestTagEdit({
      edit: { memberId: 'p1', action: '增', tag: { dimension: '艺术', name: '摄影' } },
      personId: 'p1',
      links,
      tags: [badminton],
      mergeGroups: [],
      now: T0,
    })

    expect(plan.tagRows).toHaveLength(1)
    expect(plan.tagRows[0]).toMatchObject({ tagId: '艺术:摄影', name: '摄影', dimension: '艺术', firstSeenAt: T0 })
    expect(plan.linkRows).toEqual([
      {
        personId: 'p1',
        tagId: '艺术:摄影',
        confidence: 1,
        evidenceMessageIds: [],
        origin: '人工增改',
      },
    ])
  })

  it('增：标签本体已存在时不重复创建（只补连接行）', () => {
    const plan = planInterestTagEdit({
      edit: { memberId: 'p1', action: '增', tag: { dimension: '运动', name: '羽毛球' } },
      personId: 'p1',
      links,
      tags: [badminton],
      mergeGroups: [],
      now: T0,
    })

    expect(plan.tagRows).toEqual([])
    expect(plan.linkRows[0]?.tagId).toBe('运动:羽毛球')
  })

  it('增：空标签名 / 缺标签 / 维度越界 → INVALID_INPUT（契约错误码）', () => {
    const base = { personId: 'p1', links, tags: [badminton], mergeGroups: [], now: T0 }

    expect(
      errorCodeOf(() =>
        planInterestTagEdit({ ...base, edit: { memberId: 'p1', action: '增', tag: { dimension: '艺术', name: '  ' } } }),
      ),
    ).toBe('INVALID_INPUT')
    expect(
      errorCodeOf(() => planInterestTagEdit({ ...base, edit: { memberId: 'p1', action: '增' } })),
    ).toBe('INVALID_INPUT')
    expect(
      errorCodeOf(() =>
        planInterestTagEdit({
          ...base,
          edit: { memberId: 'p1', action: '增', tag: { dimension: '美食' as never, name: '探店' } },
        }),
      ),
    ).toBe('INVALID_INPUT')
  })

  it('删：产出墓碑行（零置信度、无证据、人工增改），组内同义标签一并墓碑化', () => {
    const merged = interestTag('运动:羽球', '羽球', '运动')
    const group = mergeGroup('运动:羽毛球', ['运动:羽球'])
    const pairLinks = [
      tagLink({ personId: 'p1', tag: badminton, confidence: 0.8, evidenceMessageIds: ['m1'] }),
      tagLink({ personId: 'p1', tag: merged, confidence: 0.7, evidenceMessageIds: ['m2'] }),
    ]

    const plan = planInterestTagEdit({
      edit: { memberId: 'p1', action: '删', targetTagId: '运动:羽球' },
      personId: 'p1',
      links: pairLinks,
      tags: [badminton, merged],
      mergeGroups: [group],
      now: T0,
    })

    expect(plan.tagRows).toEqual([])
    expect(plan.linkRows.map((row) => row.tagId).sort()).toEqual(['运动:羽毛球', '运动:羽球'])
    for (const row of plan.linkRows) {
      expect(isTombstone(row)).toBe(true)
      expect(row.confidence).toBe(0)
      expect(row.evidenceMessageIds).toEqual([])
    }
  })

  it('删：目标不存在（或已失效）→ NOT_FOUND', () => {
    const code = errorCodeOf(() =>
      planInterestTagEdit({
        edit: { memberId: 'p1', action: '删', tag: { dimension: '娱乐', name: '电影' } },
        personId: 'p1',
        links,
        tags: [badminton],
        mergeGroups: [],
        now: T0,
      }),
    )
    expect(code).toBe('NOT_FOUND')
  })

  it('改：旧标签墓碑 + 新标签人工连接；改到自身为幂等空操作', () => {
    const plan = planInterestTagEdit({
      edit: {
        memberId: 'p1',
        action: '改',
        targetTagId: '运动:羽毛球',
        tag: { dimension: '艺术', name: '摄影' },
      },
      personId: 'p1',
      links,
      tags: [badminton],
      mergeGroups: [],
      now: T0,
    })

    expect(plan.tagRows.map((row) => row.tagId)).toEqual(['艺术:摄影'])
    expect(plan.linkRows).toHaveLength(2)
    expect(plan.linkRows[0]).toMatchObject({ tagId: '运动:羽毛球', confidence: 0, origin: '人工增改' })
    expect(plan.linkRows[1]).toMatchObject({ tagId: '艺术:摄影', confidence: 1, origin: '人工增改' })

    const noop = planInterestTagEdit({
      edit: { memberId: 'p1', action: '改', tag: { dimension: '运动', name: '羽毛球' } },
      personId: 'p1',
      links,
      tags: [badminton],
      mergeGroups: [],
      now: T0,
    })
    expect(noop).toEqual({ tagRows: [], linkRows: [] })
  })

  it('改：标签名在本人标签中命中多条且无法凭维度唯一定位 → INVALID_INPUT', () => {
    const sportsBadminton = interestTag('运动:羽毛球', '羽毛球', '运动')
    const entertainmentBadminton = interestTag('娱乐:羽毛球', '羽毛球', '娱乐')
    const ambiguousLinks = [
      tagLink({ personId: 'p1', tag: sportsBadminton, confidence: 0.8, evidenceMessageIds: ['m1'] }),
      tagLink({ personId: 'p1', tag: entertainmentBadminton, confidence: 0.6, evidenceMessageIds: ['m2'] }),
    ]

    const code = errorCodeOf(() =>
      planInterestTagEdit({
        edit: { memberId: 'p1', action: '改', tag: { dimension: '社交', name: '羽毛球' } },
        personId: 'p1',
        links: ambiguousLinks,
        tags: [sportsBadminton, entertainmentBadminton],
        mergeGroups: [],
        now: T0,
      }),
    )
    expect(code).toBe('INVALID_INPUT')
  })

  it('规划是纯函数：同一输入两次调用输出一致（可重算）', () => {
    const input = {
      edit: { memberId: 'p1', action: '增' as const, tag: { dimension: '艺术' as Dimension, name: '摄影' } },
      personId: 'p1',
      links,
      tags: [badminton],
      mergeGroups: [],
      now: T0,
    }

    expect(planInterestTagEdit(input)).toEqual(planInterestTagEdit(input))
  })
})
