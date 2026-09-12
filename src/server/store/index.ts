/**
 * 门面：`createStore()` → `Store`（mod-002 §3.1、§3.2）——`API-003` ~ `API-006` 的唯一实现入口。
 *
 * - 全部持久化写入、读取与删除经本组件；worker 不开库（连接有主线程断言，详设 §1.1）。
 * - 写：同步方法；返回时本批已提交或已整体回滚；批上限 1000 行 / 2 MB、逐批提交、可重放（§4.1）。
 * - 读：同步只读；分页默认 1 / 50、上限 1000（决策 7）。
 * - 删：预检只读；执行 = 库内单事务 + 提交后清理（决策 3），缺二次确认不触库（§4.4）。
 * - epoch：`_meta.data_epoch` 单调递增；`write(..., { bumpEpoch: true })` 由调用方声明（§5.4）。
 */

import type Database from 'better-sqlite3'

import type {
  DeletionResult,
  DeletionScope,
  EntityCount,
  EntityRecord,
  EntityType,
  FilterCondition,
  PageRequest,
  PreflightResult,
  ReadResult,
  WriteResult,
} from '@shared'

import { DIMENSIONS, PERSONALITY_DIMENSIONS } from '@shared'

import {
  classifyStorageFailure,
  confirmationRequired,
  deletionInterrupted,
  invalidInput,
  isConstraintFailure,
  isStoreError,
  StoreError,
} from './errors'
import { executeDeletionInTransaction } from './deletion/execute'
import { validateScope } from './deletion/graph'
import { preflightDeletion } from './deletion/preflight'
import { nodeFileCleaner, pendingCleanupCount, sweepPending, type FileCleaner } from './deletion/sweep'
import { defaultBackupPort, type BackupPort } from './db/backup'
import { defaultDbPath, openConnection } from './db/connection'
import type { Migration } from './db/migrations'
import { withTransaction } from './db/tx'
import { findEntityDescriptor, type EntityDescriptor } from './entities/registry'
import { buildRowValues, identityOf, rowToRecord } from './entities/validate'
import { readMediaFile, registerMediaRef, replaceMediaIndex, writeMediaFile } from './media'
import { bumpEpoch, readEpoch } from './meta/epoch'
import { buildWhereSql, normalizeFilter } from './query/filter'
import { normalizePage } from './query/page'

// ---------------------------------------------------------------------------
// 对外类型
// ---------------------------------------------------------------------------

/** 结构化日志口（字段口径见详设 §6.1；不记记录内容）。 */
export interface StoreLogger {
  debug?(event: string, fields?: Record<string, unknown>): void
  info?(event: string, fields?: Record<string, unknown>): void
  warn?(event: string, fields?: Record<string, unknown>): void
  error?(event: string, fields?: Record<string, unknown>): void
}

/** 写入选项：`bumpEpoch` 由调用方声明（采集 / 导入完成、改判落库时，详设 §3.3）。 */
export interface WriteOptions {
  bumpEpoch?: boolean
}

/** 删除门：进删除后组合根（MOD-004）据此拒绝新采集启动（详设 §1.2）。 */
export interface DeleteGate {
  enter(): void
  leave(): void
  isDeleting(): boolean
}

/** 门面选项（可注入点：时钟 / 日志 / 文件清理器 / 备份器 / 迁移链 / 主线程断言）。 */
export interface StoreOptions {
  /** 应用数据目录（库、媒体、日志、备份都落在其下）。 */
  dataDir: string
  /** 库文件路径（默认 `<dataDir>/app.db`）。 */
  dbPath?: string
  /** 时钟（默认 `Date.now`；测试注入确定性时间）。 */
  clock?: () => number
  /** 日志口（默认静默）。 */
  logger?: StoreLogger
  /** 文件清理器（测试注入点：构造清理失败，覆盖 `AC-028`）。 */
  fileCleaner?: FileCleaner
  /** 迁移前备份器（测试注入点：构造备份失败）。 */
  backup?: BackupPort
  /** 迁移链（默认内置链；测试注入追加版本）。 */
  migrations?: readonly Migration[]
  /** 主线程断言开关（默认开）。 */
  requireMainThread?: boolean
  /** 主线程判定函数（测试注入点）。 */
  isMainThread?: () => boolean
  /** 启动时自动续做「待清理」清单（默认开；测试可关）。 */
  autoResumeCleanup?: boolean
}

