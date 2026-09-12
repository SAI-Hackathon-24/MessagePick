/**
 * CLI 输出解析与字段校验（mod-001 §3.1「cli/parse.ts」、决策 1）。
 *
 * - 只有本文件与 `runner.ts` 知道 wechat-cli 的输出形状（详设 §8.2：字段变化在 `cli/` 一层吸收）。
 * - 纯函数：不含 I/O、不碰存储、不带凭据 —— 可整段下沉 worker（`pool.ts` / `parse-worker.ts`）。
 * - 未知字段忽略、可选字段缺失取空；**必填缺失或输出不是合法 JSON → 抛 `OutputInvalidError`**
 *   （由调用方映射为来源级 `SOURCE_UNAVAILABLE`，详设 §4.4 / §8.2）。
 * - 只做形状与类型校验，不做业务口径判断（业务映射在 `mapping/`）。
 *
 * 事实口径（wechat-cli `AGENTS.md`，与设计文档的差异已记录在实现报告）：
 * - `sessions` / `contacts --query` 是**裸数组**；`history` / `members` 是字典。
 * - `history.messages` 是**字符串数组**，每条形如 `[YYYY-MM-DD HH:MM] 发送者: 内容`（群聊 sender 是群昵称或 `me`）。
 *   因此消息标识、提及成员、引用消息都取不到 —— 前两者由 `mapping/` 侧兜底（见 `mapping/identity.ts`）。
 */

import type { MessageKind } from '@shared'

/** 输出非法或必填字段缺失（→ 来源级 `SOURCE_UNAVAILABLE`；可自动重试，见 `cli/retry.ts`）。 */
export class OutputInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutputInvalidError'
  }
}

// ---------------------------------------------------------------------------
// 结果形状
// ---------------------------------------------------------------------------

/** `sessions` 的一条会话（`timestamp` 秒级 Unix，转毫秒由调用方处理）。 */
export interface SessionItem {
  chat: string
  username: string
  isGroup: boolean
  unread: number | null
  lastMessage: string | null
  msgType: string | null
  sender: string | null
  /** 秒级 Unix 时间戳（CLI 原样给出） */
  timestamp: number | null
  time: string | null
}

/** `history` 的返回体。 */
export interface HistoryPayload {
  chat: string
  username: string
  isGroup: boolean
  count: number
  offset: number
  limit: number
  /** 原始消息行（字符串形态，逐行解析见 `parseMessageLine`） */
  messages: string[]
  /** CLI 侧逐条失败说明（存在时进分项明细，不阻塞其他行） */
  failures: string[]
}

/** `members` 的成员项。 */
export interface MemberItem {
  username: string
  nickName: string | null
  remark: string | null
  /** 群昵称（消息里的发送者标签即此值） */
  displayName: string | null
}

/** `members` 的返回体。 */
export interface MembersPayload {
  group: string
  username: string
  memberCount: number
  owner: string | null
  members: MemberItem[]
}

/** `contacts` 的条目。 */
export interface ContactItem {
  username: string
  nickName: string | null
  remark: string | null
}

/** 一条消息行解析结果。 */
export interface ParsedMessageLine {
  /** 发送时间（UTC epoch 毫秒；CLI 只给到分钟） */
  sentAt: number
  /** 发送者标签：群昵称，或 `me`（登录账号） */
  senderLabel: string
  kind: MessageKind
  /** 文本内容（媒体消息为空） */
  text: string | null
  /** 媒体消息的 CLI 本机绝对路径（未加 `--media` 或未解密时为空） */
  mediaPath: string | null
}

/** 消息行解析结果 + 无法解析的行数（行内容不进日志，只计数）。 */
export interface ParseMessagesResult {
  parsed: ParsedMessageLine[]
  skipped: number
}

// ---------------------------------------------------------------------------
// 形状工具
// ---------------------------------------------------------------------------

