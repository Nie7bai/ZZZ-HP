import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { ExtraBuffApplySlot, ExtraBuffGain } from '@/types/extraBuff'
import type { SkillTalentLevels } from '@/utils/skillTalentLevels'
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
  applyAffixCountsOntoExternalPanel,
  applyAffixCountsToFixedParts,
  buildAffixExternalFixedParts,
  computeExternalPanelFromTeamSlot,
  type AffixExternalFixedParts,
  type AffixPanelCalcInput,
} from '@/utils/affixPanelCalc'
import {
  applyPanelDeltas,
  type AffixDeltaMap,
  type AffixPanelDeltaField,
} from '@/utils/affixLibrary'
import {
  type AgentElement,
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
  buildGenericPanelSkillContext,
  resolveEventElement,
  getHitSkipReason,
  skillNeedsDualAgents,
  applyHitPanelMods,
  type ResolvedHit,
} from '@/utils/resolvedHit'
import { snapshotCalculationInput } from '@/utils/reactiveUnwrap'
import { toRaw } from 'vue'
import {
  computeMutationZone,
  findLuminousAgentInTeam,
  resolveDamageCalcResistanceElements,
} from '@/utils/remielUtils'
import {
  REMIEL_SELF_RADIANCE_VIEW_POLICY,
  resolvePanelViewPolicyForRadiance,
} from '@/utils/panelViewPolicy'
import { mergeSkillSubcategoryMultOverrides } from '@/utils/skillSubcategoryMult'
import { isEffectEnabled } from '@/utils/buffEffect'
import {
  collectAllBuffEffects,
  computeFinalPanel,
  hasExternalPanelForSlot,
  parseSourceKeySlotIndex,
  resolveCollectedEffectSourceSlot,
  resolveAnomalyReleaseMultEvaluation,
  type BuffSelectionState,
  type MultiSlotBuffSelection,
  type PanelCalcContext,
  type ConvertResolveInputs,
  resolveBuffSelectionForSlot,
  resolvePanelBuffSelectionForSlot,
  panelToConvertAttrValues,
  buildPanelSourceValuesBySlotMap,
  collectEventCandidateEffects,
  resolveCollectedEffectParameters,
  type BuffEffectContribution,
  type ComputeFinalPanelOptions,
  type DamageInputUsage,
  type EventDamageInputUsage,
  type EventEffectRecord,
  type EventEffectRecipient,
  type EventEffectSummary,
  type EventEffectUseView,
  type PanelStageTrace,
  type ResolvedEffectParameters,
  type PanelPreConvertSnapshot,
  type EventViewSnapshot,
  buffMasterDataVersion,
} from '@/utils/panelBuffCalc'
import type { PanelViewPolicyId } from '@/utils/panelViewPolicy'
import { resolveSlotAttrValues } from '@/utils/panelSourceResolution'
import { formatAnomalyFormulaAgentLabel } from '@/utils/anomalyFormulaDisplay'
import { buildHitEvalFingerprintReused, resetHitEvalFingerprintReuseState } from '@/utils/hitEvalCache'
import { resolveCurtainCap, resolveZoneScheme } from '@/zones/scheme'

/** 扫掠 / 流程总伤只要面板数字，不拼「增益来自哪」明细 */
const PANEL_NUMBERS_ONLY = { includeDetails: false } as const

export type OptimalDamageKind = 'direct' | 'anomaly'

export type OptimalAnomalyMetric = 'attributeAnomaly' | 'disorder' | 'turbulence' | 'anomalyRelease' | 'radiance'

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
  eventElement: AgentElement | undefined
  hit: ResolvedHit
  eventId: string
  /**
   * 逐效果记录与实际采用（计算链路收敛 Spec §2.2 第 3 项）：只在带记录求值
   * （includeDetails 为 true）时填充，无效果时为空数组；数值模式不生成。
   */
  effectRecords?: EventEffectRecord[]
  panelStageTraces?: PanelStageTrace[]
  damageInputUsages?: EventDamageInputUsage[]
  viewSnapshots?: Readonly<Record<string, EventViewSnapshot>>
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
  /**
   * 主 C 的基准局外面板，来自「角色配置」（导入录入写入的 `activeSlotPanels`）。
   *
   * 有值时候选词条**叠加在它之上**（词条 = 在面板上再加 N 条，面板本身不动）；
   * 无值时 `computeExternalForEval` 回退到按槽位配置推导 —— 与改造前逐位等价。
   */
  mainBaseExternalPanel?: PanelStats | null
  /**
   * 词条「每档值」表（由词条库条目的 `perRoll` 算出），省略时按 `AFFIX_VALUE_PER_COUNT`。
   *
   * 放进上下文而不是逐函数传参：柱图扫掠 / 详情 / 收益表 / 基准总伤都从 ctx 取面板，
   * 少传一条路就会出现「同一套词条，两处数字不一样」——即 2026-09-11 修过的那类分叉。
   */
  valuePerCount?: AffixValuePerCount
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
  attributeAnomalyExpected: number
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
  /**
   * 相对权重 = 本行收益率 / 本表最大收益率，0~1（分母取「已产出行」的最大百分比差；
   * 全部 ≤ 0 时为 0，与收益表 `affixRelativeWeights` 同口径）。
   * 在 `computeDiffAnalysis` 的 addOne 排序之后统一回填。
   */
  weight?: number
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

