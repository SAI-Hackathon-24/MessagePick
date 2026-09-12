import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CalendarClock,
  Compass,
  Info,
  Lightbulb,
  MessageSquareQuote,
  RefreshCw,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/app/appState';
import {
  MEMORY_KIND_LABEL,
  SOCIAL_MODE_LABEL,
  type FriendshipPotential,
  type PersonalityProfile,
  type RelationshipSummary,
  type SharedMemory,
  type SocialMode,
} from '@/types';
import { cn } from '@/lib/cn';
import { fmtMD, num } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { BarList, MiniStat, Radar } from '@/components/charts';
import { CouplingNote, ModuleScaffold } from '@/components/scaffold/ModuleScaffold';
import { Avatar, Badge, Card, CardHeader, EmptyState, ErrorState, LoadingState, NoticeBar, ProgressBar, SectionHeading, Stat } from '@/components/ui';

/**
 * 功能三 · 正向社交 / 反向社交
 * ===========================================================================
 * 语义（由使用者明确，已取代此前的推导草案）：
 *
 *   正向社交 = 已经熟识的人之间**做了什么**          → 关系总结模板
 *   反向社交 = **非熟人**但有相似兴趣爱好，具备交友潜力 → 潜力发现模板
 *
 * 分工：**具体分析由后端完成**，本页只负责「按这个要求预留 Web 模板」。
 * 因此页面上所有字段都来自 types.ts 的契约，后端新增维度不需要改布局。
 */
