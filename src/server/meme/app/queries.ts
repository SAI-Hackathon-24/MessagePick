/**
 * 用例编排：5 条契约接口的查询处理器（mod-005 §3.1「app/ —— 唯一的业务编排层」、§4）。
 *
 * - 全部读取经 `API-003` / `API-004`（`MemeStore`），不出现数据库驱动；
 * - 派生计算全部下沉 `domain/*` 纯函数；
 * - 空态 / 错误按 §6 映射：`NO_DATA`（忽略筛选时 DM-003 为空）、`EMPTY_RESULT`（筛选无命中）、
 *   `NOT_FOUND`（不存在 / 已删除 / 已合并 / 不是梗）；
 * - 大结果集聚合按 §3.6 选择 worker 或主线程分批。
 */

import type { Id, Meme, MemeOccurrence, RawMessage, SharedFilter, Timestamp } from '@shared'

import {
  LIFECYCLE_MAX_ROWS,
  MINE_MAX_TERMS,
  REF_READ_WINDOW_MS,
  WORDCLOUD_MAX_TERMS,
} from '../constants'
import {
  buildCloudTerms,
  computeCellMetrics,
  computeLifecycle,
  computeMemeKing,
  fillMonthlyCounts,
  foldMemeStats,
  incompleteMonths,
  pickHighlights,
  pickLeadingMemes,
  sortTermsByLayout,
  type FoldedMeme,
  type LifecycleSource,
} from '../domain/metrics'
import { legendOf } from '../domain/typeCatalog'
import { resolveVisibility, type VisibilityIndex } from '../domain/visibility'
import { collectRead } from '../store/paging'
import type { CellOutput, CellQueryInput, CloudOutput, CloudQueryInput, LifecycleOutput, LifecycleQueryInput, MineOutput, MineQueryInput } from '../types'
import { aggregateCounts, aggregateOccurrences } from '../worker/aggregate'
import type { MemeDeps } from './context'
import { emptyResult, identityNotReady, noData, notFound } from './errors'

const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// API-009 查询梗词云
// ---------------------------------------------------------------------------

export async function queryCloud(deps: MemeDeps, input: CloudQueryInput): Promise<CloudOutput> {
  const filter = input.filter ?? null
  const basis = input.sizeBasis ?? '累计出现次数'

  if (!(await hasAnyData(deps))) throw noData('meme:cloud')

  const memeRead = deps.store.readAll(
    'DM-006',
    { groupIds: filter?.groupIds ?? null, keyword: filter?.keyword ?? null },
    deps.limits.readHardCap,
  )
  const memes = await collectRead(memeRead)
  const index = resolveVisibility(memes.records, warnSink(deps))

  // 出现记录：一次全局读取（时间窗口径与来源引用共用，§4 API-009 步骤②）
  const occurrenceRead = deps.store.readAll(
    'DM-007',
    {
      groupIds: filter?.groupIds ?? null,
      timeRange: filter?.timeRange ?? null,
      identity: filter?.identity ?? null,
    },
    deps.limits.readHardCap,
  )
  const occurrences = await collectRead(occurrenceRead)
  const aggregateInput = {
    occurrences: occurrences.records.map((record) => ({
      memeId: record.memeId,
      sourceMessageId: record.sourceMessageId,
    })),
    rootOf: rootOfMap(memes.records, index),
  }
  // 预估记录数 > 阈值 → worker；否则主线程（§3.6）
  const aggregation =
    occurrences.records.length > deps.limits.aggregateWorkerThreshold
      ? await aggregateOccurrences(aggregateInput, deps.aggregate)
      : aggregateCounts(aggregateInput)

  const chains = foldChains(memes.records, index)
  let sources = [...chains.entries()].map(([rootId, members]) => foldMemeStats(rootOf(members, rootId), members.filter((meme) => meme.memeId !== rootId)))

  // 时间 / 身份筛选：只保留在筛选范围内有出现记录的根（§4 API-009：时间窗口径由 DM-007 读取承担）
  if (filter?.timeRange != null || filter?.identity != null) {
    sources = sources.filter((source) => (aggregation.counts[source.memeId] ?? 0) > 0)
  }

  const useWindow = basis === '指定时间窗内出现频次' && filter?.timeRange != null
  const frequencies = useWindow ? toNumberMap(aggregation.counts) : null
  const terms = sortTermsByLayout(buildCloudTerms(sources, frequencies), input.layout)

  if (terms.length === 0) throw emptyResult('meme:cloud')

  return {
    terms,
    legend: legendOf(terms.map((term) => term.kind)),
    sourceMessageIds: aggregation.messageIds,
    truncated: terms.length > WORDCLOUD_MAX_TERMS || memes.truncated || occurrences.truncated,
    total: terms.length,
  }
}

