/**
 * 启动令牌（详设 §4.1 / mod-004 §6.2）。
 *
 * 口径：
 * - 令牌由服务进程每次启动生成，打开页面时经 URL fragment 注入；页面只在**内存**里持有，刷新即重取。
 * - 写操作（更新 / 删除 / 设置变更 / 素材确认……）必须携带令牌头；缺令牌时页面降级为只读模式，
 *   写入口置灰并提示「请从应用入口重新打开页面」，页面不自行获取令牌。
 * - 令牌不落任何持久化位置、不进日志与错误文案。
 */

/** 令牌请求头名（服务端外壳与本文件是同一份约定的两端；改名需两边同步）。 */
export const LAUNCH_TOKEN_HEADER = 'x-messagepick-token'

/** URL fragment 里的令牌参数名，形如 `#token=<值>` 或 `#/route?token=<值>`。 */
export const TOKEN_FRAGMENT_KEY = 'token'

/**
 * 从 URL fragment 解析启动令牌（纯函数）。
 *
 * 支持 `#token=x`、`#/path?token=x&other=y` 两种形态；没有令牌时返回 `null`（= 只读模式）。
 */
export function parseLaunchToken(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw.length === 0) return null
  const normalized = raw.startsWith('/') ? raw.slice(1) : raw
  const queryIndex = normalized.indexOf('?')
  const query = queryIndex >= 0 ? normalized.slice(queryIndex + 1) : normalized
  const token = new URLSearchParams(query).get(TOKEN_FRAGMENT_KEY)
  return token && token.length > 0 ? token : null
}

/** 去掉 fragment 里的令牌参数，保留其余部分（用于地址栏脱敏，避免令牌留在可见地址中）。 */
export function hashWithoutToken(hash: string): string {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw.length === 0) return ''
  const prefix = raw.startsWith('/') ? '/' : ''
  const normalized = raw.slice(prefix.length)
  const queryIndex = normalized.indexOf('?')
  const path = queryIndex >= 0 ? normalized.slice(0, queryIndex) : normalized
  const params = new URLSearchParams(queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '')
  params.delete(TOKEN_FRAGMENT_KEY)
  const query = params.toString()
  const combined = `${prefix}${path}${query ? `?${query}` : ''}`
  return combined.length > 0 ? `#${combined}` : ''
}

/** 令牌持有者（内存单例；页面关闭即失效）。 */
export interface LaunchToken {
  get(): string | null
  set(next: string | null): void
}

/** 创建令牌持有者（测试可注入初值）。 */
export function createLaunchToken(initial: string | null = null): LaunchToken {
  let token = initial
  return {
    get: () => token,
    set: (next) => {
      token = next
    },
  }
}

/** 写操作的请求头；无令牌时返回空对象（请求仍会发出，服务端按守卫口径拒绝，页面转只读）。 */
export function writeHeaders(token: string | null): Record<string, string> {
  return token ? { [LAUNCH_TOKEN_HEADER]: token } : {}
}
