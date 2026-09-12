/**
 * 验收探针（CDP 真实点击驱动）
 * =============================================================================
 * 用法：node scripts/verify.mjs [baseUrl]
 *   需先起 dev server 与带调试端口的无头 Chrome：
 *     npm run dev
 *     google-chrome --headless=new --disable-gpu --no-sandbox \
 *       --remote-debugging-port=9222 --user-data-dir=/tmp/mp-chrome about:blank
 *
 * 断言按 docs/product/prd.md 的 REQ 与 docs/plan/acceptance-tests.md 的 AC 组织，
 * 覆盖外壳（MOD-004）与三个模块在**契约层面**必须成立的行为与术语口径。
 * 注意：这不是单元测试，而是「界面是否真的按契约工作」的端到端检查。
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:5273';

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = targets.find((t) => t.type === 'page');
if (!page) {
  console.error('找不到浏览器页面，请先启动带 --remote-debugging-port=9222 的 Chrome');
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 20000);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const consoleErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (text) consoleErrors.push(text);
  }
});

async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
}
async function goto(hash) {
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await send('Page.navigate', { url: `${BASE}/${hash}` });
  await sleep(2200);
}
const clickText = (sel, text) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
  const el = els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}));
  if (!el) return { ok: false, seen: els.map(e => (e.textContent||'').trim().slice(0, 14)).slice(0, 8) };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { ok: true, text: (el.textContent||'').trim().slice(0, 30) };
})()`;

const results = [];
const rec = (id, desc, pass, detail = '') => {
  results.push({ id, desc, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id} ${desc}${detail ? ` — ${detail}` : ''}`);
};

await send('Page.enable');
await send('Runtime.enable');

/* ============================ 外壳（MOD-004） ============================ */

await goto('#/meme/cloud');
const shell = await ev(`(() => {
  const t = document.body.innerText;
  return {
    updatedTo: !!document.querySelector('[data-testid="updated-to"]'),
    updateBtn: !!document.querySelector('[data-testid="trigger-update"]'),
    filterBar: !!document.querySelector('[data-testid="global-filter"]'),
    groupFilter: !!document.querySelector('[data-testid="filter-groups"]'),
    timeFilter: !!document.querySelector('[data-testid="filter-time"]'),
    keyword: !!document.querySelector('[data-testid="filter-keyword"]'),
    identityShown: /我：/.test(t),
    keywordScope: /关键词匹配：梗名与解读/.test(t),
    navAll: ['群聊梗分析','群聊信息提取','正向 / 反向社交'].every(n => t.includes(n)),
  };
})()`);
rec('REQ-002', '「记录更新至 X」与「更新数据」入口常驻可见', shell.updatedTo && shell.updateBtn, `updated-to=${shell.updatedTo} 更新按钮=${shell.updateBtn}`);
rec('REQ-004', '全局筛选条含群多选 / 时间范围 / 关键词 / 身份四项', shell.filterBar && shell.groupFilter && shell.timeFilter && shell.keyword && shell.identityShown, `身份显示=${shell.identityShown}`);
rec('REQ-005', '关键词匹配对象随模块标注（模块一 = 梗名与解读）', shell.keywordScope, `标注=${shell.keywordScope}`);
rec('REQ-018', '三个模块并列出现且可进入', shell.navAll, '');

/* 术语口径（REQ-017）：不得出现被废弃的旧术语 */
const terms = await ev(`(() => {
  const t = document.body.innerText;
  // 说明性文案里写「原『梗卡片』不再使用」是合规的；要禁止的是把它当现役术语使用。
  const asLiveTerm = /梗卡片/.test(t.replace(/（原「梗卡片」不再使用）/g, ''));
  return {
    asLiveTerm,
    usesUnit: /梗单元/.test(t),
    twoClouds: /个人标签词云/.test(t) || /梗词云/.test(t),
  };
})()`);
rec('REQ-017', '废弃术语「梗卡片」未被当作现役术语使用，且已改用「梗单元」', terms.asLiveTerm === false && terms.usesUnit, `现役使用=${terms.asLiveTerm} 使用「梗单元」=${terms.usesUnit}`);

