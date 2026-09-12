/**
 * MOD-002 护栏与错误映射（mod-002 §6、§7.2；决策 1）：
 *
 * - 事务体必须是同步函数：返回 Promise 被拒且回滚；嵌套事务被拒；
 * - worker 侧（非主线程）打开连接被拒；
 * - 存储不可用（打开失败注入）→ `STORAGE_UNAVAILABLE`（AC-038）；
 * - 媒体路径护栏：穿越 / 绝对路径 / 空引用被拒；缺失引用 → `NOT_FOUND`；
 * - 未知实体 / 非法结构 → `INVALID_INPUT`（整次拒绝）。
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'

import { afterEach, describe, expect, it } from 'vitest'

import type { EntityRecord, EntityType } from '@shared'

import { withTransaction } from '../db/tx'
import { isStoreError, isStoreUsageError } from '../errors'
import { createStore } from '../index'

import { StoreHarness, storeErrorCode, storeErrorCodeAsync } from './harness'

const harness = new StoreHarness()
const cleanups: Array<() => void> = []
afterEach(() => {
  harness.dispose()
  while (cleanups.length > 0) cleanups.pop()!()
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'messagepick-guard-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  cleanups.push(() => db.close())
  return db
}

function captureSync(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('期望抛出异常，但调用未抛错')
}

describe('事务护栏（决策 1）', () => {
  it('事务体返回 Promise：拒绝、回滚，连接不卡在事务中', () => {
    const dir = tempDir()
    const db = openDb(join(dir, 'guard.db'))

    const error = captureSync(() => withTransaction(db, async () => 1))
    expect(isStoreUsageError(error)).toBe(true)
    expect(isStoreUsageError(error) ? error.reason : null).toBe('async-transaction-body')
    expect(db.inTransaction).toBe(false)

    // 连接仍可正常使用
    expect(withTransaction(db, () => 42)).toBe(42)
  })

  it('嵌套事务：StoreUsageError(nested-transaction)，外层回滚', () => {
    const dir = tempDir()
    const db = openDb(join(dir, 'guard.db'))

    const error = captureSync(() => withTransaction(db, () => withTransaction(db, () => 1)))
    expect(isStoreUsageError(error)).toBe(true)
    expect(isStoreUsageError(error) ? error.reason : null).toBe('nested-transaction')
    expect(db.inTransaction).toBe(false)
  })
})

describe('运行环境与存储错误', () => {
  it('非主线程打开连接被拒（worker 不开库，详设 §1.1）', () => {
    const dir = tempDir()
    const error = captureSync(() =>
      createStore({
        dataDir: dir,
        requireMainThread: true,
        isMainThread: () => false,
        autoResumeCleanup: false,
      }),
    )
    expect(isStoreUsageError(error)).toBe(true)
    expect(isStoreUsageError(error) ? error.reason : null).toBe('not-main-thread')
  })

  it('连接打开失败 → STORAGE_UNAVAILABLE，不静默返回空集（AC-038）', () => {
    const dir = tempDir()
    // 库路径被一个目录占住 → open 失败
    mkdirSync(join(dir, 'blocked'), { recursive: true })
    const error = captureSync(() =>
      createStore({
        dataDir: dir,
        dbPath: join(dir, 'blocked'),
        requireMainThread: false,
        autoResumeCleanup: false,
      }),
    )
    expect(isStoreError(error)).toBe(true)
    expect(isStoreError(error) ? error.envelope.code : null).toBe('STORAGE_UNAVAILABLE')
  })
})

describe('媒体路径护栏（§5.2 / §7.2）', () => {
  it('路径穿越 / 绝对路径 / 空引用被拒（INVALID_INPUT），不落盘', () => {
    const { store, dataDir } = harness.create()
    expect(storeErrorCode(() => store.openMedia('../escape.png'))).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.openMedia('media/../../escape.png'))).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.openMedia('/etc/passwd'))).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.openMedia(''))).toBe('INVALID_INPUT')
    expect(
      storeErrorCode(() => store.writeMedia('../escape.png', new Uint8Array([1]))),
    ).toBe('INVALID_INPUT')
    expect(existsSync(join(dataDir, '..', 'escape.png'))).toBe(false)
  })

  it('目录内相对路径可读写；缺失引用 → NOT_FOUND（媒体通道）', () => {
    const { store } = harness.create()
    store.writeMedia('media/ok/note.txt', new TextEncoder().encode('你好'))
    const payload = store.openMedia('media/ok/note.txt')
    expect(new TextDecoder().decode(payload.bytes)).toBe('你好')
    expect(payload.mime).toBe('text/plain; charset=utf-8')
    expect(storeErrorCode(() => store.openMedia('media/missing.txt'))).toBe('NOT_FOUND')
  })
})

describe('非法输入（§6）', () => {
  it('未知实体 / 非法结构整次拒绝（INVALID_INPUT）', async () => {
    const { store } = harness.create()
    expect(storeErrorCode(() => store.write('DM-099' as EntityType, []))).toBe('INVALID_INPUT')
    expect(storeErrorCode(() => store.read('DM-099' as EntityType))).toBe('INVALID_INPUT')
    expect(
      storeErrorCode(() =>
        store.write('DM-002', null as unknown as readonly EntityRecord<'DM-002'>[]),
      ),
    ).toBe('INVALID_INPUT')
    expect(
      storeErrorCode(() => store.preflightDeletion({ kind: 'bogus' } as never)),
    ).toBe('INVALID_INPUT')
    expect(
      await storeErrorCodeAsync(() => store.executeDeletion({ kind: 'bogus' } as never, true)),
    ).toBe('INVALID_INPUT')
  })
})
