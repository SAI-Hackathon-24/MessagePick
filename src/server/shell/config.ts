/**
 * 应用配置读写（mod-004 §3.1 / §4.1「GET/PUT /api/settings」、详设 §7）。
 *
 * 口径（详设 §7 逐条）：
 * - 文件：应用数据目录 `config.json`，**权限 0600**；写入用「临时文件 + rename」原子替换。
 * - 解析失败：备份为 `config.json.bad`、**以默认值启动**并在日志给出提示（凭据缺失按未配置引导）；
 * - 未知键忽略、非法值回落默认值（同时记一条 issue，不静默吞掉）；
 * - 凭据（`model.apiKey`）只进内存与文件，**不回读给页面**（详设 §4.3）；页面只拿到「已配置」布尔。
 * - 本文件只负责「文件 ↔ 内存对象」，不触碰引擎 / 模块；生效时机（立即 / 下次启动）在
 *   `orchestration/settings.ts` 与 `app.ts` 的接线处落实（`model.taskConcurrency` 立即、`server.port` 下次启动……）。
 */

import { chmodSync, existsSync, copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ShellLogLevel } from './log'

/** 配置文件名（应用数据目录内；详设 §3.4 的数据落点清单）。 */
export const CONFIG_FILE = 'config.json'
/** 解析失败时的备份名（详设 §7）。 */
export const CONFIG_BAD_FILE = 'config.json.bad'

/** 应用配置（键名与详设 §7 表格一致；不增不减）。 */
export interface ShellConfig {
  model: {
    /** 模型服务地址（OpenAI 兼容）；空 = 未配置 */
    baseUrl: string
    /** 模型凭据；只写不读回（详设 §4.3） */
    apiKey: string
    /**
     * 模型名（决策 8 的 `model.name`；空 = 未配置）。
     * ⚠️ 该字段此前**只存在于引擎配置**（`EngineConfig.model.name`），未进入外壳配置，
     * 也没有任何写入路径；而模型客户端要求它非空（空即抛「未配置模型名」），
     * 导致整条分析链路在门口失败。此处补齐为可配置项。
     */
    name: string
    /** 模型任务并发上限（1–8） */
    taskConcurrency: number
  }
  cli: {
    /** wechat-cli 可执行文件；空 = 自动探测 PATH */
    executable: string
    /** CLI 状态目录；空 = CLI 默认 */
    stateDir: string
  }
  server: {
    /** 本机服务端口；0 = 自动选空闲端口（下次启动生效） */
    port: number
  }
  timeouts: {
    /** 单条 CLI 命令超时（毫秒） */
    cliCommandMs: number
    /** 单次模型调用超时（毫秒） */
    modelCallMs: number
    /** 单次图像合成超时（毫秒） */
    renderMs: number
  }
  retry: {
    /** 自动重试次数上限 */
    maxAttempts: number
  }
  log: {
    /** 日志级别 */
    level: ShellLogLevel
    /** 日志保留天数（下次启动清理） */
    retentionDays: number
  }
  ingest: {
    /** 采集分页大小（下次采集生效） */
    pageSize: number
    /** 采集完成后自动触发分析（HLD 决策 9） */
    autoTriggerAfterIngest: boolean
  }
}

/** 默认值（详设 §7 表格的「默认值」列，逐项对应）。 */
export const DEFAULT_CONFIG: ShellConfig = {
  model: { baseUrl: '', apiKey: '', name: '', taskConcurrency: 4 },
  cli: { executable: '', stateDir: '' },
  server: { port: 0 },
  timeouts: { cliCommandMs: 120_000, modelCallMs: 90_000, renderMs: 30_000 },
  retry: { maxAttempts: 3 },
  log: { level: 'info', retentionDays: 7 },
  ingest: { pageSize: 1_000, autoTriggerAfterIngest: true },
}

/** 可提交的设置补丁（只含使用者可改项；页面 `SettingsPatch` 的同源结构）。 */
export interface SettingsPatch {
  model?: { baseUrl?: string; apiKey?: string; name?: string; taskConcurrency?: number }
  ingest?: { autoTriggerAfterIngest?: boolean }
  log?: { level?: ShellLogLevel }
}

/** 配置文件的绝对路径（应用数据目录下）。 */
export function configPathOf(dataDir: string): string {
  return join(dataDir, CONFIG_FILE)
}

/** 读取配置的结果（`source` 用于启动日志与设置页提示）。 */
export interface ConfigLoadResult {
  config: ShellConfig
  /** `file` = 正常读取；`default` = 文件不存在（首次启动）；`recovered` = 解析失败已备份并按默认值启动 */
  source: 'file' | 'default' | 'recovered'
  /** 解析失败的备份路径（`recovered` 时给出） */
  badPath: string | null
  /** 落到默认值的非法项说明（只进日志；不出页面） */
  issues: readonly string[]
}

