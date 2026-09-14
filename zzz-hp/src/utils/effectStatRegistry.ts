import type { BuffStatKey } from '@/types/calculator'
import type { EffectOperation, EffectStage } from '@/types/effectSpec'
import {
  AFFIX_PANEL_PERCENT_OF_BASE_FIELDS,
  isPanelDeltaField,
  type AffixLibraryEntryTarget,
  type AffixPanelDeltaField,
} from '@/utils/affixLibrary'

export type StatCombineRule = 'add' | 'percentOfBase' | 'multiplyFactor'

export interface EffectStatRegistration {
  key: BuffStatKey
  combine: StatCombineRule
  /** 倍率修正区：存百分点，合并用 combineMultFactorPercent */
  isMultFactor?: boolean
}

const MULT_FACTOR_STATS = new Set<BuffStatKey>([
  'directDmgMultFactor',
  'anomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
  'radianceMultFactor',
  'specialMultFactor',
  'mutationCoeffFactor',
])

const PERCENT_OF_BASE_STATS = new Set<string>(['anomalyControl', 'energyRegen'])

export function statCombineRule(stat: BuffStatKey): StatCombineRule {
  if (MULT_FACTOR_STATS.has(stat)) return 'multiplyFactor'
  if (PERCENT_OF_BASE_STATS.has(stat)) return 'percentOfBase'
  return 'add'
}

export function operationForStat(stat: BuffStatKey): EffectOperation {
  const combine = statCombineRule(stat)
  if (combine === 'multiplyFactor') return 'multiplyFactor'
  if (combine === 'percentOfBase') return 'percentOfBase'
  return 'add'
}

export function isMultFactorStat(stat: BuffStatKey): boolean {
  return MULT_FACTOR_STATS.has(stat)
}

/** 词条 panel: 字段里按基础值乘算的集合（与 applyPanelDeltas 一致） */
export function affixPanelOperation(field: AffixPanelDeltaField): EffectOperation {
  return (AFFIX_PANEL_PERCENT_OF_BASE_FIELDS as readonly string[]).includes(field)
    ? 'percentOfBase'
    : 'add'
}

export function stageForAffixTarget(target: AffixLibraryEntryTarget): EffectStage | null {
  if (target.startsWith('panel:')) return 'external'
  if (target.startsWith('gain:')) return 'combatPreConvert'
  return null
}

export function affixTargetOverlapsPanelAndGain(stat: string): boolean {
  return isPanelDeltaField(stat)
}
