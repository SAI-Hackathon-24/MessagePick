/**
 * 契约层错误标识与统一错误信封。
 *
 * 来源：
 * - `docs/design/api-contract.md` §1.2 —— 14 个稳定英文错误标识（一经分配不复用；同一标识在各接口含义一致）。
 * - `docs/design/impl/detailed-design.md` §2.2 —— 跨模块统一错误信封 `{ code, message, retryable, scope, context }`。
 *
 * 硬约束：
 * - 标识集合只有这 14 个：**不新增、不复用**（详设 §2.2）。未映射的内部异常归入「未知失败」的通用提示，
 *   由外壳（MOD-004）在映射层落回既有标识之一并只记录日志，不得在本文件添加新标识。
 * - 面向使用者的呈现由外壳统一负责（mod-004 §6.1）；`message` 不给使用者直接看时只进日志（详设 §2.2）。
 */

/** 14 个错误标识（原样英文常量）。 */
export const ErrorCode = {
  /** 数据来源未授权（给出来源与原因，可手动重试） */
  NO_AUTH: 'NO_AUTH',
  /** 采集 / 任务超时（可重试） */
  TIMEOUT: 'TIMEOUT',
  /** 分来源执行时部分失败（其余来源结果照常返回） */
  PARTIAL_FAILURE: 'PARTIAL_FAILURE',
  /** 分析 / 生成任务失败（含原因分类，可重试） */
  ANALYSIS_FAILED: 'ANALYSIS_FAILED',
  /** 存储不可用 */
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  /** 目标对象不存在（梗 / 条目 / 成员 / 候选 / 标签 / 合并目标，按各接口说明） */
  NOT_FOUND: 'NOT_FOUND',
  /** 输入缺失或非法（含值不在闭集内） */
  INVALID_INPUT: 'INVALID_INPUT',
  /** 缺少二次确认（拒绝执行） */
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  /** 删除中断（已删除部分不可恢复） */
  DELETION_INTERRUPTED: 'DELETION_INTERRUPTED',
  /** 「我」的身份未就绪（提示 + 手动重试） */
  IDENTITY_NOT_READY: 'IDENTITY_NOT_READY',
  /** 尚无可用数据（空态；引导完成首次更新） */
  NO_DATA: 'NO_DATA',
  /** 筛选 / 检索 / 候选为空（空态 + 一键清除筛选） */
  EMPTY_RESULT: 'EMPTY_RESULT',
  /** 成员素材（头像 / 照片 / 原话）未确认，不得产出 */
  MATERIAL_NOT_CONFIRMED: 'MATERIAL_NOT_CONFIRMED',
  /** 素材 / 候选来源不可用（说明原因 + 手动重试） */
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
} as const

/** 错误标识联合类型（与 `ErrorCode` 常量同名，按 TS 惯例值 / 类型双导出）。 */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/** 全部错误标识（顺序与 api-contract.md §1.2 表格一致；长度恒为 14）。 */
export const ERROR_CODES: readonly ErrorCode[] = Object.values(ErrorCode)

/** 运行期守卫：判断任意字符串是否为契约内的错误标识（用于外部输入 / 内部异常的归口校验）。 */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
}

/**
 * 跨模块统一错误信封（详设 §2.2）。
 *
 * - `code`：只取 `ErrorCode` 闭集，不新增。
 * - `message`：一句原因；面向使用者的文案由外壳统一映射（mod-004 §6.1），未映射异常只进日志。
 * - `retryable`：是否可手动重试（判定规则见详设 §2.1：「同一输入重放一次可能成功的 → 可重试」）。
 * - `scope`：失败边界（来源 / 任务引用 / 生成请求……），分项展示与分项重试按 `scope` 聚合（REQ-016）。
 * - `context`：附加上下文（如缺失的入参、需要二次确认的对象）；不得放消息原文、联系人姓名、凭据（详设 §4.3）。
 */
export interface ErrorEnvelope {
  code: ErrorCode
  message: string
  retryable: boolean
  scope: string
  context?: Record<string, unknown>
}
