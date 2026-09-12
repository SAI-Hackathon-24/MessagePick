# 模块实现看板

> **状态**: —（**不参与状态机**）
> **维护者**: 各模块负责人
> **规则**: `docs/README.md` §12、`docs/design/README.md` §5
> **最后更新**: 2026-09-12

## 规则

- **不参与状态机**：本文件记录高频变动的事实，不走 `draft` / `reviewed` / `updating` / `frozen`，也不受 `docs/README.md` §7 变更传播约束。改它不需要开 `CHG-###`。
- **每个已定义的 `MOD-###` 都必须有一行。** 新模块从 `docs/design/modules.md` 出来后，由架构负责人补行。
- **状态枚举只能取这五个**：`未开始` / `进行中` / `阻塞` / `待评审` / `完成`。
- **只改自己那一行。** 改别人的行前先沟通（团队约定：一个文件只有一个负责人，看板是唯一的例外，按行划分）。
- **`完成` 的定义**：该模块覆盖的验收用例（`AC-###`）全部通过，而不是「代码写完了」。
- **阻塞要写原因**，并说明卡在谁 / 卡在哪条条目上。
- 完整历史由 git 承担，本文件不做变更记录。

## 看板

| 模块 | 负责人 | 实现状态 | 设计文档 | 关联任务 | 阻塞原因 | 分支 / PR | 最后更新 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `MOD-001` | — | 未开始 | [mod-001-data-ingest.md](../design/impl/mod-001-data-ingest.md) | `TASK-006`、`TASK-007` | — | — | 2026-09-12 |
| `MOD-002` | — | 未开始 | [mod-002-data-store-privacy.md](../design/impl/mod-002-data-store-privacy.md) | `TASK-001` ~ `TASK-003` | — | — | 2026-09-12 |
| `MOD-003` | — | 未开始 | [mod-003-analysis-engine.md](../design/impl/mod-003-analysis-engine.md) | `TASK-004`、`TASK-005` | — | — | 2026-09-12 |
| `MOD-004` | — | 未开始 | [mod-004-app-shell.md](../design/impl/mod-004-app-shell.md) | `TASK-008` ~ `TASK-011`、`TASK-036` ~ `TASK-038` | — | — | 2026-09-12 |
| `MOD-005` | — | 未开始 | [mod-005-meme-analysis.md](../design/impl/mod-005-meme-analysis.md) | `TASK-012` ~ `TASK-017` | — | — | 2026-09-12 |
| `MOD-006` | — | 未开始 | [mod-006-info-extraction.md](../design/impl/mod-006-info-extraction.md) | `TASK-018` ~ `TASK-021` | — | — | 2026-09-12 |
| `MOD-007` | — | 未开始 | [mod-007-social-profile.md](../design/impl/mod-007-social-profile.md) | `TASK-022` ~ `TASK-031` | — | — | 2026-09-12 |
| `MOD-008` | — | 未开始 | [mod-008-regeneration.md](../design/impl/mod-008-regeneration.md) | `TASK-032` ~ `TASK-035` | — | — | 2026-09-12 |

## 状态统计

<!-- 每次更新看板顺手改这里，便于例会同步 -->

| 状态 | 数量 |
| --- | --- |
| 未开始 | 8 |
| 进行中 | 0 |
| 阻塞 | 0 |
| 待评审 | 0 |
| 完成 | 0 |

## 待确认

<!-- > TODO: 待确认 —— <具体问题> -->
