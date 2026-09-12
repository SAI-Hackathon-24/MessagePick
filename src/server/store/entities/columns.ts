/**
 * 列规格与记录 ↔ 行映射的共享类型（mod-002 §3.2 的 `EntityDescriptor` 组成部分）。
 *
 * 一个 `ColumnSpec` 描述「DM 字段 ↔ 表列」的一次绑定：类型、必填、闭集、默认值、是否进变异白名单。
 * 记录 ↔ 行的转换、写入校验、读取装配都由这一份规格驱动 —— 登记表与契约层字段的一致性由测试守住
 * （决策 2 的后果栏）。
 */

/** 列值类型（SQLite STRICT 表允许的存储类）。 */
export type SqlValue = string | number | null

/** 字段类型。 */
export type ColumnKind = 'text' | 'int' | 'real' | 'bool' | 'json'

/** 单列绑定。 */
export interface ColumnSpec {
  /** 记录字段名（`src/shared/entities.ts` 的键）。 */
  field: string
  /** 表列名。 */
  column: string
  kind: ColumnKind
  /** 必填（记录字段不可缺失、不可为 null）。 */
  required: boolean
  /** 闭集取值（文本列的 CHECK 同步使用；写入校验按它拒绝越界值）。 */
  enumValues?: readonly string[]
  /** JSON 结构形态（写入校验用）。 */
  jsonShape?: 'array' | 'object'
  /** 记录字段省略 / 为 null 且非必填时的落库值（默认 null）。 */
  fallback?: SqlValue | boolean
  /** 是否进 upsert 的变异白名单（身份列恒不可变）。 */
  mutable: boolean
  /** 内部列（不由记录提供，由存储侧结构性维护）。 */
  internal?: boolean
  /** 备注（口径出处）。 */
  note?: string
}

/** 便捷构造器（保持规格文件紧凑、同一格式）。 */
export function col(
  field: string,
  column: string,
  spec: Omit<ColumnSpec, 'field' | 'column' | 'required'> & { required?: boolean },
): ColumnSpec {
  return { field, column, required: spec.required ?? true, ...spec }
}

/** 内部列（记录里没有对应字段；写入时由存储侧填）。 */
export function internalCol(
  column: string,
  kind: ColumnKind,
  options: { mutable?: boolean; note?: string } = {},
): ColumnSpec {
  return {
    field: column,
    column,
    kind,
    required: false,
    mutable: options.mutable ?? false,
    internal: true,
    note: options.note,
  }
}
