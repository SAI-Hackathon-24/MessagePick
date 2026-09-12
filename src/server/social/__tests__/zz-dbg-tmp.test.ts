import { describe, expect, it } from 'vitest'
import { SocialIndex, buildIndexSnapshot } from '@server/social/build/index-store'
import { SocialBuildPipeline } from '@server/social/build/index'
import { StoreHarness, groupRecord, memberRecord, messageRecord, tagRecord, personTagRecord, personRecord, CLOCK } from '@server/store/__tests__/harness'

describe('dbg', () => {
  it('seeding', async () => {
    const harness = new StoreHarness()
    const { store } = harness.create()
    const w1 = store.write('DM-002', [groupRecord('g1', '甲群')])
    const w2 = store.write('DM-004', [memberRecord('g1', 'alice', { displayName: '爱丽丝' }), memberRecord('g1', 'me', { displayName: '我', isMe: true })])
    const w3 = store.write('DM-003', [messageRecord('g1', 'a-0', { senderMemberId: 'alice', text: '打球', sentAt: CLOCK })])
    const w4 = store.write('DM-013', [tagRecord('运动:羽毛球', { name: '羽毛球', dimension: '运动' })])
    const w5 = store.write('DM-014', [personTagRecord('alice', '运动:羽毛球', ['a-0'])])
    const w6 = store.write('DM-011', [personRecord('alice', ['alice'], { activity: 20, unknown: false })])
    console.log('writes', JSON.stringify([w1, w2, w3, w4, w5, w6]))
    console.log('DM-004', JSON.stringify(store.read('DM-004').records))
    console.log('DM-011', JSON.stringify(store.read('DM-011').records))
    console.log('DM-014', JSON.stringify(store.read('DM-014').records))
    console.log('DM-013', JSON.stringify(store.read('DM-013').records))
    const index = new SocialIndex()
    index.setSnapshot(buildIndexSnapshot(store, store.currentEpoch(), CLOCK))
    console.log('effective(alice)', JSON.stringify(index.effectiveTagsOf('alice')))
    console.log('personOfMember(alice)', index.personOfMember('alice'))
    const pipeline = new SocialBuildPipeline({ store, gateway: { execute: async () => ({ ok: true, result: { items: [] }, sourceRefs: [], taskRef: 't' }) as any, retry: async () => ({ ok: true, result: { items: [] }, sourceRefs: [], taskRef: 't' }) as any }, clock: () => CLOCK, index })
    const report = await pipeline.run('lazy')
    console.log('report', JSON.stringify(report, null, 1))
    console.log('DM-011 after', JSON.stringify(store.read('DM-011').records))
    harness.dispose()
    expect(true).toBe(true)
  })
})
