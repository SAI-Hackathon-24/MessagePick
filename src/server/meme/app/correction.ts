/**
 * 用例编排：纠正改判（mod-005 §4 API-012、§3.5 状态机 B、决策 3）。
 *
 * 步骤：读梗行与同群梗集合 → `checkMerge`（合并分支）→ 组装 `DM-006` 更新
 * （必要时含 `DM-008` 边置失效）→ 经 `API-003` 提交 → 重读并返回最新梗数据。
 *
 * 幂等 / 重入：重复提交同一改判结果一致（按记录身份 upsert）；不同改判后写覆盖先写；
 * 无撤销接口（API-012 无该入参）。
 */

import type { Id, MemeCorrection } from '@shared'

import { checkMerge, type MergeCheck } from '../domain/correction'
import { resolveVisibility } from '../domain/visibility'
import { withCorrection } from '../store/mappers'
import { collectRead } from '../store/paging'
import type { CorrectionInput, CorrectionOutput } from '../types'
import type { MemeDeps } from './context'
import { analysisFailed, invalidInput, notFound } from './errors'

export async function applyCorrection(deps: MemeDeps, input: CorrectionInput): Promise<CorrectionOutput> {
  const memes = await collectRead(deps.store.readAll('DM-006', null, deps.limits.readHardCap))
  const source = memes.records.find((meme) => meme.memeId === input.memeId)
  if (source === undefined) {
    throw notFound('meme:correction', '梗不存在', { memeId: input.memeId })
  }

  const index = resolveVisibility(memes.records, (event, fields) =>
    deps.logger.warn?.(event, { module: 'MOD-005', ...fields }),
  )

  // 「合并到其他梗」是改判动作，`DM-006` 的纠正标记落库为「已合并至」（校验不过则不写入）
  let correction: MemeCorrection = input.correction === '合并到其他梗' ? '已合并至' : input.correction
  let mergedIntoId: Id | null = null
  if (input.correction === '合并到其他梗') {
    const targetId = input.mergeTargetId ?? ''
    if (targetId.length === 0) throw invalidInput('「合并到其他梗」必须给出合并目标', { memeId: input.memeId })
    const check = checkMerge(source.memeId, targetId, index, memes.records)
    if (!check.ok) {
      throw notFound('meme:correction', rejectMessage(check), {
        reason: check.reason,
        memeId: input.memeId,
        mergeTargetId: targetId,
      })
    }
    mergedIntoId = check.rootId
  }

  const updated = withCorrection(source, correction, mergedIntoId)
  const writeResult = await deps.store.upsertEntities('DM-006', [updated], { bumpEpoch: true })
  if (writeResult.failures.length > 0) {
    throw analysisFailed('meme:correction', '改判写入被存储拒绝', { failures: writeResult.failures })
  }

  // 「不是梗 / 已合并至」：把 DM-008 中该梗相关的边置「已失效」（§3.5、AC-061）
  if (correction === '不是梗' || correction === '已合并至') {
    const edges = await collectRead(
      deps.store.readAll('DM-008', { groupIds: [source.groupId] }, deps.limits.readHardCap),
    )
    const affected = edges.records.filter(
      (edge) =>
        edge.status === '生效' && (edge.sourceMemeId === source.memeId || edge.derivedMemeId === source.memeId),
    )
    if (affected.length > 0) {
      const invalidated = affected.map((edge) => ({ ...edge, status: '已失效' as const }))
      const edgeResult = await deps.store.upsertEntities('DM-008', invalidated)
      if (edgeResult.failures.length > 0) {
        throw analysisFailed('meme:correction', '变体关系失效写入被存储拒绝', { failures: edgeResult.failures })
      }
    }
  }

  // 重读最新数据（改判立即影响后续结果，REQ-008）
  const latest = await collectRead(deps.store.readAll('DM-006', null, deps.limits.readHardCap))
  return latest.records.find((meme) => meme.memeId === source.memeId) ?? updated
}

/** 合并拒绝原因 → 使用者可见 message（§6：契约未给其它标识，原因写 message / context）。 */
function rejectMessage(check: MergeCheck): string {
  if (check.ok) return '合并成功'
  switch (check.reason) {
    case 'sourceMissing':
      return '梗不存在'
    case 'targetMissing':
      return '合并目标不存在'
    case 'crossGroup':
      return '合并目标与本梗不属于同一个群'
    case 'selfLoop':
      return '不能合并到自身'
    case 'cycle':
      return '合并会形成闭环，已拒绝'
    case 'rootNotVisible':
      return '合并目标所在链的末端不是可见梗'
  }
}
