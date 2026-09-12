/**
 * 生成面板（MOD-008 的浏览器侧；入口固定在梗单元左下角 —— REQ-034）
 * =============================================================================
 * · G1 生成表情包（REQ-036）：素材档位三档单选其一 + 模板 + 文案 → 4 张 → 复制 / 下载
 *   素材档位：①参考群内相关图片 ②改编热门表情包 ③纯模板生成
 * · G2 生成更多文字变体（REQ-037）：默认 5 条，可一键复制
 * · G3 创造新梗（REQ-038）：候选梗单元 → 使用者确认后才入库并进入词云
 * · 全部生成物带「创作」标注（REQ-013）；使用成员素材需先确认（REQ-014）
 * · 遵守边界：AI 不自动发布、不自动替换群内说法（REQ-015、REQ-084）
 */
import { useState } from 'react';
import { Check, Copy, Download, Sparkles, Wand2 } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { fmtMD } from '@/lib/format';
import { GENERATE_KIND_LABEL, MATERIAL_TIER_LABEL, type GenerateKind, type MaterialTier, type MemeContext, type MemeUnit, type NewMemeCandidate } from '@/types';
import { Badge, Card, CardHeader, Chip, Drawer, ErrorState, LoadingState, NoticeBar } from '@/components/ui';
import { Button } from '@/components/shell/Button';

const TEMPLATES = [
  { id: 'classic', label: '经典双行' },
  { id: 'big', label: '大字号冲击' },
  { id: 'bottom', label: '底部小字' },
];

