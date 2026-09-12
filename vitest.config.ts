import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * 测试配置：Node 环境，覆盖 src/**\/*.test.ts（含 src/shared 的契约自检测试）。
 * 别名与 tsconfig.json 保持一致。（浏览器界面在 webui/，由它自己的 vite/vitest 负责。）
 */

const sharedDir = fileURLToPath(new URL('./src/shared', import.meta.url))
const serverDir = fileURLToPath(new URL('./src/server', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': sharedDir,
      '@server': serverDir,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
