/**
 * 内部异常 → 契约错误标识的唯一映射点（mod-002 §3.1、§6）。
 *
 * 约定：
 * - `code` 只取 `api-contract.md` §1.2 的既有标识（14 个），不新增、不复述（详设 §2.2）。
 * - 启动期错误（迁移失败 / 库版本过高 / 迁移前备份失败）不是契约标识 → `StoreStartupError`（mod-002 §6）。
 * - 编程错误（事务体返回 Promise、嵌套事务、非主线程打开连接）→ `StoreUsageError`，不上抛为契约标识（决策 1）。
 * - 面向使用者的文案由外壳（MOD-004）统一映射；本文件只给日志口径的 message 与 envelope。
 */

import type { ErrorEnvelope } from '@shared'

/** 统一的存储错误：调用方只处理 `envelope`（详设 §2.2）。 */
export class StoreError extends Error {
  readonly envelope: ErrorEnvelope

  constructor(envelope: ErrorEnvelope) {
    super(`${envelope.code}: ${envelope.message}`)
    this.name = 'StoreError'
    this.envelope = envelope
  }
}

/** 运行期守卫：判断异常是否为 `StoreError`。 */
export function isStoreError(value: unknown): value is StoreError {
  return value instanceof StoreError
}

/** 构造 `STORAGE_UNAVAILABLE`（连接 / 磁盘 / 权限 / busy；按详设 §2.1 给 retryable）。 */
export function storageUnavailable(
  scope: string,
  options: { retryable?: boolean; context?: Record<string, unknown>; cause?: unknown } = {},
): StoreError {
  return new StoreError({
    code: 'STORAGE_UNAVAILABLE',
    message: '存储不可用',
    retryable: options.retryable ?? false,
    scope,
    context: options.context,
  })
}

/** 构造 `INVALID_INPUT`（未知实体类型 / 非法分页 / 非法筛选结构；整次调用拒绝）。 */
export function invalidInput(message: string, context?: Record<string, unknown>): StoreError {
  return new StoreError({
    code: 'INVALID_INPUT',
    message,
    retryable: false,
    scope: 'store:input',
    context,
  })
}

/** 构造 `CONFIRMATION_REQUIRED`（API-006 缺二次确认；不读写库）。 */
export function confirmationRequired(): StoreError {
  return new StoreError({
    code: 'CONFIRMATION_REQUIRED',
    message: '缺少二次确认，删除被拒绝',
    retryable: false,
    scope: 'store:deletion',
  })
}

/** 构造 `DELETION_INTERRUPTED`（库内已提交、提交后清理未完成；附待清理计数）。 */
export function deletionInterrupted(pendingCount: number): StoreError {
  return new StoreError({
    code: 'DELETION_INTERRUPTED',
    message: '删除已提交，但文件清理未完成（已删除部分不可恢复）',
    retryable: true,
    scope: 'store:deletion',
    context: { pendingCount },
  })
}

/** 构造 `NOT_FOUND`（媒体 / 产物引用无对应文件；仅供媒体通道，非 API-003 ~ 006 的错误集）。 */
export function mediaNotFound(ref: string): StoreError {
  return new StoreError({
    code: 'NOT_FOUND',
    message: '媒体引用不存在',
    retryable: false,
    scope: 'store:media',
    context: { ref },
  })
}

/** 判断是否为 SQLite 约束失败（外键 / 唯一 / CHECK）：写入时落单条失败明细，不升级为契约错误。 */
export function isConstraintFailure(error: unknown): boolean {
  const code = sqliteCodeOf(error)
  return code.startsWith('SQLITE_CONSTRAINT')
}

/**
 * 把 SQLite / 文件系统错误分类为 `STORAGE_UNAVAILABLE`：
 * busy / locked 可重试；磁盘满、权限、无法打开不可重试（详设 §2.1）。
 */
export function classifyStorageFailure(error: unknown, scope: string): StoreError {
  const code = sqliteCodeOf(error)
  const retryable =
    code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || code === 'SQLITE_BUSY_SNAPSHOT'
  const reason = code || errorText(error) || 'unknown'
  return storageUnavailable(scope, {
    retryable,
    context: { reason },
  })
}

function sqliteCodeOf(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

/** 启动期错误的原因分类（mod-002 §6 / 详设 §8.1）。 */
export type StoreStartupReason = 'migration-failed' | 'backup-failed' | 'version-too-new'

/** 启动期错误：拒绝启动，不经 HTTP 返回；日志与页面给出恢复指引（详设 §8.1）。 */
export class StoreStartupError extends Error {
  readonly reason: StoreStartupReason
  readonly context: Record<string, unknown>

  constructor(reason: StoreStartupReason, message: string, context: Record<string, unknown> = {}) {
    super(message)
    this.name = 'StoreStartupError'
    this.reason = reason
    this.context = context
  }
}

/** 运行期守卫：判断异常是否为 `StoreStartupError`。 */
export function isStoreStartupError(value: unknown): value is StoreStartupError {
  return value instanceof StoreStartupError
}

/** 编程错误的原因分类（决策 1 的护栏，测试捕获用）。 */
export type StoreUsageReason = 'not-main-thread' | 'async-transaction-body' | 'nested-transaction'

/** 编程错误：不进错误信封、不上抛为契约标识。 */
export class StoreUsageError extends Error {
  readonly reason: StoreUsageReason

  constructor(reason: StoreUsageReason, message: string) {
    super(message)
    this.name = 'StoreUsageError'
    this.reason = reason
  }
}

/** 运行期守卫：判断异常是否为 `StoreUsageError`。 */
export function isStoreUsageError(value: unknown): value is StoreUsageError {
  return value instanceof StoreUsageError
}
