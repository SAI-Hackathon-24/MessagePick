/**
 * MOD-007 错误映射（mod-007 §6；详设 §2.1 / §2.2、`AC-138`）。
 *
 * 覆盖口径：
 * - 只复用 `@shared` 的 14 个错误标识，不新增（`api-contract.md` §1.2）；
 * - 8 个与模块三相关的标识：`NOT_FOUND` / `NO_DATA` / `EMPTY_RESULT` / `IDENTITY_NOT_READY` /
 *   `ANALYSIS_FAILED` / `TIMEOUT` / `SOURCE_UNAVAILABLE` / `INVALID_INPUT`；
 * - 统一信封 `{ code, message, retryable, scope, context }` 与可重试判定（详设 §2.1）。
 */

import { describe, expect, it } from 'vitest'

import { ERROR_CODES, ErrorCode } from '@shared'

import {
  SocialError,
  analysisFailure,
  isSocialError,
  socialError,
  storageUnavailable,
  toErrorEnvelope,
} from '../errors'

/** 任务要求覆盖的 8 个模块三错误标识。 */
const SOCIAL_ERROR_CODES = [
  'NOT_FOUND',
  'NO_DATA',
  'EMPTY_RESULT',
  'IDENTITY_NOT_READY',
  'ANALYSIS_FAILED',
  'TIMEOUT',
  'SOURCE_UNAVAILABLE',
  'INVALID_INPUT',
] as const

describe('模块内错误（错误标识不新增）', () => {
  it('8 个模块三错误标识全部落在契约 14 码闭集内', () => {
    expect(ERROR_CODES).toHaveLength(14)
    for (const code of SOCIAL_ERROR_CODES) {
      expect(ERROR_CODES).toContain(code)
    }
  })

  it('socialError 构造 SocialError：携带标识 / 边界 / 上下文', () => {
    const error = socialError(ErrorCode.NOT_FOUND, '候选不存在', {
      scope: 'social.identity.decision',
      context: { candidateId: 'c1' },
    })

    expect(error).toBeInstanceOf(SocialError)
    expect(isSocialError(error)).toBe(true)
    expect(error.code).toBe('NOT_FOUND')
    expect(error.scope).toBe('social.identity.decision')
    expect(error.context).toEqual({ candidateId: 'c1' })
  })

  it('isSocialError 对普通错误为假', () => {
    expect(isSocialError(new Error('boom'))).toBe(false)
    expect(isSocialError('boom')).toBe(false)
  })
})

describe('可重试判定（详设 §2.1）', () => {
  it('超时 / 分析失败 / 存储不可用 / 来源不可用 → 可重试', () => {
    for (const code of ['TIMEOUT', 'ANALYSIS_FAILED', 'STORAGE_UNAVAILABLE', 'SOURCE_UNAVAILABLE'] as const) {
      expect(socialError(code, 'reason', { scope: 'social' }).retryable).toBe(true)
    }
  })

  it('不存在 / 非法输入 / 无数据 / 空结果 / 身份未就绪 → 不可重试', () => {
    for (const code of [
      'NOT_FOUND',
      'INVALID_INPUT',
      'NO_DATA',
      'EMPTY_RESULT',
      'IDENTITY_NOT_READY',
    ] as const) {
      expect(socialError(code, 'reason', { scope: 'social' }).retryable).toBe(false)
    }
  })

  it('可显式覆盖默认判定', () => {
    expect(socialError(ErrorCode.NOT_FOUND, 'reason', { scope: 'social', retryable: true }).retryable).toBe(true)
  })
})

describe('统一错误信封（详设 §2.2）', () => {
  it('SocialError → 信封保留 code / retryable / scope / context', () => {
    const envelope = toErrorEnvelope(
      socialError(ErrorCode.TIMEOUT, '抽取任务超时', {
        scope: 'social.build.stage',
        context: { taskRef: 'task-1' },
      }),
      'social.fallback',
    )

    expect(envelope).toEqual({
      code: 'TIMEOUT',
      message: '抽取任务超时',
      retryable: true,
      scope: 'social.build.stage',
      context: { taskRef: 'task-1' },
    })
  })

  it('无上下文时不携带 context 键', () => {
    const envelope = toErrorEnvelope(socialError(ErrorCode.NO_DATA, '尚无数据', { scope: 'social' }), 'fallback')
    expect('context' in envelope).toBe(false)
  })

  it('未映射的普通 Error → ANALYSIS_FAILED（重试一次可能成功），scope 取调用边界', () => {
    expect(toErrorEnvelope(new Error('boom'), 'social.query')).toEqual({
      code: 'ANALYSIS_FAILED',
      message: 'boom',
      retryable: true,
      scope: 'social.query',
    })
  })

  it('非 Error 值 → ANALYSIS_FAILED，不新增标识', () => {
    const envelope = toErrorEnvelope(undefined, 'social.query')
    expect(envelope.code).toBe('ANALYSIS_FAILED')
    expect(envelope.retryable).toBe(true)
  })
})

describe('透传与保存任务引用', () => {
  it('storageUnavailable → STORAGE_UNAVAILABLE（不静默失败，REQ-016）', () => {
    const error = storageUnavailable(new Error('打开失败'), 'social.store')
    expect(error.code).toBe('STORAGE_UNAVAILABLE')
    expect(error.message).toBe('打开失败')
  })

  it('storageUnavailable 无原因文本时给出兜底描述', () => {
    expect(storageUnavailable(undefined, 'social.store').message).toBe('存储不可用')
  })

  it('analysisFailure → 指定标识并携带 taskRef（供 API-008 重试）', () => {
    const error = analysisFailure(ErrorCode.ANALYSIS_FAILED, '抽取失败', 'social.extract', 'task-9')
    expect(error.code).toBe('ANALYSIS_FAILED')
    expect(error.context).toEqual({ taskRef: 'task-9' })

    const timeout = analysisFailure(ErrorCode.TIMEOUT, '任务超时', 'social.extract', 'task-9')
    expect(timeout.code).toBe('TIMEOUT')
    expect(timeout.retryable).toBe(true)
  })
})
