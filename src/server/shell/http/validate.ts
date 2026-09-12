/**
 * 入参校验与归一化（mod-004 §3.1「http/validate.ts」、§4.1、详设 §4.4）。
 *
 * 口径：
 * - HTTP 入参一律先校验（类型 / 长度 / 枚举 / 分页结构），**非法即拒绝、不进业务层**；
 * - 只收 JSON（`express.json` 落地）；查询串用于读接口的筛选与分页；
 * - 拒绝口径 = 闭集内的 `INVALID_INPUT` 信封（`retryable=false`，就地说明含可取值）；
 * - 边界与默认值不在这里发明：分页默认与上限、时间范围语义等由各模块自身口径决定，
 *   外壳只做**结构**校验与「空 = 不限」的归一化（`api-contract.md` §1.3、`AC-014`）。
 */

import type { ErrorEnvelope } from '@shared'
import { INGEST_SOURCES, type Id, type IngestSource, type PageRequest, type SharedFilter } from '@shared'

import { DEFAULT_CONFIG, type SettingsPatch, type ShellConfig } from '../config'
import type { ShellLogLevel } from '../log'

/** 校验失败（信封原样上抛；`http/respond.ts` 的 `envelopeOf` 识别 `.envelope`）。 */
export class InvalidInputError extends Error {
  readonly envelope: ErrorEnvelope

  constructor(message: string, scope: string, context?: Record<string, unknown>) {
    super(message)
    this.name = 'InvalidInputError'
    this.envelope = {
      code: 'INVALID_INPUT',
      message,
      retryable: false,
      scope,
      ...(context === undefined ? {} : { context }),
    }
  }
}

/** 构造 `INVALID_INPUT`（调用方直接 throw）。 */
export function invalidInput(message: string, scope: string, context?: Record<string, unknown>): InvalidInputError {
  return new InvalidInputError(message, scope, context)
}

// ---------------------------------------------------------------------------
// 查询串基础取值（express 5 的 `req.query` 值为 string | string[] | 嵌套对象）
// ---------------------------------------------------------------------------

/** 取同名参数的全部字符串值（重复参数 = 多值；嵌套对象忽略）。 */
export function queryValues(raw: unknown): string[] {
  if (typeof raw === 'string') return [raw]
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string')
  return []
}

/** 取首个非空字符串值（无值返回 `null`）。 */
export function queryFirst(raw: unknown): string | null {
  for (const value of queryValues(raw)) {
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

/** 取整数参数（缺省返回 `null`；非整数抛 `INVALID_INPUT`）。 */
export function queryInt(raw: unknown, field: string, scope: string): number | null {
  const value = queryFirst(raw)
  if (value === null) return null
  if (!/^-?\d+$/.test(value)) {
    throw invalidInput(`参数 ${field} 需为整数`, scope, { field, value })
  }
  return Number.parseInt(value, 10)
}

/** 取枚举参数（闭集外抛 `INVALID_INPUT`，context 带可取值）。 */
export function queryEnum<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[],
  scope: string,
): T | null {
  const value = queryFirst(raw)
  if (value === null) return null
  if (!(allowed as readonly string[]).includes(value)) {
    throw invalidInput(`参数 ${field} 取值不在闭集内`, scope, { field, value, allowed: [...allowed] })
  }
  return value as T
}

// ---------------------------------------------------------------------------
// JSON 体基础取值
// ---------------------------------------------------------------------------

/** 取 JSON 体对象（非对象抛 `INVALID_INPUT`）。 */
export function bodyRecord(body: unknown, scope: string): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalidInput('请求体需为 JSON 对象', scope)
  }
  return body as Record<string, unknown>
}

