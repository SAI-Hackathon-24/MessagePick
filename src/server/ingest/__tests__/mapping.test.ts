/**
 * 记录映射与记录身份（mod-001 §7「写入与幂等」行、§5.4）：
 *
 * - 记录身份稳定 = 同一范围重复采集不产生副本（`AC-008`）；
 * - 发送者解析：昵称索引 → 解析不到回落标签原文 + 占位成员（立即外键不丢消息）；
 * - `me` 标签 → `ME_MEMBER_ID`，`isMe` 由调用方按「全库至多一条」判定；
 * - 媒体：CLI 只给本机绝对路径，`mediaRef` 落 null（模块不写媒体文件），类型保留。
 */

import { describe, expect, it } from 'vitest'

import { parseContacts, parseHistory, parseMembers, parseSessions } from '../cli/parse'
import { ME_MEMBER_ID, contactIdOf, messageIdOf, personIdOf } from '../mapping/identity'
import {
  buildMemberIndex,
  contactRecordsFromContacts,
  contactRecordsFromSessions,
  displayNameOf,
  groupRecordFromMembers,
  groupRecordFromSession,
  memberRecordsFromMembers,
  messageRecordsFromHistory,
} from '../mapping/records'

import { contactsJson, historyJson, membersJson, makeMessageLine, sessionsJson } from './harness'

const GROUP = 'g1@chatroom'

describe('记录身份（幂等键）', () => {
  const base = { groupId: GROUP, sentAt: 1_700_000_000_000, senderMemberId: 'wxid_a', kind: '文字' as const, text: '你好', mediaPath: null }

  it('同一输入得到同一标识（重复采集不产生副本）', () => {
    expect(messageIdOf(base)).toBe(messageIdOf({ ...base }))
    expect(messageIdOf(base)).toMatch(/^msg-[0-9a-f]{20}$/)
  })

  it('群 / 时间 / 发送者 / 类型 / 内容 / 媒体路径任一不同 → 标识不同', () => {
    const ids = new Set([
      messageIdOf(base),
      messageIdOf({ ...base, groupId: 'g2' }),
      messageIdOf({ ...base, sentAt: base.sentAt + 60_000 }),
      messageIdOf({ ...base, senderMemberId: 'wxid_b' }),
      messageIdOf({ ...base, kind: '图片', text: null, mediaPath: '/x.dat' }),
      messageIdOf({ ...base, text: '你好！' }),
    ])
    expect(ids.size).toBe(6)
  })

  it('人标识与联系人标识取值口径', () => {
    expect(personIdOf(GROUP, 'wxid_a')).toBe(`person:${GROUP}:wxid_a`)
    expect(contactIdOf('wxid_a')).toBe('wxid_a')
  })
})

describe('成员索引与显示名', () => {
  const members = parseMembers(
    membersJson({
      group: '群一',
      username: GROUP,
      members: [
        { username: 'wxid_a', displayName: '群昵称A', nickName: '昵称A' },
        { username: 'wxid_b', displayName: null, nickName: '昵称B', remark: '备注B' },
      ],
    }),
  ).members

  it('显示名优先级：群昵称 → 昵称 → 备注 → 成员标识', () => {
    expect(displayNameOf(members[0]!)).toBe('群昵称A')
    expect(displayNameOf(members[1]!)).toBe('昵称B')
    expect(displayNameOf({ username: 'wxid_c', nickName: null, remark: '备注C', displayName: null })).toBe('备注C')
    expect(displayNameOf({ username: 'wxid_d', nickName: null, remark: null, displayName: null })).toBe('wxid_d')
  })

  it('索引按四类标签建；解析不到返回 null；`me` 标签固定指向 Me 标识', () => {
    const index = buildMemberIndex(members)
    expect(index.resolve('wxid_a')).toBe('wxid_a')
    expect(index.resolve('群昵称A')).toBe('wxid_a')
    expect(index.resolve('昵称B')).toBe('wxid_b')
    expect(index.resolve('备注B')).toBe('wxid_b')
    expect(index.resolve('不存在的人')).toBeNull()
    expect(index.resolve('me')).toBe(ME_MEMBER_ID)
  })

  it('成员缺失成员标识 → 记分项失败并跳过该条（不编造）', () => {
    // 解析层会拒绝空标识（requiredStr）；这里直接构造返回体，模拟 CLI 字段异常时的映射防御
    const payload = {
      group: '群一',
      username: GROUP,
      memberCount: 2,
      owner: null,
      members: [
        { username: 'wxid_a', nickName: null, remark: null, displayName: '群昵称A' },
        { username: '', nickName: null, remark: null, displayName: null },
      ],
    }
    const mapped = memberRecordsFromMembers(payload)
    expect(mapped.records.map((record) => record.memberId)).toEqual(['wxid_a'])
    expect(mapped.failures).toHaveLength(1)
    expect(mapped.failures[0]?.code).toBe('SOURCE_UNAVAILABLE')
  })
})

