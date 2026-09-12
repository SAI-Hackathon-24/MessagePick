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
 * - `build/`：构建流水线 `ProfileBuildPipeline`（单飞、幂等、可重入；§3.4）与进程内索引 `SocialIndex`（§5.2）；
 * - `http/`：`API-020` ~ `API-029` 十条接口的适配（入参校验、错误映射；§3.3、§4）；
 * - `personality/`：性格标签推断编排与确认 / 增删改（§5.3；DM-016、`REQ-074` ~ `REQ-077`）；
 * - `suggest/`：组局建议编排（`API-024` 的生成任务构造与结果解析；`REQ-063`）；
 * - `errors.ts`：统一信封映射（§6；未映射异常归「未知失败」，不新增标识）。
 *
 * 设计声明但尚未落盘的入口（本文件不补实现）：`src/web/social/**`（浏览器侧视图与图表，§3.1）。
 */

export * from './align'
export * from './build'
export * from './http'
export * from './interactions'
export * from './person'
export * from './personality'
export * from './scoring'
export * from './store'
export * from './suggest'
export * from './tags/edits'
export * from './tags/extract'
export * from './tags/merge'
export * from './tags/normalize'

// 统一信封映射（跨进程 / 跨模块边界用；外壳据此呈现，§6）
export { isSocialError, SocialError, socialError, toErrorEnvelope } from './errors'
