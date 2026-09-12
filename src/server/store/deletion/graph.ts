/**
 * 删除图（mod-002 §5.3、决策 3/4/5）：范围解析、级联边、依赖序、计数。
 *
 * 预检与执行共用同一份计划（`buildDeletionPlan`）：
 * - 计划中的所有集合都在「原始状态」下求值（执行时先落临时表、再删），保证
 *   预检计数与（无并发写入时）执行计数一致（§7.2 的不变量）；
 * - 依赖序 = 子行 → 父行，避免外键级联「替」显式删除删掉计数目标（§5.3 的删除图）；
 * - 结构整理（人拆分 / 条目保留 / 标签孤儿）在同一事务内完成（§5.3 第 3 步）。
 */

import type Database from 'better-sqlite3'

import { ENTITY_TYPES, type DeletionScope, type EntityCount, type EntityType } from '@shared'

import { invalidInput } from '../errors'
import { getEntityDescriptor } from '../entities/registry'

/** 一条实体删除步骤：在原始状态下选出待删行的 rowid。 */
export interface DeletionStep {
  entityType: EntityType
  table: string
  where: string
  params: readonly unknown[]
}

/** 提交后清理任务（媒体文件 / 日志 / 迁移备份）。 */
export interface CleanupTask {
  kind: 'media' | 'log' | 'backup'
  path: string
}

/** 结构整理输入（执行阶段使用；均为原始状态下的身份集合）。 */
export interface StructuralPlan {
  /** 失去群成员身份、仍需拆分 / 重算的人（含已被孤儿删除者，执行时按存在性过滤）。 */
  affectedPersons: string[]
  /** 保留 + 置 `needs_recompute` 的条目（DM-010 部分来源被删，决策 4）。 */
  keptItems: string[]
}

/** 删除计划（预检与执行共用）。 */
export interface DeletionPlan {
  scope: DeletionScope
  counts: readonly EntityCount[]
  steps: readonly DeletionStep[]
  /** 本次删除触及的 `_media_index` 行（索引先删、文件后清）。 */
  mediaIndexPaths: readonly string[]
  cleanup: readonly CleanupTask[]
  structural: StructuralPlan
}

const MSGS_IN_GROUP = 'SELECT msg_id FROM dm003_message WHERE group_id = ?'
const MEMES_IN_GROUP = 'SELECT meme_id FROM dm006_meme WHERE group_id = ?'

/** 人将被删除：至少一个成员在范围内、且没有成员在范围外。
 *  `personRef` 必须是外层表限定的引用列（如 `dm011_person.person_id`）：子查询里未限定的人列
 *  会解析到 `m.person_id`，使相关性子查询退化为恒真 / 恒假，计数与结构整理随之失真。 */
function personDoomed(personRef: string): string {
  return `(EXISTS (SELECT 1 FROM dm004_member m WHERE m.person_id = ${personRef} AND m.group_id = ?) AND NOT EXISTS (SELECT 1 FROM dm004_member m WHERE m.person_id = ${personRef} AND m.group_id <> ?))`
}

/** 标签将被删除：有引用、且全部引用的人都将被删除（§5.3 结构整理）。 */
function tagDoomed(): string {
  return `(EXISTS (SELECT 1 FROM dm014_person_tag pt WHERE pt.tag_id = dm013_tag.tag_id) AND NOT EXISTS (SELECT 1 FROM dm014_person_tag pt JOIN dm004_member m ON m.person_id = pt.person_id WHERE pt.tag_id = dm013_tag.tag_id AND m.group_id <> ?))`
}

function itemDoomed(): string {
  return `((EXISTS (SELECT 1 FROM dm010_source s WHERE s.item_id = dm010_item.item_id) OR source_group_id = ?) AND NOT EXISTS (SELECT 1 FROM dm010_source s JOIN dm003_message m ON m.msg_id = s.msg_id WHERE s.item_id = dm010_item.item_id AND m.group_id <> ?))`
}

/** 条目保留（部分来源）：既有关联来源落在删除范围内、又有关联来源在范围外。 */
function itemKept(): string {
  return `(EXISTS (SELECT 1 FROM dm010_source s JOIN dm003_message m ON m.msg_id = s.msg_id WHERE s.item_id = dm010_item.item_id AND m.group_id = ?) AND EXISTS (SELECT 1 FROM dm010_source s JOIN dm003_message m ON m.msg_id = s.msg_id WHERE s.item_id = dm010_item.item_id AND m.group_id <> ?))`
}

