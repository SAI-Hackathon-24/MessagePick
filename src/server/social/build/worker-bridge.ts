/**
 * worker 桥（mod-007 §3.1「build/」、§3.4）：图谱组装、逐人融入度、身份候选相似度（O(n²) 段）。
 *
 * - 三个段都是**纯函数**：输入由主线程分页读取后传入，worker 不接触库与网络（§3.4）；
 * - 缺省在主线程执行（内联）；可注入 `runners` 把某段下放 worker（测试以此断言派发与结果一致）；
 * - 图谱口径（§5.4 取数上限、决策 4）：节点 ≤ 200（活跃度降序，「我」优先）；
 *   **未知成员无连线**（可作孤立节点列出）；边 = 两人五维共同有效标签（含社交维度）。
 */

import type { Id, IdentityCandidate, Person } from '@shared'

import { generateCandidates, type AlignInput } from '../align'
import { affinity, type CommonTag, type EffectiveTag, type PersonStats } from '../scoring'
import { GRAPH_NODE_LIMIT } from '../scoring'

/** 图谱节点（展示名由主线程预先解析；worker 输入保持结构化可克隆）。 */
export interface GraphNode {
  personId: Id
  displayName: string
  activity: number
  unknown: boolean
  isMe: boolean
}

/** 图谱边（无序对；`personAId < personBId`）。 */
export interface GraphEdge {
  personAId: Id
  personBId: Id
  /** 共同有效标签（含社交维度；未知成员不产出边） */
  commonTagIds: Id[]
}

export interface GraphView {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 图谱组装输入（人、逐人有效标签、展示名、节点上限）。 */
export interface GraphInput {
  people: readonly Person[]
  effectiveByPerson: ReadonlyMap<Id, readonly EffectiveTag[]>
  displayNames: ReadonlyMap<Id, string>
  limit?: number
}

/** 图谱组装：节点按「我优先 → 活跃度降序 → 标识升序」截断；边只在非未知成员之间产出。 */
export function assembleGraph(input: GraphInput): GraphView {
  const limit = input.limit ?? GRAPH_NODE_LIMIT
  const ordered = [...input.people].sort((left, right) => {
    if (left.isMe !== right.isMe) return left.isMe ? -1 : 1
    if (left.activity !== right.activity) return right.activity - left.activity
    return left.personId < right.personId ? -1 : 1
  })
  const nodes = ordered.slice(0, Math.max(0, limit)).map((person) => ({
    personId: person.personId,
    displayName: input.displayNames.get(person.personId) ?? person.personId,
    activity: person.activity,
    unknown: person.unknown,
    isMe: person.isMe,
  }))

  const tagIdsOf = (personId: Id): string[] =>
    (input.effectiveByPerson.get(personId) ?? []).map((tag) => tag.tagId)

  const edges: GraphEdge[] = []
  for (let left = 0; left < nodes.length; left += 1) {
    const a = nodes[left] as GraphNode
    if (a.unknown) continue // 零连线（决策 4 / AC-127）
    const tagsA = new Set(tagIdsOf(a.personId))
    if (tagsA.size === 0) continue
    for (let right = left + 1; right < nodes.length; right += 1) {
      const b = nodes[right] as GraphNode
      if (b.unknown) continue
      const common = tagIdsOf(b.personId).filter((tagId) => tagsA.has(tagId))
      if (common.length === 0) continue
      edges.push({
        personAId: a.personId < b.personId ? a.personId : b.personId,
        personBId: a.personId < b.personId ? b.personId : a.personId,
        commonTagIds: common.sort(),
      })
    }
  }
  edges.sort((left, right) =>
    left.personAId === right.personAId
      ? left.personBId < right.personBId
        ? -1
        : 1
      : left.personAId < right.personAId
        ? -1
        : 1,
  )
  return { nodes, edges }
}

/** 逐人契合度的输入（「我」的逐人列表；worker 段）。 */
export interface AffinityPairInput {
  me: PersonStats
  friends: readonly PersonStats[]
  /** 每个群友与「我」的共同标签（含社交维度；T / C 项内部只取四维语义标签） */
  commonTagsByFriend: ReadonlyMap<Id, readonly CommonTag[]>
  /** 每个群友与「我」的双向互动条数（I 项） */
  interactionsByFriend: ReadonlyMap<Id, number>
}

/** 逐人契合度条目（对 = 「我」 × 群友）。 */
export interface AffinityPairResult {
  personId: Id
  score: number
}

/** 逐人契合度（O(群友数 ×（共同标签 + 互动）)，契合度纯函数逐对调用）。 */
export function computeAffinityPairs(input: AffinityPairInput): AffinityPairResult[] {
  const results: AffinityPairResult[] = []
  for (const friend of input.friends) {
    results.push({
      personId: friend.personId,
      score: affinity(input.me, friend, input.commonTagsByFriend.get(friend.personId) ?? [], input.interactionsByFriend.get(friend.personId) ?? 0),
    })
  }
  return results.sort((left, right) => (left.personId < right.personId ? -1 : 1))
}

/** 身份候选相似度（O(成员 × 联系人)；本地确定性匹配，不调模型）。 */
export function computeIdentityCandidates(input: AlignInput): IdentityCandidate[] {
  return generateCandidates(input)
}

/** worker 运行器（测试或真实 worker 线程的注入点；缺省 = 内联执行）。 */
export interface WorkerRunners {
  assembleGraph?: (input: GraphInput) => GraphView | Promise<GraphView>
  computeAffinityPairs?: (input: AffinityPairInput) => AffinityPairResult[] | Promise<AffinityPairResult[]>
  generateIdentityCandidates?: (input: AlignInput) => IdentityCandidate[] | Promise<IdentityCandidate[]>
}

/** worker 桥：每个段都可由 runner 下放；无 runner 时主线程内联执行。 */
export interface WorkerBridge {
  assembleGraph(input: GraphInput): Promise<GraphView>
  computeAffinityPairs(input: AffinityPairInput): Promise<AffinityPairResult[]>
  generateIdentityCandidates(input: AlignInput): Promise<IdentityCandidate[]>
}

/** 装配 worker 桥（组合根 / 测试注入 runners；缺省全部内联）。 */
export function createWorkerBridge(runners: WorkerRunners = {}): WorkerBridge {
  const { assembleGraph: assembleRunner, computeAffinityPairs: pairRunner, generateIdentityCandidates: candidateRunner } = runners
  return {
    assembleGraph: async (input) =>
      assembleRunner === undefined ? assembleGraph(input) : assembleRunner(input),
    computeAffinityPairs: async (input) =>
      pairRunner === undefined ? computeAffinityPairs(input) : pairRunner(input),
    generateIdentityCandidates: async (input) =>
      candidateRunner === undefined ? computeIdentityCandidates(input) : candidateRunner(input),
  }
}
