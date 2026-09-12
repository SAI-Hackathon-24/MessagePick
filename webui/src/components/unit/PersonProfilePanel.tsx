/**
 * 人物兴趣画像（API-020 / REQ-061、REQ-071、REQ-073、REQ-078、REQ-080）
 * =============================================================================
 * · 二级标签：每条带置信度与证据，证据可打开原文（REQ-053）
 * · 一级维度分 = 该维度下全部二级标签置信度之和（REQ-080）
 * · 爱好雷达图：五轴；点任一轴展开该维度下的二级具体词条（REQ-071）
 * · 个人标签词云：按该成员自己的 tag 生成（与模块一「梗词云」不同物 —— REQ-073）
 * · 性格雷达图与性格标签：仅显示已确认的（REQ-075、REQ-077）；候选只在确认面板里出现
 * · 人工增删改兴趣标签，立即影响后续结果（REQ-056）
 * · 未知成员标「未知」、不做推测，但仍列出（REQ-081）
 */
import { useState } from 'react';
import { Plus, Sparkles, Tags, Trash2, UserRound } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { fmtMD } from '@/lib/format';
import { INTEREST_CATEGORIES, INTEREST_CATEGORY_LABEL, PERSONALITY_LABEL, TAG_ORIGIN_LABEL, type InterestCategory, type PersonalityTrait } from '@/types';
import { Avatar, Badge, Card, CardHeader, Chip, Collapsible, EmptyState, ErrorState, LoadingState, MiniStat, NoticeBar } from '@/components/ui';
import { Button } from '@/components/shell/Button';
import { HobbyRadar, PersonalityRadar } from '@/components/charts/Charts';

