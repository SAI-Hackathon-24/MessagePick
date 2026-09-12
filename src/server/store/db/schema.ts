/**
 * 全库 DDL（与 `SCHEMA_VERSION = 1` 对应；mod-002 §5.6）。
 *
 * 口径（mod-002 §5.2 / §5.6）：
 * - 全表 `STRICT`；时间统一 UTC epoch 毫秒（INTEGER）；枚举列按文档原文做 `CHECK` 闭集；
 * - 媒体引用只存应用数据目录内的相对路径（写入侧由 `media/` 做路径护栏）；
 * - 多对多一律拆连接表（`dm010_source` / `dm014_evidence` / `dm021_source` / `dm020_output`）；
 * - 内部列不属于任何 `DM-###`：`src_time`（时间筛选冗余）、`needs_recompute`（决策 4）。
 *
 * 外键删除动作（§5.3 的删除图依赖它兜底，执行侧仍显式按依赖序删除并计数）：
 * - 群 → 消息 / 成员 / 梗 / 条目：CASCADE；
 * - 消息 / 梗 / 人 / 标签 的引用行：CASCADE；消息自引用（引用消息）：SET NULL；
 * - 成员 → 人：RESTRICT（人只在不再被任何成员引用时由结构整理删除）。
 */

import {
  CONTACT_SOURCES,
  DIMENSIONS,
  GENERATION_KINDS,
  IDENTITY_CANDIDATE_STATUSES,
  INGEST_SOURCES,
  INGEST_SOURCE_STATUSES,
  INTERACTION_KINDS,
  MATERIAL_CONSENT_STATUSES,
  MATERIAL_TIERS,
  MEME_CANDIDATE_STATUSES,
  MEME_CORRECTIONS,
  MEME_HEATS,
  MEME_KINDS,
  MESSAGE_KINDS,
  PERSONALITY_DIMENSIONS,
  PERSONALITY_TAG_ORIGINS,
  PERSONALITY_TAG_STATUSES,
  PRIORITIES,
  REMIND_STATES,
  TAG_ORIGINS,
  TODO_STATUSES,
  VARIANT_LINK_STATUSES,
} from '@shared'

import { DATA_EPOCH_KEY, SCHEMA_WATERMARK_KEY } from '../meta/epoch'

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`

const inCheck = (column: string, values: readonly string[]): string =>
  `CHECK (${column} IN (${values.map(quote).join(', ')}))`

const nullableJsonCheck = (column: string): string =>
  `CHECK (${column} IS NULL OR json_valid(${column}))`

const jsonCheck = (column: string): string => `CHECK (json_valid(${column}))`

/** 版本 1 的全量结构（表、约束、索引、内部表）。 */
export const SCHEMA_SQL = `
-- ===========================================================================
-- DM-001 ~ DM-005（MOD-002 与采集侧的事实）
-- ===========================================================================

CREATE TABLE dm001_source_status (
  source          TEXT PRIMARY KEY ${inCheck('source', INGEST_SOURCES)},
  status          TEXT NOT NULL ${inCheck('status', INGEST_SOURCE_STATUSES)},
  last_success_at INTEGER,
  failure_reason  TEXT,
  updated_until_x INTEGER,
  has_data        INTEGER NOT NULL DEFAULT 0 CHECK (has_data IN (0, 1))
) STRICT;

CREATE TABLE dm002_group (
  group_id   TEXT PRIMARY KEY,
  group_name TEXT NOT NULL
) STRICT;

CREATE TABLE dm011_person (
  person_id          TEXT PRIMARY KEY,
  member_ids         TEXT NOT NULL ${jsonCheck('member_ids')},
  is_me              INTEGER NOT NULL DEFAULT 0 CHECK (is_me IN (0, 1)),
  unknown            INTEGER NOT NULL DEFAULT 0 CHECK (unknown IN (0, 1)),
  activity           REAL NOT NULL DEFAULT 0,
  reply_median_ms    INTEGER,
  dimension_scores   TEXT NOT NULL ${jsonCheck('dimension_scores')},
  personality_scores TEXT NOT NULL ${jsonCheck('personality_scores')}
) STRICT;

