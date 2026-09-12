/**
 * 出参装配（mod-007 §4「出参按 `api-contract.md` 对应条目」；纯函数、可直接单测）。
 *
 * - 画像：`ProfileView`（二级标签 / 一级维度分 / 爱好雷达 / 词云 / 仅已确认性格标签）；
 * - 人选：`PeopleEntry`（含回复时长与活跃度；未知标记照实列出）；
 * - 兴趣提示：`MemberHint`（仅已确认数据，不含性格、不含候选）。
 *
 * 口径（不得偏离）：
 * - **未确认的性格候选不出现在任何产物与视图**（这里只经 `visiblePersonalityTags` 取数）；
 * - **未知成员不产出任何标签、五维分为 0**（§8 决策 4）；
 * - 关键词：调用方按「昵称命中 → 该人整体命中；未命中 → 按标签名过滤」决定传入哪些标签。
 */

import { TAG_CLOUD_LIMIT, type EffectiveTag } from '../scoring'
import { emptyDimensionScores, dimensionScores } from '../scoring'
import { visiblePersonalityTags } from '../personality'
import type {
  MemberHint,
  PeopleEntry,
  Person,
  PersonalityTag,
  ProfileTagView,
  ProfileView,
  TagCloudEntry,
} from '@shared'

/** 画像装配输入（标签已按窗口 / 关键词口径筛过；性格标签传原始行）。 */
export interface ProfileInputs {
  person: Person
  /** 已按窗口口径处理过的有效标签 */
  tags: readonly EffectiveTag[]
  /** DM-016 原始行（含候选与墓碑；本函数只取「已确认」） */
  personality: readonly PersonalityTag[]
  /** 未知标记（窗口重算后的口径） */
  unknown: boolean
}

/** 组装画像（`API-020` / `API-028` 共用；`radar` 与 `dimensionScores` 同源）。 */
export function profileViewOf(input: ProfileInputs): ProfileView {
  const tags = input.unknown ? [] : [...input.tags]
  const scores = input.unknown ? emptyDimensionScores() : dimensionScores(tags)
  return {
    secondaryTags: secondaryTagsOf(tags),
    dimensionScores: scores,
    radar: { ...scores },
    tagCloud: tagCloudOf(tags),
    personalityTags: visiblePersonalityTags(input.personality, input.person.personId),
  }
}

/** 二级标签视图（按标签标识稳定排序）。 */
export function secondaryTagsOf(tags: readonly EffectiveTag[]): ProfileTagView[] {
  return [...tags].sort(byTagId).map((tag) => ({
    tagId: tag.tagId,
    name: tag.name,
    dimension: tag.dimension,
    confidence: tag.confidence,
    evidenceMessageIds: [...tag.evidenceMessageIds].sort(),
  }))
}

/** 个人标签词云（权重 = 置信度；按权重降序，取数上限 `TAG_CLOUD_LIMIT`，§5.4）。 */
export function tagCloudOf(tags: readonly EffectiveTag[]): TagCloudEntry[] {
  return [...tags]
    .sort((left, right) => right.confidence - left.confidence || byTagId(left, right))
    .slice(0, TAG_CLOUD_LIMIT)
    .map((tag) => ({ tagId: tag.tagId, name: tag.name, weight: tag.confidence }))
}

/** 人选条目（`API-021`）。 */
export function peopleEntryOf(input: {
  person: Person
  displayName: string
  activity: number
  unknown: boolean
}): PeopleEntry {
  return {
    personId: input.person.personId,
    displayName: input.displayName,
    replyMedianMs: input.person.replyMedianMs,
    activity: input.activity,
    unknown: input.unknown,
  }
}

/** 成员兴趣提示（`API-029`；只含已确认数据）。 */
export function hintOf(memberId: string, tags: readonly EffectiveTag[]): MemberHint {
  return { memberId, tags: secondaryTagsOf(tags) }
}

/** 关键词规范化（空串 = 不限）。 */
export function normalizeKeyword(keyword: string | null | undefined): string | null {
  if (keyword === undefined || keyword === null) return null
  const trimmed = keyword.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

/** 包含判定（大小写无关；中文原样）。 */
export function containsKeyword(haystack: string, keyword: string): boolean {
  return haystack.toLowerCase().includes(keyword)
}

function byTagId(left: { tagId: string }, right: { tagId: string }): number {
  return left.tagId < right.tagId ? -1 : left.tagId > right.tagId ? 1 : 0
}
