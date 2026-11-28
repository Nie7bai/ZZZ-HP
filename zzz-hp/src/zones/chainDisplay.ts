import type { StageDefinition } from './pipeline'

/**
 * 管理端「计算链路」展示用的纯函数。
 *
 * 链路的阶段只描述链路自身；全局乘区方案里的自定义乘区（烬痕 / 最终伤害 / 一布之力 等）
 * 由方案在结算末尾单独相乘，不属于任何链路阶段，但管理端看链路时也要能看到它们。
 * 这里只做**展示拼接**，不参与结算与预览。
 */
export interface SchemeEntryStageInput {
  key: string
  label?: string
  module?: string
  params?: Record<string, unknown>
  when?: unknown
  enabled?: boolean
  action?: string
}

/** 乘区方案条目 → 阶段格（只读展示：一个条目就是一个乘区） */
export function schemeEntriesToStages(
  entries: readonly SchemeEntryStageInput[],
): StageDefinition[] {
  return entries
    .filter((entry) => entry.enabled !== false)
    .map((entry, index) => ({
      id: entry.key,
      kind: 'multiplier' as const,
      label: entry.label || entry.key,
      group: 'scheme',
      // 乘区方案条目自带 `params.order`（自定义乘区按它排在链路末尾）；没有才退回条目顺序
      order: Number(entry.params?.order) || index + 1,
      module: entry.module ?? '',
      params: entry.params,
      when: entry.when as StageDefinition['when'],
      enabled: true,
      action: entry.action === 'inherit' || entry.action === 'disable' ? entry.action : undefined,
    }))
}

/** 链路阶段 + 全局独立乘区（同 id 或同标签不重复，追加在末尾） */
export function mergeSchemeStagesIntoChain(
  chainStages: readonly StageDefinition[],
  schemeStages: readonly StageDefinition[],
): readonly StageDefinition[] {
  if (!schemeStages.length) return chainStages
  const ownIds = new Set(chainStages.map((stage) => stage.id))
  // 标签也去重：历史方案里可能留着与内置阶段同名的条目（如 `custom:finalDamage`「最终伤害区」）
  const ownLabels = new Set(chainStages.map((stage) => stage.label.trim()))
  const extra = schemeStages.filter(
    (stage) => !ownIds.has(stage.id) && !ownLabels.has(stage.label.trim()),
  )
  return extra.length ? [...chainStages, ...extra] : chainStages
}
