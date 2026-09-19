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
 * ## 搜索策略：比例 + 保底的多路线 Beam（2026-09-17 定稿：删换档、删自适应 B）
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
 * 5. 同一 `usedRolls` 桶内按**三件套**定宽度：先按**累计提升比例**（`routeRetentionRatio`）筛；
 *    筛完不足 `minRetainedRoutes` 条时按累计提升从高到低**补足**（只补正提升）；
 *    超过 `maxRetainedRoutes` 条时按累计提升从高到低**截顶**（设计内行为，不算 truncated）。
 * 6. `maxWorkUnits` 只是**刹车**：预算**只挡在每次真实评估之前**（缓存命中不计价），
 *    本层按总伤从高到低开，**花光为止**；已经评估过的路线照常进终选。
 *    它**不参与任何宽度决策**（不截顶，也不因为"下一层估不满"就停掉整个搜索）。
 *
 * 2026-09-17 删掉的两样（用户口径，别再往回加）：
 * - **1/2-swap 换档精修**：实测 0 贡献（200k 与 600k 预算总伤完全相同），纯成本；
 * - **自适应 B**：由剩余预算反推宽度会让「同一份参数在不同机器/流程上留不同条数」，
 *   不可解释、不可复现；宽度改成只由路线保留比例 + 最小保留路线决定。
 *
 * **穿透专路**：把已启用的 `main:slot5:penRate` / `set:penRate:8` 锁满（它们**绕过**
 * 初始门槛、路线比例与保底，直接进 `fixedRolls`），在带穿透率的面板上重新测量、
 * 形成**专路独立候选池**，再跑同一套 Beam；最后与普通路比最终总伤。
 * 防御区 24+8+固穿是正协同，单档排序看不见整套，所以必须另开一路。
 *
 * ## 计算量预算
 *
 * - 一次评估的计价 = `1 + 命中数`（实测拟合良好，见 `dev-docs/affix-optimizer-impl-log.md`）。
 * - 缓存命中只花真算约 1% 的时间，因此**不计入**计算量消耗。
 * - `maxWorkUnits` 是**纯刹车**（默认 20 万）：只决定「跑不跑得完」，不决定宽度。
 *   撞到它时**不停整个搜索**，只是停止花钱：本层按总伤从高到低能开多少开多少，
 *   后面的层不再扩展（已评估的状态照常参与终选），并把 `truncated` 标成 true。
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
  /**
   * 最小保留路线数（1..64）：比例筛完**不足这么多条**时，按本层累计提升从高到低**补足**
   * （只补有正提升的路线）。
   *
   * 语义与候选级的 `initialCandidateFloor` 同构：比例挡的是「不像赢家」，它挡的是「被筛空」。
   * 它是**下限**，与 `maxRetainedRoutes`（上限）成对使用。
   */
  minRetainedRoutes: number
  /**
   * 最大保留路线数（1..64）：比例筛完**超过这么多条**时，按本层累计提升从高到低**截顶**。
   *
   * 2026-09-17 用户口径：比例筛管不住宽度（同层大量路线都在比例线以内），
   * 所以「比例 + 下限 + 上限」三件套缺一不可 —— 上限是防爆宽度的唯一保险。
   * 上限截顶不算 `truncated`（它是设计内行为，不是预算吃紧）。
   */
  maxRetainedRoutes: number
  /**
   * 候选兜底（每组保底前 N 名，0 = 关掉）：按**单档收益**在组内排名前 N 的条目**无论如何保留**。
   *
   * 保留判定 = 比例过线 **或** 组内排名 < N（取保留更多者）。**只救有正收益的条目** ——
   * 零收益仍然只在门槛线 = 0（R=0）时才留下，负收益一律出局。
   *
   * 为什么要有它：门槛的线是**在空盘上用单档**画的，天生看不见「基线上不值钱、终局里最值钱」的条目 ——
   * 典型是副词条爆伤（空盘暴击率只有 5% 时它单档只值组内最高的 ~10%，等暴击率顶满后它才是收益王）。
   * 兜底保证每组最优秀的那几条不会被比例线剪掉；实测（8 命中合成场景）它能把 R=0.15/0.5 的质量从
   * 90.91% 拉回 100%。
   *
   * 副作用（要有数）：每组 ≤ N 条时，门槛基本失效（只丢排名 ≥ N 的）—— 默认库上真正被筛的是
   * 「副词条」这种大组（10 条）；号位组（5~6 条）几乎不受门槛影响。
   */
  initialCandidateFloor: number
}

