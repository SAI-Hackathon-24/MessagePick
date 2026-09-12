/**
 * MOD-007 人的同步、身份对齐与「我」相关（mod-007 §3.1、§5.1、§8 决策 4 / 5；
 * `REQ-006`、`REQ-082`、`AC-127` ~ `AC-131`）。
 *
 * 覆盖重点：
 * - 跨群合并到人：**只有已确认映射**才把人合并；未确认与已否定一律按独立个体处理
 *   （重点断言④「未确认身份映射在任何出参中不可达」）；
 * - 「我」的判定（Me 标识 → 唯一的人）、我的群友（去重到人、排除我）；
 * - 未知成员不标注、不推断（初始零值基线；判定阈值在 `scoring.test.ts` 复算）；
 * - 身份对齐：三级本地匹配、候选生成（≥ 2 个不同群）、重复生成不覆盖既有结论。
 */

import { describe, expect, it } from 'vitest'

import type { Person } from '@shared'

import {
  candidateIdOf,
  applyDecision,
  generateCandidates,
  matchMembersOfContact,
  mergeCandidateRecords,
} from '../align'
import { editDistanceWithin, matchLevel, normalizeName } from '../align/matching'
import {
  displayNameOf,
  findMe,
  groupsOf,
  myFriendPersonIds,
  personOfMember,
  syncPeople,
} from '../person'
import { commonTagsOf, effectiveTags } from '../scoring'

import {
  T0,
  candidate,
  contact,
  interestTag,
  member,
  personRecord,
  tagLink,
} from './fixtures'

// ---------------------------------------------------------------------------
// 人在同步与身份合并（DM-011 / REQ-082 / AC-129 / AC-130）
// ---------------------------------------------------------------------------

