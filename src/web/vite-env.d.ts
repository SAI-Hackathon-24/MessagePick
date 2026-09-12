/**
 * 浏览器侧类型补充。
 *
 * `tsconfig.json` 的 `types` 只含 node（服务端与测试同源），因此这里补上 CSS 副作用导入的声明；
 * 样式文件本身由 vite 处理（`src/web/shell/styles.css`）。
 */

declare module '*.css'
