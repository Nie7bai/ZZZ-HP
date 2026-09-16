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
 * ## 搜索策略：自适应 Beam（2026-09-16 改造，取代单路贪心）
 *
 * 旧版是「每条路一个起点、贪心 + 1/2-swap」，单条链一旦选错就回不来。
 * 现改为**保留多条完整分配路线**、最后比总伤的 Beam：
 *
 * 1. **本路基线全量测一次**（真实引擎），形成**永久候选池** —— 低于
 *    「本路最佳初始边际 × 初始候选门槛」的条目出局，零 / 负收益不补测、不复活。
 * 2. 从基线状态起，按**已用词条数**（`usedRolls`）**分桶推进**。`rollCost > 1`
 *    的付费条目一次跨多档，所以「层」是已用词条数，不是「加了几次条目」。
 * 3. 每个存活状态**扩展候选池里所有当前可用条目**，唯一约束走 `remainingAllowedRolls`
 *    （完整保留 `rollCost` / 组 cap / 总词条预算 / `entryCapTaxes` 语义）。
 * 4. 按**规范化 `rollsByEntryId`** 去重。不同条目即使临时伤害相同也不按评估值合并，
 *    否则会丢掉后续 cap / 税差异。
 * 5. 同一 `usedRolls` 桶内先按**累计提升比例**（`routeRetentionRatio`）筛，
 *    再按**自适应 B** 截顶（用户 `maxRetainedRoutes` 是上限）。
 * 6. 自适应 B 由「剩余计算量 × 剩余预算层 × 候选池规模」反推；预算不足以
 *    完成整层时**保留上一层完整状态**（无半成品）。
 * 7. Beam 结束后对**前 `min(3, B)` 个状态**各跑一次 1-swap / 2-swap，
 *    再选最终赢家 —— 避免只优化第一名、漏掉「第二名换档后反超」。
 *
 * **穿透专路**：把已启用的 `main:slot5:penRate` / `set:penRate:8` 锁满（它们**绕过**
 * 初始门槛、路线比例和 B，直接进 `fixedRolls`），在带穿透率的面板上重新测量、
 * 形成**专路独立候选池**，再跑同一套 Beam；最后与普通路比最终总伤。
 * 防御区 24+8+固穿是正协同，单档排序看不见整套，所以必须另开一路。
 *
 * ## 计算量预算
 *
 * - 一次评估的计价 = `1 + 命中数`（实测拟合良好，见 `dev-docs/affix-optimizer-impl-log.md`）。
 * - 缓存命中只花真算约 1% 的时间，因此**不计入**计算量消耗。
 * - `maxWorkUnits` 是**总刹车**（默认 20 万），不再兼「候选宽度」。原「手动不设上限跑到底」
 *   由「最大保留路线 = 全池 + 大预算」表达。
 */

/** 搜索预设 id */
export type AffixSearchPresetId = 'fast' | 'balanced' | 'fine' | 'custom'

/**
 * 三个用户参数（取代旧的「候选宽度 + 最低收益比例」）。
 * 白话解释见 `dev-docs/词条最优分配.md`「改造：自适应 Beam」。
 */
export interface AffixSearchParams {
  /** 初始候选门槛（0..1）：永久排除低于「本路最佳初始边际 × 比例」的词条 */
  initialCandidateThreshold: number
  /** 路线保留比例（0..1）：同层保留「累计提升 ≥ 本层最佳 × 比例」的整条路线 */
  routeRetentionRatio: number
  /** 最大保留路线 B：比例筛后最多留几条，分支规模硬上限 */
  maxRetainedRoutes: number
}

/**
 * 预设参数（2026-09-16 实测校准落定）。
 *
 * 三个预设只沿「搜索宽度」一条轴变化：门槛递减、B 递增，其余不动。
 * 实测数据见 `dev-docs/词条最优分配.md` 文末「实测校准」：
 *
 * | 预设 | 真实长流程(96 命中) 耗时 | 真实流程质量 | 合成流程质量 |
 * |---|---|---|---|
 * | 快速 | ~3.4s | 100% | 96.3% |
 * | 均衡 | ~9.7s | 100% | 100% |
 * | 精细 | ~20s 起 | 100% | 100% |
 *
 * ⚠️ 门槛必须很小（≤2%）。实测：门槛 10% 以上时「单档值很低的副词条」会被永久淘汰，
 * 46 档预算只花得掉 10 档，总伤腰斩。所以「快速」也不能激进到 5% 以上。
 * 改这里必须同步改手册。
 */
