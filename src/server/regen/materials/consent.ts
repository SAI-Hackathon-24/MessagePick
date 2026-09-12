/**
 * `DM-022` 素材合规确认 —— 读写与状态机（mod-008 §3.1「materials/consent」、§3.5-A、§5.1）。
 *
 * 状态机（§3.5-A）：
 * - 未确认 → 已确认：外壳确认动作 → `submitMaterialConsent`；
 * - 已确认 → 已确认：重复确认 / 再次生成 → 幂等（不重复建记录、不刷新确认时间）；
 * - 未确认 → 未确认：再次提交生成 → `MATERIAL_NOT_CONFIRMED`（不产出、不写生成历史）。
 *
 * 确认标识 =（素材类别 + 素材引用 + 涉及成员）的确定性散列 —— 同一素材重复使用不产生第二条，
 * 不同成员用同一素材不共享确认（§5.1、§7.2）。
 */

import type { MaterialConsent, Timestamp } from '@shared'

import { consentRecordOf } from '../domain/derive'
import { failInvalidInput } from '../errors'
import { readAll, writeAllOrFail } from '../store/regen-store'
import type { RegenStore } from '../store/port'
import { CONSENT_SCAN_MAX_PAGES, CONSENT_SCAN_PAGE_SIZE } from '../constants'
import { consentIndexOf, consentIdOfItem, type ConsentIndex } from './compliance'
import { isMemberMaterial, type MaterialItem } from './manifest'

/** 读取确认索引与全部确认记录（分页扫描，显式上限）。 */
export function readConsentRecords(store: RegenStore): MaterialConsent[] {
  return readAll(store, 'DM-022', null, {
    pageSize: CONSENT_SCAN_PAGE_SIZE,
    maxPages: CONSENT_SCAN_MAX_PAGES,
  })
}

/** 读取确认索引（合规判定的输入）。 */
export function readConsentIndex(store: RegenStore): ConsentIndex {
  return consentIndexOf(readConsentRecords(store))
}

/** 确认动作结果（进程内入口 `submitMaterialConsent` 的出参）。 */
export interface ConsentResult {
  /** 本次涉及的全部确认标识 */
  consentIds: string[]
  /** 本次新写入（未确认 → 已确认 或其他状态 → 已确认）的条数 */
  confirmed: number
  /** 已处于已确认、幂等跳过的条数 */
  alreadyConfirmed: number
}

/**
 * 首次使用成员素材时落「未确认」记录（§3.5-A 的进入态；不覆盖既有记录、不做状态降级）。
 * 只在生成被拒的路径调用 —— 拒绝不产出、不写生成历史（`AC-032`）。
 */
export function ensureUnconfirmedRecords(
  store: RegenStore,
  pending: readonly MaterialItem[],
): void {
  const index = readConsentIndex(store)
  const records: MaterialConsent[] = []
  const seen = new Set<string>()
  for (const item of pending) {
    const consentId = consentIdOfItem(item)
    if (seen.has(consentId) || index.statusOf(consentId) !== null) continue
    seen.add(consentId)
    records.push(
      consentRecordOf({
        kind: item.kind,
        ref: item.ref,
        memberId: item.memberRef ?? null,
        status: '未确认',
        confirmedAt: null,
      }),
    )
  }
  writeAllOrFail(store, 'DM-022', records)
}

/**
 * 外壳确认动作的进程内入口（§8 决策 1）：按清单条目写 `DM-022` 为已确认。
 *
 * - 只接受成员素材（头像 / 照片 / 原话）；成员素材必须携带涉及成员；
 * - 已确认的记录不改写（幂等，不刷新确认时间）；同一引用 + 同一成员复用同一确认记录。
 */
export function submitMaterialConsent(
  store: RegenStore,
  items: readonly MaterialItem[],
  now: Timestamp,
): ConsentResult {
  if (!Array.isArray(items) || items.length === 0) {
    failInvalidInput('确认清单非法：应为非空的成员素材条目数组', { items: String(items) })
  }
  const existing = readConsentIndex(store)
  const records: MaterialConsent[] = []
  const consentIds: string[] = []
  const seen = new Set<string>()
  let alreadyConfirmed = 0

  for (const item of items) {
    if (!isMemberMaterial(item.kind)) {
      failInvalidInput('确认清单非法：只有成员素材（头像 / 照片 / 原话）需要确认', {
        kind: item.kind,
        ref: item.ref,
      })
    }
    if (item.memberRef === undefined || item.memberRef === '') {
      failInvalidInput('确认清单非法：成员素材必须携带涉及成员', { kind: item.kind, ref: item.ref })
    }
    if (typeof item.ref !== 'string' || item.ref === '') {
      failInvalidInput('确认清单非法：素材引用不能为空', { kind: item.kind })
    }
    const consentId = consentIdOfItem(item)
    if (seen.has(consentId)) continue
    seen.add(consentId)
    consentIds.push(consentId)

    if (existing.statusOf(consentId) === '已确认') {
      alreadyConfirmed += 1
      continue
    }
    records.push(
      consentRecordOf({
        kind: item.kind,
        ref: item.ref,
        memberId: item.memberRef,
        status: '已确认',
        confirmedAt: now,
      }),
    )
  }

  writeAllOrFail(store, 'DM-022', records)
  return { consentIds, confirmed: records.length, alreadyConfirmed }
}
