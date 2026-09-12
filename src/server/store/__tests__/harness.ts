/**
 * MOD-002 测试支撑（mod-002 §7.3）：
 *
 * - 一律使用临时目录下的临时库文件（`mkdtemp`），不碰真实应用数据目录；
 * - 可注入点按 §7.3：时钟、文件清理器（构造清理失败 / 中断）、备份器（构造备份失败）、迁移链；
 * - `inspect` = 直连校验连接：只做断言（行数、孤儿引用），不经被测门面；
 * - 记录工厂给最小合法记录（字段约束照 `src/shared/entities.ts` 与登记表）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'

import {
  type EntityRecord,
  type IngestSource,
  type MessageKind,
} from '@shared'

import { isStoreError } from '../errors'
import { createStore, type Store, type StoreOptions } from '../index'

/** 固定时钟（确定性测试；删除清理的 `created_at` 等取此值）。 */
export const CLOCK = 1_700_000_000_000

/** 一个测试用 store 及其旁路断言通道。 */
export interface TestStore {
  store: Store
  dataDir: string
  dbPath: string
  /** 直连校验连接（断言用；不执行写入）。 */
  inspect: Database.Database
}

/** 临时 store 工厂：同一 harness 内的 store 在 `dispose()` 时统一关闭并删除临时目录。 */
export class StoreHarness {
  readonly #created: Array<TestStore & { dir: string }> = []

  /** 建一个临时目录 + 临时库（默认关闭主线程断言与启动自动续清，保证测试确定性）。 */
  create(options: Partial<StoreOptions> = {}): TestStore {
    const dir = mkdtempSync(join(tmpdir(), 'messagepick-store-'))
    const dbPath = options.dbPath ?? join(dir, 'app.db')
    const store = createStore({
      dataDir: dir,
      dbPath,
      clock: () => CLOCK,
      requireMainThread: false,
      autoResumeCleanup: false,
      ...options,
    })
    const inspect = new Database(dbPath)
    const created = { store, dataDir: dir, dbPath, inspect, dir }
    this.#created.push(created)
    return created
  }

  /** 关闭全部 store 与校验连接、删除临时目录。 */
  dispose(): void {
    for (const created of this.#created.splice(0)) {
      created.inspect.close()
      created.store.close()
      rmSync(created.dir, { recursive: true, force: true })
    }
  }
}

/** 断言调用抛出 `StoreError` 并返回其错误标识（同步）。 */
export function storeErrorCode(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (isStoreError(error)) return error.envelope.code
    throw error
  }
  throw new Error('期望抛出 StoreError，但调用未抛错')
}

/** 断言调用抛出 `StoreError` 并返回其错误标识（异步）。 */
export async function storeErrorCodeAsync(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    if (isStoreError(error)) return error.envelope.code
    throw error
  }
  throw new Error('期望抛出 StoreError，但调用未抛错')
}

/** 表行数（校验连接直读）。 */
export function tableCount(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
  return row.count
}

// ---------------------------------------------------------------------------
// 记录工厂（最小合法记录；字段口径见 src/shared/entities.ts）
// ---------------------------------------------------------------------------

export function groupRecord(groupId: string, groupName = `群-${groupId}`): EntityRecord<'DM-002'> {
  return { groupId, groupName }
}

export function sourceStatusRecord(
  source: IngestSource,
  overrides: Partial<EntityRecord<'DM-001'>> = {},
): EntityRecord<'DM-001'> {
  return {
    source,
    status: '成功',
    lastSuccessAt: CLOCK,
    failureReason: null,
    updatedUntilX: CLOCK,
    hasData: true,
    ...overrides,
  }
}

export function memberRecord(
  groupId: string,
  memberId: string,
  options: { isMe?: boolean; personId?: string; displayName?: string } = {},
): EntityRecord<'DM-004'> {
  return {
    memberId,
    groupId,
    displayName: options.displayName ?? `成员-${memberId}`,
    isMe: options.isMe ?? false,
    personId: options.personId ?? `person-${groupId}-${memberId}`,
  }
}

export function messageRecord(
  groupId: string,
  messageId: string,
  options: {
    senderMemberId: string
    sentAt?: number
    kind?: MessageKind
    text?: string | null
    mediaRef?: string | null
    mentionedMemberIds?: string[] | null
    quotedMessageId?: string | null
  },
): EntityRecord<'DM-003'> {
  return {
    messageId,
    groupId,
    senderMemberId: options.senderMemberId,
    sentAt: options.sentAt ?? CLOCK,
    kind: options.kind ?? '文字',
    text: options.text ?? null,
    mediaRef: options.mediaRef ?? null,
    mentionedMemberIds: options.mentionedMemberIds ?? null,
    quotedMessageId: options.quotedMessageId ?? null,
  }
}

