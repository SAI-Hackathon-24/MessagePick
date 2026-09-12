/**
 * 梗王榜（模块一 · 排行榜）
 * =============================================================================
 * 回答「这些梗是谁在用、谁带火的」。三项指标都是可由对话记录统计的事实，
 * 不做性格判断（REQ-031、REQ-041）：
 *   · 参与度 = 使用梗的总次数（说了多少次）
 *   · 创造力 = 由该成员**首次带火**、且被全群反复使用的梗数量
 *   · 综合分 = 参与度 40% + 覆盖广度 20% + 带火贡献 40%（各归一化到 0–100）
 * 综合榜第一名即「梗王」。
 */
import { useMemo, useState } from 'react';
import { Award, Crown, Flame, Sparkles, Trophy, Users } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { num } from '@/lib/format';
import type { MemeKingRow } from '@/types';
import { Avatar, Badge, Card, CardHeader, Chip, EmptyState, ErrorState, LoadingState, NoticeBar, SectionHeading, Stat } from '@/components/ui';

type SortKey = 'score' | 'participations' | 'distinctMemes' | 'authoredHits';

const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: 'score', label: '综合评分', hint: '参与度 40% + 覆盖广度 20% + 带火贡献 40%' },
  { key: 'participations', label: '参与度', hint: '使用梗的总次数' },
  { key: 'distinctMemes', label: '覆盖广度', hint: '用过的不同梗数量' },
  { key: 'authoredHits', label: '创造力', hint: '由其首次带火且被反复使用的梗数量' },
];

