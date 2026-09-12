/**
 * 兴趣标签的人工增 / 删 / 改（mod-007 §3.1「tags/」、§5.5、§5.6；`REQ-008`、`REQ-055`、`REQ-056`、`AC-100`）。
 *
 * **实现层申报项（MOD-002 能力边界）**：MOD-002 只提供「按群 / 全量删除」，没有**记录级删除**；
 * 因此本文把「删 / 改」编码为**墓碑行**：
 * - 墓碑 = `origin = '人工增改'` + 置信度 0 + 证据为空 → `isActiveLink` 判定为失效，不进任何产物与视图；
 * - 墓碑行按 `origin = '人工增改'` 在重算时**不被模型结果覆盖**（否则删除会在下次构建时复活）；
 * - 同一操作重复提交得到同一结果（幂等，§5.6）。
 *
 * 「增」写入人工标签（置信度 = `HUMAN_TAG_CONFIDENCE`，无证据消息但属使用者显式输入，照常生效）。
 */

import type { InterestTag, InterestTagInput, InterestTagAction, PersonInterestTag, TagMergeGroup } from '@shared'

import { socialError } from '../errors'
import { ErrorCode } from '@shared'
import { HUMAN_TAG_CONFIDENCE, TOMBSTONE_CONFIDENCE } from '../scoring'
import { isActiveLink } from '../scoring'
import { normalizeTagName, tagIdOf } from './normalize'
import type { PersonTagLink } from '../scoring'

/** 模块内的兴趣标签编辑入参（HTTP 层由 `Api028Request` 映射而来）。 */
export interface InterestTagEdit {
  memberId: string
  action: InterestTagAction
  /** 标签（增与改时必填：一级维度 + 二级标签名） */
  tag?: InterestTagInput | null
  /**
   * 「删 / 改」的目标标签（模块内补充字段：`api-contract.md` 的 API-028 入参未给出目标标签标识，
   * 缺失时按标签名在本人标签中唯一定位；两处以上命中 → `INVALID_INPUT`）。
   */
  targetTagId?: string | null
}

/** 编辑产出的落库行。 */
export interface InterestTagEditPlan {
  /** 需要写入的 DM-013（新增标签本体；已存在则空） */
  tagRows: InterestTag[]
  /** 需要写入的 DM-014（人工标签或墓碑行） */
  linkRows: PersonInterestTag[]
}

/** 「删 / 改」的定位结果：需要墓碑化的连接集合。 */
export interface LocatedTarget {
  /** 命中的连接（提供替换来源） */
  link: PersonTagLink
  /** 需要覆盖为墓碑的连接（含同一归并组内该人的其余连接） */
  tombstoned: PersonTagLink[]
}

/** 判断一条连接是否是「删」留下的墓碑行。 */
export function isTombstone(link: PersonInterestTag): boolean {
  return link.origin === '人工增改' && !(link.confidence > TOMBSTONE_CONFIDENCE)
}

/** 在本人标签中定位目标（`targetTagId` 优先；缺省按标签名唯一定位）。 */
export function locateInterestTag(input: {
  edit: InterestTagEdit
  personId: string
  links: readonly PersonTagLink[]
  mergeGroups: readonly TagMergeGroup[]
}): LocatedTarget {
  const active = input.links.filter((link) => link.personId === input.personId && isActiveLink(link))
  let found: PersonTagLink | undefined
  if (input.edit.targetTagId !== undefined && input.edit.targetTagId !== null) {
    found = active.find((link) => link.tagId === input.edit.targetTagId)
  } else if (input.edit.tag !== undefined && input.edit.tag !== null) {
    const exact = active.find(
      (link) => link.tagId === tagIdOf(input.edit.tag?.dimension as never, input.edit.tag?.name ?? ''),
    )
    if (exact !== undefined) {
      found = exact
    } else {
      const wanted = normalizeTagName(input.edit.tag.name)
      const byName = active.filter((link) => normalizeTagName(link.name) === wanted)
      if (byName.length > 1) {
        throw socialError(ErrorCode.INVALID_INPUT, '标签名在本人标签中命中多条，无法唯一定位', {
          scope: `social.tag.edit:${input.personId}`,
          context: { matches: byName.map((link) => link.tagId).sort() },
        })
      }
      found = byName[0]
    }
  }
  if (found === undefined) {
    throw socialError(ErrorCode.NOT_FOUND, '目标标签不存在（或对该人不生效）', {
      scope: `social.tag.edit:${input.personId}`,
    })
  }
  const group = input.mergeGroups.find(
    (candidate) =>
      candidate.representativeTagId === found?.tagId || candidate.mergedTagIds.includes(found?.tagId ?? ''),
  )
  const groupTags = group === undefined ? [found.tagId] : [group.representativeTagId, ...group.mergedTagIds]
  const tombstoned = active.filter((link) => groupTags.includes(link.tagId))
  return { link: found, tombstoned: tombstoned.length === 0 ? [found] : tombstoned }
}