export default function SocialPage() {
  const { chats } = useAppState();
  const [mode, setMode] = useState<SocialMode>('forward');
  const [activeRelId, setActiveRelId] = useState<string | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const stats = useApi(() => api.getSocialStats(), []);
  const relationships = useApi(() => api.listRelationships(), []);
  const potentials = useApi(() => api.listPotentials(), []);
  const profiles = useApi(() => api.listProfiles(chats[0] ?? '24组·聊斋开发群'), [chats.join(',')]);

  const rels = relationships.data ?? [];
  const pots = potentials.data ?? [];
  const profileList = profiles.data ?? [];

  const currentRel = useMemo(
    () => rels.find((r) => r.id === activeRelId) ?? rels[0] ?? null,
    [rels, activeRelId],
  );
  const currentProfile = useMemo(
    () => profileList.find((p) => p.id === activeProfileId) ?? profileList[0] ?? null,
    [profileList, activeProfileId],
  );

  const s = stats.data;
  const loading = stats.loading && !s;
  const error = relationships.error ?? potentials.error ?? stats.error;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <NoticeBar className="flex items-start gap-2">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          <strong>本页是模板（占位数据）</strong>：语义已按「正向=熟人之间做了什么 / 反向=非熟人但有相似兴趣、有交友潜力」实现。
          <strong>具体分析口径由后端负责</strong>，前端只约定结果结构与展示形式；字段全部在{' '}
          <span className="font-mono">src/types.ts</span> 的 <span className="font-mono">RelationshipSummary</span> /{' '}
          <span className="font-mono">FriendshipPotential</span> 中定义，均带 <span className="font-mono">ext</span> 扩展位。
        </span>
      </NoticeBar>

      {/* 模式切换 */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-ink-900/[0.04] p-1">
          {(['forward', 'reverse'] as SocialMode[]).map((m) => {
            const meta = SOCIAL_MODE_LABEL[m];
            const Icon = m === 'forward' ? Users : Compass;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                  mode === m ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700',
                )}
              >
                <Icon size={14} />
                <span className="text-left">
                  <span className="block">{meta.title}</span>
                  <span className="mp-meta block">{meta.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <span className="mp-meta">视角：我 · 分析范围 {chats.length ? `${chats.length} 个群` : '全部群聊'}</span>
      </section>

      {/* 指标条 */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="mp-card h-[74px] animate-pulse-soft" />)
        ) : mode === 'forward' ? (
          <>
            <Stat label="熟识的人" value={s?.familiar_count ?? 0} unit="位" hint="有持续往来的对象" icon={Users} />
            <Stat label="记录下的共同经历" value={s?.memory_count ?? 0} unit="件" hint="从对话里沉淀出来的「一起做过的事」" icon={Sparkles} tone="amber" />
            <Stat label="覆盖群聊" value={chats.length || 6} unit="个" hint="可在顶部切换" icon={ArrowLeftRight} tone="ink" />
            <Stat label="平均往来消息" value={rels.length ? num(Math.round(rels.reduce((a, r) => a + r.interaction.message_count, 0) / rels.length)) : '—'} unit="条" icon={MessageSquareQuote} tone="jade" />
          </>
        ) : (
          <>
            <Stat label="潜在好友候选" value={s?.potential_count ?? 0} unit="位" hint="非熟人 + 兴趣相似" icon={Compass} />
            <Stat label="高潜力（≥80）" value={s?.high_potential_count ?? 0} unit="位" hint="优先尝试破冰" icon={Sparkles} tone="amber" />
            <Stat label="共同兴趣标签" value={new Set(pots.flatMap((p) => p.shared_interests)).size} unit="个" hint="候选人的兴趣并集" icon={Lightbulb} tone="jade" />
            <Stat label="平均直接互动" value={pots.length ? (pots.reduce((a, p) => a + p.unfamiliarity.direct_messages, 0) / pots.length).toFixed(1) : '—'} unit="条" hint="越低越说明「还不熟」" icon={MessageSquareQuote} tone="ink" />
          </>
        )}
      </section>

      {error && <ErrorState code={error.code} message={error.message} hint={error.hint} onRetry={() => { relationships.refetch(); potentials.refetch(); stats.refetch(); }} />}

      {/* 主体 */}
      {mode === 'forward' ? (
        <ForwardView
          relationships={rels}
          current={currentRel}
          onSelect={(r) => setActiveRelId(r.id)}
          loading={relationships.loading && !rels.length}
          onRefresh={relationships.refetch}
          refreshing={relationships.loading}
        />
      ) : (
        <ReverseView
          potentials={pots}
          loading={potentials.loading && !pots.length}
          onRefresh={potentials.refetch}
          refreshing={potentials.loading}
        />
      )}

      {/* 性格展示卡片（登记表功能点二：多维度分析 → 可视化卡片；两个模式共用） */}
      <section>
        <SectionHeading
          title="性格展示卡片"
          hint="登记表功能点二：从语言风格、情绪倾向、话题偏好、互动频率、表情使用、回复习惯等维度生成（当前为占位数据）"
        />
        {profiles.loading && !profileList.length ? (
          <LoadingState rows={1} label="正在读取成员…" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {currentProfile ? <ProfilePanel profile={currentProfile} /> : <EmptyState title="暂无成员数据" />}
            </div>
            <Card className="h-fit">
              <CardHeader title="成员列表" icon={Users} subtitle="点击切换" right={<span className="mp-meta">{profileList.length} 人</span>} />
              <ul className="max-h-[360px] overflow-y-auto px-2 py-2">
                {profileList.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setActiveProfileId(p.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-jade-500/[0.06]',
                        currentProfile?.id === p.id && 'bg-jade-500/[0.08]',
                      )}
                    >
                      <Avatar name={p.name} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ink-700">{p.name}</span>
                        <span className="mp-meta truncate">{p.persona_tags.join(' · ')}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-ink-300">{num(p.stats.message_count)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </section>

      <ModuleScaffold
        title="功能三 · 已按新语义重做，等待后端分析口径"
        subtitle="模板已就绪：后端给出结果即可直接渲染，不需要改布局"
        planned={[
          '「熟识」的判定口径（互动频次阈值？双向性？时间窗？）',
          '「相似兴趣」的抽取方式（关键词 / embedding / 话题聚类）',
          '交友潜力分值的计算权重',
          '观察视角切换（以某位成员为中心看关系）',
          '关系图谱可视化（谁和谁走得近）',
          '隐私边界：画像与潜力分析对谁可见',
        ]}
        note="接入方式：把 api.listRelationships / api.listPotentials 换成后端路由即可；新增维度往 ext 里塞，或往 axes[] 加一项，雷达与对比条会自动扩展。"
      />
      <CouplingNote module="core / LLM 接口" />
    </div>
  );
}

/* ========================================================================== */
/* 正向：熟人关系总结                                                          */
/* ========================================================================== */
function ForwardView({
  relationships,
  current,
  onSelect,
  loading,
  onRefresh,
  refreshing,
}: {
  relationships: RelationshipSummary[];
  current: RelationshipSummary | null;
  onSelect: (r: RelationshipSummary) => void;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (loading) return <LoadingState rows={3} label="正在总结你们之间的往来…" />;
  if (!relationships.length) {
    return (
      <EmptyState
        title="没有可总结的熟识关系"
        description="需要两个人在选定时间范围内有持续的往来消息。可以放宽时间范围，或换一个更活跃的群。"
      />
    );
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* 熟人清单 */}
      <Card className="h-fit">
        <CardHeader
          title="熟识的人"
          icon={Users}
          subtitle="按往来消息量排序"
          right={
            <button
              type="button"
              onClick={onRefresh}
              className="mp-meta inline-flex items-center gap-1 text-jade-700 hover:underline"
            >
              <RefreshCw size={11} className={cn(refreshing && 'animate-spin')} />
              刷新
            </button>
          }
        />
        <ul className="max-h-[520px] overflow-y-auto px-2 py-2">
          {relationships.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-jade-500/[0.06]',
                  current?.id === r.id && 'bg-jade-500/[0.08] ring-1 ring-jade-500/20',
                )}
              >
                <Avatar name={r.person.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink-700">{r.person.name}</span>
                  <span className="mp-meta block truncate">{r.relation_tags.join(' · ')}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[11px] tabular-nums text-ink-500">{num(r.interaction.message_count)}</span>
                  <span className="mp-meta">{r.shared_memories.length} 段经历</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* 关系详情 */}
      {current && <RelationshipDetail rel={current} />}
    </section>
  );
}

function RelationshipDetail({ rel }: { rel: RelationshipSummary }) {
  return (
    <div className="min-w-0 space-y-4">
      {/* 关系头部 */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 border-b border-ink-900/[0.06] bg-gradient-to-br from-jade-500/[0.07] to-transparent px-4 py-4">
          <div className="flex items-center gap-2">
            <Avatar name={rel.viewer.name} size={44} />
            <ArrowLeftRight size={15} className="text-ink-300" />
            <Avatar name={rel.person.name} size={44} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[16px] font-semibold text-ink-800">
                {rel.viewer.name} × {rel.person.name}
              </h3>
              {rel.relation_tags.map((t) => (
                <Badge key={t} tone="jade">
                  {t}
                </Badge>
              ))}
              {rel.confidence !== undefined && <Badge tone={rel.confidence >= 0.75 ? 'sky' : 'amber'}>置信度 {(rel.confidence * 100).toFixed(0)}%</Badge>}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{rel.one_liner}</p>
          </div>
        </div>

        {/* 关系综述 */}
        <div className="px-4 py-3.5">
          <div className="mp-section-title mb-1.5 inline-flex items-center gap-1.5">
            <Sparkles size={12} className="text-jade-600" /> 关系综述
          </div>
          <p className="text-[13px] leading-relaxed text-ink-700">{rel.narrative}</p>
        </div>

        {/* 互动指标 */}
        <div className="grid grid-cols-2 gap-2 px-4 pb-3.5 sm:grid-cols-4">
          <MiniStat label="往来消息" value={num(rel.interaction.message_count)} tone="jade" />
          <MiniStat label="我先开口" value={rel.interaction.initiator_ratio !== undefined ? `${Math.round(rel.interaction.initiator_ratio * 100)}%` : '—'} />
          <MiniStat label="平均回复" value={rel.interaction.avg_reply_minutes !== undefined ? `${rel.interaction.avg_reply_minutes} 分` : '—'} />
          <MiniStat label="共同群聊" value={rel.interaction.shared_chats ?? '—'} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 共同经历 —— 正向的核心：一起做了什么 */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="你们一起做过的事"
            icon={Sparkles}
            subtitle={`从对话记录里沉淀出的 ${rel.shared_memories.length} 段共同经历`}
          />
          <ol className="relative px-4 py-4">
            <span className="absolute bottom-6 left-[27px] top-6 w-px bg-ink-900/[0.09]" aria-hidden />
            {rel.shared_memories.map((m) => (
              <li key={m.id} className="relative flex gap-3 pb-4 last:pb-0">
                <span className="z-10 mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-white bg-jade-500 ring-1 ring-jade-500/30" />
                <MemoryItem memory={m} />
              </li>
            ))}
          </ol>
        </Card>

        {/* 共同话题 */}
        <Card>
          <CardHeader title="共同话题" icon={MessageSquareQuote} subtitle="两人都反复提及的主题" />
          <div className="flex flex-wrap gap-1.5 px-4 py-3.5">
            {rel.shared_topics.map((t) => (
              <span key={t} className="mp-chip">
                #{t}
              </span>
            ))}
          </div>
        </Card>

        {/* 情绪基调 */}
        <Card>
          <CardHeader title="相处的感觉" icon={UserRound} subtitle="情绪倾向统计" />
          <div className="space-y-3 px-4 py-3.5">
            {rel.vibe?.label && <p className="text-[13px] text-ink-700">{rel.vibe.label}</p>}
            {rel.vibe?.positivity !== undefined && (
              <div>
                <div className="mp-meta mb-1">正向情绪占比 {Math.round(rel.vibe.positivity * 100)}%</div>
                <ProgressBar percent={rel.vibe.positivity * 100} />
              </div>
            )}
            {rel.rhythm && rel.rhythm.length > 0 && (
              <div>
                <div className="mp-section-title mb-1.5">互动节奏（按周）</div>
                <BarList items={rel.rhythm.map((r) => ({ label: r.bucket, value: r.count }))} unit="次" />
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* 维护建议 */}
      {rel.suggestions && rel.suggestions.length > 0 && (
        <Card>
          <CardHeader title="可以把这段关系维护得更好" icon={Lightbulb} subtitle="基于互动习惯给出的可执行建议" />
          <ul className="space-y-1.5 px-4 py-3.5">
            {rel.suggestions.map((sg) => (
              <li key={sg} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-600">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-jade-500/60" />
                {sg}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MemoryItem({ memory }: { memory: SharedMemory }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-ink-900/[0.06] bg-white/70 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="jade">{MEMORY_KIND_LABEL[memory.kind]}</Badge>
        <span className="text-[13px] font-semibold text-ink-800">{memory.headline}</span>
      </div>
      <div className="mp-meta mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <CalendarClock size={11} /> {fmtMD(memory.happened_at)}
        </span>
        <span className="rounded bg-ink-900/[0.05] px-1.5 py-0.5">{memory.chat}</span>
        {memory.participants && memory.participants.length > 0 && <span>还有 {memory.participants.slice(0, 3).join('、')} 等</span>}
      </div>
      {typeof memory.ext?.raw_template === 'string' && <p className="mt-1.5 text-xs leading-relaxed text-ink-600">{memory.ext.raw_template}</p>}
      {memory.highlights && memory.highlights.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 text-[11px] text-jade-700 hover:underline">
            {open ? '收起原始消息' : `展开 ${memory.highlights.length} 条原始消息`}
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5 border-l-2 border-jade-500/25 pl-3">
              {memory.highlights.map((h, i) => (
                <li key={i} className="text-[11.5px] leading-relaxed text-ink-600">
                  <span className="font-medium text-ink-700">{h.sender}</span>
                  <span className="mp-meta ml-2">{h.time}</span>
                  <div>{h.text}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ========================================================================== */
/* 反向：潜在好友发现（非熟人 + 相似兴趣）                                       */
/* ========================================================================== */
function ReverseView({
  potentials,
  loading,
  onRefresh,
  refreshing,
}: {
  potentials: FriendshipPotential[];
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (loading) return <LoadingState rows={3} label="正在寻找可能聊得来的人…" />;
  if (!potentials.length) {
    return (
      <EmptyState
        title="暂未发现潜在好友"
        description="需要在群成员中找到「互动不多但兴趣相似」的人；可以扩大时间范围或增加参与分析的群。"
      />
    );
  }

  return (
    <section className="space-y-4">
      <SectionHeading
        title="可能聊得来的人"
        hint="判定前提是「还不熟」：直接互动很少或几乎没有；在此之上按兴趣相似度排序"
        right={
          <button
            type="button"
            onClick={onRefresh}
            className="mp-meta inline-flex items-center gap-1 text-jade-700 hover:underline"
          >
            <RefreshCw size={11} className={cn(refreshing && 'animate-spin')} />
            重新分析
          </button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {potentials.map((p) => (
          <PotentialCard key={p.id} item={p} />
        ))}
      </div>
    </section>
  );
}

function PotentialCard({ item }: { item: FriendshipPotential }) {
  const [showEvidence, setShowEvidence] = useState(false);
  const tone = item.potential >= 80 ? 'jade' : item.potential >= 65 ? 'amber' : 'neutral';

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      {/* 头部：人 + 潜力分 */}
      <div className="flex items-start gap-3">
        <Avatar name={item.person.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink-800">{item.person.name}</h3>
            <Badge tone={tone}>交友潜力 {item.potential}</Badge>
            {item.confidence !== undefined && <Badge tone="neutral">置信度 {(item.confidence * 100).toFixed(0)}%</Badge>}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">{item.one_liner}</p>
        </div>
      </div>

      {/* 「还不熟」的证据 —— 反向社交的判定前提，必须让用户看到 */}
      <div className="rounded-xl border border-ink-900/[0.06] bg-ink-900/[0.02] px-3 py-2.5">
        <div className="mp-section-title mb-1.5">为什么算「非熟人」</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="mp-meta">
            直接互动 <span className="font-semibold tabular-nums text-ink-600">{item.unfamiliarity.direct_messages}</span> 条
          </span>
          {item.unfamiliarity.last_interaction && <span className="mp-meta">最近一次 {fmtMD(item.unfamiliarity.last_interaction)}</span>}
          {item.unfamiliarity.mutual_friends && item.unfamiliarity.mutual_friends.length > 0 && (
            <span className="mp-meta">共同好友 {item.unfamiliarity.mutual_friends.slice(0, 3).join('、')}</span>
          )}
        </div>
        {item.unfamiliarity.reason && <p className="mp-meta mt-1">{item.unfamiliarity.reason}</p>}
      </div>

      {/* 相似维度对比 */}
      <div>
        <div className="mp-section-title mb-2">相似度对比（我 / TA）</div>
        <ul className="space-y-2">
          {item.axes.map((a) => (
            <li key={a.key}>
              <div className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="font-medium text-ink-700">{a.label}</span>
                <span className="tabular-nums text-ink-500">相似 {a.similarity}</span>
              </div>
              {/* 双向对比条：上=我，下=TA */}
              <div className="mt-1 space-y-[3px]">
                <div className="flex items-center gap-2">
                  <span className="mp-meta w-6 shrink-0">我</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
                    <span className="block h-full rounded-full bg-jade-500" style={{ width: `${a.mine}%` }} />
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="mp-meta w-6 shrink-0">TA</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
                    <span className="block h-full rounded-full bg-amber-500" style={{ width: `${a.theirs}%` }} />
                  </span>
                </div>
              </div>
              {a.evidence && <p className="mp-meta mt-1">{a.evidence}</p>}
            </li>
          ))}
        </ul>
      </div>

      {/* 共同兴趣 */}
      <div className="flex flex-wrap gap-1.5">
        {item.shared_interests.map((t) => (
          <span key={t} className="mp-chip !text-jade-700">
            #{t}
          </span>
        ))}
      </div>

      {/* 相似证据 */}
      <div>
        <button type="button" onClick={() => setShowEvidence((o) => !o)} className="text-[11px] text-jade-700 hover:underline">
          {showEvidence ? '收起相似证据' : '查看相似证据（双方各自说过的话）'}
        </button>
        {showEvidence && (
          <ul className="mt-2 space-y-2">
            {item.evidence.map((e, i) => (
              <li key={i} className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                <div className="mp-meta flex flex-wrap items-center gap-2">
                  <Badge tone={e.from === 'me' ? 'jade' : 'amber'}>{e.from === 'me' ? '我' : 'TA'}</Badge>
                  <span>{e.time}</span>
                  <span className="rounded bg-ink-900/[0.05] px-1.5 py-0.5">{e.chat}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-700">{e.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 破冰建议 */}
      <div className="rounded-xl border border-jade-500/20 bg-jade-500/[0.05] px-3 py-2.5">
        <div className="mp-meta mb-1.5 inline-flex items-center gap-1 text-jade-700">
          <Lightbulb size={12} /> 破冰建议
        </div>
        <ul className="space-y-1">
          {item.icebreakers.map((b) => (
            <li key={b} className="flex gap-2 text-[11.5px] leading-relaxed text-ink-600">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-jade-500/60" />
              {b}
            </li>
          ))}
        </ul>
        {item.entry_points && item.entry_points.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="mp-meta">可从这些群切入</span>
            {item.entry_points.map((e) => (
              <span key={e} className="mp-chip !py-0.5 !text-[11px]">
                {e}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ========================================================================== */
/* 性格展示卡片（两个模式共用）                                                  */
/* ========================================================================== */
function ProfilePanel({ profile }: { profile: PersonalityProfile }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-4">
        <Avatar name={profile.name} size={48} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink-800">{profile.name}</h3>
            {profile.persona_tags.map((t) => (
              <Badge key={t} tone="jade">
                {t}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">{profile.one_liner}</p>
        </div>
        <Radar axes={profile.dimensions.map((d) => ({ label: d.label, score: d.score }))} size={210} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="发言" value={num(profile.stats.message_count)} />
        <MiniStat label="均回复" value={profile.stats.avg_reply_minutes !== undefined ? `${profile.stats.avg_reply_minutes} 分` : '—'} />
        <MiniStat label="活跃时段" value={profile.stats.active_hours ?? '—'} />
        <MiniStat label="表情占比" value={profile.stats.emoji_ratio !== undefined ? `${Math.round(profile.stats.emoji_ratio * 100)}%` : '—'} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mp-section-title mb-1.5">语言风格</div>
          <div className="flex flex-wrap gap-1.5">
            {profile.style_keywords.map((k) => (
              <span key={k} className="mp-chip">
                {k}
              </span>
            ))}
          </div>
        </div>
        <div>
          <div className="mp-section-title mb-1.5">口癖 / 常用梗</div>
          <div className="flex flex-wrap gap-1.5">
            {profile.catchphrases.map((k) => (
              <span key={k} className="mp-chip">
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>

      {profile.confidence !== undefined && (
        <div className="mt-3">
          <div className="mp-meta mb-1">画像置信度 {(profile.confidence * 100).toFixed(0)}%（数据量不足时会变低）</div>
          <ProgressBar percent={profile.confidence * 100} />
        </div>
      )}
    </Card>
  );
}
