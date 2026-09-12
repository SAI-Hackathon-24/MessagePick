import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope, ApiError } from '@/types';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  /** 失败信息：按 api-contract §1.2 的错误标识，UI 统一呈现（REQ-016） */
  error: ApiError | null;
  /** 已缓存内容仍可浏览时为 true（REQ-016：失败不阻塞已有内容） */
  stale: boolean;
  refetch: () => void;
  /** 本地乐观更新，避免整页闪烁 */
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * 统一处理 ApiEnvelope 的 loading / 空态 / 失败三种分支。
 *
 * ⚠️ 依赖项必须序列化成「一个稳定的字符串」再进依赖数组：
 * 直接把数组展开成 [...deps] 会让依赖数组长度随调用方变化，
 * React 会告警并忽略整个依赖列表，导致筛选条件变化时不重新取数。
 */
export function useApi<T>(fetcher: () => Promise<ApiEnvelope<T>>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const depKey = JSON.stringify(deps);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    setError(null);
    fetcherRef
      .current()
      .then((res) => {
        if (!alive.current) return;
        if (!res.ok) {
          setError(res.error ?? { code: 'ANALYSIS_FAILED', message: '未知错误' });
          setStale(!!res.stale);
        } else {
          setData(res.data);
          setStale(!!res.stale);
        }
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
        setError({ code: 'STORAGE_UNAVAILABLE', message: e instanceof Error ? e.message : String(e) });
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [depKey, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const update = useCallback((updater: (prev: T | null) => T | null) => setData((prev) => updater(prev)), []);

  return { data, loading, error, stale, refetch, setData: update };
}

/**
 * 与 useApi 同构，但用于**不是** `ApiEnvelope` 的接口。
 * 目前 mock 层把「查询更新状态」之外的少数接口直接返回 ApiEnvelope，
 * 因此业务调用统一走 useApi；本 hook 供后续接入真实后端时按需使用。
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; loading: boolean; error: Error | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(deps), tick]);
  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}