function generationDoomed(): string {
  return `(meme_id IN (${MEMES_IN_GROUP}) OR EXISTS (SELECT 1 FROM dm020_consent mc WHERE mc.generation_id = dm020_generation.generation_id AND EXISTS (SELECT 1 FROM dm022_member dm JOIN dm004_member m ON m.member_id = dm.member_id WHERE dm.consent_id = mc.consent_id AND m.group_id = ?)))`
}

function consentDoomed(): string {
  return `EXISTS (SELECT 1 FROM dm022_member dm JOIN dm004_member m ON m.member_id = dm.member_id WHERE dm.consent_id = dm022_material_consent.consent_id AND m.group_id = ?)`
}

function candidateDoomed(): string {
  return `EXISTS (SELECT 1 FROM dm021_source s WHERE s.candidate_id = dm021_candidate.candidate_id AND s.msg_id IN (${MSGS_IN_GROUP}))`
}

/** 按实体类型返回「原始状态下的删除谓词」（全量 = 全部行）。 */
function deletePredicate(scope: DeletionScope, type: EntityType): { where: string; params: unknown[] } {
  if (scope.kind === 'all') return { where: '1=1', params: [] }
  const gid = scope.groupId
  switch (type) {
    case 'DM-001':
    case 'DM-005':
      return { where: '0=1', params: [] }
    case 'DM-002':
    case 'DM-003':
    case 'DM-004':
    case 'DM-006':
      return { where: 'group_id = ?', params: [gid] }
    case 'DM-007':
    case 'DM-009':
      return {
        where: `(meme_id IN (${MEMES_IN_GROUP}) OR source_message_id IN (${MSGS_IN_GROUP}))`,
        params: [gid, gid],
      }
    case 'DM-008':
      return {
        where: `(source_meme_id IN (${MEMES_IN_GROUP}) OR derived_meme_id IN (${MEMES_IN_GROUP}))`,
        params: [gid, gid],
      }
    case 'DM-010':
      return { where: itemDoomed(), params: [gid, gid] }
    case 'DM-011':
      return { where: personDoomed('dm011_person.person_id'), params: [gid, gid] }
    case 'DM-012':
      return {
        where: `EXISTS (SELECT 1 FROM dm012_member dm JOIN dm004_member m ON m.member_id = dm.member_id WHERE dm.candidate_id = dm012_candidate.candidate_id AND m.group_id = ?)`,
        params: [gid],
      }
    case 'DM-013':
      return { where: tagDoomed(), params: [gid] }
    case 'DM-014':
      return { where: personDoomed('dm014_person_tag.person_id'), params: [gid, gid] }
    case 'DM-015':
      return {
        where: `representative_tag_id IN (SELECT tag_id FROM dm013_tag WHERE ${tagDoomed()})`,
        params: [gid],
      }
    case 'DM-016':
      return { where: personDoomed('dm016_personality_tag.person_id'), params: [gid, gid] }
    case 'DM-017':
      return {
        where: `(trigger_message_id IN (${MSGS_IN_GROUP}) OR response_message_id IN (${MSGS_IN_GROUP}))`,
        params: [gid, gid],
      }
    case 'DM-018':
      return {
        where: `(${personDoomed('dm018_pair_score.person_a_id')} OR ${personDoomed('dm018_pair_score.person_b_id')})`,
        params: [gid, gid, gid, gid],
      }
    case 'DM-019':
      return {
        where: `NOT EXISTS (SELECT 1 FROM dm004_member m WHERE m.is_me = 1 AND m.group_id <> ?)`,
        params: [gid],
      }
    case 'DM-020':
      return { where: generationDoomed(), params: [gid, gid] }
    case 'DM-021':
      return { where: candidateDoomed(), params: [gid] }
    case 'DM-022':
      return { where: consentDoomed(), params: [gid] }
  }
}

/** 执行序：子行 → 父行（§5.3；避免级联抢先删除计数目标）。 */
const DELETION_ORDER: readonly EntityType[] = [
  'DM-014',
  'DM-016',
  'DM-018',
  'DM-019',
  'DM-017',
  'DM-012',
  'DM-020',
  'DM-021',
  'DM-022',
  'DM-015',
  'DM-013',
  'DM-009',
  'DM-008',
  'DM-007',
  'DM-010',
  'DM-006',
  'DM-003',
  'DM-004',
  'DM-011',
  'DM-002',
  'DM-005',
  'DM-001',
]

