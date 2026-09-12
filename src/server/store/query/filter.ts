/**
 * 全局筛选（群 / 时间 / 关键词 / 身份）→ 参数化 WHERE（mod-002 §3.1、§4.2、§5.2）。
 *
 * - 四项条件为 AND；空 = 不限（`AC-014`）；
 * - 条件只按登记表的「筛选绑定」施加：未声明绑定的实体 = 该条件不施加（§5.2）；
 * - 非法筛选结构在进入 SQL 前被拒（`INVALID_INPUT`）。
 */

import type { SharedFilter } from '@shared'

import { invalidInput } from '../errors'
import type { EntityDescriptor, NormalizedFilter, SqlFragment } from '../entities/registry'
import { likePattern } from './keyword'

/** 归一化筛选：校验结构、把「空」统一为「不限」。 */
export function normalizeFilter(filter?: SharedFilter | null): NormalizedFilter {
  if (filter === undefined || filter === null) {
    return { groups: [], timeRange: null, keyword: null, identity: null }
  }
  if (typeof filter !== 'object' || Array.isArray(filter)) {
    throw invalidInput('筛选条件结构非法：应为对象', { filter: typeof filter })
  }

  const groups = normalizeGroups(filter.groupIds)
  const timeRange = normalizeTimeRange(filter.timeRange)
  const keyword = normalizeText(filter.keyword, '筛选条件「关键词」')
  const identity = normalizeText(filter.identity, '筛选条件「身份」')

  return { groups, timeRange, keyword, identity }
}

function normalizeGroups(value: SharedFilter['groupIds']): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw invalidInput('筛选条件「群」结构非法：应为群标识数组')
  }
  const groups: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item === '') {
      throw invalidInput('筛选条件「群」结构非法：群标识应为非空文本')
    }
    groups.push(item)
  }
  return [...new Set(groups)]
}

function normalizeTimeRange(value: SharedFilter['timeRange']): { from: number; to: number } | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidInput('筛选条件「时间范围」结构非法：应为起止时间点')
  }
  const { from, to } = value as { from?: unknown; to?: unknown }
  if (
    typeof from !== 'number' ||
    typeof to !== 'number' ||
    !Number.isFinite(from) ||
    !Number.isFinite(to)
  ) {
    throw invalidInput('筛选条件「时间范围」结构非法：起止时间点应为数值（UTC epoch 毫秒）')
  }
  if (from > to) {
    throw invalidInput('筛选条件「时间范围」结构非法：起始时间晚于结束时间')
  }
  return { from, to }
}

function normalizeText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw invalidInput(`${label}结构非法：应为文本`)
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : value
}

/** 由筛选构造用 `AND` 连接的 WHERE 片段（无条件时为空列表）。 */
export function buildFilterConditions(
  descriptor: EntityDescriptor,
  filter: NormalizedFilter,
): SqlFragment[] {
  const conditions: SqlFragment[] = []
  const ctx = {
    alias: descriptor.table,
    filter,
    keywordPattern: filter.keyword === null ? null : likePattern(filter.keyword),
  }

  const group = descriptor.filterBindings.group?.(ctx)
  if (group != null) conditions.push(group)
  const time = descriptor.filterBindings.time?.(ctx)
  if (time != null) conditions.push(time)
  const keyword = descriptor.filterBindings.keyword?.(ctx)
  if (keyword != null) conditions.push(keyword)
  const identity = descriptor.filterBindings.identity?.(ctx)
  if (identity != null) conditions.push(identity)

  return conditions
}

/** 组合成完整 WHERE（恒含 `1=1`，便于拼接可选条件）。 */
export function buildWhereSql(
  descriptor: EntityDescriptor,
  filter: NormalizedFilter,
): SqlFragment {
  const conditions = buildFilterConditions(descriptor, filter)
  const extra = descriptor.readExtra === undefined ? [] : [descriptor.readExtra]
  const parts = ['1=1', ...conditions.map((condition) => `(${condition.sql})`), ...extra]
  return {
    sql: parts.join(' AND '),
    params: conditions.flatMap((condition) => [...condition.params]),
  }
}

/** 身份条件是否声明（用于 debug 日志：模块二实体 = 不施加，§4.2）。 */
export function declaresIdentityBinding(descriptor: EntityDescriptor): boolean {
  return descriptor.filterBindings.identity !== undefined
}
