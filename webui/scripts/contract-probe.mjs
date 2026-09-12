/**
 * 前后端契约探针（对真实后端运行）
 * =============================================================================
 * 用法：node scripts/contract-probe.mjs [baseUrl]
 *   需先起本机服务进程（`npm start` 或 `MESSAGEPICK_NO_OPEN=1 npx tsx src/server/main.ts`）。
 *
 * 目的：验证**前端 api 层假设的响应形状**与**后端真实返回**一致。
 * 与 verify.mjs 的区别：那个验证界面行为（需要浏览器与 dev server），
 * 这个直接打 HTTP，不需要浏览器，可在 CI 里先跑。
 *
 * 断言策略：不依赖库里是否有真实数据 —— 成功时校验 data 的字段形状，
 * 业务失败时校验错误信封的 14 个闭集标识之一；两种情况都算「契约成立」。
 */
const BASE = process.argv[2] ?? process.env.MESSAGEPICK_BASE ?? 'http://127.0.0.1:38123';

/** 14 个稳定错误标识（docs/design/api-contract.md §1.2 与 src/shared/errors.ts） */
const ERROR_CODES = new Set([
  'NO_AUTH', 'TIMEOUT', 'PARTIAL_FAILURE', 'ANALYSIS_FAILED', 'STORAGE_UNAVAILABLE',
  'NOT_FOUND', 'INVALID_INPUT', 'CONFIRMATION_REQUIRED', 'DELETION_INTERRUPTED',
  'IDENTITY_NOT_READY', 'NO_DATA', 'EMPTY_RESULT', 'MATERIAL_NOT_CONFIRMED', 'SOURCE_UNAVAILABLE',
]);

