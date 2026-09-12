/**
 * 服务进程入口（Wave 0 脚手架占位）。
 *
 * `npm run dev:server` / `npm start` 指向本文件（package.json）。
 * 真实实现由 MOD-004 承担：`src/server/shell/app.ts` 负责组装端口 / 路由 / 守卫 / SSE，
 * 并完成「选端口 → 启服务 → 打开带令牌页面」三步（详设决策 9）。
 * MOD-004 落地后请用 `shell/app.ts` 的启动函数替换本占位实现。
 */

console.error(
  [
    'src/server/main.ts 尚未实现（Wave 0 只建脚手架）。',
    '服务入口由 MOD-004 在 src/server/shell/app.ts 落地后接线：',
    '  端口：config.json 的 server.port（默认 0 = 自动选空闲端口，详设 §7）',
    '  防护：仅回环监听 + Host / Origin 校验 + 启动令牌（详设 §4.1）',
  ].join('\n'),
)

process.exitCode = 1
