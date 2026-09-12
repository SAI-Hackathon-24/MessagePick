/**
 * MOD-005 §7「负向护栏 + 类型目录」测试面：
 *
 * - 类型闭集与图例 ≤ 3 类、颜色与文字标签共用同一取值来源（AC-041）；
 * - 白名单断言：输出中无情感 / 立场字段、无梗王之外成员画像、无 G4 入口、无跨模块越界依赖
 *   （AC-075 ~ AC-078、§2 实现侧硬边界）——静态扫描 + 运行期形状断言。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { MEME_KINDS, type MemeKind } from '@shared'

import { KIND_COLORS, TYPE_CLOSED_SET } from '../constants'
import { colorOf, isKnownKind, legendOf } from '../domain/typeCatalog'

const MODULE_DIR = fileURLToPath(new URL('..', import.meta.url))

/** 模块源码文件（排除测试目录；用于静态护栏断言）。 */
function moduleSourceFiles(): string[] {
  return readdirSync(MODULE_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.includes('__tests__'))
    .map((file) => join(MODULE_DIR, file))
}

describe('MOD-005 TypeCatalog：类型闭集与图例（AC-041）', () => {
  it('类型闭集 = 3 类（口头禅 / 内部梗 / 表情包梗）', () => {
    expect(TYPE_CLOSED_SET).toEqual(MEME_KINDS)
    expect(TYPE_CLOSED_SET).toHaveLength(3)
    for (const kind of MEME_KINDS) expect(isKnownKind(kind)).toBe(true)
    expect(isKnownKind('禁忌梗')).toBe(false)
    expect(isKnownKind('')).toBe(false)
    expect(isKnownKind(undefined)).toBe(false)
  })

  it('图例 ≤ 3 项、顺序固定、每项带颜色 + 文字标签（不依赖颜色单独区分）', () => {
    const legend = legendOf(['表情包梗', '口头禅', '内部梗', '越界类型'] as unknown as MemeKind[])
    expect(legend).toHaveLength(3)
    expect(legend.map((item) => item.kind)).toEqual(['口头禅', '内部梗', '表情包梗'])
    for (const item of legend) {
      expect(item.label).toBe(item.kind)
      expect(item.color).toBe(KIND_COLORS[item.kind])
      expect(colorOf(item.kind)).toBe(item.color)
    }
    expect(legendOf([])).toEqual([])
  })

  it('颜色表只覆盖闭集三类（无额外类型扩充）', () => {
    expect(Object.keys(KIND_COLORS).sort()).toEqual([...MEME_KINDS].sort())
  })
})

describe('MOD-005 负向护栏：白名单静态断言（AC-075 ~ AC-078）', () => {
  const files = moduleSourceFiles()
  const sources = files.map((file) => ({ file, content: readFileSync(file, 'utf8') }))

  it('至少扫描到模块全部源码文件（防护栏空转）', () => {
    expect(files.length).toBeGreaterThanOrEqual(15)
  })

  it('无情感倾向 / 立场类字段与文案（AC-075）', () => {
    const offenders = sources.filter(({ content }) => /(情感|立场)/.test(content))
    expect(offenders.map(({ file }) => file)).toEqual([])
  })

  it('无 G4 规划功能入口（AC-078）', () => {
    const offenders = sources.filter(({ content }) => /G4/.test(content))
    expect(offenders.map(({ file }) => file)).toEqual([])
  })

  it('无跨模块越界依赖（不 import MOD-006 / MOD-007 / MOD-008，不碰数据库驱动）', () => {
    const offenders = sources.filter(({ content }) => {
      const crossesModule = /from\s+['"][^'"]*(extract|social|regen)\//.test(content)
      const touchesDb = /better-sqlite3/.test(content)
      return crossesModule || touchesDb
    })
    expect(offenders.map(({ file }) => file)).toEqual([])
  })

  it('模型调用只经引擎网关：模块内不存在模型 SDK / 地址 / 凭据调用点', () => {
    const offenders = sources.filter(({ content }) => /(openai|apiKey|Authorization)/i.test(content))
    expect(offenders.map(({ file }) => file)).toEqual([])
  })
})
