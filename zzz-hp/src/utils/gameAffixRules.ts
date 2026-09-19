import {
  AFFIX_PRESET_GROUPS,
  createPresetAffixLibraryEntries,
  type AffixLibraryEntry,
  type AffixLibraryGroup,
} from '@/utils/affixLibrary'
import {
  DEFAULT_WORK_BUDGET,
  solveOptimalAffixAllocationAsync,
  type AffixEntryCapTax,
  type AffixOptimizerAsyncOptions,
  type AffixOptimizerInput,
  type AffixOptimizerProgress,
  type AffixOptimizerResult,
  type AffixSearchPresetId,
} from '@/utils/affixOptimizer'
import type { OptimalEvalContext } from '@/utils/optimalAffixAlloc'

/**
 * 游戏专用规则分配：一份写死方案，不进官方词条库。
 *
 * 副词条每条上限**可设**（`substatEntryCap`，默认 30，0 = 无上限；对副词条组内每条分别生效）。
 * 付费判定标准 =「该主属性字段在副词条池里也有同 target 条目」
 * （游戏里副词条不会与主属性重复）：
 *
 * - **4 号位 6 条全部付费** —— 爆伤 / 暴击 / 攻击 / 生命 / 精通 / 防御 在副词条池里全都有；
 * - **5 / 6 号位只有攻击 / 生命 / 防御付费** —— 增伤 / 穿透率 / 异常掌控 / 冲击力 / 能量恢复
 *   这几种在副词条池里没有对应条目（副词条是固定穿透 `pen`，不是穿透率 `penRate`）。
 *
 * 付费 = 分到档则总分配再扣 extraCost（x），并扣副词条里对应条目 cap 5。
 * 4/5/6 与 2 件套组额度锁 1；副词条组额度 = 总分配数（**不预扣**那 4 档 —— 2026-09-18 改：
 * 那四组买几档就从总预算里扣几档，勾掉或不买时省下的档留给副词条）。
 * 外层 **4 路**（5 / 6 各自付费或不付费；4 号位恒付费，不再有「不付费」分支）
 * 再跑现有 Beam + 换档。
 *
 * 勾选默认全开（含 2 件套）。已写入本机的勾选原样读取，不再改写。
 * 官方词条库里 2 件套 `enabledByDefault: false` 只防「求最优分配」叠导入面板，不套用到本方案。
 */

export const GAME_AFFIX_STORAGE_KEY = 'zzz-hp-game-affix-rules-v1'
export const GAME_AFFIX_EXTRA_COST_DEFAULT = 1
export const GAME_PAID_SUBSTAT_TAX = 5
/**
 * 副词条**每条**的默认上限（用户可在弹窗里改；0 = 无上限）。
 *
 * 口径：对**副词条组内每个条目分别生效**（不是整组共享），与 `createGameAffixGroups`
 * 给的「组额度 = 总词条数」是两层约束 —— 组额度管总量，这个管单条能叠多少档。
 */
export const GAME_AFFIX_SUBSTAT_ENTRY_CAP_DEFAULT = 30

/**
 * 每个槽位算「付费」的主属性 key。
 *
 * 4 号位 6 条全在与副词条重复之列，故整槽付费；5 / 6 号位只认攻 / 生 / 防。
 * 改这张表必须同步 `PAID_MAIN_TO_SUBSTAT`（每条付费 key 都要有被它挤占的副词条）。
 */
const SLOT_PAID_KEYS: Record<4 | 5 | 6, readonly string[]> = {
  4: [
    'critDmg',
    'critRate',
    'externalAtkPercent',
    'externalHpPercent',
    'mastery',
    'externalDefPercent',
  ],
  5: ['externalAtkPercent', 'externalHpPercent', 'externalDefPercent'],
  6: ['externalAtkPercent', 'externalHpPercent', 'externalDefPercent'],
}

/** 付费主属性 key → 被它挤占上限的副词条 id（扣 `GAME_PAID_SUBSTAT_TAX` 档） */
const PAID_MAIN_TO_SUBSTAT: Record<string, string> = {
  externalAtkPercent: 'substat:atkPercent',
  externalHpPercent: 'substat:hpPercent',
  externalDefPercent: 'substat:defPercent',
  critDmg: 'substat:critDmg',
  critRate: 'substat:critRate',
  mastery: 'substat:mastery',
}

