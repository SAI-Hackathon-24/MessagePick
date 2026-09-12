/**
 * 模块二：群聊信息提取（MOD-006 的浏览器侧）
 * =============================================================================
 * 覆盖：REQ-043 ~ REQ-048（明确不做：REQ-049 —— 模块内不另做一套筛选）
 *   · 消息时间轴（REQ-047）：AI 按时间排序，排列全部群聊的提取消息；
 *     也可对选中的一个或多个群的消息按时间排序（群多选取自全局筛选条）
 *   · 通知总览（REQ-045）：按来源 / 类型 / 优先级 / 待办四个维度分组
 *   · 归档与可改（REQ-044）：主题由 AI 聚类命名、用户可改；优先级可改，改后立即生效
 *   · 待办管理（REQ-046）：完成 / 忽略标记；到期前在应用内提醒（提前 1 天，无后台常驻）
 *   · 消息详情（REQ-048）：heading = AI 一句话总结 + 来源群 + 时间；
 *     正文 = AI 总结 + 所有来源群消息；并内联给出成员兴趣提示（REQ-070）
 */
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlarmClock, Check, CheckCheck, Clock, EyeOff, ListFilter, MessageSquareText, Pencil, Sparkles } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { deadlineHint, fmtDayLabel, fmtMD, num } from '@/lib/format';
import {
  EXTRACT_TYPE_LABEL,
  NOTICE_DIMENSION_LABEL,
  PRIORITY_LABEL,
  TODO_STATE_LABEL,
  type ExtractItem,
  type NoticeDimension,
  type Priority,
} from '@/types';
import { Badge, Card, CardHeader, Chip, EmptyState, ErrorState, LoadingState, NoticeBar, SectionHeading, Stat } from '@/components/ui';
import { Button } from '@/components/shell/Button';
import { MessageDetailDrawer } from '@/components/unit/MessageDetailDrawer';

const PRIORITY_TONE = { high: 'coral', medium: 'amber', low: 'neutral' } as const;
const TODO_TONE = { pending: 'sky', done: 'jade', ignored: 'neutral' } as const;

