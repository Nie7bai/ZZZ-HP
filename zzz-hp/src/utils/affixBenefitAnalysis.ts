import type { AffixCounts } from '@/types/calculatorPanel'
import {
  AFFIX_GAIN_SOURCE_ID_PREFIX,
  affixValuePerCountFromEntries,
  entryRollsToEvalInput,
  extraGainFromLibraryEntry,
  isGainTarget,
  panelFieldOfTarget,
  statKeyOfTarget,
  type AffixDeltaMap,
  type AffixLibraryEntry,
  type AffixLibraryEntryTarget,
} from '@/utils/affixLibrary'
import {
  evaluateAffixCounts,
  type AffixValuePerCount,
  type OptimalEvalContext,
} from '@/utils/optimalAffixAlloc'
import type { ExtraBuffGain } from '@/utils/extraBuffCalc'

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
  /** 条目落点（用于按字段单位格式化「每档」显示） */
  target: AffixLibraryEntryTarget
  /** 每档增量 */
  perRoll: number
  /** 再 +1 档的总伤增量 */
  damageDelta: number
  /** 再 +1 档的收益率（%） */
  percentDelta: number
  /** 相对权重 = 本行收益率 / 最大收益率，0~1（**整表**口径：分母是全表最大收益率） */
  weight: number
  /** 是否因上限不可再加。**预留字段：当前一律 `false`**（收益表暂不判上限） */
  capped: boolean
  /** 上限提示。**预留字段：当前不产出** */
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
  /** 该档是否已因上限不可再加（曲线图用）。**预留字段：当前全 `false`** */
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

/**
 * 相对权重：分母是**传入这组行**里的最大收益率（0~1）。
 *
 * 两处调用，区别只在分母范围：
 * - `computeAffixBenefitTable` 传全部行 → `row.weight`（整表口径的数据契约）；
 * - 收益表显示时传**当前显示的行**（筛选之后）→ 筛掉最高那条以后，显示出来的行里最强的仍然是 1.000。
 *   否则整列柱子会一起变短，看不出这批里谁强谁弱。
 *
 * 分母 ≤ 0（全为 0 或全为负）时一律 0：负收益率之间比大小没有意义，
 * 不这样做还会出现「越负越满格」。
 */
export function affixRelativeWeights(rows: { percentDelta: number }[]): number[] {
  const maxPercent = rows.reduce((max, row) => Math.max(max, row.percentDelta), 0)
  return rows.map((row) => (maxPercent > 0 ? row.percentDelta / maxPercent : 0))
}

export interface AffixBenefitInput {
  ctx: OptimalEvalContext
  /** 当前副词条分配 */
  baseCounts: AffixCounts
  /** 当前自定义条目的面板增量 */
  basePanelDeltas?: AffixDeltaMap
  /** 当前分配里已有的 `gain:` extraGains（不进扁平增量表） */
  baseExtraGains?: ExtraBuffGain[]
  /** 参与分析的词条库条目 */
  entries: AffixLibraryEntry[]
  /** 每档增量（>1 时按 N 档一起评估，用于「看 +4 档收益」） */
  rollsPerStep?: number
  /** 曲线最多画多少档 */
  maxCurveRolls?: number
  /** 曲线最多画多少条（按 +1 档收益率降序） */
  maxCurveSeries?: number
  /**
   * 是否同时算逐档收益曲线（默认 true）。
   *
   * 为什么可以关掉：曲线只服务「收益曲线」折线图，而该图在分配模式下要等求解
   * 完成后才渲染（`v-if="affixAllocResult"`）。而曲线占整个收益表评估量的
   * **85%**（实测 42 招式流程：71 次评估里 60 次是曲线），首屏却完全用不到。
   * 传 false 时 `series` 返回空数组，需要时再调 `computeAffixBenefitSeries()` 补算。
   */
  includeSeries?: boolean
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
  const baseExtraGains = input.baseExtraGains
  // 每档值以词条库条目为准（合并后副词条也读 entry.perRoll）
  const valuePerCount = affixValuePerCountFromEntries(entries)

  const baseEval = evaluateAffixCounts(
    ctx,
    baseCounts,
    basePanelDeltas,
    valuePerCount,
    baseExtraGains,
  )
  const baselineDamage = metricOf(baseEval)

  const rows: AffixBenefitRow[] = []
  for (const entry of entries) {
    const nextCounts = bumpEntryCounts(baseCounts, entry, step)
    const nextDeltas = bumpEntryDeltas(basePanelDeltas, entry, step)
    const nextGains = bumpEntryExtraGains(baseExtraGains, entry, step)
    const evaluated = evaluateAffixCounts(
      ctx,
      nextCounts,
      nextDeltas,
      valuePerCount,
      nextGains,
    )
    const damageDelta = metricOf(evaluated) - baselineDamage
    const percentDelta = baselineDamage > 0 ? (damageDelta / baselineDamage) * 100 : 0
    rows.push({
      entryId: entry.id,
      label: entry.label,
      target: entry.target,
      perRoll: entry.perRoll,
      damageDelta,
      percentDelta,
      weight: 0,
      capped: false,
    })
  }

  // 整表口径的权重（显示层筛过之后会按「显示出来的行」再归一，见 affixRelativeWeights）
  const weights = affixRelativeWeights(rows)
  rows.forEach((row, index) => {
    row.weight = weights[index] ?? 0
  })
  rows.sort((a, b) => b.percentDelta - a.percentDelta)

