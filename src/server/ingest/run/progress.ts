/**
 * 进度事件体与进程内通道（mod-001 §3.1「run/progress.ts」、§4.1）。
 *
 * - 只定义**事件体**与进程内订阅；SSE 传输在 `MOD-004`（`progress/event-bus` 订阅本通道）。
 * - 事件不含消息原文、联系人与凭据（详设 §6.1）：来源级事件只带计数与失败边界（`scope`）。
 * - 运行级事件用于「更新入口置灰 / 结束」判定（mod-004 §4.3），不落库、不做缓存。
 */

import type { IngestSource, Timestamp } from '@shared'

import type { OverallCode } from '../errors'
import type { SourceProgress } from '../sources/source'

/** 进度事件：运行级（开始 / 结束）+ 来源级（`CollectContext.onProgress` 的透传）。 */
export type IngestProgressEvent =
  | {
      kind: 'run'
      runId: string
      at: Timestamp
      phase: 'start' | 'finish'
      /** 本次运行的来源集合（串行顺序 = `INGEST_SOURCE_ORDER` 的子序） */
      sources: readonly IngestSource[]
      /** 仅结束事件：批次级标识（全部成功时不给出） */
      overallCode?: OverallCode
    }
  | { kind: 'source'; runId: string; at: Timestamp; progress: SourceProgress }

/** 进度通道：emit / subscribe（订阅返回退订函数）。 */
export interface IngestProgressChannel {
  emit(event: IngestProgressEvent): void
  subscribe(listener: (event: IngestProgressEvent) => void): () => void
}

/** 创建进程内进度通道（订阅者异常不影响采集主流程）。 */
export function createIngestProgress(): IngestProgressChannel {
  const listeners = new Set<(event: IngestProgressEvent) => void>()
  return {
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch {
          // 订阅者异常只影响该订阅者：进度是旁路，不得反噬采集主流程（详设 §2.2 不静默失败口径的例外）
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