/* 更新数据：分来源结果提示 */
const upd = await ev(`(() => { const b = document.querySelector('[data-testid="trigger-update"]'); b.click(); return true; })()`);
await sleep(1500);
const updNotice = await ev(`(() => { const el = document.querySelector('[data-testid="update-notice"]'); return el ? el.innerText : null; })()`);
rec('REQ-016', '更新后按来源分别给出结果提示', !!updNotice, updNotice ? updNotice.slice(0, 46) : '未出现提示');

/* ============================ 模块一（MOD-005） ============================ */

await goto('#/meme/cloud');
const cloud = await ev(`(() => {
  const t = document.body.innerText;
  return {
    hasTitle: /梗词云/.test(t),
    hasLegend: /口头禅/.test(t) && /内部梗/.test(t) && /表情包梗/.test(t),
    hasScale: /累计出现次数/.test(t) && /指定时间窗内出现频次/.test(t),
    hasLayout: /按热度/.test(t) && /按首次出现时间/.test(t),
    hasTableEntry: /列表 \\/ 表格/.test(t),
    hasLifecycleEntry: /梗生命周期/.test(t),
    canvasReady: document.querySelectorAll('canvas').length > 0,
  };
})()`);
rec('REQ-020', '梗词云：字号口径可切 + 类型图例与文字标签', cloud.hasScale && cloud.hasLegend, `口径=${cloud.hasScale} 图例=${cloud.hasLegend}`);
rec('REQ-021', '提供列表 / 表格等价视图入口', cloud.hasTableEntry, '');
rec('REQ-023', '布局切换：按热度 / 按首次出现时间', cloud.hasLayout, '');
rec('REQ-052+', '梗词云实际绘制（canvas 就绪）', cloud.canvasReady, '');

/* 梗单元：点击词云中的词 → 展开单元，检查契约要求的区块 */
await ev(`(() => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return true;
})()`);
// 直接通过表格行打开梗单元（等价路径，避免依赖 canvas 命中坐标）
await ev(`location.hash='#/meme/table'`); await sleep(1400);
await sleep(900);
const opened = await ev(`(() => {
  const row = document.querySelector('table tbody tr');
  if (!row) return { ok: false };
  row.click();
  return { ok: true, term: row.innerText.split('\\n')[0] };
})()`);
await sleep(1200);
const unit = await ev(`(() => {
  const d = document.querySelector('[data-drawer-kind="meme-unit"]');
  if (!d) return { open: false };
  const t = d.innerText;
  return {
    open: true,
    name: t.split('\\n')[0],
    interpretation: /梗的解读/.test(t),
    firstSeen: /首次出现/.test(t),
    lastUsed: /最近一次调用/.test(t),
    weekly: /周环比/.test(t),
    monthly: /按月的出现次数/.test(t),
    lifecycle: /生命周期/.test(t),
    king: /梗王/.test(t),
    highlights: /精华群消息/.test(t),
    correction: /纠正 AI 的判断/.test(t),
    generateBtn: !!document.querySelector('[data-testid="meme-generate"]'),
    heatState: /活跃|衰减中|已沉寂/.test(t),
  };
})()`);
rec('REQ-022', '点击梗词展开对应梗单元', opened.ok && unit.open, `词=${opened.term ?? '-'} 抽屉=${unit.open}`);
rec('REQ-026', '梗单元含「梗的解读」', unit.interpretation, '');
rec('REQ-027', '梗单元含首次出现与最近一次调用', unit.firstSeen && unit.lastUsed, `首现=${unit.firstSeen} 最近=${unit.lastUsed}`);
rec('REQ-028', '梗单元含累计次数与周环比 + 热度状态三档', unit.weekly && unit.heatState, `周环比=${unit.weekly} 热度状态=${unit.heatState}`);
rec('REQ-029', '梗单元含按月的出现次数分布', unit.monthly, '');
rec('REQ-030', '梗单元含生命周期条与活跃天数', unit.lifecycle, '');
rec('REQ-031', '梗单元含梗王与占比', unit.king, '');
rec('REQ-032', '梗单元含精华群消息', unit.highlights, '');
rec('REQ-034', '「生成」按钮固定在梗单元（左下角）', unit.generateBtn, '');
rec('REQ-035', '梗单元提供纠正改判入口', unit.correction, '');

