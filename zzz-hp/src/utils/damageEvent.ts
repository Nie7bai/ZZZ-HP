import type {
  AnomalyDamageSubKind,
  DamageCalcKind,
  DamageEvent,
  DamageEventCritMode,
  DamageEventKind,
  DamageEventMultOverrides,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import { SKILL_CATEGORY_OPTIONS, TRIGGER_AGENT_AT_CALC } from '@/types/calculator'
import { computeDamageResult, type DamageCalcInput, type DamageCalcResult } from '@/utils/damageCalc'
import {
  canAgentBeAnomalyProducerForKind,
  findLuminousAgentInTeam,
  isLegacyAnomalyEventKind,
  isLuminousAgent,
  isLuminousElement,
} from '@/utils/remielUtils'
import {
  formatEventOwnerPrefix,
  isRadianceOwnerValid,
  resolveEventOwnerAgentId,
  resolveRadianceOwnerAgentId,
  RADIANCE_SELF_TRIGGER_HINT,
} from '@/utils/damageEventOwner'

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
    ownerAgentId: null,
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
  ownerName?: string,
): string {
  let core: string
  if (event.skillBound === false) {
    const kindLabel =
      DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === event.kind)?.label ?? event.kind
    core = kindLabel
  } else {
    const cat =
      SKILL_CATEGORY_OPTIONS.find((item) => item.id === event.categoryId)?.label ??
      (event.categoryId as SkillCategoryId)
    const sub = event.skillSubcategoryId
      ? resolveSubcategory?.(event.skillSubcategoryId)?.name
      : null
    core = sub ? `${cat} · ${sub}` : `${cat} · 整大类`
  }
  const prefix = ownerName ? formatEventOwnerPrefix(ownerName) : ''
  return prefix ? `${prefix}${core}` : core
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
  mainAgentId?: string
}

/** 乱流：主 C、事件产生角色或异常产生角色之一须为风属性 */
export function hasTurbulenceWindRole(
  agents: Array<{ id: string; element: string }>,
  mainAgentId: string,
  ownerAgentId: string,
  triggerAgentId: string | null,
): boolean {
  const elementOf = (id: string | null | undefined) =>
    id ? agents.find((agent) => agent.id === id)?.element : undefined
  return (
    elementOf(mainAgentId) === '风' ||
    elementOf(ownerAgentId) === '风' ||
    (triggerAgentId != null && elementOf(triggerAgentId) === '风')
  )
}

export function getTurbulenceParticipationFailureReason(
  ctx: Pick<DamageEventParticipationContext, 'teamSlots' | 'agents'>,
  mainAgentId: string,
  ownerAgentId: string,
  triggerAgentId: string | null,
): string | null {
  if (!isTurbulenceTeamCompositionOk(ctx.teamSlots, ctx.agents)) {
    return '乱流需队伍同时包含风属性与至少一个非风属性代理人'
  }
  if (!hasTurbulenceWindRole(ctx.agents, mainAgentId, ownerAgentId, triggerAgentId)) {
    return '乱流伤害需事件产生角色、异常产生角色或主 C 之一为风属性'
  }
  return null
}

