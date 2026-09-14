import type {
  BuffApplySituation,
  BuffScope,
  BuffSkillTargetId,
  BuffStatKey,
} from '@/types/calculator'
import {
  EFFECT_SPEC_VERSION,
  type EffectSpec,
} from '@/types/effectSpec'
import {
  affixPanelOperation,
  operationForStat,
  stageForAffixTarget,
} from '@/utils/effectStatRegistry'
import {
  gainFieldOfTarget,
  isAffixLibraryEntryTarget,
  isGainTarget,
  isPanelTarget,
  panelFieldOfTarget,
  statKeyOfTarget,
  type AffixLibraryEntry,
  type AffixLibraryEntryTarget,
} from '@/utils/affixLibrary'

export const AFFIX_EFFECT_TEMPLATE_VERSION = 1 as const

type AffixConditionFields = Pick<
  AffixLibraryEntry,
  'applySituation' | 'scope' | 'skillCategory' | 'skillSubcategoryId' | 'appliesToAnomaly'
>

export type AffixEffectTemplate =
  | {
      version: typeof AFFIX_EFFECT_TEMPLATE_VERSION
      allocation: 'count'
      legacyTarget: AffixLibraryEntryTarget
    }
  | {
      version: typeof AFFIX_EFFECT_TEMPLATE_VERSION
      allocation: 'effect'
      legacyTarget: AffixLibraryEntryTarget
      spec: EffectSpec
    }

function conditionsFromEntry(entry: AffixConditionFields): EffectSpec['conditions'] {
  return {
    applySituation: entry.applySituation,
    scope: entry.scope,
    skillTargets: entry.skillCategory
      ? [{ category: entry.skillCategory, subcategoryId: entry.skillSubcategoryId ?? null }]
      : undefined,
    appliesToAnomaly: entry.appliesToAnomaly,
  }
}

function conditionsToEntry(spec: EffectSpec): AffixConditionFields {
  const skill = spec.conditions.skillTargets?.[0]
  return {
    ...(spec.conditions.applySituation ? { applySituation: spec.conditions.applySituation } : {}),
    ...(spec.conditions.scope ? { scope: spec.conditions.scope } : {}),
    ...(skill?.category ? { skillCategory: skill.category as BuffSkillTargetId } : {}),
    ...(skill && skill.subcategoryId !== undefined
      ? { skillSubcategoryId: skill.subcategoryId }
      : {}),
    ...(typeof spec.conditions.appliesToAnomaly === 'boolean'
      ? { appliesToAnomaly: spec.conditions.appliesToAnomaly }
      : {}),
  }
}

/** 从现行 `target` + 条件字段编出存盘模板。认不出的落点回 null。 */
export function buildAffixEffectTemplate(
  entry: Pick<AffixLibraryEntry, 'target'> & AffixConditionFields,
): AffixEffectTemplate | null {
  const target = entry.target
  if (!isAffixLibraryEntryTarget(target)) return null
  if (statKeyOfTarget(target)) {
    return {
      version: AFFIX_EFFECT_TEMPLATE_VERSION,
      allocation: 'count',
      legacyTarget: target,
    }
  }

  const stage = stageForAffixTarget(target)
  const panelField = panelFieldOfTarget(target)
  const gainField = gainFieldOfTarget(target)
  const stat = (panelField ?? gainField) as BuffStatKey | null
  if (!stage || !stat) return null

  const operation = isPanelTarget(target) ? affixPanelOperation(panelField!) : operationForStat(stat)
  return {
    version: AFFIX_EFFECT_TEMPLATE_VERSION,
    allocation: 'effect',
    legacyTarget: target,
    spec: {
      version: EFFECT_SPEC_VERSION,
      stat,
      operation,
      stage,
      beneficiary: 'self',
      conditions: conditionsFromEntry(entry),
    },
  }
}

export function parseAffixEffectTemplate(raw: unknown): AffixEffectTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const item = raw as Record<string, unknown>
  if (item.version !== AFFIX_EFFECT_TEMPLATE_VERSION) return null
  if (typeof item.legacyTarget !== 'string' || !isAffixLibraryEntryTarget(item.legacyTarget)) {
    return null
  }
  if (item.allocation === 'count') {
    return {
      version: AFFIX_EFFECT_TEMPLATE_VERSION,
      allocation: 'count',
      legacyTarget: item.legacyTarget,
    }
  }
  if (item.allocation !== 'effect' || !item.spec || typeof item.spec !== 'object') return null
  const spec = item.spec as EffectSpec
  if (spec.version !== EFFECT_SPEC_VERSION) return null
  if (typeof spec.stat !== 'string' || !spec.stat) return null
  if (spec.operation !== 'add' && spec.operation !== 'percentOfBase' && spec.operation !== 'multiplyFactor') {
    return null
  }
  if (
    spec.stage !== 'external' &&
    spec.stage !== 'combatPreConvert' &&
    spec.stage !== 'convert' &&
    spec.stage !== 'damageZone'
  ) {
    return null
  }
  return {
    version: AFFIX_EFFECT_TEMPLATE_VERSION,
    allocation: 'effect',
    legacyTarget: item.legacyTarget,
    spec: {
      version: EFFECT_SPEC_VERSION,
      stat: spec.stat,
      operation: spec.operation,
      stage: spec.stage,
      beneficiary: spec.beneficiary === 'team' ? 'team' : 'self',
      conditions: spec.conditions && typeof spec.conditions === 'object' ? spec.conditions : {},
      ...(spec.convert ? { convert: spec.convert } : {}),
    },
  }
}

/** 读新优先：有合法模板就抄条件；没有就保持条目上已有的条件字段。 */
export function mergeAffixEntryFromTemplate(
  entry: AffixLibraryEntry,
  template: AffixEffectTemplate | null,
): AffixLibraryEntry {
  if (!template) return entry
  if (template.allocation !== 'effect') {
    return { ...entry, effectTemplate: template }
  }
  const fromSpec = conditionsToEntry(template.spec)
  return {
    ...entry,
    effectTemplate: template,
    applySituation: entry.applySituation ?? fromSpec.applySituation,
    scope: entry.scope ?? fromSpec.scope,
    skillCategory: entry.skillCategory ?? fromSpec.skillCategory,
    skillSubcategoryId:
      entry.skillSubcategoryId !== undefined
        ? entry.skillSubcategoryId
        : fromSpec.skillSubcategoryId,
    appliesToAnomaly: entry.appliesToAnomaly ?? fromSpec.appliesToAnomaly,
  }
}

export function affixTemplateSourceFamily(
  template: AffixEffectTemplate,
): 'affix-stat' | 'affix-panel' | 'affix-gain' {
  if (template.allocation === 'count') return 'affix-stat'
  return isGainTarget(template.legacyTarget) ? 'affix-gain' : 'affix-panel'
}