// ---------------------------------------------------------------------------
// API-010 查询梗单元
// ---------------------------------------------------------------------------

export async function queryCell(deps: MemeDeps, input: CellQueryInput): Promise<CellOutput> {
  const filter = input.filter ?? null
  const now = new Date(deps.clock())

  const memes = await collectRead(
    deps.store.readAll('DM-006', { groupIds: filter?.groupIds ?? null }, deps.limits.readHardCap),
  )
  const byId = new Map<Id, Meme>()
  for (const meme of memes.records) byId.set(meme.memeId, meme)

  const index = resolveVisibility(memes.records, warnSink(deps))
  const entry = index.entryOf(input.memeId)
  // NOT_FOUND 三情形：不存在 / 已删除、被判「不是梗」、已合并至（AC-045）
  if (entry === undefined || entry.state === 'excluded' || entry.mergedAway || entry.rootId === null) {
    throw notFound('meme:cell', '梗不存在或不可直接访问', { memeId: input.memeId })
  }

  const root = byId.get(entry.rootId)
  if (root === undefined) throw notFound('meme:cell', '梗不存在或不可直接访问', { memeId: input.memeId })

  const chain = memes.records.filter((meme) => meme.memeId === root.memeId || index.rootOf(meme.memeId) === root.memeId)
  const chainIds = new Set(chain.map((meme) => meme.memeId))
  const folded = foldMemeStats(root, chain.filter((meme) => meme.memeId !== root.memeId))

  // 出现记录：生命周期窗口内一次读取（周环比 / 梗王 / 引用回读共用）
  const occurrences = await collectRead(
    deps.store.readAll(
      'DM-007',
      {
        groupIds: [root.groupId],
        timeRange: { from: folded.firstSeenAt - REF_READ_WINDOW_MS, to: now.getTime() },
      },
      deps.limits.readHardCap,
    ),
  )
  const chainOccurrences = occurrences.records.filter((record) => chainIds.has(record.memeId))
  const recent14d = chainOccurrences.filter((record) => record.occurredAt > now.getTime() - 14 * DAY_MS)
  const metrics = computeCellMetrics({ lastUsedAt: folded.lastUsedAt }, recent14d, now)
  const king = chainOccurrences.length > 0 ? computeMemeKing(chainOccurrences, folded.occurrenceCount) : folded.memeKing

  const first = boundaryOf(chainOccurrences, 'first')
  const last = boundaryOf(chainOccurrences, 'last')

  // 相关变体：以 root 为源的生效边（改判置失效后自然不再出现，AC-061）
  const edges = await collectRead(
    deps.store.readAll('DM-008', { groupIds: [root.groupId] }, deps.limits.readHardCap),
  )
  const variantMemeIds: Id[] = []
  for (const edge of edges.records) {
    if (edge.sourceMemeId !== root.memeId || edge.status !== '生效') continue
    const derivedRoot = index.rootOf(edge.derivedMemeId)
    if (derivedRoot === null || derivedRoot === root.memeId) continue
    if (!variantMemeIds.includes(derivedRoot)) variantMemeIds.push(derivedRoot)
  }

  // 精华消息：默认展示 3 条、展开上限 20（超出给截断标记，§4 API-010）
  const highlightRows = await collectRead(
    deps.store.readAll('DM-009', { groupIds: [root.groupId] }, deps.limits.readHardCap),
  )
  const picked = pickHighlights(highlightRows.records.filter((row) => row.memeId === root.memeId))

  // 引用回读：首现 / 最近 / 各精华 → 单时间点窄窗读取 DM-003（§8 决策 1）
  const needed = new Set<Id>()
  if (first !== null) needed.add(first.sourceMessageId)
  if (last !== null) needed.add(last.sourceMessageId)
  for (const row of picked.page) needed.add(row.sourceMessageId)

  const times = new Map<Id, Timestamp>()
  for (const occurrence of chainOccurrences) {
    if (needed.has(occurrence.sourceMessageId) && !times.has(occurrence.sourceMessageId)) {
      times.set(occurrence.sourceMessageId, occurrence.occurredAt)
    }
  }
  const messageById = new Map<Id, RawMessage>()
  for (const time of new Set(times.values())) {
    const window = await deps.store.readAt('DM-003', { groupIds: [root.groupId] }, time)
    for (const message of window) {
      if (needed.has(message.messageId)) messageById.set(message.messageId, message)
    }
  }

  // 精华条目：消息已删（级联）时跳过，不杜撰数据
  const highlights = picked.page
    .filter((row) => messageById.has(row.sourceMessageId))
    .map((row) => ({
      messageId: row.sourceMessageId,
      kind: messageById.get(row.sourceMessageId)?.kind ?? '文字',
      displayOrder: row.displayOrder,
    }))
  const highlightMediaRefs: string[] = []
  for (const highlight of highlights) {
    const mediaRef = messageById.get(highlight.messageId)?.mediaRef
    if (typeof mediaRef === 'string' && mediaRef.length > 0 && !highlightMediaRefs.includes(mediaRef)) {
      highlightMediaRefs.push(mediaRef)
    }
  }

  const sourceMessageIds: Id[] = []
  for (const messageId of [first?.sourceMessageId, last?.sourceMessageId, ...highlights.map((row) => row.messageId)]) {
    if (typeof messageId === 'string' && !sourceMessageIds.includes(messageId)) sourceMessageIds.push(messageId)
  }

  const coverage = await readCoverage(deps, filter)
  const incomplete = incompleteMonths(Object.keys(folded.monthlyCounts), coverage, now)

  return {
    memeId: input.memeId,
    interpretation: root.interpretation,
    firstSeenAt: folded.firstSeenAt,
    firstSeenGroupId: folded.firstSeenGroupId,
    lastUsedAt: folded.lastUsedAt,
    elapsed: metrics.elapsed,
    occurrenceCount: folded.occurrenceCount,
    heat: metrics.heat,
    weekOverWeek: metrics.weekOverWeek,
    monthlyCounts: fillMonthlyCounts(folded.monthlyCounts),
    lifecycle: folded.lifecycle,
    memeKing: king,
    highlights,
    variantMemeIds,
    sourceMessageIds,
    incompleteMonths: incomplete,
    highlightsTruncated: picked.truncated,
    highlightMediaRefs,
  }
}

