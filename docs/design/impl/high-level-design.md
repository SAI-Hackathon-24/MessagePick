# 高层设计（HLD）

> **状态**: draft
> **生成者**: `docs/prompt/generate_high_level_design.md`
> **上游**: `docs/product/prd.md`、`docs/design/modules.md`
> **下游**: `docs/design/impl/detailed-design.md`、`docs/design/impl/mod-*.md`
> **变更中**: —
> **最后更新**: 2026-09-12

<!-- 本文件属于实现层。修改必须走 design-doc-change skill（.github/skills/design-doc-change/SKILL.md）。 -->
<!-- 本层允许出现框架名、类图、时序图、代码片段。契约层（design/ 根目录）才禁止。 -->

## 1. 架构总览

<!-- 分层、核心组件、装配关系。一张 mermaid 图 + 一段话 -->

```mermaid
flowchart LR
    A["组件 A"] --> B["组件 B"]
```

## 2. 运行时视图

<!-- 进程 / 线程 / 事件循环 / 部署边界；哪些组件同进程、哪些跨进程 -->

## 3. 关键流程（端到端）

<!-- 挑 3–5 条最重要的用户路径，从入口走到落库。逐条写，不要泛泛画大图 -->

### 流程 1 —— <名称>（覆盖 US-###）

1.

## 4. 部署与运行形态

<!-- 单机 / 客户端 / 服务端 / 插件宿主；依赖的外部服务 -->

## 5. 横切关注点总览

<!-- 只列清单，具体机制交给 detailed-design.md 展开 -->

| 关注点 | 是否适用 | 展开位置 |
| --- | --- | --- |
| 并发模型 | | `detailed-design.md` |
| 错误处理与重试 | | `detailed-design.md` |
| 存储与一致性 | | `detailed-design.md` |
| 安全与权限 | | `detailed-design.md` |

## 6. 关键决策与取舍

<!-- 每个决策一节，必须填「上游影响」。填了条目 ID 就不允许继续往下写，先走回流。 -->

### 决策 1 —— <标题>

- **背景与约束**：
- **候选方案与取舍**：
- **决定**：
- **后果**：
- **上游影响**：无 / 影响 `REQ-###` · `MOD-###` · `API-###` · `DM-###`

## 7. 待确认

<!-- > TODO: 待确认 —— <具体问题> -->
