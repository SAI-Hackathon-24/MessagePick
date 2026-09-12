/**
 * MOD-007 评分层的内部类型（§3.3 的签名级接口用到的输入形态）。
 *
 * 实体本体一律用 `@shared` 的 DM 类型；这里只定义**连接后的视图类型**：
 * 把 DM-014（人物兴趣标签）与其目标标签 DM-013 的列解析到一起，供纯函数直接消费。
 */

import type { Dimension, Id, InterestEventPoint, PairScore, PersonInterestTag, PersonalityDimension, TagOrigin } from '@shared'

/** 标签的「种类」= 其一级维度；`社交` 维度的置信度与活跃度联动（§8 决策 1）。 */
export type TagKind = Dimension

/** 人 ↔ 兴趣的连接行：DM-014 记录 + 解析出的 DM-013 列（名字与一级维度）。 */
export interface PersonTagLink extends PersonInterestTag {
  /** 解析自 DM-013（标签名） */
  name: string
  /** 解析自 DM-013（一级维度） */
  dimension: Dimension
}

/** 有效标签（归并后）：每人每组只出现一次（§5.4「有效标签」）。 */
export interface EffectiveTag {
  /** 归属的人 */
  personId: Id
  /** 代表标签标识（未归并时 = 自身） */
  tagId: Id
  name: string
  dimension: Dimension
  /** 组内最大置信度 */
  confidence: number
  /** 组内证据消息并集（去重、升序） */
  evidenceMessageIds: Id[]
  /** 组内被归入的其他标签（不含代表标签；未归并为空） */
  mergedTagIds: Id[]
}

/** 人的评分输入（DM-011 的最小面）。 */
export interface PersonStats {
  personId: Id
  activity: number
}

/** 「我」的群友评分输入（DM-019 的逐人列表按人遍历用）。 */
export interface FriendStats extends PersonStats {
  /** 是否「我」本人（true 时不由 `overallIntegration` 计入权重） */
  isMe?: boolean
}

/** 两人共同标签（契合度 C 项需要两人各自的置信度）。 */
export interface CommonTag {
  tagId: Id
  name: string
  dimension: Dimension
  confidenceA: number
  confidenceB: number
}

/** 逐维度差值 / 维度分（直接复用契约结构） */
export type { PairScore }

/** 事件流（DM-013）单点 */
export type { InterestEventPoint }

/** 标签来源方式（DM-014） */
export type { TagOrigin }

/** 性格维度（DM-016） */
export type { PersonalityDimension }
