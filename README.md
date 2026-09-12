# 聊斋 MessagePick

> **第 24 组 · 回声队** · SAI 2026 级新生黑客松 AI 挑战赛
>
> 在成员多、消息量大的微信群里，信息爆炸让人陷入「获取信息疲劳」与「重要信息遗漏」的双重困境；
> 同时群里自然生长出的热梗、黑话与共同记忆，因为缺少沉淀与再创作机制而转瞬即逝。
> 聊斋要解决的就是这两件事：**把碎片化消息变成清晰可执行的信息，把群文化变成可传播、可再创作的资产。**

单机、单用户的本地 Web 应用：采集本机微信聊天记录 → **梗分析 / 信息提取 / 社交画像 / 再创作生成** 四个模块。

- 形态：本机服务进程（Node）只监听回环地址 + 浏览器页面；无账号体系、无对外访问入口。
- 设计文档在 `docs/`，入口建议按序读：
  - `docs/design/impl/high-level-design.md`（架构、运行时、9 条技术决策）
  - `docs/design/impl/detailed-design.md`（并发 / 错误与重试 / 存储 / 安全 / 性能 / 日志 / 配置 / 迁移）
  - `docs/design/api-contract.md`、`docs/design/data-model.md`（契约层：接口与实体）
  - `docs/design/impl/mod-00*.md`（8 个模块的实现层设计，每个模块一份）

> 主工程是**单包**结构（不使用 npm workspaces）：一个 `package.json`、一个 `tsconfig.json`，服务端（`src/server/`）与页面（`src/web/`）同包构建；另有独立前端包 `webui/`（自带 `package.json` / `package-lock.json`，不在主工程的类型检查与构建范围内）。

---

## 三大核心功能

| # | 功能 | 一句话 |
|---|---|---|
| 一 | **群聊热梗与文化符号的提炼与再创作** | 一键提炼群内热梗 → 词云 / 梗卡片 / 时间轴 → 生成表情包、配文图 |
| 二 | **微信重要通知的智能提取与多维集中展示** | 识别公告、@所有人、接龙、报名、缴费、会议、DDL → 通知总览与待办 |
| 三 | **好友性格画像与趣味人格匹配** | 基于聊天行为生成性格卡片，匹配同频好友（**设计中，待定稿**） |

## 整体运作方式

```
微信本地数据
   │  （只读、不出本机）
   ▼
wechat-cli ──────────► utils：外部工具调用（wechat-cli、llm）
   │  JSON                  │
   ▼                        ▼
core：业务逻辑，生成结构化 prompt ──► 同时暴露 MCP 工具，让 LLM 补充观察上下文
   │
   ▼
webui：图形化界面（本仓库 webui/）
```

## 团队成员

杨贺尧（测试 / 产品测试）· 李沛轩（技术 / 架构）· 蒋驰骋（策划 / 产品）· 刘行健（技术）·
杨睿哲（测试）· 陈禹哲（技术 / 答辩）· 陈诺（技术 / 前端设计）

---

## 环境要求

- Node.js ≥ 22.12（本脚手架在 Node **v26.8.1** / npm **11.19.0** 上验证）
- 首次 `npm install` 需要编译 `better-sqlite3` 原生模块，请准备本机工具链：
  - Linux：`python3`、`make`、`g++`
  - macOS：Xcode Command Line Tools
  - Windows：Visual Studio Build Tools（C++ 负载）

## 安装

```bash
npm install
```

## 运行

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 开发（服务端） | `npm run dev:server` | `tsx watch src/server/main.ts`，改动自动重启 |
| 开发（产品前端 `webui/`） | `cd webui && npm run dev` | `vite`，默认 <http://127.0.0.1:5273>；`/api`、`/media` 代理到服务进程（开发用，写操作请走完整流程） |
| 开发（`src/web/` 旧实现） | `npm run dev:web` | `vite`，默认 <http://127.0.0.1:5173>；不参与构建 |
| 完整应用 | `npm run build && npm start` | 先构建 `webui/` → `dist/web`，再由服务进程托管并打开**带启动令牌**的页面（同源，读写全功能） |

