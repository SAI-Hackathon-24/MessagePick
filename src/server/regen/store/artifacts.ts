/**
 * 产物句柄与读取入口（mod-008 §3.1「store/artifacts —— 产物句柄与读取入口」、§8 决策 6）。
 *
 * - 产物引用 = `gen/<记录标识>/<变体序号>`（扩展名由派生函数补全，见 `domain/derive.ts`）；
 * - 字节经 `MOD-002` 的双载体写入 / 读取，本模块不直接读写应用数据目录；
 * - 产物随所属数据删除后读取返回 `NOT_FOUND`（§6）。
 */

import { failNotFound, RegenError, envelopeOf } from '../errors'
import type { MediaPort } from './port'

/** 写入一条产物字节（文件 + 索引由后续 `DM-020` 写入登记）。 */
export function writeArtifact(store: MediaPort, ref: string, bytes: Uint8Array): void {
  try {
    store.writeMedia(ref, bytes)
  } catch (error) {
    if (error instanceof RegenError) throw error
    throw new RegenError(envelopeOf(error, `产物写入失败：${ref}`))
  }
}

/** 读取一条产物字节（路径护栏在存储侧；不存在 → `NOT_FOUND`）。 */
export function readArtifact(store: MediaPort, ref: string): { bytes: Uint8Array; mime: string } {
  if (typeof ref !== 'string' || ref.trim() === '') {
    failNotFound('产物引用非法：应为非空标识', { ref: String(ref) })
  }
  try {
    return store.openMedia(ref)
  } catch (error) {
    if (error instanceof RegenError) throw error
    throw new RegenError(envelopeOf(error, `产物读取失败：${ref}`))
  }
}
