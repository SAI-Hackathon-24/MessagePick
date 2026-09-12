/**
 * MOD-008 再创作生成 —— 模块出口（mod-008 §3.1「index.ts」、§3.3 关键数据结构、§3.4 关键接口）。
 *
 * 供外壳（MOD-004）与其它装配方消费：模块外只经本文件取用 `regen/` 的实现，不深入子目录。
 * - `constants.ts`（§5.3、§7.3）：变体数 / 条数上限 / 原话阈值等模块唯一取值来源；
 * - `domain/dedupe.ts`：幂等键派生（§5.1 / §5.2）；
 * - `domain/derive.ts`：入库字段派生与产物引用（§5.1，`DM-020` ~ `DM-022`）；
 * - `materials/manifest.ts`（§3.3）：三档素材清单条目构造（成员素材判定见 §5.3 判定表）；
 * - `render/registry.ts`（§3.3、§8 决策 3）：模板库加载 / 校验 / 版本（元数据驱动、内置只读）；
 * - `errors.ts`（§6）：统一错误信封构造与跨模块透传（不新增标识）。
 *
 * 设计声明但尚未落盘的入口（本文件不补实现，勿在其它文件私自补齐）：
 * `API-030` ~ `API-034` 绑定（`api/`）、用例编排（`app/`）与 `src/web/regen/**`。
 * 已由模块负责人落盘、供外壳（`MOD-004`）接线的进程内入口：素材合规（`materials/consent`）与
 * 产物读取（`store/artifacts`）—— 下方导出，外壳按 `createRegenPort` 绑定。
 */

export * from './constants'
export * from './domain/dedupe'
export * from './domain/derive'
export * from './errors'
export * from './materials/manifest'
export * from './render/registry'

// 外壳接线的进程内入口（mod-004 §4.7；`store` 由调用方绑定）
export { ensureUnconfirmedRecords, readConsentRecords, submitMaterialConsent } from './materials/consent'
export type { ConsentResult } from './materials/consent'
export { readArtifact, writeArtifact } from './store/artifacts'
