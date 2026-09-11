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
  fillPanelStatsDefaults,
  isPlaceholderExternalPanel,
} from '@/types/calculatorPanel'
import {
  AFFIX_VALUE_PER_COUNT,
  applyAffixCountsToFixedParts,
  buildAffixExternalFixedParts,
  computeExternalPanelFromTeamSlot,
  type AffixExternalFixedParts,
  type AffixPanelCalcInput,
} from '@/utils/affixPanelCalc'
import { applyPanelDeltas, type AffixPanelDeltaField } from '@/utils/affixLibrary'
import {
  createEmptyAgentBasePanel,
  createEmptyBuffStatModifiers,
  createEmptyWengineAdvancedStats,
} from '@/utils/calculatorUi'
import {
  computeDamageResult,
  resolveBaseDamageSourceForProfession,
  type DamageCalcResult,
  type DamageEnemyInput,
} from '@/utils/damageCalc'
import {
  pickEventDamage,
  applyOwnerPanelMultOverrides,
  applyRadianceBonusMultOverrides,
  splitSkillZoneMultOverrides,
} from '@/utils/damageEvent'
import {
  buildSkillContextFromHit,
  getHitSkipReason,
  skillNeedsDualAgents,
  applyHitPanelMods,
  type ResolvedHit,
} from '@/utils/resolvedHit'
import { mergeExtraModsForEvent } from '@/utils/extraBuffCalc'
import { deepUnwrapReactive } from '@/utils/reactiveUnwrap'
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
import { isEffectEnabled } from '@/utils/buffEffect'
import {
  collectAllBuffEffects,
  computeFinalPanel,
  parseSourceKeySlotIndex,
  resolveAnomalyReleaseMultFields,
  type BuffSelectionState,
  type MultiSlotBuffSelection,
  type PanelCalcContext,
  resolveBuffSelectionForSlot,
  panelToConvertAttrValues,
  buildPanelSourceValuesBySlotMap,
} from '@/utils/panelBuffCalc'
import { formatAnomalyFormulaAgentLabel } from '@/utils/anomalyFormulaDisplay'

/** 扫掠 / 流程总伤只要面板数字，不拼「增益来自哪」明细 */
const PANEL_NUMBERS_ONLY = { includeDetails: false } as const

export type OptimalDamageKind = 'direct' | 'anomaly'

export type OptimalAnomalyMetric = 'anomaly' | 'disorder' | 'turbulence' | 'anomalyRelease' | 'radiance'

export type OptimalAffixKey =
  | 'atkFlat'
  | 'hpFlat'
  | 'defFlat'
  | 'atkPercent'
  | 'hpPercent'
  | 'defPercent'
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
  /** 类型增伤/倍率面板（全部异常子类含紊乱/乱流=异常类触发者） */
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
export type CappedAffixKey =
  | 'atkPercent'
  | 'hpPercent'
  | 'defPercent'
  | 'critRate'
  | 'critDmg'
  | 'mastery'

export type AffixRollCaps = Record<CappedAffixKey, number>

