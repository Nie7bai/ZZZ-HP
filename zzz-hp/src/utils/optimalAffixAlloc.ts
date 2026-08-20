import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import type {
  AgentBuffDoc,
  AnomalyDamageSubKind,
  BangbooBuffDoc,
  BaseDamageSource,
  BuffStatModifiers,
  DamageEventKind,
  DamageEventMultOverrides,
  DriveDiscBuffDoc,
  SkillCalcContext,
  SkillSubcategory,
  WengineBuffDoc,
} from '@/types/calculator'
import type { AffixCounts, AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'
import {
  createEmptyAffixCounts,
  createDefaultExternalPanel,
  createExternalPanelFromAgentBase,
  fillPanelStatsDefaults,
  resolveSlotPanelEntryMode,
} from '@/types/calculatorPanel'
import {
  AFFIX_VALUE_PER_COUNT,
  computeExternalPanelFromAffixes,
  computeExternalPanelFromTeamSlot,
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
  pickEventDamage,
  applyOwnerPanelMultOverrides,
  applyRadianceBonusMultOverrides,
} from '@/utils/damageEvent'
import {
  buildSkillContextFromHit,
  getHitSkipReason,
  skillNeedsDualAgents,
  applyHitPanelMods,
  type ResolvedHit,
} from '@/utils/resolvedHit'
import { mergeExtraModsForEvent } from '@/utils/extraBuffCalc'
import {
  computeMutationZone,
  findLuminousAgentInTeam,
  isRemielSelfRadiancePowerProvider,
  resolveDamageCalcResistanceElements,
} from '@/utils/remielUtils'
import {
  collectRemielSelfRestrictedContributions,
  computeRemielSelfInCombatPanel,
  resolveRemielSelfRadianceCalcInput,
} from '@/utils/remielSelfRadiancePanel'
import { mergeSkillSubcategoryMultOverrides } from '@/utils/skillSubcategoryMult'
import {
  computeFinalPanel,
  resolveAnomalyReleaseMultFields,
  type BuffSelectionState,
  type MultiSlotBuffSelection,
  type PanelCalcContext,
  resolveBuffSelectionForSlot,
  panelToConvertAttrValues,
  buildPanelSourceValuesBySlotRecord,
} from '@/utils/panelBuffCalc'
import { formatAnomalyFormulaAgentLabel } from '@/utils/anomalyFormulaDisplay'

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
  hit: ResolvedHit
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
  /** 类型增伤/倍率面板（属性异常/异放/耀变=异常类触发者；紊乱/乱流=招式持有者） */
  bonusFinalPanel?: PanelStats
  bonusExternalPanel?: PanelStats
  bonusBreakdown?: OptimalPanelBreakdown
  /** 减防/无视 tip（异常类触发者面板） */
  defenseTriggerFinalPanel?: PanelStats
  defenseTriggerExternalPanel?: PanelStats
  defenseTriggerBreakdown?: OptimalPanelBreakdown
  defenseTriggerAgentLabel?: string
  /** 异常基础乘区角色名 */
  baseAgentLabel?: string
  /** 增伤/倍率乘区角色名 */
  bonusAgentLabel?: string
  /** 异化系数区角色名（蕾米埃尔） */
  mutationAgentLabel?: string
  mutationFinalPanel?: PanelStats
  mutationExternalPanel?: PanelStats
  mutationSources?: OptimalPanelBreakdown['sources']
  remielSelfAtkSourceItems?: string[]
  remielSelfMasterySourceItems?: string[]
  remielSelfExternalPanel?: PanelStats
  remielSelfSources?: OptimalPanelBreakdown['sources']
  remielSelfFinalPanel?: PanelStats
  remielIsMb?: boolean
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

export function affixCapLimitNote(
  mainStats: AffixDriveDiscMainStats,
  key: OptimalAffixKey,
  currentCount: number,
): string {
  if (!isCappedAffixKey(key)) return '已达可分配上限'
  const cap = affixRollCap(mainStats, key)
  return `已达主词条约束上限（当前 ${currentCount}/${cap}）`
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
  /**
   * 流程展开后的结算列表：有则最优词条按总伤期望扫掠。
   * 与主计算页共用同一份，保证准备阶段倍率与流程次数两边一致（§15）。
   */
  hits?: ResolvedHit[]
  /** 额外 Buff（按事件 scope 匹配，与面板计算共用） */
  extraGains?: ExtraBuffGain[]
  /** 页级异常强度提供者 id（命名含 trigger，实为 power）；有 hits 时优先逐击字段 */
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
  /** 完整评估较重；扫掠默认不填，点柱/过程 Tab 再懒算 */
  evalSnapshot?: {
    finalPanel: PanelStats
    result: DamageCalcResult
    piercePower: number
    external: PanelStats
    breakdown: OptimalPanelBreakdown
    grandTotal: number
    eventLines: OptimalEventDamageLine[]
  } | null
  directExpected: number
  eventLines: OptimalEventDamageLine[]
  grandTotal: number
}

export interface AnomalySweepPoint {
  outPercent: number
  mastery: number
  label: string
  affixCounts: AffixCounts
  evalSnapshot: DirectSweepPoint['evalSnapshot']
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
  /** 已达主词条约束上限，无法再 +1 */
  capped?: boolean
  note?: string
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
  capped?: boolean
  note?: string
}

export interface BenefitCurveSeries {
  key: OptimalAffixKey
  label: string
  color: string
  /** index 0 unused; values[n] = cumulative % after adding n rolls */
  cumulativePercent: number[]
  /** values[n] = marginal % of the n-th roll */
  marginalPercent: number[]
  /** values[n] = 第 n 条因上限未计入 */
  cappedAt: boolean[]
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

export function affixKeyLabel(key: OptimalAffixKey, _isMb: boolean): string {
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

function buildOptimalExtraModsForEvent(
  ctx: OptimalEvalContext,
  hit: ResolvedHit,
  slotAgentId: string,
): BuffStatModifiers {
  const gains = ctx.extraGains ?? []
  if (!gains.length) return createEmptyBuffStatModifiers()
  const ownerAgentId = hit.ownerAgentId
  const ownerElement = ctx.panelContext.agents.find((item) => item.id === ownerAgentId)?.element
  const slotIndex = ctx.panelContext.teamSlots.findIndex((slot) => slot.agentId === slotAgentId)
  return mergeExtraModsForEvent(gains, buildSkillContextFromHit(hit, ownerElement), {
    slotIndex,
    slotAgentId,
    staggerPhase: hit.staggerPhase,
    resolveAgentProfession: (agentId) =>
      ctx.panelContext.agents.find((item) => item.id === agentId)?.profession,
    teamSlots: ctx.panelContext.teamSlots,
    agents: ctx.panelContext.agents,
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
    mainExternalPanel: mainExternalPanel,
    extraMods,
    extraGains: ctx.extraGains,
    buffSelection: ctx.slotBuffSelections
      ? resolveBuffSelectionForSlot(ctx.slotBuffSelections, slotIndex)
      : ctx.panelContext.buffSelection,
    attrValues: panelToConvertAttrValues(externalForSlot, { level, pierceMod: 0 }),
  }
  const panelSourceValuesRecord = buildPanelSourceValuesBySlotRecord(base, externalForSlot)
  const panelSourceValuesBySlot = new Map(
    Object.entries(panelSourceValuesRecord).map(([key, value]) => [Number(key), value]),
  )
  return {
    ...base,
    panelSourceValues: panelSourceValuesRecord[slotIndex],
    panelSourceValuesBySlot,
  }
}


function resolveRemielSelfRadianceCalcForOptimal(
  ctx: OptimalEvalContext,
  anomalyPowerAgentId: string | null | undefined,
  mainExternal: PanelStats,
  skillContext?: import('@/types/calculator').SkillCalcContext,
) {
  const remiel = findLuminousAgentInTeam(ctx.panelContext.teamSlots, ctx.panelContext.agents)
  if (!remiel || !isRemielSelfRadiancePowerProvider(anomalyPowerAgentId, remiel.id)) {
    return undefined
  }
  const external = resolveExternalForAgent(ctx, remiel.id, remiel.slotIndex, mainExternal)
  const agent = ctx.panelContext.agents.find((item) => item.id === remiel.id)
  const baseCtx = buildPanelContextForSlot(ctx, remiel.slotIndex, external, mainExternal)
  return resolveRemielSelfRadianceCalcInput({
    teamSlots: ctx.panelContext.teamSlots,
    agents: ctx.panelContext.agents,
    externalPanel: external,
    panelCtx: skillContext ? { ...baseCtx, skillContext } : baseCtx,
    remielSlotIndex: remiel.slotIndex,
    agentLevel: resolveProducerAgentLevel(ctx, remiel.id),
    isMb: agent?.profession === MB_PROFESSION,
  })
}

function resolveExternalForAgent(
  ctx: OptimalEvalContext,
  agentId: string,
  slotIndex: number,
  mainExternal: PanelStats,
): PanelStats {
  if (slotIndex === ctx.panelContext.mainSlotIndex) return mainExternal
  const mapped = ctx.panelContext.slotExternalPanels?.[slotIndex]
  if (mapped) return fillPanelStatsDefaults(mapped)
  const anomaly = ctx.panelContext.anomalySlotPanels?.[agentId]
  if (anomaly) return fillPanelStatsDefaults(anomaly)
  return createDefaultExternalPanel()
}

function resolveProducerAgentLevel(_ctx: OptimalEvalContext, agentId: string | null | undefined): number {
  if (!agentId || agentId === _ctx.mainAgentId) return _ctx.enemyInput.level
  return 60
}

function applyEventMultOverrides(
  finalPanel: PanelStats,
  overrides: DamageEventMultOverrides | null | undefined,
): PanelStats {
  return applyOwnerPanelMultOverrides(finalPanel, overrides)
}

function resolveLuminousTeamModifiersForOptimal(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats,
): {
  mutationZone: number
  radianceResPen: number
  finalPanel?: PanelStats
  external?: PanelStats
  sources?: OptimalPanelBreakdown['sources']
  remielIsMb?: boolean
} {
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
  const agent = ctx.panelContext.agents.find((item) => item.id === found.id)
  return {
    mutationZone: computeMutationZone(panel),
    radianceResPen: panel.radianceResPen,
    finalPanel: panel,
    external: producerExternal,
    sources: breakdown.sources,
    remielIsMb: agent?.profession === MB_PROFESSION,
  }
}

export function evaluateOptimalEventDetail(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats,
  hit: ResolvedHit,
): OptimalEventEvalDetail | null {
  const skipReason = getHitSkipReason(hit, {
    teamSlots: ctx.panelContext.teamSlots,
    agents: ctx.panelContext.agents,
  })
  if (skipReason) return null

  const damageType = hit.skill.damageType
  const anomalySubKind = hit.anomalySubKind
  const eventNeedsTrigger = skillNeedsDualAgents(damageType)
  const mainSlotIndex = ctx.panelContext.mainSlotIndex
  const ownerAgentId = hit.ownerAgentId
  const ownerSlotIndexRaw = ctx.panelContext.teamSlots.findIndex(
    (slot) => slot.agentId === ownerAgentId,
  )
  const ownerSlotIndex = ownerSlotIndexRaw >= 0 ? ownerSlotIndexRaw : mainSlotIndex

  const evtPowerAgentId = hit.anomalyPowerAgentId
  if (eventNeedsTrigger && !evtPowerAgentId) return null

  const ownerAgent = ctx.panelContext.agents.find((item) => item.id === ownerAgentId)
  const evtOwnerIsMb = ownerAgent?.profession === MB_PROFESSION
  const evtBaseDamageSource: BaseDamageSource = evtOwnerIsMb ? 'pierce' : ctx.baseDamageSource

  const tAgent = evtPowerAgentId
    ? ctx.panelContext.agents.find((a) => a.id === evtPowerAgentId)
    : undefined
  const evtPowerElement = eventNeedsTrigger ? tAgent?.element : ownerAgent?.element
  const evtTriggerIsMb = tAgent?.profession === MB_PROFESSION

  const skillCtx = buildSkillContextFromHit(hit, ownerAgent?.element)

  const ownerExternal = resolveExternalForAgent(
    ctx,
    ownerAgentId,
    ownerSlotIndex,
    mainExternal,
  )
  const ownerExtraMods = buildOptimalExtraModsForEvent(ctx, hit, ownerAgentId)
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
  let evtFinalPanel = applyHitPanelMods(
    applyEventMultOverrides(evtBreakdown.finalPanel, hit.multOverrides),
    hit.panelMods,
  )

  const evtPierce = computePiercePower(
    evtFinalPanel.hp,
    evtFinalPanel.atk,
    evtBreakdown.totalMods.pierce,
  )

  let evtTriggerFinalPanel: PanelStats | undefined
  let evtTriggerPierce: number | undefined
  let producerBreakdown: OptimalPanelBreakdown | undefined
  let producerExternalPanel: PanelStats | undefined

  /** 异常强度提供者是否不是主 C（扫掠敏感度等元数据用） */
  const usesNonMainProducer = Boolean(
    eventNeedsTrigger && evtPowerAgentId && evtPowerAgentId !== ctx.mainAgentId,
  )
  const mainlyProducerDriven =
    usesNonMainProducer &&
    (damageType === 'disorder' || damageType === 'turbulence' || damageType === 'anomaly')

  if (eventNeedsTrigger && evtPowerAgentId) {
    const tSlotIndex = ctx.panelContext.teamSlots.findIndex(
      (slot) => slot.agentId === evtPowerAgentId,
    )
    if (tSlotIndex < 0) return null

    if (evtPowerAgentId === ownerAgentId) {
      // 提供者 = 持有者：复用已算好的持有者面板，并显式填入 producer* 供过程明细展示
      evtTriggerFinalPanel = evtFinalPanel
      evtTriggerPierce = evtPierce
      producerExternalPanel = ownerExternal
      producerBreakdown = evtBreakdown
    } else {
      const tExternal = resolveExternalForAgent(ctx, evtPowerAgentId, tSlotIndex, mainExternal)
      producerExternalPanel = tExternal
      const tExtraMods = buildOptimalExtraModsForEvent(ctx, hit, evtPowerAgentId)
      producerBreakdown = computeFinalPanel(tExternal, {
        ...buildPanelContextForSlot(ctx, tSlotIndex, tExternal, mainExternal, tExtraMods),
        skillContext: buildSkillContextFromHit(hit, tAgent?.element),
      })
      // 招式倍率覆写：紊乱/乱流落到强度提供者面板
      evtTriggerFinalPanel = applyEventMultOverrides(producerBreakdown.finalPanel, {
        disorderBaseMult: hit.multOverrides?.disorderBaseMult,
        disorderBaseMultFactor: hit.multOverrides?.disorderBaseMultFactor,
        disorderCompMult: hit.multOverrides?.disorderCompMult,
        turbulenceBaseMult: hit.multOverrides?.turbulenceBaseMult,
        turbulenceBaseMultFactor: hit.multOverrides?.turbulenceBaseMultFactor,
        turbulenceCompMult: hit.multOverrides?.turbulenceCompMult,
      })
      evtTriggerPierce = computePiercePower(
        evtTriggerFinalPanel.hp,
        evtTriggerFinalPanel.atk,
        producerBreakdown.totalMods.pierce,
      )
    }

    const o = hit.multOverrides
    if (evtTriggerFinalPanel) {
      if (damageType === 'disorder') {
        if (o?.disorderBaseMult == null) {
          evtFinalPanel.disorderBaseMult = evtTriggerFinalPanel.disorderBaseMult
        }
        if (o?.disorderBaseMultFactor == null) {
          evtFinalPanel.disorderBaseMultFactor = evtTriggerFinalPanel.disorderBaseMultFactor
        }
        if (o?.disorderCompMult == null) {
          evtFinalPanel.disorderCompMult = evtTriggerFinalPanel.disorderCompMult
        }
      } else if (damageType === 'turbulence') {
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

  const sub = ctx.resolveSubcategory?.(hit.skill.buffAnchorId ?? null) ?? null
  const overrides = hit.multOverrides
  // 倍率修正只写面板，避免与 resolveSkillMults 双重相乘
  const effectiveSub =
    sub && overrides ? mergeSkillSubcategoryMultOverrides(sub, overrides) : sub

  const luminousMods = resolveLuminousTeamModifiersForOptimal(ctx, mainExternal)

  // 属性异常/异放/耀变类型增伤取触发者；紊乱/乱流取持有者；直伤回落 owner
  let anomalyTriggerPanel = evtFinalPanel
  let bonusExternalPanel = ownerExternal
  let bonusBreakdown: OptimalPanelBreakdown = evtBreakdown
  if (eventNeedsTrigger) {
    if (!hit.triggerAgentId) return null
    if (hit.triggerAgentId !== ownerAgentId) {
      const trigSlotIndex = ctx.panelContext.teamSlots.findIndex(
        (slot) => slot.agentId === hit.triggerAgentId,
      )
      if (trigSlotIndex < 0) return null
      const trigExternal = resolveExternalForAgent(
        ctx,
        hit.triggerAgentId,
        trigSlotIndex,
        mainExternal,
      )
      const trigAgent = ctx.panelContext.agents.find((item) => item.id === hit.triggerAgentId)
      bonusBreakdown = computeFinalPanel(trigExternal, {
        ...buildPanelContextForSlot(
          ctx,
          trigSlotIndex,
          trigExternal,
          mainExternal,
          buildOptimalExtraModsForEvent(ctx, hit, hit.triggerAgentId),
        ),
        skillContext: buildSkillContextFromHit(hit, trigAgent?.element),
      })
      anomalyTriggerPanel = bonusBreakdown.finalPanel
      bonusExternalPanel = trigExternal
    }
  }

  if (damageType === 'anomaly' || damageType === 'anomalyRelease') {
    anomalyTriggerPanel = applyEventMultOverrides(anomalyTriggerPanel, {
      anomalyMult: hit.multOverrides?.anomalyMult,
      anomalyMultFactor: hit.multOverrides?.anomalyMultFactor,
      anomalyReleaseMult: hit.multOverrides?.anomalyReleaseMult,
      anomalyReleaseMultFactor: hit.multOverrides?.anomalyReleaseMultFactor,
    })
  }

  if (damageType === 'anomalyRelease') {
    const needReleaseMult = hit.multOverrides?.anomalyReleaseMult == null
    const needReleaseFactor = hit.multOverrides?.anomalyReleaseMultFactor == null
    if (needReleaseMult || needReleaseFactor) {
      const triggerId = hit.triggerAgentId ?? ownerAgentId
      const trigSlotIndex = ctx.panelContext.teamSlots.findIndex(
        (slot) => slot.agentId === triggerId,
      )
      const trigExternal =
        triggerId === ownerAgentId
          ? ownerExternal
          : resolveExternalForAgent(ctx, triggerId, trigSlotIndex, mainExternal)
      const trigAgent = ctx.panelContext.agents.find((item) => item.id === triggerId)
      const trigPanelCtx =
        triggerId === ownerAgentId
          ? evtPanelCtx
          : {
              ...buildPanelContextForSlot(
                ctx,
                trigSlotIndex,
                trigExternal,
                mainExternal,
                buildOptimalExtraModsForEvent(ctx, hit, triggerId),
              ),
              skillContext: buildSkillContextFromHit(hit, trigAgent?.element),
            }
      const releaseFields = resolveAnomalyReleaseMultFields(
        trigExternal,
        trigPanelCtx,
        evtPowerElement,
      )
      anomalyTriggerPanel = {
        ...anomalyTriggerPanel,
        anomalyReleaseMult: needReleaseMult
          ? releaseFields.anomalyReleaseMult
          : anomalyTriggerPanel.anomalyReleaseMult,
        anomalyReleaseMultFactor: needReleaseFactor
          ? releaseFields.anomalyReleaseMultFactor
          : anomalyTriggerPanel.anomalyReleaseMultFactor,
      }
    }
  }

  // 耀变综合增伤/倍率/特殊倍率取异常类触发者
  if (damageType === 'radiance') {
    anomalyTriggerPanel = applyRadianceBonusMultOverrides(anomalyTriggerPanel, hit.multOverrides)
  }

  const usesTriggerBonus =
    damageType === 'anomaly' ||
    damageType === 'anomalyRelease' ||
    damageType === 'radiance'
  const bonusFinalPanel = usesTriggerBonus ? anomalyTriggerPanel : evtFinalPanel
  const bonusExternalForTips = usesTriggerBonus ? bonusExternalPanel : ownerExternal
  const bonusBreakdownForTips = usesTriggerBonus ? bonusBreakdown : evtBreakdown

  const ownerResistance = resolveDamageCalcResistanceElements(
    ctx.panelContext.teamSlots,
    ctx.panelContext.agents,
    ownerSlotIndex,
    evtPowerAgentId,
  )
  const triggerAgentDoc = hit.triggerAgentId
    ? ctx.panelContext.agents.find((item) => item.id === hit.triggerAgentId)
    : undefined

  const result = computeDamageResult({
    finalPanel: evtFinalPanel,
    anomalyTriggerPanel,
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
    staggerPhase: hit.staggerPhase,
    ownerAgentElement: ownerAgent?.element ?? '',
    ownerAgentResistanceElement: ownerResistance.mainAgentResistanceElement,
    anomalyTriggerElement: triggerAgentDoc?.element,
    mainAgentElement: ownerAgent?.element ?? '',
    ...ownerResistance,
    mainAgentId: ctx.mainAgentId,
    mainAgentName: ctx.mainAgentName,
    anomalySubKind,
    triggerFinalPanel: evtTriggerFinalPanel,
    triggerAgentElement: eventNeedsTrigger ? evtPowerElement : undefined,
    triggerPiercePower: evtTriggerPierce,
    triggerBaseDamageSource: evtTriggerIsMb ? 'pierce' : 'atk',
    triggerIsMb: evtTriggerIsMb,
    skillSubcategory: effectiveSub,
    mainAgentLevel: resolveProducerAgentLevel(ctx, ownerAgentId),
    ownerAgentLevel: resolveProducerAgentLevel(ctx, ownerAgentId),
    triggerAgentLevel: evtPowerAgentId
      ? resolveProducerAgentLevel(ctx, evtPowerAgentId)
      : resolveProducerAgentLevel(ctx, ownerAgentId),
    mutationZone: luminousMods.mutationZone,
    remielRadianceResPen: damageType === 'radiance' ? luminousMods.radianceResPen : 0,
    remielSelfRadianceCalc: resolveRemielSelfRadianceCalcForOptimal(
      ctx,
      evtPowerAgentId,
      mainExternal,
      skillCtx,
    ),
  })

  const perHit = pickEventDamage(result, damageType, hit.critMode)
  const total = perHit * hit.count
  const displayName = `${ownerAgent?.name ? `${ownerAgent.name} · ` : ''}${hit.skill.name}`

  const remiel = findLuminousAgentInTeam(ctx.panelContext.teamSlots, ctx.panelContext.agents)
  const remielName = remiel
    ? ctx.panelContext.agents.find((item) => item.id === remiel.id)?.name
    : undefined
  const triggerName = hit.triggerAgentId
    ? ctx.panelContext.agents.find((item) => item.id === hit.triggerAgentId)?.name
    : undefined
  const baseAgentLabel = eventNeedsTrigger
    ? formatAnomalyFormulaAgentLabel('anomalyPower', tAgent?.name)
    : formatAnomalyFormulaAgentLabel('owner', ownerAgent?.name)
  const bonusAgentLabel = usesTriggerBonus
    ? formatAnomalyFormulaAgentLabel('trigger', triggerName ?? ownerAgent?.name)
    : formatAnomalyFormulaAgentLabel('owner', ownerAgent?.name)
  const mutationAgentLabel =
    remielName && result.mutationZone > 1
      ? formatAnomalyFormulaAgentLabel('mutation', remielName)
      : undefined

  let remielSelfAtkSourceItems: string[] | undefined
  let remielSelfMasterySourceItems: string[] | undefined
  let remielSelfExternalPanel: PanelStats | undefined
  let remielSelfSources: OptimalPanelBreakdown['sources'] | undefined
  let remielSelfFinalPanel: PanelStats | undefined
  if (result.remielSelfRadianceActive && remiel) {
    const remielExternal = resolveExternalForAgent(ctx, remiel.id, remiel.slotIndex, mainExternal)
    const remielCtx = buildPanelContextForSlot(ctx, remiel.slotIndex, remielExternal, mainExternal)
    const restricted = collectRemielSelfRestrictedContributions(
      remielExternal,
      { ...remielCtx, skillContext: skillCtx },
      remiel.slotIndex,
    )
    const selfBreakdown = computeRemielSelfInCombatPanel(
      remielExternal,
      remielCtx,
      remiel.slotIndex,
    )
    remielSelfAtkSourceItems = restricted.atkItems
    remielSelfMasterySourceItems = restricted.masteryItems
    remielSelfExternalPanel = remielExternal
    remielSelfSources = selfBreakdown.sources
    remielSelfFinalPanel = selfBreakdown.finalPanel
  }

  return {
    hit,
    eventId: hit.id,
    displayName,
    kind: damageType,
    perHit,
    total,
    usesNonMainProducer,
    mainlyProducerDriven,
    result,
    finalPanel: evtFinalPanel,
    // 过程明细的「局外面板」必须是招式持有者，不能误用主 C（最优词条）面板
    external: ownerExternal,
    breakdown: evtBreakdown,
    piercePower: evtPierce,
    anomalySubKind,
    // 只要有异常强度提供者，就带上其面板与名字，避免回落到主 C（如蕾米埃尔）面板
    producerFinalPanel: evtTriggerFinalPanel,
    producerExternalPanel,
    producerBreakdown,
    producerAgentLabel: eventNeedsTrigger
      ? formatAnomalyFormulaAgentLabel('anomalyPower', tAgent?.name)
      : undefined,
    bonusFinalPanel,
    bonusExternalPanel: bonusExternalForTips,
    bonusBreakdown: bonusBreakdownForTips,
    defenseTriggerFinalPanel: eventNeedsTrigger ? anomalyTriggerPanel : undefined,
    defenseTriggerExternalPanel: eventNeedsTrigger ? bonusExternalPanel : undefined,
    defenseTriggerBreakdown: eventNeedsTrigger ? bonusBreakdown : undefined,
    defenseTriggerAgentLabel: eventNeedsTrigger
      ? formatAnomalyFormulaAgentLabel('trigger', triggerName ?? ownerAgent?.name)
      : undefined,
    baseAgentLabel,
    bonusAgentLabel,
    mutationAgentLabel,
    mutationFinalPanel: luminousMods.finalPanel,
    mutationExternalPanel: luminousMods.external,
    mutationSources: luminousMods.sources,
    remielSelfAtkSourceItems,
    remielSelfMasterySourceItems,
    remielSelfExternalPanel,
    remielSelfSources,
    remielSelfFinalPanel,
    remielIsMb: luminousMods.remielIsMb,
  }
}

function evaluateOptimalDamageEvent(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats,
  hit: ResolvedHit,
): OptimalEventDamageLine | null {
  const detail = evaluateOptimalEventDetail(ctx, mainExternal, hit)
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
  const hits = ctx.hits ?? []
  if (!hits.length) {
    return { grandTotal: 0, eventLines: [], firstResult: null, firstBreakdown: null }
  }

  let grandTotal = 0
  const eventLines: OptimalEventDamageLine[] = []
  let firstResult: DamageCalcResult | null = null
  let firstBreakdown: OptimalPanelBreakdown | null = null

  for (const hit of hits) {
    const line = evaluateOptimalDamageEvent(ctx, external, hit)
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
        ...resolveDamageCalcResistanceElements(
          ctx.panelContext.teamSlots,
          ctx.panelContext.agents,
          ctx.panelContext.mainSlotIndex,
          ctx.triggerAnomalyAgentId,
        ),
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
  const hits = ctx.hits ?? []
  if (!hits.length) return { grandTotal: 0, eventLines: [] }

  let grandTotal = 0
  const eventLines: OptimalEventDamageLine[] = []
  for (const hit of hits) {
    const line = evaluateOptimalDamageEvent(ctx, external, hit)
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
  if (ctx.hits?.length) {
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
      ...resolveDamageCalcResistanceElements(
        ctx.panelContext.teamSlots,
        ctx.panelContext.agents,
        ctx.panelContext.mainSlotIndex,
        ctx.triggerAnomalyAgentId,
      ),
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
    ctx.hits
      ?.map(
        (hit) =>
          `${hit.id}:${hit.skill.id}:${hit.count}:${hit.critMode}:${hit.staggerPhase}` +
          `:${hit.anomalyPowerAgentId ?? ''}:${hit.triggerAgentId ?? ''}` +
          `:${JSON.stringify(hit.multOverrides ?? {})}` +
          `:${JSON.stringify(hit.panelMods ?? {})}`,
      )
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

  if (ctx.hits?.length) {
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
        ...resolveDamageCalcResistanceElements(
          ctx.panelContext.teamSlots,
          ctx.panelContext.agents,
          ctx.panelContext.mainSlotIndex,
          ctx.triggerAnomalyAgentId,
        ),
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
    ...resolveDamageCalcResistanceElements(
      ctx.panelContext.teamSlots,
      ctx.panelContext.agents,
      ctx.panelContext.mainSlotIndex,
      ctx.triggerAnomalyAgentId,
    ),
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

/** 使局内暴击率刚好 > 100% 的最小暴击条数（只算面板，不算事件） */
export function findMinCritRollsForOvercap(
  ctx: OptimalEvalContext,
  baseState: Omit<DirectAllocState, 'critRate' | 'totalRolls'>,
  maxSearch = DIRECT_CONSTRAINTS.maxTotalRolls,
): number {
  const critCap = affixRollCap(ctx.driveDiscMainStats, 'critRate')
  const limit = Math.min(maxSearch, Number.isFinite(critCap) ? critCap : maxSearch)
  const panelOnlyCtx: OptimalEvalContext = { ...ctx, hits: undefined }
  for (let n = 0; n <= limit; n += 1) {
    const counts = buildDirectAffixCounts(
      ctx.isMb,
      { ...baseState, critRate: n, totalRolls: n },
      0,
      0,
    )
    const { finalPanel } = evaluateAffixCounts(panelOnlyCtx, counts)
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
      const evaled = evaluateAffixCounts(ctx, affixCounts)
      points.push({
        outPercent: hpPercent,
        critDmg,
        label: `局外大生命${hpPercent}/爆伤${critDmg}`,
        affixCounts,
        evalSnapshot: evaled,
        directExpected: evaled.grandTotal,
        eventLines: evaled.eventLines,
        grandTotal: evaled.grandTotal,
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
    const evaled = evaluateAffixCounts(ctx, affixCounts)
    points.push({
      outPercent,
      critDmg,
      label: `${outLabel}${outPercent}/爆伤${critDmg}`,
      affixCounts,
      evalSnapshot: evaled,
      directExpected: evaled.grandTotal,
      eventLines: evaled.eventLines,
      grandTotal: evaled.grandTotal,
    })
  }
  return points
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

export type SweepAsyncOptions = {
  chunkSize?: number
  signal?: AbortSignal
}

/** 分片扫掠直伤，避免长循环卡住主线程 */
export async function sweepDirectDamageAsync(
  ctx: OptimalEvalContext,
  state: DirectAllocState,
  options?: SweepAsyncOptions,
): Promise<DirectSweepPoint[]> {
  const chunkSize = Math.max(1, options?.chunkSize ?? 6)
  const signal = options?.signal
  const crit = clampInt(state.critRate, 0, DIRECT_CONSTRAINTS.maxTotalRolls)
  const total = clampInt(state.totalRolls, crit, DIRECT_CONSTRAINTS.maxTotalRolls)
  const caps = getAffixRollCaps(ctx.driveDiscMainStats)
  const points: DirectSweepPoint[] = []
  let sinceYield = 0

  const pushPoint = async (point: DirectSweepPoint) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    points.push(point)
    sinceYield += 1
    if (sinceYield >= chunkSize) {
      sinceYield = 0
      await yieldToMain()
    }
  }

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
      const swept = evaluateAffixCountsForSweep(ctx, affixCounts)
      await pushPoint({
        outPercent: hpPercent,
        critDmg,
        label: `局外大生命${hpPercent}/爆伤${critDmg}`,
        affixCounts,
        evalSnapshot: null,
        directExpected: swept.grandTotal,
        eventLines: swept.eventLines,
        grandTotal: swept.grandTotal,
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
    const swept = evaluateAffixCountsForSweep(ctx, affixCounts)
    await pushPoint({
      outPercent,
      critDmg,
      label: `${outLabel}${outPercent}/爆伤${critDmg}`,
      affixCounts,
      evalSnapshot: null,
      directExpected: swept.grandTotal,
      eventLines: swept.eventLines,
      grandTotal: swept.grandTotal,
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
    const evaled = evaluateAffixCounts(ctx, affixCounts)
    points.push({
      outPercent,
      mastery,
      label: `${outLabel}${outPercent}/精通${mastery}`,
      affixCounts,
      evalSnapshot: evaled,
      anomalyExpected: evaled.grandTotal,
      disorderExpected: evaled.result.disorderExpected,
      turbulenceExpected: evaled.result.turbulenceExpected,
      anomalyReleaseExpected: evaled.result.anomalyReleaseExpected,
      radianceExpected: evaled.result.radianceExpected,
      eventLines: evaled.eventLines,
      grandTotal: evaled.grandTotal,
    })
  }
  return points
}

/** 分片扫掠异常，避免长循环卡住主线程 */
export async function sweepAnomalyDamageAsync(
  ctx: OptimalEvalContext,
  state: AnomalyAllocState,
  options?: SweepAsyncOptions,
): Promise<AnomalySweepPoint[]> {
  const chunkSize = Math.max(1, options?.chunkSize ?? 6)
  const signal = options?.signal
  const total = clampInt(state.totalRolls, 0, ANOMALY_CONSTRAINTS.maxTotalRolls)
  const outLabel = outPercentLabel(ctx.isMb)
  const caps = getAffixRollCaps(ctx.driveDiscMainStats)
  const outCap = ctx.isMb ? caps.hpPercent : caps.atkPercent
  const points: AnomalySweepPoint[] = []
  let sinceYield = 0

  for (let outPercent = 0; outPercent <= total; outPercent += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const mastery = total - outPercent
    if (outPercent > outCap || mastery > caps.mastery) continue
    const affixCounts = buildAnomalyAffixCounts(ctx.isMb, { ...state, totalRolls: total }, outPercent, mastery)
    if (ctx.hits?.length) {
      const swept = evaluateAffixCountsForSweep(ctx, affixCounts)
      points.push({
        outPercent,
        mastery,
        label: `${outLabel}${outPercent}/精通${mastery}`,
        affixCounts,
        evalSnapshot: null,
        anomalyExpected: swept.grandTotal,
        disorderExpected: swept.grandTotal,
        turbulenceExpected: swept.grandTotal,
        anomalyReleaseExpected: swept.grandTotal,
        radianceExpected: swept.grandTotal,
        eventLines: swept.eventLines,
        grandTotal: swept.grandTotal,
      })
    } else {
      const evaled = evaluateAffixCounts(ctx, affixCounts)
      points.push({
        outPercent,
        mastery,
        label: `${outLabel}${outPercent}/精通${mastery}`,
        affixCounts,
        evalSnapshot: null,
        anomalyExpected: evaled.result.anomalyExpected,
        disorderExpected: evaled.result.disorderExpected,
        turbulenceExpected: evaled.result.turbulenceExpected,
        anomalyReleaseExpected: evaled.result.anomalyReleaseExpected,
        radianceExpected: evaled.result.radianceExpected,
        eventLines: evaled.eventLines,
        grandTotal: evaled.grandTotal,
      })
    }
    sinceYield += 1
    if (sinceYield >= chunkSize) {
      sinceYield = 0
      await yieldToMain()
    }
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

function resolveEvalMetricDamage(
  evaled: {
    result: DamageCalcResult
    grandTotal: number
    eventLines: OptimalEventDamageLine[]
  },
  kind: OptimalDamageKind,
  anomalyMetric: OptimalAnomalyMetric,
  selectedEventIds?: string[] | null,
): number {
  if (selectedEventIds?.length && evaled.eventLines.length) {
    const ids = new Set(selectedEventIds)
    return evaled.eventLines
      .filter((line) => ids.has(line.eventId))
      .reduce((sum, line) => sum + line.total, 0)
  }
  return damageMetric(evaled.result, kind, anomalyMetric, evaled.grandTotal)
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

function resolveSweepMetricDamage(
  evaled: { grandTotal: number; eventLines: OptimalEventDamageLine[] },
  selectedEventIds?: string[] | null,
): number {
  if (selectedEventIds?.length && evaled.eventLines.length) {
    const ids = new Set(selectedEventIds)
    return evaled.eventLines
      .filter((line) => ids.has(line.eventId))
      .reduce((sum, line) => sum + line.total, 0)
  }
  return evaled.grandTotal
}

/** 差异/曲线用：有事件走轻量扫掠口径；无事件仍走完整评估（要分子类伤害） */
function evaluateAffixForDiffMetric(ctx: OptimalEvalContext, affixCounts: AffixCounts) {
  if (ctx.hits?.length) return evaluateAffixCountsForSweep(ctx, affixCounts)
  const full = evaluateAffixCounts(ctx, affixCounts)
  return {
    grandTotal: full.grandTotal,
    eventLines: full.eventLines,
    result: full.result,
  }
}

export function computeDiffAnalysis(
  ctx: OptimalEvalContext,
  baseCounts: AffixCounts,
  kind: OptimalDamageKind,
  anomalyMetric: OptimalAnomalyMetric = 'anomaly',
  selectedEventIds?: string[] | null,
): { addOne: AffixDiffRow[]; replace: AffixReplaceRow[] } {
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb) : anomalyCandidateKeys(ctx.isMb)
  const base = evaluateAffixForDiffMetric(ctx, baseCounts)
  const baseDmg = ctx.hits?.length
    ? resolveSweepMetricDamage(base, selectedEventIds)
    : resolveEvalMetricDamage(
        base as {
          result: DamageCalcResult
          grandTotal: number
          eventLines: OptimalEventDamageLine[]
        },
        kind,
        anomalyMetric,
        selectedEventIds,
      )
  const mainStats = ctx.driveDiscMainStats

  const metricOf = (evaled: ReturnType<typeof evaluateAffixForDiffMetric>) =>
    ctx.hits?.length
      ? resolveSweepMetricDamage(evaled, selectedEventIds)
      : resolveEvalMetricDamage(
          evaled as {
            result: DamageCalcResult
            grandTotal: number
            eventLines: OptimalEventDamageLine[]
          },
          kind,
          anomalyMetric,
          selectedEventIds,
        )

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
        capped: true,
        note: affixCapLimitNote(mainStats, key, baseCounts[key] ?? 0),
      }
    }
    const bumped = bumpAffix(baseCounts, key, 1)
    const next = evaluateAffixForDiffMetric(ctx, bumped)
    const nextDmg = metricOf(next)
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

  const ownedKeys = candidates.filter((key) => (baseCounts[key] ?? 0) > 0)
  const replace: AffixReplaceRow[] = ownedKeys.map((key) => {
    const without = bumpAffix(baseCounts, key, -1)
    let bestReplaceKey = key
    let bestDelta = -Infinity
    let bestAdd = 0
    let found = false

    for (const cand of candidates) {
      if (cand === key) continue
      const nextCount = (without[cand] ?? 0) + 1
      if (exceedsAffixCap(mainStats, cand, nextCount)) continue
      const swapped = bumpAffix(without, cand, 1)
      const evaled = evaluateAffixForDiffMetric(ctx, swapped)
      const dmg = metricOf(evaled)
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
        capped: true,
        note: '可替换目标均已达主词条约束上限',
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
      return `编辑中角色副词条变化可影响该事件（含蕾米埃尔攻击转模等全队增益，最大变化 ${maxDelta.toFixed(2)}）`
    }
    return `编辑中角色副词条变化可影响该事件（最大变化 ${maxDelta.toFixed(2)}）`
  }
  if (line.kind === 'anomalyRelease' && line.total <= AFFIX_IMPACT_EPS) {
    return '异放倍率为 0 或未配置产生角色，当前无法计算异放伤害'
  }
  return '不受编辑中角色副词条变化影响'
}

/** 各伤害事件对编辑中角色副词条变化的敏感度 */
export function computeEventAffixImpact(
  ctx: OptimalEvalContext,
  baseCounts: AffixCounts,
  kind: OptimalDamageKind,
): OptimalEventAffixImpact[] {
  if (!ctx.hits?.length) return []
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
  selectedEventIds?: string[] | null,
): { series: BenefitCurveSeries[]; nextStep: AffixDiffRow[] } {
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb) : anomalyCandidateKeys(ctx.isMb)
  const metricOf = (evaled: ReturnType<typeof evaluateAffixForDiffMetric>) =>
    ctx.hits?.length
      ? resolveSweepMetricDamage(evaled, selectedEventIds)
      : resolveEvalMetricDamage(
          evaled as {
            result: DamageCalcResult
            grandTotal: number
            eventLines: OptimalEventDamageLine[]
          },
          kind,
          anomalyMetric,
          selectedEventIds,
        )
  const base = evaluateAffixForDiffMetric(ctx, baseCounts)
  const baseDmg = metricOf(base)
  const mainStats = ctx.driveDiscMainStats

  const series: BenefitCurveSeries[] = candidates.map((key) => {
    const cumulativePercent = [0]
    const marginalPercent = [0]
    const cappedAt = [false]
    let counts = { ...baseCounts }
    let prevDmg = baseDmg
    let capped = false
    let lastCum = 0

    for (let n = 1; n <= maxAdded; n += 1) {
      if (capped || exceedsAffixCap(mainStats, key, (counts[key] ?? 0) + 1)) {
        capped = true
        cumulativePercent.push(lastCum)
        marginalPercent.push(0)
        cappedAt.push(true)
        continue
      }
      counts = bumpAffix(counts, key, 1)
      const evaled = evaluateAffixForDiffMetric(ctx, counts)
      const dmg = metricOf(evaled)
      const cum = baseDmg > 0 ? ((dmg - baseDmg) / baseDmg) * 100 : 0
      const mar = prevDmg > 0 ? ((dmg - prevDmg) / prevDmg) * 100 : 0
      cumulativePercent.push(cum)
      marginalPercent.push(mar)
      cappedAt.push(false)
      prevDmg = dmg
      lastCum = cum
    }

    return {
      key,
      label: affixKeyLabel(key, ctx.isMb),
      color: SERIES_COLORS[key] ?? '#9aa3b0',
      cumulativePercent,
      marginalPercent,
      cappedAt,
    }
  })

  const nextStep = computeDiffAnalysis(ctx, baseCounts, kind, anomalyMetric, selectedEventIds).addOne

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
  hits?: ResolvedHit[]
  /** 页级异常强度提供者 id（命名含 trigger，实为 power） */
  triggerAnomalyAgentId?: string | null
  resolveSubcategory?: (id: string | null) => SkillSubcategory | null
  skillSubcategories?: SkillSubcategory[]
  followUpSkillRules?: import('@/types/calculator').FollowUpSkillRule[]
  environmentBuffs?: import('@/utils/environmentBuffCalc').EnvironmentBuffEntry[]
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
      liveExternalSlotIndex: input.mainSlotIndex,
      driveDiscs: input.driveDiscs,
      skillContext: input.skillContext,
      buffSelection: input.buffSelection,
      anomalySlotPanels: input.anomalySlotPanels,
      convertSlotPanels: input.convertSlotPanels,
      slotExternalPanels: Object.fromEntries(
        input.teamSlots.flatMap((slot, index) => {
          if (!slot.agentId) return []
          // 主 C：最优词条自己扫。队友按该人导入方式：词条用推导，面板用手填，互不顶替。
          if (index !== input.mainSlotIndex) {
            if (resolveSlotPanelEntryMode(slot) === 'affix') {
              return [
                [
                  index,
                  computeExternalPanelFromTeamSlot({
                    slot,
                    agents: input.agents,
                    wengines: input.wengines,
                    driveDiscs: input.driveDiscs,
                  }),
                ],
              ]
            }
            const saved = input.anomalySlotPanels?.[slot.agentId]
            if (saved) {
              return [[index, fillPanelStatsDefaults(saved)]]
            }
            const agent = input.agents.find((item) => item.id === slot.agentId)
            return [[index, createExternalPanelFromAgentBase(agent?.basePanel)]]
          }
          return [
            [
              index,
              computeExternalPanelFromTeamSlot({
                slot,
                agents: input.agents,
                wengines: input.wengines,
                driveDiscs: input.driveDiscs,
                overrideAffix: {
                  affixCounts: {
                    ...createEmptyAffixCounts(),
                    ...slot.affixCounts,
                  },
                  affixDriveDiscMainStats: input.driveDiscMainStats,
                },
              }),
            ],
          ]
        }),
      ),
      baseAnomalyControl: mainAgent?.basePanel.anomalyControl ?? 0,
      baseEnergyRegen: mainAgent?.basePanel.energyRegen ?? 0,
      environmentBuffs: input.environmentBuffs,
      extraGains: input.extraGains,
    },
    enemyInput: input.enemyInput,
    baseDamageSource: input.baseDamageSource,
    mainAgentElement: mainAgent?.element ?? '',
    mainAgentId: mainAgent?.id ?? '',
    mainAgentName: mainAgent?.name ?? '',
    hits: input.hits,
    extraGains: input.extraGains,
    triggerAnomalyAgentId: input.triggerAnomalyAgentId,
    slotBuffSelections: input.slotBuffSelections,
    resolveSubcategory: input.resolveSubcategory,
    skillSubcategories: input.skillSubcategories,
    followUpSkillRules: input.followUpSkillRules,
  }
}