/** MOD-002 的门面：同步读写 + 异步删除 + epoch 与媒体通道。 */
export interface Store {
  /** 应用数据目录（媒体 / 产物读取的根）。 */
  readonly dataDir: string
  /** 删除门（组合根接线用；本模块不依赖 MOD-001）。 */
  readonly deleteGate: DeleteGate
  /** API-003 写入记录（按记录身份去重）。 */
  write<T extends EntityType>(
    type: T,
    records: readonly EntityRecord<T>[],
    opts?: WriteOptions,
  ): WriteResult
  /** API-004 按条件读取（分页）。 */
  read<T extends EntityType>(
    type: T,
    filter?: FilterCondition | null,
    page?: PageRequest | null,
  ): ReadResult<T>
  /** API-005 删除预检（只读）。 */
  preflightDeletion(scope: DeletionScope): PreflightResult
  /** API-006 执行删除（库内同步、提交后清理异步；缺二次确认抛 `CONFIRMATION_REQUIRED`）。 */
  executeDeletion(scope: DeletionScope, confirmed: boolean): Promise<DeletionResult>
  /** 当前 `data_epoch`（详设 §3.3）。 */
  currentEpoch(): number
  /** 媒体 / 产物读取（路径护栏在存储侧；入口名以 mod-002 设计为准，详设 §4.4）。 */
  openMedia(ref: string): { bytes: Uint8Array; mime: string }
  /** 媒体 / 产物字节写入（文件 + 索引双载体；写入者不直接碰应用数据目录）。 */
  writeMedia(ref: string, bytes: Uint8Array, owner?: { entityType: string; entityId: string }): void
  /** 续做「待清理」清单（下次启动或再次调用；返回仍未完成的条数）。 */
  resumeCleanup(): Promise<number>
  /** 关闭连接（测试 / 进程退出 cleanup 用）。 */
  close(): void
}

const MAX_BATCH_ROWS = 1000
const MAX_BATCH_BYTES = 2 * 1024 * 1024