function parseJson(text: string, scope: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new OutputInvalidError(`${scope}：CLI 输出不是合法 JSON`)
  }
}

function asRecord(value: unknown, scope: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OutputInvalidError(`${scope}：CLI 输出结构非法（应为对象）`)
  }
  return value as Record<string, unknown>
}

function asArray(value: unknown, scope: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new OutputInvalidError(`${scope}：CLI 输出结构非法（应为数组）`)
  }
  return value
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 必填文本（缺失 → 输出非法）。 */
function requiredStr(value: unknown, field: string, scope: string): string {
  const text = str(value)
  if (text === null || text === '') {
    throw new OutputInvalidError(`${scope}：必填字段缺失（${field}）`)
  }
  return text
}

// ---------------------------------------------------------------------------
// 会话 / 成员 / 联系人
// ---------------------------------------------------------------------------

/** `sessions` / `unread` 返回体 → 会话列表。 */
export function parseSessions(stdout: string, scope = 'sessions'): SessionItem[] {
  return asArray(parseJson(stdout, scope), scope).map((item) => {
    const record = asRecord(item, scope)
    return {
      chat: requiredStr(record.chat, 'chat', scope),
      username: requiredStr(record.username, 'username', scope),
      isGroup: record.is_group === true,
      unread: num(record.unread),
      lastMessage: str(record.last_message),
      msgType: str(record.msg_type),
      sender: str(record.sender),
      timestamp: num(record.timestamp),
      time: str(record.time),
    }
  })
}

/** `history` 返回体 → 消息行集合。 */
export function parseHistory(stdout: string, scope = 'history'): HistoryPayload {
  const record = asRecord(parseJson(stdout, scope), scope)
  const messages = asArray(record.messages ?? [], scope).map((line) => {
    const text = str(line)
    if (text === null) throw new OutputInvalidError(`${scope}：messages 元素不是文本`)
    return text
  })
  const failures = Array.isArray(record.failures)
    ? record.failures.map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
    : []
  return {
    chat: str(record.chat) ?? '',
    username: requiredStr(record.username, 'username', scope),
    isGroup: record.is_group === true,
    count: num(record.count) ?? messages.length,
    offset: num(record.offset) ?? 0,
    limit: num(record.limit) ?? messages.length,
    messages,
    failures,
  }
}

/** `members` 返回体 → 群成员集合。 */
export function parseMembers(stdout: string, scope = 'members'): MembersPayload {
  const record = asRecord(parseJson(stdout, scope), scope)
  const members = asArray(record.members ?? [], scope).map((item) => {
    const member = asRecord(item, scope)
    return {
      username: requiredStr(member.username, 'username', scope),
      nickName: str(member.nick_name),
      remark: str(member.remark),
      displayName: str(member.display_name),
    }
  })
  return {
    group: str(record.group) ?? '',
    username: requiredStr(record.username, 'username', scope),
    memberCount: num(record.member_count) ?? members.length,
    owner: str(record.owner),
    members,
  }
}

/** `contacts --query` 返回体（裸数组）→ 联系人集合。 */
export function parseContacts(stdout: string, scope = 'contacts'): ContactItem[] {
  return asArray(parseJson(stdout, scope), scope).map((item) => {
    const record = asRecord(item, scope)
    return {
      username: requiredStr(record.username, 'username', scope),
      nickName: str(record.nick_name),
      remark: str(record.remark),
    }
  })
}

// ---------------------------------------------------------------------------
// 消息行
// ---------------------------------------------------------------------------

/** 消息行前缀：`[YYYY-MM-DD HH:MM(:SS)?] 发送者: 内容`。 */
const MESSAGE_LINE = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?\]\s*([^:]*?)\s*:\s?([\s\S]*)$/

/**
 * epoch 毫秒 → CLI 的 `--start-time` / `--end-time` 文本（本机时区，秒级）。
 *
 * CLI 只接受 `YYYY-MM-DD` / `YYYY-MM-DD HH:MM` / `YYYY-MM-DD HH:MM:SS`，且消息行里的时间也是本机时区
 * （AGENTS.md §4）—— 两侧口径一致，避免时区漂移把窗口算错。
 */
