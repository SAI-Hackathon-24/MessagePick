/**
 * 成员素材合规判定（mod-008 §3.1「materials/compliance」、§5.3 判定表、§8 决策 2）。
 *
 * 纯逻辑：`evaluateCompliance` 只依赖清单与确认索引（无 IO，可全量单测）。
 * 判定表（§5.3）是唯一依据：头像 / 照片 / 原话三类成员素材逐条查 `DM-022`；
 * 存在未确认项即拒绝产出（`MATERIAL_NOT_CONFIRMED`，§6），不产出、不写生成历史。
 */

import type { Id, MaterialConsent, MaterialConsentStatus } from '@shared'

import { consentIdOf } from '../domain/dedupe'
import { isMemberMaterial, type MaterialItem, type MaterialManifest } from './manifest'

/** `DM-022` 确认索引（按确认标识定位；未登记返回 null）。 */
export interface ConsentIndex {
  statusOf(consentId: Id): MaterialConsentStatus | null
}

/** 由 `DM-022` 记录构造确认索引（同一确认标识以最后一条为准；纯函数）。 */
export function consentIndexOf(records: readonly MaterialConsent[]): ConsentIndex {
  const byId = new Map<Id, MaterialConsentStatus>()
  for (const record of records) {
    byId.set(record.consentId, record.status)
  }
  return { statusOf: (consentId) => byId.get(consentId) ?? null }
}

/** 清单条目的确认标识（=（素材类别 + 素材引用 + 涉及成员）的确定性散列，§5.1）。 */
export function consentIdOfItem(item: MaterialItem): Id {
  return consentIdOf(item.kind, item.ref, item.memberRef ?? null)
}

/** 清单中的成员素材条目（装载即触发合规判定）。 */
export function memberItemsOf(manifest: MaterialManifest): MaterialItem[] {
  return manifest.items.filter((item) => isMemberMaterial(item.kind))
}

/** 合规判定结果：通过时给出确认引用集（写入 `DM-020` 的结构引用），否则给出待确认清单。 */
export type ComplianceVerdict =
  | { ok: true; consentIds: Id[] }
  | { ok: false; pending: MaterialItem[] }

/**
 * 合规判定：成员素材逐条查确认索引；全部已确认 → 通过。
 * 未确认（含成员缺失的防御性情形）→ 拒绝并给出同一份清单条目（§5.3「一致性」）。
 */
export function evaluateCompliance(
  manifest: MaterialManifest,
  consent: ConsentIndex,
): ComplianceVerdict {
  const consentIds: Id[] = []
  const pending: MaterialItem[] = []

  for (const item of manifest.items) {
    if (!isMemberMaterial(item.kind)) continue
    if (item.memberRef === undefined) {
      // 判定表要求成员素材必须能定位到成员；缺失按未确认处理（从严，§8 决策 2）。
      pending.push(item)
      continue
    }
    const consentId = consentIdOfItem(item)
    if (consent.statusOf(consentId) === '已确认') {
      consentIds.push(consentId)
    } else {
      pending.push(item)
    }
  }

  if (pending.length > 0) return { ok: false, pending }
  return { ok: true, consentIds: [...new Set(consentIds)] }
}