/** 打开存储并完成启动期检查（失败抛 `StoreError` / `StoreStartupError`）。 */
export function createStore(options: StoreOptions): Store {
  const dataDir = options.dataDir
  const clock = options.clock ?? Date.now
  const logger = options.logger ?? {}
  const cleaner = options.fileCleaner ?? nodeFileCleaner
  const handle = openConnection({
    dataDir,
    dbPath: options.dbPath ?? defaultDbPath(dataDir),
    migrations: options.migrations,
    backup: options.backup ?? defaultBackupPort,
    requireMainThread: options.requireMainThread,
    isMainThread: options.isMainThread,
  })
  const db = handle.db
  if (handle.appliedMigrations.length > 0) {
    logger.info?.('migration.done', {
      module: 'MOD-002',
      applied: [...handle.appliedMigrations],
      backupPath: handle.backupPath,
    })
  }

  const statements = new Map<string, Database.Statement>()
  const prepare = (sql: string): Database.Statement => {
    let statement = statements.get(sql)
    if (statement === undefined) {
      statement = db.prepare(sql)
      statements.set(sql, statement)
    }
    return statement
  }

  let epochCache = readEpoch(db)
  const gate = createDeleteGate()
  let inflightCleanup: Promise<number> | null = null

  const resumeCleanup = (): Promise<number> => {
    if (inflightCleanup === null) {
      inflightCleanup = sweepPending(db, dataDir, cleaner, logger)
        .then((result) => result.failed)
        .finally(() => {
          inflightCleanup = null
        })
    }
    return inflightCleanup
  }

  if ((options.autoResumeCleanup ?? true) && pendingCleanupCount(db) > 0) {
    void resumeCleanup().catch(() => {
      // 启动续清失败不影响可用性；清单仍在，下次启动或再次删除时续做。
    })
  }

  return {
    dataDir,
    deleteGate: gate,

    write(type, records, opts) {
      const descriptor = requireDescriptor(type)
      if (!Array.isArray(records)) {
        throw invalidInput('写入记录结构非法：应为记录数组', { entityType: type })
      }
      const failures: WriteResult['failures'] = []
      for (const batch of chunkRecords(records)) {
        withTransaction(db, (tx) => {
          for (const record of batch) {
            const outcome = tryWriteRecord(tx, descriptor, record as Record<string, unknown>)
            if (!outcome.ok) failures.push(outcome.failure)
          }
        })
      }
      if (opts?.bumpEpoch === true) {
        withTransaction(db, (tx) => {
          epochCache = bumpEpoch(tx)
        })
        logger.info?.('cache.invalidated', { module: 'MOD-002', reason: 'write', epoch: epochCache })
      }
      const written = records.length - failures.length
      logger.info?.('store.write', {
        module: 'MOD-002',
        entityType: type,
        written,
        failed: failures.length,
      })
      return { written, failures }
    },

    read(type, filter, page) {
      const descriptor = findEntityDescriptor(type)
      if (descriptor === undefined) {
        throw invalidInput(`未知实体类型：${String(type)}`, { entityType: String(type) })
      }
      const normalizedFilter = normalizeFilter(filter)
      const normalizedPage = normalizePage(page)
      if (
        normalizedFilter.identity !== null &&
        descriptor.filterBindings.identity === undefined
      ) {
        // 模块二口径 = 不施加身份条件（§4.2）；记 debug 日志便于对账。
        logger.debug?.('store.read.identity-not-applied', { module: 'MOD-002', entityType: type })
      }
      try {
        const where = buildWhereSql(descriptor, normalizedFilter)
        const countRow = db
          .prepare(`SELECT COUNT(*) AS total FROM ${descriptor.table} WHERE ${where.sql}`)
          .get(...where.params) as { total: number }
        const rows = db
          .prepare(
            `SELECT * FROM ${descriptor.table} WHERE ${where.sql} ORDER BY ${descriptor.orderBy.join(', ')} LIMIT ? OFFSET ?`,
          )
          .all(...where.params, normalizedPage.pageSize, normalizedPage.offset) as Array<
          Record<string, unknown>
        >
        const records = rows.map((row) => rowToRecord(descriptor.columns, row))
        attachLinks(prepare, descriptor, rows, records)
        return {
          records: toEntityRecords<typeof type>(records),
          pageInfo: {
            page: normalizedPage.page,
            pageSize: normalizedPage.pageSize,
            total: countRow.total,
          },
        }
      } catch (error) {
        throw wrapStorageError(error, 'store:read')
      }
    },

    preflightDeletion(scope) {
      const normalized = validateScope(scope)
      try {
        const result = preflightDeletion(db, normalized)
        logger.info?.('deletion.preflight', {
          module: 'MOD-002',
          scope: normalized.kind === 'group' ? `group:${normalized.groupId}` : 'all',
          counts: countsSummary(result.items),
        })
        return result
      } catch (error) {
        throw wrapStorageError(error, 'store:preflight')
      }
    },

    async executeDeletion(scope, confirmed) {
      const normalized = validateScope(scope)
      if (confirmed !== true) {
        throw confirmationRequired()
      }
      gate.enter()
      try {
        const execution = withTransaction(db, (tx) =>
          executeDeletionInTransaction(tx, normalized, clock, (event, fields) => {
            logger.warn?.(event, { module: 'MOD-002', ...fields })
          }),
        )
        // 库内删除已提交（含后续清理失败的场景）：epoch 缓存必须立即反映事务内的 +1（§4.4）。
        epochCache = readEpoch(db)
        let failed: number
        try {
          const sweep = await sweepPending(db, dataDir, cleaner, logger)
          failed = sweep.failed
        } catch {
          failed = pendingCleanupCountSafe(db)
        }
        logger.info?.('deletion.done', {
          module: 'MOD-002',
          scope: normalized.kind === 'group' ? `group:${normalized.groupId}` : 'all',
          counts: countsSummary(execution.items),
          pendingCleanup: failed,
        })
        if (failed > 0) {
          throw deletionInterrupted(failed)
        }
        return { items: execution.items.map((item) => ({ ...item })) }
      } catch (error) {
        throw wrapStorageError(error, 'store:execute')
      } finally {
        gate.leave()
      }
    },

    currentEpoch() {
      return epochCache
    },

    openMedia(ref) {
      try {
        return readMediaFile(dataDir, ref)
      } catch (error) {
        throw wrapStorageError(error, 'store:media')
      }
    },

    writeMedia(ref, bytes, owner) {
      writeMediaFile(dataDir, ref, bytes)
      if (owner !== undefined) {
        withTransaction(db, (tx) => {
          registerMediaRef(tx, owner, ref, 'media')
        })
      }
    },

    resumeCleanup,

    close() {
      statements.clear()
      db.close()
    },
  }
}