/** 取字符串字段（缺失返回 `null`；类型不符抛 `INVALID_INPUT`）。 */
export function bodyString(record: Record<string, unknown>, field: string, scope: string): string | null {
  const value = record[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw invalidInput(`字段 ${field} 需为字符串`, scope, { field })
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** 取必填字符串字段（缺失 / 空抛 `INVALID_INPUT`）。 */
export function bodyRequiredString(record: Record<string, unknown>, field: string, scope: string): string {
  const value = bodyString(record, field, scope)
  if (value === null) {
    throw invalidInput(`缺少必填字段 ${field}`, scope, { field })
  }
  return value
}

/** 取布尔字段（缺失返回 `null`；类型不符抛 `INVALID_INPUT`）。 */
export function bodyBoolean(record: Record<string, unknown>, field: string, scope: string): boolean | null {
  const value = record[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') {
    throw invalidInput(`字段 ${field} 需为布尔值`, scope, { field })
  }
  return value
}

/** 取整数字段（缺失返回 `null`；非整数抛 `INVALID_INPUT`）。 */
export function bodyInt(record: Record<string, unknown>, field: string, scope: string): number | null {
  const value = record[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalidInput(`字段 ${field} 需为整数`, scope, { field })
  }
  return value
}

/** 取枚举字段（缺失返回 `null`；闭集外抛 `INVALID_INPUT`）。 */
export function bodyEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  scope: string,
): T | null {
  const value = bodyString(record, field, scope)
  if (value === null) return null
  if (!(allowed as readonly string[]).includes(value)) {
    throw invalidInput(`字段 ${field} 取值不在闭集内`, scope, { field, value, allowed: [...allowed] })
  }
  return value as T
}

/** 取必填枚举字段。 */
export function bodyRequiredEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  scope: string,
): T {
  const value = bodyEnum(record, field, allowed, scope)
  if (value === null) {
    throw invalidInput(`缺少必填字段 ${field}`, scope, { field, allowed: [...allowed] })
  }
  return value
}

// ---------------------------------------------------------------------------
// 全局筛选条件（api-contract.md §1.3；空 = 不限）
// ---------------------------------------------------------------------------

/** 参数名（与页面侧 `api/filter-query.ts` 同一份约定；改名需两边同步）。 */
export const FILTER_QUERY_KEYS = {
  groups: 'groupIds',
  from: 'from',
  to: 'to',
  keyword: 'keyword',
  identity: 'identity',
} as const

/**
 * 归一化筛选条件：四项全空 → `undefined`（不下发）；
 * 时间范围只给一端、或时间戳非数字 → 结构非法（`INVALID_INPUT`）。
 */
export function parseFilter(query: Record<string, unknown>, scope: string): SharedFilter | undefined {
  const filter: {
    groupIds?: Id[]
    timeRange?: { from: number; to: number }
    keyword?: string
    identity?: Id
  } = {}

  const groups = [...new Set(queryValues(query[FILTER_QUERY_KEYS.groups]).map((value) => value.trim()).filter((value) => value.length > 0))]
  if (groups.length > 0) filter.groupIds = groups

  const fromRaw = queryFirst(query[FILTER_QUERY_KEYS.from])
  const toRaw = queryFirst(query[FILTER_QUERY_KEYS.to])
  if (fromRaw !== null || toRaw !== null) {
    if (fromRaw === null || toRaw === null) {
      throw invalidInput('时间范围需同时给出起点与终点', scope, { field: 'timeRange' })
    }
    const from = Number(fromRaw)
    const to = Number(toRaw)
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw invalidInput('时间范围需为 UTC epoch 毫秒数', scope, { field: 'timeRange' })
    }
    filter.timeRange = from <= to ? { from, to } : { from: to, to: from }
  }

  const keyword = queryFirst(query[FILTER_QUERY_KEYS.keyword])
  if (keyword !== null) filter.keyword = keyword
  const identity = queryFirst(query[FILTER_QUERY_KEYS.identity])
  if (identity !== null) filter.identity = identity

  return Object.keys(filter).length > 0 ? filter : undefined
}

/** 归一化分页（结构校验；默认值与上限由各模块口径决定，外壳不改口径）。 */
export function parsePage(query: Record<string, unknown>, scope: string): PageRequest | undefined {
  const page = queryInt(query['page'], 'page', scope)
  const pageSize = queryInt(query['pageSize'], 'pageSize', scope)
  if (page === null && pageSize === null) return undefined
  const result: PageRequest = {}
  if (page !== null) result.page = page
  if (pageSize !== null) result.pageSize = pageSize
  return result
}

// ---------------------------------------------------------------------------
// 各写接口的入参体（API-001 / API-005 / API-006 / 设置补丁）
// ---------------------------------------------------------------------------

/** `POST /api/update` 的入参（`API-001`）。 */
export function parseUpdateRequest(body: unknown, scope: string): { targetSource?: IngestSource | null } {
  if (body === undefined || body === null) return {}
  const record = bodyRecord(body, scope)
  const targetSource = bodyString(record, 'targetSource', scope)
  if (targetSource === null) return {}
  if (!(INGEST_SOURCES as readonly string[]).includes(targetSource)) {
    throw invalidInput('目标来源不在闭集内', scope, { field: 'targetSource', value: targetSource, allowed: [...INGEST_SOURCES] })
  }
  return { targetSource: targetSource as IngestSource }
}

