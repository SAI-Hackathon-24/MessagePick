/**
 * 总览页（外壳视图容器）
 * =============================================================================
 * 汇总三个模块的关键结果，让使用者一眼看到「这个群在玩什么、群里发生了什么、我和谁合得来」。
 * 三模块并列交付、互不依赖：本页任一块失败都不影响其它块（AC-040、REQ-016）。
 */
import { Link } from 'react-router-dom';
import { AlarmClock, ArrowUpRight, BarChart3, Flame, HeartHandshake, MessageSquareText, Sparkles, Users } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { fmtMD, num } from '@/lib/format';
import { INTEREST_CATEGORY_LABEL, MEME_TYPE_LABEL, PRIORITY_LABEL } from '@/types';
import { Card, CardHeader, ErrorState, LoadingState, SectionHeading, Stat } from '@/components/ui';
import { HourBars } from '@/components/charts/Charts';

export default function OverviewPage() {
  const { filter, clearFilter, groups } = useAppState();
  const volume = useApi(() => api.dataVolume(), []);
  const cloud = useApi(() => api.memeCloud(filter, 'heat', 'cumulative'), [JSON.stringify(filter)]);
  const extracts = useApi(() => api.extractItems(filter, 1, 10), [JSON.stringify(filter)]);
  const due = useApi(() => api.dueTodos(new Date().toISOString()), []);
  // 注：不自动调用社交接口（/me/fit 等）—— 避免打开应用即触发社交全量构建（含模型任务）；
  // 社交画像改为进入「正向 / 反向社交」页时按需构建。
  const scores = useApi(() => api.interestScoreCards(), []);

  const memes = cloud.data?.entries ?? [];
  const items = extracts.data?.items ?? [];
  const dueList = due.data ?? [];

  return (
    <div className="space-y-6">
      {/* 关键指标 */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="已采集消息" value={num(volume.data?.messages ?? 0)} unit="条" hint={`覆盖 ${volume.data?.groups ?? 0} 个群`} icon={MessageSquareText} />
        <Stat label="梗词云条目" value={memes.length} unit="个" hint="模块一：字号 = 出现频率" icon={Sparkles} tone="amber" />
        <Stat label="提取条目" value={num(extracts.data?.total ?? 0)} unit="条" hint="模块二：通知与活动" icon={AlarmClock} tone="coral" />
        <Stat label="我的整体融入度" value="—" unit="分" hint="模块三：进入「正向 / 反向社交」后生成" icon={HeartHandshake} tone="jade" />
      </section>

      {/* 到期待办提示：仅在使用应用期间检查（REQ-046） */}
      {dueList.length > 0 && (
        <section className="rounded-2xl border border-coral-500/25 bg-gradient-to-r from-coral-500/[0.08] to-amber-500/[0.06] px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-coral-500/15 text-coral-500">
              <AlarmClock size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mp-meta">距到期不足 1 天且未处理（{dueList.length} 条）</div>
              {dueList.slice(0, 2).map((t) => (
                <div key={t.id} className="truncate text-sm font-medium text-ink-800">
                  {t.subject} · {t.groupName} · {fmtMD(t.deadline)}
                </div>
              ))}
            </div>
            <Link to="/extract" className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800">
              去处理 <ArrowUpRight size={12} />
            </Link>
          </div>
        </section>
      )}

      {/* 三大模块入口 */}
      <section>
        <SectionHeading title="三大核心功能" hint="并列交付、互不依赖；任一模块不可用不影响其它模块（AC-040）" />
        <div className="grid gap-3 lg:grid-cols-3">
          <ModuleTile
            to="/meme"
            icon={Flame}
            tone="amber"
            title="群聊梗分析"
            desc="梗词云 → 梗单元 → 梗生命周期；可生成表情包与文字变体"
            metrics={[
              { k: '梗', v: `${memes.length} 个` },
              { k: '最热', v: memes[0]?.name ?? '—' },
            ]}
          />
          <ModuleTile
            to="/extract"
            icon={MessageSquareText}
            tone="jade"
            title="群聊信息提取"
            desc="消息时间轴 → 通知总览（来源 / 类型 / 优先级 / 待办）→ 详情回原文"
            metrics={[
              { k: '条目', v: `${extracts.data?.total ?? 0} 条` },
              { k: '待办', v: `${items.filter((i) => i.todoState === 'pending').length} 条` },
            ]}
          />
          <ModuleTile
            to="/social"
            icon={HeartHandshake}
            tone="violet"
            title="正向 / 反向社交"
            desc="人 → 兴趣（画像）/ 兴趣 → 人（找搭子）；契合度与逐维度差值"
            metrics={[
              { k: '候选人', v: '按需生成' },
              { k: '高契合', v: '—' },
            ]}
          />
        </div>
      </section>

      {/* 热度与待办 */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="最热的梗" icon={Flame} subtitle="点进梗词云查看全部（模块一）" right={<Link to="/meme" className="mp-meta text-jade-700 hover:underline">查看全部</Link>} />
          <div className="px-4 py-3.5">
            {cloud.loading && !memes.length ? (
              <LoadingState rows={1} label="正在读取梗词云…" />
            ) : cloud.error ? (
              <ErrorState error={cloud.error} onClearFilter={clearFilter} onRetry={cloud.refetch} className="!py-4" />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {memes.slice(0, 14).map((m) => (
                  <Link key={m.memeId} to="/meme" className="mp-chip hover:border-jade-500/40 hover:text-jade-700" title={`${MEME_TYPE_LABEL[m.type]} · ${m.occurrences} 次`}>
                    {m.name}
                    <span className="tabular-nums text-ink-400">{m.occurrences}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="最近的提取条目" icon={AlarmClock} subtitle="按时间倒序（模块二）" right={<Link to="/extract" className="mp-meta text-jade-700 hover:underline">进入信息提取</Link>} />
          <ul className="divide-y divide-ink-900/[0.05] px-1.5 py-1">
            {items.slice(0, 5).map((it) => (
              <li key={it.id}>
                <Link to="/extract" className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-jade-500/[0.06]">
                  <span className={it.priority === 'high' ? 'h-2 w-2 rounded-full bg-coral-500' : it.priority === 'medium' ? 'h-2 w-2 rounded-full bg-amber-500' : 'h-2 w-2 rounded-full bg-jade-500'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-ink-700">{it.summaryLine}</span>
                    <span className="mp-meta">
                      {it.groupName} · {fmtMD(it.sentAt)} · 优先级{PRIORITY_LABEL[it.priority]}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {!items.length && <li className="mp-meta px-3 py-3">暂无条目</li>}
          </ul>
        </Card>
      </section>

      {/* 兴趣评分卡 + 群规模 */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="群规模" icon={Users} subtitle="DM-002 群的实际数量" />
          <ul className="space-y-1.5 px-4 py-3.5">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between text-xs text-ink-600">
                <span className="truncate">{g.name}</span>
                <span className="mp-meta">已采集</span>
              </li>
            ))}
            {!groups.length && <li className="mp-meta">尚无群数据</li>}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="兴趣评分卡" icon={BarChart3} subtitle="兴趣热度分 = 该爱好下的人的活跃 / 投入程度（模块三，REQ-078）" right={<Link to="/social" className="mp-meta text-jade-700 hover:underline">进入社交</Link>} />
          <div className="px-4 py-3.5">
            {scores.loading && !scores.data ? (
              <LoadingState rows={1} label="正在读取评分卡…" />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {(scores.data ?? []).slice(0, 6).map((c) => (
                  <li key={c.tagId} className="rounded-xl border border-ink-900/[0.06] bg-white/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-ink-700">{c.name}</span>
                      <span className="mp-meta shrink-0">{INTEREST_CATEGORY_LABEL[c.category]} · {c.peopleCount} 人</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-900/[0.06]">
                      <div className="h-full rounded-full bg-gradient-to-r from-jade-400 to-jade-600" style={{ width: `${Math.min(100, c.heat * 8)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader title="24 小时活跃分布" icon={BarChart3} subtitle="用于判断什么时候发通知最可能被看到" />
        <div className="px-4 py-3.5">
          <HourBars hourly={Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), Math.round(20 + 260 * Math.exp(-Math.pow(h - 21, 2) / 26) + 120 * Math.exp(-Math.pow(h - 11, 2) / 18))]))} />
        </div>
      </Card>
    </div>
  );
}

function ModuleTile({ to, icon: Icon, title, desc, metrics, tone }: { to: string; icon: typeof Flame; title: string; desc: string; metrics: { k: string; v: string }[]; tone: 'amber' | 'jade' | 'violet' }) {
  const tones = {
    amber: 'from-amber-500/[0.12] text-amber-700 ring-amber-500/20',
    jade: 'from-jade-500/[0.12] text-jade-700 ring-jade-500/20',
    violet: 'from-violet-500/[0.12] text-violet-700 ring-violet-500/20',
  };
  return (
    <Link to={to} className={`mp-card mp-card-hover group relative overflow-hidden bg-gradient-to-br to-transparent p-4 ${tones[tone]}`}>
      <div className="flex items-start justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ${tones[tone]}`}>
          <Icon size={19} />
        </span>
        <ArrowUpRight size={15} className="text-ink-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <h3 className="mt-3 text-[15px] font-semibold text-ink-800">{title}</h3>
      <p className="mp-meta mt-1 leading-relaxed">{desc}</p>
      <dl className="mt-3 flex gap-4">
        {metrics.map((m) => (
          <div key={m.k}>
            <dt className="mp-meta">{m.k}</dt>
            <dd className="text-sm font-semibold text-ink-700">{m.v}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}
