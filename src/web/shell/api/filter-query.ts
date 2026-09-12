/**
 * 全局筛选条件 → 请求参数（`api-contract.md` §1.3、mod-004 §4.2 / §5.1）。
 *
 * 口径：
 * - 四项（群 / 时间范围 / 关键词 / 身份）全部选填；空值一律**不下发**（空 = 不限，`AC-014`）。
 * - 群为多选 → 同名参数重复（`groupIds=a&groupIds=b`）；时间范围拆成 `from` / `to`（UTC epoch 毫秒）。
 * - 单项为空只影响该项，不影响其余三项（`AC-014`）。
 * - 身份为只读项（取自「当前用户」），本模块只在取数时携带，不提供手工设置（`AC-016`）。
 *
 * 参数名只在浏览器侧外壳与服务端外壳之间约定（mod-004 §4.1：路由名不进契约层）；
 * 服务端按 `api-contract.md` §1.3 的结构校验并归一化。
 */

import type { Id, SharedFilter, TimeRange, Timestamp } from '@shared'

/** 筛选条件的查询参数名。 */
export const FILTER_QUERY_KEYS = {
  groups: 'groupIds',
  from: 'from',
  to: 'to',
  keyword: 'keyword',
  identity: 'identity',
} as const

/** 归一化：去空白、去重、去空值；返回值只含有效项（供 store 与请求共用）。 */
export function normalizeFilter(filter: SharedFilter | null | undefined): SharedFilter {
  if (!filter) return {}
  const next: SharedFilter = {}
  const groupIds = (filter.groupIds ?? [])
    .filter((id): id is Id => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
  const uniqueGroups = [...new Set(groupIds)]
  if (uniqueGroups.length > 0) next.groupIds = uniqueGroups
  const range = filter.timeRange
  if (range && Number.isFinite(range.from) && Number.isFinite(range.to)) {
    next.timeRange = range.from <= range.to ? { from: range.from, to: range.to } : { from: range.to, to: range.from }
  }
  const keyword = filter.keyword?.trim()
  if (keyword && keyword.length > 0) next.keyword = keyword
  const identity = filter.identity?.trim()
  if (identity && identity.length > 0) next.identity = identity
  return next
}

/** 是否为空筛选（四项全空 = 不限）。 */
export function isEmptyFilter(filter: SharedFilter | null | undefined): boolean {
  const normalized = normalizeFilter(filter)
  return (
    (normalized.groupIds?.length ?? 0) === 0 &&
    !normalized.timeRange &&
    !normalized.keyword &&
    !normalized.identity
  )
}

/** 生效项数量（用于空态与模块占位提示「已应用 N 项筛选条件」）。 */
export function activeFilterCount(filter: SharedFilter | null | undefined): number {
  const normalized = normalizeFilter(filter)
  let count = 0
  if ((normalized.groupIds?.length ?? 0) > 0) count += 1
  if (normalized.timeRange) count += 1
  if (normalized.keyword) count += 1
  return count
}

/** 生成查询参数列表（空项省略；顺序稳定，便于断言与缓存）。 */
export function buildFilterParams(filter: SharedFilter | null | undefined): Array<[string, string]> {
  const normalized = normalizeFilter(filter)
  const params: Array<[string, string]> = []
  for (const groupId of normalized.groupIds ?? []) params.push([FILTER_QUERY_KEYS.groups, groupId])
  if (normalized.timeRange) {
    params.push([FILTER_QUERY_KEYS.from, String(normalized.timeRange.from)])
    params.push([FILTER_QUERY_KEYS.to, String(normalized.timeRange.to)])
  }
  if (normalized.keyword) params.push([FILTER_QUERY_KEYS.keyword, normalized.keyword])
  if (normalized.identity) params.push([FILTER_QUERY_KEYS.identity, normalized.identity])
  return params
}

/** 把筛选条件附加到请求路径（原有查询串保留；空筛选原样返回）。 */
export function applyFilterParams(url: string, filter: SharedFilter | null | undefined): string {
  const params = buildFilterParams(filter)
  if (params.length === 0) return url
  const search = new URLSearchParams(params).toString()
  return url.includes('?') ? `${url}&${search}` : `${url}?${search}`
}

/** 日期输入框（`YYYY-MM-DD`）→ 时间戳；`edge='start'` 取当天零点，`edge='end'` 取当天最后一毫秒。 */
export function fromDateInputValue(value: string, edge: 'start' | 'end'): Timestamp | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  if (edge === 'end') date.setHours(23, 59, 59, 999)
  return date.getTime()
}

/** 时间戳 → 日期输入框的值（本地时区；无值返回空串）。 */
export function toDateInputValue(value: Timestamp | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const date = new Date(value)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 两个日期输入 → 时间范围；任一为空 / 非法时该项不下发（返回 `null`）。 */
export function timeRangeFromInputs(from: string, to: string): TimeRange | null {
  const start = fromDateInputValue(from, 'start')
  const end = fromDateInputValue(to, 'end')
  if (start === null || end === null) return null
  return start <= end ? { from: start, to: end } : { from: end, to: start }
}