// ---------------------------------------------------------------------------
// API-011 查询生命周期视图
// ---------------------------------------------------------------------------

export async function queryLifecycle(deps: MemeDeps, input: LifecycleQueryInput): Promise<LifecycleOutput> {
  const filter = input.filter ?? null
  if (!(await hasAnyData(deps))) throw noData('meme:lifecycle')

  const memes = await collectRead(
    deps.store.readAll(
      'DM-006',
      { groupIds: filter?.groupIds ?? null, keyword: filter?.keyword ?? null },
      deps.limits.readHardCap,
    ),
  )
  const index = resolveVisibility(memes.records, warnSink(deps))
  const chains = foldChains(memes.records, index)
  const sources: LifecycleSource[] = [...chains.entries()].map(([rootId, members]) =>
    foldMemeStats(rootOf(members, rootId), members.filter((meme) => meme.memeId !== rootId)),
  )

  const rows = computeLifecycle(sources, input.months)
  const leadingMemes = pickLeadingMemes(sources, input.months)
  const page = rows.slice(0, LIFECYCLE_MAX_ROWS)
  return {
    rows: page.map(({ occurrenceCount: _occurrenceCount, ...row }) => row),
    leadingMemes,
    truncated: rows.length > LIFECYCLE_MAX_ROWS,
    total: rows.length,
  }
}

// ---------------------------------------------------------------------------
// API-013 查询「我相关」梗
// ---------------------------------------------------------------------------