export function PersonProfilePanel({ personId }: { personId: string }) {
  const profile = useApi(() => api.personProfile(personId), [personId]);
  const persona = useApi(() => api.personaPanel(personId), [personId]);
  const [expanded, setExpanded] = useState<InterestCategory | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newCat, setNewCat] = useState<InterestCategory>('sports');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (profile.loading && !profile.data) return <LoadingState label="正在读取兴趣画像…" rows={3} />;
  if (profile.error) {
    return <ErrorState error={profile.error} onRetry={profile.refetch} />;
  }
  const p = profile.data;
  if (!p) return <EmptyState title="没有可展示的画像" />;

  const personalityScores = Object.fromEntries(p.personality.map((t) => [t.trait, t.score])) as Partial<Record<PersonalityTrait, number>>;

  const editTag = async (op: 'add' | 'delete' | 'edit', payload: { tagId?: string; name?: string; category?: InterestCategory }) => {
    setBusy(true);
    setMsg(null);
    const res = await api.editInterestTag(personId, op, payload);
    setBusy(false);
    if (res.ok) {
      profile.setData(() => res.data);
      setMsg(op === 'add' ? '已新增标签，后续匹配结果已同步更新。' : op === 'delete' ? '已删除标签，后续匹配结果已同步更新。' : '已更新标签。');
      setAdding(false);
      setNewTag('');
    } else {
      setMsg(`${res.error?.message ?? '操作未生效'}（${res.error?.code ?? 'UNKNOWN'}）`);
    }
  };

  const updatePersona = async (op: 'confirm' | 'add' | 'delete' | 'edit', traitId: string, trait?: PersonalityTrait) => {
    const res = await api.updatePersona(personId, op, traitId, trait);
    if (res.ok && res.data) {
      persona.setData(() => res.data!);
      profile.refetch();
    }
  };

  return (
    <div className="min-w-0 space-y-4" data-testid="person-profile">
      {/* 头部 */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 border-b border-ink-900/[0.06] bg-gradient-to-br from-jade-500/[0.07] to-transparent px-4 py-4">
          <Avatar name={p.name} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[16px] font-semibold text-ink-800">{p.name}</h3>
              {p.isMe && <Badge tone="jade">我</Badge>}
              {p.unknown && <Badge tone="neutral">未知（发言不足，不做推测）</Badge>}
              {p.groups.map((g) => (
                <Badge key={g.groupId} tone="sky">
                  {g.groupName}
                </Badge>
              ))}
            </div>
            <p className="mp-meta mt-1">
              正向社交：这个人喜欢什么。每条标签都能追溯到具体的群消息，点证据可打开原文。
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3.5 sm:grid-cols-4">
          <MiniStat label="活跃度（发言量）" value={p.activity} tone="jade" />
          <MiniStat label="回复时长中位数" value={p.replyMedianMinutes !== undefined ? `${p.replyMedianMinutes} 分` : '样本不足'} />
          <MiniStat label="兴趣标签" value={p.tags.length} />
          <MiniStat label="跨群身份" value={`${p.groups.length} 个群`} />
        </div>
      </Card>

      {msg && <NoticeBar tone="jade">{msg}</NoticeBar>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 爱好雷达图（REQ-071） */}
        <Card>
          <CardHeader title="爱好雷达图" icon={Sparkles} subtitle="五轴 = 运动 / 艺术 / 游戏 / 娱乐 / 社交；点击任一轴展开该维度下的二级词条" />
          <div className="px-4 py-3.5">
            <HobbyRadar
              scores={p.categoryScores}
              activity={p.activityScore}
              activityOf={p.activityScore}
              onAxisClick={(c) => setExpanded((prev) => (prev === c ? null : c))}
            />
            <div className="flex flex-wrap gap-1.5">
              {INTEREST_CATEGORIES.map((c) =>
                c === 'social' ? (
                  // 第五根轴按活跃度展示（数据层仍是契约固定的 social 维度）
                  <Chip key={c} active={expanded === c} onClick={() => setExpanded((prev) => (prev === c ? null : c))}>
                    活跃度 {p.activityScore?.insufficient ? '数据不足' : (p.activityScore?.score ?? '—')}
                  </Chip>
                ) : (
                  <Chip key={c} active={expanded === c} onClick={() => setExpanded((prev) => (prev === c ? null : c))}>
                    {INTEREST_CATEGORY_LABEL[c]} {p.categoryScores[c].toFixed(1)}
                  </Chip>
                ),
              )}
            </div>
            {expanded === 'social' ? (
              <div className="mt-2 rounded-xl border border-ink-900/[0.07] bg-white/70 px-3 py-2">
                <div className="mp-meta mb-1.5">活跃度构成（点雷达图上的「活跃度」轴可再次展开）</div>
                {p.activityScore?.insufficient ? (
                  <p className="text-xs text-ink-500">数据不足：发言少于 10 条，不做推测。</p>
                ) : (
                  <ul className="space-y-1.5">
                    {(p.activityScore?.metrics ?? []).map((mt) => (
                      <li key={mt.key} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                        <span className="w-[168px] shrink-0 text-ink-600">{mt.label}</span>
                        <span className="tabular-nums text-ink-700">
                          {mt.raw}
                          {mt.key === 'messages' ? ' 条' : mt.key === 'reply' ? ' 分钟' : ' 天'}
                        </span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-900/[0.06]">
                          <span className="block h-full rounded-full bg-jade-500" style={{ width: `${mt.normalized ?? 0}%` }} />
                        </span>
                        <span className="tabular-nums text-ink-400">
                          {mt.normalized === null ? '无样本' : `${mt.normalized} 分`} · 权重 {(mt.effectiveWeight * 100).toFixed(0)}%
                        </span>
                        {mt.note && <span className="mp-meta w-full">{mt.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mp-meta mt-1.5">口径：消息条数 50% + 平均回复时长 30% + 活跃新鲜度 20%，各项先除以群内最大值归一化到 0–100。</p>
              </div>
            ) : expanded ? (
              <div className="mt-2 rounded-xl border border-ink-900/[0.07] bg-white/70 px-3 py-2">
                <div className="mp-meta mb-1">{INTEREST_CATEGORY_LABEL[expanded]} 下的二级标签</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.tags.filter((t) => t.category === expanded).map((t) => (
                    <span key={t.tagId} className="mp-chip !text-[11px]">
                      {t.name}
                      <span className="tabular-nums text-ink-400">{t.confidence}</span>
                    </span>
                  ))}
                  {!p.tags.some((t) => t.category === expanded) && <span className="mp-meta">该维度下暂无标签</span>}
                </div>
              </div>
            ) : null}
            <p className="mp-meta mt-2 leading-relaxed">
              前四轴 = 该维度下全部二级标签的置信度之和（REQ-080）；第五轴「活跃度」为综合分，
              由消息条数、平均回复时长、活跃新鲜度按 50/30/20 加权得出。悬停任一根轴可看明细。
            </p>
          </div>
        </Card>

        {/* 个人标签词云（REQ-073） */}
        <Card>
          <CardHeader
            title="个人标签词云"
            icon={Tags}
            subtitle="按该成员自己的 tag 生成；与模块一的「梗词云」是不同物（REQ-017、REQ-073）"
            right={
              <Button size="sm" variant="outline" icon={Plus} onClick={() => setAdding((v) => !v)}>
                增标签
              </Button>
            }
          />
          <div className="px-4 py-3.5">
            {adding && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="二级标签名，如 乒乓球" className="w-[160px] rounded-lg border border-ink-900/[0.1] px-2 py-1 text-xs outline-none focus:border-jade-500/50" />
                <select value={newCat} onChange={(e) => setNewCat(e.target.value as InterestCategory)} className="rounded-lg border border-ink-900/[0.1] bg-white px-2 py-1 text-xs outline-none">
                  {INTEREST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {INTEREST_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
                <Button size="sm" disabled={!newTag.trim() || busy} onClick={() => void editTag('add', { name: newTag.trim(), category: newCat })}>
                  确认新增
                </Button>
                <span className="mp-meta">一级维度固定五类，不可增删（REQ-052）</span>
              </div>
            )}
            <div className="flex flex-wrap items-baseline gap-2">
              {p.tags.map((t) => (
                <span
                  key={t.tagId}
                  className="group inline-flex items-center gap-1 rounded-lg border border-ink-900/[0.07] px-2 py-1"
                  style={{ fontSize: Math.max(11, Math.min(20, 11 + t.confidence * 9)) }}
                  title={`${INTEREST_CATEGORY_LABEL[t.category]} · 置信度 ${t.confidence} · ${TAG_ORIGIN_LABEL[t.origin]}${t.mergedFrom?.length ? ` · 已归并 ${t.mergedFrom.join(' / ')}` : ''}`}
                >
                  {t.name}
                  <button type="button" aria-label={`删除标签 ${t.name}`} onClick={() => void editTag('delete', { tagId: t.tagId })} className="opacity-0 transition-opacity group-hover:opacity-100">
                    <Trash2 size={11} className="text-coral-500" />
                  </button>
                </span>
              ))}
              {!p.tags.length && <span className="mp-meta">暂无可展示的兴趣标签</span>}
            </div>
          </div>
        </Card>
      </div>

      {/* 二级标签 + 证据（REQ-053、REQ-054）：默认收起，避免一次性铺满整页 */}
      <Collapsible
        title="兴趣标签与证据"
        icon={Tags}
        count={p.tags.length}
        hint="每条标签都必须附带证据消息；无证据的标签不进入画像（REQ-054）"
        testId="profile-tags-collapse"
      >
        <ul className="divide-y divide-ink-900/[0.05]">
          {p.tags.map((t) => (
            <li key={t.tagId} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-ink-800">{t.name}</span>
                <Badge tone="neutral">{INTEREST_CATEGORY_LABEL[t.category]}</Badge>
                <Badge tone="jade">置信度 {t.confidence}</Badge>
                <Badge tone={t.origin === 'manual' ? 'violet' : 'sky'}>{TAG_ORIGIN_LABEL[t.origin]}</Badge>
                {t.mergedFrom?.length ? <span className="mp-meta">同义归并：{t.mergedFrom.join(' / ')}</span> : null}
              </div>
              <ul className="mt-1.5 space-y-1">
                {t.evidence.slice(0, 3).map((e) => (
                  <li key={e.messageId} className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-600">
                    <span className="font-medium">{e.senderName}</span>
                    <span className="mp-meta tabular-nums">{fmtMD(e.sentAt)}</span>
                    <span className="truncate">{e.excerpt}</span>
                    <button type="button" className="text-jade-700 hover:underline">
                      打开原文
                    </button>
                  </li>
                ))}
                {!t.evidence.length && <li className="mp-meta">该标签暂无证据（人工新增）</li>}
              </ul>
            </li>
          ))}
          {!p.tags.length && <li className="mp-meta py-3">暂无标签</li>}
        </ul>
      </Collapsible>

      {/* 性格标签：候选 → 确认 → 展示（REQ-074 ~ REQ-077）：默认收起，降低整页信息密度 */}
      <Collapsible
        title="性格标签"
        icon={UserRound}
        count={(persona.data?.confirmed ?? []).length}
        hint="六维闭集：领导式 / 活泼 / 幽默 / 冷静 / 理性 / 判断。候选必须经确认后才展示；仅对使用者本人可见"
        testId="profile-persona-collapse"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mp-section-title mb-2">已确认（会出现在画像与视图中）</div>
            <div className="flex flex-wrap gap-1.5">
              {(persona.data?.confirmed ?? []).map((t) => (
                <span key={t.traitId} className="inline-flex items-center gap-1 rounded-lg border border-jade-500/25 bg-jade-500/[0.08] px-2 py-1 text-xs text-ink-700">
                  {PERSONALITY_LABEL[t.trait]}
                  <span className="tabular-nums text-ink-400">{t.score}</span>
                  <button type="button" aria-label="删除" onClick={() => void updatePersona('delete', t.traitId)}>
                    <Trash2 size={11} className="text-coral-500" />
                  </button>
                </span>
              ))}
              {!(persona.data?.confirmed ?? []).length && <span className="mp-meta">暂无已确认的性格标签</span>}
            </div>

            <div className="mp-section-title mb-2 mt-4">候选（未确认，不出现在任何产物与视图中）</div>
            <div className="flex flex-wrap gap-1.5">
              {(persona.data?.candidates ?? []).map((t) => (
                <span key={t.traitId} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-ink-900/15 px-2 py-1 text-xs text-ink-500">
                  {PERSONALITY_LABEL[t.trait]}
                  <span className="tabular-nums text-ink-400">{t.score}</span>
                  <Button size="sm" variant="ghost" onClick={() => void updatePersona('confirm', t.traitId)} className="!px-1 !py-0 !text-[11px]">
                    确认
                  </Button>
                </span>
              ))}
              {!(persona.data?.candidates ?? []).length && <span className="mp-meta">暂无待确认候选</span>}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(['leadership', 'lively', 'humorous', 'calm', 'rational', 'judgement'] as PersonalityTrait[]).map((t) => (
                <Chip key={t} onClick={() => void updatePersona('add', `manual_${t}_${Date.now()}`, t)} title="人工新增（闭集内）">
                  + {PERSONALITY_LABEL[t]}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <PersonalityRadar scores={personalityScores} />
            <p className="mp-meta mt-1 leading-relaxed">
              性格维度分只统计状态为「已确认」的标签（REQ-075、REQ-080）；本面板不提供任何对外分享通道（REQ-077、REQ-085）。
            </p>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
