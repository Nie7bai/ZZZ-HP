import {
  AFFIX_SEARCH_PRESETS,
  DEFAULT_AFFIX_SEARCH_PRESET,
  clampAffixMaxRetainedRoutes,
  clampAffixUnitRatio,
  type AffixSearchParams,
  type AffixSearchPresetId,
} from '@/utils/affixOptimizer'

/**
 * 词条「求最优分配」搜索设置（本机独立存盘）。
 *
 * 存的是三项搜索参数（预设 + 自定义值）与高级区展开状态。
 * **不混入**词条库、方案包或游戏规则那套 `localStorage` 键，见 `dev-docs/词条最优分配.md`。
 */
export const AFFIX_SEARCH_SETTINGS_STORAGE_KEY = 'zzz-hp-affix-search-settings-v1'

export interface AffixSearchSettings {
  /** 当前预设 */
  preset: AffixSearchPresetId
  /** 自定义参数（preset = 'custom' 时生效） */
  custom: AffixSearchParams
  /** 高级区是否展开 */
  advancedOpen: boolean
}

const PRESET_IDS: AffixSearchPresetId[] = ['fast', 'balanced', 'fine', 'custom']

export const DEFAULT_AFFIX_SEARCH_SETTINGS: AffixSearchSettings = {
  preset: DEFAULT_AFFIX_SEARCH_PRESET,
  custom: { ...AFFIX_SEARCH_PRESETS.balanced },
  advancedOpen: false,
}

function cloneDefaults(): AffixSearchSettings {
  return {
    preset: DEFAULT_AFFIX_SEARCH_SETTINGS.preset,
    custom: { ...DEFAULT_AFFIX_SEARCH_SETTINGS.custom },
    advancedOpen: DEFAULT_AFFIX_SEARCH_SETTINGS.advancedOpen,
  }
}

export function isAffixSearchPresetId(value: unknown): value is AffixSearchPresetId {
  return typeof value === 'string' && (PRESET_IDS as string[]).includes(value)
}

/**
 * 面板与求解实际要用的三项参数：预设直接取预设表，自定义取用户值。
 * 点「自定义」时从当前预设值起步（界面侧负责把上次的值带进 custom）。
 */
export function effectiveAffixSearchParams(settings: AffixSearchSettings): AffixSearchParams {
  if (settings.preset === 'custom') return { ...settings.custom }
  return { ...AFFIX_SEARCH_PRESETS[settings.preset] }
}

export function loadAffixSearchSettings(): AffixSearchSettings {
  if (typeof localStorage === 'undefined') return cloneDefaults()
  try {
    const raw = localStorage.getItem(AFFIX_SEARCH_SETTINGS_STORAGE_KEY)
    if (!raw) return cloneDefaults()
    const parsed = JSON.parse(raw) as Partial<AffixSearchSettings> & {
      custom?: Partial<AffixSearchParams>
    }
    const fallback = cloneDefaults()
    return {
      preset: isAffixSearchPresetId(parsed.preset) ? parsed.preset : fallback.preset,
      custom: {
        initialCandidateThreshold: clampAffixUnitRatio(
          parsed.custom?.initialCandidateThreshold,
          fallback.custom.initialCandidateThreshold,
        ),
        routeRetentionRatio: clampAffixUnitRatio(
          parsed.custom?.routeRetentionRatio,
          fallback.custom.routeRetentionRatio,
        ),
        maxRetainedRoutes: clampAffixMaxRetainedRoutes(
          parsed.custom?.maxRetainedRoutes,
          fallback.custom.maxRetainedRoutes,
        ),
      },
      advancedOpen: parsed.advancedOpen === true,
    }
  } catch {
    return cloneDefaults()
  }
}

export function saveAffixSearchSettings(settings: AffixSearchSettings): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    AFFIX_SEARCH_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      preset: settings.preset,
      custom: { ...settings.custom },
      advancedOpen: settings.advancedOpen,
    }),
  )
}
