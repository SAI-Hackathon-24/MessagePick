/**
 * 记录级校验与记录 ↔ 行映射（mod-002 §4.1：按登记表逐条校验，产出逐条失败明细）。
 *
 * 校验边界：必填、类型、闭集、JSON 形态、身份非空 —— 不校验业务口径（归属模块负责），
 * 不校验跨记录引用（由外键约束兜底，失败时落单条失败明细，见写入引擎）。
 */

import type { ColumnSpec, SqlValue } from './columns'

/** 单条记录的行值（列名 → SQLite 值）。 */
export type RowValues = Readonly<Record<string, SqlValue>>

/** 校验结果：通过时给出行值；失败时给出原因（写 `WriteFailureDetail.reason`）。 */
export type RowBuildResult = { ok: true; values: RowValues } | { ok: false; reason: string }

/**
 * 按列规格把记录转成行值；失败时给出单条原因（不抛异常）。
 *
 * @param columns 列规格（含内部列；内部列不由记录提供）
 * @param identityFields 身份字段（额外要求非空）
 */
export function buildRowValues(
  columns: readonly ColumnSpec[],
  identityFields: readonly string[],
  record: unknown,
): RowBuildResult {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: '记录不是对象' }
  }
  const source = record as Record<string, unknown>
  const values: Record<string, SqlValue> = {}

  for (const spec of columns) {
    if (spec.internal === true) continue
    const raw = source[spec.field]
    if (raw === undefined || raw === null) {
      if (spec.required) {
        return { ok: false, reason: `必填字段缺失：${spec.field}` }
      }
      const fallback = spec.fallback
      values[spec.column] = fallback === undefined ? null : toSqlValue(spec, fallback)
      continue
    }
    const converted = convertValue(spec, raw)
    if (isFailure(converted)) {
      return { ok: false, reason: converted.reason }
    }
    if (spec.kind === 'text' && identityFields.includes(spec.field) && converted === '') {
      return { ok: false, reason: `身份字段不能为空：${spec.field}` }
    }
    values[spec.column] = converted
  }

  return { ok: true, values }
}

type ConvertResult = SqlValue | { reason: string }

function isFailure(value: ConvertResult): value is { reason: string } {
  return typeof value === 'object' && value !== null && 'reason' in value
}

function convertValue(spec: ColumnSpec, value: unknown): ConvertResult {
  switch (spec.kind) {
    case 'text': {
      if (typeof value !== 'string') return { reason: `类型不符：${spec.field}（应为文本）` }
      if (spec.enumValues !== undefined && !spec.enumValues.includes(value)) {
        return { reason: `取值不在闭集内：${spec.field}=${JSON.stringify(value)}` }
      }
      return value
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
        return { reason: `类型不符：${spec.field}（应为整数）` }
      }
      return value
    }
    case 'real': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { reason: `类型不符：${spec.field}（应为数值）` }
      }
      return value
    }
    case 'bool': {
      if (typeof value !== 'boolean') return { reason: `类型不符：${spec.field}（应为布尔）` }
      return value ? 1 : 0
    }
    case 'json': {
      const shapeOk =
        spec.jsonShape === 'array' ? Array.isArray(value) : isPlainObjectOrArray(value, spec)
      if (!shapeOk) {
        return {
          reason: `JSON 结构不符：${spec.field}（应为${spec.jsonShape === 'array' ? '数组' : '对象'}）`,
        }
      }
      try {
        return JSON.stringify(value)
      } catch {
        return { reason: `JSON 不可序列化：${spec.field}` }
      }
    }
  }
}

function isPlainObjectOrArray(value: unknown, spec: ColumnSpec): boolean {
  if (spec.jsonShape === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
  return typeof value === 'object' && value !== null
}

function toSqlValue(spec: ColumnSpec, value: SqlValue | boolean): SqlValue {
  if (spec.kind === 'bool') return value === true || value === 1 ? 1 : 0
  if (spec.kind === 'json') return JSON.stringify(value)
  return value as SqlValue
}

/** 记录身份（失败明细与去重定位共用；复合键逐段给出）。 */
export function identityOf(
  columns: readonly ColumnSpec[],
  identityFields: readonly string[],
  record: Record<string, unknown>,
): string[] {
  return identityFields.map((field) => {
    const value = record[field]
    if (value === undefined || value === null) return ''
    return String(value)
  })
}

/** 行 → 记录（不含连接表字段；JSON 反序列化、布尔还原）。 */
export function rowToRecord(
  columns: readonly ColumnSpec[],
  row: Record<string, unknown>,
): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const spec of columns) {
    if (spec.internal === true) continue
    const value = row[spec.column]
    if (value === undefined || value === null) {
      record[spec.field] = null
      continue
    }
    switch (spec.kind) {
      case 'bool':
        record[spec.field] = value === 1
        break
      case 'json':
        record[spec.field] = JSON.parse(String(value)) as unknown
        break
      default:
        record[spec.field] = value
    }
  }
  return record
}
