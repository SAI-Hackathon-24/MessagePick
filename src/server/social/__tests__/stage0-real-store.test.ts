/**
 * MOD-007 阶段 0 在**真实存储**上的回归护栏（P0 缺陷：社交模块整体不可用）。
 *
 * 缺陷回顾：`syncPeople` 曾用「成员标识的最小值」当人标识（如 `'me'`），
 * 而 MOD-002 的口径是 `person:<群>:<成员>`。于是「我」被写到一个**新的** personId 上，
 * 同时 `dm011_person` 有 `is_me = 1` 的**唯一索引**（`store/db/schema.ts`），
 * 真正的「我」那条还在 → 唯一约束冲突 → 阶段 0 失败、阶段 3~8 全部 skipped
 * → 索引永不物化 → `API-020` ~ `API-029` 全部 `EMPTY_RESULT`。
 *
 * 为什么既有用例没发现：`__tests__/fixtures.ts` 的 `member()` 曾把 `personId`
 * 写成 `memberId`（`'m1'`）而不是 MOD-002 的真实值，夹具与真实口径不一致，
 * 单元测试因此永远构造不出冲突。本文件用**真实 store + 真实 schema** 覆盖该路径。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { GroupMember, Id, Person } from '@shared'
import { createStore, type Store } from '@server/store'

import { syncPeople } from '../person'
import { readAll } from '../store'
import { runStage0 } from '../build/stages'
import type { StageEnv } from '../build/stages'

const dirs: string[] = []

const makeStore = (): Store => {
  const dataDir = mkdtempSync(join(tmpdir(), 'messagepick-p0-2-'))
  dirs.push(dataDir)
  return createStore({ dataDir })
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/** 与 MOD-002 完全一致的成员构造（`ingest/mapping/identity.ts` 的口径）。 */
const mod002Member = (groupId: Id, memberId: Id, displayName: string, isMe = false): GroupMember => ({
  memberId,
  groupId,
  displayName,
  isMe,
  personId: `person:${groupId}:${memberId}`,
})

/** 阶段 0 只用到 members 与 workspace/persons 两个字段，其余用不到的留空壳。 */
const makeEnv = (store: Store): StageEnv =>
  ({
    store,
    workspace: {},
    failures: [],
  }) as unknown as StageEnv

describe('阶段 0：真实库上的人同步（P0-2 护栏）', () => {
  it('为「我」写人记录时不撞 is_me 唯一索引，且「我」唯一', async () => {
    const store = makeStore()
    /**
     * 关键构造：真实导出里登录账号的成员标识是字面量 `me`（MOD-001 的 `ME_MEMBER_ID`），
     * 且它的人标识由 MOD-002 给成 `person:<群>:me`。
     * 成员标识排序上 `me` 未必最小 —— 这正是旧实现出错的场景。
     */
    const members: GroupMember[] = [
      mod002Member('g1', 'aaa', '阿黎'),
      mod002Member('g1', 'me', '我', true),
      mod002Member('g2', 'bbb', '小北'),
    ]
    store.write('DM-004', members)
    store.write('DM-012', [])

    const outcome = await runStage0(makeEnv(store))

    // 阶段 0 必须无失败（旧实现在这里给出「唯一约束不满足」）
    expect(outcome.failures).toEqual([])

    // 用适配层的读尽（store.read 返回分页结果，不是数组）
    const persons = readAll(store as never, 'DM-011') as Person[]
    expect(persons.length).toBeGreaterThan(0)

    // 「我」在 DM-011 里至多一条（唯一索引的直接体现）
    const mePersons = persons.filter((person) => person.isMe)
    expect(mePersons).toHaveLength(1)

    // 人的标识必须沿用 MOD-002 的口径，而不是自造的成员标识
    expect(persons.map((person) => person.personId).sort()).toEqual([
      'person:g1:aaa',
      'person:g1:me',
      'person:g2:bbb',
    ])
  })

  it('库里已有另一条 isMe 人记录时，新构造的人不得再声称 isMe（唯一索引护栏）', async () => {
    const store = makeStore()
    store.write('DM-004', [
      mod002Member('g1', 'aaa', '阿黎'),
      mod002Member('g1', 'me', '我', true),
    ])
    store.write('DM-012', [])
    /**
     * 预置一条**已经占据唯一槽位**的 isMe 人记录（模拟先前构建的产物）。
     * 旧实现为「我」构造出的是另一个 personId，于是一次写入会出现两条 isMe=1 →
     * `idx_dm011_me` 唯一索引拒绝 → 阶段 0 失败。
     * 正确实现下「我」仍归到 `person:g1:me`，不会新增第二条 isMe。
     */
    store.write('DM-011', [
      {
        personId: 'person:g1:me',
        memberIds: ['me'],
        isMe: true,
        unknown: false,
        activity: 0,
        replyMedianMs: null,
        dimensionScores: { 运动: 0, 艺术: 0, 游戏: 0, 娱乐: 0, 社交: 0 },
        personalityScores: { 领导式: 0, 活泼: 0, 幽默: 0, 冷静: 0, 理性: 0, 判断: 0 },
      },
    ] as never)

    const outcome = await runStage0(makeEnv(store))
    expect(outcome.failures).toEqual([])

    const persons = readAll(store as never, 'DM-011') as Person[]
    expect(persons.filter((person) => person.isMe)).toHaveLength(1)
  })

  it('身份合并到已确认映射后，「我」仍是唯一且人标识稳定', () => {
    const members: GroupMember[] = [
      mod002Member('g1', 'aaa', '阿黎'),
      mod002Member('g1', 'me', '我', true),
      mod002Member('g2', 'bbb', '小北'),
    ]
    const result = syncPeople({
      members,
      candidates: [
        {
          candidateId: 'c1',
          memberIds: ['aaa', 'bbb'],
          status: '已确认',
          confidence: 0.9,
          evidence: [],
        },
      ],
    } as unknown as Parameters<typeof syncPeople>[0])

    // 合并后的人标识 = 组内 personId 最小值（幂等、与成员顺序无关）
    const merged = result.persons.find((person) => person.memberIds.length === 2)
    expect(merged?.personId).toBe('person:g1:aaa')
    expect(result.personByMember.get('bbb')).toBe('person:g1:aaa')

    // 「我」不受合并影响，且全库仍只有一条 isMe
    expect(result.persons.filter((person) => person.isMe)).toHaveLength(1)
    expect(result.personByMember.get('me')).toBe('person:g1:me')
  })
})