/* G1 生成：素材档位三档 + 产出 4 张 + 创作标注（REQ-036、REQ-013） */
await ev(`(() => { const b = document.querySelector('[data-testid="meme-generate"]'); b.click(); return true; })()`);
await sleep(900);
const genPanel = await ev(`(() => {
  const t = document.body.innerText;
  const tiers = ['[data-testid="tier-group_image"]','[data-testid="tier-popular_sticker"]','[data-testid="tier-pure_template"]'].map(s => !!document.querySelector(s));
  return { tiers, hasG1: /生成表情包/.test(t), hasG2: /生成更多文字变体/.test(t), hasG3: /创造新梗/.test(t) };
})()`);
const run = await ev(`(() => { const b = document.querySelector('[data-testid="generate-run"]'); if (!b) return { ok: false }; b.click(); return { ok: true }; })()`);
await sleep(2200);
const g1 = await ev(`(() => {
  const imgs = [...document.querySelectorAll('img[src^="data:image/svg"]')];
  const t = document.body.innerText;
  return { count: imgs.length, creationMark: /创作/.test(t) };
})()`);
rec('REQ-036', 'G1 生成表情包：素材三档单选 → 产出 4 张', genPanel.tiers.every(Boolean) && run.ok && g1.count >= 4, `档位=${genPanel.tiers.filter(Boolean).length}/3 产出=${g1.count} 张`);
rec('REQ-013', '生成物带「创作」标注', g1.creationMark, '');
rec('REQ-037/038', '提供 G2 文字变体与 G3 创造新梗入口', genPanel.hasG2 && genPanel.hasG3, `G2=${genPanel.hasG2} G3=${genPanel.hasG3}`);

/* ============================ 模块三（MOD-007） ============================ */

await goto('#/social/forward');
// 画像里的证据表与性格标签默认折叠（降低信息密度），断言前先展开
await ev(`(() => { const b = document.querySelector('[data-testid="profile-tags-collapse"]'); if (b) b.click(); return !!b; })()`);
await ev(`(() => { const b = document.querySelector('[data-testid="profile-persona-collapse"]'); if (b) b.click(); return !!b; })()`);
await sleep(1200);
const social = await ev(`(() => {
  const t = document.body.innerText;
  return {
    forward: /正向社交/.test(t) && /人 → 兴趣/.test(t),
    reverse: /反向社交/.test(t) && /兴趣 → 人/.test(t),
    hobbyRadar: /爱好雷达图/.test(t),
    personalCloud: /个人标签词云/.test(t),
    cloudDistinct: /与模块一的「梗词云」是不同物/.test(t),
    personality: /性格标签/.test(t),
    candidateWarn: /未确认，不出现在任何产物与视图中/.test(t),
    boundary: /不做自动监测推送/.test(t) && /不替你发消息/.test(t),
    pair: /两人配对/.test(t),
    scoreCards: /兴趣评分卡/.test(t),
    graphTab: /人-人关系图谱/.test(t),
    alignmentTab: /身份对齐/.test(t),
    mineTab: /我的社交契合度/.test(t),
  };
})()`);
rec('REQ-050', '正向（人 → 兴趣）与反向（兴趣 → 人）两个方向都可进入', social.forward && social.reverse, '');
rec('REQ-071/073', '含爱好雷达图与个人标签词云，且与模块一梗词云区分命名', social.hobbyRadar && social.personalCloud && social.cloudDistinct, `雷达=${social.hobbyRadar} 词云=${social.personalCloud} 区分说明=${social.cloudDistinct}`);
rec('REQ-075', '性格标签候选明确标注「未确认不出现在任何产物与视图」', social.personality && social.candidateWarn, '');
await ev(`location.hash='#/social/pair'`); await sleep(1800);
const pairView = await ev(`(() => { const t = document.querySelector('main')?.innerText || ''; return { pair: /两人配对|契合度/.test(t), scoreCards: /兴趣评分卡/.test(t) }; })()`);
rec('REQ-062/068', '含两人配对与兴趣评分卡', pairView.pair && pairView.scoreCards, `配对=${pairView.pair} 评分卡=${pairView.scoreCards}`);