/** 删除范围（`{ kind: 'all' }` 或 `{ kind: 'group', groupId }`）。 */
export type ParsedDeletionScope = { kind: 'all' } | { kind: 'group'; groupId: Id }

/** 解析删除范围（缺 `kind` / 群标识为空 → `INVALID_INPUT`）。 */
export function parseDeletionScope(raw: unknown, scope: string): ParsedDeletionScope {
  const record = bodyRecord(raw, scope)
  const kind = bodyRequiredString(record, 'kind', scope)
  if (kind === 'all') return { kind: 'all' }
  if (kind === 'group') {
    const groupId = bodyRequiredString(record, 'groupId', scope)
    return { kind: 'group', groupId }
  }
  throw invalidInput('删除范围 kind 取值不在闭集内', scope, { field: 'kind', value: kind, allowed: ['all', 'group'] })
}

/** `POST /api/deletions/preflight` 的入参（`API-005`）。 */
export function parsePreflightRequest(body: unknown, scope: string): { scope: ParsedDeletionScope } {
  const record = bodyRecord(body, scope)
  return { scope: parseDeletionScope(record['scope'], scope) }
}

/** `POST /api/deletions` 的入参（`API-006`）。 */
export function parseDeletionRequest(
  body: unknown,
  scope: string,
): { scope: ParsedDeletionScope; confirmed: boolean } {
  const record = bodyRecord(body, scope)
  const scopeValue = parseDeletionScope(record['scope'], scope)
  const confirmed = bodyBoolean(record, 'confirmed', scope)
  // 二次确认是唯一授权凭证：缺失 / 非 true 一律按「未确认」下传，由模块返回 CONFIRMATION_REQUIRED，
  // 外壳不代模块补齐（mod-004 §4.4、AC-027）。
  return { scope: scopeValue, confirmed: confirmed === true }
}

// ---------------------------------------------------------------------------
// 设置补丁（PUT /api/settings）
// ---------------------------------------------------------------------------

const LOG_LEVELS: readonly ShellLogLevel[] = ['error', 'warn', 'info', 'debug']

/**
 * 校验设置补丁（页面侧已先检一遍，这里兜底；校验口径与 `docs/design/impl/detailed-design.md` §7 一致）。
 * 只接受使用者可改项；未列出的键忽略（不静默接受未知语义）。
 */
export function parseSettingsPatch(body: unknown, scope: string): SettingsPatch {
  const record = bodyRecord(body, scope)
  const patch: SettingsPatch = {}

  const modelRaw = record['model']
  if (modelRaw !== undefined && modelRaw !== null) {
    const model = bodyRecord(modelRaw, scope)
    const next: NonNullable<SettingsPatch['model']> = {}
    const baseUrl = bodyString(model, 'baseUrl', scope)
    if (baseUrl !== null) {
      if (!/^https?:\/\/\S+$/i.test(baseUrl)) {
        throw invalidInput('模型服务地址需以 http:// 或 https:// 开头', scope, { field: 'model.baseUrl' })
      }
      next.baseUrl = baseUrl
    }
    const apiKey = bodyString(model, 'apiKey', scope)
    if (apiKey !== null) next.apiKey = apiKey
    const name = bodyString(model, 'name', scope)
    if (name !== null) next.name = name
    const concurrency = bodyInt(model, 'taskConcurrency', scope)
    if (concurrency !== null) {
      if (concurrency < 1 || concurrency > 8) {
        throw invalidInput('模型任务并发上限需为 1 到 8 之间的整数', scope, {
          field: 'model.taskConcurrency',
          allowed: [1, 8],
        })
      }
      next.taskConcurrency = concurrency
    }
    patch.model = next
  }

  const ingestRaw = record['ingest']
  if (ingestRaw !== undefined && ingestRaw !== null) {
    const ingest = bodyRecord(ingestRaw, scope)
    const auto = bodyBoolean(ingest, 'autoTriggerAfterIngest', scope)
    if (auto !== null) patch.ingest = { autoTriggerAfterIngest: auto }
  }

  const logRaw = record['log']
  if (logRaw !== undefined && logRaw !== null) {
    const log = bodyRecord(logRaw, scope)
    const level = bodyEnum(log, 'level', LOG_LEVELS, scope)
    if (level !== null) patch.log = { level }
  }

  return patch
}

/** 配置默认值透出（供设置页的 `DEFAULT_SETTINGS` 断言与测试对照）。 */
export { DEFAULT_CONFIG as SHELL_CONFIG_DEFAULTS }

/** 类型再导出（避免调用方再 import 一次 `../config`）。 */
export type { SettingsPatch, ShellConfig }
