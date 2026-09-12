/**
 * 共享契约自检（Wave 0 起跑测试）：
 * - 错误标识集合恰为 14 个、无重复、与 api-contract.md §1.2 一致；
 * - 22 个实体类型齐全、无重复，`EntityRecord` 映射可被引用；
 * - API-001 ~ API-034 的入参 / 出参类型全部可被引用（编译期 + 运行期双重校验）；
 * - 顺带验证 `@shared/*` 别名在 vitest / tsc 两条链路上可用（模块统一从 @shared 导入）。
 */

import { describe, expect, it } from 'vitest'

import {
  DIMENSIONS,
  ENTITY_TYPES,
  MEME_KINDS,
  PERSONALITY_DIMENSIONS,
  type EntityRecord,
  type EntityType,
} from '@shared/entities'
import { ERROR_CODES, ErrorCode, isErrorCode } from '@shared/errors'
import type {
  Api001ErrorCode,
  Api001Request,
  Api001Response,
  Api002Response,
  Api003Request,
  Api003Response,
  Api004Request,
  Api004Response,
  Api005Request,
  Api005Response,
  Api006Request,
  Api006Response,
  Api007Request,
  Api007Response,
  Api008Request,
  Api008Response,
  Api009Request,
  Api009Response,
  Api010Request,
  Api010Response,
  Api011Request,
  Api011Response,
  Api012Request,
  Api012Response,
  Api013Request,
  Api013Response,
  Api014Request,
  Api014Response,
  Api015Request,
  Api015Response,
  Api016Request,
  Api016Response,
  Api017Request,
  Api017Response,
  Api018Request,
  Api018Response,
  Api019Request,
  Api019Response,
  Api020Request,
  Api020Response,
  Api021Request,
  Api021Response,
  Api022Request,
  Api022Response,
  Api023Response,
  Api024Request,
  Api024Response,
  Api025Response,
  Api026Request,
  Api026Response,
  Api027Request,
  Api027Response,
  Api028Request,
  Api028Response,
  Api029Request,
  Api029Response,
  Api030Request,
  Api030Response,
  Api031Request,
  Api031Response,
  Api032Request,
  Api032Response,
  Api033Request,
  Api033Response,
  Api034Request,
  Api034Response,
  DeletionScope,
  GroupRef,
  MemeGenerationContext,
  PageInfo,
  PageRequest,
  PreflightResult,
  DeletionResult,
  ReadResult,
  SourceRef,
  TaskInput,
  TaskOutcome,
  TaskParams,
  TaskRef,
  UpdateStatus,
  WriteResult,
} from '@shared/contracts'

/** api-contract.md §1.2 的 14 个标识（顺序即文档表格顺序）。 */
const EXPECTED_ERROR_CODES = [
  'NO_AUTH',
  'TIMEOUT',
  'PARTIAL_FAILURE',
  'ANALYSIS_FAILED',
  'STORAGE_UNAVAILABLE',
  'NOT_FOUND',
  'INVALID_INPUT',
  'CONFIRMATION_REQUIRED',
  'DELETION_INTERRUPTED',
  'IDENTITY_NOT_READY',
  'NO_DATA',
  'EMPTY_RESULT',
  'MATERIAL_NOT_CONFIRMED',
  'SOURCE_UNAVAILABLE',
] as const

/** 34 条 API（API-001 ~ API-034）。 */
const EXPECTED_API_IDS = Array.from({ length: 34 }, (_, i) => `API-${String(i + 1).padStart(3, '0')}`)

describe('错误标识（errors.ts）', () => {
  it('恰为 14 个且无重复', () => {
    expect(ERROR_CODES).toHaveLength(14)
    expect(new Set(ERROR_CODES).size).toBe(14)
  })

  it('与 api-contract.md §1.2 的标识集合一致', () => {
    expect([...ERROR_CODES]).toEqual([...EXPECTED_ERROR_CODES])
  })

  it('ErrorCode 常量对象、联合类型与守卫可用', () => {
    const sample: ErrorCode = ErrorCode.PARTIAL_FAILURE
    expect(sample).toBe('PARTIAL_FAILURE')
    expect(isErrorCode('NO_DATA')).toBe(true)
    expect(isErrorCode('UNKNOWN_FAILURE')).toBe(false)
    expect(isErrorCode(0)).toBe(false)
  })
})

