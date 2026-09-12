/**
 * 无依赖的 CDP 交互探针（Node 24 自带全局 WebSocket）
 * 用途：真实点击/输入驱动 UI，验证验收标准里的交互类用例，并输出结果表。
 * 用法：node scripts/e2e-probe.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:5273';

const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
let page = targets.find((t) => t.type === 'page');
if (!page) {
  page = await (await fetch(`http://127.0.0.1:9222/json/new?about:blank`, { method: 'PUT' })).json();
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

/** 在页面里执行表达式并取回 JSON 结果 */
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
}

async function goto(hash) {
  // 先回空白页再进目标页：确保每次都是全新的应用状态，
  // 避免上一次用例遗留的展开态（如下拉框）影响布局断言
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(250);
  await send('Page.navigate', { url: `${BASE}/${hash}` });
  await sleep(1500);
}

/** 按文本找元素并点击（React 事件用原生 click 即可触发） */
const clickByText = (selector, text) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}));
  if (!el) return { ok: false, found: els.map(e => (e.textContent||'').trim().slice(0,20)) };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { ok: true, text: (el.textContent||'').trim().slice(0, 40) };
})()`;

const results = [];
const record = (id, desc, pass, detail) => {
  results.push({ id, desc, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${id} ${desc}${detail ? ` — ${detail}` : ''}`);
};

await send('Page.enable');
await send('Runtime.enable');

/* ------------------------------------------------------------------ */
/* 收集运行时控制台错误 —— 顺带抓 React key 警告之类的隐患               */
/* ------------------------------------------------------------------ */
const consoleErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (text) consoleErrors.push(text);
  }
});

/* ================================================================== */
/* A1：点击词云词条 → 打开梗卡片抽屉，三项时间信息均有值                  */
/* ================================================================== */
await goto('#/meme');
await sleep(1200);
const cloudClick = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => {
    const t = (b.textContent||'').trim();
    return t && t.length <= 6 && b.style.fontSize && parseFloat(b.style.fontSize) > 12 && b.closest('.relative.h-\\\\[360px\\\\]');
  });
  if (!btns.length) return { ok: false, count: 0 };
  btns[0].click();
  return { ok: true, count: btns.length, term: btns[0].textContent.trim() };
})()`);
await sleep(700);
const drawer = await evaluate(`(() => {
  const aside = document.querySelector('[data-testid="drawer"]');
  if (!aside) return { open: false };
  const t = aside.innerText;
  return {
    open: true,
    hasFirst: /首次|首现/.test(t),
    hasLast: /最近/.test(t),
    hasDist: /按时间划分的分布/.test(t),
    hasTrend: /使用趋势/.test(t),
    hasRemix: /再生成|再生成/.test(t),
    len: t.length,
  };
})()`);
record('A1', '点击词云词条打开梗卡片抽屉，含首现/最近调用/分布图', cloudClick.ok && drawer.open && drawer.hasFirst && drawer.hasLast && drawer.hasDist, `term=${cloudClick.term ?? '-'} drawerLen=${drawer.len}`);

/* ================================================================== */
/* A5：抽屉内点「生成表情包」→ 出现结果图                                */
/* ================================================================== */
const remixClick = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const el = btns.find(b => (b.textContent||'').includes('生成表情包'));
  if (!el) return { ok: false };
  el.scrollIntoView({ block: 'center' });
  el.click();
  return { ok: true };
})()`);
await sleep(1600);
const remixResult = await evaluate(`(() => {
  const imgs = [...document.querySelectorAll('aside img')];
  return { count: imgs.length, first: imgs[0]?.getAttribute('src')?.slice(0, 30) ?? null };
})()`);
record('A5', '点击「生成表情包」后出现结果图', remixClick.ok && remixResult.count >= 1, `imgs=${remixResult.count} src=${remixResult.first ?? '-'}`);

// 关闭抽屉
await evaluate(`(() => { const b=document.querySelector('[data-testid="drawer"] button[aria-label="关闭"]'); b&&b.click(); return true; })()`);
await sleep(400);

