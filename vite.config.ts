import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * 前端构建配置（浏览器侧页面）。
 *
 * - 根目录 src/web，构建输出 dist/web（形态见 docs/design/impl/high-level-design.md §4）。
 * - 开发期 /api、/media 代理到本机服务进程；服务进程端口默认由 config.json 的 server.port 决定
 *   （默认 0 = 自动选空闲端口，见 docs/design/impl/detailed-design.md §7）。
 *   开发时请把 server.port 固定为代理目标端口，或用环境变量 MESSAGEPICK_SERVER_PORT 覆盖代理目标。
 * - 别名必须与 tsconfig.json 的 paths 保持一致（共享契约类型只从 @shared 导入）。
 */

const sharedDir = fileURLToPath(new URL('./src/shared', import.meta.url))
const serverDir = fileURLToPath(new URL('./src/server', import.meta.url))
const webDir = fileURLToPath(new URL('./src/web', import.meta.url))

/** 开发期代理目标：服务进程监听的回环地址。改端口优先用环境变量，不改本文件。 */
const serverPort = process.env.MESSAGEPICK_SERVER_PORT ?? '8787'
const proxyTarget = `http://127.0.0.1:${serverPort}`

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': sharedDir,
      '@server': serverDir,
      '@web': webDir,
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': { target: proxyTarget },
      '/media': { target: proxyTarget },
    },
  },
})
