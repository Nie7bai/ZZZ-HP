import type {
  AnomalyDamageSubKind,
  DamageCalcKind,
  DamageEvent,
  DamageEventCritMode,
  DamageEventKind,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import { SKILL_CATEGORY_OPTIONS } from '@/types/calculator'
import { computeDamageResult, type DamageCalcInput, type DamageCalcResult } from '@/utils/damageCalc'

export const DAMAGE_EVENT_KIND_OPTIONS: { id: DamageEventKind; label: string }[] = [
  { id: 'direct', label: '直伤' },
  { id: 'anomaly', label: '异常' },
  { id: 'disorder', label: '紊乱' },
  { id: 'anomalyRelease', label: '异放' },
  { id: 'turbulence', label: '乱流' },
]

export const DAMAGE_EVENT_CRIT_MODE_OPTIONS: { id: DamageEventCritMode; label: string }[] = [
  { id: 'expected', label: '期望' },
  { id: 'noCrit', label: '不暴击' },
  { id: 'fullCrit', label: '必暴击' },
]

export function createEmptyDamageEvent(
  index = 0,
  kind: DamageEventKind = 'direct',
): DamageEvent {
  return {
    id: `evt-local-${Date.now().toString(36)}-${index}`,
    kind,
    categoryId: 'basic',
    skillSubcategoryId: null,
    count: 1,
    staggerPhase: 'stagger',
    critMode: 'expected',
    triggerAgentId: null,
    multOverrides: null,
  }
}

export function mapEventKindToCalc(
  kind: DamageEventKind,
): { damageKind: DamageCalcKind; anomalySubKind: AnomalyDamageSubKind } {
  if (kind === 'direct') {
    return { damageKind: 'direct', anomalySubKind: 'anomaly' }
  }
  if (kind === 'anomaly') {
    return { damageKind: 'anomaly', anomalySubKind: 'anomaly' }
  }
  if (kind === 'disorder') {
    return { damageKind: 'anomaly', anomalySubKind: 'disorder' }
  }
  if (kind === 'anomalyRelease') {
    return { damageKind: 'anomaly', anomalySubKind: 'anomalyRelease' }
  }
  return { damageKind: 'anomaly', anomalySubKind: 'turbulence' }
}

export function pickEventDamage(
  result: DamageCalcResult,
  kind: DamageEventKind,
  critMode: DamageEventCritMode,
): number {
  if (kind === 'direct') {
    if (critMode === 'noCrit') {
      return (
        result.generalMultiplier *
        result.specialMultiplier *
        result.pierceDmgMultiplier *
        result.directDmgMultZone
      )
    }
    if (critMode === 'fullCrit') {
      const preCrit =
        result.generalMultiplier *
        result.specialMultiplier *
        result.pierceDmgMultiplier *
        result.directDmgMultZone
      return preCrit * (1 + result.critDmgRatio)
    }
    return result.directDamageExpected
  }
  if (kind === 'anomaly') {
    if (critMode === 'noCrit') return result.anomalyExpectedNoCrit
    if (critMode === 'fullCrit') return result.anomalyExpectedFullCrit
    return result.anomalyExpected
  }
  if (kind === 'disorder') return result.disorderExpected
  if (kind === 'anomalyRelease') {
    if (critMode === 'noCrit') return result.anomalyReleaseExpectedNoCrit
    if (critMode === 'fullCrit') return result.anomalyReleaseExpectedFullCrit
    return result.anomalyReleaseExpected
  }
  if (critMode === 'noCrit') return result.turbulenceExpectedNoCrit
  if (critMode === 'fullCrit') return result.turbulenceExpectedFullCrit
  return result.turbulenceExpected
}

export function disorderLabelFromResult(result: DamageCalcResult): string {
  return result.hasPolarDisorder ? '极性紊乱' : '紊乱伤害'
}

export interface DamageEventLine {
  event: DamageEvent
  perHit: number
  total: number
  /** @deprecated 含种类前缀，展示请用 displayName */
  label: string
  displayName: string
  result: DamageCalcResult
}

/** 伤害事件展示名（不含直伤/异常等种类前缀） */
export function formatDamageEventDisplayName(
  event: DamageEvent,
  resolveSubcategory?: (id: string | null) => SkillSubcategory | null,
): string {
  const cat =
    SKILL_CATEGORY_OPTIONS.find((item) => item.id === event.categoryId)?.label ??
    (event.categoryId as SkillCategoryId)
  const sub = event.skillSubcategoryId
    ? resolveSubcategory?.(event.skillSubcategoryId)?.name
    : null
  return sub ? `${cat} · ${sub}` : `${cat} · 整大类`
}

export function summarizeDamageEvents(
  events: DamageEvent[],
  buildInput: (event: DamageEvent) => DamageCalcInput | null,
  resolveSubcategory?: (id: string | null) => SkillSubcategory | null,
): { lines: DamageEventLine[]; grandTotal: number } {
  const lines: DamageEventLine[] = []
  let grandTotal = 0
  for (const event of events) {
    const input = buildInput(event)
    if (!input) continue
    const result = computeDamageResult(input)
    const perHit = pickEventDamage(result, event.kind, event.critMode)
    const total = perHit * Math.max(0, event.count)
    const kindLabel =
      DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === event.kind)?.label ?? event.kind
    const disorderSuffix =
      event.kind === 'disorder' ? `（${disorderLabelFromResult(result)}）` : ''
    const displayName = formatDamageEventDisplayName(event, resolveSubcategory)
    lines.push({
      event,
      perHit,
      total,
      label: `${kindLabel}${disorderSuffix}`,
      displayName:
        event.kind === 'disorder'
          ? `${displayName}（${disorderLabelFromResult(result)}）`
          : displayName,
      result,
    })
    grandTotal += total
  }
  return { lines, grandTotal }
}
