/**
 * 生成 `data/config.json`（模型 / 采集 / 服务等全部可配项）。
 * =============================================================================
 * 用法：
 *   npx tsx scripts/gen-config.ts > data/config.json     # 生成（会覆盖，先备份）
 *   npx tsx scripts/gen-config.ts                        # 仅打印到终端
 *
 * 为什么要用脚本生成而不是手写 JSON：字段模板直接取自后端的 `DEFAULT_CONFIG`，
 * 代码新增配置项时这里自动跟上，不会出现「文档写了、代码不认」的漂移。
 *
 * 换模型服务只改下面的 `MODEL` 常量（或设对应的环境变量）：
 *   MESSAGEPICK_MODEL_BASE_URL / MESSAGEPICK_MODEL_NAME / DEEPSEEK_API_KEY
 * 任何 OpenAI 兼容端点都可以（`POST {baseUrl}/chat/completions`、Bearer 鉴权）。
 */
import { DEFAULT_CONFIG } from '../src/server/shell/config'

/** 默认模型端点：DeepSeek 官方（OpenAI 兼容）。 */
const MODEL = {
  baseUrl: process.env['MESSAGEPICK_MODEL_BASE_URL'] ?? 'https://api.deepseek.com/v1',
  name: process.env['MESSAGEPICK_MODEL_NAME'] ?? 'deepseek-chat',
  /** 留空后用 `scripts/set-model-key.sh` 写入，避免密钥出现在命令历史里 */
  apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
  taskConcurrency: 4,
} as const

const config = structuredClone(DEFAULT_CONFIG)

config.model = { ...MODEL }

/** wechat-cli：留空 = 自动探测 PATH */
config.cli.executable = process.env['MESSAGEPICK_CLI'] ?? ''
config.cli.stateDir = process.env['MESSAGEPICK_CLI_STATE'] ?? ''

/** 采集：采集完成后自动触发分析（HLD 决策 9） */
config.ingest.autoTriggerAfterIngest = true
config.ingest.pageSize = 1000

/** 服务：0 = 每次启动自动选空闲端口；固定端口便于开发期代理 */
config.server.port = Number(process.env['MESSAGEPICK_PORT'] ?? 0)

process.stdout.write(`${JSON.stringify(config, null, 2)}\n`)