export default function KingBoardPage() {
  const { filter, clearFilter } = useAppState();
  const [sort, setSort] = useState<SortKey>('score');
  const [expanded, setExpanded] = useState<string | null>(null);

  const board = useApi(() => api.memeKingBoard(filter), [JSON.stringify(filter)]);

  const rows = useMemo(() => {
    const list = [...(board.data?.rows ?? [])];
    list.sort((a, b) => b[sort] - a[sort] || b.participations - a.participations);
    return list;
  }, [board.data, sort]);

  const king = board.data?.king;
  const podium = rows.slice(0, 3);

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="上榜成员" value={rows.length} unit="人" hint="在选定范围内用过梗的人" icon={Users} />
        <Stat label="梗提及总量" value={num(board.data?.totalParticipations ?? 0)} unit="次" hint="排行榜的分母" icon={Flame} tone="amber" />
        <Stat label="带火过的梗" value={num(rows.reduce((s, r) => s + r.authoredHits, 0))} unit="个" hint="首现出自该成员、且被反复使用" icon={Sparkles} tone="coral" />
        <Stat label="梗王" value={king?.name ?? '—'} hint={king ? `综合 ${king.score} 分` : ''} icon={Crown} tone="jade" />
      </section>

      {board.error && <ErrorState error={board.error} onRetry={board.refetch} onClearFilter={clearFilter} />}

      {/* 梗王：综合榜第一名单独突出 */}
      {king && (
        <Card className="overflow-hidden border-amber-500/30" data-testid="meme-king">
          <div className="flex flex-wrap items-center gap-4 bg-gradient-to-r from-amber-500/[0.12] to-transparent px-5 py-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-600 ring-1 ring-amber-500/30">
              <Crown size={26} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mp-meta">本期梗王（综合评分第一）</div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                <span className="text-2xl font-bold text-ink-900">{king.name}</span>
                <span className="text-lg font-semibold tabular-nums text-amber-600">{king.score} 分</span>
              </div>
              <div className="mp-meta mt-1">
                参与度 {king.participations} 次 · 用过 {king.distinctMemes} 个梗 · 带火 {king.authoredHits} 个
              </div>
              {king.authoredMemeNames.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {king.authoredMemeNames.slice(0, 6).map((n) => (
                    <span key={n} className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* 前三名 */}
      {podium.length > 0 && (
        <section>
          <SectionHeading title="前三名" hint="按综合评分排列；点击可看该成员的带火梗" />
          <div className="grid gap-3 sm:grid-cols-3">
            {podium.map((r, i) => (
              <Card key={r.memberId} className={cn('p-4', i === 0 && 'ring-1 ring-amber-500/30')}>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-xl text-sm font-bold',
                      i === 0 ? 'bg-amber-500/20 text-amber-700' : i === 1 ? 'bg-ink-900/[0.08] text-ink-600' : 'bg-amber-700/12 text-amber-800',
                    )}
                  >
                    {i + 1}
                  </span>
                  <Avatar name={r.name} size={38} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink-800">{r.name}</div>
                    <div className="mp-meta">综合 {r.score} 分</div>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                  <div className="rounded-lg bg-ink-900/[0.03] px-1 py-1.5">
                    <dt className="mp-meta">参与度</dt>
                    <dd className="text-xs font-semibold tabular-nums text-ink-700">{r.participations}</dd>
                  </div>
                  <div className="rounded-lg bg-ink-900/[0.03] px-1 py-1.5">
                    <dt className="mp-meta">覆盖</dt>
                    <dd className="text-xs font-semibold tabular-nums text-ink-700">{r.distinctMemes}</dd>
                  </div>
                  <div className="rounded-lg bg-ink-900/[0.03] px-1 py-1.5">
                    <dt className="mp-meta">带火</dt>
                    <dd className="text-xs font-semibold tabular-nums text-ink-700">{r.authoredHits}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* 完整榜单 */}
      <Card className="overflow-hidden">
        <CardHeader
          title="完整榜单"
          icon={Trophy}
          subtitle="三项指标均为可统计事实：说了多少次、用过多少个、带火了几个"
          right={
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mp-meta">排序</span>
              {SORTS.map((s) => (
                <Chip key={s.key} active={sort === s.key} onClick={() => setSort(s.key)} title={s.hint} data-testid={`king-sort-${s.key}`}>
                  {s.label}
                </Chip>
              ))}
            </div>
          }
        />
        <div className="px-4 py-3.5">
          {board.loading && !board.data ? (
            <LoadingState label="正在统计梗王榜…" rows={3} />
          ) : rows.length === 0 ? (
            <EmptyState title="没有可统计的梗" description="当前筛选条件下没有梗出现记录，可以清除筛选或扩大时间范围。" onAction={clearFilter} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-ink-900/[0.08] text-ink-500">
                    <th className="py-2 pr-3 font-medium">名次</th>
                    <th className="py-2 pr-3 font-medium">成员</th>
                    <th className="py-2 pr-3 text-right font-medium">参与度</th>
                    <th className="py-2 pr-3 text-right font-medium">覆盖广度</th>
                    <th className="py-2 pr-3 text-right font-medium">创造力</th>
                    <th className="py-2 pr-3 text-right font-medium">综合评分</th>
                    <th className="py-2 font-medium">带火的梗</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: MemeKingRow) => (
                    <tr key={r.memberId} className="border-b border-ink-900/[0.04] hover:bg-jade-500/[0.04]">
                      <td className="py-2 pr-3">
                        <span className={cn('inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold', r.isKing ? 'bg-amber-500/20 text-amber-700' : 'bg-ink-900/[0.06] text-ink-500')}>
                          {r.rank}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <Avatar name={r.name} size={22} />
                          <span className="font-medium text-ink-700">{r.name}</span>
                          {r.isKing && (
                            <Badge tone="amber">
                              <Crown size={10} /> 梗王
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.participations}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.distinctMemes}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.authoredHits}</td>
                      <td className="py-2 pr-3 text-right font-semibold tabular-nums text-jade-700">{r.score}</td>
                      <td className="py-2">
                        {r.authoredMemeNames.length > 0 ? (
                          <button
                            type="button"
                            data-testid={`king-expand-${r.memberId}`}
                            onClick={() => setExpanded((v) => (v === r.memberId ? null : r.memberId))}
                            className="text-left text-jade-700 hover:underline"
                          >
                            {expanded === r.memberId ? '收起' : `${r.authoredHits} 个（展开）`}
                          </button>
                        ) : (
                          <span className="mp-meta">—</span>
                        )}
                        {expanded === r.memberId && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.authoredMemeNames.map((n) => (
                              <span key={n} className="mp-chip !py-0.5 !text-[11px]">
                                {n}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <NoticeBar tone="sky" className="leading-relaxed">
        <Award size={13} className="mr-1 inline" />
        口径说明：只统计「说了多少次」这类可统计事实，不做性格判断（REQ-031、REQ-041）。
        「创造力」的判定是：某个梗的**首条出现记录**出自该成员，且这个梗被全群反复使用。
        统计数据取自当前筛选范围（群与时间范围在顶部调整）。
      </NoticeBar>
    </div>
  );
}
