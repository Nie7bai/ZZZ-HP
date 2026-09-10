import type { AffixCounts } from '@/types/calculatorPanel'
import {
  entryRollsToAffixCounts,
  entryRollsToPanelDeltas,
  type AffixLibraryEntry,
} from '@/utils/affixLibrary'
import {
  affixRollCap,
  evaluateAffixCountsWithCacheInfo,
  yieldToMain,
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
 *
 * ## 计算量预算（本次改造）
 *
 * 旧版按「引擎调用次数」兜底（4000 次），次数与流程贵贱无关，
 * 做不到「流程便宜就多搜、流程昂贵就少搜」。现改为按**计算量**记账：
 *
 * - 一次评估的计价 = `1 + 命中数`（实测拟合良好，见 `dev-docs/affix-optimizer-impl-log.md`）。
 * - 缓存命中只花真算约 1% 的时间，因此**不计入**计算量消耗。
 * - 每轮候选宽度 K 由当轮剩余预算反推（`auto` 模式），不再由常量决定。
 * - `manual` 模式下 K 由用户指定，**不设预算兜底**（用户口径：跑到底，中途可中止）。
 *
 * 记账本身的开销：计价在求解开始时读一次输入即可（求解期间流程固定），
 * 之后每次评估只多一次整数加法，相对单次 0.3ms 量级的引擎评估可忽略。
 */

/** 候选宽度（每轮参与试算的条目数）来源 */
export type AffixCandidateWidthMode = 'auto' | 'manual'

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
  /** 候选宽度模式（默认 auto：由剩余预算推导） */
  candidateWidthMode?: AffixCandidateWidthMode
  /** manual 模式下的每轮候选条数；会被钳到 [1, 词条条数] */
  manualCandidateWidth?: number
  /** 计算量预算（单位：命中-次），仅 auto 模式生效 */
  maxWorkUnits?: number
  /** 兼容旧调用：把调用次数上限换算成计算量预算 */
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
  /** 真实引擎评估次数（缓存命中不计入） */
  engineCalls: number
  /** 缓存命中次数（只花真算约 1% 的时间，不计入计算量） */
  cacheHits: number
  /** 已消耗计算量 */
  workUsed: number
  /** 计算量预算；manual 模式为 null，表示不设上限 */
  workBudget: number | null
  /** 本次搜索用到的最紧候选宽度（反映「剪枝可能漏解」的程度，越小越可能漏） */
  candidateWidth: number
  /** 本次搜索用到的最宽候选宽度 */
  candidateWidthMax: number
  candidateWidthMode: AffixCandidateWidthMode
  /** 是否因预算耗尽而提前停止（manual 模式恒为 false） */
  truncated: boolean
  /** 实际走完的阶段（供 UI 说明搜索结果停在哪一级） */
  phasesCompleted: string[]
  /** 本次搜索的起点数（候选集已覆盖全部条目时为 1，避免重复劳动） */
  startsRun: number
}

/** 求解进度快照（异步驱动定期回调，用于 UI 显示） */
export interface AffixOptimizerProgress {
  phase: 'baseline' | 'measure' | 'greedy' | 'swap1' | 'swap2' | 'done'
  /** 第几个起点（从 1 开始） */
  startIndex: number
  startCount: number
  engineCalls: number
  cacheHits: number
  workUsed: number
  workBudget: number | null
  bestTotal: number
  baselineDamage: number
}

export type AffixOptimizerAsyncOptions = {
  /** 每多少次评估让出主线程一次（默认 24） */
  chunkSize?: number
  /** 中止信号：改参数后应中止旧求解 */
  signal?: AbortSignal
  /** 进度回调（每次让出主线程前调用一次） */
  onProgress?: (progress: AffixOptimizerProgress) => void
}

const DEFAULT_MAX_TOTAL_ROLLS = 46

/**
 * 默认计算量预算。
 * 校准依据：旧版默认 `maxEngineCalls = 4000`，典型场景 8 命中（单次计价 9），
 * 即 4000 × 9 = 36000。取该值以保持「典型场景总工作量不变」。
 */
const DEFAULT_WORK_BUDGET = 36000

