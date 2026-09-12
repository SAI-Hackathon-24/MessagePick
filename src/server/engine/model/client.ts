/**
 * 模型调用（mod-003 §3.1「model/client.ts」、决策 8；详设 §4.3、§8.2）。
 *
 * - OpenAI 兼容：`POST {baseUrl}/chat/completions`，Bearer 凭据，`{ model, messages }`。
 * - 超时（`timeouts.modelCallMs`）、429 的 `Retry-After`、响应容错与错误归类都在这里；
 *   自动重试与熔断在 `policy/retry.ts`（本文件只报出一次性调用的结果 / 分类）。
 * - 凭据 / 模型名 / baseURL 全部来自配置，不在代码写死；凭据不进日志与报错文本。
 */

import type { Clock } from '../clock'
import type { EngineConfig } from '../config'
import { EngineFailure } from '../errors'
import type { ModelMessage } from '../prompt/assemble'

/** 出站 fetch 的最小形态（测试注入假端点；生产用全局 fetch）。 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** 模型客户端依赖。 */
export interface ModelClientDeps {
  /** 每次调用现读配置（下一个任务生效，详设 §7）。 */
  getConfig: () => EngineConfig
  fetchImpl: FetchLike
  clock: Clock
}

/** 一次成功的模型调用结果。 */
export interface ModelCallResult {
  /** 助手消息正文（待解析的 JSON 文本）。 */
  text: string
}

/** OpenAI 兼容调用客户端。 */
export class ModelClient {
  constructor(private readonly deps: ModelClientDeps) {}

  /** 执行一次调用；失败一律抛 `EngineFailure`（分类见 §6.1）。 */
  async call(messages: readonly ModelMessage[]): Promise<ModelCallResult> {
    const config = this.deps.getConfig()
    const baseUrl = config.model.baseUrl.trim()
    const apiKey = config.model.apiKey.trim()
    const modelName = config.model.name.trim()

    if (baseUrl.length === 0) throw new EngineFailure('MODEL_NOT_CONFIGURED', '未配置模型服务地址（model.baseUrl）')
    if (apiKey.length === 0) throw new EngineFailure('MODEL_NOT_CONFIGURED', '未配置模型凭据（model.apiKey）')
    // 决策 8 的 `model.name`：空值按未配置处理——遵守「不在代码写死模型名」的硬规则（见模块回收报告）。
    if (modelName.length === 0) throw new EngineFailure('MODEL_NOT_CONFIGURED', '未配置模型名（model.name）')

    const controller = new AbortController()
    let timedOut = false
    const cancelTimer = this.deps.clock.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, config.timeouts.modelCallMs)

    try {
      let response: Response
      try {
        response = await this.deps.fetchImpl(chatCompletionsUrl(baseUrl), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model: modelName, messages }),
          signal: controller.signal,
        })
      } catch (error) {
        if (timedOut) {
          throw new EngineFailure('CALL_TIMEOUT', `模型调用超时（${config.timeouts.modelCallMs} ms）`, { cause: error })
        }
        throw new EngineFailure('NETWORK', '模型服务网络不可达', { cause: error })
      }

      if (!response.ok) {
        throw this.#httpFailure(response)
      }

      let bodyText: string
      try {
        bodyText = await response.text()
      } catch (error) {
        throw new EngineFailure('NETWORK', '读取模型响应失败', { cause: error })
      }

      return { text: extractContent(bodyText) }
    } finally {
      cancelTimer()
    }
  }

  #httpFailure(response: Response): EngineFailure {
    const status = response.status
    if (status === 401 || status === 403) {
      return new EngineFailure('CREDENTIAL', `模型凭据无效（HTTP ${status}）`)
    }
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.deps.clock.now())
      return new EngineFailure('RATE_LIMIT', `模型服务限流（HTTP 429）`, { retryAfterMs })
    }
    if (status >= 500) {
      return new EngineFailure('UPSTREAM_5XX', `模型服务异常（HTTP ${status}）`)
    }
    return new EngineFailure('REQUEST_REJECTED', `模型服务拒绝请求（HTTP ${status}）`)
  }
}

function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  if (normalized.endsWith('/chat/completions')) return normalized
  return `${normalized}/chat/completions`
}

/** `Retry-After`：数字（秒）或 HTTP 日期；无法解析时返回 null（退回退避口径）。 */
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null
  const value = header.trim()
  if (value.length === 0) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000))

  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now)
}

/** 响应正文 → 助手内容；拒答 / 缺字段 / 类型不符按 §6.1 归类。 */
export function extractContent(bodyText: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    throw new EngineFailure('OUTPUT_INVALID', '模型响应不是合法 JSON')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new EngineFailure('OUTPUT_INVALID', '模型响应不是 JSON 对象')
  }

  const choices = (parsed as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new EngineFailure('OUTPUT_INVALID', '模型响应缺少 choices')
  }

  const choice = choices[0]
  if (typeof choice !== 'object' || choice === null) {
    throw new EngineFailure('OUTPUT_INVALID', '模型响应 choices[0] 结构异常')
  }

  const { message, finish_reason: finishReason } = choice as { message?: unknown; finish_reason?: unknown }
  if (typeof message !== 'object' || message === null) {
    throw new EngineFailure('OUTPUT_INVALID', '模型响应缺少 choices[0].message')
  }

  const refusal = (message as { refusal?: unknown }).refusal
  if (typeof refusal === 'string' && refusal.trim().length > 0) {
    throw new EngineFailure('REFUSAL', '模型拒答（refusal）')
  }
  if (finishReason === 'content_filter') {
    throw new EngineFailure('REFUSAL', '模型拒答（内容过滤）')
  }

  const content = normalizeContent((message as { content?: unknown }).content)
  if (content === null || content.trim().length === 0) {
    throw new EngineFailure('OUTPUT_INVALID', '模型响应内容为空')
  }
  return content
}

/** 容错：字符串直接用；多模态数组取 text 片段拼接（详设 §8.2）。 */
function normalizeContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === 'string') return part
        if (typeof part === 'object' && part !== null) {
          const text = (part as { text?: unknown }).text
          if (typeof text === 'string') return text
        }
        return ''
      })
      .filter((part) => part.length > 0)
    return parts.length > 0 ? parts.join('\n') : null
  }
  return null
}
