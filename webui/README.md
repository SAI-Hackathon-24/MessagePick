# 聊斋 MessagePick · WebUI

微信群聊分析工具的图形化前端。把群里的**海量消息**变成两样东西：
**清晰可执行的信息**（通知 / 待办）与**有生命力的群文化**（热梗 / 表情包）。

> 第 24 组 · 回声队 · SAI 2026 级新生黑客松 AI 挑战赛
> 数据链路：`wechat-cli`（本地只读）→ core（结构化 prompt）→ LLM（分析）→ **本 WebUI**

---

## 快速开始

```bash
cd webui
npm install          # 已配置 npmmirror 镜像
npm run dev          # → http://127.0.0.1:5273
npm run build        # 生产构建（tsc -b && vite build）
npm run typecheck    # 只做类型检查

# 自测（验收标准 A1–A12 的自动化版本）
npm run test:layout  # 词云布局算法单测，11 项，无需浏览器
npm run test:e2e     # 真实浏览器点击驱动，14 项（需 dev server + Chrome 调试端口）
```

### 端到端自测怎么跑

`npm run test:e2e` 通过 Chrome DevTools Protocol 真实点击驱动界面，校验验收标准。
先起一个带调试端口的无头 Chrome，再跑脚本：

```bash
# 终端 1
npm run dev

# 终端 2
google-chrome --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9222 --user-data-dir=/tmp/mp-chrome about:blank

# 终端 3
npm run test:e2e
```

当前**不需要任何后端**即可跑通全部页面：数据来自 `src/api/mockData.ts`（种子固定，每次刷新结果一致，方便演示与评审）。

### 走查异常分支

在地址后加 `?sim=` 参数即可，无需后端配合：

| 地址 | 效果 |
|---|---|
| `#/meme?sim=empty` | 空态：词云、梗卡片、通知全部走空数据分支 |
| `#/meme?sim=error` | 失败态：返回 `LLM_TIMEOUT` 错误信封 |
| `#/meme?sim=slow` | 慢速：强制 3s 延迟，检查骨架屏 |

也可以直接用顶栏右侧的「正常 / 空态 / 失败态 / 慢速」开关切换。

---

## 页面与三大核心功能

| 路由 | 页面 | 对应登记表功能 | 关键展示形式 |
|---|---|---|---|
| `/` | 总览 | 统一入口 | 指标卡、活跃分布、类型占比、发言排行、DDL 提醒 |
| `/meme` | 热梗分析 | **核心功能点一** | **可点击词云 → 梗卡片 → 梗时间轴 → 再生成** |
| `/inbox` | 信息提取 | **核心功能点三** | **通知总览 + 时间轴 + 多维筛选 + 详情抽屉** |
| `/social` | 社交图谱 | **核心功能点二** | 画像雷达卡 + 契合度匹配 + 反向提示（**占位，待定稿**） |
| `/insight` | 数据洞察 | 支撑页 | 图表组件目录，便于复用 |

### 已实现的关键交互（对应 `目标.md`）

**热梗分析**
- 可点击词云：字号 = 频次；点词条 → 打开梗卡片抽屉
- 词云三种布局：**词云 / 热度排行 / 按出现时间排序**
- 梗卡片：**首次出现时间、最近一次调用时间、按时间划分的分布图**，外加趋势迷你图、生命周期（<14 天标「已凉」）、主要贡献者、代表消息
- 梗时间轴两种读法：**生命线**（甘特式，看一个梗从初现到无人问津经过多久）与**热度编组**（看同一时段什么梗在爆发）
- 再生成：表情包 / 配文图 / 海报等，风格可切换（出图走占位 SVG，接口已留）
- 词云放不下的长尾词自动收纳到列表，**信息不丢失**

**信息提取**
- 筛选：关键词、时间范围、来源群（多选）、信息类型、优先级、待办状态、只看带 DDL
- 排序：时间倒序 / 时间正序（时间轴）/ 优先级 / DDL 紧急度；支持**多个群合并排序**
- 三种视图：**时间轴 / 卡片 / 紧凑列表**
- 详情抽屉：heading = **AI 一句话总结 + 来源群 + 时间**；正文 = **AI 总结 + 所有群消息来源（时间正序会话流）**，并有抽取要素表、状态流转、复制摘要

---

## 目录结构

```
webui/
├── docs/
│   ├── 前端需求整理.md      # 需求、功能边界、验收标准、待定稿问题清单
│   └── 接口契约清单.md      # wechat-cli 真实字段 + 建议路由 + 扩展方式
├── src/
│   ├── types.ts             # ★ 数据契约（所有领域对象 + ext 扩展位）
│   ├── api/
│   │   ├── index.ts         # ★ 数据接入层：mock → 真实后端只改这里
│   │   └── mockData.ts      # 演示数据（种子固定）
│   ├── app/appState.ts      # 全局状态：群范围、时间范围、模拟场景
│   ├── lib/                 # cn / 格式化 / useApi / 词云布局算法
│   ├── components/
│   │   ├── ui/              # Card / Chip / Badge / Avatar / 空错态 / 抽屉
│   │   ├── charts.tsx       # Sparkline / TrendArea / DistributionBars / Donut / Radar / HourBars / HeatStrip / BarList
│   │   ├── controls.tsx     # 群选择器 / 时间范围 / 场景切换
│   │   ├── layout/          # AppShell
│   │   ├── meme/            # WordCloud / MemeCardView / MemeTimeline / MemeDetailDrawer
│   │   ├── notice/          # NoticeCard / NoticeDetailDrawer
│   │   └── scaffold/        # 未定稿模块的占位脚手架
│   └── pages/               # 5 个页面
└── vite.config.ts           # 已预留 /api 代理注释
```

---

## 可扩展性设计（针对 PRD 未定稿）

因为 `docs/raw/raw_design.md` 与 PRD 尚未完成，本项目刻意做了这些预留：

1. **`ext?: Record<string, unknown>`** 挂在每个领域对象上 —— 后端新增字段前端不会报错。
2. **枚举驱动 UI** —— 加一个 `RemixKind` / `NoticeCategory`，对应按钮和筛选项自动出现，不用改布局。
3. **`ModuleScaffold` 占位组件** —— 页面里凡「未来要加、现在没定死」的能力，都显式列出扩展点与改法。
4. **`CouplingNote` 边界说明** —— 每个页面标注与 `wechat-cli` / core 的约定，避免返工。
5. **`AnalysisEnvelope` 统一信封** —— 换数据源只改 adapter。
6. **`NormalizedMessage` + `raw_line` 降级** —— wechat-cli 目前 `history` 返回的是格式化行文本，前端已按「结构化优先、原文保底」适配。

---

## 技术栈

React 18 · TypeScript 5（`strict`）· Vite 5 · Tailwind CSS 3 · react-router 6 · lucide-react
图表全部为**手写 SVG**，不依赖任何图表库 —— 离线可跑、样式完全可控、体积小（gzip 后 JS 约 113 KB）。

## 待办

- [ ] 等 `raw_design.md` / PRD 定稿后，替换 `types.ts` 中标注 `TODO(接口待定)` 的字段
- [ ] 接入真实 core 接口（改 `src/api/index.ts` + 打开 vite proxy）
- [ ] 功能三定稿后替换占位数据（正向/反向社交语义、授权边界、匹配范围）
- [ ] 表情包出图接真实 LLM 接口，替换占位 SVG
- [ ] 把本目录并入主仓库（建议 `webui/`）
