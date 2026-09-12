/**
 * 事务护栏（mod-002 §3.2 / 决策 1）：
 *
 * - 事务体必须是同步函数：`BEGIN…COMMIT` 之间不让出事件循环，写与删天然不可交错；
 *   返回 Promise（thenable）视为违约 → 回滚并抛 `StoreUsageError`（不上抛为契约标识）。
 * - 不使用嵌套事务：已在事务内调用直接抛 `StoreUsageError`。
 * - 使用 `BEGIN IMMEDIATE`：进入写事务即取写锁，配合 `busy_timeout`（详设 §3.1）。
 */

import type Database from 'better-sqlite3'

import { StoreUsageError } from '../errors'

/** 事务体拿到的数据库句柄（单连接、同步接口）。 */
export type Tx = Database.Database

/** 单次事务执行（同步）；失败整体回滚。 */
export function withTransaction<T>(db: Database.Database, fn: (tx: Tx) => T): T {
  if (db.inTransaction) {
    throw new StoreUsageError('nested-transaction', '不允许嵌套事务：事务体必须一次调用内完成')
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn(db)
    if (isThenable(result)) {
      db.exec('ROLLBACK')
      throw new StoreUsageError(
        'async-transaction-body',
        '事务体必须是同步函数：不允许 await / 返回 Promise（决策 1）',
      )
    }
    db.exec('COMMIT')
    return result
  } catch (error) {
    if (db.inTransaction) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // 回滚失败（连接已坏）时保留原始异常；连接将按存储不可用处理。
      }
    }
    throw error
  }
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}
