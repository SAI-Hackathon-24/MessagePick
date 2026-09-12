/**
 * 记录身份（幂等键）取值口径（mod-001 §5.4、详设 §2.4「记录身份」）。
 *
 * 记录身份 = `MOD-002` upsert / insert-only 去重的依据：同一范围重复采集不得产生副本（`AC-008`）。
 *
 * 客观事实带来的约束（wechat-cli `AGENTS.md` §3.2）：`history` 的 `messages` 是**字符串数组**，
 * 不含消息主键（local_id / server_id / md5 都拿不到）。因此：
 * - 消息标识 = 由「群 + 发送时间 + 发送者 + 类型 + 内容 / 媒体路径」派生的稳定摘要 —— 同一条消息
 *   在重复采集（含跨重启重采）时得到同一标识，从而被 `MOD-002` 去重；
 * - 代价：同一群内、同一分钟（CLI 时间精度到分钟）、同一发送者的**完全相同**的两条消息会被视为同一条
 *   （去重合并）。这是拿不到消息主键时的保守选择，已在实现报告中点出。
 */

import { createHash } from 'node:crypto'

import type { Id, MessageKind, Timestamp } from '@shared'

/** 「我」的成员标识：CLI 在消息行里把登录账号渲染为字面量 `me`（客观事实，AGENTS.md §3.2）。 */
export const ME_MEMBER_ID: Id = 'me'

/** DM-002 群标识 = CLI 会话 `username`（形如 `xxx@chatroom`）。 */
export function groupIdOf(username: string): Id {
  return username
}

/** DM-004 成员标识 = CLI 的 `username`（wxid 形态）；解析不到时回落为发送者标签原文。 */
export function memberIdOf(username: string): Id {
  return username
}

/** DM-004 的归属人标识：默认「一人 = 一个群成员」（未确认映射时，`data-model.md` DM-004 / DM-011）。 */
export function personIdOf(groupId: Id, memberId: Id): Id {
  return `person:${groupId}:${memberId}`
}

/** DM-005 联系人标识 = CLI 的 `username`。 */
export function contactIdOf(username: string): Id {
  return username
}

export interface MessageIdentityInput {
  groupId: Id
  sentAt: Timestamp
  senderMemberId: Id
  kind: MessageKind
  /** 文本内容（媒体消息为 null） */
  text: string | null
  /** 媒体消息的 CLI 本机绝对路径（未解密时为 null）；媒体引用未落库，但参与身份计算以区分同分钟同文本 */
  mediaPath: string | null
}

/** 消息标识（记录身份键；见文件头注释的取舍）。 */
export function messageIdOf(input: MessageIdentityInput): Id {
  const digest = createHash('sha1')
    .update(
      [
        input.groupId,
        String(input.sentAt),
        input.senderMemberId,
        input.kind,
        input.text ?? '',
        input.mediaPath ?? '',
      ].join('\u0000'),
    )
    .digest('hex')
    .slice(0, 20)
  return `msg-${digest}`
}
