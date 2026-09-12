/**
 * 临时审计脚本（不属于仓库交付物；审计完成后删除）。
 */

import { describe, expect, it } from 'vitest'

import type {
  ContactRecord,
  GroupMember,
  IdentityCandidate,
  InterestTag,
  Person,
  PersonInterestTag,
  PersonalityTag,
  RawMessage,
} from '@shared'

import { SocialIndex, buildIndexSnapshot } from '../build/index-store'
import { SocialHttpAdapter } from '../http'
import type { SocialTaskGateway } from '../build/gateway'
import { syncPeople } from '../person'

import { FakeStore, T0, MINUTE, member, msg } from './fixtures'

function tag(tagId: string, name: string, dimension: InterestTag['dimension'], heatScore = 0): InterestTag {
  return { tagId, name, dimension, mergeGroupId: null, firstSeenAt: T0, eventStream: [], heatScore }
}

function link(personId: string, tagId: string, confidence: number, evidence: string[] = []): PersonInterestTag {
  return { personId, tagId, confidence, evidenceMessageIds: evidence, origin: '模型抽取' }
}

interface SeedOptions {
  members: GroupMember[]
  messages: RawMessage[]
  tags: InterestTag[]
  links: PersonInterestTag[]
  personality?: PersonalityTag[]
  contacts?: ContactRecord[]
  candidates?: IdentityCandidate[]
  interactions?: any[]
}

function build(seed: SeedOptions) {
  const store = new FakeStore()
  const sync = syncPeople({ members: seed.members, candidates: seed.candidates ?? [] })
  const persons: Person[] = sync.persons.map((person) => {
    const activity = seed.messages.filter((row) => person.memberIds.includes(row.senderMemberId)).length
    return { ...person, activity, unknown: activity < 5 }
  })
  store.seed('DM-004', seed.members)
  store.seed('DM-003', seed.messages)
  store.seed('DM-011', persons)
  store.seed('DM-013', seed.tags)
  store.seed('DM-014', seed.links)
  store.seed('DM-015', [])
  store.seed('DM-016', seed.personality ?? [])
  store.seed('DM-012', seed.candidates ?? [])
  store.seed('DM-005', seed.contacts ?? [])
  store.seed('DM-017', seed.interactions ?? [])
  store.seed('DM-001', [
    {
      source: '通讯录与好友列表',
      status: '成功',
      lastSuccessAt: T0,
      failureReason: null,
      updatedUntilX: T0,
      hasData: true,
    } as any,
  ])
  const index = new SocialIndex()
  index.setSnapshot(buildIndexSnapshot(store, store.epoch, T0))
  return { store, index, persons, sync }
}

const gateway: SocialTaskGateway = {
  execute: (async () => ({ ok: true, result: { items: [{ text: '组局建议文字' }] } })) as any,
  retry: (async () => ({ ok: true, result: { items: [{ text: '重试文字' }] } })) as any,
}

function seedStandard() {
  const members = [
    member('me', 'g1', '我', { isMe: true }),
    member('a', 'g1', '小明'),
    member('b', 'g1', '小红'),
    member('c', 'g2', '小刚'),
  ]
  const messages = [
    ...Array.from({ length: 10 }, (_, i) => msg(`m-me-${i}`, 'g1', 'me', T0 + i * MINUTE)),
    ...Array.from({ length: 8 }, (_, i) => msg(`m-a-${i}`, 'g1', 'a', T0 + i * MINUTE)),
    ...Array.from({ length: 6 }, (_, i) => msg(`m-b-${i}`, 'g1', 'b', T0 + (i + 20) * MINUTE)),
    ...Array.from({ length: 7 }, (_, i) => msg(`m-c-${i}`, 'g2', 'c', T0 + (i + 40) * MINUTE)),
  ]
  const tags = [
    tag('运动:羽毛球', '羽毛球', '运动'),
    tag('娱乐:看电影', '看电影', '娱乐'),
    tag('社交:闲聊', '闲聊', '社交'),
  ]
  const links = [
    link('me', '运动:羽毛球', 0.8, ['m-me-0']),
    link('me', '社交:闲聊', 0.6, ['m-me-1']),
    link('a', '运动:羽毛球', 1, ['m-a-0']),
    link('a', '娱乐:看电影', 0.5, ['m-a-1']),
    link('b', '运动:羽毛球', 0.4, ['m-b-0']),
    link('c', '娱乐:看电影', 0.9, ['m-c-0']),
  ]
  const personality: PersonalityTag[] = [
    { tagId: 'pt:a:活泼', personId: 'a', dimension: '活泼', score: 0.7, status: '已确认', origin: '模型推断' },
    { tagId: 'pt:a:幽默', personId: 'a', dimension: '幽默', score: 0.9, status: '候选', origin: '模型推断' },
  ]
  return { members, messages, tags, links, personality }
}