export function GeneratePanel({ unit, open, onClose, onImported }: { unit: MemeUnit | null; open: boolean; onClose: () => void; onImported: () => void }) {
  const { filter } = useAppState();
  const [kind, setKind] = useState<GenerateKind>('G1');
  const [tier, setTier] = useState<MaterialTier>('pure_template');
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: 'MATERIAL_NOT_CONFIRMED' | 'ANALYSIS_FAILED' | 'SOURCE_UNAVAILABLE'; message: string; hint?: string } | null>(null);
  const [stickers, setStickers] = useState<{ url: string; caption: string }[] | null>(null);
  const [texts, setTexts] = useState<string[] | null>(null);
  const [candidates, setCandidates] = useState<NewMemeCandidate[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const consents = useApi(() => api.materialConsents(), []);
  const history = useApi(() => api.generationHistory(filter), [JSON.stringify(filter)]);

  if (!unit) return null;

  const ctx: MemeContext = {
    memeId: unit.memeId,
    name: unit.name,
    interpretation: unit.interpretation,
    variants: unit.variants.map((v) => v.name),
    highlightImages: unit.highlights.filter((h) => h.mediaUrl).map((h) => ({ messageId: h.messageId, mediaUrl: h.mediaUrl! })),
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    if (kind === 'G1') {
      const res = await api.generateStickers(ctx, tier, TEMPLATES.find((t) => t.id === template)?.label ?? template, caption || unit.name);
      setBusy(false);
      if (res.ok && res.data) setStickers(res.data.images);
      else setError({ code: (res.error?.code as 'MATERIAL_NOT_CONFIRMED') ?? 'ANALYSIS_FAILED', message: res.error?.message ?? '生成失败', hint: res.error?.hint });
    } else if (kind === 'G2') {
      const res = await api.generateTextVariants(ctx);
      setBusy(false);
      if (res.ok && res.data) setTexts(res.data.variants);
      else setError({ code: 'ANALYSIS_FAILED', message: res.error?.message ?? '生成失败' });
    } else {
      const res = await api.generateNewMemeCandidates(filter);
      setBusy(false);
      if (res.ok && res.data) setCandidates(res.data);
      else setError({ code: 'ANALYSIS_FAILED', message: res.error?.message ?? '生成失败' });
    }
    history.refetch();
  };

  const confirmCandidate = async (candidateId: string) => {
    const res = await api.confirmCandidate(candidateId);
    if (res.ok && res.data) {
      setCandidates((prev) => prev?.map((c) => (c.candidateId === candidateId ? { ...c, status: 'confirmed' as const, memeId: res.data!.memeId } : c)) ?? null);
      onImported();
    } else {
      setError({ code: 'ANALYSIS_FAILED', message: res.error?.message ?? '入库失败' });
    }
  };

  const confirmMaterial = async (consentId: string) => {
    const res = await api.confirmMaterial(consentId);
    if (res.ok) consents.refetch();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="max-w-3xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">生成 · {unit.name}</span>
          <Badge tone="amber">全部产物标注「创作」</Badge>
        </span>
      }
      subtitle="AI 只产出内容与建议，不自动发布、也不会替换群内正在用的说法（REQ-015、REQ-084）"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button data-testid="generate-run" onClick={() => void run()} disabled={busy} icon={Wand2}>
            {busy ? '生成中…' : GENERATE_KIND_LABEL[kind]}
          </Button>
          <span className="mp-meta">产出会记入生成历史，可回看与再次下载</span>
        </div>
      }
    >
      <div className="space-y-5">
        {/* 生成入口三类 */}
        <div className="flex flex-wrap gap-1.5">
          {(['G1', 'G2', 'G3'] as GenerateKind[]).map((k) => (
            <Chip key={k} active={kind === k} onClick={() => { setKind(k); setError(null); }} data-testid={`generate-kind-${k}`}>
              {GENERATE_KIND_LABEL[k]}
            </Chip>
          ))}
        </div>

        {/* G1 参数 */}
        {kind === 'G1' && (
          <Card>
            <CardHeader title="素材与文案" icon={Sparkles} subtitle="素材来源三档，单选其一（REQ-036）" />
            <div className="space-y-3 px-4 py-3.5">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(MATERIAL_TIER_LABEL) as MaterialTier[]).map((t) => (
                  <Chip key={t} active={tier === t} onClick={() => setTier(t)} data-testid={`tier-${t}`}>
                    {MATERIAL_TIER_LABEL[t]}
                  </Chip>
                ))}
              </div>
              {tier === 'popular_sticker' && <NoticeBar tone="amber">改编热门表情包需注意原作者的版权与使用许可（REQ-014）。</NoticeBar>}
              {tier === 'group_image' && (
                <div className="space-y-2">
                  <div className="mp-meta">参考群内相关图片：使用成员素材前必须确认（未确认时生成会被拒绝 —— REQ-014 / AC-032）</div>
                  {(consents.data ?? []).map((c) => (
                    <div key={c.consentId} className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-900/[0.07] px-3 py-2">
                      <span className="text-xs text-ink-700">{c.materialRef}</span>
                      <span className="mp-meta">涉及成员：{c.memberName}</span>
                      <Badge tone={c.status === 'confirmed' ? 'jade' : 'coral'}>{c.status === 'confirmed' ? '已确认' : '未确认'}</Badge>
                      {c.status === 'unconfirmed' && (
                        <Button size="sm" variant="outline" onClick={() => void confirmMaterial(c.consentId)}>
                          确认素材
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="mp-meta">模板</span>
                {TEMPLATES.map((t) => (
                  <Chip key={t.id} active={template === t.id} onClick={() => setTemplate(t.id)}>
                    {t.label}
                  </Chip>
                ))}
              </div>
              <div>
                <div className="mp-section-title mb-1.5">文案（据此生成 4 个变体）</div>
                <input
                  data-testid="generate-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={`默认使用梗名「${unit.name}」`}
                  className="w-full rounded-xl border border-ink-900/[0.1] px-3 py-2 text-xs outline-none focus:border-jade-500/50"
                />
              </div>
            </div>
          </Card>
        )}

        {error && <ErrorState error={error} onRetry={() => void run()} className="!py-4" />}
        {busy && <LoadingState label={`正在${GENERATE_KIND_LABEL[kind]}…`} rows={1} />}

        {/* G1 产出：4 张 */}
        {stickers && (
          <section>
            <div className="mp-section-title mb-2 flex items-center gap-2">
              表情包（{stickers.length} 张）
              <Badge tone="amber">创作</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stickers.map((s, i) => (
                <figure key={i} className="overflow-hidden rounded-xl border border-ink-900/[0.08] bg-white">
                  <img src={s.url} alt={s.caption} className="aspect-square w-full object-cover" />
                  <figcaption className="space-y-1 px-2 py-1.5">
                    <div className="mp-meta truncate" title={s.caption}>
                      {s.caption}
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={s.url} download={`${unit.name}-${i + 1}.svg`} className="mp-meta inline-flex items-center gap-1 text-jade-700 hover:underline">
                        <Download size={10} /> 下载
                      </a>
                      <button type="button" onClick={() => void copy(s.caption)} className="mp-meta inline-flex items-center gap-1 text-jade-700 hover:underline">
                        {copied === s.caption ? <Check size={10} /> : <Copy size={10} />} 复制文案
                      </button>
                    </div>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* G2 产出：5 条 */}
        {texts && (
          <section>
            <div className="mp-section-title mb-2 flex items-center gap-2">
              文字变体（{texts.length} 条）
              <Badge tone="amber">创作</Badge>
            </div>
            <ul className="space-y-1.5">
              {texts.map((t) => (
                <li key={t} className="flex items-center justify-between gap-2 rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                  <span className="text-xs text-ink-700">{t}</span>
                  <button type="button" onClick={() => void copy(t)} className="mp-meta inline-flex shrink-0 items-center gap-1 text-jade-700 hover:underline">
                    {copied === t ? <Check size={10} /> : <Copy size={10} />} 复制
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* G3 产出：候选，确认后才入库 */}
        {candidates && (
          <section>
            <div className="mp-section-title mb-2">新梗候选（确认后才进入词云等视图 —— REQ-038、AC-023）</div>
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li key={c.candidateId} className="rounded-2xl border border-ink-900/[0.07] bg-white/70 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink-800">{c.name}</span>
                    <Badge tone={c.status === 'confirmed' ? 'jade' : 'amber'}>{c.status === 'confirmed' ? '已确认入库' : '候选（未生效）'}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-600">{c.meaningGuess}</p>
                  <div className="mt-2">
                    <div className="mp-meta mb-1">出处消息</div>
                    <ul className="space-y-1">
                      {c.sources.slice(0, 3).map((s) => (
                        <li key={s.messageId} className="text-[11.5px] text-ink-600">
                          <span className="font-medium">{s.senderName}</span>
                          <span className="mp-meta ml-2">{fmtMD(s.sentAt)}</span>
                          <div>{s.excerpt}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="mp-meta">使用示例：{c.examples.join('；')}</span>
                    {c.status === 'candidate' && (
                      <Button size="sm" onClick={() => void confirmCandidate(c.candidateId)} data-testid={`confirm-candidate-${c.candidateId}`}>
                        确认入库
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 生成历史（DM-020） */}
        <Card>
          <CardHeader title="生成历史" icon={Copy} subtitle="可回看与再次下载；产物均带「创作」标注" />
          <ul className="divide-y divide-ink-900/[0.05] px-4 py-1">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <Badge tone="neutral">{GENERATE_KIND_LABEL[h.kind]}</Badge>
                <span className="text-ink-700">{h.memeName ?? '—'}</span>
                {h.tier && <span className="mp-meta">{MATERIAL_TIER_LABEL[h.tier]}</span>}
                <span className="mp-meta ml-auto tabular-nums">{fmtMD(h.createdAt)}</span>
              </li>
            ))}
            {!history.data?.length && <li className="mp-meta py-2">还没有生成记录</li>}
          </ul>
        </Card>

        <NoticeBar tone="sky" className={cn('leading-relaxed')}>
          G1 的 4 张由「同一模板 + 4 个文案变体」驱动，采用本地模板化渲染（离线、确定性排版）；
          复制与下载在浏览器侧完成。所有产出不会自动发布，也不会替换群里正在用的说法。
        </NoticeBar>
      </div>
    </Drawer>
  );
}