export const AFFIX_SEARCH_PRESETS: Record<Exclude<AffixSearchPresetId, 'custom'>, AffixSearchParams> = {
  fast: { initialCandidateThreshold: 0.02, routeRetentionRatio: 0.95, maxRetainedRoutes: 4 },
  balanced: { initialCandidateThreshold: 0.005, routeRetentionRatio: 0.95, maxRetainedRoutes: 8 },
  fine: { initialCandidateThreshold: 0, routeRetentionRatio: 0.95, maxRetainedRoutes: 16 },
}

export const AFFIX_SEARCH_PRESET_LABELS: Record<AffixSearchPresetId, string> = {
  fast: '快速',
  balanced: '均衡',
  fine: '精细',
  custom: '自定义',
}

export const DEFAULT_AFFIX_SEARCH_PRESET: AffixSearchPresetId = 'balanced'

export function clampAffixUnitRatio(value: number | undefined, fallback = 0): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(1, value))
}

export function clampAffixMaxRetainedRoutes(value: number | undefined, fallback = 8): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(64, Math.round(value)))
}

/**
 * 解析生效的搜索参数：预设给底、显式值覆盖。`custom` 用「均衡」打底再让用户值覆盖。
 */
export function resolveAffixSearchParams(input: {
  searchPreset?: AffixSearchPresetId
  initialCandidateThreshold?: number
  routeRetentionRatio?: number
  maxRetainedRoutes?: number
}): AffixSearchParams {
  const preset = input.searchPreset ?? DEFAULT_AFFIX_SEARCH_PRESET
  const base = AFFIX_SEARCH_PRESETS[preset === 'custom' ? 'balanced' : preset]
  return {
    initialCandidateThreshold: clampAffixUnitRatio(
      input.initialCandidateThreshold,
      base.initialCandidateThreshold,
    ),
    routeRetentionRatio: clampAffixUnitRatio(input.routeRetentionRatio, base.routeRetentionRatio),
    maxRetainedRoutes: clampAffixMaxRetainedRoutes(
      input.maxRetainedRoutes,
      base.maxRetainedRoutes,
    ),
  }
}

/** @deprecated 旧的候选宽度模式，已被「自适应 B + 三项搜索参数」取代；保留仅为旧脚本不报错。 */
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
  /** 固定投入的档数（不参与优化，但计入预算与基线；穿透专路的锁也走这里） */
  fixedRollsByEntryId?: Record<string, number>
  /** 总词条数上限；不传则用默认 46 */
  maxTotalRolls?: number
  /** 搜索预设（默认 `balanced`） */
  searchPreset?: AffixSearchPresetId
  /** 初始候选门槛（0..1）；显式值覆盖预设 */
  initialCandidateThreshold?: number
  /** 路线保留比例（0..1）；显式值覆盖预设 */
  routeRetentionRatio?: number
  /** 最大保留路线 B；显式值覆盖预设 */
  maxRetainedRoutes?: number
  /**
   * 是否跑穿透专路（默认 true）。测试可关，用来对照「不锁 24+8」时的漏解。
   */
  enablePenRatePath?: boolean
  /** 计算量预算（单位：命中-次） */
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
  /** @deprecated 被 `maxRetainedRoutes` 取代，传入即忽略。 */
  candidateWidthMode?: AffixCandidateWidthMode
  /** @deprecated 被 `maxRetainedRoutes` 取代，传入即忽略。 */
  manualCandidateWidth?: number
  /** @deprecated 被 `initialCandidateThreshold` / `routeRetentionRatio` 取代，传入即忽略。 */
  minimumBenefitRatio?: number
}

