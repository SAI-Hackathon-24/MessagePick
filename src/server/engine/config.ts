/**
 * 引擎配置读取与变更订阅（mod-003 §3.1「config.ts」）。
 *
 * 口径来源：详设 §7 配置表（`model.baseUrl` / `model.apiKey` / `model.taskConcurrency` /
 * `timeouts.modelCallMs` / `retry.maxAttempts`）+ mod-003 决策 8（`model.name`）。
 *
 * - 不在代码写死凭据 / 模型名 / baseURL：默认全为空，由外壳（MOD-004）把 `config.json` 的值灌进来
 *   （`configureEngine(patch)` 或 `createEngine({ config })`）。
 * - 凭据只经此进内存，不进日志、不进报错文本（详设 §4.3）。
 * - 生效时机：`model.taskConcurrency` 立即（重设信号量，运行中任务不打断）；其余下一个任务生效
 *   —— 都由「每次调用时现读」自然满足。
 */

/** 模型接入配置（OpenAI 兼容）。 */
export interface ModelConfig {
  /** 模型服务地址（OpenAI 兼容，如 `https://host/v1`）。 */
  baseUrl: string
  /** 模型凭据（Bearer）。 */
  apiKey: string
  /** 模型名（决策 8 的 `model.name`；空 = 未配置，见下方 `resolveModelNotConfigured`）。 */
  name: string
  /** 模型任务并发上限（1–8；详设 §7）。 */
  taskConcurrency: number
}

/** 引擎配置。 */
export interface EngineConfig {
  model: ModelConfig
  timeouts: {
    /** 单次模型调用超时（毫秒；详设 §7 默认 90000）。 */
    modelCallMs: number
  }
  retry: {
    /** 自动重试次数上限（详设 §7 默认 3；0 = 关闭自动重试）。 */
    maxAttempts: number
  }
}

/** 局部更新。 */
export interface EngineConfigPatch {
  model?: Partial<ModelConfig>
  timeouts?: Partial<EngineConfig['timeouts']>
  retry?: Partial<EngineConfig['retry']>
}

/** 默认值（详设 §7）；模型地址 / 凭据 / 模型名留空，按未配置处理。 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  model: {
    baseUrl: '',
    apiKey: '',
    name: '',
    taskConcurrency: 4,
  },
  timeouts: { modelCallMs: 90_000 },
  retry: { maxAttempts: 3 },
}

/** 配置存储：读取 + 变更订阅（队列据此热调整信号量）。 */
export interface EngineConfigStore {
  /** 当前配置快照（每次返回新对象，外部修改不影响内部状态）。 */
  get(): EngineConfig
  /** 局部更新并通知订阅者；非法值抛错（不静默接受）。 */
  patch(patch: EngineConfigPatch): EngineConfig
  subscribe(listener: (config: EngineConfig) => void): () => void
}

function merge(base: EngineConfig, patch: EngineConfigPatch): EngineConfig {
  return {
    model: { ...base.model, ...(patch.model ?? {}) },
    timeouts: { ...base.timeouts, ...(patch.timeouts ?? {}) },
    retry: { ...base.retry, ...(patch.retry ?? {}) },
  }
}

function assertValid(config: EngineConfig): EngineConfig {
  const { taskConcurrency } = config.model
  /* 2026-09-13 校准：云端模型端点（如 DeepSeek）并发余量充足（限制量级 2500），
     原 1–8 是为本机模型服务留的性能护栏；上限抬到 64，实际值由设置页/配置控制。 */
  if (!Number.isInteger(taskConcurrency) || taskConcurrency < 1 || taskConcurrency > 64) {
    throw new RangeError('model.taskConcurrency 必须是 1–64 的整数（详设 §7；2026-09-13 校准）')
  }
  const { modelCallMs } = config.timeouts
  if (!Number.isFinite(modelCallMs) || modelCallMs <= 0) {
    throw new RangeError('timeouts.modelCallMs 必须是正数（详设 §7）')
  }
  const { maxAttempts } = config.retry
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 10) {
    throw new RangeError('retry.maxAttempts 必须是 0–10 的整数（详设 §7）')
  }
  return config
}

/** 创建配置存储（默认值 + 可选初始覆盖）。 */
export function createEngineConfig(initial: EngineConfigPatch = {}): EngineConfigStore {
  let current = assertValid(merge(DEFAULT_ENGINE_CONFIG, initial))
  const listeners = new Set<(config: EngineConfig) => void>()

  const snapshot = (): EngineConfig => ({
    model: { ...current.model },
    timeouts: { ...current.timeouts },
    retry: { ...current.retry },
  })

  return {
    get: snapshot,
    patch(patch) {
      current = assertValid(merge(current, patch))
      const next = snapshot()
      for (const listener of [...listeners]) listener(next)
      return next
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** 进程级默认配置存储（外壳把 `config.json` 的值灌到这里）。 */
export const engineConfig: EngineConfigStore = createEngineConfig()

/** 便捷入口：更新进程级配置（等价于 `engineConfig.patch`）。 */
export function configureEngine(patch: EngineConfigPatch): EngineConfig {
  return engineConfig.patch(patch)
}
