/**
 * 抽取结果的落点（mod-007 §3.4 阶段 3；DM-013、DM-014；`REQ-052` ~ `REQ-054`、`REQ-057`）。
 *
 * 引擎只回传结构化条目，业务口径全在这里：
 * - 一级维度必须落在五类闭集内（`REQ-052`），越界条目丢弃并计入报告；
 * - **无证据的标签不进入画像**（`REQ-054`）：证据为空 / 全部证据消息不可解析 → 不产出；
 * - 证据消息标识以本地消息索引核对，剔除悬空引用（`REQ-011`）；
 * - 社交维度置信度按活跃度联动（§8 决策 1），其余维度为 `clamp01(强度)`；
 * - 标签首现时间 = 该标签下最早的证据消息发送时间；事件流 = 按自然月分箱的证据条数（不参与分值）。
 */

import { DIMENSIONS, type Dimension, type InterestTag, type PersonInterestTag, type RawMessage, type TaskResult } from '@shared'

import { confidenceOf, roundTo } from '../scoring'
import { tagIdOf } from './normalize'

/** 单条抽取结果的解析上下文。 */
export interface ExtractionContext {
  personId: string
  /** 该人的活跃度（社交维度置信度联动用） */
  activity: number
  /** 消息索引：证据消息标识 → 记录（核对引用、首现时间与事件流用） */
  messages: ReadonlyMap<string, RawMessage>
  /** 现在时刻（无有效证据时间时兜底；正常路径不会用到） */
  now: number
}

/** 抽取产出的落库行与报告。 */
export interface ExtractionOutcome {
  /** 需要写入的标签（同一次抽取内按标签标识去重，取最小首现时间与最大置信度） */
  tags: InterestTag[]
  /** 需要写入的人物兴趣标签（含置信度与证据） */
  links: PersonInterestTag[]
  /** 被丢弃的条目数（维度越界 / 无证据 / 结构非法） */
  dropped: number
}

/** 解析一次抽取任务的结果。 */
export function parseExtraction(result: TaskResult, context: ExtractionContext): ExtractionOutcome {
  const tags = new Map<string, InterestTag>()
  const links = new Map<string, PersonInterestTag>()
  let dropped = 0

  for (const item of result.items) {
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const dimension = typeof item.dimension === 'string' ? item.dimension : ''
    const rawStrength = typeof item.strength === 'number' ? item.strength : Number.NaN
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.filter((value): value is string => typeof value === 'string')
      : []

    if (name === '' || !isDimension(dimension) || Number.isNaN(rawStrength)) {
      dropped += 1
      continue
    }
    const evidenceRows = evidence
      .map((messageId) => context.messages.get(messageId))
      .filter((row): row is RawMessage => row !== undefined)
    if (evidenceRows.length === 0) {
      // 无证据的标签不进入画像（REQ-054）
      dropped += 1
      continue
    }

    const tagId = tagIdOf(dimension, name)
    const firstSeenAt = Math.min(...evidenceRows.map((row) => row.sentAt))
    const eventStream = binEvidenceByMonth(evidenceRows)
    const confidence = confidenceOf(rawStrength, dimension, context.activity)

    const tag = tags.get(tagId)
    if (tag === undefined) {
      tags.set(tagId, {
        tagId,
        name,
        dimension,
        mergeGroupId: null,
        firstSeenAt,
        eventStream,
        heatScore: 0,
      })
    } else {
      tag.firstSeenAt = Math.min(tag.firstSeenAt, firstSeenAt)
      tag.eventStream = mergeEventStreams(tag.eventStream, eventStream)
    }

    if (!(confidence > 0)) {
      dropped += 1
      continue
    }
    const link = links.get(tagId)
    if (link === undefined) {
      links.set(tagId, {
        personId: context.personId,
        tagId,
        confidence,
        evidenceMessageIds: [...new Set(evidenceRows.map((row) => row.messageId))].sort(),
        origin: '模型抽取',
      })
    } else {
      link.confidence = Math.max(link.confidence, confidence)
      link.evidenceMessageIds = [...new Set([...link.evidenceMessageIds, ...evidenceRows.map((row) => row.messageId)])].sort()
    }
  }

  return { tags: [...tags.values()], links: [...links.values()], dropped }
}

/** 事件流：按自然月分箱的证据条数（时间点 = 该月起点，强度 = 条数；不参与任何分值）。 */
export function binEvidenceByMonth(rows: readonly RawMessage[]): InterestTag['eventStream'] {
  const counts = new Map<string, { at: number; strength: number }>()
  for (const row of rows) {
    const date = new Date(row.sentAt)
    const key = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
    const entry = counts.get(key)
    if (entry === undefined) {
      counts.set(key, { at: monthStart, strength: 1 })
    } else {
      entry.strength += 1
    }
  }
  return [...counts.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([, value]) => ({ at: value.at, strength: roundTo(value.strength) }))
}

/** 合并两条事件流（同月求和）。 */
export function mergeEventStreams(
  left: InterestTag['eventStream'],
  right: InterestTag['eventStream'],
): InterestTag['eventStream'] {
  const merged = new Map<number, number>()
  for (const point of [...left, ...right]) {
    merged.set(point.at, (merged.get(point.at) ?? 0) + point.strength)
  }
  return [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, strength]) => ({ at, strength: roundTo(strength) }))
}

/** 一级维度闭集判定（`REQ-052`：固定五类，不增不减）。 */
export function isDimension(value: string): value is Dimension {
  return (DIMENSIONS as readonly string[]).includes(value)
}

/**
 * 合并同一标签在多次写入中的行（跨人抽取时标签本体是共享的）：
 * 首现时间取更早者、事件流按月合并、热度分取更大者。
 */
export function mergeTagRows(existing: InterestTag, incoming: InterestTag): InterestTag {
  return {
    ...existing,
    firstSeenAt: Math.min(existing.firstSeenAt, incoming.firstSeenAt),
    eventStream: mergeEventStreams(existing.eventStream, incoming.eventStream),
    heatScore: Math.max(existing.heatScore, incoming.heatScore),
  }
}
