/**
 * MOD-008 幂等键（mod-008 §3.1「domain/dedupe.ts —— 幂等键」、§5.1 / §5.2）。
 *
 * - 素材确认（`DM-022`）：确认标识 =（素材类别 + 素材引用 + 涉及成员）的确定性散列 ——
 *   同一素材重复使用不产生第二条；不同成员用同一素材不共享确认（§7.2 分支）。
 * - 生成请求 ID：由时钟 + 进程内序号派生（`app/deps.ts` 的默认 `RegenIds`），
 *   同一请求内部的技术重试复用它、落库按记录身份去重（§5.2）。
 * - 候选 / 入库梗 / 出现记录：由生成请求 ID 与出处消息确定性派生，重复执行不产生新身份。
 */

import type { MaterialKind } from '../materials/manifest'

/**
 * 64 位 FNV-1a 散列（十六进制，16 位定长）。
 *
 * 选择理由：无依赖、确定性、跨进程稳定（幂等键不随进程重启变化）；非密码学用途。
 */
export function stableHash(input: string): string {
  const FNV_OFFSET = 0xcbf29ce484222325n
  const FNV_PRIME = 0x100000001b3n
  const MASK = 0xffffffffffffffffn

  let hash = FNV_OFFSET
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = (hash * FNV_PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}

/** 素材确认身份键 = 素材类别 + 素材引用 + 涉及成员（成员为空时用固定占位）。 */
export function consentIdentityKey(kind: MaterialKind, ref: string, memberId: string | null): string {
  return `${kind}\u0000${ref}\u0000${memberId ?? ''}`
}

/** 确认标识（`DM-022.consentId`；确定性散列，见 §5.1）。 */
export function consentIdOf(kind: MaterialKind, ref: string, memberId: string | null): string {
  return `consent-${stableHash(consentIdentityKey(kind, ref, memberId))}`
}

/** 候选标识（`DM-021.candidateId`）：生成请求 ID + 序号，确定性可复现。 */
export function candidateIdOf(generationId: string, index: number): string {
  return `cand-${generationId}-${index + 1}`
}

/** 入库梗标识（`DM-006.memeId`）：由候选标识派生（确认动作幂等，重复确认返回同一标识）。 */
export function memeIdOfCandidate(candidateId: string): string {
  return `meme-${stableHash(candidateId)}`
}

/** 出现记录标识（`DM-007.occurrenceId`）：按「梗 + 来源消息」去重（§4.4 决策 5）。 */
export function occurrenceIdOf(memeId: string, messageId: string): string {
  return `occ-${stableHash(`${memeId}\u0000${messageId}`)}`
}
