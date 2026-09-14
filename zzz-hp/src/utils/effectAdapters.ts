import type { BuffEffect, BuffStatKey } from '@/types/calculator'
import type {
  EffectInstance,
  EffectSpec,
  EffectStage,
} from '@/types/effectSpec'
import {
  applyTargetToBeneficiary,
  beneficiaryToApplyTarget,
  EFFECT_SPEC_VERSION,
} from '@/types/effectSpec'
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
import { createEmptyBuffEffect, getEffectSkillTargets } from '@/utils/buffEffect'
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
      scope: effect.scope,
      skillTargets: getEffectSkillTargets(effect),
      elementFilter: effect.elementFilter,
      appliesToAnomaly: effect.appliesToAnomaly,
      applyProfession: effect.applyProfession,
      teamProfession: effect.teamProfession,
      teamProfessionValues: effect.teamProfessionValues,
      teamProfessionMinCount: effect.teamProfessionMinCount,
    },
    convert: effect.convert,
  }
}

export function instantiateBuffEffect(
  effect: BuffEffect,
  meta: { sourceKey: string; instanceId?: string; displayName?: string },
): EffectInstance {
  const spec = adaptBuffEffect(effect)
  return {
    ...spec,
    instanceId: meta.instanceId ?? effect.id,
    sourceKey: meta.sourceKey,
    sourceFamily: 'buff',
    quantity: 1,
    magnitude: effect.value ?? 0,
    displayName: meta.displayName,
    enabledDefault: effect.enabledDefault,
    stackable: effect.stackable,
    maxStacks: effect.maxStacks,
    valuePerStack: effect.valuePerStack,
    defaultStacks: effect.defaultStacks,
    buffKind: effect.kind,
    legacyBuffEffect: effect,
  }
}

/**
 * 从 EffectInstance 往返 BuffEffect。故意不读 `legacyBuffEffect`，
 * 避免适配器漏字段时双跑假绿。
 */
export function effectInstanceToBuffEffect(instance: EffectInstance): BuffEffect {
  const skillTargets = instance.conditions.skillTargets
  return createEmptyBuffEffect({
    id: instance.instanceId,
    scope: instance.conditions.scope ?? 'general',
    applyTarget: beneficiaryToApplyTarget(instance.beneficiary),
    applySituation: instance.conditions.applySituation ?? 'global',
    applyProfession: instance.conditions.applyProfession,
    teamProfession: instance.conditions.teamProfession,
    teamProfessionValues: instance.conditions.teamProfessionValues,
    teamProfessionMinCount: instance.conditions.teamProfessionMinCount,
    skillTargets: skillTargets?.length ? skillTargets : undefined,
    elementFilter: instance.conditions.elementFilter ?? 'all',
    kind: instance.buffKind ?? (instance.operation === 'convert' ? 'convert' : 'fixed'),
    stat: instance.stat,
    value: instance.magnitude,
    stackable: instance.stackable,
    maxStacks: instance.maxStacks,
    valuePerStack: instance.valuePerStack,
    defaultStacks: instance.defaultStacks,
    convert: instance.convert,
    appliesToAnomaly: instance.conditions.appliesToAnomaly,
    enabledDefault: instance.enabledDefault,
  })
}

export function instantiateCollectedEffect(item: CollectedEffect): EffectInstance {
  return instantiateBuffEffect(item.effect, {
    instanceId: item.effect.id,
    sourceKey: item.sourceKey,
    displayName: item.blockName || item.sourceLabel,
  })
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
    conditions: {
      skillTargets: entry.skillCategory
        ? [{ category: entry.skillCategory, subcategoryId: entry.skillSubcategoryId ?? null }]
        : undefined,
      applySituation: entry.applySituation,
      scope: entry.scope,
      appliesToAnomaly: entry.appliesToAnomaly,
    },
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
