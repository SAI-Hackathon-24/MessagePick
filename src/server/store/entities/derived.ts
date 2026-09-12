/**
 * DM-006 ~ DM-022 的列映射（mod-002 §5.1；口径归持有模块，这里只登记结构）。
 *
 * 变异白名单（`mutable`）口径 = DM 已声明的可变字段 + 「来源 = 计算」的派生字段
 * （后者由持有模块在每次写入前重算，写库后即权威值；身份列与原始事实列永不覆盖，决策 2）。
 */

import {
  DIMENSIONS,
  GENERATION_KINDS,
  IDENTITY_CANDIDATE_STATUSES,
  INTERACTION_KINDS,
  MATERIAL_CONSENT_STATUSES,
  MATERIAL_TIERS,
  MEME_CANDIDATE_STATUSES,
  MEME_CORRECTIONS,
  MEME_HEATS,
  MEME_KINDS,
  PERSONALITY_DIMENSIONS,
  PERSONALITY_TAG_ORIGINS,
  PERSONALITY_TAG_STATUSES,
  PRIORITIES,
  REMIND_STATES,
  TAG_ORIGINS,
  TODO_STATUSES,
  VARIANT_LINK_STATUSES,
} from '@shared'

import { col, internalCol, type ColumnSpec } from './columns'

/** DM-006 梗（一个梗只属一个群；可变字段 = 梗名 / 类型 / 解读 / 纠正标记 / 合并目标 + 全部派生指标）。 */
export const DM006_COLUMNS: readonly ColumnSpec[] = [
  col('memeId', 'meme_id', { kind: 'text', mutable: false }),
  col('groupId', 'group_id', { kind: 'text', mutable: false }),
  col('name', 'name', { kind: 'text', mutable: true }),
  col('kind', 'kind', { kind: 'text', enumValues: MEME_KINDS, mutable: true }),
  col('interpretation', 'interpretation', { kind: 'text', mutable: true }),
  col('correction', 'correction', {
    kind: 'text',
    enumValues: MEME_CORRECTIONS,
    fallback: '无',
    mutable: true,
  }),
  col('mergedIntoId', 'merged_into_id', { kind: 'text', required: false, mutable: true }),
  col('sourceCandidateId', 'source_candidate_id', {
    kind: 'text',
    required: false,
    mutable: false,
    note: 'G3 确认入库后取得，此后不由重新写入覆盖',
  }),
  col('firstSeenAt', 'first_seen_at', { kind: 'int', mutable: true }),
  col('firstSeenGroupId', 'first_seen_group_id', { kind: 'text', mutable: true }),
  col('lastUsedAt', 'last_used_at', { kind: 'int', mutable: true }),
  col('elapsed', 'elapsed', { kind: 'int', mutable: true }),
  col('occurrenceCount', 'occurrence_count', { kind: 'int', mutable: true }),
  col('weekOverWeek', 'week_over_week', { kind: 'real', mutable: true }),
  col('heat', 'heat', { kind: 'text', enumValues: MEME_HEATS, mutable: true }),
  col('monthlyCounts', 'monthly_counts', { kind: 'json', jsonShape: 'object', mutable: true }),
  col('lifecycle', 'lifecycle', { kind: 'json', jsonShape: 'object', mutable: true }),
  col('memeKing', 'meme_king', { kind: 'json', jsonShape: 'array', mutable: true }),
]

/** DM-007 梗出现记录（不单独修改；时间筛选走内部冗余列 `src_time`，§5.2）。 */
export const DM007_COLUMNS: readonly ColumnSpec[] = [
  col('occurrenceId', 'occurrence_id', { kind: 'text', mutable: false }),
  col('memeId', 'meme_id', { kind: 'text', mutable: false }),
  col('sourceMessageId', 'source_message_id', { kind: 'text', mutable: false }),
  col('occurredAt', 'occurred_at', { kind: 'int', mutable: false }),
  col('speakerMemberId', 'speaker_member_id', { kind: 'text', mutable: false }),
  col('mineRelated', 'mine_related', { kind: 'bool', mutable: false }),
  internalCol('src_time', 'int', { note: '= occurred_at；时间筛选绑定列（§5.2）' }),
]