export function memeRecord(
  groupId: string,
  memeId: string,
  overrides: Partial<EntityRecord<'DM-006'>> = {},
): EntityRecord<'DM-006'> {
  return {
    memeId,
    groupId,
    name: `梗-${memeId}`,
    kind: '内部梗',
    interpretation: `解读-${memeId}`,
    correction: '无',
    mergedIntoId: null,
    sourceCandidateId: null,
    firstSeenAt: CLOCK,
    firstSeenGroupId: groupId,
    lastUsedAt: CLOCK,
    elapsed: 0,
    occurrenceCount: 0,
    weekOverWeek: 0,
    heat: '活跃',
    monthlyCounts: {},
    lifecycle: { firstSeenAt: CLOCK, peakMonth: '2026-01', silentAt: CLOCK, activeDays: 1 },
    memeKing: [],
    ...overrides,
  }
}

export function occurrenceRecord(
  occurrenceId: string,
  memeId: string,
  sourceMessageId: string,
  options: { occurredAt?: number; speakerMemberId?: string; mineRelated?: boolean } = {},
): EntityRecord<'DM-007'> {
  return {
    occurrenceId,
    memeId,
    sourceMessageId,
    occurredAt: options.occurredAt ?? CLOCK,
    speakerMemberId: options.speakerMemberId ?? 'me',
    mineRelated: options.mineRelated ?? false,
  }
}

export function itemRecord(
  groupId: string,
  entryId: string,
  sourceMessageIds: string[],
  overrides: Partial<EntityRecord<'DM-010'>> = {},
): EntityRecord<'DM-010'> {
  return {
    entryId,
    recognitionType: '活动通知',
    timeElement: null,
    locationElement: null,
    personElementMemberIds: null,
    subjectElement: null,
    deadline: null,
    groupId,
    sourceMessageIds,
    headline: `标题-${entryId}`,
    aiSummary: `总结-${entryId}`,
    topic: '话题',
    priority: '中',
    todoStatus: '未处理',
    remindState: '不提醒',
    ...overrides,
  }
}

export function tagRecord(
  tagId: string,
  overrides: Partial<EntityRecord<'DM-013'>> = {},
): EntityRecord<'DM-013'> {
  return {
    tagId,
    name: `标签-${tagId}`,
    dimension: '运动',
    mergeGroupId: null,
    firstSeenAt: CLOCK,
    eventStream: [],
    heatScore: 1,
    ...overrides,
  }
}

export function personTagRecord(
  personId: string,
  tagId: string,
  evidenceMessageIds: string[] = [],
): EntityRecord<'DM-014'> {
  return { personId, tagId, confidence: 1, evidenceMessageIds, origin: '模型抽取' }
}

export function pairScoreRecord(
  pairId: string,
  personAId: string,
  personBId: string,
  overrides: Partial<EntityRecord<'DM-018'>> = {},
): EntityRecord<'DM-018'> {
  return {
    pairId,
    personAId,
    personBId,
    commonTagIds: [],
    fitScore: 0.5,
    dimensionDiffs: zeroDimensionDiffs(),
    ...overrides,
  }
}

export function generationRecord(
  generationId: string,
  options: {
    kind?: EntityRecord<'DM-020'>['kind']
    memeId?: string | null
    outputRefs?: string[]
    generatedAt?: number
  } = {},
): EntityRecord<'DM-020'> {
  return {
    generationId,
    kind: options.kind ?? 'G1',
    memeId: options.memeId ?? null,
    materialTier: '纯模板生成',
    template: 'tpl-v1',
    outputRefs: options.outputRefs ?? [],
    creationMark: true,
    generatedAt: options.generatedAt ?? CLOCK,
  }
}

export function candidateRecord(
  candidateId: string,
  sourceMessageIds: string[],
  overrides: Partial<EntityRecord<'DM-021'>> = {},
): EntityRecord<'DM-021'> {
  return {
    candidateId,
    meaningGuess: `含义-${candidateId}`,
    sourceMessageIds,
    usageExample: '用法示例',
    status: '候选',
    memeId: null,
    ...overrides,
  }
}

export function consentRecord(
  consentId: string,
  memberIds: string[],
  overrides: Partial<EntityRecord<'DM-022'>> = {},
): EntityRecord<'DM-022'> {
  return {
    consentId,
    materialRef: `media/${consentId}.png`,
    memberIds,
    status: '已确认',
    confirmedAt: CLOCK,
    ...overrides,
  }
}