// ---------------------------------------------------------------------------
// 写入引擎
// ---------------------------------------------------------------------------

/** 单条写入的结局：成功 / 单条失败明细（不升级为契约错误码，§4.1）。 */
type WriteOutcome = { ok: true } | { ok: false; failure: WriteResult['failures'][number] }

function tryWriteRecord(
  tx: Database.Database,
  descriptor: EntityDescriptor,
  record: Record<string, unknown>,
): WriteOutcome {
  const built = buildRowValues(descriptor.columns, descriptor.identity, record)
  if (!built.ok) {
    return { ok: false, failure: { identity: identityOf(descriptor.columns, descriptor.identity, record), reason: built.reason } }
  }
  const values: Record<string, string | number | null> = { ...built.values }

  try {
    applyPreWriteHooks(tx, descriptor, record, values)
    const result = runWriteStatement(tx, descriptor, values)
    const inserted = result.changes > 0
    applyPostWriteHooks(tx, descriptor, record, values, inserted)
    return { ok: true }
  } catch (error) {
    if (isConstraintFailure(error)) {
      return {
        ok: false,
        failure: {
          identity: identityOf(descriptor.columns, descriptor.identity, record),
          reason: constraintReason(error),
        },
      }
    }
    throw classifyStorageFailure(error, 'store:write')
  }
}

/** 写入前钩子：内部列取值（`src_time` / 单例键）、立即外键要求的前置结构行。 */
function applyPreWriteHooks(
  tx: Database.Database,
  descriptor: EntityDescriptor,
  record: Record<string, unknown>,
  values: Record<string, string | number | null>,
): void {
  switch (descriptor.type) {
    case 'DM-004': {
      // 成员行的人引用是立即外键：默认人必须在成员行插入前落库（§5.1）。
      // 已存在的成员按其当前人引用（`person_id` 不在变异白名单，重写不会改归属）。
      const existing = tx
        .prepare('SELECT person_id FROM dm004_member WHERE group_id = ? AND member_id = ?')
        .get(values.group_id, values.member_id) as { person_id: string } | undefined
      const personId = existing?.person_id ?? String(values.person_id)
      ensureDefaultPerson(tx, personId, String(values.member_id), values.is_me === 1)
      break
    }
    case 'DM-007':
      // 时间筛选冗余列 = 出现时间（§5.2）。
      values.src_time = values.occurred_at ?? null
      break
    case 'DM-010': {
      // 排序时间 = 全部来源消息中最早的发送时间（mod-006 的排序键口径）。
      const sources = Array.isArray(record.sourceMessageIds) ? record.sourceMessageIds : []
      const row = tx
        .prepare(
          'SELECT MIN(sent_at) AS earliest FROM dm003_message WHERE msg_id IN (SELECT value FROM json_each(?))',
        )
        .get(JSON.stringify(sources)) as { earliest: number | null }
      values.src_time = row.earliest
      values.needs_recompute = 0
      break
    }
    case 'DM-019':
      values.scope = 'me'
      break
    default:
      break
  }
}

