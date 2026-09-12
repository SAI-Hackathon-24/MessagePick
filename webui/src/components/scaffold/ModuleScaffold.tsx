/**
 * 未定稿模块的占位脚手架
 * ---------------------------------------------------------------------------
 * raw_design.md / PRD 尚未完成，为保证「接口、信息清单可预留、可扩展」：
 * 页面里凡是未来确定要加、但现在没定死的能力，统一用 ModuleScaffold 占位，
 * 明确写出「已预留什么 / 加东西时改哪里」，评审时一眼能看出扩展点在哪。
 */
import { PlugZap, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Card, CardHeader } from '@/components/ui';

export function ModuleScaffold({
  title,
  subtitle,
  planned,
  note,
  className,
}: {
  title: string;
  subtitle?: string;
  planned: string[];
  note?: string;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden border-dashed', className)}>
      <CardHeader title={title} subtitle={subtitle} icon={PlugZap} right={<span className="mp-meta">预留扩展位</span>} />
      <div className="px-4 py-3.5">
        <div className="flex flex-wrap gap-1.5">
          {planned.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-ink-900/15 bg-ink-900/[0.02] px-2.5 py-1 text-[11px] text-ink-500">
              <Plus size={10} />
              {p}
            </span>
          ))}
        </div>
        {note && <p className="mp-meta mt-3 leading-relaxed">{note}</p>}
      </div>
    </Card>
  );
}

/** 接口耦合说明：明确前端与 core / wechat-cli 的边界，避免后续返工 */
export function CouplingNote({ module = 'core', className }: { module?: string; className?: string }) {
  const lines: Record<string, string[]> = {
    'core / LLM 接口': [
      '前端只依赖 src/types.ts 的数据契约，不关心 prompt 如何拼装',
      'core 输出的每条分析结果都带 confidence，低置信度 UI 会弱化展示',
      '新增字段可直接塞进领域的 ext，前端不会因未知字段报错',
    ],
    'wechat-cli 数据接口': [
      'sessions → 群列表与未读数；members → 成员清单',
      'history --media → 原始消息与本地媒体路径（图片/表情/语音）',
      'stats → 活跃度与类型分布（总览页直接复用）',
    ],
  };
  const list = lines[module] ?? lines['core / LLM 接口'];
  return (
    <div className={cn('rounded-2xl border border-sky-500/20 bg-sky-500/[0.05] px-4 py-3', className)}>
      <div className="mp-meta mb-1.5 font-medium text-sky-700">与 {module} 的耦合约定（接口未定稿，先约定边界）</div>
      <ul className="space-y-1">
        {list.map((l) => (
          <li key={l} className="flex gap-2 text-[11.5px] leading-relaxed text-ink-600">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sky-500/60" />
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}
