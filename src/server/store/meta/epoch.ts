/**
 * `_meta.data_epoch` 读写（mod-002 §3.1、§5.4；详设 §3.3 的失效信号）。
 *
 * - 单调递增；触发点 = 采集 / 导入完成、删除完成、改判落库、迁移完成，
 *   由调用方以 `WriteOptions.bumpEpoch` 声明（删除与迁移由本模块自行递增）。
 * - 递增必须发生在已开启的事务内（删除完成与提交同事务；写入完成单独一个小事务）。
 */

import type Database from 'better-sqlite3'

export const DATA_EPOCH_KEY = 'data_epoch'
export const SCHEMA_WATERMARK_KEY = 'schema_version'

/** 读取当前 epoch；键缺失（异常库）时按 0 处理。 */
export function readEpoch(db: Database.Database): number {
  const row = db
    .prepare('SELECT value FROM _meta WHERE key = ?')
    .get(DATA_EPOCH_KEY) as { value: string } | undefined
  const value = row === undefined ? 0 : Number.parseInt(row.value, 10)
  return Number.isFinite(value) ? value : 0
}

/** 在已开启的事务内把 epoch +1，返回新值。 */
export function bumpEpoch(db: Database.Database): number {
  db.prepare(
    'INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)',
  ).run(DATA_EPOCH_KEY, '1')
  return readEpoch(db)
}

/** 写入结构水位镜像（`_meta.schema_version`；权威版本仍以 `PRAGMA user_version` 为准）。 */
export function writeSchemaWatermark(db: Database.Database, version: number): void {
  db.prepare(
    'INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(SCHEMA_WATERMARK_KEY, String(version))
}
