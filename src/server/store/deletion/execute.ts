/**
 * API-006 的库内部分（mod-002 §4.4）：单事务、按依赖序删除、实际计数、结构整理、epoch +1。
 *
 * 事务语义（§4.4 / 决策 3）：
 * - 计划在事务开始时重算（不信任预检快照）；待删集合先落临时表（原始状态求值），
 *   再按依赖序显式删除并逐表计数 —— 预检与执行计数一致（§7.2）；
 * - 提交前任何失败 → 整体回滚，库内保持原状（由调用方转 `STORAGE_UNAVAILABLE`）；
 * - epoch +1 与「待清理清单」在同一事务内写入（提交后清理见 `sweep.ts`）。
 */

import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import { DIMENSIONS, PERSONALITY_DIMENSIONS, type DeletionScope, type EntityCount } from '@shared'

import { getEntityDescriptor } from '../entities/registry'
import { bumpEpoch } from '../meta/epoch'
import { buildDeletionPlan, type CleanupTask, type DeletionPlan } from './graph'

/** 库内删除的执行结果。 */
export interface DeletionExecution {
  items: readonly EntityCount[]
  cleanupTasks: readonly CleanupTask[]
}

/** 日志口（只记计数与事件名，不记记录内容，详设 §6.1）。 */
export type DeletionWarn = (event: string, fields: Record<string, unknown>) => void

/** 在已开启的事务内执行删除（同步；失败由调用方回滚）。 */
export function executeDeletionInTransaction(
  tx: Database.Database,
  scope: DeletionScope,
  clock: () => number,
  warn: DeletionWarn,
): DeletionExecution {
  const plan = buildDeletionPlan(tx, scope)

  materializeTempTables(tx, plan)
  try {
    const counts = deleteByPlan(tx, plan, warn)
    removeMediaIndexRows(tx, plan.mediaIndexPaths)
    applyItemStructure(tx, plan)
    applyPersonStructure(tx, plan, warn)
    pruneJsonReferences(tx, plan)
    writePendingCleanup(tx, plan.cleanup, clock)
    bumpEpoch(tx)
    return { items: counts, cleanupTasks: plan.cleanup }
  } finally {
    dropTempTables(tx, plan)
  }
}

/** ① 待删集合落临时表（原始状态求值；保证后续删除不会因先前的级联而漏计）。 */
function materializeTempTables(tx: Database.Database, plan: DeletionPlan): void {
  plan.steps.forEach((step, index) => {
    tx.exec(`DROP TABLE IF EXISTS ${tempTable(index)}`)
    tx.prepare(
      `CREATE TEMP TABLE ${tempTable(index)} AS SELECT rowid AS rid FROM ${step.table} WHERE ${step.where}`,
    ).run(...step.params)
  })
}

function dropTempTables(tx: Database.Database, plan: DeletionPlan): void {
  plan.steps.forEach((_step, index) => {
    try {
      tx.exec(`DROP TABLE IF EXISTS ${tempTable(index)}`)
    } catch {
      // 临时表清理是尽力而为；连接关闭时也会回收。
    }
  })
}

/** ② 按依赖序显式删除并逐表计数。 */
function deleteByPlan(
  tx: Database.Database,
  plan: DeletionPlan,
  warn: DeletionWarn,
): EntityCount[] {
  const expected = new Map(plan.counts.map((count) => [count.entityType, count.count]))
  const actual = new Map<string, number>()
  plan.steps.forEach((step, index) => {
    const result = tx
      .prepare(`DELETE FROM ${step.table} WHERE rowid IN (SELECT rid FROM ${tempTable(index)})`)
      .run()
    actual.set(step.entityType, result.changes)
    const wanted = expected.get(step.entityType) ?? 0
    if (result.changes !== wanted) {
      warn('deletion.count.mismatch', {
        entityType: step.entityType,
        expected: wanted,
        actual: result.changes,
      })
    }
  })
  return plan.counts.map((count) => ({
    entityType: count.entityType,
    count: actual.get(count.entityType) ?? 0,
  }))
}

