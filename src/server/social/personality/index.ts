/**
 * 性格标签（mod-007 §3.1「personality/」、§5.3 状态机、§8 决策 4；DM-016、`REQ-074` ~ `REQ-077`、`AC-120` ~ `AC-123`）。
 *
 * - **六维闭集固定**（领导式 / 活泼 / 幽默 / 冷静 / 理性 / 判断）：越界值一律 `INVALID_INPUT` 并回传可取值（`AC-120`）；
 * - 推断任务只产出**候选**（状态 = 候选）；**未确认记录不进任何产物与视图**（`REQ-075`）；
 * - 「确认 / 增 / 删 / 改」全部由使用者发起、即时生效（`REQ-076`）；删除 = **墓碑行**
 *   （MOD-002 只提供按群 / 全量删除，没有记录级删除；同款申报见 `tags/edits.ts`）：
 *   `status = 候选` + `score = 0` + `origin = 人工增改` → `confirmedPersonalityTags` 判定为失效；
 * - 已确认 / 人工增改行**不被推断重算覆盖**（否则确认与删除会在下次构建时被推翻）；
 * - 性格标签与分数的可见面仅限 `API-020` 的外呼返回；`API-029` 与任何列表接口不含（`REQ-077`、§2）。
 */

import {
  ErrorCode,
  PERSONALITY_DIMENSIONS,
  type PersonalityDimension,
  type PersonalityScores,
  type PersonalityTag,
  type PersonalityTagAction,
  type PersonalityTagView,
  type TaskResult,
} from '@shared'

import { socialError } from '../errors'
import { clamp01, roundTo } from '../scoring'

/** 模块内的性格标签编辑入参（`http/` 由 `Api027Request` 映射而来）。 */
export interface PersonalityEdit {
  memberId: string
  action: PersonalityTagAction
  /** 六维标签；「删」以外必填（闭集校验在此拒绝，`AC-120`） */
  dimension?: PersonalityDimension | null
  /**
   * 「改 / 删」的目标维度（模块内补充字段：`api-contract.md` 的 API-027 入参未给出目标标识）。
   * 缺省时「删」按 `dimension` 定位；「改」按「唯一候选行 → 入参维度所在行」的顺序定位，
   * 候选行多条且无法唯一定位 → `INVALID_INPUT`（同 `tags/edits.ts` 的定位口径）。
   */
  targetDimension?: PersonalityDimension | null
}

/** 人工增改的性格标签分数（使用者显式标注视为完全可信；与兴趣标签的 `HUMAN_TAG_CONFIDENCE` 同口径）。 */
export const HUMAN_PERSONALITY_SCORE = 1

/** 性格标签标识（DM-016 记录身份键的派生形式：人物 + 维度，全库唯一且稳定）。 */
export function personalityTagIdOf(personId: string, dimension: PersonalityDimension): string {
  return `pt:${personId}:${dimension}`
}

/** 六维闭集判定。 */
export function isPersonalityDimension(value: unknown): value is PersonalityDimension {
  return typeof value === 'string' && (PERSONALITY_DIMENSIONS as readonly string[]).includes(value)
}

/** 闭集校验：越界 → `INVALID_INPUT`，`context.allowed` 回传可取值（`AC-120`）。 */
export function assertPersonalityDimension(value: unknown, scope: string): PersonalityDimension {
  if (!isPersonalityDimension(value)) {
    throw socialError(ErrorCode.INVALID_INPUT, '性格标签维度不在六维闭集内', {
      scope,
      context: { allowed: [...PERSONALITY_DIMENSIONS] },
    })
  }
  return value
}

/** 墓碑判定：人工删除留下的行（状态 = 候选、分数 0、来源 = 人工增改）→ 不出现、不被重算复活。 */
export function isPersonalityTombstone(row: PersonalityTag): boolean {
  return row.origin === '人工增改' && row.status === '候选' && !(row.score > 0)
}

/** 该人状态为「已确认」的性格标签（进入产物与视图的集合；`REQ-075`）。 */
export function confirmedPersonalityTags(
  rows: readonly PersonalityTag[],
  personId: string,
): PersonalityTag[] {
  return rows
    .filter((row) => row.personId === personId && row.status === '已确认' && row.score > 0)
    .sort((left, right) => (left.dimension < right.dimension ? -1 : 1))
}

