/**
 * 入参 schema 校验（mod-007 §3.1「http/」、§2；详设 §4.4「入参非法即拒绝，不进业务层」）。
 *
 * 只做「结构 + 闭集」校验：必填、非空、数组元素、枚举闭集；**业务存在性**（成员 / 标签 / 候选）
 * 由各接口在业务层判定并返回 `NOT_FOUND`。闭集违规一律 `INVALID_INPUT` 并回传可取值（`AC-120`）。
 */

import {
  DIMENSIONS,
  IDENTITY_DECISIONS,
  INTEREST_TAG_ACTIONS,
  PEOPLE_SEARCH_ENTRIES,
  PERSONALITY_DIMENSIONS,
  PERSONALITY_TAG_ACTIONS,
  ErrorCode,
  type Dimension,
  type Id,
  type IdentityDecision,
  type InterestTagAction,
  type InterestTagInput,
  type PeopleSearchEntry,
  type PersonalityDimension,
  type PersonalityTagAction,
  type SharedFilter,
} from '@shared'

import { socialError } from '../errors'

/** 必填标识（非空文本）。 */
export function requireId(value: unknown, scope: string, label = '成员标识'): Id {
  if (typeof value !== 'string' || value.trim() === '') {
    throw socialError(ErrorCode.INVALID_INPUT, `${label}不能为空`, { scope })
  }
  return value
}

/** 必填文本（非空）。 */
export function requireText(value: unknown, scope: string, label = '文本'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw socialError(ErrorCode.INVALID_INPUT, `${label}不能为空`, { scope })
  }
  return value
}

/** 标识数组（允许空数组；元素必须是非空文本）。 */
export function requireIdList(value: unknown, scope: string, label = '成员标识集合'): Id[] {
  if (!Array.isArray(value)) {
    throw socialError(ErrorCode.INVALID_INPUT, `${label}必须是数组`, { scope })
  }
  return value.map((item) => requireId(item, scope, `${label}的元素`))
}

/** 闭集取值校验（越界 → `INVALID_INPUT`，`context.allowed` 回传可取值）。 */
export function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  scope: string,
  label = '取值',
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw socialError(ErrorCode.INVALID_INPUT, `${label}必须在闭集内`, {
      scope,
      context: { allowed: [...allowed] },
    })
  }
  return value as T
}

/** 一级维度闭集（固定五类，不增不减；`REQ-052`）。 */
export function requireDimension(value: unknown, scope: string): Dimension {
  return requireOneOf(value, DIMENSIONS, scope, '一级维度')
}

/** 性格六维闭集（`REQ-074`、`AC-120`）。 */
export function requirePersonalityDimension(value: unknown, scope: string): PersonalityDimension {
  return requireOneOf(value, PERSONALITY_DIMENSIONS, scope, '性格标签维度')
}

/** 检索入口闭集（两个入口，`REQ-064`）。 */
export function requirePeopleSearchEntry(value: unknown, scope: string): PeopleSearchEntry {
  return requireOneOf(value, PEOPLE_SEARCH_ENTRIES, scope, '检索入口')
}

/** 身份对齐结论闭集（确认 / 否定）。 */
export function requireIdentityDecision(value: unknown, scope: string): IdentityDecision {
  return requireOneOf(value, IDENTITY_DECISIONS, scope, '结论')
}

/** 性格标签操作闭集（确认 / 增 / 删 / 改）。 */
export function requirePersonalityAction(value: unknown, scope: string): PersonalityTagAction {
  return requireOneOf(value, PERSONALITY_TAG_ACTIONS, scope, '性格标签操作')
}

/** 兴趣标签操作闭集（增 / 删 / 改）。 */
export function requireInterestAction(value: unknown, scope: string): InterestTagAction {
  return requireOneOf(value, INTEREST_TAG_ACTIONS, scope, '兴趣标签操作')
}

/**
 * 选填的全局筛选条件（`api-contract.md` §1.3 的四键；空 = 不限）。
 *
 * 只做**结构**校验：未知键忽略（前向兼容），已知键的类型与元素格式非法 → `INVALID_INPUT`。
 */
export function optionalFilter(value: unknown, scope: string): SharedFilter | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw socialError(ErrorCode.INVALID_INPUT, '全局筛选条件必须是结构', { scope })
  }
  const filter = value as SharedFilter
  if (filter.groupIds !== undefined && filter.groupIds !== null) {
    if (!Array.isArray(filter.groupIds)) {
      throw socialError(ErrorCode.INVALID_INPUT, '筛选条件的群标识必须是数组', { scope })
    }
    for (const groupId of filter.groupIds) requireId(groupId, scope, '群标识')
  }
  if (filter.timeRange !== undefined && filter.timeRange !== null) {
    const range = filter.timeRange as { from?: unknown; to?: unknown }
    if (!isFiniteNumber(range.from) || !isFiniteNumber(range.to)) {
      throw socialError(ErrorCode.INVALID_INPUT, '筛选条件的起止时间必须是有限数值', { scope })
    }
  }
  if (filter.keyword !== undefined && filter.keyword !== null && typeof filter.keyword !== 'string') {
    throw socialError(ErrorCode.INVALID_INPUT, '筛选条件的关键词必须是文本', { scope })
  }
  if (filter.identity !== undefined && filter.identity !== null) {
    requireId(filter.identity, scope, '筛选条件的身份')
  }
  return filter
}

/**
 * 选填的兴趣标签入参（`API-028`）：一级维度闭集 + 二级标签名非空。
 *
 * 值缺失（`undefined` / `null`）返回 `null` 由调用方按各操作的条件必填口径处置；
 * 给了值但结构或闭集非法 → `INVALID_INPUT`。
 */
export function optionalInterestTag(value: unknown, scope: string): InterestTagInput | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw socialError(ErrorCode.INVALID_INPUT, '标签必须是结构（一级维度 + 二级标签名）', { scope })
  }
  const tag = value as InterestTagInput
  const name = requireText(tag.name, scope, '标签名')
  const dimension = requireDimension(tag.dimension, scope)
  return { name, dimension }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
