/**
 * MOD-007 社交画像（模块三）—— 模块出口（mod-007 §3.1 目录划分、§3.3 关键接口、§5.4 评分口径）。
 *
 * 供外壳（MOD-004）与其它装配方消费：模块外只经本文件取用 `social/` 的实现，不深入子目录。
 * - `scoring/`：置信度 / 维度分 / 契合度 / 融入度 / 热度分等纯函数与常量（§3.3、§5.4，无 I/O）；
 * - `interactions/`：互动扫描与回复时长（§8 决策 3；DM-017、`AC-111` / `AC-112`）；
 * - `person/`：人在同步与身份合并（§5.1；DM-011、`REQ-082`）；
 * - `tags/`：标签规范化 / 同义归并 / 抽取映射 / 人工增删改计划（DM-013 ~ DM-015）；
 * - `align/`：身份对齐候选生成与结论提交（§8 决策 5；DM-012）；
 * - `store/`：`API-003` / `API-004` 适配与 `dataEpoch` 观测（§3.1、§5.2）；
 * - `errors.ts`：统一信封映射（§6；未映射异常归「未知失败」，不新增标识）。
 *
 * 设计声明但尚未落盘的入口与本文件不补实现的部分：
 * `API-020` ~ `API-029` 适配层（`http/`）、构建流水线 `ProfileBuildPipeline`（`build/`）、
 * `personality/`、`suggest/` 与 `src/web/social/**`。
 */

export * from './align'
export * from './interactions'
export * from './person'
export * from './scoring'
export * from './store'
export * from './tags/edits'
export * from './tags/extract'
export * from './tags/merge'
export * from './tags/normalize'

// 统一信封映射（跨进程 / 跨模块边界用；外壳据此呈现，§6）
export { isSocialError, SocialError, socialError, toErrorEnvelope } from './errors'
