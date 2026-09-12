/**
 * MOD-008 错误信封（mod-008 §6；详设 §2.2）。
 *
 * 断言口径：错误标识只用契约闭集（14 个）中的 8 个；`scope` / `retryable` 承载重试语义
 * （`task:<任务引用>` 供 `API-008` 重试；生成请求 ID 供拒绝路径的分项展示）。
 */

import { describe, expect, it } from 'vitest'

import { ERROR_CODES, isErrorCode } from '@shared'

import {
  RegenError,
  envelopeOf,
  failAnalysis,
  failEmptyResult,
  failInvalidInput,
  failMaterialNotConfirmed,
  failNotFound,
  failSourceUnavailable,
  failStorageUnavailable,
  failTimeout,
  isRegenError,
} from '../errors'
import { regenEnvelope } from './harness'

describe('MOD-008 失败构造器 → 契约信封（§6 映射表）', () => {
  const cases: Array<{ name: string; run: () => unknown; code: string; retryable: boolean; scope: string }> = [
    {
      name: 'INVALID_INPUT（档位 / 模板 / 筛选非法）',
      run: () => failInvalidInput('档位值不在闭集'),
      code: 'INVALID_INPUT',
      retryable: false,
      scope: 'regen:input',
    },
    {
      name: 'SOURCE_UNAVAILABLE（来源素材缺失 / 媒体不可用）',
      run: () => failSourceUnavailable('精华图片缺失'),
      code: 'SOURCE_UNAVAILABLE',
      retryable: true,
      scope: 'regen:materials',
    },
    {
      name: 'EMPTY_RESULT（候选 / 历史空态）',
      run: () => failEmptyResult('无候选'),
      code: 'EMPTY_RESULT',
      retryable: false,
      scope: 'regen:empty',
    },
    {
      name: 'NOT_FOUND（候选 / 产物不存在）',
      run: () => failNotFound('候选不存在'),
      code: 'NOT_FOUND',
      retryable: false,
      scope: 'regen:lookup',
    },
    {
      name: 'STORAGE_UNAVAILABLE（存储不可用 / 产物持久化失败）',
      run: () => failStorageUnavailable('库忙'),
      code: 'STORAGE_UNAVAILABLE',
      retryable: true,
      scope: 'regen:store',
    },
  ]

  for (const entry of cases) {
    it(`${entry.name} → code=${entry.code}，retryable=${entry.retryable}`, () => {
      const envelope = regenEnvelope(entry.run)
      expect(envelope.code).toBe(entry.code)
      expect(envelope.retryable).toBe(entry.retryable)
      expect(envelope.scope).toBe(entry.scope)
      expect(isErrorCode(envelope.code)).toBe(true)
    })
  }

  it('MATERIAL_NOT_CONFIRMED：scope = 本次生成请求、context.items = 待确认清单（AC-032）', () => {
    const items = [
      { kind: 'memberAvatar', ref: 'member-avatar/m1', memberRef: 'm1', needsConfirmation: true },
      { kind: 'memberPhoto', ref: 'media/photo.png', memberRef: 'm1', originMsgRef: 'msg-1', needsConfirmation: true },
    ]
    const envelope = regenEnvelope(() => failMaterialNotConfirmed('gen-42', items))

    expect(envelope.code).toBe('MATERIAL_NOT_CONFIRMED')
    expect(envelope.retryable).toBe(false) // 拒绝产出：需先确认，重放无效
    expect(envelope.scope).toBe('gen-42')
    expect(envelope.context?.requestId).toBe('gen-42')
    expect(envelope.context?.items).toEqual(items)
  })

  it('ANALYSIS_FAILED / TIMEOUT：凭任务引用经 API-008 重试（scope = task:<任务引用>）', () => {
    const analysis = regenEnvelope(() => failAnalysis('文案变体任务失败', { taskRef: 'task-7' }))
    expect(analysis.code).toBe('ANALYSIS_FAILED')
    expect(analysis.retryable).toBe(true)
    expect(analysis.scope).toBe('task:task-7')

    const timeout = regenEnvelope(() => failTimeout('渲染超时', { taskRef: 'task-7', context: { stage: 'render' } }))
    expect(timeout.code).toBe('TIMEOUT')
    expect(timeout.retryable).toBe(true)
    expect(timeout.scope).toBe('task:task-7')
    expect(timeout.context?.stage).toBe('render')
  })

  it('不带任务引用时失败归入生成请求边界；可显式收窄 retryable', () => {
    expect(regenEnvelope(() => failAnalysis('任务失败')).scope).toBe('regen:generation')
    expect(regenEnvelope(() => failTimeout('超时')).scope).toBe('regen:generation')
    expect(regenEnvelope(() => failAnalysis('x', { retryable: false })).retryable).toBe(false)
  })
})