/** 写入后钩子：连接表、媒体索引、结构性绑定（§5.1 的「结构性写入由本模块执行」）。 */
function applyPostWriteHooks(
  tx: Database.Database,
  descriptor: EntityDescriptor,
  record: Record<string, unknown>,
  values: Record<string, string | number | null>,
  inserted: boolean,
): void {
  switch (descriptor.type) {
    case 'DM-003': {
      if (!inserted) return
      const messageId = String(values.msg_id)
      const mediaRef = values.media_ref
      replaceMediaIndex(
        tx,
        { entityType: 'DM-003', entityId: messageId },
        typeof mediaRef === 'string' ? [{ ref: mediaRef, kind: 'media' }] : [],
      )
      break
    }
    case 'DM-004':
      syncPersonForMember(tx, String(values.group_id), String(values.member_id))
      break
    case 'DM-010': {
      replaceLinkRows(
        tx,
        { table: 'dm010_source', ownerColumns: ['item_id'], ownerFields: ['itemId'] },
        { item_id: String(values.item_id) },
        arrayField(record, 'sourceMessageIds'),
        'msg_id',
        { skipMissing: { table: 'dm003_message', column: 'msg_id' } },
      )
      // 重算完成信号：写入即清除「待重算」标记（决策 4）。
      tx.prepare('UPDATE dm010_item SET needs_recompute = 0 WHERE item_id = ?').run(
        String(values.item_id),
      )
      break
    }
    case 'DM-012': {
      replaceLinkRows(
        tx,
        { table: 'dm012_member', ownerColumns: ['candidate_id'], ownerFields: ['candidateId'] },
        { candidate_id: String(values.candidate_id) },
        arrayField(record, 'memberIds'),
        'member_id',
      )
      if (values.status === '已确认') {
        mergePersonsForMembers(tx, arrayField(record, 'memberIds'))
      }
      break
    }
    case 'DM-014':
      replaceLinkRows(
        tx,
        { table: 'dm014_evidence', ownerColumns: ['person_id', 'tag_id'], ownerFields: ['personId', 'tagId'] },
        { person_id: String(values.person_id), tag_id: String(values.tag_id) },
        arrayField(record, 'evidenceMessageIds'),
        'msg_id',
        { skipMissing: { table: 'dm003_message', column: 'msg_id' } },
      )
      break
    case 'DM-020': {
      const refs = arrayField(record, 'outputRefs')
      const fileRefs = refs.filter((ref) => !ref.startsWith('consent:'))
      const consentRefs = refs
        .filter((ref) => ref.startsWith('consent:'))
        .map((ref) => ref.slice('consent:'.length))
      replaceLinkRows(
        tx,
        { table: 'dm020_output', ownerColumns: ['generation_id'], ownerFields: ['generationId'] },
        { generation_id: String(values.generation_id) },
        fileRefs,
        'ref',
      )
      tx.prepare('DELETE FROM dm020_consent WHERE generation_id = ?').run(String(values.generation_id))
      const linkConsent = tx.prepare(
        `INSERT INTO dm020_consent (generation_id, consent_id)
         SELECT ?, ? WHERE EXISTS (SELECT 1 FROM dm022_material_consent WHERE consent_id = ?)`,
      )
      for (const consentId of new Set(consentRefs)) {
        linkConsent.run(String(values.generation_id), consentId, consentId)
      }
      replaceMediaIndex(
        tx,
        { entityType: 'DM-020', entityId: String(values.generation_id) },
        fileRefs.map((ref) => ({ ref, kind: 'artifact' as const })),
      )
      break
    }
    case 'DM-021':
      replaceLinkRows(
        tx,
        { table: 'dm021_source', ownerColumns: ['candidate_id'], ownerFields: ['candidateId'] },
        { candidate_id: String(values.candidate_id) },
        arrayField(record, 'sourceMessageIds'),
        'msg_id',
        { skipMissing: { table: 'dm003_message', column: 'msg_id' } },
      )
      break
    case 'DM-022': {
      replaceLinkRows(
        tx,
        { table: 'dm022_member', ownerColumns: ['consent_id'], ownerFields: ['consentId'] },
        { consent_id: String(values.consent_id) },
        arrayField(record, 'memberIds'),
        'member_id',
        { skipMissing: { table: 'dm004_member', column: 'member_id' } },
      )
      replaceMediaIndex(
        tx,
        { entityType: 'DM-022', entityId: String(values.consent_id) },
        [{ ref: String(values.material_ref), kind: 'media' }],
      )
      break
    }
    default:
      break
  }
}

