# 前端工作约束与接口备忘（NOTES）

> **状态**: —（工作备忘，不参与 `docs/README.md` §6 的文档状态机；改它不需要开 `CHG-###`）
> **用途**: 记录**必须长期记住**的硬约束、协作约定与后端对接要点。
> 目的：即使会话上下文被压缩或换人接手，这些约束也不会丢。
> **最后更新**: 2026-09-12

---

## 1. 硬约束（来自使用者，勿违反）

| # | 约束 | 说明 |
| --- | --- | --- |
| C1 | **不要修改 `main` 分支** | 前端改动一律推到 `feat/webui-contract-v1`。推送时显式写分支名，**不要用 `HEAD:xxx`**（曾导致本地 `main` 指针被动跟着走） |
| C2 | **每次完成修改都要 `git push` 存档** | 一项改完就提交并推送，不要攒着 |
| C3 | **不改后端接口与数据口径** | 只允许新增**展示用派生值**（如活跃度综合分）。要改契约字段必须先走 `.github/skills/design-doc-change` 回流上游 |
| C4 | **分类逻辑归后端** | 前端不做「LLM 输出 → 一级维度」的映射。界面上出现的分类错误，先查是不是开发期假数据的问题 |
| C5 | 界面文案用中文；**不引入英文术语**（`REQ-017`） | 例：一级维度第五类在界面上显示为「活跃度」，但契约字段名仍是 `social` |
| C6 | 不引入未注册的 ECharts 组件/系列 | 见 §3「ECharts 静默失败清单」——漏注册**不报错**，只是不画 |

## 2. 术语口径（易错，务必遵守）

| 场景 | 正确 | 禁用 |
| --- | --- | --- |
| 梗的展示与操作单元 | **梗单元** | ~~梗卡片~~（已废弃，仅在说明性文案里作为「原称」出现） |
| 模块一的词云 | **梗词云** | — |
| 模块三的词云 | **个人标签词云** | 与「梗词云」不混用 |
| 模块一的时间视图 | **梗生命周期** | — |
| 模块二的时间视图 | **消息时间轴** | 与「梗生命周期」不共用名称 |
| 一个界面上出现两个「活跃度」时的区分 | `DM-011` 的发言量 → 标为「**发言 N 条**」；新综合分 → 标为「**活跃度**」 | 两者不得同名 |

## 3. ECharts 静默失败清单（都实际踩过）

未注册的组件/系列 **不报错、不告警**，只表现为「图不画」或「只画一部分」，排查成本极高。

| 漏注册 | 表现 | 已注册于 |
| --- | --- | --- |
| `charts.HeatmapChart` | 生命周期热力图：行名、月份轴、图例都在，**格子全空** | `EChart.tsx` |
| `components.VisualMapComponent` | 热力图不着色 | `EChart.tsx` |
| `components.GraphicComponent` | 用 `graphic` 画标注时整图不绘制（已改为 HTML 渲染，不再依赖它） | `EChart.tsx` |

数据格式方面的静默陷阱：

| 错误写法 | 表现 |
| --- | --- |
| heatmap 的 `value` 用**四元组** `[x, y, 值, 名称]` | 整张热力图**退化成只有一行**有格子；名称要放 tooltip 里用 y 索引反查 |
| `visualMap.max` 写死成 1（当作强度比例），而值是真实次数 | 超出范围的值不着色 |
| 图表 `setOption` 时容器尺寸为 0 | canvas 变 0×0；直角坐标系能靠 resize 恢复，**力导向图直接不画**。`EChart` 已改为等非零尺寸再 init |

## 4. React 侧易错点

| 问题 | 规则 |
| --- | --- |
| Hooks 顺序 | **所有 hook 必须在任何提前 `return` 之前**。曾把 `useMemo` 写在 `if (!g) return null` 之后，导致 `Rendered more hooks than during the previous render`、整页崩溃 |
| 异步派生的 id | 子组件不得因 id 为空而被上游**跳过渲染**（会造成「同一路由有时有、有时没有」的竞态）。改为常驻挂载 + 加载态。见 `PersonProfilePanel` |
| `useApi` 依赖 | 依赖必须序列化成**一个字符串**再进依赖数组（`[...deps]` 长度变化会让 React 忽略整个依赖列表，筛选静默失效） |
| 抽屉互斥 | 同一时刻只允许一个 `Drawer` 打开（`appState` 的 `claimDrawer` / `releaseDrawer`） |

