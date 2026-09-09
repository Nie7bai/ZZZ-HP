import type { AdminPanel, AdminScope } from '@/types/admin'
import type { AdminCalculatorPanel } from '@/types/calculator'
import type { SiteInfoPanelId } from '@/types/siteInfo'

/** 危局 / 防卫管理侧栏 */
export const ADMIN_SCOPE_PANELS: readonly AdminPanel[] = [
  'monster',
  'monster-form',
  'buff-form',
  'season-date',
  'import-export',
] as const

/** 临界推演管理侧栏（无表单页 / 版本日期） */
export const ADMIN_DEDUCTION_PANELS: readonly AdminPanel[] = ['monster', 'import-export'] as const

export function adminPanelsForScope(scope: AdminScope): readonly AdminPanel[] {
  return scope === 'deduction' ? ADMIN_DEDUCTION_PANELS : ADMIN_SCOPE_PANELS
}

export function isAdminPanelId(value: unknown): value is AdminPanel {
  return (
    value === 'monster' ||
    value === 'monster-form' ||
    value === 'buff-form' ||
    value === 'season-date' ||
    value === 'import-export'
  )
}

export const ADMIN_CALCULATOR_PANELS: readonly AdminCalculatorPanel[] = [
  'agent',
  'wengine',
  'bangboo',
  'drive-disc',
  'skill-subcategory',
  'skill-library',
  'import-export',
] as const

export function isAdminCalculatorPanelId(value: unknown): value is AdminCalculatorPanel {
  return (ADMIN_CALCULATOR_PANELS as readonly string[]).includes(String(value))
}

export const SITE_INFO_ROUTE_PANELS: readonly SiteInfoPanelId[] = [
  'about',
  'features',
  'credits',
  'legal',
] as const

export function isSiteInfoPanelId(value: unknown): value is SiteInfoPanelId {
  return (SITE_INFO_ROUTE_PANELS as readonly string[]).includes(String(value))
}

export const CHARACTER_CALC_PAGES = [
  'damage',
  'role-buff',
  'wengine-buff',
  'bangboo-buff',
  'drive-disc-buff',
] as const

export type CharacterCalcPage = (typeof CHARACTER_CALC_PAGES)[number]

export function isCharacterCalcPage(value: unknown): value is CharacterCalcPage {
  return (CHARACTER_CALC_PAGES as readonly string[]).includes(String(value))
}