/** 对外的性格标签视图（仅已确认；未确认候选在任何出参中不可达，重点断言④）。 */
export function visiblePersonalityTags(
  rows: readonly PersonalityTag[],
  personId: string,
): PersonalityTagView[] {
  return confirmedPersonalityTags(rows, personId).map((row) => ({
    tagId: row.tagId,
    dimension: row.dimension,
    score: row.score,
  }))
}

/** 契约层对外的性格标签状态（= 契约 `PersonalityTagView`；设计签名 `PersonalityTagState` 的落点）。 */
export type PersonalityTagState = PersonalityTagView

/** 性格六维分 = 已确认记录分数之和（DM-011「性格维度分」；`REQ-080`）。 */
export function personalityScoresOf(rows: readonly PersonalityTag[]): PersonalityScores {
  const scores = {} as PersonalityScores
  for (const dimension of PERSONALITY_DIMENSIONS) scores[dimension] = 0
  for (const row of rows) {
    if (row.status !== '已确认' || !(row.score > 0)) continue
    scores[row.dimension] = roundTo(scores[row.dimension] + row.score)
  }
  return scores
}

/** 一次推断任务的解析结果。 */
export interface PersonalityInferenceOutcome {
  /** 状态 =「候选」的推断行（每人每维度至多一条） */
  rows: PersonalityTag[]
  /** 被丢弃的条目数（维度越界 / 强度非法 / 强度为 0） */
  dropped: number
}

/**
 * 解析性格推断任务的结果（§3.4 阶段 6）：
 * 条目形如 `{ dimension, strength }`；维度越界或强度非法的条目丢弃并计数；每组取最大强度。
 */
export function parsePersonalityInference(result: TaskResult, personId: string): PersonalityInferenceOutcome {
  const byDimension = new Map<PersonalityDimension, PersonalityTag>()
  let dropped = 0
  for (const item of result.items) {
    const dimension = item.dimension
    const raw =
      typeof item.strength === 'number'
        ? item.strength
        : typeof item.score === 'number'
          ? item.score
          : Number.NaN
    if (!isPersonalityDimension(dimension) || Number.isNaN(raw)) {
      dropped += 1
      continue
    }
    const score = roundTo(clamp01(raw))
    if (!(score > 0)) {
      dropped += 1
      continue
    }
    const previous = byDimension.get(dimension)
    if (previous === undefined || score > previous.score) {
      byDimension.set(dimension, {
        tagId: personalityTagIdOf(personId, dimension),
        personId,
        dimension,
        score,
        status: '候选',
        origin: '模型推断',
      })
    }
  }
  return {
    rows: [...byDimension.values()].sort((left, right) =>
      left.dimension < right.dimension ? -1 : 1,
    ),
    dropped,
  }
}

/**
 * 把推断结果合并到既有记录：只写需要变更的行（幂等、可重入）。
 *
 * - 人工增改行（含墓碑）**不覆盖**；
 * - 已确认行**不覆盖**（使用者确认过的状态与分数不带回候选）；
 * - 其余（新维度 / 既有候选）按最新推断更新。
 */
export function applyInferredCandidates(
  existing: readonly PersonalityTag[],
  inferred: readonly PersonalityTag[],
): PersonalityTag[] {
  const byTagId = new Map(existing.map((row) => [row.tagId, row]))
  const rows: PersonalityTag[] = []
  for (const row of inferred) {
    const current = byTagId.get(row.tagId)
    if (current === undefined) {
      rows.push(row)
      continue
    }
    if (current.origin === '人工增改') continue
    if (current.status === '已确认') continue
    rows.push({ ...row, tagId: current.tagId })
  }
  return rows
}

/** 一次编辑的落库计划（纯函数：只产出需要写入的行，不触库）。 */
export interface PersonalityEditPlan {
  /** 需要写入的 DM-016 行（0 ~ 2 行；空 = 幂等空操作） */
  rows: PersonalityTag[]
}

/**
 * 规划一次性格标签编辑（`API-027`）：
 * - 「确认」：按 `dimension` 定位 + 置「已确认」；
 * - 「增」：按 `dimension` 新增（已存在且已确认时幂等空操作）；
 * - 「删」：按 `targetDimension ?? dimension` 定位 + 墓碑化（找不到 → `NOT_FOUND`）；
 * - 「改」：目标行以 `dimension` 为准重写为「已确认 + 人工分数 + 人工增改」；
 *   目标维度变化时旧行墓碑化（MOD-002 无记录级删除，见文件头）。
 */
