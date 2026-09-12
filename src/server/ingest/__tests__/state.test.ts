/**
 * `DM-001` 状态读写与派生字段（mod-001 §7「状态与 X」/「只读接口」行；§5.2、§4.2）：
 *
 * - 「记录更新至 X」只在**群消息来源完整成功**时推进；通讯录与好友列表永不推进（`AC-002` ~ `AC-004`）；
 * - 失败保留上一次的最近成功时间与 X，并记录失败原因；
 * - 「是否有数据」= 群消息来源存在 ≥ 1 条 `DM-003`；只读计算、无缓存（删除后立即回落，`AC-029`）；
 * - 缺行不补造（从未执行过的来源不出现在状态列表里）；`STORAGE_UNAVAILABLE` 原样冒泡（`AC-038`）。
 */

import { describe, expect, it } from 'vitest'

import { isStoreError } from '@server/store/errors'

import {
  readHasData,
  readMeMemberId,
  readSourceStatuses,
  sourceStatusEntries,
  writeSourceStatus,
} from '../state/source-state'

import { FakeStore, NOW } from './harness'

const MINUTE = 60 * 1000

function seedOneMessage(store: FakeStore): void {
  store.seedGroup('g1@chatroom')
  store.seedMember({ memberId: 'wxid_a', groupId: 'g1@chatroom', displayName: '张三', isMe: false, personId: 'p1' })
  store.seedMessage({
    messageId: 'msg-1',
    groupId: 'g1@chatroom',
    senderMemberId: 'wxid_a',
    sentAt: NOW - 60 * MINUTE,
    kind: '文字',
    text: '晚上吃啥',
    mediaRef: null,
    mentionedMemberIds: null,
    quotedMessageId: null,
  })
}

describe('「记录更新至 X」：只随群消息来源完整成功推进', () => {
  it('群消息成功 → 最近成功时间与 X 同时推进；通讯录成功不推进 X', () => {
    const store = new FakeStore()
    seedOneMessage(store)

    writeSourceStatus(store, {
      source: '群消息',
      status: '成功',
      completedAt: NOW,
      failureReason: null,
    })
    expect(store.statuses.get('群消息')).toMatchObject({
      status: '成功',
      lastSuccessAt: NOW,
      updatedUntilX: NOW,
      failureReason: null,
      hasData: true,
    })

    writeSourceStatus(store, {
      source: '通讯录与好友列表',
      status: '成功',
      completedAt: NOW + 5 * MINUTE,
      failureReason: null,
    })
    expect(store.statuses.get('群消息')).toMatchObject({ lastSuccessAt: NOW, updatedUntilX: NOW })
    expect(store.statuses.get('通讯录与好友列表')).toMatchObject({
      status: '成功',
      lastSuccessAt: NOW + 5 * MINUTE,
      updatedUntilX: NOW, // X 仍指群消息来源的最近成功时间
    })
  })

  it('群消息失败：保留上一次成功时间与 X，写入失败原因（不推进）', () => {
    const store = new FakeStore()
    writeSourceStatus(store, { source: '群消息', status: '成功', completedAt: NOW, failureReason: null })

    writeSourceStatus(store, {
      source: '群消息',
      status: '失败',
      completedAt: null,
      failureReason: 'CLI 命令超时（群消息:g1@chatroom）',
    })
    expect(store.statuses.get('群消息')).toMatchObject({
      status: '失败',
      lastSuccessAt: NOW,
      updatedUntilX: NOW,
      failureReason: 'CLI 命令超时（群消息:g1@chatroom）',
    })
  })

  it('未执行过更新：两条来源都没有记录，X 为空', () => {
    const store = new FakeStore()
    expect(readSourceStatuses(store).bySource.size).toBe(0)
    expect(sourceStatusEntries(readSourceStatuses(store))).toEqual([])
  })

  it('缺行不补造：只有通讯录执行过时，列表里只有通讯录、X 为空', () => {
    const store = new FakeStore()
    writeSourceStatus(store, { source: '通讯录与好友列表', status: '失败', completedAt: null, failureReason: '找不到聊天对象' })

    const snapshot = readSourceStatuses(store)
    expect(snapshot.bySource.has('群消息')).toBe(false)
    expect(sourceStatusEntries(snapshot)).toEqual([
      { source: '通讯录与好友列表', status: '失败', at: null },
    ])
  })
})

describe('「是否有数据」与只读口径（无缓存）', () => {
  it('= 群消息来源存在 ≥ 1 条 DM-003；删除后立即回落为否', () => {
    const store = new FakeStore()
    expect(readHasData(store)).toBe(false)

    seedOneMessage(store)
    expect(readHasData(store)).toBe(true)
    writeSourceStatus(store, { source: '群消息', status: '成功', completedAt: NOW, failureReason: null })
    expect(store.statuses.get('群消息')?.hasData).toBe(true)

    store.messages.clear() // 模拟删除（API-006）后即时回落
    expect(readHasData(store)).toBe(false)
    // X 不回退（X 表示「最近一次成功」，不是「当前数据完整覆盖」的证明）
    expect(store.statuses.get('群消息')?.updatedUntilX).toBe(NOW)
  })

  it('`meMemberId` 经 DM-004（成员标识 = me）读取；未解析出时为 null', () => {
    const store = new FakeStore()
    expect(readMeMemberId(store)).toBeNull()

    store.seedGroup('g1@chatroom')
    store.seedMember({ memberId: 'me', groupId: 'g1@chatroom', displayName: '我', isMe: true, personId: 'p-me' })
    expect(readMeMemberId(store)).toBe('me')
  })

  it('读失败（STORAGE_UNAVAILABLE）原样冒泡，不转成「无数据」', () => {
    const store = new FakeStore()
    store.failReads = true
    try {
      readSourceStatuses(store)
      expect.unreachable('应当抛出存储不可用')
    } catch (error) {
      expect(isStoreError(error)).toBe(true)
      expect(isStoreError(error) && error.envelope.code).toBe('STORAGE_UNAVAILABLE')
    }
    expect(() => readHasData(store)).toThrow()
  })
})
