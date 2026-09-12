# Prompt 索引

> **状态**: draft
> **上游**: `docs/README.md`
> **变更中**: —
> **最后更新**: 2026-09-12

每个 prompt 都是一个**阶段生成器**：读一份上游文档，经过「提问确认」后生成一份下游文档。规则见 `docs/README.md` §3–§8。

## 索引

| 阶段 | prompt | 输入 | 输出 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | `generate_prd.md` | `docs/raw/raw_design.md` | `docs/product/prd.md` | 已补全 |
| 2 | `generate_modules.md` | `docs/product/prd.md` | `docs/design/modules.md` | 已补全 |
| 3 | `generate_api_contract.md` | `docs/design/modules.md` | `docs/design/api-contract.md` | 已补全 |
| 4 | `generate_data_model.md` | `docs/product/prd.md` + `docs/design/modules.md` | `docs/design/data-model.md` | 已补全 |
| 5 | `generate_tasks.md` | `docs/design/*.md` | `docs/plan/tasks.md` | 已补全 |
| 6 | `generate_acceptance_tests.md` | `docs/product/prd.md` + `docs/design/*.md` + `docs/plan/tasks.md` | `docs/plan/acceptance-tests.md` | 已补全 |
| 7a | `generate_high_level_design.md` | `docs/product/prd.md` + `docs/design/modules.md` | `docs/design/impl/high-level-design.md` | 已补全 |
| 7b | `generate_detailed_design.md` | `docs/design/impl/high-level-design.md` | `docs/design/impl/detailed-design.md` | 已补全 |
| 回流 | `update_design_document_prompt.md`（指针）→ `.github/skills/design-doc-change/SKILL.md` | 一条变更请求（改什么 / 为什么 / 期望结果） | 上游文档补丁式更新 + `docs/CHANGELOG.md` 记录 | 已迁移为 skill |

## 编排器（不是阶段生成器）

`run_pipeline.md` 是**编排器**，不出现在上面的阶段表里：它不生成任何设计内容，只负责顺序调度、提问转述与产出核对。

| 它做什么 | 它不做什么 |
| --- | --- |
| 按门禁顺序 dispatch 阶段 1–7b（每阶段一个 subagent） | 不生成任何文档内容（那是 `generate_*.md` 的活） |
| subagent 返回「未闭环」时，用问答工具把问题转述给提出者 | 不代写、不补写、不「顺手修一下」 |
| 自己打开产出核对状态块 / ID / 上游引用 | 不相信 subagent 的自述 |
| 最后为每个 `MOD-###` 建骨架并补看板 | 不写模块设计正文（那是负责人的活） |

**为什么它不是 skill**：它属于**正向编排**（人一定在场），不属于需要被自动发现的反向变更。分工判断见 `docs/README.md` §11。

## 调用顺序

**正向生成**：严格按阶段号递增执行。上一阶段输出状态必须为 `reviewed` 或 `frozen`，否则禁止开跑（`docs/README.md` §6 门禁）。

阶段 7c（`design/impl/mod-###-<slug>.md`）**没有生成器**：由模块负责人从 `docs/design/impl/mod-000-template.md` 复制后自行撰写，首次撰写或后续修改均走 `design-doc-change` skill。

**反向变更**：一律走 `design-doc-change` skill（分工说明见 `docs/README.md` §11），**不得直接编辑** `docs/product`、`docs/design`、`docs/plan` 下的任何文档。由它负责：确认变更范围 → 把范围置为 `updating` → 改最上游 → 重跑下游 → 收敛状态 → 写 `CHANGELOG`。

本目录下的 `update_design_document_prompt.md` 只是**指针**，不含流程定义——改流程请改 `SKILL.md`。

## 新增 prompt 时必须遵守的骨架

```markdown
# 目标
一句话：这份 prompt 产出什么、基于什么。

# 输入
<文件路径>（必须是唯一、明确的路径）

# 输出
<文件路径>

# 步骤
1. 阅读并理解 <输入>
2. 提问确认模糊的地方（提问未闭环时禁止产出）
3. 生成 <输出>
   - 要求：<逐条列出必须包含的内容>

# 额外要求
不要擅自做出决定。不要揣测我的意图。有任何不清楚的地方必须通过提问的方式问清楚我。尽量调用copilot内置工具向我提问。
```

约定：

- 「额外要求」段落是每个 prompt 的固定尾部，禁止删除。
- 阶段 1–6（契约层阶段）：必须显式写明「技术选型未指定时提问，不得假设」。契约层禁止框架名。
- 阶段 7a / 7b（实现层阶段）：是全流水线**唯一允许做技术选型**的地方，写法相反 —— 不适用上面那条，改为「列出 2–3 个候选方案 + 取舍 + 推荐理由，经提出者确认后才写入决定」。
- 输出文档的条目必须带 `docs/README.md` §5.2 规定的 ID 前缀。
