import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import type {
  AgentBuffDoc,
  AnomalyDamageSubKind,
  BangbooBuffDoc,
  BaseDamageSource,
  BuffStatModifiers,
  DamageEvent,
  DamageEventKind,
  DriveDiscBuffDoc,
  SkillCalcContext,
  SkillSubcategory,
  WengineBuffDoc,
} from '@/types/calculator'
import type { AffixCounts, AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'
import { createEmptyAffixCounts, createDefaultExternalPanel } from '@/types/calculatorPanel'
import {
  AFFIX_VALUE_PER_COUNT,
  computeExternalPanelFromAffixes,
  type AffixPanelCalcInput,
} from '@/utils/affixPanelCalc'
import {
  createEmptyAgentBasePanel,
  createEmptyBuffStatModifiers,
  createEmptyWengineAdvancedStats,
} from '@/utils/calculatorUi'
import {
  computeDamageResult,
  type DamageCalcResult,
  type DamageEnemyInput,
} from '@/utils/damageCalc'
import {
  eventNeedsAnomalyProducer,
  mapEventKindToCalc,
  pickEventDamage,
  canSelectTurbulenceDamageEvent,
  formatDamageEventDisplayName,
  getDamageEventSkipReason,
} from '@/utils/damageEvent'
import { resolveEventOwnerAgentId } from '@/utils/damageEventOwner'
import { buildSkillContextFromDamageEvent, mergeExtraModsForEvent } from '@/utils/extraBuffCalc'
import {
  computeMutationZone,
  findLuminousAgentInTeam,
  isLuminousElement,
  resolveLuminousEquivalentElement,
} from '@/utils/remielUtils'
import {
  computeFinalPanel,
  convertSlotPartialToExternalPanel,
  resolveMainCAnomalyReleaseMultFields,
  type BuffSelectionState,
  type MultiSlotBuffSelection,
  type PanelCalcContext,
  resolveBuffSelectionForSlot,
  panelToConvertAttrValues,
  buildPanelSourceValuesBySlotRecord,
} from '@/utils/panelBuffCalc'
import { resolveIsFollowUp } from '@/utils/buffEffect'

export type OptimalDamageKind = 'direct' | 'anomaly'

export type OptimalAnomalyMetric = 'anomaly' | 'disorder' | 'turbulence' | 'anomalyRelease' | 'radiance'

export type OptimalAffixKey =
  | 'atkFlat'
  | 'hpFlat'
  | 'atkPercent'
  | 'hpPercent'
  | 'pen'
  | 'critRate'
  | 'critDmg'
  | 'mastery'

export const DIRECT_CONSTRAINTS = {
  maxTotalRolls: 46,
  maxAtkPenTotal: 54,
} as const

export const ANOMALY_CONSTRAINTS = {
  maxTotalRolls: 41,
  maxAtkPenTotal: 53,
} as const

/** 无对应主词条时的副词条上限基数；每出现 1 次同类主词条减 6 */
export const AFFIX_ROLL_CAP_BASE = 36
export const AFFIX_ROLL_CAP_PER_MAIN = 6

export const BENEFIT_CURVE_MAX_ADDED = 10

const MB_PROFESSION = '命破'
const AFFIX_IMPACT_EPS = 0.001

export interface OptimalEventDamageLine {
  eventId: string
  displayName: string
  kind: DamageEventKind
  perHit: number
  total: number
  usesNonMainProducer: boolean
  mainlyProducerDriven: boolean
}

export interface OptimalEventAffixImpact extends OptimalEventDamageLine {
  maxAffixDelta: number
  affixSensitive: boolean
  reason: string
}

export interface OptimalEventEvalDetail {
  event: DamageEvent
  eventId: string
  displayName: string
  kind: DamageEventKind
  perHit: number
  total: number
  usesNonMainProducer: boolean
  mainlyProducerDriven: boolean
  result: DamageCalcResult
  finalPanel: PanelStats
  external: PanelStats
  breakdown: OptimalPanelBreakdown
  piercePower: number
  anomalySubKind: AnomalyDamageSubKind
  producerFinalPanel?: PanelStats
  producerExternalPanel?: PanelStats
  producerBreakdown?: OptimalPanelBreakdown
  producerAgentLabel?: string
}

/** 受 4/5/6 主词条计数约束的副词条 */
export type CappedAffixKey = 'atkPercent' | 'hpPercent' | 'critRate' | 'critDmg' | 'mastery'

export type AffixRollCaps = Record<CappedAffixKey, number>

/** 副词条 key → 对应主词条 id */
const CAPPED_AFFIX_TO_MAIN_STAT: Record<CappedAffixKey, string> = {
  atkPercent: 'externalAtkPercent',
  hpPercent: 'externalHpPercent',
  critRate: 'critRate',
  critDmg: 'critDmg',
  mastery: 'mastery',
}

export function countDriveDiscMainStat(
  mainStats: AffixDriveDiscMainStats,
  id: string,
): number {
  let count = 0
  if (mainStats.slot4MainStat === id) count += 1
  if (mainStats.slot5MainStat === id) count += 1
  if (mainStats.slot6MainStat === id) count += 1
  return count
}

/** 副词条条数上限：有对应主词条时为 max(0, 36 - 6x)；否则无上限 */
export function affixRollCap(
  mainStats: AffixDriveDiscMainStats,
  affixKey: OptimalAffixKey | CappedAffixKey,
): number {
  const mainId = (CAPPED_AFFIX_TO_MAIN_STAT as Record<string, string | undefined>)[affixKey]
  if (!mainId) return Number.POSITIVE_INFINITY
  const x = countDriveDiscMainStat(mainStats, mainId)
  return Math.max(0, AFFIX_ROLL_CAP_BASE - AFFIX_ROLL_CAP_PER_MAIN * x)
}

export function getAffixRollCaps(mainStats: AffixDriveDiscMainStats): AffixRollCaps {
  return {
    atkPercent: affixRollCap(mainStats, 'atkPercent'),
    hpPercent: affixRollCap(mainStats, 'hpPercent'),
    critRate: affixRollCap(mainStats, 'critRate'),
    critDmg: affixRollCap(mainStats, 'critDmg'),
    mastery: affixRollCap(mainStats, 'mastery'),
  }
}

function isCappedAffixKey(key: string): key is CappedAffixKey {
  return key in CAPPED_AFFIX_TO_MAIN_STAT
}

function exceedsAffixCap(
  mainStats: AffixDriveDiscMainStats,
  key: OptimalAffixKey,
  count: number,
): boolean {
  if (!isCappedAffixKey(key)) return false
  return count > affixRollCap(mainStats, key)
}

export interface DirectAllocState {
  /** 攻击力条数（非命破为主 flat；命破时也需填写） */
  flatStat: number
  /** 命破：生命值条数 */
  hpFlat: number
  /** 命破：局外大攻击条数（固定填写，不参与扫掠） */
  atkPercent: number
  pen: number
  critRate: number
  /** 非命破 = 暴击 + 爆伤 + 局外大攻击；命破 = 暴击 + 爆伤 + 局外大生命 + 局外大攻击 */
  totalRolls: number
}

export interface AnomalyAllocState {
  flatStat: number
  pen: number
  /** = 精通 + 局外大攻/大生命 */
  totalRolls: number
}

export interface OptimalEvalContext {
  isMb: boolean
  agentBase: AffixPanelCalcInput['agentBase']
  wengineBaseAtk: number
  wengineAdvanced: AffixPanelCalcInput['wengineAdvanced']
  driveDiscSelection: AffixPanelCalcInput['driveDiscSelection']
  driveDiscMainStats: AffixDriveDiscMainStats
  driveDiscs: DriveDiscBuffDoc[]
  panelContext: PanelCalcContext
  enemyInput: DamageEnemyInput
  baseDamageSource: BaseDamageSource
  mainAgentElement: string
  mainAgentId: string
  mainAgentName: string
  /** 伤害事件列表：有则最优词条按事件总伤期望扫掠 */
  damageEvents?: DamageEvent[]
  /** 额外 Buff（按事件 scope 匹配，与面板计算共用） */
  extraGains?: ExtraBuffGain[]
  triggerAnomalyAgentId?: string | null
  slotBuffSelections?: MultiSlotBuffSelection | null
  resolveSubcategory?: (id: string | null) => SkillSubcategory | null
  skillSubcategories?: SkillSubcategory[]
  followUpSkillRules?: import('@/types/calculator').FollowUpSkillRule[]
}

export interface DirectSweepPoint {
  /** 非命破：局外大攻击；命破：局外大生命 */
  outPercent: number
  critDmg: number
  label: string
  affixCounts: AffixCounts
  /** 扫掠路径下可省略，详情区会单独 evaluate */
  result?: DamageCalcResult
  directExpected: number
  eventLines: OptimalEventDamageLine[]
  grandTotal: number
}

export interface AnomalySweepPoint {
  outPercent: number
  mastery: number
  label: string
  affixCounts: AffixCounts
  result?: DamageCalcResult
  anomalyExpected: number
  disorderExpected: number
  turbulenceExpected: number
  anomalyReleaseExpected: number
  radianceExpected: number
  eventLines: OptimalEventDamageLine[]
  grandTotal: number
}

export interface AffixDiffRow {
  key: OptimalAffixKey
  label: string
  currentCount: number
  currentValue: number
  addOne: number
  damageDelta: number
  percentDelta: number
}

export interface AffixReplaceRow {
  key: OptimalAffixKey
  label: string
  removeOne: number
  bestReplaceKey: OptimalAffixKey
  bestReplaceLabel: string
  addOne: number
  damageDelta: number
  percentDelta: number
}

export interface BenefitCurveSeries {
  key: OptimalAffixKey
  label: string
  color: string
  /** index 0 unused; values[n] = cumulative % after adding n rolls */
  cumulativePercent: number[]
  /** values[n] = marginal % of the n-th roll */
  marginalPercent: number[]
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function flatStatKey(isMb: boolean): 'atkFlat' | 'hpFlat' {
  return isMb ? 'hpFlat' : 'atkFlat'
}

export function outPercentKey(isMb: boolean): 'atkPercent' | 'hpPercent' {
  return isMb ? 'hpPercent' : 'atkPercent'
}

export function flatStatLabel(isMb: boolean) {
  return isMb ? '生命值' : '攻击力'
}

export function outPercentLabel(isMb: boolean) {
  return isMb ? '局外大生命' : '局外大攻击'
}

export function affixKeyLabel(key: OptimalAffixKey, isMb: boolean): string {
  switch (key) {
    case 'atkFlat':
      return '攻击力'
    case 'hpFlat':
      return '生命值'
    case 'atkPercent':
      return '局外大攻击'
    case 'hpPercent':
      return '局外大生命'
    case 'pen':
      return '穿透值'
    case 'critRate':
      return '暴击'
    case 'critDmg':
      return '爆伤'
    case 'mastery':
      return '精通'
  }
}

export function validateDirectAlloc(
  state: DirectAllocState,
  isMb = false,
  mainStats?: AffixDriveDiscMainStats,
): string | null {
  const atkFlat = clampInt(state.flatStat, 0, 99)
  const hpFlat = clampInt(state.hpFlat, 0, 99)
  const pen = clampInt(state.pen, 0, 99)
  const crit = clampInt(state.critRate, 0, DIRECT_CONSTRAINTS.maxTotalRolls)
  const total = clampInt(state.totalRolls, 0, DIRECT_CONSTRAINTS.maxTotalRolls)
  const fixedAtkPercent = isMb ? clampInt(state.atkPercent, 0, 99) : 0
  if (total < crit) return '总词条数不能小于暴击条数'
  if (isMb && total < crit + fixedAtkPercent) {
    return '总词条数不能小于暴击与局外大攻击条数之和'
  }
  if (total > DIRECT_CONSTRAINTS.maxTotalRolls) {
    return `总词条数不能超过 ${DIRECT_CONSTRAINTS.maxTotalRolls}`
  }
  const flatPenTotal = isMb
    ? atkFlat + hpFlat + pen + total
    : atkFlat + pen + total
  if (flatPenTotal > DIRECT_CONSTRAINTS.maxAtkPenTotal) {
    return isMb
      ? `攻击力+生命值+穿透+总词条数不能超过 ${DIRECT_CONSTRAINTS.maxAtkPenTotal}`
      : `${flatStatLabel(isMb)}+穿透+总词条数不能超过 ${DIRECT_CONSTRAINTS.maxAtkPenTotal}`
  }
  if (mainStats) {
    const caps = getAffixRollCaps(mainStats)
    if (crit > caps.critRate) {
      return `暴击条数不能超过主词条约束上限 ${caps.critRate}`
    }
    const remain = isMb ? total - crit - fixedAtkPercent : total - crit
    if (isMb) {
      if (fixedAtkPercent > caps.atkPercent) {
        return `局外大攻击条数不能超过主词条约束上限 ${caps.atkPercent}`
      }
      if (remain > caps.hpPercent + caps.critDmg) {
        return `局外大生命+爆伤可分配余量 ${remain} 超出主词条约束上限（局外大生命≤${caps.hpPercent}，爆伤≤${caps.critDmg}）`
      }
    } else {
      const outCap = caps.atkPercent
      const outName = outPercentLabel(isMb)
      if (remain > outCap + caps.critDmg) {
        return `${outName}+爆伤可分配余量 ${remain} 超出主词条约束上限（${outName}≤${outCap}，爆伤≤${caps.critDmg}）`
      }
    }
  }
  return null
}

export function validateAnomalyAlloc(
  state: AnomalyAllocState,
  isMb: boolean,
  mainStats?: AffixDriveDiscMainStats,
): string | null {
  const flat = clampInt(state.flatStat, 0, 99)
  const pen = clampInt(state.pen, 0, 99)
  const total = clampInt(state.totalRolls, 0, ANOMALY_CONSTRAINTS.maxTotalRolls)
  if (total > ANOMALY_CONSTRAINTS.maxTotalRolls) {
    return `总词条数不能超过 ${ANOMALY_CONSTRAINTS.maxTotalRolls}`
  }
  if (flat + pen + total > ANOMALY_CONSTRAINTS.maxAtkPenTotal) {
    return `${flatStatLabel(isMb)}+穿透+总词条数不能超过 ${ANOMALY_CONSTRAINTS.maxAtkPenTotal}`
  }
  if (mainStats) {
    const caps = getAffixRollCaps(mainStats)
    const outCap = isMb ? caps.hpPercent : caps.atkPercent
    const outName = outPercentLabel(isMb)
    if (total > outCap + caps.mastery) {
      return `总词条数 ${total} 超出主词条约束上限（${outName}≤${outCap}，精通≤${caps.mastery}）`
    }
  }
  return null
}

export function buildDirectAffixCounts(
  isMb: boolean,
  state: DirectAllocState,
  outPercent: number,
  critDmg: number,
): AffixCounts {
  const counts = createEmptyAffixCounts()
  counts.pen = clampInt(state.pen, 0, 99)
  counts.critRate = clampInt(state.critRate, 0, 99)
  counts.critDmg = clampInt(critDmg, 0, 99)
  if (isMb) {
    counts.atkFlat = clampInt(state.flatStat, 0, 99)
    counts.hpFlat = clampInt(state.hpFlat, 0, 99)
    counts.hpPercent = clampInt(outPercent, 0, 99)
    counts.atkPercent = clampInt(state.atkPercent, 0, 99)
  } else {
    counts.atkFlat = clampInt(state.flatStat, 0, 99)
    counts.atkPercent = clampInt(outPercent, 0, 99)
  }
  return counts
}

export function buildAnomalyAffixCounts(
  isMb: boolean,
  state: AnomalyAllocState,
  outPercent: number,
  mastery: number,
): AffixCounts {
  const counts = createEmptyAffixCounts()
  const flatKey = flatStatKey(isMb)
  const percentKey = outPercentKey(isMb)
  counts[flatKey] = clampInt(state.flatStat, 0, 99)
  counts.pen = clampInt(state.pen, 0, 99)
  counts[percentKey] = clampInt(outPercent, 0, 99)
  counts.mastery = clampInt(mastery, 0, 99)
  return counts
}

function computePiercePower(hp: number, atk: number, pierceMod = 0) {
  return Math.round((0.1 * hp + 0.3 * atk + pierceMod) * 100) / 100
}

export type OptimalPanelBreakdown = ReturnType<typeof computeFinalPanel>

function resolveOptimalBuffMatchElementForSlot(
  ctx: OptimalEvalContext,
  slotIndex: number,
): string | undefined {
  const agent = ctx.panelContext.agents.find(
    (item) => item.id === ctx.panelContext.teamSlots[slotIndex]?.agentId,
  )
  const element = agent?.element
  if (!element) return undefined
  if (
    ctx.panelContext.skillContext?.damageKind === 'direct' &&
    isLuminousElement(element)
  ) {
    return resolveLuminousEquivalentElement(
      ctx.panelContext.teamSlots,
      ctx.panelContext.agents,
      slotIndex,
    )
  }
  return element
}

function buildOptimalExtraModsForEvent(
  ctx: OptimalEvalContext,
  event: DamageEvent,
  slotAgentId: string,
): BuffStatModifiers {
  const gains = ctx.extraGains ?? []
  if (!gains.length) return createEmptyBuffStatModifiers()
  const ownerAgentId = resolveEventOwnerAgentId(event, ctx.mainAgentId)
  const skillCtx = buildSkillContextFromDamageEvent(event, {
    ownerAgentId,
    agents: ctx.panelContext.agents,
    skillSubcategories: ctx.skillSubcategories ?? [],
    followUpSkillRules: ctx.followUpSkillRules ?? [],
    resolveBuffElement: (agentId) => {
      const slotIndex = ctx.panelContext.teamSlots.findIndex((slot) => slot.agentId === agentId)
      if (slotIndex < 0) return undefined
      return resolveOptimalBuffMatchElementForSlot(ctx, slotIndex)
    },
    resolveTriggerElement: (evt) => {
      const raw = evt.triggerAgentId ?? ctx.triggerAnomalyAgentId
      if (!raw || raw === '__at_calc__') return undefined
      return ctx.panelContext.agents.find((item) => item.id === raw)?.element
    },
  })
  return mergeExtraModsForEvent(gains, event, skillCtx, {
    slotAgentId,
    ownerAgentId,
    staggerPhase: event.staggerPhase,
  })
}

function buildPanelContextForSlot(
  ctx: OptimalEvalContext,
  slotIndex: number,
  externalForSlot: PanelStats,
  mainExternalPanel: PanelStats,
  extraModsOverride?: BuffStatModifiers,
): PanelCalcContext {
  const extraMods = extraModsOverride ?? ctx.panelContext.extraMods ?? createEmptyBuffStatModifiers()
  const level =
    slotIndex === ctx.panelContext.mainSlotIndex
      ? ctx.enemyInput.level
      : resolveProducerAgentLevel(ctx, ctx.panelContext.teamSlots[slotIndex]?.agentId)
  const base: PanelCalcContext = {
    ...ctx.panelContext,
    mainSlotIndex: slotIndex,
    extraMods,
    buffSelection: ctx.slotBuffSelections
      ? resolveBuffSelectionForSlot(ctx.slotBuffSelections, slotIndex)
      : ctx.panelContext.buffSelection,
    attrValues: panelToConvertAttrValues(externalForSlot, { level, pierceMod: 0 }),
  }
  const panelSourceValuesRecord = buildPanelSourceValuesBySlotRecord(base, mainExternalPanel)
  const panelSourceValuesBySlot = new Map(
    Object.entries(panelSourceValuesRecord).map(([key, value]) => [Number(key), value]),
  )
  return {
    ...base,
    panelSourceValues: panelSourceValuesRecord[slotIndex],
    panelSourceValuesBySlot,
  }
}


function resolveExternalForAgent(
  ctx: OptimalEvalContext,
  agentId: string,
  slotIndex: number,
  mainExternal: PanelStats,
): PanelStats {
  if (slotIndex === ctx.panelContext.mainSlotIndex) return mainExternal
  const anomaly = ctx.panelContext.anomalySlotPanels?.[agentId]
  if (anomaly) return { ...anomaly }
  const partial = ctx.panelContext.convertSlotPanels?.[agentId]
  if (partial) return convertSlotPartialToExternalPanel(partial)
  return createDefaultExternalPanel()
}

function resolveProducerExternal(ctx: OptimalEvalContext, agentId: string): PanelStats {
  return ctx.panelContext.anomalySlotPanels?.[agentId] ?? createDefaultExternalPanel()
}

function resolveProducerAgentLevel(_ctx: OptimalEvalContext, agentId: string | null | undefined): number {
  if (!agentId || agentId === _ctx.mainAgentId) return _ctx.enemyInput.level
  return 60
}

function applyEventMultOverrides(
  finalPanel: PanelStats,
  overrides: DamageEvent['multOverrides'],
): PanelStats {
  if (!overrides) return finalPanel
  const next = { ...finalPanel }
  if (overrides.directDmgMult != null) next.directDmgMult = overrides.directDmgMult
  if (overrides.settlementDmgMult != null) next.settlementDmgMult = overrides.settlementDmgMult
  if (overrides.directDmgMultFactor != null) next.directDmgMultFactor = overrides.directDmgMultFactor
  if (overrides.anomalyMult != null) next.anomalyMult = overrides.anomalyMult
  if (overrides.anomalyMultFactor != null) next.anomalyMultFactor = overrides.anomalyMultFactor
  if (overrides.anomalyReleaseMult != null) next.anomalyReleaseMult = overrides.anomalyReleaseMult
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
  if (overrides.radianceMult != null) next.radianceMult = overrides.radianceMult
  if (overrides.radianceMultFactor != null) next.radianceMultFactor = overrides.radianceMultFactor
  return next
}

function resolveLuminousTeamModifiersForOptimal(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats,
): { mutationZone: number; radianceResPen: number } {
  const found = findLuminousAgentInTeam(ctx.panelContext.teamSlots, ctx.panelContext.agents)
  if (!found) return { mutationZone: 1, radianceResPen: 0 }
  const tSlotIndex = found.slotIndex
  const producerExternal = resolveExternalForAgent(ctx, found.id, tSlotIndex, mainExternal)
  const breakdown = computeFinalPanel(producerExternal, {
    ...buildPanelContextForSlot(ctx, tSlotIndex, producerExternal, mainExternal),
    skillContext: {
      damageKind: 'anomaly',
      categoryId: 'basic',
      subcategoryId: null,
      element: found.element,
      staggerPhase: 'stagger',
      isFollowUp: false,
      anomalySubKind: 'radiance',
    },
  })
  const panel = breakdown.finalPanel
  return {
    mutationZone: computeMutationZone(panel),
    radianceResPen: panel.radianceResPen,
  }
}

export function evaluateOptimalEventDetail(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats,
  event: DamageEvent,
): OptimalEventEvalDetail | null {
  const turbulenceCalculable = canSelectTurbulenceDamageEvent(
    ctx.panelContext.teamSlots,
    ctx.panelContext.agents,
    ctx.mainAgentElement,
  )
  const skipReason = getDamageEventSkipReason(event, {
    teamSlots: ctx.panelContext.teamSlots,
    agents: ctx.panelContext.agents,
    turbulenceCalculable,
    mainAgentId: ctx.mainAgentId,
  })
  if (skipReason) return null

  const { damageKind, anomalySubKind } = mapEventKindToCalc(event.kind)
  const eventNeedsTrigger = eventNeedsAnomalyProducer(event.kind)
  const mainSlotIndex = ctx.panelContext.mainSlotIndex
  const ownerAgentId = resolveEventOwnerAgentId(event, ctx.mainAgentId)
  const ownerSlotIndexRaw = ctx.panelContext.teamSlots.findIndex(
    (slot) => slot.agentId === ownerAgentId,
  )
  const ownerSlotIndex = ownerSlotIndexRaw >= 0 ? ownerSlotIndexRaw : mainSlotIndex

  const rawTriggerId = event.triggerAgentId ?? ctx.triggerAnomalyAgentId
  const evtTriggerAgentId =
    rawTriggerId && rawTriggerId !== '__at_calc__' ? rawTriggerId : null
  if (eventNeedsTrigger && !evtTriggerAgentId) return null

  const ownerAgent = ctx.panelContext.agents.find((item) => item.id === ownerAgentId)
  const evtOwnerIsMb = ownerAgent?.profession === MB_PROFESSION
  const evtBaseDamageSource: BaseDamageSource = evtOwnerIsMb ? 'pierce' : ctx.baseDamageSource

  const tAgent = evtTriggerAgentId
    ? ctx.panelContext.agents.find((a) => a.id === evtTriggerAgentId)
    : undefined
  const evtTriggerElement = eventNeedsTrigger ? tAgent?.element : ctx.mainAgentElement
  const evtTriggerIsMb = tAgent?.profession === MB_PROFESSION

  const skillBound = event.skillBound !== false || damageKind === 'direct'
  const evtIsFollowUp = skillBound
    ? resolveIsFollowUp({
        agentId: ownerAgentId,
        categoryId: event.categoryId,
        subcategoryId: event.skillSubcategoryId,
        skillSubcategories: ctx.skillSubcategories ?? [],
        followUpSkillRules: ctx.followUpSkillRules ?? [],
      })
    : false

  const ownerBuffElement =
    damageKind === 'direct'
      ? resolveOptimalBuffMatchElementForSlot(ctx, ownerSlotIndex)
      : ownerAgent?.element

  const skillCtx = {
    damageKind,
    categoryId: skillBound ? event.categoryId : ('basic' as const),
    subcategoryId: skillBound ? (event.skillSubcategoryId ?? null) : null,
    element: eventNeedsTrigger ? evtTriggerElement : ownerBuffElement,
    staggerPhase: event.staggerPhase,
    isFollowUp: evtIsFollowUp,
    anomalySubKind,
  }

  const ownerExternal = resolveExternalForAgent(
    ctx,
    ownerAgentId,
    ownerSlotIndex,
    mainExternal,
  )
  const ownerExtraMods = buildOptimalExtraModsForEvent(ctx, event, ownerAgentId)
  const evtPanelCtx = {
    ...buildPanelContextForSlot(
      ctx,
      ownerSlotIndex,
      ownerExternal,
      mainExternal,
      ownerExtraMods,
    ),
    skillContext: skillCtx,
  }
  const evtBreakdown = computeFinalPanel(ownerExternal, evtPanelCtx)
  let evtFinalPanel = applyEventMultOverrides(evtBreakdown.finalPanel, event.multOverrides)

  if (event.kind === 'anomalyRelease') {
    const releaseFields = resolveMainCAnomalyReleaseMultFields(
      ownerExternal,
      evtPanelCtx,
      evtTriggerElement,
    )
    if (event.multOverrides?.anomalyReleaseMult == null) {
      evtFinalPanel.anomalyReleaseMult = releaseFields.anomalyReleaseMult
    }
    if (event.multOverrides?.anomalyReleaseMultFactor == null) {
      evtFinalPanel.anomalyReleaseMultFactor = releaseFields.anomalyReleaseMultFactor
    }
  }

  const evtPierce = computePiercePower(
    evtFinalPanel.hp,
    evtFinalPanel.atk,
    evtBreakdown.totalMods.pierce,
  )

  let evtTriggerFinalPanel: PanelStats | undefined
  let evtTriggerPierce: number | undefined
  let producerBreakdown: OptimalPanelBreakdown | undefined
  let producerExternalPanel: PanelStats | undefined

  const usesNonMainProducer = Boolean(
    eventNeedsTrigger && evtTriggerAgentId && evtTriggerAgentId !== ctx.mainAgentId,
  )
  const mainlyProducerDriven =
    usesNonMainProducer &&
    (event.kind === 'disorder' || event.kind === 'turbulence' || event.kind === 'anomaly')

  if (eventNeedsTrigger && evtTriggerAgentId) {
    const tSlotIndex = ctx.panelContext.teamSlots.findIndex(
      (slot) => slot.agentId === evtTriggerAgentId,
    )
    if (tSlotIndex < 0) return null

    if (evtTriggerAgentId === ownerAgentId) {
      evtTriggerFinalPanel = evtFinalPanel
      evtTriggerPierce = evtPierce
    } else {
      const tExternal = resolveExternalForAgent(
        ctx,
        evtTriggerAgentId,
        tSlotIndex,
        mainExternal,
      )
      producerExternalPanel = tExternal
      const tExtraMods = buildOptimalExtraModsForEvent(ctx, event, evtTriggerAgentId)
      producerBreakdown = computeFinalPanel(tExternal, {
        ...buildPanelContextForSlot(ctx, tSlotIndex, tExternal, mainExternal, tExtraMods),
        skillContext: {
          damageKind: 'anomaly',
          categoryId: skillBound ? event.categoryId : 'basic',
          subcategoryId: skillBound ? (event.skillSubcategoryId ?? null) : null,
          element: tAgent?.element,
          staggerPhase: event.staggerPhase,
          isFollowUp: resolveIsFollowUp({
            agentId: tAgent?.id,
            categoryId: skillBound ? event.categoryId : 'basic',
            subcategoryId: skillBound ? (event.skillSubcategoryId ?? null) : null,
            skillSubcategories: ctx.skillSubcategories ?? [],
            followUpSkillRules: ctx.followUpSkillRules ?? [],
          }),
          anomalySubKind,
        },
      })
      evtTriggerFinalPanel = producerBreakdown.finalPanel
      evtTriggerPierce = computePiercePower(
        producerBreakdown.finalPanel.hp,
        producerBreakdown.finalPanel.atk,
        producerBreakdown.totalMods.pierce,
      )
    }

    const o = event.multOverrides
    if (evtTriggerFinalPanel) {
      if (event.kind === 'disorder') {
        if (o?.disorderBaseMult == null) {
          evtFinalPanel.disorderBaseMult = evtTriggerFinalPanel.disorderBaseMult
        }
        if (o?.disorderBaseMultFactor == null) {
          evtFinalPanel.disorderBaseMultFactor = evtTriggerFinalPanel.disorderBaseMultFactor
        }
        if (o?.disorderCompMult == null) {
          evtFinalPanel.disorderCompMult = evtTriggerFinalPanel.disorderCompMult
        }
      } else if (event.kind === 'turbulence') {
        if (o?.turbulenceBaseMult == null) {
          evtFinalPanel.turbulenceBaseMult = evtTriggerFinalPanel.turbulenceBaseMult
        }
        if (o?.turbulenceBaseMultFactor == null) {
          evtFinalPanel.turbulenceBaseMultFactor = evtTriggerFinalPanel.turbulenceBaseMultFactor
        }
        if (o?.turbulenceCompMult == null) {
          evtFinalPanel.turbulenceCompMult = evtTriggerFinalPanel.turbulenceCompMult
        }
      }
    }
  }

  const sub = skillBound
    ? (ctx.resolveSubcategory?.(event.skillSubcategoryId ?? null) ?? null)
    : null
  const overrides = event.multOverrides
  const effectiveSub =
    sub && overrides
      ? {
          ...sub,
          directDmgMult: overrides.directDmgMult ?? sub.directDmgMult,
          settlementDmgMult: overrides.settlementDmgMult ?? sub.settlementDmgMult,
          directDmgMultFactor: overrides.directDmgMultFactor ?? sub.directDmgMultFactor,
          anomalyReleaseMult: overrides.anomalyReleaseMult ?? sub.anomalyReleaseMult,
          anomalyReleaseMultFactor:
            overrides.anomalyReleaseMultFactor ?? sub.anomalyReleaseMultFactor,
          disorderMult: overrides.disorderBaseMult ?? sub.disorderMult,
          disorderMultFactor: overrides.disorderBaseMultFactor ?? sub.disorderMultFactor,
        }
      : sub

  const luminousMods = resolveLuminousTeamModifiersForOptimal(ctx, mainExternal)

  const mainCFinalPanel =
    ownerAgentId === ctx.mainAgentId
      ? evtFinalPanel
      : computeFinalPanel(
          mainExternal,
          buildPanelContextForSlot(ctx, mainSlotIndex, mainExternal, mainExternal),
        ).finalPanel

  const result = computeDamageResult({
    finalPanel: evtFinalPanel,
    mainCFinalPanel,
    piercePower: evtPierce,
    baseDamageSource: evtBaseDamageSource,
    isMbMainAgent: evtOwnerIsMb,
    enemyInput: ctx.enemyInput,
    combatVulnerable: evtBreakdown.combatMods.vulnerable,
    combatGlobalStaggerVulnerable: evtBreakdown.combatMods.globalStaggerVulnerable,
    combatStaggerVulnerable: evtBreakdown.combatMods.staggerVulnerable,
    combatStaggerVulnerableOnly: evtBreakdown.combatMods.staggerVulnerableOnly,
    combatSpecial: evtBreakdown.combatMods.special,
    combatPierceDmgBonus: evtBreakdown.combatMods.pierceDmgBonus,
    staggerPhase: event.staggerPhase,
    mainAgentElement: ctx.mainAgentElement,
    mainAgentId: ctx.mainAgentId,
    mainAgentName: ctx.mainAgentName,
    anomalySubKind,
    triggerFinalPanel: evtTriggerFinalPanel,
    triggerAgentElement: eventNeedsTrigger ? evtTriggerElement : undefined,
    triggerPiercePower: evtTriggerPierce,
    triggerBaseDamageSource: evtTriggerIsMb ? 'pierce' : 'atk',
    triggerIsMb: evtTriggerIsMb,
    skillSubcategory: effectiveSub,
    mainAgentLevel: ctx.enemyInput.level,
    ownerAgentLevel: resolveProducerAgentLevel(ctx, ownerAgentId),
    triggerAgentLevel: evtTriggerAgentId
      ? resolveProducerAgentLevel(ctx, evtTriggerAgentId)
      : resolveProducerAgentLevel(ctx, ownerAgentId),
    mutationZone: luminousMods.mutationZone,
    remielRadianceResPen: event.kind === 'radiance' ? luminousMods.radianceResPen : 0,
  })

  const perHit = pickEventDamage(result, event.kind, event.critMode)
  const total = perHit * Math.max(0, event.count)
  const displayName = formatDamageEventDisplayName(
    event,
    ctx.resolveSubcategory,
    ownerAgent?.name,
  )

  return {
    event,
    eventId: event.id,
    displayName,
    kind: event.kind,
    perHit,
    total,
    usesNonMainProducer,
    mainlyProducerDriven,
    result,
    finalPanel: evtFinalPanel,
    external: mainExternal,
    breakdown: evtBreakdown,
    piercePower: evtPierce,
    anomalySubKind,
    producerFinalPanel: usesNonMainProducer ? evtTriggerFinalPanel : undefined,
    producerExternalPanel,
    producerBreakdown,
    producerAgentLabel: usesNonMainProducer ? tAgent?.name : undefined,
  }
}

function evaluateOptimalDamageEvent(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats,
  event: DamageEvent,
): OptimalEventDamageLine | null {
  const detail = evaluateOptimalEventDetail(ctx, mainExternal, event)
  if (!detail) return null
  return {
    eventId: detail.eventId,
    displayName: detail.displayName,
    kind: detail.kind,
    perHit: detail.perHit,
    total: detail.total,
    usesNonMainProducer: detail.usesNonMainProducer,
    mainlyProducerDriven: detail.mainlyProducerDriven,
  }
}

function computeEventDamageLines(
  ctx: OptimalEvalContext,
  external: PanelStats,
): {
  grandTotal: number
  eventLines: OptimalEventDamageLine[]
  firstResult: DamageCalcResult | null
  firstBreakdown: OptimalPanelBreakdown | null
} {
  const events = ctx.damageEvents ?? []
  if (!events.length) {
    return { grandTotal: 0, eventLines: [], firstResult: null, firstBreakdown: null }
  }

  let grandTotal = 0
  const eventLines: OptimalEventDamageLine[] = []
  let firstResult: DamageCalcResult | null = null
  let firstBreakdown: OptimalPanelBreakdown | null = null

  for (const event of events) {
    const line = evaluateOptimalDamageEvent(ctx, external, event)
    if (!line) continue
    eventLines.push(line)
    grandTotal += line.total
    if (!firstResult) {
      firstBreakdown = computeFinalPanel(external, {
        ...buildPanelContextForSlot(ctx, ctx.panelContext.mainSlotIndex, external, external),
        skillContext: ctx.panelContext.skillContext ?? undefined,
      })
      firstResult = computeDamageResult({
        finalPanel: firstBreakdown.finalPanel,
        piercePower: computePiercePower(
          firstBreakdown.finalPanel.hp,
          firstBreakdown.finalPanel.atk,
          firstBreakdown.totalMods.pierce,
        ),
        baseDamageSource: ctx.isMb ? 'pierce' : ctx.baseDamageSource,
        isMbMainAgent: ctx.isMb,
        enemyInput: ctx.enemyInput,
        combatVulnerable: firstBreakdown.combatMods.vulnerable,
        combatStaggerVulnerable: firstBreakdown.combatMods.staggerVulnerable,
        combatSpecial: firstBreakdown.combatMods.special,
        mainAgentElement: ctx.mainAgentElement,
        mainAgentId: ctx.mainAgentId,
        mainAgentName: ctx.mainAgentName,
      })
    }
  }

  return { grandTotal, eventLines, firstResult, firstBreakdown }
}

function computeEventDamageLinesForSweep(
  ctx: OptimalEvalContext,
  external: PanelStats,
): { grandTotal: number; eventLines: OptimalEventDamageLine[] } {
  const events = ctx.damageEvents ?? []
  if (!events.length) return { grandTotal: 0, eventLines: [] }

  let grandTotal = 0
  const eventLines: OptimalEventDamageLine[] = []
  for (const event of events) {
    const line = evaluateOptimalDamageEvent(ctx, external, event)
    if (!line) continue
    eventLines.push(line)
    grandTotal += line.total
  }
  return { grandTotal, eventLines }
}

const AFFIX_SWEEP_CACHE_MAX = 1200
const affixSweepCache = new Map<
  string,
  { grandTotal: number; eventLines: OptimalEventDamageLine[] }
>()

export function evaluateAffixCountsForSweep(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
): { grandTotal: number; eventLines: OptimalEventDamageLine[] } {
  resetAffixEvalCacheIfNeeded(ctx)
  const cacheKey = affixCountsCacheKey(affixCounts)
  const cached = affixSweepCache.get(cacheKey)
  if (cached) return cached

  const external = computeExternalPanelFromAffixes({
    agentBase: ctx.agentBase ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: ctx.wengineBaseAtk,
    wengineAdvanced: ctx.wengineAdvanced ?? createEmptyWengineAdvancedStats(),
    affixCounts,
    driveDiscSelection: ctx.driveDiscSelection,
    driveDiscMainStats: ctx.driveDiscMainStats,
    driveDiscs: ctx.driveDiscs,
  })

  let payload: { grandTotal: number; eventLines: OptimalEventDamageLine[] }
  if (ctx.damageEvents?.length) {
    payload = computeEventDamageLinesForSweep(ctx, external)
  } else {
    const breakdown = computeFinalPanel(external, {
      ...buildPanelContextForSlot(ctx, ctx.panelContext.mainSlotIndex, external, external),
      skillContext: ctx.panelContext.skillContext ?? undefined,
    })
    const piercePower = computePiercePower(
      breakdown.finalPanel.hp,
      breakdown.finalPanel.atk,
      breakdown.totalMods.pierce,
    )
    const result = computeDamageResult({
      finalPanel: breakdown.finalPanel,
      piercePower,
      baseDamageSource: ctx.isMb ? 'pierce' : ctx.baseDamageSource,
      isMbMainAgent: ctx.isMb,
      enemyInput: ctx.enemyInput,
      combatVulnerable: breakdown.combatMods.vulnerable,
      combatStaggerVulnerable: breakdown.combatMods.staggerVulnerable,
      combatSpecial: breakdown.combatMods.special,
      mainAgentElement: ctx.mainAgentElement,
      mainAgentId: ctx.mainAgentId,
      mainAgentName: ctx.mainAgentName,
    })
    payload = {
      grandTotal:
        ctx.panelContext.skillContext?.damageKind === 'anomaly'
          ? result.anomalyExpected
          : result.directDamageExpected,
      eventLines: [],
    }
  }

  if (affixSweepCache.size >= AFFIX_SWEEP_CACHE_MAX) {
    const firstKey = affixSweepCache.keys().next().value
    if (firstKey) affixSweepCache.delete(firstKey)
  }
  affixSweepCache.set(cacheKey, payload)
  return payload
}

const AFFIX_EVAL_CACHE_MAX = 800
let affixEvalCacheCtxSig = ''
const affixEvalCache = new Map<
  string,
  {
    finalPanel: PanelStats
    result: DamageCalcResult
    piercePower: number
    external: PanelStats
    breakdown: OptimalPanelBreakdown
    grandTotal: number
    eventLines: OptimalEventDamageLine[]
  }
>()

function affixCountsCacheKey(affixCounts: AffixCounts): string {
  return `${affixCounts.hpFlat},${affixCounts.hpPercent},${affixCounts.atkFlat},${affixCounts.atkPercent},${affixCounts.pen},${affixCounts.critRate},${affixCounts.critDmg},${affixCounts.mastery}`
}

function serializeBuffSelection(state: BuffSelectionState | null | undefined): string {
  if (!state) return ''
  return Object.entries(state.enabledIds)
    .filter(([, enabled]) => enabled)
    .map(([id]) => id)
    .sort()
    .join(',')
}

function serializeMultiSlotBuffSelection(
  multi: MultiSlotBuffSelection | null | undefined,
): string {
  if (!multi) return ''
  const slotPart = Object.keys(multi.bySlot)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => `${key}:${serializeBuffSelection(multi.bySlot[Number(key)])}`)
    .join('|')
  return `${serializeBuffSelection(multi.team)}#${slotPart}`
}

function affixEvalContextSignature(ctx: OptimalEvalContext): string {
  const events =
    ctx.damageEvents
      ?.map((event) => `${event.id}:${event.kind}:${event.count}:${event.critMode}:${event.triggerAgentId ?? ''}`)
      .join(';') ?? ''
  return [
    ctx.mainAgentId ?? '',
    ctx.mainAgentElement ?? '',
    ctx.isMb ? '1' : '0',
    ctx.wengineBaseAtk ?? 0,
    ctx.baseDamageSource ?? '',
    JSON.stringify(ctx.driveDiscMainStats),
    JSON.stringify(ctx.enemyInput),
    JSON.stringify(ctx.panelContext.skillContext),
    JSON.stringify(ctx.extraGains ?? []),
    JSON.stringify(ctx.panelContext.anomalySlotPanels ?? {}),
    JSON.stringify(ctx.panelContext.convertSlotPanels ?? {}),
    events,
    serializeMultiSlotBuffSelection(ctx.slotBuffSelections),
    ctx.triggerAnomalyAgentId ?? '',
  ].join('|')
}

function resetAffixEvalCacheIfNeeded(ctx: OptimalEvalContext) {
  const sig = affixEvalContextSignature(ctx)
  if (sig !== affixEvalCacheCtxSig) {
    affixEvalCache.clear()
    affixSweepCache.clear()
    affixEvalCacheCtxSig = sig
  }
}

export function clearAffixEvalCache() {
  affixEvalCache.clear()
  affixSweepCache.clear()
  affixEvalCacheCtxSig = ''
}

function evaluateAffixCountsUncached(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
): {
  finalPanel: PanelStats
  result: DamageCalcResult
  piercePower: number
  external: PanelStats
  breakdown: OptimalPanelBreakdown
  grandTotal: number
  eventLines: OptimalEventDamageLine[]
} {
  const external = computeExternalPanelFromAffixes({
    agentBase: ctx.agentBase ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: ctx.wengineBaseAtk,
    wengineAdvanced: ctx.wengineAdvanced ?? createEmptyWengineAdvancedStats(),
    affixCounts,
    driveDiscSelection: ctx.driveDiscSelection,
    driveDiscMainStats: ctx.driveDiscMainStats,
    driveDiscs: ctx.driveDiscs,
  })

  if (ctx.damageEvents?.length) {
    const { grandTotal, eventLines, firstResult, firstBreakdown } = computeEventDamageLines(
      ctx,
      external,
    )
    const breakdown =
      firstBreakdown ??
      computeFinalPanel(external, {
        ...buildPanelContextForSlot(ctx, ctx.panelContext.mainSlotIndex, external, external),
        skillContext: ctx.panelContext.skillContext ?? undefined,
      })
    const piercePower = computePiercePower(
      breakdown.finalPanel.hp,
      breakdown.finalPanel.atk,
      breakdown.totalMods.pierce,
    )
    const result =
      firstResult ??
      computeDamageResult({
        finalPanel: breakdown.finalPanel,
        piercePower,
        baseDamageSource: ctx.isMb ? 'pierce' : ctx.baseDamageSource,
        isMbMainAgent: ctx.isMb,
        enemyInput: ctx.enemyInput,
        combatVulnerable: breakdown.combatMods.vulnerable,
        combatStaggerVulnerable: breakdown.combatMods.staggerVulnerable,
        combatSpecial: breakdown.combatMods.special,
        mainAgentElement: ctx.mainAgentElement,
        mainAgentId: ctx.mainAgentId,
        mainAgentName: ctx.mainAgentName,
      })
    return {
      finalPanel: breakdown.finalPanel,
      result,
      piercePower,
      external,
      breakdown,
      grandTotal,
      eventLines,
    }
  }

  const breakdown = computeFinalPanel(external, {
    ...buildPanelContextForSlot(ctx, ctx.panelContext.mainSlotIndex, external, external),
    skillContext: ctx.panelContext.skillContext ?? undefined,
  })

  const piercePower = computePiercePower(
    breakdown.finalPanel.hp,
    breakdown.finalPanel.atk,
    breakdown.totalMods.pierce,
  )

  const result = computeDamageResult({
    finalPanel: breakdown.finalPanel,
    piercePower,
    baseDamageSource: ctx.isMb ? 'pierce' : ctx.baseDamageSource,
    isMbMainAgent: ctx.isMb,
    enemyInput: ctx.enemyInput,
    combatVulnerable: breakdown.combatMods.vulnerable,
    combatStaggerVulnerable: breakdown.combatMods.staggerVulnerable,
    combatSpecial: breakdown.combatMods.special,
    mainAgentElement: ctx.mainAgentElement,
    mainAgentId: ctx.mainAgentId,
    mainAgentName: ctx.mainAgentName,
  })

  return {
    finalPanel: breakdown.finalPanel,
    result,
    piercePower,
    external,
    breakdown,
    grandTotal:
      ctx.panelContext.skillContext?.damageKind === 'anomaly'
        ? result.anomalyExpected
        : result.directDamageExpected,
    eventLines: [],
  }
}

export function evaluateAffixCounts(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
): {
  finalPanel: PanelStats
  result: DamageCalcResult
  piercePower: number
  external: PanelStats
  breakdown: OptimalPanelBreakdown
  grandTotal: number
  eventLines: OptimalEventDamageLine[]
} {
  resetAffixEvalCacheIfNeeded(ctx)
  const cacheKey = affixCountsCacheKey(affixCounts)
  const cached = affixEvalCache.get(cacheKey)
  if (cached) return cached

  const result = evaluateAffixCountsUncached(ctx, affixCounts)
  if (affixEvalCache.size >= AFFIX_EVAL_CACHE_MAX) {
    const firstKey = affixEvalCache.keys().next().value
    if (firstKey) affixEvalCache.delete(firstKey)
  }
  affixEvalCache.set(cacheKey, result)
  return result
}

/** 使局内暴击率刚好 > 100% 的最小暴击条数 */
export function findMinCritRollsForOvercap(
  ctx: OptimalEvalContext,
  baseState: Omit<DirectAllocState, 'critRate' | 'totalRolls'>,
  maxSearch = DIRECT_CONSTRAINTS.maxTotalRolls,
): number {
  const critCap = affixRollCap(ctx.driveDiscMainStats, 'critRate')
  const limit = Math.min(maxSearch, Number.isFinite(critCap) ? critCap : maxSearch)
  for (let n = 0; n <= limit; n += 1) {
    const counts = buildDirectAffixCounts(
      ctx.isMb,
      { ...baseState, critRate: n, totalRolls: n },
      0,
      0,
    )
    const { finalPanel } = evaluateAffixCounts(ctx, counts)
    if (finalPanel.critRate > 100) return n
  }
  return limit
}

export function sweepDirectDamage(
  ctx: OptimalEvalContext,
  state: DirectAllocState,
): DirectSweepPoint[] {
  const crit = clampInt(state.critRate, 0, DIRECT_CONSTRAINTS.maxTotalRolls)
  const total = clampInt(state.totalRolls, crit, DIRECT_CONSTRAINTS.maxTotalRolls)
  const caps = getAffixRollCaps(ctx.driveDiscMainStats)
  const points: DirectSweepPoint[] = []

  if (ctx.isMb) {
    const fixedAtkPercent = clampInt(state.atkPercent, 0, 99)
    const remain = total - crit - fixedAtkPercent
    if (remain < 0 || fixedAtkPercent > caps.atkPercent || crit > caps.critRate) return points
    for (let hpPercent = 0; hpPercent <= remain; hpPercent += 1) {
      const critDmg = remain - hpPercent
      if (hpPercent > caps.hpPercent || critDmg > caps.critDmg) continue
      const affixCounts = buildDirectAffixCounts(
        true,
        { ...state, critRate: crit, totalRolls: total },
        hpPercent,
        critDmg,
      )
      const { grandTotal, eventLines } = evaluateAffixCountsForSweep(ctx, affixCounts)
      points.push({
        outPercent: hpPercent,
        critDmg,
        label: `局外大生命${hpPercent}/爆伤${critDmg}`,
        affixCounts,
        directExpected: grandTotal,
        eventLines,
        grandTotal,
      })
    }
    return points
  }

  const remain = total - crit
  const outLabel = outPercentLabel(false)
  const outCap = caps.atkPercent
  for (let outPercent = 0; outPercent <= remain; outPercent += 1) {
    const critDmg = remain - outPercent
    if (outPercent > outCap || critDmg > caps.critDmg || crit > caps.critRate) continue
    const affixCounts = buildDirectAffixCounts(
      false,
      { ...state, critRate: crit, totalRolls: total },
      outPercent,
      critDmg,
    )
    const { grandTotal, eventLines } = evaluateAffixCountsForSweep(ctx, affixCounts)
    points.push({
      outPercent,
      critDmg,
      label: `${outLabel}${outPercent}/爆伤${critDmg}`,
      affixCounts,
      directExpected: grandTotal,
      eventLines,
      grandTotal,
    })
  }
  return points
}

export function sweepAnomalyDamage(
  ctx: OptimalEvalContext,
  state: AnomalyAllocState,
): AnomalySweepPoint[] {
  const total = clampInt(state.totalRolls, 0, ANOMALY_CONSTRAINTS.maxTotalRolls)
  const outLabel = outPercentLabel(ctx.isMb)
  const caps = getAffixRollCaps(ctx.driveDiscMainStats)
  const outCap = ctx.isMb ? caps.hpPercent : caps.atkPercent
  const points: AnomalySweepPoint[] = []

  for (let outPercent = 0; outPercent <= total; outPercent += 1) {
    const mastery = total - outPercent
    if (outPercent > outCap || mastery > caps.mastery) continue
    const affixCounts = buildAnomalyAffixCounts(ctx.isMb, { ...state, totalRolls: total }, outPercent, mastery)
    const { grandTotal, eventLines } = evaluateAffixCountsForSweep(ctx, affixCounts)
    const subMetrics = ctx.damageEvents?.length
      ? null
      : evaluateAffixCounts(ctx, affixCounts).result
    points.push({
      outPercent,
      mastery,
      label: `${outLabel}${outPercent}/精通${mastery}`,
      affixCounts,
      anomalyExpected: grandTotal,
      disorderExpected: subMetrics?.disorderExpected ?? 0,
      turbulenceExpected: subMetrics?.turbulenceExpected ?? 0,
      anomalyReleaseExpected: subMetrics?.anomalyReleaseExpected ?? 0,
      radianceExpected: subMetrics?.radianceExpected ?? 0,
      eventLines,
      grandTotal,
    })
  }
  return points
}

function damageMetric(
  result: DamageCalcResult,
  kind: OptimalDamageKind,
  anomalyMetric: OptimalAnomalyMetric = 'anomaly',
  grandTotal?: number,
) {
  if (typeof grandTotal === 'number' && Number.isFinite(grandTotal)) return grandTotal
  if (kind === 'direct') return result.directDamageExpected
  if (anomalyMetric === 'disorder') return result.disorderExpected
  if (anomalyMetric === 'turbulence') return result.turbulenceExpected
  if (anomalyMetric === 'anomalyRelease') return result.anomalyReleaseExpected
  if (anomalyMetric === 'radiance') return result.radianceExpected
  return result.anomalyExpected
}

export function directCandidateKeys(isMb: boolean): OptimalAffixKey[] {
  if (isMb) {
    return ['atkFlat', 'hpFlat', 'hpPercent', 'atkPercent', 'pen', 'critRate', 'critDmg']
  }
  return ['atkFlat', 'atkPercent', 'pen', 'critRate', 'critDmg']
}

export function anomalyCandidateKeys(isMb: boolean): OptimalAffixKey[] {
  return [flatStatKey(isMb), outPercentKey(isMb), 'pen', 'mastery']
}

const SERIES_COLORS: Record<string, string> = {
  atkFlat: '#7dd3a0',
  hpFlat: '#7dd3a0',
  atkPercent: '#f07178',
  hpPercent: '#f07178',
  pen: '#6eb6ff',
  critRate: '#e6c07b',
  critDmg: '#c678dd',
  mastery: '#abb2bf',
}

function bumpAffix(counts: AffixCounts, key: OptimalAffixKey, delta: number): AffixCounts {
  const next = { ...counts }
  next[key] = Math.max(0, (next[key] ?? 0) + delta)
  return next
}

export function computeDiffAnalysis(
  ctx: OptimalEvalContext,
  baseCounts: AffixCounts,
  kind: OptimalDamageKind,
  anomalyMetric: OptimalAnomalyMetric = 'anomaly',
): { addOne: AffixDiffRow[]; replace: AffixReplaceRow[] } {
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb) : anomalyCandidateKeys(ctx.isMb)
  const base = evaluateAffixCounts(ctx, baseCounts)
  const baseDmg = damageMetric(base.result, kind, anomalyMetric, base.grandTotal)
  const mainStats = ctx.driveDiscMainStats

  const addOne: AffixDiffRow[] = candidates.map((key) => {
    const nextCount = (baseCounts[key] ?? 0) + 1
    if (exceedsAffixCap(mainStats, key, nextCount)) {
      return {
        key,
        label: affixKeyLabel(key, ctx.isMb),
        currentCount: baseCounts[key],
        currentValue: baseCounts[key] * AFFIX_VALUE_PER_COUNT[key],
        addOne: AFFIX_VALUE_PER_COUNT[key],
        damageDelta: 0,
        percentDelta: 0,
      }
    }
    const bumped = bumpAffix(baseCounts, key, 1)
    const next = evaluateAffixCounts(ctx, bumped)
    const nextDmg = damageMetric(next.result, kind, anomalyMetric, next.grandTotal)
    const delta = nextDmg - baseDmg
    return {
      key,
      label: affixKeyLabel(key, ctx.isMb),
      currentCount: baseCounts[key],
      currentValue: baseCounts[key] * AFFIX_VALUE_PER_COUNT[key],
      addOne: AFFIX_VALUE_PER_COUNT[key],
      damageDelta: delta,
      percentDelta: baseDmg > 0 ? (delta / baseDmg) * 100 : 0,
    }
  })

  addOne.sort((a, b) => b.damageDelta - a.damageDelta)
  const best = addOne.find((row) => !exceedsAffixCap(mainStats, row.key, (baseCounts[row.key] ?? 0) + 1)) ?? addOne[0]

  const ownedKeys = candidates.filter((key) => (baseCounts[key] ?? 0) > 0)
  const replace: AffixReplaceRow[] = ownedKeys.map((key) => {
    const without = bumpAffix(baseCounts, key, -1)
    let bestReplaceKey = best?.key ?? key
    let bestDelta = -Infinity
    let bestAdd = AFFIX_VALUE_PER_COUNT[bestReplaceKey]
    let found = false

    for (const cand of candidates) {
      if (cand === key) continue
      const nextCount = (without[cand] ?? 0) + 1
      if (exceedsAffixCap(mainStats, cand, nextCount)) continue
      const swapped = bumpAffix(without, cand, 1)
      const evaled = evaluateAffixCounts(ctx, swapped)
      const dmg = damageMetric(evaled.result, kind, anomalyMetric, evaled.grandTotal)
      const delta = dmg - baseDmg
      if (delta > bestDelta) {
        bestDelta = delta
        bestReplaceKey = cand
        bestAdd = AFFIX_VALUE_PER_COUNT[cand]
        found = true
      }
    }

    if (!found) {
      return {
        key,
        label: affixKeyLabel(key, ctx.isMb),
        removeOne: AFFIX_VALUE_PER_COUNT[key],
        bestReplaceKey: key,
        bestReplaceLabel: '无可用候选（已达上限）',
        addOne: 0,
        damageDelta: 0,
        percentDelta: 0,
      }
    }

    return {
      key,
      label: affixKeyLabel(key, ctx.isMb),
      removeOne: AFFIX_VALUE_PER_COUNT[key],
      bestReplaceKey,
      bestReplaceLabel: affixKeyLabel(bestReplaceKey, ctx.isMb),
      addOne: bestAdd,
      damageDelta: bestDelta,
      percentDelta: baseDmg > 0 ? (bestDelta / baseDmg) * 100 : 0,
    }
  })

  return { addOne, replace }
}

