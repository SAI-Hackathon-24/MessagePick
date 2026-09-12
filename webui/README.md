# 聊斋 MessagePick · WebUI

按本仓库**已定稿的契约层**实现的图形化前端：实现 `MOD-004`（应用外壳与全局筛选）的浏览器侧，
以及三个业务模块（群聊梗分析 / 群聊信息提取 / 正向·反向社交）的视图与交互。

> **文档归属**：需求、模块、接口、数据模型、验收用例的唯一事实来源都在 [`../docs/`](../docs/)。
> 本文件只讲**怎么跑起来、代码怎么组织**，不复述契约正文（见 `docs/README.md` §1、§8）。

---

## 唯一依据（改代码前先读）

| 内容 | 文档 |
| --- | --- |
| 用户场景与需求条目（`US-###` / `REQ-###`） | [`../docs/product/prd.md`](../docs/product/prd.md) |
| 模块职责与边界（`MOD-001` ~ `MOD-008`） | [`../docs/design/modules.md`](../docs/design/modules.md) |
| **接口契约（`API-001` ~ `API-034`、16 个错误标识）** | [`../docs/design/api-contract.md`](../docs/design/api-contract.md) |
| **数据模型（`DM-001` ~ `DM-022`）** | [`../docs/design/data-model.md`](../docs/design/data-model.md) |
| 架构与技术选型（决策 2：React + ECharts） | [`../docs/design/impl/high-level-design.md`](../docs/design/impl/high-level-design.md) |
| 验收用例（`AC-001` ~ `AC-139`） | [`../docs/plan/acceptance-tests.md`](../docs/plan/acceptance-tests.md) |

**本前端不发明字段**：`src/types.ts` 里的每个类型都能指回上述文档；要改字段先走
`design-doc-change` skill 改上游契约，再同步这里。

---

## 快速开始

```bash
cd webui
npm install
npm run dev        # → http://127.0.0.1:5273
npm run build      # tsc -b && vite build
npm run typecheck  # 只做类型检查
npm run verify     # 端到端验收检查（见下）
```

### 两种运行模式

| 模式 | 说明 |
| --- | --- |
| `mock`（默认） | 走 `src/api/mock.ts` + `src/api/fixtures.ts`。**后端 `MOD-001` ~ `MOD-008` 看板均为「未开始」**，此模式用于在后端就位前开发与自检界面：数据严格按 `api-contract.md` 与 `data-model.md` 的口径产出。 |
| `http` | 走本机服务进程的 HTTP 接口（HLD §1：浏览器只经本机 HTTP 取数）。 |

切到真实后端：

```bash
# 1) 打开 vite.config.ts 里已预留的 /api 代理
# 2) 设置模式
echo 'VITE_API_MODE=http' > .env.local
# 3) 删除开发期替身（REQ-019 / AC-010：不做演示数据版本）
rm src/api/fixtures.ts src/api/mock.ts
```

> ⚠️ `REQ-019` / `AC-010` 明确「不做演示数据版本」，交付物只接真实微信消息。
> `fixtures.ts` / `mock.ts` **不是产品功能**，是让界面在无后端时可被验证的替身，
> 两个文件头部都写明了这一点；接入真实后端后必须删除。

---

## 端到端验收检查

`npm run verify` 通过 Chrome DevTools Protocol **真实点击驱动**界面，按 `REQ-###` / `AC-###`
检查契约层面的行为与术语口径（40 项）。先起两个进程：

```bash
# 终端 1
npm run dev

# 终端 2
google-chrome --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9222 --user-data-dir=/tmp/mp-chrome about:blank

# 终端 3
npm run verify            # 或 npm run verify http://127.0.0.1:5273
```

覆盖范围：外壳（`REQ-002`/`004`/`005`/`011`/`012`/`016`/`017`/`018`）、
模块一（`REQ-013`/`020`~`023`/`026`~`036`/`037`/`038`）、
模块二（`REQ-045`~`049`/`070`）、
模块三（`REQ-050`/`062`~`065`/`068`/`071`/`073`/`075`/`082`），以及运行期零告警。

---

## 代码结构

```
src/
├── types.ts                  ★ 契约层映射（含 16 个错误标识与统一呈现口径）
├── api/
│   ├── index.ts              ★ 34 条 API 的唯一调用点（mock / http 双模式）
│   ├── fixtures.ts            开发期数据替身（接真实后端后删除）
│   └── mock.ts                开发期契约实现（接真实后端后删除）
├── state/appState.tsx        全局筛选条件 · 更新状态 · 抽屉互斥 · 设置面板
├── components/
│   ├── shell/                外壳：AppShell / GlobalFilterBar / FirstRunGuide / SettingsDialog
│   ├── ui/                   基础展示单元（含异常与空态的统一呈现）
│   ├── charts/               ECharts 按需懒加载容器 + 各图表
│   └── unit/                 业务展示单元：梗单元 / 消息详情 / 生成面板 / 社交各面板
└── pages/                    总览 / 梗分析 / 信息提取 / 社交画像
```

### 几处与契约直接对应的实现要点

- **全局筛选条是唯一筛选控件**（`REQ-004`、`REQ-049`）：只有 `shell/GlobalFilterBar` 产生
  群多选 · 时间范围 · 关键词 · 身份；三个模块只消费，不自建同类控件。关键词的匹配对象
  随模块变化（`REQ-005`），在控件上直接标注。
- **身份无需手工设置**（`REQ-006`）：界面只展示「我」并据此提供「我相关」视角，没有输入框。
- **异常统一呈现**（`REQ-016`）：`types.ts` 的 `ERROR_PRESENTATION` 把 16 个错误标识映射到
  五种处置方式（重试 / 清除筛选 / 引导更新 / 返回 / 确认），三模块与外壳共用 `ErrorState`。
- **图表按需加载**：`REQ-010` 要求万条级首屏 < 2s，故 ECharts 与 `echarts-wordcloud`
  都在首次绘制时动态引入（首屏 JS 因此从 473KB 降到约 122KB gzip）。
- **术语口径**（`REQ-017`）：统一用「梗单元」；模块一「梗词云」与模块三「个人标签词云」
  区分命名；「梗生命周期」与「消息时间轴」不共用名称。

## 尚未完成

- 后端的 `MOD-001` ~ `MOD-008` 均未实现，`http` 模式尚未与真实接口联调。
- 端到端检查是契约层面的行为验证，**不等于** `docs/plan/acceptance-tests.md` 中
  `AC-001` ~ `AC-139` 的全部用例已通过（那需要真实后端）。
