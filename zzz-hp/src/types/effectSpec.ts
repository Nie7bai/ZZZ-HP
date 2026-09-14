import type {
  BuffApplySituation,
  BuffApplyTarget,
  BuffEffect,
  BuffEffectConvert,
  BuffEffectKind,
  BuffScope,
  BuffSkillTarget,
  BuffStatKey,
} from '@/types/calculator'
import type { AffixLibraryEntryTarget } from '@/utils/affixLibrary'

export const EFFECT_SPEC_VERSION = 1 as const

/** 效果执行阶段。用户侧不再出现 stat/panel/gain 三族。 */
export type EffectStage = 'external' | 'combatPreConvert' | 'convert' | 'damageZone'

export type EffectOperation = 'add' | 'percentOfBase' | 'multiplyFactor' | 'convert'

/**
 * 稳定 stat 键。运行期禁止再压成无命名空间的裸增量袋。
 * 同一 BuffStatKey 可以出现在不同 stage / sourceFamily，互不覆盖。
 */
export type EffectStatKey = BuffStatKey

export type EffectSourceFamily = 'buff' | 'affix-stat' | 'affix-panel' | 'affix-gain'

export type EffectBeneficiary = 'self' | 'team' | { slot: number }

export interface EffectConditions {
  applySituation?: BuffApplySituation
  scope?: BuffScope
  skillTargets?: BuffSkillTarget[]
  elementFilter?: 'all' | string[]
  appliesToAnomaly?: boolean
  applyProfession?: string | null
  teamProfession?: string | null
  teamProfessionValues?: Array<number | null> | null
  teamProfessionMinCount?: number | null
}

export type EffectSourcePolicy = 'remiel-self-radiance'

export interface EffectSpec {
  version: typeof EFFECT_SPEC_VERSION
  stat: EffectStatKey
  operation: EffectOperation
  stage: EffectStage
  beneficiary: EffectBeneficiary
  conditions: EffectConditions
  convert?: BuffEffectConvert
  sourcePolicy?: EffectSourcePolicy
}

export interface EffectInstance extends EffectSpec {
  instanceId: string
  sourceKey: string
  sourceFamily: EffectSourceFamily
  /** 叠层或词条档数 */
  quantity: number
  /** 已按 quantity 展开后的施加量（add / percentOfBase 用） */
  magnitude: number
  displayName?: string
  enabledDefault?: boolean
  stackable?: boolean
  maxStacks?: number
  valuePerStack?: number
  defaultStacks?: number
  /** 叠层 / 转模等旧 kind；operation 不表达 stacked */
  buffKind?: BuffEffectKind
  /** 旧 Buff 执行器回退；生产切换后删除 */
  legacyBuffEffect?: BuffEffect
  /** 迁移期回读旧词条 target */
  legacyAffixTarget?: AffixLibraryEntryTarget
}

export function beneficiaryToApplyTarget(
  beneficiary: EffectBeneficiary,
): BuffApplyTarget {
  return beneficiary === 'team' ? 'team' : 'self'
}

export interface EffectExecutionPlan {
  instances: readonly EffectInstance[]
  byStage: Record<EffectStage, readonly EffectInstance[]>
}

export function emptyStageBuckets(): Record<EffectStage, EffectInstance[]> {
  return {
    external: [],
    combatPreConvert: [],
    convert: [],
    damageZone: [],
  }
}

export function applyTargetToBeneficiary(applyTarget: BuffApplyTarget | undefined): EffectBeneficiary {
  return applyTarget === 'team' ? 'team' : 'self'
}
