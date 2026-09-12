import { useCallback, useMemo, useState } from 'react';
import { AlarmClock, ArrowDownUp, CheckCheck, ListFilter, Search, Sparkles, X } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/app/appState';
import { GROUPS } from '@/api/mockData';
import {
  NOTICE_CATEGORY_LABEL,
  NOTICE_PRIORITY_LABEL,
  NOTICE_SORT_LABEL,
  NOTICE_STATUS_LABEL,
  type NoticeCategory,
  type NoticeItem,
  type NoticePriority,
  type NoticeQuery,
  type NoticeSortKey,
  type NoticeStatus,
} from '@/types';
import { cn } from '@/lib/cn';
import { deadlineHint, fmtDayLabel, num } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { NoticeCard, NoticeCompactRow, NoticeTimelineGroup } from '@/components/notice/NoticeCard';
import { NoticeDetailDrawer } from '@/components/notice/NoticeDetailDrawer';
import { CouplingNote, ModuleScaffold } from '@/components/scaffold/ModuleScaffold';
import { Card, CardHeader, Chip, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { MiniStat } from '@/components/charts';

type ViewMode = 'timeline' | 'board' | 'list';

/**
 * 功能二 · 群聊信息提取与通知总览（Inbox）
 * ---------------------------------------------------------------------------
 * 目标.md 要求逐条落实：
 *   1. 筛选：时间筛选 / 关键词筛选                    → 左侧筛选栏 + 顶部搜索
 *   2. 排序：按时间（时间轴）/ 按优先级 / 按 DDL        → 排序切换 + 时间轴视图
 *      可选中一个或多个群，对其中的消息做时间排序        → 群多选（全局 GroupSelector）
 *   3. 详情页：heading（AI 一句话总结 + 来源群 + 时间）
 *              正文（AI 总结 + 所有群消息来源）        → NoticeDetailDrawer
 */
export default function InboxPage() {
  const { chats, setChats, toggleChat, range } = useAppState();
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<NoticeSortKey>('time_desc');
  const [categories, setCategories] = useState<NoticeCategory[]>([]);
  const [priorities, setPriorities] = useState<NoticePriority[]>([]);
  const [statuses, setStatuses] = useState<NoticeStatus[]>([]);
  const [onlyDeadline, setOnlyDeadline] = useState(false);
  const [view, setView] = useState<ViewMode>('timeline');
  const [selected, setSelected] = useState<NoticeItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const query: NoticeQuery = useMemo(
    () => ({
      chats,
      categories,
      priorities,
      statuses,
      keyword,
      sort,
      start: range.start,
      end: range.end,
      only_with_deadline: onlyDeadline,
    }),
    [chats, categories, priorities, statuses, keyword, sort, range.start, range.end, onlyDeadline],
  );

  const notices = useApi(() => api.queryNotices(query), [JSON.stringify(query)]);

  const toggleIn = <T,>(list: T[], v: T, set: (next: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const items = notices.data ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, NoticeItem[]>();
    [...items]
      .sort((a, b) => (sort === 'time_asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp))
      .forEach((n) => {
        const key = fmtDayLabel(n.time);
        map.set(key, [...(map.get(key) ?? []), n]);
      });
    return [...map.entries()];
  }, [items, sort]);

  const stats = useMemo(() => {
    const urgent = items.filter((n) => n.priority === 'urgent').length;
    const todo = items.filter((n) => n.status === 'todo' || n.status === 'doing').length;
    const withDdl = items.filter((n) => n.entities.deadline).length;
    const soon = items
      .filter((n) => n.entities.deadline && n.status !== 'done')
      .map((n) => ({ n, hint: deadlineHint(String(n.entities.deadline))! }))
      .filter(({ hint }) => hint && !hint.overdue && hint.urgent).length;
    return { urgent, todo, withDdl, soon };
  }, [items]);

  const openNotice = useCallback((n: NoticeItem) => {
    setSelected(n);
    setDrawerOpen(true);
  }, []);

  const changeStatus = useCallback(
    async (id: string, status: NoticeStatus) => {
      await api.updateNoticeStatus(id, status);
      notices.setData((prev) => prev?.map((n) => (n.id === id ? { ...n, status } : n)) ?? prev);
      setSelected((prev) => (prev && prev.id === id ? { ...prev, status } : prev));
    },
    [notices],
  );

  const activeFilterCount = categories.length + priorities.length + statuses.length + (onlyDeadline ? 1 : 0) + (chats.length ? 1 : 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* 顶部指标 */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="提取到的信息条目" value={num(items.length)} tone="jade" />
        <MiniStat label="其中紧急" value={num(stats.urgent)} tone="coral" />
        <MiniStat label="待办 / 进行中" value={num(stats.todo)} tone="amber" />
        <MiniStat label="48 小时内到期" value={num(stats.soon)} tone="coral" />
      </section>

      <div className="grid gap-5 lg:grid-cols-[286px_minmax(0,1fr)]">
        {/* --------------------------- 左：筛选栏 --------------------------- */}
        <aside className="space-y-3 lg:sticky lg:top-[76px] lg:self-start">
          <Card>
            <CardHeader
              title="筛选"
              icon={ListFilter}
              subtitle={activeFilterCount ? `已启用 ${activeFilterCount} 项条件` : '按时间 / 关键词 / 类型多维筛选'}
              right={
                activeFilterCount ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCategories([]);
                      setPriorities([]);
                      setStatuses([]);
                      setOnlyDeadline(false);
                      setKeyword('');
                    }}
                    className="mp-meta inline-flex items-center gap-1 text-coral-500 hover:underline"
                  >
                    <X size={11} /> 清空
                  </button>
                ) : undefined
              }
            />
            <div className="space-y-4 px-4 py-3.5">
              {/* 关键词 */}
              <div>
                <label className="mp-section-title mb-1.5 block">关键词 / 语义搜索</label>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300" />
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="如：缴费、排练、接龙…"
                    className="w-full rounded-xl border border-ink-900/[0.1] bg-white py-2 pl-8 pr-2.5 text-xs text-ink-700 outline-none transition-colors placeholder:text-ink-300 focus:border-jade-500/50 focus:ring-2 focus:ring-jade-500/12"
                  />
                </div>
                <p className="mp-meta mt-1">匹配标题、摘要、标签与全部来源消息</p>
              </div>

              {/* 时间（全局） */}
              <div>
                <label className="mp-section-title mb-1.5 block">时间范围</label>
                <div className="rounded-xl border border-ink-900/[0.07] bg-ink-900/[0.02] px-2.5 py-2 text-[11px] tabular-nums text-ink-600">
                  {range.start} ~ {range.end}
                </div>
                <p className="mp-meta mt-1">在顶部工具栏切换范围，所有页面共享</p>
              </div>

              {/* 来源群 */}
              <div>
                <label className="mp-section-title mb-1.5 block">来源群（可多选）</label>
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={chats.length === 0} onClick={() => setChats([])}>
                    全部
                  </Chip>
                  {GROUPS.filter((g) => g.username.includes('@chatroom')).map((g) => (
                    <Chip key={g.chat} active={chats.includes(g.chat)} onClick={() => toggleChat(g.chat)}>
                      {g.chat}
                    </Chip>
                  ))}
                </div>
              </div>

              {/* 类型 */}
              <div>
                <label className="mp-section-title mb-1.5 block">信息类型</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(NOTICE_CATEGORY_LABEL) as NoticeCategory[]).map((c) => (
                    <Chip key={c} active={categories.includes(c)} onClick={() => toggleIn(categories, c, setCategories)}>
                      {NOTICE_CATEGORY_LABEL[c]}
                    </Chip>
                  ))}
                </div>
              </div>

              {/* 优先级 */}
              <div>
                <label className="mp-section-title mb-1.5 block">优先级</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(NOTICE_PRIORITY_LABEL) as NoticePriority[]).map((p) => (
                    <Chip key={p} active={priorities.includes(p)} onClick={() => toggleIn(priorities, p, setPriorities)}>
                      {NOTICE_PRIORITY_LABEL[p]}
                    </Chip>
                  ))}
                </div>
              </div>

              {/* 状态 */}
              <div>
                <label className="mp-section-title mb-1.5 block">待办状态</label>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(NOTICE_STATUS_LABEL) as NoticeStatus[]).map((s) => (
                    <Chip key={s} active={statuses.includes(s)} onClick={() => toggleIn(statuses, s, setStatuses)}>
                      {NOTICE_STATUS_LABEL[s]}
                    </Chip>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-ink-900/[0.07] px-2.5 py-2">
                <input type="checkbox" checked={onlyDeadline} onChange={(e) => setOnlyDeadline(e.target.checked)} className="accent-jade-600" />
                <span className="text-xs text-ink-600">只看带 DDL 的信息</span>
              </label>
            </div>
          </Card>

          {/* 待办清单（右侧同为可扩展的窄栏） */}
          <Card>
            <CardHeader title="最近到期" icon={AlarmClock} subtitle="按 DDL 升序，避免遗漏" />
            <ul className="px-2 py-2">
              {items
                .filter((n) => n.entities.deadline && n.status !== 'done')
                .sort((a, b) => String(a.entities.deadline).localeCompare(String(b.entities.deadline)))
                .slice(0, 5)
                .map((n) => (
                  <li key={n.id}>
                    <NoticeCompactRow notice={n} onOpen={() => openNotice(n)} />
                  </li>
                ))}
              {!items.length && <li className="mp-meta px-2 py-3">暂无待办</li>}
            </ul>
          </Card>

          <CouplingNote module="wechat-cli 数据接口" />
        </aside>

        {/* --------------------------- 右：列表 / 时间轴 --------------------------- */}
        <section className="min-w-0 space-y-4" data-testid="notice-results">
          {/* 视图与排序工具条 */}
          <div className="mp-card flex flex-wrap items-center gap-2 px-3.5 py-2.5">
            <div className="flex items-center gap-1 rounded-xl bg-ink-900/[0.04] p-1">
              {(
                [
                  { k: 'timeline', label: '时间轴' },
                  { k: 'board', label: '卡片' },
                  { k: 'list', label: '紧凑列表' },
                ] as { k: ViewMode; label: string }[]
              ).map((v) => (
                <button
                  key={v.k}
                  type="button"
                  onClick={() => setView(v.k)}
                  className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors', view === v.k ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700')}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="mp-meta inline-flex items-center gap-1">
                <ArrowDownUp size={11} /> 排序
              </span>
              {(Object.keys(NOTICE_SORT_LABEL) as NoticeSortKey[]).map((k) => (
                <Chip key={k} active={sort === k} onClick={() => setSort(k)}>
                  {NOTICE_SORT_LABEL[k]}
                </Chip>
              ))}
            </div>
          </div>

          {notices.error && <ErrorState code={notices.error.code} message={notices.error.message} hint={notices.error.hint} onRetry={notices.refetch} />}

          {notices.loading && !notices.data ? (
            <LoadingState label="正在从群消息中提取通知与关键信息…" rows={4} />
          ) : items.length === 0 ? (
            <EmptyState
              title="没有符合条件的信息"
              description="可能是筛选条件过窄、时间范围内消息太少，或该群的公告/接龙本身不多。可以试试清空筛选或扩大时间范围。"
              action={
                <button
                  type="button"
                  onClick={() => {
                    setCategories([]);
                    setPriorities([]);
                    setStatuses([]);
                    setOnlyDeadline(false);
                    setKeyword('');
                  }}
                  className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800"
                >
                  清空筛选
                </button>
              }
            />
          ) : view === 'timeline' ? (
            <div className="mp-card px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-700">消息时间轴</h3>
                <span className="mp-meta">
                  共 {num(items.length)} 条 · {grouped.length} 天
                  {chats.length > 1 && ` · 已合并 ${chats.length} 个群`}
                </span>
              </div>
              {grouped.map(([day, list]) => (
                <NoticeTimelineGroup key={day} dateLabel={day} count={list.length}>
                  {list.map((n) => (
                    <NoticeCard key={n.id} notice={n} active={selected?.id === n.id} onOpen={() => openNotice(n)} onToggleStatus={(s) => changeStatus(n.id, s)} compact />
                  ))}
                </NoticeTimelineGroup>
              ))}
            </div>
          ) : view === 'board' ? (
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((n) => (
                <NoticeCard key={n.id} notice={n} active={selected?.id === n.id} onOpen={() => openNotice(n)} onToggleStatus={(s) => changeStatus(n.id, s)} />
              ))}
            </div>
          ) : (
            <Card className="divide-y divide-ink-900/[0.05] p-1.5">
              {items.map((n) => (
                <NoticeCompactRow key={n.id} notice={n} onOpen={() => openNotice(n)} />
              ))}
            </Card>
          )}

          {/* 批量操作（占位，接口待定） */}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-jade-500/40 hover:text-jade-700">
              <CheckCheck size={12} />
              全部标记完成
            </button>
            <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:border-jade-500/40 hover:text-jade-700">
              <Sparkles size={12} />
              让 AI 生成今日待办摘要
            </button>
            <span className="mp-meta">批量操作与导出接口待 raw_design.md 定稿后接入</span>
          </div>

          <ModuleScaffold
            title="信息提取 · 后续形态"
            subtitle="目标.md 对「总结后的消息」形态只写到这里，剩余能力预留"
            planned={['群日报 / 周报自动生成', '跨群同一事项自动合并', '导出为日历 / 提醒事项', '按人聚合的待办视图', '接龙结果自动统计']}
            note="扩展方式：NoticeItem 已在 types.ts 中预留 ext 与 tags，新增字段不需要改动列表与详情布局。"
          />
        </section>
      </div>

      <NoticeDetailDrawer notice={selected} open={drawerOpen} onClose={() => setDrawerOpen(false)} onStatusChange={changeStatus} />
    </div>
  );
}
