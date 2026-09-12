/**
 * CLI 输出解析（mod-001 §7「CLI 适配」行、§5.4；决策 1）：
 *
 * - `history` 的 `messages` 是**字符串数组**（`[YYYY-MM-DD HH:MM] 发送者: 内容`）；含 `--media` 时的
 *   `[图片] /abs/path` 口径；
 * - `sessions` / `contacts` 是裸数组，`history` / `members` 是字典；字段校验与非法输出（→ 调用方映射
 *   `SOURCE_UNAVAILABLE`）。
 */

import { describe, expect, it } from 'vitest'

import {
  OutputInvalidError,
  formatCliTime,
  parseContacts,
  parseHistory,
  parseMembers,
  parseMessageLine,
  parseMessageLines,
  parseSessions,
} from '../cli/parse'

import { contactsJson, historyJson, membersJson, sessionsJson } from './harness'

describe('history：字符串数组（客观事实口径）', () => {
  const messages = [
    '[2026-09-01 10:30] 张三: 晚上吃啥',
    '[2026-09-01 10:31] 李四: 随便: 都行',
  ]

  it('逐行解析为「时间 + 发送者 + 内容」；内容里的冒号不参与切分', () => {
    const payload = parseHistory(historyJson({ username: 'g1@chatroom', messages }))
    expect(payload.username).toBe('g1@chatroom')
    // 字符串数组原样保留（不含消息主键；身份由 mapping 侧合成，见 identity.ts）
    expect(payload.messages).toEqual(messages)

    const { parsed, skipped } = parseMessageLines(payload.messages)
    expect(skipped).toBe(0)
    expect(parsed[0]).toEqual({
      sentAt: new Date(2026, 8, 1, 10, 30).getTime(),
      senderLabel: '张三',
      kind: '文字',
      text: '晚上吃啥',
      mediaPath: null,
    })
    expect(parsed[1]?.text).toBe('随便: 都行')
    expect(parsed[1]?.senderLabel).toBe('李四')
  })

  it('秒位可给可不给；`me` 是登录账号的发送者标签', () => {
    const line = '[2026-09-01 10:30:45] me: 大家好'
    expect(parseMessageLine(line)).toEqual({
      sentAt: new Date(2026, 8, 1, 10, 30, 45).getTime(),
      senderLabel: 'me',
      kind: '文字',
      text: '大家好',
      mediaPath: null,
    })
  })

  it('`--media` 的媒体行：`[图片] /abs/path` → 类型 = 图片、文本为空、给出本机路径', () => {
    expect(parseMessageLine('[2026-09-01 10:32] 张三: [图片] /Users/x/media/a.dat')).toEqual({
      sentAt: new Date(2026, 8, 1, 10, 32).getTime(),
      senderLabel: '张三',
      kind: '图片',
      text: null,
      mediaPath: '/Users/x/media/a.dat',
    })
    expect(parseMessageLine('[2026-09-01 10:33] 李四: [表情] ./cache/b.gif')).toEqual({
      sentAt: new Date(2026, 8, 1, 10, 33).getTime(),
      senderLabel: '李四',
      kind: '表情包',
      text: null,
      mediaPath: './cache/b.gif',
    })
  })

  it('未解密 / 未加 `--media` 的媒体行：类型保留、路径为空（不编造路径）', () => {
    const bare = parseMessageLine('[2026-09-01 10:34] 张三: [图片]')
    expect(bare).toMatchObject({ kind: '图片', text: null, mediaPath: null })
    const marker = parseMessageLine('[2026-09-01 10:35] 张三: [图片] (local_id=9)')
    expect(marker).toMatchObject({ kind: '图片', text: null, mediaPath: null })
  })

  it('无法解析的行 → 计数跳过（不静默、不编造）', () => {
    const { parsed, skipped } = parseMessageLines([
      '没有时间前缀的行',
      '[2026-09-01 10:36]   : 发送者为空',
      '[xxxx-xx-xx] 张三: 时间不合法',
      '[2026-09-01 10:37] 张三: 正常',
    ])
    expect(skipped).toBe(3)
    expect(parsed).toHaveLength(1)
  })

  it('非法输出：非 JSON / messages 元素不是文本 / 必填字段缺失 → OutputInvalidError', () => {
    expect(() => parseHistory('not json')).toThrow(OutputInvalidError)
    expect(() => parseHistory(JSON.stringify({ username: 'g1', messages: [1] }))).toThrow(OutputInvalidError)
    expect(() => parseHistory(JSON.stringify({ messages: [] }))).toThrow(OutputInvalidError)
    expect(() => parseSessions(JSON.stringify({ chat: 'x' }))).toThrow(OutputInvalidError)
    expect(() => parseSessions(JSON.stringify({ 不是: '数组' }))).toThrow(OutputInvalidError)
  })

  it('逐条失败说明（`failures`）原样带回，供来源层计入分项明细', () => {
    const payload = parseHistory(
      historyJson({ username: 'g1', messages: [], failures: ['id=12: 解密失败'] }),
    )
    expect(payload.failures).toEqual(['id=12: 解密失败'])
  })
})

describe('sessions / members / contacts：字段映射', () => {
  it('sessions：`is_group` 决定群 / 私聊；chat 为显示名、username 为标识', () => {
    const sessions = parseSessions(
      sessionsJson([
        { chat: '群一', username: 'g1@chatroom', isGroup: true },
        { chat: '张三', username: 'wxid_zhang' },
      ]),
    )
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ chat: '群一', username: 'g1@chatroom', isGroup: true })
    expect(sessions[1]).toMatchObject({ chat: '张三', username: 'wxid_zhang', isGroup: false })
  })

  it('members：群昵称（display_name）与昵称 / 备注分别保留', () => {
    const payload = parseMembers(
      membersJson({
        group: '群一',
        username: 'g1@chatroom',
        members: [
          { username: 'wxid_a', displayName: '群昵称A', nickName: '昵称A', remark: null },
          { username: 'wxid_b', displayName: null, nickName: '昵称B', remark: '备注B' },
        ],
      }),
    )
    expect(payload.group).toBe('群一')
    expect(payload.members).toEqual([
      { username: 'wxid_a', nickName: '昵称A', remark: null, displayName: '群昵称A' },
      { username: 'wxid_b', nickName: '昵称B', remark: '备注B', displayName: null },
    ])
  })

  it('contacts：裸数组；remark / nick_name 可空', () => {
    const contacts = parseContacts(
      contactsJson([
        { username: 'wxid_c', remark: '备注C' },
        { username: 'wxid_d', nickName: '昵称D' },
      ]),
    )
    expect(contacts).toEqual([
      { username: 'wxid_c', nickName: null, remark: '备注C' },
      { username: 'wxid_d', nickName: '昵称D', remark: null },
    ])
  })
})

describe('formatCliTime：窗口参数（本机时区、秒级）', () => {
  it('epoch 毫秒 → `YYYY-MM-DD HH:MM:SS`（与消息行时间同口径）', () => {
    const epoch = new Date(2026, 8, 1, 9, 5, 7).getTime()
    expect(formatCliTime(epoch)).toBe('2026-09-01 09:05:07')
  })
})