## 5. 后端对接要点

| 项 | 内容 |
| --- | --- |
| 运行模式 | `VITE_API_MODE=mock`（默认，开发期替身）/ `http`（本机服务）。切换见 `webui/README.md` |
| 接真实后端三步 | ① 设 `VITE_API_MODE=http` ② 打开 `vite.config.ts` 里预留的 `/api` 代理 ③ 删除 `src/api/fixtures.ts` 与 `src/api/mock.ts`（`REQ-019` / `AC-010`：不做演示数据版本） |
| 唯一调用点 | `src/api/index.ts`，每个方法都标注了对应的 `API-###`；组件层不直接依赖 mock |
| 响应信封 | `{ ok, data, error?: { code, message, hint }, stale? }`；`error.code` 必须是 `api-contract.md` §1.2 的 **16 个稳定标识之一** |
| 后端现状 | `docs/status/implementation.md` 里 `MOD-001` ~ `MOD-008` **均为「未开始」**；`wechat-cli` 采集通道已在本机验证可用（16 个库密钥提取成功，`sessions` / `members` / `history` 均读通） |
| 文档与 CLI 的出入 | HLD 决策 7 称「CLI 对登录账号返回 `me`」，实际是 `wechat_cli/core/contacts.py` 的 `get_self_username()` **靠推断**，不会输出名为 `me` 的字段。`REQ-006` 的身份解析需后端自行实现（**已记录，未改文档**） |
| 本地工具 | `wechat-cli` 装在 `~/.venvs/wechat-cli`，入口软链 `~/.local/bin/wechat-cli`（已加入 PATH）；密钥在 `~/.wechat-cli/`（**root 属主，勿提交仓库**） |

## 6. 验收与自检

| 命令 | 内容 |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `tsc -b && vite build` |
| `npm run verify` | 端到端验收探针（CDP 真实点击驱动）。跑之前需 dev server + 带 `--remote-debugging-port=9222` 的 Chrome |

写断言的注意事项：

- **不要只查「元素存在」**：热力图那个 bug 就是「canvas 在、格子空」。关键图形要做**像素级**校验。
- 断言要限定作用域（如 `[data-testid="persona-panel"]` 内），否则会命中页面其它位置的同名文案。
- 懒加载图表与异步取数要**轮询等待**，不要用固定 `sleep`（否则出现随机失败）。
- 页面内不得出现**未注册 ECharts 组件**导致的空白图：新增图表类型时同步更新 §3。

## 6.1 本轮新增的前端接口（后端需实现，已在前端 api 层预留）

| 前端方法 | 建议路由 | 说明 |
| --- | --- | --- |
| `api.memeKingBoard` | `GET /api/memes/king-board` | 梗王榜。口径：参与度 = 使用梗总次数；创造力 = 由其**首次带火**且被反复使用的梗数量；综合分 = 参与度 40% + 覆盖广度 20% + 带火贡献 40%（各归一化 0–100）。综合第一即「梗王」 |
| `api.memeYearbook` | `GET /api/memes/yearbook` | 梗年鉴（全屏翻页回顾）一次取齐 6 页所需数据；数据不足时 `enough = false` |
| `api.yearbookTitle` | `POST /api/memes/yearbook/title` | LLM 依据 Top10 梗生成群称号。**前端按「群 + 时间范围」用 localStorage 缓存**（键 `mp:yearbook-title:<群key>`） |

## 7. 待办与已知遗留

| 项 | 说明 |
| --- | --- |
| `raw_design.md` §6 表述过时 | 仍写着「技术选型尚未确定，不得作为契约层输入」，而 HLD 决策 2 已定为 React + ECharts。**未改**，等作者确认 |
| `REQ-019` 与开发期替身 | 规范要求「不做演示数据版本」，而 `webui` 默认跑在替身上。替身已在界面与文件头标注为非产品功能，接后端后删除 |
| `prototype` 分支 | 早期原型，与现状无关，**按使用者要求保留不删** |
| 通知聚合粒度等产品问题 | 见 `docs/frontend/` 已删除前记录的清单；当前以后端实现为准 |
