import type { AffixCounts } from '@/types/calculatorPanel'
import {
  entryRollsToAffixCounts,
  entryRollsToPanelDeltas,
  type AffixLibraryEntry,
} from '@/utils/affixLibrary'
import {
  affixRollCap,
  evaluateAffixCounts,
  type AffixPanelDeltaMap,
  type OptimalEvalContext,
} from '@/utils/optimalAffixAlloc'

/**
 * 最优词条分配求解器（独立功能）
 *
 * 目标：在「总词条数」预算内，给出使「流程总伤」最大的词条分配。
 *
 * 预算口径（与「词条计算」页的双预算规则**无关**）：
 * - 总词条数是唯一预算，每条词条 1 档 = 1 个词条，不分大小词条。
 * - 主词条上限（36 − 6×同类主词条数）与互斥组仍作为单条上限生效。
 *
 * 搜索策略（每一步都用真实引擎评估，不做可分性假设）：
 * 1. **多起点贪心**：若干候选优先序各跑一遍，避免单一顺序的结构性偏差。
 * 2. **1-swap 局部搜索**：撤一档 + 加一档，只接受净提升。
 * 3. **2-swap 局部搜索**：撤两档 + 加两档，跳出 1-swap 局部最优
 *    （典型：攻击% 与固定攻击需同时增减才提升）。
 *
 * 为什么不照搬 zzz-dev 的对数 DP：
 * 伤害公式是「和之积」（Σ 在 Π 外），各词条收益不可乘；攻击%/固定攻击、
 * 暴击率/爆伤、防御三件套之间存在乘积或交叉项，分开 DP 会系统性偏差。
 * 本实现不做上述假设，因此没有该偏差；调用次数由 `maxEngineCalls` 兜底。
 */

export interface AffixOptimizerBudget {
  /** 总词条数上限（唯一预算） */
  maxTotalRolls: number
  /** 主词条档数上限（36 − 6×同类主词条数） */
  rollCapOf: (entry: AffixLibraryEntry) => number
}

export interface AffixOptimizerInput {
  ctx: OptimalEvalContext
  entries: AffixLibraryEntry[]
  /** 固定投入的档数（不参与优化，但计入预算与基线） */
  fixedRollsByEntryId?: Record<string, number>
  /** 总词条数上限；不传则用默认 46 */
  maxTotalRolls?: number
  /** 引擎调用上限，防止极端词条库卡死 UI */
  maxEngineCalls?: number
  /** 允许单条最大档数（默认按 cap 与预算推） */
  maxRollsPerEntry?: number
  /** 多起点贪心的起点数（1~3，默认 3） */
  maxStarts?: number
}

export interface AffixOptimizerResult {
  /** 最优分配：条目 id → 档数 */
  rollsByEntryId: Record<string, number>
  counts: AffixCounts
  panelDeltas: AffixPanelDeltaMap | undefined
  totalDamage: number
  baselineDamage: number
  improvementPercent: number
  /** 已用总词条数 */
  usedRolls: number
  /** 总词条数上限 */
  maxTotalRolls: number
  engineCalls: number
  truncated: boolean
}

const DEFAULT_MAX_TOTAL_ROLLS = 46