/** 候选兜底的合法范围（每组保底前几名的上限） */
export function clampAffixCandidateFloor(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return clampInt(value, 0, 64)
}

/**
 * 预设参数（2026-09-17 二次定稿：**比例 + 最小保留路线 + 最大保留路线**三件套）。
 *
 * 用户口径（原话数值）：
 * - 快速：1-2 条 / 比例 95%
 * - 均衡：2-5 条 / 比例 90%
 * - 精细：4-8 条 / 比例 50%
 *
 * 为什么必须有上限：比例筛的度量是「累计提升 ≥ 本层最佳 × 比例」，同层大量路线都在这条线以内
 * （实测 9 池 34 档场景，比例 80% 时单层能活几百条），**比例管不住宽度**——
 * 去上限那版实测把预算刹车逼停（20 万只花掉 3.9 万、34 档只走 9 层），
 * 所以宽度 = 「比例筛 → 不足 min 补足 → 超过 max 截顶」。
 *
 * 同时保留 `initialCandidateThreshold`（组内单档比例）与 `initialCandidateFloor`（候选兜底 5）：
 * 依据见 `dev-docs/词条最优分配.md`「实测口径」。
 */
export const AFFIX_SEARCH_PRESETS: Record<Exclude<AffixSearchPresetId, 'custom'>, AffixSearchParams> = {
  fast: { initialCandidateThreshold: 0.8, initialCandidateFloor: 5, routeRetentionRatio: 0.95, minRetainedRoutes: 1, maxRetainedRoutes: 2 },
  balanced: { initialCandidateThreshold: 0.5, initialCandidateFloor: 5, routeRetentionRatio: 0.9, minRetainedRoutes: 2, maxRetainedRoutes: 5 },
  fine: { initialCandidateThreshold: 0.2, initialCandidateFloor: 5, routeRetentionRatio: 0.5, minRetainedRoutes: 4, maxRetainedRoutes: 8 },
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

/**
 * 最小保留路线数的合法范围（1..64）。
 *
 * `fallback` 默认 3 = 均衡预设值：调用方没给值时按「均衡」兜底。
 */
export function clampAffixMinRetainedRoutes(value: number | undefined, fallback = 3): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(64, Math.round(value)))
}

/**
 * 最大保留路线数的合法范围（1..64）。
 *
 * `fallback` 默认 5 = 均衡预设值：调用方没给值时按「均衡」兜底。
 */
export function clampAffixMaxRetainedRoutes(value: number | undefined, fallback = 5): number {
  if (value == null || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(64, Math.round(value)))
}

/**
 * 解析生效的搜索参数：预设给底、显式值覆盖。`custom` 用「均衡」打底再让用户值覆盖。
 */
