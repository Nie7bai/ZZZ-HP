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
import { type DamageCalcResult } from '@/utils/damageCalc'
import {
  canAgentBeAnomalyProducerForKind,
  findLuminousAgentInTeam,
  isLegacyAnomalyEventKind,
  isLuminousAgent,
} from '@/utils/remielUtils'
import {
  formatEventOwnerPrefix,
  isRadianceOwnerValid,
  resolveEventOwnerAgentId,
} from '@/utils/damageEventOwner'

export const DAMAGE_EVENT_KIND_OPTIONS: { id: DamageEventKind; label: string }[] = [
  { id: 'direct', label: '直伤' },
  { id: 'sharpen', label: '锐化' },
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

export function mapEventKindToCalc(
  kind: DamageEventKind,
): { damageKind: DamageCalcKind; anomalySubKind: AnomalyDamageSubKind } {
  if (kind === 'direct' || kind === 'sharpen') {
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
  if (kind === 'direct' || kind === 'sharpen') {
    if (result.useSharpenFormula) {
      const perZone =
        result.sharpenCritZone > 0
          ? result.directDamageExpected / result.sharpenCritZone
          : result.directDamageExpected
      if (critMode === 'noCrit') return perZone * result.sharpenCritZoneNoCrit
      if (critMode === 'fullCrit') return perZone * result.sharpenCritZoneFullCrit
      return result.directDamageExpected
    }
    const perCrit =
      result.critMultiplier > 0
        ? result.directDamageExpected / result.critMultiplier
        : result.directDamageExpected
    if (critMode === 'noCrit') return perCrit
    if (critMode === 'fullCrit') return perCrit * (1 + result.critDmgRatio)
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

/**
 * 流程卡外侧汇总用暴击模式：
 * 异常 / 乱流 / 异放固定必暴击；直伤、紊乱、耀变仍跟随条目 critMode。
 */
export function resolveFlowHitCritMode(
  damageType: DamageEventKind,
  entryCritMode: DamageEventCritMode,
): DamageEventCritMode {
  if (
    damageType === 'anomaly' ||
    damageType === 'turbulence' ||
    damageType === 'anomalyRelease'
  ) {
    return 'fullCrit'
  }
  return entryCritMode
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
  teamSlots: Array<{ agentId: string }>
  agents: Array<{ id: string; element: string; name?: string }>
  mainAgentId?: string
}

/** 乱流：异常类触发者须为风属性 */
export function isTurbulenceWindTrigger(
  agents: Array<{ id: string; element: string }>,
  triggerAgentId: string | null | undefined,
): boolean {
  if (!triggerAgentId) return false
  return agents.find((agent) => agent.id === triggerAgentId)?.element === '风'
}

export function getTurbulenceParticipationFailureReason(
  ctx: Pick<DamageEventParticipationContext, 'teamSlots' | 'agents'>,
  _ownerAgentId: string,
  _powerAgentId: string | null,
  triggerAgentId: string | null,
): string | null {
  if (!isTurbulenceTeamCompositionOk(ctx.teamSlots, ctx.agents)) {
    return '乱流需队伍同时包含风属性与至少一个非风属性代理人'
  }
  if (!isTurbulenceWindTrigger(ctx.agents, triggerAgentId)) {
    return '乱流仅当异常类触发者为风属性角色时才能生效'
  }
  return null
}

/** 事件不参与汇总时的原因；null 表示可计算 */
export function getDamageEventSkipReason(
  event: DamageEvent,
  ctx: DamageEventParticipationContext,
): string | null {
  const mainSlot = ctx.teamSlots[0]
  const mainAgentId = ctx.mainAgentId ?? mainSlot?.agentId ?? ''
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
    if (!isLuminousAgent(producer)) {
      return '耀变仅当异常类触发者为蕾米埃尔时才能生效'
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
    const failure = getTurbulenceParticipationFailureReason(ctx, ownerId, triggerId, triggerId)
    if (failure) return failure
  }

  return null
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


/** 耀变综合增伤/倍率/特殊倍率乘区取异常类触发者面板；覆写也应写入触发者侧 */
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

export interface SkillZoneMultResolved {
  panelOverrides: DamageEventMultOverrides | null | undefined
  disorderZoneMult?: number | null
  disorderZoneMultFactor?: number | null
  turbulenceZoneMult?: number | null
  turbulenceZoneMultFactor?: number | null
}

/**
 * 招式倍率填写（紊乱/乱流）语义为最终倍率区%，不是面板基础倍率。
 * 拆出 zone 覆写，并剥离会误入面板的 base 字段（含旧存档 disorderBaseMult）。
 */
export function splitSkillZoneMultOverrides(
  damageType: DamageEventKind,
  overrides: DamageEventMultOverrides | null | undefined,
): SkillZoneMultResolved {
  if (!overrides) return { panelOverrides: overrides }

  if (damageType === 'disorder') {
    const zone = overrides.disorderZoneMult ?? overrides.disorderBaseMult
    if (zone != null) {
      const {
        disorderZoneMult: _zone,
        disorderBaseMult: _base,
        disorderBaseMultFactor: _factor,
        ...rest
      } = overrides
      return {
        panelOverrides: Object.keys(rest).length ? rest : null,
        disorderZoneMult: zone,
        disorderZoneMultFactor: overrides.disorderBaseMultFactor ?? 100,
      }
    }
  }

  if (damageType === 'turbulence') {
    const zone = overrides.turbulenceZoneMult ?? overrides.turbulenceBaseMult
    if (zone != null) {
      const {
        turbulenceZoneMult: _zone,
        turbulenceBaseMult: _base,
        turbulenceBaseMultFactor: _factor,
        ...rest
      } = overrides
      return {
        panelOverrides: Object.keys(rest).length ? rest : null,
        turbulenceZoneMult: zone,
        turbulenceZoneMultFactor: overrides.turbulenceBaseMultFactor ?? 100,
      }
    }
  }

  return { panelOverrides: overrides }
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

