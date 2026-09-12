/**
 * 连接打开与启动期检查（mod-002 §3.1、§5.5；详设 §3.1、§8.1）。
 *
 * 顺序：主线程断言 → 目录准备 → 打开库 → 运行参数 → 版本检查 →（旧库）备份 → 逐版本迁移 → epoch +1。
 * - 运行参数：`journal_mode = WAL`、`synchronous = NORMAL`、`foreign_keys = ON`、`busy_timeout = 5000 ms`。
 * - 连接打开失败 / 磁盘满 / 权限错误 → `STORAGE_UNAVAILABLE`（分类见 errors.ts）。
 * - 迁移失败 / 备份失败 / 库版本过高 → `StoreStartupError`（非契约标识，拒绝启动，详设 §8.1）。
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isMainThread as workerIsMainThread } from 'node:worker_threads'

import Database from 'better-sqlite3'

import {
  classifyStorageFailure,
  StoreStartupError,
  StoreUsageError,
} from '../errors'
import { bumpEpoch, writeSchemaWatermark } from '../meta/epoch'
import { backupBeforeMigration, defaultBackupPort, type BackupPort } from './backup'
import {
  assertMigrationChain,
  BUILTIN_MIGRATIONS,
  targetSchemaVersion,
  type Migration,
} from './migrations'
import { withTransaction } from './tx'

/** 连接选项（测试注入点：迁移链 / 备份器 / 主线程断言）。 */
export interface ConnectionOptions {
  /** 应用数据目录（库、媒体、日志、备份都落在其下）。 */
  dataDir: string
  /** 库文件路径（默认 `<dataDir>/app.db`）。 */
  dbPath: string
  /** 迁移链（默认内置链；测试可注入追加版本）。 */
  migrations?: readonly Migration[]
  /** 迁移前备份器（测试注入点：构造备份失败）。 */
  backup?: BackupPort
  /** 主线程断言开关（生产默认开；测试可关闭或注入判定）。 */
  requireMainThread?: boolean
  /** 主线程判定函数（测试注入点）。 */
  isMainThread?: () => boolean
}

/** 连接打开结果。 */
export interface ConnectionHandle {
  db: Database.Database
  /** 本次启动实际执行的迁移版本（从旧到新）。 */
  appliedMigrations: readonly number[]
  /** 迁移前备份路径（无备份时为空）。 */
  backupPath: string | null
}

/** 默认库文件路径：`<dataDir>/app.db`（§3.2 的 `StoreOptions.dbPath` 缺省值）。 */
export function defaultDbPath(dataDir: string): string {
  return join(dataDir, 'app.db')
}

/** 打开库并完成启动期检查；失败时抛 `StoreError` / `StoreStartupError`。 */
export function openConnection(options: ConnectionOptions): ConnectionHandle {
  if (options.requireMainThread !== false && !(options.isMainThread ?? (() => workerIsMainThread))()) {
    throw new StoreUsageError(
      'not-main-thread',
      '存储连接只能由服务进程主线程打开（worker 不开库，详设 §1.1）',
    )
  }

  const migrations = options.migrations ?? BUILTIN_MIGRATIONS
  assertMigrationChain(migrations)
  const target = targetSchemaVersion(migrations)

  prepareDirectories(options.dataDir, options.dbPath)

  let db: Database.Database
  try {
    db = new Database(options.dbPath)
  } catch (error) {
    throw classifyStorageFailure(error, 'store:open')
  }

  let applied: number[] = []
  let backupPath: string | null = null
  try {
    applyPragmas(db)
    const current = readUserVersion(db)
    if (current > target) {
      throw new StoreStartupError(
        'version-too-new',
        `库结构版本（${current}）高于应用支持的版本（${target}）：拒绝打开，请升级应用`,
        { current, target },
      )
    }
    if (current < target) {
      if (current > 0) {
        const relativeBackup = join('backup', `app.db.v${current}`)
        try {
          backupPath = backupBeforeMigration(
            db,
            options.dataDir,
            current,
            options.backup ?? defaultBackupPort,
          )
        } catch (error) {
          throw new StoreStartupError(
            'backup-failed',
            `迁移前备份失败：不迁移、不启动（备份目标 ${relativeBackup}）`,
            { current, target, backupPath: relativeBackup, reason: reasonOf(error) },
          )
        }
      }
      applied = runMigrations(db, migrations, current, backupPath)
    }
  } catch (error) {
    closeQuietly(db)
    throw error
  }

  return { db, appliedMigrations: applied, backupPath }
}

/** 逐版本迁移（每版本一个事务）；迁移完成后 epoch +1（全部派生缓存失效，详设 §8.3）。 */
function runMigrations(
  db: Database.Database,
  migrations: readonly Migration[],
  fromVersion: number,
  backupPath: string | null,
): number[] {
  const applied: number[] = []
  for (const migration of migrations) {
    if (migration.version <= fromVersion) continue
    try {
      withTransaction(db, (tx) => {
        migration.up(tx)
        tx.pragma(`user_version = ${migration.version}`)
        writeSchemaWatermark(tx, migration.version)
      })
    } catch (error) {
      throw new StoreStartupError(
        'migration-failed',
        `迁移到版本 ${migration.version} 失败：已回滚该版本事务，停止启动（详设 §8.1）`,
        { fromVersion, toVersion: migration.version, backupPath, reason: reasonOf(error) },
      )
    }
    applied.push(migration.version)
  }
  if (applied.length > 0) {
    withTransaction(db, (tx) => {
      bumpEpoch(tx)
    })
  }
  return applied
}

/** 运行参数（详设 §3.1）。 */
function applyPragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
}

function readUserVersion(db: Database.Database): number {
  const rows = db.pragma('user_version') as Array<{ user_version: number }>
  return rows[0]?.user_version ?? 0
}

/** 目录准备：数据目录 / 媒体 / 日志 / 备份（应用数据目录布局，详设 §3.4）。 */
export function prepareDirectories(dataDir: string, dbPath?: string): void {
  for (const dir of [
    dataDir,
    join(dataDir, 'media'),
    join(dataDir, 'logs'),
    join(dataDir, 'backup'),
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  if (dbPath !== undefined) {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
}

function closeQuietly(db: Database.Database): void {
  try {
    db.close()
  } catch {
    // 关闭失败不覆盖原始启动错误。
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}