describe('MOD-008 标识闭集（§6 末节：不新增、不复述、不产生其余六个标识）', () => {
  it('模块产生的全部标识都落在契约 14 个闭集内，且互不重复', () => {
    const produced = [
      regenEnvelope(() => failInvalidInput('x')).code,
      regenEnvelope(() => failSourceUnavailable('x')).code,
      regenEnvelope(() => failMaterialNotConfirmed('gen-x', [])).code,
      regenEnvelope(() => failAnalysis('x')).code,
      regenEnvelope(() => failTimeout('x')).code,
      regenEnvelope(() => failEmptyResult('x')).code,
      regenEnvelope(() => failNotFound('x')).code,
      regenEnvelope(() => failStorageUnavailable('x')).code,
    ]

    for (const code of produced) expect(isErrorCode(code)).toBe(true)
    expect(new Set(produced).size).toBe(produced.length)
    expect(ERROR_CODES).toHaveLength(14)
  })

  it('不产生模块明确排除的六个标识（NO_AUTH / PARTIAL_FAILURE / …）', () => {
    const produced = regenEnvelope(() => failAnalysis('x')).code
    const excluded = [
      'NO_AUTH',
      'PARTIAL_FAILURE',
      'CONFIRMATION_REQUIRED',
      'DELETION_INTERRUPTED',
      'IDENTITY_NOT_READY',
      'NO_DATA',
    ]
    expect(excluded).not.toContain(produced)
    for (const code of excluded) expect(isErrorCode(code)).toBe(true) // 是合法标识但本模块不使用
  })
})

describe('MOD-008 RegenError 与跨模块信封还原（详设 §2.2）', () => {
  function caught(fn: () => unknown): unknown {
    try {
      fn()
    } catch (error) {
      return error
    }
    throw new Error('期望抛出异常，但调用未抛错')
  }

  it('RegenError 是 Error、name 固定、isRegenError 只认本类', () => {
    const error = caught(() => failInvalidInput('输入非法'))
    expect(error).toBeInstanceOf(RegenError)
    expect(error).toBeInstanceOf(Error)
    expect((error as RegenError).name).toBe('RegenError')
    expect((error as RegenError).message).toContain('INVALID_INPUT')
    expect(isRegenError(error)).toBe(true)
    expect(isRegenError(new Error('x'))).toBe(false)
  })

  it('RegenError 原样透传（同一信封对象）', () => {
    const error = caught(() => failStorageUnavailable('存储不可用')) as RegenError
    expect(envelopeOf(error, '兜底')).toBe(error.envelope)
  })

  it('跨模块信封（MOD-002 / MOD-003 等）按结构识别并原样透传', () => {
    const foreign = {
      envelope: { code: 'SOURCE_UNAVAILABLE' as const, message: 'store down', retryable: true, scope: 'store:write' },
    }
    expect(envelopeOf(foreign, '兜底')).toBe(foreign.envelope)
  })

  it('无法识别的异常归入 STORAGE_UNAVAILABLE 兜底（不静默失败，REQ-016）', () => {
    const unknowns: unknown[] = [
      new Error('boom'),
      'boom',
      null,
      { envelope: { code: 'NOT_A_CODE', message: 'x', retryable: true, scope: 's' } },
      { envelope: { code: 'TIMEOUT', message: 'x' } },
    ]
    for (const value of unknowns) {
      expect(envelopeOf(value, '存储不可用')).toEqual({
        code: 'STORAGE_UNAVAILABLE',
        message: '存储不可用',
        retryable: true,
        scope: 'regen:store',
      })
    }
  })
})