/** 组装并执行 INSERT / UPSERT（幂等：insert-only 忽略重复；upsert 只覆盖变异白名单）。 */
function runWriteStatement(
  tx: Database.Database,
  descriptor: EntityDescriptor,
  values: Record<string, string | number | null>,
): { changes: number } {
  const columns = descriptor.columns
  const columnNames = columns.map((column) => column.column)
  const params = columns.map((column) => values[column.column] ?? null)
  const placeholders = columns.map(() => '?').join(', ')
  const conflictTarget = descriptor.identityColumns.join(', ')

  let conflictClause: string
  if (descriptor.writeMode === 'insert-only') {
    conflictClause = `ON CONFLICT (${conflictTarget}) DO NOTHING`
  } else {
    const updates = descriptor.mutableFields.map((column) => `${column} = excluded.${column}`)
    conflictClause = `ON CONFLICT (${conflictTarget}) DO UPDATE SET ${updates.join(', ')}`
  }
  const sql = `INSERT INTO ${descriptor.table} (${columnNames.join(', ')}) VALUES (${placeholders}) ${conflictClause}`
  return tx.prepare(sql).run(...params) as { changes: number }
}

/** 连接表整批替换（先删该归属的既有行，再插入当前集合）。
 *  `skipMissing` 给出被引用列所在的目标表 / 列（如来源消息 `dm003_message.msg_id`、
 *  涉及成员 `dm004_member.member_id`）：目标行不存在时跳过该连接行，不产生悬空引用。 */
function replaceLinkRows(
  tx: Database.Database,
  link: { table: string; ownerColumns: readonly string[]; ownerFields: readonly string[] },
  owner: Record<string, string>,
  values: readonly string[],
  valueColumn: string,
  options: { skipMissing?: { table: string; column: string } } = {},
): void {
  const conditions = link.ownerColumns.map((column) => `${column} = ?`).join(' AND ')
  const ownerParams = link.ownerColumns.map((column) => owner[column]!)
  tx.prepare(`DELETE FROM ${link.table} WHERE ${conditions}`).run(...ownerParams)
  const missingRef = options.skipMissing
  const insertSql =
    missingRef === undefined
      ? `INSERT INTO ${link.table} (${[...link.ownerColumns, valueColumn].join(', ')}) VALUES (${link.ownerColumns.map(() => '?').join(', ')}, ?)`
      : `INSERT INTO ${link.table} (${[...link.ownerColumns, valueColumn].join(', ')}) SELECT ${link.ownerColumns.map(() => '?').join(', ')}, ? WHERE EXISTS (SELECT 1 FROM ${missingRef.table} WHERE ${missingRef.column} = ?)`
  const insert = tx.prepare(insertSql)
  for (const value of new Set(values)) {
    if (missingRef === undefined) {
      insert.run(...ownerParams, value)
    } else {
      insert.run(...ownerParams, value, value)
    }
  }
}

/** 单条失败原因：把 SQLite 约束消息映射成短原因（不携带数据内容）。 */
function constraintReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('FOREIGN KEY')) return '引用不满足（外键约束）'
  if (message.includes('UNIQUE')) return '唯一约束不满足（含「我」唯一 / 记录身份冲突）'
  if (message.includes('CHECK')) return '取值不满足列约束'
  if (message.includes('NOT NULL')) return '必填列为空'
  return '约束不满足'
}