export function planPersonalityEdit(input: {
  edit: PersonalityEdit
  personId: string
  existing: readonly PersonalityTag[]
  now: number
}): PersonalityEditPlan {
  const { edit, personId } = input
  const scope = `social.personality.edit:${personId}`
  const mine = input.existing.filter((row) => row.personId === personId)
  switch (edit.action) {
    case '确认': {
      const dimension = assertPersonalityDimension(edit.dimension, scope)
      const current = mine.find((row) => row.dimension === dimension)
      if (current === undefined) {
        throw socialError(ErrorCode.NOT_FOUND, '性格标签不存在（该维度没有可确认的记录）', { scope })
      }
      if (current.status === '已确认' && !isPersonalityTombstone(current)) return { rows: [] }
      return { rows: [{ ...current, status: '已确认', score: current.score > 0 ? current.score : HUMAN_PERSONALITY_SCORE }] }
    }
    case '增': {
      const dimension = assertPersonalityDimension(edit.dimension, scope)
      const current = mine.find((row) => row.dimension === dimension)
      if (current === undefined) {
        return {
          rows: [
            {
              tagId: personalityTagIdOf(personId, dimension),
              personId,
              dimension,
              score: HUMAN_PERSONALITY_SCORE,
              status: '已确认',
              origin: '人工增改',
            },
          ],
        }
      }
      if (current.status === '已确认' && !isPersonalityTombstone(current)) return { rows: [] }
      return {
        rows: [
          {
            ...current,
            status: '已确认',
            origin: '人工增改',
            score: current.score > 0 ? current.score : HUMAN_PERSONALITY_SCORE,
          },
        ],
      }
    }
    case '删': {
      const dimension = assertPersonalityDimension(edit.targetDimension ?? edit.dimension, scope)
      const target = mine.find((row) => row.dimension === dimension)
      if (target === undefined) {
        throw socialError(ErrorCode.NOT_FOUND, '性格标签不存在', { scope })
      }
      if (isPersonalityTombstone(target)) return { rows: [] }
      return { rows: [tombstoneOf(target)] }
    }
    case '改': {
      const dimension = assertPersonalityDimension(edit.dimension, scope)
      const target = locateEditTarget(edit, mine, scope) ?? mine.find((row) => row.dimension === dimension)
      if (target === undefined) {
        throw socialError(ErrorCode.NOT_FOUND, '性格标签不存在（没有可修改的记录）', { scope })
      }
      const rows: PersonalityTag[] = []
      if (target.dimension !== dimension && !isPersonalityTombstone(target)) {
        rows.push(tombstoneOf(target))
      }
      rows.push({
        tagId: personalityTagIdOf(personId, dimension),
        personId,
        dimension,
        score: HUMAN_PERSONALITY_SCORE,
        status: '已确认',
        origin: '人工增改',
      })
      return { rows }
    }
    default:
      throw socialError(ErrorCode.INVALID_INPUT, `未知的性格标签操作：${String(edit.action)}`, { scope })
  }
}

/** 「改」的目标定位：`targetDimension` → 唯一候选行；多条候选且无法唯一定位 → `INVALID_INPUT`。 */
function locateEditTarget(
  edit: PersonalityEdit,
  mine: readonly PersonalityTag[],
  scope: string,
): PersonalityTag | undefined {
  if (edit.targetDimension !== undefined && edit.targetDimension !== null) {
    const dimension = assertPersonalityDimension(edit.targetDimension, scope)
    return mine.find((row) => row.dimension === dimension)
  }
  const candidates = mine.filter((row) => row.status === '候选' && row.origin === '模型推断' && row.score > 0)
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) {
    if (edit.dimension !== undefined && edit.dimension !== null) {
      const dimension = assertPersonalityDimension(edit.dimension, scope)
      const hit = candidates.find((row) => row.dimension === dimension)
      if (hit !== undefined) return hit
    }
    throw socialError(ErrorCode.INVALID_INPUT, '性格候选存在多条，无法唯一定位（请给出目标维度）', {
      scope,
      context: { candidates: candidates.map((row) => row.dimension).sort() },
    })
  }
  return undefined
}

function tombstoneOf(row: PersonalityTag): PersonalityTag {
  return { ...row, score: 0, status: '候选', origin: '人工增改' }
}