开发期代理目标默认 `http://127.0.0.1:8787`（见 `vite.config.ts`）。服务进程端口默认由应用数据目录的 `config.json` 的 `server.port` 决定（默认 `0` = 自动选空闲端口，详设 §7）；开发时请把 `server.port` 固定为 `8787`，或用环境变量 `MESSAGEPICK_SERVER_PORT` 覆盖代理目标端口。

> 说明：`npm start` 会选端口 → 启服务 → 打开带启动令牌的页面（详设决策 9），`Ctrl+C` / `SIGTERM` 停止；
> **分析依赖模型服务**：首次使用先在页面「设置 → 模型服务」填写服务地址、模型名（请求体 `model` 字段）与 API 密钥；
> 未配置时采集（数据导入）仍可用，但梗分析 / 信息提取 / 社交画像的模型任务会失败（错误可见，不伪造数据）。采集成功后会按设置自动触发后台预热（默认开）。
> 密钥落点：`data/config.json`（权限 0600，只写不读回页面）；`data/` 与 `config.json` 已在 `.gitignore`，不会被提交。
> 页面即 `webui/` 的构建产物（`dist/web`），与接口同源 —— 启动令牌经 URL fragment 注入，写操作全功能。

### 快速开始（webui/）

```bash
cd webui
npm install
npm run dev        # → http://127.0.0.1:5273
```

当前 `webui/` 使用内置开发期数据即可完整走通三大功能的页面与交互，**不依赖后端**；异常分支（空态 / 失败态 / 慢速）可直接用顶栏开关或 URL 参数 `?sim=empty|error|slow` 走查。细节见 [`webui/README.md`](webui/README.md)。

## 测试 / 类型检查 / 构建

```bash
npm run typecheck   # tsc --noEmit（主工程类型检查）
npm test            # vitest run（覆盖 src/**/*.test.ts）
npm run build       # 构建 webui/ → dist/web + tsc --noEmit（服务端类型检查）
```

`webui/` 为独立包（首次先 `npm --prefix webui install`）；类型检查与开发命令见 [`webui/README.md`](webui/README.md)。

## 目录结构

```text
.
├── package.json / tsconfig.json / vite.config.ts / vitest.config.ts
├── README.md                       # 本文件
├── docs/                           # 设计文档（不要改；变更走 design-doc-change skill）
├── webui/                          # 独立包：产品前端（按契约实现）；构建产物进 dist/web，由 npm start 托管
└── src/
    ├── shared/                     # 共享契约类型（全模块只读消费）
    │   ├── errors.ts               #   14 个错误标识 + 统一错误信封
    │   ├── filter.ts               #   全局筛选条件（api-contract.md §1.3）
    │   ├── entities.ts             #   DM-001 ~ DM-022 实体类型（data-model.md）
    │   ├── contracts.ts            #   API-001 ~ API-034 入参 / 出参类型（api-contract.md）
    │   ├── index.ts                #   统一出口
    │   └── contracts.test.ts       #   契约自检（错误标识 14 个、34 条 API 类型可引用）
    ├── server/                     # 服务进程（Node）
    │   └── main.ts                 #   入口：选端口 → 启服务 → 打开带令牌页面（MOD-004 已接线）
    │   # ingest/  store/  engine/  shell/  meme/  extract/  social/  regen/
    │   # ↑ 各模块目录（src/server/<模块>/）
    └── web/                        # 浏览器页面（React + ECharts；旧实现，dev:web 可单独运行）
        ├── index.html              #   vite 入口
        ├── main.tsx                #   挂载点：接线 src/web/shell/（MOD-004 已接线）
        # shell/  meme/  extract/  social/  regen/
        # ↑ 各视图目录（src/web/<视图>/）
```

### 模块 → 代码目录对照（详见各 `mod-###-<slug>.md` §3.1）

