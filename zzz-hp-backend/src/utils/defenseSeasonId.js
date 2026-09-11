/**
 * 新式舆防卫战「显示 ID」与 version+phase 互转。
 *
 * 锚点：2.5 第 1 期 = 62038
 * 规则：已知时间线 + 额外期数（如 date 表新建）按版本/期数排序后，相邻显示 ID ±1。
 * 新期不必再手改本表：只要比表末更新，就会自动接到末尾继续 +1。
 */

export const DEFENSE_DISPLAY_ID_ANCHOR = 62038

export const DEFENSE_ANCHOR = {
  version: '2.5',
  phase: 1,
}

/** 历史锚点时间线（2.4～已核对期）；其后新期由 extraSeasons / 自动并入续推 */
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

function parseVersionParts(version) {
  return String(version ?? '')
    .trim()
    .split('.')
    .map((part) => Number(part.replace(/\D/g, '')) || 0)
}

export function compareDefenseVersionPhase(a, b) {
  const va = parseVersionParts(a.version)
  const vb = parseVersionParts(b.version)
  const len = Math.max(va.length, vb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (va[i] || 0) - (vb[i] || 0)
    if (diff !== 0) return diff
  }
  return normalizeDefensePhase(a.phase) - normalizeDefensePhase(b.phase)
}

/**
 * 合并静态时间线与额外期数（date/boss 等），按版本+期数排序。
 * @param {Array<{ version: string, phase: string|number }>} [extraSeasons]
 */
export function resolveDefenseSeasonOrder(extraSeasons = []) {
  const map = new Map()
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

function getAnchorIndex(order = DEFENSE_SEASON_ORDER) {
  const key = defenseSeasonKey(DEFENSE_ANCHOR.version, DEFENSE_ANCHOR.phase)
  return order.findIndex((item) => defenseSeasonKey(item.version, item.phase) === key)
}

/**
 * version + phase → 显示 ID（nanoka 赛季 ID）
 * @param {Array<{ version: string, phase: string|number }>} [extraSeasons] 一并参与排序的其它期（避免多期都落到 +1）
 */
export function versionPhaseToDisplayId(version, phase, extraSeasons = []) {
  const self = { version, phase }
  const order = resolveDefenseSeasonOrder([...extraSeasons, self])
  const index = order.findIndex(
    (item) => defenseSeasonKey(item.version, item.phase) === defenseSeasonKey(version, phase),
  )
  if (index < 0) return null

  const anchorIndex = getAnchorIndex(order)
  if (anchorIndex < 0) return null

  return DEFENSE_DISPLAY_ID_ANCHOR + (index - anchorIndex)
}

/**
 * 显示 ID → version + phase
 */
export function displayIdToVersionPhase(displayId, extraSeasons = []) {
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

/**
 * 完整转换表（含锚点偏移后的显示 ID）
 */
export function getDefenseSeasonIdTable(extraSeasons = []) {
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

export function isKnownDefenseSeason(version, phase, extraSeasons = []) {
  const order = resolveDefenseSeasonOrder(extraSeasons)
  const key = defenseSeasonKey(version, phase)
  return order.some((item) => defenseSeasonKey(item.version, item.phase) === key)
}

/** 批量：期数列表 → displayId 字符串映射 */
export function buildDefenseDisplayIdMap(extraSeasons = []) {
  const table = getDefenseSeasonIdTable(extraSeasons)
  return new Map(table.map((row) => [row.seasonKey, row.displayId]))
}
