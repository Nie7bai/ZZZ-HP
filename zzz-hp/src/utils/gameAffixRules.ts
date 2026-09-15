import {
  AFFIX_PRESET_GROUPS,
  createPresetAffixLibraryEntries,
  type AffixLibraryEntry,
  type AffixLibraryGroup,
} from '@/utils/affixLibrary'
import {
  solveOptimalAffixAllocationAsync,
  type AffixCandidateWidthMode,
  type AffixEntryCapTax,
  type AffixOptimizerAsyncOptions,
  type AffixOptimizerInput,
  type AffixOptimizerProgress,
  type AffixOptimizerResult,
} from '@/utils/affixOptimizer'
import type { OptimalEvalContext } from '@/utils/optimalAffixAlloc'

/**
 * 游戏专用分配规则：一份写死方案，不进官方词条库。
 *
 * 副词条每条上限 30。4/5/6 号位选到攻击 / 生命 / 防御是「付费」口袋：
 * 分到档则总分配再扣 extraCost（x），并扣副词条里对应条目 cap 5。
 * 4/5/6 与 2 件套组额度锁 1；副词条组额度 = 总分配 − 4。
 * 外层 8 路（每槽付费/不付费）再跑现有贪心+换档。
 *
 * 勾选默认全开（含 2 件套）。已写入本机的勾选原样读取，不再改写。
 * 官方词条库里 2 件套 `enabledByDefault: false` 只防「求最优分配」叠导入面板，不套用到本方案。
 */

export const GAME_AFFIX_STORAGE_KEY = 'zzz-hp-game-affix-rules-v1'
export const GAME_AFFIX_EXTRA_COST_DEFAULT = 1
export const GAME_MAIN_SLOT_RESERVE = 4
export const GAME_PAID_SUBSTAT_TAX = 5
export const GAME_AFFIX_SUBSTAT_ENTRY_CAP = 30

const PAID_MAIN_KEYS = ['externalAtkPercent', 'externalHpPercent', 'externalDefPercent'] as const

const PAID_MAIN_TO_SUBSTAT: Record<(typeof PAID_MAIN_KEYS)[number], string> = {
  externalAtkPercent: 'substat:atkPercent',
  externalHpPercent: 'substat:hpPercent',
  externalDefPercent: 'substat:defPercent',
}

export type GameSlotPocket = 'paid' | 'free'

export interface GamePocketCombo {
  slot4: GameSlotPocket
  slot5: GameSlotPocket
  slot6: GameSlotPocket
}

export interface GameAffixRulesSettings {
  extraCost: number
  enabledIds: string[]
}

export function gamePaidMainId(slot: 4 | 5 | 6, key: string): string {
  return `main:slot${slot}:${key}`
}

export function isGamePaidMainId(id: string): boolean {
  return /^main:slot[456]:(externalAtkPercent|externalHpPercent|externalDefPercent)$/.test(id)
}

export function parseGamePaidMainId(
  id: string,
): { slot: 4 | 5 | 6; key: (typeof PAID_MAIN_KEYS)[number] } | null {
  const match = /^main:slot([456]):(externalAtkPercent|externalHpPercent|externalDefPercent)$/.exec(
    id,
  )
  if (!match) return null
  return {
    slot: Number(match[1]) as 4 | 5 | 6,
    key: match[2] as (typeof PAID_MAIN_KEYS)[number],
  }
}

export const GAME_POCKET_COMBOS: GamePocketCombo[] = (
  ['paid', 'free'] as const
).flatMap((slot4) =>
  (['paid', 'free'] as const).flatMap((slot5) =>
    (['paid', 'free'] as const).map((slot6) => ({ slot4, slot5, slot6 })),
  ),
)

export function gamePocketLabel(combo: GamePocketCombo): string {
  const bit = (pocket: GameSlotPocket) => (pocket === 'paid' ? '付费' : '不付费')
  return `4${bit(combo.slot4)} 5${bit(combo.slot5)} 6${bit(combo.slot6)}`
}

export function createGameAffixLibraryEntries(): AffixLibraryEntry[] {
  return createPresetAffixLibraryEntries().map((entry) => {
    if (entry.group !== '副词条') return { ...entry }
    return { ...entry, cap: GAME_AFFIX_SUBSTAT_ENTRY_CAP }
  })
}

export function createGameAffixGroups(maxTotalRolls: number): AffixLibraryGroup[] {
  const substatCap = Math.max(0, Math.round(maxTotalRolls) - GAME_MAIN_SLOT_RESERVE)
  return AFFIX_PRESET_GROUPS.map((group) => {
    if (group.name === '副词条') return { ...group, cap: substatCap }
    if (group.name === '2件套' || /号位$/.test(group.name)) return { ...group, cap: 1 }
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

export function loadGameAffixRulesSettings(entries: AffixLibraryEntry[]): GameAffixRulesSettings {
  const fallback: GameAffixRulesSettings = {
    extraCost: GAME_AFFIX_EXTRA_COST_DEFAULT,
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
      enabledIds: settings.enabledIds,
    }),
  )
}

function pocketOfSlot(combo: GamePocketCombo, slot: 4 | 5 | 6): GameSlotPocket {
  if (slot === 4) return combo.slot4
  if (slot === 5) return combo.slot5
  return combo.slot6
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
      const wantPaid = pocketOfSlot(args.combo, slot) === 'paid'
      if (paid !== wantPaid) continue
      if (paid) {
        entries.push({ ...entry, rollCost: Math.max(1, paidCost) })
        const parsed = parseGamePaidMainId(entry.id)
        if (parsed) {
          entryCapTaxes.push({
            whenEntryId: entry.id,
            targetEntryId: PAID_MAIN_TO_SUBSTAT[parsed.key],
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

export async function solveGameAffixAllocationAsync(
  input: {
    ctx: OptimalEvalContext
    entries: AffixLibraryEntry[]
    enabledIds: Iterable<string>
    extraCost: number
    maxTotalRolls: number
    candidateWidthMode?: AffixCandidateWidthMode
    manualCandidateWidth?: number
    minimumBenefitRatio?: number
  },
  options?: AffixOptimizerAsyncOptions,
): Promise<AffixOptimizerResult> {
  const groupCaps = gameAffixGroupCaps(input.maxTotalRolls)
  let best: AffixOptimizerResult | null = null
  const total = GAME_POCKET_COMBOS.length

  for (let index = 0; index < total; index += 1) {
    const combo = GAME_POCKET_COMBOS[index]!
    const branch = buildGameAffixBranch({
      entries: input.entries,
      enabledIds: input.enabledIds,
      combo,
      extraCost: input.extraCost,
    })
    if (!branch.entries.length) continue
    const label = gamePocketLabel(combo)
    const branchInput: AffixOptimizerInput = {
      ctx: input.ctx,
      entries: branch.entries,
      maxTotalRolls: input.maxTotalRolls,
      candidateWidthMode: input.candidateWidthMode,
      manualCandidateWidth: input.manualCandidateWidth,
      minimumBenefitRatio: input.minimumBenefitRatio,
      groupCaps,
      entryCapTaxes: branch.entryCapTaxes,
    }
    const result = await solveOptimalAffixAllocationAsync(branchInput, {
      ...options,
      onProgress: (progress: AffixOptimizerProgress) => {
        options?.onProgress?.({
          ...progress,
          gameBranch: { index: index + 1, total, label },
        })
      },
    })
    if (!best || result.totalDamage > best.totalDamage) best = result
  }

  if (!best) {
    throw new Error('游戏专用方案没有可参与的词条')
  }
  return best
}
