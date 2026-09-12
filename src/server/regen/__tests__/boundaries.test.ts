/**
 * MOD-008 边界纪律（mod-008 §2 实现侧硬边界、§7.2「负向」；AC-034 / REQ-015 / REQ-085）。
 *
 * 静态检查（不联网、不桩）：
 * - 依赖方向：模块源码只 import node 内建、@shared 与模块内相对路径 —— 自然排除 MOD-005 / 006 / 007、
 *   数据库驱动与模型 SDK；
 * - 负向路径：不存在发布 / 分享 / 上传 / 转发 / 替换 / 发送类导出入口。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const regenDir = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** 负向动作词（AC-034：无自动发布、自动替换群内说法、对外分享 / 发送）。 */
const FORBIDDEN_ACTION_WORDS = ['publish', 'share', 'upload', 'forward', 'replace', 'send']

describe('MOD-008 依赖方向（§2：不 import 其他业务模块 / 不出现数据库驱动与模型 SDK）', () => {
  it('模块源码只依赖 node 内建、@shared 与模块内相对路径', () => {
    const files = listSourceFiles(regenDir)
    expect(files.length).toBeGreaterThanOrEqual(6)

    const violations: string[] = []
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const specifier of importSpecifiers(source)) {
        const label = `${modulePath(file)} → ${specifier}`
        if (specifier.startsWith('node:')) continue
        if (specifier === '@shared' || specifier.startsWith('@shared/')) continue
        if (specifier.startsWith('.')) {
          const resolved = resolve(dirname(file), specifier)
          if (!resolved.startsWith(regenDir + sep)) violations.push(label)
          continue
        }
        violations.push(label)
      }
    }

    expect(violations).toEqual([])
  })
})

describe('MOD-008 负向路径（AC-034）', () => {
  it('不存在发布 / 分享 / 上传 / 转发 / 替换 / 发送类导出入口', () => {
    const violations: string[] = []
    for (const file of listSourceFiles(regenDir)) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/g)) {
        const name = match[1]
        if (name === undefined) continue
        const hits = actionWords(name).filter((word) => FORBIDDEN_ACTION_WORDS.includes(word))
        if (hits.length > 0) violations.push(`${modulePath(file)} → ${name}（${hits.join(' / ')}）`)
      }
    }
    expect(violations).toEqual([])
  })

  it('不存在发布 / 分享 / 上传类源文件名', () => {
    const violations: string[] = []
    for (const file of listSourceFiles(regenDir)) {
      const stem = modulePath(file).replace(/\.ts$/, '')
      const hits = actionWords(stem).filter((word) => FORBIDDEN_ACTION_WORDS.includes(word))
      if (hits.length > 0) violations.push(`${modulePath(file)}（${hits.join(' / ')}）`)
    }
    expect(violations).toEqual([])
  })
})

/** 模块内相对路径（从模块根起算，便于失败信息定位）。 */
function modulePath(file: string): string {
  return file.slice(regenDir.length + 1)
}

/** 导出名 / 文件名的动作词切分（camelCase / snake_case / kebab-case / 路径分隔都识别）。 */
function actionWords(name: string): string[] {
  return name
    .split(/[-_.\/]|(?=[A-Z])/)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 0)
}

/** 模块源码文件（跳过测试目录；只扫 .ts）。 */
function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full))
    } else if (entry.name.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

/** 剔除注释，避免把文档示例当代码扫描。 */
function stripComments(rawSource: string): string {
  return rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/** 扫描真实的 import / export-from 说明符。 */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1]
    if (specifier) specifiers.push(specifier)
  }
  return specifiers
}
