/**
 * 模块三：正向 / 反向社交（MOD-007 的浏览器侧）
 * =============================================================================
 * 核心是一份「人 ↔ 兴趣」的双向索引（REQ-050）：正向 = 人 → 兴趣；反向 = 兴趣 → 人。
 * 覆盖：
 *   · 人物兴趣画像（REQ-061）：二级标签 + 置信度 + 证据可回原文（REQ-053）
 *   · 爱好雷达图（REQ-071）：五轴 = 运动 / 艺术 / 游戏 / 娱乐 / 社交，点轴展开二级词条
 *   · 个人标签词云（REQ-073）：与模块一「梗词云」不同物、不共用名称
 *   · 兴趣 → 人（REQ-060、REQ-064、REQ-065）：按维度 / 按标签两个入口，结果含回复时长与活跃度
 *   · 两人配对（REQ-062）：共同爱好 + 契合度 + 逐维度差值（雷达叠加对比 —— REQ-059）
 *   · 我的社交契合度（REQ-079）：逐人列表 + 整体融入度
 *   · 组局建议（REQ-063）：仅文字建议
 *   · 身份对齐（REQ-082）：候选逐条确认 / 否定，未确认不生效
 *   · 标签增删改（REQ-056）与性格标签确认（REQ-074 ~ REQ-077）
 *   · 人-人关系图谱（REQ-069）与兴趣时间轴 / 事件流（REQ-067，仅可视化，不参与权重 —— REQ-087）
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { HeartHandshake, Link2, Tags, Users } from 'lucide-react';
import { api } from '@/api';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/cn';
import { INTEREST_CATEGORY_LABEL } from '@/types';
import { Badge, Card, CardHeader, NoticeBar, SectionHeading, Stat } from '@/components/ui';
import { PersonProfilePanel } from '@/components/unit/PersonProfilePanel';
import { InterestToPeoplePanel } from '@/components/unit/InterestToPeoplePanel';
import { PairMatchPanel } from '@/components/unit/PairMatchPanel';
import { MyCompatibilityPanel } from '@/components/unit/MyCompatibilityPanel';
import { IdentityAlignmentPanel } from '@/components/unit/IdentityAlignmentPanel';
import { RelationGraphPanel, InterestTimelinePanel } from '@/components/unit/SocialExtraPanels';


export default function SocialPage() {
  const { view } = useParams();
  const navigate = useNavigate();
  /** 左侧导航的子项决定当前展示哪个视图（REQ-050 的两个方向 + 其余产物） */
  const active = (view ?? 'forward') as 'forward' | 'reverse' | 'pair' | 'mine' | 'graph' | 'alignment' | 'timeline';
  /**
   * 选中的人默认取「我」（由数据派生，不硬编码 personId —— 人标识是后端下发的，
   * 硬编码会在标识规则变化时静默失效）。配对默认取「我」与前两位其他人。
   */
  const graph = useApi(() => api.relationGraph(), []);
  const allPeople = graph.data?.nodes ?? [];
  const meId = allPeople.find((n) => n.isMe)?.personId ?? allPeople[0]?.personId ?? '';
  const [personId, setPersonId] = useState('');
  const [pairA, setPairA] = useState('');
  const [pairB, setPairB] = useState('');
  const selectedPerson = personId || meId;
  const selectedA = pairA || meId;
  const selectedB = pairB || allPeople.find((n) => n.personId !== (pairA || meId))?.personId || '';

  const cards = useApi(() => api.interestScoreCards(), []);
  const mine = useApi(() => api.myCompatibility(), []);

  /** 未知成员不进「选择成员」列表（他们按 REQ-081 仍出现在图谱里，但画像无内容） */
  const people = allPeople.filter((n) => !n.unknown);

  return (
    <div className="space-y-5">
      {/* 指标 */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="参与分析的人数" value={people.length} unit="人" hint="跨全部已采集的历史群（REQ-051）" icon={Users} />
        <Stat label="兴趣标签" value={cards.data?.length ?? 0} unit="个" hint="一级固定五类，二级自由标签" icon={Tags} tone="amber" />
        <Stat label="共同爱好连线" value={graph.data?.links.length ?? 0} unit="条" hint="人-人图谱：连线 = 共同爱好" icon={Link2} tone="ink" />
        <Stat label="我的整体融入度" value={mine.data?.integration ?? '—'} unit="分" hint="我 vs 每个群友的契合度均值" icon={HeartHandshake} tone="jade" />
      </section>

      {/* 当前位置与口径说明（切换入口在左侧导航，避免同一组入口出现两处） */}
      <NoticeBar tone="sky" className="leading-relaxed">
        正向社交 = 人 → 兴趣（他喜欢什么）；反向社交 = 兴趣 → 人（找搭子）。两者是**同一份「人 ↔ 兴趣」数据的两个查询方向**（REQ-050）。
        分析对象是整个群的社交生态，匹配范围为跨全部已采集的历史群（REQ-051）。
      </NoticeBar>

      {active === 'mine' && <MyCompatibilityPanel />}
      {active === 'graph' && <RelationGraphPanel />}
      {active === 'timeline' && <InterestTimelinePanel />}
      {active === 'alignment' && <IdentityAlignmentPanel />}

      {active === 'forward' ? (
        /* ---------------- 正向：人 → 兴趣（人物兴趣画像） ---------------- */
        <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="选择成员" icon={Users} subtitle="点击查看其兴趣画像" />
            <ul className="max-h-[520px] overflow-y-auto px-2 py-2">
              {people.map((p) => (
                <li key={p.personId}>
                  <button
                    type="button"
                    data-person={p.personId}
                    onClick={() => setPersonId(p.personId)}
                    className={cn('flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-jade-500/[0.06]', selectedPerson === p.personId && 'bg-jade-500/[0.08] ring-1 ring-jade-500/20')}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-jade-500/12 text-xs font-semibold text-jade-700">{p.name.slice(0, 1)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink-700">{p.name}</span>
                      <span className="mp-meta">活跃度 {p.activity}</span>
                    </span>
                    {p.isMe && <Badge tone="jade">我</Badge>}
                  </button>
                </li>
              ))}
              {!people.length && <li className="mp-meta px-3 py-3">尚未采集到成员数据</li>}
            </ul>
          </Card>
          <PersonProfilePanel personId={selectedPerson} />
        </section>
      ) : active === 'reverse' ? (
        /* ---------------- 反向：兴趣 → 人（找搭子） ---------------- */
        <InterestToPeoplePanel />
      ) : null}

      {/* 两人配对（REQ-062） */}
      {active === 'pair' && (
      <Card>
        <CardHeader title="两人配对" icon={HeartHandshake} subtitle="共同爱好 + 契合度 + 逐维度差值（雷达叠加对比）" />
        <div className="space-y-3 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <PersonSelect label="A" value={selectedA} onChange={setPairA} options={people} />
            <span className="text-ink-300">×</span>
            <PersonSelect label="B" value={selectedB} onChange={setPairB} options={people} />
          </div>
          <PairMatchPanel aId={selectedA} bId={selectedB} />
        </div>
      </Card>
      )}

      {/* 评分卡（REQ-068、REQ-078）：只在按兴趣找人时展示，避免所有视图都堆满信息 */}
      {(active === 'reverse' || active === 'pair') && (
      <section>
        <SectionHeading title="兴趣评分卡" hint="兴趣热度分 = 该爱好下的人的活跃 / 投入程度；兴趣置信度 = 某人在这项爱好上有多可信" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(cards.data ?? []).slice(0, 9).map((c) => (
            <Card key={c.tagId} className="p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-800">{c.name}</span>
                <Badge tone="neutral">{INTEREST_CATEGORY_LABEL[c.category]}</Badge>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="mp-meta w-14 shrink-0">热度 {c.heat}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-900/[0.06]">
                  <span className="block h-full rounded-full bg-gradient-to-r from-jade-400 to-jade-600" style={{ width: `${Math.min(100, c.heat * 8)}%` }} />
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {c.perPerson.slice(0, 5).map((p) => (
                  <button key={p.personId} type="button" onClick={() => { setPersonId(p.personId); navigate('/social/forward'); }} className="mp-chip !py-0.5 !text-[11px]" title={`置信度 ${p.confidence}`}>
                    {p.name}
                  </button>
                ))}
                <span className="mp-meta self-center">{c.peopleCount} 人</span>
              </div>
            </Card>
          ))}
        </div>
      </section>
      )}

      {/* 边界声明 */}
      <NoticeBar tone="sky" className="leading-relaxed">
        本模块只做使用者主动查询，不做自动监测推送（REQ-083）；AI 只分析与给建议，不替你发消息、不替你拉群（REQ-084）；
        推断结果不外露给群成员（REQ-085）；不做时效衰减（REQ-086）；时间轴 / 事件流仅用于回放兴衰，不参与权重计算（REQ-087）。
      </NoticeBar>
    </div>
  );
}

function PersonSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { personId: string; name: string }[] }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-600">
      <span className="mp-meta">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-ink-900/[0.1] bg-white px-2 py-1 text-xs outline-none focus:border-jade-500/50">
        {options.map((o) => (
          <option key={o.personId} value={o.personId}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
