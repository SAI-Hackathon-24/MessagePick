# 聊斋 MessagePick

> **第 24 组 · 回声队** · SAI 2026 级新生黑客松 AI 挑战赛
>
> 在成员多、消息量大的微信群里，信息爆炸让人陷入「获取信息疲劳」与「重要信息遗漏」的双重困境；
> 同时群里自然生长出的热梗、黑话与共同记忆，因为缺少沉淀与再创作机制而转瞬即逝。
> 聊斋要解决的就是这两件事：**把碎片化消息变成清晰可执行的信息，把群文化变成可传播、可再创作的资产。**

---

## 三大核心功能

| # | 功能 | 一句话 |
|---|---|---|
| 一 | **群聊热梗与文化符号的提炼与再创作** | 一键提炼群内热梗 → 词云 / 梗卡片 / 时间轴 → 生成表情包、配文图 |
| 二 | **微信重要通知的智能提取与多维集中展示** | 识别公告、@所有人、接龙、报名、缴费、会议、DDL → 通知总览与待办 |
| 三 | **好友性格画像与趣味人格匹配** | 基于聊天行为生成性格卡片，匹配同频好友（**设计中，待定稿**） |

---

## 项目结构

```
MessagePick/
├── docs/
│   ├── frontend/
│   │   ├── 前端需求整理.md      # 需求 / 功能边界 / 验收标准 / 待定稿问题清单
│   │   └── 接口契约清单.md      # wechat-cli 真实字段 + 建议路由 + 扩展方式
│   ├── prompt/                  # 工程提示词（生成 PRD 等）
│   ├── raw/                     # 原始设计草稿（raw_design.md，编写中）
│   └── product/                 # PRD 产物（prd.md，待生成）
└── webui/                       # 图形化 WebUI（React + TS + Vite + Tailwind）
```

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

## 快速开始（WebUI）

```bash
cd webui
npm install
npm run dev        # → http://127.0.0.1:5273
```

当前使用内置演示数据即可完整跑通三大功能的页面与交互，**不依赖后端**。
异常分支（空态 / 失败态 / 慢速）可直接用顶栏开关或 URL 参数 `?sim=empty|error|slow` 走查。
细节见 [`webui/README.md`](webui/README.md)。

## 团队成员

杨贺尧（测试 / 产品测试）· 李沛轩（技术 / 架构）· 蒋驰骋（策划 / 产品）· 刘行健（技术）·
杨睿哲（测试）· 陈禹哲（技术 / 答辩）· 陈诺（技术 / 前端设计）

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

**当前主链状态**：全部为 `draft`（`docs/raw/raw_design.md` 仍是空白模板），按 §6.3 门禁尚不可被下游消费。

### `webui/` 的定位

`webui/` 是**按已定稿契约实现的前端**（`MOD-004` 外壳 + 三个业务模块的视图与交互）。

- 需求、模块、接口、数据模型、验收用例的**唯一事实来源仍在上表的主链**；
  `webui/` 不复制契约正文，只在 `webui/src/types.ts` 中做类型映射，并逐条标注 `API-###`
- 后端 `MOD-001` ~ `MOD-008` 尚未实现，因此 `webui/` 默认运行在开发期数据模式
  （`src/api/fixtures.ts` + `mock.ts`，严格按数据模型口径产出）。
  `REQ-019` / `AC-010` 要求不做演示数据版本，故这两个文件在接入真实后端后必须删除
- 怎么跑、怎么自检见 [`webui/README.md`](webui/README.md)

