import type { AffixCounts } from '@/types/calculatorPanel'
import { rollsToEvalInput } from '@/utils/affixBenefitAnalysis'
import {
  affixValuePerCountFromEntries,
  isDefenseZoneAffixTarget,
  isFlatPenAffixTarget,
  isPenRateAffixTarget,
  type AffixDeltaMap,
  type AffixLibraryEntry,
} from '@/utils/affixLibrary'
import type { ExtraBuffGain } from '@/utils/extraBuffCalc'
import {
  evaluateAffixCounts,
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
  /**
   * 初始候选门槛（0..1）：**组内比例** —— 永久排除低于「本组最高单档收益 × 比例」的词条。
   *
   * 度量口径 = 单档收益（只加 1 档），标尺 = 同组最高；**越大筛得越狠**（0 = 只丢负收益）。
   * 详见 `dev-docs/词条最优分配.md`「施工中：第二轮改造」。
   */
  initialCandidateThreshold: number
  /** 路线保留比例（0..1）：同层保留「累计提升 ≥ 本层最佳 × 比例」的整条路线 */
  routeRetentionRatio: number
  /** 最大保留路线 B：比例筛后最多留几条，分支规模硬上限 */
  maxRetainedRoutes: number
}

/**
 * 预设参数（2026-09-16 第二轮改造：门槛换成**组内单档比例**）。
 *
 * ⚠️ **三档的 `R` 由用户最终定**；下面是按实测扫出来的值（越大筛得越狠）：
 * 同一场景（46 档、合成 8 命中）里 `R=0` 为 100% 基准 ——
 *
 * | R | 淘汰 | 质量 |
 * |---|---|---|
 * | 0 | 0 条 | 100% |
 * | 0.05 | 21 条 | 100% |
 * | 0.10 | 22 条 | 96.3% |
 * | 0.15 起 | 24 条+ | 73.4% 及以下（质量塌） |
 *
 * 所以三档取 `快速 0.1 / 均衡 0.05 / 精细 0`，正好对上手册记的「快速不低于精细的 95%」。
 * 旧的 2% / 0.5% / 0% 是「占全场最佳满额收益」的旧语义，**不作数**。
 */
