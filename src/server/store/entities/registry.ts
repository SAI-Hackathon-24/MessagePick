/**
 * 实体登记表（mod-002 §3.2 / §5.1 / §5.2）：DM-001 ~ DM-022 的
 * 表 / 身份键 / 写模式 / 变异白名单 / 筛选绑定 / 级联归属 / 排序键，集中在本文件。
 *
 * 读取 / 写入 / 删除三条流程各写一次，全部由这张表驱动（决策 2）；
 * 新增字段 / 实体 = 改登记表 + 一次迁移。
 */

import type { EntityType } from '@shared'

import type { ColumnSpec } from './columns'
import { DM001_COLUMNS, DM002_COLUMNS, DM003_COLUMNS, DM004_COLUMNS, DM005_COLUMNS } from './raw'
import {
  DM006_COLUMNS,
  DM007_COLUMNS,
  DM008_COLUMNS,
  DM009_COLUMNS,
  DM010_COLUMNS,
  DM011_COLUMNS,
  DM012_COLUMNS,
  DM013_COLUMNS,
  DM014_COLUMNS,
  DM015_COLUMNS,
  DM016_COLUMNS,
  DM017_COLUMNS,
  DM018_COLUMNS,
  DM019_COLUMNS,
  DM020_COLUMNS,
  DM021_COLUMNS,
  DM022_COLUMNS,
} from './derived'

// ---------------------------------------------------------------------------
// 筛选绑定
// ---------------------------------------------------------------------------

/** 归一化后的筛选条件（`query/filter.ts` 产出；空数组 / null = 该项不限）。 */
export interface NormalizedFilter {
  groups: readonly string[]
  timeRange: { from: number; to: number } | null
  keyword: string | null
  identity: string | null
}

/** 一段参数化 WHERE 片段。 */
export interface SqlFragment {
  sql: string
  params: readonly unknown[]
}

export interface BindingContext {
  /** 表别名。 */
  alias: string
  filter: NormalizedFilter
  /** 关键词 LIKE 模式（已转义并加通配；关键词不限时为 null）。 */
  keywordPattern: string | null
}

/** 单项筛选的列绑定；返回 null = 该条件不施加于本实体。 */
export type Binding = (ctx: BindingContext) => SqlFragment | null

/** 四项筛选的列绑定（§5.2 的「登记表声明筛选绑定」）。 */
export interface FilterBindings {
  group?: Binding
  time?: Binding
  keyword?: Binding
  identity?: Binding
}

const LIKE_ESCAPE = `ESCAPE '\\'`

const groupsJson = (filter: NormalizedFilter): string => JSON.stringify([...filter.groups])