export type GameSlotPocket = 'paid' | 'free'

/** 外层只枚举 5 / 6 两维（4 号位恒付费），故是 4 袋 */
export interface GamePocketCombo {
  slot5: GameSlotPocket
  slot6: GameSlotPocket
}

export interface GameAffixRulesSettings {
  extraCost: number
  /**
   * 副词条**每条**的档数上限（0 = 无上限）；默认 30。
   *
   * 弹窗里那个「所有副词条条目上限（默认 30）」输入格，对副词条组内**每个条目分别**生效。
   */
  substatEntryCap: number
  enabledIds: string[]
}

export function gamePaidMainId(slot: 4 | 5 | 6, key: string): string {
  return `main:slot${slot}:${key}`
}

/** 该主属性 id 是否算「付费」（按槽位查付费 key 表，不看字面 key 单集合） */
export function isGamePaidMainId(id: string): boolean {
  const match = /^main:slot([456]):(.+)$/.exec(id)
  if (!match) return false
  const slot = Number(match[1]) as 4 | 5 | 6
  return SLOT_PAID_KEYS[slot].includes(match[2]!)
}

export function parseGamePaidMainId(id: string): { slot: 4 | 5 | 6; key: string } | null {
  if (!isGamePaidMainId(id)) return null
  const match = /^main:slot([456]):(.+)$/.exec(id)!
  return {
    slot: Number(match[1]) as 4 | 5 | 6,
    key: match[2]!,
  }
}

export const GAME_POCKET_COMBOS: GamePocketCombo[] = (['paid', 'free'] as const).flatMap((slot5) =>
  (['paid', 'free'] as const).map((slot6) => ({ slot5, slot6 })),
)

export function gamePocketLabel(combo: GamePocketCombo): string {
  const bit = (pocket: GameSlotPocket) => (pocket === 'paid' ? '付费' : '不付费')
  // 4 号位恒付费、不进标签（每袋都一样，写出来只是噪声）；规则细节在编辑弹窗里说明
  return `5${bit(combo.slot5)} 6${bit(combo.slot6)}`
}

export function createGameAffixLibraryEntries(
  substatEntryCap: number = GAME_AFFIX_SUBSTAT_ENTRY_CAP_DEFAULT,
): AffixLibraryEntry[] {
  // 0 = 不限（模型里 cap 0 就是"不限"，与词条库一致）
  const cap = clampGameSubstatEntryCap(substatEntryCap)
  return createPresetAffixLibraryEntries().map((entry) => {
    if (entry.group !== '副词条') return { ...entry }
    return { ...entry, cap }
  })
}

export function createGameAffixGroups(maxTotalRolls: number): AffixLibraryGroup[] {
  // 副词条组额度 = 总词条数（**不预扣** 4/5/6 与 2 件套 的那 4 档）。
  //
  // 2026-09-18 用户口径：旧写法 `总词条数 − 4` 是凭空预扣 —— 它假设那四组一定各买 1 档，
  // 可用户能在弹窗里勾掉（例如不带 2 件套），求解器也可能不买（主属性不如副词条划算）。
  // 买了才占预算：主属性 / 2 件套 的 `rollCost`（付费 1 + x）本来就在总预算里扣，
  // 总量由 `maxTotalRolls` 兜住，不需要再提前留位。
  const substatCap = Math.max(0, Math.round(maxTotalRolls))
  return AFFIX_PRESET_GROUPS.map((group) => {
    if (group.name === '副词条') return { ...group, cap: substatCap }
    // 2 件套 / 4 / 5 / 6 号位：额度锁 1，且**不消耗总词条数**（2026-09-18 用户方案「给 2456 都加上」）——
    // 用户只看副词条数，主属性 / 套装买了不该从那个数里扣；冲突条目的额外 x 仍照扣（见 affixLibrary 的字段注释）。
    if (group.name === '2件套' || /号位$/.test(group.name)) {
      return { ...group, cap: 1, excludedFromTotalRolls: true }
    }
    return { ...group }
  })
}

