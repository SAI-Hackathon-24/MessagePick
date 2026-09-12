/**
 * CLI 字段 → `DM-002` ~ `DM-005` 记录的映射（mod-001 §5.4）。
 *
 * 规则（§5.4、详设 §4.4 / §8.2）：
 * - 未知字段忽略、可选字段缺失取空、**必填缺失 → 记日志并跳过该条**（不编造值）；
 * - 记录身份统一走 `identity.ts`（幂等键 = 重复采集不产生副本）；
 * - 发送者解析：消息行的发送者是「群昵称或 `me`」。昵称可能重名或不稳定，因此按
 *   `display_name → nick_name → remark → username` 建索引；解析不到的标签**回落为标签原文当成员标识**，
 *   并给该群补一条占位成员记录 —— 否则 `dm003_message` 的 `(group_id, sender_key)` 立即外键会让整条消息丢失。
 *   `me` 行同理按需补（成员返回体不含登录账号，`isMe` 由调用方按「全库至多一条」裁决）。
 * - 媒体引用：CLI 只给本机绝对路径，而 `MediaRef` 必须是应用数据目录内的相对路径，且模块边界禁止本模块
 *   写媒体文件（§2「不持有第二份存储」）→ `mediaRef` 落 null（类型 = 图片 / 表情包仍保留，供 `MOD-002` 后续按需解密）。
 */

import type { ContactRecord, ContactSource, EntityRecord, GroupMember, Group, Id, RawMessage } from '@shared'

import type { IngestFailure } from '../errors'
import { failure } from '../errors'
import { messageIdOf, contactIdOf, ME_MEMBER_ID, personIdOf } from './identity'
import { parseMessageLines, type ContactItem, type HistoryPayload, type MemberItem, type MembersPayload, type SessionItem } from '../cli/parse'

/** 群成员的显示名取值（群昵称优先）。 */
export function displayNameOf(member: Pick<MemberItem, 'displayName' | 'nickName' | 'remark' | 'username'>): string {
  const candidates = [member.displayName, member.nickName, member.remark]
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== '') return candidate
  }
  return member.username
}

/** 群 → `DM-002`（会话条目、成员返回体都可给出群名）。 */
export function groupRecordFromSession(session: SessionItem): EntityRecord<'DM-002'> {
  return { groupId: session.username, groupName: session.chat }
}

/** 群 → `DM-002`（成员返回体的 `username` / `group` 为准，避免会话名与群名不一致）。 */
export function groupRecordFromMembers(payload: MembersPayload, fallbackName: string): EntityRecord<'DM-002'> {
  const name = payload.group !== '' ? payload.group : fallbackName
  return { groupId: payload.username, groupName: name }
}

/** 发送者标签 → 成员标识 的解析器（按群建立）。 */
export interface MemberIndex {
  /** 解析发送者标签；解析不到返回 null（调用方回落为标签原文）。 */
  resolve(label: string): Id | null
  /** 已知成员是否包含该标识。 */
  has(memberId: Id): boolean
}

/** 按 `display_name → nick_name → remark → username` 建索引（先到先得，标签重复时取首条）。 */
export function buildMemberIndex(members: readonly MemberItem[], meMemberId: Id = ME_MEMBER_ID): MemberIndex {
  const byLabel = new Map<string, Id>()
  const ids = new Set<Id>()
  for (const member of members) {
    const memberId = member.username
    ids.add(memberId)
    const labels = [member.displayName, member.nickName, member.remark, member.username]
    for (const label of labels) {
      if (label === null || label === '') continue
      if (!byLabel.has(label)) byLabel.set(label, memberId)
    }
  }
  // 登录账号由 CLI 渲染为 `me`：直接把该标签指向 Me 标识，避免与真实昵称撞名时解析错。
  // 注意：`ids` 只登记**成员返回体里真实存在**的标识 —— Me 行按需由消息行创建（见 `messageRecordsFromHistory`）。
  byLabel.set(ME_MEMBER_ID, meMemberId)
  return {
    resolve(label) {
      return byLabel.get(label) ?? null
    },
    has(memberId) {
      return ids.has(memberId)
    },
  }
}

export interface MemberMappingResult {
  records: EntityRecord<'DM-004'>[]
  index: MemberIndex
  failures: IngestFailure[]
}

/**
 * 群成员 → `DM-004`（成员返回体的成员；不含登录账号 —— 登录账号由消息行的 `me` 标签按需创建）。
 *
 * 不在此处造 `me` 行的理由：`dm004_member` 上有「全库至多一条 `is_me=1`」的部分唯一索引
 * （`data-model.md` DM-004 约束），把 `is_me=1` 颁给哪一行必须与实际看到「我发言」的群绑定。
 */
export function memberRecordsFromMembers(payload: MembersPayload): MemberMappingResult {
  const failures: IngestFailure[] = []
  const records: EntityRecord<'DM-004'>[] = []
  for (const member of payload.members) {
    if (member.username === '') {
      failures.push(failure('SOURCE_UNAVAILABLE', '群成员缺少成员标识，已跳过该条', payload.username, false))
      continue
    }
    records.push(memberRecord(payload.username, member.username, displayNameOf(member), false))
  }
  return { records, index: buildMemberIndex(payload.members), failures }
}

