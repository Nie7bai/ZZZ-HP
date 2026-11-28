import type { StageDefinition } from './pipeline'

/**
 * 管理端「计算链路」展示用的纯函数。
 *
 * 全局乘区方案里的自定义乘区（烬痕 / 最终伤害 / 一布之力 等）在事件结算时由
 * `customZoneStageEntries()` 编译成链路阶段、与阶段一起连乘。管理端链路面板按同一口径
 * 把它们并列展示：位置在「期望伤害」之前，并把期望伤害固定排到最后（order 显示 999）。
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

/**
 * 链路阶段 + 全局独立乘区（同 id 或同标签不重复）。
 *
 * 方案编译出的乘区排在「期望伤害」之前——它确实参与连乘，期望伤害是乘完之后的结果，
 * 所以期望伤害固定最后展示，序号显示为 999（展示口径，不改内置链路定义的 order）。
 */
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
  if (!extra.length) return chainStages
  const finals = chainStages
    .filter((stage) => stage.kind === 'final')
    .map((stage) => ({ ...stage, order: 999 }))
  const body = chainStages.filter((stage) => stage.kind !== 'final')
  return [...body, ...extra, ...finals]
}
