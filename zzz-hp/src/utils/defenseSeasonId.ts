/**
 * 新式舆防卫战「显示 ID」与 version+phase 互转（与后端 defenseSeasonId.js 规则一致）
 *
 * 锚点：2.5 第 1 期 = 62038，相邻期数 ID ±1
 */

export const DEFENSE_DISPLAY_ID_ANCHOR = 62038

export const DEFENSE_ANCHOR = {
  version: '2.5',
  phase: 1,
} as const

export interface DefenseSeasonOrderItem {
  version: string
  phase: number
}

export const DEFENSE_SEASON_ORDER: DefenseSeasonOrderItem[] = [
  { version: '2.4', phase: 1 },
  { version: '2.4', phase: 2 },
  { version: '2.5', phase: 1 },
  { version: '2.5', phase: 2 },
  { version: '2.5', phase: 3 },
  { version: '2.6', phase: 1 },
  { version: '2.6', phase: 2 },
  { version: '2.6', phase: 3 },
  { version: '2.6', phase: 4 },
  { version: '2.7', phase: 1 },
  { version: '2.7', phase: 2 },
  { version: '2.7', phase: 3 },
  { version: '2.8', phase: 1 },
  { version: '2.8', phase: 2 },
  { version: '2.8', phase: 3 },
  { version: '3.0', phase: 1 },
  { version: '3.0', phase: 2 },
  { version: '3.0', phase: 3 },
  { version: '3.0', phase: 4 },
  { version: '3.1', phase: 1 },
  { version: '3.1', phase: 2 },
  { version: '3.1', phase: 3 },
]

export interface DefenseSeasonIdRow {
  version: string
  phase: number
  phaseLabel: string
  seasonKey: string
  displayId: string
  offsetFromAnchor: number
}

export function normalizeDefensePhase(phase: string | number) {
  const digits = String(phase).replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export function defenseSeasonKey(version: string, phase: string | number) {
  return `${String(version).trim()}-${normalizeDefensePhase(phase)}`
}

function findSeasonIndex(version: string, phase: string | number) {
  const key = defenseSeasonKey(version, phase)
  return DEFENSE_SEASON_ORDER.findIndex(
    (item) => defenseSeasonKey(item.version, item.phase) === key,
  )
}

function getAnchorIndex() {
  return findSeasonIndex(DEFENSE_ANCHOR.version, DEFENSE_ANCHOR.phase)
}

export function versionPhaseToDisplayId(version: string, phase: string | number): string | null {
  const index = findSeasonIndex(version, phase)
  if (index < 0) return null

  const anchorIndex = getAnchorIndex()
  if (anchorIndex < 0) return null

  return String(DEFENSE_DISPLAY_ID_ANCHOR + (index - anchorIndex))
}

export function displayIdToVersionPhase(displayId: string | number) {
  const anchorIndex = getAnchorIndex()
  if (anchorIndex < 0) return null

  const index = anchorIndex + (Number(displayId) - DEFENSE_DISPLAY_ID_ANCHOR)
  const item = DEFENSE_SEASON_ORDER[index]
  if (!item) return null

  return {
    version: item.version,
    phase: String(item.phase),
  }
}

export function getDefenseSeasonIdTable(): DefenseSeasonIdRow[] {
  const anchorIndex = getAnchorIndex()

  return DEFENSE_SEASON_ORDER.map((item, index) => ({
    version: item.version,
    phase: item.phase,
    phaseLabel: `第 ${item.phase} 期`,
    seasonKey: defenseSeasonKey(item.version, item.phase),
    displayId: String(DEFENSE_DISPLAY_ID_ANCHOR + (index - anchorIndex)),
    offsetFromAnchor: index - anchorIndex,
  }))
}

export function isKnownDefenseSeason(version: string, phase: string | number) {
  return findSeasonIndex(version, phase) >= 0
}