export function resolveAffixSearchParams(input: {
  searchPreset?: AffixSearchPresetId
  initialCandidateThreshold?: number
  initialCandidateFloor?: number
  routeRetentionRatio?: number
  minRetainedRoutes?: number
  maxRetainedRoutes?: number
}): AffixSearchParams {
  const preset = input.searchPreset ?? DEFAULT_AFFIX_SEARCH_PRESET
  const base = AFFIX_SEARCH_PRESETS[preset === 'custom' ? 'balanced' : preset]
  return {
    initialCandidateThreshold: clampAffixUnitRatio(
      input.initialCandidateThreshold,
      base.initialCandidateThreshold,
    ),
    initialCandidateFloor: clampAffixCandidateFloor(
      input.initialCandidateFloor,
      base.initialCandidateFloor,
    ),
    routeRetentionRatio: clampAffixUnitRatio(input.routeRetentionRatio, base.routeRetentionRatio),
    // 上限永远是上限：给了「最小 > 最大」这种矛盾输入时压低的是下限（保底让位于截顶），
    // 这样界面上的「最大保留 N 条」在任何参数组合下都字面成立。
    maxRetainedRoutes: clampAffixMaxRetainedRoutes(
      input.maxRetainedRoutes,
      base.maxRetainedRoutes,
    ),
    minRetainedRoutes: Math.min(
      clampAffixMinRetainedRoutes(input.minRetainedRoutes, base.minRetainedRoutes),
      clampAffixMaxRetainedRoutes(input.maxRetainedRoutes, base.maxRetainedRoutes),
    ),
  }
}

/** @deprecated 旧的候选宽度模式，已被「初始候选门槛 + 路线保留比例 + 最小保留路线」取代；保留仅为旧脚本不报错。 */
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
  /** 候选兜底：每组保底前 N 名（0 = 关掉）；显式值覆盖预设 */
  initialCandidateFloor?: number
  /** 路线保留比例（0..1）；显式值覆盖预设 */
  routeRetentionRatio?: number
  /** 最小保留路线数（1..64）：比例筛完不足这么多条时的保底下限；显式值覆盖预设 */
  minRetainedRoutes?: number
  /** 最大保留路线数（1..64）：比例筛完超过这么多条时的截顶上限；显式值覆盖预设 */
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
   * 「不消耗总词条数」的组名（组规则 `AffixLibraryGroup.excludedFromTotalRolls`，见 `affixLibrary`）。
   *
   * 语义：这些组条目的**基础占用**不计入总词条数（每档那 1 个词条不算），**冲突额外 x 照算**
   * （付费条目 `rollCost = 1 + x` → 预算里只记 `rollCost − 1`）。
   *
   * **层推进不受影响**：层仍按 `rollCost` 计（每加一条至少推进 1 档），所以搜索结构、同层比较完全不变 ——
   * 变的只是"还剩多少预算"这一个数。这正是"预算轴分前后、组间不分前后"的精确写法：
   * 不必先放宽预算再事后减回（那种补丁在"组勾了但一条没选"时会把多出来的档漏给副词条）。
   *
   * 缺省空数组 = 所有条目照常占预算（普通模式的默认行为）。
   */
  freeRollGroups?: string[]
  /**
   * 跨条目 cap 税：`whenEntryId` 已有档时，`targetEntryId` 的有效上限再减 `amount`。
   * 游戏专用规则用来表达「号位选了攻击% → 副词条攻击% 少 1 档」。默认库不传。
   */
  entryCapTaxes?: AffixEntryCapTax[]
  /** @deprecated 被 `minRetainedRoutes` 取代，传入即忽略。 */
  candidateWidthMode?: AffixCandidateWidthMode
  /** @deprecated 被 `minRetainedRoutes` 取代，传入即忽略。 */
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
  /** 初始候选门槛永久淘汰的条目数 */
  initialDropped: number
  /** 其中靠「每组保底前 N 名」兜底救回来的条目数 */
  initialFloorSaved: number
  /** 层内路线比例淘汰的路线数（各层累计；**含后来被最小保留路线补回的那些**） */
  layerRatioDropped: number
  /** 靠「最小保留路线」保底补回来的路线数（各层累计） */
  routeFloorSaved: number
  /** 被「最大保留路线」截顶丢掉的路线数（各层累计；设计内行为，不算 truncated） */
  routeCapDropped: number
}