/** 穿透结构只认这两个官方 id，不泛化成所有 penRate 条目 */
export const PEN_RATE_STRUCTURE_ENTRY_IDS = [
  'main:slot5:penRate',
  'set:penRate:8',
] as const

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
  /** 计算量预算；null 表示不设上限 */
  workBudget: number | null
  /** 是否因预算耗尽而提前停止 */
  truncated: boolean
  /** 是否因候选池太大而跳过了可选的 1/2-swap 精修（Beam 本身已完整走完） */
  refineSkipped: boolean
  /** 实际走完的阶段（供 UI 说明搜索结果停在哪一级） */
  phasesCompleted: string[]
  /** 本次是否跑过穿透专路 */
  penRatePathUsed: boolean
  /** 最终采用哪条路线 */
  winningPath: 'ordinary' | 'penRate'
  /** 实际生效的搜索参数 */
  searchParams: AffixSearchParams
  /** 实际走完的预算层数（Beam 层数） */
  beamLayers: number
  /** 最终存活路线数（跨全部预算层的完整状态数） */
  survivedRoutes: number
  /** 累计扩展评估的路线条数 */
  expandedRoutes: number
  /** 累计被比例 / B 淘汰的路线条数 */
  prunedRoutes: number
  /** 初始候选门槛永久淘汰的条目数 */
  initialDropped: number
  /** 层内路线比例淘汰的路线数（各层累计） */
  layerRatioDropped: number
  /** 本次用到的自适应 B 最小值 */
  adaptiveBMin: number
  /** 本次用到的自适应 B 最大值 */
  adaptiveBMax: number
  /** 进入 1/2-swap 换档的终选状态数（min(3, B)） */
  refinedRoutes: number
}

/** 求解进度快照（异步驱动定期回调，用于 UI 显示） */
export interface AffixOptimizerProgress {
  phase: 'baseline' | 'measure' | 'beam' | 'swap1' | 'swap2' | 'done'
  engineCalls: number
  cacheHits: number
  workUsed: number
  workBudget: number | null
  bestTotal: number
  baselineDamage: number
  /** 当前在普通路线还是穿透专路 */
  searchPath?: 'ordinary' | 'penRate'
  /** 游戏专用 8 路外层：当前第几组 */
  gameBranch?: { index: number; total: number; label: string }
  /** 游戏专用：已完成口袋累计 + 当前口袋的合计计算量 */
  gameTotals?: { workUsed: number; engineCalls: number }
  /** 当前预算层（已用词条数） */
  layerUsedRolls?: number
  /** 当前层存活路线数 */
  survivedRoutes?: number
  /** 当前层实际 B */
  adaptiveB?: number
  /** 初始候选门槛永久淘汰条数 */
  initialDropped?: number
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
 * 原先按旧版 `maxEngineCalls = 4000` × 典型 8 命中计价 9 = 36000，
 * 长流程会在词条档数用尽前先撞上算力上限。提到 20 万。
 */
const DEFAULT_WORK_BUDGET = 200000

/** 单次评估的计价 = 1 + 命中数（实测 0/3/8/15/30 命中 ≈ 1 : 3.8 : 8.9 : 16 : 29.6） */
function workPricePerEval(ctx: OptimalEvalContext): number {
  return 1 + (ctx.hits?.length ?? 0)
}

/** 单路搜索的计算量上限；穿透专路与普通路共用调用方这一份预算。 */
function resolveSearchWorkBudget(input: AffixOptimizerInput): number | null {
  const pricePerEval = workPricePerEval(input.ctx)
  return input.maxWorkUnits ?? (input.maxEngineCalls != null
    ? input.maxEngineCalls * pricePerEval
    : DEFAULT_WORK_BUDGET)
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number.isFinite(value) ? value : min)
  return Math.max(min, Math.min(max, n))
}

/** 丢掉 ≤0 的档数，得到规范化分配（去重键 / 状态快照都用它） */
function normalizeRolls(rolls: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(rolls)) {
    const value = rolls[key] ?? 0
    if (value > 0) out[key] = value
  }
  return out
}

