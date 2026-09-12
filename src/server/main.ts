/**
 * 服务进程入口（`npm run dev:server` / `npm start` 指向本文件；详设决策 9）。
 *
 * 三步启动（实现全在 `shell/app.ts` 的 `startShell()` / `openPage()`，本文件只做编排与收尾）：
 * 1. **选端口**：`config.json` 的 `server.port`（默认 `0` = 自动选空闲端口，详设 §7）；
 * 2. **启服务**：只监听回环 `127.0.0.1`（详设 §4.1；HLD §4）；
 * 3. **打开带令牌页面**：启动令牌经 URL fragment 注入（页面只在内存持有；令牌不进日志，详设 §4.3）。
 *
 * 启动失败（库迁移失败 / 库版本过高 / 端口占用……）→ 明确提示 + 非零退出码，不静默重试（详设 §8.1）。
 * `Ctrl+C` / `SIGTERM` → 关服务并释放句柄（排队中的引擎任务转 `canceled`）。
 *
 * 环境变量：`MESSAGEPICK_DATA_DIR`（应用数据目录，缺省 `<仓库根>/data`）、
 * `MESSAGEPICK_NO_OPEN=1`（不自动打开浏览器）、`MESSAGEPICK_OPEN=1`（页面未构建时也强制打开）。
 */

import { openPage, startShell, type ShellServer } from './shell/app'

/** 自动打开浏览器的开关（默认：页面已构建才打开，避免打开一个 404）。 */
const suppressed = process.env['MESSAGEPICK_NO_OPEN'] === '1'
const forced = process.env['MESSAGEPICK_OPEN'] === '1'

async function main(): Promise<void> {
  const shell: ShellServer = await startShell()

  const lines = [`MessagePick 服务已启动（仅本机可访问）：${shell.url}`, `应用数据目录：${shell.dataDir}`]
  if (shell.pageBuilt) {
    lines.push(`页面地址（含启动令牌，请用此地址打开）：${shell.pageUrl}`)
  } else {
    lines.push('页面尚未构建：先 `npm run build` 后用上面的地址打开；')
    lines.push('开发期请用 `npm run dev:web`（vite，需把 config.json 的 server.port 固定为 8787），')
    lines.push(`并在地址上加令牌 fragment：http://127.0.0.1:5173/#token=${shell.token}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)

  if (!suppressed && (shell.pageBuilt || forced)) {
    openPage(shell.pageUrl)
  }

  const stop = async (signal: string): Promise<void> => {
    process.stdout.write(`\n收到 ${signal}：正在关闭服务…\n`)
    await shell.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void stop('SIGINT'))
  process.once('SIGTERM', () => void stop('SIGTERM'))
}

main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error)
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  const hints: string[] = []
  if (code === 'EADDRINUSE') {
    hints.push('端口已被占用：请修改 config.json 的 server.port，或改回 0 由系统自动选择。')
  }
  hints.push('详细原因见控制台输出与 logs/ 下的日志；修复后重新执行 npm start。')
  process.stderr.write([`MessagePick 启动失败：${detail}`, ...hints].join('\n') + '\n')
  process.exitCode = 1
})
