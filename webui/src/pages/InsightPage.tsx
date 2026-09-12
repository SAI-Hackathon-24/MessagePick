import { Activity, BarChart3, Clock, Flame, Layers, MessageSquareText, Users } from 'lucide-react';
import { api } from '@/api';
import { useAppState } from '@/app/appState';
import { GROUPS } from '@/api/mockData';
import { compactNum, num } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { BarList, Donut, HourBars, Sparkline } from '@/components/charts';
import { CouplingNote, ModuleScaffold } from '@/components/scaffold/ModuleScaffold';
import { Avatar, Card, CardHeader, ErrorState, SectionHeading, Stat } from '@/components/ui';

/**
 * 数据洞察页
 * ---------------------------------------------------------------------------
 * 这一页是「展示单元的试验田」：所有图表组件都在这里以真实数据结构跑一遍，
 * 后续 PRD 要求新增维度时，可以直接从这里挑组件复用（避免重复造轮子）。
 * 数据来源全部对齐 wechat-cli `stats` 的输出结构。
 */
export default function InsightPage() {
  const { chats } = useAppState();
  const overview = useApi(() => api.getOverview(chats), [chats.join(',')]);
  const o = overview.data;
  const scope = chats.length ? GROUPS.filter((g) => chats.includes(g.chat)) : GROUPS;

  if (overview.error) {
    return <ErrorState code={overview.error.code} message={overview.error.message} hint={overview.error.hint} onRetry={overview.refetch} />;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="消息总量" value={compactNum(o?.total_messages ?? 0)} unit="条" icon={MessageSquareText} />
        <Stat label="覆盖群聊" value={scope.filter((g) => g.username.includes('@chatroom')).length} unit="个" hint="不含单聊会话" icon={Layers} tone="amber" />
        <Stat label="群成员合计" value={num(o?.member_count ?? 0)} unit="人" icon={Users} tone="ink" />
        <Stat
          label="日均消息"
          value={o ? num(Math.round(o.total_messages / Math.max(1, Math.round((Date.parse(o.range.end) - Date.parse(o.range.start)) / 86400000)))) : '—'}
          unit="条"
          icon={Activity}
          tone="jade"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="24 小时活跃分布" icon={Clock} subtitle="可直接用于判断「什么时候发通知最可能被看到」" />
          <div className="px-4 py-3.5">{o ? <HourBars hourly={o.hourly} height={130} /> : <div className="mp-skeleton h-32" />}</div>
        </Card>
        <Card>
          <CardHeader title="消息类型分布" icon={BarChart3} subtitle="文本/图片/表情/链接文件… 来自 wechat-cli stats" />
          <div className="px-4 py-3.5">
            {o ? <Donut size={160} data={Object.entries(o.type_breakdown).map(([label, value]) => ({ label, value }))} /> : <div className="mp-skeleton h-40" />}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="发言排行 Top" icon={Users} subtitle="stats.top_senders" />
          <div className="px-4 py-3.5">{o ? <BarList items={o.top_senders.map((s) => ({ label: s.name, value: s.count }))} unit="条" /> : <div className="mp-skeleton h-32" />}</div>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader title="群活跃度对比" icon={Flame} subtitle="按群消息量归一化" />
          <div className="space-y-2.5 px-4 py-3.5">
            {scope
              .filter((g) => g.username.includes('@chatroom'))
              .map((g) => {
                const series = Array.from({ length: 14 }, () => Math.round(Math.random() * g.weight));
                return (
                  <div key={g.chat} className="flex items-center gap-3">
                    <Avatar name={g.chat} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11.5px] font-medium text-ink-700">{g.chat}</div>
                      <div className="mp-meta">{g.subject} · {g.memberCount} 人</div>
                    </div>
                    <Sparkline data={series} width={80} height={24} />
                  </div>
                );
              })}
          </div>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader title="时间轴覆盖率" icon={Activity} subtitle="有消息的天数占比（爬楼成本的直观指标）" />
          <div className="space-y-3 px-4 py-3.5">
            {scope
              .filter((g) => g.username.includes('@chatroom'))
              .slice(0, 6)
              .map((g) => {
                const pct = Math.min(100, Math.round((g.weight / 34) * 100));
                return (
                  <div key={g.chat}>
                    <div className="flex items-center justify-between text-[11.5px]">
                      <span className="truncate text-ink-600">{g.chat}</span>
                      <span className="tabular-nums text-ink-400">{pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-900/[0.06]">
                      <div className="h-full rounded-full bg-gradient-to-r from-jade-400 to-jade-600" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeading title="展示单元清单" hint="本页同时是「组件目录」：PRD 定稿新增维度时，优先从这里复用" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { name: 'Stat 指标卡', desc: '关键数字 + 口径提示' },
            { name: 'Card + CardHeader', desc: '所有内容单元的基础容器' },
            { name: 'Sparkline / TrendArea', desc: '迷你趋势 / 带峰值标注的趋势图' },
            { name: 'DistributionBars', desc: '按时间划分的分布图（梗卡片用）' },
            { name: 'HeatStrip', desc: '时间轴热力条' },
            { name: 'HourBars / Donut', desc: '活跃分布 / 类型占比' },
            { name: 'Radar', desc: '多维度画像雷达' },
            { name: 'BarList', desc: '排行 / 长尾列表' },
          ].map((c) => (
            <div key={c.name} className="mp-card px-3.5 py-3">
              <div className="text-[12.5px] font-semibold text-ink-700">{c.name}</div>
              <div className="mp-meta mt-0.5">{c.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <ModuleScaffold
        title="数据洞察 · 预留看板"
        subtitle="以下能力等 PRD 定稿后接入，图表组件已经就位"
        planned={['群健康度评分', '消息量异常检测（骤增/骤降）', '通知响应率统计', '梗的跨群迁移路径', '导出报告（PDF/图片）']}
      />

      <CouplingNote module="wechat-cli 数据接口" />
    </div>
  );
}