| 模块 | 服务端 | 浏览器侧 |
| --- | --- | --- |
| `MOD-001` 数据接入与更新 | `src/server/ingest/` | — |
| `MOD-002` 数据存储与隐私 | `src/server/store/` | — |
| `MOD-003` 智能分析引擎 | `src/server/engine/` | — |
| `MOD-004` 应用外壳与全局筛选 | `src/server/shell/` | `src/web/shell/` |
| `MOD-005` 梗分析 | `src/server/meme/` | `src/web/meme/` |
| `MOD-006` 信息提取 | `src/server/extract/` | `src/web/extract/` |
| `MOD-007` 社交画像 | `src/server/social/` | `src/web/social/` |
| `MOD-008` 再创作生成 | `src/server/regen/` | `src/web/regen/` |

模块间共享的**纯展示**组件与映射常量由 `MOD-004` 发布在 `src/shared/ui/present/`（mod-004 §8 决策 7）；该目录随实现波次创建。

## 目录边界与并行开发规则

各模块**并行**实现，共同依赖本脚手架。请严格遵守：

1. **共享文件只由编排器修改**：
   `package.json`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`src/shared/**`、根 `README.md`、`.gitignore`。
   模块负责人**不得**直接修改这些文件。
2. **各模块只写自己目录**：`src/server/<模块>/`、`src/web/<模块>/`（对照上表）。不要写别的模块目录，也不要写 `docs/`（文档变更走 `design-doc-change` skill）。
3. **共享类型只从 `@shared` 导入**（`import type { ... } from '@shared'`）：不得在模块内复制第二份契约类型；模块内部 DTO 可以有自己的类型，但跨模块传递的入参 / 出参必须落在 `src/shared` 的类型上。
4. **需要新依赖 → 向编排器申报**：不要在模块内新增依赖或改 `package.json`；编排器评估后统一钉版本。
5. **需要改共享类型（新增字段 / 新枚举 / 新别名）→ 向编排器申报**：说明用途与文档依据（`docs/design/` 哪条），由编排器修改 `src/shared/**` 并广播给其余模块（避免 8 个模块各写一份）。
6. **跨模块调用只走设计文档声明的接口**：业务模块之间的数据传递一律经 `MOD-004` 转交（`REQ-018`）；模块不得反向依赖外壳（`AC-040`）。
7. **Wave 0 已预置且预期稳定的东西**：`npm run typecheck` / `npm test` / `npm run build` 三条命令必须保持绿色；共享类型名与枚举取值一旦下发即按契约使用。

### 入口接线（MOD-004 已落地）

- `src/server/main.ts`：服务进程入口（`dev:server` / `start` 的入口）——已接线 `src/server/shell/app.ts`。
- `src/web/index.html` + `src/web/main.tsx`：vite 入口与 React 根节点挂载——已接线 `src/web/shell/`。

## 共享契约类型（`src/shared/`）

| 文件 | 内容 | 文档来源 |
| --- | --- | --- |
| `errors.ts` | `ErrorCode`（14 个英文常量 + 联合类型）、`ERROR_CODES`、`isErrorCode`、`ErrorEnvelope` | api-contract.md §1.2、详设 §2.2 |
| `filter.ts` | `SharedFilter`（群多选 / 时间范围 / 关键词 / 身份，空 = 不限）、`TimeRange`、`DEFAULT_RECENT_WINDOW_DAYS` | api-contract.md §1.3、mod-004 决策 8 |
| `entities.ts` | `DM-001` ~ `DM-022` 实体接口、`EntityType` / `EntityRecord<T>` / `RecordDTO`、全部枚举常量 | data-model.md |
| `contracts.ts` | `Api001Request/Response` ~ `Api034Request/Response`、`TaskOutcome`、`PageRequest` / `PageInfo` / `WriteResult` / `ReadResult` / `DeletionScope` / `GroupRef` 等公共结构 | api-contract.md §2 |

### 使用约定（模块实现必须遵守）