/** 规范化分配 → 稳定去重键（同一条分法只留一份） */
function canonicalRollsKey(rolls: Record<string, number>): string {
  const keys = Object.keys(rolls).filter((key) => (rolls[key] ?? 0) > 0).sort()
  let out = ''
  for (const key of keys) out += `${key}:${rolls[key]};`
  return out
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

/** Beam 下的一个完整状态（一条分配路线） */
type BeamState = SolveState & {
  rolls: Record<string, number>
  usedRolls: number
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
  /**
   * 因为候选池太大而跳过了 1/2-swap 精修。
   *
   * 与 `truncated` 分开：截断 = Beam 没走完、结果不完整；跳过精修 = Beam 已完整走完、
   * 只是没做最后那道可选的换档。两者对用户的含义完全不同（前者“结果可能不是最优、
   * 建议换更快预设”，后者“已完整搜索，只是没做2档微调”）。
   */
  refineSkipped: boolean
  phasesCompleted: string[]
  searchPath: 'ordinary' | 'penRate'
  penRatePathUsed: boolean
  searchParams: AffixSearchParams
  beamLayers: number
  survivedRoutes: number
  expandedRoutes: number
  prunedRoutes: number
  initialDropped: number
  layerRatioDropped: number
  adaptiveBMin: number
  adaptiveBMax: number
  refinedRoutes: number
}

/**
 * 搜索核心（生成器）。
 *
 * 每次引擎评估后 `yield` 一次进度快照，同步/异步两个驱动共用这一份实现，
 * 因此不存在「同步版与异步版算出不同结果」的可能。
 */
function* solveSearch(
  input: AffixOptimizerInput,
  searchPath: 'ordinary' | 'penRate' = 'ordinary',
): Generator<AffixOptimizerProgress, SearchOutcome, void> {
  const { ctx, entries } = input
  const budget = resolveAffixOptimizerBudget(ctx, input.maxTotalRolls)
  const maxRollsPerEntry = input.maxRollsPerEntry ?? budget.maxTotalRolls
  /** 组额度表：缺省无表，任何组都按不限算（`groupCapFor`） */
  const groupCaps = input.groupCaps ?? {}
  const capTaxes = input.entryCapTaxes ?? []
  const fixedRolls = normalizeRolls(input.fixedRollsByEntryId ?? {})
  const params = resolveAffixSearchParams(input)
  const pricePerEval = workPricePerEval(ctx)
  const workBudget: number | null = resolveSearchWorkBudget(input)
  const maxUsed = budget.maxTotalRolls

  const emptyCounts = {
    hpFlat: 0, hpPercent: 0, atkFlat: 0, atkPercent: 0, defFlat: 0,
    defPercent: 0, pen: 0, critRate: 0, critDmg: 0, mastery: 0,
  } as AffixCounts

  let engineCalls = 0
  let cacheHits = 0
  let workUsed = 0
  let truncated = false
  const phasesCompleted: string[] = []

  // 进度快照用的可变状态
  let phase: AffixOptimizerProgress['phase'] = 'baseline'
  let bestTotalSoFar = 0
  let baselineDamage = 0
  let layerUsedRolls = -1
  let liveSurvived = 0
  let liveAdaptiveB = 0
  let liveInitialDropped = 0
  let refineSkipped = false

  const snapshot = (): AffixOptimizerProgress => ({
    phase,
    engineCalls,
    cacheHits,
    workUsed,
    workBudget,
    bestTotal: bestTotalSoFar,
    baselineDamage,
    searchPath,
    ...(layerUsedRolls >= 0 ? { layerUsedRolls } : {}),
    ...(liveSurvived > 0 ? { survivedRoutes: liveSurvived } : {}),
    ...(liveAdaptiveB > 0 ? { adaptiveB: liveAdaptiveB } : {}),
    ...(liveInitialDropped > 0 ? { initialDropped: liveInitialDropped } : {}),
  })

  const remainingWork = (): number =>
    workBudget == null ? Number.POSITIVE_INFINITY : workBudget - workUsed

  /** 真实评估一次（缓存命中不计入计算量） */
  const evalRolls = (rolls: Record<string, number>): BeamState => {
    const { counts, panelDeltas, extraGains, valuePerCount } = entryRolls(
      entries,
      rolls,
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
    const total = value.grandTotal
    if (total > bestTotalSoFar) bestTotalSoFar = total
    return {
      rolls: normalizeRolls(rolls),
      usedRolls: usedRollsOf(entries, rolls),
      total,
      counts,
      panelDeltas,
      extraGains,
    }
  }

  /**
   * 自适应 B：以用户 B 为上限，由「剩余计算量 × 剩余预算层 × 候选池规模」反推。
   *
   * 下一层扩展成本 ≈ 存活数 × 池大小，于是 `B ≈ (剩余评估数 / 剩余层数) / 池大小`。
   * 预算紧时自然退化到 B=1（等价贪心），松时才展开多路线。
   */
  const deriveAdaptiveB = (remainingLayers: number, poolSize: number): number => {
    const upper = params.maxRetainedRoutes
    if (upper <= 1) return 1
    const remaining = remainingWork()
    if (!Number.isFinite(remaining)) return upper
    const affordableEvals = remaining / pricePerEval
    const layersLeft = Math.max(1, remainingLayers)
    const perLayer = affordableEvals / layersLeft
    const raw = Math.floor(perLayer / Math.max(1, poolSize))
    return clampInt(raw, 1, upper)
  }

  // ---------- 0. 基线（固定档数，不参与优化） ----------
  phase = 'baseline'
  const baselineState = evalRolls({ ...fixedRolls })
  baselineDamage = baselineState.total

  // ---------- 1. 本路基线全量测一次 → 永久候选池 ----------
  //
  // 探测口径：**满额收益** —— 把这条词条「当前允许投入的档数」一次性全投进去，
  // 看总共能涨多少分，而不是只投 1 档看第一档的边际。
  //
  // 为什么不能用「1 档边际」当门槛（2026-09-16 实测教训）：
  // 主属性条目 cap=1，一档就是 24% 穿透 / 30% 增伤这种大值；副词条一档只有 8%，
  // 但它能连吃 6 档。按「1 档边际」排序，主属性永远压着副词条，门槛一旦 > 0 就把
  // 副词条全筛掉，于是候选池只剩几个 cap=1 的主属性 —— 最优解连预算都花不完
  // （实测：门槛 0.1 时 46 档预算只花掉 10 档，总伤直接腰斩）。
  // 换成「满额收益」后，比较的是「这条词条能贡献多少」，与能投几档无关。
  phase = 'measure'
  const initialGain = new Map<string, number>()
  for (const entry of entries) {
    const current = baselineState.rolls[entry.id] ?? 0
    const room = remainingAllowedRolls(
      entry,
      current,
      budget,
      baselineState.usedRolls,
      baselineState.rolls,
      entries,
      maxRollsPerEntry,
      groupCaps,
      capTaxes,
    )
    if (room <= 0) {
      initialGain.set(entry.id, 0)
      continue
    }
    if (remainingWork() < pricePerEval) {
      truncated = true
      break
    }
    const probe = evalRolls({ ...baselineState.rolls, [entry.id]: current + room })
    initialGain.set(entry.id, probe.total - baselineState.total)
  }

  let bestInitialGain = 0
  for (const gain of initialGain.values()) bestInitialGain = Math.max(bestInitialGain, gain)
  const pool: AffixLibraryEntry[] = []
  if (bestInitialGain > 0) {
    const cutoff = bestInitialGain * params.initialCandidateThreshold
    for (const entry of entries) {
      const gain = initialGain.get(entry.id) ?? 0
      // 零收益保留（门槛为 0 时给交叉项留机会），负收益一律出局
      if (gain >= 0 && gain >= cutoff) pool.push(entry)
    }
  }
  const initialDropped = entries.length - pool.length
  liveInitialDropped = initialDropped
  phasesCompleted.push('measure')

  // ---------- 2. Beam 构造 ----------
  phase = 'beam'
  /** 已定稿的桶（预算层 → 存活状态） */
  const survivorsByUsed = new Map<number, BeamState[]>()
  /** 已评估、等待所属桶定稿的状态 */
  const pendingByUsed = new Map<number, BeamState[]>()
  survivorsByUsed.set(baselineState.usedRolls, [baselineState])

  let beamLayers = 0
  let expandedRoutes = 0
  let prunedRoutes = 0
  let layerRatioDropped = 0
  let adaptiveBMin = 0
  let adaptiveBMax = 0

  if (pool.length) {
    for (let used = baselineState.usedRolls; used <= maxUsed; used += 1) {
      const bucket = [
        ...(survivorsByUsed.get(used) ?? []),
        ...(pendingByUsed.get(used) ?? []),
      ]
      if (!bucket.length) continue

      // 去重：同一条分配只留一份（不按评估值合并）
      const seen = new Set<string>()
      const unique: BeamState[] = []
      for (const state of bucket) {
        const key = canonicalRollsKey(state.rolls)
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(state)
      }

      // 层内路线保留比例：累计提升 ≥ 本层最佳累计提升 × 比例
      let bestLayerImprovement = Number.NEGATIVE_INFINITY
      for (const state of unique) {
        bestLayerImprovement = Math.max(bestLayerImprovement, state.total - baselineDamage)
      }
      const afterRatio = params.routeRetentionRatio <= 0
        ? unique
        : unique.filter(
          (state) => state.total - baselineDamage >= bestLayerImprovement * params.routeRetentionRatio - 1e-9,
        )
      layerRatioDropped += unique.length - afterRatio.length

      // 自适应 B 截顶
      const adaptiveB = deriveAdaptiveB(Math.max(1, maxUsed - used), Math.max(1, pool.length))
      if (adaptiveBMin === 0) adaptiveBMin = adaptiveB
      adaptiveBMin = Math.min(adaptiveBMin, adaptiveB)
      adaptiveBMax = Math.max(adaptiveBMax, adaptiveB)
      liveAdaptiveB = adaptiveB

      afterRatio.sort((a, b) => b.total - a.total)
      const finalStates = afterRatio.slice(0, adaptiveB)
      prunedRoutes += afterRatio.length - finalStates.length
      survivorsByUsed.set(used, finalStates)
      beamLayers += 1
      layerUsedRolls = used
      liveSurvived = finalStates.length
      yield snapshot()

      if (!finalStates.length) continue

      // 预算不足以完成整层 → 停在上一层完整状态（无半成品）
      const estimated = finalStates.length * pool.length
      if (remainingWork() < estimated * pricePerEval) {
        truncated = true
        break
      }

      for (const state of finalStates) {
        const allowedOf = (entry: AffixLibraryEntry) =>
          remainingAllowedRolls(
            entry,
            state.rolls[entry.id] ?? 0,
            budget,
            state.usedRolls,
            state.rolls,
            entries,
            maxRollsPerEntry,
            groupCaps,
            capTaxes,
          ) > 0
        for (const entry of pool) {
          if (!allowedOf(entry)) continue
          const nextRolls = { ...state.rolls, [entry.id]: (state.rolls[entry.id] ?? 0) + 1 }
          const nextUsed = usedRollsOf(entries, nextRolls)
          if (nextUsed > maxUsed) continue
          const nextState = evalRolls(nextRolls)
          expandedRoutes += 1
          yield snapshot()
          const arr = pendingByUsed.get(nextUsed)
          if (arr) arr.push(nextState)
          else pendingByUsed.set(nextUsed, [nextState])
        }
      }
    }
  }
  phasesCompleted.push('beam')

  // ---------- 3. 终选：前 min(3, B) 条路线各跑 1/2-swap ----------
  const finalists: BeamState[] = []
  for (const states of survivorsByUsed.values()) finalists.push(...states)
  finalists.sort((a, b) => b.total - a.total)

  const refineCount = Math.min(3, params.maxRetainedRoutes, finalists.length)
  let bestState: BeamState = finalists[0] ?? baselineState
  let bestRolls: Record<string, number> = { ...bestState.rolls }
  let refinedRoutes = 0

  /** 1-swap：撤一档、加一档（池内候选） */
  function* localSearch1Swap(
    rolls: Record<string, number>,
    start: BeamState,
  ): Generator<AffixOptimizerProgress, BeamState, void> {
    phase = 'swap1'
    let current = start
    for (;;) {
      const removals = entries.filter((entry) => {
        const removeRolls = rolls[entry.id] ?? 0
        return removeRolls > 0 && (fixedRolls[entry.id] ?? 0) < removeRolls
      })
      if (!removals.length) break
      const poolSize = Math.max(1, pool.length)
      if (remainingWork() < removals.length * poolSize * pricePerEval) {
        refineSkipped = true
        break
      }
      let bestSwap: { rolls: Record<string, number>; state: BeamState } | null = null
      for (const removeEntry of removals) {
        const removeRolls = rolls[removeEntry.id] ?? 0
        const afterRemove = normalizeRolls({ ...rolls, [removeEntry.id]: removeRolls - 1 })
        const usedAfter = usedRollsOf(entries, afterRemove)
        for (const addEntry of pool) {
          if (addEntry.id === removeEntry.id) continue
          const addRolls = afterRemove[addEntry.id] ?? 0
          if (
            remainingAllowedRolls(
              addEntry,
              addRolls,
              budget,
              usedAfter,
              afterRemove,
              entries,
              maxRollsPerEntry,
              groupCaps,
              capTaxes,
            ) <= 0
          ) continue
          const evaluated = evalRolls({ ...afterRemove, [addEntry.id]: addRolls + 1 })
          yield snapshot()
          if (evaluated.total > current.total &&
              (!bestSwap || evaluated.total > bestSwap.state.total)) {
            bestSwap = { rolls: { ...evaluated.rolls }, state: evaluated }
          }
        }
      }
      if (!bestSwap) break
      for (const key of Object.keys(rolls)) delete rolls[key]
      Object.assign(rolls, bestSwap.rolls)
      current = bestSwap.state
    }
    return current
  }

  /** 2-swap：撤两档、加两档（池内候选；撤法只从活跃集里出） */
  function* localSearch2Swap(
    rolls: Record<string, number>,
    start: BeamState,
  ): Generator<AffixOptimizerProgress, BeamState, void> {
    phase = 'swap2'
    let current = start
    for (;;) {
      // 撤法只从「已分配档数的条目」里出（活跃集）：没分到档数的条目无从撤起，
      // 这正是把旧的 O(E⁴) 降到「活跃集²」的关键
      const active = entries.filter((entry) => (rolls[entry.id] ?? 0) > 0)
      if (!active.length) break
      const removalCount = Math.max(1, (active.length * (active.length + 1)) / 2)
      const poolSize = Math.max(1, pool.length)
      const pairCount = Math.max(1, (poolSize * (poolSize + 1)) / 2)
      // 做不完就不开这一轮：宁可停在上一级完成的结果，也不给半成品
      if (remainingWork() < removalCount * pairCount * pricePerEval) {
        refineSkipped = true
        break
      }

      const removals: { rolls: Record<string, number>; usedRolls: number }[] = []
      for (let i = 0; i < active.length; i += 1) {
        const a = active[i]!
        const aRolls = rolls[a.id] ?? 0
        const aFixed = fixedRolls[a.id] ?? 0
        if (aRolls - 2 >= aFixed) {
          const next = normalizeRolls({ ...rolls, [a.id]: aRolls - 2 })
          removals.push({ rolls: next, usedRolls: usedRollsOf(entries, next) })
        }
        for (let j = i + 1; j < active.length; j += 1) {
          const b = active[j]!
          const bRolls = rolls[b.id] ?? 0
          const bFixed = fixedRolls[b.id] ?? 0
          if (aRolls - 1 < aFixed || bRolls - 1 < bFixed) continue
          const next = normalizeRolls({ ...rolls, [a.id]: aRolls - 1, [b.id]: bRolls - 1 })
          removals.push({ rolls: next, usedRolls: usedRollsOf(entries, next) })
        }
      }

      let bestSwap: { rolls: Record<string, number>; state: BeamState } | null = null
      for (const removal of removals) {
        const candidatesA: AffixLibraryEntry[] = []
        for (const entry of pool) {
          if (
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
          ) candidatesA.push(entry)
        }
        for (let i = 0; i < candidatesA.length; i += 1) {
          const a = candidatesA[i]!
          const aRolls = removal.rolls[a.id] ?? 0
          const afterAddA = { ...removal.rolls, [a.id]: aRolls + 1 }
          const usedA = usedRollsOf(entries, afterAddA)
          for (let j = i; j < candidatesA.length; j += 1) {
            const b = candidatesA[j]!
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
            const evaluated = evalRolls(candidate)
            yield snapshot()
            if (evaluated.total > current.total &&
                (!bestSwap || evaluated.total > bestSwap.state.total)) {
              bestSwap = { rolls: { ...evaluated.rolls }, state: evaluated }
            }
          }
        }
      }

      if (!bestSwap) break
      for (const key of Object.keys(rolls)) delete rolls[key]
      Object.assign(rolls, bestSwap.rolls)
      current = bestSwap.state
    }
    return current
  }

  if (refineCount > 0) {
    const canRefine = (): boolean => remainingWork() > 0
    for (const candidate of finalists.slice(0, refineCount)) {
      if (!canRefine()) {
        truncated = true
        break
      }
      const rolls = { ...candidate.rolls }
      const refined1 = yield* localSearch1Swap(rolls, candidate)
      if (!phasesCompleted.includes('swap1')) phasesCompleted.push('swap1')
      const refined2 = yield* localSearch2Swap(rolls, refined1)
      if (!phasesCompleted.includes('swap2')) phasesCompleted.push('swap2')
      refinedRoutes += 1
      if (refined2.total > bestState.total) {
        bestState = refined2
        bestRolls = { ...rolls }
      }
    }
  }
  phase = 'done'

  return {
    rollsByEntryId: normalizeRolls(bestRolls),
    state: bestState,
    baselineDamage,
    engineCalls,
    cacheHits,
    workUsed,
    workBudget,
    truncated,
    refineSkipped,
    phasesCompleted,
    searchPath,
    penRatePathUsed: false,
    searchParams: params,
    beamLayers,
    survivedRoutes: finalists.length,
    expandedRoutes,
    prunedRoutes,
    initialDropped,
    layerRatioDropped,
    adaptiveBMin,
    adaptiveBMax,
    refinedRoutes,
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
    truncated: outcome.truncated,
    refineSkipped: outcome.refineSkipped,
    phasesCompleted: outcome.phasesCompleted,
    penRatePathUsed: outcome.penRatePathUsed,
    winningPath: outcome.searchPath,
    searchParams: outcome.searchParams,
    beamLayers: outcome.beamLayers,
    survivedRoutes: outcome.survivedRoutes,
    expandedRoutes: outcome.expandedRoutes,
    prunedRoutes: outcome.prunedRoutes,
    initialDropped: outcome.initialDropped,
    layerRatioDropped: outcome.layerRatioDropped,
    adaptiveBMin: outcome.adaptiveBMin,
    adaptiveBMax: outcome.adaptiveBMax,
    refinedRoutes: outcome.refinedRoutes,
  }
}

function mergeSearchOutcomes(
  ordinary: SearchOutcome,
  pen: SearchOutcome,
  sharedWorkBudget: number | null,
): SearchOutcome {
  const usePen = pen.state.total > ordinary.state.total
  const winner = usePen ? pen : ordinary
  const bMins = [ordinary.adaptiveBMin, pen.adaptiveBMin].filter((value) => value > 0)
  return {
    ...winner,
    baselineDamage: ordinary.baselineDamage,
    engineCalls: ordinary.engineCalls + pen.engineCalls,
    cacheHits: ordinary.cacheHits + pen.cacheHits,
    workUsed: ordinary.workUsed + pen.workUsed,
    workBudget: sharedWorkBudget,
    truncated: ordinary.truncated || pen.truncated,
    refineSkipped: ordinary.refineSkipped || pen.refineSkipped,
    phasesCompleted: [...new Set([...ordinary.phasesCompleted, ...pen.phasesCompleted])],
    searchPath: usePen ? 'penRate' : 'ordinary',
    penRatePathUsed: true,
    beamLayers: Math.max(ordinary.beamLayers, pen.beamLayers),
    survivedRoutes: ordinary.survivedRoutes + pen.survivedRoutes,
    expandedRoutes: ordinary.expandedRoutes + pen.expandedRoutes,
    prunedRoutes: ordinary.prunedRoutes + pen.prunedRoutes,
    initialDropped: Math.max(ordinary.initialDropped, pen.initialDropped),
    layerRatioDropped: ordinary.layerRatioDropped + pen.layerRatioDropped,
    adaptiveBMin: bMins.length ? Math.min(...bMins) : 0,
    adaptiveBMax: Math.max(ordinary.adaptiveBMax, pen.adaptiveBMax),
    refinedRoutes: ordinary.refinedRoutes + pen.refinedRoutes,
  }
}

function* solveSearchWithPenPath(
  input: AffixOptimizerInput,
): Generator<AffixOptimizerProgress, SearchOutcome, void> {
  if (input.enablePenRatePath === false) return yield* solveSearch(input, 'ordinary')

  const locks = collectPenRateStructureLocks(
    input.entries,
    input.fixedRollsByEntryId ?? {},
    input.groupCaps ?? {},
    resolveAffixOptimizerBudget(input.ctx, input.maxTotalRolls).maxTotalRolls,
    input.entryCapTaxes ?? [],
  )
  if (!Object.keys(locks).length) return yield* solveSearch(input, 'ordinary')

  const sharedWorkBudget = resolveSearchWorkBudget(input)
  let ordinaryInput = input
  let penWorkUnits: number | undefined
  // auto：专路预留 1/3，普通路 2/3；普通路没用完的还给专路。
  if (sharedWorkBudget != null) {
    const penShare = Math.floor(sharedWorkBudget / 3)
    ordinaryInput = { ...input, maxWorkUnits: sharedWorkBudget - penShare }
    penWorkUnits = penShare
  }

  const ordinary = yield* solveSearch(ordinaryInput, 'ordinary')
  const leftover = sharedWorkBudget == null
    ? 0
    : Math.max(0, (ordinary.workBudget ?? 0) - ordinary.workUsed)
  const penInput: AffixOptimizerInput = {
    ...input,
    fixedRollsByEntryId: { ...(input.fixedRollsByEntryId ?? {}), ...locks },
    enablePenRatePath: false,
    ...(sharedWorkBudget != null ? { maxWorkUnits: (penWorkUnits ?? 0) + leftover } : {}),
  }
  const pen = yield* solveSearch(penInput, 'penRate')
  return mergeSearchOutcomes(ordinary, pen, sharedWorkBudget)
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