/** 副词条 key → 对应主词条 id */
const CAPPED_AFFIX_TO_MAIN_STAT: Record<CappedAffixKey, string> = {
  atkPercent: 'externalAtkPercent',
  hpPercent: 'externalHpPercent',
  defPercent: 'externalDefPercent',
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
    defPercent: affixRollCap(mainStats, 'defPercent'),
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
  /** 精通条数（固定填写，不参与总词条扫掠） */
  mastery: number
  critRate: number
  /** 非命破 = 暴击 + 爆伤 + 局外大攻击；命破 = 暴击 + 爆伤 + 局外大生命 + 局外大攻击（不含精通） */
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
  /** 主 C 为锋御：直伤扫盘用防御副词条，评估走锐化公式 */
  isFengYu: boolean
  agentBase: AffixPanelCalcInput['agentBase']
  wengineBaseAtk: number
  wengineBaseDef?: number
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
  /** 系列标识；扫掠模式为 OptimalAffixKey，词条分配模式为词条库条目 id */
  key: string
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

function resolveAffixOutPercentCap(caps: AffixRollCaps, isMb: boolean, isFengYu: boolean): number {
  if (isMb) return caps.hpPercent
  if (isFengYu) return caps.defPercent
  return caps.atkPercent
}

function resolvePanelOnlyDamageCalcBase(ctx: OptimalEvalContext) {
  return {
    baseDamageSource: ctx.isMb ? ('pierce' as const) : ctx.isFengYu ? ('def' as const) : ctx.baseDamageSource,
    isMbMainAgent: ctx.isMb,
    useSharpenFormula: Boolean(ctx.isFengYu),
  }
}

export function flatStatKey(isMb: boolean, isFengYu = false): 'atkFlat' | 'hpFlat' | 'defFlat' {
  if (isMb) return 'hpFlat'
  if (isFengYu) return 'defFlat'
  return 'atkFlat'
}

export function outPercentKey(
  isMb: boolean,
  isFengYu = false,
): 'atkPercent' | 'hpPercent' | 'defPercent' {
  if (isMb) return 'hpPercent'
  if (isFengYu) return 'defPercent'
  return 'atkPercent'
}

export function flatStatLabel(isMb: boolean, isFengYu = false) {
  if (isMb) return '生命值'
  if (isFengYu) return '防御力'
  return '攻击力'
}

export function outPercentLabel(isMb: boolean, isFengYu = false) {
  if (isMb) return '局外大生命'
  if (isFengYu) return '局外大防御'
  return '局外大攻击'
}

export function affixKeyLabel(key: OptimalAffixKey, _isMb: boolean): string {
  switch (key) {
    case 'atkFlat':
      return '攻击力'
    case 'hpFlat':
      return '生命值'
    case 'defFlat':
      return '防御力'
    case 'atkPercent':
      return '局外大攻击'
    case 'hpPercent':
      return '局外大生命'
    case 'defPercent':
      return '局外大防御'
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
  isFengYu = false,
): string | null {
  const atkFlat = clampInt(state.flatStat, 0, 99)
  const hpFlat = clampInt(state.hpFlat, 0, 99)
  const pen = clampInt(state.pen, 0, 99)
  const mastery = clampInt(state.mastery, 0, 99)
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
    ? mastery + atkFlat + hpFlat + pen + total
    : mastery + atkFlat + pen + total
  if (flatPenTotal > DIRECT_CONSTRAINTS.maxAtkPenTotal) {
    return isMb
      ? `精通+攻击力+生命值+穿透+总词条数不能超过 ${DIRECT_CONSTRAINTS.maxAtkPenTotal}`
      : `精通+${flatStatLabel(isMb, isFengYu)}+穿透+总词条数不能超过 ${DIRECT_CONSTRAINTS.maxAtkPenTotal}`
  }
  if (mainStats) {
    const caps = getAffixRollCaps(mainStats)
    if (mastery > caps.mastery) {
      return `精通条数不能超过主词条约束上限 ${caps.mastery}`
    }
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
      const outCap = resolveAffixOutPercentCap(caps, isMb, isFengYu)
      const outName = outPercentLabel(isMb, isFengYu)
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
  isFengYu = false,
): string | null {
  const flat = clampInt(state.flatStat, 0, 99)
  const pen = clampInt(state.pen, 0, 99)
  const total = clampInt(state.totalRolls, 0, ANOMALY_CONSTRAINTS.maxTotalRolls)
  if (total > ANOMALY_CONSTRAINTS.maxTotalRolls) {
    return `总词条数不能超过 ${ANOMALY_CONSTRAINTS.maxTotalRolls}`
  }
  if (flat + pen + total > ANOMALY_CONSTRAINTS.maxAtkPenTotal) {
    return `${flatStatLabel(isMb, isFengYu)}+穿透+总词条数不能超过 ${ANOMALY_CONSTRAINTS.maxAtkPenTotal}`
  }
  if (mainStats) {
    const caps = getAffixRollCaps(mainStats)
    const outCap = resolveAffixOutPercentCap(caps, isMb, isFengYu)
    const outName = outPercentLabel(isMb, isFengYu)
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
  isFengYu = false,
): AffixCounts {
  const counts = createEmptyAffixCounts()
  counts.pen = clampInt(state.pen, 0, 99)
  counts.mastery = clampInt(state.mastery, 0, 99)
  counts.critRate = clampInt(state.critRate, 0, 99)
  counts.critDmg = clampInt(critDmg, 0, 99)
  if (isMb) {
    counts.atkFlat = clampInt(state.flatStat, 0, 99)
    counts.hpFlat = clampInt(state.hpFlat, 0, 99)
    counts.hpPercent = clampInt(outPercent, 0, 99)
    counts.atkPercent = clampInt(state.atkPercent, 0, 99)
  } else if (isFengYu) {
    counts.defFlat = clampInt(state.flatStat, 0, 99)
    counts.defPercent = clampInt(outPercent, 0, 99)
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
  isFengYu = false,
): AffixCounts {
  const counts = createEmptyAffixCounts()
  const flatKey = flatStatKey(isMb, isFengYu)
  const percentKey = outPercentKey(isMb, isFengYu)
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
  // 直伤用招式持有者属性；异常类改用异常强度提供者属性（元素恒取强度提供者）
  const isAnomalyHit = hit.skill.damageType !== 'direct'
  const powerElement =
    isAnomalyHit && hit.anomalyPowerAgentId
      ? ctx.panelContext.agents.find((item) => item.id === hit.anomalyPowerAgentId)?.element
      : undefined
  const ownerElement =
    powerElement ||
    ctx.panelContext.agents.find((item) => item.id === ownerAgentId)?.element
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
  const panelSourceValuesBySlot = buildPanelSourceValuesBySlotMap(base, externalForSlot)
  return {
    ...base,
    panelSourceValues: panelSourceValuesBySlot.get(slotIndex),
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

/** A 是否有「按自己面板折算再给全队」且已勾选的转模。有则队友招式会跟着 A 词条变。 */
let mainAgentTeamConvertReadsPanelCached: boolean | null = null

function mainAgentTeamConvertReadsPanel(ctx: OptimalEvalContext): boolean {
  if (mainAgentTeamConvertReadsPanelCached != null) return mainAgentTeamConvertReadsPanelCached
  const mainIndex = ctx.panelContext.mainSlotIndex
  const selection = ctx.slotBuffSelections
    ? resolveBuffSelectionForSlot(ctx.slotBuffSelections, mainIndex)
    : ctx.panelContext.buffSelection
  for (const item of collectAllBuffEffects(ctx.panelContext)) {
    if (parseSourceKeySlotIndex(item.sourceKey) !== mainIndex) continue
    if (item.effect.applyTarget !== 'team') continue
    if (item.effect.kind !== 'convert' || !item.effect.convert) continue
    if ((item.effect.convert.panelSource ?? 'external') === 'manual') continue
    if (!isEffectEnabled(item.effect, selection)) continue
    mainAgentTeamConvertReadsPanelCached = true
    return true
  }
  mainAgentTeamConvertReadsPanelCached = false
  return false
}

/**
 * 这招算伤害时有没有用到 A 正在变的那张面板。
 * 用不到则整次「开始计算」只算一次，每根柱共用。拿不准当用到。
 */
export function optimalHitDependsOnMainAffixPanel(
  ctx: OptimalEvalContext,
  hit: ResolvedHit,
): boolean {
  const mainId = ctx.mainAgentId
  if (!mainId) return true
  if (hit.ownerAgentId === mainId) return true
  if (hit.anomalyPowerAgentId === mainId) return true
  if (hit.triggerAgentId === mainId) return true
  if (mainAgentTeamConvertReadsPanel(ctx)) return true
  const remiel = findLuminousAgentInTeam(ctx.panelContext.teamSlots, ctx.panelContext.agents)
  if (remiel?.id === mainId) {
    if (hit.skill.damageType === 'radiance' || hit.anomalySubKind === 'radiance') return true
  }
  return false
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
  includeDetails = true,
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
  const breakdown = computeFinalPanel(
    producerExternal,
    {
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
    },
    includeDetails ? undefined : PANEL_NUMBERS_ONLY,
  )
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
  options?: { includeDetails?: boolean },
): OptimalEventEvalDetail | null {
  const includeDetails = options?.includeDetails !== false
  const panelOpts = includeDetails ? undefined : PANEL_NUMBERS_ONLY
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
  const evtOwnerIsFengYu = ownerAgent?.profession === '锋御'
  const evtBaseDamageSource: BaseDamageSource = evtOwnerIsMb
    ? 'pierce'
    : evtOwnerIsFengYu
      ? 'def'
      : ctx.baseDamageSource
  const evtUseSharpen = evtOwnerIsFengYu || damageType === 'sharpen'

  const tAgent = evtPowerAgentId
    ? ctx.panelContext.agents.find((a) => a.id === evtPowerAgentId)
    : undefined
  const evtPowerElement = eventNeedsTrigger ? tAgent?.element : ownerAgent?.element
  const evtTriggerIsMb = tAgent?.profession === MB_PROFESSION
  const evtTriggerBaseDamageSource = resolveBaseDamageSourceForProfession(tAgent?.profession)

  // 直伤用招式持有者属性；异常类改用异常强度提供者属性（元素恒取强度提供者）
  const skillCtx = buildSkillContextFromHit(hit, evtPowerElement)

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
  const evtBreakdown = computeFinalPanel(ownerExternal, evtPanelCtx, panelOpts)
  const zoneMultResolved = splitSkillZoneMultOverrides(damageType, hit.multOverrides)
  const panelOverrides = zoneMultResolved.panelOverrides
  const evtFinalPanel = applyHitPanelMods(
    applyEventMultOverrides(evtBreakdown.finalPanel, panelOverrides),
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
      producerBreakdown = computeFinalPanel(
        tExternal,
        {
          ...buildPanelContextForSlot(ctx, tSlotIndex, tExternal, mainExternal, tExtraMods),
          skillContext: buildSkillContextFromHit(hit, tAgent?.element),
        },
        panelOpts,
      )
      // 招式倍率覆写：紊乱/乱流落到强度提供者面板（最终倍率区填写不进面板基础字段）
      evtTriggerFinalPanel = applyEventMultOverrides(producerBreakdown.finalPanel, {
        disorderBaseMult: panelOverrides?.disorderBaseMult,
        disorderBaseMultFactor: panelOverrides?.disorderBaseMultFactor,
        disorderCompMult: panelOverrides?.disorderCompMult,
        turbulenceBaseMult: panelOverrides?.turbulenceBaseMult,
        turbulenceBaseMultFactor: panelOverrides?.turbulenceBaseMultFactor,
        turbulenceCompMult: panelOverrides?.turbulenceCompMult,
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
        if (o?.disorderZoneMult == null && o?.disorderBaseMult == null) {
          evtFinalPanel.disorderBaseMult = evtTriggerFinalPanel.disorderBaseMult
        }
        if (o?.disorderZoneMult == null && o?.disorderBaseMultFactor == null) {
          evtFinalPanel.disorderBaseMultFactor = evtTriggerFinalPanel.disorderBaseMultFactor
        }
        if (o?.disorderCompMult == null) {
          evtFinalPanel.disorderCompMult = evtTriggerFinalPanel.disorderCompMult
        }
      } else if (damageType === 'turbulence') {
        if (o?.turbulenceZoneMult == null && o?.turbulenceBaseMult == null) {
          evtFinalPanel.turbulenceBaseMult = evtTriggerFinalPanel.turbulenceBaseMult
        }
        if (o?.turbulenceZoneMult == null && o?.turbulenceBaseMultFactor == null) {
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
    sub && panelOverrides ? mergeSkillSubcategoryMultOverrides(sub, panelOverrides) : sub

  const luminousMods = resolveLuminousTeamModifiersForOptimal(ctx, mainExternal, includeDetails)

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
      bonusBreakdown = computeFinalPanel(
        trigExternal,
        {
          ...buildPanelContextForSlot(
            ctx,
            trigSlotIndex,
            trigExternal,
            mainExternal,
            buildOptimalExtraModsForEvent(ctx, hit, hit.triggerAgentId),
          ),
          // 元素（属性系别）恒取异常强度提供者，避免触发者自身属性误匹配元素限定增益
          skillContext: buildSkillContextFromHit(
            hit,
            (hit.anomalyPowerAgentId
              ? ctx.panelContext.agents.find((item) => item.id === hit.anomalyPowerAgentId)?.element
              : undefined) || trigAgent?.element,
          ),
        },
        panelOpts,
      )
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
              // 元素（属性系别）恒取异常强度提供者，避免触发者自身属性误匹配元素限定增益
              skillContext: buildSkillContextFromHit(hit, evtPowerElement || trigAgent?.element),
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

  // 全部异常子类的类型增伤/倍率/暴击均取异常类触发者（含紊乱/乱流）
  const usesTriggerBonus =
    damageType === 'anomaly' ||
    damageType === 'anomalyRelease' ||
    damageType === 'radiance' ||
    damageType === 'disorder' ||
    damageType === 'turbulence'
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
    combatDirectVulnerable: evtBreakdown.combatMods.directVulnerable,
    combatAnomalyVulnerable: evtBreakdown.combatMods.anomalyVulnerable,
    combatDmgReduction: evtBreakdown.combatMods.dmgReduction,
    combatDirectDmgReduction: evtBreakdown.combatMods.directDmgReduction,
    combatAnomalyDmgReduction: evtBreakdown.combatMods.anomalyDmgReduction,
    combatGlobalStaggerVulnerable: evtBreakdown.combatMods.globalStaggerVulnerable,
    combatStaggerVulnerable: evtBreakdown.combatMods.staggerVulnerable,
    combatStaggerVulnerableOnly: evtBreakdown.combatMods.staggerVulnerableOnly,
    combatSpecial: evtBreakdown.combatMods.special,
    combatPierceDmgBonus: evtBreakdown.combatMods.pierceDmgBonus,
    combatSharpenDmgBonus: evtBreakdown.combatMods.sharpenDmgBonus,
    combatSharpenCritDmgBonus: evtBreakdown.combatMods.sharpenCritDmgBonus,
    combatDmgPenalty: evtBreakdown.combatMods.dmgPenalty,
    useSharpenFormula: evtUseSharpen,
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
    triggerBaseDamageSource: evtTriggerBaseDamageSource,
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
    disorderZoneMultOverride: zoneMultResolved.disorderZoneMult,
    disorderZoneMultFactorOverride: zoneMultResolved.disorderZoneMultFactor,
    turbulenceZoneMultOverride: zoneMultResolved.turbulenceZoneMult,
    turbulenceZoneMultFactorOverride: zoneMultResolved.turbulenceZoneMultFactor,
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
  if (includeDetails && result.remielSelfRadianceActive && remiel) {
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
  const detail = evaluateOptimalEventDetail(ctx, mainExternal, hit, PANEL_NUMBERS_ONLY)
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

/**
 * 取一条招式的伤害明细；「不随主 C 面板变化」的招式按 `hit.id` 跨轮复用。
 *
 * 判据是 `optimalHitDependsOnMainAffixPanel()`（拿不准时返回 true，即不缓存）。
 * 调用方（求解器每评估一次、扫掠每个点）都会重复问同样这些招式，而这类招式的
 * 结果在同一套配置下与主 C 词条无关，重算纯属浪费。
 */
function resolveEventLine(
  ctx: OptimalEvalContext,
  external: PanelStats,
  hit: ResolvedHit,
): OptimalEventDamageLine | null {
  if (optimalHitDependsOnMainAffixPanel(ctx, hit)) {
    return evaluateOptimalDamageEvent(ctx, external, hit)
  }
  if (!stableEventLinesByHitId) stableEventLinesByHitId = new Map()
  const cached = stableEventLinesByHitId.get(hit.id)
  if (cached) return cached
  const line = evaluateOptimalDamageEvent(ctx, external, hit)
  if (line) stableEventLinesByHitId.set(hit.id, line)
  return line
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
    const line = resolveEventLine(ctx, external, hit)
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
        ...resolvePanelOnlyDamageCalcBase(ctx),
        enemyInput: ctx.enemyInput,
        combatVulnerable: firstBreakdown.combatMods.vulnerable,
        combatDirectVulnerable: firstBreakdown.combatMods.directVulnerable,
        combatAnomalyVulnerable: firstBreakdown.combatMods.anomalyVulnerable,
        combatDmgReduction: firstBreakdown.combatMods.dmgReduction,
        combatDirectDmgReduction: firstBreakdown.combatMods.directDmgReduction,
        combatAnomalyDmgReduction: firstBreakdown.combatMods.anomalyDmgReduction,
        combatGlobalStaggerVulnerable: firstBreakdown.combatMods.globalStaggerVulnerable,
        combatStaggerVulnerable: firstBreakdown.combatMods.staggerVulnerable,
        combatStaggerVulnerableOnly: firstBreakdown.combatMods.staggerVulnerableOnly,
        combatSpecial: firstBreakdown.combatMods.special,
        combatPierceDmgBonus: firstBreakdown.combatMods.pierceDmgBonus,
        combatSharpenDmgBonus: firstBreakdown.combatMods.sharpenDmgBonus,
        combatSharpenCritDmgBonus: firstBreakdown.combatMods.sharpenCritDmgBonus,
        combatDmgPenalty: firstBreakdown.combatMods.dmgPenalty,
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
    const line = resolveEventLine(ctx, external, hit)
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
  panelDeltas?: AffixPanelDeltaMap,
): { grandTotal: number; eventLines: OptimalEventDamageLine[] } {
  resetAffixEvalCacheIfNeeded(ctx)
  const cacheKey = affixCountsCacheKey(affixCounts, panelDeltas)
  const cached = affixSweepCache.get(cacheKey)
  if (cached) return cached

  const external = computeExternalForEval(ctx, affixCounts, panelDeltas)

  let payload: { grandTotal: number; eventLines: OptimalEventDamageLine[] }
  if (ctx.hits?.length) {
    payload = computeEventDamageLinesForSweep(ctx, external)
  } else {
    const breakdown = computeFinalPanel(
      external,
      {
        ...buildPanelContextForSlot(ctx, ctx.panelContext.mainSlotIndex, external, external),
        skillContext: ctx.panelContext.skillContext ?? undefined,
      },
      PANEL_NUMBERS_ONLY,
    )
    const piercePower = computePiercePower(
      breakdown.finalPanel.hp,
      breakdown.finalPanel.atk,
      breakdown.totalMods.pierce,
    )
    const result = computeDamageResult({
      finalPanel: breakdown.finalPanel,
      piercePower,
      ...resolvePanelOnlyDamageCalcBase(ctx),
      enemyInput: ctx.enemyInput,
      combatVulnerable: breakdown.combatMods.vulnerable,
      combatDirectVulnerable: breakdown.combatMods.directVulnerable,
      combatAnomalyVulnerable: breakdown.combatMods.anomalyVulnerable,
      combatDmgReduction: breakdown.combatMods.dmgReduction,
      combatDirectDmgReduction: breakdown.combatMods.directDmgReduction,
      combatAnomalyDmgReduction: breakdown.combatMods.anomalyDmgReduction,
      combatGlobalStaggerVulnerable: breakdown.combatMods.globalStaggerVulnerable,
      combatStaggerVulnerable: breakdown.combatMods.staggerVulnerable,
      combatStaggerVulnerableOnly: breakdown.combatMods.staggerVulnerableOnly,
      combatSpecial: breakdown.combatMods.special,
      combatPierceDmgBonus: breakdown.combatMods.pierceDmgBonus,
      combatSharpenDmgBonus: breakdown.combatMods.sharpenDmgBonus,
      combatSharpenCritDmgBonus: breakdown.combatMods.sharpenCritDmgBonus,
      combatDmgPenalty: breakdown.combatMods.dmgPenalty,
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
/** 自定义词条（panelField 类）叠加到局外面板的增量表 */
export type AffixPanelDeltaMap = Partial<Record<AffixPanelDeltaField, number>>
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

/**
 * 词条计数各字段的「每档值」。
 *
 * 由词条库条目决定（`entryRollsToEvalInput` 产出）：`stat:` 目标的条目用自己的
 * `perRoll` 覆盖对应字段，未覆盖的字段回落 `AFFIX_VALUE_PER_COUNT`。
 * 省略时全部走常量表 —— 柱图（词条计算页）等调用点因此行为不变。
 */
export type AffixValuePerCount = Record<keyof AffixCounts, number>

/** valuePerCount 是否与默认常量表一致（一致就不进缓存键，保持既有键形态稳定） */
function isDefaultValuePerCount(valuePerCount: AffixValuePerCount): boolean {
  const keys = Object.keys(AFFIX_VALUE_PER_COUNT) as (keyof AffixCounts)[]
  for (const key of keys) {
    if (valuePerCount[key] !== AFFIX_VALUE_PER_COUNT[key]) return false
  }
  return true
}

function affixCountsCacheKey(
  affixCounts: AffixCounts,
  panelDeltas?: AffixPanelDeltaMap,
  valuePerCount?: AffixValuePerCount,
): string {
  // 必须覆盖 AffixCounts 的全部字段：锋御走 defFlat/defPercent，
  // 漏掉会让不同防御档数命中同一条缓存，返回错误伤害。
  const base = `${affixCounts.hpFlat},${affixCounts.hpPercent},${affixCounts.atkFlat},${affixCounts.atkPercent},${affixCounts.defFlat},${affixCounts.defPercent},${affixCounts.pen},${affixCounts.critRate},${affixCounts.critDmg},${affixCounts.mastery}`
  /**
   * 每档值必须进键。
   *
   * 本项目已因「缓存键漏字段」栽过两次（`defFlat/defPercent`、`agentBase/wengineAdvanced`）。
   * 漏掉 `valuePerCount` 会以新形式复发同一个病症：
   * **改「每档」数字，伤害一动不动** —— 正是本次词条库改造要修的东西。
   * 默认值不进键，让柱图等既有调用点的键形态与改造前完全一致。
   */
  const valuePart =
    valuePerCount && !isDefaultValuePerCount(valuePerCount)
      ? `|vpc:${(Object.keys(AFFIX_VALUE_PER_COUNT) as (keyof AffixCounts)[])
          .map((key) => valuePerCount[key])
          .join(',')}`
      : ''
  if (!panelDeltas) return `${base}${valuePart}`
  const parts = (Object.keys(panelDeltas) as AffixPanelDeltaField[])
    .sort()
    .filter((key) => Boolean(panelDeltas[key]))
    .map((key) => `${key}=${panelDeltas[key]}`)
  const deltaPart = parts.length ? `|${parts.join(',')}` : ''
  return `${base}${valuePart}${deltaPart}`
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

/**
 * 上下文签名的记忆化。
 *
 * 背景：签名要把十余个字段 `JSON.stringify`（含本次新增的 agentBase / wengineAdvanced），
 * 实测这部分约占「面板口径」单次评估的**一半**开销；而一次求解或一次收益表重算里
 * `ctx` 始终是**同一个对象**，签名结果必然相同，逐次重算是纯浪费。
 *
 * 按 `ctx` 对象身份缓存后，签名从「每次评估算一遍」变为「每个 ctx 算一遍」。
 *
 * 前提：调用方不得**就地修改** `ctx` 的字段（当前全项目已核对：无此用法；
 * `buildOptimalEvalContext` 每次返回新对象，页面侧 `evalCtx` 是 computed）。
 * 若将来出现就地修改，需在改完显式调用 `clearAffixEvalCache()`。
 */
const affixCtxSignatureCache = new WeakMap<OptimalEvalContext, string>()

function affixEvalContextSignature(ctx: OptimalEvalContext): string {
  const memo = affixCtxSignatureCache.get(ctx)
  if (memo !== undefined) return memo
  const signature = computeAffixEvalContextSignature(ctx)
  affixCtxSignatureCache.set(ctx, signature)
  return signature
}

function computeAffixEvalContextSignature(ctx: OptimalEvalContext): string {
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
    ctx.isFengYu ? '1' : '0',
    ctx.wengineBaseAtk ?? 0,
    ctx.wengineBaseDef ?? 0,
    /**
     * 角色基础面板与音擎加成必须整体入签名。
     *
     * 修复前的缺陷（2026-09-10 实测复现）：签名只带 `mainAgentId` 与
     * `wengineBaseAtk/wengineBaseDef`，而 `buildAffixExternalFixedParts` 真正读的是
     * `ctx.agentBase` 与 `ctx.wengineAdvanced`。于是下面两种操作会命中旧上下文、
     * 拿到过期的基础值：
     *   1. 换成「基础攻击/防御相同、但加成不同」的音擎（如两把基础攻击都是 594 的 S 音擎）；
     *   2. 同一角色 id 的基础面板发生变化（例如重新加载角色数据）。
     * 表现为换完音擎后伤害/面板一动不动。
     */
    JSON.stringify(ctx.agentBase ?? null),
    JSON.stringify(ctx.wengineAdvanced ?? null),
    ctx.baseDamageSource ?? '',
    JSON.stringify(ctx.driveDiscMainStats),
    // 主词条组合试算会改 2/4 件套；缺失会导致同词条数命中旧缓存，伤害不变
    JSON.stringify(ctx.driveDiscSelection),
    JSON.stringify(ctx.enemyInput),
    JSON.stringify(ctx.panelContext.skillContext),
    JSON.stringify(ctx.extraGains ?? []),
    JSON.stringify(ctx.panelContext.anomalySlotPanels ?? {}),
    JSON.stringify(ctx.panelContext.convertSlotPanels ?? {}),
    events,
    serializeMultiSlotBuffSelection(ctx.slotBuffSelections),
    ctx.triggerAnomalyAgentId ?? '',
    /**
     * 队伍级数据必须入签名。
     *
     * 缺陷与实测（2026-09-09 起就有、2026-09-10 用真实方案复现）：引擎会读队友数据
     * （`collectTeamDriveDiscMods` 遍历全部槽位、`collectAllBuffEffects` 取全队效果、
     * 事件按 `ownerAgentId/anomalyPowerAgentId` 反查角色文档），但签名只覆盖主 C。
     * 于是**只改队友、不动主 C** 时签名不变 → 缓存不失效 → 结果停在旧值。
     *
     * 实测（真实方案，把 1 号队友的音擎从 Electro_Lip_Gloss 换成 Identity_Base）：
     * - 不手动清缓存：61863011 → **61863011**（错，两次一样）
     * - 每次手动清缓存：61863011 → **58285182**（对，确实应该变）
     *
     * 收进来的内容：槽位配置、全量角色/音擎/驱动盘文档、邦布、页级选择态。
     * 这几份 JSON 串合计 8~12ms，而签名按 ctx 对象身份记忆化（`affixCtxSignatureCache`），
     * 同一份 ctx 只算一次 —— 求解 200 次评估共用，摊薄后可忽略。
     */
    JSON.stringify(ctx.panelContext.teamSlots ?? []),
    JSON.stringify(ctx.panelContext.agents ?? []),
    JSON.stringify(ctx.panelContext.wengines ?? []),
    JSON.stringify(ctx.panelContext.driveDiscs ?? []),
    JSON.stringify(ctx.panelContext.bangboo ?? null),
    /**
     * 邦布精炼**必须单独入签名**：`ctx.panelContext.bangboo` 是邦布文档本身，
     * 精炼只决定「取 refinementEffects 的第几组」，不体现在文档内容里。
     *
     * 缺陷与依据（2026-09-10，审计同类缺口时发现）：`panelBuffCalc.ts` 的
     * `clampRefine(ctx.bangbooRefine) - 1` 用它选精炼效果块；而
     * `zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json` 里同一邦布不同精炼
     * 效果确实不同（snap：精1 全队 dmgBonus 6.8 → 精5 10；biggest_fan：精1 atk 50 → 精5 100）。
     * 只改精炼而签名不变，就会沿用旧精炼的结果。
     */
    ctx.panelContext.bangbooRefine ?? 1,
    JSON.stringify(ctx.panelContext.buffSelection ?? null),
    JSON.stringify(ctx.panelContext.extraMods ?? null),
    ctx.panelContext.liveExternalSlotIndex ?? '',
  ].join('|')
}

let affixExternalFixedParts: AffixExternalFixedParts | null = null

/**
 * 「不随主 C 面板变化的招式」的伤害明细缓存（按 hit.id）。
 *
 * 判定见 `optimalHitDependsOnMainAffixPanel()`：持有者 / 异常强度提供者 / 触发者
 * 都不是主 C，且队伍里没有主 C 的转模作用于全队时，该招式的伤害在同一套配置下
 * 与主 C 词条无关。早期只有扫掠路径这样缓存，求解器路径没有，于是求解器每评估
 * 一次就把这些招式全部重算一遍 —— 实测（42 招式）占单次评估约 60%。
 * 上下文签名变化时由 `resetAffixEvalCacheIfNeeded()` 统一清空，与其它缓存同生命周期。
 */
let stableEventLinesByHitId: Map<string, OptimalEventDamageLine> | null = null

function resetAffixEvalCacheIfNeeded(ctx: OptimalEvalContext) {
  const sig = affixEvalContextSignature(ctx)
  if (sig !== affixEvalCacheCtxSig) {
    affixEvalCache.clear()
    affixSweepCache.clear()
    affixExternalFixedParts = null
    stableEventLinesByHitId = null
    mainAgentTeamConvertReadsPanelCached = null
    affixEvalCacheCtxSig = sig
  }
}

export function clearAffixEvalCache() {
  affixEvalCache.clear()
  affixSweepCache.clear()
  affixExternalFixedParts = null
  stableEventLinesByHitId = null
  mainAgentTeamConvertReadsPanelCached = null
  affixEvalCacheCtxSig = ''
}

function getAffixExternalFixedParts(ctx: OptimalEvalContext): AffixExternalFixedParts {
  if (!affixExternalFixedParts) {
    affixExternalFixedParts = buildAffixExternalFixedParts({
      agentBase: ctx.agentBase ?? createEmptyAgentBasePanel(),
      wengineBaseAtk: ctx.wengineBaseAtk,
      wengineBaseDef: ctx.wengineBaseDef ?? 0,
      wengineAdvanced: ctx.wengineAdvanced ?? createEmptyWengineAdvancedStats(),
      driveDiscSelection: ctx.driveDiscSelection,
      driveDiscMainStats: ctx.driveDiscMainStats,
      driveDiscs: ctx.driveDiscs,
    })
  }
  return affixExternalFixedParts
}

function computeExternalForEval(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
  panelDeltas?: AffixPanelDeltaMap,
  valuePerCount?: AffixValuePerCount,
): PanelStats {
  const external = applyAffixCountsToFixedParts(
    getAffixExternalFixedParts(ctx),
    affixCounts,
    valuePerCount,
  )
  return panelDeltas ? applyPanelDeltas(external, panelDeltas) : external
}

function evaluateAffixCountsUncached(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
  panelDeltas?: AffixPanelDeltaMap,
  valuePerCount?: AffixValuePerCount,
): {
  finalPanel: PanelStats
  result: DamageCalcResult
  piercePower: number
  external: PanelStats
  breakdown: OptimalPanelBreakdown
  grandTotal: number
  eventLines: OptimalEventDamageLine[]
} {
  const external = computeExternalForEval(ctx, affixCounts, panelDeltas, valuePerCount)

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
        ...resolvePanelOnlyDamageCalcBase(ctx),
        enemyInput: ctx.enemyInput,
        combatVulnerable: breakdown.combatMods.vulnerable,
        combatDirectVulnerable: breakdown.combatMods.directVulnerable,
        combatAnomalyVulnerable: breakdown.combatMods.anomalyVulnerable,
        combatDmgReduction: breakdown.combatMods.dmgReduction,
        combatDirectDmgReduction: breakdown.combatMods.directDmgReduction,
        combatAnomalyDmgReduction: breakdown.combatMods.anomalyDmgReduction,
        combatGlobalStaggerVulnerable: breakdown.combatMods.globalStaggerVulnerable,
        combatStaggerVulnerable: breakdown.combatMods.staggerVulnerable,
        combatStaggerVulnerableOnly: breakdown.combatMods.staggerVulnerableOnly,
        combatSpecial: breakdown.combatMods.special,
        combatPierceDmgBonus: breakdown.combatMods.pierceDmgBonus,
      combatSharpenDmgBonus: breakdown.combatMods.sharpenDmgBonus,
      combatSharpenCritDmgBonus: breakdown.combatMods.sharpenCritDmgBonus,
      combatDmgPenalty: breakdown.combatMods.dmgPenalty,
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
    ...resolvePanelOnlyDamageCalcBase(ctx),
    enemyInput: ctx.enemyInput,
    combatVulnerable: breakdown.combatMods.vulnerable,
    combatDirectVulnerable: breakdown.combatMods.directVulnerable,
    combatAnomalyVulnerable: breakdown.combatMods.anomalyVulnerable,
    combatDmgReduction: breakdown.combatMods.dmgReduction,
    combatDirectDmgReduction: breakdown.combatMods.directDmgReduction,
    combatAnomalyDmgReduction: breakdown.combatMods.anomalyDmgReduction,
    combatGlobalStaggerVulnerable: breakdown.combatMods.globalStaggerVulnerable,
    combatStaggerVulnerable: breakdown.combatMods.staggerVulnerable,
    combatStaggerVulnerableOnly: breakdown.combatMods.staggerVulnerableOnly,
    combatSpecial: breakdown.combatMods.special,
    combatPierceDmgBonus: breakdown.combatMods.pierceDmgBonus,
      combatSharpenDmgBonus: breakdown.combatMods.sharpenDmgBonus,
    combatSharpenCritDmgBonus: breakdown.combatMods.sharpenCritDmgBonus,
    combatDmgPenalty: breakdown.combatMods.dmgPenalty,
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

export interface AffixCountsEvalResult {
  finalPanel: PanelStats
  result: DamageCalcResult
  piercePower: number
  external: PanelStats
  breakdown: OptimalPanelBreakdown
  grandTotal: number
  eventLines: OptimalEventDamageLine[]
}

/**
 * 与 `evaluateAffixCounts` 同源，额外回报本次是「缓存命中」还是「真算」。
 *
 * 用途：求解器需要按**真实计算量**记账——缓存命中只花真算约 1% 的时间，
 * 计入预算会让预算虚耗并提前触发截断（见 `dev-docs/affix-optimizer-impl-log.md` 步骤 0）。
 * 缓存键与淘汰逻辑复用同一份实现，避免两套键不一致返回错误伤害。
 */
export function evaluateAffixCountsWithCacheInfo(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
  panelDeltas?: AffixPanelDeltaMap,
  valuePerCount?: AffixValuePerCount,
): { value: AffixCountsEvalResult; cacheHit: boolean } {
  resetAffixEvalCacheIfNeeded(ctx)
  const cacheKey = affixCountsCacheKey(affixCounts, panelDeltas, valuePerCount)
  const cached = affixEvalCache.get(cacheKey)
  if (cached) return { value: cached, cacheHit: true }

  const result = evaluateAffixCountsUncached(ctx, affixCounts, panelDeltas, valuePerCount)
  if (affixEvalCache.size >= AFFIX_EVAL_CACHE_MAX) {
    const firstKey = affixEvalCache.keys().next().value
    if (firstKey) affixEvalCache.delete(firstKey)
  }
  affixEvalCache.set(cacheKey, result)
  return { value: result, cacheHit: false }
}

export function evaluateAffixCounts(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
  panelDeltas?: AffixPanelDeltaMap,
  valuePerCount?: AffixValuePerCount,
): AffixCountsEvalResult {
  return evaluateAffixCountsWithCacheInfo(ctx, affixCounts, panelDeltas, valuePerCount).value
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
  const outLabel = outPercentLabel(ctx.isMb, ctx.isFengYu)
  const outCap = resolveAffixOutPercentCap(caps, ctx.isMb, ctx.isFengYu)
  for (let outPercent = 0; outPercent <= remain; outPercent += 1) {
    const critDmg = remain - outPercent
    if (outPercent > outCap || critDmg > caps.critDmg || crit > caps.critRate) continue
    const affixCounts = buildDirectAffixCounts(
      ctx.isMb,
      { ...state, critRate: crit, totalRolls: total },
      outPercent,
      critDmg,
      ctx.isFengYu,
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

/**
 * 让出主线程一次，供分片异步任务（扫掠 / 求解器）保持页面响应。
 *
 * **为什么浏览器里用 MessageChannel 而不是 requestAnimationFrame**（2026-09-10 实测，真实浏览器）：
 *
 * | 让出方式 | 每次等待 |
 * |---|---|
 * | `requestAnimationFrame` | **16.66 ms**（绑定帧率） |
 * | `setTimeout(0)` | **10.33 ms**（浏览器嵌套定时器钳制） |
 * | `MessageChannel` | **0.01 ms** |
 *
 * 于是「多久让出一次」直接决定总耗时：模拟 251 次评估、纯计算 21ms，
 * rAF 每 24 次让出 → 159ms；MessageChannel 每 24 次让出 → 26ms。
 * 用户反馈的「词条分配变慢」就是这个：计算量没变，全花在等帧上了。
 *
 * 响应性仍然保证：每个时间片（见调用方的 `sliceBudgetMs`）结束后都会让出，
 * 浏览器可在让出的间隙处理输入与绘制。
 *
 * **Node（脚本与测试）里走 `setImmediate`**：模块级 MessageChannel 会一直保活事件循环，
 * 导致脚本跑完不退出（实测挂住不返回）；而 `port.unref()` 又会让纯 await 的脚本
 * 以 unsettled top-level await 直接退出。`setImmediate` 两者皆无。
 */
const isBrowserMessageChannelUsable =
  typeof window !== 'undefined' && typeof window.MessageChannel === 'function'

let yieldChannel: MessageChannel | null = null
const yieldWaiters: (() => void)[] = []

function scheduleYield(resolve: () => void): void {
  if (isBrowserMessageChannelUsable) {
    if (!yieldChannel) {
      yieldChannel = new MessageChannel()
      // 严格一一对应：一次 postMessage 唤醒一个等待者，避免并发让出时互相顶掉
      yieldChannel.port1.onmessage = () => {
        const waiter = yieldWaiters.shift()
        if (waiter) waiter()
      }
    }
    yieldWaiters.push(resolve)
    yieldChannel.port2.postMessage(null)
    return
  }
  if (typeof setImmediate === 'function') {
    setImmediate(resolve)
    return
  }
  setTimeout(resolve, 0)
}

export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    scheduleYield(resolve)
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
  const outLabel = outPercentLabel(ctx.isMb, ctx.isFengYu)
  const outCap = resolveAffixOutPercentCap(caps, ctx.isMb, ctx.isFengYu)
  for (let outPercent = 0; outPercent <= remain; outPercent += 1) {
    const critDmg = remain - outPercent
    if (outPercent > outCap || critDmg > caps.critDmg || crit > caps.critRate) continue
    const affixCounts = buildDirectAffixCounts(
      ctx.isMb,
      { ...state, critRate: crit, totalRolls: total },
      outPercent,
      critDmg,
      ctx.isFengYu,
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
  const outLabel = outPercentLabel(ctx.isMb, ctx.isFengYu)
  const caps = getAffixRollCaps(ctx.driveDiscMainStats)
  const outCap = resolveAffixOutPercentCap(caps, ctx.isMb, ctx.isFengYu)
  const points: AnomalySweepPoint[] = []

  for (let outPercent = 0; outPercent <= total; outPercent += 1) {
    const mastery = total - outPercent
    if (outPercent > outCap || mastery > caps.mastery) continue
    const affixCounts = buildAnomalyAffixCounts(
      ctx.isMb,
      { ...state, totalRolls: total },
      outPercent,
      mastery,
      ctx.isFengYu,
    )
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
  const outLabel = outPercentLabel(ctx.isMb, ctx.isFengYu)
  const caps = getAffixRollCaps(ctx.driveDiscMainStats)
  const outCap = resolveAffixOutPercentCap(caps, ctx.isMb, ctx.isFengYu)
  const points: AnomalySweepPoint[] = []
  let sinceYield = 0

  for (let outPercent = 0; outPercent <= total; outPercent += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const mastery = total - outPercent
    if (outPercent > outCap || mastery > caps.mastery) continue
    const affixCounts = buildAnomalyAffixCounts(
      ctx.isMb,
      { ...state, totalRolls: total },
      outPercent,
      mastery,
      ctx.isFengYu,
    )
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

export function directCandidateKeys(isMb: boolean, isFengYu = false): OptimalAffixKey[] {
  if (isMb) {
    return ['atkFlat', 'hpFlat', 'hpPercent', 'atkPercent', 'pen', 'mastery', 'critRate', 'critDmg']
  }
  if (isFengYu) {
    return ['defFlat', 'defPercent', 'pen', 'critRate', 'critDmg']
  }
  return ['atkFlat', 'atkPercent', 'pen', 'mastery', 'critRate', 'critDmg']
}

export function anomalyCandidateKeys(isMb: boolean, isFengYu = false): OptimalAffixKey[] {
  return [flatStatKey(isMb, isFengYu), outPercentKey(isMb, isFengYu), 'pen', 'mastery']
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
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb, ctx.isFengYu) : anomalyCandidateKeys(ctx.isMb, ctx.isFengYu)
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
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb, ctx.isFengYu) : anomalyCandidateKeys(ctx.isMb, ctx.isFengYu)
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
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb, ctx.isFengYu) : anomalyCandidateKeys(ctx.isMb, ctx.isFengYu)
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

export function outPercentFromAffixCounts(
  counts: AffixCounts,
  isMb: boolean,
  isFengYu = false,
): number {
  if (isMb) return counts.hpPercent
  if (isFengYu) return counts.defPercent
  return counts.atkPercent
}

export function buildOptimalEvalContext(input: {
  isMb: boolean
  isFengYu?: boolean
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
  // 深解包响应式代理：引擎会对这批数据做海量属性读取，走 Proxy 陷阱会慢 3 倍以上
  // （实测 16.4ms → 5.3ms/次评估，见 reactiveUnwrap.ts）。只换引用不改值，
  // 写入仍走响应式链路，因此不会造成「面板改了但计算不更新」。
  deepUnwrapReactive(input)

  const mainSlot = input.teamSlots[input.mainSlotIndex]!
  const mainAgent = input.agents.find((a) => a.id === mainSlot.agentId)
  const mainWengine =
    mainSlot.wengineId && mainSlot.wengineId !== 'none'
      ? input.wengines.find((w) => w.id === mainSlot.wengineId)
      : null

  return {
    isMb: input.isMb,
    isFengYu: Boolean(input.isFengYu),
    agentBase: mainAgent?.basePanel ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: mainWengine?.baseAtk ?? 0,
    wengineBaseDef: mainWengine?.baseDef ?? 0,
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
          // 主 C：由最优词条扫掠推导；队友：优先用手填局外，避免盖掉「导入」录入
          if (index !== input.mainSlotIndex) {
            const saved = input.anomalySlotPanels?.[slot.agentId]
            if (saved && !isPlaceholderExternalPanel(saved)) {
              return [[index, fillPanelStatsDefaults(saved)]]
            }
          }
          return [
            [
              index,
              computeExternalPanelFromTeamSlot({
                slot,
                agents: input.agents,
                wengines: input.wengines,
                driveDiscs: input.driveDiscs,
                overrideAffix:
                  index === input.mainSlotIndex
                    ? {
                        affixCounts: {
                          ...createEmptyAffixCounts(),
                          ...slot.affixCounts,
                        },
                        affixDriveDiscMainStats: input.driveDiscMainStats,
                      }
                    : undefined,
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
