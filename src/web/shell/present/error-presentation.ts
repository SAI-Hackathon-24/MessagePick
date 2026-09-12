/**
 * 错误标识 → 统一呈现（唯一实现；`TASK-038`、`AC-035`、mod-004 §6.1）。
 *
 * 放置说明：mod-004 §8 决策 7 要求把「纯展示组件 + 映射常量」发布到 `src/shared/ui/present/`，
 * 由三个模块视图与外壳共同复用；本轮交付边界限定在 `src/web/**`，因此先落在
 * `src/web/shell/present/`：模块只依赖 react 与 `@shared` 类型、不取数、不读外壳状态，
 * 待共享层开放 UI 目录后整体平移（无代码结构调整）。
 *
 * 口径：
 * - `code` 只取 14 个闭集标识；未映射异常（含无信封的网络失败）→ 「未知失败」通用提示 + 请求标识。
 * - 失败 / 超时 → 提示 + 手动重试；无结果 → 空态 + 一键清除筛选；无授权 → 原因 + 手动重试。
 * - 前台不做静默自动重试（详设 §2.3）：`action` 描述的是使用者可点的动作。
 */

import type { ErrorCode, ErrorEnvelope } from '@shared'

import { TERMS } from '../terminology'

/** 呈现类别：失败（含超时、无授权）与空态。 */
export type PresentationKind = 'failure' | 'empty'

/** 使用者可执行的动作（组件按它决定按钮文案与回调）。 */
export type PresentationAction =
  | 'retry'
  | 'retry-source'
  | 'clear-filter'
  | 'update-data'
  | 'back'
  | 'fix-input'
  | 'confirm'
  | 'confirm-material'
  | 'resume'
  | 'refresh'
  | 'none'

/** 单个错误标识的呈现定义。 */
export interface ErrorPresentation {
  kind: PresentationKind
  action: PresentationAction
  /** 默认是否可手动重试（服务端给了 `retryable` 时以其为准）。 */
  retryable: boolean
  /** 面向使用者的标题（中文；不含英文标识）。 */
  title: string
}

/** 结构化的失败信息（`api/envelope.ts` 的失败对象满足此形状）。 */
export interface FailureLike {
  envelope: ErrorEnvelope | null
  requestId?: string | null
}

/** 14 个标识 → 呈现（与 mod-004 §6.1 表格逐条对应）。 */
export const ERROR_PRESENTATIONS: Record<ErrorCode, ErrorPresentation> = {
  NO_AUTH: { kind: 'failure', action: 'retry', retryable: true, title: '数据来源未授权' },
  TIMEOUT: { kind: 'failure', action: 'retry', retryable: true, title: '任务超时' },
  PARTIAL_FAILURE: { kind: 'failure', action: 'retry-source', retryable: true, title: '部分来源失败' },
  ANALYSIS_FAILED: { kind: 'failure', action: 'retry', retryable: true, title: '分析未完成' },
  STORAGE_UNAVAILABLE: { kind: 'failure', action: 'retry', retryable: true, title: '本地存储不可用' },
  NOT_FOUND: { kind: 'failure', action: 'back', retryable: false, title: '内容不存在' },
  INVALID_INPUT: { kind: 'failure', action: 'fix-input', retryable: false, title: '输入不符合要求' },
  CONFIRMATION_REQUIRED: { kind: 'failure', action: 'confirm', retryable: false, title: '缺少二次确认' },
  DELETION_INTERRUPTED: { kind: 'failure', action: 'resume', retryable: true, title: '删除被中断' },
  IDENTITY_NOT_READY: { kind: 'failure', action: 'retry', retryable: true, title: '「我」的身份未就绪' },
  NO_DATA: { kind: 'empty', action: 'update-data', retryable: false, title: '尚无可用数据' },
  EMPTY_RESULT: { kind: 'empty', action: 'clear-filter', retryable: false, title: '没有符合筛选条件的结果' },
  MATERIAL_NOT_CONFIRMED: { kind: 'failure', action: 'confirm-material', retryable: false, title: '成员素材未确认' },
  SOURCE_UNAVAILABLE: { kind: 'failure', action: 'retry', retryable: true, title: '来源不可用' },
}

