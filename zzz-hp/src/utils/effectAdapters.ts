import type { BuffEffect, BuffStatKey } from '@/types/calculator'
import type {
  EffectInstance,
  EffectSpec,
  EffectStage,
} from '@/types/effectSpec'
import { applyTargetToBeneficiary, EFFECT_SPEC_VERSION } from '@/types/effectSpec'
import {
  affixPanelOperation,
  operationForStat,
  stageForAffixTarget,
} from '@/utils/effectStatRegistry'
import {
  affixRollsToEquivalentRolls,
  gainFieldOfTarget,
  isGainTarget,
  isPanelTarget,
  panelFieldOfTarget,
  statKeyOfTarget,
  type AffixLibraryEntry,
} from '@/utils/affixLibrary'
import { getEffectSkillTargets } from '@/utils/buffEffect'
import type { CollectedEffect } from '@/utils/panelBuffCalc'

export function stageForBuffEffect(effect: BuffEffect): EffectStage {
  if (effect.kind === 'convert') return 'convert'
  // 旧引擎把招式/失衡条件当成面板计算的过滤，不是伤害公式里的独立乘区。
  // 方案里的 damageZone 是目标模型；阶段 5 切换执行器前不要提前改桶。
  return 'combatPreConvert'
}

export function adaptBuffEffect(effect: BuffEffect): EffectSpec {
  const operation = effect.kind === 'convert' ? 'convert' : operationForStat(effect.stat)
  return {
    version: EFFECT_SPEC_VERSION,
    stat: effect.stat,
    operation,
    stage: stageForBuffEffect(effect),
    beneficiary: applyTargetToBeneficiary(effect.applyTarget),
    conditions: {
      applySituation: effect.applySituation,
      skillTargets: getEffectSkillTargets(effect),
      elementFilter: effect.elementFilter,
      appliesToAnomaly: effect.appliesToAnomaly,
      applyProfession: effect.applyProfession,
      teamProfession: effect.teamProfession,
      teamProfessionValues: effect.teamProfessionValues,
    },
    convert: effect.convert,
  }
}

export function instantiateCollectedEffect(item: CollectedEffect): EffectInstance {
  const spec = adaptBuffEffect(item.effect)
  return {
    ...spec,
    instanceId: item.effect.id,
    sourceKey: item.sourceKey,
    sourceFamily: 'buff',
    quantity: 1,
    magnitude: item.effect.value ?? 0,
    displayName: item.blockName || item.sourceLabel,
    legacyBuffEffect: item.effect,
  }
}

export type AllocatedAffix =
  | {
      type: 'count'
      entryId: string
      statKey: NonNullable<ReturnType<typeof statKeyOfTarget>>
      equivalentRolls: number
    }
  | { type: 'effect'; instance: EffectInstance }

export function adaptAffixLibraryEntry(
  entry: AffixLibraryEntry,
  rolls: number,
): AllocatedAffix | null {
  if (rolls <= 0) return null
  const statKey = statKeyOfTarget(entry.target)
  if (statKey) {
    return {
      type: 'count',
      entryId: entry.id,
      statKey,
      equivalentRolls: affixRollsToEquivalentRolls(entry, statKey, rolls),
    }
  }

  const stage = stageForAffixTarget(entry.target)
  const panelField = panelFieldOfTarget(entry.target)
  const gainField = gainFieldOfTarget(entry.target)
  const stat = (panelField ?? gainField) as BuffStatKey | null
  if (!stage || !stat) return null

  const magnitude = rolls * entry.perRoll
  const operation = isPanelTarget(entry.target)
    ? affixPanelOperation(panelField!)
    : operationForStat(stat)

  const instance: EffectInstance = {
    version: EFFECT_SPEC_VERSION,
    stat,
    operation,
    stage,
    beneficiary: 'self',
    conditions: {},
    instanceId: `affix:${entry.id}`,
    sourceKey: `affix:${entry.id}`,
    sourceFamily: isGainTarget(entry.target) ? 'affix-gain' : 'affix-panel',
    quantity: rolls,
    magnitude,
    displayName: entry.label,
    legacyAffixTarget: entry.target,
  }
  return { type: 'effect', instance }
}
