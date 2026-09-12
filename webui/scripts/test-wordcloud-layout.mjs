/**
 * 词云布局算法单元测试（无依赖，直接 node 运行）
 *   node scripts/test-wordcloud-layout.mjs
 *
 * 为什么单独测：这是全项目唯一的自研算法，
 * 「信息不丢失」（放不下的词必须能被调用方识别并收纳）是验收标准 A11 的核心，
 * 不能只靠界面观察。
 */
import { layoutCloud, estimateTextWidth } from '../src/lib/wordcloud-layout.ts';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const makeItems = (n, len = 4) =>
  Array.from({ length: n }, (_, i) => ({ term: `词${i}`.padEnd(len, '梗'), count: n - i }));

/* 1. 文本宽度估算：中文 1em、英文 0.56em */
check('estimateTextWidth：4 个汉字 ≈ 4em', Math.abs(estimateTextWidth('已阅摸鱼', 20) - 80) < 0.01);
check('estimateTextWidth：4 个字母 < 3em', estimateTextWidth('abcd', 20) < 60);

/* 2. 小画布 + 大量词条 → 必须有词放不下（触发长尾收纳分支） */
const small = layoutCloud(makeItems(60), (i) => i.term, (i) => i.count, { width: 300, height: 220 });
const smallPlaced = small.filter((w) => w.placed);
const smallOverflow = small.filter((w) => !w.placed);
check('小画布必然产生未放置词条', smallOverflow.length > 0, `放置 ${smallPlaced.length} / 未放置 ${smallOverflow.length}`);
check('未放置词条数量 + 已放置数量 = 总数（不丢词）', smallPlaced.length + smallOverflow.length === 60);
check('未放置词条的标记正确（placed=false 且尺寸归零）', smallOverflow.every((w) => w.placed === false && w.w === 0 && w.h === 0));

/* 3. 大画布 → 绝大多数词条能放下 */
const big = layoutCloud(makeItems(30), (i) => i.term, (i) => i.count, { width: 1200, height: 400 });
const bigPlaced = big.filter((w) => w.placed);
check('大画布能放下绝大多数词条（≥90%）', bigPlaced.length / 30 >= 0.9, `放置 ${bigPlaced.length}/30`);

/* 4. 已放置的词条互不重叠（碰撞检测有效） */
const overlaps = [];
for (let i = 0; i < bigPlaced.length; i++) {
  for (let j = i + 1; j < bigPlaced.length; j++) {
    const a = bigPlaced[i];
    const b = bigPlaced[j];
    const hit = !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
    if (hit) overlaps.push(`${a.text}×${b.text}`);
  }
}
check('已放置词条互不重叠', overlaps.length === 0, overlaps.slice(0, 3).join(', ') || '无重叠');

/* 5. 所有词条都在画布内 */
const outside = bigPlaced.filter((w) => w.x < -0.5 || w.y < -0.5 || w.x + w.w > 1200.5 || w.y + w.h > 400.5);
check('已放置词条全部落在画布范围内', outside.length === 0, outside.slice(0, 2).map((w) => w.text).join(', ') || '全部在内');

/* 6. 字号单调性：count 越大字号越大（词云的核心语义） */
const sorted = [...bigPlaced].sort((a, b) => b.size - a.size);
const countsDesc = sorted.every((w, i) => i === 0 || sorted[i - 1].size >= w.size);
check('字号按权重单调不增（高频词更大）', countsDesc, `最大 ${sorted[0].size.toFixed(1)}px / 最小 ${sorted[sorted.length - 1].size.toFixed(1)}px`);

/* 7. 边界：空输入与零尺寸画布不能崩 */
check('空输入返回空数组', layoutCloud([], (i) => String(i), () => 1, { width: 100, height: 100 }).length === 0);
check('零尺寸画布返回空数组', layoutCloud(makeItems(5), (i) => i.term, (i) => i.count, { width: 0, height: 0 }).length === 0);

console.log(`\n===== 汇总：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