/** 规划一次编辑（纯函数：只产出需要写入的行，不触库）。 */
export function planInterestTagEdit(input: {
  edit: InterestTagEdit
  personId: string
  links: readonly PersonTagLink[]
  tags: readonly InterestTag[]
  mergeGroups: readonly TagMergeGroup[]
  now: number
}): InterestTagEditPlan {
  const { edit, personId } = input
  switch (edit.action) {
    case '增':
      return planAdd(input)
    case '删':
      return planRemove(input)
    case '改':
      return planUpdate(input)
    default:
      throw socialError(ErrorCode.INVALID_INPUT, `未知的标签操作：${String(edit.action)}`, {
        scope: `social.tag.edit:${personId}`,
      })
  }
}

function requireTagInput(edit: InterestTagEdit, personId: string): InterestTagInput {
  const tag = edit.tag
  if (tag === undefined || tag === null) {
    throw socialError(ErrorCode.INVALID_INPUT, '标签操作缺少标签（一级维度 + 二级标签名）', {
      scope: `social.tag.edit:${personId}`,
    })
  }
  if (tag.name.trim() === '') {
    throw socialError(ErrorCode.INVALID_INPUT, '标签名不能为空', { scope: `social.tag.edit:${personId}` })
  }
  if (!isKnownDimension(tag.dimension)) {
    throw socialError(ErrorCode.INVALID_INPUT, '一级维度必须落在固定五类内', {
      scope: `social.tag.edit:${personId}`,
      context: { allowed: KNOWN_DIMENSIONS },
    })
  }
  return tag
}

function planAdd(input: {
  edit: InterestTagEdit
  personId: string
  tags: readonly InterestTag[]
  now: number
}): InterestTagEditPlan {
  const tag = requireTagInput(input.edit, input.personId)
  const tagId = tagIdOf(tag.dimension, tag.name)
  const tagRows = input.tags.some((row) => row.tagId === tagId)
    ? []
    : [
        {
          tagId,
          name: tag.name.trim(),
          dimension: tag.dimension,
          mergeGroupId: null,
          firstSeenAt: input.now,
          eventStream: [],
          heatScore: 0,
        } satisfies InterestTag,
      ]
  return {
    tagRows,
    linkRows: [
      {
        personId: input.personId,
        tagId,
        confidence: HUMAN_TAG_CONFIDENCE,
        evidenceMessageIds: [],
        origin: '人工增改',
      },
    ],
  }
}

function planRemove(input: {
  edit: InterestTagEdit
  personId: string
  links: readonly PersonTagLink[]
  mergeGroups: readonly TagMergeGroup[]
}): InterestTagEditPlan {
  const located = locateInterestTag(input)
  return {
    tagRows: [],
    linkRows: located.tombstoned.map((link) => tombstoneRow(input.personId, link.tagId)),
  }
}

function planUpdate(input: {
  edit: InterestTagEdit
  personId: string
  links: readonly PersonTagLink[]
  tags: readonly InterestTag[]
  mergeGroups: readonly TagMergeGroup[]
  now: number
}): InterestTagEditPlan {
  const tag = requireTagInput(input.edit, input.personId)
  const located = locateInterestTag(input)
  const tagId = tagIdOf(tag.dimension, tag.name)
  if (located.link.tagId === tagId && normalizeTagName(located.link.name) === normalizeTagName(tag.name)) {
    // 目标状态与当前状态一致：幂等空操作。
    return { tagRows: [], linkRows: [] }
  }
  const tagRows = input.tags.some((row) => row.tagId === tagId)
    ? []
    : [
        {
          tagId,
          name: tag.name.trim(),
          dimension: tag.dimension,
          mergeGroupId: null,
          firstSeenAt: input.now,
          eventStream: [],
          heatScore: 0,
        } satisfies InterestTag,
      ]
  return {
    tagRows,
    linkRows: [
      ...located.tombstoned
        .map((link) => link.tagId)
        .filter((tagIdOfLink) => tagIdOfLink !== tagId)
        .map((tagIdOfLink) => tombstoneRow(input.personId, tagIdOfLink)),
      {
        personId: input.personId,
        tagId,
        confidence: HUMAN_TAG_CONFIDENCE,
        evidenceMessageIds: [],
        origin: '人工增改',
      },
    ],
  }
}

function tombstoneRow(personId: string, tagId: string): PersonInterestTag {
  return {
    personId,
    tagId,
    confidence: TOMBSTONE_CONFIDENCE,
    evidenceMessageIds: [],
    origin: '人工增改',
  }
}

const KNOWN_DIMENSIONS = ['运动', '艺术', '游戏', '娱乐', '社交'] as const

function isKnownDimension(value: unknown): value is InterestTag['dimension'] {
  return typeof value === 'string' && (KNOWN_DIMENSIONS as readonly string[]).includes(value)
}
