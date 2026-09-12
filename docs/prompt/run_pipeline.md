# 目标
按 `docs/README.md` §3 的流水线，顺序推进阶段 1–6 + 7a + 7b，每阶段用 subagent 隔离执行；
最后为每个 `MOD-###` 建出模块设计骨架并补齐看板，使提出者可以把每个模块分派给团队成员。

本文件是**编排器**，不是阶段生成器：它只负责「顺序调度 + 提问转述 + 产出核对」，不产出任何设计内容。

# 输入
docs/raw/raw_design.md
docs/README.md
docs/prompt/generate_*.md

# 输出
不是一份文档，而是一次流水线推进的副作用：

- `docs/product/prd.md`
- `docs/design/modules.md`
- `docs/design/api-contract.md`
- `docs/design/data-model.md`
- `docs/plan/tasks.md`
- `docs/plan/acceptance-tests.md`
- `docs/design/impl/high-level-design.md`
- `docs/design/impl/detailed-design.md`
- `docs/design/impl/mod-###-<slug>.md` × N（**只建骨架，不写内容**）
- `docs/status/implementation.md`（每个 `MOD-###` 补一行）

# 步骤

## 步骤 0 —— 前置检查（任一不满足就停下提问，不得开始）

1. `docs/raw/raw_design.md` 必须已由人写实：除状态块与 HTML 注释外，必须存在实质内容。空则**停下**，要求提出者先写。
2. 必须先通过自检：
   ```bash
   python3 .github/skills/design-doc-change/scripts/check-traceability.py --strict
   ```
3. 本 prompt 只做**首次生成**。若某个目标文档已含实质内容（说明该阶段跑过），**停下**并报告：已跑过的阶段不得重复生成，改动要走 `design-doc-change` skill。

## 步骤 1 —— 建立决策包

subagent 无状态，收不到本对话的任何内容，也无法向你追问。所以每次 dispatch 都必须携带一份**决策包**：

| 编号 | 阶段 | 问题 | 提出者回答 |
| --- | --- | --- | --- |
| D-001 | | | |

规则：

- 首次 dispatch 时决策包为空表。
- 每当你从 subagent 或提出者处得到新的确认，就追加一行，**编号只增不复用**。
- 任务包里必须写明：决策包中的内容是**已确认事实**，subagent 不得重新提问。

## 步骤 2 —— 按阶段表顺序 dispatch

| 阶段 | 生成器 | 上游（dispatch 时必须全部附上） | 输出 | 前置门禁 |
| --- | --- | --- | --- | --- |
| 1 | `docs/prompt/generate_prd.md` | `docs/raw/raw_design.md` | `docs/product/prd.md` | raw 已写实 |
| 2 | `docs/prompt/generate_modules.md` | `docs/product/prd.md` | `docs/design/modules.md` | 1 = `reviewed`/`frozen` |
| 3 | `docs/prompt/generate_api_contract.md` | `docs/design/modules.md` | `docs/design/api-contract.md` | 2 = `reviewed`/`frozen` |
| 4 | `docs/prompt/generate_data_model.md` | `docs/product/prd.md`、`docs/design/modules.md` | `docs/design/data-model.md` | 1、2 = `reviewed`/`frozen` |
| 5 | `docs/prompt/generate_tasks.md` | `docs/design/modules.md`、`docs/design/api-contract.md`、`docs/design/data-model.md` | `docs/plan/tasks.md` | 3、4 = `reviewed`/`frozen` |
| 6 | `docs/prompt/generate_acceptance_tests.md` | `docs/product/prd.md`、`docs/design/modules.md`、`docs/design/api-contract.md`、`docs/design/data-model.md`、`docs/plan/tasks.md` | `docs/plan/acceptance-tests.md` | 5 = `reviewed`/`frozen` |
| 7a | `docs/prompt/generate_high_level_design.md` | `docs/product/prd.md`、`docs/design/modules.md` | `docs/design/impl/high-level-design.md` | 2 = `reviewed`/`frozen` |
| 7b | `docs/prompt/generate_detailed_design.md` | `docs/design/impl/high-level-design.md` | `docs/design/impl/detailed-design.md` | 7a = `reviewed`/`frozen` |

要点：

- **门禁是硬门禁**：上游状态为 `draft` 或 `updating` 时，禁止开始该阶段（`docs/README.md` §6.3）。
- **阶段 3 与阶段 4 可以并行**（都只依赖 1、2），其余严格串行。
- **阶段 7a 的输入是契约层，不是阶段 5、6 的产出**：不要因为阶段 5、6 还没跑完就卡住 7a。

### 每次 dispatch 的任务包，必须包含这五项

1. 生成器文件路径（让 subagent 自己读，不要在任务包里复述其要求）
2. 上游文件路径（全部）
3. 输出文件路径
4. 决策包全文
5. 下面的**回收契约**
6. 下面的**提问署名规则**

### 提问署名规则（原文抄进任务包）

> 你向提出者提问时，每条问题的 header 必须标明**来源与进度**，例如 `阶段 2 提问 1/3`。
>
> 原因：subagent 的问题会直接弹到提出者面前，不署名就无法与编排器的提问区分，
> 提出者会误以为是主 agent 在重复提问（实测发生过）。

### 回收契约（原文抄进任务包）