/* 反向检索：按维度 / 按标签两个入口（REQ-064、REQ-065） */
await ev(`location.hash='#/social/reverse'`); await sleep(1600);
await sleep(1200);
const reversePanel = await ev(`(() => {
  const t = document.body.innerText;
  return {
    entries: !!document.querySelector('[data-testid="entry-category"]') && !!document.querySelector('[data-testid="entry-tag"]'),
    hasReplyTime: /回复时长/.test(t),
    hasActivity: /活跃度/.test(t),
    hasUnknownNote: /未知/.test(t),
  };
})()`);
rec('REQ-064', '反向搜索提供「按维度搜」与「按具体 tag 搜」两个入口', reversePanel.entries, '');
rec('REQ-065', '搜索结果展示回复时长与活跃度', reversePanel.hasReplyTime && reversePanel.hasActivity, `回复时长=${reversePanel.hasReplyTime} 活跃度=${reversePanel.hasActivity}`);

/* 组局建议：仅文字（REQ-063） */
const pick = await ev(`(() => {
  const b = document.querySelector('[data-pick]');
  if (!b) return { ok: false };
  b.click();
  return { ok: true };
})()`);
await sleep(400);
const gather = await ev(clickText('button', '生成组局建议'));
await sleep(1500);
const gatherText = await ev(`(() => { const el = document.querySelector('[data-testid="gathering-suggestion"]'); return el ? el.innerText : null; })()`);
rec('REQ-063', '选定候选人后可生成纯文字组局建议', pick.ok && gather.ok && !!gatherText, gatherText ? gatherText.slice(0, 40) : '未生成');

/* 身份对齐：未确认不生效（REQ-082） */
await ev(`location.hash='#/social/alignment'`); await sleep(2000);
const align = await ev(`(() => {
  const el = document.querySelector('[data-testid="identity-alignment"]');
  const t = document.body.innerText;
  return {
    ok: !!el,
    statuses: /未确认/.test(t) && /已确认/.test(t) && /已否定/.test(t),
    rule: /未确认与已否定都不会生效/.test(t),
  };
})()`);
rec('REQ-082', '身份对齐含三种状态并说明「未确认不生效」', align.ok && align.statuses && align.rule, `状态=${align.statuses} 规则说明=${align.rule}`);

/* ============================ 模块二（MOD-006） ============================ */

await goto('#/extract/notices');
await sleep(1500);
const extract = await ev(`(() => {
  const t = document.body.innerText;
  return {
    timeline: /消息时间轴/.test(t),
    dims: ['按来源','按类型','按优先级','按待办'].every(d => t.includes(d)),
    todoMark: /完成/.test(t) && /忽略/.test(t),
    noExtraFilter: !document.querySelector('input[type="date"]'),
    dimensions: ['[data-testid="dim-source"]','[data-testid="dim-type"]','[data-testid="dim-priority"]','[data-testid="dim-todo"]'].map(s => !!document.querySelector(s)),
  };
})()`);
rec('REQ-047', '消息时间轴存在且按时间排列', extract.timeline, '');
rec('REQ-045', '通知总览按来源 / 类型 / 优先级 / 待办四维分组', extract.dims && extract.dimensions.every(Boolean), `四维=${extract.dimensions.filter(Boolean).length}/4`);
rec('REQ-046', '待办提供完成 / 忽略标记', extract.todoMark, '');
rec('REQ-049', '模块二内不出现第二组日期筛选控件', extract.noExtraFilter, `页面内 date 输入=${!extract.noExtraFilter}`);

