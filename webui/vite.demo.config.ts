/**
 * 静态示范站的构建配置（**不进正式构建链路**）
 * =============================================================================
 * 与 `vite.config.ts` 的唯一区别：把 `@/api` 指向 `src/api/demoApi.ts`，
 * 于是**页面组件仍是未改动的正式源码**，只有数据来源被换成内置演示数据。
 *
 * 用法：
 *   npm run demo:build     # 产物 → demo-dist/（相对路径，可托管在任意子路径）
 *   npm run demo:serve     # 本地静态预览（纯静态文件，无后端）
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // 相对资源路径：产物可托管在 GitCode Pages / 任意子目录 / 本地文件
  base: './',
  resolve: {
    alias: [
      // 顺序重要：更具体的 `@/api` 必须排在 `@` 之前
      { find: /^@\/api$/, replacement: fileURLToPath(new URL('./src/api/demoApi.ts', import.meta.url)) },
      { find: /^@\//, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/` },
    ],
  },
  build: {
    outDir: 'demo-dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5280,
    strictPort: true,
    allowedHosts: ['frp-sea.com'],
  },
});
