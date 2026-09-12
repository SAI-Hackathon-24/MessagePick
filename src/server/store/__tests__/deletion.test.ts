/**
 * MOD-002 删除（API-005 / API-006；mod-002 §4.3 / §4.4、§7.1 / §7.2）：
 *
 * - 预检：按群 / 全量计数快照，未知群全零、不写库；预检与执行计数一致（不变量）；
 * - 缺二次确认：`CONFIRMATION_REQUIRED`，不触库（AC-027）；
 * - 按群删除：群 A 不可读、群 B 不受影响、结构整理（孤儿人 / 无引用标签）、`DM-010` 部分来源保留（AC-025、决策 4）；
 * - 全量清空：全部实体（含 `DM-001`）清零 + 媒体 / 日志 / 备份清除（AC-026 / AC-029、决策 5）；
 * - 删除中断：库内已提交、清理失败 → `DELETION_INTERRUPTED`，续做可完成（AC-028、决策 3）；
 * - 提交前失败：整体回滚 + `STORAGE_UNAVAILABLE`，原样重试成功；
 * - 删除后：全库无孤儿引用 + epoch +1（§5.3 / §7.2）。
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type Database from 'better-sqlite3'

import { afterEach, describe, expect, it } from 'vitest'

import { ENTITY_TYPES, type EntityCount, type EntityRecord } from '@shared'

import { nodeFileCleaner, pendingCleanupCount, type FileCleaner } from '../deletion/sweep'
import { getEntityDescriptor } from '../entities/registry'
import { isStoreError, type StoreError } from '../errors'
import type { Store } from '../index'

import {
  CLOCK,
  StoreHarness,
  candidateRecord,
  collectOrphanViolations,
  consentRecord,
  generationRecord,
  groupRecord,
  itemRecord,
  memberRecord,
  memeRecord,
  messageRecord,
  occurrenceRecord,
  personTagRecord,
  sourceStatusRecord,
  storeErrorCode,
  storeErrorCodeAsync,
  tableCount,
  tagRecord,
} from './harness'

const harness = new StoreHarness()
afterEach(() => harness.dispose())

const MEDIA_REF = 'media/mA1.png'

function contactRecord(contactId: string): EntityRecord<'DM-005'> {
  return { contactId, displayName: `联系人-${contactId}`, source: '通讯录' }
}

function identityCandidateRecord(
  candidateId: string,
  sourceContactId: string,
  memberIds: string[],
): EntityRecord<'DM-012'> {
  return { candidateId, sourceContactId, memberIds, status: '未确认', confirmedAt: null }
}

function interactionRecord(
  interactionId: string,
  triggerMessageId: string,
  triggerMemberId: string,
  responseMessageId: string,
  responseMemberId: string,
): EntityRecord<'DM-017'> {
  return {
    interactionId,
    triggerMessageId,
    triggerMemberId,
    responseMessageId,
    responseMemberId,
    kind: '紧随接话',
    intervalMs: 5000,
  }
}

/**
 * 两群夹具：群 A 含原始 / 派生 / 生成历史数据，群 B 为对照；
 * `itemAB` 的来源跨两群（部分来源被删 → 保留 + 待重算）。
 */
