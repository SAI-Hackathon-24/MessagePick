/**
 * 模块一：群聊梗分析（MOD-005 的浏览器侧）
 * =============================================================================
 * 覆盖：REQ-020 ~ REQ-038
 *   · 梗词云：字号 = 出现频率（口径可切换）、颜色 = 类型 + 图例、悬停四项、布局切换、
 *     列表 / 表格等价视图（无障碍等价形式 —— REQ-021）
 *   · 梗单元：解读 / 首现与来源群 / 最近调用与距今 / 累计次数与周环比 / 月度分布（可切表格）/
 *     生命周期条 / 梗王 / 精华消息（文字与梗图都支持）/ 相关变体 / 纠正改判 / 左下角「生成」
 *   · 梗生命周期视图：每梗一行、条带长度 = 生命周期跨度、按月强度、当月领跑梗、表格视图
 *   · 生成：G1 表情包（三档素材 + 模板 + 文案 → 4 张）、G2 文字变体（5 条）、G3 新梗候选（确认后入库）
 */
import { useMemo, useState } from 'react';
import { Clock, Flame, Grid3x3, RefreshCw, Sparkles, Table2 } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/state/appState';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { fmtMD, num } from '@/lib/format';
import {
  CLOUD_LAYOUT_LABEL,
  FONT_SCALE_LABEL,
  MEME_TYPE_COLOR,
  MEME_TYPE_LABEL,
  type CloudLayout,
  type FontScaleMode,
  type MemeCloudEntry,
  type MemeUnit,
} from '@/types';
import { Button } from '@/components/shell/Button';
import { Badge, Card, CardHeader, Chip, EmptyState, ErrorState, LoadingState, NoticeBar, SectionHeading, Stat } from '@/components/ui';
import { MemeWordCloud } from '@/components/charts/MemeWordCloud';
import { LifecycleHeatmap } from '@/components/charts/Charts';
import { MemeUnitDrawer } from '@/components/unit/MemeUnitDrawer';
import { GeneratePanel } from '@/components/unit/GeneratePanel';

type View = 'cloud' | 'lifecycle' | 'table';

