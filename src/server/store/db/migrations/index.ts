/**
 * 迁移链注册表（mod-002 §3.1、§5.5 / 决策 8）。
 *
 * - 版本存取 `PRAGMA user_version`；迁移链只向前、逐版本一个事务（执行见 `connection.ts`）；
 * - 注册表集中在本文件；每个版本一个文件（`vNNN.ts`）；
 * - 测试可注入自定义迁移链（在版本 1 之后追加测试迁移）覆盖链式升级与迁移前备份。
 */

import type Database from 'better-sqlite3'

import { v001 } from './v001'

/** 单个版本迁移：`up` 必须是同步迁移体（由 `withTransaction` 包裹逐版本提交）。 */
export interface Migration {
  version: number
  up(db: Database.Database): void
}

/** 内置迁移链（只向前、逐版本一个文件）。 */
export const BUILTIN_MIGRATIONS: readonly Migration[] = [v001]

/** 目标结构版本 = 迁移链末端。 */
export function targetSchemaVersion(migrations: readonly Migration[]): number {
  return migrations.length === 0 ? 0 : migrations[migrations.length - 1]!.version
}

/** 校验迁移链（升序、无重复、版本从 1 连续）；不合法属编程错误。 */
export function assertMigrationChain(migrations: readonly Migration[]): void {
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index]!
    if (migration.version !== index + 1) {
      throw new Error(
        `迁移链不合法：期望连续版本 ${index + 1}，实际 ${migration.version}（只向前、逐版本一个文件）`,
      )
    }
  }
}

export { v001 }
