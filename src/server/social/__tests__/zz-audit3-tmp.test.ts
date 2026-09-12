/**
 * 临时审计脚本 3：使用**真实 MOD-002 store**（better-sqlite3 临时库）复现（审计后删除）。
 */

import { afterEach, describe, expect, it } from 'vitest'

import type { EntityRecord } from '@shared'

import { SocialIndex, buildIndexSnapshot } from '../build/index-store'
import { SocialBuildPipeline } from '../build/index'
import { SocialHttpAdapter } from '../http'
import type { SocialTaskGateway } from '../build/gateway'

import {
  CLOCK,
  StoreHarness,
  groupRecord,
  memberRecord,
  messageRecord,
  personRecord,
  personTagRecord,
  tagRecord,
} from '../../store/__tests__/harness'

const harness = new StoreHarness()
afterEach(() => harness.dispose())

const emptyGateway: SocialTaskGateway = {
  execute: (async () => ({ ok: true, result: { items: [] }, sourceRefs: [], taskRef: 't1' })) as any,
  retry: (async () => ({ ok: true, result: { items: [] }, sourceRefs: [], taskRef: 't1' })) as any,
}

describe('W1：窗口 + 关键词（真实 store）', () => {
  it('关键词命中昵称时不应把窗口消息也按文本过滤', async () => {
    const { store } = harness.create()
    store.write('DM-002', [groupRecord('g1', '甲群')])
    store.write('DM-004', [
      memberRecord('g1', 'alice', { displayName: '爱丽丝' }),
      memberRecord('g1', 'me', { displayName: '我', isMe: true }),
    ])
    store.write('DM-003', [
      ...Array.from({ length: 20 }, (_, i) =>
        messageRecord('g1', `a-${i}`, {
          senderMemberId: 'alice',
          text: `今天一起去打球吧 ${i}`,
          sentAt: CLOCK + i * 1000,
        }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        messageRecord('g1', `me-${i}`, {
          senderMemberId: 'me',
          text: `好的 ${i}`,
          sentAt: CLOCK + i * 1000 + 500,
        }),
      ),
    ])
    store.write('DM-013', [tagRecord('运动:羽毛球', { name: '羽毛球', dimension: '运动' })])
    store.write('DM-014', [personTagRecord('alice', '运动:羽毛球', ['a-0'])])
    store.write('DM-011', [personRecord('alice', ['alice'], { activity: 20, unknown: false })])

    const index = new SocialIndex()
    index.setSnapshot(buildIndexSnapshot(store, store.currentEpoch(), CLOCK))
    const api = new SocialHttpAdapter({ store, index, gateway: emptyGateway, clock: () => CLOCK })

    const noKeyword = await api.getProfile({ memberId: 'alice', filter: { groupIds: ['g1'] } })
    console.log('W1a 无关键词 =', JSON.stringify(noKeyword))

    const withKeyword = await api
      .getProfile({ memberId: 'alice', filter: { groupIds: ['g1'], keyword: '爱丽丝' } })
      .catch((error) => ({ error: error.code, message: error.message }))
    console.log('W1b 关键词=昵称 =', JSON.stringify(withKeyword))

    expect(withKeyword).toEqual(noKeyword)
  })
})

describe('W2：身份对齐确认后的合并（真实 store + 流水线）', () => {
  it('确认后同一个人的两个群成员身份应指向同一个人', async () => {
    const { store } = harness.create()
    store.write('DM-002', [groupRecord('g1', '甲群'), groupRecord('g2', '乙群')])
    store.write('DM-004', [
      memberRecord('g1', 'a1', { displayName: '张三' }),
      memberRecord('g2', 'b1', { displayName: '张三' }),
      memberRecord('g1', 'me', { displayName: '我', isMe: true }),
    ])
    store.write('DM-003', [
      ...Array.from({ length: 6 }, (_, i) =>
        messageRecord('g1', `a-${i}`, { senderMemberId: 'a1', text: `g1 消息 ${i}`, sentAt: CLOCK + i * 1000 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        messageRecord('g2', `b-${i}`, { senderMemberId: 'b1', text: `g2 消息 ${i}`, sentAt: CLOCK + i * 1000 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        messageRecord('g1', `me-${i}`, { senderMemberId: 'me', text: `我 ${i}`, sentAt: CLOCK + i * 1000 + 500 }),
      ),
    ])
    store.write('DM-013', [tagRecord('运动:羽毛球', { name: '羽毛球', dimension: '运动' })])
    store.write('DM-014', [
      personTagRecord('a1', '运动:羽毛球', ['a-0']),
      personTagRecord('b1', '运动:羽毛球', ['b-0']),
    ])
    store.write('DM-005', [{ contactId: 'c1', displayName: '张三', source: '通讯录' } as EntityRecord<'DM-005'>])
    store.write('DM-012', [
      {
        candidateId: 'cand1',
        sourceContactId: 'c1',
        memberIds: ['a1', 'b1'],
        status: '未确认',
        confirmedAt: null,
      } as EntityRecord<'DM-012'>,
    ])

    const index = new SocialIndex()
    const pipeline = new SocialBuildPipeline({ store, gateway: emptyGateway, clock: () => CLOCK, index })
    const api = new SocialHttpAdapter({ store, index, pipeline, gateway: emptyGateway, clock: () => CLOCK })

    await pipeline.run('lazy')
    console.log('W2a 构建后 persons =', JSON.stringify(index.persons().map((p) => [p.personId, p.memberIds, p.activity, p.unknown])))
    console.log('W2a personOfMember(b1) =', index.personOfMember('b1'))

    const decision = await api.submitIdentityDecision({ candidateId: 'cand1', conclusion: '确认' })
    console.log('W2b 提交结论 =', JSON.stringify(decision))
    await pipeline.run('retry')

    console.log('W2c 确认后 persons =', JSON.stringify(index.persons().map((p) => [p.personId, p.memberIds, p.activity, p.unknown])))
    console.log('W2c personOfMember(a1) =', index.personOfMember('a1'), ' personOfMember(b1) =', index.personOfMember('b1'))
    const profileA1 = await api.getProfile({ memberId: 'a1' }).catch((e) => ({ error: e.code }))
    const profileB1 = await api.getProfile({ memberId: 'b1' }).catch((e) => ({ error: e.code }))
    console.log('W2c profile(a1) =', JSON.stringify(profileA1))
    console.log('W2c profile(b1) =', JSON.stringify(profileB1))
    const listG2 = await api
      .searchPeople({ entry: '按一级维度', value: '运动', filter: { groupIds: ['g2'] } })
      .catch((e) => ({ error: e.code }))
    console.log('W2c API-021(groupIds=[g2]) =', JSON.stringify(listG2))

    expect(index.personOfMember('b1')).toBe(index.personOfMember('a1'))
  })
})