/** 单条 `DM-004`。 */
export function memberRecord(groupId: Id, memberId: Id, displayName: string, isMe: boolean): EntityRecord<'DM-004'> {
  return { memberId, groupId, displayName, isMe, personId: personIdOf(groupId, memberId) }
}

export interface MessageMappingResult {
  records: EntityRecord<'DM-003'>[]
  /** 解析不到归属的发送者的占位成员记录（必须先于消息写入，否则立即外键失败） */
  placeholderMembers: EntityRecord<'DM-004'>[]
  /** 行格式无法解析的条数（CLI 输出与约定不符；计数后跳过，不静默不编造） */
  skippedLines: number
  /** 媒体消息中 CLI 未给出本机路径的条数（未解密 / 未加 `--media`） */
  mediaUnavailable: number
}

/**
 * `history` 返回体 → `DM-003` 消息记录（时间窗 + 分页已在调用方完成）。
 *
 * 占位成员：发送者解析不到（回落标签原文）或发送者为 `me`（成员返回体不含登录账号）时，
 * 都给该群补一条 `DM-004`，保证 `DM-003` 的立即外键成立、消息不丢。
 *
 * `markMe`：补 `me` 占位行时调用一次；返回 true 表示本次可把该行标为「我」
 * （全库至多一条，由调用方结合库里已有的标记状态决定）。
 */
export function messageRecordsFromHistory(
  payload: HistoryPayload,
  options: { index: MemberIndex; markMe?: () => boolean },
): MessageMappingResult {
  const parsed = parseMessageLines(payload.messages)
  const records: EntityRecord<'DM-003'>[] = []
  const placeholders = new Map<Id, EntityRecord<'DM-004'>>()

  for (const line of parsed.parsed) {
    const resolved = options.index.resolve(line.senderLabel)
    // 解析不到归属：以标签原文当成员标识（`me` 标签 = 登录账号，统一走 Me 标识）。
    const senderMemberId = resolved ?? (line.senderLabel === ME_MEMBER_ID ? ME_MEMBER_ID : line.senderLabel)
    // 立即外键兜底：成员返回体不列出登录账号（`me` 只是消息行里的标签），解析不到的标签也会回落为
    // 标签原文 —— 这两类发送者都必须先给该群补一条占位成员，否则 `dm003_message` 的
    // `(group_id, sender_key)` 立即外键会让整条消息丢失。
    if (!options.index.has(senderMemberId) && !placeholders.has(senderMemberId)) {
      const isMe = senderMemberId === ME_MEMBER_ID && options.markMe?.() === true
      placeholders.set(
        senderMemberId,
        memberRecord(payload.username, senderMemberId, senderMemberId === ME_MEMBER_ID ? '我' : line.senderLabel, isMe),
      )
    }
    records.push({
      messageId: messageIdOf({
        groupId: payload.username,
        sentAt: line.sentAt,
        senderMemberId,
        kind: line.kind,
        text: line.text,
        mediaPath: line.mediaPath,
      }),
      groupId: payload.username,
      senderMemberId,
      sentAt: line.sentAt,
      kind: line.kind,
      text: line.text,
      // 媒体引用见文件头注释：只记录「有媒体」这一事实（类型），落库引用为空。
      mediaRef: null,
      // 提及成员 / 引用消息：CLI 的字符串输出不提供，不猜（实现报告已点出）。
      mentionedMemberIds: null,
      quotedMessageId: null,
    })
  }

  const mediaUnavailable = parsed.parsed.filter(
    (line) => (line.kind === '图片' || line.kind === '表情包') && line.mediaPath === null,
  ).length

  return { records, placeholderMembers: [...placeholders.values()], skippedLines: parsed.skipped, mediaUnavailable }
}

/** `contacts` → `DM-005`（来源 = 通讯录）。 */
export function contactRecordsFromContacts(
  items: readonly ContactItem[],
  source: ContactSource = '通讯录',
): { records: EntityRecord<'DM-005'>[]; skipped: number } {
  const records: EntityRecord<'DM-005'>[] = []
  let skipped = 0
  for (const item of items) {
    if (item.username === '') {
      skipped += 1
      continue
    }
    const displayName = item.remark !== null && item.remark !== '' ? item.remark : (item.nickName ?? item.username)
    records.push({ contactId: contactIdOf(item.username), displayName, source } satisfies EntityRecord<'DM-005'> & ContactRecord)
  }
  return { records, skipped }
}

/** 私聊会话条目 → `DM-005`（来源 = 好友列表；CLI 无独立的好友列表命令）。 */
export function contactRecordsFromSessions(
  sessions: readonly SessionItem[],
  source: ContactSource = '好友列表',
): EntityRecord<'DM-005'>[] {
  return sessions
    .filter((session) => !session.isGroup)
    .map((session) => ({
      contactId: contactIdOf(session.username),
      displayName: session.chat,
      source,
    }))
}

/** 类型别名（供来源适配器签名使用）。 */
export type GroupRecord = EntityRecord<'DM-002'> & Group
export type MemberRecord = EntityRecord<'DM-004'> & GroupMember
export type MessageRecord = EntityRecord<'DM-003'> & RawMessage
export type Contact = EntityRecord<'DM-005'> & ContactRecord