/** ③ 媒体 / 产物索引行先删、文件由提交后清理按「待清理清单」处理（§5.3）。 */
function removeMediaIndexRows(tx: Database.Database, paths: readonly string[]): void {
  if (paths.length === 0) return
  tx.prepare('DELETE FROM _media_index WHERE path IN (SELECT value FROM json_each(?))').run(
    JSON.stringify([...paths]),
  )
}

/** ④ DM-010 部分来源被删：保留 + `needs_recompute`，重算前不进入读取结果（决策 4）。 */
function applyItemStructure(tx: Database.Database, plan: DeletionPlan): void {
  const kept = plan.structural.keptItems
  if (kept.length === 0) return
  const ids = JSON.stringify([...kept])
  tx.prepare('UPDATE dm010_item SET needs_recompute = 1 WHERE item_id IN (SELECT value FROM json_each(?))').run(ids)
  // 排序时间 = 剩余来源消息中最早的发送时间（§5.2、mod-006 的排序键）。
  tx.prepare(
    `UPDATE dm010_item SET src_time = (
       SELECT MIN(m.sent_at) FROM dm010_source s JOIN dm003_message m ON m.msg_id = s.msg_id
       WHERE s.item_id = dm010_item.item_id
     ) WHERE item_id IN (SELECT value FROM json_each(?))`,
  ).run(ids)
  // 来源群重绑到剩余来源消息中最早的发送时间所在群（被删群不再被引用）。
  tx.prepare(
    `UPDATE dm010_item SET source_group_id = (
       SELECT m.group_id FROM dm010_source s JOIN dm003_message m ON m.msg_id = s.msg_id
       WHERE s.item_id = dm010_item.item_id
       ORDER BY m.sent_at ASC, m.group_id ASC LIMIT 1
     ) WHERE item_id IN (SELECT value FROM json_each(?))`,
  ).run(ids)
  // 人物要素里已不存在的成员（按来源群限定，避免同标识跨群误判）从引用集中剔除。
  tx.prepare(
    `UPDATE dm010_item SET person_element = (
       SELECT COALESCE(json_group_array(je.value), '[]') FROM json_each(dm010_item.person_element) je
       WHERE EXISTS (SELECT 1 FROM dm004_member m WHERE m.member_id = je.value AND m.group_id = dm010_item.source_group_id)
     ) WHERE item_id IN (SELECT value FROM json_each(?)) AND person_element IS NOT NULL`,
  ).run(ids)
}

