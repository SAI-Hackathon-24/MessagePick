/**
 * 兴趣 → 人（API-021 / REQ-060、REQ-064、REQ-065、REQ-081）
 * =============================================================================
 * 两个检索入口：按一级维度搜（分数高的人）/ 按具体二级标签搜。
 * 结果展示每人的**回复时长**与**活跃度**；发言不足者标「未知」但仍列出。
 * 可勾选候选人 → 生成组局建议（REQ-063，仅文字建议）。
 */
import { useState } from 'react';
import { Activity, Clock, Sparkles, Users } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { INTEREST_CATEGORIES, INTEREST_CATEGORY_LABEL, type InterestCategory } from '@/types';
import { Avatar, Badge, Card, CardHeader, Chip, EmptyState, ErrorState, LoadingState, NoticeBar } from '@/components/ui';
import { Button } from '@/components/shell/Button';

export function InterestToPeoplePanel() {
  const { filter, clearFilter } = useAppState();
  const [entry, setEntry] = useState<'category' | 'tag'>('category');
  const [category, setCategory] = useState<InterestCategory>('sports');
  const [tag, setTag] = useState('羽毛球');
  const [picked, setPicked] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const value = entry === 'category' ? category : tag;
  const result = useApi(() => api.interestToPeople(entry, value, filter), [entry, value, JSON.stringify(filter)]);
  const cards = useApi(() => api.interestScoreCards(), []);
  const tagOptions = (cards.data ?? []).map((c) => c.name);

  const run = async () => {
    setBusy(true);
    setSuggestion(null);
    const res = await api.gatheringSuggestion(value, picked);
    setBusy(false);
    setSuggestion(res.ok && res.data ? res.data.text : `${res.error?.message ?? '生成失败'}（${res.error?.code ?? 'UNKNOWN'}）`);
  };

  return (
    <div className="space-y-4" data-testid="interest-to-people">
      <Card>
        <CardHeader title="反向社交：按兴趣找人" icon={Sparkles} subtitle="两个入口：按一级维度搜（该维度分高的人）/ 按具体标签搜（如「乒乓球」）" />
        <div className="space-y-3 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Chip active={entry === 'category'} onClick={() => setEntry('category')} data-testid="entry-category">
              按维度搜
            </Chip>
            <Chip active={entry === 'tag'} onClick={() => setEntry('tag')} data-testid="entry-tag">
              按具体 tag 搜
            </Chip>
          </div>
          {entry === 'category' ? (
            <div className="flex flex-wrap gap-1.5">
              {INTEREST_CATEGORIES.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
                  {INTEREST_CATEGORY_LABEL[c]}
                </Chip>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="输入二级标签，如 羽毛球"
                className="w-[200px] rounded-lg border border-ink-900/[0.1] px-2.5 py-1.5 text-xs outline-none focus:border-jade-500/50"
                data-testid="tag-input"
              />
              <div className="flex flex-wrap gap-1">
                {tagOptions.slice(0, 10).map((t) => (
                  <Chip key={t} active={tag === t} onClick={() => setTag(t)}>
                    {t}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <p className="mp-meta">
            匹配范围为跨全部已采集的历史群（REQ-051）；结果中会给出每人的回复时长、发言量与活跃度综合分，用来判断「找他要等多久、他还活跃吗」（REQ-065）。
          </p>
        </div>
      </Card>

      {result.error && <ErrorState error={result.error} onRetry={result.refetch} onClearFilter={clearFilter} />}

      {result.data && (
        <p className="mp-meta">
          共 {result.data.people.length} 人 · 排序按该兴趣上的置信度；卡片里的「回复时长」用来判断找他要等多久（REQ-065）。
        </p>
      )}

      {result.loading && !result.data ? (
        <LoadingState label="正在检索…" rows={3} />
      ) : !result.data?.people.length ? (
        <EmptyState title="没有找到符合条件的人" description="换个维度或标签试试，也可以一键清除筛选条件。" onAction={clearFilter} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-ink-700">
              {entry === 'category' ? `${INTEREST_CATEGORY_LABEL[category]}维度` : `标签「${tag}」`}：{result.data.people.length} 人
            </div>
            <div className="flex items-center gap-2">
              <span className="mp-meta">已选 {picked.length} 人</span>
              <Button size="sm" disabled={!picked.length || busy} onClick={() => void run()} icon={Sparkles}>
                生成组局建议
              </Button>
            </div>
          </div>

          {suggestion && (
            <NoticeBar tone="jade" className="leading-relaxed">
              <div className="mb-1 font-medium">组局建议（仅文字建议，不生成待办、也不生成可直接发送的文案 —— REQ-063）</div>
              <div data-testid="gathering-suggestion">{suggestion}</div>
            </NoticeBar>
          )}

          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {result.data.people.map((p) => {
              const on = picked.includes(p.personId);
              return (
                <li key={p.personId}>
                  <Card className={cn('p-3.5', on && 'border-jade-500/40 ring-1 ring-jade-500/20')}>
                    <div className="flex items-start gap-2.5">
                      <Avatar name={p.name} size={34} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink-800">{p.name}</span>
                          {p.unknown ? <Badge tone="neutral">未知</Badge> : <Badge tone="jade">置信度 {p.confidence}</Badge>}
                        </div>
                        <div className="mp-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={10} /> 回复时长 {p.replyMedianMinutes !== undefined ? `${p.replyMedianMinutes} 分` : '样本不足'}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Users size={10} /> 发言 {p.activity} 条
                          </span>
                          <span className="inline-flex items-center gap-1" title="活跃度综合分 = 消息条数 50% + 平均回复时长 30% + 活跃新鲜度 20%">
                            <Activity size={10} /> 活跃度{' '}
                            {p.activityScore?.insufficient ? '数据不足' : (p.activityScore?.score ?? '—')}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-pick={p.personId}
                        disabled={p.unknown}
                        onClick={() => setPicked((prev) => (prev.includes(p.personId) ? prev.filter((x) => x !== p.personId) : [...prev, p.personId]))}
                        className={cn('shrink-0 rounded-lg border px-2 py-0.5 text-[11px] transition-colors', on ? 'border-jade-600 bg-jade-600 text-white' : 'border-ink-900/[0.1] text-ink-500 hover:border-jade-500/40', p.unknown && 'cursor-not-allowed opacity-40')}
                      >
                        {on ? '已选' : '选为候选'}
                      </button>
                    </div>
                    {p.evidence.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-ink-900/[0.05] pt-2">
                        {p.evidence.slice(0, 1).map((e) => (
                          <li key={e.messageId} className="mp-meta truncate">
                            {e.senderName}：{e.excerpt}
                          </li>
                        ))}
                        {p.evidence.length > 1 && <li className="mp-meta">另有 {p.evidence.length - 1} 条证据（打开画像查看）</li>}
                      </ul>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
