/**
 * 关键词匹配列与 LIKE 转义（mod-002 §4.2 / 决策 6）。
 *
 * - 参数化 `LIKE '%kw%'`，不引入 FTS5（决策 6）；
 * - 转义 `%` / `_` / `\`（ESCAPE '\'），关键词原样匹配（任意长度、任意字符）；
 * - ASCII 大小写不敏感由 SQLite `LIKE` 默认提供；中文按字面匹配。
 */

/** LIKE 通配符转义（含转义字符自身）。 */
export function escapeLike(keyword: string): string {
  return keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** 构造 LIKE 模式（`%<escaped>%`）。 */
export function likePattern(keyword: string): string {
  return `%${escapeLike(keyword)}%`
}
