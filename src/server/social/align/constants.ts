/**
 * 身份对齐常量（mod-007 §8 决策 5 的细化取值；全部为模块内常量，不进 `config.json`）。
 */

/** 编辑距离上限（≥ 2 个字符的名称才允许 1 次编辑；更长名称允许 2 次）。 */
export const ALIGN_EDIT_DISTANCE_MAX = 2

/** 包含匹配的最小长度占比（短名不得只占长名的一小部分，避免「李」命中「李四的号」）。 */
export const ALIGN_CONTAINS_MIN_RATIO = 0.5

/** 参与模糊匹配的最小规范化长度。 */
export const ALIGN_MIN_NAME_LENGTH = 2

/** 一个候选至少覆盖的不同群数（决策 5：同一联系人匹配到 ≥ 2 个不同群的群成员才产出候选）。 */
export const ALIGN_MIN_GROUPS = 2