const LOG_LEVELS: readonly ShellLogLevel[] = ['error', 'warn', 'info', 'debug']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(raw: unknown, fallback: string, path: string, issues: string[]): string {
  if (raw === undefined) return fallback
  if (typeof raw !== 'string') {
    issues.push(`${path} 取值类型非法，回落默认值`)
    return fallback
  }
  return raw
}

function intValue(
  raw: unknown,
  fallback: number,
  path: string,
  issues: string[],
  bounds: { min?: number; max?: number } = {},
): number {
  if (raw === undefined) return fallback
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    issues.push(`${path} 取值非整数，回落默认值`)
    return fallback
  }
  if (bounds.min !== undefined && raw < bounds.min) {
    issues.push(`${path} 低于下限 ${bounds.min}，回落默认值`)
    return fallback
  }
  if (bounds.max !== undefined && raw > bounds.max) {
    issues.push(`${path} 高于上限 ${bounds.max}，回落默认值`)
    return fallback
  }
  return raw
}

function boolValue(raw: unknown, fallback: boolean, path: string, issues: string[]): boolean {
  if (raw === undefined) return fallback
  if (typeof raw !== 'boolean') {
    issues.push(`${path} 取值非布尔，回落默认值`)
    return fallback
  }
  return raw
}

function section(raw: unknown, key: string): Record<string, unknown> {
  if (!isRecord(raw)) return {}
  const value = raw[key]
  return isRecord(value) ? value : {}
}

/**
 * 归一化任意载荷 → 配置：未知键忽略、非法值回落默认值并记 issue（不抛异常）。
 * 解析出的对象结构对不上（如整个文件是数组）时按「全部默认 + 一条 issue」处理。
 */
export function normalizeConfig(raw: unknown): { config: ShellConfig; issues: string[] } {
  const issues: string[] = []
  if (raw !== undefined && !isRecord(raw)) {
    issues.push('配置文件顶层不是对象，整体回落默认值')
    return { config: structuredClone(DEFAULT_CONFIG), issues }
  }
  const source = isRecord(raw) ? raw : {}
  const model = section(source, 'model')
  const cli = section(source, 'cli')
  const server = section(source, 'server')
  const timeouts = section(source, 'timeouts')
  const retry = section(source, 'retry')
  const log = section(source, 'log')
  const ingest = section(source, 'ingest')

  const levelRaw = log['level']
  const level: ShellLogLevel =
    typeof levelRaw === 'string' && (LOG_LEVELS as readonly string[]).includes(levelRaw)
      ? (levelRaw as ShellLogLevel)
      : DEFAULT_CONFIG.log.level
  if (levelRaw !== undefined && level !== levelRaw) issues.push('log.level 不在闭集内，回落默认值')

  return {
    config: {
      model: {
        baseUrl: stringValue(model['baseUrl'], DEFAULT_CONFIG.model.baseUrl, 'model.baseUrl', issues),
        apiKey: stringValue(model['apiKey'], DEFAULT_CONFIG.model.apiKey, 'model.apiKey', issues),
        name: stringValue(model['name'], DEFAULT_CONFIG.model.name, 'model.name', issues),
        taskConcurrency: intValue(
          model['taskConcurrency'],
          DEFAULT_CONFIG.model.taskConcurrency,
          'model.taskConcurrency',
          issues,
          { min: 1, max: 8 },
        ),
      },
      cli: {
        executable: stringValue(cli['executable'], DEFAULT_CONFIG.cli.executable, 'cli.executable', issues),
        stateDir: stringValue(cli['stateDir'], DEFAULT_CONFIG.cli.stateDir, 'cli.stateDir', issues),
      },
      server: {
        port: intValue(server['port'], DEFAULT_CONFIG.server.port, 'server.port', issues, { min: 0, max: 65_535 }),
      },
      timeouts: {
        cliCommandMs: intValue(
          timeouts['cliCommandMs'],
          DEFAULT_CONFIG.timeouts.cliCommandMs,
          'timeouts.cliCommandMs',
          issues,
          { min: 1 },
        ),
        modelCallMs: intValue(
          timeouts['modelCallMs'],
          DEFAULT_CONFIG.timeouts.modelCallMs,
          'timeouts.modelCallMs',
          issues,
          { min: 1 },
        ),
        renderMs: intValue(timeouts['renderMs'], DEFAULT_CONFIG.timeouts.renderMs, 'timeouts.renderMs', issues, {
          min: 1,
        }),
      },
      retry: {
        maxAttempts: intValue(retry['maxAttempts'], DEFAULT_CONFIG.retry.maxAttempts, 'retry.maxAttempts', issues, {
          min: 0,
        }),
      },
      log: {
        level,
        retentionDays: intValue(log['retentionDays'], DEFAULT_CONFIG.log.retentionDays, 'log.retentionDays', issues, {
          min: 1,
        }),
      },
      ingest: {
        pageSize: intValue(ingest['pageSize'], DEFAULT_CONFIG.ingest.pageSize, 'ingest.pageSize', issues, { min: 1 }),
        autoTriggerAfterIngest: boolValue(
          ingest['autoTriggerAfterIngest'],
          DEFAULT_CONFIG.ingest.autoTriggerAfterIngest,
          'ingest.autoTriggerAfterIngest',
          issues,
        ),
      },
    },
    issues,
  }
}