/** 校验删除范围结构（非法即拒，不触库）。 */
export function validateScope(scope: unknown): DeletionScope {
  if (scope === null || typeof scope !== 'object' || Array.isArray(scope)) {
    throw invalidInput('删除范围结构非法：应为按群 / 全量两种结构之一')
  }
  const candidate = scope as { kind?: unknown; groupId?: unknown }
  if (candidate.kind === 'all') {
    return { kind: 'all' }
  }
  if (candidate.kind === 'group') {
    if (typeof candidate.groupId !== 'string' || candidate.groupId === '') {
      throw invalidInput('删除范围结构非法：按群删除需要非空群标识')
    }
    return { kind: 'group', groupId: candidate.groupId }
  }
  throw invalidInput('删除范围结构非法：kind 应为 group / all')
}

/** 构建删除计划（只读；预检与执行共用）。 */
export function buildDeletionPlan(db: Database.Database, scope: DeletionScope): DeletionPlan {
  const counts: EntityCount[] = []
  const steps: DeletionStep[] = []

  for (const type of ENTITY_TYPES) {
    const descriptor = getEntityDescriptor(type)
    const predicate = deletePredicate(scope, type)
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM ${descriptor.table} WHERE ${predicate.where}`)
      .get(...predicate.params) as { count: number }
    counts.push({ entityType: type, count: row.count })
  }

  for (const type of DELETION_ORDER) {
    const descriptor = getEntityDescriptor(type)
    const predicate = deletePredicate(scope, type)
    steps.push({ entityType: type, table: descriptor.table, where: predicate.where, params: predicate.params })
  }

  const mediaIndexPaths = collectMediaIndexPaths(db, scope)
  const structural = collectStructuralPlan(db, scope)
  return {
    scope,
    counts,
    steps,
    mediaIndexPaths,
    cleanup: buildCleanupTasks(scope, mediaIndexPaths),
    structural,
  }
}

/** 本次删除触及的媒体 / 产物索引行（原始状态下求值）。 */
function collectMediaIndexPaths(db: Database.Database, scope: DeletionScope): string[] {
  if (scope.kind === 'all') {
    const rows = db.prepare('SELECT path FROM _media_index ORDER BY path').all() as Array<{
      path: string
    }>
    return rows.map((row) => row.path)
  }
  const gid = scope.groupId
  const generation = deletePredicate(scope, 'DM-020')
  const consent = deletePredicate(scope, 'DM-022')
  const rows = db
    .prepare(
      `SELECT path FROM _media_index
       WHERE (entity_type = 'DM-003' AND entity_id IN (${MSGS_IN_GROUP}))
          OR (entity_type = 'DM-020' AND entity_id IN (SELECT generation_id FROM dm020_generation WHERE ${generation.where}))
          OR (entity_type = 'DM-022' AND entity_id IN (SELECT consent_id FROM dm022_material_consent WHERE ${consent.where}))
       ORDER BY path`,
    )
    .all(gid, ...generation.params, ...consent.params) as Array<{ path: string }>
  return rows.map((row) => row.path)
}

/** 结构整理输入：受影响的人、保留重算的条目（原始状态下求值）。 */
function collectStructuralPlan(db: Database.Database, scope: DeletionScope): StructuralPlan {
  if (scope.kind === 'all') {
    return { affectedPersons: [], keptItems: [] }
  }
  const gid = scope.groupId
  const persons = db
    .prepare('SELECT DISTINCT person_id FROM dm004_member WHERE group_id = ? ORDER BY person_id')
    .all(gid) as Array<{ person_id: string }>
  const items = db
    .prepare(`SELECT item_id FROM dm010_item WHERE ${itemKept()} ORDER BY item_id`)
    .all(gid, gid) as Array<{ item_id: string }>
  return {
    affectedPersons: persons.map((row) => row.person_id),
    keptItems: items.map((row) => row.item_id),
  }
}

/** 提交后清理任务：媒体文件 +（全量）日志与迁移备份（决策 5）。 */
function buildCleanupTasks(scope: DeletionScope, mediaPaths: readonly string[]): CleanupTask[] {
  const tasks: CleanupTask[] = mediaPaths.map((path) => ({ kind: 'media', path }))
  if (scope.kind === 'all') {
    tasks.push({ kind: 'log', path: 'logs' }, { kind: 'backup', path: 'backup' })
  }
  return tasks
}