export function personRecord(
  personId: string,
  memberIds: string[],
  overrides: Partial<EntityRecord<'DM-011'>> = {},
): EntityRecord<'DM-011'> {
  return {
    personId,
    memberIds,
    isMe: false,
    unknown: false,
    activity: 0,
    replyMedianMs: null,
    dimensionScores: zeroDimensionScores(),
    personalityScores: zeroPersonalityScores(),
    ...overrides,
  }
}

/** 五轴零分（DM-011 / DM-013 / DM-018 的结构字段）。 */
export function zeroDimensionScores(): EntityRecord<'DM-011'>['dimensionScores'] {
  return { 运动: 0, 艺术: 0, 游戏: 0, 娱乐: 0, 社交: 0 }
}

/** 六维零分（DM-011 的结构字段）。 */
export function zeroPersonalityScores(): EntityRecord<'DM-011'>['personalityScores'] {
  return { 领导式: 0, 活泼: 0, 幽默: 0, 冷静: 0, 理性: 0, 判断: 0 }
}

/** 五轴零差值（DM-018 的结构字段）。 */
export function zeroDimensionDiffs(): EntityRecord<'DM-018'>['dimensionDiffs'] {
  return { 运动: 0, 艺术: 0, 游戏: 0, 娱乐: 0, 社交: 0 }
}

// ---------------------------------------------------------------------------
// 不变量：删除后全库不存在指向已删行的引用（§5.3 / §7.2）
// ---------------------------------------------------------------------------

interface ScalarReference {
  table: string
  column: string
  refTable: string
  refColumn: string
}

interface JsonReference {
  table: string
  column: string
  refTable: string
  refColumn: string
}

const SCALAR_REFERENCES: readonly ScalarReference[] = [
  { table: 'dm003_message', column: 'group_id', refTable: 'dm002_group', refColumn: 'group_id' },
  { table: 'dm003_message', column: 'quote_msg_id', refTable: 'dm003_message', refColumn: 'msg_id' },
  { table: 'dm004_member', column: 'group_id', refTable: 'dm002_group', refColumn: 'group_id' },
  { table: 'dm004_member', column: 'person_id', refTable: 'dm011_person', refColumn: 'person_id' },
  { table: 'dm006_meme', column: 'group_id', refTable: 'dm002_group', refColumn: 'group_id' },
  { table: 'dm006_meme', column: 'first_seen_group_id', refTable: 'dm002_group', refColumn: 'group_id' },
  { table: 'dm006_meme', column: 'merged_into_id', refTable: 'dm006_meme', refColumn: 'meme_id' },
  { table: 'dm006_meme', column: 'source_candidate_id', refTable: 'dm021_candidate', refColumn: 'candidate_id' },
  { table: 'dm007_occurrence', column: 'meme_id', refTable: 'dm006_meme', refColumn: 'meme_id' },
  { table: 'dm007_occurrence', column: 'source_message_id', refTable: 'dm003_message', refColumn: 'msg_id' },
  { table: 'dm008_variant_link', column: 'source_meme_id', refTable: 'dm006_meme', refColumn: 'meme_id' },
  { table: 'dm008_variant_link', column: 'derived_meme_id', refTable: 'dm006_meme', refColumn: 'meme_id' },
  { table: 'dm009_highlight', column: 'meme_id', refTable: 'dm006_meme', refColumn: 'meme_id' },
  { table: 'dm009_highlight', column: 'source_message_id', refTable: 'dm003_message', refColumn: 'msg_id' },
  { table: 'dm010_source', column: 'item_id', refTable: 'dm010_item', refColumn: 'item_id' },
  { table: 'dm010_source', column: 'msg_id', refTable: 'dm003_message', refColumn: 'msg_id' },
  { table: 'dm012_member', column: 'candidate_id', refTable: 'dm012_candidate', refColumn: 'candidate_id' },
  { table: 'dm013_tag', column: 'merge_group_id', refTable: 'dm015_tag_merge', refColumn: 'merge_group_id' },
  { table: 'dm014_person_tag', column: 'person_id', refTable: 'dm011_person', refColumn: 'person_id' },
  { table: 'dm014_person_tag', column: 'tag_id', refTable: 'dm013_tag', refColumn: 'tag_id' },
  { table: 'dm014_evidence', column: 'msg_id', refTable: 'dm003_message', refColumn: 'msg_id' },
  { table: 'dm015_tag_merge', column: 'representative_tag_id', refTable: 'dm013_tag', refColumn: 'tag_id' },
  { table: 'dm016_personality_tag', column: 'person_id', refTable: 'dm011_person', refColumn: 'person_id' },
  { table: 'dm017_interaction', column: 'trigger_message_id', refTable: 'dm003_message', refColumn: 'msg_id' },
  { table: 'dm017_interaction', column: 'response_message_id', refTable: 'dm003_message', refColumn: 'msg_id' },
  { table: 'dm018_pair_score', column: 'person_a_id', refTable: 'dm011_person', refColumn: 'person_id' },
  { table: 'dm018_pair_score', column: 'person_b_id', refTable: 'dm011_person', refColumn: 'person_id' },
  { table: 'dm020_generation', column: 'meme_id', refTable: 'dm006_meme', refColumn: 'meme_id' },
  { table: 'dm020_output', column: 'generation_id', refTable: 'dm020_generation', refColumn: 'generation_id' },
  { table: 'dm020_consent', column: 'generation_id', refTable: 'dm020_generation', refColumn: 'generation_id' },
  { table: 'dm020_consent', column: 'consent_id', refTable: 'dm022_material_consent', refColumn: 'consent_id' },
  { table: 'dm021_candidate', column: 'meme_id', refTable: 'dm006_meme', refColumn: 'meme_id' },
  { table: 'dm021_source', column: 'candidate_id', refTable: 'dm021_candidate', refColumn: 'candidate_id' },
  { table: 'dm021_source', column: 'msg_id', refTable: 'dm003_message', refColumn: 'msg_id' },
  { table: 'dm022_member', column: 'consent_id', refTable: 'dm022_material_consent', refColumn: 'consent_id' },
]

