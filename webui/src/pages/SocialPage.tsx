import { useState } from 'react';
import { AlertTriangle, Compass, Dices, HeartHandshake, Info, Sparkles, Tags, UserRound, Users } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/app/appState';
import type { MatchResult, PersonalityProfile, ReverseSignal, SocialMode } from '@/types';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { MiniStat, Radar } from '@/components/charts';
import { CouplingNote, ModuleScaffold } from '@/components/scaffold/ModuleScaffold';
import { Avatar, Badge, Card, CardHeader, EmptyState, ErrorState, LoadingState, NoticeBar, ProgressBar, SectionHeading, Stat } from '@/components/ui';

/**
 * 功能三 · 正向社交与反向社交（占位实现）
 * ---------------------------------------------------------------------------
 * 目标.md 里该章节标题已写但内容为空（第 31-33 行），登记表功能点二的表述是：
 *   「语言风格、情绪倾向、话题偏好、互动频率、表情使用、回复习惯 →
 *     性格展示卡片 + 趣味人格标签 + 契合度匹配」
 *
 * 因此本页的可扩展策略是：
 *   · 保留完整的两栏骨架（正向=找到同频的人 / 反向=提前知道沟通成本）
 *   · 卡片、雷达图、匹配条目都用与其它页一致的展示单元，字段来自 types.ts
 *   · 具体口径未定 → 用 NoticeBar + ModuleScaffold 明确标注「占位」，不假装已实现
 */