describe('审计 A：查询路径', () => {
  it('打印十个接口的输出', async () => {
    const seed = seedStandard()
    const { store, index } = build(seed)
    const api = new SocialHttpAdapter({ store, index, gateway, clock: () => T0 })

    const profile = await api.getProfile({ memberId: 'a' })
    console.log('A1 profile(a) =', JSON.stringify(profile, null, 1))

    const byDim = await api.searchPeople({ entry: '按一级维度', value: '运动' })
    console.log('A2 searchByDim(运动) =', JSON.stringify(byDim))

    const byTag = await api.searchPeople({ entry: '按二级标签', value: '羽毛球' })
    console.log('A3 searchByTag(羽毛球) =', JSON.stringify(byTag))

    const pair = await api.getPair({ memberAId: 'a', memberBId: 'b' })
    console.log('A4 pair(a,b) =', JSON.stringify(pair))

    const pairRev = await api.getPair({ memberAId: 'b', memberBId: 'a' })
    console.log('A5 pair(b,a) =', JSON.stringify(pairRev))

    const mine = await api.getMyAffinity()
    console.log('A6 myAffinity =', JSON.stringify(mine))

    const hints = await api.getInterestHints({ memberIds: ['a', 'b', 'c'] })
    console.log('A7 hints =', JSON.stringify(hints))

    const unknownMember = await api.getProfile({ memberId: 'unknown-member' }).catch((e) => e)
    console.log('A8 profile(unknown) =', unknownMember?.code ?? unknownMember)

    const suggest = await api.suggestGroupActivity({ interest: '羽毛球', candidateMemberIds: ['a', 'b'] })
    console.log('A9 suggest =', JSON.stringify(suggest))

    expect(true).toBe(true)
  })
})

describe('审计 B：API-028 写路径（增 / 删 / 改）', () => {
  it('改：把已有标签换成新名字', async () => {
    const seed = seedStandard()
    const { store, index } = build(seed)
    const api = new SocialHttpAdapter({ store, index, gateway, clock: () => T0 })

    const ok = await api.editInterestTag({
      memberId: 'a',
      action: '改',
      tag: { dimension: '运动', name: '篮球' },
    })
    console.log('B1 改(新名) =', JSON.stringify(ok))
  })

  it('改：同名换维度', async () => {
    const seed = seedStandard()
    const { store, index } = build(seed)
    const api = new SocialHttpAdapter({ store, index, gateway, clock: () => T0 })
    const ok = await api
      .editInterestTag({ memberId: 'a', action: '改', tag: { dimension: '娱乐', name: '羽毛球' } })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('B2 改(同名换维度) =', JSON.stringify(ok))
  })

  it('增 / 删', async () => {
    const seed = seedStandard()
    const { store, index } = build(seed)
    const api = new SocialHttpAdapter({ store, index, gateway, clock: () => T0 })
    const added = await api
      .editInterestTag({ memberId: 'a', action: '增', tag: { dimension: '游戏', name: '王者荣耀' } })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('B3 增 =', JSON.stringify(added))
    const removed = await api
      .editInterestTag({ memberId: 'a', action: '删', tag: { dimension: '运动', name: '羽毛球' } })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('B4 删 =', JSON.stringify(removed))
  })
})

describe('审计 C：API-027 性格标签写路径', () => {
  it('确认 / 增 / 删 / 改', async () => {
    const seed = seedStandard()
    const { store, index } = build(seed)
    const api = new SocialHttpAdapter({ store, index, gateway, clock: () => T0 })
    const confirm = await api
      .editPersonalityTag({ memberId: 'a', action: '确认', dimension: '幽默' })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('C1 确认(幽默候选) =', JSON.stringify(confirm))
    const add = await api
      .editPersonalityTag({ memberId: 'a', action: '增', dimension: '冷静' })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('C2 增 =', JSON.stringify(add))
    const change = await api
      .editPersonalityTag({ memberId: 'a', action: '改', dimension: '理性' })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('C3 改 =', JSON.stringify(change))
    const del = await api
      .editPersonalityTag({ memberId: 'a', action: '删', dimension: '活泼' })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('C4 删 =', JSON.stringify(del))
    const profile = await api.getProfile({ memberId: 'a' })
    console.log('C5 profile personalityTags =', JSON.stringify(profile.personalityTags))
    expect(true).toBe(true)
  })
})

describe('审计 D：筛选窗口（群 / 时间范围）', () => {
  it('时间范围重算活跃度', async () => {
    const seed = seedStandard()
    const { store, index } = build(seed)
    const api = new SocialHttpAdapter({ store, index, gateway, clock: () => T0 })
    const out = await api.getProfile({
      memberId: 'a',
      filter: { timeRange: { from: T0, to: T0 + 3 * MINUTE } },
    })
    console.log('D1 windowed profile =', JSON.stringify(out))
  })
})