/** 批次拆分：单批 ≤ 1000 行且 ≤ 2 MB（先到者为限；§3.3、§4.1）。 */
function chunkRecords<T>(records: readonly T[]): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let bytes = 0
  for (const record of records) {
    const size = Buffer.byteLength(JSON.stringify(record) ?? '', 'utf8')
    if (current.length > 0 && (current.length >= MAX_BATCH_ROWS || bytes + size > MAX_BATCH_BYTES)) {
      chunks.push(current)
      current = []
      bytes = 0
    }
    current.push(record)
    bytes += size
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

// ---------------------------------------------------------------------------
// 结构性绑定：DM-004 默认人 / DM-012 确认合并
// ---------------------------------------------------------------------------

/** DM-011 的默认记录：一人 = 一个群成员（未确认映射时，§5.1）。
 *  写前钩子调用：成员行的人引用是立即外键，默认人必须先于成员行落库。 */
function ensureDefaultPerson(
  tx: Database.Database,
  personId: string,
  memberId: string,
  isMe: boolean,
): void {
  const exists = tx.prepare('SELECT 1 AS ok FROM dm011_person WHERE person_id = ?').get(personId)
  if (exists !== undefined) return
  tx.prepare(
    `INSERT INTO dm011_person (person_id, member_ids, is_me, unknown, activity, reply_median_ms, dimension_scores, personality_scores)
     VALUES (?, ?, ?, 0, 0, NULL, ?, ?)`,
  ).run(personId, JSON.stringify([memberId]), isMe ? 1 : 0, zeroDimensions(), zeroPersonality())
}

/** 成员写入后：按行的实际人引用重算该人的成员集与「我」（结构绑定以成员表为准）。 */
function syncPersonForMember(tx: Database.Database, groupId: string, memberId: string): void {
  const memberRow = tx
    .prepare('SELECT person_id FROM dm004_member WHERE group_id = ? AND member_id = ?')
    .get(groupId, memberId) as { person_id: string } | undefined
  if (memberRow === undefined) return
  syncPersonMembership(tx, memberRow.person_id)
}

/** 把人记录的成员集与「我」按当前成员重算（结构绑定以成员表为准）。 */
function syncPersonMembership(tx: Database.Database, personId: string): void {
  const members = tx
    .prepare('SELECT member_id, is_me FROM dm004_member WHERE person_id = ? ORDER BY member_id')
    .all(personId) as Array<{ member_id: string; is_me: number }>
  const isMe = members.some((member) => member.is_me === 1) ? 1 : 0
  tx.prepare('UPDATE dm011_person SET member_ids = ?, is_me = ? WHERE person_id = ?').run(
    JSON.stringify(members.map((member) => member.member_id)),
    isMe,
    personId,
  )
}

/** DM-012 状态 = 「已确认」时的结构合并：涉及群成员归到同一个人（§5.1、REQ-082）。 */
function mergePersonsForMembers(tx: Database.Database, memberIds: readonly string[]): void {
  if (memberIds.length < 2) return
  const persons = new Set<string>()
  for (const memberId of memberIds) {
    const rows = tx
      .prepare('SELECT person_id FROM dm004_member WHERE member_id = ?')
      .all(memberId) as Array<{ person_id: string }>
    for (const row of rows) persons.add(row.person_id)
  }
  const ordered = [...persons].sort()
  if (ordered.length < 2) return
  const canonical = ordered[0]!
  // 先清零「我」的唯一标记，避免唯一索引冲突；随后按成员重算。
  for (const personId of ordered) {
    tx.prepare('UPDATE dm011_person SET is_me = 0 WHERE person_id = ?').run(personId)
  }
  for (const memberId of memberIds) {
    tx.prepare('UPDATE dm004_member SET person_id = ? WHERE member_id = ?').run(canonical, memberId)
  }
  for (const personId of ordered) {
    if (personId === canonical) continue
    tx.prepare('DELETE FROM dm011_person WHERE person_id = ?').run(personId)
  }
  syncPersonMembership(tx, canonical)
}

function zeroDimensions(): string {
  return JSON.stringify(Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 0])))
}