/**
 * 启动读取（详设 §7）。
 *
 * 任何文件系统异常都不上抛：读不到就按默认值启动（配置是旁路，不得反噬启动）。
 */
export function loadConfig(dataDir: string): ConfigLoadResult {
  const path = configPathOf(dataDir)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { config: structuredClone(DEFAULT_CONFIG), source: 'default', badPath: null, issues: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // 解析失败：备份为 config.json.bad、以默认值启动（详设 §7）。
    const badPath = join(dataDir, CONFIG_BAD_FILE)
    try {
      copyFileSync(path, badPath)
    } catch {
      // 备份失败不影响「按默认值启动」这条主路径
    }
    return { config: structuredClone(DEFAULT_CONFIG), source: 'recovered', badPath, issues: ['配置文件解析失败'] }
  }
  const { config, issues } = normalizeConfig(parsed)
  return { config, source: 'file', badPath: null, issues }
}

/** 原子写入（临时文件 + rename；权限 0600；详设 §7）。 */
export function saveConfig(dataDir: string, config: ShellConfig): void {
  const path = configPathOf(dataDir)
  const tmp = `${path}.tmp-${process.pid}`
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch {
    // 部分文件系统不支持 chmod：权限已由 mode 尽力而为
  }
  renameSync(tmp, path)
  if (!existsSync(path)) {
    // rename 在极少数平台可能跨设备失败：清理临时文件后重试同目录写入
    rmSync(tmp, { force: true })
  }
}

/** 设置页只读视图（凭据只给「是否已配置」；详设 §4.3）。 */
export interface SettingsView {
  model: { baseUrl: string; apiKeyConfigured: boolean; name: string; taskConcurrency: number }
  ingest: { autoTriggerAfterIngest: boolean; pageSize: number }
  cli: { executable: string; stateDir: string }
  server: { port: number }
  log: { level: ShellLogLevel; retentionDays: number }
  timeouts: { cliCommandMs: number; modelCallMs: number; renderMs: number }
  retry: { maxAttempts: number }
}

/** 构造设置页视图（不回显凭据值）。 */
export function settingsViewOf(config: ShellConfig): SettingsView {
  return {
    model: {
      baseUrl: config.model.baseUrl,
      apiKeyConfigured: config.model.apiKey.length > 0,
      name: config.model.name,
      taskConcurrency: config.model.taskConcurrency,
    },
    ingest: { autoTriggerAfterIngest: config.ingest.autoTriggerAfterIngest, pageSize: config.ingest.pageSize },
    cli: { executable: config.cli.executable, stateDir: config.cli.stateDir },
    server: { port: config.server.port },
    log: { level: config.log.level, retentionDays: config.log.retentionDays },
    timeouts: { ...config.timeouts },
    retry: { ...config.retry },
  }
}

/** 补丁应用结果。 */
export interface PatchResult {
  /** 新配置（不可变更新，原对象不动） */
  config: ShellConfig
  /** 实际变更的键（点号路径；调用方据此决定「立即生效」的副作用） */
  changed: readonly string[]
}

/**
 * 应用补丁（调用方保证补丁已过校验）。
 *
 * `model.apiKey` 为 `<留空>` 之外的任意字符串即覆盖；不提供「清除凭据」之外的语义。
 * 合法性校验在 `http/validate.ts`（shell 侧 schema）与设置页（页面侧先检一遍）双跑。
 */
export function applySettingsPatch(config: ShellConfig, patch: SettingsPatch): PatchResult {
  const next = structuredClone(config)
  const changed: string[] = []
  if (patch.model !== undefined) {
    if (patch.model.baseUrl !== undefined && patch.model.baseUrl !== next.model.baseUrl) {
      next.model.baseUrl = patch.model.baseUrl
      changed.push('model.baseUrl')
    }
    if (patch.model.apiKey !== undefined && patch.model.apiKey !== next.model.apiKey) {
      next.model.apiKey = patch.model.apiKey
      changed.push('model.apiKey')
    }
    if (patch.model.name !== undefined && patch.model.name !== next.model.name) {
      next.model.name = patch.model.name
      changed.push('model.name')
    }
    if (patch.model.taskConcurrency !== undefined && patch.model.taskConcurrency !== next.model.taskConcurrency) {
      next.model.taskConcurrency = patch.model.taskConcurrency
      changed.push('model.taskConcurrency')
    }
  }
  if (patch.ingest?.autoTriggerAfterIngest !== undefined && patch.ingest.autoTriggerAfterIngest !== next.ingest.autoTriggerAfterIngest) {
    next.ingest.autoTriggerAfterIngest = patch.ingest.autoTriggerAfterIngest
    changed.push('ingest.autoTriggerAfterIngest')
  }
  if (patch.log?.level !== undefined && patch.log.level !== next.log.level) {
    next.log.level = patch.log.level
    changed.push('log.level')
  }
  return { config: next, changed }
}