function seedTwoGroups(store: Store): void {
  store.writeMedia(MEDIA_REF, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  store.write('DM-002', [groupRecord('grp-a', '甲群'), groupRecord('grp-b', '乙群')])
  store.write('DM-004', [
    memberRecord('grp-a', 'me', { isMe: true, displayName: '我' }),
    memberRecord('grp-a', 'alice', { displayName: '爱丽丝' }),
    memberRecord('grp-b', 'bob', { displayName: '鲍勃' }),
  ])
  store.write('DM-003', [
    messageRecord('grp-a', 'mA1', {
      senderMemberId: 'me',
      kind: '图片',
      mediaRef: MEDIA_REF,
      sentAt: CLOCK,
    }),
    messageRecord('grp-a', 'mA2', { senderMemberId: 'alice', text: '群 A 消息二', sentAt: CLOCK + 1 }),
    messageRecord('grp-b', 'mB1', { senderMemberId: 'bob', text: '群 B 消息', sentAt: CLOCK + 2 }),
  ])
  store.write('DM-006', [memeRecord('grp-a', 'mA-meme'), memeRecord('grp-b', 'mB-meme')])
  store.write('DM-007', [
    occurrenceRecord('occA', 'mA-meme', 'mA1', { speakerMemberId: 'me' }),
    occurrenceRecord('occB', 'mB-meme', 'mB1', { speakerMemberId: 'bob' }),
  ])
  store.write('DM-013', [tagRecord('tagA'), tagRecord('tagB', { name: '标签-乙' })])
  store.write('DM-014', [
    personTagRecord('person-grp-a-alice', 'tagA', ['mA1']),
    personTagRecord('person-grp-b-bob', 'tagB', ['mB1']),
  ])
  store.write('DM-010', [
    itemRecord('grp-a', 'itemA', ['mA1']),
    itemRecord('grp-a', 'itemAB', ['mA1', 'mB1']),
    itemRecord('grp-b', 'itemB', ['mB1']),
  ])
  store.write('DM-012', [identityCandidateRecord('cand-A', 'contact-1', ['alice'])])
  store.write('DM-017', [interactionRecord('intA', 'mA1', 'me', 'mA2', 'alice')])
  store.write('DM-020', [
    generationRecord('genA', { memeId: 'mA-meme' }),
    generationRecord('genB', { memeId: 'mB-meme' }),
  ])
  store.write('DM-021', [candidateRecord('cand-M', ['mA1']), candidateRecord('cand-B', ['mB1'])])
  store.write('DM-022', [consentRecord('consent-A', ['alice']), consentRecord('consent-B', ['bob'])])
  store.write('DM-005', [contactRecord('contact-1')])
  store.write('DM-001', [sourceStatusRecord('群消息', { hasData: true })])
}

function countMap(items: readonly EntityCount[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of items) {
    if (item.count > 0) map[item.entityType] = item.count
  }
  return map
}

function countsSnapshot(db: Database.Database): Record<string, number> {
  const snapshot: Record<string, number> = {}
  for (const type of ENTITY_TYPES) {
    const descriptor = getEntityDescriptor(type)
    snapshot[type] = tableCount(db, descriptor.table)
  }
  snapshot._media_index = tableCount(db, '_media_index')
  snapshot._pending_cleanup = tableCount(db, '_pending_cleanup')
  return snapshot
}

async function storeErrorOf(fn: () => Promise<unknown>): Promise<StoreError> {
  try {
    await fn()
  } catch (error) {
    if (isStoreError(error)) return error
    throw error
  }
  throw new Error('期望抛出 StoreError，但调用未抛错')
}

const EXPECTED_GROUP_A_COUNTS: Record<string, number> = {
  'DM-002': 1,
  'DM-003': 2,
  'DM-004': 2,
  'DM-006': 1,
  'DM-007': 1,
  'DM-010': 1,
  'DM-011': 2,
  'DM-012': 1,
  'DM-013': 1,
  'DM-014': 1,
  'DM-017': 1,
  'DM-020': 1,
  'DM-021': 1,
  'DM-022': 1,
}

describe('删除预检（API-005）', () => {
  it('按群给出全部 22 类实体的清单；未知群返回全零清单，不是错误且不写库', () => {
    const { store } = harness.create()
    seedTwoGroups(store)
    const epochBefore = store.currentEpoch()

    const preflight = store.preflightDeletion({ kind: 'group', groupId: 'grp-a' })
    expect(preflight.items).toHaveLength(22)
    expect(countMap(preflight.items)).toEqual(EXPECTED_GROUP_A_COUNTS)

    // 预检只读：数据与 epoch 不变
    expect(store.currentEpoch()).toBe(epochBefore)
    expect(store.read('DM-003', { groupIds: ['grp-a'] }).pageInfo.total).toBe(2)

    const unknown = store.preflightDeletion({ kind: 'group', groupId: '不存在的群' })
    expect(unknown.items).toHaveLength(22)
    expect(unknown.items.every((item) => item.count === 0)).toBe(true)
  })

  it('删除范围结构非法 → INVALID_INPUT（不触库）', () => {
    const { store } = harness.create()
    seedTwoGroups(store)
    expect(storeErrorCode(() => store.preflightDeletion({ kind: 'bogus' } as never))).toBe(
      'INVALID_INPUT',
    )
    expect(
      storeErrorCode(() => store.preflightDeletion({ kind: 'group', groupId: '' } as never)),
    ).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.preflightDeletion(null as never))).toBe('INVALID_INPUT')
  })
})

