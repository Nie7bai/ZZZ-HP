/**
 * 新式舆防卫战「显示 ID」与 version+phase 互转（与后端 defenseSeasonId.js 规则一致）
 *
 * 锚点：2.5 第 1 期 = 62038，相邻期数 ID ±1；
 * 静态表之后的新期通过 extraSeasons 并入后自动续推。
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

/** 历史锚点时间线；其后新期由 extraSeasons 自动并入续推 */
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

function parseVersionParts(version: string) {
  return String(version ?? '')
    .trim()
    .split('.')
    .map((part) => Number(part.replace(/\D/g, '')) || 0)
}

export function compareDefenseVersionPhase(
  a: { version: string; phase: string | number },
  b: { version: string; phase: string | number },
) {
  const va = parseVersionParts(a.version)
  const vb = parseVersionParts(b.version)
  const len = Math.max(va.length, vb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (va[i] || 0) - (vb[i] || 0)
    if (diff !== 0) return diff
  }
  return normalizeDefensePhase(a.phase) - normalizeDefensePhase(b.phase)
}

export function resolveDefenseSeasonOrder(
  extraSeasons: Array<{ version: string; phase: string | number }> = [],
): DefenseSeasonOrderItem[] {
  const map = new Map<string, DefenseSeasonOrderItem>()
  for (const item of DEFENSE_SEASON_ORDER) {
    map.set(defenseSeasonKey(item.version, item.phase), {
      version: String(item.version).trim(),
      phase: normalizeDefensePhase(item.phase),
    })
  }
  for (const item of extraSeasons) {
    if (!item?.version) continue
    const phase = normalizeDefensePhase(item.phase)
    if (!phase) continue
    const version = String(item.version).trim()
    const key = defenseSeasonKey(version, phase)
    if (!map.has(key)) map.set(key, { version, phase })
  }
  return [...map.values()].sort(compareDefenseVersionPhase)
}

function getAnchorIndex(order: DefenseSeasonOrderItem[] = DEFENSE_SEASON_ORDER) {
  const key = defenseSeasonKey(DEFENSE_ANCHOR.version, DEFENSE_ANCHOR.phase)
  return order.findIndex((item) => defenseSeasonKey(item.version, item.phase) === key)
}

export function versionPhaseToDisplayId(
  version: string,
  phase: string | number,
  extraSeasons: Array<{ version: string; phase: string | number }> = [],
): string | null {
  const order = resolveDefenseSeasonOrder([...extraSeasons, { version, phase }])
  const index = order.findIndex(
    (item) => defenseSeasonKey(item.version, item.phase) === defenseSeasonKey(version, phase),
  )
  if (index < 0) return null

  const anchorIndex = getAnchorIndex(order)
  if (anchorIndex < 0) return null

  return String(DEFENSE_DISPLAY_ID_ANCHOR + (index - anchorIndex))
}

export function displayIdToVersionPhase(
  displayId: string | number,
  extraSeasons: Array<{ version: string; phase: string | number }> = [],
) {
  const order = resolveDefenseSeasonOrder(extraSeasons)
  const anchorIndex = getAnchorIndex(order)
  if (anchorIndex < 0) return null

  const index = anchorIndex + (Number(displayId) - DEFENSE_DISPLAY_ID_ANCHOR)
  const item = order[index]
  if (!item) return null

  return {
    version: item.version,
    phase: String(item.phase),
  }
}

export function getDefenseSeasonIdTable(
  extraSeasons: Array<{ version: string; phase: string | number }> = [],
): DefenseSeasonIdRow[] {
  const order = resolveDefenseSeasonOrder(extraSeasons)
  const anchorIndex = getAnchorIndex(order)

  return order.map((item, index) => ({
    version: item.version,
    phase: item.phase,
    phaseLabel: `第 ${item.phase} 期`,
    seasonKey: defenseSeasonKey(item.version, item.phase),
    displayId: String(DEFENSE_DISPLAY_ID_ANCHOR + (index - anchorIndex)),
    offsetFromAnchor: index - anchorIndex,
  }))
}

export function isKnownDefenseSeason(
  version: string,
  phase: string | number,
  extraSeasons: Array<{ version: string; phase: string | number }> = [],
) {
  const order = resolveDefenseSeasonOrder(extraSeasons)
  const key = defenseSeasonKey(version, phase)
  return order.some((item) => defenseSeasonKey(item.version, item.phase) === key)
}

export function buildDefenseDisplayIdMap(
  extraSeasons: Array<{ version: string; phase: string | number }> = [],
) {
  const table = getDefenseSeasonIdTable(extraSeasons)
  return new Map(table.map((row) => [row.seasonKey, row.displayId]))
}
