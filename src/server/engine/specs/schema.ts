/**
 * 任务参数与结果条目的浅校验（mod-003 §3.3「浅校验（required / 类型 / 枚举），多余字段忽略」）。
 *
 * - 引擎只校验**存在性与形状**，不解释业务口径（任务语义与判定标准全部来自调用方，决策 2）。
 * - 结果条目校验以调用方给的 `outputSchema` 的 `type / required / properties / enum` 子集为准；
 *   未知属性、未知 type 字符串一律忽略（详设 §8.2 容错口径）。
 */

import type { TaskOutputSchema, TaskParams } from '@shared'

/** 校验问题（内部诊断用；`path` 不含消息正文）。 */
export interface Issue {
  path: string
  message: string
}

/** 普通对象判定（排除 null / 数组）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 任务参数校验：`instruction` 非空、`outputSchema` 形状合法、`options` 为对象（可缺省）。 */
export function validateTaskParams(params: unknown): Issue[] {
  const issues: Issue[] = []
  if (!isPlainObject(params)) return [{ path: 'params', message: '必须是对象' }]

  if (typeof params.instruction !== 'string' || params.instruction.trim().length === 0) {
    issues.push({ path: 'params.instruction', message: '必须是非空字符串（任务语义与判定口径）' })
  }

  issues.push(...validateOutputSchema(params.outputSchema))

  if (params.options !== undefined && params.options !== null && !isPlainObject(params.options)) {
    issues.push({ path: 'params.options', message: '必须是对象' })
  }

  return issues
}

/** 输出条目字段片段校验：`type` 必填，`required` 为字符串数组，`properties` 为 { type, enum? } 子集。 */
export function validateOutputSchema(schema: unknown): Issue[] {
  const issues: Issue[] = []
  if (!isPlainObject(schema)) return [{ path: 'params.outputSchema', message: '必须是对象' }]

  if (typeof schema.type !== 'string' || schema.type.trim().length === 0) {
    issues.push({ path: 'params.outputSchema.type', message: '必须是非空字符串' })
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== 'string')) {
      issues.push({ path: 'params.outputSchema.required', message: '必须是字符串数组' })
    }
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      issues.push({ path: 'params.outputSchema.properties', message: '必须是对象' })
    } else {
      for (const [name, property] of Object.entries(schema.properties)) {
        if (!isPlainObject(property) || typeof property.type !== 'string') {
          issues.push({ path: `params.outputSchema.properties.${name}`, message: '必须是 { type, enum? }' })
          continue
        }
        if (property.enum !== undefined && (!Array.isArray(property.enum) || property.enum.some((v) => typeof v !== 'string'))) {
          issues.push({ path: `params.outputSchema.properties.${name}.enum`, message: '必须是字符串数组' })
        }
      }
    }
  }

  return issues
}

/** 结果条目浅校验：必填、类型、枚举；多余字段忽略。 */
export function validateItemShape(item: unknown, schema: TaskOutputSchema): Issue[] {
  const issues: Issue[] = []
  if (!isPlainObject(item)) return [{ path: 'item', message: '必须是对象' }]

  for (const name of schema.required ?? []) {
    if (!(name in item)) issues.push({ path: `item.${name}`, message: '缺少必填字段' })
  }

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (!(name in item)) continue
    const value = item[name]
    if (!matchesType(value, property.type)) {
      issues.push({ path: `item.${name}`, message: `类型不符（期望 ${property.type}）` })
      continue
    }
    const allowed = property.enum
    if (allowed && typeof value === 'string' && !allowed.includes(value)) {
      issues.push({ path: `item.${name}`, message: '取值不在闭集内' })
    }
  }

  return issues
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    case 'null':
      return value === null
    default:
      // 未知 type 一律忽略（详设 §8.2：未知字段忽略、可选缺失容错）。
      return true
  }
}
