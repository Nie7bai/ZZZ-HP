import type { AffixCounts } from '@/types/calculatorPanel'
import {
  entryRollsToAffixCounts,
  entryRollsToPanelDeltas,
  type AffixLibraryEntry,
} from '@/utils/affixLibrary'
import {
  evaluateAffixCounts,
  type AffixPanelDeltaMap,
  type OptimalEvalContext,
} from '@/utils/optimalAffixAlloc'

/**
 * 全词条收益分析（词条功能改造 · 阶段 1）
 *
 * 与现有 `computeDiffAnalysis`（optimalAffixAlloc.ts）的区别：
 * - 候选池来自词条库（含自定义条目），不再按直伤/异常分两套；
 * - 目标统一为「流程全部事件加总」的总伤，不再按伤害类型取分量；
 * - 输出相对权重列，便于横向比较词条价值。
 *
 * 复用 `evaluateAffixCounts` 的缓存与上下文，不重复实现公式。
 */

export interface AffixBenefitRow {
  entryId: string
  label: string
  /** 当前已投入档数（按当前分配回填） */
  currentRolls: number
  /** 每档增量 */
  perRoll: number
  /** 再 +1 档的总伤增量 */
  damageDelta: number
  /** 再 +1 档的收益率（%） */
  percentDelta: number
  /** 相对权重 = 本行收益率 / 最大收益率，0~1 */
  weight: number
  /** 是否因上限（cap 或主词条约束）不可再加 */
  capped: boolean
  /** 上限提示 */
  note?: string
}

export interface AffixBenefitSeries {
  entryId: string
  /** 图表组件的系列 key */
  key: string
  label: string
  color: string
  /** 逐档累计收益率（%），索引 = 档数，[0] = 0 */
  cumulativePercent: number[]
  /** 逐档边际收益率（%） */
  marginalPercent: number[]
  /** 该档是否已因上限不可再加（曲线图用） */
  cappedAt: boolean[]
}

export interface AffixBenefitTable {
  /** 基线总伤（当前分配） */
  baselineDamage: number
  rows: AffixBenefitRow[]
  /** 本次分析实际评估的条目数 */
  evaluatedCount: number
  /** 逐档收益曲线（用于折线图），按最大收益率取前 N 条 */
  series: AffixBenefitSeries[]
}

export interface AffixBenefitInput {
  ctx: OptimalEvalContext
  /** 当前副词条分配 */
  baseCounts: AffixCounts
  /** 当前自定义条目的面板增量 */
  basePanelDeltas?: AffixPanelDeltaMap
  /** 参与分析的词条库条目 */
  entries: AffixLibraryEntry[]
  /** 每档增量（>1 时按 N 档一起评估，用于「看 +4 档收益」） */
  rollsPerStep?: number
  /** 曲线最多画多少档 */
  maxCurveRolls?: number
  /** 曲线最多画多少条（按 +1 档收益率降序） */
  maxCurveSeries?: number
}

/** 目标口径：流程全部事件加总（有 hits 走事件，无 hits 回落到面板口径总伤） */
function metricOf(evaluated: { grandTotal: number }): number {
  return evaluated.grandTotal
}

/** 曲线配色，与扫掠柱图/曲线图保持一致的观感 */
const CURVE_COLORS = [
  '#bfff09', '#7dd3a0', '#6eb6ff', '#e6c07b', '#c678dd',
  '#f07178', '#56b6c2', '#abb2bf',
]

/**
 * 计算全词条收益表。
 *
 * 每个条目单独 +N 档重算一次，与 zzz-dev 的收益表同口径；
 * 不做联合枚举（那是求解器的职责），因此互斥组条目之间互不影响。
 *
 * 同时产出逐档收益曲线（每档真实调引擎），供折线图使用。
 */
export function computeAffixBenefitTable(input: AffixBenefitInput): AffixBenefitTable {
  const { ctx, baseCounts, entries } = input
  const step = Math.max(1, Math.round(input.rollsPerStep ?? 1))
  const basePanelDeltas = input.basePanelDeltas

  const baseEval = evaluateAffixCounts(ctx, baseCounts, basePanelDeltas)
  const baselineDamage = metricOf(baseEval)

  const rows: AffixBenefitRow[] = []
  for (const entry of entries) {
    const nextCounts = bumpEntryCounts(baseCounts, entry, step)
    const nextDeltas = bumpEntryPanelDeltas(basePanelDeltas, entry, step)
    const evaluated = evaluateAffixCounts(ctx, nextCounts, nextDeltas)
    const damageDelta = metricOf(evaluated) - baselineDamage
    const percentDelta = baselineDamage > 0 ? (damageDelta / baselineDamage) * 100 : 0
    rows.push({
      entryId: entry.id,
      label: entry.label,
      currentRolls: currentRollsOf(baseCounts, basePanelDeltas, entry),
      perRoll: entry.perRoll,
      damageDelta,
      percentDelta,
      weight: 0,
      capped: false,
    })
  }

  const maxPercent = rows.reduce((max, row) => Math.max(max, row.percentDelta), 0)
  for (const row of rows) {
    row.weight = maxPercent > 0 ? row.percentDelta / maxPercent : 0
  }
  rows.sort((a, b) => b.percentDelta - a.percentDelta)

  const series = computeAffixBenefitSeries({
    ctx,
    baseCounts,
    basePanelDeltas,
    entries,
    baselineDamage,
    rankedRows: rows,
    maxCurveRolls: Math.max(2, Math.round(input.maxCurveRolls ?? 10)),
    maxCurveSeries: Math.max(1, Math.round(input.maxCurveSeries ?? 6)),
  })

  return { baselineDamage, rows, evaluatedCount: entries.length, series }
}