export function defaultGameAffixEnabledIds(entries: AffixLibraryEntry[]): string[] {
  return entries.map((entry) => entry.id)
}

export function clampGameExtraCost(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(20, Math.round(value))
}

/**
 * 副词条条目上限的合法范围：**0..64，0 = 无上限**。
 *
 * 非法值（NaN / 负数 / 非数字）走 `fallback`（默认 30），不是走 0 ——
 * 存档损坏时保持"默认 30"的老行为，比悄悄变成"不限"安全（不限会放大搜索空间）。
 */
export function clampGameSubstatEntryCap(
  value: unknown,
  fallback: number = GAME_AFFIX_SUBSTAT_ENTRY_CAP_DEFAULT,
): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(64, Math.round(n))
}

export function loadGameAffixRulesSettings(entries: AffixLibraryEntry[]): GameAffixRulesSettings {
  const fallback: GameAffixRulesSettings = {
    extraCost: GAME_AFFIX_EXTRA_COST_DEFAULT,
    substatEntryCap: GAME_AFFIX_SUBSTAT_ENTRY_CAP_DEFAULT,
    enabledIds: defaultGameAffixEnabledIds(entries),
  }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(GAME_AFFIX_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<GameAffixRulesSettings>
    const known = new Set(entries.map((entry) => entry.id))
    const enabledIds = Array.isArray(parsed.enabledIds)
      ? parsed.enabledIds.filter((id) => typeof id === 'string' && known.has(id))
      : fallback.enabledIds
    return {
      extraCost: clampGameExtraCost(Number(parsed.extraCost)),
      // 老存档没有这个键 → 默认 30（等于旧行为）；`undefined` 会让 Number() 变 NaN → 走 fallback ✓
      substatEntryCap: clampGameSubstatEntryCap(parsed.substatEntryCap, fallback.substatEntryCap),
      enabledIds: enabledIds.length ? enabledIds : fallback.enabledIds,
    }
  } catch {
    return fallback
  }
}

export function saveGameAffixRulesSettings(settings: GameAffixRulesSettings): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    GAME_AFFIX_STORAGE_KEY,
    JSON.stringify({
      extraCost: clampGameExtraCost(settings.extraCost),
      substatEntryCap: clampGameSubstatEntryCap(settings.substatEntryCap),
      enabledIds: settings.enabledIds,
    }),
  )
}

function pocketOfSlot(combo: GamePocketCombo, slot: 5 | 6): GameSlotPocket {
  return slot === 5 ? combo.slot5 : combo.slot6
}

function slotOfMainId(id: string): 4 | 5 | 6 | null {
  const match = /^main:slot([456]):/.exec(id)
  if (!match) return null
  return Number(match[1]) as 4 | 5 | 6
}

export function buildGameAffixBranch(args: {
  entries: AffixLibraryEntry[]
  enabledIds: Iterable<string>
  combo: GamePocketCombo
  extraCost: number
}): { entries: AffixLibraryEntry[]; entryCapTaxes: AffixEntryCapTax[] } {
  const enabled = new Set(args.enabledIds)
  const extraCost = clampGameExtraCost(args.extraCost)
  const paidCost = 1 + extraCost
  const entries: AffixLibraryEntry[] = []
  const entryCapTaxes: AffixEntryCapTax[] = []

  for (const entry of args.entries) {
    if (!enabled.has(entry.id)) continue
    const slot = slotOfMainId(entry.id)
    if (slot) {
      const paid = isGamePaidMainId(entry.id)
      // 4 号位主属性全部与副词条同字段 → 恒付费，不再有「4 不付费」分支
      const wantPaid = slot === 4 ? true : pocketOfSlot(args.combo, slot) === 'paid'
      if (paid !== wantPaid) continue
      if (paid) {
        entries.push({ ...entry, rollCost: Math.max(1, paidCost) })
        // 每条付费 key 都必须在映射表里有对应副词条；查不到说明两张表脱节，跳过税而不是塞 undefined
        const parsed = parseGamePaidMainId(entry.id)
        const targetSubstat = parsed ? PAID_MAIN_TO_SUBSTAT[parsed.key] : undefined
        if (targetSubstat) {
          entryCapTaxes.push({
            whenEntryId: entry.id,
            targetEntryId: targetSubstat,
            amount: GAME_PAID_SUBSTAT_TAX,
          })
        }
        continue
      }
    }
    entries.push({ ...entry })
  }

  return { entries, entryCapTaxes }
}

