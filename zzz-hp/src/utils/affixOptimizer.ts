import type { AffixCounts } from '@/types/calculatorPanel'
import { rollsToEvalInput } from '@/utils/affixBenefitAnalysis'
import {
  affixValuePerCountFromEntries,
  type AffixDeltaMap,
  type AffixLibraryEntry,
} from '@/utils/affixLibrary'
import type { ExtraBuffGain } from '@/utils/extraBuffCalc'
import {
  evaluateAffixCountsWithCacheInfo,
  yieldToMain,
  type AffixValuePerCount,
  type OptimalEvalContext,
} from '@/utils/optimalAffixAlloc'

/**
 * 最优词条分配求解器（独立功能）
 *
 * 目标：在「总词条数」预算内，给出使「流程总伤」最大的词条分配。
 *
 * 预算口径（与「词条计算」页的双预算规则**无关**）：
 * - 总词条数是唯一预算，每条词条 1 档 = 1 个词条，不分大小词条。
 * - 柱图那套「36 − 6×同类主词条数」的档数上限**不适用**（用户 2026-09-10 决定）；
 *   现存的单条约束只有词条库条目自身的 `cap` 与互斥组，见 `resolveAffixOptimizerBudget`。
 *
 * 搜索策略（每一步都用真实引擎评估，不做可分性假设）：
 * 1. **普通路线**：贪心 + 1-swap + 2-swap。多起点只留 `gainDesc` / `declared`。
 *    倒序起点 `gainAsc` 已删除：倒数就是垃圾。若以后某个明确阈值被证实漏解，
 *    针对该机制加专路，不恢复全局倒序。
 * 2. **穿透专路**：把已启用的 `main:slot5:penRate` / `set:penRate:8` 锁满，
 *    在这块面板上重测副词条再跑贪心+swap，与普通路线比最终总伤。
 *    防御区 24+8+固穿是正协同，单档排序看不见整套；专路不进 Top-K。
 * 3. **1-swap / 2-swap**：撤一加一 / 撤两加两。暴击和爆伤这类配比 1 换 1 走不到。
 *    不是「局外攻击% 与固定攻击必须一起加减才涨伤」——局外是
 *    基础 × (1+攻击%) + 固定，两者不是相乘。
 *
 * 候选筛选：先按最低收益比例切质量，仍超过 K 时才按最新收益取前 K（过载保护）。
 *
 * 为什么不照搬 zzz-dev 的对数 DP：
 * 伤害公式是「和之积」（Σ 在 Π 外），各词条收益不可乘；暴击率/爆伤等
 * 交叉项分开 DP 会系统性偏差。
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
  /** 单条档数上限；当前实现恒为不限，见 `resolveAffixOptimizerBudget` */
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
  /**
   * 最低收益比例（0..1，默认 0）。
   * 每轮先丢掉「当前边际 < 本轮最强 × 该比例」的条目，再若仍超过 K 才截 Top-K。
   */
  minimumBenefitRatio?: number
  /**
   * 是否跑穿透专路（默认 true）。测试可关，用来对照「不锁 24+8」时的漏解。
   */
  enablePenRatePath?: boolean
  /** 计算量预算（单位：命中-次），仅 auto 模式生效 */
  maxWorkUnits?: number
  /** 兼容旧调用：把调用次数上限换算成计算量预算 */
  maxEngineCalls?: number
  /** 允许单条最大档数（默认按 cap 与预算推） */
  maxRollsPerEntry?: number
  /**
   * 组额度表（组名 → 组内各条档数之和的上限；`0` = 不限）。
   *
   * 组名不在表里时按**不限**算 —— 静默加约束比不加约束危险（见 `groupCapFor`）。
   * 表由词条库的 `affixGroupCaps(state)` 给。
   */
  groupCaps?: Record<string, number>
  /**
   * 跨条目 cap 税：`whenEntryId` 已有档时，`targetEntryId` 的有效上限再减 `amount`。
   * 游戏专用规则用来表达「号位选了攻击% → 副词条攻击% 少 1 档」。默认库不传。
   */
  entryCapTaxes?: AffixEntryCapTax[]
  /** 多起点贪心的起点数（1~2，默认 2：gainDesc / declared） */
  maxStarts?: number
}

