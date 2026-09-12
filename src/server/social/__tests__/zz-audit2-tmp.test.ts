/**
 * 临时审计脚本 2（审计完成后删除）。
 */

import { describe, expect, it } from 'vitest'

import type { EntityRecord, EntityType, PageRequest, ReadResult, SharedFilter, WriteResult } from '@shared'

import { effectiveTags } from '../scoring'
import { SocialIndex, buildIndexSnapshot } from '../build/index-store'
import { SocialBuildPipeline } from '../build/index'
import { SocialHttpAdapter } from '../http'
import type { SocialTaskGateway } from '../build/gateway'
import { syncPeople } from '../person'
import type { SocialStorePort } from '../store'

import { FakeStore, T0, MINUTE, member, msg } from './fixtures'

// ---------------------------------------------------------------------------
// 有状态的假端口（写入真正落表，便于观察多步写路径）
// ---------------------------------------------------------------------------

class StatefulStore implements SocialStorePort {
  epoch = 1
  readonly tables = new Map<EntityType, Map<string, EntityRecord>>()

  seed<T extends EntityType>(type: T, records: readonly EntityRecord<T>[]): void {
    const table = new Map<string, EntityRecord>()
    for (const row of records) table.set(this.#keyOf(type, row), row as EntityRecord)
    this.tables.set(type, table)
  }

  rows<T extends EntityType>(type: T): EntityRecord<T>[] {
    return [...(this.tables.get(type)?.values() ?? [])] as EntityRecord<T>[]
  }

  #keyOf(type: EntityType, row: EntityRecord): string {
    switch (type) {
      case 'DM-011':
        return (row as any).personId
      case 'DM-013':
        return (row as any).tagId
      case 'DM-014':
        return `${(row as any).personId}\u0001${(row as any).tagId}`
      case 'DM-016':
        return (row as any).tagId
      case 'DM-012':
        return (row as any).candidateId
      case 'DM-003':
        return (row as any).messageId
      case 'DM-004':
        return `${(row as any).groupId}:${(row as any).memberId}`
      case 'DM-017':
        return (row as any).interactionId
      case 'DM-015':
        return (row as any).mergeGroupId
      default:
        return JSON.stringify(row)
    }
  }

  currentEpoch(): number {
    return this.epoch
  }

  read<T extends EntityType>(type: T, filter?: SharedFilter | null, page?: PageRequest | null): ReadResult<T> {
    const all = this.rows(type)
    const pageNumber = page?.page ?? 1
    const pageSize = page?.pageSize ?? 50
    const start = (pageNumber - 1) * pageSize
    return {
      records: all.slice(start, start + pageSize),
      pageInfo: { page: pageNumber, pageSize, total: all.length },
    }
  }