export default function MemePage() {
  const { filter, clearFilter } = useAppState();
  const [view, setView] = useState<View>('cloud');
  const [layout, setLayout] = useState<CloudLayout>('heat');
  const [scale, setScale] = useState<FontScaleMode>('cumulative');
  const [mineOnly, setMineOnly] = useState(false);
  const [selected, setSelected] = useState<MemeUnit | null>(null);
  const [generateFor, setGenerateFor] = useState<MemeUnit | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | undefined>();

  const cloud = useApi(() => api.memeCloud(filter, layout, scale), [JSON.stringify(filter), layout, scale]);
  /* 「我相关」视角（REQ-006）：与主查询同构，切换时只换数据源 */
  const mine = useApi(
    () => (mineOnly ? api.myMemes(filter, 'used') : api.memeCloud(filter, layout, scale)),
    [mineOnly, JSON.stringify(filter), layout, scale],
  );
  /* 生命周期视图的月份窗口：锚定词云数据自身的「首现 ~ 最近」范围。
     服务端 API-011 按请求窗口原样返回月度强度（含空月），窗口过宽时条带会落在
     窗口远角、看上去全空；用数据范围做窗口后条带铺满视野。词云未就绪时给空数组，
     由接口层兜底「最近 24 个月」。 */
  const lifecycleMonths = useMemo(() => {
    const stamps = (cloud.data?.entries ?? [])
      .flatMap((entry) => [entry.firstSeenAt, entry.lastUsedAt])
      .map((value) => value.slice(0, 7))
      .filter((month) => /^\d{4}-\d{2}$/.test(month))
      .sort();
    const first = stamps[0];
    const last = stamps[stamps.length - 1];
    return first === undefined || last === undefined ? [] : [first, last];
  }, [cloud.data]);
  const lifecycle = useApi(
    () => api.memeLifecycle(filter, lifecycleMonths),
    [JSON.stringify(filter), lifecycleMonths.join(',')],
  );

  const source = mineOnly ? mine : cloud;
  const entries = source.data?.entries ?? [];
  const legend = cloud.data?.legend ?? source.data?.legend ?? [];
  const { loading, error, refetch } = source;

  const stats = useMemo(() => {
    const total = entries.reduce((s, e) => s + e.occurrences, 0);
    return { count: entries.length, total, hottest: entries[0] };
  }, [entries]);

  const openUnit = async (entry: MemeCloudEntry, pos?: { x: number; y: number }) => {
    setAnchor(pos);
    const res = await api.memeUnit(entry.memeId);
    if (res.ok && res.data) setSelected(res.data);
    else setSelected(null);
  };

  return (
    <div className="space-y-5">
      {/* 指标 + 视图切换 */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="梗词云条目" value={stats.count} unit="个" hint="字号 = 出现频率" icon={Sparkles} />
        <Stat label="累计出现次数" value={num(stats.total)} unit="次" hint={`口径：${FONT_SCALE_LABEL[scale]}`} icon={Flame} tone="amber" />
        <Stat label="最热的梗" value={stats.hottest?.name ?? '—'} hint={stats.hottest ? `${stats.hottest.occurrences} 次` : ''} icon={Flame} tone="coral" />
        <Stat label="生命周期视图" value={lifecycle.data?.rows.length ?? '—'} unit="行" hint="每梗一行，条带 = 生命周期跨度" icon={Clock} tone="ink" />
      </section>

      {/* 词云工具条：字号口径 + 布局 + 我相关 + 等价视图（全部属于模块一的视图状态，不是第二套筛选控件） */}
      <Card className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <div className="flex items-center gap-1 rounded-xl bg-ink-900/[0.04] p-1">
          {(
            [
              { k: 'cloud', label: '梗词云', icon: Grid3x3 },
              { k: 'lifecycle', label: '梗生命周期', icon: Clock },
              { k: 'table', label: '列表 / 表格', icon: Table2 },
            ] as { k: View; label: string; icon: typeof Grid3x3 }[]
          ).map((v) => (
            <button
              key={v.k}
              type="button"
              data-testid={`meme-view-${v.k}`}
              onClick={() => setView(v.k)}
              className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors', view === v.k ? 'bg-white text-jade-700 shadow-sm' : 'text-ink-500 hover:text-ink-700')}
            >
              <v.icon size={13} />
              {v.label}
            </button>
          ))}
        </div>

        <span className="mx-1 h-4 w-px bg-ink-900/10" />

        <span className="mp-meta">字号口径</span>
        {(Object.keys(FONT_SCALE_LABEL) as FontScaleMode[]).map((k) => (
          <Chip key={k} active={scale === k} onClick={() => setScale(k)} title="口径可切换（REQ-020 / AC-042）">
            {FONT_SCALE_LABEL[k]}
          </Chip>
        ))}

        <span className="mx-1 h-4 w-px bg-ink-900/10" />
        <span className="mp-meta">布局</span>
        {(Object.keys(CLOUD_LAYOUT_LABEL) as CloudLayout[]).map((k) => (
          <Chip key={k} active={layout === k} onClick={() => setLayout(k)} title="按首次出现时间时，每个词下标注首现日期（REQ-023）">
            {CLOUD_LAYOUT_LABEL[k]}
          </Chip>
        ))}

        <Chip active={mineOnly} onClick={() => setMineOnly((v) => !v)} title="只看与「我」相关的梗（我用过的）—— REQ-006">
          我相关
        </Chip>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" icon={RefreshCw} spin={loading} onClick={refetch}>
            重新查询
          </Button>
        </div>
      </Card>

      {error && <ErrorState error={error} onRetry={refetch} onClearFilter={clearFilter} />}

      {/* ---------------- 梗词云 ---------------- */}
      {view === 'cloud' && (
        <>
          <Card className="overflow-hidden">
            <CardHeader
              title="梗词云"
              icon={Sparkles}
              subtitle="字号 = 该梗的出现频率；颜色 = 梗类型。点击任意词在词的位置展开梗单元"
              right={
                <div className="flex flex-wrap items-center gap-2.5">
                  {legend.map((l) => (
                    <span key={l.type} className="inline-flex items-center gap-1 text-[11px] text-ink-500">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
                      {l.label}
                    </span>
                  ))}
                </div>
              }
            />
            <div className="px-4 py-3">
              {loading && !entries.length ? (
                <LoadingState label="正在读取梗词云…" rows={2} />
              ) : entries.length === 0 ? (
                <EmptyState title="没有符合条件的结果" description="当前筛选条件下没有梗。可以一键清除筛选条件，或扩大时间范围。" onAction={clearFilter} />
              ) : (
                <MemeWordCloud entries={entries} layout={layout} onPick={openUnit} />
              )}
              {/* 类型同时有文字标签，不依赖颜色单独区分（REQ-020） */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {legend.map((l) => (
                  <Badge key={l.type} tone="neutral">
                    {l.label}
                  </Badge>
                ))}
                <span className="mp-meta">类型另有文字标签，不依赖颜色单独区分</span>
              </div>
            </div>
          </Card>

          {/* 列表 / 表格等价视图入口提示（REQ-021） */}
          <NoticeBar tone="sky">
            无障碍等价形式：切到「列表 / 表格」可以看到与词云完全等价的梗数据（可复制）。
          </NoticeBar>
        </>
      )}

      {/* ---------------- 梗生命周期视图 ---------------- */}
      {view === 'lifecycle' && (
        <Card className="overflow-hidden">
          <CardHeader
            title="梗生命周期视图"
            icon={Clock}
            subtitle="每梗一行，条带长度 = 生命周期跨度，条带内按月显示出现强度（顺序色阶）"
            right={<span className="mp-meta">首现 → 峰值 → 沉寂</span>}
          />
          <div className="px-4 py-3.5">
            {lifecycle.loading && !lifecycle.data ? (
              <LoadingState label="正在查询生命周期视图…" rows={2} />
            ) : lifecycle.error ? (
              <ErrorState error={lifecycle.error} onRetry={lifecycle.refetch} onClearFilter={clearFilter} />
            ) : (
              <>
                {/* 怎么读这张图（把「生命周期」讲清楚） */}
                <div className="mb-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                    <div className="mp-section-title mb-1">一眼看出「火过多久」</div>
                    <p className="mp-meta leading-relaxed">同一行的有色格子从最左到最右，就是这个梗从初现到沉寂的跨度；越靠右说明它凉得越晚。</p>
                  </div>
                  <div className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                    <div className="mp-section-title mb-1">一眼看出「这段时间在玩什么」</div>
                    <p className="mp-meta leading-relaxed">同一列里颜色最暖的格子，就是那个月被反复使用的梗。</p>
                  </div>
                  <div className="rounded-xl border border-ink-900/[0.06] bg-white/70 px-3 py-2">
                    <div className="mp-section-title mb-1">颜色含义</div>
                    <div className="flex items-center gap-1.5">
                      <span className="mp-meta">少</span>
                      <span className="h-3 w-24 rounded-sm border border-ink-900/10" style={{ background: 'linear-gradient(90deg, #eef7f1, #0b5c33)' }} />
                      <span className="mp-meta">多</span>
                    </div>
                    <p className="mp-meta mt-1 leading-relaxed">色阶按「当月强度」在 0 ~ 本期最大值之间线性映射。</p>
                  </div>
                </div>

                <LifecycleHeatmap rows={lifecycle.data?.rows ?? []} />

                {/* 当月领跑梗（REQ-025） */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="mp-meta mr-1">当月领跑梗</span>
                  {(lifecycle.data?.monthlyLeaders ?? []).slice(-6).map((l) => (
                    <Chip key={l.month} title={`${l.month} 出现 ${l.count} 次`}>
                      {l.month.slice(5)}：{l.name}
                    </Chip>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* ---------------- 列表 / 表格等价视图 ---------------- */}
      {view === 'table' && (
        <Card className="overflow-hidden">
          <CardHeader title="梗列表（等价数据，可复制）" icon={Table2} subtitle="与词云使用同口径的同一份数据（REQ-021）" />
          <div className="overflow-x-auto px-4 py-3.5">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ink-900/[0.08] text-ink-500">
                  <th className="py-2 pr-3 font-medium">梗名</th>
                  <th className="py-2 pr-3 font-medium">类型</th>
                  <th className="py-2 pr-3 text-right font-medium">频率值</th>
                  <th className="py-2 pr-3 text-right font-medium">出现次数</th>
                  <th className="py-2 pr-3 font-medium">首次出现</th>
                  <th className="py-2 pr-3 font-medium">最近调用</th>
                  <th className="py-2 font-medium">我相关</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.memeId} className="cursor-pointer border-b border-ink-900/[0.04] hover:bg-jade-500/[0.05]" onClick={() => void openUnit(e)}>
                    <td className="py-2 pr-3 font-medium text-ink-700">{e.name}</td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm" style={{ background: MEME_TYPE_COLOR[e.type] }} />
                        {MEME_TYPE_LABEL[e.type]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{e.frequency}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{e.occurrences}</td>
                    <td className="py-2 pr-3 tabular-nums text-ink-500">{fmtMD(e.firstSeenAt)}</td>
                    <td className="py-2 pr-3 tabular-nums text-ink-500">{fmtMD(e.lastUsedAt)}</td>
                    <td className="py-2">{e.mine ? '是' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---------------- 梗单元抽屉 ---------------- */}
      <MemeUnitDrawer
        unit={selected}
        open={!!selected}
        anchor={anchor}
        onClose={() => setSelected(null)}
        onOpenVariant={async (memeId) => {
          const res = await api.memeUnit(memeId);
          if (res.ok && res.data) {
            setSelected(res.data);
            cloud.refetch();
            lifecycle.refetch();
          }
        }}
        onCorrected={(next) => {
          setSelected(next);
          cloud.refetch();
          lifecycle.refetch();
        }}
        onGenerate={(unit) => {
          setGenerateFor(unit);
        }}
      />

      {/* ---------------- 生成（MOD-008，入口在梗单元左下角） ---------------- */}
      <GeneratePanel unit={generateFor} open={!!generateFor} onClose={() => setGenerateFor(null)} onImported={() => { cloud.refetch(); lifecycle.refetch(); }} />

      <SectionHeading title="术语口径" hint="REQ-017：不引入英文术语，且两个「词云」、两个时间轴视图不混用名称" />
      <div className="mp-meta -mt-2 leading-relaxed">
        本页的「梗词云」与模块三的「个人标签词云」是不同物；本页的「梗生命周期」与模块二的「消息时间轴」是两个不同视图。
        梗的唯一展示与操作单元统一称「梗单元」（原「梗卡片」不再使用）。
      </div>
    </div>
  );
}