function entryRolls(
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

function usedRollsOf(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): number {
  let rolls = 0
  for (const entry of entries) {
    const count = rollsByEntryId[entry.id] ?? 0
    if (count <= 0) continue
    rolls += count * entry.rollCost
  }
  return rolls
}

/** 互斥组占用：同组已选条目集合 */
function occupiedGroups(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): Set<string> {
  const occupied = new Set<string>()
  for (const entry of entries) {
    if (!entry.group) continue
    if ((rollsByEntryId[entry.id] ?? 0) > 0) occupied.add(entry.group)
  }
  return occupied
}

/** 该条目还能再加多少档（受 cap、主词条上限、总词条数、互斥组限制） */
function remainingAllowedRolls(
  entry: AffixLibraryEntry,
  current: number,
  budget: AffixOptimizerBudget,
  usedRolls: number,
  occupied: Set<string>,
  maxRollsPerEntry: number,
): number {
  const capLimit = entry.cap > 0 ? entry.cap : maxRollsPerEntry
  const rollCap = budget.rollCapOf(entry)
  const byCap = Math.max(
    0,
    Math.min(capLimit, Number.isFinite(rollCap) ? rollCap : capLimit) - current,
  )
  if (byCap <= 0) return 0
  if (entry.group && current === 0 && occupied.has(entry.group)) return 0
  const cost = Math.max(1, entry.rollCost)
  const rollRoom = Math.floor((budget.maxTotalRolls - usedRolls) / cost)
  return Math.max(0, Math.min(byCap, rollRoom))
}

export function resolveAffixOptimizerBudget(
  ctx: OptimalEvalContext,
  maxTotalRolls?: number,
): AffixOptimizerBudget {
  return {
    maxTotalRolls: maxTotalRolls ?? DEFAULT_MAX_TOTAL_ROLLS,
    rollCapOf: (entry) =>
      entry.kind === 'substat' && entry.affixKey
        ? affixRollCap(ctx.driveDiscMainStats, entry.affixKey)
        : Number.POSITIVE_INFINITY,
  }
}

type SolveState = {
  total: number
  counts: AffixCounts
  panelDeltas: AffixPanelDeltaMap | undefined
}

export function solveOptimalAffixAllocation(
  input: AffixOptimizerInput,
): AffixOptimizerResult {
  const { ctx, entries } = input
  const budget = resolveAffixOptimizerBudget(ctx, input.maxTotalRolls)
  const maxEngineCalls = input.maxEngineCalls ?? 4000
  const maxRollsPerEntry = input.maxRollsPerEntry ?? budget.maxTotalRolls
  const fixedRolls = input.fixedRollsByEntryId ?? {}
  const maxStarts = Math.max(1, Math.min(3, input.maxStarts ?? 3))

  const emptyCounts = {
    hpFlat: 0, hpPercent: 0, atkFlat: 0, atkPercent: 0, defFlat: 0,
    defPercent: 0, pen: 0, critRate: 0, critDmg: 0, mastery: 0,
  } as AffixCounts

  let engineCalls = 0
  let truncated = false

  const evaluate = (rollsByEntryId: Record<string, number>): SolveState => {
    const { counts, panelDeltas } = entryRolls(entries, rollsByEntryId, emptyCounts)
    engineCalls += 1
    const evaluated = evaluateAffixCounts(ctx, counts, panelDeltas)
    return { total: evaluated.grandTotal, counts, panelDeltas }
  }

  const baseline = evaluate({ ...fixedRolls })
  const baselineDamage = baseline.total

  // ---------- 1. 贪心构造 ----------
  const greedyBuild = (order: AffixLibraryEntry[]): { rolls: Record<string, number>; state: SolveState } => {
    const rolls: Record<string, number> = { ...fixedRolls }
    let current: SolveState = {
      total: baselineDamage, counts: baseline.counts, panelDeltas: baseline.panelDeltas,
    }
    let used = usedRollsOf(entries, rolls)

    for (;;) {
      if (engineCalls >= maxEngineCalls) { truncated = true; break }
      const occupied = occupiedGroups(entries, rolls)
      let bestEntryId: string | null = null
      let bestTotal = current.total
      let bestEval: SolveState | null = null

      for (const entry of order) {
        if (engineCalls >= maxEngineCalls) { truncated = true; break }
        const currentRolls = rolls[entry.id] ?? 0
        if (remainingAllowedRolls(entry, currentRolls, budget, used, occupied, maxRollsPerEntry) <= 0) continue
        const evaluated = evaluate({ ...rolls, [entry.id]: currentRolls + 1 })
        if (evaluated.total > bestTotal) {
          bestTotal = evaluated.total
          bestEntryId = entry.id
          bestEval = evaluated
        }
      }

      if (!bestEntryId || !bestEval) break
      rolls[bestEntryId] = (rolls[bestEntryId] ?? 0) + 1
      current = bestEval
      used = usedRollsOf(entries, rolls)
    }
    return { rolls, state: current }
  }

  // ---------- 2. 1-swap 局部搜索 ----------
  const localSearch1Swap = (rolls: Record<string, number>, start: SolveState): SolveState => {
    let current = start
    for (;;) {
      if (engineCalls >= maxEngineCalls) { truncated = true; break }
      let bestSwap: { removeId: string; addId: string; state: SolveState } | null = null

      for (const removeEntry of entries) {
        const removeRolls = rolls[removeEntry.id] ?? 0
        if (removeRolls <= 0) continue
        if ((fixedRolls[removeEntry.id] ?? 0) >= removeRolls) continue
        const afterRemove = { ...rolls, [removeEntry.id]: removeRolls - 1 }
        const usedAfter = usedRollsOf(entries, afterRemove)
        const occupiedAfter = occupiedGroups(entries, afterRemove)

        for (const addEntry of entries) {
          if (engineCalls >= maxEngineCalls) { truncated = true; break }
          if (addEntry.id === removeEntry.id) continue
          const addRolls = afterRemove[addEntry.id] ?? 0
          if (remainingAllowedRolls(addEntry, addRolls, budget, usedAfter, occupiedAfter, maxRollsPerEntry) <= 0) continue
          const evaluated = evaluate({ ...afterRemove, [addEntry.id]: addRolls + 1 })
          if (evaluated.total > current.total &&
              (!bestSwap || evaluated.total > bestSwap.state.total)) {
            bestSwap = { removeId: removeEntry.id, addId: addEntry.id, state: evaluated }
          }
        }
      }

      if (!bestSwap) break
      const removed = (rolls[bestSwap.removeId] ?? 0) - 1
      if (removed <= 0) delete rolls[bestSwap.removeId]
      else rolls[bestSwap.removeId] = removed
      rolls[bestSwap.addId] = (rolls[bestSwap.addId] ?? 0) + 1
      current = bestSwap.state
    }
    return current
  }

  // ---------- 3. 2-swap 局部搜索 ----------
  const localSearch2Swap = (rolls: Record<string, number>, start: SolveState): SolveState => {
    let current = start
    for (;;) {
      if (engineCalls >= maxEngineCalls) { truncated = true; break }
      let bestSwap: { next: Record<string, number>; state: SolveState } | null = null

      // 撤两档：同条目撤 2 档，或两条目各撤 1 档
      const removals: { rolls: Record<string, number>; usedRolls: number }[] = []
      for (let i = 0; i < entries.length; i += 1) {
        const a = entries[i]!
        const aRolls = rolls[a.id] ?? 0
        const aFixed = fixedRolls[a.id] ?? 0
        if (aRolls - 2 >= aFixed) {
          const next = { ...rolls, [a.id]: aRolls - 2 }
          removals.push({ rolls: next, usedRolls: usedRollsOf(entries, next) })
        }
        for (let j = i + 1; j < entries.length; j += 1) {
          const b = entries[j]!
          const bRolls = rolls[b.id] ?? 0
          const bFixed = fixedRolls[b.id] ?? 0
          if (aRolls - 1 < aFixed || bRolls - 1 < bFixed) continue
          const next = { ...rolls, [a.id]: aRolls - 1, [b.id]: bRolls - 1 }
          removals.push({ rolls: next, usedRolls: usedRollsOf(entries, next) })
        }
      }

      for (const removal of removals) {
        if (engineCalls >= maxEngineCalls) { truncated = true; break }
        const occupiedAfter = occupiedGroups(entries, removal.rolls)
        for (let i = 0; i < entries.length; i += 1) {
          const a = entries[i]!
          const aRolls = removal.rolls[a.id] ?? 0
          if (remainingAllowedRolls(a, aRolls, budget, removal.usedRolls, occupiedAfter, maxRollsPerEntry) <= 0) continue
          const afterAddA = { ...removal.rolls, [a.id]: aRolls + 1 }
          const usedA = usedRollsOf(entries, afterAddA)

          for (let j = i; j < entries.length; j += 1) {
            if (engineCalls >= maxEngineCalls) { truncated = true; break }
            const b = entries[j]!
            const bRolls = afterAddA[b.id] ?? 0
            if (remainingAllowedRolls(b, bRolls, budget, usedA, occupiedAfter, maxRollsPerEntry) <= 0) continue
            const candidate = { ...afterAddA, [b.id]: bRolls + 1 }
            const evaluated = evaluate(candidate)
            if (evaluated.total > current.total &&
                (!bestSwap || evaluated.total > bestSwap.state.total)) {
              bestSwap = { next: candidate, state: evaluated }
            }
          }
        }
      }

      if (!bestSwap) break
      for (const key of Object.keys(rolls)) delete rolls[key]
      Object.assign(rolls, bestSwap.next)
      current = bestSwap.state
    }
    return current
  }

  // ---------- 4. 多起点主循环 ----------
  const singleGain = new Map<string, number>()
  const measureGain = (entry: AffixLibraryEntry) => {
    const cached = singleGain.get(entry.id)
    if (cached != null) return cached
    if (engineCalls >= maxEngineCalls) return 0
    const currentRolls = fixedRolls[entry.id] ?? 0
    const evaluated = evaluate({ ...fixedRolls, [entry.id]: currentRolls + 1 })
    const gain = evaluated.total - baselineDamage
    singleGain.set(entry.id, gain)
    return gain
  }

  const orders: AffixLibraryEntry[][] = [entries]
  if (maxStarts >= 2) orders.push([...entries].sort((a, b) => measureGain(b) - measureGain(a)))
  if (maxStarts >= 3) orders.push([...entries].sort((a, b) => measureGain(a) - measureGain(b)))

  let bestRolls: Record<string, number> | null = null
  let bestState: SolveState | null = null

  for (const order of orders) {
    if (engineCalls >= maxEngineCalls) { truncated = true; break }
    const built = greedyBuild(order)
    const refined1 = localSearch1Swap(built.rolls, built.state)
    const refined2 = localSearch2Swap(built.rolls, refined1)
    if (!bestState || refined2.total > bestState.total) {
      bestState = refined2
      bestRolls = { ...built.rolls }
    }
  }

  const rollsByEntryId = bestRolls ?? { ...fixedRolls }
  const finalState: SolveState = bestState ?? {
    total: baselineDamage,
    counts: baseline.counts,
    panelDeltas: baseline.panelDeltas,
  }

  const improvementPercent = baselineDamage > 0
    ? ((finalState.total - baselineDamage) / baselineDamage) * 100
    : 0

  return {
    rollsByEntryId,
    counts: finalState.counts,
    panelDeltas: finalState.panelDeltas,
    totalDamage: finalState.total,
    baselineDamage,
    improvementPercent,
    usedRolls: usedRollsOf(entries, rollsByEntryId),
    maxTotalRolls: budget.maxTotalRolls,
    engineCalls,
    truncated,
  }
}

/** 把求解结果整理成展示行（按档数降序） */
export function buildAllocationRows(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): { entry: AffixLibraryEntry; rolls: number; totalValue: number }[] {
  const rows: { entry: AffixLibraryEntry; rolls: number; totalValue: number }[] = []
  for (const entry of entries) {
    const rolls = rollsByEntryId[entry.id] ?? 0
    if (rolls <= 0) continue
    rows.push({ entry, rolls, totalValue: rolls * entry.perRoll })
  }
  rows.sort((a, b) => b.rolls - a.rolls || a.entry.label.localeCompare(b.entry.label, 'zh'))
  return rows
}
