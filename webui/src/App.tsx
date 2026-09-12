import { useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getSimMode, setSimMode as persistSim, type SimMode } from '@/api';
import { AppStateContext, type AppState } from '@/app/appState';
import { AppShell } from '@/components/layout/AppShell';
import InboxPage from '@/pages/InboxPage';
import InsightPage from '@/pages/InsightPage';
import MemePage from '@/pages/MemePage';
import OverviewPage from '@/pages/OverviewPage';
import SocialPage from '@/pages/SocialPage';

/** 演示数据的时间基准，与 mockData 的 RANGE_START/END 保持一致 */
const DEFAULT_RANGE = { start: '2026-03-01', end: '2026-06-09' };

export default function App() {
  const [chats, setChats] = useState<string[]>([]);
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [sim, setSimState] = useState<SimMode>(getSimMode());

  const setSim = useCallback((s: SimMode) => {
    persistSim(s);
    setSimState(s);
  }, []);

  useEffect(() => {
    const onChange = (e: Event) => setSimState((e as CustomEvent<SimMode>).detail);
    window.addEventListener('mp:sim', onChange);
    return () => window.removeEventListener('mp:sim', onChange);
  }, []);

  const toggleChat = useCallback((chat: string) => {
    setChats((prev) => (prev.includes(chat) ? prev.filter((c) => c !== chat) : [...prev, chat]));
  }, []);

  const value: AppState = useMemo(
    () => ({ chats, setChats, toggleChat, range, setRange, sim, setSim }),
    [chats, toggleChat, range, sim, setSim],
  );

  return (
    <AppStateContext.Provider value={value}>
      <HashRouter
        future={{
          // 提前打开 v7 行为，消除 React Router 的 future flag 告警
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="meme" element={<MemePage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="social" element={<SocialPage />} />
            <Route path="insight" element={<InsightPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppStateContext.Provider>
  );
}