  const series = input.includeSeries === false
    ? []
    : computeAffixBenefitSeries({
        ctx,
        baseCounts,
        basePanelDeltas,
        baseExtraGains,
        entries,
        baselineDamage,
        rankedRows: rows,
        maxCurveRolls: Math.max(2, Math.round(input.maxCurveRolls ?? 10)),
        maxCurveSeries: Math.max(1, Math.round(input.maxCurveSeries ?? 6)),
      })

  return { baselineDamage, rows, evaluatedCount: entries.length, series }
}

/**
 * 补算逐档收益曲线（`computeAffixBenefitTable({ includeSeries: false })` 之后调用）。
 *
 * 单独拆出来是为了让首屏只付「基线 + 逐条目 +1 档」的成本（约占 15%），
 * 把占 85% 的曲线留到用户真的要看折线图时再算。
 */
export function computeAffixBenefitSeriesForTable(
  input: AffixBenefitInput,
  table: Pick<AffixBenefitTable, 'baselineDamage' | 'rows'>,
): AffixBenefitSeries[] {
  return computeAffixBenefitSeries({
    ctx: input.ctx,
    baseCounts: input.baseCounts,
    basePanelDeltas: input.basePanelDeltas,
    baseExtraGains: input.baseExtraGains,
    entries: input.entries,
    baselineDamage: table.baselineDamage,
    rankedRows: table.rows,
    maxCurveRolls: Math.max(2, Math.round(input.maxCurveRolls ?? 10)),
    maxCurveSeries: Math.max(1, Math.round(input.maxCurveSeries ?? 6)),
  })
}

/**
 * 逐档收益曲线：对收益最高的若干条目，逐档累加并真实重算。
 * 第 0 档为基线（0%），第 n 档为「该条目累计 n 档」相对基线的收益率。
 */
function computeAffixBenefitSeries(input: {
  ctx: OptimalEvalContext
  baseCounts: AffixCounts
  basePanelDeltas?: AffixDeltaMap
  baseExtraGains?: ExtraBuffGain[]
  entries: AffixLibraryEntry[]
  baselineDamage: number
  rankedRows: AffixBenefitRow[]
  maxCurveRolls: number
  maxCurveSeries: number
}): AffixBenefitSeries[] {
  const { ctx, baseCounts, basePanelDeltas, baseExtraGains, baselineDamage, rankedRows } = input
  if (baselineDamage <= 0) return []
  const entryById = new Map(input.entries.map((entry) => [entry.id, entry]))
  const valuePerCount = affixValuePerCountFromEntries(input.entries)
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
      const deltas = bumpEntryDeltas(basePanelDeltas, entry, n)
      const gains = bumpEntryExtraGains(baseExtraGains, entry, n)
      const evaluated = evaluateAffixCounts(ctx, counts, deltas, valuePerCount, gains)
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
  _entry: AffixLibraryEntry,
  _step: number,
): AffixCounts {
  return counts
}

function bumpEntryDeltas(
  deltas: AffixDeltaMap | undefined,
  entry: AffixLibraryEntry,
  step: number,
): AffixDeltaMap | undefined {
  if (isGainTarget(entry.target)) return deltas
  const field = panelFieldOfTarget(entry.target) ?? statKeyOfTarget(entry.target)
  if (!field) return deltas
  const next: AffixDeltaMap = { ...(deltas ?? {}) }
  next[field] = (next[field] ?? 0) + step * entry.perRoll
  return next
}

function bumpEntryExtraGains(
  gains: ExtraBuffGain[] | undefined,
  entry: AffixLibraryEntry,
  step: number,
): ExtraBuffGain[] | undefined {
  const id = `${AFFIX_GAIN_SOURCE_ID_PREFIX}${entry.id}`
  const others = (gains ?? []).filter((gain) => gain.id !== id)
  const added = extraGainFromLibraryEntry(entry, step)
  if (!added) return others.length ? others : gains
  return [...others, added]
}

/** 把「条目档数表」换算成求解器可直接使用的 (counts, panelDeltas, extraGains, valuePerCount) */
export function rollsToEvalInput(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
  baseCounts: AffixCounts,
  basePanelDeltas?: AffixDeltaMap,
  baseExtraGains?: ExtraBuffGain[],
): {
  counts: AffixCounts
  panelDeltas: AffixDeltaMap | undefined
  extraGains: ExtraBuffGain[] | undefined
  valuePerCount: AffixValuePerCount
} {
  const input = entryRollsToEvalInput(entries, rollsByEntryId)
  const counts = { ...baseCounts }
  for (const key of Object.keys(input.counts) as (keyof AffixCounts)[]) {
    counts[key] = (counts[key] ?? 0) + (input.counts[key] ?? 0)
  }
  const extraGains = mergeExtraGains(baseExtraGains, input.extraGains)
  const deltaKeys = Object.keys(input.deltas) as (keyof typeof input.deltas)[]
  if (!deltaKeys.length) {
    return {
      counts,
      panelDeltas: basePanelDeltas,
      extraGains,
      valuePerCount: input.valuePerCount,
    }
  }
  const panelDeltas: AffixDeltaMap = { ...(basePanelDeltas ?? {}) }
  for (const key of deltaKeys) {
    panelDeltas[key] = (panelDeltas[key] ?? 0) + (input.deltas[key] ?? 0)
  }
  return { counts, panelDeltas, extraGains, valuePerCount: input.valuePerCount }
}

function mergeExtraGains(
  base: ExtraBuffGain[] | undefined,
  added: ExtraBuffGain[],
): ExtraBuffGain[] | undefined {
  if (!added.length) return base?.length ? base : undefined
  if (!base?.length) return added
  const byId = new Map(base.map((gain) => [gain.id, gain]))
  for (const gain of added) byId.set(gain.id, gain)
  return [...byId.values()]
}
