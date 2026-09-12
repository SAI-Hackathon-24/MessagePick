/**
 * 「数据去向」说明（`REQ-012` / `AC-030` / `TASK-010`）。
 *
 * 首次使用流程与设置页共用同一份文案：写清存了哪些数据、云端分析的数据去向、
 * 删除范围与不可恢复性，且与删除能力的表述不矛盾（`AC-030` 的判定口径）。
 */

import { TERMS } from '../terminology'

/** 「数据去向」说明入参。 */
export interface DataDirectionNoticeProps {
  /** 紧凑模式（首次使用引导内用）。 */
  compact?: boolean
}

/** 「数据去向」说明（纯静态文案，无状态、不取数）。 */
export function DataDirectionNotice({ compact = false }: DataDirectionNoticeProps) {
  return (
    <section className={compact ? 'shell-direction shell-direction--compact' : 'shell-direction'}>
      <h3 className="shell-direction__title">数据去向</h3>
      <ul className="shell-direction__list">
        <li>
          <strong>存在本机的数据：</strong>
          群消息记录、群与成员身份、由分析产生的全部结论（梗、提取条目、画像、生成记录）都保存在本机数据目录，
          应用只在本地读取，不向其他服务同步。
        </li>
        <li>
          <strong>发往云端的内容：</strong>
          只有分析任务所需的那部分内容会发往你配置的模型服务（例如消息文本与必要的上下文）；
          通讯录全量、群成员全量与媒体原件不外发。模型服务地址与凭据由你在设置页自行配置。
        </li>
        <li>
          <strong>删除范围与不可恢复：</strong>
          可在设置页按群删除或全量清空；删除范围包含原始记录与全部派生结果（含生成历史）。
          删除一旦执行，已删除的部分不可恢复；删除前后均可先查看受影响实体的清单与计数。
        </li>
        <li>
          <strong>不对外分享：</strong>
          画像、契合度、性格标签等推断结果没有对外分享与发送通道，{TERMS.appName} 是纯个人工具。
        </li>
      </ul>
    </section>
  )
}