> 你有两种合法返回，二选一。**不允许带着未闭环的疑问硬产出。**
>
> **(1) 提问已全部闭环** → 写入输出文件 → 返回：
> ```
> [完成]
> 输出: <路径>
> 状态: <状态块里的状态值>
> 新分配 ID: <本阶段新增的全部 ID，逐个列出>
> 摘要: <一句话>
> ```
>
> **(2) 存在无法闭环的疑问** → **不得写入任何文件** → 返回：
> ```
> [未闭环]
> 问题清单:
>   1. <问题> / 为什么必须问 / 你倾向的选项
> 已获得的回答: <若有，逐条列出，供追加进决策包>
> 说明: 为什么即使提问也无法闭环
> ```

## 步骤 3 —— 每次 dispatch 之后，你的动作

### 收到 `[完成]`

**自己打开产出文件核对，不要相信 subagent 的自述。** 逐项检查：

- 状态块字段齐全、状态值合法（`draft` / `reviewed` / `updating` / `frozen`）
- 新分配的 ID 与既有 ID 无冲突、无回收（对照 `docs/README.md` §5.2）
- 文档里引用的每个 `US-###` / `REQ-###` / `MOD-###` / `API-###` / `DM-###` / `TASK-###` **真实存在**于对应上游文档
- 「变更中」字段在非 `updating` 时为 `—`

核对通过 → 进入下一阶段并回报；核对不通过 → **停下报告差异，不要自行修补**。

### 收到 `[未闭环]`

1. 用 `askQuestions` 把问题清单**原样**转述给提出者（这是 subagent 做不到的兜底）。
2. 把得到的新确认追加进决策包。
3. **派一个全新的 subagent**（带上更新后的决策包）重跑该阶段。
4. 同一阶段最多重试 **2 轮**；仍 `[未闭环]` → 停下报告卡点，**不要继续往后推**。

## 步骤 4 —— 建模块骨架 + 补看板（交付前最后一步）

阶段 7b 完成后，**不要**生成模块设计内容 —— 那是模块负责人自己的工作（`docs/README.md` §12.1）。
你只做下面四件事：

1. 读 `docs/design/modules.md`，取出全部 `MOD-###`（**不含 `MOD-000`**）。
2. 对每个 `MOD-###`：
   - 复制 `docs/design/impl/mod-000-template.md` 为 `docs/design/impl/mod-###-<slug>.md`
     （`<slug>` 取模块名，kebab-case；`###` 必须与 `modules.md` 中一致）
   - 填好状态块：状态 `draft` / 生成者「模块负责人按 `mod-000-template.md` 撰写」/ 上游 / 下游「无」/ 变更中 `—` / 最后更新
   - 填好 §1「模块信息」表的「模块 ID」与「涉及的契约（`API-###` / `DM-###`）」两栏，「负责人」留 `—`
   - 删掉模板顶部的复制说明注释
3. 在 `docs/status/implementation.md` 的看板为每个模块补一行：
   模块 / 负责人 `—` / 实现状态 `未开始` / 设计文档链接 / 关联 `TASK-###` / 阻塞原因 `—` / 分支 `—` / 日期。
   同步更新底部的「状态统计」。
4. 跑自检，确认 0 error / 0 warning。

## 步骤 5 —— 交付分派清单

向提出者输出这张表，**负责人一栏留空由提出者填**：

| `MOD-###` | 模块名 | 设计文档 | 关联 `TASK-###` | 覆盖的 `AC-###` 数 | 负责人 |
| --- | --- | --- | --- | --- | --- |

并附一句：团队成员拿到自己的 `mod-###-<slug>.md` 后，按 `docs/design/README.md` §3 的「上游影响」规则撰写；遇到契约问题走 `design-doc-change` skill，不要自行绕过 PRD。

# 异常处理

| 情况 | 动作 |
| --- | --- |
| 上游状态是 `draft` 或 `updating` | **停下**，不得开始下游；报告是哪份文档卡住 |
| subagent 返回 `[未闭环]` | 转述给提出者 → 更新决策包 → 重新 dispatch，同阶段最多 2 轮 |
| subagent 写了文件但核对不通过 | **停下报告差异，不要自行修补**（修补会绕过状态机） |
| 提出者中途要改已 `frozen` 的上游 | 立即停止编排，改走 `design-doc-change` skill —— 那不是本 prompt 的职责 |
| 同一阶段重试 3 次仍不过 | 停下报告卡点，不要继续往后推 |
| 提出者要求跳阶段 | 拒绝，并指出 `docs/README.md` §6.3 的门禁 |

# 额外要求
本 prompt 只做「顺序调度 + 提问转述 + 产出核对」，**不生成任何设计内容**。
全部设计内容由 `docs/prompt/generate_*.md` 生成，本文件不得复述其要求（`docs/README.md` §1 SSOT）。
你不得自己代写任何阶段产出：不生成、不补写、不「顺手修一下」，即使你觉得 subagent 写得不好。
subagent 任务包必须自包含：subagent 无状态，收不到本对话的任何内容，也无法向你追问。
不得跳过门禁，不得跳过自检。
不得在阶段 7c 生成模块设计正文；骨架里的章节标题保留为注释即可。
每阶段结束后向提出者报告：阶段号 / 输出路径 / 状态块状态 / 新 ID 清单 / 下一阶段是什么。
是否 commit 由提出者决定；若提交，建议一次阶段产出一个 commit。
不要擅自做出决定。不要揣测我的意图。有任何不清楚的地方必须通过提问的方式问清楚我。尽量调用copilot内置工具向我提问。