/** 求解进度快照（异步驱动定期回调，用于 UI 显示） */
export interface AffixOptimizerProgress {
  phase: 'baseline' | 'measure' | 'beam' | 'done'
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
  /** 当前层存活路线数（比例筛 + 最小保留补足之后的**最终**条数） */
  survivedRoutes?: number
  /** 初始候选门槛永久淘汰条数 */
  initialDropped?: number
  /** 靠「每组保底前 N 名」兜底救回的条数 */
  initialFloorSaved?: number
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
 * 默认计算量预算（导出：游戏专用 4 口袋要按「每袋默认额度 × 袋数」建共享池）。
 * 原先按旧版 `maxEngineCalls = 4000` × 典型 8 命中计价 9 = 36000，
 * 长流程会在词条档数用尽前先撞上算力上限。提到 20 万。
 */
export const DEFAULT_WORK_BUDGET = 200000

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
 * 该条目在**预算**里要花几档。
 *
 * 与 `usedRollsOf`（层推进 / 显示口径）的区别只有一处：「不消耗总词条数」的组（`freeRollGroups`）
 * **基础占用不算**，只算冲突额外 —— 付费条目 `rollCost = 1 + x`，于是预算记 `x`；普通条目记 0。
 */
function budgetRollCostOf(entry: AffixLibraryEntry, freeRollGroups: ReadonlySet<string>): number {
  const cost = Math.max(1, entry.rollCost)
  return freeRollGroups.has(entry.group) ? Math.max(0, cost - 1) : cost
}

/** 已用**预算**（`usedRollsOf` 的预算版：豁免组的基础档不算） */
function budgetUsedRollsOf(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
  freeRollGroups: ReadonlySet<string>,
): number {
  let used = 0
  for (const entry of entries) {
    const count = rollsByEntryId[entry.id] ?? 0
    if (count <= 0) continue
    used += count * budgetRollCostOf(entry, freeRollGroups)
  }
  return used
}

/**
 * 解析出**真正生效**的「不占数」组，并算出层循环需要多走多少档。
 *
 * - 只认**有界**的组：组额度与组内条目 cap 都有限才算（无界会让层推进没有上界，搜索一直长下去）；
 * - 层推进按 `rollCost` 计，而这些组的基础档不进预算 → 层循环上界要把它们补回来
 *   （否则"拿了豁免组条目"的状态会被 `nextUsed > maxUsed` 提前丢掉）。
 */
function resolveFreeRollGroups(
  input: AffixOptimizerInput,
  entries: AffixLibraryEntry[],
  groupCaps: Record<string, number>,
  maxRollsPerEntry: number,
): { groups: Set<string>; layerHeadroom: number } {
  const groups = new Set<string>()
  let layerHeadroom = 0
  for (const name of input.freeRollGroups ?? []) {
    const capOfGroup = groupCapFor(groupCaps, name)
    let headroom = 0
    let bounded = true
    for (const entry of entries) {
      if (entry.group !== name) continue
      const perEntry = entryCapLimit(entry, maxRollsPerEntry, 0)
      const maxCount = Number.isFinite(capOfGroup) ? Math.min(capOfGroup, perEntry) : perEntry
      if (!Number.isFinite(maxCount)) {
        bounded = false
        break
      }
      headroom += maxCount * Math.max(1, entry.rollCost)
    }
    if (!bounded) continue
    groups.add(name)
    layerHeadroom += headroom
  }
  return { groups, layerHeadroom }
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
  /** 已用**预算**档数（不是层口径：豁免组的基础档不算） */
  budgetUsedRolls: number,
  rolls: Record<string, number>,
  entries: AffixLibraryEntry[],
  maxRollsPerEntry: number,
  groupCaps: Record<string, number>,
  capTaxes: readonly AffixEntryCapTax[],
  /** 该条目在预算里要花几档（豁免组只算冲突额外，可能为 0 = 不花预算） */
  budgetCost: number,
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
  const rollRoom =
    budgetCost <= 0
      ? Number.POSITIVE_INFINITY
      : Math.floor((budget.maxTotalRolls - budgetUsedRolls) / budgetCost)
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
  /** 「不消耗总词条数」的组（见 `AffixOptimizerInput.freeRollGroups`）—— 种子也要按**预算**口径判 */
  freeRollGroups: Iterable<string> = [],
): Record<string, number> {
  const budget = {
    maxTotalRolls,
    rollCapOf: () => Number.POSITIVE_INFINITY,
  } as AffixOptimizerBudget
  const freeGroups = new Set(freeRollGroups)
  const next = { ...fixedRolls }
  const locks: Record<string, number> = {}
  let lockedPenRate = 0
  for (const entry of entries) {
    if (!isPenRateAffixTarget(entry.target)) continue
    // 防呆上限：正常条目会被 cap / 组额度 / 预算先掐住
    for (let guard = 0; guard < 64; guard += 1) {
      if (lockedPenRate + entry.perRoll > DEFENSE_ZONE_PEN_RATE_CAP) break
      const used = budgetUsedRollsOf(entries, next, freeGroups)
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
        budgetRollCostOf(entry, freeGroups),
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
  /** 「不消耗总词条数」的组（见 `AffixOptimizerInput.freeRollGroups`）—— 梯子也按预算口径裁 */
  freeRollGroups?: string[]
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
  const freeGroups = new Set(input.freeRollGroups ?? [])
  const used = budgetUsedRollsOf(input.entries, locked, freeGroups)
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
    budgetRollCostOf(primary, freeGroups),
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
  /** 层口径：按 `rollCost` 累加（每加一条至少 +1），决定"这是第几层" */
  usedRolls: number
  /** 预算口径：豁免组（`freeRollGroups`）的基础档不算，只算冲突额外 */
  budgetUsed: number
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
  phasesCompleted: string[]
  searchPath: 'ordinary' | 'penRate'
  penRatePathUsed: boolean
  searchParams: AffixSearchParams
  beamLayers: number
  survivedRoutes: number
  expandedRoutes: number
  initialDropped: number
  /** 其中靠「每组保底前 N 名」兜底救回来的条目数 */
  initialFloorSaved: number
  layerRatioDropped: number
  /** 靠「最小保留路线」保底补回来的路线数（各层累计） */
  routeFloorSaved: number
  /** 被「最大保留路线」截顶丢掉的路线数（各层累计） */
  routeCapDropped: number
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
  // 「不占数」组：预算里不算它们的基础档（冲突额外 x 照算），层推进照旧按 rollCost 计
  const { groups: freeRollGroups, layerHeadroom } = resolveFreeRollGroups(
    input,
    entries,
    groupCaps,
    maxRollsPerEntry,
  )
  const maxUsed = budget.maxTotalRolls + layerHeadroom

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
  let liveInitialDropped = 0
  let liveInitialFloorSaved = 0

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
    ...(liveInitialDropped > 0 ? { initialDropped: liveInitialDropped } : {}),
    ...(liveInitialFloorSaved > 0 ? { initialFloorSaved: liveInitialFloorSaved } : {}),
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
      budgetUsed: budgetUsedRollsOf(entries, rolls, freeRollGroups),
      total,
      counts,
      panelDeltas,
      extraGains,
    }
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
      baselineState.budgetUsed,
      baselineState.rolls,
      entries,
      maxRollsPerEntry,
      groupCaps,
      capTaxes,
      budgetRollCostOf(entry, freeRollGroups),
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
  /** 组内名次：比它单档收益更高的**同组**条目数（0 = 组内第一） */
  const rankInGroup = new Map<string, number>()
  for (const entry of entries) {
    if (poolExcluded(entry)) continue
    const gain = initialGain.get(entry.id) ?? 0
    let rank = 0
    for (const other of entries) {
      if (other.id === entry.id || poolExcluded(other) || other.group !== entry.group) continue
      if ((initialGain.get(other.id) ?? 0) > gain) rank += 1
    }
    rankInGroup.set(entry.id, rank)
  }
  const floor = Math.max(0, Math.floor(params.initialCandidateFloor))
  let floorSaved = 0
  for (const entry of entries) {
    if (poolExcluded(entry)) continue
    const gain = initialGain.get(entry.id) ?? 0
    // 判定：先丢负收益；再过线（≥ 本组最高 × 比例）；没过线但**组内排名 < 兜底名次**的也留
    if (gain < 0) continue
    const cutoff = (bestGainByGroup.get(entry.group) ?? 0) * params.initialCandidateThreshold
    if (gain >= cutoff) {
      pool.push(entry)
      continue
    }
    if (floor > 0 && gain > 0 && (rankInGroup.get(entry.id) ?? Number.POSITIVE_INFINITY) < floor) {
      pool.push(entry)
      floorSaved += 1
    }
  }
  const initialDropped = entries.filter((entry) => !poolExcluded(entry)).length - pool.length
  liveInitialDropped = initialDropped
  liveInitialFloorSaved = floorSaved
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
  let layerRatioDropped = 0
  let routeFloorSaved = 0
  let routeCapDropped = 0
  /** 最小保留路线数（1..64）：比例筛完不足这么多条时补足 */
  const minRetained = clampInt(params.minRetainedRoutes, 1, 64)
  /** 最大保留路线数（1..64）：比例筛完超过这么多条时按总伤截顶 */
  const maxRetained = clampInt(params.maxRetainedRoutes, 1, 64)

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

      // 最小保留路线：比例筛完不足 N 条时，按本层累计提升从高到低补足（**只补正提升**）。
      // 语义与候选级的「每组保底前 N 名」同构：比例管"像不像赢家"，它管"别被筛空"。
      afterRatio.sort((a, b) => b.total - a.total)
      let finalStates = afterRatio
      if (afterRatio.length < minRetained) {
        const inRatio = new Set(afterRatio)
        const saved = unique
          .filter((state) => !inRatio.has(state) && state.total - baselineDamage > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, minRetained - afterRatio.length)
        if (saved.length) {
          routeFloorSaved += saved.length
          finalStates = [...afterRatio, ...saved]
        }
      }
      // 最大保留路线：比例筛管不住宽度（同层大量路线都在比例线内），超上限就按总伤截顶。
      // 上限截顶是**设计内行为**，不算 truncated（不是预算吃紧）。
      if (finalStates.length > maxRetained) {
        routeCapDropped += finalStates.length - maxRetained
        finalStates = finalStates.slice(0, maxRetained)
      }
      survivorsByUsed.set(used, finalStates)
      beamLayers += 1
      layerUsedRolls = used
      liveSurvived = finalStates.length
      yield snapshot()

      if (!finalStates.length) continue

      // 预算刹车（2026-09-17 重写）：旧写法按「本层路线数 × 池大小 × 单价」估下一层最坏成本，
      // 估不满就**停掉整个搜索** —— 去掉上限之后一层动辄几百条路线，这个最坏估算必然爆表
      // （实测：预算 20 万只花掉 3.9 万，34 档只走了 9 层）。
      // 新写法：预算只挡在**每次真实评估之前**（缓存命中不计价），按总伤从高到低开，花光为止。
      let budgetHit = false
      for (const state of finalStates) {
        const allowedOf = (entry: AffixLibraryEntry) =>
          remainingAllowedRolls(
            entry,
            state.rolls[entry.id] ?? 0,
            budget,
            state.budgetUsed,
            state.rolls,
            entries,
            maxRollsPerEntry,
            groupCaps,
            capTaxes,
            budgetRollCostOf(entry, freeRollGroups),
          ) > 0
        for (const entry of pool) {
          if (remainingWork() < pricePerEval) {
            budgetHit = true
            break
          }
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
        if (budgetHit) break
      }
      if (budgetHit) truncated = true
    }
  }
  phasesCompleted.push('beam')

  // ---------- 3. 终选：全部存活路线里比总伤，取最大 ----------
  //
  // 2026-09-17 去掉 1/2-swap 换档精修（实测 0 贡献，见文件头「搜索策略」说明）：
  // 终选就是「所有层留下的完整路线里，总伤最高的那条」。
  const finalists: BeamState[] = []
  for (const states of survivorsByUsed.values()) finalists.push(...states)
  finalists.sort((a, b) => b.total - a.total)
  const bestState: BeamState = finalists[0] ?? baselineState

  phase = 'done'

  return {
    rollsByEntryId: normalizeRolls(bestState.rolls),
    state: bestState,
    baselineDamage,
    engineCalls,
    cacheHits,
    workUsed,
    workBudget,
    truncated,
    phasesCompleted,
    searchPath,
    penRatePathUsed: false,
    searchParams: params,
    beamLayers,
    survivedRoutes: finalists.length,
    expandedRoutes,
    initialDropped,
    initialFloorSaved: floorSaved,
    layerRatioDropped,
    routeFloorSaved,
    routeCapDropped,
  }
}

function toResult(input: AffixOptimizerInput, outcome: SearchOutcome): AffixOptimizerResult {
  const { baselineDamage, state } = outcome
  const improvementPercent = baselineDamage > 0
    ? ((state.total - baselineDamage) / baselineDamage) * 100
    : 0
  // 报给用户看的 `usedRolls` 是**预算口径**（「不占数」组的基础档不算）——与求解时的约束同一套算法
  const { groups: freeRollGroups } = resolveFreeRollGroups(
    input,
    input.entries,
    input.groupCaps ?? {},
    input.maxRollsPerEntry ?? resolveAffixOptimizerBudget(input.ctx, input.maxTotalRolls).maxTotalRolls,
  )

  return {
    rollsByEntryId: outcome.rollsByEntryId,
    counts: state.counts,
    panelDeltas: state.panelDeltas,
    extraGains: state.extraGains,
    valuePerCount: affixValuePerCountFromEntries(input.entries),
    totalDamage: state.total,
    baselineDamage,
    improvementPercent,
    usedRolls: budgetUsedRollsOf(input.entries, outcome.rollsByEntryId, freeRollGroups),
    maxTotalRolls: resolveAffixOptimizerBudget(input.ctx, input.maxTotalRolls).maxTotalRolls,
    engineCalls: outcome.engineCalls,
    cacheHits: outcome.cacheHits,
    workUsed: outcome.workUsed,
    workBudget: outcome.workBudget,
    truncated: outcome.truncated,
    phasesCompleted: outcome.phasesCompleted,
    penRatePathUsed: outcome.penRatePathUsed,
    winningPath: outcome.searchPath,
    searchParams: outcome.searchParams,
    beamLayers: outcome.beamLayers,
    survivedRoutes: outcome.survivedRoutes,
    expandedRoutes: outcome.expandedRoutes,
    initialDropped: outcome.initialDropped,
    initialFloorSaved: outcome.initialFloorSaved,
    layerRatioDropped: outcome.layerRatioDropped,
    routeFloorSaved: outcome.routeFloorSaved,
    routeCapDropped: outcome.routeCapDropped,
  }
}

/**
 * 汇总：普通路 + 全部专路世界，**比最终总伤取最大**（中间不交汇）。
 *
 * 统计量跨世界求和（引擎调用 / 计算量 / 存活路线…），`searchPath` 取赢家那条。
 *
 * `probeCost` = 专路开跑前那次「锁满穿透率的世界真算」（`evaluateWorldOnce`，走原始引擎、
 * 不经过缓存与计数通道）。它本来就是真实开销、也已被预算预留（`planCost`），
 * 所以在这里补记一次评估 —— 不补的话「N 次评估 / 计算量 X」会比实际少一次（2026-09-17 修）。
 */
function mergeSearchOutcomes(
  ordinary: SearchOutcome,
  penWorlds: SearchOutcome[],
  sharedWorkBudget: number | null,
  probeCost = 0,
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
  return {
    ...winner,
    baselineDamage: ordinary.baselineDamage,
    engineCalls: sum((item) => item.engineCalls) + (probeCost > 0 ? 1 : 0),
    cacheHits: sum((item) => item.cacheHits),
    workUsed: sum((item) => item.workUsed) + probeCost,
    workBudget: sharedWorkBudget,
    truncated: all.some((item) => item.truncated),
    phasesCompleted: [...new Set(all.flatMap((item) => item.phasesCompleted))],
    searchPath: usePen ? 'penRate' : 'ordinary',
    penRatePathUsed: true,
    beamLayers: Math.max(...all.map((item) => item.beamLayers)),
    survivedRoutes: sum((item) => item.survivedRoutes),
    expandedRoutes: sum((item) => item.expandedRoutes),
    initialDropped: Math.max(...all.map((item) => item.initialDropped)),
    initialFloorSaved: Math.max(...all.map((item) => item.initialFloorSaved)),
    layerRatioDropped: sum((item) => item.layerRatioDropped),
    routeFloorSaved: sum((item) => item.routeFloorSaved),
    routeCapDropped: sum((item) => item.routeCapDropped),
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
  const penLocks = collectPenRateFieldLocks(
    entries,
    baseFixed,
    groupCaps,
    totalRolls,
    capTaxes,
    input.freeRollGroups ?? [],
  )
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
    freeRollGroups: input.freeRollGroups ?? [],
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
  // ---------- ④ 普通路：剩下的算力全给它（兜底） ----------
  const penUsed = penOutcomes.reduce((total, item) => total + item.workUsed, 0) + planCost
  const ordinaryInput: AffixOptimizerInput =
    sharedWorkBudget == null
      ? input
      : { ...input, maxWorkUnits: Math.max(0, sharedWorkBudget - penUsed) }
  const ordinary = yield* solveSearch(ordinaryInput, 'ordinary')
  return mergeSearchOutcomes(ordinary, penOutcomes, sharedWorkBudget, planCost)
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

/**
 * 展示行（结果表 / 标签摘要共用）的**排序契约**（2026-09-17 用户定）：
 *
 * 1. **组优先**：4 号位 → 5 号位 → 6 号位 → 2 件套 → 副词条（与游戏专用弹窗的页签同序）；
 *    库外自定义组排在最后，组间按组名中文序；
 * 2. 组内按**分配档数降序**；
 * 3. 同档数按词条名中文序；名字也相同则保持条目在库内的原始顺序（sort 稳定）。
 *
 * 为什么组优先：只看档数时表会「跳组」（副词条顶到最前、号位散在后面），读起来像没规则。
 */
export const AFFIX_ALLOC_GROUP_ORDER = ['4号位', '5号位', '6号位', '2件套', '副词条'] as const

function compareAllocGroup(a: string, b: string): number {
  const rank = (group: string): number => {
    const index = (AFFIX_ALLOC_GROUP_ORDER as readonly string[]).indexOf(group)
    return index >= 0 ? index : AFFIX_ALLOC_GROUP_ORDER.length
  }
  const diff = rank(a) - rank(b)
  return diff !== 0 ? diff : a.localeCompare(b, 'zh')
}

/** 把求解结果整理成展示行（组优先 → 组内按档数降序，见 `AFFIX_ALLOC_GROUP_ORDER`） */
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
  rows.sort((a, b) =>
    compareAllocGroup(a.entry.group, b.entry.group) ||
    b.rolls - a.rolls ||
    a.entry.label.localeCompare(b.entry.label, 'zh'),
  )
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
