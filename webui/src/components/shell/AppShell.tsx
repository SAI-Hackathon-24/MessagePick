/**
 * 应用外壳与全局筛选（MOD-004 的浏览器侧）
 * =============================================================================
 * 职责（见 docs/design/modules.md MOD-004 与 prd §2.1）：
 *   · 视图容器与导航：三个模块并列交付、互不依赖（REQ-018、AC-040）
 *   · 全局筛选条：唯一筛选控件（REQ-004、REQ-049）
 *   · 首屏引导（REQ-003）与「更新数据」入口 + 「记录更新至 X」始终可见（REQ-002）
 *   · 四类异常的统一呈现（REQ-016、AC-035）
 *   · 设置页：数据去向说明（REQ-012）与删除流程入口（REQ-011）
 */
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Clock3, HeartHandshake, Info, LayoutDashboard, MessageSquareText, RefreshCw, Settings, Sparkles, UploadCloud } from 'lucide-react';
import { useAppState } from '@/state/appState';
import { cn } from '@/lib/cn';
import { fmtMD } from '@/lib/format';
import { apiMode } from '@/api';
import { MODULE_LABEL } from '@/types';
import { GlobalFilterBar } from './GlobalFilterBar';
import { Badge, NoticeBar } from '@/components/ui';
import { FirstRunGuide } from './FirstRunGuide';
import { SettingsDialog } from './SettingsDialog';

const NAV = [
  { to: '/', label: '总览', icon: LayoutDashboard, module: null },
  { to: '/meme', label: '群聊梗分析', icon: Sparkles, module: 'meme' as const },
  { to: '/extract', label: '群聊信息提取', icon: MessageSquareText, module: 'extract' as const },
  { to: '/social', label: '正向 / 反向社交', icon: HeartHandshake, module: 'social' as const },
] as const;

export function AppShell() {
  const { status, statusLoading, triggerUpdate, updating, updateNotice, dismissUpdateNotice, setSettingsOpen, groups } = useAppState();
  const loc = useLocation();
  const path = '/' + (loc.pathname.split('/')[1] ?? '');

  /* REQ-003：未采集到任何数据 → 首屏引导 */
  if (!statusLoading && status && !status.hasData) {
    return <FirstRunGuide />;
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* ---------------- 顶栏：更新入口 + 记录更新至 X（REQ-002，始终可见） ---------------- */}
      <header className="mp-sticky-head border-b border-ink-900/[0.07] bg-white/75 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-jade-500 to-jade-700 text-white shadow-glow">
              <Sparkles size={16} />
            </span>
            <div className="leading-tight">
              <div className="text-[14px] font-semibold tracking-wide text-ink-800">聊斋 MessagePick</div>
              <div className="mp-meta">{MODULE_LABEL[(NAV.find((n) => n.to === path)?.module ?? 'meme') as 'meme']}</div>
            </div>
          </div>

          <div className="mx-auto hidden items-center gap-1 rounded-xl bg-ink-900/[0.04] p-1 lg:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors', isActive ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700')
                }
              >
                <n.icon size={13} />
                {n.label}
              </NavLink>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* 「记录更新至 X」：始终可见（REQ-002） */}
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white/80 px-2.5 py-1.5 text-xs text-ink-600" data-testid="updated-to" title="群消息来源最近一次成功采集完成的时间">
              <Clock3 size={13} className="text-jade-600" />
              记录更新至 {status?.updatedTo ? fmtMD(status.updatedTo) : '—'}
            </span>
            <button
              type="button"
              data-testid="trigger-update"
              onClick={() => void triggerUpdate()}
              disabled={updating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-jade-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-jade-700 disabled:opacity-60"
            >
              {updating ? <RefreshCw size={12} className="animate-spin" /> : <UploadCloud size={12} />}
              {updating ? '更新中…' : '更新数据'}
            </button>
            <button
              type="button"
              aria-label="设置"
              onClick={() => setSettingsOpen(true)}
              className="rounded-xl border border-ink-900/[0.08] bg-white/80 p-2 text-ink-500 transition-colors hover:border-jade-500/40 hover:text-jade-700"
            >
              <Settings size={13} />
            </button>
          </div>
        </div>

        {/* 全局筛选条：唯一筛选控件（REQ-004） */}
        <div className="border-t border-ink-900/[0.05] px-4 py-2 md:px-6">
          <GlobalFilterBar />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 md:px-6">
        {updateNotice && (
          <NoticeBar tone="sky" className="mb-4 flex items-start justify-between gap-3">
            <span className="flex items-start gap-2">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span data-testid="update-notice">{updateNotice}</span>
            </span>
            <button type="button" onClick={dismissUpdateNotice} className="shrink-0 text-[11px] text-sky-700 hover:underline">
              知道了
            </button>
          </NoticeBar>
        )}

        {apiMode() === 'mock' && (
          <NoticeBar tone="amber" className="mb-4">
            当前运行在 <strong>开发期数据模式</strong>（后端 MOD-001 ~ MOD-008 尚未实现）。
            界面与数据均严格按 <span className="font-mono">docs/design</span> 的接口契约与数据模型产出；
            接真实后端时把 <span className="font-mono">VITE_API_MODE</span> 设为 <span className="font-mono">http</span> 并删除
            <span className="font-mono"> src/api/fixtures.ts</span>、<span className="font-mono">src/api/mock.ts</span>（REQ-019：不做演示数据版本）。
          </NoticeBar>
        )}

        <Outlet />
      </main>

      {/* ---------------- 移动端底部导航 ---------------- */}
      <nav className="flex items-center justify-around border-t border-ink-900/[0.07] bg-white/85 py-1.5 backdrop-blur lg:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => cn('flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px]', isActive ? 'text-jade-700' : 'text-ink-400')}
          >
            <n.icon size={17} />
            {n.label}
          </NavLink>
        ))}
      </nav>

      <footer className="border-t border-ink-900/[0.06] px-4 py-3 md:px-6">
        <div className="mp-meta flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>本机运行 · 数据不出本机</span>
          <span>群 {groups.length} 个</span>
          <a href="https://github.com/SAI-Hackathon-24/MessagePick" target="_blank" rel="noreferrer" className="hover:text-jade-700">
            SAI-Hackathon-24/MessagePick
          </a>
          <Badge tone="neutral">
            <BarChart3 size={10} /> React + ECharts
          </Badge>
        </div>
      </footer>

      <SettingsDialog />
    </div>
  );
}
