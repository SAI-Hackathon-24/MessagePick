/**
 * DM-001 ~ DM-005 的列映射（mod-002 §5.1「本模块持有的事实」）。
 *
 * 字段名与可空性严格照抄 `docs/design/data-model.md` 的字段表与 `src/shared/entities.ts`
 * （错误列一律不造；需要补字段时先在 docs 走变更流程）。
 */

import {
  INGEST_SOURCES,
  INGEST_SOURCE_STATUSES,
  MESSAGE_KINDS,
  CONTACT_SOURCES,
} from '@shared'

import { col, type ColumnSpec } from './columns'

/** DM-001 采集来源状态（MOD-001 写；两条来源各一条）。 */
export const DM001_COLUMNS: readonly ColumnSpec[] = [
  col('source', 'source', { kind: 'text', enumValues: INGEST_SOURCES, mutable: false }),
  col('status', 'status', { kind: 'text', enumValues: INGEST_SOURCE_STATUSES, mutable: true }),
  col('lastSuccessAt', 'last_success_at', { kind: 'int', required: false, mutable: true }),
  col('failureReason', 'failure_reason', { kind: 'text', required: false, mutable: true }),
  // 「记录更新至 X」与「是否有数据」为派生值，由写者在写入前算好（写库后即权威值）。
  col('updatedUntilX', 'updated_until_x', { kind: 'int', required: false, mutable: true }),
  col('hasData', 'has_data', { kind: 'bool', mutable: true }),
]

/** DM-002 群（群多选筛选与按群删除的单位）。 */
export const DM002_COLUMNS: readonly ColumnSpec[] = [
  col('groupId', 'group_id', { kind: 'text', mutable: false }),
  col('groupName', 'group_name', { kind: 'text', mutable: true, note: '群名随采集更新' }),
]

/** DM-003 原始消息记录（全部结论的来源事实；写入后字段不可修改）。 */
export const DM003_COLUMNS: readonly ColumnSpec[] = [
  col('messageId', 'msg_id', { kind: 'text', mutable: false }),
  col('groupId', 'group_id', { kind: 'text', mutable: false }),
  col('senderMemberId', 'sender_key', { kind: 'text', mutable: false }),
  col('sentAt', 'sent_at', { kind: 'int', mutable: false }),
  col('kind', 'msg_type', { kind: 'text', enumValues: MESSAGE_KINDS, mutable: false }),
  col('text', 'text', { kind: 'text', required: false, mutable: false }),
  col('mediaRef', 'media_ref', { kind: 'text', required: false, mutable: false }),
  col('mentionedMemberIds', 'mentioned', {
    kind: 'json',
    required: false,
    jsonShape: 'array',
    mutable: false,
  }),
  col('quotedMessageId', 'quote_msg_id', { kind: 'text', required: false, mutable: false }),
]

/** DM-004 群成员身份（群内唯一；记录身份键 = 所属群 + 成员标识）。 */
export const DM004_COLUMNS: readonly ColumnSpec[] = [
  col('memberId', 'member_id', { kind: 'text', mutable: false }),
  col('groupId', 'group_id', { kind: 'text', mutable: false }),
  col('displayName', 'display_name', { kind: 'text', mutable: true, note: '群昵称随采集更新' }),
  col('isMe', 'is_me', { kind: 'bool', mutable: false, note: '由 Me 标识给出；全库至多一条为真' }),
  col('personId', 'person_id', {
    kind: 'text',
    mutable: false,
    note: '结构性绑定：默认指向仅含本成员的人；存在已确认映射时由存储侧合并',
  }),
]

/** DM-005 通讯录 / 好友列表记录（与来源组合后唯一；不参与群归属）。 */
export const DM005_COLUMNS: readonly ColumnSpec[] = [
  col('contactId', 'contact_id', { kind: 'text', mutable: false }),
  col('displayName', 'display_name', { kind: 'text', mutable: false }),
  col('source', 'source', { kind: 'text', enumValues: CONTACT_SOURCES, mutable: false }),
]
