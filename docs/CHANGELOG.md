# 变更记录

> **状态**: —（本文件是流水线的审计日志，不参与文档状态机）
> **维护者**: `docs/prompt/update_design_document_prompt.md`
> **规则**: `docs/README.md` §6、§7
> **最后更新**: 2026-09-12

## 规则

- **只追加**：历史行永不修改、永不删除。写错了就再追加一条更正记录，摘要写「更正 CHG-###」。
- **编号永不复用**：记录 ID `CHG-###` 为三位数字，取现有最大值 +1，作废的编号也不回收。
- **一次变更 = 一条记录**：同一次变更涉及多份文档时，「被改文档」列写多份，不拆成多行。
- 状态变更必须与对应的记录在同一次操作内完成（见 `docs/prompt/update_design_document_prompt.md`）。
- 本文件只记**结果**，不复述内容。要看具体怎么做，查对应文档与 git 历史。

## 记录

| 日期 | 记录 ID | 类型 | 被改文档 | 摘要 | 涉及 ID | 触发的下游重跑 | 操作者 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-12 | CHG-001 | 追加 | `docs/README.md`、`docs/prompt/README.md`、`docs/**` | 建立 `docs/` 架构骨架：阶段化目录分层、ID 追溯链、文档状态机、变更传播规则 | — | —（下游尚未生成） | Copilot |
| 2026-09-12 | CHG-002 | 修改 | `docs/README.md`、`docs/CHANGELOG.md`、`docs/prompt/update_design_document_prompt.md`、`docs/prompt/README.md`、`docs/**`（状态块） | 引入 `updating` 状态与 `CHG-###` 记录机制；实现设计变更回流 prompt；各文档状态块增加「变更中」字段 | `CHG-###` | —（下游尚未生成） | Copilot |
| 2026-09-12 | CHG-003 | 修改 | `.github/skills/design-doc-change/SKILL.md`、`.github/skills/design-doc-change/scripts/check-traceability.py`、`docs/prompt/update_design_document_prompt.md`、`docs/README.md`、`docs/prompt/README.md`、`docs/plan/acceptance-tests.md` | 回流流程整体迁移为工作区 skill `design-doc-change`（可自动加载），原 prompt 文件改为指针；新增追溯链自检脚本；消除流程定义的第二份事实来源；验收用例模板示例改为占位式 ID | `CHG-###` | —（下游尚未生成） | Copilot |
| 2026-09-12 | CHG-004 | 追加 | `docs/design/README.md`、`docs/design/impl/high-level-design.md`、`docs/design/impl/detailed-design.md`、`docs/design/impl/mod-000-template.md`、`docs/status/implementation.md`、`docs/README.md`、`.github/skills/design-doc-change/SKILL.md`、`.github/skills/design-doc-change/scripts/check-traceability.py` | 新增设计分层：契约层（`design/` 根）vs 实现层（`design/impl/`）；建立模块实现看板与「一份模块设计 = 一个负责人」分派规则；引入「上游影响」强制字段，给出下游推翻上游的唯一合法路径；脚本增加实现层文档与看板交叉校验 | `MOD-###`、`REQ-###` | —（下游尚未生成） | Copilot |
| 2026-09-12 | CHG-005 | 追加 | `CONTRIBUTING.md`、`docs/CHANGELOG.md` | 新增仓库根贡献入口 `CONTRIBUTING.md`：角色分派表、上手步骤、流水线图、红线摘要（每条指向定义章节）、提交前自检命令、当前阻塞；**只做索引与指针，规则定义仍只有 `docs/README.md` 一处**（不引入第二份事实来源）；该文件不参与状态机 | — | —（下游尚未生成） | Copilot |
| 2026-09-12 | CHG-006 | 修改 | `CONTRIBUTING.md`、`docs/CHANGELOG.md` | 修正 `CONTRIBUTING.md` 的时效性问题：删去「当前仓库只有 docs、没有产品代码」类状态快照；原 §7「当前状态与阻塞」与原 §8「规则在哪」合并为长期有效的 §7「去哪查」索引；「团队协作流程未定义」改用 `TODO: 待确认` 表达；补完 §4 一处残缺说明 | — | —（下游尚未生成） | Copilot |
| 2026-09-12 | CHG-007 | 修改 | `docs/prompt/generate_prd.md`、`docs/prompt/generate_modules.md`、`docs/prompt/generate_api_contract.md`、`docs/prompt/generate_data_model.md`、`docs/prompt/generate_tasks.md`、`docs/prompt/generate_acceptance_tests.md`、`docs/prompt/README.md`、`docs/README.md`、`docs/CHANGELOG.md` | 补全流水线生成器：阶段 1、2 的「额外要求」补入 §5.2 ID 前缀要求（原本完全缺失，会导致追溯链断在阶段 1、2）；阶段 3–6 从骨架补全为正式条款（ID 与归属、上游可回溯、覆盖要求、异常分支与等价类、终态回流）；同步 `docs/README.md` §2 目录树、§10 状态表与待办勾选 | `US-###`、`REQ-###`、`MOD-###`、`API-###`、`DM-###`、`TASK-###`、`AC-###` | —（下游尚未生成，不涉及重跑） | Copilot |
| 2026-09-12 | CHG-008 | 追加 | `docs/prompt/generate_high_level_design.md`、`docs/prompt/generate_detailed_design.md`、`docs/README.md`、`docs/prompt/README.md`、`.github/skills/design-doc-change/SKILL.md`、`docs/CHANGELOG.md` | 补阶段 7a/7b 生成器，结束「阶段 7 无 prompt」的空缺；技术选型改为「列 2–3 个候选方案 + 推荐理由 → 提出者确认后才写入决定」（阶段 7 是全流水线唯一允许选型的阶段，与阶段 1–6「未定就提问」相反）；`docs/README.md` §4 第 7 行拆为 7a/7b/7c、§2 目录树与 §10 状态表同步；修正 `SKILL.md` 自身矛盾（`USE FOR` 声称「写 HLD 或详细设计」，而 `When NOT to Use` 说「首次生成用 prompt」——该 prompt 原本不存在） | `MOD-###`、`API-###`、`DM-###` | —（下游尚未生成，不涉及重跑） | Copilot |
| 2026-09-12 | CHG-009 | 修改 | `docs/README.md`、`CONTRIBUTING.md`、`docs/prompt/generate_prd.md`、`docs/prompt/generate_modules.md`、`docs/prompt/generate_api_contract.md`、`docs/prompt/generate_data_model.md`、`docs/prompt/generate_tasks.md`、`docs/prompt/generate_acceptance_tests.md`、`docs/design/impl/high-level-design.md`、`docs/design/impl/detailed-design.md`、`docs/CHANGELOG.md` | ① 流水线图补上阶段 7（实现层）分支：`prd` + `modules` → HLD → 详设 → `mod-###-<slug>.md`，并标出第三跳没有生成器；② 6 个生成器的步骤 2 统一补「（提问未闭环时禁止产出）」，与 `docs/prompt/README.md` 规定的骨架一致；③ 两份实现层模板状态块的「生成者」由「人工 / agent 撰写」改为对应生成器路径，与其他文档统一（两文档走完整状态流转 `draft → updating → draft`，因内容仍为未填模板、DoD 未满足） | `MOD-###`、`API-###`、`DM-###` | —（`design/impl/` 的下游 `mod-*.md` 尚未生成，无需重跑） | Copilot |
| 2026-09-12 | CHG-010 | 追加 | `docs/prompt/run_pipeline.md`、`docs/README.md`、`docs/prompt/README.md`、`docs/CHANGELOG.md` | 新增编排器 `run_pipeline.md`：按 §6.3 门禁顺序调度阶段 1–7b（每阶段一个 subagent），以「决策包 + 回收契约」解决 subagent 无状态与无法追问的问题，产出核对由主 agent 自读完成（不信 subagent 自述），最后按 §12.1 为每个 `MOD-###` 建骨架并补看板后交付分派清单；`docs/README.md` §2 目录树与 §10 状态表、`docs/prompt/README.md` 新增「编排器」小节同步 | `MOD-###`、`TASK-###`、`AC-###` | —（不涉及既有文档重跑） | Copilot |
| 2026-09-12 | CHG-011 | 修改 | `docs/raw/raw_design.md`、`docs/raw/raw_lxj.md`（删除）、`docs/README.md` | 并入团队成员模块一需求文档 `raw_lxj.md` v1.1 并删除原文件：新增 §2 全局约定（术语 / 全局筛选 / 非功能需求 / 合规底线 / 数据源），模块一扩为 §3 详规，模块二/三改为引用全局约定；裁定并消除两份文档 17 处不一致（接真实微信、三模块并列无严格顺序、画像禁令仅限模块一、再生成取 G1–G3 且 G4 标规划中、卡片定名「梗单元」、「梗」不引入英文、梗王定名、筛选条全局唯一、两个时间轴分别命名、精华消息含梗图、非功能需求升为全局且性能按模块分别写、词云字号默认累计次数、4 条待确认保留并补身份对齐阻塞说明）；补回 `raw_design.md` 缺失的状态块（修复自检 6 个 ERROR） | — | —（下游仍为空模板，无内容可重跑） | Copilot |
| 2026-09-12 | CHG-012 | 修改 | `docs/raw/raw_design.md`、`docs/README.md` | 重写 §5 社交模块并并入新 input：爱好改「一级固定五类（运动/艺术/游戏/娱乐/社交）+ 二级自由标签」，原「自由标签无预设分类」作废；「匹配度」改名「契合度」并新增逐维度差值；产物新增「按维度搜人 / 按 tag 搜人」；展示形态由四种扩为七种（+ 爱好雷达图 / 性格雷达图 / 个人标签词云）；新增 §5.6 回复时长（口径标待确认）与 §5.7 性格标签（LLM 推断 + 本人确认 + 仅本人可见，闭集六维：领导式/活泼/幽默/冷静/理性/判断）；§5.8 补雷达图维度分口径（聚合方式标待确认）；§2.1 梗王行去掉「不做性格判断」的全局歧义并新增词云术语区分；排除来源 input 中「活跃时间 / 夜猫指数」误记段 | — | —（下游仍为空模板，无内容可重跑） | Copilot |
| 2026-09-12 | CHG-013 | 修改 | `docs/raw/raw_design.md`、`docs/README.md` | 启动前问答闭环：关闭 `raw_design.md` §7 全部 5 条待确认并写回正文——跨群身份对齐改走「群昵称 + 人工确认映射表」（`wechat-cli` 无跨群稳定标识，**本期仍做跨群**，原「只能按单群实现」的阻塞解除；通讯录 / 好友列表用于身份对齐）、时间轴只做可视化不参与权重、未知成员入人-人图谱零连线、模块二/三性能与模块一统一为万条级 < 2s；回复时长口径与雷达图维度分（置信度求和）定稿；清除 raw 内全部 `TODO` 与待确认，状态由 `draft` 提为 `reviewed` | — | —（下游仍为空模板） | Copilot |
