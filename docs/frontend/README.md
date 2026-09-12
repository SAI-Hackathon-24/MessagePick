# 前端文档（原型先行产物）

> **本目录不在 `docs/README.md` 的主链结构中。** 先读 [`../README.md`](../README.md)（文档架构规则）与 [`../CHANGELOG.md`](../CHANGELOG.md)。

---

## 1. 这里是什么

WebUI 原型（`webui/`）在实现过程中产出的两份**前端侧**文档：

| 文件 | 内容 | 对应的主链归属 |
| --- | --- | --- |
| `frontend-requirements.md` | 三大功能的界面需求、功能边界、交互流程与异常分支、数据口径、14 条可判定验收标准、5 个实测缺陷记录、**待回流清单** | `product/prd.md`（`US-###` / `REQ-###`）+ `plan/acceptance-tests.md`（`AC-###`） |
| `frontend-data-contract.md` | `wechat-cli` 源码级 JSON 字段清单、建议路由表、领域对象字段、6 类扩展点改法 | `design/api-contract.md`（`API-###`）+ `design/data-model.md`（`DM-###`） |

## 2. 为什么放在这里，而不是直接写进主链

按 `docs/README.md` §1「文档是唯一事实来源」与 §8「下游不得复制上游正文」：

- 主链全部文档当前状态均为 `draft`（见 `docs/README.md` §10），按 §6.3 门禁**尚不可被下游消费**；
  而 `docs/raw/raw_design.md` 仍是空白模板，阶段 1 尚未启动。
- 若此时把前端需求直接写进 `product/prd.md`，等于**由下游倒灌上游**，会破坏追溯链
  （`AC → TASK → MOD → REQ → US`），也违反「未定就提问、不写猜测值」。
- 因此本目录的定位是：**原型阶段的事实记录 + 给主链的输入**。它们是 `draft`，
  不被任何下游消费；等主链推进到对应阶段，内容被吸收后**本目录应整体删除**。

## 3. 与主链的边界（自查清单）

- [x] 不复述 `REQ-###` / `MOD-###` 正文（主链尚未产出这些 ID）
- [x] 不写函数体、伪代码（契约层约束）
- [x] 头部带规范状态块（状态 / 生成者 / 上游 / 下游 / 变更中 / 最后更新）
- [x] 文件名 kebab-case、小写、`.md`
- [x] 未确定项写成 `> TODO: 待确认` 或「待定稿问题清单」，不写猜测值
- [x] 明确标出**技术选型尚未完成**（选型属阶段 7a，原型实现不等于已决策）

## 4. 下一步

1. 手写 `docs/raw/raw_design.md`（按 `CONTRIBUTING.md` §3，这是唯一由人从零手写的文档）
2. 跑阶段 1–6（见 `docs/prompt/run_pipeline.md`）
3. 阶段 7a 确认技术选型（含本目录第 3 节标注的那一项）
4. 主链产出后，按 `frontend-requirements.md` §10「待回流清单」逐项吸收，删除本目录
