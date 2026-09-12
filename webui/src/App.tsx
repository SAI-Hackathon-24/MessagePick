/**
 * 应用入口与路由
 * =============================================================================
 * 三个模块并列交付、互不依赖（REQ-018、AC-040）：任一路由的加载失败都不影响其它路由。
 * 全局筛选、更新入口、首屏引导与异常统一呈现都在 AppShell（MOD-004）。
 */
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppStateProvider } from '@/state/appState';
import { AppShell } from '@/components/shell/AppShell';
import OverviewPage from '@/pages/OverviewPage';
import MemePage from '@/pages/MemePage';
import ExtractPage from '@/pages/ExtractPage';
import SocialPage from '@/pages/SocialPage';

export default function App() {
  return (
    <AppStateProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="meme" element={<MemePage />} />
            <Route path="extract" element={<ExtractPage />} />
            <Route path="social" element={<SocialPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppStateProvider>
  );
}