/** 事件不参与汇总时的原因；null 表示可计算 */
export function getDamageEventSkipReason(
  event: DamageEvent,
  ctx: DamageEventParticipationContext,
): string | null {
  const mainSlot = ctx.teamSlots.find((slot) => slot.isMainC) ?? ctx.teamSlots[0]
  const mainAgentId = ctx.mainAgentId ?? mainSlot?.agentId ?? ''
  const mainAgent = ctx.agents.find((item) => item.id === mainSlot?.agentId)
  const ownerId = resolveEventOwnerAgentId(event, mainAgentId)
  const ownerAgent = ctx.agents.find((item) => item.id === ownerId)
  const remielInTeam = findLuminousAgentInTeam(ctx.teamSlots, ctx.agents)

  if (event.kind === 'radiance') {
    if (!remielInTeam) {
      return '队伍需编入蕾米埃尔（流明）才可计算耀变'
    }
    if (!isRadianceOwnerValid(event, mainAgentId, ctx.agents)) {
      return '耀变事件的产生角色必须是蕾米埃尔'
    }
    const rawId = event.triggerAgentId
    const triggerId = rawId && rawId !== TRIGGER_AGENT_AT_CALC ? rawId : null
    if (!triggerId) {
      return '请先选择耀变异常产生角色'
    }
    const producer = ctx.agents.find((item) => item.id === triggerId)
    if (!canAgentBeAnomalyProducerForKind(producer, 'radiance')) {
      return '耀变异常产生角色须为队内代理人'
    }
    return null
  }

  if (isLuminousAgent(ownerAgent) && isLegacyAnomalyEventKind(event.kind)) {
    return '蕾米埃尔产生的旧四类异常事件不参与计算（请改用耀变）'
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

  if (event.kind === 'turbulence') {
    const failure = getTurbulenceParticipationFailureReason(
      ctx,
      mainAgentId,
      ownerId,
      triggerId,
    )
    if (failure) return failure
  }

  return null
}

export function getRadianceEventHint(event: DamageEvent, ctx: DamageEventParticipationContext): string | null {
  if (event.kind !== 'radiance') return null
  const mainSlot = ctx.teamSlots.find((slot) => slot.isMainC) ?? ctx.teamSlots[0]
  const mainAgentId = ctx.mainAgentId ?? mainSlot?.agentId ?? ''
  const remielId = resolveRadianceOwnerAgentId(ctx.teamSlots, ctx.agents)
  const triggerId =
    event.triggerAgentId && event.triggerAgentId !== TRIGGER_AGENT_AT_CALC
      ? event.triggerAgentId
      : null
  if (remielId && triggerId === remielId) {
    return RADIANCE_SELF_TRIGGER_HINT
  }
  const ownerId = resolveEventOwnerAgentId(event, mainAgentId)
  if (remielId && ownerId === remielId && triggerId && triggerId !== remielId) {
    return null
  }
  return null
}

export function filterAnomalyProducerAgentOptions<
  T extends { id: string; element?: string | null },
>(agents: T[], kind: DamageEventKind): T[] {
  return agents.filter((agent) => canAgentBeAnomalyProducerForKind(agent, kind))
}

/** @deprecated 使用 getDamageEventKindOptionsForMode */
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

/** 乱流伤害事件：队伍须含风 + 另一属性；具体风角色由事件产生/异常产生/主 C 校验 */
export function canSelectTurbulenceDamageEvent(
  teamSlots: Array<{ agentId: string }>,
  agents: Array<{ id: string; element: string }>,
  _mainAgentElement?: string | null,
): boolean {
  return isTurbulenceTeamCompositionOk(teamSlots, agents)
}

export function isTriggerAgentAtCalc(id: string | null | undefined): boolean {
  return id === TRIGGER_AGENT_AT_CALC || id == null || id === ''
}

/** 耀变综合增伤/倍率/特殊倍率乘区取主 C 面板；覆写也应写入主 C 侧 */
export function applyRadianceBonusMultOverrides(
  panel: PanelStats,
  overrides: DamageEventMultOverrides | null | undefined,
): PanelStats {
  if (!overrides) return panel
  const hasOverride =
    overrides.radianceMult != null ||
    overrides.radianceMultFactor != null ||
    overrides.specialMult != null ||
    overrides.specialMultFactor != null
  if (!hasOverride) return panel
  const next = { ...panel }
  if (overrides.radianceMult != null) next.radianceMult = overrides.radianceMult
  if (overrides.radianceMultFactor != null) {
    next.radianceMultFactor = overrides.radianceMultFactor
  }
  if (overrides.specialMult != null) next.specialMult = overrides.specialMult
  if (overrides.specialMultFactor != null) {
    next.specialMultFactor = overrides.specialMultFactor
  }
  return next
}

/** 事件倍率覆写（不含耀变主 C _bonus 字段） */
export function applyOwnerPanelMultOverrides(
  panel: PanelStats,
  overrides: DamageEventMultOverrides | null | undefined,
): PanelStats {
  if (!overrides) return panel
  const next = { ...panel }
  if (overrides.directDmgMult != null) next.directDmgMult = overrides.directDmgMult
  if (overrides.settlementDmgMult != null) next.settlementDmgMult = overrides.settlementDmgMult
  if (overrides.directDmgMultFactor != null) {
    next.directDmgMultFactor = overrides.directDmgMultFactor
  }
  if (overrides.anomalyMult != null) next.anomalyMult = overrides.anomalyMult
  if (overrides.anomalyMultFactor != null) next.anomalyMultFactor = overrides.anomalyMultFactor
  if (overrides.anomalyReleaseMult != null) {
    next.anomalyReleaseMult = overrides.anomalyReleaseMult
  }
  if (overrides.anomalyReleaseMultFactor != null) {
    next.anomalyReleaseMultFactor = overrides.anomalyReleaseMultFactor
  }
  if (overrides.disorderBaseMult != null) next.disorderBaseMult = overrides.disorderBaseMult
  if (overrides.disorderBaseMultFactor != null) {
    next.disorderBaseMultFactor = overrides.disorderBaseMultFactor
  }
  if (overrides.disorderCompMult != null) next.disorderCompMult = overrides.disorderCompMult
  if (overrides.turbulenceBaseMult != null) next.turbulenceBaseMult = overrides.turbulenceBaseMult
  if (overrides.turbulenceBaseMultFactor != null) {
    next.turbulenceBaseMultFactor = overrides.turbulenceBaseMultFactor
  }
  if (overrides.turbulenceCompMult != null) next.turbulenceCompMult = overrides.turbulenceCompMult
  return next
}

export function resolveRadianceBonusMultDefaults(
  bonusPanel: Pick<
    PanelStats,
    'radianceMult' | 'radianceMultFactor' | 'specialMult' | 'specialMultFactor'
  >,
): Partial<Record<keyof DamageEventMultOverrides, number>> {
  return {
    radianceMult: bonusPanel.radianceMult,
    radianceMultFactor: bonusPanel.radianceMultFactor,
    specialMult: bonusPanel.specialMult ?? 100,
    specialMultFactor: bonusPanel.specialMultFactor ?? 100,
  }
}

export function summarizeDamageEvents(
  events: DamageEvent[],
  buildInput: (event: DamageEvent) => DamageCalcInput | null,
  resolveSubcategory?: (id: string | null) => SkillSubcategory | null,
  resolveOwnerName?: (event: DamageEvent) => string | undefined,
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
    const ownerName = resolveOwnerName?.(event)
    const displayName = formatDamageEventDisplayName(event, resolveSubcategory, ownerName)
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
