import { createContext, useContext } from 'react';
import type { SimMode } from '@/api';

export interface AppState {
  /** 当前选中的群（多选；空数组 = 全部群） */
  chats: string[];
  setChats: (chats: string[]) => void;
  toggleChat: (chat: string) => void;
  /** 分析时间范围（ISO 日期字符串，YYYY-MM-DD） */
  range: { start: string; end: string };
  setRange: (r: { start: string; end: string }) => void;
  /** 模拟场景：用于演示空态 / 失败态 */
  sim: SimMode;
  setSim: (s: SimMode) => void;
}

export const AppStateContext = createContext<AppState | null>(null);

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState 必须在 AppStateProvider 内使用');
  return ctx;
}