describe('实体类型（entities.ts）', () => {
  it('DM-001 ~ DM-022 共 22 个且无重复', () => {
    expect(ENTITY_TYPES).toHaveLength(22)
    expect(new Set(ENTITY_TYPES).size).toBe(22)
    expect(ENTITY_TYPES[0]).toBe('DM-001')
    expect(ENTITY_TYPES[21]).toBe('DM-022')
  })

  it('EntityRecord 映射可被引用（DM-002 → 群标识 + 群名）', () => {
    const group: EntityRecord<'DM-002'> = { groupId: 'g-1', groupName: '测试群' }
    const type: EntityType = 'DM-002'
    const groupRef: GroupRef = group
    expect(type).toBe('DM-002')
    expect(groupRef.groupName).toBe('测试群')
  })

  it('枚举取值来自文档（示例：类型 / 维度 / 性格六维）', () => {
    expect([...MEME_KINDS]).toEqual(['口头禅', '内部梗', '表情包梗'])
    expect([...DIMENSIONS]).toEqual(['运动', '艺术', '游戏', '娱乐', '社交'])
    expect([...PERSONALITY_DIMENSIONS]).toHaveLength(6)
  })
})

describe('接口契约类型（contracts.ts）', () => {
  it('API-001 ~ API-034 的入参 / 出参类型均可被引用', () => {
    const apiTypes: Record<string, readonly unknown[]> = {
      'API-001': [{} as Api001Request, {} as Api001Response],
      'API-002': [{} as UpdateStatus, {} as Api002Response],
      'API-003': [{} as Api003Request, {} as Api003Response, {} as WriteResult],
      'API-004': [{} as Api004Request, {} as Api004Response, {} as ReadResult],
      'API-005': [{} as Api005Request, {} as Api005Response, {} as PreflightResult],
      'API-006': [{} as Api006Request, {} as Api006Response, {} as DeletionResult],
      'API-007': [{} as Api007Request, {} as Api007Response, {} as TaskInput, {} as TaskParams],
      'API-008': [{} as Api008Request, {} as Api008Response, {} as TaskRef, {} as SourceRef],
      'API-009': [{} as Api009Request, {} as Api009Response],
      'API-010': [{} as Api010Request, {} as Api010Response],
      'API-011': [{} as Api011Request, {} as Api011Response],
      'API-012': [{} as Api012Request, {} as Api012Response],
      'API-013': [{} as Api013Request, {} as Api013Response],
      'API-014': [{} as Api014Request, {} as Api014Response],
      'API-015': [{} as Api015Request, {} as Api015Response],
      'API-016': [{} as Api016Request, {} as Api016Response],
      'API-017': [{} as Api017Request, {} as Api017Response],
      'API-018': [{} as Api018Request, {} as Api018Response],
      'API-019': [{} as Api019Request, {} as Api019Response],
      'API-020': [{} as Api020Request, {} as Api020Response],
      'API-021': [{} as Api021Request, {} as Api021Response],
      'API-022': [{} as Api022Request, {} as Api022Response],
      'API-023': [{} as Api023Response],
      'API-024': [{} as Api024Request, {} as Api024Response],
      'API-025': [{} as Api025Response],
      'API-026': [{} as Api026Request, {} as Api026Response],
      'API-027': [{} as Api027Request, {} as Api027Response],
      'API-028': [{} as Api028Request, {} as Api028Response],
      'API-029': [{} as Api029Request, {} as Api029Response],
      'API-030': [{} as Api030Request, {} as Api030Response],
      'API-031': [{} as Api031Request, {} as Api031Response],
      'API-032': [{} as Api032Request, {} as Api032Response],
      'API-033': [{} as Api033Request, {} as Api033Response],
      'API-034': [{} as Api034Request, {} as Api034Response],
    }

    expect(Object.keys(apiTypes).sort()).toEqual(EXPECTED_API_IDS)
    for (const types of Object.values(apiTypes)) {
      expect(types.length).toBeGreaterThan(0)
    }
  })

  it('公共结构可被引用（分页 / 删除范围 / 生成上下文 / 错误标识联合）', () => {
    const page: PageRequest = { page: 1, pageSize: 50 }
    const pageInfo: PageInfo = { page: 1, pageSize: 50, total: 0 }
    const scope: DeletionScope = { kind: 'all' }
    const context: MemeGenerationContext = {
      memeId: 'm-1',
      interpretation: '示例解读',
      variantMemeIds: [],
      highlightMediaRefs: [],
    }
    const codes: readonly Api001ErrorCode[] = ['NO_AUTH', 'TIMEOUT', 'PARTIAL_FAILURE']
    const outcomeShape: TaskOutcome = {
      ok: false,
      error: { code: 'TIMEOUT', message: '示例', retryable: true, scope: 'task:demo' },
    }

    expect(page.page).toBe(1)
    expect(pageInfo.total).toBe(0)
    expect(scope.kind).toBe('all')
    expect(context.variantMemeIds).toEqual([])
    expect(codes).toHaveLength(3)
    expect(outcomeShape.ok).toBe(false)
  })
})
