import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

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
    // 后端（core / MCP 服务）就绪后，把真实接口挂到这里即可，前端无需改动业务代码：
    // proxy: { '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true } },
  },
});