export async function queryMine(deps: MemeDeps, input: MineQueryInput): Promise<MineOutput> {
  const filter = input.filter ?? null

  const members = await collectRead(
    deps.store.readAll('DM-004', { groupIds: filter?.groupIds ?? null }, deps.limits.readHardCap),
  )
  const me = members.records.find((member) => member.isMe === true)
  if (me === undefined) throw identityNotReady()
  const meId = me.memberId

  const scope: SharedFilter = { groupIds: filter?.groupIds ?? null, timeRange: filter?.timeRange ?? null }
  // 两批读取都带身份筛选（§8 决策 8）：DM-007 取「发言者为『我』或『我相关』」，
  // DM-003 用于第二视角的「提及成员含『我』」判定。
  const occurrences = await collectRead(
    deps.store.readAll('DM-007', { ...scope, identity: meId }, deps.limits.readHardCap),
  )
  const messages = await collectRead(
    deps.store.readAll('DM-003', { ...scope, identity: meId }, deps.limits.readHardCap),
  )
  const mentionSet = new Set(
    messages.records
      .filter((message) => (message.mentionedMemberIds ?? []).includes(meId))
      .map((message) => message.messageId),
  )

  const relevant = occurrences.records.filter((record) =>
    input.view === '我用过的' ? record.speakerMemberId === meId : mentionSet.has(record.sourceMessageId),
  )

  const memes = await collectRead(
    deps.store.readAll('DM-006', { groupIds: filter?.groupIds ?? null }, deps.limits.readHardCap),
  )
  const index = resolveVisibility(memes.records, warnSink(deps))
  const chains = foldChains(memes.records, index)
  const sourceByRoot = new Map<Id, FoldedMeme>(
    [...chains.entries()].map(([rootId, members]) => [
      rootId,
      foldMemeStats(rootOf(members, rootId), members.filter((meme) => meme.memeId !== rootId)),
    ]),
  )

  const hitRoots: Id[] = []
  for (const record of relevant) {
    const root = index.rootOf(record.memeId)
    if (root === null || !sourceByRoot.has(root) || hitRoots.includes(root)) continue
    hitRoots.push(root)
  }

  const terms = sortTermsByLayout(
    buildCloudTerms(
      hitRoots.map((root) => sourceByRoot.get(root) as FoldedMeme),
      null,
    ),
    '按热度',
  )
  if (terms.length === 0) throw emptyResult('meme:mine', { view: input.view })

  const sourceMessageIds: Id[] = []
  for (const record of relevant) {
    if (!sourceMessageIds.includes(record.sourceMessageId)) sourceMessageIds.push(record.sourceMessageId)
  }

  return {
    terms: terms.slice(0, MINE_MAX_TERMS),
    sourceMessageIds,
    truncated: terms.length > MINE_MAX_TERMS || occurrences.truncated,
    total: terms.length,
  }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 忽略筛选时 DM-003 是否为空（`NO_DATA` 判定，§6）。 */
async function hasAnyData(deps: MemeDeps): Promise<boolean> {
  const read = deps.store.readAll('DM-003', null, 1)
  for await (const _record of read) return true
  return false
}

/** 数据覆盖窗口：全局筛选范围内 DM-003 的最早 / 最晚发送时间（§5.4，一次查询只读一次并复用）。 */
async function readCoverage(deps: MemeDeps, filter: SharedFilter | null): Promise<{ first: Timestamp; last: Timestamp } | null> {
  const read = deps.store.readAll(
    'DM-003',
    { groupIds: filter?.groupIds ?? null, timeRange: filter?.timeRange ?? null },
    deps.limits.readHardCap,
  )
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  let any = false
  for await (const message of read) {
    any = true
    first = Math.min(first, message.sentAt)
    last = Math.max(last, message.sentAt)
  }
  return any ? { first, last } : null
}

/** 可见根 → 链成员（可见根 + 「已合并至」来源；根不可见时整支不进入视图，§5.3）。 */
function foldChains(memes: readonly Meme[], index: VisibilityIndex): Map<Id, Meme[]> {
  const chains = new Map<Id, Meme[]>()
  const push = (rootId: Id, meme: Meme): void => {
    const bucket = chains.get(rootId)
    if (bucket === undefined) chains.set(rootId, [meme])
    else bucket.push(meme)
  }
  for (const meme of memes) {
    const entry = index.entryOf(meme.memeId)
    if (entry === undefined || entry.state === 'excluded' || entry.rootId === null) continue
    const rootEntry = index.entryOf(entry.rootId)
    if (rootEntry === undefined || rootEntry.state !== 'visible') continue
    if (entry.mergedAway) push(entry.rootId, meme)
    else if (entry.state === 'visible') push(meme.memeId, meme)
  }
  return chains
}

/** root 映射（worker 聚合用）。 */
function rootOfMap(memes: readonly Meme[], index: VisibilityIndex): Record<Id, Id | null> {
  const map: Record<Id, Id | null> = {}
  for (const meme of memes) map[meme.memeId] = index.rootOf(meme.memeId)
  return map
}

function rootOf(members: readonly Meme[], rootId: Id): Meme {
  const root = members.find((meme) => meme.memeId === rootId)
  if (root !== undefined) return root
  const first = members[0]
  if (first === undefined) throw new Error(`空链：${rootId}`)
  return first
}

function toNumberMap(record: Record<Id, number>): Map<Id, number> {
  return new Map(Object.entries(record))
}

/** 首现 / 最近出现记录（并列时按记录标识稳定取小 / 大）。 */
function boundaryOf(occurrences: readonly MemeOccurrence[], kind: 'first' | 'last'): MemeOccurrence | null {
  let best: MemeOccurrence | null = null
  for (const occurrence of occurrences) {
    if (best === null) {
      best = occurrence
      continue
    }
    if (kind === 'first') {
      if (
        occurrence.occurredAt < best.occurredAt ||
        (occurrence.occurredAt === best.occurredAt && occurrence.occurrenceId < best.occurrenceId)
      ) {
        best = occurrence
      }
    } else if (
      occurrence.occurredAt > best.occurredAt ||
      (occurrence.occurredAt === best.occurredAt && occurrence.occurrenceId > best.occurrenceId)
    ) {
      best = occurrence
    }
  }
  return best
}

/** 日志口（可见性防御性截断等 warn；不记消息正文）。 */
function warnSink(deps: MemeDeps): (event: string, fields?: Record<string, unknown>) => void {
  return (event, fields) => deps.logger.warn?.(event, { module: 'MOD-005', ...fields })
}
