/**
 * 提交后清理与「待清理」续做（mod-002 §4.4、§5.3；决策 3）。
 *
 * - 媒体文件按 `_media_index` 的记录清除；（全量清空时）日志与迁移备份按目录清除（决策 5）；
 * - 失败 / 中断写「待清理」清单，下次启动或再次调用续做；不因文件失败回滚已提交的库删除；
 * - 路径护栏与媒体读取共用 `resolveWithinDataDir`（防路径穿越，详设 §4.4）。
 */

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import type Database from 'better-sqlite3'

import { isStoreError, StoreError } from '../errors'
import { resolveWithinDataDir } from '../media'

/** 文件清理器端口（测试注入点：构造清理失败 / 中断）。 */
export interface FileCleaner {
  /** 删除单个文件；失败时抛异常。 */
  removeFile(absolutePath: string): Promise<void>
  /** 清空目录内容（全量清空删除时用于日志与迁移备份）；失败时抛异常。 */
  clearDirectory(absolutePath: string): Promise<void>
}

/** 默认清理器：Node 文件系统。 */
export const nodeFileCleaner: FileCleaner = {
  async removeFile(absolutePath) {
    await rm(absolutePath, { force: true })
  },
  async clearDirectory(absolutePath) {
    await rm(absolutePath, { recursive: true, force: true })
    await mkdir(absolutePath, { recursive: true })
  },
}

/** 续做结果。 */
export interface SweepResult {
  /** 清单条数。 */
  attempted: number
  /** 本次清掉的条数。 */
  cleared: number
  /** 仍未完成的条数（> 0 时删除按 `DELETION_INTERRUPTED` 返回）。 */
  failed: number
}

/** 日志口（只记计数与分类，详设 §6.1）。 */
export interface SweepLogger {
  warn?(event: string, fields: Record<string, unknown>): void
}

/**
 * 续做「待清理」清单（异步）。
 * 幂等：对已不存在的文件（force 删除）视为成功；对非法引用（无法落在数据目录内）
 * 记录告警并出列（该文件不在应用控制范围内，不能无限阻塞删除流程）。
 */
export async function sweepPending(
  db: Database.Database,
  dataDir: string,
  cleaner: FileCleaner,
  logger: SweepLogger = {},
): Promise<SweepResult> {
  const rows = db
    .prepare('SELECT id, kind, path FROM _pending_cleanup ORDER BY id')
    .all() as Array<{ id: number; kind: 'media' | 'log' | 'backup'; path: string }>

  let cleared = 0
  let failed = 0
  const deleteRow = db.prepare('DELETE FROM _pending_cleanup WHERE id = ?')
  const bumpAttempts = db.prepare('UPDATE _pending_cleanup SET attempts = attempts + 1 WHERE id = ?')

  for (const row of rows) {
    const target = resolveTarget(dataDir, row.kind, row.path, logger)
    if (target === null) {
      deleteRow.run(row.id)
      cleared += 1
      continue
    }
    try {
      if (row.kind === 'media') {
        await cleaner.removeFile(target)
      } else {
        await cleaner.clearDirectory(target)
      }
      deleteRow.run(row.id)
      cleared += 1
    } catch {
      bumpAttempts.run(row.id)
      failed += 1
      logger.warn?.('deletion.cleanup.failed', { kind: row.kind, path: row.path })
    }
  }

  return { attempted: rows.length, cleared, failed }
}

function resolveTarget(
  dataDir: string,
  kind: 'media' | 'log' | 'backup',
  path: string,
  logger: SweepLogger,
): string | null {
  try {
    if (kind === 'media') {
      return resolveWithinDataDir(dataDir, path)
    }
    return resolveWithinDataDir(dataDir, kind === 'log' ? 'logs' : 'backup')
  } catch (error) {
    if (error instanceof StoreError && error.envelope.code === 'INVALID_INPUT') {
      logger.warn?.('deletion.cleanup.invalid-path', { kind, path })
      return null
    }
    throw error
  }
}

/** 待清理清单条数（删除中断时的 context 与状态查询用）。 */
export function pendingCleanupCount(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM _pending_cleanup').get() as { count: number }
  return row.count
}

/** 数据目录内的备份目录（全量清空时清理）。 */
export function backupDirOf(dataDir: string): string {
  return join(dataDir, 'backup')
}