function eventAffixImpactReason(
  ctx: OptimalEvalContext,
  line: OptimalEventDamageLine,
  maxDelta: number,
): string {
  if (maxDelta > AFFIX_IMPACT_EPS) {
    const teamHasRemiel = Boolean(
      findLuminousAgentInTeam(ctx.panelContext.teamSlots, ctx.panelContext.agents),
    )
    if (teamHasRemiel) {
      return `主C副词条变化可影响该事件（含蕾米埃尔攻击转模等全队增益，最大变化 ${maxDelta.toFixed(2)}）`
    }
    return `主C副词条变化可影响该事件（最大变化 ${maxDelta.toFixed(2)}）`
  }
  if (line.kind === 'anomalyRelease' && line.total <= AFFIX_IMPACT_EPS) {
    return '异放倍率为 0 或未配置产生角色，当前无法计算异放伤害'
  }
  return '不受主C副词条变化影响'
}

/** 各伤害事件对主C副词条变化的敏感度 */
export function computeEventAffixImpact(
  ctx: OptimalEvalContext,
  baseCounts: AffixCounts,
  kind: OptimalDamageKind,
): OptimalEventAffixImpact[] {
  if (!ctx.damageEvents?.length) return []
  const base = evaluateAffixCounts(ctx, baseCounts)
  const baseById = new Map(base.eventLines.map((line) => [line.eventId, line.total]))
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb) : anomalyCandidateKeys(ctx.isMb)
  const maxDeltaByEvent = new Map<string, number>()

  for (const key of candidates) {
    const nextCount = (baseCounts[key] ?? 0) + 1
    if (exceedsAffixCap(ctx.driveDiscMainStats, key, nextCount)) continue
    const bumped = bumpAffix(baseCounts, key, 1)
    const next = evaluateAffixCounts(ctx, bumped)
    for (const line of next.eventLines) {
      const baseTotal = baseById.get(line.eventId) ?? 0
      const delta = Math.abs(line.total - baseTotal)
      maxDeltaByEvent.set(line.eventId, Math.max(maxDeltaByEvent.get(line.eventId) ?? 0, delta))
    }
  }

  return base.eventLines.map((line) => {
    const maxAffixDelta = maxDeltaByEvent.get(line.eventId) ?? 0
    const affixSensitive = maxAffixDelta > AFFIX_IMPACT_EPS
    return {
      ...line,
      maxAffixDelta,
      affixSensitive,
      reason: eventAffixImpactReason(ctx, line, maxAffixDelta),
    }
  })
}

