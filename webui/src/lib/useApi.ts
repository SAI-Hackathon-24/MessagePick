import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope, ApiError } from '@/types';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  notice?: string;
  /** 刷新 */
  refetch: () => void;
  /** 本地乐观更新（避免整页闪烁） */
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * 统一处理 ApiEnvelope 的 loading / empty / error 三种分支。
 * 组件只需根据 state 渲染，异常分支不会漏掉。
 */
export function useApi<T>(fetcher: () => Promise<ApiEnvelope<T>>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  /**
   * ⚠️ 关键点：依赖项必须序列化成「一个稳定的字符串」再进依赖数组。
   * 之前写成 [...deps, tick] —— 依赖数组长度会随调用方变化，React 会告警并
   * 忽略该依赖列表，导致筛选条件变化时不会重新取数（所有筛选静默失效）。
   */
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
          setError(res.error ?? { code: 'UNKNOWN', message: '未知错误' });
          setData(null);
        } else {
          setData(res.data);
          setNotice(res.notice);
        }
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
        setError({ code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) });
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

  return { data, loading, error, notice, refetch, setData: update };
}
