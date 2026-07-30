import type {
  AnomalyDamageSubKind,
  DamageCalcKind,
  DamageEvent,
  DamageEventCritMode,
  DamageEventKind,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import { SKILL_CATEGORY_OPTIONS, TRIGGER_AGENT_AT_CALC } from '@/types/calculator'
import { computeDamageResult, type DamageCalcInput, type DamageCalcResult } from '@/utils/damageCalc'
import {
  canAgentBeAnomalyProducerForKind,
  isLegacyAnomalyEventKind,
  isLuminousAgent,
  isLuminousElement,
} from '@/utils/remielUtils'

export const DAMAGE_EVENT_KIND_OPTIONS: { id: DamageEventKind; label: string }[] = [
  { id: 'direct', label: '直伤' },
  { id: 'anomaly', label: '异常' },
  { id: 'disorder', label: '紊乱' },
  { id: 'anomalyRelease', label: '异放' },
  { id: 'turbulence', label: '乱流' },
  { id: 'radiance', label: '耀变' },
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
  const isAnomaly = kind !== 'direct'
  return {
    id: `evt-local-${Date.now().toString(36)}-${index}`,
    kind,
    categoryId: 'basic',
    skillSubcategoryId: null,
    count: 1,
    staggerPhase: 'stagger',
    critMode: 'expected',
    // 计算页默认待选；管理端在编辑器里通过 allowCalcTimeTrigger 写入 __at_calc__
    triggerAgentId: null,
    skillBound: !isAnomaly,
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
  if (kind === 'radiance') {
    return { damageKind: 'anomaly', anomalySubKind: 'radiance' }
  }
  return { damageKind: 'anomaly', anomalySubKind: 'turbulence' }
}

export function pickEventDamage(
  result: DamageCalcResult,
  kind: DamageEventKind,
  critMode: DamageEventCritMode,
): number {
  if (kind === 'direct') {
    const baseChain =
      result.generalMultiplier *
      result.specialMultiplier *
      result.pierceDmgMultiplier
    const multSum = result.directDmgMultZone + result.settlementDmgMultZone
    if (critMode === 'noCrit') {
      return baseChain * multSum
    }
    if (critMode === 'fullCrit') {
      return baseChain * multSum * (1 + result.critDmgRatio)
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
  if (kind === 'radiance') {
    if (critMode === 'noCrit') return result.radianceExpectedNoCrit
    if (critMode === 'fullCrit') return result.radianceExpectedFullCrit
    return result.radianceExpected
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

/** 伤害事件展示名（不含直伤/异常等种类前缀；不暴露内部 id） */
export function formatDamageEventDisplayName(
  event: DamageEvent,
  resolveSubcategory?: (id: string | null) => SkillSubcategory | null,
): string {
  if (event.skillBound === false) {
    const kindLabel =
      DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === event.kind)?.label ?? event.kind
    return kindLabel
  }
  const cat =
    SKILL_CATEGORY_OPTIONS.find((item) => item.id === event.categoryId)?.label ??
    (event.categoryId as SkillCategoryId)
  const sub = event.skillSubcategoryId
    ? resolveSubcategory?.(event.skillSubcategoryId)?.name
    : null
  return sub ? `${cat} · ${sub}` : `${cat} · 整大类`
}

export function eventNeedsAnomalyProducer(kind: DamageEventKind): boolean {
  return (
    kind === 'disorder' ||
    kind === 'turbulence' ||
    kind === 'anomalyRelease' ||
    kind === 'radiance'
  )
}

export interface DamageEventParticipationContext {
  teamSlots: Array<{ agentId: string; isMainC?: boolean }>
  agents: Array<{ id: string; element: string; name?: string }>
  turbulenceCalculable: boolean
}

/** 事件不参与汇总时的原因；null 表示可计算 */
export function getDamageEventSkipReason(
  event: DamageEvent,
  ctx: DamageEventParticipationContext,
): string | null {
  const mainSlot = ctx.teamSlots.find((slot) => slot.isMainC) ?? ctx.teamSlots[0]
  const mainAgent = ctx.agents.find((item) => item.id === mainSlot?.agentId)
  const mainIsLuminous = isLuminousAgent(mainAgent)

  if (event.kind === 'radiance') {
    if (!mainIsLuminous) {
      return '耀变事件仅主 C 为蕾米埃尔（流明）时可计算'
    }
    const rawId = event.triggerAgentId
    const triggerId = rawId && rawId !== TRIGGER_AGENT_AT_CALC ? rawId : null
    if (!triggerId) {
      return '请先选择耀变异常产生角色（须为非蕾米埃尔队友）'
    }
    const producer = ctx.agents.find((item) => item.id === triggerId)
    if (!canAgentBeAnomalyProducerForKind(producer, 'radiance')) {
      return '耀变产生角色须为非蕾米埃尔队友'
    }
    return null
  }

  if (mainIsLuminous && isLegacyAnomalyEventKind(event.kind)) {
    return '蕾米埃尔为主 C 时，旧四类异常事件不参与计算（请改用耀变或切换主 C）'
  }

  const rawTriggerId = event.triggerAgentId
  const triggerId =
    eventNeedsAnomalyProducer(event.kind) && rawTriggerId && rawTriggerId !== TRIGGER_AGENT_AT_CALC
      ? rawTriggerId
      : null

  if (eventNeedsAnomalyProducer(event.kind) && !triggerId) {
    return '请先选择当前属性异常的产生角色'
  }

  if (triggerId) {
    const producer = ctx.agents.find((item) => item.id === triggerId)
    if (isLuminousAgent(producer)) {
      return '旧四类异常产生角色不能为蕾米埃尔（流明）'
    }
  }

  if (event.kind === 'turbulence' && !ctx.turbulenceCalculable) {
    if (mainAgent?.element !== '风') {
      return '乱流伤害仅风属性代理人为主 C 时可计算'
    }
    return '乱流需队伍同时包含风属性与至少一个非风属性代理人'
  }

  return null
}

export function filterAnomalyProducerAgentOptions<
  T extends { id: string; element?: string | null },
>(agents: T[], kind: DamageEventKind): T[] {
  return agents.filter((agent) => canAgentBeAnomalyProducerForKind(agent, kind))
}

export function filterDamageEventKindOptionsForMainAgent(
  options: { id: DamageEventKind; label: string }[],
  mainAgentElement: string | null | undefined,
  modeType: 'direct' | 'anomaly',
): { id: DamageEventKind; label: string }[] {
  if (modeType === 'direct') {
    return options.filter((opt) => opt.id === 'direct')
  }
  if (isLuminousElement(mainAgentElement ?? null)) {
    return options.filter((opt) => opt.id === 'radiance')
  }
  return options.filter((opt) => opt.id !== 'direct' && opt.id !== 'radiance')
}

/** 队伍中是否同时存在风属性与至少一个非风属性代理人 */
export function isTurbulenceTeamCompositionOk(
  teamSlots: Array<{ agentId: string }>,
  agents: Array<{ id: string; element: string }>,
): boolean {
  const elements = new Set(
    teamSlots
      .map((slot) => agents.find((agent) => agent.id === slot.agentId)?.element)
      .filter((element): element is string => Boolean(element)),
  )
  return elements.has('风') && [...elements].some((element) => element !== '风')
}

/** 乱流伤害事件：主 C 须为风，且队伍须含风 + 另一属性代理人 */
export function canSelectTurbulenceDamageEvent(
  teamSlots: Array<{ agentId: string }>,
  agents: Array<{ id: string; element: string }>,
  mainAgentElement?: string | null,
): boolean {
  return mainAgentElement === '风' && isTurbulenceTeamCompositionOk(teamSlots, agents)
}

export function isTriggerAgentAtCalc(id: string | null | undefined): boolean {
  return id === TRIGGER_AGENT_AT_CALC || id == null || id === ''
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