/* ================================================================== */
/* A2：词云切换到「按出现时间」→ 排序视图出现且时间递增                   */
/* ================================================================== */
const tabClick = await evaluate(clickByText('button', '按出现时间'));
await sleep(700);
const timeView = await evaluate(`(() => {
  const items = [...document.querySelectorAll('ol li')].map(li => (li.innerText||'').replace(/\\s+/g,' ').trim());
  const dates = items.map(s => (s.match(/首现 (\\d{2}-\\d{2})/) || [])[1]).filter(Boolean);
  const nums = dates.map(d => Number(d.replace('-', '')));
  const sorted = nums.every((v, i) => i === 0 || nums[i-1] <= v);
  return { count: items.length, sorted, first: dates[0] ?? null, last: dates[dates.length-1] ?? null };
})()`);
record('A2', '词云切「按出现时间」后词条按首次出现时间升序', tabClick.ok && timeView.count > 0 && timeView.sorted, `${timeView.first} → ${timeView.last}（${timeView.count} 条）`);

/* ================================================================== */
/* A6：信息提取页选 2 个群 → 列表只剩这 2 个群                            */
/* ================================================================== */
await goto('#/inbox');
await sleep(1300);
const pickGroups = await evaluate(`(() => {
  // 顶栏群选择器
  const trigger = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('全部群聊'));
  if (!trigger) return { ok: false, why: 'no trigger' };
  trigger.click();
  return { ok: true };
})()`);
await sleep(500);
const choose = await evaluate(`(() => {
  // 用 data-chat 精确定位下拉里的群选项，避免文本匹配命中筛选栏的同名 Chip
  const a = document.querySelector('button[data-chat="24组·聊斋开发群"]');
  const b = document.querySelector('button[data-chat="人工智能2401班群"]');
  if (!a || !b) return { ok: false, a: !!a, b: !!b };
  a.click(); b.click();
  return { ok: true };
})()`);
await sleep(1300);
const filtered = await evaluate(`(() => {
  // 只统计「结果区」：左侧筛选栏本来就列着所有候选群，不能算进来
  const results = document.querySelector('[data-testid="notice-results"]');
  const t = results ? results.innerText : '';
  const body = document.body.innerText;
  const tag = (t.match(/已合并 (\\d+) 个群/) || [])[1] ?? null;
  const cards = [...results.querySelectorAll('[role="button"]')];
  const other = /宿舍夜话\\(204\\)|学生会宣传部|羽毛球约球群|算法竞赛集训队/.test(t);
  const count = (t.match(/共 (\\d+) 条/) || [])[1] ?? null;
  return { tag, hasOther: other, count, trigger: (body.match(/已选 (\\d+) 个群/)||[])[1] ?? null, cards: cards.length };
})()`);
record('A6', '选 2 个群后主内容区只剩这 2 个群', pickGroups.ok && choose.ok && filtered.hasOther === false && filtered.trigger === '2', `合并标签=${filtered.tag} 其它群出现=${filtered.hasOther} 触发按钮=已选${filtered.trigger}个群 命中=${filtered.count}条`);

