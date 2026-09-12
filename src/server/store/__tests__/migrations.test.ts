/**
 * MOD-002 建库与迁移（mod-002 §5.5 / 决策 8；§7.2）：
 *
 * - 空库初始化到结构版本 1（`user_version` / `_meta` 水位）；
 * - 注入测试迁移验证链式升级与迁移前备份（`VACUUM INTO` 快照可打开）；
 * - 备份失败不迁移、不启动（`StoreStartupError: backup-failed`）；
 * - 迁移体失败该版本回滚并停止启动（`migration-failed`）；
 * - 库版本高于应用拒绝打开（`version-too-new`）；迁移完成 epoch +1（详设 §8.3）。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'

import { afterEach, describe, expect, it } from 'vitest'

import { backupFileName, type BackupPort } from '../db/backup'
import { v001, type Migration } from '../db/migrations'
import { isStoreStartupError } from '../errors'
import { createStore, type Store, type StoreOptions } from '../index'

import { groupRecord, tableCount } from './harness'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'messagepick-mig-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function openStore(options: StoreOptions): Store {
  const store = createStore(options)
  cleanups.push(() => {
    try {
      store.close()
    } catch {
      // 已由测试显式关闭
    }
  })
  return store
}

function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  cleanups.push(() => db.close())
  return db
}

function baseOptions(dir: string, dbPath: string): StoreOptions {
  return { dataDir: dir, dbPath, requireMainThread: false, autoResumeCleanup: false }
}

function readMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function hasTable(db: Database.Database, name: string): boolean {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !==
    undefined
  )
}

/** 测试迁移 v2：追加一张表（覆盖链式升级）。 */
const testV2: Migration = {
  version: 2,
  up(db) {
    db.exec('CREATE TABLE test_v2 (id TEXT PRIMARY KEY) STRICT;')
  },
}

/** 失败迁移 v2：建表后抛错（覆盖「该版本事务回滚」）。 */
const failingV2: Migration = {
  version: 2,
  up(db) {
    db.exec('CREATE TABLE test_v2 (id TEXT PRIMARY KEY) STRICT;')
    throw new Error('注入的迁移失败')
  },
}

function startupErrorOf(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('期望抛出 StoreStartupError，但调用未抛错')
}

describe('建库（§5.5）', () => {
  it('空库初始化到结构版本 1，epoch 由 0 → 1', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'app.db')
    const store = openStore(baseOptions(dir, dbPath))
    expect(store.currentEpoch()).toBe(1)

    const db = openDb(dbPath)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(1)
    expect(readMeta(db, 'schema_version')).toBe('1')
    expect(readMeta(db, 'data_epoch')).toBe('1')
    expect(tableCount(db, 'dm002_group')).toBe(0)
  })
})

describe('迁移链（决策 8）', () => {
  it('注入 v2：旧库先备份再链式升级；备份是升级前可打开的快照', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'app.db')
    const storeV1 = openStore(baseOptions(dir, dbPath))
    storeV1.write('DM-002', [groupRecord('gA')])
    storeV1.close()

    const storeV2 = openStore({ ...baseOptions(dir, dbPath), migrations: [v001, testV2] })
    // 迁移完成 → epoch +1（1 → 2）
    expect(storeV2.currentEpoch()).toBe(2)

    const db = openDb(dbPath)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(2)
    expect(hasTable(db, 'test_v2')).toBe(true)

    // 迁移前备份：backup/app.db.v1 = 升级前快照（v1、数据完整、无 v2 结构）
    const backupPath = join(dir, 'backup', backupFileName(1))
    expect(existsSync(backupPath)).toBe(true)
    const backup = openDb(backupPath)
    expect(Number(backup.pragma('user_version', { simple: true }))).toBe(1)
    expect(hasTable(backup, 'test_v2')).toBe(false)
    expect(tableCount(backup, 'dm002_group')).toBe(1)
  })

  it('迁移前备份失败：不迁移、不启动（backup-failed），库保持旧版本', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'app.db')
    const storeV1 = openStore(baseOptions(dir, dbPath))
    storeV1.write('DM-002', [groupRecord('gA')])
    storeV1.close()

    const failingBackup: BackupPort = {
      backup() {
        throw new Error('注入的备份失败')
      },
    }
    const error = startupErrorOf(() =>
      createStore({ ...baseOptions(dir, dbPath), migrations: [v001, testV2], backup: failingBackup }),
    )
    expect(isStoreStartupError(error)).toBe(true)
    expect(isStoreStartupError(error) ? error.reason : null).toBe('backup-failed')

    const db = openDb(dbPath)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(1)
    expect(hasTable(db, 'test_v2')).toBe(false)
    expect(tableCount(db, 'dm002_group')).toBe(1)
  })

  it('迁移体失败：该版本事务回滚、停止启动（migration-failed）', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'app.db')
    const storeV1 = openStore(baseOptions(dir, dbPath))
    storeV1.write('DM-002', [groupRecord('gA')])
    storeV1.close()

    const error = startupErrorOf(() =>
      createStore({ ...baseOptions(dir, dbPath), migrations: [v001, failingV2] }),
    )
    expect(isStoreStartupError(error)).toBe(true)
    expect(isStoreStartupError(error) ? error.reason : null).toBe('migration-failed')

    // v2 事务整体回滚：版本与结构都停在 v1
    const db = openDb(dbPath)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(1)
    expect(hasTable(db, 'test_v2')).toBe(false)
    expect(tableCount(db, 'dm002_group')).toBe(1)
  })

  it('库版本高于应用：拒绝打开（version-too-new），不迁移、不备份', () => {
    const dir = tempDir()
    const dbPath = join(dir, 'app.db')
    const storeV1 = openStore(baseOptions(dir, dbPath))
    storeV1.close()

    const db = openDb(dbPath)
    db.pragma('user_version = 99')

    const error = startupErrorOf(() => createStore(baseOptions(dir, dbPath)))
    expect(isStoreStartupError(error)).toBe(true)
    expect(isStoreStartupError(error) ? error.reason : null).toBe('version-too-new')

    expect(Number(db.pragma('user_version', { simple: true }))).toBe(99)
    expect(existsSync(join(dir, 'backup', backupFileName(99)))).toBe(false)
  })
})
