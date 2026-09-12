/**
 * CLI 依赖探测（mod-001 §3.1「cli/probe.ts」、HLD 决策 7）。
 *
 * 口径（客观事实，AGENTS.md）：
 * - `bin/wechat-cli` 需要 `state/config.json`（至少 `db_dir`）与 `state/all_keys.json`（首次提权生成）；
 *   查询不需要 root，也不需要微信客户端在运行。
 * - CLI **没有版本子命令，也没有 init 状态查询命令**（12 条命令里没有）→ 本模块不猜：
 *   `version` 恒为 null，`initState` 保持 `unknown`，初始化状态由首次真实命令的**退出码 1**判定
 *   （= 找不到聊天对象 / 密钥缺失或不匹配 → `NO_AUTH`）。
 * - 因此探测只做一件事：可执行文件是否存在且可执行（零副作用、不拉起子进程）。
 */

import { access, constants } from 'node:fs/promises'

import type { CliProbeResult } from './runner'
import { resolveCliExecutable } from './runner'

/** 探测可执行文件（存在性 + 执行权限）。 */
export async function probeCli(options: { executable?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CliProbeResult> {
  const executable = resolveCliExecutable(options.executable, options.env ?? process.env)
  try {
    await access(executable, constants.X_OK)
  } catch {
    return {
      executable,
      available: false,
      version: null,
      initState: 'unknown',
      note: '找不到可执行文件或没有执行权限：请检查终端里的 wechat-cli 安装与 cli.executable 配置',
    }
  }
  return {
    executable,
    available: true,
    version: null,
    initState: 'unknown',
    note: 'CLI 无版本 / init 状态子命令：初始化状态由首次命令的退出码（1 = 未授权）判定',
  }
}
