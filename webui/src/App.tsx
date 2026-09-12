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
import KingBoardPage from '@/pages/KingBoardPage';
import ReviewPage from '@/pages/ReviewPage';
import ExtractPage from '@/pages/ExtractPage';
import SocialPage from '@/pages/SocialPage';

export default function App() {
  return (
    <AppStateProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            {/* 模块一：子项 = 梗词云 / 梗生命周期 / 梗列表 */}
            <Route path="meme" element={<Navigate to="/meme/cloud" replace />} />
            <Route path="meme/king" element={<KingBoardPage />} />
            <Route path="meme/review" element={<ReviewPage />} />
            <Route path="meme/:view" element={<MemePage />} />
            {/* 模块二：子项 = 消息时间轴 / 通知总览 / 待办与 DDL */}
            <Route path="extract" element={<Navigate to="/extract/timeline" replace />} />
            <Route path="extract/:view" element={<ExtractPage />} />
            {/* 模块三：子项 = 人物画像 / 按兴趣找人 / 两人配对 / 我的契合度 / 人-人图谱 / 身份对齐 */}
            <Route path="social" element={<Navigate to="/social/forward" replace />} />
            <Route path="social/:view" element={<SocialPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppStateProvider>
  );
}
