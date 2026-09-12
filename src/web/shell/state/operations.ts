/**
 * 外壳发起操作的类型与派生口径（mod-004 §3.3 / §4.5 / §5.2；详设 §1.3、CHG-026）。
 *
 * 口径：
 * - 页面只展示**外壳发起**的操作（更新 / 删除 / 预热 / 生成）的排队与在途数量；
 *   模块内部队列深度不进页面（详设 §6.4）。
 * - 快照来自服务端进度通道（事件流或 5 s 轮询），页面不自行推算任务状态。
 * - 该接口形状与 mod-004 §3.3 的服务端 `ShellOperation` 同构；服务端外壳落地后如需共享类型可上收。
 */

import type { ErrorEnvelope } from '@shared'

/** 操作类别（全部由外壳发起）。 */
export type ShellOperationKind = 'ingest' | 'deletion' | 'warmup' | 'generation'

/** 操作状态机（mod-004 §5.2：不产生已取消态）。 */
export type ShellOperationState = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed'

/** 一条外壳操作。 */
export interface ShellOperation {
  id: string
  kind: ShellOperationKind
  /** 失败 / 归属边界（来源 / 群 / 模块 ID / 生成请求） */
  scope: string
  state: ShellOperationState
  counts: { done: number; total?: number }
  error?: ErrorEnvelope
  startedAt: number
  updatedAt: number
}

/** 操作类别 → 使用者可见名称。 */
export const OPERATION_KIND_LABELS: Record<ShellOperationKind, string> = {
  ingest: '数据更新',
  deletion: '数据删除',
  warmup: '后台分析',
  generation: '创作生成',
}

const KINDS: readonly ShellOperationKind[] = ['ingest', 'deletion', 'warmup', 'generation']
const STATES: readonly ShellOperationState[] = ['queued', 'running', 'succeeded', 'partial', 'failed']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 解析一条操作（字段不合法时返回 `null`，不猜、不补）。 */
export function coerceOperation(raw: unknown): ShellOperation | null {
  if (!isRecord(raw)) return null
  const id = raw['id']
  const kind = raw['kind']
  const scope = raw['scope']
  const state = raw['state']
  if (typeof id !== 'string' || !KINDS.includes(kind as ShellOperationKind)) return null
  if (typeof scope !== 'string' || !STATES.includes(state as ShellOperationState)) return null
  const counts = isRecord(raw['counts']) ? raw['counts'] : {}
  const done = typeof counts['done'] === 'number' ? counts['done'] : 0
  const total = typeof counts['total'] === 'number' ? counts['total'] : undefined
  const startedAt = typeof raw['startedAt'] === 'number' ? raw['startedAt'] : 0
  const updatedAt = typeof raw['updatedAt'] === 'number' ? raw['updatedAt'] : startedAt
  const error = isRecord(raw['error']) ? (raw['error'] as unknown as ErrorEnvelope) : undefined
  return {
    id,
    kind: kind as ShellOperationKind,
    scope,
    state: state as ShellOperationState,
    counts: total === undefined ? { done } : { done, total },
    ...(error ? { error } : {}),
    startedAt,
    updatedAt,
  }
}

/** 解析进度快照载荷（事件数据 / 轮询响应体；数组或 `{ operations: [...] }` 都兼容）。 */
export function parseOperationsPayload(raw: unknown): { operations: ShellOperation[] } | null {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  const list = Array.isArray(value) ? value : isRecord(value) ? value['operations'] : null
  if (!Array.isArray(list)) return null
  const operations: ShellOperation[] = []
  for (const item of list) {
    const operation = coerceOperation(item)
    if (operation) operations.push(operation)
  }
  return { operations }
}

/** 排队与在途数量（CHG-026：页面只展示这两类数量）。 */
export function operationSummary(operations: readonly ShellOperation[]): {
  queued: number
  running: number
  failed: number
} {
  let queued = 0
  let running = 0
  let failed = 0
  for (const operation of operations) {
    if (operation.state === 'queued') queued += 1
    else if (operation.state === 'running') running += 1
    else if (operation.state === 'failed') failed += 1
  }
  return { queued, running, failed }
}

/** 是否存在进行中的删除（排队或执行）。 */
export function isDeletionActive(operations: readonly ShellOperation[]): boolean {
  return operations.some(
    (operation) => operation.kind === 'deletion' && (operation.state === 'queued' || operation.state === 'running'),
  )
}

/** 是否存在进行中的数据更新。 */
export function isIngestActive(operations: readonly ShellOperation[]): boolean {
  return operations.some(
    (operation) => operation.kind === 'ingest' && (operation.state === 'queued' || operation.state === 'running'),
  )
}

/** 失败且可重试的操作（进度面板给手动重试入口）。 */
export function failedOperations(operations: readonly ShellOperation[]): ShellOperation[] {
  return operations.filter((operation) => operation.state === 'failed')
}

/**
 * 更新入口的置灰原因（`null` = 可用）。
 *
 * 依据：只读模式（缺启动令牌，详设 §4.1）→ 提示重新打开页面；删除进入等待 / 执行（mod-004 §4.4 门控）
 * → 「删除进行中」（预检与待确认阶段不阻断更新）。
 */
export function updateBlockedReason(
  operations: readonly ShellOperation[],
  readOnly: boolean,
  readOnlyHint: string,
): string | null {
  if (readOnly) return readOnlyHint
  if (isDeletionActive(operations)) return '删除进行中'
  return null
}

/** 生成面板等写入口的置灰原因（只读模式与删除无关：删除不影响生成之外的读取）。 */
export function writeBlockedReason(readOnly: boolean, readOnlyHint: string): string | null {
  return readOnly ? readOnlyHint : null
}
