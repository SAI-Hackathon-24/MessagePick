import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, Github, HeartHandshake, LayoutDashboard, MessageSquareText, Sparkles, Wand2 } from 'lucide-react';
import { DataSourceBadge, GroupSelector, SimSwitcher, TimeRangePicker } from '@/components/controls';
import { cn } from '@/lib/cn';

const NAV = [
  { to: '/', label: '总览', desc: '今日群聊体检', icon: LayoutDashboard },
  { to: '/meme', label: '热梗分析', desc: '词云 · 梗卡片 · 时间轴', icon: Sparkles },
  { to: '/inbox', label: '信息提取', desc: '通知 · 待办 · 时间轴', icon: MessageSquareText },
  { to: '/social', label: '社交图谱', desc: '画像 · 匹配（占位）', icon: HeartHandshake },
  { to: '/insight', label: '数据洞察', desc: '活跃度 · 类型分布', icon: BarChart3 },
] as const;

const SIM_TITLES: Record<string, string> = {
  '/': '群聊总览',
  '/meme': '群聊梗分析',
  '/inbox': '群聊信息提取',
  '/social': '正向与反向社交',
  '/insight': '数据洞察',
};

export function AppShell() {
  const loc = useLocation();
  const path = '/' + (loc.pathname.split('/')[1] ?? '');

  return (
    <div className="flex h-full">
      {/* ------------------------------ 侧边导航 ------------------------------ */}
      <aside className="hidden w-[236px] shrink-0 flex-col border-r border-ink-900/[0.07] bg-white/60 backdrop-blur md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-jade-500 to-jade-700 text-white shadow-glow">
            <Wand2 size={18} />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-wide text-ink-800">聊斋</div>
            <div className="mp-meta">MessagePick · 群聊分析</div>
          </div>
        </div>

        <nav className="mt-1 flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors',
                  isActive ? 'bg-jade-500/[0.1] text-jade-800 ring-1 ring-jade-500/25' : 'text-ink-600 hover:bg-ink-900/[0.04]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon size={17} className={cn('mt-0.5 shrink-0', isActive ? 'text-jade-600' : 'text-ink-400 group-hover:text-ink-600')} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{item.label}</span>
                    <span className="mp-meta block truncate">{item.desc}</span>
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-2 border-t border-ink-900/[0.06] px-4 py-4">
          <div className="mp-meta leading-relaxed">
            数据链路：<span className="font-mono text-ink-500">wechat-cli</span> → core → LLM
            <br />
            全程本地处理，数据不出本机
          </div>
          <a
            href="https://github.com/SAI-Hackathon-24/MessagePick"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-ink-400 transition-colors hover:text-jade-700"
          >
            <Github size={12} />
            SAI-Hackathon-24/MessagePick
          </a>
        </div>
      </aside>

      {/* ------------------------------ 主区域 ------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mp-sticky-head flex flex-wrap items-center gap-2.5 border-b border-ink-900/[0.07] bg-white/70 px-4 py-3 backdrop-blur-md md:px-6">
          <div className="mr-auto min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-ink-800">{SIM_TITLES[path] ?? '聊斋 MessagePick'}</h1>
            <p className="mp-meta hidden truncate sm:block">第 24 组 · 回声队 · 可运行 Demo（接口契约已预留，等待 raw_design.md 定稿）</p>
          </div>
          <DataSourceBadge />
          <SimSwitcher />
          <GroupSelector />
          <TimeRangePicker />
        </header>

        {/* 移动端底部导航 */}
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
          <Outlet />
        </main>

        <nav className="flex items-center justify-around border-t border-ink-900/[0.07] bg-white/80 py-1.5 backdrop-blur md:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px]', isActive ? 'text-jade-700' : 'text-ink-400')}
            >
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