- **时间**：统一 UTC epoch 毫秒（`Timestamp = number`），存储口径见 mod-002 §5.2；「时长」亦为毫秒（`DurationMs`）。
- **可空 / 选填**：实体字段的 `… | null` = 文档标注「可空」；接口入参的 `?:` = 文档标注「选填」；筛选条件里 `undefined` / `null` / 空值都表示「不限」。
- **枚举取值 = 文档原文的中文词**：如 `MessageKind = '文字' | '图片' | '表情包'`、`Priority = '高' | '中' | '低'`、`MaterialTier = '参考群内图片' | '改编热门表情包' | '纯模板生成'`、`TaskType = '识别' | '抽取' | ...`。
  模块设计文档里若出现英文枚举字面量（如 mod-005 的 `'used'`、mod-008 的 `'groupImage'`），**以本共享类型为准**，可在模块内做一层映射；界面文案的英文禁用检查（`AC-039`）不变。
- **错误**：契约错误只取 14 个标识，不新增；失败 / 超时通过 `ErrorEnvelope` 表达，分项展示与分项重试按 `scope` 聚合。
- **别名**：`GlobalFilter` / `FilterCondition` = `SharedFilter`；`PageInput` = `PageRequest`；`UpdateStatus` = `Api002Response`；`GroupRef` = `DM-002` 记录（群标识 + 群名）。
- **外壳附加字段**：所有响应由 `MOD-004` 在外层附 `epoch` / `requestId`（`ShellResponseMeta`，mod-004 §4.1 / 详设 §3.3）。

---

## 协作与文档规范（重要）

本仓库采用「**prompt 驱动、文档先行**」的推进方式，规则有唯一事实来源：

| 想知道 | 去哪看 |
| --- | --- |
| 我该做什么、按什么顺序做 | [`CONTRIBUTING.md`](CONTRIBUTING.md)（入口，非规则本身） |
| 文档架构、ID 规则、状态机、变更传播 | [`docs/README.md`](docs/README.md)（**规则定义唯一处**） |
| 契约层 / 实现层怎么分 | [`docs/design/README.md`](docs/design/README.md) |
| 变更记录（审计日志） | [`docs/CHANGELOG.md`](docs/CHANGELOG.md) |

主链：`raw/raw_design.md`（人手写）→ `product/prd.md` → `design/modules.md` →
`design/api-contract.md` / `design/data-model.md` → `plan/tasks.md` → `plan/acceptance-tests.md`
（另有一条实现层分支：`prd` + `modules` → `design/impl/high-level-design.md` → 详设 → `mod-###-<slug>.md`）

> 文档状态：各文档的当前状态（`draft` / `reviewed` / `frozen`）以 [`docs/README.md`](docs/README.md) 的状态总表为准。

### `webui/` 的定位

`webui/` 是**按已定稿契约实现的前端**（`MOD-004` 外壳 + 三个业务模块的视图与交互）。

- 需求、模块、接口、数据模型、验收用例的**唯一事实来源**在 `docs/` 主链；
  `webui/` 不复制契约正文，只在 `webui/src/types.ts` 中做类型映射，并在 `webui/src/api/map.ts` 的适配层逐条对表
- 已接线真实后端（2026-09-13）：数据一律走本机服务进程 HTTP（`webui/src/api/` 三层：`index` 调用点 / `client` 传输 + 令牌 / `map` 换算）；
  开发期替身（`fixtures.ts` / `mock.ts`）已按 `REQ-019` / `AC-010` 删除；降级清单见 [`webui/README.md`](webui/README.md)
- 页面托管：`npm run build` 的产物进 `dist/web`，`npm start` 直接托管（同源 + 启动令牌，写操作全功能）；
  单包内的 `src/web/` 保留源码（`npm run dev:web` 可单独运行），不再参与构建
- 怎么跑、怎么自检见 [`webui/README.md`](webui/README.md)

## 许可与版权

内部项目（`private`）；数据处理口径与隐私边界见 `docs/design/impl/detailed-design.md` §4.3。
