import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  BuffStatModifiers,
  DriveDiscBuffDoc,
  WengineBuffDoc,
} from '@/types/calculator'
import type { AffixCounts, AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'
import { createEmptyAffixCounts } from '@/types/calculatorPanel'
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
import { computeFinalPanel, type PanelCalcContext } from '@/utils/panelBuffCalc'

export type OptimalDamageKind = 'direct' | 'anomaly'

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
  /** 攻击力或生命值（命破）条数 */
  flatStat: number
  pen: number
  critRate: number
  /** = 暴击 + 爆伤 + 局外大攻/大生命 */
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
  baseDamageSource: 'atk' | 'pierce'
  mainAgentElement: string
  mainAgentId: string
  mainAgentName: string
}

export interface DirectSweepPoint {
  outPercent: number
  critDmg: number
  label: string
  affixCounts: AffixCounts
  result: DamageCalcResult
  directExpected: number
}

export interface AnomalySweepPoint {
  outPercent: number
  mastery: number
  label: string
  affixCounts: AffixCounts
  result: DamageCalcResult
  anomalyExpected: number
  disorderExpected: number
  turbulenceExpected: number
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
  const flat = clampInt(state.flatStat, 0, 99)
  const pen = clampInt(state.pen, 0, 99)
  const crit = clampInt(state.critRate, 0, DIRECT_CONSTRAINTS.maxTotalRolls)
  const total = clampInt(state.totalRolls, 0, DIRECT_CONSTRAINTS.maxTotalRolls)
  if (total < crit) return '总词条数不能小于暴击条数'
  if (total > DIRECT_CONSTRAINTS.maxTotalRolls) {
    return `总词条数不能超过 ${DIRECT_CONSTRAINTS.maxTotalRolls}`
  }
  if (flat + pen + total > DIRECT_CONSTRAINTS.maxAtkPenTotal) {
    return `${flatStatLabel(isMb)}+穿透+总词条数不能超过 ${DIRECT_CONSTRAINTS.maxAtkPenTotal}`
  }
  if (mainStats) {
    const caps = getAffixRollCaps(mainStats)
    if (crit > caps.critRate) {
      return `暴击条数不能超过主词条约束上限 ${caps.critRate}`
    }
    const remain = total - crit
    const outCap = isMb ? caps.hpPercent : caps.atkPercent
    const outName = outPercentLabel(isMb)
    if (remain > outCap + caps.critDmg) {
      return `${outName}+爆伤可分配余量 ${remain} 超出主词条约束上限（${outName}≤${outCap}，爆伤≤${caps.critDmg}）`
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
  const flatKey = flatStatKey(isMb)
  const percentKey = outPercentKey(isMb)
  counts[flatKey] = clampInt(state.flatStat, 0, 99)
  counts.pen = clampInt(state.pen, 0, 99)
  counts.critRate = clampInt(state.critRate, 0, 99)
  counts[percentKey] = clampInt(outPercent, 0, 99)
  counts.critDmg = clampInt(critDmg, 0, 99)
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

export function evaluateAffixCounts(
  ctx: OptimalEvalContext,
  affixCounts: AffixCounts,
  extraMods?: BuffStatModifiers,
): {
  finalPanel: PanelStats
  result: DamageCalcResult
  piercePower: number
  external: PanelStats
  breakdown: OptimalPanelBreakdown
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

  const breakdown = computeFinalPanel(external, {
    ...ctx.panelContext,
    extraMods: extraMods ?? ctx.panelContext.extraMods ?? createEmptyBuffStatModifiers(),
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

  return { finalPanel: breakdown.finalPanel, result, piercePower, external, breakdown }
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
  const remain = total - crit
  const outLabel = outPercentLabel(ctx.isMb)
  const caps = getAffixRollCaps(ctx.driveDiscMainStats)
  const outCap = ctx.isMb ? caps.hpPercent : caps.atkPercent
  const points: DirectSweepPoint[] = []

  for (let outPercent = 0; outPercent <= remain; outPercent += 1) {
    const critDmg = remain - outPercent
    if (outPercent > outCap || critDmg > caps.critDmg || crit > caps.critRate) continue
    const affixCounts = buildDirectAffixCounts(ctx.isMb, { ...state, critRate: crit, totalRolls: total }, outPercent, critDmg)
    const { result } = evaluateAffixCounts(ctx, affixCounts)
    points.push({
      outPercent,
      critDmg,
      label: `${outLabel}${outPercent}/爆伤${critDmg}`,
      affixCounts,
      result,
      directExpected: result.directDamageExpected,
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
    const { result } = evaluateAffixCounts(ctx, affixCounts)
    points.push({
      outPercent,
      mastery,
      label: `${outLabel}${outPercent}/精通${mastery}`,
      affixCounts,
      result,
      anomalyExpected: result.anomalyExpected,
      disorderExpected: result.disorderExpected,
      turbulenceExpected: result.turbulenceExpected,
    })
  }
  return points
}

function damageMetric(result: DamageCalcResult, kind: OptimalDamageKind, anomalyMetric: 'anomaly' | 'disorder' | 'turbulence' = 'anomaly') {
  if (kind === 'direct') return result.directDamageExpected
  if (anomalyMetric === 'disorder') return result.disorderExpected
  if (anomalyMetric === 'turbulence') return result.turbulenceExpected
  return result.anomalyExpected
}

export function directCandidateKeys(isMb: boolean): OptimalAffixKey[] {
  return [flatStatKey(isMb), outPercentKey(isMb), 'pen', 'critRate', 'critDmg']
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
  anomalyMetric: 'anomaly' | 'disorder' | 'turbulence' = 'anomaly',
): { addOne: AffixDiffRow[]; replace: AffixReplaceRow[] } {
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb) : anomalyCandidateKeys(ctx.isMb)
  const base = evaluateAffixCounts(ctx, baseCounts)
  const baseDmg = damageMetric(base.result, kind, anomalyMetric)
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
    const nextDmg = damageMetric(next.result, kind, anomalyMetric)
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
      const dmg = damageMetric(evaled.result, kind, anomalyMetric)
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

export function computeBenefitCurves(
  ctx: OptimalEvalContext,
  baseCounts: AffixCounts,
  kind: OptimalDamageKind,
  anomalyMetric: 'anomaly' | 'disorder' | 'turbulence' = 'anomaly',
  maxAdded = BENEFIT_CURVE_MAX_ADDED,
): { series: BenefitCurveSeries[]; nextStep: AffixDiffRow[] } {
  const candidates = kind === 'direct' ? directCandidateKeys(ctx.isMb) : anomalyCandidateKeys(ctx.isMb)
  const base = evaluateAffixCounts(ctx, baseCounts)
  const baseDmg = damageMetric(base.result, kind, anomalyMetric)
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
      const dmg = damageMetric(evaled.result, kind, anomalyMetric)
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
  baseDamageSource: 'atk' | 'pierce'
  extraMods?: BuffStatModifiers
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
      extraMods: input.extraMods,
    },
    enemyInput: input.enemyInput,
    baseDamageSource: input.baseDamageSource,
    mainAgentElement: mainAgent?.element ?? '',
    mainAgentId: mainAgent?.id ?? '',
    mainAgentName: mainAgent?.name ?? '',
  }
}
