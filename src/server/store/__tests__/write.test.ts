/**
 * MOD-002 写入（API-003；mod-002 §4.1、§7.1 / §7.2）：
 *
 * - 幂等去重：`insert-only` 忽略重复、`upsert` 只覆盖可变字段白名单（AC-008、决策 2）；
 * - 失败粒度：单条失败不影响同批其余记录，失败明细含记录身份 + 原因（§4.1）；
 * - 批次：>1000 行逐批提交（§3.3）、空批零成功；非法入参整次拒绝（`INVALID_INPUT`）；
 * - `bumpEpoch`：仅由调用方声明时递增，且随库持久化（§5.4）。
 */

import { afterEach, describe, expect, it } from 'vitest'

import type { EntityType, MessageKind } from '@shared'

import {
  StoreHarness,
  candidateRecord,
  groupRecord,
  memberRecord,
  memeRecord,
  messageRecord,
  storeErrorCode,
  tableCount,
} from './harness'

const harness = new StoreHarness()
afterEach(() => harness.dispose())

describe('写入幂等与去重（AC-008）', () => {
  it('insert-only：同身份重复写（批内 / 跨批）不产生副本，重复写按成功计', () => {
    const { store, inspect } = harness.create()
    store.write('DM-002', [groupRecord('gA')])
    store.write('DM-004', [memberRecord('gA', 'me', { isMe: true })])

    const first = store.write('DM-003', [
      messageRecord('gA', 'm1', { senderMemberId: 'me', text: '原始' }),
    ])
    expect(first).toEqual({ written: 1, failures: [] })

    // 跨批重复：同身份再次写入（内容不同）→ 视为成功、不覆盖、不产生副本
    const second = store.write('DM-003', [
      messageRecord('gA', 'm1', { senderMemberId: 'me', text: '改写' }),
    ])
    expect(second).toEqual({ written: 1, failures: [] })
    expect(tableCount(inspect, 'dm003_message')).toBe(1)
    expect(store.read('DM-003').records[0]?.text).toBe('原始')

    // 批内重复：同批两条同身份，仍只落一行
    const batch = store.write('DM-003', [
      messageRecord('gA', 'm2', { senderMemberId: 'me', text: 'A' }),
      messageRecord('gA', 'm2', { senderMemberId: 'me', text: 'B' }),
    ])
    expect(batch).toEqual({ written: 2, failures: [] })
    expect(tableCount(inspect, 'dm003_message')).toBe(2)
    const duplicated = store
      .read('DM-003', null, { pageSize: 10 })
      .records.filter((record) => record.messageId === 'm2')
    expect(duplicated).toHaveLength(1)
  })

  it('upsert：只覆盖可变字段白名单，身份列与不可变列永不覆盖', () => {
    const { store, inspect } = harness.create()
    store.write('DM-002', [groupRecord('gA', '甲'), groupRecord('gB', '乙')])

    // 群名（可变）覆盖；记录身份键（群标识）不可覆盖
    store.write('DM-002', [groupRecord('gA', '甲改')])
    expect(tableCount(inspect, 'dm002_group')).toBe(2)
    expect(store.read('DM-002', { groupIds: ['gA'] }).records[0]?.groupName).toBe('甲改')

    // DM-006：梗名 / 解读（可变）覆盖；归属群与来源候选（不可变）保持原值
    store.write('DM-021', [candidateRecord('cand-1', [])])
    store.write('DM-006', [memeRecord('gA', 'mem-1')])
    store.write('DM-006', [
      memeRecord('gB', 'mem-1', {
        name: '新名',
        interpretation: '新解读',
        sourceCandidateId: 'cand-1',
      }),
    ])
    const meme = inspect
      .prepare(
        'SELECT group_id, name, interpretation, source_candidate_id FROM dm006_meme WHERE meme_id = ?',
      )
      .get('mem-1') as {
      group_id: string
      name: string
      interpretation: string
      source_candidate_id: string | null
    }
    expect(meme.name).toBe('新名')
    expect(meme.interpretation).toBe('新解读')
    expect(meme.group_id).toBe('gA')
    expect(meme.source_candidate_id).toBeNull()

    // DM-004：群昵称（可变）覆盖；人归属（不可变，结构性绑定）保持原值
    store.write('DM-004', [memberRecord('gA', 'me', { isMe: true, personId: 'p-me' })])
    store.write('DM-004', [
      memberRecord('gA', 'me', { isMe: true, personId: 'p-other', displayName: '新昵称' }),
    ])
    const member = inspect
      .prepare('SELECT display_name, person_id FROM dm004_member WHERE group_id = ? AND member_id = ?')
      .get('gA', 'me') as { display_name: string; person_id: string }
    expect(member.display_name).toBe('新昵称')
    expect(member.person_id).toBe('p-me')
  })
})