/**
 * 逐档收益曲线：对收益最高的若干条目，逐档累加并真实重算。
 * 第 0 档为基线（0%），第 n 档为「该条目累计 n 档」相对基线的收益率。
 */
function computeAffixBenefitSeries(input: {
  ctx: OptimalEvalContext
  baseCounts: AffixCounts
  basePanelDeltas?: AffixPanelDeltaMap
  entries: AffixLibraryEntry[]
  baselineDamage: number
  rankedRows: AffixBenefitRow[]
  maxCurveRolls: number
  maxCurveSeries: number
}): AffixBenefitSeries[] {
  const { ctx, baseCounts, basePanelDeltas, baselineDamage, rankedRows } = input
  if (baselineDamage <= 0) return []
  const entryById = new Map(input.entries.map((entry) => [entry.id, entry]))
  const picked = rankedRows.slice(0, input.maxCurveSeries)
  const series: AffixBenefitSeries[] = []

  picked.forEach((row, index) => {
    const entry = entryById.get(row.entryId)
    if (!entry) return
    const cumulativePercent: number[] = [0]
    const marginalPercent: number[] = [0]
    let prevDamage = baselineDamage
    for (let n = 1; n <= input.maxCurveRolls; n += 1) {
      const counts = bumpEntryCounts(baseCounts, entry, n)
      const deltas = bumpEntryPanelDeltas(basePanelDeltas, entry, n)
      const evaluated = evaluateAffixCounts(ctx, counts, deltas)
      const damage = metricOf(evaluated)
      cumulativePercent.push(((damage - baselineDamage) / baselineDamage) * 100)
      marginalPercent.push(prevDamage > 0 ? ((damage - prevDamage) / prevDamage) * 100 : 0)
      prevDamage = damage
    }
    series.push({
      entryId: entry.id,
      key: entry.id,
      label: entry.label,
      color: CURVE_COLORS[index % CURVE_COLORS.length]!,
      cumulativePercent,
      marginalPercent,
      cappedAt: cumulativePercent.map(() => false),
    })
  })

  return series
}

function bumpEntryCounts(
  counts: AffixCounts,
  entry: AffixLibraryEntry,
  step: number,
): AffixCounts {
  const key = entry.affixKey
  if (entry.kind !== 'substat' || !key) return counts
  const next = { ...counts }
  next[key] = (next[key] ?? 0) + step
  return next
}

function bumpEntryPanelDeltas(
  deltas: AffixPanelDeltaMap | undefined,
  entry: AffixLibraryEntry,
  step: number,
): AffixPanelDeltaMap | undefined {
  const field = entry.panelField
  if (entry.kind !== 'panelField' || !field) return deltas
  const next: AffixPanelDeltaMap = { ...(deltas ?? {}) }
  next[field] = (next[field] ?? 0) + step * entry.perRoll
  return next
}

function currentRollsOf(
  counts: AffixCounts,
  deltas: AffixPanelDeltaMap | undefined,
  entry: AffixLibraryEntry,
): number {
  if (entry.kind === 'substat') {
    return entry.affixKey ? (counts[entry.affixKey] ?? 0) : 0
  }
  const total = entry.panelField ? (deltas?.[entry.panelField] ?? 0) : 0
  return entry.perRoll > 0 ? total / entry.perRoll : 0
}

/** 把「条目档数表」换算成求解器可直接使用的 (counts, panelDeltas) */
export function rollsToEvalInput(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
  baseCounts: AffixCounts,
  basePanelDeltas?: AffixPanelDeltaMap,
): { counts: AffixCounts; panelDeltas: AffixPanelDeltaMap | undefined } {
  const substatRolls = entryRollsToAffixCounts(entries, rollsByEntryId)
  const counts = { ...baseCounts }
  for (const key of Object.keys(substatRolls) as (keyof AffixCounts)[]) {
    counts[key] = (counts[key] ?? 0) + (substatRolls[key] ?? 0)
  }
  const entryDeltas = entryRollsToPanelDeltas(entries, rollsByEntryId)
  const deltaKeys = Object.keys(entryDeltas) as (keyof typeof entryDeltas)[]
  if (!deltaKeys.length) return { counts, panelDeltas: basePanelDeltas }
  const panelDeltas: AffixPanelDeltaMap = { ...(basePanelDeltas ?? {}) }
  for (const key of deltaKeys) {
    panelDeltas[key] = (panelDeltas[key] ?? 0) + (entryDeltas[key] ?? 0)
  }
  return { counts, panelDeltas }
}