export function computeBenefitCurves(
  ctx: OptimalEvalContext,
  baseCounts: AffixCounts,
  kind: OptimalDamageKind,
  anomalyMetric: OptimalAnomalyMetric = 'anomaly',
  maxAdded = BENEFIT_CURVE_MAX_ADDED,
): { series: BenefitCurveSeries[]; nextStep: AffixDiffRow[] } {
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb) : anomalyCandidateKeys(ctx.isMb)
  const base = evaluateAffixCounts(ctx, baseCounts)
  const baseDmg = damageMetric(base.result, kind, anomalyMetric, base.grandTotal)
  const mainStats = ctx.driveDiscMainStats

  const series: BenefitCurveSeries[] = candidates.map((key) => {
    const cumulativePercent = [0]
    const marginalPercent = [0]
    let counts = { ...baseCounts }
    let prevDmg = baseDmg
    let capped = false
    let lastCum = 0

    for (let n = 1; n <= maxAdded; n += 1) {
      if (capped || exceedsAffixCap(mainStats, key, (counts[key] ?? 0) + 1)) {
        capped = true
        cumulativePercent.push(lastCum)
        marginalPercent.push(0)
        continue
      }
      counts = bumpAffix(counts, key, 1)
      const evaled = evaluateAffixCounts(ctx, counts)
      const dmg = damageMetric(evaled.result, kind, anomalyMetric, evaled.grandTotal)
      const cum = baseDmg > 0 ? ((dmg - baseDmg) / baseDmg) * 100 : 0
      const mar = prevDmg > 0 ? ((dmg - prevDmg) / prevDmg) * 100 : 0
      cumulativePercent.push(cum)
      marginalPercent.push(mar)
      prevDmg = dmg
      lastCum = cum
    }

    return {
      key,
      label: affixKeyLabel(key, ctx.isMb),
      color: SERIES_COLORS[key] ?? '#9aa3b0',
      cumulativePercent,
      marginalPercent,
    }
  })

  const nextStep = computeDiffAnalysis(ctx, baseCounts, kind, anomalyMetric).addOne

  return { series, nextStep }
}