-- 全库至多一条「我」（DM-004 的约束，AC-016）
CREATE UNIQUE INDEX idx_dm011_me ON dm011_person (is_me) WHERE is_me = 1;

CREATE TABLE dm004_member (
  member_id    TEXT NOT NULL,
  group_id     TEXT NOT NULL REFERENCES dm002_group (group_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  is_me        INTEGER NOT NULL DEFAULT 0 CHECK (is_me IN (0, 1)),
  person_id    TEXT NOT NULL REFERENCES dm011_person (person_id) ON DELETE RESTRICT,
  PRIMARY KEY (group_id, member_id)
) STRICT;

-- 全库至多一条「我」的群成员（DM-004 的部分唯一索引）
CREATE UNIQUE INDEX idx_dm004_me ON dm004_member (is_me) WHERE is_me = 1;

CREATE TABLE dm003_message (
  msg_id       TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES dm002_group (group_id) ON DELETE CASCADE,
  sender_key   TEXT NOT NULL,
  sent_at      INTEGER NOT NULL,
  msg_type     TEXT NOT NULL ${inCheck('msg_type', MESSAGE_KINDS)},
  text         TEXT,
  media_ref    TEXT,
  mentioned    TEXT ${nullableJsonCheck('mentioned')},
  quote_msg_id TEXT REFERENCES dm003_message (msg_id) ON DELETE SET NULL,
  FOREIGN KEY (group_id, sender_key) REFERENCES dm004_member (group_id, member_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_dm003_group_sent ON dm003_message (group_id, sent_at);
CREATE INDEX idx_dm003_sender ON dm003_message (sender_key);

CREATE TABLE dm005_contact (
  contact_id   TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source       TEXT NOT NULL ${inCheck('source', CONTACT_SOURCES)},
  PRIMARY KEY (contact_id, source)
) STRICT;

-- ===========================================================================
-- DM-006 ~ DM-009（MOD-005 派生结果）
-- ===========================================================================

CREATE TABLE dm006_meme (
  meme_id             TEXT PRIMARY KEY,
  group_id            TEXT NOT NULL REFERENCES dm002_group (group_id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL ${inCheck('kind', MEME_KINDS)},
  interpretation      TEXT NOT NULL,
  correction          TEXT NOT NULL DEFAULT '无' ${inCheck('correction', MEME_CORRECTIONS)},
  merged_into_id      TEXT REFERENCES dm006_meme (meme_id) ON DELETE SET NULL,
  source_candidate_id TEXT REFERENCES dm021_candidate (candidate_id) ON DELETE SET NULL,
  first_seen_at       INTEGER NOT NULL,
  first_seen_group_id TEXT NOT NULL REFERENCES dm002_group (group_id) ON DELETE CASCADE,
  last_used_at        INTEGER NOT NULL,
  elapsed             INTEGER NOT NULL,
  occurrence_count    INTEGER NOT NULL DEFAULT 0,
  week_over_week      REAL NOT NULL,
  heat                TEXT NOT NULL ${inCheck('heat', MEME_HEATS)},
  monthly_counts      TEXT NOT NULL ${jsonCheck('monthly_counts')},
  lifecycle           TEXT NOT NULL ${jsonCheck('lifecycle')},
  meme_king           TEXT NOT NULL ${jsonCheck('meme_king')}
) STRICT;

CREATE INDEX idx_dm006_group ON dm006_meme (group_id);

CREATE TABLE dm007_occurrence (
  occurrence_id     TEXT PRIMARY KEY,
  meme_id           TEXT NOT NULL REFERENCES dm006_meme (meme_id) ON DELETE CASCADE,
  source_message_id TEXT NOT NULL REFERENCES dm003_message (msg_id) ON DELETE CASCADE,
  occurred_at       INTEGER NOT NULL,
  speaker_member_id TEXT NOT NULL,
  mine_related      INTEGER NOT NULL DEFAULT 0 CHECK (mine_related IN (0, 1)),
  src_time          INTEGER
) STRICT;

CREATE INDEX idx_dm007_meme ON dm007_occurrence (meme_id);
CREATE INDEX idx_dm007_msg ON dm007_occurrence (source_message_id);

CREATE TABLE dm008_variant_link (
  source_meme_id  TEXT NOT NULL REFERENCES dm006_meme (meme_id) ON DELETE CASCADE,
  derived_meme_id TEXT NOT NULL REFERENCES dm006_meme (meme_id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT '生效' ${inCheck('status', VARIANT_LINK_STATUSES)},
  PRIMARY KEY (source_meme_id, derived_meme_id)
) STRICT;

CREATE TABLE dm009_highlight (
  meme_id           TEXT NOT NULL REFERENCES dm006_meme (meme_id) ON DELETE CASCADE,
  source_message_id TEXT NOT NULL REFERENCES dm003_message (msg_id) ON DELETE CASCADE,
  display_order     INTEGER NOT NULL,
  PRIMARY KEY (meme_id, source_message_id)
) STRICT;

-- ===========================================================================
-- DM-010（MOD-006 派生结果）
-- ===========================================================================

CREATE TABLE dm010_item (
  item_id           TEXT PRIMARY KEY,
  recognition_type  TEXT NOT NULL,
  time_element      INTEGER,
  location_element  TEXT,
  person_element    TEXT ${nullableJsonCheck('person_element')},
  subject_element   TEXT,
  deadline          INTEGER,
  source_group_id   TEXT NOT NULL,
  headline          TEXT NOT NULL,
  ai_summary        TEXT NOT NULL,
  topic             TEXT NOT NULL,
  priority          TEXT NOT NULL DEFAULT '中' ${inCheck('priority', PRIORITIES)},
  todo_status       TEXT NOT NULL DEFAULT '未处理' ${inCheck('todo_status', TODO_STATUSES)},
  remind_state      TEXT NOT NULL DEFAULT '不提醒' ${inCheck('remind_state', REMIND_STATES)},
  src_time          INTEGER,
  needs_recompute   INTEGER NOT NULL DEFAULT 0 CHECK (needs_recompute IN (0, 1))
) STRICT;

CREATE INDEX idx_dm010_group ON dm010_item (source_group_id);

CREATE TABLE dm010_source (
  item_id TEXT NOT NULL REFERENCES dm010_item (item_id) ON DELETE CASCADE,
  msg_id  TEXT NOT NULL REFERENCES dm003_message (msg_id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, msg_id)
) STRICT;

CREATE INDEX idx_dm010_source_msg ON dm010_source (msg_id);

-- ===========================================================================
-- DM-012 ~ DM-019（MOD-007 派生结果）
-- ===========================================================================

CREATE TABLE dm012_candidate (
  candidate_id      TEXT PRIMARY KEY,
  source_contact_id TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT '未确认' ${inCheck('status', IDENTITY_CANDIDATE_STATUSES)},
  confirmed_at      INTEGER
) STRICT;

CREATE TABLE dm012_member (
  candidate_id TEXT NOT NULL REFERENCES dm012_candidate (candidate_id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL,
  PRIMARY KEY (candidate_id, member_id)
) STRICT;

CREATE INDEX idx_dm012_member ON dm012_member (member_id);

CREATE TABLE dm015_tag_merge (
  merge_group_id        TEXT PRIMARY KEY,
  representative_tag_id TEXT NOT NULL REFERENCES dm013_tag (tag_id) ON DELETE CASCADE,
  merged_tag_ids        TEXT NOT NULL ${jsonCheck('merged_tag_ids')}
) STRICT;

CREATE UNIQUE INDEX idx_dm015_rep ON dm015_tag_merge (representative_tag_id);

CREATE TABLE dm013_tag (
  tag_id         TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  dimension      TEXT NOT NULL ${inCheck('dimension', DIMENSIONS)},
  merge_group_id TEXT REFERENCES dm015_tag_merge (merge_group_id) ON DELETE SET NULL,
  first_seen_at  INTEGER NOT NULL,
  event_stream   TEXT NOT NULL ${jsonCheck('event_stream')},
  heat_score     REAL NOT NULL
) STRICT;

CREATE TABLE dm014_person_tag (
  person_id  TEXT NOT NULL REFERENCES dm011_person (person_id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES dm013_tag (tag_id) ON DELETE CASCADE,
  confidence REAL NOT NULL,
  origin     TEXT NOT NULL DEFAULT '模型抽取' ${inCheck('origin', TAG_ORIGINS)},
  PRIMARY KEY (person_id, tag_id)
) STRICT;

CREATE INDEX idx_dm014_person ON dm014_person_tag (person_id);
CREATE INDEX idx_dm014_tag ON dm014_person_tag (tag_id);

CREATE TABLE dm014_evidence (
  person_id TEXT NOT NULL,
  tag_id    TEXT NOT NULL,
  msg_id    TEXT NOT NULL REFERENCES dm003_message (msg_id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, tag_id, msg_id),
  FOREIGN KEY (person_id, tag_id) REFERENCES dm014_person_tag (person_id, tag_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE dm016_personality_tag (
  tag_id    TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES dm011_person (person_id) ON DELETE CASCADE,
  dimension TEXT NOT NULL ${inCheck('dimension', PERSONALITY_DIMENSIONS)},
  score     REAL NOT NULL,
  status    TEXT NOT NULL DEFAULT '候选' ${inCheck('status', PERSONALITY_TAG_STATUSES)},
  origin    TEXT NOT NULL DEFAULT '模型推断' ${inCheck('origin', PERSONALITY_TAG_ORIGINS)}
) STRICT;

CREATE INDEX idx_dm016_person ON dm016_personality_tag (person_id);

CREATE TABLE dm017_interaction (
  interaction_id      TEXT PRIMARY KEY,
  trigger_message_id  TEXT NOT NULL REFERENCES dm003_message (msg_id) ON DELETE CASCADE,
  trigger_member_id   TEXT NOT NULL,
  response_message_id TEXT NOT NULL REFERENCES dm003_message (msg_id) ON DELETE CASCADE,
  response_member_id  TEXT NOT NULL,
  kind                TEXT NOT NULL ${inCheck('kind', INTERACTION_KINDS)},
  interval_ms         INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_dm017_trigger ON dm017_interaction (trigger_message_id);
CREATE INDEX idx_dm017_response ON dm017_interaction (response_message_id);

CREATE TABLE dm018_pair_score (
  pair_id         TEXT PRIMARY KEY,
  person_a_id     TEXT NOT NULL REFERENCES dm011_person (person_id) ON DELETE CASCADE,
  person_b_id     TEXT NOT NULL REFERENCES dm011_person (person_id) ON DELETE CASCADE,
  common_tag_ids  TEXT NOT NULL ${jsonCheck('common_tag_ids')},
  fit_score       REAL NOT NULL,
  dimension_diffs TEXT NOT NULL ${jsonCheck('dimension_diffs')},
  CHECK (person_a_id < person_b_id)
) STRICT;

CREATE INDEX idx_dm018_a ON dm018_pair_score (person_a_id);
CREATE INDEX idx_dm018_b ON dm018_pair_score (person_b_id);

CREATE TABLE dm019_my_fit (
  scope       TEXT PRIMARY KEY DEFAULT 'me' CHECK (scope = 'me'),
  pair_ids    TEXT NOT NULL ${jsonCheck('pair_ids')},
  overall_fit REAL
) STRICT;

-- ===========================================================================
-- DM-020 ~ DM-022（MOD-008 派生结果）
-- ===========================================================================

CREATE TABLE dm020_generation (
  generation_id TEXT PRIMARY KEY,
  kind          TEXT NOT NULL ${inCheck('kind', GENERATION_KINDS)},
  meme_id       TEXT REFERENCES dm006_meme (meme_id) ON DELETE CASCADE,
  material_tier TEXT ${inCheck('material_tier', MATERIAL_TIERS)},
  template      TEXT,
  creation_mark INTEGER NOT NULL DEFAULT 1 CHECK (creation_mark = 1),
  generated_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_dm020_meme ON dm020_generation (meme_id);

CREATE TABLE dm020_output (
  generation_id TEXT NOT NULL REFERENCES dm020_generation (generation_id) ON DELETE CASCADE,
  ref           TEXT NOT NULL,
  PRIMARY KEY (generation_id, ref)
) STRICT;

-- 生成记录 → 素材合规确认的结构性引用（DM-020 N:1 DM-022；
-- 记录的「产物引用」以 consent:<确认标识> 形式携带该引用，由存储侧登记）。
CREATE TABLE dm020_consent (
  generation_id TEXT NOT NULL REFERENCES dm020_generation (generation_id) ON DELETE CASCADE,
  consent_id    TEXT NOT NULL REFERENCES dm022_material_consent (consent_id) ON DELETE CASCADE,
  PRIMARY KEY (generation_id, consent_id)
) STRICT;

CREATE TABLE dm021_candidate (
  candidate_id  TEXT PRIMARY KEY,
  meaning_guess TEXT NOT NULL,
  usage_example TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT '候选' ${inCheck('status', MEME_CANDIDATE_STATUSES)},
  meme_id       TEXT REFERENCES dm006_meme (meme_id) ON DELETE SET NULL
) STRICT;

CREATE TABLE dm021_source (
  candidate_id TEXT NOT NULL REFERENCES dm021_candidate (candidate_id) ON DELETE CASCADE,
  msg_id       TEXT NOT NULL REFERENCES dm003_message (msg_id) ON DELETE CASCADE,
  PRIMARY KEY (candidate_id, msg_id)
) STRICT;

CREATE INDEX idx_dm021_source_msg ON dm021_source (msg_id);

CREATE TABLE dm022_material_consent (
  consent_id   TEXT PRIMARY KEY,
  material_ref TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT '未确认' ${inCheck('status', MATERIAL_CONSENT_STATUSES)},
  confirmed_at INTEGER
) STRICT;

CREATE TABLE dm022_member (
  consent_id TEXT NOT NULL REFERENCES dm022_material_consent (consent_id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL,
  PRIMARY KEY (consent_id, member_id)
) STRICT;

CREATE INDEX idx_dm022_member ON dm022_member (member_id);

-- ===========================================================================
-- 内部表（不属于任何 DM-###）
-- ===========================================================================

CREATE TABLE _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

-- 媒体 / 产物索引：库内相对路径 + 归属引用（删除后按索引清理文件）
CREATE TABLE _media_index (
  path        TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('media', 'artifact')),
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL
) STRICT;

CREATE INDEX idx_media_index_owner ON _media_index (entity_type, entity_id);

-- 待清理清单：提交后清理失败 / 中断的条目（下次启动或再次调用续做）
CREATE TABLE _pending_cleanup (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('media', 'log', 'backup')),
  path       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO _meta (key, value) VALUES (${quote(DATA_EPOCH_KEY)}, '0'), (${quote(SCHEMA_WATERMARK_KEY)}, '1');
`

/** 全部实体表与内部表（删除 / 统计用；顺序 = DM-001 ~ DM-022）。 */
export const PRIMARY_TABLES = [
  'dm001_source_status',
  'dm002_group',
  'dm003_message',
  'dm004_member',
  'dm005_contact',
  'dm006_meme',
  'dm007_occurrence',
  'dm008_variant_link',
  'dm009_highlight',
  'dm010_item',
  'dm011_person',
  'dm012_candidate',
  'dm013_tag',
  'dm014_person_tag',
  'dm015_tag_merge',
  'dm016_personality_tag',
  'dm017_interaction',
  'dm018_pair_score',
  'dm019_my_fit',
  'dm020_generation',
  'dm021_candidate',
  'dm022_material_consent',
] as const
