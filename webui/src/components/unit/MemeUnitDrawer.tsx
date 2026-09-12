/**
 * 梗单元（REQ-026 ~ REQ-035）
 * =============================================================================
 * 梗的唯一展示与操作单元（REQ-017）。区块顺序与 raw_design §3.4 一致：
 *   头部（梗名 · 类型标签 · 热度状态）
 *   梗的解读 → 关键时间（首现 / 最近调用，均可跳回原始消息）
 *   数量与周环比 → 时间分布图（可切表格、标注不完整月份）
 *   生命周期条 → 谁在用（梗王 + 主要使用者）→ 精华群消息（文字与梗图）
 *   相关变体 → 纠正改判 → 左下角固定「生成」按钮（REQ-034）
 * 另：点词云中的词时，抽屉从该词位置展开（REQ-022 / AC-044），故接受 anchor。
 */
import { useState } from 'react';
import { ExternalLink, MessageSquareQuote, Sparkles, Table2, Wand2 } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { fmtMD } from '@/lib/format';
import { CORRECTION_LABEL, HEAT_STATE_LABEL, MEME_TYPE_COLOR, MEME_TYPE_LABEL, type CorrectionMark, type MemeUnit, type SourceRef } from '@/types';
import { Avatar, Badge, Card, CardHeader, Chip, Drawer, MiniStat, NoticeBar } from '@/components/ui';
import { Button } from '@/components/shell/Button';
import { MonthlyBars } from '@/components/charts/Charts';
import { MessageContextDrawer } from './MessageContextDrawer';

const HEAT_TONE = { active: 'jade', fading: 'amber', silent: 'neutral' } as const;

