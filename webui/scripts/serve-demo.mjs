/**
 * 静态示范站的服务脚本（零依赖，只用 Node 内置模块）
 * =============================================================================
 * 用途：把 `demo-dist/` 当作**纯静态站点**托管，用于演示 / 截图 / 给评审看界面。
 * 与正式版的区别：不需要后端进程、不需要模型凭据、不需要微信数据。
 *
 * 用法：
 *   npm run demo:build && npm run demo:serve        # 默认 127.0.0.1:5280
 *   PORT=6000 npm run demo:serve
 *
 * 说明：只监听回环地址；仅提供 demo-dist 内的文件，且拒绝越出该目录的路径。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'demo-dist');
const PORT = Number(process.env.PORT ?? 5280);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`);
  // 路径归一后必须仍在 ROOT 内（防目录穿越）
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(ROOT, rel);

  try {
    const info = await stat(filePath).catch(() => null);
    if (info === null || info.isDirectory()) {
      // SPA 语义：未知路径回落到 index.html（本应用用 hash 路由，正常不会走到这里）
      filePath = join(ROOT, 'index.html');
    }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`未找到：${url.pathname}\n${error instanceof Error ? error.message : ''}`);
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`静态示范站已启动：http://${HOST}:${PORT}/\n（数据为内置演示数据，无需后端）\n`);
});
