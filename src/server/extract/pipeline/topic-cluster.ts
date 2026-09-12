/**
 * 主题聚类与命名（mod-006 §3.1「pipeline/topic-cluster.ts」、§8 决策 2）。
 *
 * 口径：
 * - 聚类参数 = 本批新条目的一句话总结 + 事项要素 + 既有主题名清单 + 粒度（同批 3 ~ 12 个主题、
 *   主题名 2 ~ 6 字）；只作用于本批新条目，`API-016` 是既有条目的唯一改写途径。
 * - 既有主题优先复用：每批把「既有主题名清单」注入任务参数，跨批主题名趋同。
 * - `MOD-003` 的聚类不可分块（单次 ≤ 200 单元 / 120 K 字符）：超限时按序号分片多次调用，
 *   后续分片把已命名的主题并入「既有主题」清单，减少跨片命名漂移。
 * - 未覆盖条目给兜底主题 `FALLBACK_TOPIC`（保证「主题非空」；正常路径不产生）。
 */

import type { Api007Request, Id, TaskResultItem } from '@shared'

import {
  CLUSTER_CALL_MAX_CHARS,
  CLUSTER_CALL_MAX_UNITS,
  CLUSTER_MAX_TOPICS,
  CLUSTER_MIN_TOPICS,
  FALLBACK_TOPIC,
  TOPIC_MAX_CHARS,
  TOPIC_MIN_CHARS,
} from '../constants'
import { normalizeTopicName, resolveUnitRefs, type ExtractedDraft } from './recognition'

/** 聚类输入 = 本批新条目（`entryId` 即输入单元标识）。 */
export interface ClusterUnitSource {
  entryId: Id
  text: string
}

/** 聚类任务说明（粒度 + 复用清单由调用方注入）。 */
export function clusterInstruction(existingTopics: readonly string[]): string {
  const reuse =
    existingTopics.length === 0
      ? '当前没有既有主题。'
      : `优先复用以下既有主题名（语义相同必须复用，不要另造近义词）：${existingTopics.join('、')}。`
  return [
    '把输入条目按主题聚类并命名：语义相近的条目归入同一主题。',
    reuse,
    `要求：主题数 ${CLUSTER_MIN_TOPICS}~${CLUSTER_MAX_TOPICS} 个（条目很少时按实际语义合并）；主题名 ${TOPIC_MIN_CHARS}~${TOPIC_MAX_CHARS} 个汉字；覆盖全部输入条目。`,
    '每个条目给出：topic（主题名）与 sourceRefs（该主题下条目的输入单元编号或标识）。',
    '只依据输入条目，不编造主题。',
  ].join('\n')
}

/** 聚类任务结果约束。 */
export function clusterOutputSchema(): Api007Request['params']['outputSchema'] {
  return {
    type: 'object',
    required: ['topic'],
    properties: {
      topic: { type: 'string' },
      sourceRefs: { type: 'array' },
    },
  }
}

/** 由条目草稿构造聚类输入单元（一句话总结 + 事项要素）。 */
export function clusterUnits(drafts: readonly ExtractedDraft[]): ClusterUnitSource[] {
  return drafts.map((draft) => ({
    entryId: draft.entryId,
    text: [draft.headline, draft.subjectElement ?? ''].filter((part) => part.length > 0).join('\n'),
  }))
}

/** 按引擎单次调用上限分片（每次调用一个请求；分片只影响命名稳定度，不影响落库幂等）。 */
export function sliceClusterCalls(units: readonly ClusterUnitSource[]): ClusterUnitSource[][] {
  const slices: ClusterUnitSource[][] = []
  let current: ClusterUnitSource[] = []
  let chars = 0
  for (const unit of units) {
    const tooMany = current.length >= CLUSTER_CALL_MAX_UNITS
    const tooLong = chars + unit.text.length > CLUSTER_CALL_MAX_CHARS && current.length > 0
    if (tooMany || tooLong) {
      slices.push(current)
      current = []
      chars = 0
    }
    current.push(unit)
    chars += unit.text.length
  }
  if (current.length > 0) slices.push(current)
  return slices
}

/** 构造一个分片的聚类任务。 */
export function buildClusterRequest(slice: readonly ClusterUnitSource[], existingTopics: readonly string[]): Api007Request {
  return {
    taskType: '聚类',
    input: {
      kind: '消息集合',
      units: slice.map((unit) => ({ id: unit.entryId, text: unit.text })),
    },
    params: {
      instruction: clusterInstruction(existingTopics),
      outputSchema: clusterOutputSchema(),
      options: {
        language: 'zh',
        minTopics: CLUSTER_MIN_TOPICS,
        maxTopics: CLUSTER_MAX_TOPICS,
        topicNameLength: [TOPIC_MIN_CHARS, TOPIC_MAX_CHARS],
        reuseExisting: true,
      },
    },
  }
}

/** 解析一个聚类分片的结果 → 条目标识 → 主题名。 */
export function parseClusterAssignments(
  items: readonly TaskResultItem[],
  slice: readonly ClusterUnitSource[],
): Map<Id, string> {
  const ids = slice.map((unit) => unit.entryId)
  const assignment = new Map<Id, string>()
  for (const item of items) {
    const topic = normalizeTopicName(item.topic)
    if (topic === null) continue
    for (const entryId of resolveUnitRefs(item, ids)) {
      if (!assignment.has(entryId)) assignment.set(entryId, topic)
    }
  }
  return assignment
}

/** 汇总分片结果并补齐未覆盖条目（兜底主题保证非空）。 */
export function assignTopics(entryIds: readonly Id[], assignments: readonly Map<Id, string>[]): Map<Id, string> {
  const merged = new Map<Id, string>()
  for (const assignment of assignments) {
    for (const [entryId, topic] of assignment) {
      if (!merged.has(entryId)) merged.set(entryId, topic)
    }
  }
  const out = new Map<Id, string>()
  for (const entryId of entryIds) out.set(entryId, merged.get(entryId) ?? FALLBACK_TOPIC)
  return out
}

/** 既有主题名清单（去重、稳定排序；排除本批尚未写入的新条目自然不在此列）。 */
export function distinctTopics(topics: readonly string[]): string[] {
  return [...new Set(topics.filter((topic) => topic.trim().length > 0))].sort()
}
