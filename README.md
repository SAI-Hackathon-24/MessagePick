# MessagePick

单机、单用户的本地 Web 应用：采集本机微信聊天记录 → **梗分析 / 信息提取 / 社交画像 / 再创作生成** 四个模块。

- 形态：本机服务进程（Node）只监听回环地址 + 浏览器页面；无账号体系、无对外访问入口。
- 设计文档在 `docs/`，入口建议按序读：
  - `docs/design/impl/high-level-design.md`（架构、运行时、9 条技术决策）
  - `docs/design/impl/detailed-design.md`（并发 / 错误与重试 / 存储 / 安全 / 性能 / 日志 / 配置 / 迁移）
  - `docs/design/api-contract.md`、`docs/design/data-model.md`（契约层：接口与实体）
  - `docs/design/impl/mod-00*.md`（8 个模块的实现层设计，每个模块一份）

> 本仓库是**单包**结构（不使用 npm workspaces）：一个 `package.json`、一个 `tsconfig.json`，服务端与前端同包。

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
| 开发（前端） | `npm run dev:web` | `vite`，默认 <http://127.0.0.1:5173>；`/api`、`/media` 代理到服务进程 |
| 单进程启动 | `npm start` | `tsx src/server/main.ts`（详设决策 9：选端口 → 启服务 → 打开带令牌页面） |

开发期代理目标默认 `http://127.0.0.1:8787`（见 `vite.config.ts`）。服务进程端口默认由应用数据目录的 `config.json` 的 `server.port` 决定（默认 `0` = 自动选空闲端口，详设 §7）；开发时请把 `server.port` 固定为 `8787`，或用环境变量 `MESSAGEPICK_SERVER_PORT` 覆盖代理目标端口。

> 注意：`src/server/main.ts` 与 `src/web/main.tsx` 目前是 **Wave 0 占位**（见下文「脚手架占位」），在 MOD-004 接线前 `npm start` / `npm run dev:server` 会以明确提示退出，这是预期状态。

## 测试 / 类型检查 / 构建

```bash
npm run typecheck   # tsc --noEmit（全仓库类型检查）
npm test            # vitest run（覆盖 src/**/*.test.ts）
npm run build       # vite build（前端 → dist/web）+ tsc --noEmit（服务端类型检查）
```

## 目录结构

```text
.
├── package.json / tsconfig.json / vite.config.ts / vitest.config.ts
├── README.md                       # 本文件
├── docs/                           # 设计文档（不要改；变更走 design-doc-change skill）
└── src/
    ├── shared/                     # 共享契约类型（全模块只读消费）
    │   ├── errors.ts               #   14 个错误标识 + 统一错误信封
    │   ├── filter.ts               #   全局筛选条件（api-contract.md §1.3）
    │   ├── entities.ts             #   DM-001 ~ DM-022 实体类型（data-model.md）
    │   ├── contracts.ts            #   API-001 ~ API-034 入参 / 出参类型（api-contract.md）
    │   ├── index.ts                #   统一出口
    │   └── contracts.test.ts       #   契约自检（错误标识 14 个、34 条 API 类型可引用）
    ├── server/                     # 服务进程（Node）
    │   └── main.ts                 #   ⚠️ Wave 0 占位入口，由 MOD-004 接线
    │   # ingest/  store/  engine/  shell/  meme/  extract/  social/  regen/
    │   # ↑ 各模块目录（src/server/<模块>/）由对应模块负责人创建
    └── web/                        # 浏览器页面（React + ECharts）
        ├── index.html              #   ⚠️ vite 入口（Wave 0 占位，MOD-004 补全）
        ├── main.tsx                #   ⚠️ Wave 0 占位挂载点，由 MOD-004 接线
        # shell/  meme/  extract/  social/  regen/
        # ↑ 各视图目录（src/web/<视图>/）由对应模块负责人创建
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

### 脚手架占位（由 MOD-004 在实现波次替换）

- `src/server/main.ts`：服务进程入口（`dev:server` / `start` 的入口）——接线 `src/server/shell/app.ts`。
- `src/web/index.html` + `src/web/main.tsx`：vite 入口与 React 根节点挂载——接线 `src/web/shell/`。

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

## 许可与版权

内部项目（`private`）；数据处理口径与隐私边界见 `docs/design/impl/detailed-design.md` §4.3。