const results = [];
const rec = (group, name, pass, detail = '') => {
  results.push({ group, name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} [${group}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  let body = null;
  let parseError = null;
  try {
    body = await res.json();
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e);
  }
  return { status: res.status, body, parseError };
};

/** 统一判定：成功信封必须有 data；失败信封必须有合法 code。 */
const judge = (label, r, shapeCheck) => {
  if (r.parseError !== null) {
    rec('信封', label, false, `响应不是 JSON（${r.parseError}）`);
    return null;
  }
  const b = r.body;
  if (b === null || typeof b !== 'object') {
    rec('信封', label, false, '响应体为空或非对象');
    return null;
  }
  if (typeof b.epoch !== 'number' || typeof b.requestId !== 'string') {
    rec('信封', label, false, `缺少 epoch/requestId（实际键：${Object.keys(b).join(',')}）`);
    return null;
  }
  if (b.error !== undefined) {
    const code = b.error?.code;
    const ok = ERROR_CODES.has(code) && typeof b.error.message === 'string' && typeof b.error.retryable === 'boolean';
    rec('信封', `${label}（业务失败分支）`, ok, `code=${code} scope=${b.error?.scope}`);
    return null;
  }
  // 成功分支：不允许出现 ok 字段（后端不返回 ok）
  if ('ok' in b) {
    rec('信封', label, false, '成功响应不应含 ok 字段');
    return null;
  }
  const shape = shapeCheck(b.data);
  rec('契约', label, shape.ok, shape.detail);
  return b.data;
};

/** 字段存在性检查：期望的键必须都在（值可为 null）。 */
const hasKeys = (obj, keys) => {
  if (obj === null || typeof obj !== 'object') return { ok: false, detail: `data 不是对象（${typeof obj}）` };
  const missing = keys.filter((k) => !(k in obj));
  return missing.length === 0
    ? { ok: true, detail: `${keys.length} 个字段齐全` }
    : { ok: false, detail: `缺少字段：${missing.join(',')}（实际：${Object.keys(obj).join(',')}）` };
};

console.log(`契约探针目标：${BASE}\n`);

/* ---------------- 外壳与配置 ---------------- */
const status = await get('/api/update-status');
judge('API-002 GET /api/update-status', status, (d) =>
  hasKeys(d, ['hasData', 'updatedUntilX', 'sourceStatuses', 'meMemberId']),
);

const volume = await get('/api/status/volume');
judge('GET /api/status/volume', volume, (d) => hasKeys(d, ['messages', 'groups', 'people', 'memes', 'extracts']));

/* 群清单：必须显式带 pageSize，否则只回 50 条 */
const groups = await get('/api/filter-options/groups?page=1&pageSize=1000');
const groupData = judge('API-004 GET /api/filter-options/groups', groups, (d) =>
  hasKeys(d, ['records', 'pageInfo']) && Array.isArray(d.records) && hasKeys(d.pageInfo, ['page', 'pageSize', 'total']).ok
    ? { ok: true, detail: `群 ${d.records.length} 个，pageInfo 齐全` }
    : { ok: false, detail: 'records/pageInfo 形状不符' },
);

const settings = await get('/api/settings');
judge('GET /api/settings', settings, (d) =>
  hasKeys(d, ['model', 'ingest', 'cli', 'server', 'log', 'timeouts', 'retry']) &&
  hasKeys(d.model, ['baseUrl', 'apiKeyConfigured', 'taskConcurrency']).ok
    ? { ok: true, detail: `apiKeyConfigured=${d.model.apiKeyConfigured}（凭据不回显，符合预期）` }
    : { ok: false, detail: '设置结构不符' },
);

const operations = await get('/api/operations');
judge('GET /api/operations（进度快照）', operations, (d) =>
  hasKeys(d, ['operations']) && Array.isArray(d.operations) ? { ok: true, detail: `操作 ${d.operations.length} 条` } : { ok: false, detail: 'operations 非数组' },
);

/* ---------------- 模块一：梗分析 ---------------- */
const FILTER = '?layout=%E6%8C%89%E7%83%AD%E5%BA%A6&sizeBasis=%E7%B4%AF%E8%AE%A1%E5%87%BA%E7%8E%B0%E6%AC%A1%E6%95%B0';

const cloud = await get(`/api/memes/cloud${FILTER}`);
judge('API-009 GET /api/memes/cloud', cloud, (d) =>
  hasKeys(d, ['terms', 'legend']) && Array.isArray(d.terms)
    ? { ok: true, detail: `词条 ${d.terms.length} 个；多出字段 total=${d.total ?? '-'} truncated=${d.truncated ?? '-'}` }
    : { ok: false, detail: 'terms/legend 形状不符' },
);

const lifecycle = await get('/api/memes/lifecycle?months=2026-01,2026-12');
judge('API-011 GET /api/memes/lifecycle', lifecycle, (d) =>
  hasKeys(d, ['rows']) && Array.isArray(d.rows)
    ? { ok: true, detail: `行 ${d.rows.length} 个；total=${d.total ?? '-'}` }
    : { ok: false, detail: 'rows 形状不符' },
);

const mine = await get(`/api/memes/mine?view=%E6%88%91%E7%94%A8%E8%BF%87%E7%9A%84${FILTER.replace('?', '&')}`);
judge('API-013 GET /api/memes/mine', mine, (d) =>
  hasKeys(d, ['terms', 'legend']) ? { ok: true, detail: `词条 ${d.terms.length} 个` } : { ok: false, detail: '形状不符' },
);

/* ---------------- 模块二：信息提取 ---------------- */
const extracts = await get('/api/extracts?page=1&pageSize=100');
judge('API-014 GET /api/extracts', extracts, (d) =>
  hasKeys(d, ['items', 'pageInfo']) && Array.isArray(d.items)
    ? { ok: true, detail: `条目 ${d.items.length} 个，total=${d.pageInfo.total}` }
    : { ok: false, detail: 'items/pageInfo 形状不符' },
);

const notifications = await get('/api/notifications?dimension=%E6%9D%A5%E6%BA%90&page=1&pageSize=50');
judge('API-015 GET /api/notifications', notifications, (d) =>
  hasKeys(d, ['groups']) && Array.isArray(d.groups)
    ? { ok: true, detail: `分组 ${d.groups.length} 组` }
    : { ok: false, detail: 'groups 形状不符' },
);

const now = Date.now();
const due = await get(`/api/todos/due?now=${now}`);
judge('API-018 GET /api/todos/due', due, (d) =>
  hasKeys(d, ['todos']) && Array.isArray(d.todos) ? { ok: true, detail: `到期 ${d.todos.length} 条，total=${d.total ?? '-'}` } : { ok: false, detail: 'todos 形状不符' },
);

/* ---------------- 模块三：社交画像 ---------------- */
const people = await get('/api/people?entry=%E6%8C%89%E4%B8%80%E7%BA%A7%E7%BB%B4%E5%BA%A6&value=%E8%BF%90%E5%8A%A8');
judge('API-021 GET /api/people', people, (d) =>
  d !== null && typeof d === 'object' ? { ok: true, detail: `键：${Object.keys(d).join(',')}` } : { ok: false, detail: 'data 非对象' },
);

const hints = await get('/api/people/interest-hints?ids=');
judge('API-029 GET /api/people/interest-hints', hints, (d) =>
  d !== null && typeof d === 'object' ? { ok: true, detail: `键：${Object.keys(d).join(',')}` } : { ok: false, detail: 'data 非对象' },
);

const identity = await get('/api/identity/candidates');
judge('API-025 GET /api/identity/candidates', identity, (d) =>
  d !== null && typeof d === 'object' ? { ok: true, detail: `键：${Object.keys(d).join(',')}` } : { ok: false, detail: 'data 非对象' },
);

const fit = await get('/api/me/fit');
judge('API-023 GET /api/me/fit', fit, (d) =>
  hasKeys(d, ['overallFit']) ? { ok: true, detail: `overallFit=${JSON.stringify(d.overallFit)}（可为 null，符合实现）` } : { ok: false, detail: '缺少 overallFit' },
);

const members = await get('/api/members?ids=');
judge('GET /api/members（辅助读）', members, (d) =>
  d !== null && typeof d === 'object' ? { ok: true, detail: `键：${Object.keys(d).join(',')}` } : { ok: false, detail: 'data 非对象' },
);

/* ---------------- 错误分支：业务失败必须是 HTTP 200 + 合法 code ---------------- */
const notFound = await get('/api/memes/__not_exists__');
const nfOk =
  notFound.status === 200 &&
  notFound.body?.error !== undefined &&
  ERROR_CODES.has(notFound.body.error.code);
rec('错误分支', '不存在的梗标识 → HTTP 200 + 合法错误标识（NOT_FOUND）', nfOk,
  `status=${notFound.status} code=${notFound.body?.error?.code}`);

const badPage = await get('/api/extracts?page=0&pageSize=10');
rec('错误分支', '非法分页（page=0）→ HTTP 200 + INVALID_INPUT', badPage.status === 200 && badPage.body?.error?.code === 'INVALID_INPUT',
  `status=${badPage.status} code=${badPage.body?.error?.code}`);

const badEnum = await get('/api/memes/cloud?layout=heat&sizeBasis=cumulative');
rec('错误分支', '英文枚举值 → HTTP 200 + INVALID_INPUT（中文闭集）', badEnum.status === 200 && badEnum.body?.error?.code === 'INVALID_INPUT',
  `status=${badEnum.status} code=${badEnum.body?.error?.code}`);

const onlyFrom = await get('/api/memes/cloud?layout=%E6%8C%89%E7%83%AD%E5%BA%A6&sizeBasis=%E7%B4%AF%E8%AE%A1%E5%87%BA%E7%8E%B0%E6%AC%A1%E6%95%B0&from=1');
rec('错误分支', '只给 from 不给 to → INVALID_INPUT（时间范围需成对）', onlyFrom.status === 200 && onlyFrom.body?.error?.code === 'INVALID_INPUT',
  `status=${onlyFrom.status} code=${onlyFrom.body?.error?.code}`);

/* ---------------- 守卫：写请求无令牌必须 403 ---------------- */
const writeRes = await fetch(`${BASE}/api/update`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const writeBody = await writeRes.json().catch(() => null);
rec('守卫', '写请求不带令牌 → 403 + scope=guard:token',
  writeRes.status === 403 && writeBody?.error?.scope === 'guard:token',
  `status=${writeRes.status} scope=${writeBody?.error?.scope}`);

/* ---------------- 页面托管 ---------------- */
const pageRes = await fetch(`${BASE}/`);
const html = await pageRes.text();
rec('托管', '根路径返回前端页面（pageBuilt=true 时）',
  pageRes.status === 200 && html.includes('<div id="root"'),
  `status=${pageRes.status} 含 #root=${html.includes('<div id="root"')}`);

/* ---------------- 汇总 ---------------- */
const passed = results.filter((r) => r.pass).length;
console.log(`\n===== 汇总 =====\n${passed}/${results.length} 通过`);
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.log('未通过：');
  for (const f of failed) console.log(`  · [${f.group}] ${f.name} — ${f.detail}`);
  process.exit(1);
}
