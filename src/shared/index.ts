/**
 * `src/shared/` 统一出口：共享契约类型与错误标识。
 *
 * 全部模块只从 `@shared`（或 `@shared/index`）导入共享定义；不要复制第二份。
 * 各文件职责：
 * - `errors.ts`    错误标识（14 个）与统一错误信封
 * - `filter.ts`    全局筛选条件（api-contract.md §1.3）
 * - `entities.ts`  DM-001 ~ DM-022 实体类型（data-model.md）
 * - `contracts.ts` API-001 ~ API-034 入参 / 出参类型（api-contract.md）
 */

export * from './contracts'
export * from './entities'
export * from './errors'
export * from './filter'