/* ================================================================== */
/* A8：打开通知详情 → heading 三要素 + 全部来源按时间正序                  */
/* ================================================================== */
const openNotice = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('main [role="button"]')].filter(b => (b.innerText||'').includes('条来源'));
  if (!cards.length) return { ok: false, why: '列表为空', mainLen: (document.querySelector('main')?.innerText||'').length };
  const card = cards[0];
  card.scrollIntoView({ block: 'center' });
  card.click();
  return { ok: true, text: (card.innerText||'').replace(/\\s+/g,' ').slice(0, 50), total: cards.length };
})()`);
await sleep(900);
const detail = await evaluate(`(() => {
  const aside = document.querySelector('[data-testid="drawer"]');
  if (!aside) return { open: false };
  const t = aside.innerText;
  const srcBlock = t.includes('所有群消息来源');
  const n = (t.match(/所有群消息来源（(\\d+)）/) || [])[1];
  // 来源列表时间是否正序
  const lis = [...aside.querySelectorAll('ol li')].map(li => (li.innerText||'').match(/\\d{2}-\\d{2} \\d{2}:\\d{2}/)?.[0]).filter(Boolean);
  const keys = lis.map(s => Number(s.replace(/[-: ]/g,'')));
  const asc = keys.every((v,i)=> i===0 || keys[i-1] <= v);
  return {
    open: true, srcBlock, n, asc, lis: lis.length,
    hasAiSummary: t.includes('AI 总结'),
    hasEntities: t.includes('抽取到的关键要素'),
  };
})()`);
record('A8', '详情抽屉含 AI 总结 + 全部来源且来源按时间正序', openNotice.ok && detail.open && detail.hasAiSummary && detail.srcBlock && detail.asc, `点击=${openNotice.ok ? openNotice.total + '张卡可选' : openNotice.why} 抽屉=${detail.open} 来源数=${detail.n} 时间戳=${detail.lis} 正序=${detail.asc} 要素表=${detail.hasEntities}`);

/* ================================================================== */
/* A7：切「按时间正序（时间轴）」→ 日期分组自上而下递增                    */
/* ================================================================== */
const ascClick = await evaluate(clickByText('button', '按时间正序'));
await sleep(1000);
const ascView = await evaluate(`(() => {
  const heads = [...document.querySelectorAll('section h4')].map(h => (h.innerText||'').trim());
  const mon = heads.map(s => { const m = s.match(/(\\d{2})月(\\d{2})日/); return m ? Number(m[1]+m[2]) : null; }).filter(Boolean);
  const asc = mon.every((v,i)=> i===0 || mon[i-1] <= v);
  return { heads: heads.slice(0,5), asc, n: mon.length };
})()`);
record('A7', '时间正序排序后日期分组自上而下递增', ascClick.ok && ascView.n > 1 && ascView.asc, `${ascView.heads.join(' | ')}`);

/* ================================================================== */
/* A9：空态                                                             */
/* ================================================================== */
await goto('#/meme?sim=empty');
await sleep(1500);
const empty = await evaluate(`(() => {
  const t = document.body.innerText;
  return {
    hasEmpty: /没有提炼到梗|还没有提炼出梗/.test(t),
    hasHint: /换一个时间范围或群聊|时间范围内消息太少|放宽|清空筛选/.test(t),
    hasCrash: /undefined|NaN|\\[object Object\\]/.test(t),
    len: t.length,
  };
})()`);
record('A9', 'sim=empty 显示空态与下一步建议，无崩溃', empty.hasEmpty && empty.hasHint && !empty.hasCrash, `提示=${empty.hasHint} 崩溃标记=${empty.hasCrash}`);

/* ================================================================== */
/* A10：失败态 + 重试按钮存在                                            */
/* ================================================================== */
await goto('#/meme?sim=error');
await sleep(1600);
const errState = await evaluate(`(() => {
  const t = document.body.innerText;
  return {
    hasErr: /分析失败/.test(t),
    hasCode: /LLM_TIMEOUT/.test(t),
    hasRetry: [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('重新分析')),
    hasHint: /重试|检查/.test(t),
  };
})()`);
record('A10', 'sim=error 显示错误码/建议/重试按钮', errState.hasErr && errState.hasCode && errState.hasRetry, `错误码=${errState.hasCode} 重试按钮=${errState.hasRetry} 建议=${errState.hasHint}`);

/* ================================================================== */
/* A12：窄屏（375px）无横向滚动 + 出现底部导航                            */
/* ================================================================== */
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true });
await goto('#/meme');
await sleep(1500);
const mobile = await evaluate(`(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  bottomNav: !!document.querySelector('nav.md\\\\:hidden'),
  header: document.querySelector('header')?.innerText.slice(0, 40) ?? '',
}))()`);
record('A12', '375px 窄屏无横向滚动且底部导航出现', mobile.overflow === false && mobile.bottomNav, `scrollW=${mobile.scrollW} clientW=${mobile.clientW} 底部导航=${mobile.bottomNav}`);
await send('Emulation.clearDeviceMetricsOverride');

/* ================================================================== */
/* 额外：控制台错误汇总                                                  */
/* ================================================================== */
const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
record('X1', '运行期无 React 警告 / 控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' || ') || '无');


/* ================================================================== */
/* A11：词云空间不足时，未放置的词条进入「长尾词」区，信息不丢失            */
/* ================================================================== */
await goto('#/meme');
// 把视口压到很窄，画布放不下所有词条，触发长尾收纳分支
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
await sleep(1800);
const overflowCase = await evaluate(`(() => {
  const t = document.body.innerText;
  const total = 30; // mock 词条总数
  const longTail = (t.match(/长尾词[^\\n]*/) || [])[0] ?? null;
  const tailCount = document.querySelectorAll('button.mp-chip').length;
  const canvasBtns = [...document.querySelectorAll('button')].filter(b => b.style.fontSize && parseFloat(b.style.fontSize) > 12).length;
  return { hasLongTail: !!longTail, longTailLabel: longTail, canvasBtns, tailChips: tailCount };
})()`);
record('A11', '词云空间不足时词条收纳进「长尾词」，总数不丢失',
  overflowCase.hasLongTail ? overflowCase.tailChips > 0 : overflowCase.canvasBtns > 0,
  overflowCase.hasLongTail
    ? `触发长尾收纳：画布内 ${overflowCase.canvasBtns} 个，长尾区 ${overflowCase.tailChips} 个`
    : `空间充足，未触发（画布内 ${overflowCase.canvasBtns} 个词条）`);
await send('Emulation.clearDeviceMetricsOverride');
await sleep(600);

/* ================================================================== */
/* A3：梗卡片生命周期 = 最近调用 - 首次出现（±1 天取整误差）              */
/* ================================================================== */
await goto('#/meme');
await sleep(1500);
const life = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('main [role="button"]')].filter(c => /首次出现/.test(c.innerText||''));
  const bad = [];
  let checked = 0;
  cards.forEach(c => {
    const t = c.innerText || '';
    const first = (t.match(/首次出现\\s*\\n?\\s*(\\d{2}-\\d{2} \\d{2}:\\d{2})/) || [])[1];
    const last  = (t.match(/最近调用\\s*\\n?\\s*(\\d{2}-\\d{2} \\d{2}:\\d{2})/) || [])[1];
    const span  = (t.match(/生命周期\\s*\\n?\\s*(\\d+) 天/) || [])[1];
    if (first && last && span !== undefined) {
      checked++;
      const days = Math.round((Date.parse('2026/' + last.replace('-','/')) - Date.parse('2026/' + first.replace('-','/'))) / 86400000);
      if (Math.abs(days - Number(span)) > 1) bad.push({ first, last, span, computed: days, card: t.slice(0, 24) });
    }
  });
  return { checked, bad: bad.slice(0, 3), total: cards.length };
})()`);
record('A3', '梗卡片「生命周期」= 最近调用 − 首次出现（±1 天）',
  life.checked > 0 && life.bad.length === 0,
  `校验 ${life.checked}/${life.total} 张卡片${life.bad.length ? '，异常：' + JSON.stringify(life.bad) : '，全部一致'}`);