describe('messageRecordsFromHistory（history 字符串数组 → DM-003）', () => {
  const payload = parseHistory(
    historyJson({
      username: GROUP,
      messages: [
        makeMessageLine('2026-09-01 10:30', '群昵称A', '晚上吃啥'),
        makeMessageLine('2026-09-01 10:31', '野生陌生人', '你们好'),
        makeMessageLine('2026-09-01 10:32', 'me', '我看看'),
        makeMessageLine('2026-09-01 10:33', '群昵称A', '[图片] /Users/x/a.dat'),
        makeMessageLine('2026-09-01 10:34', '群昵称A', '[图片] (local_id=9)'),
      ],
    }),
  )
  const members = parseMembers(
    membersJson({ group: '群一', username: GROUP, members: [{ username: 'wxid_a', displayName: '群昵称A' }] }),
  ).members
  const index = buildMemberIndex(members)

  it('解析到的发送者用成员标识；解析不到的回落标签原文并补占位成员', () => {
    const mapped = messageRecordsFromHistory(payload, { index })
    expect(mapped.records.map((record) => record.senderMemberId)).toEqual([
      'wxid_a',
      '野生陌生人',
      ME_MEMBER_ID,
      'wxid_a',
      'wxid_a',
    ])
    const placeholders = mapped.placeholderMembers.map((record) => record.memberId)
    expect(placeholders).toEqual(['野生陌生人', ME_MEMBER_ID])
  })

  it('占位成员先于消息写入（立即外键）：占位行带归属人与显示名', () => {
    const mapped = messageRecordsFromHistory(payload, { index })
    const stranger = mapped.placeholderMembers.find((record) => record.memberId === '野生陌生人')
    expect(stranger).toMatchObject({
      groupId: GROUP,
      displayName: '野生陌生人',
      isMe: false,
      personId: personIdOf(GROUP, '野生陌生人'),
    })
  })

  it('`me` 行是否标「我」由调用方判定（全库至多一条）：markMe 只放行一次', () => {
    const first = messageRecordsFromHistory(payload, { index, markMe: () => true })
    expect(first.placeholderMembers.find((record) => record.memberId === ME_MEMBER_ID)?.isMe).toBe(true)
    const second = messageRecordsFromHistory(payload, { index, markMe: () => false })
    expect(second.placeholderMembers.find((record) => record.memberId === ME_MEMBER_ID)?.isMe).toBe(false)
  })

  it('媒体行：类型保留、文本为空、`mediaRef` 落 null（模块不写媒体文件）；缺路径计入 mediaUnavailable', () => {
    const mapped = messageRecordsFromHistory(payload, { index })
    const image = mapped.records[3]!
    expect(image).toMatchObject({ kind: '图片', text: null, mediaRef: null })
    const marker = mapped.records[4]!
    expect(marker).toMatchObject({ kind: '图片', text: null, mediaRef: null })
    expect(mapped.mediaUnavailable).toBe(1)
    // 提及成员 / 引用消息：字符串输出不提供 → 不猜（null）
    expect(mapped.records.every((record) => record.mentionedMemberIds === null && record.quotedMessageId === null)).toBe(true)
  })

  it('重复映射结果一致（记录身份稳定 → MOD-002 按身份去重不产生副本）', () => {
    const first = messageRecordsFromHistory(payload, { index })
    const second = messageRecordsFromHistory(payload, { index })
    expect(second.records.map((record) => record.messageId)).toEqual(first.records.map((record) => record.messageId))
  })

  it('无法解析的行只计数跳过（不静默、不编造）', () => {
    const broken = parseHistory(
      historyJson({ username: GROUP, messages: [makeMessageLine('2026-09-01 10:40', '张三', '好的'), '坏行'] }),
    )
    const mapped = messageRecordsFromHistory(broken, { index })
    expect(mapped.records).toHaveLength(1)
    expect(mapped.skippedLines).toBe(1)
  })
})

describe('contacts / 好友列表 → DM-005；群记录', () => {
  it('通讯录显示名：备注 → 昵称 → 联系人标识；空标识跳过', () => {
    const items = parseContacts(
      contactsJson([
        { username: 'wxid_c', remark: '备注C' },
        { username: 'wxid_d', nickName: '昵称D' },
        { username: 'wxid_e' },
      ]),
    )
    items.push({ username: '', nickName: null, remark: null }) // 绕过解析层校验，模拟 CLI 字段异常
    const mapped = contactRecordsFromContacts(items)
    expect(mapped.records).toEqual([
      { contactId: 'wxid_c', displayName: '备注C', source: '通讯录' },
      { contactId: 'wxid_d', displayName: '昵称D', source: '通讯录' },
      { contactId: 'wxid_e', displayName: 'wxid_e', source: '通讯录' },
    ])
    expect(mapped.skipped).toBe(1)
  })

  it('好友列表：只取私聊会话（群条目不进 DM-005）', () => {
    const sessions = parseSessions(
      sessionsJson([
        { chat: '群一', username: 'g1@chatroom', isGroup: true },
        { chat: '张三', username: 'wxid_zhang' },
      ]),
    )
    expect(contactRecordsFromSessions(sessions)).toEqual([
      { contactId: 'wxid_zhang', displayName: '张三', source: '好友列表' },
    ])
  })

  it('群记录：成员返回体的群名 / 标识优先，缺失时回落到会话名', () => {
    const payload = parseMembers(membersJson({ group: '群一', username: GROUP, members: [] }))
    expect(groupRecordFromMembers(payload, '会话里的名字')).toEqual({ groupId: GROUP, groupName: '群一' })
    const empty = parseMembers(membersJson({ group: '', username: GROUP, members: [] }))
    expect(groupRecordFromMembers(empty, '会话里的名字')).toEqual({ groupId: GROUP, groupName: '会话里的名字' })
    expect(
      groupRecordFromSession({ chat: '会话名', username: GROUP, isGroup: true, unread: null, lastMessage: null, msgType: null, sender: null, timestamp: null, time: null }),
    ).toEqual({ groupId: GROUP, groupName: '会话名' })
  })
})