export function formatCliTime(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  return (
    `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** 媒体标记 → DM-003 类型（其余标记归「文字」，原文保留在文本内容里）。 */
const MEDIA_KINDS: ReadonlyMap<string, MessageKind> = new Map([
  ['图片', '图片'],
  ['表情', '表情包'],
])

/**
 * 解析一条消息行。
 *
 * 口径（客观事实，AGENTS.md §3.2）：
 * - 时间只给到分钟（秒位可缺省）；发送者是群昵称或 `me`。
 * - 加 `--media` 后媒体消息形如 `[图片] /abs/path/x.dat`；未解密时不带路径。
 * - 解析不到的行返回 `null`（调用方计数并跳过，不静默、也不编造内容）。
 */
export function parseMessageLine(line: string): ParsedMessageLine | null {
  const matched = MESSAGE_LINE.exec(line)
  if (matched === null) return null
  const [, year, month, day, hour, minute, second, senderLabel, content] = matched
  const sentAt = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second === undefined ? 0 : Number(second),
  ).getTime()
  if (!Number.isFinite(sentAt)) return null
  const sender = (senderLabel ?? '').trim()
  if (sender === '') return null

  const marker = /^\[([^\]]+)\](?:\s+([\s\S]+))?$/.exec(content ?? '')
  if (marker !== null) {
    const kind = MEDIA_KINDS.get((marker[1] ?? '').trim())
    if (kind !== undefined) {
      const tail = (marker[2] ?? '').trim()
      // 只认「看起来是路径」的尾部；未解密时 CLI 给的是 `(local_id=N)` 之类标记。
      const mediaPath = tail.startsWith('/') || tail.startsWith('./') ? tail : null
      return { sentAt, senderLabel: sender, kind, text: null, mediaPath }
    }
  }
  return { sentAt, senderLabel: sender, kind: '文字', text: content ?? '', mediaPath: null }
}

/** 批量解析消息行（含无法解析行计数）。 */
export function parseMessageLines(lines: readonly string[]): ParseMessagesResult {
  const parsed: ParsedMessageLine[] = []
  let skipped = 0
  for (const line of lines) {
    const one = parseMessageLine(line)
    if (one === null) skipped += 1
    else parsed.push(one)
  }
  return { parsed, skipped }
}

// ---------------------------------------------------------------------------
// 解析执行器（worker 池 / 内联）
// ---------------------------------------------------------------------------

/** 解析任务：只带文本与入口名，不带凭据与配置（详设 §1.1 的 worker 禁止项）。 */
export interface ParseTask {
  kind: 'sessions' | 'history' | 'members' | 'contacts'
  text: string
  /** 失败边界名（命令名 / 群标识；不含消息内容与联系人姓名） */
  scope: string
}

/**
 * 解析执行器：默认走 worker 池（`pool.ts`，大输出才下沉），测试与降级路径用内联实现。
 *
 * 返回 `unknown`（调用方按 `kind` 断言），避免把每个入口的结果类型都写进执行器签名。
 */
export type ParseRunner = (task: ParseTask) => Promise<unknown>

/** 按任务入口分派（纯计算；worker 与内联实现共用）。 */
export function parseByKind(task: ParseTask): unknown {
  switch (task.kind) {
    case 'sessions':
      return parseSessions(task.text, task.scope)
    case 'history':
      return parseHistory(task.text, task.scope)
    case 'members':
      return parseMembers(task.text, task.scope)
    case 'contacts':
      return parseContacts(task.text, task.scope)
  }
}

/** 内联解析（小输出常态路径，也是 worker 不可用时的降级路径）。 */
export function createInlineParseRunner(): ParseRunner {
  return async (task) => parseByKind(task)
}