export function gameAffixGroupCaps(maxTotalRolls: number): Record<string, number> {
  const caps: Record<string, number> = {}
  for (const group of createGameAffixGroups(maxTotalRolls)) caps[group.name] = group.cap
  return caps
}

/** 各袋合计消耗（含赢家），避免把单袋数字误当成总成本 */
export interface GameAffixPocketTotals {
  /** 各袋合计计算量 */
  workUsed: number
  /** 各袋合计引擎评估次数 */
  engineCalls: number
  /** 各袋合计缓存命中 */
  cacheHits: number
  /** 实际参与的口袋数 */
  pockets: number
}

export interface GameAffixAllocationResult extends AffixOptimizerResult {
  /** 胜出口袋 */
  gameWinner: { index: number; total: number; label: string }
  /** 各袋合计 */
  gameTotals: GameAffixPocketTotals
}

/**
 * 游戏专用 4 口袋求解。
 *
 * 用户 2026-09-16 口径：预设 / 高级参数**透传给每个口袋**，**每袋都完整跑 Beam**，
 * 不先粗筛口袋；每袋同等参数、**共享一个预算池**（每袋公平额度 × 袋数，先跑的口袋没用完的
 * 顺延给后面的口袋 —— 与普通模式「先专路、剩余给普通路」同构），最后按总伤取最高。
 * 4 号位主属性全付费，故外层只有 5 / 6 两维 = **4 袋**（`GAME_POCKET_COMBOS`）。
 * 5 号付费口袋自然排除 24% 穿透专路（付费号位里没有 `main:slot5:penRate`）。
 *
 * **为什么不做成"一次搜索"**（2026-09-16 复核）：4 袋的差别不只是代价（付费已用 `rollCost` +
 * cap 税表达），更关键是**候选集本身不同** —— 5 号付费袋里没有 `penRate` 条目。同一号位组的
 * 候选集随"买不买"变化，单次搜索表达不了，所以外层枚举是当前表达力下的必要代价。
 */