/** ⑤ 人的结构整理：孤儿删除、映射失效后的「自成人」回退、成员集与「我」重算（§5.3 第 3 步）。 */
function applyPersonStructure(
  tx: Database.Database,
  plan: DeletionPlan,
  warn: DeletionWarn,
): void {
  if (plan.scope.kind === 'all') return
  const affected = plan.structural.affectedPersons
  if (affected.length === 0) return

  const memberPerson = new Map<string, string>()
  const collectMembers = tx.prepare(
    'SELECT member_id, person_id FROM dm004_member WHERE person_id IN (SELECT value FROM json_each(?))',
  )
  const collectLinked = tx.prepare(
    `SELECT dm.member_id AS member_id, m.person_id AS person_id
     FROM dm012_member dm
     JOIN dm012_candidate c ON c.candidate_id = dm.candidate_id
     JOIN dm004_member m ON m.member_id = dm.member_id
     WHERE c.status = '已确认' AND dm.member_id = ?`,
  )

  // 种子 = 受影响的人的全部剩余成员；向「仍有效的已确认映射」做闭包（映射链跨多人时保持一致）。
  const queue: string[] = []
  for (const row of collectMembers.all(JSON.stringify(affected)) as Array<{
    member_id: string
    person_id: string
  }>) {
    memberPerson.set(row.member_id, row.person_id)
    queue.push(row.member_id)
  }
  const visited = new Set(queue)
  while (queue.length > 0) {
    const memberId = queue.shift()!
    for (const linked of collectLinked.all(memberId) as Array<{
      member_id: string
      person_id: string
    }>) {
      if (visited.has(linked.member_id)) continue
      visited.add(linked.member_id)
      memberPerson.set(linked.member_id, linked.person_id)
      queue.push(linked.member_id)
    }
  }
  if (memberPerson.size === 0) return

  // 连接分量（并查集）：同一条已确认映射里的成员必须落在同一个人。
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    let cursor = id
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }
  const union = (a: string, b: string): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootB, rootA)
  }
  for (const memberId of memberPerson.keys()) parent.set(memberId, memberId)
  const linkRows = tx
    .prepare(
      `SELECT dm.candidate_id, dm.member_id FROM dm012_member dm
       JOIN dm012_candidate c ON c.candidate_id = dm.candidate_id
       WHERE c.status = '已确认' AND dm.member_id IN (SELECT value FROM json_each(?))
       ORDER BY dm.candidate_id, dm.member_id`,
    )
    .all(JSON.stringify([...memberPerson.keys()])) as Array<{ candidate_id: string; member_id: string }>
  const byCandidate = new Map<string, string[]>()
  for (const row of linkRows) {
    const list = byCandidate.get(row.candidate_id) ?? []
    list.push(row.member_id)
    byCandidate.set(row.candidate_id, list)
  }
  for (const members of byCandidate.values()) {
    for (let index = 1; index < members.length; index += 1) {
      union(members[0]!, members[index]!)
    }
  }

  const components = new Map<string, string[]>()
  for (const memberId of memberPerson.keys()) {
    const root = find(memberId)
    const list = components.get(root) ?? []
    list.push(memberId)
    components.set(root, list)
  }
  const ordered = [...components.values()]
    .map((members) => [...members].sort())
    .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0))

  const assignedPersons = new Set<string>()
  const assignments: Array<{ members: string[]; target: string; isNew: boolean }> = []
  for (const members of ordered) {
    const natural = memberPerson.get(members[0]!)!
    if (!assignedPersons.has(natural)) {
      assignedPersons.add(natural)
      assignments.push({ members, target: natural, isNew: false })
    } else {
      const target = `person:${randomUUID()}`
      assignedPersons.add(target)
      assignments.push({ members, target, isNew: true })
      warn('deletion.person.split', { members: members.length, from: natural })
    }
  }

  const touched = new Set<string>([...memberPerson.values(), ...assignedPersons])
  const clearMe = tx.prepare('UPDATE dm011_person SET is_me = 0 WHERE person_id = ?')
  for (const personId of touched) clearMe.run(personId)

  const rebind = tx.prepare('UPDATE dm004_member SET person_id = ? WHERE member_id = ?')
  const insertPerson = tx.prepare(
    `INSERT INTO dm011_person (person_id, member_ids, is_me, unknown, activity, reply_median_ms, dimension_scores, personality_scores)
     VALUES (?, ?, ?, 0, 0, NULL, ?, ?)`,
  )
  const zeroDimensions = JSON.stringify(Object.fromEntries(DIMENSIONS.map((dim) => [dim, 0])))
  const zeroPersonality = JSON.stringify(
    Object.fromEntries(PERSONALITY_DIMENSIONS.map((dim) => [dim, 0])),
  )
  for (const assignment of assignments) {
    if (assignment.isNew) {
      insertPerson.run(
        assignment.target,
        JSON.stringify([...assignment.members].sort()),
        0,
        zeroDimensions,
        zeroPersonality,
      )
    }
    for (const memberId of assignment.members) {
      if (memberPerson.get(memberId) !== assignment.target) rebind.run(assignment.target, memberId)
    }
  }

  // 空人删除（受影响且不再有任何成员；派生行随外键级联）。
  const countMembers = tx.prepare('SELECT COUNT(*) AS count FROM dm004_member WHERE person_id = ?')
  const deletePerson = tx.prepare('DELETE FROM dm011_person WHERE person_id = ?')
  for (const personId of touched) {
    const { count } = countMembers.get(personId) as { count: number }
    if (count === 0) deletePerson.run(personId)
  }

  // 成员集与「我」按当前成员重算（成员集只含仍存在的人；唯一索引要求先清零再置位）。
  const listMembers = tx.prepare(
    'SELECT member_id, is_me FROM dm004_member WHERE person_id = ? ORDER BY member_id',
  )
  const refresh = tx.prepare(
    'UPDATE dm011_person SET member_ids = ?, is_me = ? WHERE person_id = ?',
  )
  for (const personId of assignedPersons) {
    const members = listMembers.all(personId) as Array<{ member_id: string; is_me: number }>
    if (members.length === 0) continue
    const isMe = members.some((member) => member.is_me === 1) ? 1 : 0
    refresh.run(JSON.stringify(members.map((member) => member.member_id)), isMe, personId)
  }
}

