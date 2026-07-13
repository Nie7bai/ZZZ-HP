/**
 * 新式舆防卫战「显示 ID」与 version+phase 互转。
 *
 * 锚点：2.5 第 1 期 = 62038
 * 规则：按版本期数时间线排序，相邻期数显示 ID ±1
 */

export const DEFENSE_DISPLAY_ID_ANCHOR = 62038

export const DEFENSE_ANCHOR = {
  version: '2.5',
  phase: 1,
}

/** 新式舆（2.4+）完整期数时间线；新增版本/期数在末尾追加即可 */
export const DEFENSE_SEASON_ORDER = [
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

export function normalizeDefensePhase(phase) {
  const digits = String(phase).replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

export function defenseSeasonKey(version, phase) {
  return `${String(version).trim()}-${normalizeDefensePhase(phase)}`
}

function findSeasonIndex(version, phase) {
  const key = defenseSeasonKey(version, phase)
  return DEFENSE_SEASON_ORDER.findIndex(
    (item) => defenseSeasonKey(item.version, item.phase) === key,
  )
}

function getAnchorIndex() {
  return findSeasonIndex(DEFENSE_ANCHOR.version, DEFENSE_ANCHOR.phase)
}

/**
 * version + phase → 显示 ID（nanoka 赛季 ID）
 */
export function versionPhaseToDisplayId(version, phase) {
  const index = findSeasonIndex(version, phase)
  if (index < 0) return null

  const anchorIndex = getAnchorIndex()
  if (anchorIndex < 0) return null

  return DEFENSE_DISPLAY_ID_ANCHOR + (index - anchorIndex)
}

/**
 * 显示 ID → version + phase
 */
export function displayIdToVersionPhase(displayId) {
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

/**
 * 完整转换表（含锚点偏移后的显示 ID）
 */
export function getDefenseSeasonIdTable() {
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

export function isKnownDefenseSeason(version, phase) {
  return findSeasonIndex(version, phase) >= 0
}
