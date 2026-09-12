/**
 * 标签名规范化与标识派生（mod-007 §5.1：标签标识 = 一级维度 + 规范化标签名）。
 *
 * 规范化用于「同义比较」「人工增改定位」与「稳定标识」三处，必须是纯函数、无随机性。
 */

import type { Dimension, Id } from '@shared'

/** 规范化标签名：全角转半角（NFKC）、去首尾空白、折叠内部空白、小写化。 */
export function normalizeTagName(name: string): string {
  return name
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('zh-Hans-CN')
}

/** 标签标识（DM-013 记录身份键的派生形式）。 */
export function tagIdOf(dimension: Dimension, name: string): Id {
  return `${dimension}:${normalizeTagName(name)}`
}
