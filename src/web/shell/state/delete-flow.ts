/**
 * 删除流程状态机（`API-005` / `API-006`；mod-004 §4.4 / §5.3、`AC-025` ~ `AC-029`）。
 *
 * 硬口径：
 * - 顺序固定：选择范围 → 预检 → 展示受影响实体与计数 → **二次确认** → 执行。
 * - 二次确认是唯一进入执行态的路径（未确认时页面不发执行请求；服务端仍会兜底拒绝）。
 * - 中断（`DELETION_INTERRUPTED`）只给「已删除部分不可恢复」提示 + 续做入口，不做任何回滚假象。
 * - 缺二次确认（`CONFIRMATION_REQUIRED`）→ 回到待确认态，不视为普通失败。
 * - 采集进行中发起删除：进入执行前页面显示等待态（门控在服务端，页面据进度事件提示）。
 */

import type { DeletionResult, DeletionScope, ErrorEnvelope, PreflightResult } from '@shared'

import type { ShellFailure } from '../api/envelope'
import { isIngestActive, type ShellOperation } from './operations'

/** 删除流程状态。 */
export type DeleteFlowState =
  | { step: 'closed' }
  | { step: 'choose'; scope: DeletionScope | null }
  | { step: 'preflight'; scope: DeletionScope }
  | { step: 'confirm'; scope: DeletionScope; preflight: PreflightResult }
  | { step: 'execute'; scope: DeletionScope; preflight: PreflightResult; resumed: boolean }
  | {
      step: 'interrupted'
      scope: DeletionScope
      preflight: PreflightResult
      result: DeletionResult | null
      failure: ErrorEnvelope | null
    }
  | {
      step: 'failed'
      scope: DeletionScope
      preflight: PreflightResult | null
      failure: ShellFailure
      retry: 'preflight' | 'execute'
    }
  | { step: 'done'; scope: DeletionScope; result: DeletionResult | null }

/** 删除流程事件。 */
export type DeleteFlowEvent =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'pickScope'; scope: DeletionScope | null }
  | { type: 'preflightStart' }
  | { type: 'preflightDone'; preflight: PreflightResult }
  | { type: 'preflightFailed'; failure: ShellFailure }
  | { type: 'cancel' }
  | { type: 'confirm' }
  | { type: 'executeDone'; result: DeletionResult }
  | { type: 'executeInterrupted'; result: DeletionResult | null; failure?: ErrorEnvelope }
  | { type: 'executeFailed'; failure: ShellFailure }
  | { type: 'resume' }
  | { type: 'retry' }
  | { type: 'dismiss' }

/** 初始状态。 */
export const INITIAL_DELETE_FLOW: DeleteFlowState = { step: 'closed' }

/** 删除流程 reducer（纯函数）。 */
export function deleteFlowReducer(state: DeleteFlowState, event: DeleteFlowEvent): DeleteFlowState {
  switch (event.type) {
    case 'open':
      return state.step === 'closed' ? { step: 'choose', scope: null } : state
    case 'close':
    case 'dismiss':
      return { step: 'closed' }
    case 'pickScope':
      return state.step === 'choose' ? { step: 'choose', scope: event.scope } : state
    case 'preflightStart':
      return state.step === 'choose' && state.scope ? { step: 'preflight', scope: state.scope } : state
    case 'preflightDone':
      return state.step === 'preflight' ? { step: 'confirm', scope: state.scope, preflight: event.preflight } : state
    case 'preflightFailed':
      return state.step === 'preflight'
        ? { step: 'failed', scope: state.scope, preflight: null, failure: event.failure, retry: 'preflight' }
        : state
    case 'cancel':
      // 待确认 → 返回选择范围（已取消：不执行、不产生任何删除）。
      return state.step === 'confirm' || state.step === 'failed'
        ? { step: 'choose', scope: state.scope }
        : state
    case 'confirm':
      // 唯一进入执行态的路径。
      return state.step === 'confirm'
        ? { step: 'execute', scope: state.scope, preflight: state.preflight, resumed: false }
        : state
    case 'executeDone':
      return state.step === 'execute' ? { step: 'done', scope: state.scope, result: event.result } : state
    case 'executeInterrupted':
      return state.step === 'execute'
        ? {
            step: 'interrupted',
            scope: state.scope,
            preflight: state.preflight,
            result: event.result,
            failure: event.failure ?? null,
          }
        : state
    case 'executeFailed': {
      if (state.step !== 'execute') return state
      if (event.failure.envelope?.code === 'CONFIRMATION_REQUIRED') {
        return { step: 'confirm', scope: state.scope, preflight: state.preflight }
      }
      return {
        step: 'failed',
        scope: state.scope,
        preflight: state.preflight,
        failure: event.failure,
        retry: 'execute',
      }
    }
    case 'resume':
      return state.step === 'interrupted'
        ? { step: 'execute', scope: state.scope, preflight: state.preflight, resumed: true }
        : state
    case 'retry': {
      if (state.step !== 'failed') return state
      if (state.retry === 'preflight') return { step: 'preflight', scope: state.scope }
      return state.preflight
        ? { step: 'execute', scope: state.scope, preflight: state.preflight, resumed: true }
        : { step: 'preflight', scope: state.scope }
    }
    default:
      return state
  }
}

/** 是否允许发执行请求（仅执行态；配合二次确认规则）。 */
export function canExecute(state: DeleteFlowState): boolean {
  return state.step === 'execute'
}

/** 是否处于「等待采集收尾」：删除在途或预检中，且采集仍在跑（服务端门控在收尾后放行）。 */
export function isWaitingForIngest(state: DeleteFlowState, operations: readonly ShellOperation[]): boolean {
  if (state.step !== 'preflight' && state.step !== 'execute') return false
  return isIngestActive(operations)
}

/** 删除面板的等待 / 进行提示（`null` = 无提示）。 */
export function deleteProgressNote(state: DeleteFlowState, operations: readonly ShellOperation[]): string | null {
  if (state.step === 'preflight' && isIngestActive(operations)) return '采集进行中，将在采集结束后开始预检。'
  if (state.step === 'execute' && isIngestActive(operations)) return '等待采集收尾，采集结束后开始删除。'
  if (state.step === 'execute') return state.resumed ? '正在继续删除剩余数据。' : '正在删除，请保持页面打开。'
  return null
}
