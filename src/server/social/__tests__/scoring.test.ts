/**
 * MOD-007 评分层（mod-007 §5.4 与 §8 决策 1 / 2 / 4；`REQ-052`、`REQ-057`、`REQ-058`、`REQ-078` ~ `REQ-080`、`REQ-086`）。
 *
 * 覆盖重点（§7「重点断言」①②）：
 * - 维度分 = 该维度有效标签置信度之和，可手工复算；社交维度分随活跃度单调变化；
 * - 契合度因子（共同标签数 / 置信度 / 互动 / 活跃度）单调，T 与 C 只取四维语义标签
 *   （社交维度与活跃度同源，其贡献由 V 承担**一次**）；
 * - 全部公式无时间项（「不做时效衰减」的链路级断言见 `interactions.test.ts`）。
 */

import { describe, expect, it } from 'vitest'

import { DIMENSIONS, PERSONALITY_DIMENSIONS } from '@shared'

import {
  AFFINITY_WEIGHTS,
  SCORING_VERSION,
  SOCIAL_DIMENSIONS,
  affinity,
  clamp01,
  commonTagsOf,
  confidenceOf,
  dimensionDiffs,
  dimensionScores,
  effectiveTags,
  emptyDimensionScores,
  emptyPersonalityScores,
  interestHeat,
  isUnknown,
  overallIntegration,
  pairKeyOf,
  roundTo,
  socialActivityFactor,
} from '../scoring'

import {
  commonTag,
  effectiveTag,
  friendStats,
  interestTag,
  mergeGroup,
  personStats,
  tagLink,
} from './fixtures'

// ---------------------------------------------------------------------------
// 置信度（§5.4）
// ---------------------------------------------------------------------------