export function resolveAffixOutPercentCap(caps: AffixRollCaps, isMb: boolean, isFengYu: boolean): number {
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

function buildPanelContextForSlot(
  ctx: OptimalEvalContext,
  slotIndex: number,
  externalForSlot: PanelStats,
  mainExternalPanel: PanelStats,
  event?: { skillContext: SkillCalcContext; rowBuffOverride: ResolvedHit['buffOverride']; deferSourceValues?: boolean },
): PanelCalcContext {
  const base: PanelCalcContext = {
    ...ctx.panelContext,
    mainSlotIndex: slotIndex,
    mainExternalPanel: mainExternalPanel,
    extraGains: ctx.extraGains,
    buffSelection: resolvePanelBuffSelectionForSlot(ctx.panelContext, slotIndex),
    // 转模基数与面板页同一份解析（Spec §2.1）：主槽用敌方等级、其余用角色等级，
    // 转模部分面板自带的 level 优先。
    attrValues: resolveSlotAttrValues({
      slotIndex,
      mainSlotIndex: ctx.panelContext.mainSlotIndex,
      teamSlots: ctx.panelContext.teamSlots,
      external: externalForSlot,
      convertSlotPanels: ctx.panelContext.convertSlotPanels,
      agentLevelBySlot: (index) =>
        index === ctx.panelContext.mainSlotIndex
          ? ctx.enemyInput.level
          : resolveProducerAgentLevel(ctx, ctx.panelContext.teamSlots[index]?.agentId),
    }),
    ...event,
  }
  const panelSourceValuesBySlot = buildPanelSourceValuesBySlotMap(base, externalForSlot)
  return {
    ...base,
    panelSourceValues: event?.deferSourceValues ? undefined : panelSourceValuesBySlot.get(slotIndex),
    panelSourceValuesBySlot,
  }
}


export function buildEventPanelContext(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats | null,
  hit: ResolvedHit,
  slotIndex: number,
  deferSourceValues = false,
): PanelCalcContext {
  const mainId = ctx.panelContext.teamSlots[ctx.panelContext.mainSlotIndex]?.agentId
  const mainPanel = mainExternal ?? (mainId ? ctx.panelContext.activeSlotPanels?.[mainId] : undefined) ?? createDefaultExternalPanel()
  const agentId = ctx.panelContext.teamSlots[slotIndex]?.agentId ?? ''
  const external = resolveExternalForAgent(ctx, agentId, slotIndex, mainPanel)
  return buildPanelContextForSlot(ctx, slotIndex, external, mainPanel, {
    skillContext: buildSkillContextFromHit(hit, resolveEventElement(hit, ctx.panelContext.agents)),
    rowBuffOverride: hit.buffOverride ?? null,
    deferSourceValues,
  })
}

/** 全局通用视图与事件视图共用槽位/来源装配，行级状态不进入全局。 */
export function buildGlobalPanelContext(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats | null,
  slotIndex: number,
): PanelCalcContext {
  const mainIndex = ctx.panelContext.mainSlotIndex
  const mainPanel = mainExternal ?? ctx.panelContext.slotExternalPanels?.[mainIndex] ?? createDefaultExternalPanel()
  const agentId = ctx.panelContext.teamSlots[slotIndex]?.agentId ?? ''
  const external = resolveExternalForAgent(ctx, agentId, slotIndex, mainPanel)
  const skill = ctx.panelContext.skillContext
  const base = buildPanelContextForSlot(ctx, slotIndex, external, mainPanel, {
    rowBuffOverride: null,
    deferSourceValues: true,
    skillContext: buildGenericPanelSkillContext({
      element: ctx.panelContext.agents.find(agent => agent.id === agentId)?.element,
      damageKind: skill?.damageKind ?? 'direct',
      staggerPhase: skill?.staggerPhase ?? 'stagger',
    }),
  })
  return base
}

/**
 * 事件视图与逐效果记录（计算链路收敛 Spec §3.3）。
 *
 * 一次事件求值会算若干张面板：持有者、异常强度提供者、异常类触发者、（S3 起的）本人耀变等。
 * 每张面板 = 一个 viewKey；同一 viewKey 的贡献由正式求值回调产出，这里只做归并、排序与
 * 实际采用标注，**不重新匹配或折算**。
 */
interface EventTraceView {
  convertValues?: import('@/utils/panelBuffCalc').PanelSourceValues
  external: PanelStats
  useView: EventEffectUseView
  viewKey: string
  slotIndex: number
  agentId: string
  policy: PanelViewPolicyId
  contributions: BuffEffectContribution[]
}

function hashPanelForView(panel: PanelStats | null | undefined): string {
  if (!panel) return 'null'
  return JSON.stringify(panel)
}

/** viewKey 由完整有效输入与政策派生（不是槽位号/政策名的别名，Spec §3.2 第 4 项）。 */
function buildEventViewKey(parts: {
  policy: PanelViewPolicyId
  useView: EventEffectUseView
  slotIndex: number
  agentId: string
  element?: string | null
  external: PanelStats | null | undefined
  context?: PanelCalcContext
}): string {
  return [
    parts.policy,
    `slot:${parts.slotIndex}`,
    `agent:${parts.agentId || ''}`,
    `elem:${parts.element ?? ''}`,
    `panel:${hashPanelForView(parts.external)}`,
    `context:${JSON.stringify([parts.context?.skillContext, parts.context?.restrictToSlotIndex, parts.context?.excludeBangboo, parts.context?.effectSourcePolicy, parts.context?.traceStage, parts.context?.buffSelection, parts.context?.rowBuffOverride, Boolean(parts.context?.skipConvert)])}`,
  ].join('|')
}

function createEventTraceCollector(ctx: OptimalEvalContext, mainPanel: PanelStats, hit: ResolvedHit) {
  const views: EventTraceView[] = []
  const usages: EventDamageInputUsage[] = []
  const preConvertCache = new Map<string, PanelPreConvertSnapshot>()
  const panelCache = new Map<string, OptimalPanelBreakdown>()
  const boundInputs = new Map<string, { viewKey: string; usedView: EventEffectUseView }>()
  const collector = {
    views,
    usages,
    boundInputs,
    snapshots(): Record<string, EventViewSnapshot> {
      return Object.fromEntries(views.map(view => {
        const final = panelCache.get(view.viewKey)
        const pre = preConvertCache.get(view.viewKey)
        const agentId = ctx.panelContext.teamSlots[view.slotIndex]?.agentId ?? ''
        const agentName = ctx.panelContext.agents.find(agent => agent.id === agentId)?.name ?? agentId
        return [view.viewKey, { agentName, viewKey: view.viewKey, slotIndex: view.slotIndex, policy: view.policy,
          externalPanel: view.external, panel: final?.finalPanel ?? pre?.preConvertPanel ?? view.external,
          sources: final?.sources ?? pre?.sources ?? [],
          convertValues: view.convertValues,
        }]
      }))
    },
    view(parts: {
      useView: EventEffectUseView
      slotIndex: number
      agentId: string
      policy: PanelViewPolicyId
      element?: string | null
      external: PanelStats | null | undefined
      context?: PanelCalcContext
    }) {
      const context = parts.context ?? buildEventPanelContext(ctx, mainPanel, hit, parts.slotIndex, true)
      const viewKey = buildEventViewKey({ ...parts, context })
      const existing = views.find((item) => item.viewKey === viewKey)
      const view: EventTraceView = existing ?? {
        external: parts.external!,
        useView: parts.useView,
        viewKey,
        slotIndex: parts.slotIndex,
        agentId: parts.agentId,
        policy: parts.policy,
        contributions: [],
      }
      if (!existing) views.push(view)
      const options: ComputeFinalPanelOptions = {
        includeDetails: true,
        trace: {
          onSourceValues: values => { view.convertValues = values },
          viewKey,
          policy: parts.policy,
          onContribution: (item: BuffEffectContribution) => view.contributions.push(item),
          preConvertCache,
          panelCache,
          resolveView: (external, context, usedView, policy = parts.policy) => collector.view({
            external, context,
            useView: usedView,
            slotIndex: context.mainSlotIndex,
            agentId: context.teamSlots[context.mainSlotIndex]?.agentId ?? '',
            policy,
            element: context.skillContext?.element,
          }).options.trace!,
          bindInput: (inputKey, field, targetViewKey) => {
            boundInputs.set(`${inputKey}:${field}`, { viewKey: targetViewKey, usedView: parts.useView })
          },
        },
      }
      return {
        viewKey,
        options,
        usage: (usage: DamageInputUsage) => {
          usages.push({
            ...usage,
            viewKey,
            slotIndex: parts.slotIndex,
            policy: parts.policy,
            usedView: parts.useView,
          })
        },
      }
    },
  }
  return collector
}

/** 同一身份只保留最终阶段那一条：转模取 convert，固定值取 preConvert，跳过态让位。 */
function pickFinalContributions(contributions: BuffEffectContribution[]): BuffEffectContribution[] {
  const byIdentity = new Map<string, BuffEffectContribution>()
  const rank = (entry: BuffEffectContribution) =>
    entry.status === 'convert-skipped' ? -1 : entry.stage === 'convert' ? 2 : 1
  for (const item of contributions) {
    const identity = [item.viewKey, item.sourceKey, item.blockId, item.effectId].join('|')
    const current = byIdentity.get(identity)
    if (!current || rank(item) > rank(current)) byIdentity.set(identity, item)
  }
  return [...byIdentity.values()]
}

function formatSlotLabel(
  ctx: OptimalEvalContext,
  slotIndex: number,
): { label: string; agentId: string; name: string } {
  const agentId = ctx.panelContext.teamSlots[slotIndex]?.agentId ?? ''
  const agent = agentId ? ctx.panelContext.agents.find((item) => item.id === agentId) : undefined
  const name = agent?.name ?? ''
  const profession = agent?.profession ?? ''
  const label = name ? (profession ? `${profession}·${name}` : name) : `槽位${slotIndex + 1}`
  return { label, agentId, name }
}

/** 效果属性 → 它真正会改到的面板字段（只用于判断「这条贡献是否被本事件采用」，不改数值） */
const STAT_TO_PANEL_FIELDS: Record<string, string[]> = {
  atk: ['atk', 'inCombatAtk'],
  atkPercent: ['atk'],
  inCombatAtkPercent: ['atk'],
  hp: ['hp'],
  hpPercent: ['hp'],
  inCombatHpPercent: ['hp'],
  def: ['def'],
  defPercent: ['def'],
  inCombatDefPercent: ['def'],
  dmgBonus: ['dmgBonus'],
  skillDmgBonus: ['dmgBonus'],
  externalAtkPercent: ['atk'],
  externalHpPercent: ['hp'],
  externalDefPercent: ['def'],
  mastery: ['mastery', 'inCombatMastery'],
  mutationCoeff: ['mutationCoeff', 'mutationZone'],
  mutationCoeffFactor: ['mutationCoeffFactor', 'mutationZone'],
  skillMultiplierBonus: ['directDmgMult'],
  anomalyControlPercent: ['anomalyControl'],
  energyRegenFlat: ['energyRegen'],
}

/**
 * 这条贡献的属性是否可能进入该字段。
 * 其它键与面板字段同名（critRate/critDmg/mastery/penRate/pen/resPen/reduceDefense/
 * attributeAnomalyDmgBonus/attributeAnomalyMult/anomalyCrit*…）；不同名且无显式映射时不登记采用。
 */
function recordUsesField(stat: string, field: string): boolean {
  const mapped = STAT_TO_PANEL_FIELDS[stat]
  if (mapped) return mapped.includes(field)
  return stat === field
}

function recordFeedsConvertBase(stat: string, field: string): boolean {
  // panelToConvertAttrValues 的贯穿力由生命、攻击与固定贯穿力共同构成。
  return field === 'pierce'
    ? recordUsesField(stat, 'hp') || recordUsesField(stat, 'atk') || stat === 'pierce'
    : recordUsesField(stat, field)
}
function buildEventEffectRecords(
  ctx: OptimalEvalContext,
  hit: ResolvedHit,
  trace: ReturnType<typeof createEventTraceCollector>,
): {
  effectRecords: EventEffectRecord[]
  panelStageTraces: PanelStageTrace[]
  damageInputUsages: EventDamageInputUsage[]
} {
  const effectRecords: EventEffectRecord[] = []
  const panelStageTraces: PanelStageTrace[] = []
  for (const view of trace.views) {
    const finalContributions = pickFinalContributions(view.contributions)
    panelStageTraces.push({
      viewKey: view.viewKey,
      slotIndex: view.slotIndex,
      policy: view.policy,
      contributions: view.contributions,
    })
    const viewUsages = trace.usages.filter((usage) => usage.viewKey === view.viewKey)
    const beneficiary = formatSlotLabel(ctx, view.slotIndex)
    const appliedStatus = (contribution: BuffEffectContribution) =>
      contribution.status === 'applied' || contribution.status === 'zero'
    for (const contribution of finalContributions) {
      // 未生效/被排除的候选不登记采用（否则详情会把非生效项当贡献解释）
      const overriddenField = contribution.stat === 'skillMultiplierBonus' ? 'directDmgMult' : contribution.stat
      const overwritten = hit.multOverrides?.[overriddenField as keyof NonNullable<ResolvedHit['multOverrides']>] != null
      const skillReleaseIncrement = contribution.stat === 'anomalyReleaseMult' && contribution.convertBase != null && contribution.stage === 'releaseMult'
      const contributionRecords = appliedStatus(contribution) && (!overwritten || skillReleaseIncrement)
        ? viewUsages.filter((usage) => recordUsesField(contribution.stat, String(usage.field)))
        : []
      const providerSlot = contribution.providerSlot ?? contribution.sourceSlot
      const provider =
        providerSlot != null && providerSlot >= 0
          ? formatSlotLabel(ctx, providerSlot)
          : { label: '', agentId: '', name: '' }
      effectRecords.push({
        ...contribution,
        eventId: hit.id,
        providerName: contribution.providerName ?? provider.name,
        beneficiaryAgentId: beneficiary.agentId,
        beneficiaryName: beneficiary.name,
        beneficiaryLabel: beneficiary.label,
        // 采用关系按视图绑定：这张面板的字段没被本事件采用，就没有使用项；
        // 未生效/被排除的候选也不登记采用（否则详情会把非生效项当贡献解释）
        usedInputs: contributionRecords,
        usedViews: [...new Set(contributionRecords.map((usage) => usage.usedView))],
        usedZones: [...new Set(contributionRecords.flatMap((usage) => usage.usedZones))],
      })
    }
  }
  // 转模读取非转模快照：只给真正进入本事件的转模建立来源依赖。
  for (const record of effectRecords) {
    const base = record.convertBase
    if (!record.usedInputs.length || base?.stage !== 'preConvert' || !base.sourceViewKey) continue
    for (const source of effectRecords) {
      if (source.viewKey !== base.sourceViewKey || source.stage !== 'preConvert' ||
          (source.status !== 'applied' && source.status !== 'zero') ||
          !recordFeedsConvertBase(source.stat, base.from)) continue
      for (const used of record.usedInputs) {
        const dependency: EventDamageInputUsage = {
          ...used,
          field: base.from as DamageInputUsage['field'],
          viewKey: source.viewKey,
          slotIndex: source.beneficiarySlot,
          policy: source.policy,
          usedView: 'convertSourcePanel',
        }
        if (!source.usedInputs.some(item => item.usedView === dependency.usedView && item.field === dependency.field && item.resultKey === dependency.resultKey)) {
          source.usedInputs.push(dependency)
          trace.usages.push(dependency)
        }
      }
    }
  }
  for (const record of effectRecords) {
    record.usedViews = [...new Set(record.usedInputs.map(item => item.usedView))]
    record.usedZones = [...new Set(record.usedInputs.flatMap(item => item.usedZones))]
  }
  const sortKey = (record: EventEffectRecord) =>
    [record.eventId, record.beneficiarySlot, record.policy, record.viewKey, record.stage, record.sourceKey, record.blockId, record.effectId].join('|')
  effectRecords.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  return { effectRecords, panelStageTraces, damageInputUsages: trace.usages }
}

/**
 * 事件投影（Spec §2.3 第 1 项 / §3.5）：按 effect id 归并。
 * `recipients` 只留**被本事件实际采用**的项（`usedInputs` 非空）；`candidates` 保留全部已求值视图。
 */
export function projectEventEffectRecords(
  records: EventEffectRecord[],
): Record<string, EventEffectSummary> {
  const byEffect = new Map<string, EventEffectRecord[]>()
  for (const record of records) {
    const list = byEffect.get(record.effectId)
    if (list) list.push(record)
    else byEffect.set(record.effectId, [record])
  }
  const out: Record<string, EventEffectSummary> = {}
  for (const [effectId, candidates] of byEffect) {
    const recipients: EventEffectRecipient[] = candidates
      .filter(
        (record) =>
          (record.status === 'applied' || record.status === 'zero') && record.usedInputs.length > 0,
      )
      .map((record) => ({
        viewKey: record.viewKey,
        slotIndex: record.beneficiarySlot,
        agentId: record.beneficiaryAgentId,
        label: record.beneficiaryLabel,
        policy: record.policy,
        stage: record.stage,
        amount: record.amount,
        status: record.status === 'zero' ? 'zero' : 'applied',
        usedViews: record.usedViews,
        usedZones: record.usedZones,
      }))
    recipients.sort((a, b) =>
      [a.slotIndex, a.policy, a.viewKey, a.stage].join('|').localeCompare(
        [b.slotIndex, b.policy, b.viewKey, b.stage].join('|'),
      ),
    )
    const first = candidates[0]
    if (!first) continue
    const firstRecipient = recipients[0]
    let state: EventEffectSummary['state'] = 'inactive'
    let amount: number | undefined
    if (recipients.length === 1 && firstRecipient) {
      state = 'single'
      amount = firstRecipient.amount
    } else if (recipients.length > 1 && firstRecipient) {
      const sameAmount = recipients.every(
        (item) => Math.abs(item.amount - firstRecipient.amount) <= 1e-6,
      )
      if (sameAmount) {
        state = 'same'
        amount = firstRecipient.amount
      } else {
        state = 'multiple'
      }
    }
    out[effectId] = {
      effectId,
      stat: first.stat,
      sourceKey: first.sourceKey,
      blockId: first.blockId,
      providerName: first.providerName,
      candidates,
      recipients,
      state,
      amount,
    }
  }
  return out
}

/**
 * 事件增益预览（Spec §2.2 第 4 项 / §2.3）。
 *
 * 改造要点：**不再**为每个参与者重新求值、更不再「按 effect id 先到先得」把多受益角色压成
 * 一个数（C2 缺陷的产生机制）。现在只读正式事件求值的逐效果记录：
 * - `evaluation` 有值 → 只投影该快照；
 * - 省略 → 通过正式事件入口取一份带记录的结果（冷态允许一次正式重放，由调用方缓存）；
 * - 显式 `null` → 该事件不可结算，只给配置参数，不伪造实际金额。
 */
export function resolveEventBuffPreviewInputs(
  ctx: OptimalEvalContext,
  mainExternal: PanelStats | null,
  hit: ResolvedHit,
  slotIndex: number,
  evaluation?: OptimalEventEvalDetail | null,
): ConvertResolveInputs {
  const snapshot =
    evaluation === undefined
      ? evaluateOptimalEventDetail(ctx, mainExternal, hit, { includeDetails: true, requirePanel: true })
      : evaluation
  const context = buildEventPanelContext(ctx, mainExternal, hit, slotIndex, true)
  // 使用正式来源阶段的原值，组合属性和阶段身份也不在配置侧重建。
  for (const view of Object.values(snapshot?.viewSnapshots ?? {})) {
    if (view.policy === 'default' && view.convertValues) {
      context.panelSourceValuesBySlot!.set(view.slotIndex, view.convertValues)
    }
  }
  const base = {
    attrDefaults: context.attrValues ?? {},
    panelSourceValues: context.panelSourceValues,
    panelSourceValuesBySlot: Object.fromEntries(context.panelSourceValuesBySlot ?? []),
  }
  if (!snapshot) {
    // 不可结算：只给共享参数解析出的配置参数（不构造 summary、不冒充 inactive）
    return {
      ...base,
      contextKind: 'unavailable',
      configurationOnly: true,
      configurationParameters: resolveContextConfigurationParameters(ctx, context, slotIndex),
    }
  }

  const effectSummaries = projectEventEffectRecords(snapshot.effectRecords ?? [])
  // 兼容投影：保留旧字段，但只从 recipients 的真值推出（Spec §3.5）
  const effectAmounts: Record<string, number> = {}
  for (const [effectId, summary] of Object.entries(effectSummaries)) {
    if (summary.amount != null) effectAmounts[effectId] = summary.amount
    else if (summary.state === 'inactive') effectAmounts[effectId] = 0
  }
  // 未进入本次求值视图的候选（未启用/未匹配且没有记录）沿用既有「非生效显示位」= 0
  const candidates = collectEventCandidateEffects(context)
  for (const item of [...candidates.items, ...candidates.excluded.map(entry => entry.item)]) {
    effectAmounts[item.effect.id] ??= 0
  }
  return {
    ...base,
    contextKind: 'event',
    configurationOnly: false,
    effectAmounts,
    effectSummaries,
    configurationParameters: resolveContextConfigurationParameters(ctx, context, slotIndex),
  }
}

/**
 * 配置参数（Spec §5.1）：按显式查看槽位的上下文解析待选层数/基数/折算值。
 * 与实际贡献分开：不进 `effectAmounts`，也不参与结算。
 */
export function resolveConfigurationParameters(
  ctx: OptimalEvalContext,
  hit: ResolvedHit,
  slotIndex: number,
  mainExternal: PanelStats | null = null,
): Record<string, ResolvedEffectParameters> {
  const context = buildEventPanelContext(
    ctx,
    mainExternal,
    hit,
    slotIndex,
  )
  return resolveContextConfigurationParameters(ctx, context, slotIndex)
}

/** 目录候选与生效状态分离；查询禁用条目不重启来源，合并表覆盖所有受益槽位。 */
export function resolveContextConfigurationParameters(
  ctx: OptimalEvalContext,
  query: PanelCalcContext,
  slotIndex: number,
): Record<string, ResolvedEffectParameters> {
  const contexts = new Map<number, PanelCalcContext>([[slotIndex, query]])
  function forSlot(index: number) {
    let context = contexts.get(index)
    if (!context) {
      const main = query.mainExternalPanel ?? ctx.panelContext.slotExternalPanels![ctx.panelContext.mainSlotIndex]!
      const external = resolveExternalForAgent(ctx, ctx.panelContext.teamSlots[index]?.agentId ?? '', index, main)
      context = buildPanelContextForSlot(ctx, index, external, main, {
        skillContext: query.skillContext!.generic
          ? buildGenericPanelSkillContext({ ...query.skillContext, element: ctx.panelContext.agents.find(a => a.id === ctx.panelContext.teamSlots[index]?.agentId)?.element })
          : query.skillContext!,
        rowBuffOverride: query.rowBuffOverride,
        deferSourceValues: true,
      })
      if (!query.skillContext?.generic) context.panelSourceValuesBySlot = query.panelSourceValuesBySlot
      contexts.set(index, context)
    }
    return context
  }
  const parameters: Record<string, ResolvedEffectParameters> = {}
  for (let index = 0; index < ctx.panelContext.teamSlots.length; index++) {
    if (!ctx.panelContext.teamSlots[index]?.agentId) continue
    const context = forSlot(index)
    const candidates = collectEventCandidateEffects(context)
    for (const item of [...candidates.items, ...candidates.excluded.map(entry => entry.item)]) {
      const beneficiary = item.applicableSlots?.length === 1 ? item.applicableSlots[0]! : slotIndex
      if (index !== beneficiary) continue
      parameters[item.effect.id] = resolveCollectedEffectParameters(item, forSlot(beneficiary))
    }
  }
  return parameters
}


function resolveRemielSelfRadianceCalcForOptimal(
  ctx: OptimalEvalContext,
  anomalyPowerAgentId: string | null | undefined,
  mainExternal: PanelStats,
  hit: ResolvedHit,
  trace?: ReturnType<typeof createEventTraceCollector> | null,
) {
  const remiel = findLuminousAgentInTeam(ctx.panelContext.teamSlots, ctx.panelContext.agents)
  const policy = resolvePanelViewPolicyForRadiance(anomalyPowerAgentId, remiel?.id)
  if (policy.id !== 'remiel-self-radiance' || !remiel || !policy.resolveRadianceCalcInput) {
    return undefined
  }
  const external = resolveExternalForAgent(ctx, remiel.id, remiel.slotIndex, mainExternal)
  const agent = ctx.panelContext.agents.find((item) => item.id === remiel.id)
  const baseCtx = buildEventPanelContext(ctx, mainExternal, hit, remiel.slotIndex, Boolean(trace))
  return policy.resolveRadianceCalcInput({
    teamSlots: ctx.panelContext.teamSlots,
    agents: ctx.panelContext.agents,
    externalPanel: external,
    panelCtx: baseCtx,
    remielSlotIndex: remiel.slotIndex,
    agentLevel: resolveProducerAgentLevel(ctx, remiel.id),
    isMb: agent?.profession === MB_PROFESSION,
    trace: trace?.view({ useView: 'radianceSelfPanel', external, context: baseCtx,
      slotIndex: remiel.slotIndex, agentId: remiel.id, element: baseCtx.skillContext?.element,
      policy: 'remiel-self-radiance' }).options.trace,
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
  const anomaly = ctx.panelContext.activeSlotPanels?.[agentId]
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
    // 额外 Buff 的来源槽位在 extraGainSourceSlot 上（providerSlot 恒 null），与其它转模判定统一解析
    if (resolveCollectedEffectSourceSlot(item) !== mainIndex) continue
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
  hit?: ResolvedHit,
  /** 追踪工厂（团队异化视图，Spec §2.4 第 1 项）：拿到真实来源面板后再建视图身份 */
  traceFor?: (external: PanelStats) => ComputeFinalPanelOptions,
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
  const luminousContext: PanelCalcContext = hit
    ? buildEventPanelContext(ctx, mainExternal, hit, tSlotIndex, includeDetails)
    : {
        ...buildPanelContextForSlot(ctx, tSlotIndex, producerExternal, mainExternal),
        skillContext: {
          damageKind: 'anomaly', categoryId: 'basic', subcategoryId: null,
          element: found.element, staggerPhase: 'stagger', isFollowUp: false,
          anomalySubKind: 'radiance',
        },
      }
  const breakdown = computeFinalPanel(
    producerExternal,
    luminousContext,
    traceFor ? traceFor(producerExternal) : includeDetails ? undefined : PANEL_NUMBERS_ONLY,
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
  mainExternal: PanelStats | null,
  hit: ResolvedHit,
  options?: {
    includeDetails?: boolean
    /**
     * 要求「该角色有面板」才出伤害（伤害页四条入口传 true；最优分配的候选评估不传）。
     *
     * 必要条件（所有者口径 2026-09-12）：没点导入 → 没有面板 → 没有伤害。
     * 关掉它，Buff 里的固定攻击/暴击仍会算出一份不小的数 —— 那会让人以为面板还在。
     */
    requirePanel?: boolean
  },
): OptimalEventEvalDetail | null {
  // mainPanel 为 null 时（「伤害面板」3 选 1 选了角色配置面板），用主槽激活面板兜底：
  // 普通模式的事件明细同样要能点开（同一套流程计算）。
  const mainSlotAgentId = ctx.panelContext.teamSlots[ctx.panelContext.mainSlotIndex ?? -1]?.agentId
  const mainPanel = mainExternal ?? (mainSlotAgentId ? ctx.panelContext.activeSlotPanels?.[mainSlotAgentId] : undefined) ?? null
  const includeDetails = options?.includeDetails !== false
  const panelOpts = includeDetails ? undefined : PANEL_NUMBERS_ONLY
  const skipReason = getHitSkipReason(hit, {
    teamSlots: ctx.panelContext.teamSlots,
    agents: ctx.panelContext.agents,
  })
  if (skipReason) return null
  // 主 C 没面板时任何事件明细都算不出（主 C 面板是全部事件的参照基底）
  if (!mainPanel) return null

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

  if (options?.requirePanel) {
    // 出手的角色没面板 → 这一条不出伤害
    if (!hasExternalPanelForSlot(ownerSlotIndex, ctx.panelContext)) return null
    // 异常类还要强度提供者的面板（它身上的精通/异常增伤才配得出来）
    if (eventNeedsTrigger && evtPowerAgentId) {
      const providerSlotIndex = ctx.panelContext.teamSlots.findIndex(
        (slot) => slot.agentId === evtPowerAgentId,
      )
      if (!hasExternalPanelForSlot(providerSlotIndex, ctx.panelContext)) return null
    }
  }

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
  const evtPowerElement = resolveEventElement(hit, ctx.panelContext.agents)
  const evtTriggerIsMb = tAgent?.profession === MB_PROFESSION
  const evtTriggerBaseDamageSource = resolveBaseDamageSourceForProfession(tAgent?.profession)

  // 事件元素只由共享优先级解析；角色面板归属保持独立。
  const skillCtx = buildSkillContextFromHit(hit, evtPowerElement)

  const ownerExternal = resolveExternalForAgent(
    ctx,
    ownerAgentId,
    ownerSlotIndex,
    mainPanel,
  )
  // 带记录的一侧才建追踪；数值侧（includeDetails=false）不分配任何记录（Spec §3.4 第 1 项）
  const trace = includeDetails ? createEventTraceCollector(ctx, mainPanel, hit) : null
  const ownerView = trace?.view({
    useView: 'ownerPanel',
    slotIndex: ownerSlotIndex,
    agentId: ownerAgentId,
    policy: 'default',
    element: evtPowerElement,
    external: ownerExternal,
  })
  const evtPanelCtx = buildEventPanelContext(ctx, mainPanel, hit, ownerSlotIndex, includeDetails)
  const evtBreakdown = computeFinalPanel(ownerExternal, evtPanelCtx, ownerView?.options ?? panelOpts)
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
  let producerView: ReturnType<NonNullable<typeof trace>['view']> | undefined
  let mutationPanelView: ReturnType<NonNullable<typeof trace>['view']> | undefined
  let radianceSelfView: ReturnType<NonNullable<typeof trace>['view']> | undefined

  /** 异常强度提供者是否不是主 C（扫掠敏感度等元数据用） */
  const usesNonMainProducer = Boolean(
    eventNeedsTrigger && evtPowerAgentId && evtPowerAgentId !== ctx.mainAgentId,
  )
  const mainlyProducerDriven =
    usesNonMainProducer &&
    (damageType === 'disorder' || damageType === 'turbulence' || damageType === 'attributeAnomaly')

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
      producerView = ownerView
    } else {
      const tExternal = resolveExternalForAgent(ctx, evtPowerAgentId, tSlotIndex, mainPanel)
      producerExternalPanel = tExternal
      producerView = trace?.view({
        useView: 'powerProviderPanel',
        slotIndex: tSlotIndex,
        agentId: evtPowerAgentId,
        policy: 'default',
        element: evtPowerElement,
        external: tExternal,
      })
      producerBreakdown = computeFinalPanel(
        tExternal,
        buildEventPanelContext(ctx, mainPanel, hit, tSlotIndex, includeDetails),
        producerView?.options ?? panelOpts,
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
  // 倍率修正只写面板，避免与 resolveSkillMults 双重相乘
  let effectiveSub =
    sub && panelOverrides ? mergeSkillSubcategoryMultOverrides(sub, panelOverrides) : sub

  const luminousMods = resolveLuminousTeamModifiersForOptimal(
    ctx,
    mainPanel,
    includeDetails,
    hit,
    trace
      ? (external) =>
          (mutationPanelView = trace.view({
            useView: 'mutationPanel',
            slotIndex:
              findLuminousAgentInTeam(ctx.panelContext.teamSlots, ctx.panelContext.agents)?.slotIndex ??
              mainSlotIndex,
            agentId: findLuminousAgentInTeam(ctx.panelContext.teamSlots, ctx.panelContext.agents)?.id ?? '',
            policy: 'default',
            element: evtPowerElement,
            external,
          })).options
      : undefined,
  )

  // 属性异常/异放/耀变类型增伤取触发者；紊乱/乱流取持有者；直伤回落 owner
  let anomalyTriggerPanel = evtFinalPanel
  let bonusExternalPanel = ownerExternal
  let bonusBreakdown: OptimalPanelBreakdown = evtBreakdown
  let triggerView: ReturnType<NonNullable<typeof trace>['view']> | undefined = ownerView
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
        mainPanel,
      )
      triggerView = trace?.view({
        useView: 'anomalyTriggerPanel',
        slotIndex: trigSlotIndex,
        agentId: hit.triggerAgentId,
        policy: 'default',
        element: evtPowerElement,
        external: trigExternal,
      })
      bonusBreakdown = computeFinalPanel(
        trigExternal,
        buildEventPanelContext(ctx, mainPanel, hit, trigSlotIndex, includeDetails),
        triggerView?.options ?? panelOpts,
      )
      anomalyTriggerPanel = bonusBreakdown.finalPanel
      bonusExternalPanel = trigExternal
    }
  }

  if (damageType === 'attributeAnomaly' || damageType === 'anomalyRelease') {
    anomalyTriggerPanel = applyEventMultOverrides(anomalyTriggerPanel, {
      attributeAnomalyMult: hit.multOverrides?.attributeAnomalyMult,
      attributeAnomalyMultFactor: hit.multOverrides?.attributeAnomalyMultFactor,
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
          : resolveExternalForAgent(ctx, triggerId, trigSlotIndex, mainPanel)
      const trigPanelCtx = triggerId === ownerAgentId
        ? evtPanelCtx : buildEventPanelContext(ctx, mainPanel, hit, trigSlotIndex, includeDetails)
      // 异放倍率视图：走同一套倍率合并规则，只是带上追踪（Spec §2.4 第 3 项）
      const releaseView = trace?.view({
        useView: 'releaseMult',
        slotIndex: trigSlotIndex,
        agentId: triggerId,
        policy: 'default',
        element: evtPowerElement,
        external: trigExternal,
        context: { ...trigPanelCtx, traceStage: 'releaseMult' },
      })
      const releaseEvaluation = resolveAnomalyReleaseMultEvaluation(
        trigExternal,
        { ...trigPanelCtx, trace: releaseView?.options.trace, traceStage: 'releaseMult' },
        evtPowerElement,
      )
      const releaseFields = releaseEvaluation.fields
      for (const inputKey of ['finalPanel', 'anomalyTriggerPanel'] as const) {
        releaseView?.options.trace?.bindInput?.(inputKey, 'anomalyReleaseMult', releaseView.viewKey)
      }
      if (needReleaseFactor) for (const inputKey of ['finalPanel', 'anomalyTriggerPanel'] as const) {
        releaseView?.options.trace?.bindInput?.(inputKey, 'anomalyReleaseMultFactor', releaseView.viewKey)
      }
      // 行级覆盖来自招式基础倍率：固定值与基础倍率重复，只把「技能等级转模」增量补上去。
      // 行级异放倍率也会被写进招式小类（小类非 0 时优先于面板），所以增量要同时补到
      // 小类与面板：倍率区按小类算，结果明细的提示按面板显示。
      const rowConvertMult = needReleaseMult
        ? 0
        : (releaseEvaluation.convertMods.anomalyReleaseMult ?? 0)
      if (rowConvertMult && effectiveSub) {
        effectiveSub = {
          ...effectiveSub,
          anomalyReleaseMult: effectiveSub.anomalyReleaseMult + rowConvertMult,
        }
        releaseView?.usage({ inputKey: 'anomalyTriggerPanel', field: 'anomalyReleaseMult', resultKey: 'anomalyReleaseMultZone', usedZones: ['anomalyTypeBonus'] })
      }
      anomalyTriggerPanel = {
        ...anomalyTriggerPanel,
        anomalyReleaseMult: needReleaseMult
          ? releaseFields.anomalyReleaseMult
          : anomalyTriggerPanel.anomalyReleaseMult + rowConvertMult,
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
    damageType === 'attributeAnomaly' ||
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
    eventNeedsTrigger ? evtPowerAgentId : null,
    evtPowerElement,
  )
  const triggerAgentDoc = hit.triggerAgentId
    ? ctx.panelContext.agents.find((item) => item.id === hit.triggerAgentId)
    : undefined
  /** 伤害计算报告上来的「实际采用了哪张面板的哪个字段」，按角色落到对应视图 */
  const rawUsages: DamageInputUsage[] = []
  const viewOfInputKey = (inputKey: DamageInputUsage['inputKey']) => {
    if (inputKey === 'triggerFinalPanel') return producerView ?? ownerView
    if (inputKey === 'anomalyTriggerPanel') return triggerView ?? ownerView
    if (inputKey === 'remielSelfRadianceCalc') return radianceSelfView ?? ownerView
    if (inputKey === 'mutationZone') return mutationPanelView ?? ownerView
    if (inputKey === 'remielRadianceResPen') return mutationPanelView ?? ownerView
    return ownerView
  }

  const remielSelfRadianceCalc = resolveRemielSelfRadianceCalcForOptimal(ctx, evtPowerAgentId, mainPanel, hit, trace)
  const result = computeDamageResult({
    eventDamageType: damageType,
    eventCritMode: hit.critMode,
    onInputUsed: trace ? (usage) => rawUsages.push(usage) : undefined,
    eventElement: evtPowerElement,
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
    remielSelfRadianceCalc,
    disorderZoneMultOverride: zoneMultResolved.disorderZoneMult,
    disorderZoneMultFactorOverride: zoneMultResolved.disorderZoneMultFactor,
    turbulenceZoneMultOverride: zoneMultResolved.turbulenceZoneMult,
    turbulenceZoneMultFactorOverride: zoneMultResolved.turbulenceZoneMultFactor,
    curtainVulnerabilityCap: resolveCurtainCap(
      resolveZoneScheme({ hit, panelContext: ctx.panelContext }),
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
  if (includeDetails && result.remielSelfRadianceActive && remiel) {
    const remielExternal = resolveExternalForAgent(ctx, remiel.id, remiel.slotIndex, mainPanel)
    const remielCtx = buildEventPanelContext(ctx, mainPanel, hit, remiel.slotIndex, includeDetails)
    const restricted = REMIEL_SELF_RADIANCE_VIEW_POLICY.collectRestrictedContributions!(
      remielExternal,
      { ...remielCtx, skillContext: skillCtx },
      remiel.slotIndex,
    )
    // 本人耀变受限视图：政策不变，只把追踪透传（Spec §2.4 第 1 项）
    radianceSelfView = trace?.view({
      useView: 'radianceSelfPanel',
      slotIndex: remiel.slotIndex,
      agentId: remiel.id,
      policy: 'remiel-self-radiance',
      element: evtPowerElement,
      external: remielExternal,
    })
    const selfBreakdown = REMIEL_SELF_RADIANCE_VIEW_POLICY.computeInCombatPanel(
      remielExternal,
      remielCtx,
      remiel.slotIndex,
      radianceSelfView?.options,
    )
    remielSelfAtkSourceItems = restricted.atkItems
    remielSelfMasterySourceItems = restricted.masteryItems
    remielSelfExternalPanel = remielExternal
    remielSelfSources = selfBreakdown.sources
    remielSelfFinalPanel = selfBreakdown.finalPanel
  }

  if (trace) {
    for (const usage of rawUsages) {
      const bound = trace.boundInputs.get(`${usage.inputKey}:${usage.field}`)
      if (bound) {
        const view = trace.views.find(item => item.viewKey === bound.viewKey)
        if (view) trace.usages.push({ ...usage, ...bound, slotIndex: view.slotIndex, policy: view.policy })
      } else viewOfInputKey(usage.inputKey)?.usage(usage)
    }
  }
  const eventRecords = trace ? buildEventEffectRecords(ctx, hit, trace) : null
  const viewSnapshots = trace?.snapshots()
  if (trace && viewSnapshots) {
    // 绑定正式输入的覆盖后字段；视图其他字段保持该政策的原快照，不拼接别人的面板。
    for (const usage of trace.usages) {
      // 间接依赖沿用下游结果键，但属于来源自己的视图，不是下游伤害输入的别名。
      if (usage.usedView === 'convertSourcePanel') continue
      const view = viewSnapshots[usage.viewKey]!
      const field = usage.field === 'inCombatAtk' ? 'atk' : usage.field === 'inCombatMastery' ? 'mastery' : usage.field
      const panel = usage.inputKey === 'triggerFinalPanel' ? evtTriggerFinalPanel
        : usage.inputKey === 'anomalyTriggerPanel' ? anomalyTriggerPanel
          : usage.inputKey === 'finalPanel' ? evtFinalPanel : null
      const value = usage.inputKey === 'remielSelfRadianceCalc'
        ? remielSelfRadianceCalc?.[usage.field as keyof NonNullable<typeof remielSelfRadianceCalc>]
        : panel?.[field as keyof PanelStats]
      if (typeof value === 'number' && field in view.panel) {
        view.panel = { ...view.panel, [field]: value }
      }
    }
  }

  return {
    eventElement: evtPowerElement,
    hit,
    eventId: hit.id,
    displayName,
    kind: damageType,
    perHit,
    total,
    usesNonMainProducer,
    mainlyProducerDriven,
    result,
    ...(eventRecords
      ? {
          effectRecords: eventRecords.effectRecords,
          panelStageTraces: eventRecords.panelStageTraces,
          damageInputUsages: eventRecords.damageInputUsages,
          viewSnapshots,
        }
      : {}),
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

/**
 * 事件汇总（计算链路收敛 Spec §2.7 第 1 项 / C8）。
 *
 * 这里**只**产出「逐事件行 + 合计」；`globalSummary` 是顺带拿到的**全局面板摘要**
 * （主槽面板，与具体是哪个事件无关），两者语义不同、不能互相替代：
 * 把 `globalSummary` 直接当第一条事件的结果会改变分析侧展示含义。
 */
function computeEventDamageLines(
  ctx: OptimalEvalContext,
  external: PanelStats,
): {
  eventSummary: { grandTotal: number; eventLines: OptimalEventDamageLine[] }
  globalSummary: { result: DamageCalcResult; breakdown: OptimalPanelBreakdown } | null
} {
  const hits = ctx.hits ?? []
  if (!hits.length) {
    return { eventSummary: { grandTotal: 0, eventLines: [] }, globalSummary: null }
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

  return {
    eventSummary: { grandTotal, eventLines },
    globalSummary: firstResult && firstBreakdown ? { result: firstResult, breakdown: firstBreakdown } : null,
  }
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
  panelDeltas?: AffixDeltaMap,
): { grandTotal: number; eventLines: OptimalEventDamageLine[] } {
  resetAffixEvalCacheIfNeeded(ctx)
  const cacheKey = affixEvalCacheKey(affixCounts, panelDeltas, ctx.valuePerCount)
  const cached = affixSweepCache.get(cacheKey)
  if (cached) return cached

  const external = computeExternalForEval(ctx, affixCounts, panelDeltas)

  let payload: { grandTotal: number; eventLines: OptimalEventDamageLine[] }
  if (ctx.hits?.length) {
    payload = computeEventDamageLinesForSweep(ctx, external)  } else {
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
          ? result.attributeAnomalyExpected
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
/**
 * 当前上下文在**缓存键里**用的短标识。
 *
 * 缺陷与实测（2026-09-11，用户报「词条计算变慢」）：此前缓存键直接把上下文签名
 * （`affixEvalCacheCtxSig`）拼在前面，而签名含全量角色 / 音擎 / 驱动盘文档 ——
 * 实测一次 30 词条求解里键长 **4,217,995 字符**，241 次评估中仅「拼键 + Map 查找 +
 * Map 写入」就花掉 **13.2 s**（真算只占 0.84 s），把求解从 888 ms 拖到 14 s。
 * 每次拼键都会新建一个 4 MB 字符串、每次哈希都要重算，纯属浪费。
 *
 * 签名本身只需回答「变没变」（`resetAffixEvalCacheIfNeeded` 比的是它，变了就整体清缓存），
 * 因此缓存键里改成用**等价的短 id**：签名一变、id 必变，隔断语义与原来逐位相同。
 */
let affixEvalCacheCtxKey = ''
let affixEvalCacheCtxSeq = 0
/**
 * 增量表类型在 `affixLibrary.ts`（`AffixDeltaMap`）：只装局外增量。
 * `gain:` 走 `extraGains`，不进这张表。
 */
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
 * 分析侧现在把局外 `panel:` 都写进 `panelDeltas`，本表对分析路径恒为常量表。
 * 省略时全部走常量表 —— 柱图（词条计算页）等仍按十格计数 × 本表折算。
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
  panelDeltas?: AffixDeltaMap,
  valuePerCount?: AffixValuePerCount,
  extraGains?: ExtraBuffGain[],
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
  const extraGainPart = extraGainsCachePart(extraGains)
  if (!panelDeltas) return `${base}${valuePart}${extraGainPart}`
  const parts = (Object.keys(panelDeltas) as AffixPanelDeltaField[])
    .sort()
    .filter((key) => Boolean(panelDeltas[key]))
    .map((key) => `${key}=${panelDeltas[key]}`)
  const deltaPart = parts.length ? `|${parts.join(',')}` : ''
  return `${base}${valuePart}${deltaPart}${extraGainPart}`
}

/**
 * 候选词条的 extraGains 指纹：进**每评估键**，不进 ctx 签名。
 *
 * 若把它们写进 `{ ...ctx, extraGains }` 再当缓存上下文，每次评估都会清整表。
 * 空数组 / undefined 不进键，默认库路径的键形态与改造前一致。
 */
/** 稳定序列化（键排序）：缓存指纹不能受对象键顺序影响 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${key}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function extraGainsCachePart(extraGains?: ExtraBuffGain[]): string {
  if (!extraGains?.length) return ''
  const parts = extraGains
    .map(
      (gain) =>
        `${gain.id}:${gain.applySlot}:${gain.sourceSlot}:${stableJson(gain.effects ?? [])}`,
    )
    .sort()
  return `|eg:${parts.join(',')}`
}

/**
 * 评估缓存键 = **上下文短标识** + 词条数。
 *
 * 只按词条数做键时，同一套词条在不同上下文下会互相命中：实测（2026-09-11，真实方案）
 * 主属性组合试算用 `mainBaseExternalPanel: null` 评估（换主属性必须重新推导面板），
 * 它把「无基准」的结果写进缓存；随后柱图/详情再评估同一套词条直接命中该条，
 * 详情总伤从 74,222,437 掉成 56,758,629 —— 就是用户看到的「柱图与详情对不上」。
 *
 * 标识由 `resetAffixEvalCacheIfNeeded()` 在调用前备好（同一份 ctx 走记忆化，不增开销），
 * 这里直接复用；这样即便将来签名又漏了字段，也不会跨上下文串值。
 *
 * 注意**不要**把签名原文（几 MB）拼进键：那会让每次评估都新建并哈希一个巨型字符串，
 * 实测把求解从 888 ms 拖到 14 s（见 `affixEvalCacheCtxKey` 的说明）。
 */
function affixEvalCacheKey(
  affixCounts: AffixCounts,
  panelDeltas?: AffixDeltaMap,
  valuePerCount?: AffixValuePerCount,
  extraGains?: ExtraBuffGain[],
): string {
  return `${affixEvalCacheCtxKey}|${affixCountsCacheKey(affixCounts, panelDeltas, valuePerCount, extraGains)}`
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
 *
 * 复核判据（2026-10-29 本次优化）：记忆项不再拿整批事件指纹拼大字符串来比对，
 * 而是比「逐条指纹（同一份字符串实例，O(1) 引用比较）」+「各槽角色 id / 元素」。
 * 指纹本身由 `buildHitEvalFingerprintReused` 按**真实内容**复用（就地改 `count`、
 * `buffOverride.disabledEffectIds`、`multOverrides`、`elementOverride` 都会换指纹），
 * 因此这里的比对强度不低于改造前逐字比较整串 `JSON.stringify`，只是不再重复构造那串正文。
 */
interface AffixCtxEventIdentity {
  /** 逐条事件指纹（复用层返回的同一份字符串实例） */
  fingerprints: string[]
  /** 事件状态判断的另一半：各槽位角色 id 与角色元素 */
  teamElements: string
  /** 完整上下文签名 */
  signature: string
}

let affixCtxSignatureCache = new WeakMap<OptimalEvalContext, AffixCtxEventIdentity>()

/**
 * 上下文身份链的调试计数（**只数真实执行路径**，不含计时）。
 *
 * 用途：回归要证明「同批事件指纹只生成一次」「换候选不重生成」——
 * 这只能从真实身份链的计数观察，常量或 mock 都不算证据。
 * `builtFingerprints` / `reusedFingerprints` 由复用层逐条回报；
 * `serializations` 的真实序列化次数见 `hitFingerprintReuseDebugStats()`。
 */
const affixEventIdentityDebug = {
  /** 上下文身份查询次数（= `affixEvalContextSignature` 调用次数） */
  batches: 0,
  /** 该批中按内容重建的事件指纹条数 */
  builtFingerprints: 0,
  /** 该批中直接复用已生成事件指纹的条数 */
  reusedFingerprints: 0,
  /** 完整上下文签名构造次数 */
  signatureComputes: 0,
}

export function affixEventIdentityDebugStats(): {
  batches: number
  builtFingerprints: number
  reusedFingerprints: number
  signatureComputes: number
} {
  return { ...affixEventIdentityDebug }
}

export function resetAffixEventIdentityDebugStats(): void {
  affixEventIdentityDebug.batches = 0
  affixEventIdentityDebug.builtFingerprints = 0
  affixEventIdentityDebug.reusedFingerprints = 0
  affixEventIdentityDebug.signatureComputes = 0
}

/**
 * 上下文身份查询：**一批事件指纹只生成一次**，供「事件状态判断」与「完整签名构造」共用。
 *
 * 改造前这里会 `ctx.hits.map(buildHitEvalFingerprint)` 一次做状态判断，
 * 未命中时 `computeAffixEvalContextSignature` 里又整批再来一次 —— 同一次查询生成两遍，
 * 每个候选都要付两遍（Spec §4.2 第 1、2 项要消除的正是这两处）。
 */
function affixEvalContextSignature(ctx: OptimalEvalContext): string {
  affixEventIdentityDebug.batches += 1
  const hits = ctx.hits ?? []
  const fingerprints: string[] = new Array(hits.length)
  for (let index = 0; index < hits.length; index += 1) {
    const reused = buildHitEvalFingerprintReused(hits[index]!)
    if (reused.reused) affixEventIdentityDebug.reusedFingerprints += 1
    else affixEventIdentityDebug.builtFingerprints += 1
    fingerprints[index] = reused.fingerprint
  }
  const teamElements = JSON.stringify(
    ctx.panelContext.teamSlots.map(slot => [slot.agentId,
      ctx.panelContext.agents.find(agent => agent.id === slot.agentId)?.element]),
  )
  const memo = affixCtxSignatureCache.get(ctx)
  if (memo && memo.teamElements === teamElements && sameEventFingerprints(memo.fingerprints, fingerprints)) {
    return memo.signature
  }
  const signature = computeAffixEvalContextSignature(ctx, fingerprints)
  affixEventIdentityDebug.signatureComputes += 1
  affixCtxSignatureCache.set(ctx, { fingerprints, teamElements, signature })
  return signature
}

/** 逐条比指纹：复用层返回同一份字符串实例，内容没变就是 O(1) 引用比较 */
function sameEventFingerprints(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function computeAffixEvalContextSignature(ctx: OptimalEvalContext, fingerprints: string[]): string {
  // 与改造前 `ctx.hits?.map(buildHitEvalFingerprint).join(';') ?? ''` 逐位等价：
  // 指纹由调用方（`affixEvalContextSignature`）按真实内容生成并传入，这里不再生成第二遍。
  const events = fingerprints.join(';')
  return [
    ctx.panelContext.masterDataVersion ?? buffMasterDataVersion(ctx.panelContext),
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
    /**
     * 基准局外面板必须入签名。
     *
     * 主属性组合试算会用 `mainBaseExternalPanel: null` 评估「换一套主属性会怎样」
     * （见组件 `evaluateMainStatComboDamage`：主属性变了面板必须重新推导），
     * 而它的主属性/套装在「当前这套」时与常规 ctx 完全相同 —— 也就是说**只有基准不同**。
     * 漏掉它，两者签名一致 → 共用同一份缓存 → 谁先算谁的值被另一边读走。
     */
    JSON.stringify(ctx.mainBaseExternalPanel ?? null),
    /**
     * 每档值必须入签名。
     *
     * 它与 `agentBase` / `wengineAdvanced` 同类：都影响「由词条数算出来的局外面板」。
     * 词条库改「每档」后若签名不变，柱图 / 详情 / 基准总伤会共用同一条旧缓存，
     * 表现为「改了每档，数字一动不动」。
     */
    JSON.stringify(ctx.valuePerCount ?? null),
    // 主词条组合试算会改 2/4 件套；缺失会导致同词条数命中旧缓存，伤害不变
    JSON.stringify(ctx.driveDiscSelection),
    JSON.stringify(ctx.enemyInput),
    JSON.stringify(ctx.panelContext.skillContext),
    /**
     * 技能等级表必须入签名：异放「技能等级转模」按等级折算，改等级后签名不变会命中旧缓存，
     * 表现为「改了普攻/连携等级，伤害一动不动」（`dev-docs/convert-from-skill-level.md`）。
     */
    JSON.stringify(ctx.panelContext.skillTalentLevelsByAgent ?? {}),
    JSON.stringify(ctx.extraGains ?? []),
    JSON.stringify(ctx.panelContext.activeSlotPanels ?? {}),
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
    /**
     * 场地 / 环境 Buff（危局、Boss 场地、防卫房间）必须入签名，且要含**内容**。
     *
     * 缺陷与实测（2026-09-11，`scripts/test-env-buff-cache-key.mjs`）：
     * 原先只有 `buffSelection`（勾选状态）。同一 effect id、勾选不变、仅改数值
     * （+30% → +60%）时签名不变 → 词条评估沿用旧值（实测两次都是 1484）。
     * 同批把 `panelBuffCalc.environmentBuffsKey` 也从「只用 sourceKey」改为含内容，
     * 否则面板级目录缓存同样会停在旧 mods；两处缺一不可。
     */
    JSON.stringify(ctx.panelContext.environmentBuffs ?? null),
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
    // 签名变了 → 换一把短 id，缓存键里的上下文段随之失效（见 affixEvalCacheCtxKey）
    affixEvalCacheCtxSeq += 1
    affixEvalCacheCtxKey = `c${affixEvalCacheCtxSeq}`
  }
}

export function clearAffixEvalCache() {
  affixEvalCache.clear()
  affixSweepCache.clear()
  affixExternalFixedParts = null
  stableEventLinesByHitId = null
  mainAgentTeamConvertReadsPanelCached = null
  affixEvalCacheCtxSig = ''
  affixEvalCacheCtxSeq += 1
  affixEvalCacheCtxKey = `c${affixEvalCacheCtxSeq}`
  /**
   * 本次新增的事件身份复用状态一并丢弃（Spec §4.2 第 4 项）。
   *
   * 丢弃是**保守收口**：复用状态本身按真实内容校验，判断不出过期值；
   * 但清理语义要求「清理后不再提供旧身份」，所以连同按 ctx 记忆的签名一起重来，
   * 调用方不需要为此多做任何手工清理。
   */
  affixCtxSignatureCache = new WeakMap<OptimalEvalContext, AffixCtxEventIdentity>()
  resetHitEvalFingerprintReuseState()
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

/**
 * 本次评估用的主 C 局外面板 —— 求解 / 扫掠 / 收益表唯一的「取面板」入口。
 *
 * 有基准面板（「角色配置」录入的那份，`activeSlotPanels`）时：**面板是起点，
 * 候选词条叠加其上** —— 词条是「在面板上再加 N 条」，不反推也不扣减面板里已有的词条。
 * 百分比词条按「角色基础 + 音擎基础」折算，与 `applyAffixCountsToFixedParts` 同口径。
 *
 * 没有基准面板时回退到按槽位配置推导，行为与改造前逐位等价。
 */
function computeExternalForEval(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
  panelDeltas?: AffixDeltaMap,
  valuePerCount?: AffixValuePerCount,
): PanelStats {
  // 显式参数优先（求解器 / 收益表按自己的条目表算），否则用上下文里那份 ——
  // 页面所有展示路径共用同一个 ctx，因此「每档」在哪儿改，哪儿就跟着变。
  const vpc = valuePerCount ?? ctx.valuePerCount
  const base = ctx.mainBaseExternalPanel
  const external = base
    ? applyAffixCountsOntoExternalPanel(
        base,
        affixCounts,
        {
          hp: ctx.agentBase?.hp ?? 0,
          atk: (ctx.agentBase?.atk ?? 0) + (ctx.wengineBaseAtk ?? 0),
          def: (ctx.agentBase?.def ?? 0) + (ctx.wengineBaseDef ?? 0),
        },
        vpc,
      )
    : applyAffixCountsToFixedParts(getAffixExternalFixedParts(ctx), affixCounts, vpc)
  if (!panelDeltas) return external
  /**
   * 条目贡献的折算基础：**主 C 槽位的角色基础面板**，与主属性 / Buff 同口径。
   *
   * 不传就会让「异常掌控 / 能量恢复」这两个按基础值乘算的字段贡献归零 ——
   * 所以这里是必填参数，漏传由类型检查拦住（见 `applyPanelDeltas`）。
   */
  return applyPanelDeltas(external, panelDeltas, {
    anomalyControl: ctx.agentBase?.anomalyControl ?? 0,
    energyRegen: ctx.agentBase?.energyRegen ?? 0,
    hp: ctx.agentBase?.hp ?? 0,
    atk: (ctx.agentBase?.atk ?? 0) + (ctx.wengineBaseAtk ?? 0),
    def: (ctx.agentBase?.def ?? 0) + (ctx.wengineBaseDef ?? 0),
  })
}

/**
 * 库路径 `gain:` 条目的 extraGains：缓存查找之后才并入 ctx 副本。
 * 页级 extraGains 仍在原 ctx 上，走上下文签名。
 *
 * 招式流程选「最优分配 / 当前柱」重算时也要走这里：这些增益不在局外面板上。
 */
export function withAffixLibraryExtraGains(
  ctx: OptimalEvalContext,
  extraGains?: ExtraBuffGain[],
): OptimalEvalContext {
  if (!extraGains?.length) return ctx
  const applySlot = ctx.panelContext.mainSlotIndex
  /**
   * 只重绑**词条生成**的卡片（`extraGainFromLibraryEntry` / `applyAllocatedAffixEffects` 产出，
   * id 以 `affix-gain:` 开头）：页级手工额外 Buff 的固定目标保持不变（Spec §5.3 第 2 项）。
   */
  const tagged = extraGains.map((gain) => {
    if (!gain.id.startsWith('affix-gain:')) return gain
    return {
      ...gain,
      applySlot: applySlot as ExtraBuffApplySlot,
      // 评估主角永远是具体槽位（不是全队），目标固定派生为 self
      effects: gain.effects.map((effect) => ({ ...effect, applyTarget: 'self' as const })),
    }
  })
  return { ...ctx, extraGains: [...(ctx.extraGains ?? []), ...tagged] }
}

function evaluateAffixCountsUncached(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
  panelDeltas?: AffixDeltaMap,
  valuePerCount?: AffixValuePerCount,
  extraGains?: ExtraBuffGain[],
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
  const evalCtx = withAffixLibraryExtraGains(ctx, extraGains)

  if (ctx.hits?.length) {
    // 事件汇总与全局面板摘要分开取：前者逐事件，后者是主槽面板（Spec §2.7 第 1 项）
    const { eventSummary, globalSummary } = computeEventDamageLines(evalCtx, external)
    const { grandTotal, eventLines } = eventSummary
    const breakdown =
      globalSummary?.breakdown ??
      computeFinalPanel(external, {
        ...buildPanelContextForSlot(evalCtx, evalCtx.panelContext.mainSlotIndex, external, external),
        skillContext: evalCtx.panelContext.skillContext ?? undefined,
      })
    const piercePower = computePiercePower(
      breakdown.finalPanel.hp,
      breakdown.finalPanel.atk,
      breakdown.totalMods.pierce,
    )
    const result =
      globalSummary?.result ??
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
    ...buildPanelContextForSlot(evalCtx, evalCtx.panelContext.mainSlotIndex, external, external),
    skillContext: evalCtx.panelContext.skillContext ?? undefined,
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
        ? result.attributeAnomalyExpected
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
  panelDeltas?: AffixDeltaMap,
  valuePerCount?: AffixValuePerCount,
  extraGains?: ExtraBuffGain[],
): { value: AffixCountsEvalResult; cacheHit: boolean } {
  resetAffixEvalCacheIfNeeded(ctx)
  const vpc = valuePerCount ?? ctx.valuePerCount
  const cacheKey = affixEvalCacheKey(affixCounts, panelDeltas, vpc, extraGains)
  const cached = affixEvalCache.get(cacheKey)
  if (cached) return { value: cached, cacheHit: true }

  const result = evaluateAffixCountsUncached(ctx, affixCounts, panelDeltas, vpc, extraGains)
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
  panelDeltas?: AffixDeltaMap,
  valuePerCount?: AffixValuePerCount,
  extraGains?: ExtraBuffGain[],
): AffixCountsEvalResult {
  return evaluateAffixCountsWithCacheInfo(
    ctx,
    affixCounts,
    panelDeltas,
    valuePerCount,
    extraGains,
  ).value
}

/**
 * 「只改了固定词条（精通/穿透/小攻等）」时，能否原地刷新既有柱体而不重新枚举结构。
 *
 * 结构条件：既有各柱仍是「局外大% + 爆伤 = 剩余档数」。
 *
 * **上限条件同样必须满足**（2026-09-11 补）：4/5/6 主属性变化会改变主词条上限
 * （36 − 6×同类数）。上限收紧后若仍原地刷新，就会留下完整扫掠本会跳过的柱 ——
 * 实测（局外大防御上限 30 → 24，总词条 30）：完整扫掠出 25 根，原地刷新保留 31 根，
 * 柱图里凭空多出 25~30 档「已超上限」的柱，且与 X 轴上限规则自相矛盾。
 */
export function canReuseDirectSweepStructure(
  points: DirectSweepPoint[],
  state: DirectAllocState,
  isMb: boolean,
  isFengYu: boolean,
  mainStats: AffixDriveDiscMainStats,
): boolean {
  const crit = Math.round(state.critRate)
  const total = Math.round(state.totalRolls)
  const fixedAtk = isMb ? Math.round(state.atkPercent) : 0
  const remain = isMb ? total - crit - fixedAtk : total - crit
  if (remain < 0 || !points.length) return false
  if (!points.every((p) => p.outPercent + p.critDmg === remain)) return false
  const caps = getAffixRollCaps(mainStats)
  if (crit > caps.critRate) return false
  const outCap = resolveAffixOutPercentCap(caps, isMb, isFengYu)
  return points.every((p) => p.outPercent <= outCap && p.critDmg <= caps.critDmg)
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

// Node 的 setImmediate 不在 tsconfig 的 lib 里（`types: []` 刻意不引 @types/node），
// 从 globalThis 上取，避免为它把 Node 全局类型拉进整个前端工程。
const nodeSetImmediate = (
  globalThis as { setImmediate?: (callback: () => void) => unknown }
).setImmediate

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
  if (typeof nodeSetImmediate === 'function') {
    nodeSetImmediate(resolve)
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
      attributeAnomalyExpected: evaled.grandTotal,
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
        attributeAnomalyExpected: swept.grandTotal,
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
        attributeAnomalyExpected: evaled.result.attributeAnomalyExpected,
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
  anomalyMetric: OptimalAnomalyMetric = 'attributeAnomaly',
  grandTotal?: number,
) {
  if (typeof grandTotal === 'number' && Number.isFinite(grandTotal)) return grandTotal
  if (kind === 'direct') return result.directDamageExpected
  if (anomalyMetric === 'disorder') return result.disorderExpected
  if (anomalyMetric === 'turbulence') return result.turbulenceExpected
  if (anomalyMetric === 'anomalyRelease') return result.anomalyReleaseExpected
  if (anomalyMetric === 'radiance') return result.radianceExpected
  return result.attributeAnomalyExpected
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
  anomalyMetric: OptimalAnomalyMetric = 'attributeAnomaly',
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

  // 相对权重（2026-10-05 用户要求）：与收益表同口径 —— 分母 = 本表最大百分比差（≤0 全为 0）。
  // capped 行计入分母集合但百分比恒为 0，不影响最大值。
  const maxPercent = addOne.reduce((max, row) => Math.max(max, row.percentDelta), 0)
  for (const row of addOne) {
    row.weight = maxPercent > 0 ? row.percentDelta / maxPercent : 0
  }

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
  anomalyMetric: OptimalAnomalyMetric = 'attributeAnomaly',
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
  /** 已解析的激活面板（每人一份）：调用方解析完来源再传进来 */
  activeSlotPanels?: Record<string, PanelStats>
  /** 主 C「词条导入」那一路的词条数（没有存面板时用来现推局外） */
  mainAffixCounts?: AffixCounts
  convertSlotPanels?: import('@/utils/panelBuffCalc').ConvertSlotPanels
  /**
   * 各槽位局外面板（`index → PanelStats`），**整份覆盖**默认解析。
   *
   * 为什么需要：默认解析是「激活面板，取不到则按配置推导」（本文件下方 `Object.fromEntries`），
   * 而面板计算链路取不到时会回落到「转模部分面板 → 默认面板」。两条链路的回落不同，
   * 合并时由调用方把自己那份解析结果传进来，保证逐位一致
   * （见 `dev-docs/affix-calc-manual.md` §4；实施见提交「计算链路统一·步骤①」）。
   * 省略 = 保持原有解析。
   */
  slotExternalPanels?: Record<number, PanelStats>
  /** 技能等级转模来源：按角色 id 的五大类技能等级 */
  skillTalentLevelsByAgent?: Record<string, Partial<SkillTalentLevels> | null>
  hits?: ResolvedHit[]
  /** 页级异常强度提供者 id（命名含 trigger，实为 power） */
  triggerAnomalyAgentId?: string | null
  resolveSubcategory?: (id: string | null) => SkillSubcategory | null
  skillSubcategories?: SkillSubcategory[]
  followUpSkillRules?: import('@/types/calculator').FollowUpSkillRule[]
  environmentBuffs?: import('@/utils/environmentBuffCalc').EnvironmentBuffEntry[]
  /**
   * 词条「每档值」表（词条库条目的 `perRoll`）。省略 = 按 `AFFIX_VALUE_PER_COUNT`，
   * 与改造前的行为逐位一致。
   */
  valuePerCount?: AffixValuePerCount
}): OptimalEvalContext {
  // 深解包响应式代理：引擎会对这批数据做海量属性读取，走 Proxy 陷阱会慢 3 倍以上
  // （实测 16.4ms → 5.3ms/次评估，见 reactiveUnwrap.ts）。只换引用不改值，
  // 写入仍走响应式链路，因此不会造成「面板改了但计算不更新」。
  // 版本化主数据只读共享；可变配置先隔离，不能在页面容器中就地解包代理。
  const masterDataVersion = buffMasterDataVersion(input)
  const { agents, wengines, driveDiscs, bangboo, ...configuration } = input
  input = {
    ...snapshotCalculationInput(configuration),
    agents: agents.map(agent => ({ ...toRaw(agent), element: agent.element })),
    wengines: toRaw(wengines), driveDiscs: toRaw(driveDiscs), bangboo: toRaw(bangboo),
  }

  const mainSlot = input.teamSlots[input.mainSlotIndex]!
  const mainAgent = input.agents.find((a) => a.id === mainSlot.agentId)
  const mainWengine =
    mainSlot.wengineId && mainSlot.wengineId !== 'none'
      ? input.wengines.find((w) => w.id === mainSlot.wengineId)
      : null

  /**
   * 主 C 的**基准局外面板**：来自「角色配置」（导入录入写入的 `activeSlotPanels`）。
   *
   * 面板是起点，候选词条在它之上叠加 —— 见 `computeExternalForEval`。取不到时留 null，
   * 由 `computeExternalForEval` 回退到「按槽位配置推导」（改造前的行为，逐位等价）。
   */
  const mainSavedPanel = mainSlot.agentId ? input.activeSlotPanels?.[mainSlot.agentId] : undefined
  const mainBaseExternalPanel =
    mainSavedPanel && !isPlaceholderExternalPanel(mainSavedPanel)
      ? fillPanelStatsDefaults(mainSavedPanel)
      : null

  return {
    isMb: input.isMb,
    isFengYu: Boolean(input.isFengYu),
    mainBaseExternalPanel,
    // 词条库条目的「每档值」：不放这里就得在每个展示路径上各传一次，漏一处就分叉
    valuePerCount: input.valuePerCount,
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
      masterDataVersion,
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
      slotBuffSelections: input.slotBuffSelections,
      resolvedSlotBuffSelections: input.slotBuffSelections ? Object.fromEntries(input.teamSlots.flatMap((slot, index) =>
        slot.agentId ? [[index, resolveBuffSelectionForSlot(input.slotBuffSelections, index)]] : [])) : undefined,
      activeSlotPanels: input.activeSlotPanels,
      convertSlotPanels: input.convertSlotPanels,
      skillTalentLevelsByAgent: input.skillTalentLevelsByAgent,
      slotExternalPanels:
        input.slotExternalPanels ??
        Object.fromEntries(
          input.teamSlots.flatMap((slot, index) => {
            if (!slot.agentId) return []
            // 局外面板统一以「角色配置」为准（导入录入写入的 activeSlotPanels）；
            // 主 C 的候选词条叠加不在这里，见 computeExternalForEval。
            const saved = input.activeSlotPanels?.[slot.agentId]
            if (saved && !isPlaceholderExternalPanel(saved)) {
              return [[index, fillPanelStatsDefaults(saved)]]
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
                          // 词条数来自「词条导入」那份来源记录（老方案经 v4 迁移后同在一处）
                          affixCounts: {
                            ...createEmptyAffixCounts(),
                            ...input.mainAffixCounts,
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