export function buildOptimalEvalContext(input: {
  isMb: boolean
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboo: BangbooBuffDoc
  bangbooRefine: number
  driveDiscs: DriveDiscBuffDoc[]
  mainSlotIndex: number
  driveDiscMainStats: AffixDriveDiscMainStats
  enemyInput: DamageEnemyInput
  baseDamageSource: BaseDamageSource
  extraGains?: ExtraBuffGain[]
  skillContext?: SkillCalcContext | null
  buffSelection?: BuffSelectionState | null
  slotBuffSelections?: MultiSlotBuffSelection | null
  anomalySlotPanels?: Record<string, PanelStats>
  convertSlotPanels?: import('@/utils/panelBuffCalc').ConvertSlotPanels
  damageEvents?: DamageEvent[]
  triggerAnomalyAgentId?: string | null
  resolveSubcategory?: (id: string | null) => SkillSubcategory | null
  skillSubcategories?: SkillSubcategory[]
  followUpSkillRules?: import('@/types/calculator').FollowUpSkillRule[]
}): OptimalEvalContext {
  const mainSlot = input.teamSlots[input.mainSlotIndex]!
  const mainAgent = input.agents.find((a) => a.id === mainSlot.agentId)
  const mainWengine =
    mainSlot.wengineId && mainSlot.wengineId !== 'none'
      ? input.wengines.find((w) => w.id === mainSlot.wengineId)
      : null

  return {
    isMb: input.isMb,
    agentBase: mainAgent?.basePanel ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: mainWengine?.baseAtk ?? 0,
    wengineAdvanced: mainWengine?.advancedStats ?? createEmptyWengineAdvancedStats(),
    driveDiscSelection: {
      twoPieceDriveDiscId: mainSlot.twoPieceDriveDiscId,
      fourPieceDriveDiscId: mainSlot.fourPieceDriveDiscId,
    },
    driveDiscMainStats: input.driveDiscMainStats,
    driveDiscs: input.driveDiscs,
    panelContext: {
      teamSlots: input.teamSlots,
      agents: input.agents,
      wengines: input.wengines,
      bangboo: input.bangboo,
      bangbooRefine: input.bangbooRefine,
      mainSlotIndex: input.mainSlotIndex,
      driveDiscs: input.driveDiscs,
      skillContext: input.skillContext,
      buffSelection: input.buffSelection,
      anomalySlotPanels: input.anomalySlotPanels,
      convertSlotPanels: input.convertSlotPanels,
      baseAnomalyControl: mainAgent?.basePanel.anomalyControl ?? 0,
      baseEnergyRegen: mainAgent?.basePanel.energyRegen ?? 0,
    },
    enemyInput: input.enemyInput,
    baseDamageSource: input.baseDamageSource,
    mainAgentElement: mainAgent?.element ?? '',
    mainAgentId: mainAgent?.id ?? '',
    mainAgentName: mainAgent?.name ?? '',
    damageEvents: input.damageEvents,
    extraGains: input.extraGains,
    triggerAnomalyAgentId: input.triggerAnomalyAgentId,
    slotBuffSelections: input.slotBuffSelections,
    resolveSubcategory: input.resolveSubcategory,
    skillSubcategories: input.skillSubcategories,
    followUpSkillRules: input.followUpSkillRules,
  }
}