export default function SocialPage() {
  const { chats } = useAppState();
  const [mode, setMode] = useState<SocialMode>('forward');
  const [active, setActive] = useState<PersonalityProfile | null>(null);

  const profiles = useApi(() => api.listProfiles(chats[0] ?? '24组·聊斋开发群'), [chats.join(',')]);
  const matches = useApi(() => api.listMatches(), []);
  const reverse = useApi(() => api.listReverseSignals(), []);

  const list = profiles.data ?? [];
  const current = active ?? list[0] ?? null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <NoticeBar className="flex items-start gap-2">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          <strong>本页为占位实现。</strong>目标.md 中「正向社交和反向社交」章节尚未编写，登记表只锁定了功能点二的表述。
          下面所有卡片、雷达图、匹配条目的<strong>字段结构已在 types.ts 预留</strong>，定稿后替换数据来源即可，布局不用重做。
        </span>
      </NoticeBar>

      {/* 模式切换：正向 / 反向 */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-ink-900/[0.04] p-1">
          {(
            [
              { k: 'forward', label: '正向社交', desc: '我该主动找谁聊', icon: Compass },
              { k: 'reverse', label: '反向社交', desc: '和谁沟通成本高', icon: AlertTriangle },
            ] as const
          ).map((m) => (
            <button
              key={m.k}
              type="button"
              onClick={() => setMode(m.k)}
              className={cn('inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors', mode === m.k ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700')}
            >
              <m.icon size={14} />
              <span className="text-left">
                <span className="block">{m.label}</span>
                <span className="mp-meta block">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <span className="mp-meta">分析对象：{chats[0] ?? '24组·聊斋开发群'}（可在顶部切换群）</span>
      </section>

      {/* 指标条 */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="已生成画像的成员" value={list.length} unit="人" icon={Users} />
        <Stat label="候选匹配对数" value={matches.data?.length ?? 0} unit="对" icon={HeartHandshake} tone="amber" />
        <Stat label="需要留意的关系" value={reverse.data?.length ?? 0} unit="条" icon={AlertTriangle} tone="coral" />
        <Stat label="人格标签词库" value={12} unit="个" hint="可扩展，规则待定稿" icon={Tags} tone="ink" />
      </section>

      {profiles.error && <ErrorState code={profiles.error.code} message={profiles.error.message} hint={profiles.error.hint} onRetry={profiles.refetch} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 左：模式相关内容 */}
        <div className="min-w-0 space-y-5">
          {mode === 'forward' ? (
            <>
              <section>
                <SectionHeading title="同频匹配" hint="契合度 = 表达节奏 + 话题重合 + 活跃时段 + 梗重叠（具体权重待定稿）" />
                {matches.loading && !matches.data ? (
                  <LoadingState rows={3} label="正在计算契合度…" />
                ) : (matches.data ?? []).length === 0 ? (
                  <EmptyState title="暂无可匹配对象" description="需要至少两位成员有足够的聊天数据。" />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {(matches.data ?? []).map((m) => (
                      <MatchCard key={m.id} match={m} />
                    ))}
                  </div>
                )}
              </section>

              <ModuleScaffold
                title="正向社交 · 未定稿的扩展方向"
                subtitle="目标.md 该章节空白，以下为可能的落点，全部预留"
                planned={['群内话题引荐', '组队建议（技术互补）', '共同好友路径', '破冰话术一键复制', '按匹配度重排群成员列表']}
                note="字段扩展位：MatchResult.ext / PersonalityProfile.ext —— 新增维度不需要改动卡片布局。"
              />
            </>
          ) : (
            <>
              <section>
                <SectionHeading title="沟通成本提示" hint="反向社交的语义尚未定稿，当前以「可能需要额外触达成本」的口径展示" />
                {reverse.loading && !reverse.data ? (
                  <LoadingState rows={3} label="正在分析互动模式…" />
                ) : (
                  <div className="space-y-2.5">
                    {(reverse.data ?? []).map((s) => (
                      <ReverseCard key={s.id} signal={s} />
                    ))}
                  </div>
                )}
              </section>

              <ModuleScaffold
                title="反向社交 · 未定稿的扩展方向"
                subtitle="「反向社交」的定义需要你确认：是避雷？是降低期待？还是识别单向关系？"
                planned={['单向关系识别（总是你先开口）', '情绪消耗预警', '消息已读不回统计', '话题冷场归因', '给沟通方式的具体建议']}
                note="该模块的展示单元已按「标签 + 说明 + 严重度 + 建议」四段式预留，语义定稿后直接填内容即可。"
              />
            </>
          )}
        </div>

        {/* 右：画像侧栏 */}
        <aside className="space-y-3 lg:sticky lg:top-[76px] lg:self-start">
          <Card>
            <CardHeader title="性格展示卡片" icon={UserRound} subtitle="登记表功能点二：多维度分析生成可视化卡片" />
            {profiles.loading && !list.length ? (
              <div className="p-4">
                <LoadingState rows={1} label="正在读取成员…" />
              </div>
            ) : !current ? (
              <div className="p-4">
                <EmptyState title="暂无成员数据" />
              </div>
            ) : (
              <div className="space-y-3.5 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <Avatar name={current.name} size={44} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink-800">{current.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {current.persona_tags.map((t) => (
                        <Badge key={t} tone="jade">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="rounded-xl bg-ink-900/[0.03] px-3 py-2 text-xs leading-relaxed text-ink-600">{current.one_liner}</p>

                <div className="flex justify-center">
                  <Radar axes={current.dimensions.map((d) => ({ label: d.label, score: d.score }))} size={230} />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="发言" value={num(current.stats.message_count)} />
                  <MiniStat label="均回复" value={`${current.stats.avg_reply_minutes ?? '—'} 分`} />
                  <MiniStat label="活跃" value={current.stats.active_hours ?? '—'} />
                </div>

                <div>
                  <div className="mp-section-title mb-1.5">语言风格</div>
                  <div className="flex flex-wrap gap-1.5">
                    {current.style_keywords.map((k) => (
                      <span key={k} className="mp-chip">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mp-section-title mb-1.5">口癖 / 常用梗</div>
                  <div className="flex flex-wrap gap-1.5">
                    {current.catchphrases.map((k) => (
                      <span key={k} className="mp-chip">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>

                {current.confidence !== undefined && (
                  <div>
                    <div className="mp-meta mb-1">画像置信度 {(current.confidence * 100).toFixed(0)}%（数据量不足时会变低）</div>
                    <ProgressBar percent={current.confidence * 100} />
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="成员列表" icon={Users} subtitle="点击切换画像" right={<span className="mp-meta">{list.length} 人</span>} />
            <ul className="max-h-[280px] overflow-y-auto px-2 py-2">
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setActive(p)}
                    className={cn('flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-jade-500/[0.06]', current?.id === p.id && 'bg-jade-500/[0.08]')}
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

          <CouplingNote module="core / LLM 接口" />
        </aside>
      </div>

      <ModuleScaffold
        title="功能三 · 骨架已就绪，等待目标.md 补完"
        subtitle="当前页面已能承接「画像卡片 + 契合度 + 反向提示」三类结果，不需要推倒重来"
        planned={['正向/反向的定义确认', '人格标签词库与生成规则', '契合度算法口径与权重', '隐私与授权边界（谁能看到画像）', '分享卡片 / 邀请好友参与测试']}
        note="需要你确认的关键问题：① 反向社交到底指什么？② 画像是否需要「被分析者本人同意」？③ 匹配是全群范围还是仅好友？"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="inline-flex items-center gap-1.5 rounded-xl bg-jade-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-jade-700">
          <Sparkles size={13} />
          生成画像（接口待接）
        </button>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-xl border border-ink-900/[0.08] bg-white px-3.5 py-2 text-xs font-medium text-ink-600 transition-colors hover:border-jade-500/40 hover:text-jade-700">
          <Dices size={13} />
          随机匹配看看
        </button>
        <span className="mp-meta">POST /api/analyze/profiles · 参数见 types.ts AnalyzeRequest</span>
      </div>
    </div>
  );
}

function MatchCard({ match }: { match: MatchResult }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Avatar name={match.a.name} size={30} />
        <Avatar name={match.b.name} size={30} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-800">
            {match.a.name} <span className="text-ink-300">×</span> {match.b.name}
          </div>
          <div className="mp-meta">契合度 {match.score}</div>
        </div>
        <div className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-jade-500/10 text-sm font-bold tabular-nums text-jade-700 ring-1 ring-jade-500/20">
          {match.score}
        </div>
      </div>
      <ul className="mt-3 space-y-1">
        {match.reasons.map((r) => (
          <li key={r} className="flex gap-2 text-[11.5px] leading-relaxed text-ink-600">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-jade-500/60" />
            {r}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {match.shared_topics.map((t) => (
          <span key={t} className="mp-chip">
            #{t}
          </span>
        ))}
      </div>
      {match.icebreakers.length > 0 && <p className="mp-meta mt-2.5">破冰建议：{match.icebreakers.join('；')}</p>}
    </Card>
  );
}

function ReverseCard({ signal }: { signal: ReverseSignal }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name={signal.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink-800">{signal.name}</span>
            <Badge tone={signal.severity > 0.65 ? 'coral' : signal.severity > 0.45 ? 'amber' : 'neutral'}>{signal.label}</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">{signal.detail}</p>
          {signal.suggestion && <p className="mp-meta mt-1.5">建议：{signal.suggestion}</p>}
          <div className="mt-2">
            <div className="mp-meta mb-1">关注度 {(signal.severity * 100).toFixed(0)}%</div>
            <ProgressBar percent={signal.severity * 100} />
          </div>
        </div>
      </div>
    </Card>
  );
}