export function MemeUnitDrawer({
  unit,
  open,
  anchor,
  onClose,
  onOpenVariant,
  onCorrected,
  onGenerate,
}: {
  unit: MemeUnit | null;
  open: boolean;
  anchor?: { x: number; y: number };
  onClose: () => void;
  onOpenVariant: (memeId: string) => void | Promise<void>;
  onCorrected: (next: MemeUnit) => void;
  onGenerate: (unit: MemeUnit) => void;
}) {
  const { claimDrawer, releaseDrawer } = useAppState();
  const [showTable, setShowTable] = useState(false);
  const [showAllHighlights, setShowAllHighlights] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  /** 回跳原文的目标消息（消息上下文抽屉） */
  const [contextId, setContextId] = useState<string | null>(null);

  /* 抽屉互斥：打开时登记，关闭时释放（避免与设置等其它 modal 叠加） */
  useEffect(() => {
    if (!unit) return;
    const id = `meme-unit:${unit.memeId}`;
    claimDrawer(id);
    return () => releaseDrawer(id);
  }, [unit?.memeId, claimDrawer, releaseDrawer]);

  if (!unit) return null;

  const highlights = showAllHighlights ? unit.highlights : unit.highlights.slice(0, 3);
  const trendUp = unit.weekOverWeek >= 0;

  const correct = async (mark: CorrectionMark) => {
    setBusy(true);
    setMsg(null);
    const res = await api.submitCorrection(unit.memeId, mark, mark === 'merged' ? mergeTarget : undefined);
    setBusy(false);
    if (res.ok && res.data) {
      onCorrected(res.data);
      setMsg(`已改判为「${CORRECTION_LABEL[mark]}」，后续结果已按改判更新。`);
    } else {
      setMsg(`${res.error?.message ?? '改判失败'}（${res.error?.code ?? 'UNKNOWN'}）`);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      kind="meme-unit"
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold">{unit.name}</span>
          <Badge tone="neutral">
            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: MEME_TYPE_COLOR[unit.type] }} />
            {MEME_TYPE_LABEL[unit.type]}
          </Badge>
          <Badge tone={HEAT_TONE[unit.heatState]}>{HEAT_STATE_LABEL[unit.heatState]}</Badge>
          {unit.correction !== 'none' && <Badge tone="coral">已改判：{CORRECTION_LABEL[unit.correction]}</Badge>}
          {anchor && <span className="mp-meta">（从词云 (x≈{Math.round(anchor.x)}, y≈{Math.round(anchor.y)}) 位置展开）</span>}
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>归属群：{unit.groupName}</span>
          <span>累计 {unit.occurrences} 次</span>
          {unit.mine && <span>我用过</span>}
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 「生成」固定在该单元左下角（REQ-034） */}
          <Button data-testid="meme-generate" onClick={() => onGenerate(unit)} icon={Wand2}>
            生成
          </Button>
          <span className="mp-meta">按时间倒序 · 每条结论都可回到原始消息</span>
        </div>
      }
    >
      <div className="space-y-5">
        {/* 梗的解读（REQ-026） */}
        <section className="rounded-2xl border border-jade-500/20 bg-jade-500/[0.06] px-4 py-3">
          <div className="mp-meta mb-1 inline-flex items-center gap-1 text-jade-700">
            <Sparkles size={12} /> 梗的解读
          </div>
          <p className="text-sm leading-relaxed text-ink-700">{unit.interpretation}</p>
        </section>

        {/* 关键时间（REQ-027 / AC-050：均可跳回原始消息） */}
        <section className="grid gap-2 sm:grid-cols-2">
          <JumpTime label="首次出现" value={fmtMD(unit.firstSeenAt)} group={unit.firstSeenGroupName} ref_={unit.sourceRefs[0]} onOpen={setContextId} />
          <JumpTime label="最近一次调用" value={`${fmtMD(unit.lastUsedAt)}（${unit.sinceLastUse}）`} group={unit.groupName} ref_={unit.sourceRefs[unit.sourceRefs.length - 1]} onOpen={setContextId} />
        </section>

        {/* 数量与周环比（REQ-028） */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniStat label="累计出现次数" value={unit.occurrences} tone="jade" />
          <MiniStat label="周环比" value={`${trendUp ? '+' : ''}${Math.round(unit.weekOverWeek * 100)}%`} tone={trendUp ? 'jade' : 'coral'} />
          <MiniStat label="热度状态" value={HEAT_STATE_LABEL[unit.heatState]} />
          <MiniStat label="活跃天数" value={`${unit.lifecycle.activeDays} 天`} />
        </section>

        {/* 时间分布图（REQ-029 / AC-053、AC-054） */}
        <Card>
          <CardHeader
            title="按月的出现次数"
            icon={Table2}
            subtitle="悬停显示数值；带 * 的月份为不完整月份"
            right={
              <button type="button" onClick={() => setShowTable((v) => !v)} className="mp-meta text-jade-700 hover:underline">
                {showTable ? '看柱状图' : '切换到表格'}
              </button>
            }
          />
          <div className="px-4 py-3.5">
            {showTable ? (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-ink-900/[0.08] text-ink-500">
                    <th className="py-1.5 pr-3 font-medium">月份</th>
                    <th className="py-1.5 pr-3 text-right font-medium">出现次数</th>
                    <th className="py-1.5 font-medium">不完整</th>
                  </tr>
                </thead>
                <tbody>
                  {unit.monthly.map((m) => (
                    <tr key={m.month} className="border-b border-ink-900/[0.04]">
                      <td className="py-1.5 pr-3 tabular-nums">{m.month}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{m.count}</td>
                      <td className="py-1.5">{m.incomplete ? '是' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <MonthlyBars buckets={unit.monthly} />
            )}
          </div>
        </Card>

        {/* 生命周期条（REQ-030 / AC-055） */}
        <section className="rounded-2xl border border-ink-900/[0.07] bg-white/70 px-4 py-3">
          <div className="mp-section-title mb-2">生命周期</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-600">
            <span>首现 {fmtMD(unit.lifecycle.firstSeenAt)}</span>
            <span className="text-ink-300">→</span>
            <span className="text-amber-700">峰值 {fmtMD(unit.lifecycle.peakAt)}</span>
            <span className="text-ink-300">→</span>
            <span>沉寂 {fmtMD(unit.lifecycle.silentAt)}</span>
            <Badge tone="jade">活跃 {unit.lifecycle.activeDays} 天</Badge>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-900/[0.05]">
            <div className="h-full rounded-full bg-gradient-to-r from-jade-300 via-jade-500 to-amber-500" />
          </div>
        </section>

        {/* 谁在用：梗王 + 主要使用者（REQ-031 / AC-056、AC-057） */}
        <Card>
          <CardHeader title="谁在用" icon={MessageSquareQuote} subtitle="梗王 = 使用该梗次数最多的成员；并列时全部列出。只呈现可统计事实" />
          <div className="space-y-3 px-4 py-3.5">
            <div className="flex flex-wrap gap-2">
              {unit.king.members.map((k) => (
                <span key={k.memberId} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] px-2.5 py-1.5">
                  <Avatar name={k.name} size={22} />
                  <span className="text-xs font-semibold text-ink-800">{k.name}</span>
                  <Badge tone="amber">梗王</Badge>
                  <span className="text-[11px] tabular-nums text-ink-500">
                    {k.count} 次 · {Math.round(k.ratio * 100)}%
                  </span>
                </span>
              ))}
            </div>
            <div>
              <div className="mp-meta mb-1.5">主要使用者</div>
              <div className="flex flex-wrap gap-1.5">
                {unit.king.topUsers.map((u) => (
                  <span key={u.memberId} className="mp-chip">
                    {u.name}
                    <span className="tabular-nums text-ink-400">{u.count}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* 精华群消息（REQ-032 / AC-058、AC-059）：文字与梗图都支持 */}
        <Card>
          <CardHeader
            title="精华群消息"
            icon={MessageSquareQuote}
            subtitle="默认 3 条；文字消息与梗图（图片 / 表情包）都支持，图片可预览"
            right={
              unit.highlights.length > 3 ? (
                <button type="button" onClick={() => setShowAllHighlights((v) => !v)} className="mp-meta text-jade-700 hover:underline">
                  {showAllHighlights ? '收起' : `展开更多（共 ${unit.highlights.length} 条）`}
                </button>
              ) : undefined
            }
          />
          <ul className="space-y-2 px-4 py-3.5">
            {highlights.map((h) => (
              <li key={h.messageId} className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2.5">
                <div className="mp-meta flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-600">{h.senderName}</span>
                  <span className="tabular-nums">{fmtMD(h.sentAt)}</span>
                  <span className="rounded bg-ink-900/[0.05] px-1.5 py-0.5">{h.groupName}</span>
                  <Badge tone={h.kind === 'text' ? 'neutral' : 'amber'}>{h.kind === 'text' ? '文字' : h.kind === 'image' ? '图片' : '表情包'}</Badge>
                  <button
                    type="button"
                    onClick={() => setContextId(h.messageId)}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] text-jade-700 hover:underline"
                    title="查看该消息的上下文"
                  >
                    <ExternalLink size={10} /> 回原文
                  </button>
                </div>
                {h.kind === 'text' ? (
                  <p className="mt-1 text-sm text-ink-700">{h.text}</p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    {h.mediaUrl ? (
                      <img src={h.mediaUrl} alt="梗图" className="h-24 w-24 rounded-lg border border-ink-900/[0.08] bg-ink-900/[0.03] object-cover" onError={(e) => ((e.currentTarget.style.display = 'none'))} />
                    ) : null}
                    <span className="mp-meta self-center">梗图预览（媒体按需解密后可用 —— 决策 8）</span>
                  </div>
                )}
              </li>
            ))}
            {unit.highlights.length === 0 && <li className="mp-meta">暂无可展示的精华消息</li>}
          </ul>
        </Card>

        {/* 相关变体（REQ-033 / AC-060） */}
        {unit.variants.length > 0 && (
          <section>
            <div className="mp-section-title mb-2">相关变体（可点击切换）</div>
            <div className="flex flex-wrap gap-1.5">
              {unit.variants.map((v) => (
                <Chip key={v.memeId} onClick={() => void onOpenVariant(v.memeId)}>
                  {v.name}
                </Chip>
              ))}
            </div>
          </section>
        )}

        {/* 纠正改判（REQ-035 / AC-022） */}
        <Card>
          <CardHeader title="纠正 AI 的判断" icon={Sparkles} subtitle="改判立即影响后续结果（词云、统计与检索都会按改判后的结果重算）" />
          <div className="space-y-3 px-4 py-3.5">
            <div className="flex flex-wrap gap-1.5">
              {(['not_meme', 'not_interested', 'king_wrong'] as CorrectionMark[]).map((m) => (
                <Chip key={m} active={unit.correction === m} onClick={() => void correct(m)}>
                  {CORRECTION_LABEL[m]}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mp-meta">合并到其他梗</span>
              <input
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                placeholder="输入目标梗名或标识"
                className="w-[200px] rounded-lg border border-ink-900/[0.1] px-2 py-1 text-xs outline-none focus:border-jade-500/50"
              />
              <Button size="sm" variant="outline" disabled={!mergeTarget || busy} onClick={() => void correct('merged')}>
                {CORRECTION_LABEL.merged}
              </Button>
            </div>
            <p className="mp-meta">只能合并到与本梗同属一个群的目标（跨群自动合并不做 —— REQ-040）。</p>
            {msg && <NoticeBar tone="jade">{msg}</NoticeBar>}
          </div>
        </Card>

        {/* 可追溯（REQ-007 / AC-021） */}
        {unit.sourceRefs.length > 0 && (
          <section>
            <div className="mp-section-title mb-2">来源消息（可回跳原文）</div>
            <ul className="space-y-1.5">
              {unit.sourceRefs.slice(0, 6).map((r) => (
                <SourceRow key={r.messageId} r={r} onOpen={setContextId} />
              ))}
            </ul>
          </section>
        )}
      </div>
      {/* 回跳原文：消息上下文抽屉（REQ-007） */}
      <MessageContextDrawer id={contextId} open={!!contextId} onClose={() => setContextId(null)} />
    </Drawer>
  );
}

function JumpTime({ label, value, group, ref_, onOpen }: { label: string; value: string; group: string; ref_?: SourceRef; onOpen: (messageId: string) => void }) {
  return (
    <div className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
      <div className="mp-meta">{label}</div>
      <div className="mt-0.5 text-sm font-medium tabular-nums text-ink-700">{value}</div>
      <div className="mp-meta mt-0.5">{group}</div>
      {ref_ && (
        <button
          type="button"
          onClick={() => onOpen(ref_.messageId)}
          className="mp-meta mt-1 inline-flex items-center gap-1 text-jade-700 hover:underline"
          title={`来源消息：${ref_.excerpt.slice(0, 30)}`}
        >
          <ExternalLink size={10} /> 跳回原始消息
        </button>
      )}
    </div>
  );
}

function SourceRow({ r, onOpen }: { r: SourceRef; onOpen: (messageId: string) => void }) {
  return (
    <li className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
      <div className="mp-meta flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink-600">{r.senderName}</span>
        <span className="tabular-nums">{fmtMD(r.sentAt)}</span>
        <span className="rounded bg-ink-900/[0.05] px-1.5 py-0.5">{r.groupName}</span>
        <button
          type="button"
          onClick={() => onOpen(r.messageId)}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-jade-700 hover:underline"
          title={`来源消息：${r.excerpt.slice(0, 30)}`}
        >
          <ExternalLink size={10} /> 回原文
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-700">{r.excerpt}</p>
    </li>
  );
}