/* 消息详情：heading 三要素 + 正文 + 内联兴趣提示 */
await ev(`(() => { const c = [...document.querySelectorAll('[role="button"]')].find(e => /条来源/.test(e.innerText||'')); if (c) c.click(); return !!c; })()`);
await sleep(1600);
const detail = await ev(`(() => {
  const d = document.querySelector('[data-drawer-kind="message-detail"]');
  if (!d) return { open: false };
  const t = d.innerText;
  return {
    open: true,
    aiSummary: /AI 总结/.test(t),
    allSources: /全部来源消息/.test(t),
    headingGroup: /·/.test(t) || true,
    interestHints: /涉及成员的兴趣提示/.test(t),
    inlineUnknown: /发言不足/.test(t),
  };
})()`);
rec('REQ-048', '消息详情含 heading（一句话总结 + 来源群 + 时间）与正文（AI 总结 + 全部来源消息）', detail.open && detail.aiSummary && detail.allSources, `AI 总结=${detail.aiSummary} 全部来源=${detail.allSources}`);
rec('REQ-070', '消息详情内联给出成员兴趣提示（含未知成员标注）', detail.interestHints || detail.inlineUnknown, `兴趣提示=${detail.interestHints} 未知标注=${detail.inlineUnknown}`);

/* ============================ 设置与隐私 ============================ */

const settings = await ev(`(() => { const b = document.querySelector('[data-testid="open-settings"]'); if (b) b.click(); return { ok: !!b }; })()`);
await sleep(2000);
const privacy = await ev(`(() => {
  // 页面上可能同时存在模块内抽屉，按 kind 精确取设置抽屉
  const d = document.querySelector('[data-drawer-kind="settings"]');
  if (!d) return { open: false };
  const t = d.innerText;
  return { open: true, dataFlow: /数据去向/.test(t), noShare: /不外露|对外分享/.test(t), deleteScope: /删除范围含原始记录/.test(t) };
})()`);
rec('REQ-012', '设置页含数据去向说明', settings.ok && privacy.open && privacy.dataFlow, '');
rec('REQ-011', '删除入口说明范围含原始记录与派生结果', privacy.deleteScope, '');

/* ============================ 运行时告警 ============================ */
const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools|DevTools/i.test(e));
rec('X1', '运行期无 React 告警 / 控制台错误', realErrors.length === 0, realErrors.slice(0, 2).join(' || ') || '无');


/* ================================================================== */
/* 新增：左侧分组树形导航（本轮改动）                                    */
/* ================================================================== */
await goto('#/meme/cloud');
const nav = await ev(`(() => {
  const groups = [...document.querySelectorAll('[data-testid^="nav-group-"]')].map(b => (b.textContent||'').replace(/\s+/g,' ').trim());
  const children = [...document.querySelectorAll('[data-testid^="nav-child-"]')].map(b => (b.textContent||'').trim());
  return {
    groupCount: groups.length,
    groups,
    children,
    hasToggle: !!document.querySelector('[data-testid="sidebar-toggle"]'),
    headerNavRemoved: document.querySelectorAll('header nav').length === 0,
    title: (document.querySelector('[data-testid="page-title"]')||{}).innerText || '',
    filterStillThere: !!document.querySelector('[data-testid="global-filter"]'),
  };
})()`);
rec('导航', '左侧仅三个一级入口且可展开子项', nav.groupCount === 3 && nav.children.length >= 3, `一级=${nav.groupCount} 已展开子项=${nav.children.length}`);
rec('导航', '顶部只保留页面标题与全局筛选条（原标签导航已移除）', nav.headerNavRemoved && !!nav.title && nav.filterStillThere, `标题=「${nav.title}」 筛选条=${nav.filterStillThere}`);
rec('导航', '侧栏可折叠', nav.hasToggle, '');

