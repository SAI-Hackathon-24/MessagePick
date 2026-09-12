/**
 * 外壳日志（mod-004 §3.1 的接线点、详设 §6.1 / §6.2）—— 进程内唯一持久观测面的落点。
 *
 * 口径（详设 §6.1）：
 * - 形式：JSON Lines；同时输出标准输出与 `logs/app-YYYY-MM-DD.log`；按天滚动，默认保留 7 天；
 * - 字段：`ts` / `level` / `event` / `module` / `requestId` / `taskRef` / `source` / `durationMs` / `code` /
 *   `counts` / `retry`（调用方按需给，缺省不编造）；
 * - 禁止写入：消息原文、联系人姓名、模型凭据、启动令牌（§4.3）——由调用方保证，本文件不做清洗。
 *
 * 模块的日志口（`StoreLogger` / `IngestLogger` / `ExtractLogger` / `MemeLogger` / `SocialLogger`）字段口径
 * 与本文一致，外壳把同一个 sink 灌进各模块（结构上满足它们「方法全可选」的口径）。
 */

import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 日志级别（详设 §6.1：error / warn / info / debug）。 */
export type ShellLogLevel = 'error' | 'warn' | 'info' | 'debug'

/** 日志字段（键名口径见详设 §6.1；不记消息原文与凭据）。 */
export interface ShellLogFields {
  readonly [key: string]: unknown
}

/** 结构化日志口（与各模块的 logger 结构兼容：模块侧方法全可选）。 */
export interface ShellLogger {
  error(event: string, fields?: ShellLogFields): void
  warn(event: string, fields?: ShellLogFields): void
  info(event: string, fields?: ShellLogFields): void
  debug(event: string, fields?: ShellLogFields): void
}

/** 级别序（数值越大越啰嗦；写入门槛见 `createShellLogger`）。 */
const LEVEL_ORDER: Readonly<Record<ShellLogLevel, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
}

/** 日志 sink 选项（全部可注入，便于单测与「不落盘」场景）。 */
export interface ShellLoggerOptions {
  /** 应用数据目录；缺省只写标准输出（不落盘）。 */
  dataDir?: string
  /** 级别门槛（默认 `info`；低于门槛的事件不产出）。 */
  level?: ShellLogLevel
  /** 日志保留天数（默认 7；启动时清理一次）。 */
  retentionDays?: number
  /** 时钟（默认 `Date.now`）。 */
  clock?: () => number
  /** 标准输出口（默认 `process.stdout`；测试注入收集数组）。 */
  stdout?: (line: string) => void
  /** 日志目录名（默认 `logs`；与 `MOD-002` 的目录约定一致）。 */
  dirName?: string
  /** 启动时是否清理过期日志（默认开）。 */
  prune?: boolean
}

/** 单日日志文件名（`app-YYYY-MM-DD.log`，按本机时区切天）。 */
export function logFileName(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `app-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.log`
}

/** 日志目录（`<dataDir>/logs`）。 */
export function logsDirOf(dataDir: string, dirName = 'logs'): string {
  return join(dataDir, dirName)
}

/**
 * 清理过期日志（详设 §7 的 `log.retentionDays`，默认 7 天；核验一次返回删除条数）。
 * 启动时调用；任何文件系统异常都不上抛（日志是旁路，不得反噬启动）。
 */
export function pruneOldLogs(dataDir: string, retentionDays: number, now: number, dirName = 'logs'): number {
  const dir = logsDirOf(dataDir, dirName)
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  let removed = 0
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('app-') || !name.endsWith('.log')) continue
      const path = join(dir, name)
      try {
        if (statSync(path).mtimeMs < cutoff) {
          rmSync(path)
          removed += 1
        }
      } catch {
        // 单个文件清理失败不影响其余（下次启动重试）
      }
    }
  } catch {
    // 目录不存在 / 不可读：无日志可清理
  }
  return removed
}

/** 创建日志 sink（标准输出 + 可选的按天落盘）。 */
export function createShellLogger(options: ShellLoggerOptions = {}): ShellLogger {
  const level = options.level ?? 'info'
  const clock = options.clock ?? Date.now
  const stdout = options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`))
  const dirName = options.dirName ?? 'logs'
  const dataDir = options.dataDir
  const threshold = LEVEL_ORDER[level]

  if (dataDir !== undefined && (options.prune ?? true)) {
    pruneOldLogs(dataDir, options.retentionDays ?? 7, clock(), dirName)
  }

  const write = (entryLevel: ShellLogLevel, event: string, fields: ShellLogFields | undefined): void => {
    if (LEVEL_ORDER[entryLevel] > threshold) return
    const ts = clock()
    // 字段放后面：调用方提供的 `module` / `requestId` 等不会被默认值覆盖。
    const line = JSON.stringify({ ts, level: entryLevel, event, ...(fields ?? {}) })
    try {
      stdout(line)
    } catch {
      // 标准输出异常不打断请求
    }
    if (dataDir === undefined) return
    try {
      const dir = logsDirOf(dataDir, dirName)
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, logFileName(ts)), `${line}\n`)
    } catch {
      // 落盘失败不打断请求（唯一持久观测面缺失时仍有标准输出）
    }
  }

  return {
    error: (event, fields) => write('error', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    info: (event, fields) => write('info', event, fields),
    debug: (event, fields) => write('debug', event, fields),
  }
}

/** 静默 sink（测试与「未接线」场景：不产出任何日志）。 */
export function createSilentLogger(): ShellLogger {
  return {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
  }
}

/** 收集到内存的 sink（单测断言日志事件用）。 */
export function createMemoryLogger(): ShellLogger & { readonly lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = []
  const push = (level: ShellLogLevel, event: string, fields?: ShellLogFields): void => {
    lines.push({ level, event, ...(fields ?? {}) })
  }
  return {
    lines,
    error: (event, fields) => push('error', event, fields),
    warn: (event, fields) => push('warn', event, fields),
    info: (event, fields) => push('info', event, fields),
    debug: (event, fields) => push('debug', event, fields),
  }
}