/** 单次评估的计价 = 1 + 命中数（实测 0/3/8/15/30 命中 ≈ 1 : 3.8 : 8.9 : 16 : 29.6） */
function workPricePerEval(ctx: OptimalEvalContext): number {
  return 1 + (ctx.hits?.length ?? 0)
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number.isFinite(value) ? value : min)
  return Math.max(min, Math.min(max, n))
}

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

interface SearchOutcome {
  rollsByEntryId: Record<string, number>
  state: SolveState
  baselineDamage: number
  engineCalls: number
  cacheHits: number
  workUsed: number
  workBudget: number | null
  truncated: boolean
  candidateWidth: number
  candidateWidthMax: number
  phasesCompleted: string[]
  startsRun: number
}

/** 候选集的排序口径（多起点用不同口径制造多样性） */
type CandidateOrder = 'gainDesc' | 'gainAsc' | 'declared'

/**
 * 搜索核心（生成器）。
 *
 * 每次引擎评估后 `yield` 一次进度快照，同步/异步两个驱动共用这一份实现，
 * 因此不存在「同步版与异步版算出不同结果」的可能。
 */
function* solveSearch(input: AffixOptimizerInput): Generator<AffixOptimizerProgress, SearchOutcome, void> {
  const { ctx, entries } = input
  const budget = resolveAffixOptimizerBudget(ctx, input.maxTotalRolls)
  const maxRollsPerEntry = input.maxRollsPerEntry ?? budget.maxTotalRolls
  const fixedRolls = input.fixedRollsByEntryId ?? {}
  const maxStarts = Math.max(1, Math.min(3, input.maxStarts ?? 3))
  const widthMode: AffixCandidateWidthMode = input.candidateWidthMode ?? 'auto'
  const entryCount = Math.max(1, entries.length)
  const manualWidth = clampInt(input.manualCandidateWidth ?? entryCount, 1, entryCount)
  const pricePerEval = workPricePerEval(ctx)

  // 计算量预算：manual 模式不设上限（用户口径：跑到底，中途可中止）
  const workBudget: number | null = widthMode === 'manual'
    ? null
    : input.maxWorkUnits ?? (input.maxEngineCalls != null
      ? input.maxEngineCalls * pricePerEval
      : DEFAULT_WORK_BUDGET)

  const emptyCounts = {
    hpFlat: 0, hpPercent: 0, atkFlat: 0, atkPercent: 0, defFlat: 0,
    defPercent: 0, pen: 0, critRate: 0, critDmg: 0, mastery: 0,
  } as AffixCounts

  let engineCalls = 0
  let cacheHits = 0
  let workUsed = 0
  let truncated = false
  let widthMinUsed = 0
  let widthMaxUsed = 0
  const phasesCompleted: string[] = []

  // 进度快照用的可变状态
  let phase: AffixOptimizerProgress['phase'] = 'baseline'
  let startIndex = 0
  let bestTotalSoFar = 0
  let baselineDamage = 0
  let startsRun = 0

  const snapshot = (): AffixOptimizerProgress => ({
    phase,
    startIndex,
    startCount: startsRun || maxStarts,
    engineCalls,
    cacheHits,
    workUsed,
    workBudget,
    bestTotal: bestTotalSoFar,
    baselineDamage,
  })

  const remainingWork = (): number =>
    workBudget == null ? Number.POSITIVE_INFINITY : workBudget - workUsed

  /** 真实评估一次（缓存命中不计入计算量） */
  const evaluate = (rollsByEntryId: Record<string, number>): SolveState => {
    const { counts, panelDeltas } = entryRolls(entries, rollsByEntryId, emptyCounts)
    const { value, cacheHit } = evaluateAffixCountsWithCacheInfo(ctx, counts, panelDeltas)
    if (cacheHit) {
      cacheHits += 1
    } else {
      engineCalls += 1
      workUsed += pricePerEval
    }
    return { total: value.grandTotal, counts, panelDeltas }
  }

  /**
   * 由剩余预算推导本轮候选宽度 K。
   *
   * - `linear`：一轮成本 ≈ 需要保留的撤法数 × K（贪心与 1-swap）
   * - `quadratic`：一轮成本 ≈ 撤法数 × K²/2（2-swap：撤两档 × 加两档）
   *
   * 每轮最多花掉剩余预算的一半，因此总额不会超支（几何衰减）。
   */
  const deriveWidth = (shape: 'linear' | 'quadratic', divisor: number): number => {
    let width: number
    if (widthMode === 'manual') {
      width = manualWidth
    } else {
      const budgetForRound = remainingWork() / 2
      if (!Number.isFinite(budgetForRound)) {
        width = entryCount
      } else {
        const affordableEvals = budgetForRound / pricePerEval
        const safeDivisor = Math.max(1, divisor)
        const raw = shape === 'linear'
          ? affordableEvals / safeDivisor
          : Math.sqrt((2 * affordableEvals) / safeDivisor)
        width = clampInt(raw, 1, entryCount)
      }
    }
    // 记录搜索期间实际用到的最紧 / 最宽宽度：最紧值才反映「剪枝可能漏解」的程度
    if (widthMinUsed === 0) {
      widthMinUsed = width
      widthMaxUsed = width
    } else {
      widthMinUsed = Math.min(widthMinUsed, width)
      widthMaxUsed = Math.max(widthMaxUsed, width)
    }
    return width
  }

  /** 条目 id → 最近一次测得的单档增益 */
  const lastGain = new Map<string, number>()

  /** 上一轮补测时已分配的档数；补测按「档数翻倍」放宽间隔，兼顾发现交叉项与浪费调用 */
  let refreshGateRolls = 0

  /**
   * 候选集：在「还能再加档」且「实测增益 > 0」的条目里，按指定口径排序取前 width 条。
   *
   * 两个过滤都是硬约束：
   * - 增益 ≤ 0：加它不涨分，不该占用引擎调用（如直伤角色加固定防御）。
   * - 已到上限：加了也不生效，同理由。
   *
   * 不做「已分配条目优先」的特殊照顾——那会让已分配条目挤占全部名额，
   * 使搜索再也加不进新条目（实测：手动 K=4 时总伤只有正确值的一半）。
   * 已分配条目本身仍参与排序，凭当前边际增益竞争名额。
   */
  const pickCandidates = (
    width: number,
    order: CandidateOrder,
    isAllowed: (entry: AffixLibraryEntry) => boolean,
  ): AffixLibraryEntry[] => {
    const gainOf = (entry: AffixLibraryEntry) => lastGain.get(entry.id) ?? 0
    const eligible = entries.filter(
      (entry) => gainOf(entry) > 0 && isAllowed(entry),
    )
    if (order === 'gainDesc') eligible.sort((a, b) => gainOf(b) - gainOf(a))
    else if (order === 'gainAsc') eligible.sort((a, b) => gainOf(a) - gainOf(b))
    return eligible.slice(0, Math.max(1, width))
  }

  // ---------- 0. 基线 ----------
  phase = 'baseline'
  const baseline = evaluate({ ...fixedRolls })
  baselineDamage = baseline.total
  bestTotalSoFar = baselineDamage
  yield snapshot()

  // ---------- 1. 单档增益测量（供候选排序与「零收益出局」） ----------
  phase = 'measure'

  function* measureEntry(
    entry: AffixLibraryEntry,
    baseRolls: Record<string, number>,
    referenceTotal: number,
  ): Generator<AffixOptimizerProgress, void, void> {
    const currentRolls = baseRolls[entry.id] ?? 0
    const evaluated = evaluate({ ...baseRolls, [entry.id]: currentRolls + 1 })
    lastGain.set(entry.id, evaluated.total - referenceTotal)
    yield snapshot()
  }

  for (const entry of entries) {
    yield* measureEntry(entry, fixedRolls, baselineDamage)
  }
  phasesCompleted.push('measure')

  /**
   * 零收益条目的补测。
   *
   * 必须**以当前分配为基准**补测（不是基线）：增益有交叉项，
   * 例如暴击率为 0 时爆伤增益为 0、暴击率堆起来后爆伤才有收益。
   * 若只按基线测一次，这类条目会被永久误杀。
   *
   * 触发条件（两个都满足才补测）：
   * 1. 正收益候选不够填满 width（说明有富余的试算名额）；
   * 2. 已分配档数 ≥ 上一次补测的门槛档数。
   *
   * 门槛按「档数翻倍」推进（0 → 1 → 2 → 4 → 8 …），所以整个构建过程
   * 只补测 O(log 总档数) 次，不会让零收益条目每轮都吃掉调用。
   */
  function* refreshStaleEntries(
    width: number,
    baseRolls: Record<string, number>,
    referenceTotal: number,
  ): Generator<AffixOptimizerProgress, void, void> {
    const usedRolls = usedRollsOf(entries, baseRolls)
    if (usedRolls < refreshGateRolls) return
    const stale = entries.filter(
      (entry) => (baseRolls[entry.id] ?? 0) === 0 && (lastGain.get(entry.id) ?? 0) <= 0,
    )
    if (!stale.length) {
      refreshGateRolls = Math.max(usedRolls + 1, usedRolls * 2)
      return
    }
    if (remainingWork() < stale.length * pricePerEval) return
    refreshGateRolls = Math.max(usedRolls + 1, usedRolls * 2)
    for (const entry of stale) {
      yield* measureEntry(entry, baseRolls, referenceTotal)
    }
  }

  // ---------- 2. 贪心构造 ----------
  phase = 'greedy'
  function* greedyBuild(
    order: CandidateOrder,
  ): Generator<AffixOptimizerProgress, { rolls: Record<string, number>; state: SolveState }, void> {
    const rolls: Record<string, number> = { ...fixedRolls }
    let current: SolveState = {
      total: baselineDamage, counts: baseline.counts, panelDeltas: baseline.panelDeltas,
    }
    let used = usedRollsOf(entries, rolls)

    for (;;) {
      const width = deriveWidth('linear', 1)
      const occupied = occupiedGroups(entries, rolls)
      const allowedHere = (entry: AffixLibraryEntry) =>
        remainingAllowedRolls(
          entry,
          rolls[entry.id] ?? 0,
          budget,
          used,
          occupied,
          maxRollsPerEntry,
        ) > 0
      let candidates = pickCandidates(width, order, allowedHere)
      // 候选不足就补测零收益条目（补测门槛按档数翻倍推进，不会无限循环）
      if (candidates.length < width) {
        yield* refreshStaleEntries(width, rolls, current.total)
        candidates = pickCandidates(width, order, allowedHere)
      }
      if (!candidates.length) break
      // 做不完就不开这一轮：预算不足直接停在这一步，不产生半成品
      if (remainingWork() < candidates.length * pricePerEval) {
        truncated = true
        break
      }
      let bestEntryId: string | null = null
      let bestTotal = current.total
      let bestEval: SolveState | null = null

      for (const entry of candidates) {
        const currentRolls = rolls[entry.id] ?? 0
        const evaluated = evaluate({ ...rolls, [entry.id]: currentRolls + 1 })
        lastGain.set(entry.id, evaluated.total - current.total)
        yield snapshot()
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
      if (current.total > bestTotalSoFar) bestTotalSoFar = current.total
    }
    return { rolls, state: current }
  }

  // ---------- 3. 1-swap 局部搜索 ----------
  phase = 'swap1'
  function* localSearch1Swap(
    rolls: Record<string, number>,
    start: SolveState,
    order: CandidateOrder,
  ): Generator<AffixOptimizerProgress, SolveState, void> {
    let current = start
    for (;;) {
      const removals = entries.filter((entry) => {
        const removeRolls = rolls[entry.id] ?? 0
        return removeRolls > 0 && (fixedRolls[entry.id] ?? 0) < removeRolls
      })
      if (!removals.length) break
      const width = deriveWidth('linear', removals.length)
      // 做不完就不开这一轮
      if (remainingWork() < removals.length * width * pricePerEval) {
        truncated = true
        break
      }
      let bestSwap: { removeId: string; addId: string; state: SolveState } | null = null

      for (const removeEntry of removals) {
        const removeRolls = rolls[removeEntry.id] ?? 0
        const afterRemove = { ...rolls, [removeEntry.id]: removeRolls - 1 }
        const usedAfter = usedRollsOf(entries, afterRemove)
        const occupiedAfter = occupiedGroups(entries, afterRemove)
        const candidates = pickCandidates(
          width,
          order,
          (entry) =>
            remainingAllowedRolls(
              entry,
              afterRemove[entry.id] ?? 0,
              budget,
              usedAfter,
              occupiedAfter,
              maxRollsPerEntry,
            ) > 0,
        )

        for (const addEntry of candidates) {
          if (addEntry.id === removeEntry.id) continue
          const addRolls = afterRemove[addEntry.id] ?? 0
          const evaluated = evaluate({ ...afterRemove, [addEntry.id]: addRolls + 1 })
          yield snapshot()
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
      if (current.total > bestTotalSoFar) bestTotalSoFar = current.total
    }
    return current
  }

  // ---------- 4. 2-swap 局部搜索 ----------
  phase = 'swap2'
  function* localSearch2Swap(
    rolls: Record<string, number>,
    start: SolveState,
    order: CandidateOrder,
  ): Generator<AffixOptimizerProgress, SolveState, void> {
    let current = start
    for (;;) {
      // 撤法只从「已分配档数的条目」里出（活跃集）：没分到档数的条目无从撤起，
      // 这正是把旧的 O(E⁴) 降到「活跃集²」的关键
      const active = entries.filter((entry) => (rolls[entry.id] ?? 0) > 0)
      if (!active.length) break
      const removalCount = Math.max(1, (active.length * (active.length + 1)) / 2)
      const width = deriveWidth('quadratic', removalCount)
      // 做不完就不开这一轮：宁可停在上一级完成的结果，也不给半成品
      if (remainingWork() < removalCount * width * width * pricePerEval) {
        truncated = true
        break
      }

      const removals: { rolls: Record<string, number>; usedRolls: number }[] = []
      for (let i = 0; i < active.length; i += 1) {
        const a = active[i]!
        const aRolls = rolls[a.id] ?? 0
        const aFixed = fixedRolls[a.id] ?? 0
        if (aRolls - 2 >= aFixed) {
          const next = { ...rolls, [a.id]: aRolls - 2 }
          removals.push({ rolls: next, usedRolls: usedRollsOf(entries, next) })
        }
        for (let j = i + 1; j < active.length; j += 1) {
          const b = active[j]!
          const bRolls = rolls[b.id] ?? 0
          const bFixed = fixedRolls[b.id] ?? 0
          if (aRolls - 1 < aFixed || bRolls - 1 < bFixed) continue
          const next = { ...rolls, [a.id]: aRolls - 1, [b.id]: bRolls - 1 }
          removals.push({ rolls: next, usedRolls: usedRollsOf(entries, next) })
        }
      }

      let bestSwap: { next: Record<string, number>; state: SolveState } | null = null

      for (const removal of removals) {
        const occupiedAfter = occupiedGroups(entries, removal.rolls)
        const candidates = pickCandidates(
          width,
          order,
          (entry) =>
            remainingAllowedRolls(
              entry,
              removal.rolls[entry.id] ?? 0,
              budget,
              removal.usedRolls,
              occupiedAfter,
              maxRollsPerEntry,
            ) > 0,
        )
        for (let i = 0; i < candidates.length; i += 1) {
          const a = candidates[i]!
          const aRolls = removal.rolls[a.id] ?? 0
          const afterAddA = { ...removal.rolls, [a.id]: aRolls + 1 }
          const usedA = usedRollsOf(entries, afterAddA)

          for (let j = i; j < candidates.length; j += 1) {
            const b = candidates[j]!
            const bRolls = afterAddA[b.id] ?? 0
            if (remainingAllowedRolls(b, bRolls, budget, usedA, occupiedAfter, maxRollsPerEntry) <= 0) continue
            const candidate = { ...afterAddA, [b.id]: bRolls + 1 }
            const evaluated = evaluate(candidate)
            yield snapshot()
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
      if (current.total > bestTotalSoFar) bestTotalSoFar = current.total
    }
    return current
  }

  // ---------- 5. 多起点主循环 ----------
  /**
   * 候选集已覆盖全部条目时，多起点之间没有差异（贪心每轮取最优，与顺序无关），
   * 此时只跑 1 个起点，避免 3 倍重复劳动。
   */
  const widthCoversAll = widthMode === 'manual'
    ? manualWidth >= entries.length
    : (workBudget ?? 0) / 2 / pricePerEval >= entries.length
  const orders: CandidateOrder[] = widthCoversAll
    ? ['gainDesc']
    : (['gainDesc', 'gainAsc', 'declared'] as CandidateOrder[]).slice(0, maxStarts)
  startsRun = orders.length

  let bestRolls: Record<string, number> | null = null
  let bestState: SolveState | null = null

  for (let i = 0; i < orders.length; i += 1) {
    startIndex = i + 1
    if (remainingWork() <= 0) { truncated = true; break }
    const built = yield* greedyBuild(orders[i]!)
    phasesCompleted.push('greedy')
    const refined1 = yield* localSearch1Swap(built.rolls, built.state, orders[i]!)
    phasesCompleted.push('swap1')
    const refined2 = yield* localSearch2Swap(built.rolls, refined1, orders[i]!)
    phasesCompleted.push('swap2')
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
  phase = 'done'

  return {
    rollsByEntryId,
    state: finalState,
    baselineDamage,
    engineCalls,
    cacheHits,
    workUsed,
    workBudget,
    truncated,
    candidateWidth: widthMinUsed || entries.length,
    candidateWidthMax: widthMaxUsed || entries.length,
    phasesCompleted,
    startsRun,
  }
}

function toResult(input: AffixOptimizerInput, outcome: SearchOutcome): AffixOptimizerResult {
  const { baselineDamage, state } = outcome
  const improvementPercent = baselineDamage > 0
    ? ((state.total - baselineDamage) / baselineDamage) * 100
    : 0

  return {
    rollsByEntryId: outcome.rollsByEntryId,
    counts: state.counts,
    panelDeltas: state.panelDeltas,
    totalDamage: state.total,
    baselineDamage,
    improvementPercent,
    usedRolls: usedRollsOf(input.entries, outcome.rollsByEntryId),
    maxTotalRolls: resolveAffixOptimizerBudget(input.ctx, input.maxTotalRolls).maxTotalRolls,
    engineCalls: outcome.engineCalls,
    cacheHits: outcome.cacheHits,
    workUsed: outcome.workUsed,
    workBudget: outcome.workBudget,
    candidateWidth: outcome.candidateWidth,
    candidateWidthMax: outcome.candidateWidthMax,
    candidateWidthMode: input.candidateWidthMode ?? 'auto',
    truncated: outcome.truncated,
    phasesCompleted: outcome.phasesCompleted,
    startsRun: outcome.startsRun,
  }
}

/** 同步求解（测试与脚本使用；UI 请用 async 版以免卡住主线程） */
export function solveOptimalAffixAllocation(
  input: AffixOptimizerInput,
): AffixOptimizerResult {
  const generator = solveSearch(input)
  let step = generator.next()
  while (!step.done) step = generator.next()
  return toResult(input, step.value)
}

/** 分帧异步求解：保持页面响应，可中止，可报进度 */
export async function solveOptimalAffixAllocationAsync(
  input: AffixOptimizerInput,
  options?: AffixOptimizerAsyncOptions,
): Promise<AffixOptimizerResult> {
  const chunkSize = Math.max(1, options?.chunkSize ?? 24)
  const signal = options?.signal
  const generator = solveSearch(input)

  let sinceYield = 0
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    let step: IteratorResult<AffixOptimizerProgress, SearchOutcome>
    try {
      step = generator.next()
    } catch (error) {
      // 生成器内部抛错时也要让出一次，避免同步抛出吞掉中止语义
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw error
    }
    if (step.done) return toResult(input, step.value)
    sinceYield += 1
    if (sinceYield >= chunkSize) {
      sinceYield = 0
      options?.onProgress?.(step.value)
      await yieldToMain()
    }
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
