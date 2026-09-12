/**
 * 身份对齐的本地确定性匹配（mod-007 §8 决策 5；`REQ-082`）。
 *
 * 三级匹配：**名称规范化 → 精确 → 包含 → 编辑距离**；全部本地完成，不调模型、不出数据。
 * 阈值集中在 `align/constants.ts`（O(n²) 段由 worker 执行，见 build/worker-bridge.ts）。
 */

import { ALIGN_CONTAINS_MIN_RATIO, ALIGN_EDIT_DISTANCE_MAX, ALIGN_MIN_NAME_LENGTH } from './constants'

/** 匹配级别（候选按级别降序排序，级别高者更可信）。 */
export const MATCH_LEVELS = ['精确', '包含', '编辑距离'] as const
export type MatchLevel = (typeof MATCH_LEVELS)[number]

/**
 * 名称规范化：全角转半角（NFKC）→ 小写 → 去空白 → 去常见装饰符 / 分隔符 / emoji。
 * 仅用于匹配比较，不写回任何记录（禁止改写昵称）。
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKC')
    .toLocaleLowerCase('zh-Hans-CN')
    .replace(/[\s\u3000]+/gu, '')
    .replace(/[·・.。,_，、~～\-—()（）[\]【】{}<>《》"'"']/gu, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
}

/** 三级匹配：返回级别，未命中返回 `null`。 */
export function matchLevel(memberName: string, contactName: string): MatchLevel | null {
  const member = normalizeName(memberName)
  const contact = normalizeName(contactName)
  if (member === '' || contact === '') return null
  if (member === contact) return '精确'
  if (member.length < ALIGN_MIN_NAME_LENGTH || contact.length < ALIGN_MIN_NAME_LENGTH) return null

  const shorter = member.length <= contact.length ? member : contact
  const longer = member.length <= contact.length ? contact : member
  if (longer.includes(shorter) && shorter.length / longer.length >= ALIGN_CONTAINS_MIN_RATIO) {
    return '包含'
  }
  if (editDistanceWithin(member, contact, ALIGN_EDIT_DISTANCE_MAX)) {
    return '编辑距离'
  }
  return null
}

/** 编辑距离是否 ≤ `max`（上限提前退出；不做全量 DP 到超出为止）。 */
export function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      )
      current.push(value)
      rowMin = Math.min(rowMin, value)
    }
    if (rowMin > max) return false
    previous = current
  }
  return (previous[b.length] ?? max + 1) <= max
}