const JSON_REFERENCES: readonly JsonReference[] = [
  { table: 'dm011_person', column: 'member_ids', refTable: 'dm004_member', refColumn: 'member_id' },
  { table: 'dm015_tag_merge', column: 'merged_tag_ids', refTable: 'dm013_tag', refColumn: 'tag_id' },
  { table: 'dm018_pair_score', column: 'common_tag_ids', refTable: 'dm013_tag', refColumn: 'tag_id' },
  { table: 'dm019_my_fit', column: 'pair_ids', refTable: 'dm018_pair_score', refColumn: 'pair_id' },
]

/** 复合外键（子行 → 父行两列同组匹配）。 */
const COMPOSITE_REFERENCES: ReadonlyArray<{ sql: string; label: string }> = [
  {
    label: 'dm003_message (group_id, sender_key) → dm004_member',
    sql: `SELECT COUNT(*) AS count FROM dm003_message m
          WHERE NOT EXISTS (
            SELECT 1 FROM dm004_member d WHERE d.group_id = m.group_id AND d.member_id = m.sender_key
          )`,
  },
  {
    label: 'dm014_evidence (person_id, tag_id) → dm014_person_tag',
    sql: `SELECT COUNT(*) AS count FROM dm014_evidence e
          WHERE NOT EXISTS (
            SELECT 1 FROM dm014_person_tag pt WHERE pt.person_id = e.person_id AND pt.tag_id = e.tag_id
          )`,
  },
]

/** 全部孤儿引用（空列表 = 不变量成立）。 */
export function collectOrphanViolations(db: Database.Database): string[] {
  const violations: string[] = []
  for (const reference of SCALAR_REFERENCES) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${reference.table}
         WHERE ${reference.column} IS NOT NULL
           AND ${reference.column} NOT IN (SELECT ${reference.refColumn} FROM ${reference.refTable})`,
      )
      .get() as { count: number }
    if (row.count > 0) {
      violations.push(`${reference.table}.${reference.column} → ${reference.refTable} 有 ${row.count} 行孤儿`)
    }
  }
  for (const reference of JSON_REFERENCES) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${reference.table}
         WHERE EXISTS (
           SELECT 1 FROM json_each(${reference.table}.${reference.column}) je
           WHERE je.value NOT IN (SELECT ${reference.refColumn} FROM ${reference.refTable})
         )`,
      )
      .get() as { count: number }
    if (row.count > 0) {
      violations.push(`${reference.table}.${reference.column}（JSON）→ ${reference.refTable} 有 ${row.count} 行孤儿`)
    }
  }
  for (const composite of COMPOSITE_REFERENCES) {
    const row = db.prepare(composite.sql).get() as { count: number }
    if (row.count > 0) {
      violations.push(`${composite.label} 有 ${row.count} 行孤儿`)
    }
  }
  return violations
}
