/**
 * 应用设置的页面侧读写与校验（详设 §7；`GET/PUT /api/settings`）。
 *
 * - 凭据只写不读回：页面显示「已配置 / 未配置」，不显示值（详设 §4.3）。
 * - 校验在页面侧先做一遍（给出中文原因），服务端仍会按 schema 兜底拒绝。
 * - 取值边界与详设 §7 一致：模型任务并发 1 ~ 8、日志保留 ≥ 1 天、各类超时为正数。
 */

/** 日志级别（详设 §7 的闭集）。 */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
/** 日志级别类型。 */
export type LogLevel = (typeof LOG_LEVELS)[number]

/** 日志级别 → 使用者可见名称（界面不出现英文级别名）。 */
export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: '调试（最详细）',
  info: '常规',
  warn: '警告以上',
  error: '仅错误',
}

/** 页面侧可见的设置（凭据值不回显）。 */
export interface ClientSettings {
  model: { baseUrl: string; apiKeyConfigured: boolean; taskConcurrency: number }
  ingest: { autoTriggerAfterIngest: boolean; pageSize: number }
  cli: { executable: string; stateDir: string }
  server: { port: number }
  log: { level: LogLevel; retentionDays: number }
  timeouts: { cliCommandMs: number; modelCallMs: number; renderMs: number }
  retry: { maxAttempts: number }
}

/** 页面侧默认值（服务端返回缺项时的兜底；与详设 §7 的默认值一致）。 */
export const DEFAULT_SETTINGS: ClientSettings = {
  model: { baseUrl: '', apiKeyConfigured: false, taskConcurrency: 4 },
  ingest: { autoTriggerAfterIngest: true, pageSize: 1000 },
  cli: { executable: '', stateDir: '' },
  server: { port: 0 },
  log: { level: 'info', retentionDays: 7 },
  timeouts: { cliCommandMs: 120000, modelCallMs: 90000, renderMs: 30000 },
  retry: { maxAttempts: 3 },
}

/** 可提交的设置补丁（只含使用者可改项）。 */
export interface SettingsPatch {
  model?: { baseUrl?: string; apiKey?: string; taskConcurrency?: number }
  ingest?: { autoTriggerAfterIngest?: boolean }
  log?: { level?: LogLevel }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function pick<T>(value: unknown, fallback: T): T {
  return typeof value === typeof fallback ? (value as T) : fallback
}

/** 归一化服务端返回（缺项用默认值补齐；凭据只保留「是否已配置」）。 */
export function coerceSettings(raw: unknown): ClientSettings | null {
  if (!isRecord(raw)) return null
  const model = isRecord(raw['model']) ? raw['model'] : {}
  const ingest = isRecord(raw['ingest']) ? raw['ingest'] : {}
  const cli = isRecord(raw['cli']) ? raw['cli'] : {}
  const server = isRecord(raw['server']) ? raw['server'] : {}
  const log = isRecord(raw['log']) ? raw['log'] : {}
  const timeouts = isRecord(raw['timeouts']) ? raw['timeouts'] : {}
  const retry = isRecord(raw['retry']) ? raw['retry'] : {}
  const level = log['level']
  return {
    model: {
      baseUrl: pick(model['baseUrl'], DEFAULT_SETTINGS.model.baseUrl),
      apiKeyConfigured:
        typeof model['apiKeyConfigured'] === 'boolean'
          ? model['apiKeyConfigured']
          : typeof model['apiKey'] === 'string' && model['apiKey'].length > 0,
      taskConcurrency: pick(model['taskConcurrency'], DEFAULT_SETTINGS.model.taskConcurrency),
    },
    ingest: {
      autoTriggerAfterIngest: pick(
        ingest['autoTriggerAfterIngest'],
        DEFAULT_SETTINGS.ingest.autoTriggerAfterIngest,
      ),
      pageSize: pick(ingest['pageSize'], DEFAULT_SETTINGS.ingest.pageSize),
    },
    cli: { executable: pick(cli['executable'], ''), stateDir: pick(cli['stateDir'], '') },
    server: { port: pick(server['port'], DEFAULT_SETTINGS.server.port) },
    log: {
      level: typeof level === 'string' && (LOG_LEVELS as readonly string[]).includes(level)
        ? (level as LogLevel)
        : DEFAULT_SETTINGS.log.level,
      retentionDays: pick(log['retentionDays'], DEFAULT_SETTINGS.log.retentionDays),
    },
    timeouts: {
      cliCommandMs: pick(timeouts['cliCommandMs'], DEFAULT_SETTINGS.timeouts.cliCommandMs),
      modelCallMs: pick(timeouts['modelCallMs'], DEFAULT_SETTINGS.timeouts.modelCallMs),
      renderMs: pick(timeouts['renderMs'], DEFAULT_SETTINGS.timeouts.renderMs),
    },
    retry: { maxAttempts: pick(retry['maxAttempts'], DEFAULT_SETTINGS.retry.maxAttempts) },
  }
}

/** 校验可提交补丁；返回首个问题（中文原因）或 `null`。 */
export function validateSettingsPatch(patch: SettingsPatch): string | null {
  const model = patch.model
  if (model) {
    if (model.baseUrl !== undefined) {
      const trimmed = model.baseUrl.trim()
      if (trimmed.length > 0 && !/^https?:\/\/\S+$/i.test(trimmed)) {
        return '模型服务地址需以 http:// 或 https:// 开头，留空表示未配置。'
      }
    }
    if (model.apiKey !== undefined && model.apiKey.trim().length === 0) {
      return '模型凭据不能提交空值；不改动请保持原样。'
    }
    if (model.taskConcurrency !== undefined) {
      const value = model.taskConcurrency
      if (!Number.isInteger(value) || value < 1 || value > 8) {
        return '模型任务并发上限需为 1 到 8 之间的整数。'
      }
    }
  }
  const ingest = patch.ingest
  if (ingest && ingest.autoTriggerAfterIngest !== undefined && typeof ingest.autoTriggerAfterIngest !== 'boolean') {
    return '「采集完成后自动分析」只能是开或关。'
  }
  const log = patch.log
  if (log && log.level !== undefined && !(LOG_LEVELS as readonly string[]).includes(log.level)) {
    return '日志级别取值不合法。'
  }
  return null
}

/** 凭据状态的展示文案（凭据值本身不回显）。 */
export function maskSecret(configured: boolean): string {
  return configured ? '已配置' : '未配置'
}
