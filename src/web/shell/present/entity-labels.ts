/**
 * 实体类型 → 使用者可见名称（删除预检 / 删除结果的计数展示用；`REQ-017` 约束下的必要映射）。
 *
 * 名称取自 `docs/design/data-model.md` 的实体名；界面不出现内部编号（`AC-039`）。
 */

import type { EntityCount, EntityType } from '@shared'

/** 22 个实体类型的中文名称（与 `ENTITY_TYPES` 一一对应）。 */
export const ENTITY_LABELS: Record<EntityType, string> = {
  'DM-001': '采集来源状态',
  'DM-002': '群',
  'DM-003': '消息记录',
  'DM-004': '群成员身份',
  'DM-005': '通讯录与好友列表记录',
  'DM-006': '梗',
  'DM-007': '梗出现记录',
  'DM-008': '梗变体关系',
  'DM-009': '梗精华消息',
  'DM-010': '提取条目',
  'DM-011': '人物',
  'DM-012': '身份对齐候选',
  'DM-013': '兴趣标签',
  'DM-014': '人物兴趣标签',
  'DM-015': '同义标签归并组',
  'DM-016': '性格标签',
  'DM-017': '消息互动记录',
  'DM-018': '两人契合度',
  'DM-019': '我的社交契合度',
  'DM-020': '生成历史',
  'DM-021': '候选梗单元',
  'DM-022': '素材合规确认',
}

/** 取实体类型的中文名称。 */
export function entityLabel(type: EntityType): string {
  return ENTITY_LABELS[type] ?? '其他记录'
}

/** 计数列表 → 展示行（预检与删除结果共用；零计数保留，便于对照范围）。 */
export function entityCountLines(items: readonly EntityCount[]): Array<{ label: string; count: number }> {
  return items.map((item) => ({ label: entityLabel(item.entityType), count: item.count }))
}