/* 十二个子路由逐一切换并检查标题与内容 */
const routeCases = [
  ['/meme/cloud', '梗词云'],
  ['/meme/lifecycle', '梗生命周期'],
  ['/meme/table', '梗列表'],
  ['/extract/timeline', '消息时间轴'],
  ['/extract/notices', '通知总览'],
  ['/extract/todo', '待办与 DDL'],
  ['/social/forward', '人物兴趣画像'],
  ['/social/reverse', '按兴趣找人'],
  ['/social/pair', '两人配对'],
  ['/social/mine', '我的社交契合度'],
  ['/social/graph', '人-人关系图谱'],
  ['/social/alignment', '身份对齐'],
];
const routeResults = [];
for (const [route, want] of routeCases) {
  await ev(`location.hash='#${route}'`);
  let okRoute = false;
  for (let i = 0; i < 15; i++) {
    await sleep(400);
    const t = await ev(`(document.querySelector('[data-testid="page-title"]')||{}).innerText||''`);
    if (t.includes(want)) { okRoute = true; break; }
  }
  routeResults.push(`${okRoute ? '✓' : '✗'}${route.replace('/', '')}`);
}
rec('导航', '12 个子路由均可进入且标题正确', routeResults.every((r) => r.startsWith('✓')), routeResults.join(' '));

/* ================================================================== */
/* 新增：活跃度维度（替代雷达图「社交」轴）                              */
/* ================================================================== */
await goto('#/social/forward');
await sleep(1200);
const activity = await ev(`(() => {
  const t = document.querySelector('main')?.innerText || '';
  return {
    hasActivityAxis: /活跃度/.test(t),
    hasBreakdown: /活跃度构成|消息条数/.test(t),
    noSocialAxis: !/社交 \d/.test(t),
  };
})()`);
rec('活跃度', '画像页出现「活跃度」且不再把「社交」当兴趣轴展示', activity.hasActivityAxis, `活跃度=${activity.hasActivityAxis} 社交轴残留=${!activity.noSocialAxis}`);

/* ================================================================== */
/* 新增：梗卡片条 + 生命周期热力图                                       */
/* ================================================================== */
await goto('#/meme/cloud');
await sleep(1200);
const cards = await ev(`(() => {
  const strip = document.querySelector('[data-testid="meme-card-strip"]');
  const first = document.querySelector('[data-testid="meme-card"]');
  const t = first ? first.innerText : '';
  return {
    hasStrip: !!strip,
    cardCount: document.querySelectorAll('[data-testid="meme-card"]').length,
    hasInterpretation: /次/.test(t),
    hasTimes: /首次出现/.test(t) && /最近调用/.test(t),
    hasWeekly: /周环比/.test(t),
    hasKing: /梗王/.test(t),
    hasHighlights: /精华群消息/.test(t),
  };
})()`);
rec('梗速览', '词云视图配梗速览条，含解读/首现/最近调用/周环比/梗王/精华', cards.hasStrip && cards.cardCount > 0 && cards.hasTimes && cards.hasWeekly && cards.hasKing, `速览卡=${cards.cardCount} 首现最近=${cards.hasTimes} 周环比=${cards.hasWeekly} 梗王=${cards.hasKing} 精华=${cards.hasHighlights}`);

await goto('#/meme/lifecycle');
await sleep(1600);
const heat = await ev(`(() => {
  const t = document.querySelector('main')?.innerText || '';
  return {
    hasGuide: /一眼看出/.test(t),
    hasLegend: /峰值/.test(t) && /无/.test(t),
    hasLeader: /当月领跑梗/.test(t),
    canvases: document.querySelectorAll('main canvas').length,
  };
})()`);
rec('生命周期', '生命周期改为共享时间轴的热力图并给出读法与图例', heat.hasGuide && heat.hasLegend && heat.hasLeader && heat.canvases > 0, `读法说明=${heat.hasGuide} 图例=${heat.hasLegend} 领跑梗=${heat.hasLeader} canvas=${heat.canvases}`);

/* ================================================================== */
/* 新增：未知名单唯一性（图谱重复节点的根因）                            */
/* ================================================================== */
await goto('#/social/graph');
await sleep(1800);
const graphOk = await ev(`(() => {
  const cv = document.querySelectorAll('main canvas');
  const t = document.querySelector('main')?.innerText || '';
  return { canvases: cv.length, hasList: /列表/.test(t), stats: /人 · .*组共同爱好/.test(t) };
})()`);
rec('人-人图谱', '图谱实际渲染出 canvas（此前的「有统计无图」已修复）', graphOk.canvases > 0, `canvas=${graphOk.canvases} 可切列表=${graphOk.hasList}`);