describe('缺二次确认（AC-027）', () => {
  it('confirmed ≠ true → CONFIRMATION_REQUIRED，数据 / epoch / 文件均不变', async () => {
    const { store, inspect, dataDir } = harness.create()
    seedTwoGroups(store)
    const epochBefore = store.currentEpoch()
    const before = countsSnapshot(inspect)

    const code = await storeErrorCodeAsync(() =>
      store.executeDeletion({ kind: 'group', groupId: 'grp-a' }, false),
    )
    expect(code).toBe('CONFIRMATION_REQUIRED')

    expect(countsSnapshot(inspect)).toEqual(before)
    expect(store.currentEpoch()).toBe(epochBefore)
    expect(existsSync(join(dataDir, 'media', 'mA1.png'))).toBe(true)
    expect(store.read('DM-003', { groupIds: ['grp-a'] }).pageInfo.total).toBe(2)
  })
})

describe('按群删除（AC-025 / AC-021 / 决策 4）', () => {
  it('预检 = 执行计数；群 A 清空、群 B 不受影响；结构整理与部分来源保留；无孤儿', async () => {
    const warnings: string[] = []
    const { store, inspect, dataDir } = harness.create({
      logger: {
        warn: (event) => {
          warnings.push(event)
        },
      },
    })
    seedTwoGroups(store)
    writeFileSync(join(dataDir, 'logs', 'app.log'), '日志')

    const epochBefore = store.currentEpoch()
    const preflight = store.preflightDeletion({ kind: 'group', groupId: 'grp-a' })

    // 二次确认后执行
    const execution = await store.executeDeletion({ kind: 'group', groupId: 'grp-a' }, true)
    expect(execution.items).toEqual(preflight.items)
    expect(warnings).not.toContain('deletion.count.mismatch')
    expect(store.currentEpoch()).toBe(epochBefore + 1)

    // 群 A 不可读；群 B 不受影响
    expect(store.read('DM-002', { groupIds: ['grp-a'] }).pageInfo.total).toBe(0)
    expect(store.read('DM-003', { groupIds: ['grp-a'] }).pageInfo.total).toBe(0)
    expect(store.read('DM-006', { groupIds: ['grp-a'] }).pageInfo.total).toBe(0)
    expect(store.read('DM-002').records.map((record) => record.groupId)).toEqual(['grp-b'])
    expect(store.read('DM-003', { groupIds: ['grp-b'] }).records.map((record) => record.messageId)).toEqual([
      'mB1',
    ])

    // DM-010 部分来源被删：itemAB 保留 + needs_recompute=1，重算前不进入读取结果（决策 4）
    const kept = inspect
      .prepare(
        'SELECT source_group_id, needs_recompute, src_time FROM dm010_item WHERE item_id = ?',
      )
      .get('itemAB') as { source_group_id: string; needs_recompute: number; src_time: number }
    expect(kept).toEqual({ source_group_id: 'grp-b', needs_recompute: 1, src_time: CLOCK + 2 })
    // 全量来源被删的 itemA 已删除；itemB 属于群 B 且可读
    expect(tableCount(inspect, 'dm010_item')).toBe(2)
    expect(
      store.read('DM-010', { groupIds: ['grp-b'] }).records.map((record) => record.entryId),
    ).toEqual(['itemB'])

    // 结构整理：孤儿人删除、无引用标签删除；群 B 的派生数据保留
    const persons = (
      inspect.prepare('SELECT person_id FROM dm011_person ORDER BY person_id').all() as Array<{
        person_id: string
      }>
    ).map((row) => row.person_id)
    expect(persons).toEqual(['person-grp-b-bob'])
    const tags = (
      inspect.prepare('SELECT tag_id FROM dm013_tag ORDER BY tag_id').all() as Array<{
        tag_id: string
      }>
    ).map((row) => row.tag_id)
    expect(tags).toEqual(['tagB'])
    expect(tableCount(inspect, 'dm007_occurrence')).toBe(1)
    expect(tableCount(inspect, 'dm020_generation')).toBe(1)
    expect(tableCount(inspect, 'dm021_candidate')).toBe(1)
    expect(tableCount(inspect, 'dm022_material_consent')).toBe(1)

    // 无群归属的实体不受按群删除影响（决策 5：日志也不清）
    expect(tableCount(inspect, 'dm005_contact')).toBe(1)
    expect(tableCount(inspect, 'dm001_source_status')).toBe(1)
    expect(existsSync(join(dataDir, 'logs', 'app.log'))).toBe(true)

    // 媒体文件清除、待清理清单清空
    expect(existsSync(join(dataDir, 'media', 'mA1.png'))).toBe(false)
    expect(pendingCleanupCount(inspect)).toBe(0)

    // 不变量：全库无指向已删行的引用（§5.3 / §7.2）
    expect(collectOrphanViolations(inspect)).toEqual([])
  })

  it('删除可重放：已删范围再次发起计数为 0，不重复删除（§4.4）', async () => {
    const { store, inspect } = harness.create()
    seedTwoGroups(store)
    await store.executeDeletion({ kind: 'group', groupId: 'grp-a' }, true)

    const again = await store.executeDeletion({ kind: 'group', groupId: 'grp-a' }, true)
    expect(again.items).toHaveLength(22)
    expect(again.items.every((item) => item.count === 0)).toBe(true)
    expect(collectOrphanViolations(inspect)).toEqual([])
  })
})