/** DM-008 梗变体关系（记录身份键 = 源梗 + 衍生梗）。 */
export const DM008_COLUMNS: readonly ColumnSpec[] = [
  col('sourceMemeId', 'source_meme_id', { kind: 'text', mutable: false }),
  col('derivedMemeId', 'derived_meme_id', { kind: 'text', mutable: false }),
  col('status', 'status', {
    kind: 'text',
    enumValues: VARIANT_LINK_STATUSES,
    fallback: '生效',
    mutable: true,
  }),
]

/** DM-009 梗精华消息（记录身份键 = 梗 + 来源消息）。 */
export const DM009_COLUMNS: readonly ColumnSpec[] = [
  col('memeId', 'meme_id', { kind: 'text', mutable: false }),
  col('sourceMessageId', 'source_message_id', { kind: 'text', mutable: false }),
  col('displayOrder', 'display_order', { kind: 'int', mutable: true }),
]

/** DM-010 提取条目（可变字段 = 主题 / 优先级 / 待办状态 + 随时间重算的提醒状态）。 */
export const DM010_COLUMNS: readonly ColumnSpec[] = [
  col('entryId', 'item_id', { kind: 'text', mutable: false }),
  col('recognitionType', 'recognition_type', { kind: 'text', mutable: false }),
  col('timeElement', 'time_element', { kind: 'int', required: false, mutable: false }),
  col('locationElement', 'location_element', { kind: 'text', required: false, mutable: false }),
  col('personElementMemberIds', 'person_element', {
    kind: 'json',
    required: false,
    jsonShape: 'array',
    mutable: false,
  }),
  col('subjectElement', 'subject_element', { kind: 'text', required: false, mutable: false }),
  col('deadline', 'deadline', { kind: 'int', required: false, mutable: false }),
  col('groupId', 'source_group_id', {
    kind: 'text',
    mutable: false,
    note: '来源群；部分来源删除时由存储侧结构重绑（决策 4）',
  }),
  col('headline', 'headline', { kind: 'text', mutable: false }),
  col('aiSummary', 'ai_summary', { kind: 'text', mutable: false }),
  col('topic', 'topic', { kind: 'text', mutable: true }),
  col('priority', 'priority', {
    kind: 'text',
    enumValues: PRIORITIES,
    fallback: '中',
    mutable: true,
  }),
  col('todoStatus', 'todo_status', {
    kind: 'text',
    enumValues: TODO_STATUSES,
    fallback: '未处理',
    mutable: true,
  }),
  col('remindState', 'remind_state', {
    kind: 'text',
    enumValues: REMIND_STATES,
    fallback: '不提醒',
    mutable: true,
    note: '计算字段，随每次写入重算（未处理且距 DDL ≤1 天）',
  }),
  // 内部列（决策 4）：部分来源被删后置 1，重算完成前不进入读取结果。
  internalCol('needs_recompute', 'int', { mutable: false }),
  // 内部列（§5.2）：= 全部来源消息中最早的发送时间（排序时间）。
  internalCol('src_time', 'int', { mutable: false }),
]

/** DM-011 人（member_ids / is_me 为存储侧结构绑定；其余派生字段由 MOD-007 重算）。 */
export const DM011_COLUMNS: readonly ColumnSpec[] = [
  col('personId', 'person_id', { kind: 'text', mutable: false }),
  col('memberIds', 'member_ids', { kind: 'json', jsonShape: 'array', mutable: false }),
  col('isMe', 'is_me', { kind: 'bool', mutable: false }),
  col('unknown', 'unknown', { kind: 'bool', mutable: true }),
  col('activity', 'activity', { kind: 'real', mutable: true }),
  col('replyMedianMs', 'reply_median_ms', { kind: 'int', required: false, mutable: true }),
  col('dimensionScores', 'dimension_scores', { kind: 'json', jsonShape: 'object', mutable: true }),
  col('personalityScores', 'personality_scores', {
    kind: 'json',
    jsonShape: 'object',
    mutable: true,
  }),
]