describe('置信度（§5.4）', () => {
  it('语义标签置信度 = clamp01(抽取强度)，保留 3 位小数', () => {
    expect(confidenceOf(0.4, '运动', 0)).toBe(0.4)
    expect(confidenceOf(3, '运动', 100)).toBe(1)
    expect(confidenceOf(-1, '艺术', 100)).toBe(0)
    expect(confidenceOf(Number.NaN, '游戏', 100)).toBe(0)
    expect(confidenceOf(0.12345, '娱乐', 0)).toBe(0.123)
  })

  it('语义标签置信度与活跃度无关（联动只针对社交维度）', () => {
    expect(confidenceOf(0.8, '运动', 0)).toBe(confidenceOf(0.8, '运动', 100))
  })

  it('社交维度置信度 = clamp01(强度) × min(1, sqrt((活跃度+1)/50))，可复算', () => {
    // 活跃度 0：因子 = sqrt(1/50) = 0.141421… → 0.141
    expect(confidenceOf(1, '社交', 0)).toBe(0.141)
    // 活跃度 24：因子 = sqrt(25/50) = 0.707106… → 0.707
    expect(confidenceOf(1, '社交', 24)).toBe(0.707)
    // 活跃度 49：因子 = sqrt(50/50) = 1，超量后封顶
    expect(confidenceOf(0.9, '社交', 49)).toBe(0.9)
    expect(confidenceOf(0.9, '社交', 100)).toBe(0.9)
    // 强度侧同样 clamp01
    expect(confidenceOf(2, '社交', 49)).toBe(1)
  })

  it('社交活跃度因子单调不减且封顶于 1（AC-101 的“同步变化”前提）', () => {
    expect(socialActivityFactor(0)).toBeLessThan(socialActivityFactor(10))
    expect(socialActivityFactor(10)).toBeLessThan(socialActivityFactor(48))
    expect(socialActivityFactor(49)).toBe(1)
    expect(socialActivityFactor(1000)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 有效标签（§5.4「有效标签」；REQ-053 ~ REQ-055、AC-099 / AC-100）
// ---------------------------------------------------------------------------

describe('有效标签（归并与证据口径）', () => {
  it('归并组内取代表标签、置信度取最大值、证据并集，每组只产出一条', () => {
    const representative = interestTag('运动:羽毛球', '羽毛球', '运动')
    const mergedName = interestTag('运动:羽球', '羽球', '运动')
    const links = [
      tagLink({ tag: representative, confidence: 0.6, evidenceMessageIds: ['m1'] }),
      tagLink({ tag: mergedName, confidence: 0.8, evidenceMessageIds: ['m2'] }),
    ]

    const result = effectiveTags(links, [mergeGroup(representative.tagId, [mergedName.tagId])])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      tagId: '运动:羽毛球',
      name: '羽毛球',
      dimension: '运动',
      confidence: 0.8,
      evidenceMessageIds: ['m1', 'm2'],
      mergedTagIds: ['运动:羽球'],
    })
  })

  it('无证据的模型标签不进画像（REQ-054）', () => {
    const tag = interestTag('运动:攀岩', '攀岩', '运动')
    const links = [tagLink({ tag, confidence: 0.9, evidenceMessageIds: [] })]

    expect(effectiveTags(links, [])).toEqual([])
  })

  it('人工增改的标签没有证据也照常生效（REQ-056）', () => {
    const tag = interestTag('艺术:摄影', '摄影', '艺术')
    const links = [
      tagLink({ tag, confidence: 1, evidenceMessageIds: [], origin: '人工增改' }),
    ]

    expect(effectiveTags(links, [])).toHaveLength(1)
    expect(effectiveTags(links, [])[0]?.confidence).toBe(1)
  })

  it('墓碑行（人工增改 + 零置信度）不进任何产物（删的落点）', () => {
    const tag = interestTag('艺术:摄影', '摄影', '艺术')
    const links = [
      tagLink({ tag, confidence: 1, evidenceMessageIds: ['m0'] }),
      tagLink({ tag, confidence: 0, evidenceMessageIds: [], origin: '人工增改' }),
    ]

    // 同一标签两组连接：人工墓碑不应把模型有效行“拖没”，但也不单独产出。
    const result = effectiveTags(links, [])
    expect(result).toHaveLength(1)
    expect(result[0]?.confidence).toBe(1)
  })

  it('归并组内全部连接都失效时该组不产出（人工删除后只剩无证据模型行）', () => {
    const representative = interestTag('运动:羽毛球', '羽毛球', '运动')
    const mergedName = interestTag('运动:羽球', '羽球', '运动')
    const links = [
      tagLink({ tag: representative, confidence: 0.9, evidenceMessageIds: [] }),
      tagLink({ tag: mergedName, confidence: 0, evidenceMessageIds: [], origin: '人工增改' }),
    ]

    expect(effectiveTags(links, [mergeGroup(representative.tagId, [mergedName.tagId])])).toEqual([])
  })

  it('未归并的标签各自成组（二级标签可自由创建）', () => {
    const swimming = interestTag('运动:游泳', '游泳', '运动')
    const reading = interestTag('娱乐:读书', '读书', '娱乐')
    const links = [
      tagLink({ tag: swimming, confidence: 0.5, evidenceMessageIds: ['m1'] }),
      tagLink({ tag: reading, confidence: 0.7, evidenceMessageIds: ['m2'] }),
    ]

    const result = effectiveTags(links, [])
    expect(result.map((tag) => tag.tagId).sort()).toEqual(['娱乐:读书', '运动:游泳'])
  })
})

// ---------------------------------------------------------------------------
// 维度分（§5.4；REQ-080、AC-097 / AC-126）
// ---------------------------------------------------------------------------

describe('维度分与差值（可复算）', () => {
  it('维度分 = 该维度下全部有效标签置信度之和（手工复算）', () => {
    const scores = dimensionScores([
      effectiveTag('运动:羽毛球', '运动', 0.8),
      effectiveTag('运动:跑步', '运动', 0.5),
      effectiveTag('艺术:绘画', '艺术', 0.6),
      effectiveTag('社交:群聊活跃', '社交', 0.9),
    ])

    expect(scores).toEqual({
      运动: 1.3,
      艺术: 0.6,
      游戏: 0,
      娱乐: 0,
      社交: 0.9,
    })
  })

  it('空标签集 → 五轴全零，且键集合恰好是一级五类闭集', () => {
    const scores = emptyDimensionScores()
    expect(Object.keys(scores).sort()).toEqual([...DIMENSIONS].sort())
    for (const dimension of DIMENSIONS) expect(scores[dimension]).toBe(0)
    expect(dimensionScores([])).toEqual(scores)
  })

  it('性格零值恰好是六维闭集（候选不出现的基线：无已确认记录 = 全零）', () => {
    const scores = emptyPersonalityScores()
    expect(Object.keys(scores).sort()).toEqual([...PERSONALITY_DIMENSIONS].sort())
    for (const dimension of PERSONALITY_DIMENSIONS) expect(scores[dimension]).toBe(0)
  })

  it('逐维度差值 = 两轴相减（可复算、保留负值）', () => {
    const a = dimensionScores([
      effectiveTag('运动:羽毛球', '运动', 2.5),
      effectiveTag('艺术:绘画', '艺术', 0.2),
    ])
    const b = dimensionScores([effectiveTag('运动:跑步', '运动', 1), effectiveTag('艺术:雕塑', '艺术', 0.5)])

    expect(dimensionDiffs(a, b)).toEqual({
      运动: 1.5,
      艺术: -0.3,
      游戏: 0,
      娱乐: 0,
      社交: 0,
    })
  })

  it('社交维度分随活跃度单调变化，且等于 Σ 置信度（AC-101 与 AC-126 同时成立）', () => {
    const confidences = [5, 25, 49].map((activity) => confidenceOf(0.8, '社交', activity))
    expect(confidences[0]).toBeLessThan(confidences[1] as number)
    expect(confidences[1]).toBeLessThan(confidences[2] as number)

    const scoreAt = (activity: number): number =>
      dimensionScores([effectiveTag('社交:闲聊', '社交', confidenceOf(0.8, '社交', activity))])['社交']
    expect(scoreAt(5)).toBe(confidences[0])
    expect(scoreAt(49)).toBe(0.8)
  })

  it('证据条数与时间分布不参与维度分（时间轴 / 事件流不进权重，REQ-087）', () => {
    const few = effectiveTag('运动:骑行', '运动', 0.7, { evidenceMessageIds: ['m1'] })
    const many = effectiveTag('运动:骑行', '运动', 0.7, {
      evidenceMessageIds: ['m1', 'm2', 'm3', 'm4', 'm5'],
    })

    expect(dimensionScores([few])).toEqual(dimensionScores([many]))
  })
})

// ---------------------------------------------------------------------------
// 契合度（§5.4；REQ-057 / REQ-058 / REQ-086、AC-102 / AC-103 / AC-135）
// ---------------------------------------------------------------------------

describe('两人契合度（因子与口径）', () => {
  const fiveSemantic = (confidence: number) => [
    commonTag('运动:羽毛球', '运动', confidence, confidence),
    commonTag('艺术:摄影', '艺术', confidence, confidence),
    commonTag('游戏:桌游', '游戏', confidence, confidence),
    commonTag('娱乐:电影', '娱乐', confidence, confidence),
    commonTag('娱乐:音乐', '娱乐', confidence, confidence),
  ]

  it('全因子手工复算：100 × (0.35·T + 0.25·C + 0.25·I + 0.15·V)', () => {
    const a = personStats('p1', 50)
    const b = personStats('p2', 100)
    const score = affinity(a, b, fiveSemantic(0.6), 5)

    // T = 5/5 = 1；C = 0.6；I = 5/10 = 0.5；V = 50/100 = 0.5
    expect(score).toBe(70)
  })

  it('T 与 C 只取运动 / 艺术 / 游戏 / 娱乐四维；社交标签不进这两项', () => {
    const a = personStats('p1', 100)
    const b = personStats('p2', 100)
    // 四个语义共同标签 + 一个社交共同标签：T = 4/5、C = 0.8，社交的 0.5 不参与。
    const tags = [...fiveSemantic(0.8).slice(0, 4), commonTag('社交:群聊活跃', '社交', 0.5, 0.5)]

    // 若社交计入 T / C：T = 1、C = (0.8×4 + 0.5)/5 = 0.74 → 68.5；正确口径 = 63
    expect(affinity(a, b, tags, 0)).toBe(63)
  })

  it('活跃度只计一次：社交标签置信度变化不影响契合度，活跃度变化只经 V 项', () => {
    const base = [...fiveSemantic(0.8), commonTag('社交:群聊活跃', '社交', 0.5, 0.5)]

    const before = affinity(personStats('p1', 50), personStats('p2', 100), base, 0)
    // 社交标签置信度翻倍：被 T / C 排除 → 结果不变（其贡献只由 V 承担）。
    const swappedSocial = base.map((tag, index) =>
      index === base.length - 1 ? commonTag(tag.tagId, tag.dimension, 1, 1) : tag,
    )
    expect(affinity(personStats('p1', 50), personStats('p2', 100), swappedSocial, 0)).toBe(before)

    // 活跃度 50 → 100：V 从 0.5 → 1，增量 = 0.15 × 0.5 × 100 = 7.5
    expect(affinity(personStats('p1', 100), personStats('p2', 100), swappedSocial, 0)).toBe(before + 7.5)
  })

  it('共同标签数单调：数量增加分数不减（T 趋近封顶）', () => {
    const a = personStats('p1', 100)
    const b = personStats('p2', 100)
    const scores = [0, 1, 2, 4, 5].map((count) => affinity(a, b, fiveSemantic(0.6).slice(0, count), 0))

    for (let index = 1; index < scores.length; index += 1) {
      expect(scores[index] as number).toBeGreaterThan(scores[index - 1] as number)
    }
  })

  it('置信度单调：共同标签置信度提高分数增加', () => {
    const a = personStats('p1', 0)
    const b = personStats('p2', 0)
    expect(affinity(a, b, fiveSemantic(0.8), 0)).toBeGreaterThan(affinity(a, b, fiveSemantic(0.4), 0))
  })

  it('互动单调：互动条数增加分数不减，10 条后封顶（I 的上限）', () => {
    const a = personStats('p1', 0)
    const b = personStats('p2', 0)
    const at = (count: number): number => affinity(a, b, fiveSemantic(0.6), count)

    expect(at(5)).toBeGreaterThan(at(0))
    expect(at(10)).toBeGreaterThan(at(5))
    expect(at(20)).toBe(at(10))
  })

  it('活跃度以短板为准（min），且负值与非法输入不会反向抬分', () => {
    const tags = fiveSemantic(0.6)
    expect(affinity(personStats('p1', 40), personStats('p2', 100), tags, 0)).toBe(
      affinity(personStats('p1', 40), personStats('p2', 40), tags, 0),
    )
    expect(affinity(personStats('p1', -10), personStats('p2', -10), tags, 0)).toBe(
      affinity(personStats('p1', 0), personStats('p2', 0), tags, 0),
    )
    expect(affinity(personStats('p1', 0), personStats('p2', 0), tags, -5)).toBe(
      affinity(personStats('p1', 0), personStats('p2', 0), tags, 0),
    )
  })

  it('公式无时间项：同一输入重复计算恒等（时间前移不变性见链路测试）', () => {
    const a = personStats('p1', 80)
    const b = personStats('p2', 20)
    const tags = fiveSemantic(0.7)
    expect(affinity(a, b, tags, 3)).toBe(affinity(a, b, tags, 3))
  })

  it('commonTagsOf 取交集并保留两侧置信度；含社交维度；顺序稳定', () => {
    const a = [
      { tagId: '娱乐:音乐', name: '音乐', dimension: '娱乐' as const, confidence: 0.9 },
      { tagId: '运动:羽毛球', name: '羽毛球', dimension: '运动' as const, confidence: 0.5 },
      { tagId: '社交:群聊活跃', name: '群聊活跃', dimension: '社交' as const, confidence: 0.4 },
    ]
    const b = [
      { tagId: '运动:羽毛球', name: '羽毛球', dimension: '运动' as const, confidence: 0.7 },
      { tagId: '娱乐:音乐', name: '音乐', dimension: '娱乐' as const, confidence: 0.6 },
    ]

    const common = commonTagsOf(a, b)
    expect(common.map((tag) => tag.tagId)).toEqual(['娱乐:音乐', '运动:羽毛球'])
    expect(common[0]).toMatchObject({ confidenceA: 0.9, confidenceB: 0.6 })
    // 无交集部分（社交）不出现
    expect(common.some((tag) => tag.dimension === '社交')).toBe(false)
  })

  it('pairKeyOf 形成无序对规范键（DM-018 记录身份键）', () => {
    expect(pairKeyOf('b', 'a')).toBe('a+b')
    expect(pairKeyOf('a', 'b')).toBe('a+b')
    expect(pairKeyOf('a', 'a')).toBe('a+a')
  })
})

// ---------------------------------------------------------------------------
// 整体融入度与兴趣热度分（§5.4；REQ-078 / REQ-079、AC-107）
// ---------------------------------------------------------------------------

describe('整体融入度（我的社交契合度）', () => {
  it('无群友返回 null（不显示 0 或猜测值）', () => {
    expect(overallIntegration([], [])).toBeNull()
    expect(overallIntegration([], [friendStats('me', 100, true)])).toBeNull()
  })

  it('单一分数：Σ(契合度 × max(1, 活跃度)) / Σ(max(1, 活跃度))，手工复算', () => {
    const pairs = [
      { pairId: 'p1+p2', personAId: 'p1', personBId: 'p2', commonTagIds: [], fitScore: 70, dimensionDiffs: emptyDimensionScores() },
      { pairId: 'p1+p3', personAId: 'p1', personBId: 'p3', commonTagIds: [], fitScore: 80, dimensionDiffs: emptyDimensionScores() },
    ]
    const friends = [friendStats('p2', 100), friendStats('p3', 0)]

    // (70×100 + 80×1) / (100 + 1) = 7080 / 101 = 70.099009… → 70.099
    expect(overallIntegration(pairs, friends)).toBe(70.099)
  })

  it('排除「我」、同一人只计一次（去重到人）', () => {
    const pairs = [
      { pairId: 'p1+p2', personAId: 'p1', personBId: 'p2', commonTagIds: [], fitScore: 60, dimensionDiffs: emptyDimensionScores() },
    ]
    const friends = [
      friendStats('me', 100, true),
      friendStats('p2', 10),
      friendStats('p2', 10),
    ]

    // 只计 p2 一次：60 × max(1,10) / max(1,10) = 60
    expect(overallIntegration(pairs, friends)).toBe(60)
  })

  it('无配对结果的群友以 0 分计入权重（不拉高整体）', () => {
    const pairs = [
      { pairId: 'p1+p2', personAId: 'p1', personBId: 'p2', commonTagIds: [], fitScore: 100, dimensionDiffs: emptyDimensionScores() },
    ]
    const friends = [friendStats('p2', 100), friendStats('p3', 100)]

    // (100×100 + 0×100) / 200 = 50
    expect(overallIntegration(pairs, friends)).toBe(50)
  })

  it('低活跃群友的权重下限为 1（不因 0 活跃被吞掉）', () => {
    const pairs = [
      { pairId: 'p1+p2', personAId: 'p1', personBId: 'p2', commonTagIds: [], fitScore: 95, dimensionDiffs: emptyDimensionScores() },
    ]
    expect(overallIntegration(pairs, [friendStats('p2', 0)])).toBe(95)
  })
})

describe('兴趣热度分', () => {
  it('Σ 置信度 × sqrt(1 + 活跃度)，手工复算（阻尼防独占）', () => {
    const tags = [
      effectiveTag('运动:羽毛球', '运动', 0.5, { personId: 'p1' }),
      effectiveTag('运动:羽毛球', '运动', 0.5, { personId: 'p2' }),
    ]
    const people = [personStats('p1', 0), personStats('p2', 3)]

    // 0.5 × sqrt(1) + 0.5 × sqrt(4) = 0.5 + 1 = 1.5
    expect(interestHeat(tags, people)).toBe(1.5)
  })

  it('同一个人重复出现只计一次', () => {
    const tags = [
      effectiveTag('运动:羽毛球', '运动', 0.5, { personId: 'p1' }),
      effectiveTag('运动:跑步', '运动', 0.5, { personId: 'p1' }),
    ]
    expect(interestHeat(tags, [personStats('p1', 0)])).toBe(0.5)
  })

  it('高活跃者不应独占：低活跃者的贡献仍按 sqrt 计入', () => {
    const tags = [
      effectiveTag('娱乐:电影', '娱乐', 1, { personId: 'heavy' }),
      effectiveTag('娱乐:电影', '娱乐', 1, { personId: 'light' }),
    ]
    const people = [personStats('heavy', 9999), personStats('light', 0)]

    // 1 × sqrt(10000) + 1 × sqrt(1) = 101
    expect(interestHeat(tags, people)).toBe(101)
  })

  it('空集返回 0', () => {
    expect(interestHeat([], [])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 未知标记与工具（§5.4；REQ-081、AC-127）
// ---------------------------------------------------------------------------

describe('未知标记与工具', () => {
  it('未知阈值：活跃度 < 5 → 未知；≥ 5 可推断（边界复算）', () => {
    expect(isUnknown(0)).toBe(true)
    expect(isUnknown(4)).toBe(true)
    expect(isUnknown(5)).toBe(false)
    expect(isUnknown(100)).toBe(false)
  })

  it('clamp01 收敛区间与非法值', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(0.3)).toBe(0.3)
    expect(clamp01(7)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
  })

  it('roundTo 按位数四舍五入（复算可比）', () => {
    expect(roundTo(0.12349)).toBe(0.123)
    expect(roundTo(0.1235)).toBe(0.124)
    expect(roundTo(2.5, 0)).toBe(3)
  })

  it('口径常量不变量：一级五类闭集、社交单列、语义四维、权重和为 1', () => {
    expect(SOCIAL_DIMENSIONS).toEqual(DIMENSIONS)
    expect(SOCIAL_DIMENSIONS).toContain('社交')
    const weightSum =
      AFFINITY_WEIGHTS.tagCount +
      AFFINITY_WEIGHTS.confidence +
      AFFINITY_WEIGHTS.interaction +
      AFFINITY_WEIGHTS.activity
    expect(weightSum).toBeCloseTo(1, 10)
    expect(SCORING_VERSION).toMatch(/^social-scoring-v\d+$/)
  })
})