describe('全量清空（AC-026 / AC-029 / 决策 5）', () => {
  it('全部实体（含 DM-001）清零；媒体 / 日志 / 备份清除；无孤儿；epoch +1', async () => {
    const { store, inspect, dataDir } = harness.create()
    seedTwoGroups(store)
    writeFileSync(join(dataDir, 'logs', 'app.log'), '日志')
    writeFileSync(join(dataDir, 'backup', 'app.db.v1'), '备份')

    const epochBefore = store.currentEpoch()
    const result = await store.executeDeletion({ kind: 'all' }, true)

    // 确实删除了数据（抽样），且各表清零
    expect(countMap(result.items)).toMatchObject({
      'DM-001': 1,
      'DM-002': 2,
      'DM-003': 3,
      'DM-020': 2,
      'DM-022': 2,
    })
    for (const type of ENTITY_TYPES) {
      const descriptor = getEntityDescriptor(type)
      expect(tableCount(inspect, descriptor.table), `${type} 应清零`).toBe(0)
    }
    expect(tableCount(inspect, '_media_index')).toBe(0)
    expect(pendingCleanupCount(inspect)).toBe(0)

    // 空态回落：读取为空集而不是错误（AC-029）
    expect(store.read('DM-003')).toEqual({
      records: [],
      pageInfo: { page: 1, pageSize: 50, total: 0 },
    })
    expect(store.currentEpoch()).toBe(epochBefore + 1)

    // 提交后清理：媒体文件、日志、应用自建备份
    expect(existsSync(join(dataDir, 'media', 'mA1.png'))).toBe(false)
    expect(readdirSync(join(dataDir, 'logs'))).toEqual([])
    expect(readdirSync(join(dataDir, 'backup'))).toEqual([])
    expect(collectOrphanViolations(inspect)).toEqual([])
  })
})