/** 穿透结构只认这两个官方 id，不泛化成所有 penRate 条目 */
export const PEN_RATE_STRUCTURE_ENTRY_IDS = [
  'main:slot5:penRate',
  'set:penRate:8',
] as const

export function clampAffixMinimumBenefitRatio(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/** 见 `AffixOptimizerInput.entryCapTaxes` */
export interface AffixEntryCapTax {
  whenEntryId: string
  targetEntryId: string
  amount: number
}

export interface AffixOptimizerResult {
  /** 最优分配：条目 id → 档数 */
  rollsByEntryId: Record<string, number>
  counts: AffixCounts
  panelDeltas: AffixDeltaMap | undefined
  extraGains: ExtraBuffGain[] | undefined
  /**
   * 本次求解用的「每档值」表（由参与求解的条目决定）。
   *
   * 消费方拿 `counts`/`panelDeltas`/`extraGains` 复算总伤时**必须**一并传入，
   * 否则会按默认常量表算，与求解器报告的数字对不上。
   */
  valuePerCount: AffixValuePerCount
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
  /** 各阶段实际执行过的零收益补测轮数（贪心 / 1-swap / 2-swap） */
  staleRefreshesByPhase: Partial<Record<'greedy' | 'swap1' | 'swap2', number>>
  /** 实际生效的最低收益比例 */
  minimumBenefitRatio: number
  /** 比例筛掉的候选条数（各轮累计） */
  ratioDropped: number
  /** 比例筛完后被 K 截掉的候选条数（各轮累计） */
  kDropped: number
  /** 本次是否跑过穿透专路 */
  penRatePathUsed: boolean
  /** 最终采用哪条路线 */
  winningPath: 'ordinary' | 'penRate'
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
  /** 游戏专用 8 路外层：当前第几组 */
  gameBranch?: { index: number; total: number; label: string }
  /** 当前在普通路线还是穿透专路 */
  searchPath?: 'ordinary' | 'penRate'
}

export type AffixOptimizerAsyncOptions = {
  /** 每多少次评估至少让出主线程一次（默认 24） */
  chunkSize?: number
  /** 一个时间片最多占主线程多久（默认 8ms）；与 chunkSize 取「先到先让」 */
  sliceBudgetMs?: number
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
  basePanelDeltas?: AffixDeltaMap,
): {
  counts: AffixCounts
  panelDeltas: AffixDeltaMap | undefined
  extraGains: ExtraBuffGain[] | undefined
  valuePerCount: AffixValuePerCount
} {
  return rollsToEvalInput(entries, rollsByEntryId, baseCounts, basePanelDeltas)
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

/**
 * 某组当前已占用的档数（组内所有条目已分配档数之和）。
 *
 * `rolls` 必须是**当前正在评估的那份**档数快照：局部搜索里一次会连加两条，
 * 判断第二条时必须把刚加上的第一条算进来（2026-09-12 修：原先传的是「撤档之后」的
 * 旧快照，导致同组两条可以同时上榜）。
 */
function groupRollsUsed(
  entries: AffixLibraryEntry[],
  rolls: Record<string, number>,
  group: string,
): number {
  let sum = 0
  for (const entry of entries) {
    if (entry.group !== group) continue
    sum += rolls[entry.id] ?? 0
  }
  return sum
}

/**
 * 组额度：`0` = 不限（不构成约束）；组名不在表里也按不限算。
 *
 * 为什么缺失按「不限」而不是「1」：预设条目自带组名（都在「副词条」组），
 * 而调用方（脚本、测试）未必传组额度表 —— 那时若按 1 算，会让所有副词条
 * 共享 1 档，求解结果直接崩掉。静默加约束比不加约束危险得多。
 */
function groupCapFor(groupCaps: Record<string, number>, group: string): number {
  const cap = groupCaps[group]
  if (cap === undefined || !Number.isFinite(cap) || cap <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return cap
}

function capTaxOnTarget(
  taxes: readonly AffixEntryCapTax[],
  rolls: Record<string, number>,
  targetEntryId: string,
): number {
  let extra = 0
  for (const tax of taxes) {
    if (tax.targetEntryId !== targetEntryId) continue
    if ((rolls[tax.whenEntryId] ?? 0) > 0) extra += tax.amount
  }
  return extra
}

function entryCapLimit(
  entry: AffixLibraryEntry,
  maxRollsPerEntry: number,
  tax: number,
): number {
  const raw = entry.cap > 0 ? entry.cap : maxRollsPerEntry
  return Math.max(0, raw - tax)
}

/** 该条目还能再加多少档（受 cap、组额度、总词条数、可选 cap 税限制） */
function remainingAllowedRolls(
  entry: AffixLibraryEntry,
  current: number,
  budget: AffixOptimizerBudget,
  usedRolls: number,
  rolls: Record<string, number>,
  entries: AffixLibraryEntry[],
  maxRollsPerEntry: number,
  groupCaps: Record<string, number>,
  capTaxes: readonly AffixEntryCapTax[],
): number {
  const capLimit = entryCapLimit(
    entry,
    maxRollsPerEntry,
    capTaxOnTarget(capTaxes, rolls, entry.id),
  )
  const rollCap = budget.rollCapOf(entry)
  const byCap = Math.max(
    0,
    Math.min(capLimit, Number.isFinite(rollCap) ? rollCap : capLimit) - current,
  )
  if (byCap <= 0) return 0
  if (current <= 0) {
    for (const tax of capTaxes) {
      if (tax.whenEntryId !== entry.id) continue
      const target = entries.find((item) => item.id === tax.targetEntryId)
      if (!target) continue
      const targetRolls = rolls[target.id] ?? 0
      const nextTax = capTaxOnTarget(capTaxes, rolls, target.id) + tax.amount
      if (targetRolls > entryCapLimit(target, maxRollsPerEntry, nextTax)) return 0
    }
  }
  let byGroup = Number.POSITIVE_INFINITY
  if (entry.group) {
    const capOfGroup = groupCapFor(groupCaps, entry.group)
    if (Number.isFinite(capOfGroup)) {
      const groupRoom = capOfGroup - groupRollsUsed(entries, rolls, entry.group)
      if (groupRoom <= 0) return 0
      byGroup = groupRoom
    }
  }
  const cost = Math.max(1, entry.rollCost)
  const rollRoom = Math.floor((budget.maxTotalRolls - usedRolls) / cost)
  return Math.max(0, Math.min(byCap, byGroup, rollRoom))
}

export function collectPenRateStructureLocks(
  entries: AffixLibraryEntry[],
  fixedRolls: Record<string, number> = {},
  groupCaps: Record<string, number> = {},
  maxTotalRolls = DEFAULT_MAX_TOTAL_ROLLS,
  capTaxes: readonly AffixEntryCapTax[] = [],
): Record<string, number> {
  const budget = {
    maxTotalRolls,
    rollCapOf: () => Number.POSITIVE_INFINITY,
  } as AffixOptimizerBudget
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const next = { ...fixedRolls }
  const locks: Record<string, number> = {}
  for (const id of PEN_RATE_STRUCTURE_ENTRY_IDS) {
    const entry = byId.get(id)
    if (!entry) continue
    if ((next[id] ?? 0) > 0) continue
    const used = usedRollsOf(entries, next)
    if (
      remainingAllowedRolls(
        entry,
        next[id] ?? 0,
        budget,
        used,
        next,
        entries,
        maxTotalRolls,
        groupCaps,
        capTaxes,
      ) <= 0
    ) {
      continue
    }
    next[id] = 1
    locks[id] = 1
  }
  return locks
}

export function resolveAffixOptimizerBudget(
  ctx: OptimalEvalContext,
  maxTotalRolls?: number,
): AffixOptimizerBudget {
  return {
    maxTotalRolls: maxTotalRolls ?? DEFAULT_MAX_TOTAL_ROLLS,
    /**
     * 单条档数上限一律不限。
     *
     * 这里原先是 `affixRollCap(ctx.driveDiscMainStats, key)`，即柱图/词条计算页的
     * 「36 − 6×同名主属性数」规则（`AFFIX_ROLL_CAP_BASE` / `AFFIX_ROLL_CAP_PER_MAIN`）。
     * 用户 2026-09-10 决定：**词条分配模式不复用柱图规则** ——
     * 本模式回答的是「N 个词条怎么分最优」，是纯分配问题，与真实配装的可行性约束无关。
     *
     * 条目自身的 `cap`（词条库里的「上限」列）仍然生效，见 `remainingAllowedRolls`。
     * 参数 `ctx` 保留以维持既有调用签名。
     */
    rollCapOf: () => Number.POSITIVE_INFINITY,
  }
}

type SolveState = {
  total: number
  counts: AffixCounts
  panelDeltas: AffixDeltaMap | undefined
  extraGains: ExtraBuffGain[] | undefined
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
  staleRefreshesByPhase: Partial<Record<'greedy' | 'swap1' | 'swap2', number>>
  minimumBenefitRatio: number
  ratioDropped: number
  kDropped: number
  searchPath: 'ordinary' | 'penRate'
  penRatePathUsed: boolean
}

/** 候选集的排序口径。倒序 `gainAsc` 已删除，不恢复全局倒序起点。 */
type CandidateOrder = 'gainDesc' | 'declared'

/**
 * 搜索核心（生成器）。
 *
 * 每次引擎评估后 `yield` 一次进度快照，同步/异步两个驱动共用这一份实现，
 * 因此不存在「同步版与异步版算出不同结果」的可能。
 */
function* solveSearch(input: AffixOptimizerInput, searchPath: 'ordinary' | 'penRate' = 'ordinary'): Generator<AffixOptimizerProgress, SearchOutcome, void> {
  const { ctx, entries } = input
  const budget = resolveAffixOptimizerBudget(ctx, input.maxTotalRolls)
  const maxRollsPerEntry = input.maxRollsPerEntry ?? budget.maxTotalRolls
  /** 组额度表：缺省无表，任何组都按 DEFAULT_AFFIX_GROUP_CAP 算 */
  const groupCaps = input.groupCaps ?? {}
  const capTaxes = input.entryCapTaxes ?? []
  const fixedRolls = input.fixedRollsByEntryId ?? {}
  const maxStarts = Math.max(1, Math.min(2, input.maxStarts ?? 2))
  const widthMode: AffixCandidateWidthMode = input.candidateWidthMode ?? 'auto'
  const entryCount = Math.max(1, entries.length)
  const manualWidth = clampInt(input.manualCandidateWidth ?? entryCount, 1, entryCount)
  const minimumBenefitRatio = clampAffixMinimumBenefitRatio(input.minimumBenefitRatio)
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
  let ratioDropped = 0
  let kDropped = 0

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
    searchPath,
  })

  const remainingWork = (): number =>
    workBudget == null ? Number.POSITIVE_INFINITY : workBudget - workUsed

  /** 真实评估一次（缓存命中不计入计算量） */
  const evaluate = (rollsByEntryId: Record<string, number>): SolveState => {
    const { counts, panelDeltas, extraGains, valuePerCount } = entryRolls(
      entries,
      rollsByEntryId,
      emptyCounts,
    )
    const { value, cacheHit } = evaluateAffixCountsWithCacheInfo(
      ctx,
      counts,
      panelDeltas,
      valuePerCount,
      extraGains,
    )
    if (cacheHit) {
      cacheHits += 1
    } else {
      engineCalls += 1
      workUsed += pricePerEval
    }
    return { total: value.grandTotal, counts, panelDeltas, extraGains }
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
  const staleRefreshesByPhase: Partial<Record<'greedy' | 'swap1' | 'swap2', number>> = {}

  /**
   * 候选集：当前状态下正收益条目，先按最低收益比例切，仍超过 width 再取前 K。
   *
   * 增益 ≤ 0 是硬约束。不做「已分配条目优先」。
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
    if (!eligible.length) return []
    let bestGain = 0
    for (const entry of eligible) bestGain = Math.max(bestGain, gainOf(entry))
    const afterRatio = minimumBenefitRatio <= 0
      ? eligible.slice()
      : eligible.filter((entry) => gainOf(entry) >= bestGain * minimumBenefitRatio)
    ratioDropped += eligible.length - afterRatio.length
    if (order === 'gainDesc') afterRatio.sort((a, b) => gainOf(b) - gainOf(a))
    if (afterRatio.length > width) {
      kDropped += afterRatio.length - width
      return afterRatio.slice(0, width)
    }
    return afterRatio
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

  function* remesureAllowed(
    baseRolls: Record<string, number>,
    referenceTotal: number,
    isAllowed: (entry: AffixLibraryEntry) => boolean,
  ): Generator<AffixOptimizerProgress, void, void> {
    for (const entry of entries) {
      if (!isAllowed(entry)) continue
      if (remainingWork() < pricePerEval) {
        truncated = true
        return
      }
      yield* measureEntry(entry, baseRolls, referenceTotal)
    }
  }

  /**
   * 零收益条目的补测。
   *
   * 必须**以当前分配为基准**补测（不是基线）：增益有交叉项，
   * 例如暴击率为 0 时爆伤增益为 0、暴击率堆起来后爆伤才有收益。
   * 若只按基线测一次，这类条目会被永久误杀。
   *
   * 触发条件（满足其一才补测）：
   * 1. 贪心：正收益候选不够填满 width，且已分配档数 ≥ 门槛；
   * 2. 交换阶段每轮开头 `force`：门槛往往已被贪心推过已用档数，不强制则一次都跑不到。
   *
   * 门槛按「档数翻倍」推进（0 → 1 → 2 → 4 → 8 …），所以整个构建过程
   * 只补测 O(log 总档数) 次；交换阶段每轮最多再强制一次。
   */
  function* refreshStaleEntries(
    _width: number,
    baseRolls: Record<string, number>,
    referenceTotal: number,
    options?: { force?: boolean },
  ): Generator<AffixOptimizerProgress, void, void> {
    const usedRolls = usedRollsOf(entries, baseRolls)
    if (!options?.force && usedRolls < refreshGateRolls) return
    const stale = entries.filter(
      (entry) => (baseRolls[entry.id] ?? 0) === 0 && (lastGain.get(entry.id) ?? 0) <= 0,
    )
    if (!stale.length) {
      refreshGateRolls = Math.max(usedRolls + 1, usedRolls * 2)
      return
    }
    if (remainingWork() < stale.length * pricePerEval) return
    refreshGateRolls = Math.max(usedRolls + 1, usedRolls * 2)
    if (phase === 'greedy' || phase === 'swap1' || phase === 'swap2') {
      staleRefreshesByPhase[phase] = (staleRefreshesByPhase[phase] ?? 0) + 1
    }
    for (const entry of stale) {
      yield* measureEntry(entry, baseRolls, referenceTotal)
    }
  }

  // ---------- 2. 贪心构造 ----------
  phase = 'greedy'
  function* greedyBuild(
    order: CandidateOrder,
  ): Generator<AffixOptimizerProgress, { rolls: Record<string, number>; state: SolveState }, void> {
    phase = 'greedy'
    const rolls: Record<string, number> = { ...fixedRolls }
    let current: SolveState = {
      total: baselineDamage,
      counts: baseline.counts,
      panelDeltas: baseline.panelDeltas,
      extraGains: baseline.extraGains,
    }
    let used = usedRollsOf(entries, rolls)
    let greedySteps = 0

    for (;;) {
      const width = deriveWidth('linear', 1)
      const allowedHere = (entry: AffixLibraryEntry) =>
          remainingAllowedRolls(
          entry,
          rolls[entry.id] ?? 0,
          budget,
          used,
          rolls,
          entries,
          maxRollsPerEntry,
          groupCaps,
          capTaxes,
        ) > 0
      if (greedySteps > 0) {
        yield* remesureAllowed(rolls, current.total, allowedHere)
      }
      greedySteps += 1
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
    phase = 'swap1'
    let current = start
    let forcedRefresh = false
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
      if (!forcedRefresh) {
        yield* remesureAllowed(rolls, current.total, (entry) =>
          remainingAllowedRolls(
            entry,
            rolls[entry.id] ?? 0,
            budget,
            usedRollsOf(entries, rolls),
            rolls,
            entries,
            maxRollsPerEntry,
            groupCaps,
            capTaxes,
          ) > 0,
        )
        yield* refreshStaleEntries(width, rolls, current.total, { force: true })
        forcedRefresh = true
      }
      let bestSwap: { removeId: string; addId: string; state: SolveState } | null = null

      for (const removeEntry of removals) {
        const removeRolls = rolls[removeEntry.id] ?? 0
        const afterRemove = { ...rolls, [removeEntry.id]: removeRolls - 1 }
        const usedAfter = usedRollsOf(entries, afterRemove)
        const allowedHere = (entry: AffixLibraryEntry) =>
          remainingAllowedRolls(
            entry,
            afterRemove[entry.id] ?? 0,
            budget,
            usedAfter,
            afterRemove,
            entries,
            maxRollsPerEntry,
            groupCaps,
            capTaxes,
          ) > 0
        const candidates = pickCandidates(width, order, allowedHere)

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
      forcedRefresh = false
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
    phase = 'swap2'
    let current = start
    let forcedRefresh = false
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
      if (!forcedRefresh) {
        yield* remesureAllowed(rolls, current.total, (entry) =>
          remainingAllowedRolls(
            entry,
            rolls[entry.id] ?? 0,
            budget,
            usedRollsOf(entries, rolls),
            rolls,
            entries,
            maxRollsPerEntry,
            groupCaps,
            capTaxes,
          ) > 0,
        )
        yield* refreshStaleEntries(width, rolls, current.total, { force: true })
        forcedRefresh = true
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
        const allowedHere = (entry: AffixLibraryEntry) =>
          remainingAllowedRolls(
            entry,
            removal.rolls[entry.id] ?? 0,
            budget,
            removal.usedRolls,
            removal.rolls,
            entries,
            maxRollsPerEntry,
            groupCaps,
            capTaxes,
          ) > 0
        const candidates = pickCandidates(width, order, allowedHere)
        for (let i = 0; i < candidates.length; i += 1) {
          const a = candidates[i]!
          const aRolls = removal.rolls[a.id] ?? 0
          const afterAddA = { ...removal.rolls, [a.id]: aRolls + 1 }
          const usedA = usedRollsOf(entries, afterAddA)

          for (let j = i; j < candidates.length; j += 1) {
            const b = candidates[j]!
            const bRolls = afterAddA[b.id] ?? 0
            // 传 afterAddA 而不是 removal.rolls：这一轮已经加了 a 一档，
            // 同组额度必须把 a 算进去（否则同组两条会同时被加进来）
            if (
              remainingAllowedRolls(
                b,
                bRolls,
                budget,
                usedA,
                afterAddA,
                entries,
                maxRollsPerEntry,
                groupCaps,
                capTaxes,
              ) <= 0
            ) continue
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
      forcedRefresh = false
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
    : (['gainDesc', 'declared'] as CandidateOrder[]).slice(0, maxStarts)
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
    extraGains: baseline.extraGains,
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
    staleRefreshesByPhase,
    minimumBenefitRatio,
    ratioDropped,
    kDropped,
    searchPath,
    penRatePathUsed: false,
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
    extraGains: state.extraGains,
    valuePerCount: affixValuePerCountFromEntries(input.entries),
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
    staleRefreshesByPhase: outcome.staleRefreshesByPhase,
    minimumBenefitRatio: outcome.minimumBenefitRatio,
    ratioDropped: outcome.ratioDropped,
    kDropped: outcome.kDropped,
    penRatePathUsed: outcome.penRatePathUsed,
    winningPath: outcome.searchPath,
  }
}

function mergeSearchOutcomes(
  ordinary: SearchOutcome,
  pen: SearchOutcome,
): SearchOutcome {
  const usePen = pen.state.total > ordinary.state.total
  const winner = usePen ? pen : ordinary
  return {
    ...winner,
    baselineDamage: ordinary.baselineDamage,
    engineCalls: ordinary.engineCalls + pen.engineCalls,
    cacheHits: ordinary.cacheHits + pen.cacheHits,
    workUsed: ordinary.workUsed + pen.workUsed,
    truncated: ordinary.truncated || pen.truncated,
    candidateWidth: Math.min(ordinary.candidateWidth, pen.candidateWidth),
    candidateWidthMax: Math.max(ordinary.candidateWidthMax, pen.candidateWidthMax),
    phasesCompleted: [...ordinary.phasesCompleted, ...pen.phasesCompleted],
    startsRun: ordinary.startsRun + pen.startsRun,
    ratioDropped: ordinary.ratioDropped + pen.ratioDropped,
    kDropped: ordinary.kDropped + pen.kDropped,
    searchPath: usePen ? 'penRate' : 'ordinary',
    penRatePathUsed: true,
  }
}

function* solveSearchWithPenPath(
  input: AffixOptimizerInput,
): Generator<AffixOptimizerProgress, SearchOutcome, void> {
  const ordinary = yield* solveSearch(input, 'ordinary')
  if (input.enablePenRatePath === false) return ordinary

  const locks = collectPenRateStructureLocks(
    input.entries,
    input.fixedRollsByEntryId ?? {},
    input.groupCaps ?? {},
    resolveAffixOptimizerBudget(input.ctx, input.maxTotalRolls).maxTotalRolls,
    input.entryCapTaxes ?? [],
  )
  if (!Object.keys(locks).length) return ordinary

  const penInput: AffixOptimizerInput = {
    ...input,
    fixedRollsByEntryId: { ...(input.fixedRollsByEntryId ?? {}), ...locks },
    maxStarts: 1,
    enablePenRatePath: false,
  }
  const pen = yield* solveSearch(penInput, 'penRate')
  return mergeSearchOutcomes(ordinary, pen)
}

/** 同步求解（测试与脚本使用；UI 请用 async 版以免卡住主线程） */
export function solveOptimalAffixAllocation(
  input: AffixOptimizerInput,
): AffixOptimizerResult {
  const generator = solveSearchWithPenPath(input)
  let step = generator.next()
  while (!step.done) step = generator.next()
  return toResult(input, step.value)
}

/**
 * 分片异步求解：保持页面响应，可中止，可报进度。
 *
 * 让出节奏由两个条件共同决定（任一满足即让出）：
 * - `chunkSize`：一次至少评估多少次；
 * - `sliceBudgetMs`：一个时间片最多占主线程多久。
 *
 * 为什么要时间预算：单次评估的成本随流程规模变化（面板口径约 0.03ms、30 命中约 1ms）。
 * 只用次数下限时，流程很贵会导致一个时间片长达数十毫秒、输入发涩；只用时间预算时，
 * 极便宜的评估会把时钟查询变密。两者取「或」，兼顾。
 *
 * 注意：让出机制本身是 MessageChannel（≈0.01ms/次），不是 rAF（16.66ms/次）——
 * 用 rAF 会让总耗时被帧率卡死，见 `yieldToMain` 的说明。
 */
export async function solveOptimalAffixAllocationAsync(
  input: AffixOptimizerInput,
  options?: AffixOptimizerAsyncOptions,
): Promise<AffixOptimizerResult> {
  const chunkSize = Math.max(1, options?.chunkSize ?? 24)
  const sliceBudgetMs = Math.max(1, options?.sliceBudgetMs ?? 8)
  const signal = options?.signal
  const generator = solveSearchWithPenPath(input)

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  let sinceYield = 0
  let sliceStart = now()

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
    if (sinceYield >= chunkSize || now() - sliceStart >= sliceBudgetMs) {
      sinceYield = 0
      sliceStart = now()
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

/**
 * ② 最优分配标签用：按条目档数摘要，不读十格计数桶。
 * 分析侧 T12 后 `result.counts` 恒空，不能再拿它拼「暴击 21」。
 */
export function formatAffixRollsSummary(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): string {
  const parts = buildAllocationRows(entries, rollsByEntryId)
    .slice(0, 3)
    .map((row) => `${row.entry.label} ${row.rolls}`)
  return parts.length ? parts.join(' + ') : '零词条'
}