/** 群列直连：`column IN (群多选)`。 */
function directGroup(column: string): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `${alias}.${column} IN (SELECT value FROM json_each(?))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：`column` 指向 `dm006_meme`，由梗的归属群过滤。 */
function groupViaMeme(memeColumn: string): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `${alias}.${memeColumn} IN (SELECT meme_id FROM dm006_meme WHERE group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：`personColumn` 指向 `dm011_person`，由该人的群成员身份过滤。 */
function groupViaPerson(personColumn: string): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm004_member m WHERE m.person_id = ${alias}.${personColumn} AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：标签 → 人物兴趣标签 → 群成员身份。 */
function groupViaTag(): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm014_person_tag pt JOIN dm004_member m ON m.person_id = pt.person_id WHERE pt.tag_id = ${alias}.tag_id AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：归并组 → 代表标签 / 已归入标签 → 人物兴趣标签 → 群成员身份。 */
function groupViaMergeGroup(): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm013_tag t JOIN dm014_person_tag pt ON pt.tag_id = t.tag_id JOIN dm004_member m ON m.person_id = pt.person_id WHERE (t.tag_id = ${alias}.representative_tag_id OR t.merge_group_id = ${alias}.merge_group_id) AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：候选映射 → 涉及群成员。 */
function groupViaCandidateMembers(): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm012_member dm JOIN dm004_member m ON m.member_id = dm.member_id WHERE dm.candidate_id = ${alias}.candidate_id AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：互动记录 → 触发消息的所属群。 */
function groupViaTriggerMessage(): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm003_message m WHERE m.msg_id = ${alias}.trigger_message_id AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：配对双方任一人在该群有成员身份。 */
function groupViaPairPersons(): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm004_member m WHERE m.person_id IN (${alias}.person_a_id, ${alias}.person_b_id) AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：「我」的群成员身份命中选中群。 */
function groupViaMyMembers(): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm011_person p JOIN dm004_member m ON m.person_id = p.person_id WHERE p.is_me = 1 AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：候选梗 → 出处消息的所属群。 */
function groupViaCandidateSources(): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm021_source s JOIN dm003_message m ON m.msg_id = s.msg_id WHERE s.candidate_id = ${alias}.candidate_id AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 经归属链：素材确认 → 涉及群成员。 */
function groupViaConsentMembers(): Binding {
  return ({ alias, filter }) =>
    filter.groups.length === 0
      ? null
      : {
          sql: `EXISTS (SELECT 1 FROM dm022_member dm JOIN dm004_member m ON m.member_id = dm.member_id WHERE dm.consent_id = ${alias}.consent_id AND m.group_id IN (SELECT value FROM json_each(?)))`,
          params: [groupsJson(filter)],
        }
}

/** 时间范围：`column BETWEEN from AND to`（闭区间）。 */
function timeBetween(column: string): Binding {
  return ({ alias, filter }) =>
    filter.timeRange === null
      ? null
      : {
          sql: `${alias}.${column} >= ? AND ${alias}.${column} <= ?`,
          params: [filter.timeRange.from, filter.timeRange.to],
        }
}

/** 关键词：单列 / 多列参数化 LIKE（ASCII 大小写不敏感；转义由 keyword.ts 完成）。 */
function keywordLike(...columns: string[]): Binding {
  return ({ alias, filter, keywordPattern }) => {
    if (filter.keyword === null || keywordPattern === null) return null
    return {
      sql: `(${columns.map((column) => `${alias}.${column} LIKE ? ${LIKE_ESCAPE}`).join(' OR ')})`,
      params: columns.map(() => keywordPattern),
    }
  }
}

/** 关键词（DM-010 口径）：AI 总结 + 来源消息文本。 */
function keywordItem(): Binding {
  return ({ alias, filter, keywordPattern }) => {
    if (filter.keyword === null || keywordPattern === null) return null
    return {
      sql: `(${alias}.ai_summary LIKE ? ${LIKE_ESCAPE} OR EXISTS (SELECT 1 FROM dm010_source s JOIN dm003_message m ON m.msg_id = s.msg_id WHERE s.item_id = ${alias}.item_id AND m.text LIKE ? ${LIKE_ESCAPE}))`,
      params: [keywordPattern, keywordPattern],
    }
  }
}

/** 身份：成员引用直连（`column = 我`）。 */
function identityMemberColumn(column: string, options: { includeMineRelated?: boolean } = {}): Binding {
  return ({ alias, filter }) => {
    if (filter.identity === null) return null
    const mine = options.includeMineRelated === true ? ` OR ${alias}.mine_related = 1` : ''
    return { sql: `(${alias}.${column} = ?${mine})`, params: [filter.identity] }
  }
}

/** 身份：消息口径（发送者为「我」，或提及成员含「我」）。 */
function identityMessage(): Binding {
  return ({ alias, filter }) => {
    if (filter.identity === null) return null
    return {
      sql: `(${alias}.sender_key = ? OR (${alias}.mentioned IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(${alias}.mentioned) je WHERE je.value = ?)))`,
      params: [filter.identity, filter.identity],
    }
  }
}

/** 身份：「我」的人（布尔派生列）。 */
function identityIsMe(): Binding {
  return ({ alias, filter }) => (filter.identity === null ? null : { sql: `${alias}.is_me = 1`, params: [] })
}

/** 身份：经归属链 —— 该行的人包含「我」。 */
function identityViaPerson(personColumn: string): Binding {
  return ({ alias, filter }) => {
    if (filter.identity === null) return null
    return {
      sql: `EXISTS (SELECT 1 FROM dm004_member m WHERE m.person_id = ${alias}.${personColumn} AND m.member_id = ?)`,
      params: [filter.identity],
    }
  }
}

// ---------------------------------------------------------------------------
// 连接表（多对多）
// ---------------------------------------------------------------------------

/** 连接表规格：写入时整批替换、读取时批量装配。 */
export interface LinkSpec {
  table: string
  ownerColumns: readonly string[]
  ownerFields: readonly string[]
  valueColumn: string
  valueField: string
  /** 读取装配时是否按值排序（稳定输出）。 */
  sortValues?: boolean
}

// ---------------------------------------------------------------------------
// 登记表
// ---------------------------------------------------------------------------

/** 写模式：`insert-only` 忽略重复写入；`upsert` 仅覆盖变异白名单。 */
export type WriteMode = 'insert-only' | 'upsert'

/** 每个 DM 一条登记（§3.2）。 */
export interface EntityDescriptor {
  type: EntityType
  table: string
  /** 记录内容由谁给出（仅用于日志与归属标注）。 */
  writer: string
  /** 记录身份键（字段名；去重依据）。 */
  identity: readonly string[]
  /** 记录身份键（列名；与 `identity` 一一对应）。 */
  identityColumns: readonly string[]
  writeMode: WriteMode
  /** 变异白名单（列名；仅 upsert 生效）。 */
  mutableFields: readonly string[]
  columns: readonly ColumnSpec[]
  filterBindings: FilterBindings
  /** 排序键（SQL 片段；附加身份键兜底，保证翻页稳定，不依赖 rowid）。 */
  orderBy: readonly string[]
  /** 读取追加条件（内部列；如 DM-010 的重算窗口）。 */
  readExtra?: string
  /** 连接表（多对多字段的落点）。 */
  links?: readonly LinkSpec[]
  /** 单例实体（DM-019）：整表至多一行。 */
  singleton?: boolean
}

const NO_BINDINGS: FilterBindings = {}

/** 登记表（顺序 = DM-001 ~ DM-022）。 */
export const ENTITY_DESCRIPTORS: readonly EntityDescriptor[] = [
  {
    type: 'DM-001',
    table: 'dm001_source_status',
    writer: 'MOD-001',
    identity: ['source'],
    identityColumns: ['source'],
    writeMode: 'upsert',
    mutableFields: ['status', 'last_success_at', 'failure_reason', 'updated_until_x', 'has_data'],
    columns: DM001_COLUMNS,
    filterBindings: NO_BINDINGS,
    orderBy: ['source ASC'],
  },
  {
    type: 'DM-002',
    table: 'dm002_group',
    writer: 'MOD-001',
    identity: ['groupId'],
    identityColumns: ['group_id'],
    writeMode: 'upsert',
    mutableFields: ['group_name'],
    columns: DM002_COLUMNS,
    filterBindings: { group: directGroup('group_id') },
    orderBy: ['group_id ASC'],
  },
  {
    type: 'DM-003',
    table: 'dm003_message',
    writer: 'MOD-001',
    identity: ['messageId'],
    identityColumns: ['msg_id'],
    writeMode: 'insert-only',
    mutableFields: [],
    columns: DM003_COLUMNS,
    filterBindings: {
      group: directGroup('group_id'),
      time: timeBetween('sent_at'),
      keyword: keywordLike('text'),
      identity: identityMessage(),
    },
    orderBy: ['sent_at DESC', 'msg_id DESC'],
  },
  {
    type: 'DM-004',
    table: 'dm004_member',
    writer: 'MOD-001',
    identity: ['groupId', 'memberId'],
    identityColumns: ['group_id', 'member_id'],
    writeMode: 'upsert',
    mutableFields: ['display_name'],
    columns: DM004_COLUMNS,
    filterBindings: {
      group: directGroup('group_id'),
      keyword: keywordLike('display_name'),
      identity: identityMemberColumn('member_id'),
    },
    orderBy: ['group_id ASC', 'member_id ASC'],
  },
  {
    type: 'DM-005',
    table: 'dm005_contact',
    writer: 'MOD-001',
    identity: ['contactId', 'source'],
    identityColumns: ['contact_id', 'source'],
    writeMode: 'insert-only',
    mutableFields: [],
    columns: DM005_COLUMNS,
    filterBindings: NO_BINDINGS,
    orderBy: ['contact_id ASC', 'source ASC'],
  },
  {
    type: 'DM-006',
    table: 'dm006_meme',
    writer: 'MOD-005',
    identity: ['memeId'],
    identityColumns: ['meme_id'],
    writeMode: 'upsert',
    mutableFields: [
      'name',
      'kind',
      'interpretation',
      'correction',
      'merged_into_id',
      'first_seen_at',
      'first_seen_group_id',
      'last_used_at',
      'elapsed',
      'occurrence_count',
      'week_over_week',
      'heat',
      'monthly_counts',
      'lifecycle',
      'meme_king',
    ],
    columns: DM006_COLUMNS,
    filterBindings: {
      group: directGroup('group_id'),
      // 时间条件在 DM-006 上不施加：时间窗口径由 DM-007 的读取承担（mod-005 §4）。
      keyword: keywordLike('name', 'interpretation'),
    },
    orderBy: ['last_used_at DESC', 'meme_id DESC'],
  },
  {
    type: 'DM-007',
    table: 'dm007_occurrence',
    writer: 'MOD-005',
    identity: ['occurrenceId'],
    identityColumns: ['occurrence_id'],
    writeMode: 'insert-only',
    mutableFields: [],
    columns: DM007_COLUMNS,
    filterBindings: {
      group: groupViaMeme('meme_id'),
      time: timeBetween('src_time'),
      identity: identityMemberColumn('speaker_member_id', { includeMineRelated: true }),
    },
    orderBy: ['src_time DESC', 'occurrence_id DESC'],
  },
  {
    type: 'DM-008',
    table: 'dm008_variant_link',
    writer: 'MOD-005',
    identity: ['sourceMemeId', 'derivedMemeId'],
    identityColumns: ['source_meme_id', 'derived_meme_id'],
    writeMode: 'upsert',
    mutableFields: ['status'],
    columns: DM008_COLUMNS,
    filterBindings: { group: groupViaMeme('source_meme_id') },
    orderBy: ['source_meme_id ASC', 'derived_meme_id ASC'],
  },
  {
    type: 'DM-009',
    table: 'dm009_highlight',
    writer: 'MOD-005',
    identity: ['memeId', 'sourceMessageId'],
    identityColumns: ['meme_id', 'source_message_id'],
    writeMode: 'upsert',
    mutableFields: ['display_order'],
    columns: DM009_COLUMNS,
    filterBindings: { group: groupViaMeme('meme_id') },
    orderBy: ['meme_id ASC', 'display_order ASC', 'source_message_id ASC'],
  },
  {
    type: 'DM-010',
    table: 'dm010_item',
    writer: 'MOD-006',
    identity: ['entryId'],
    identityColumns: ['item_id'],
    writeMode: 'upsert',
    mutableFields: ['topic', 'priority', 'todo_status', 'remind_state'],
    columns: DM010_COLUMNS,
    filterBindings: {
      group: directGroup('source_group_id'),
      time: timeBetween('src_time'),
      keyword: keywordItem(),
    },
    orderBy: ['src_time DESC', 'item_id DESC'],
    readExtra: 'needs_recompute = 0',
    links: [
      {
        table: 'dm010_source',
        ownerColumns: ['item_id'],
        ownerFields: ['entryId'],
        valueColumn: 'msg_id',
        valueField: 'sourceMessageIds',
      },
    ],
  },
  {
    type: 'DM-011',
    table: 'dm011_person',
    writer: 'MOD-007',
    identity: ['personId'],
    identityColumns: ['person_id'],
    writeMode: 'upsert',
    mutableFields: ['unknown', 'activity', 'reply_median_ms', 'dimension_scores', 'personality_scores'],
    columns: DM011_COLUMNS,
    filterBindings: {
      group: groupViaPerson('person_id'),
      identity: identityIsMe(),
    },
    orderBy: ['person_id ASC'],
  },
  {
    type: 'DM-012',
    table: 'dm012_candidate',
    writer: 'MOD-007',
    identity: ['candidateId'],
    identityColumns: ['candidate_id'],
    writeMode: 'upsert',
    mutableFields: ['status', 'confirmed_at'],
    columns: DM012_COLUMNS,
    filterBindings: { group: groupViaCandidateMembers() },
    orderBy: ['candidate_id ASC'],
    links: [
      {
        table: 'dm012_member',
        ownerColumns: ['candidate_id'],
        ownerFields: ['candidateId'],
        valueColumn: 'member_id',
        valueField: 'memberIds',
      },
    ],
  },
  {
    type: 'DM-013',
    table: 'dm013_tag',
    writer: 'MOD-007',
    identity: ['tagId'],
    identityColumns: ['tag_id'],
    writeMode: 'upsert',
    mutableFields: ['name', 'dimension', 'merge_group_id', 'first_seen_at', 'event_stream', 'heat_score'],
    columns: DM013_COLUMNS,
    filterBindings: {
      group: groupViaTag(),
      keyword: keywordLike('name'),
    },
    orderBy: ['tag_id ASC'],
  },
  {
    type: 'DM-014',
    table: 'dm014_person_tag',
    writer: 'MOD-007',
    identity: ['personId', 'tagId'],
    identityColumns: ['person_id', 'tag_id'],
    writeMode: 'upsert',
    mutableFields: ['confidence', 'origin'],
    columns: DM014_COLUMNS,
    filterBindings: {
      group: groupViaPerson('person_id'),
      identity: identityViaPerson('person_id'),
    },
    orderBy: ['person_id ASC', 'tag_id ASC'],
    links: [
      {
        table: 'dm014_evidence',
        ownerColumns: ['person_id', 'tag_id'],
        ownerFields: ['personId', 'tagId'],
        valueColumn: 'msg_id',
        valueField: 'evidenceMessageIds',
      },
    ],
  },
  {
    type: 'DM-015',
    table: 'dm015_tag_merge',
    writer: 'MOD-007',
    identity: ['mergeGroupId'],
    identityColumns: ['merge_group_id'],
    writeMode: 'upsert',
    mutableFields: ['representative_tag_id', 'merged_tag_ids'],
    columns: DM015_COLUMNS,
    filterBindings: { group: groupViaMergeGroup() },
    orderBy: ['merge_group_id ASC'],
  },
  {
    type: 'DM-016',
    table: 'dm016_personality_tag',
    writer: 'MOD-007',
    identity: ['tagId'],
    identityColumns: ['tag_id'],
    writeMode: 'upsert',
    mutableFields: ['dimension', 'score', 'status', 'origin'],
    columns: DM016_COLUMNS,
    filterBindings: { group: groupViaPerson('person_id') },
    orderBy: ['person_id ASC', 'tag_id ASC'],
  },
  {
    type: 'DM-017',
    table: 'dm017_interaction',
    writer: 'MOD-007',
    identity: ['interactionId'],
    identityColumns: ['interaction_id'],
    writeMode: 'insert-only',
    mutableFields: [],
    columns: DM017_COLUMNS,
    filterBindings: { group: groupViaTriggerMessage() },
    orderBy: ['interaction_id ASC'],
  },
  {
    type: 'DM-018',
    table: 'dm018_pair_score',
    writer: 'MOD-007',
    identity: ['pairId'],
    identityColumns: ['pair_id'],
    writeMode: 'upsert',
    mutableFields: ['common_tag_ids', 'fit_score', 'dimension_diffs'],
    columns: DM018_COLUMNS,
    filterBindings: { group: groupViaPairPersons() },
    orderBy: ['pair_id ASC'],
  },
  {
    type: 'DM-019',
    table: 'dm019_my_fit',
    writer: 'MOD-007',
    identity: ['scope'],
    identityColumns: ['scope'],
    writeMode: 'upsert',
    mutableFields: ['pair_ids', 'overall_fit'],
    columns: DM019_COLUMNS,
    filterBindings: { group: groupViaMyMembers() },
    orderBy: ['scope ASC'],
    singleton: true,
  },
  {
    type: 'DM-020',
    table: 'dm020_generation',
    writer: 'MOD-008',
    identity: ['generationId'],
    identityColumns: ['generation_id'],
    writeMode: 'upsert',
    mutableFields: ['meme_id'],
    columns: DM020_COLUMNS,
    filterBindings: {
      // 群经梗归属链；G3 未回填梗时的候选出处链由写入侧的结构引用补齐（见 index.ts 的 DM-020 钩子）。
      group: groupViaMeme('meme_id'),
      time: timeBetween('generated_at'),
    },
    orderBy: ['generated_at DESC', 'generation_id DESC'],
    links: [
      {
        table: 'dm020_output',
        ownerColumns: ['generation_id'],
        ownerFields: ['generationId'],
        valueColumn: 'ref',
        valueField: 'outputRefs',
      },
    ],
  },
  {
    type: 'DM-021',
    table: 'dm021_candidate',
    writer: 'MOD-008',
    identity: ['candidateId'],
    identityColumns: ['candidate_id'],
    writeMode: 'upsert',
    mutableFields: ['status', 'meme_id'],
    columns: DM021_COLUMNS,
    filterBindings: { group: groupViaCandidateSources() },
    orderBy: ['candidate_id ASC'],
    links: [
      {
        table: 'dm021_source',
        ownerColumns: ['candidate_id'],
        ownerFields: ['candidateId'],
        valueColumn: 'msg_id',
        valueField: 'sourceMessageIds',
      },
    ],
  },
  {
    type: 'DM-022',
    table: 'dm022_material_consent',
    writer: 'MOD-008',
    identity: ['consentId'],
    identityColumns: ['consent_id'],
    writeMode: 'upsert',
    mutableFields: ['status', 'confirmed_at'],
    columns: DM022_COLUMNS,
    filterBindings: { group: groupViaConsentMembers() },
    orderBy: ['consent_id ASC'],
    links: [
      {
        table: 'dm022_member',
        ownerColumns: ['consent_id'],
        ownerFields: ['consentId'],
        valueColumn: 'member_id',
        valueField: 'memberIds',
      },
    ],
  },
]

const DESCRIPTOR_BY_TYPE = new Map<EntityType, EntityDescriptor>(
  ENTITY_DESCRIPTORS.map((descriptor) => [descriptor.type, descriptor]),
)

/** 按实体类型取登记（未知类型返回 undefined；调用方转 `INVALID_INPUT`）。 */
export function findEntityDescriptor(type: string): EntityDescriptor | undefined {
  return DESCRIPTOR_BY_TYPE.get(type as EntityType)
}

/** 按实体类型取登记（要求存在；仅内部已知类型调用）。 */
export function getEntityDescriptor(type: EntityType): EntityDescriptor {
  const descriptor = DESCRIPTOR_BY_TYPE.get(type)
  if (descriptor === undefined) {
    throw new Error(`未登记的实体类型：${type}`)
  }
  return descriptor
}
