/**
 * wechat-cli 子进程适配（mod-001 §3.1「cli/runner.ts」、决策 1、详设 §1.4）。
 *
 * - **参数数组、不经 shell**（`spawn(executable, args)`；args 里的空格 / 引号 / `;` 一律按字面量传递）。
 * - 超时 = 终止子进程 + 不读残缺输出（`timedOut` 标记，由 `retry.ts` 映射为 `TIMEOUT`）。
 * - stdout 是纯 JSON、日志与报错走 stderr（AGENTS.md §1）：只保留 stderr 的尾部片段（详设 §6.1 的 4 KB 截断口径）。
 * - **入口固定为 `<repo>/bin/wechat-cli`**：`bin/wechat-cli` 会把 `WECHAT_CLI_CONFIG` / `WECHAT_CLI_CACHE`
 *   固定到该仓库的 `state/`；直接调 `.venv/bin/wechat-cli` 会退回全局状态目录（AGENTS.md §1）。
 *   配置 `cli.stateDir` 非空时，本模块按同一口径显式指定这两个环境变量。
 * - 并发：解密缓存是单写者，调用方（`run/executor.ts` 的全局互斥）保证同一时刻只有一条命令在飞。
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { probeCli } from './probe'

/** 本机默认入口（客观事实：CLI 仓库不在本应用仓库内；配置 `cli.executable` 可覆盖）。 */
export const DEFAULT_CLI_EXECUTABLE = '/home/xm71/projects/OH-WorkSpace/tools/wechat-cli/bin/wechat-cli'

/** stderr 尾部保留上限（详设 §6.1：失败片段截断入日志）。 */
export const STDERR_TAIL_LIMIT = 4 * 1024

/** 单条 CLI 命令的返回。 */
export interface CliResult {
  /** 退出码（超时 / 启动失败时为 -1） */
  exitCode: number
  stdout: string
  stderrTail: string
  durationMs: number
  /** 超时后被强制终止（不读残缺输出） */
  timedOut: boolean
  /** 子进程启动失败（可执行文件不存在 / 无执行权限） */
  spawnFailed: boolean
}

/** 依赖探测结果（`probe()`）。 */
export interface CliProbeResult {
  executable: string
  /** 可执行文件存在且可执行 */
  available: boolean
  /** CLI 版本（无版本子命令时为 null） */
  version: string | null
  /** 初始化状态：`unknown` = 未探测（由首次命令的退出码判定，避免多余的 CLI 调用） */
  initState: 'unknown' | 'ready' | 'noAuth'
  note?: string
}

/** CLI 运行器（唯一拉起子进程的地方）。 */
export interface CliRunner {
  /** 执行一条命令；超时即终止子进程。 */
  run(args: string[], timeoutMs: number): Promise<CliResult>
  /** 可执行文件存在性 / 版本 / init 状态探测。 */
  probe(): Promise<CliProbeResult>
}

export interface CliRunnerOptions {
  /** 可执行文件路径（配置 `cli.executable`；缺省见 `resolveCliExecutable`）。 */
  executable?: string
  /** CLI 状态目录（配置 `cli.stateDir`；留空 = CLI 自己的默认）。 */
  stateDir?: string
  /** 额外环境变量（测试注入路径等）。 */
  env?: Record<string, string>
  /** 工作目录（缺省继承父进程）。 */
  cwd?: string
  /** 进程内时钟（测试注入）。 */
  clock?: () => number
}

/** 解析可执行文件路径：显式配置 → `WECHAT_CLI_BIN` → `WECHAT_CLI_REPO/bin/wechat-cli` → 本机默认入口。 */
export function resolveCliExecutable(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (explicit !== undefined && explicit !== '') return explicit
  const fromEnv = env.WECHAT_CLI_BIN
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const repo = env.WECHAT_CLI_REPO
  if (repo !== undefined && repo !== '') return join(repo, 'bin', 'wechat-cli')
  return DEFAULT_CLI_EXECUTABLE
}

/** 状态目录 → CLI 的环境变量（口径与 `bin/wechat-cli` 一致；留空则不干预）。 */
function stateDirEnv(stateDir: string | undefined): Record<string, string> {
  if (stateDir === undefined || stateDir === '') return {}
  return {
    WECHAT_CLI_CONFIG: join(stateDir, 'config.json'),
    WECHAT_CLI_CACHE: join(stateDir, 'cache'),
  }
}

function tail(text: string, limit = STDERR_TAIL_LIMIT): string {
  if (text.length <= limit) return text
  return text.slice(text.length - limit)
}

/** 创建 CLI 运行器（默认实现；测试以假的 `CliRunner` 替换，不真调 CLI）。 */
export function createCliRunner(options: CliRunnerOptions = {}): CliRunner {
  const executable = resolveCliExecutable(options.executable)
  const clock = options.clock ?? Date.now
  const env: NodeJS.ProcessEnv = { ...process.env, ...stateDirEnv(options.stateDir), ...(options.env ?? {}) }

  return {
    run(args, timeoutMs) {
      return new Promise<CliResult>((resolve) => {
        const startedAt = clock()
        const child = spawn(executable, [...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
          env,
        })
        let stdout = ''
        let stderr = ''
        let timedOut = false
        let settled = false
        const timer = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, timeoutMs)

        const finish = (exitCode: number, spawnFailed: boolean): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ exitCode, stdout, stderrTail: tail(stderr), durationMs: clock() - startedAt, timedOut, spawnFailed })
        }

        child.stdout?.setEncoding('utf8')
        child.stdout?.on('data', (chunk: string) => {
          stdout += chunk
        })
        child.stderr?.setEncoding('utf8')
        child.stderr?.on('data', (chunk: string) => {
          stderr += chunk
        })
        child.on('error', () => {
          finish(-1, true)
        })
        child.on('close', (code) => {
          finish(code ?? -1, false)
        })
      })
    },

    async probe() {
      return await probeCli({ executable, env })
    },
  }
}