export const AFFIX_SEARCH_PRESETS: Record<Exclude<AffixSearchPresetId, 'custom'>, AffixSearchParams> = {
  fast: { initialCandidateThreshold: 0.1, routeRetentionRatio: 0.95, maxRetainedRoutes: 4 },
  balanced: { initialCandidateThreshold: 0.05, routeRetentionRatio: 0.95, maxRetainedRoutes: 8 },
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
  /**
   * 只给**专路世界**用：防御区一族（穿透率 / 固穿 / 减防 / 无视防御）不进候选池。
   *
   * 专路把这族定死在落点上之后，剩余分配阶段不再动它们（收益已榨干），
   * 这一族也就不能参与门槛、不能当组内标尺。
   */
  excludeDefenseZoneFromPool?: boolean
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

/** 专路种子 / 落点都按 **target 字段** 判，不写 id（见 `affixLibrary.AFFIX_DEFENSE_ZONE_FIELDS`） */

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
  /** 游戏专用 4 袋外层：当前第几袋 */
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

/** 空词条数起点（评估入参的底座） */
function emptyAffixCounts(): AffixCounts {
  return {
    hpFlat: 0, hpPercent: 0, atkFlat: 0, atkPercent: 0, defFlat: 0,
    defPercent: 0, pen: 0, critRate: 0, critDmg: 0, mastery: 0,
  } as AffixCounts
}

/**
 * 真算一个「世界」（一组固定档数）的总伤，并回报这世界的**有效防御**。
 *
 * 专路 2.0 专门用它：把穿透率绑死后的世界算一次，`effectiveDefense` 就是
 * 「还要再堆多少固定穿透点才能把防御吃干净」（单位与固定穿透一致，0 = 已经吃干净）。
 */
function evaluateWorldOnce(
  ctx: OptimalEvalContext,
  entries: AffixLibraryEntry[],
  rolls: Record<string, number>,
): { total: number; effectiveDefense: number } {
  const { counts, panelDeltas, extraGains, valuePerCount } = entryRolls(
    entries,
    rolls,
    emptyAffixCounts(),
  )
  const value = evaluateAffixCounts(ctx, counts, panelDeltas, valuePerCount, extraGains)
  return { total: value.grandTotal, effectiveDefense: value.result.effectiveDefense }
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

/**
 * 专路 2.0 · 第一步：把 `penRate` 字段的已启用条目**尽可能选走**（种子）。
 *
 * 按 **target 字段** 判，不写 id：默认库的两条（5 号位 24% / 2 件套 8%）自然命中，
 * 用户自建的同字段条目、将来加回的条目同样认。
 *
 * 「尽可能」= 在自身 cap / 组额度 / 总预算都允许的前提下，能加几档加几档；
 * 穿透率本身有 95% 硬上限（与 `damageCalc.computeDefenseZone` 的 clamp 一致），锁到即停。
 */
export function collectPenRateFieldLocks(
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
  const next = { ...fixedRolls }
  const locks: Record<string, number> = {}
  let lockedPenRate = 0
  for (const entry of entries) {
    if (!isPenRateAffixTarget(entry.target)) continue
    // 防呆上限：正常条目会被 cap / 组额度 / 预算先掐住
    for (let guard = 0; guard < 64; guard += 1) {
      if (lockedPenRate + entry.perRoll > DEFENSE_ZONE_PEN_RATE_CAP) break
      const used = usedRollsOf(entries, next)
      const room = remainingAllowedRolls(
        entry,
        next[entry.id] ?? 0,
        budget,
        used,
        next,
        entries,
        maxTotalRolls,
        groupCaps,
        capTaxes,
      )
      if (room <= 0) break
      next[entry.id] = (next[entry.id] ?? 0) + 1
      locks[entry.id] = (locks[entry.id] ?? 0) + 1
      lockedPenRate += entry.perRoll
    }
  }
  return locks
}

/** 穿透率硬上限（%，与 `damageCalc.computeDefenseZone` 的 clamp 同值） */
export const DEFENSE_ZONE_PEN_RATE_CAP = 95

/**
 * 专路 2.0 · 第二步：解析求「猛堆固定穿透」的落点（不再一档一档试）。
 *
 * 用绑定世界真算一次的 `DamageCalcResult.effectiveDefense`（与固定穿透同单位）：
 * - `需要再堆的点数 = 有效防御`；
 * - `n = ceil(有效防御 ÷ 每档值)`，再由调用方按 `remainingAllowedRolls` 裁到 cap / 额度 / 预算；
 * - 候选 = `{max(0, n−1), n}`（去重、升序）—— 最后一条可能只吃得掉一部分（多的浪费），两种开销都试。
 *
 * 多固穿条目：只堆**每档值最大**的那条（现状库只有一条；多条堆叠不在本轮范围）。
 */
export function resolveFlatPenLadder(input: {
  entries: AffixLibraryEntry[]
  lockedRolls: Record<string, number>
  effectiveDefense: number
  groupCaps?: Record<string, number>
  maxTotalRolls?: number
  capTaxes?: readonly AffixEntryCapTax[]
}): { entryId: string; candidates: number[] } | null {
  const penEntries = input.entries.filter((entry) => isFlatPenAffixTarget(entry.target))
  if (!penEntries.length) return null
  const primary = penEntries.reduce(
    (best, item) => (item.perRoll > best.perRoll ? item : best),
    penEntries[0]!,
  )
  const maxTotalRolls = input.maxTotalRolls ?? DEFAULT_MAX_TOTAL_ROLLS
  const budget = {
    maxTotalRolls,
    rollCapOf: () => Number.POSITIVE_INFINITY,
  } as AffixOptimizerBudget
  const locked = input.lockedRolls
  const used = usedRollsOf(input.entries, locked)
  const room = remainingAllowedRolls(
    primary,
    locked[primary.id] ?? 0,
    budget,
    used,
    locked,
    input.entries,
    maxTotalRolls,
    input.groupCaps ?? {},
    input.capTaxes ?? [],
  )
  const need = Math.max(0, input.effectiveDefense)
  const perRoll = Math.max(1e-9, primary.perRoll)
  const wanted = need > 0 ? Math.ceil(need / perRoll) : 0
  const n = Math.max(0, Math.min(wanted, room))
  const candidates = [...new Set([Math.max(0, n - 1), n])].sort((a, b) => a - b)
  return { entryId: primary.id, candidates }
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
  /** 专路世界：防御区一族不进候选池（那一族已被专路定死，收益榨干） */
  const excludeDefenseZoneFromPool = input.excludeDefenseZoneFromPool === true
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

  const emptyCounts = emptyAffixCounts()

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
  // 探测口径：**单档收益**（2026-09-16 第二轮改造）—— 只给这条词条加 1 档，
  // 看总伤涨多少。**组内比**：每条只跟自己组的最高值比，不跨组、不看全场。
  //
  // 为什么不用「满额收益」（旧口径）：满额把「这条能投几档」混进了度量里，
  // 26 档的副词条天然压过 1 档的号位主属性，门槛一动就整组筛没。
  // 单档 + 组内 = 每组内部比「第一条值不值」，跨组不互相压。
  //
  // 空组条目（临时条目）按规则**不进池**（不测量、不参与最优计算）；
  // 专路世界额外把防御区一族从池子里摘掉（那一族已按落点定死，收益榨干）。
  phase = 'measure'
  const poolExcluded = (entry: AffixLibraryEntry): boolean =>
    !entry.group || (excludeDefenseZoneFromPool && isDefenseZoneAffixTarget(entry.target))
  const initialGain = new Map<string, number>()
  for (const entry of entries) {
    if (poolExcluded(entry)) continue
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
    const probe = evalRolls({ ...baselineState.rolls, [entry.id]: current + 1 })
    initialGain.set(entry.id, probe.total - baselineState.total)
  }

  /** 组内标尺：该组单档收益的最高值（不跨组、不看全场） */
  const bestGainByGroup = new Map<string, number>()
  for (const entry of entries) {
    if (poolExcluded(entry)) continue
    const gain = initialGain.get(entry.id) ?? 0
    if (gain > (bestGainByGroup.get(entry.group) ?? 0)) {
      bestGainByGroup.set(entry.group, gain)
    }
  }
  const pool: AffixLibraryEntry[] = []
  for (const entry of entries) {
    if (poolExcluded(entry)) continue
    const gain = initialGain.get(entry.id) ?? 0
    // 判定：≥ 0（负收益一律出局）且 ≥ 本组最高 × 比例；组内最高 ≤ 0 时线 ≤ 0，该组 ≥0 全留
    const cutoff = (bestGainByGroup.get(entry.group) ?? 0) * params.initialCandidateThreshold
    if (gain >= 0 && gain >= cutoff) pool.push(entry)
  }
  const initialDropped = entries.filter((entry) => !poolExcluded(entry)).length - pool.length
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

/**
 * 汇总：普通路 + 全部专路世界，**比最终总伤取最大**（中间不交汇）。
 *
 * 统计量跨世界求和（引擎调用 / 计算量 / 存活路线…），`searchPath` 取赢家那条。
 */
function mergeSearchOutcomes(
  ordinary: SearchOutcome,
  penWorlds: SearchOutcome[],
  sharedWorkBudget: number | null,
): SearchOutcome {
  const penBest = penWorlds.reduce(
    (best, item) => (item.state.total > best.state.total ? item : best),
    penWorlds[0]!,
  )
  const usePen = penBest.state.total > ordinary.state.total
  const winner = usePen ? penBest : ordinary
  const all = [ordinary, ...penWorlds]
  const sum = (pick: (item: SearchOutcome) => number): number =>
    all.reduce((total, item) => total + pick(item), 0)
  const bMins = all.map((item) => item.adaptiveBMin).filter((value) => value > 0)
  return {
    ...winner,
    baselineDamage: ordinary.baselineDamage,
    engineCalls: sum((item) => item.engineCalls),
    cacheHits: sum((item) => item.cacheHits),
    workUsed: sum((item) => item.workUsed),
    workBudget: sharedWorkBudget,
    truncated: all.some((item) => item.truncated),
    refineSkipped: all.some((item) => item.refineSkipped),
    phasesCompleted: [...new Set(all.flatMap((item) => item.phasesCompleted))],
    searchPath: usePen ? 'penRate' : 'ordinary',
    penRatePathUsed: true,
    beamLayers: Math.max(...all.map((item) => item.beamLayers)),
    survivedRoutes: sum((item) => item.survivedRoutes),
    expandedRoutes: sum((item) => item.expandedRoutes),
    prunedRoutes: sum((item) => item.prunedRoutes),
    initialDropped: Math.max(...all.map((item) => item.initialDropped)),
    layerRatioDropped: sum((item) => item.layerRatioDropped),
    adaptiveBMin: bMins.length ? Math.min(...bMins) : 0,
    adaptiveBMax: Math.max(...all.map((item) => item.adaptiveBMax)),
    refinedRoutes: sum((item) => item.refinedRoutes),
  }
}

/**
 * 专路 2.0（2026-09-16 用户口径）：先把防御区定死，再分配剩余档数。
 *
 * 1. **种子**：`penRate` 字段「尽可能选走」（没有穿透率条目也行 → 只堆固穿的世界）；
 * 2. **落点解析求**：绑定世界真算一次 → `有效防御` → `n = ceil(有效防御 ÷ 每档值)`，
 *    被 cap / 额度 / 预算裁过；候选 = `{n−1, n}`（堆到底时只有一个）；
 * 3. 每个候选跑一条**专路世界**（防御区一族不再进池，其余照跑门槛）；
 * 4. **先跑专路，剩下的算力给普通路**；最后两边比最终总伤。
 *
 * 预算分配是**暂定**的：每个专路世界先拿 `剩余 ÷ (世界数 + 1)`，没用完的留给普通路。
 * 实测后可能再调（见 `dev-docs/词条最优分配改造方案.md` §6.3）。
 */
function* solveSearchWithPenPath(
  input: AffixOptimizerInput,
): Generator<AffixOptimizerProgress, SearchOutcome, void> {
  if (input.enablePenRatePath === false) return yield* solveSearch(input, 'ordinary')

  const entries = input.entries
  const totalRolls = resolveAffixOptimizerBudget(input.ctx, input.maxTotalRolls).maxTotalRolls
  const baseFixed = normalizeRolls(input.fixedRollsByEntryId ?? {})
  const groupCaps = input.groupCaps ?? {}
  const capTaxes = input.entryCapTaxes ?? []
  const sharedWorkBudget = resolveSearchWorkBudget(input)
  const pricePerEval = workPricePerEval(input.ctx)

  // ---------- ① 种子：穿透率「尽可能选走」 ----------
  const penLocks = collectPenRateFieldLocks(entries, baseFixed, groupCaps, totalRolls, capTaxes)
  const lockedRolls = { ...baseFixed, ...penLocks }
  const hasDefenseZoneEntry = entries.some((entry) => isDefenseZoneAffixTarget(entry.target))
  if (!hasDefenseZoneEntry) return yield* solveSearch(input, 'ordinary')

  // ---------- ② 落点：解析求固穿梯子 ----------
  const lockedProbe = evaluateWorldOnce(input.ctx, entries, lockedRolls)
  const planCost = pricePerEval
  const ladder = resolveFlatPenLadder({
    entries,
    lockedRolls,
    effectiveDefense: lockedProbe.effectiveDefense,
    groupCaps,
    maxTotalRolls: totalRolls,
    capTaxes,
  })

  // ---------- ③ 专路世界：先跑，剩余算力给普通路 ----------
  const candidates = ladder?.candidates ?? [0]
  const penOutcomes: SearchOutcome[] = []
  let penWorkLeft =
    sharedWorkBudget == null ? null : Math.max(0, sharedWorkBudget - planCost)
  for (const extraRolls of candidates) {
    const worldFixed = { ...lockedRolls }
    if (ladder) worldFixed[ladder.entryId] = (worldFixed[ladder.entryId] ?? 0) + extraRolls
    const worldsLeft = candidates.length - penOutcomes.length
    const allowance =
      penWorkLeft == null ? undefined : Math.floor(penWorkLeft / Math.max(1, worldsLeft + 1))
    const worldInput: AffixOptimizerInput = {
      ...input,
      fixedRollsByEntryId: worldFixed,
      enablePenRatePath: false,
      excludeDefenseZoneFromPool: true,
      ...(allowance != null ? { maxWorkUnits: allowance } : {}),
    }
    const outcome = yield* solveSearch(worldInput, 'penRate')
    penOutcomes.push(outcome)
    if (penWorkLeft != null) penWorkLeft = Math.max(0, penWorkLeft - outcome.workUsed)
  }
  void planCost

  // ---------- ④ 普通路：剩下的算力全给它（兜底） ----------
  const penUsed = penOutcomes.reduce((total, item) => total + item.workUsed, 0) + planCost
  const ordinaryInput: AffixOptimizerInput =
    sharedWorkBudget == null
      ? input
      : { ...input, maxWorkUnits: Math.max(0, sharedWorkBudget - penUsed) }
  const ordinary = yield* solveSearch(ordinaryInput, 'ordinary')
  return mergeSearchOutcomes(ordinary, penOutcomes, sharedWorkBudget)
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
