/**
 * 分页规范化与结果装配（mod-002 §4.2、决策 7）。
 *
 * - 页码默认 1、每页条数默认 50，均须 ≥ 1；每页条数上限 1000（越界返回 `INVALID_INPUT`）。
 * - 页码 / 每页条数为整数；小数、非数值、NaN、Infinity 一律拒绝。
 */

import type { PageRequest } from '@shared'

import { invalidInput } from '../errors'

export const DEFAULT_PAGE = 1
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 1000

/** 规范化后的分页参数（回显给调用方）。 */
export interface NormalizedPage {
  page: number
  pageSize: number
  offset: number
}

/** 规范化分页（越界即拒，决策 7）。 */
export function normalizePage(page?: PageRequest | null): NormalizedPage {
  if (page !== undefined && page !== null && (typeof page !== 'object' || Array.isArray(page))) {
    throw invalidInput('分页参数结构非法：应为对象')
  }
  const request = (page ?? {}) as PageRequest
  const pageNumber = normalizePositiveInteger(request.page, DEFAULT_PAGE, '页码', (value) =>
    value > Number.MAX_SAFE_INTEGER ? '页码超出可表示范围' : null,
  )
  const pageSize = normalizePositiveInteger(request.pageSize, DEFAULT_PAGE_SIZE, '每页条数', (value) =>
    value > MAX_PAGE_SIZE ? `每页条数超出上限（${MAX_PAGE_SIZE}）` : null,
  )
  return {
    page: pageNumber,
    pageSize,
    offset: (pageNumber - 1) * pageSize,
  }
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  label: string,
  extraCheck: (value: number) => string | null,
): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw invalidInput(`${label}非法：应为整数`)
  }
  if (value < 1) {
    throw invalidInput(`${label}非法：须 ≥ 1`)
  }
  const extra = extraCheck(value)
  if (extra !== null) throw invalidInput(`${label}非法：${extra}`)
  return value
}