/** DM-012 身份对齐候选映射（可变字段 = 状态 / 确认时间）。 */
export const DM012_COLUMNS: readonly ColumnSpec[] = [
  col('candidateId', 'candidate_id', { kind: 'text', mutable: false }),
  col('sourceContactId', 'source_contact_id', { kind: 'text', mutable: false }),
  col('status', 'status', {
    kind: 'text',
    enumValues: IDENTITY_CANDIDATE_STATUSES,
    fallback: '未确认',
    mutable: true,
  }),
  col('confirmedAt', 'confirmed_at', { kind: 'int', required: false, mutable: true }),
]

/** DM-013 兴趣标签（可变字段 = 标签名 / 一级维度 / 归并组 + 派生热度与事件流）。 */
export const DM013_COLUMNS: readonly ColumnSpec[] = [
  col('tagId', 'tag_id', { kind: 'text', mutable: false }),
  col('name', 'name', { kind: 'text', mutable: true }),
  col('dimension', 'dimension', { kind: 'text', enumValues: DIMENSIONS, mutable: true }),
  col('mergeGroupId', 'merge_group_id', { kind: 'text', required: false, mutable: true }),
  col('firstSeenAt', 'first_seen_at', { kind: 'int', mutable: true }),
  col('eventStream', 'event_stream', { kind: 'json', jsonShape: 'array', mutable: true }),
  col('heatScore', 'heat_score', { kind: 'real', mutable: true }),
]

/** DM-014 人物兴趣标签（记录身份键 = 人物 + 兴趣标签；证据走连接表 `dm014_evidence`）。 */
export const DM014_COLUMNS: readonly ColumnSpec[] = [
  col('personId', 'person_id', { kind: 'text', mutable: false }),
  col('tagId', 'tag_id', { kind: 'text', mutable: false }),
  col('confidence', 'confidence', { kind: 'real', mutable: true }),
  col('origin', 'origin', {
    kind: 'text',
    enumValues: TAG_ORIGINS,
    fallback: '模型抽取',
    mutable: true,
  }),
]

/** DM-015 同义标签归并组（代表标签唯一）。 */
export const DM015_COLUMNS: readonly ColumnSpec[] = [
  col('mergeGroupId', 'merge_group_id', { kind: 'text', mutable: false }),
  col('representativeTagId', 'representative_tag_id', { kind: 'text', mutable: true }),
  col('mergedTagIds', 'merged_tag_ids', { kind: 'json', jsonShape: 'array', mutable: true }),
]

/** DM-016 性格标签（六维闭集；可变字段 = 维度 / 分数 / 状态 / 来源方式）。 */
export const DM016_COLUMNS: readonly ColumnSpec[] = [
  col('tagId', 'tag_id', { kind: 'text', mutable: false }),
  col('personId', 'person_id', { kind: 'text', mutable: false }),
  col('dimension', 'dimension', {
    kind: 'text',
    enumValues: PERSONALITY_DIMENSIONS,
    mutable: true,
  }),
  col('score', 'score', { kind: 'real', mutable: true }),
  col('status', 'status', {
    kind: 'text',
    enumValues: PERSONALITY_TAG_STATUSES,
    fallback: '候选',
    mutable: true,
  }),
  col('origin', 'origin', {
    kind: 'text',
    enumValues: PERSONALITY_TAG_ORIGINS,
    fallback: '模型推断',
    mutable: true,
  }),
]

