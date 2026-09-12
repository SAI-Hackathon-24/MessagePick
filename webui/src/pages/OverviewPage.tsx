import { Link } from 'react-router-dom';
import { AlarmClock, ArrowUpRight, BarChart3, Flame, HeartHandshake, MessageSquareText, Sparkles, Users } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/app/appState';
import { cn } from '@/lib/cn';
import { compactNum, deadlineHint, fmtMD, num } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { BarList, Donut, HourBars } from '@/components/charts';
import { NoticeCompactRow } from '@/components/notice/NoticeCard';
import { CouplingNote, ModuleScaffold } from '@/components/scaffold/ModuleScaffold';
import { Avatar, Badge, Card, CardHeader, ErrorState, LoadingState, NoticeBar, SectionHeading, Stat } from '@/components/ui';

/**
 * 总览页 —— 三大功能的统一入口
 * 一句话定位：打开就知道「今天群里发生了什么、有什么不能漏、谁在活跃」。
 */
export default function OverviewPage() {
  const { chats } = useAppState();
  const overview = useApi(() => api.getOverview(chats), [chats.join(',')]);
  const memes = useApi(() => api.listMemes(chats, 'hot'), [chats.join(',')]);
  const notices = useApi(() => api.queryNotices({ chats, categories: [], priorities: [], statuses: [], keyword: '', sort: 'deadline' }), [chats.join(',')]);

  const o = overview.data;
  const loading = overview.loading && !o;

  if (overview.error) {
    return <ErrorState code={overview.error.code} message={overview.error.message} hint={overview.error.hint} onRetry={overview.refetch} />;
  }

  const upcoming = (notices.data ?? []).filter((n) => n.entities.deadline && n.status !== 'done').slice(0, 5);
  const hotMemes = (memes.data ?? []).slice(0, 8);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* 数据说明：诚实标注当前为演示数据 */}
      <NoticeBar>
        当前为 <strong>演示数据（mock）</strong>：结构与 <span className="font-mono">wechat-cli</span> 真实输出一致，接口调用点已在 <span className="font-mono">src/api/index.ts</span> 预留。后端就绪后切换为真实数据即可。
      </NoticeBar>

      {/* ① 关键指标 */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="mp-card h-[74px] animate-pulse-soft" />)
        ) : (
          <>
            <Stat label="消息总量" value={compactNum(o?.total_messages ?? 0)} unit="条" hint={`${o?.group_count ?? 0} 个群 · ${o?.member_count ?? 0} 位成员`} icon={MessageSquareText} />
            <Stat label="提炼出的热梗" value={o?.meme_count ?? 0} unit="个" hint="词云与梗卡片的来源" icon={Sparkles} tone="amber" />
            <Stat label="提取到的信息" value={o?.notice_count ?? 0} unit="条" hint={`其中待办 ${o?.todo_count ?? 0} 条`} icon={AlarmClock} tone="coral" />
            <Stat label="数据时间跨度" value={o ? Math.round((Date.parse(o.range.end) - Date.parse(o.range.start)) / 86400000) : '—'} unit="天" hint={o ? `${o.range.start.slice(0, 10)} 起` : ''} icon={BarChart3} tone="ink" />
          </>
        )}
      </section>

      {/* ② 最近的 DDL 提醒 */}
      {o?.next_deadline && (
        <section className="rounded-2xl border border-coral-500/25 bg-gradient-to-r from-coral-500/[0.08] to-amber-500/[0.06] px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-coral-500/15 text-coral-500">
              <AlarmClock size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mp-meta">最近一个不能漏的 DDL</div>
              <div className="truncate text-sm font-semibold text-ink-800">{o.next_deadline.headline}</div>
              <div className="mp-meta mt-0.5">
                {o.next_deadline.chat} · 截止 {fmtMD(o.next_deadline.deadline)}
                {deadlineHint(o.next_deadline.deadline) && ` · ${deadlineHint(o.next_deadline.deadline)!.text}`}
              </div>
            </div>
            <Link to="/inbox" className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-ink-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-ink-800">
              去处理 <ArrowUpRight size={12} />
            </Link>
          </div>
        </section>
      )}

      {/* ③ 三大功能入口 */}
      <section>
        <SectionHeading title="三大核心功能" hint="登记表锁定的功能方向；点击进入对应工作区" />
        <div className="grid gap-3 lg:grid-cols-3">
          <FeatureTile
            to="/meme"
            icon={Flame}
            tone="amber"
            title="群聊热梗分析"
            desc="一键提炼群内热梗与黑话 → 词云 → 梗卡片 → 生成表情包/配文图"
            metrics={[
              { k: '热梗', v: `${o?.meme_count ?? 0} 个` },
              { k: '最热', v: hotMemes[0]?.term ?? '—' },
            ]}
          />
          <FeatureTile
            to="/inbox"
            icon={MessageSquareText}
            tone="jade"
            title="群聊信息提取"
            desc="自动识别公告、@所有人、接龙、报名、缴费、会议、DDL → 通知总览与待办"
            metrics={[
              { k: '信息', v: `${o?.notice_count ?? 0} 条` },
              { k: '待办', v: `${o?.todo_count ?? 0} 条` },
            ]}
          />
          <FeatureTile
            to="/social"
            icon={HeartHandshake}
            tone="violet"
            title="正向与反向社交"
            desc="好友性格画像、趣味人格标签、同频匹配（目标.md 该章节待补，先占位）"
            metrics={[
              { k: '状态', v: '占位' },
              { k: '挂载点', v: '已预留' },
            ]}
            placeholder
          />
        </div>
      </section>

      {/* ④ 活跃度 / 类型分布 / 排行 */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="24 小时活跃分布" icon={BarChart3} subtitle="来自 wechat-cli stats.hourly" />
          <div className="px-4 py-3.5">{o ? <HourBars hourly={o.hourly} /> : <div className="mp-skeleton h-24" />}</div>
        </Card>
        <Card className="lg:col-span-1">
          <CardHeader title="消息类型分布" icon={MessageSquareText} subtitle="来自 wechat-cli stats.type_breakdown" />
          <div className="px-4 py-3.5">
            {o ? (
              <Donut size={140} data={Object.entries(o.type_breakdown).map(([label, value]) => ({ label, value }))} />
            ) : (
              <div className="mp-skeleton h-32" />
            )}
          </div>
        </Card>
        <Card className="lg:col-span-1">
          <CardHeader title="发言排行" icon={Users} subtitle="来自 wechat-cli stats.top_senders" />
          <div className="px-4 py-3.5">
            {o ? <BarList items={o.top_senders.map((s) => ({ label: s.name, value: s.count, hint: '条' }))} unit="条" /> : <div className="mp-skeleton h-32" />}
          </div>
        </Card>
      </section>

      {/* ⑤ 热梗速览 + 待办速览 */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="当前最热的梗"
            icon={Flame}
            subtitle="点击进入热梗分析，查看词云与卡片"
            right={
              <Link to="/meme" className="mp-meta inline-flex items-center gap-1 text-jade-700 hover:underline">
                查看全部 <ArrowUpRight size={11} />
              </Link>
            }
          />
          <div className="flex flex-wrap gap-1.5 px-4 py-3.5">
            {hotMemes.length ? (
              hotMemes.map((m) => (
                <Link key={m.id} to="/meme" className="mp-chip hover:border-jade-500/40 hover:text-jade-700">
                  {m.term}
                  <span className="tabular-nums text-ink-400">{num(m.count)}</span>
                </Link>
              ))
            ) : (
              <span className="mp-meta">暂无数据</span>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="按 DDL 排序的待办"
            icon={AlarmClock}
            subtitle="目标.md：重要通知一眼可见、一键可管、到期不忘"
            right={
              <Link to="/inbox" className="mp-meta inline-flex items-center gap-1 text-jade-700 hover:underline">
                进入信息提取 <ArrowUpRight size={11} />
              </Link>
            }
          />
          <ul className="px-2 py-2">
            {upcoming.length ? (
              upcoming.map((n) => (
                <li key={n.id}>
                  <NoticeCompactRow notice={n} onOpen={() => (window.location.hash = '#/inbox')} />
                </li>
              ))
            ) : (
              <li className="mp-meta px-2 py-3">暂无带 DDL 的待办</li>
            )}
          </ul>
        </Card>
      </section>

      {/* ⑥ 成员速览（为功能三引流） */}
      <section>
        <SectionHeading title="群成员" hint="功能三（性格画像与匹配）的入口人群；该章节待目标.md 补完" />
        <MemberStrip chats={chats} />
      </section>

      <ModuleScaffold
        title="总览页 · 可扩展看板位"
        subtitle="PRD 定稿后，这里可以长出「自定义看板」"
        planned={['本周群聊体检报告', '我关注的群置顶卡片', '异常提醒（消息量骤降/骤增）', '把任意卡片固定到总览']}
        note="实现方式：新增看板卡片时，复用 Card + charts 里的展示单元即可，无需改动整体栅格。"
      />

      <CouplingNote module="core / LLM 接口" />
    </div>
  );
}

function FeatureTile({
  to,
  icon: Icon,
  title,
  desc,
  metrics,
  tone,
  placeholder,
}: {
  to: string;
  icon: typeof Flame;
  title: string;
  desc: string;
  metrics: { k: string; v: string }[];
  tone: 'amber' | 'jade' | 'violet';
  placeholder?: boolean;
}) {
  const tones = {
    amber: 'from-amber-500/[0.12] text-amber-600 ring-amber-500/20',
    jade: 'from-jade-500/[0.12] text-jade-700 ring-jade-500/20',
    violet: 'from-violet-500/[0.12] text-violet-600 ring-violet-500/20',
  };
  return (
    <Link to={to} className={cn('mp-card mp-card-hover group relative overflow-hidden bg-gradient-to-br to-transparent p-4', tones[tone])}>
      <div className="flex items-start justify-between">
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1', tones[tone])}>
          <Icon size={19} />
        </span>
        {placeholder ? <Badge tone="violet">待定稿</Badge> : <ArrowUpRight size={15} className="text-ink-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
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

function MemberStrip({ chats }: { chats: string[] }) {
  const profiles = useApi(() => api.listProfiles(chats[0] ?? '24组·聊斋开发群'), [chats.join(',')]);
  if (profiles.loading && !profiles.data) return <LoadingState rows={1} label="正在读取群成员…" />;
  const list = profiles.data ?? [];
  if (!list.length) return <span className="mp-meta">暂无成员数据</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((p) => (
        <div key={p.id} className="mp-card flex items-center gap-2.5 px-3 py-2">
          <Avatar name={p.name} size={30} />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-ink-700">{p.name}</div>
            <div className="mp-meta truncate">{p.persona_tags[0]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