describe('人在同步（只有已确认映射才合并）', () => {
  const members = [
    member('m1', 'g1', '小明'),
    member('m2', 'g2', '小明'),
    member('m3', 'g1', '小红'),
  ]

  it('空输入 → 空结果', () => {
    expect(syncPeople({ members: [], candidates: [] })).toEqual({ persons: [], personByMember: new Map() })
  })

  it('无候选映射：一人 = 一个群成员（独立个体）', () => {
    const result = syncPeople({ members, candidates: [] })

    // 人标识 = MOD-002 的归属口径 `person:<群>:<成员>`（不是成员标识本身）
    expect(result.persons.map((person) => person.personId)).toEqual([
      'person:g1:m1',
      'person:g1:m3',
      'person:g2:m2',
    ])
    expect(result.personByMember.get('m1')).toBe('person:g1:m1')
    expect(result.personByMember.get('m2')).toBe('person:g2:m2')
  })

  it('未确认候选不生效：不合并，按独立个体处理（重点断言④）', () => {
    const result = syncPeople({
      members,
      candidates: [candidate('c1', ['m1', 'm2'], '未确认')],
    })

    expect(result.persons).toHaveLength(3)
    expect(result.personByMember.get('m2')).toBe('person:g2:m2')
    expect(result.persons.find((person) => person.personId === 'person:g1:m1')?.memberIds).toEqual(['m1'])
  })

  it('已否定候选不生效：不合并', () => {
    const result = syncPeople({
      members,
      candidates: [candidate('c1', ['m1', 'm2'], '已否定')],
    })

    expect(result.persons).toHaveLength(3)
    expect(result.personByMember.get('m2')).toBe('person:g2:m2')
  })

  it('已确认候选合并：人标识 = 组内 personId 最小值、成员集合跨群、映射一致', () => {
    const result = syncPeople({
      members,
      candidates: [candidate('c1', ['m2', 'm1'], '已确认')],
    })

    expect(result.persons).toHaveLength(2)
    // 合并后两种口径都指向同一个（最小的）人标识
    const merged = result.persons.find((person) => person.personId === 'person:g1:m1') as Person
    expect(merged.memberIds).toEqual(['m1', 'm2'])
    expect(result.personByMember.get('m1')).toBe('person:g1:m1')
    expect(result.personByMember.get('m2')).toBe('person:g1:m1')

    // 活跃度口径的成员基础：该人涉及的群 = 两个群（跨群合并到人）
    const memberById = new Map(members.map((row) => [row.memberId, row]))
    expect([...groupsOf(merged, memberById)].sort()).toEqual(['g1', 'g2'])
  })

  it('传递合并：两条确认候选经中间成员合并为一个人', () => {
    const result = syncPeople({
      members,
      candidates: [candidate('c1', ['m1', 'm2'], '已确认'), candidate('c2', ['m2', 'm3'], '已确认')],
    })

    expect(result.persons).toHaveLength(1)
    expect(result.persons[0]?.memberIds).toEqual(['m1', 'm2', 'm3'])
  })

  it('「我」= 含 Me 标识成员的人；合并后仍为真', () => {
    const withMe = [
      member('me', 'g1', '我', { isMe: true }),
      member('me2', 'g2', '小明'),
    ]
    const result = syncPeople({
      members: withMe,
      candidates: [candidate('c1', ['me', 'me2'], '已确认')],
    })

    expect(result.persons).toHaveLength(1)
    expect(result.persons[0]?.isMe).toBe(true)
    expect(findMe(result.persons)?.personId).toBe('person:g1:me')
  })

  it('同步产物不推断：活跃度 / 回复时长 / 性格分均为零值基线（等阶段 2 覆写）', () => {
    const result = syncPeople({ members, candidates: [] })
    const first = result.persons[0]

    expect(first?.activity).toBe(0)
    expect(first?.replyMedianMs).toBeNull()
    expect(first?.unknown).toBe(false)
    for (const score of Object.values(first?.dimensionScores ?? {})) expect(score).toBe(0)
    for (const score of Object.values(first?.personalityScores ?? {})) expect(score).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 「我」与群友（REQ-006 / REQ-079）
// ---------------------------------------------------------------------------

describe('「我」与我的群友（我相关视角）', () => {
  const me = personRecord('me', { memberIds: ['me'], isMe: true })
  const alice = personRecord('alice', { memberIds: ['alice'] })
  const bob = personRecord('bob', { memberIds: ['bob', 'bob-2'] })
  const carol = personRecord('carol', { memberIds: ['carol'] })
  const members = [
    member('me', 'g1', '我', { isMe: true }),
    member('alice', 'g1', '爱丽丝'),
    member('bob', 'g2', '鲍勃'),
    member('bob-2', 'g1', '鲍勃在甲群'),
    member('carol', 'g3', '卡罗尔'),
  ]
  const memberById = new Map(members.map((row) => [row.memberId, row]))

  it('findMe：「我」唯一；未就绪返回 undefined（API-023 据此给 IDENTITY_NOT_READY）', () => {
    expect(findMe([alice, me])?.personId).toBe('me')
    expect(findMe([alice, bob])).toBeUndefined()
  })

  it('我的群友 = 与「我」至少同属一个群的人（去重到人、排除我、升序）', () => {
    const friends = myFriendPersonIds(me, [me, alice, bob, carol], memberById)

    // alice 在 g1；bob 经 bob-2 在 g1（跨群合并到人）；carol 只在 g3 → 排除
    expect(friends).toEqual(['alice', 'bob'])
  })

  it('personOfMember：已合并成员解析到人；未知映射为 undefined', () => {
    const personByMember = new Map([
      ['alice', 'alice'],
      ['bob-2', 'bob'],
    ])

    expect(personOfMember(personByMember, 'bob-2')).toBe('bob')
    expect(personOfMember(personByMember, 'ghost')).toBeUndefined()
  })

  it('displayNameOf：取成员标识最小者的昵称；昵称为空时向后回退到人标识', () => {
    const person = personRecord('p1', { memberIds: ['m1', 'm2'] })
    const withNames = new Map([
      ['m1', member('m1', 'g1', '小一')],
      ['m2', member('m2', 'g2', '小二')],
    ])
    expect(displayNameOf(person, withNames)).toBe('小一')

    const withEmpty = new Map([
      ['m1', member('m1', 'g1', '')],
      ['m2', member('m2', 'g2', '小二')],
    ])
    expect(displayNameOf(person, withEmpty)).toBe('小二')

    expect(displayNameOf(person, new Map())).toBe('p1')
  })
})

// ---------------------------------------------------------------------------
// 未知成员：不标注、仍列出、图谱零连线（REQ-081 / AC-127）
// ---------------------------------------------------------------------------

describe('未知成员不推测（零连线的前置）', () => {
  it('未知成员没有有效标签 → 无共同标签 → 图谱无连线', () => {
    const known = tagLink({
      tag: interestTag('运动:羽毛球', '羽毛球', '运动'),
      confidence: 0.8,
      evidenceMessageIds: ['m1'],
    })

    // 未知成员：无标签输入
    expect(effectiveTags([], [])).toEqual([])
    expect(commonTagsOf([], [known])).toEqual([])
    expect(commonTagsOf([known], [])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 身份对齐：本地确定性匹配（§8 决策 5）
// ---------------------------------------------------------------------------

describe('名称规范化与三级匹配', () => {
  it('normalizeName：全角转半角、去空白 / 装饰符 / emoji（仅用于比较，不改写记录）', () => {
    expect(normalizeName(' 张三 ')).toBe('张三')
    expect(normalizeName('Ａｌｉｃｅ')).toBe('alice')
    expect(normalizeName('张三·')).toBe('张三')
    expect(normalizeName('张三😀')).toBe('张三')
    expect(normalizeName('张 三')).toBe('张三')
  })

  it('精确匹配：规范化后相同（含装饰差异）', () => {
    expect(matchLevel('张三', ' 张三 ')).toBe('精确')
    expect(matchLevel('Alice', 'alice')).toBe('精确')
    expect(matchLevel('张三·', '张三')).toBe('精确')
  })

  it('包含匹配：短名占长名比例达标（≥ 0.5）', () => {
    expect(matchLevel('张三', '小张三')).toBe('包含')
  })

  it('包含比例不足且长度差超限 → 不匹配（避免「李四」命中「李四的账号」）', () => {
    expect(matchLevel('李四', '李四的账号')).toBeNull()
  })

  it('编辑距离匹配：≤ 2 次编辑命中；超过则 null；短于 2 字符不参与模糊匹配', () => {
    expect(matchLevel('张小明', '张日月')).toBe('编辑距离')
    expect(matchLevel('李小明', '王大锤')).toBeNull()
    expect(matchLevel('张', '张三')).toBeNull()
    expect(matchLevel('', '张三')).toBeNull()
  })

  it('editDistanceWithin 边界：命中上限 / 超出 / 长度差提前退出', () => {
    expect(editDistanceWithin('abc', 'abd', 1)).toBe(true)
    expect(editDistanceWithin('abc', 'abcd', 1)).toBe(true)
    expect(editDistanceWithin('abc', 'abxy', 1)).toBe(false)
    expect(editDistanceWithin('abcdef', 'abcxyz', 2)).toBe(false)
    expect(editDistanceWithin('ab', 'ab', 0)).toBe(true)
  })
})

describe('候选生成与结论提交（REQ-082）', () => {
  const zhang = contact('c1', '张三')

  it('候选锚定联系人：至少匹配到 ≥ 2 个不同群的群成员才产出', () => {
    const members = [
      member('m1', 'g1', '张三'),
      member('m2', 'g2', '张三'),
      member('m3', 'g1', '王大锤'),
    ]
    const match = matchMembersOfContact(zhang, members)

    expect(match?.memberIds).toEqual(['m1', 'm2'])
    expect(match?.level).toBe('精确')
  })

  it('只匹配到一个成员、或匹配集中在一个群 → 不产出候选', () => {
    const single = [member('m1', 'g1', '张三'), member('m9', 'g1', '王大锤')]
    const sameGroup = [member('m1', 'g1', '张三'), member('m2', 'g1', '张三')]

    expect(matchMembersOfContact(zhang, single)).toBeNull()
    expect(matchMembersOfContact(zhang, sameGroup)).toBeNull()
  })

  it('generateCandidates：状态恒为「未确认」；同输入幂等（同标识）', () => {
    const input = {
      members: [member('m1', 'g1', '张三'), member('m2', 'g2', '张三')],
      contacts: [zhang],
    }

    const first = generateCandidates(input)
    const second = generateCandidates(input)

    expect(first).toHaveLength(1)
    expect(first[0]?.status).toBe('未确认')
    expect(first[0]?.confirmedAt).toBeNull()
    expect(second).toEqual(first)
    expect(first[0]?.candidateId).toBe(candidateIdOf('c1', ['m1', 'm2']))
  })

  it('candidateIdOf：成员集合顺序无关、稳定', () => {
    expect(candidateIdOf('c1', ['m1', 'm2'])).toBe(candidateIdOf('c1', ['m2', 'm1']))
    expect(candidateIdOf('c1', ['m1', 'm2'])).not.toBe(candidateIdOf('c2', ['m1', 'm2']))
  })

  it('mergeCandidateRecords：重复生成不覆盖任何既有结论（未确认 / 已确认 / 已否定）', () => {
    const existing = [
      candidate('x1', ['m1', 'm2'], '已确认', { confirmedAt: T0 }),
      candidate('x2', ['m3', 'm4'], '已否定'),
      candidate('x3', ['m5', 'm6'], '未确认'),
    ]
    const drafts = [candidate('x1', ['m1', 'm2']), candidate('x3', ['m5', 'm6']), candidate('x4', ['m7', 'm8'])]

    expect(mergeCandidateRecords(existing, drafts).map((row) => row.candidateId)).toEqual(['x4'])
  })

  it('applyDecision：确认写时间、否定清空时间（单出口状态机）', () => {
    const draft = candidate('c1', ['m1', 'm2'])

    expect(applyDecision(draft, '确认', T0)).toMatchObject({ status: '已确认', confirmedAt: T0 })
    expect(applyDecision(draft, '否定', T0)).toMatchObject({ status: '已否定', confirmedAt: null })
  })

  it('集成：确认结论进入人在同步后合并生效；未确认结论不生效', () => {
    const members = [member('m1', 'g1', '张三'), member('m2', 'g2', '张三')]
    const drafts = generateCandidates({ members, contacts: [zhang] })
    const draft = drafts[0]
    if (draft === undefined) throw new Error('期望生成身份对齐候选')

    // 未确认：不合并
    const pending = syncPeople({ members, candidates: [draft] })
    expect(pending.persons).toHaveLength(2)

    // 确认：合并为同一人
    const confirmed = syncPeople({ members, candidates: [applyDecision(draft, '确认', T0)] })
    expect(confirmed.persons).toHaveLength(1)
    expect(confirmed.personByMember.get('m2')).toBe('person:g1:m1')

    // 否定：不合并
    const rejected = syncPeople({ members, candidates: [applyDecision(draft, '否定', T0)] })
    expect(rejected.persons).toHaveLength(2)
  })
})
