/**
 * 左侧分组树形导航（MOD-004 的视图容器）
 * =============================================================================
 * · 三个一级入口：群聊梗分析 / 群聊信息提取 / 正向·反向社交（`REQ-018` 三模块并列）
 * · 点击一级入口展开子项，当前选中项有明确高亮态
 * · 窄屏可折叠为图标栏（宽度 64px），再窄则收起为抽屉
 *
 * 说明：子项与页面内的视图状态一一对应，切换子项等于切换视图，
 * 不新增任何数据请求口径（数据仍来自各模块既有的 API 调用）。
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, HeartHandshake, MessageSquareText, Sparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface NavChild {
  to: string;
  label: string;
}
export interface NavGroup {
  key: string;
  label: string;
  desc: string;
  to: string;
  icon: LucideIcon;
  children: NavChild[];
}

/** 三个一级入口与其子项（子项 = 模块内的实际视图，按现有功能补齐） */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'meme',
    label: '群聊梗分析',
    desc: '这个群在玩什么',
    to: '/meme/cloud',
    icon: Sparkles,
    children: [
      { to: '/meme/cloud', label: '梗词云' },
      { to: '/meme/lifecycle', label: '梗生命周期' },
      { to: '/meme/table', label: '梗列表 / 表格' },
    ],
  },
  {
    key: 'extract',
    label: '群聊信息提取',
    desc: '群里发生了什么',
    to: '/extract/timeline',
    icon: MessageSquareText,
    children: [
      { to: '/extract/timeline', label: '消息时间轴' },
      { to: '/extract/notices', label: '通知总览' },
      { to: '/extract/todo', label: '待办与 DDL' },
    ],
  },
  {
    key: 'social',
    label: '正向 / 反向社交',
    desc: '我和谁合得来',
    to: '/social/forward',
    icon: HeartHandshake,
    children: [
      { to: '/social/forward', label: '人物兴趣画像' },
      { to: '/social/reverse', label: '按兴趣找人' },
      { to: '/social/pair', label: '两人配对' },
      { to: '/social/mine', label: '我的社交契合度' },
      { to: '/social/graph', label: '人-人关系图谱' },
      { to: '/social/alignment', label: '身份对齐' },
    ],
  },
];

export function SidebarNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const loc = useLocation();
  /** 当前展开的一级入口（跟随路由，同时允许手动展开多个） */
  const activeGroup = NAV_GROUPS.find((g) => loc.pathname.startsWith(`/${g.key}`))?.key ?? 'meme';
  const [open, setOpen] = useState<string[]>([activeGroup]);

  useEffect(() => {
    setOpen((prev) => (prev.includes(activeGroup) ? prev : [...prev, activeGroup]));
  }, [activeGroup]);

  const toggle = (key: string) => setOpen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <aside
      data-testid="sidebar-nav"
      className={cn(
        'hidden shrink-0 flex-col border-r border-ink-900/[0.07] bg-white/70 backdrop-blur transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[68px]' : 'w-[228px]',
      )}
    >
      {/* 品牌区 + 折叠开关 */}
      <div className={cn('flex items-center gap-2.5 px-4 py-4', collapsed && 'justify-center px-2')}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-jade-500 to-jade-700 text-white shadow-glow">
          <Sparkles size={17} />
        </span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold tracking-wide text-ink-800">聊斋 MessagePick</div>
            <div className="mp-meta">群聊分析</div>
          </div>
        )}
      </div>

      {/* 三个一级入口 */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {NAV_GROUPS.map((g) => {
          const isActive = loc.pathname.startsWith(`/${g.key}`);
          const expanded = open.includes(g.key);
          return (
            <div key={g.key}>
              <button
                type="button"
                data-testid={`nav-group-${g.key}`}
                onClick={() => {
                  if (collapsed) onToggle();
                  toggle(g.key);
                }}
                title={collapsed ? `${g.label}（${g.desc}）` : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors',
                  isActive ? 'bg-jade-500/[0.12] text-jade-800 ring-1 ring-jade-500/25' : 'text-ink-600 hover:bg-ink-900/[0.04]',
                  collapsed && 'justify-center px-0',
                )}
              >
                <g.icon size={18} className={cn('shrink-0', isActive ? 'text-jade-600' : 'text-ink-400')} />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{g.label}</span>
                      <span className="mp-meta block truncate">{g.desc}</span>
                    </span>
                    <ChevronDown size={13} className={cn('shrink-0 text-ink-300 transition-transform', expanded && 'rotate-180')} />
                  </>
                )}
              </button>

              {/* 子项（树形缩进） */}
              {!collapsed && expanded && (
                <ul className="mb-1 ml-[22px] mt-0.5 space-y-0.5 border-l border-ink-900/[0.08] pl-2">
                  {g.children.map((c) => (
                    <li key={c.to}>
                      <NavLink
                        to={c.to}
                        data-testid={`nav-child-${c.to.split('/').pop()}`}
                        className={({ isActive: childActive }) =>
                          cn(
                            'block truncate rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors',
                            childActive ? 'bg-jade-500/15 font-semibold text-jade-800' : 'text-ink-500 hover:bg-ink-900/[0.04] hover:text-ink-700',
                          )
                        }
                      >
                        {c.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <button
        type="button"
        data-testid="sidebar-toggle"
        onClick={onToggle}
        className="m-2 rounded-xl border border-ink-900/[0.08] px-2 py-1.5 text-[11px] text-ink-500 transition-colors hover:border-jade-500/40 hover:text-jade-700"
        title={collapsed ? '展开侧栏' : '收起侧栏'}
      >
        {collapsed ? '»' : '« 收起侧栏'}
      </button>
    </aside>
  );
}