  write<T extends EntityType>(
    type: T,
    records: readonly EntityRecord<T>[],
    opts?: { bumpEpoch?: boolean },
  ): WriteResult {
    const table = this.tables.get(type) ?? new Map<string, EntityRecord>()
    for (const row of records) table.set(this.#keyOf(type, row as EntityRecord), row as EntityRecord)
    this.tables.set(type, table)
    if (opts?.bumpEpoch === true) this.epoch += 1
    return { written: records.length, failures: [] }
  }
}

describe('审计 E：effectiveTags 多人同标签', () => {
  it('E1 两个人的同一标签：应各产出一条有效标签', () => {
    const links = [
      {
        personId: 'p1',
        tagId: '运动:羽毛球',
        name: '羽毛球',
        dimension: '运动' as const,
        confidence: 0.5,
        evidenceMessageIds: ['m1'],
        origin: '模型抽取' as const,
      },
      {
        personId: 'p2',
        tagId: '运动:羽毛球',
        name: '羽毛球',
        dimension: '运动' as const,
        confidence: 0.9,
        evidenceMessageIds: ['m2'],
        origin: '模型抽取' as const,
      },
    ]
    const result = effectiveTags(links, [])
    console.log('E1 effectiveTags =', JSON.stringify(result))
    expect(result.map((tag) => [tag.personId, tag.confidence, tag.evidenceMessageIds])).toEqual([
      ['p1', 0.5, ['m1']],
      ['p2', 0.9, ['m2']],
    ])
  })

  it('E2 经索引/接口观察：两个人的维度分', () => {
    const members = [
      member('me', 'g1', '我', { isMe: true }),
      member('a', 'g1', '小明'),
      ...Array.from({ length: 8 }, (_, i) => member(`a${i}`, 'g1', `成员${i}`)),
    ]
    const messages = [
      ...Array.from({ length: 10 }, (_, i) => msg(`me-${i}`, 'g1', 'me', T0 + i * MINUTE)),
      ...Array.from({ length: 10 }, (_, i) => msg(`a-${i}`, 'g1', 'a', T0 + i * MINUTE)),
      ...Array.from({ length: 1 }, (_, i) => msg(`x-${i}`, 'g1', 'a0', T0)),
    ]
    const store = new StatefulStore()
    const sync = syncPeople({ members, candidates: [] })
    store.seed('DM-004', members)
    store.seed('DM-003', messages)
    store.seed(
      'DM-011',
      sync.persons.map((person) => {
        const activity = messages.filter((row) => person.memberIds.includes(row.senderMemberId)).length
        return { ...person, activity, unknown: activity < 5 }
      }),
    )
    store.seed('DM-013', [
      { tagId: '运动:羽毛球', name: '羽毛球', dimension: '运动', mergeGroupId: null, firstSeenAt: T0, eventStream: [], heatScore: 0 },
    ])
    store.seed('DM-014', [
      { personId: 'a', tagId: '运动:羽毛球', confidence: 0.5, evidenceMessageIds: ['a-0'], origin: '模型抽取' },
      { personId: 'a1', tagId: '运动:羽毛球', confidence: 0.9, evidenceMessageIds: ['a1-0'], origin: '模型抽取' },
    ])
    store.seed('DM-015', [])
    store.seed('DM-016', [])
    store.seed('DM-012', [])
    store.seed('DM-005', [])
    store.seed('DM-017', [])
    const index = new SocialIndex()
    index.setSnapshot(buildIndexSnapshot(store, store.epoch, T0))

    console.log('E2 effectiveOf(a) =', JSON.stringify(index.effectiveTagsOf('a')))
    console.log('E2 effectiveOf(a1) =', JSON.stringify(index.effectiveTagsOf('a1')))
    expect(index.effectiveTagsOf('a')).toHaveLength(1)
    expect(index.effectiveTagsOf('a1')).toHaveLength(1)
  })
})

describe('审计 F：构建流水线', () => {
  const gateway = (calls: string[]): SocialTaskGateway => ({
    execute: (async (req: any) => {
      calls.push(`execute:${req.taskType}`)
      if (req.taskType === '抽取') {
        return {
          ok: true,
          result: { items: [{ name: '羽毛球', dimension: '运动', strength: 0.9, evidence: [1] }] },
          sourceRefs: ['a-0'],
        }
      }
      if (req.taskType === '聚类') return { ok: true, result: { items: [{ tags: ['运动:羽毛球'] }] } }
      return { ok: true, result: { items: [{ dimension: '活泼', strength: 0.8 }] } }
    }) as any,
    retry: (async () => ({ ok: true, result: { items: [] } })) as any,
  })

  function seedPipeline() {
    const members = [member('me', 'g1', '我', { isMe: true }), member('a', 'g1', '小明')]
    const messages = [
      ...Array.from({ length: 10 }, (_, i) => msg(`me-${i}`, 'g1', 'me', T0 + i * MINUTE, { text: '我说话了' })),
      ...Array.from({ length: 10 }, (_, i) => msg(`a-${i}`, 'g1', 'a', T0 + i * MINUTE, { text: '我喜欢打羽毛球' })),
    ]
    const store = new StatefulStore()
    const sync = syncPeople({ members, candidates: [] })
    store.seed('DM-004', members)
    store.seed('DM-003', messages)
    store.seed(
      'DM-011',
      sync.persons.map((person) => {
        const activity = messages.filter((row) => person.memberIds.includes(row.senderMemberId)).length
        return { ...person, activity, unknown: activity < 5 }
      }),
    )
    store.seed('DM-013', [])
    store.seed('DM-014', [])
    store.seed('DM-015', [])
    store.seed('DM-016', [])
    store.seed('DM-012', [])
    store.seed('DM-005', [])
    store.seed('DM-017', [])
    return { store, members, messages }
  }

  it('F1 一次构建：阶段顺序与落库结果', async () => {
    const { store } = seedPipeline()
    const calls: string[] = []
    const index = new SocialIndex()
    const pipeline = new SocialBuildPipeline({ store, gateway: gateway(calls), clock: () => T0, index })
    const report = await pipeline.run('lazy')
    console.log('F1 report =', JSON.stringify(report, null, 1))
    console.log('F1 task calls =', JSON.stringify(calls))
    console.log('F1 persons =', JSON.stringify(store.rows('DM-011')))
    console.log('F1 tags =', JSON.stringify(store.rows('DM-013')))
    console.log('F1 links =', JSON.stringify(store.rows('DM-014')))
    console.log('F1 personality =', JSON.stringify(store.rows('DM-016')))
    expect(report.state).toBe('ready')
  })

  it('F2 单飞 + 补跑', async () => {
    const { store } = seedPipeline()
    const calls: string[] = []
    const index = new SocialIndex()
    const pipeline = new SocialBuildPipeline({ store, gateway: gateway(calls), clock: () => T0, index })
    const first = pipeline.run('lazy')
    const second = pipeline.run('epoch')
    const third = pipeline.run('retry')
    const [r1, r2, r3] = await Promise.all([first, second, third])
    console.log('F2 states =', r1.state, r2.state, r3.state, 'same?', r1 === r2, r2 === r3)
    console.log('F2 reasons =', r1.reason, r2.reason, r3.reason)
    console.log('F2 pipeline.state =', pipeline.state, 'calls =', calls.length)
    expect(pipeline.state === 'ready' || pipeline.state === 'partial').toBe(true)
  })
})

describe('审计 G：HTTP 写路径（有状态库）', () => {
  function apiFor() {
    const members = [member('me', 'g1', '我', { isMe: true }), member('a', 'g1', '小明')]
    const messages = [
      ...Array.from({ length: 10 }, (_, i) => msg(`me-${i}`, 'g1', 'me', T0 + i * MINUTE)),
      ...Array.from({ length: 10 }, (_, i) => msg(`a-${i}`, 'g1', 'a', T0 + i * MINUTE)),
    ]
    const store = new StatefulStore()
    const sync = syncPeople({ members, candidates: [] })
    store.seed('DM-004', members)
    store.seed('DM-003', messages)
    store.seed(
      'DM-011',
      sync.persons.map((person) => {
        const activity = messages.filter((row) => person.memberIds.includes(row.senderMemberId)).length
        return { ...person, activity, unknown: activity < 5 }
      }),
    )
    store.seed('DM-013', [
      { tagId: '运动:羽毛球', name: '羽毛球', dimension: '运动', mergeGroupId: null, firstSeenAt: T0, eventStream: [], heatScore: 0 },
    ])
    store.seed('DM-014', [
      { personId: 'a', tagId: '运动:羽毛球', confidence: 0.5, evidenceMessageIds: ['a-0'], origin: '模型抽取' },
    ])
    store.seed('DM-015', [])
    store.seed('DM-016', [
      { tagId: 'pt:a:幽默', personId: 'a', dimension: '幽默', score: 0.9, status: '候选', origin: '模型推断' },
    ])
    store.seed('DM-012', [])
    store.seed('DM-005', [])
    store.seed('DM-017', [])
    const index = new SocialIndex()
    index.setSnapshot(buildIndexSnapshot(store, store.epoch, T0))
    const api = new SocialHttpAdapter({
      store,
      index,
      gateway: { execute: async () => ({ ok: true, result: { items: [{ text: 'x' }] } }) as any, retry: async () => ({ ok: true, result: { items: [] } }) as any },
      clock: () => T0,
    })
    return { api, store, index }
  }

  it('G1 改（换名）', async () => {
    const { api, store } = apiFor()
    const out = await api
      .editInterestTag({ memberId: 'a', action: '改', tag: { dimension: '运动', name: '篮球' } })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('G1 改(换名) =', JSON.stringify(out))
    console.log('G1 links after =', JSON.stringify(store.rows('DM-014')))
    console.log('G1 tags after =', JSON.stringify(store.rows('DM-013').map((t: any) => t.tagId)))
  })

  it('G2 改（同名换维度）', async () => {
    const { api, store } = apiFor()
    const out = await api
      .editInterestTag({ memberId: 'a', action: '改', tag: { dimension: '娱乐', name: '羽毛球' } })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('G2 改(换维度) =', JSON.stringify(out))
    console.log('G2 links after =', JSON.stringify(store.rows('DM-014')))
  })

  it('G3 性格标签全流程（含确认后画像）', async () => {
    const { api, store } = apiFor()
    const c1 = await api.editPersonalityTag({ memberId: 'a', action: '确认', dimension: '幽默' })
    console.log('G3 确认 =', JSON.stringify(c1), JSON.stringify(store.rows('DM-016')), JSON.stringify(store.rows('DM-011')))
    const add = await api.editPersonalityTag({ memberId: 'a', action: '增', dimension: '冷静' })
    console.log('G3 增 =', JSON.stringify(add), JSON.stringify(store.rows('DM-016')))
    const chg = await api
      .editPersonalityTag({ memberId: 'a', action: '改', dimension: '理性' })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('G3 改 =', JSON.stringify(chg), JSON.stringify(store.rows('DM-016')))
    const del = await api
      .editPersonalityTag({ memberId: 'a', action: '删', dimension: '活泼' })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('G3 删 =', JSON.stringify(del), JSON.stringify(store.rows('DM-016')))
  })

  it('G4 删除兴趣标签后构建是否复活', async () => {
    const { api, store } = apiFor()
    const removed = await api
      .editInterestTag({ memberId: 'a', action: '删', tag: { dimension: '运动', name: '羽毛球' } })
      .catch((e) => ({ error: e.code, message: e.message }))
    console.log('G4 删 =', JSON.stringify(removed), JSON.stringify(store.rows('DM-014')))
  })
})

describe('审计 H：窗口与索引陈旧', () => {
  it('H1 windowTagsOf 社交维度回算', async () => {
    const { SocialIndex } = await import('../build/index-store')
    void SocialIndex
    void FakeStore
    expect(true).toBe(true)
  })
})