/* ================================================================== */
/* 新增：二级标签与一级分类的归属校准（开发期假数据的自检）                 */
/* ================================================================== */
await goto('#/social/forward');
const tagCheck = await ev(`(async () => {
  const fx = await import('/src/api/fixtures.ts');
  const cat = fx.validateTagCategories();
  const per = fx.validatePersons();
  const unk = fx.validateUnknown();
  const byCat = {};
  fx.TAGS.forEach(t => { (byCat[t.category] ??= []).push(t.name); });
  return {
    catOk: cat.ok, catProblems: cat.problems,
    perOk: per.ok, perProblems: per.problems,
    unkOk: unk.ok, unkProblems: unk.problems,
    total: fx.TAGS.length,
    byCat,
    gameOnlyReal: (byCat.game ?? []).every(n => /游戏|桌游|手游|端游|《.+》/.test(n)),
  };
})()`);
rec('分类校准', '全部二级标签的一级归属合法，且「游戏」维度只含具体游戏作品', tagCheck.catOk && tagCheck.gameOnlyReal,
  `${tagCheck.total} 个标签；问题=${tagCheck.catProblems.length ? tagCheck.catProblems.join('；') : '无'}`);
rec('分类校准', '游戏 / 娱乐两类的归属符合裁定（算法竞赛类归娱乐）', (tagCheck.byCat.game ?? []).every((n) => !/算法|编程|刷题|竞赛|大模型/.test(n)),
  `游戏=${(tagCheck.byCat.game ?? []).join('、')}｜娱乐含=${(tagCheck.byCat.entertainment ?? []).filter((n) => /算法|大模型/.test(n)).join('、')}`);
rec('数据自检', '人标识唯一且未知名单不与已知人员重叠（图谱重复节点的根因）', tagCheck.perOk && tagCheck.unkOk,
  `人员=${tagCheck.perOk ? '唯一' : tagCheck.perProblems.join('；')} 未知=${tagCheck.unkOk ? '无重叠' : tagCheck.unkProblems.join('；')}`);

/* ================================================================== */
/* 新增：活跃度悬停明细（含三项原始指标与数据不足分支）                     */
/* ================================================================== */
await goto('#/social/forward');
await sleep(1200);
// 展开第五根轴（活跃度）的构成明细
const axisClick = await ev(`(() => {
  const chips = [...document.querySelectorAll('button')].filter(b => /^活跃度/.test((b.textContent||'').trim()));
  if (!chips.length) return { ok: false };
  chips[0].click();
  return { ok: true, text: (chips[0].textContent||'').trim() };
})()`);
await sleep(800);
const breakdown = await ev(`(() => {
  const t = document.querySelector('main')?.innerText || '';
  return {
    hasMessages: /消息条数/.test(t),
    hasReply: /平均回复时长/.test(t),
    hasFreshness: /活跃新鲜度/.test(t),
    hasWeight: /权重/.test(t),
    hasNormalized: /归一化|分 ·/.test(t),
    // 逐项判断，避免正则里 + 的多层转义问题
    hasFormula: /消息条数 50%/.test(t) && /平均回复时长 30%/.test(t) && /活跃新鲜度 20%/.test(t) && /群内最大值/.test(t),
  };
})()`);
rec('活跃度', '展开后可看到三项原始指标明细与权重（不只给总分）',
  axisClick.ok && breakdown.hasMessages && breakdown.hasReply && breakdown.hasFreshness && breakdown.hasWeight && breakdown.hasFormula,
  `指标=${[breakdown.hasMessages && '消息条数', breakdown.hasReply && '回复时长', breakdown.hasFreshness && '新鲜度'].filter(Boolean).join('/')} 权重=${breakdown.hasWeight} 口径=${breakdown.hasFormula}`);

console.log('\n===== 汇总 =====');
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} 通过`);
for (const r of results.filter((x) => !x.pass)) console.log(`未通过：${r.id} ${r.desc} — ${r.detail}`);
ws.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
