import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/** 开发期代理目标：本机服务进程（与根 `vite.config.ts` 同口径，端口可用环境变量覆盖）。 */
const serverPort = process.env.MESSAGEPICK_SERVER_PORT ?? '8787';
const proxyTarget = `http://127.0.0.1:${serverPort}`;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: false,
    // 允许通过隧道域名访问 dev server（由使用者添加，保留）
    allowedHosts: ['frp-sea.com'],
    // 开发期把本机服务进程的接口挂到本 dev server：
    // 读操作可用；写操作的 Origin 守卫按「服务自身端口」校验，完整功能请走 `npm start` 托管页面（见 README）。
    proxy: {
      '/api': { target: proxyTarget },
      '/media': { target: proxyTarget },
    },
  },
  build: {
    /**
     * 产物进 `webui/dist`。
     * ⚠️ 必须与服务端 `defaultWebDir()`（`src/server/shell/app.ts` = `<仓库根>/webui/dist/`）
     * 一致：服务端用 `existsSync(webui/dist/index.html)` 判定 `pageBuilt`，
     * 目录不一致会导致 `npm run build && npm start` 后页面不被托管（表现为 404 兜底）。
     */
    outDir: 'dist',
    emptyOutDir: true,
  },
});
