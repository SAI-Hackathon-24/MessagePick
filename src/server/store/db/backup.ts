/**
 * 迁移前备份（mod-002 §5.5 / 决策 8；详设 §8.1）。
 *
 * - `VACUUM INTO backup/app.db.v<旧版本>`：一条语句得到一致快照，WAL 下安全（决策 8）。
 * - 保留最近 2 份；备份失败则不迁移、不启动（宁可不动）。
 * - 备份目录在应用数据目录下（`backup/`），全量清空删除时一并清除（决策 5）。
 */

import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import type Database from 'better-sqlite3'

/** 备份器端口（测试注入点：构造备份失败）。 */
export interface BackupPort {
  /** 生成一致性快照；失败时抛异常。 */
  backup(db: Database.Database, targetPath: string): void
}

/** 默认备份器：`VACUUM INTO`（不接受参数化路径，路径由本模块用应用数据目录拼出）。 */
export const defaultBackupPort: BackupPort = {
  backup(db, targetPath) {
    db.prepare('VACUUM INTO ?').run(targetPath)
  },
}

export const BACKUP_DIR_NAME = 'backup'
const KEEP_BACKUPS = 2

/** 备份文件名：`app.db.v<旧版本>`。 */
export function backupFileName(fromVersion: number): string {
  return `app.db.v${fromVersion}`
}

/**
 * 迁移前备份到 `backup/app.db.v<fromVersion>`；完成后修剪到最近 `KEEP_BACKUPS` 份。
 * 备份失败时抛出（由调用方转 `StoreStartupError('backup-failed')`，且不执行迁移）。
 */
export function backupBeforeMigration(
  db: Database.Database,
  dataDir: string,
  fromVersion: number,
  port: BackupPort,
): string {
  const backupDir = join(dataDir, BACKUP_DIR_NAME)
  mkdirSync(backupDir, { recursive: true })
  const targetPath = join(backupDir, backupFileName(fromVersion))
  port.backup(db, targetPath)
  pruneBackups(backupDir)
  return targetPath
}

/** 修剪备份到最近 2 份（按版本号排序；文件缺失不影响启动）。 */
export function pruneBackups(backupDir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(backupDir)
  } catch {
    return
  }
  const backups = entries
    .map((name) => ({ name, version: versionOfBackup(name) }))
    .filter((entry): entry is { name: string; version: number } => entry.version !== null)
    .sort((a, b) => b.version - a.version)
  for (const stale of backups.slice(KEEP_BACKUPS)) {
    try {
      unlinkSync(join(backupDir, stale.name))
    } catch {
      // 清理是尽力而为：失败不影响启动。
    }
  }
}

function versionOfBackup(name: string): number | null {
  const match = /^app\.db\.v(\d+)$/.exec(name)
  if (match === null) return null
  const version = Number.parseInt(match[1]!, 10)
  return Number.isFinite(version) ? version : null
}