export default function ExtractPage() {
  const { filter, clearFilter } = useAppState();
  const { view } = useParams();
  /** 子项：timeline（消息时间轴）/ notices（通知总览）/ todo（待办与 DDL） */
  const pageView: 'timeline' | 'notices' | 'todo' = view === 'notices' ? 'notices' : view === 'todo' ? 'todo' : 'timeline';
  const [dimension, setDimension] = useState<NoticeDimension>('todo');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState('');

  const timeline = useApi(() => api.extractItems(filter, 1, 50), [JSON.stringify(filter)]);
  const groups = useApi(() => api.noticeGroups(filter, dimension), [JSON.stringify(filter), dimension]);
  const due = useApi(() => api.dueTodos(new Date().toISOString()), []);

  const items = timeline.data?.items ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string, ExtractItem[]>();
    [...items].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).forEach((it) => {
      const key = fmtDayLabel(it.sentAt);
      map.set(key, [...(map.get(key) ?? []), it]);
    });
    return [...map.entries()];
  }, [items]);

  const stats = useMemo(() => {
    const pending = items.filter((i) => i.todoState === 'pending').length;
    const high = items.filter((i) => i.priority === 'high').length;
    const withDdl = items.filter((i) => i.elements.deadline).length;
    return { pending, high, withDdl };
  }, [items]);

  const saveSubject = async (id: string) => {
    if (!draftSubject.trim()) return setEditing(null);
    const res = await api.updateExtract(id, { subject: draftSubject.trim() });
    if (res.ok) timeline.refetch();
    setEditing(null);
  };

  const changePriority = async (id: string, priority: Priority) => {
    const res = await api.updateExtract(id, { priority });
    if (res.ok) {
      timeline.refetch();
      groups.refetch();
    }
  };

  const markTodo = async (id: string, state: 'done' | 'ignored') => {
    const res = await api.markTodo(id, state);
    if (res.ok) {
      timeline.refetch();
      groups.refetch();
      due.refetch();
    }
  };

  return (
    <div className="space-y-5">
      {pageView !== 'todo' && (
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="提取条目" value={num(timeline.data?.total ?? 0)} unit="条" hint="按时间排序供消息时间轴使用" icon={MessageSquareText} />
        <Stat label="待处理" value={stats.pending} unit="条" hint="未处理状态；支持完成 / 忽略" icon={CheckCheck} tone="amber" />
        <Stat label="优先级高" value={stats.high} unit="条" hint="优先级由 AI 判定、用户可改" icon={ListFilter} tone="coral" />
        <Stat label="带 DDL" value={stats.withDdl} unit="条" hint="到期前 1 天在应用内提醒" icon={AlarmClock} tone="ink" />
      </section>
      )}

      {/* 到期待办提示（REQ-046：仅在使用应用期间检查，无后台常驻） */}
      {(due.data ?? []).length > 0 && (
        <NoticeBar tone="coral" className="flex flex-wrap items-center gap-3">
          <AlarmClock size={14} className="shrink-0" />
          <span className="font-medium">距到期不足 1 天且未处理：</span>
          {(due.data ?? []).map((t) => (
            <span key={t.id} className="rounded-lg bg-white/70 px-2 py-0.5 text-[11.5px]">
              {t.subject} · {t.groupName} · {fmtMD(t.deadline)}
            </span>
          ))}
          <span className="mp-meta">（提醒只在应用打开时检查，不做后台常驻）</span>
        </NoticeBar>
      )}

      {/* 通知总览的浏览维度：模块二的视图状态，不是第二套筛选控件（REQ-049） */}
      {pageView === 'notices' && (
      <Card className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <span className="mp-meta">通知总览浏览维度</span>
        {(Object.keys(NOTICE_DIMENSION_LABEL) as NoticeDimension[]).map((d) => (
          <Chip key={d} active={dimension === d} onClick={() => setDimension(d)} data-testid={`dim-${d}`}>
            {NOTICE_DIMENSION_LABEL[d]}
          </Chip>
        ))}
        <span className="ml-auto mp-meta inline-flex items-center gap-1">
          <Clock size={11} /> 群多选取自全局筛选条
        </span>
      </Card>
      )}

      {timeline.error && <ErrorState error={timeline.error} onRetry={timeline.refetch} onClearFilter={clearFilter} />}

      {/* ---------------- 待办与 DDL（REQ-046）：只列未处理项，按 DDL 升序 ---------------- */}
      {pageView === 'todo' && (
        <Card>
          <CardHeader title="待办与 DDL" icon={AlarmClock} subtitle="只显示未处理的条目，按 DDL 升序；完成或忽略后会从这里移除" />
          <ul className="divide-y divide-ink-900/[0.05] px-1.5 py-1.5">
            {items
              .filter((it) => it.todoState === 'pending')
              .sort((a, b) => (a.elements.deadline ?? '9999').localeCompare(b.elements.deadline ?? '9999'))
              .map((it) => {
                const dl = deadlineHint(it.elements.deadline);
                return (
                  <li key={it.id} className="flex flex-wrap items-center gap-2 px-2.5 py-2.5">
                    <button type="button" onClick={() => setDetailId(it.id)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[13px] font-medium text-ink-700">{it.summaryLine}</span>
                      <span className="mp-meta">
                        {it.groupName} · {fmtMD(it.sentAt)}
                        {it.elements.deadline ? ` · DDL ${fmtMD(it.elements.deadline)}` : ' · 无 DDL'}
                      </span>
                    </button>
                    {dl && <Badge tone={dl.overdue ? 'neutral' : dl.urgent ? 'coral' : 'jade'}>{dl.text}</Badge>}
                    <Badge tone={PRIORITY_TONE[it.priority]}>优先级 {PRIORITY_LABEL[it.priority]}</Badge>
                    <Button size="sm" variant="outline" icon={Check} onClick={() => void markTodo(it.id, 'done')}>
                      完成
                    </Button>
                    <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => void markTodo(it.id, 'ignored')}>
                      忽略
                    </Button>
                  </li>
                );
              })}
            {!items.some((it) => it.todoState === 'pending') && <li className="mp-meta px-3 py-6 text-center">当前没有未处理的待办</li>}
          </ul>
          <div className="border-t border-ink-900/[0.06] px-4 py-2.5">
            <p className="mp-meta leading-relaxed">
              「完成」= 这件事已经办掉；「忽略」= 这件事不需要你处理（例如与你无关、或已由他人完成）。
              两者都会把条目标记为已处理并从待办清单移除，但状态不同、可在通知总览的「按待办」维度里分别查看。
            </p>
          </div>
        </Card>
      )}

      {pageView !== 'todo' && (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------- 消息时间轴（REQ-047） ---------------- */}
        <section className="min-w-0">
          <SectionHeading
            title="消息时间轴"
            hint={`共 ${timeline.data?.total ?? 0} 条 · ${grouped.length} 天${filter.groupIds.length > 1 ? ` · 已选 ${filter.groupIds.length} 个群并按时间合并` : ''}`}
          />
          {timeline.loading && !items.length ? (
            <LoadingState label="正在读取提取条目…" rows={4} />
          ) : items.length === 0 ? (
            <EmptyState title="没有符合条件的结果" description="当前筛选条件下没有提取到内容。可以一键清除筛选条件，或扩大时间范围。" onAction={clearFilter} />
          ) : (
            <div className="space-y-4">
              {grouped.map(([day, list]) => (
                <div key={day} className="relative pl-6">
                  <span className="absolute bottom-0 left-[7px] top-2 w-px bg-ink-900/[0.09]" aria-hidden />
                  <span className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-jade-500 ring-1 ring-jade-500/30" aria-hidden />
                  <header className="mb-2 flex items-center gap-2">
                    <h4 className="text-[13px] font-semibold text-ink-700">{day}</h4>
                    <span className="mp-meta">{list.length} 条</span>
                  </header>
                  <ul className="space-y-2.5 pb-2">
                    {list.map((it) => (
                      <li key={it.id}>
                        <ExtractCard
                          item={it}
                          editing={editing === it.id}
                          draftSubject={draftSubject}
                          onDraftChange={setDraftSubject}
                          onStartEdit={() => {
                            setEditing(it.id);
                            setDraftSubject(it.subject);
                          }}
                          onSaveSubject={() => void saveSubject(it.id)}
                          onPriority={(p) => void changePriority(it.id, p)}
                          onTodo={(s) => void markTodo(it.id, s)}
                          onOpen={() => setDetailId(it.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---------------- 通知总览（按维度分组 —— REQ-045）：仅在通知总览视图显示 ---------------- */}
        {pageView === 'notices' && (
        <aside className="space-y-3 xl:sticky xl:top-[128px] xl:self-start">
          <Card>
            <CardHeader title={`通知总览 · ${NOTICE_DIMENSION_LABEL[dimension]}`} icon={ListFilter} subtitle="按维度分组集中展示" />
            <div className="space-y-3 px-4 py-3.5">
              {groups.loading && !groups.data ? (
                <LoadingState rows={1} label="正在分组…" />
              ) : groups.error ? (
                <ErrorState error={groups.error} onRetry={groups.refetch} onClearFilter={clearFilter} className="!py-4" />
              ) : (
                (groups.data ?? []).map((g) => (
                  <div key={g.key}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-semibold text-ink-700">
                        {dimension === 'type' ? EXTRACT_TYPE_LABEL[g.key as keyof typeof EXTRACT_TYPE_LABEL] ?? g.key : dimension === 'priority' ? `优先级 ${PRIORITY_LABEL[g.key as Priority] ?? g.key}` : dimension === 'todo' ? TODO_STATE_LABEL[g.key as keyof typeof TODO_STATE_LABEL] ?? g.key : g.key}
                      </span>
                      <Badge tone="neutral">{g.items.length}</Badge>
                    </div>
                    <ul className="space-y-1">
                      {g.items.slice(0, 4).map((it) => (
                        <li key={it.id}>
                          <button type="button" onClick={() => setDetailId(it.id)} className="w-full truncate rounded-lg px-2 py-1.5 text-left text-[11.5px] text-ink-600 transition-colors hover:bg-jade-500/[0.06]">
                            {it.summaryLine}
                          </button>
                        </li>
                      ))}
                      {g.items.length > 4 && <li className="mp-meta px-2">…另有 {g.items.length - 4} 条</li>}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="批次操作说明" icon={Sparkles} subtitle="模块二不区分身份（REQ-006、AC-018）" />
            <ul className="space-y-1.5 px-4 py-3.5">
              <li className="mp-meta leading-relaxed">· 主题由 AI 聚类命名，可点击条目上的「改主题」就地修改，改后立即生效。</li>
              <li className="mp-meta leading-relaxed">· 优先级三档（高 / 中 / 低），可改。</li>
              <li className="mp-meta leading-relaxed">· 待办只有「完成 / 忽略」两个动作，未处理为初始状态。</li>
              <li className="mp-meta leading-relaxed">· 本模块不出现第二组时间 / 关键词 / 群筛选控件（REQ-049）。</li>
            </ul>
          </Card>
        </aside>
        )}
      </div>
      )}

      <MessageDetailDrawer id={detailId} open={!!detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function ExtractCard({
  item,
  editing,
  draftSubject,
  onDraftChange,
  onStartEdit,
  onSaveSubject,
  onPriority,
  onTodo,
  onOpen,
}: {
  item: ExtractItem;
  editing: boolean;
  draftSubject: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onSaveSubject: () => void;
  onPriority: (p: Priority) => void;
  onTodo: (s: 'done' | 'ignored') => void;
  onOpen: () => void;
}) {
  const dl = deadlineHint(elements_deadline(item));
  return (
    <Card hover className="p-4" onClick={onOpen}>
      {/* heading：AI 一句话总结 + 来源群 + 时间（详情页的 heading 同源 —— REQ-048） */}
      <h3 className="text-[14.5px] font-semibold leading-snug text-ink-800">{item.summaryLine}</h3>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="mp-chip !py-0.5 !text-[11px]">{item.groupName}</span>
        <span className="mp-meta tabular-nums">{fmtMD(item.sentAt)}</span>
        <Badge tone="neutral">{EXTRACT_TYPE_LABEL[item.type]}</Badge>
        <Badge tone={PRIORITY_TONE[item.priority]}>优先级 {PRIORITY_LABEL[item.priority]}</Badge>
        <Badge tone={TODO_TONE[item.todoState]}>{TODO_STATE_LABEL[item.todoState]}</Badge>
        {dl && <Badge tone={dl.overdue ? 'neutral' : dl.urgent ? 'coral' : 'jade'}>{dl.text}</Badge>}
        {item.remindState === 'remind' && <Badge tone="coral">即将到期</Badge>}
      </div>

      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-500">{item.aiSummary}</p>

      {/* 要素 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {item.elements.time && <span className="mp-meta">时间：{fmtMD(item.elements.time)}</span>}
        {item.elements.location && <span className="mp-meta">地点：{item.elements.location}</span>}
        {item.elements.people?.length ? <span className="mp-meta">人物：{item.elements.people.map((p) => p.name).join('、')}</span> : null}
        {item.elements.deadline && <span className="mp-meta">DDL：{fmtMD(item.elements.deadline)}</span>}
        <span className="mp-meta">{item.sourceRefs.length} 条来源</span>
      </div>

      {/* 主题（可改 —— REQ-044）与操作 */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-ink-900/[0.06] pt-2.5" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <>
            <input value={draftSubject} onChange={(e) => onDraftChange(e.target.value)} className="w-[180px] rounded-lg border border-ink-900/[0.1] px-2 py-1 text-xs outline-none focus:border-jade-500/50" autoFocus />
            <Button size="sm" onClick={onSaveSubject} icon={Check}>
              保存主题
            </Button>
            <Button size="sm" variant="ghost" onClick={onStartEdit}>
              取消
            </Button>
          </>
        ) : (
          <>
            <span className="mp-meta">主题：{item.subject}</span>
            <Button size="sm" variant="ghost" icon={Pencil} onClick={onStartEdit}>
              改主题
            </Button>
          </>
        )}
        <span className="mx-1 h-3.5 w-px bg-ink-900/10" />
        <span className="mp-meta">优先级</span>
        {(['high', 'medium', 'low'] as Priority[]).map((p) => (
          <Chip key={p} active={item.priority === p} onClick={() => onPriority(p)}>
            {PRIORITY_LABEL[p]}
          </Chip>
        ))}
        <span className="mx-1 h-3.5 w-px bg-ink-900/10" />
        {item.todoState !== 'done' && (
          <Button size="sm" variant="outline" icon={Check} onClick={() => onTodo('done')}>
            完成
          </Button>
        )}
        {item.todoState !== 'ignored' && (
          <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => onTodo('ignored')}>
            忽略
          </Button>
        )}
      </div>
    </Card>
  );
}

function elements_deadline(item: ExtractItem): string | undefined {
  return item.elements.deadline;
}