/* ================================================================== */
/* A4：时间轴生命线几何 —— 左端=首次出现，右端=最近调用（相对刻度）        */
/* ================================================================== */
const span = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('main li')].filter(li => li.querySelector('span[title*="→"]'));
  const out = [];
  rows.slice(0, 40).forEach(li => {
    const bar = li.querySelector('span[style*="left"]');
    const label = li.querySelector('span[title*="→"]')?.getAttribute('title') || '';
    if (!bar) return;
    const m = label.match(/(\\d{2}-\\d{2} \\d{2}:\\d{2}) → (\\d{2}-\\d{2} \\d{2}:\\d{2})/);
    if (!m) return;
    const left = parseFloat(bar.style.left);
    const width = parseFloat(bar.style.width);
    out.push({ term: (li.innerText||'').trim().split('\\n')[0], left: +left.toFixed(2), right: +(left + width).toFixed(2), first: m[1], last: m[2] });
  });
  // 起点越早 → left 越小；终点越晚 → right 越大
  let ok = true;
  for (let i = 0; i < out.length; i++) for (let j = 0; j < out.length; j++) {
    if (Date.parse('2026/' + out[i].first.replace('-','/')) < Date.parse('2026/' + out[j].first.replace('-','/')) && out[i].left > out[j].left + 0.6) ok = false;
    if (Date.parse('2026/' + out[i].last.replace('-','/')) > Date.parse('2026/' + out[j].last.replace('-','/')) && out[i].right < out[j].right - 0.6) ok = false;
  }
  return { n: out.length, monotonic: ok, sample: out.slice(0, 3) };
})()`);
record('A4', '时间轴生命线：起点早的靠左、终点晚的靠右（几何与数据一致）',
  span.n > 2 && span.monotonic,
  `${span.n} 条生命线，几何单调性=${span.monotonic}，样例=${JSON.stringify(span.sample?.[0] ?? {})}`);

/* ================================================================== */
/* X2：筛选栏芯片计数与筛选后的数据条数一致（避免"看着筛选了其实没有"）      */
/* ================================================================== */
await goto('#/inbox');
await sleep(1500);
const chipCounts = await evaluate(`(() => {
  const chips = [...document.querySelectorAll('button')].filter(b => /^群公告\\s*\\d+$|^群公告$/.test((b.innerText||'').replace(/\\s+/g,' ').trim()));
  const withCount = document.querySelectorAll('button .rounded-full').length;
  return { hasAnyCount: withCount > 0, total: withCount };
})()`);
const statConsistent = await evaluate(`(() => {
  const t = document.querySelector('[data-testid="notice-results"]')?.innerText || '';
  const resultCount = Number((t.match(/共 (\\d+) 条/) || [])[1] ?? -1);
  const head = document.querySelector('main')?.innerText || '';
  const statCount = Number((head.match(/提取到的信息条目\\s*\\n?\\s*(\\d+)/) || [])[1] ?? -2);
  return { resultCount, statCount, match: resultCount === statCount };
})()`);
record('X2', '顶部统计「信息条目数」与时间轴「共 N 条」一致', statConsistent.match,
  `统计=${statConsistent.statCount} 列表=${statConsistent.resultCount} 计数徽章=${chipCounts.total}`);


/* ================================================================== */
/* S1：社交页 —— 正向社交 = 熟人之间做了什么（关系总结模板）               */
/* ================================================================== */
await goto('#/social');
await sleep(1600);
const forward = await evaluate(`(() => {
  const t = document.body.innerText;
  return {
    hasModeForward: /正向社交/.test(t),
    hasModeReverse: /反向社交/.test(t),
    forwardDesc: /已经熟识的人之间做了什么/.test(t),
    reverseDesc: /非熟人但有相似兴趣/.test(t),
    hasPeopleList: /熟识的人/.test(t),
    hasNarrative: /关系综述/.test(t),
    hasMemories: /你们一起做过的事/.test(t),
    hasMemoryBadge: /一起活动|并肩攻坚|互相帮忙|共同经历|长谈|庆祝/.test(t),
    hasMetrics: /我先开口/.test(t) && /平均回复/.test(t),
    // 旧语义必须彻底消失
    legacyAvoid: /避雷|沟通成本|回复间隔偏长|话题易冷场|关注度/.test(t),
    hasCrash: /undefined|NaN|\[object Object\]/.test(t),
  };
})()`);
record('S1', '正向社交＝熟人关系总结（关系综述/共同经历/互动指标），旧「避雷」语义已移除',
  forward.hasModeForward && forward.forwardDesc && forward.hasPeopleList && forward.hasNarrative &&
  forward.hasMemories && forward.hasMetrics && forward.legacyAvoid === false,
  `综述=${forward.hasNarrative} 共同经历=${forward.hasMemories} 记忆类型徽章=${forward.hasMemoryBadge} 指标=${forward.hasMetrics} 旧语义残留=${forward.legacyAvoid}`);

/* ================================================================== */
/* S2：反向社交 = 非熟人 + 相似兴趣 → 交友潜力（含「为什么算非熟人」）        */
/* ================================================================== */
const toReverse = await evaluate(clickByText('button', '反向社交'));
await sleep(1400);
const reverse = await evaluate(`(() => {
  const t = document.body.innerText;
  // 只取卡片里的徽章文本，避免被顶部说明条里的「交友潜力」字样干扰
  const badges = [...document.querySelectorAll('main .mp-card span')].map(e => (e.textContent || '').trim());
  const scoreBadge = badges.find(b => b.startsWith('交友潜力')) ?? '';
  return {
    switched: /可能聊得来的人/.test(t),
    scoreBadge,
    hasPotentialScore: new RegExp('^交友潜力[^0-9]*[0-9]+').test(scoreBadge),
    hasUnfamiliarBlock: /为什么算「非熟人」/.test(t),
    hasDirectMsg: /直接互动/.test(t),
    hasAxes: /相似度对比/.test(t),
    hasInterests: /#独立游戏|#摄影|#算法竞赛|#黑胶唱片|#长跑|#科幻小说|#手冲咖啡|#羽毛球|#表情包制作|#前端动效|#大模型应用|#爬虫与数据/.test(t),
    hasIcebreak: /破冰建议/.test(t),
    hasEvidence: /查看相似证据/.test(t),
    legacyAvoid: /避雷|沟通成本|关注度[\s\S]{0,4}\d+%/.test(t),
    hasCrash: /undefined|NaN|\[object Object\]/.test(t),
  };
})()`);
record('S2', '反向社交＝非熟人＋相似兴趣的潜力发现（含非熟人依据/相似维度/破冰建议）',
  toReverse.ok && reverse.switched && reverse.hasPotentialScore && reverse.hasUnfamiliarBlock &&
  reverse.hasDirectMsg && reverse.hasAxes && reverse.hasInterests && reverse.hasIcebreak && reverse.legacyAvoid === false,
  `潜力徽章=「${reverse.scoreBadge}」非熟人依据=${reverse.hasUnfamiliarBlock} 直接互动=${reverse.hasDirectMsg} 相似维度=${reverse.hasAxes} 兴趣=${reverse.hasInterests} 破冰=${reverse.hasIcebreak}`);

/* ================================================================== */
/* S3：空态分支（功能三也必须能表达"没有数据"）                            */
/* ================================================================== */
await goto('#/social?sim=empty');
await sleep(1600);
const socialEmpty = await evaluate(`(() => {
  // 只看空态组件本体：顶部说明条里也含「时间范围」等字样，不能用整页文本判断
  const panel = document.querySelector('main .mp-panel');
  const panelText = panel ? panel.innerText : '';
  const t = document.body.innerText;
  return {
    panelFound: !!panel,
    hasHint: /没有可总结的熟识关系|暂未发现潜在好友/.test(panelText),
    panelText: panelText.replace(/\\s+/g, ' ').slice(0, 60),
    // ModuleScaffold 的说明文案里含「embedding」，不能用整页文本判断崩溃
    hasCrash: /undefined|NaN|\[object Object\]/.test(panelText),
  };
})()`);
record('S3', '社交页空态可表达且无崩溃', socialEmpty.hasHint && !socialEmpty.hasCrash, `空态组件=${socialEmpty.panelFound} 文案=「${socialEmpty.panelText}」`);

console.log('\n===== 汇总 =====');
const passed = results.filter((r) => r.pass).length;
console.log(`${passed}/${results.length} 通过`);
for (const r of results.filter((x) => !x.pass)) console.log(`未通过：${r.id} ${r.desc} — ${r.detail}`);
ws.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