export async function solveGameAffixAllocationAsync(
  input: {
    ctx: OptimalEvalContext
    entries: AffixLibraryEntry[]
    enabledIds: Iterable<string>
    extraCost: number
    maxTotalRolls: number
    /** 搜索预设（各袋统一透传） */
    searchPreset?: AffixSearchPresetId
    /** 初始候选门槛（0..1）；显式值覆盖预设 */
    initialCandidateThreshold?: number
    /** 候选兜底：每组保底前 N 名（0 = 关掉）；显式值覆盖预设 */
    initialCandidateFloor?: number
    /** 路线保留比例（0..1）；显式值覆盖预设 */
    routeRetentionRatio?: number
    /** 最小保留路线数（1..64）：比例筛完不足这么多条时保底补足；显式值覆盖预设 */
    minRetainedRoutes?: number
    /** 最大保留路线数（1..64）：比例筛完超过这么多条时按总伤截顶；显式值覆盖预设 */
    maxRetainedRoutes?: number
    /** 每袋的公平预算（各袋一致）；先跑的口袋没用完的，顺延给后面的口袋 */
    maxWorkUnits?: number
  },
  options?: AffixOptimizerAsyncOptions,
): Promise<GameAffixAllocationResult> {
  const groupCaps = gameAffixGroupCaps(input.maxTotalRolls)
  const groups = createGameAffixGroups(input.maxTotalRolls)
  /**
   * 「不消耗总词条数」的组名（2 件套 / 4 / 5 / 6 号位）。
   *
   * 交给求解器按**预算口径**处理：这些组的基础档不计入总词条数，冲突额外 x 照算
   * （见 `AffixOptimizerInput.freeRollGroups`）。**不再用"放宽预算 + 事后减回"那种补丁** ——
   * 那个补丁在"组勾了但一条没选"时会把多出来的档漏给副词条（2026-09-18 用户指出）。
   */
  const freeRollGroups = groups
    .filter((group) => group.excludedFromTotalRolls)
    .map((group) => group.name)
  let best: AffixOptimizerResult | null = null
  let winnerIndex = 0
  let winnerLabel = ''
  let workUsed = 0
  let engineCalls = 0
  let cacheHits = 0
  let pockets = 0
  const total = GAME_POCKET_COMBOS.length
  const sharedParams = {
    searchPreset: input.searchPreset,
    initialCandidateThreshold: input.initialCandidateThreshold,
    initialCandidateFloor: input.initialCandidateFloor,
    routeRetentionRatio: input.routeRetentionRatio,
    minRetainedRoutes: input.minRetainedRoutes,
    maxRetainedRoutes: input.maxRetainedRoutes,
  }

  // 先列出「真正会跑的口袋」（纯数据构造、零评估），好算共享预算池
  const pocketPlans = GAME_POCKET_COMBOS.map((combo, index) => ({
    combo,
    index,
    branch: buildGameAffixBranch({
      entries: input.entries,
      enabledIds: input.enabledIds,
      combo,
      extraCost: input.extraCost,
    }),
  })).filter((plan) => plan.branch.entries.length)

  /**
   * 共享预算池 = **每袋额度 × 袋数**；**先跑的口袋没用完的顺延给后面的口袋**
   * （与普通模式「先专路、剩余给普通路」同构）。每袋拿的是「剩余池 ÷ 剩余袋数」，
   * 所以任何一袋都不会低于自己的公平额度（默认额度 = `DEFAULT_WORK_BUDGET`）。
   */
  const perPocketBudget = input.maxWorkUnits ?? DEFAULT_WORK_BUDGET
  const budgetPool = perPocketBudget * pocketPlans.length
  let poolUsed = 0

  for (let planIndex = 0; planIndex < pocketPlans.length; planIndex += 1) {
    const { combo, index, branch } = pocketPlans[planIndex]!
    const label = gamePocketLabel(combo)
    const pocketsLeft = Math.max(1, pocketPlans.length - planIndex)
    const allowance = Math.max(0, Math.floor((budgetPool - poolUsed) / pocketsLeft))
    // 已完成口袋的累计（进度里给「赢家 + 各袋总计」）
    const doneWork = workUsed
    const doneCalls = engineCalls
    const branchInput: AffixOptimizerInput = {
      ctx: input.ctx,
      entries: branch.entries,
      maxTotalRolls: Math.max(1, Math.round(input.maxTotalRolls)),
      ...sharedParams,
      maxWorkUnits: allowance,
      groupCaps,
      freeRollGroups,
      entryCapTaxes: branch.entryCapTaxes,
    }
    const result = await solveOptimalAffixAllocationAsync(branchInput, {
      ...options,
      onProgress: (progress: AffixOptimizerProgress) => {
        options?.onProgress?.({
          ...progress,
          gameBranch: { index: index + 1, total, label },
          gameTotals: {
            workUsed: doneWork + progress.workUsed,
            engineCalls: doneCalls + progress.engineCalls,
          },
        })
      },
    })
    pockets += 1
    workUsed += result.workUsed
    poolUsed += result.workUsed
    engineCalls += result.engineCalls
    cacheHits += result.cacheHits
    if (!best || result.totalDamage > best.totalDamage) {
      best = result
      winnerIndex = index + 1
      winnerLabel = label
    }
  }

  if (!best) {
    throw new Error('游戏专用方案没有可参与的词条')
  }
  // `usedRolls` 已由求解器按预算口径给（豁免组的基础档不算、冲突额外照算），这里不再事后减回
  return {
    ...best,
    gameWinner: { index: winnerIndex, total, label: winnerLabel },
    gameTotals: { workUsed, engineCalls, cacheHits, pockets },
  }
}