function zeroPersonality(): string {
  return JSON.stringify(
    Object.fromEntries(PERSONALITY_DIMENSIONS.map((dimension) => [dimension, 0])),
  )
}

// ---------------------------------------------------------------------------
// 读取装配
// ---------------------------------------------------------------------------

/** 连接表字段装配：把多对多字段读回记录（批量查询；稳定排序）。 */
function attachLinks(
  prepare: (sql: string) => Database.Statement,
  descriptor: EntityDescriptor,
  rows: Array<Record<string, unknown>>,
  records: Array<Record<string, unknown>>,
): void {
  if (descriptor.links === undefined || rows.length === 0) return
  for (const link of descriptor.links) {
    const linkRows: Array<Record<string, unknown>> = []
    if (link.ownerColumns.length === 1) {
      const ownerColumn = link.ownerColumns[0]!
      const ownerIds = [...new Set(rows.map((row) => String(row[ownerColumn])))]
      const statement = prepare(
        `SELECT ${ownerColumn}, ${link.valueColumn} FROM ${link.table} WHERE ${ownerColumn} IN (SELECT value FROM json_each(?)) ORDER BY ${link.valueColumn} ASC`,
      )
      linkRows.push(
        ...(statement.all(JSON.stringify(ownerIds)) as Array<Record<string, unknown>>),
      )
    } else {
      const statement = prepare(
        `SELECT ${[...link.ownerColumns, link.valueColumn].join(', ')} FROM ${link.table} WHERE ${link.ownerColumns
          .map((column) => `${column} = ?`)
          .join(' AND ')} ORDER BY ${link.valueColumn} ASC`,
      )
      for (const row of rows) {
        linkRows.push(
          ...(statement.all(...link.ownerColumns.map((column) => row[column])) as Array<
            Record<string, unknown>
          >),
        )
      }
    }
    const byOwner = new Map<string, string[]>()
    for (const linkRow of linkRows) {
      const key = link.ownerColumns.map((column) => String(linkRow[column])).join('\u0000')
      const list = byOwner.get(key) ?? []
      list.push(String(linkRow[link.valueColumn]))
      byOwner.set(key, list)
    }
    records.forEach((record, index) => {
      const row = rows[index]!
      const key = link.ownerColumns.map((column) => String(row[column])).join('\u0000')
      record[link.valueField] = byOwner.get(key) ?? []
    })
  }
}

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

function createDeleteGate(): DeleteGate {
  let depth = 0
  return {
    enter() {
      depth += 1
    },
    leave() {
      depth = Math.max(0, depth - 1)
    },
    isDeleting() {
      return depth > 0
    },
  }
}

function requireDescriptor(type: string): EntityDescriptor {
  const descriptor = findEntityDescriptor(type)
  if (descriptor === undefined) {
    throw invalidInput(`未知实体类型：${String(type)}`, { entityType: String(type) })
  }
  return descriptor
}

/**
 * 行 → 契约记录的边界转换（唯一一处显式转换）。
 *
 * 字段映射由登记表的列规格保证（写入侧逐条校验 + `STRICT` 表约束 + `rowToRecord` 装配），
 * 但「动态列规格 → 具体记录类型」无法在编译期证明，故集中在此转换、不散落在调用点。
 */
function toEntityRecords<T extends EntityType>(
  records: readonly Record<string, unknown>[],
): EntityRecord<T>[] {
  return records as unknown as EntityRecord<T>[]
}

function arrayField(record: Record<string, unknown>, field: string): string[] {
  const value = record[field]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function countsSummary(items: readonly EntityCount[]): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const item of items) {
    if (item.count > 0) summary[item.entityType] = item.count
  }
  return summary
}

function pendingCleanupCountSafe(db: Database.Database): number {
  try {
    return pendingCleanupCount(db)
  } catch {
    return 1
  }
}

function wrapStorageError(error: unknown, scope: string): StoreError {
  if (isStoreError(error)) return error
  return classifyStorageFailure(error, scope)
}