/** 附带的解释性提示（可选，用于把「不可恢复 / 不自动重试」等口径写在提示里）。 */
export const FAILURE_HINTS: Partial<Record<ErrorCode, string>> = {
  NO_AUTH: '请按来源提示完成授权后手动重试，应用不会静默失败。',
  TIMEOUT: '已缓存的内容仍可浏览；可手动重试本次操作。',
  PARTIAL_FAILURE: '成功的来源已照常可用；可对失败来源单独重试。',
  STORAGE_UNAVAILABLE: '本地存储当前不可用，这不代表没有数据；可稍后重试。',
  INVALID_INPUT: '请按提示修正后重试；该操作不会自动重试。',
  CONFIRMATION_REQUIRED: '删除需要二次确认，未确认不会执行。',
  DELETION_INTERRUPTED: '已删除的部分不可恢复；可重新发起，继续删除剩余数据。',
  IDENTITY_NOT_READY: '「我」的身份就绪后可手动重试。',
  MATERIAL_NOT_CONFIRMED: '请先确认素材，确认后需再次点击生成。',
}

/** 未映射异常的兜底呈现（细节只进日志，页面给通用提示 + 请求标识）。 */
export const UNKNOWN_FAILURE: ErrorPresentation = {
  kind: 'failure',
  action: 'retry',
  retryable: true,
  title: TERMS.unknownFailureTitle,
}

/** 未映射异常的解释文案。 */
export const UNKNOWN_FAILURE_HINT = '细节已记录；可手动重试，如持续出现请凭请求标识排查。'

/** 标识的默认可重试性（服务端未给 `retryable` 时的兜底，规则同详设 §2.1）。 */
export function defaultRetryable(code: ErrorCode): boolean {
  return ERROR_PRESENTATIONS[code].retryable
}

/** 按标识取呈现（`null` / `undefined` → 未映射兜底）。 */
export function presentationForCode(code: ErrorCode | null | undefined): ErrorPresentation {
  if (!code) return UNKNOWN_FAILURE
  return ERROR_PRESENTATIONS[code] ?? UNKNOWN_FAILURE
}

/** 完整的呈现描述（含原因文案与请求标识）。 */
export interface ResolvedFailure {
  presentation: ErrorPresentation
  /** 主提示（服务端 `message`；未映射时为通用文案） */
  reason: string
  /** 额外口径提示（可空） */
  hint: string | null
  /** 请求标识（用于日志检索；未映射异常可能为空） */
  requestId: string | null
  /** 错误标识（只作 `data-` 属性与日志，不进可见文案） */
  code: ErrorCode | null
}

/** 解析失败对象 → 呈现描述（唯一的错误 → 呈现映射入口）。 */
export function resolveFailure(failure: FailureLike): ResolvedFailure {
  const envelope = failure.envelope
  if (!envelope) {
    return {
      presentation: UNKNOWN_FAILURE,
      reason: UNKNOWN_FAILURE.title,
      hint: UNKNOWN_FAILURE_HINT,
      requestId: failure.requestId ?? null,
      code: null,
    }
  }
  const presentation = presentationForCode(envelope.code)
  return {
    presentation: {
      ...presentation,
      retryable: typeof envelope.retryable === 'boolean' ? envelope.retryable : presentation.retryable,
    },
    reason: envelope.message || presentation.title,
    hint: FAILURE_HINTS[envelope.code] ?? null,
    requestId: failure.requestId ?? null,
    code: envelope.code,
  }
}

/** 空态定义（`NO_DATA` / `EMPTY_RESULT` 两种，其余标识不产生空态）。 */
export interface EmptyStateDefinition {
  title: string
  hint: string
  action: Extract<PresentationAction, 'update-data' | 'clear-filter'>
}

/** 按标识取空态定义；非空态标识返回 `null`。 */
export function emptyStateFor(code: ErrorCode): EmptyStateDefinition | null {
  if (code === 'NO_DATA') {
    return {
      title: ERROR_PRESENTATIONS.NO_DATA.title,
      hint: '先完成一次数据更新，再来查看分析结果。',
      action: 'update-data',
    }
  }
  if (code === 'EMPTY_RESULT') {
    return {
      title: ERROR_PRESENTATIONS.EMPTY_RESULT.title,
      hint: '当前筛选条件下没有命中内容，可一键清除筛选恢复完整结果。',
      action: 'clear-filter',
    }
  }
  return null
}
