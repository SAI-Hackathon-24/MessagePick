/**
 * 版本 1：全部表 / 索引 / 内部表（mod-002 §5.5；DDL 见 `../schema.ts`）。
 */

import type Database from 'better-sqlite3'

import { SCHEMA_SQL } from '../schema'
import type { Migration } from './index'

/** 版本 1 迁移：空库初始化到结构版本 1。 */
export const v001: Migration = {
  version: 1,
  up(db: Database.Database): void {
    db.exec(SCHEMA_SQL)
  },
}