describe('写入失败粒度与批次', () => {
  it('单条失败不拖累同批：失败明细含记录身份与原因，其余照常写入', () => {
    const { store, inspect } = harness.create()
    store.write('DM-002', [groupRecord('gA')])
    store.write('DM-004', [memberRecord('gA', 'me', { isMe: true })])

    const result = store.write('DM-003', [
      messageRecord('gA', 'mGood', { senderMemberId: 'me', text: '好的' }),
      // 发送者不存在 → 复合外键失败（记录级校验不覆盖跨记录引用，由约束兜底）
      messageRecord('gA', 'mGhost', { senderMemberId: 'ghost', text: '未知发送者' }),
      // 闭集外取值 → 记录级校验失败
      messageRecord('gA', 'mKind', {
        senderMemberId: 'me',
        text: '闭集外取值',
        kind: '语音' as unknown as MessageKind,
      }),
    ])

    expect(result.written).toBe(1)
    expect(result.failures.map((failure) => failure.identity)).toEqual([['mGhost'], ['mKind']])
    expect(result.failures[0]?.reason).toContain('外键')
    expect(result.failures[1]?.reason).toContain('闭集')
    expect(tableCount(inspect, 'dm003_message')).toBe(1)
    expect(store.read('DM-003').records[0]?.messageId).toBe('mGood')
  })

  it('批拆分：>1000 行逐批提交，跨批重复身份合并（§3.3）', () => {
    const { store, inspect } = harness.create()
    const records = [
      ...Array.from({ length: 1000 }, (_, index) => groupRecord(`g${index}`)),
      // 后 500 行与上一批重复（跨批去重）
      ...Array.from({ length: 500 }, (_, index) => groupRecord(`g${500 + index}`)),
    ]
    const result = store.write('DM-002', records)
    expect(result.written).toBe(1500)
    expect(result.failures).toEqual([])
    expect(tableCount(inspect, 'dm002_group')).toBe(1000)
    expect(store.read('DM-002', null, { pageSize: 1 }).pageInfo.total).toBe(1000)
  })

  it('空批成功写入 0 条；非法写入入参整次拒绝（INVALID_INPUT）', () => {
    const { store } = harness.create()
    expect(store.write('DM-002', [])).toEqual({ written: 0, failures: [] })
    expect(storeErrorCode(() => store.write('DM-099' as EntityType, []))).toBe('INVALID_INPUT')
    expect(
      storeErrorCode(() => store.write('DM-002', null as unknown as [])),
    ).toBe('INVALID_INPUT')
  })
})

describe('epoch 与写入的关系（§5.4）', () => {
  it('bumpEpoch 仅在声明时递增，且随库持久化', () => {
    const { store, inspect, dbPath } = harness.create()
    // 空库初始化（v1 迁移）→ epoch +1
    expect(store.currentEpoch()).toBe(1)

    store.write('DM-002', [groupRecord('gA')])
    expect(store.currentEpoch()).toBe(1)

    store.write('DM-002', [groupRecord('gB')], { bumpEpoch: true })
    expect(store.currentEpoch()).toBe(2)
    expect(inspect.prepare(`SELECT value FROM _meta WHERE key = 'data_epoch'`).get()).toEqual({
      value: '2',
    })

    // 重开同一库文件：epoch 从库内水位恢复，不受内存缓存影响
    const reopened = harness.create({ dbPath })
    expect(reopened.store.currentEpoch()).toBe(2)
  })
})