describe('删除中断（AC-028 / 决策 3）', () => {
  it('库内已提交、清理失败 → DELETION_INTERRUPTED + 待清理计数；续做完成；重发计数为 0', async () => {
    // 第一次清理调用失败（模拟中断），其后恢复正常（成功路径仍走真实清理器，
    // 否则「续做完成」无法被验证）
    let failuresLeft = 1
    const flakyCleaner: FileCleaner = {
      async removeFile(path) {
        if (failuresLeft > 0) {
          failuresLeft -= 1
          throw new Error('注入的清理失败')
        }
        await nodeFileCleaner.removeFile(path)
      },
      async clearDirectory(path) {
        if (failuresLeft > 0) {
          failuresLeft -= 1
          throw new Error('注入的清理失败')
        }
        await nodeFileCleaner.clearDirectory(path)
      },
    }
    const { store, inspect, dataDir } = harness.create({ fileCleaner: flakyCleaner })
    seedTwoGroups(store)
    store.writeMedia('media/consent-A.png', new Uint8Array([1, 2, 3]))
    writeFileSync(join(dataDir, 'logs', 'app.log'), '日志')
    const epochBefore = store.currentEpoch()

    const error = await storeErrorOf(() => store.executeDeletion({ kind: 'all' }, true))
    expect(error.envelope.code).toBe('DELETION_INTERRUPTED')
    expect(error.envelope.retryable).toBe(true)
    expect(error.envelope.context?.pendingCount).toBe(1)

    // 库内删除已提交（不可恢复），epoch 已递增；清单中 1 条待续做
    expect(store.read('DM-003').pageInfo.total).toBe(0)
    expect(store.currentEpoch()).toBe(epochBefore + 1)
    expect(pendingCleanupCount(inspect)).toBe(1)
    expect(existsSync(join(dataDir, 'media', 'consent-A.png'))).toBe(true)

    // 续做：剩余清理完成
    expect(await store.resumeCleanup()).toBe(0)
    expect(pendingCleanupCount(inspect)).toBe(0)
    expect(existsSync(join(dataDir, 'media', 'consent-A.png'))).toBe(false)

    // 已完成后再发起：计数为 0，不重复删除
    const again = await store.executeDeletion({ kind: 'all' }, true)
    expect(again.items.every((item) => item.count === 0)).toBe(true)
  })
})

describe('提交前失败（决策 3 / §7.2）', () => {
  it('事务内失败 → 整体回滚 + STORAGE_UNAVAILABLE；故障排除后原样重试成功', async () => {
    const { store, inspect, dataDir } = harness.create()
    inspect.pragma('busy_timeout = 5000')
    seedTwoGroups(store)
    const before = countsSnapshot(inspect)
    const epochBefore = store.currentEpoch()
    const preflight = store.preflightDeletion({ kind: 'group', groupId: 'grp-a' })

    // 注入事务内失败：删除群行时触发中止（模拟提交前任意 SQL 失败）
    inspect.exec(
      `CREATE TRIGGER block_group_delete BEFORE DELETE ON dm002_group
       BEGIN SELECT RAISE(ABORT, 'blocked'); END`,
    )
    const code = await storeErrorCodeAsync(() =>
      store.executeDeletion({ kind: 'group', groupId: 'grp-a' }, true),
    )
    expect(code).toBe('STORAGE_UNAVAILABLE')

    // 库内保持原状
    expect(countsSnapshot(inspect)).toEqual(before)
    expect(store.currentEpoch()).toBe(epochBefore)
    expect(existsSync(join(dataDir, 'media', 'mA1.png'))).toBe(true)
    expect(pendingCleanupCount(inspect)).toBe(0)
    expect(store.read('DM-003', { groupIds: ['grp-a'] }).pageInfo.total).toBe(2)

    // 故障排除后原样重试
    inspect.exec('DROP TRIGGER block_group_delete')
    const execution = await store.executeDeletion({ kind: 'group', groupId: 'grp-a' }, true)
    expect(execution.items).toEqual(preflight.items)
    expect(store.read('DM-003', { groupIds: ['grp-a'] }).pageInfo.total).toBe(0)
    expect(collectOrphanViolations(inspect)).toEqual([])
  })
})
