import type {
  BuffApplySituation,
  BuffEffect,
  BuffScope,
  BuffSkillTarget,
  BuffStatModifiers,
  DamageEvent,
  SkillCalcContext,
  SkillSubcategory,
  StaggerPhase,
} from '@/types/calculator'
import type { ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import { effectMatchesContext, resolveIsFollowUp } from '@/utils/buffEffect'
import { eventNeedsAnomalyProducer, mapEventKindToCalc } from '@/utils/damageEvent'
import { resolveEventOwnerAgentId } from '@/utils/damageEventOwner'
import { createEmptyBuffStatModifiers, mergeBuffStatModifiers } from '@/utils/calculatorUi'
export function extraGainToEffect(gain: ExtraBuffGain): BuffEffect {
  return {
    id: gain.id,
    scope: gain.scope ?? 'general',
    applyTarget: gain.applyTarget ?? 'self',
    applySituation: gain.applySituation ?? 'global',
    skillTargets: normalizeExtraGainSkillTargets(gain),
    skillCategory: gain.skillCategory,
    skillSubcategoryId: gain.skillSubcategoryId,
    appliesToAnomaly: gain.appliesToAnomaly,
    kind: 'fixed',
    stat: gain.stat,
    value: gain.value,
  }
}

export function buildSkillContextFromDamageEvent(
  event: DamageEvent,
  options: {
    ownerAgentId: string
    agents: Array<{ id: string; element?: string | null }>
    skillSubcategories: SkillSubcategory[]
    followUpSkillRules: Parameters<typeof resolveIsFollowUp>[0]['followUpSkillRules']
    resolveBuffElement: (ownerAgentId: string) => string | undefined
    resolveTriggerElement: (event: DamageEvent) => string | undefined
  },
): SkillCalcContext {
  const { damageKind, anomalySubKind } = mapEventKindToCalc(event.kind)
  const needsTrigger = eventNeedsAnomalyProducer(event.kind)
  const skillBound = event.skillBound !== false || damageKind === 'direct'
  const triggerElement = options.resolveTriggerElement(event)
  const ownerElement = options.resolveBuffElement(options.ownerAgentId)

  return {
    damageKind,
    categoryId: skillBound ? event.categoryId : 'basic',
    subcategoryId: skillBound ? (event.skillSubcategoryId ?? null) : null,
    element: needsTrigger ? triggerElement : ownerElement,
    staggerPhase: event.staggerPhase,
    isFollowUp: skillBound
      ? resolveIsFollowUp({
          agentId: options.ownerAgentId,
          categoryId: event.categoryId,
          subcategoryId: event.skillSubcategoryId,
          skillSubcategories: options.skillSubcategories,
          followUpSkillRules: options.followUpSkillRules,
        })
      : false,
    anomalySubKind,
  }
}

export function extraGainMatchesEvent(
  gain: ExtraBuffGain,
  skillCtx: SkillCalcContext,
): boolean {
  return effectMatchesContext(extraGainToEffect(gain), skillCtx)
}

export function mergeExtraModsForEvent(
  gains: ExtraBuffGain[],
  event: DamageEvent,
  skillCtx: SkillCalcContext,
  options: {
    /** 当前正在汇总面板的 agentId */
    slotAgentId: string
    ownerAgentId: string
    staggerPhase: StaggerPhase
  },
): BuffStatModifiers {
  let total = createEmptyBuffStatModifiers()
  for (const gain of gains) {
    const situation: BuffApplySituation = gain.applySituation ?? 'global'
    if (situation === 'stagger' && options.staggerPhase !== 'stagger') continue
    if (situation === 'non_stagger' && options.staggerPhase !== 'normal') continue
    if (!extraGainMatchesEvent(gain, skillCtx)) continue

    const applyTarget = gain.applyTarget ?? 'self'
    if (applyTarget === 'self' && options.slotAgentId !== options.ownerAgentId) continue

    const next = createEmptyBuffStatModifiers()
    next[gain.stat] = gain.value
    total = mergeBuffStatModifiers(total, next)
  }
  return total
}

export function resolveOwnerAgentIdForEvent(
  event: DamageEvent,
  mainAgentId: string,
): string {
  return resolveEventOwnerAgentId(event, mainAgentId)
}

export function scopeLabel(scope: BuffScope | undefined): string {
  const map: Record<BuffScope, string> = {
    general: '通用',
    skill: '招式',
    anomaly: '异常',
    disorder: '紊乱',
    turbulence: '乱流',
    anomalyRelease: '异放',
    radiance: '耀变',
    mutation: '异化系数',
  }
  return map[scope ?? 'general']
}

export function normalizeExtraGainSkillTargets(gain: ExtraBuffGain): BuffSkillTarget[] | undefined {
  if (gain.skillCategory) {
    return [
      {
        category: gain.skillCategory,
        subcategoryId: gain.skillSubcategoryId ?? null,
      },
    ]
  }
  return undefined
}
