/**
 * 本地接口防护（mod-004 §3.1「guard.ts」、§6.2、详设 §4.1）。
 *
 * 三件套（顺序固定：Host → Origin → 写令牌）：
 * 1. **Host 校验**：只接受回环 IP（`127.0.0.0/8`、`::1`）与 `localhost`（可带端口）；其余 403，不下发 CORS 头；
 * 2. **Origin 校验**：带 `Origin` 头的请求必须是应用页面自身 origin；跨源读取本就会被浏览器默认阻断（无 CORS 头），
 *    这里再把「跨源写入」挡在服务端；
 * 3. **启动令牌**：每次进程启动生成 128 位随机令牌；所有**写操作**必须携带 `x-mp-token` 头。
 *    缺失 / 不匹配 → 403，页面据此转**只读模式**（可浏览、写操作置灰），不自行获取令牌（§6.3）。
 */

import { randomBytes } from 'node:crypto'

import type { NextFunction, Request, Response } from 'express'

import { GUARD_STATUS, failure, shellEnvelope, type ResponseMeta } from './respond'

/** 写操作的启动令牌头（浏览器外壳按此发；令牌只存页面内存，详设 §4.1）。 */
export const TOKEN_HEADER = 'x-mp-token'

/** 每次进程启动生成 128 位随机令牌（16 字节 → 32 位十六进制）。 */
export function createStartupToken(bytes = 16): string {
  return randomBytes(bytes).toString('hex')
}

/** 去掉 Host 头里的端口（正确处理 `[::1]:1234`）。 */
export function hostnameOf(host: string | undefined): string | null {
  if (typeof host !== 'string' || host.length === 0) return null
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? null : host.slice(1, end)
  }
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

/** 回环主机名判定：`localhost` / `::1` / `127.0.0.0/8`。 */
export function isLoopbackHostname(hostname: string | null): boolean {
  if (hostname === null) return false
  const normalized = hostname.toLowerCase()
  if (normalized === 'localhost' || normalized === '::1') return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized)
  if (match === null) return false
  const octets = match.slice(1).map((value) => Number(value))
  if (octets.some((value) => value > 255)) return false
  return octets[0] === 127
}

/** 应用页面自身的 origin 集合（随实际监听端口；`localhost` 与回环 IP 等价）。 */
export function loopbackOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]
}

/** 守卫选项。 */
export interface GuardOptions {
  /** 启动令牌（`createStartupToken()` 或测试注入）。 */
  token: string
  /** 本机页面 origin 集合（随实际端口；`createGuard` 每次请求现取）。 */
  origins: () => readonly string[]
}

/** 守卫中间件（`host` / `origin` 全局挂；`write` 只挂在写路由上）。 */
export interface Guard {
  host(req: Request, res: Response, next: NextFunction): void
  origin(req: Request, res: Response, next: NextFunction): void
  write(req: Request, res: Response, next: NextFunction): void
}

/** 读操作的元信息（守卫拒绝时也要带 `epoch` / `requestId`）。 */
export type MetaOf = (req: Request) => ResponseMeta

/** 创建守卫。 */
export function createGuard(options: GuardOptions, metaOf: MetaOf): Guard {
  const reject = (res: Response, req: Request, message: string, scope: string, context?: Record<string, unknown>): void => {
    res.status(GUARD_STATUS).json(
      failure(
        metaOf(req),
        shellEnvelope('INVALID_INPUT', message, scope, {
          ...(context === undefined ? {} : { context }),
        }),
      ),
    )
  }

  return {
    host(req, res, next) {
      const hostname = hostnameOf(req.headers.host)
      if (isLoopbackHostname(hostname)) {
        next()
        return
      }
      reject(res, req, '请求的 Host 不合法：只接受本机回环地址', 'guard:host', {
        host: typeof req.headers.host === 'string' ? req.headers.host : null,
      })
    },

    origin(req, res, next) {
      const origin = req.headers.origin
      if (origin === undefined || origin === '') {
        // 同源导航 / 无 Origin 的本地调用：Host 校验已锁定回环
        next()
        return
      }
      if (typeof origin === 'string' && options.origins().includes(origin)) {
        next()
        return
      }
      reject(res, req, '请求来源不合法：只接受应用页面自身的来源', 'guard:origin', {
        origin: typeof origin === 'string' ? origin : null,
      })
    },

    write(req, res, next) {
      const token = req.headers[TOKEN_HEADER]
      const provided = Array.isArray(token) ? token[0] : token
      if (typeof provided === 'string' && provided.length === options.token.length && timingSafeEqual(provided, options.token)) {
        next()
        return
      }
      // 页面收此 403 后转只读模式：可浏览，写操作置灰并提示「请从应用入口重新打开页面」（§6.2 / §6.3）
      reject(res, req, '启动令牌缺失或无效：请从应用入口重新打开页面', 'guard:token')
    },
  }
}

/** 定长字符串比较（长度不同直接判否；避免把令牌比较退化成前缀比较）。 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return diff === 0
}
