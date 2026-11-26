import type { BuffEffect } from '@/types/calculator'
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
import { operationForStat } from '@/utils/effectStatRegistry'
import { damageTypesOf, normalizeDamageTypes } from '@/utils/buffDamageTypes'
import {
  affixRollsToEquivalentRolls,
  statKeyOfTarget,
  type AffixLibraryEntry,
} from '@/utils/affixLibrary'
import {
  affixTemplateSourceFamily,
  buildAffixEffectTemplate,
  parseAffixEffectTemplate,
} from '@/utils/affixEffectTemplate'
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
      damageTypes: damageTypesOf(effect),
      skillTargets: getEffectSkillTargets(effect),
      ...(effect.skillTargetsOnlyForTeammates ? { skillTargetsOnlyForTeammates: true } : {}),
      elementFilter: effect.elementFilter,
      applyProfession: effect.applyProfession,
      teammateProfessions: effect.teammateProfessions,
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
    extraGain: effect.extraGain,
  }
}

/**
 * 从 EffectInstance 往返 BuffEffect。故意不读 `legacyBuffEffect`，
 * 避免适配器漏字段时双跑假绿。
 */
export function effectInstanceToBuffEffect(instance: EffectInstance): BuffEffect {
  const skillTargets = instance.conditions.skillTargets
  const damageTypes = normalizeDamageTypes(instance.conditions.damageTypes)
  return createEmptyBuffEffect({
    id: instance.instanceId,
    conditions: damageTypes.length ? { damageTypes } : undefined,
    applyTarget: beneficiaryToApplyTarget(instance.beneficiary),
    applySituation: instance.conditions.applySituation ?? 'global',
    applyProfession: instance.conditions.applyProfession,
    teammateProfessions: instance.conditions.teammateProfessions,
    teamProfession: instance.conditions.teamProfession,
    teamProfessionValues: instance.conditions.teamProfessionValues,
    teamProfessionMinCount: instance.conditions.teamProfessionMinCount,
    skillTargets: skillTargets?.length ? skillTargets : undefined,
    skillTargetsOnlyForTeammates: instance.conditions.skillTargetsOnlyForTeammates,
    elementFilter: instance.conditions.elementFilter ?? 'all',
    kind: instance.buffKind ?? (instance.operation === 'convert' ? 'convert' : 'fixed'),
    stat: instance.stat,
    value: instance.magnitude,
    stackable: instance.stackable,
    maxStacks: instance.maxStacks,
    valuePerStack: instance.valuePerStack,
    defaultStacks: instance.defaultStacks,
    convert: instance.convert,
    enabledDefault: instance.enabledDefault,
    // 运行期额外 Buff 标记必须过往返（Spec §5.1 第 8 项）
    extraGain: instance.extraGain,
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
  const template =
    parseAffixEffectTemplate(entry.effectTemplate) ?? buildAffixEffectTemplate(entry)
  if (!template) return null
  if (template.allocation === 'count') {
    const statKey = statKeyOfTarget(template.legacyTarget)
    if (!statKey) return null
    return {
      type: 'count',
      entryId: entry.id,
      statKey,
      equivalentRolls: affixRollsToEquivalentRolls(entry, statKey, rolls),
    }
  }

  return {
    type: 'effect',
    instance: {
      ...template.spec,
      instanceId: `affix:${entry.id}`,
      sourceKey: `affix:${entry.id}`,
      sourceFamily: affixTemplateSourceFamily(template),
      quantity: rolls,
      magnitude: rolls * entry.perRoll,
      displayName: entry.label,
      legacyAffixTarget: template.legacyTarget,
    },
  }
}
