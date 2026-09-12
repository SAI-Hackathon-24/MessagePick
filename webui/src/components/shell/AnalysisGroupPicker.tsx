/**
 * 待分析群选择器
 * =============================================================================
 * 产品口径：**导入只入库，不默认分析任何群**。
 * 分析（梗识别 / 抽取 / 画像）要为每个群逐人调用模型，实测 22 个群约 20 分钟；
 * 默认全量开跑会让「点一下更新」变成长时间无响应的黑盒。因此由使用者选群。
 *
 * 本组件的两件事：
 *   1. 列出全部群，**按最近活跃倒序**（服务端已排序），显示消息数与最近消息时间，
 *      让「该看哪个群」这个决定有依据；
 *   2. 提供「选最近活跃的 N 个」一键默认，避免让使用者从几十个群里翻。
 *
 * 写入走 `PUT /api/settings` 的 `ingest.analysisGroupIds`（需要启动令牌）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, Check, Sparkles, Users } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { fmtMD } from '@/lib/format';
import { Badge, Card, CardHeader, NoticeBar } from '@/components/ui';
import { Button } from '@/components/shell/Button';

/** 一键默认：最近活跃的前 N 个（测试阶段按使用者要求取 2 个）。 */
const DEFAULT_TOP_N = 2;

export function AnalysisGroupPicker({ onSaved }: { onSaved?: () => void }) {
  const scope = useApi(() => api.analysisScope(), []);
  const groups = useApi(() => api.groups(), []);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * 立即分析选中的群（`POST /api/analyze`）：
   * 只跑分析、不重新采集 —— 数据早就在库里时不必再采一次。
   * 接口立即返回，真正进度看操作面板（分析是逐群逐人的模型调用，可能要几分钟）。
   */
  const analyzeNow = async (): Promise<void> => {
    setAnalyzing(true);
    const res = await api.analyze(current);
    setAnalyzing(false);
    setMessage(
      res.ok
        ? `已开始分析 ${current.length} 个群。分析要逐群逐人调用模型，可能要几分钟；进度见「更新数据」旁的操作状态。`
        : `启动分析失败：${res.error?.message ?? '未知错误'}（${res.error?.code ?? 'UNKNOWN'}）`,
    );
  };

  /** 首次拿到服务端值后落到本地状态（之后由用户编辑）。 */
  useEffect(() => {
    if (selected === null && scope.data) setSelected(scope.data.analysisGroupIds);
  }, [scope.data, selected]);

  const list = groups.data ?? [];
  /** 最近活跃在前（服务端已排好序，这里只做一次稳定兜底）。 */
  const sorted = useMemo(
    () => [...list].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || (b.messageCount ?? 0) - (a.messageCount ?? 0)),
    [list],
  );
  const current = selected ?? [];
  const dirty = selected !== null && scope.data !== null && [...current].sort().join(',') !== [...scope.data.analysisGroupIds].sort().join(',');

  const toggle = (groupId: string): void => {
    setSelected((prev) => {
      const base = prev ?? [];
      return base.includes(groupId) ? base.filter((id) => id !== groupId) : [...base, groupId];
    });
    setMessage(null);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    const res = await api.setAnalysisGroups(current);
    setBusy(false);
    if (res.ok) {
      setMessage(
        res.data.analysisGroupIds.length === 0
          ? '已保存：不分析任何群（导入只入库，随时可再选）。'
          : `已保存：将分析 ${res.data.analysisGroupIds.length} 个群；下次更新完成后自动开始。`,
      );
      scope.setData(() => res.data);
      onSaved?.();
    } else {
      setMessage(`保存失败：${res.error?.message ?? '未知错误'}（${res.error?.code ?? 'UNKNOWN'}）`);
    }
  };

  if (scope.error) {
    return (
      <Card>
        <CardHeader title="待分析群" icon={Users} subtitle="读取分析范围失败" />
        <div className="px-4 py-3.5">
          <NoticeBar tone="coral">{scope.error.message}</NoticeBar>
        </div>
      </Card>
    );
  }

  return (
    <Card data-testid="analysis-group-picker">
      <CardHeader
        title="待分析群"
        icon={Users}
        subtitle="导入只负责入库。分析要对每个群逐人调用模型，因此由你选择分析哪些群；不选则不分析"
        right={<Badge tone={current.length === 0 ? 'neutral' : 'jade'}>{current.length === 0 ? '未选择' : `已选 ${current.length} 个`}</Badge>}
      />
      <div className="space-y-3 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={Activity}
            data-testid="pick-top-active"
            onClick={() => {
              setSelected(sorted.slice(0, DEFAULT_TOP_N).map((g) => g.id));
              setMessage(null);
            }}
          >
            选最近活跃的 {DEFAULT_TOP_N} 个
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            清空选择
          </Button>
          <Button size="sm" data-testid="save-analysis-scope" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={Sparkles}
            data-testid="analyze-now"
            disabled={analyzing || current.length === 0}
            onClick={() => void analyzeNow()}
          >
            {analyzing ? '已开始分析…' : `立即分析这 ${current.length} 个群`}
          </Button>
          {dirty && <span className="mp-meta">有未保存的改动</span>}
        </div>

        {message !== null && <NoticeBar tone={message.startsWith('已保存') ? 'jade' : 'coral'}>{message}</NoticeBar>}

        <ul className="max-h-[320px] divide-y divide-ink-900/[0.05] overflow-y-auto rounded-xl border border-ink-900/[0.06]">
          {sorted.map((g) => {
            const checked = current.includes(g.id);
            return (
              <li key={g.id}>
                <button
                  type="button"
                  data-testid={`pick-group-${g.id}`}
                  onClick={() => toggle(g.id)}
                  className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-jade-500/[0.05]', checked && 'bg-jade-500/[0.07]')}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked ? 'border-jade-600 bg-jade-600 text-white' : 'border-ink-900/20',
                    )}
                  >
                    {checked && <Check size={11} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-700">{g.name}</span>
                    <span className="mp-meta">
                      {g.messageCount ?? 0} 条消息
                      {g.lastMessageAt ? ` · 最近 ${fmtMD(new Date(g.lastMessageAt).toISOString())}` : ' · 暂无消息'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {sorted.length === 0 && <li className="mp-meta px-3 py-4">还没有已采集的群：先执行一次「更新数据」。</li>}
        </ul>

        <p className="mp-meta leading-relaxed">
          列表按**最近活跃**排序。不选择任何群时，更新只把消息入库、不产生任何分析结果
          （梗词云 / 提取条目 / 社交画像都会是空的），这是预期行为。
        </p>
      </div>
    </Card>
  );
}
