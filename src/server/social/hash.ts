/**
 * 确定性短哈希（FNV-1a 32 位，十六进制）：候选标识与归并组标识的派生用。
 *
 * 只用于生成**稳定标识**（重复生成得到同一标识，幂等）；不用于安全用途。
 */
export function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
