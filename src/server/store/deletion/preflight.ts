/**
 * API-005 删除预检（mod-002 §3.1、§4.3）。
 *
 * - 同步只读：与执行共用同一份删除计划（原始状态求值），清单内部自洽；
 * - 范围语义：按群 / 全量两种；未知群标识返回全零清单（不是错误）；
 * - 预检只是给 MOD-004 展示的快照；`API-006` 执行时不使用它作为删除依据（§4.3）。
 */

import type Database from 'better-sqlite3'

import type { DeletionScope, PreflightResult } from '@shared'

import { buildDeletionPlan } from './graph'

/** 返回删除范围内的受影响实体清单与计数（22 个实体类型恒全量给出，未受影响者为 0）。 */
export function preflightDeletion(db: Database.Database, scope: DeletionScope): PreflightResult {
  const plan = buildDeletionPlan(db, scope)
  return { items: plan.counts.map((count) => ({ entityType: count.entityType, count: count.count })) }
}
