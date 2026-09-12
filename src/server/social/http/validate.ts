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
  type PeopleSearchEntry,
  type PersonalityDimension,
  type PersonalityTagAction,
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