/** DM-017 消息互动记录（可重算；记录身份键在其中，重放不产生副本）。 */
export const DM017_COLUMNS: readonly ColumnSpec[] = [
  col('interactionId', 'interaction_id', { kind: 'text', mutable: false }),
  col('triggerMessageId', 'trigger_message_id', { kind: 'text', mutable: false }),
  col('triggerMemberId', 'trigger_member_id', { kind: 'text', mutable: false }),
  col('responseMessageId', 'response_message_id', { kind: 'text', mutable: false }),
  col('responseMemberId', 'response_member_id', { kind: 'text', mutable: false }),
  col('kind', 'kind', { kind: 'text', enumValues: INTERACTION_KINDS, mutable: false }),
  col('intervalMs', 'interval_ms', { kind: 'int', mutable: false }),
]

/** DM-018 两人契合度（无序对，规范化为 人A < 人B；可变字段 = 共同爱好 / 契合度 / 逐维度差值）。 */
export const DM018_COLUMNS: readonly ColumnSpec[] = [
  col('pairId', 'pair_id', { kind: 'text', mutable: false }),
  col('personAId', 'person_a_id', { kind: 'text', mutable: false }),
  col('personBId', 'person_b_id', { kind: 'text', mutable: false }),
  col('commonTagIds', 'common_tag_ids', { kind: 'json', jsonShape: 'array', mutable: true }),
  col('fitScore', 'fit_score', { kind: 'real', mutable: true }),
  col('dimensionDiffs', 'dimension_diffs', { kind: 'json', jsonShape: 'object', mutable: true }),
]

/** DM-019 我的社交契合度（单例；身份 = 固定 scope = 'me'）。 */
export const DM019_COLUMNS: readonly ColumnSpec[] = [
  internalCol('scope', 'text', { note: "单例键，恒为 'me'" }),
  col('pairIds', 'pair_ids', { kind: 'json', jsonShape: 'array', mutable: true }),
  col('overallFit', 'overall_fit', { kind: 'real', required: false, mutable: true }),
]

/** DM-020 生成历史（可变字段 = 梗引用（G3 回填）+ 产出引用；产出走连接表与媒体索引）。 */
export const DM020_COLUMNS: readonly ColumnSpec[] = [
  col('generationId', 'generation_id', { kind: 'text', mutable: false }),
  col('kind', 'kind', { kind: 'text', enumValues: GENERATION_KINDS, mutable: false }),
  col('memeId', 'meme_id', { kind: 'text', required: false, mutable: true }),
  col('materialTier', 'material_tier', {
    kind: 'text',
    required: false,
    enumValues: MATERIAL_TIERS,
    mutable: false,
  }),
  col('template', 'template', { kind: 'text', required: false, mutable: false }),
  col('creationMark', 'creation_mark', {
    kind: 'bool',
    fallback: true,
    mutable: false,
    note: '固定标注（REQ-013）：只允许为真',
  }),
  col('generatedAt', 'generated_at', { kind: 'int', mutable: false }),
]

/** DM-021 候选梗单元（可变字段 = 状态 / 入库梗；出处消息走连接表 `dm021_source`）。 */
export const DM021_COLUMNS: readonly ColumnSpec[] = [
  col('candidateId', 'candidate_id', { kind: 'text', mutable: false }),
  col('meaningGuess', 'meaning_guess', { kind: 'text', mutable: false }),
  col('usageExample', 'usage_example', { kind: 'text', mutable: false }),
  col('status', 'status', {
    kind: 'text',
    enumValues: MEME_CANDIDATE_STATUSES,
    fallback: '候选',
    mutable: true,
  }),
  col('memeId', 'meme_id', { kind: 'text', required: false, mutable: true }),
]

/** DM-022 素材合规确认（可变字段 = 确认状态 / 确认时间；涉及成员走连接表 `dm022_member`）。 */
export const DM022_COLUMNS: readonly ColumnSpec[] = [
  col('consentId', 'consent_id', { kind: 'text', mutable: false }),
  col('materialRef', 'material_ref', { kind: 'text', mutable: false }),
  col('status', 'status', {
    kind: 'text',
    enumValues: MATERIAL_CONSENT_STATUSES,
    fallback: '未确认',
    mutable: true,
  }),
  col('confirmedAt', 'confirmed_at', { kind: 'int', required: false, mutable: true }),
]
