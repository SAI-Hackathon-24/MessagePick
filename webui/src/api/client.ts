/**
 * 传输层：本机服务进程的 HTTP 客户端（mod-004 §4.1 / 详设 §3.3、§4.1）。
 *
 * - 读请求 `GET` 不带令牌；写请求（`POST` / `PATCH` / `PUT`）带启动令牌头
 *   （`x-messagepick-token`；服务端守卫按它放行，无令牌时写操作被拒 → 界面呈现只读提示）。
 * - 令牌从 URL fragment 解析并存入 `sessionStorage`（同标签页刷新仍可用、关闭标签页即清除；
 *   不写 localStorage、不入日志）；刷新后的地址已被脱敏、fragment 无令牌，则回退读取会话存储。
 * - 服务重启后令牌轮换：旧令牌会被守卫拒绝（403），需从入口地址重新打开。
 * - 服务端统一信封：成功 `{ data, epoch, requestId }`；失败 `{ error: { code, message, retryable, scope } }`。
 *   本层把两者归一为界面侧的 `ApiEnvelope`（`{ ok, data, error }`），组件不感知差异。
 */

import { ERROR_CODES, type ApiEnvelope, type ErrorCode } from '@/types';

/** 令牌请求头名（与 `src/web/shell/api/token.ts` 同源约定；服务端守卫做头名归一）。 */
export const TOKEN_HEADER = 'x-messagepick-token';

/** URL fragment 里的令牌参数名（形如 `#token=<值>` 或 `#/route?token=<值>`）。 */
export const TOKEN_FRAGMENT_KEY = 'token';

/** API 基础路径（同源托管时即本机服务进程；开发期由 vite 代理转发）。 */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

/** 内存中的启动令牌（页面生命周期内有效）。 */
let token: string | null = null;

/** 会话存储键：随标签页会话存活（刷新保留、关闭标签页清除），服务重启后旧值自然失效。 */
const TOKEN_STORAGE_KEY = 'messagepick.launch-token';

/** 是否持有启动令牌（无令牌 = 只读；写操作会被服务端守卫拒绝）。 */
export const hasLaunchToken = (): boolean => token !== null;

/** 从 URL fragment 解析并记录启动令牌；返回解析到的令牌（无则 null）。 */
export function captureLaunchToken(hash: string = window.location.hash): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.length === 0) return null;
  const normalized = raw.startsWith('/') ? raw.slice(1) : raw;
  const queryIndex = normalized.indexOf('?');
  const query = queryIndex >= 0 ? normalized.slice(queryIndex + 1) : normalized;
  const value = new URLSearchParams(query).get(TOKEN_FRAGMENT_KEY);
  if (value !== null && value.length > 0) {
    token = value;
    saveLaunchToken(value);
    return value;
  }
  return null;
}

/**
 * 回退读取会话存储里的启动令牌（刷新后的地址已脱敏、fragment 不带令牌）。
 * 服务重启后旧令牌会被守卫拒绝（403），按提示从入口地址重新打开即可。
 */
export function restoreLaunchToken(): string | null {
  if (token !== null) return token;
  try {
    const saved = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved !== null && saved.length > 0) token = saved;
  } catch {
    // 会话存储不可用（隐私策略等）：保持只读，不影响其余功能
  }
  return token;
}

/** 写入会话存储（失败不阻断：令牌仍在内存中可用）。 */
function saveLaunchToken(value: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
  } catch {
    // 同上：不可写时降级为仅内存持有
  }
}

/** 地址栏脱敏：去掉 fragment 里的令牌参数，保留其余部分（路由 / 其他查询参数）。 */
export function stripTokenFromHash(hash: string = window.location.hash): void {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.length === 0) return;
  const prefix = raw.startsWith('/') ? '/' : '';
  const normalized = raw.slice(prefix.length);
  const queryIndex = normalized.indexOf('?');
  const path = queryIndex >= 0 ? normalized.slice(0, queryIndex) : normalized;
  const params = new URLSearchParams(queryIndex >= 0 ? normalized.slice(queryIndex + 1) : '');
  if (!params.has(TOKEN_FRAGMENT_KEY)) return;
  params.delete(TOKEN_FRAGMENT_KEY);
  const query = params.toString();
  const next = `${prefix}${path}${query.length > 0 ? `?${query}` : ''}`;
  const nextHash = next.length > 0 ? `#${next}` : '';
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
}

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

export interface RequestOptions {
  /** 查询参数（同名多值按顺序追加；空值请在调用方先行剔除）。 */
  query?: Array<[string, string]>;
  /** JSON 体（写请求）。 */
  body?: unknown;
}

interface WireFailure {
  error?: { code?: unknown; message?: unknown; scope?: unknown };
}

const isErrorCode = (value: string): value is ErrorCode =>
  (ERROR_CODES as readonly string[]).includes(value);

const failure = (code: ErrorCode, message: string, hint?: string): ApiEnvelope<never> => ({
  ok: false,
  data: null,
  error: { code, message, ...(hint === undefined ? {} : { hint }) },
});

/** 常见错误的补充指引（终端操作指引；`api-contract.md` §1.2 的 closed set 之外不新增标识）。 */
function hintOf(scope: unknown, code: ErrorCode): string | undefined {
  if (scope === 'guard:token') {
    return 'npm start 输出的地址携带启动令牌（服务重启后令牌会轮换），请用入口地址重新打开。';
  }
  if (scope === 'guard:origin' || scope === 'guard:host') {
    return '本机服务只接受回环地址访问；请通过应用入口打开页面。';
  }
  if (code === 'NO_DATA') return '请先完成一次「更新数据」。';
  return undefined;
}

/** 发起一次请求并归一为界面信封。 */
export async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const search = options.query === undefined || options.query.length === 0 ? '' : `?${new URLSearchParams(options.query).toString()}`;
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    if (token !== null) headers[TOKEN_HEADER] = token;
  }
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}${search}`, {
      method,
      headers,
      body: method === 'GET' || options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    return failure(
      'STORAGE_UNAVAILABLE',
      error instanceof Error ? error.message : '本机服务不可用',
      '请确认应用进程正在运行（npm start），或开发代理指向正确端口。',
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const record = (payload ?? {}) as Record<string, unknown>;
  const wireFailure = record as WireFailure;
  if (typeof wireFailure.error === 'object' && wireFailure.error !== null) {
    const raw = wireFailure.error;
    const code = typeof raw.code === 'string' && isErrorCode(raw.code) ? raw.code : 'ANALYSIS_FAILED';
    const message = typeof raw.message === 'string' && raw.message.length > 0 ? raw.message : '请求失败';
    return failure(code, message, hintOf(raw.scope, code));
  }

  if ('data' in record) {
    return { ok: true, data: record['data'] as T };
  }

  if (!response.ok) {
    return failure('STORAGE_UNAVAILABLE', `本机服务返回 ${response.status}`);
  }
  return failure('ANALYSIS_FAILED', '响应格式无法识别（缺少 data / error）');
}

/** 查询参数构造：空串 / undefined 一律不下发（空 = 不限，AC-014）。 */
export function queryOf(entries: Array<[string, string | undefined | null]>): Array<[string, string]> {
  return entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0);
}