/** ⑥ JSON 引用集修剪：删除后不留指向已删行的引用（§5.3 不变量）。 */
function pruneJsonReferences(tx: Database.Database, plan: DeletionPlan): void {
  if (plan.scope.kind === 'all') return
  // 我的社交契合度：剔除已删配对。
  tx.prepare(
    `UPDATE dm019_my_fit SET pair_ids = (
       SELECT COALESCE(json_group_array(je.value), '[]') FROM json_each(dm019_my_fit.pair_ids) je
       WHERE EXISTS (SELECT 1 FROM dm018_pair_score p WHERE p.pair_id = je.value)
     )`,
  ).run()
  // 两人契合度：剔除已删标签。
  tx.prepare(
    `UPDATE dm018_pair_score SET common_tag_ids = (
       SELECT COALESCE(json_group_array(je.value), '[]') FROM json_each(dm018_pair_score.common_tag_ids) je
       WHERE EXISTS (SELECT 1 FROM dm013_tag t WHERE t.tag_id = je.value)
     ) WHERE EXISTS (
       SELECT 1 FROM json_each(dm018_pair_score.common_tag_ids) je2
       WHERE NOT EXISTS (SELECT 1 FROM dm013_tag t WHERE t.tag_id = je2.value)
     )`,
  ).run()
  // 归并组：剔除已删标签（代表标签被删时整组已随外键级联删除）。
  tx.prepare(
    `UPDATE dm015_tag_merge SET merged_tag_ids = (
       SELECT COALESCE(json_group_array(je.value), '[]') FROM json_each(dm015_tag_merge.merged_tag_ids) je
       WHERE EXISTS (SELECT 1 FROM dm013_tag t WHERE t.tag_id = je.value)
     ) WHERE EXISTS (
       SELECT 1 FROM json_each(dm015_tag_merge.merged_tag_ids) je2
       WHERE NOT EXISTS (SELECT 1 FROM dm013_tag t WHERE t.tag_id = je2.value)
     )`,
  ).run()
}

/** ⑦ 待清理清单（提交后清理失败 / 中断时续做；§4.4、详设 §3.2）。 */
function writePendingCleanup(
  tx: Database.Database,
  tasks: readonly CleanupTask[],
  clock: () => number,
): void {
  const insert = tx.prepare(
    `INSERT INTO _pending_cleanup (kind, path, created_at, attempts)
     SELECT ?, ?, ?, 0
     WHERE NOT EXISTS (SELECT 1 FROM _pending_cleanup WHERE kind = ? AND path = ?)`,
  )
  const now = clock()
  for (const task of tasks) {
    insert.run(task.kind, task.path, now, task.kind, task.path)
  }
}

function tempTable(index: number): string {
  return `_mp_del_${index}`
}
