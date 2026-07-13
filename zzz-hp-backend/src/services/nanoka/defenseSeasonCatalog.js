import {
  displayIdToVersionPhase,
  getDefenseSeasonIdTable,
  versionPhaseToDisplayId,
} from '../../utils/defenseSeasonId.js'

/**
 * 新式舆开放日期（与 nanoka 排期对齐）。
 * 显示 ID 由 defenseSeasonId 锚点规则自动计算，不在此重复维护。
 */
const DEFENSE_SEASON_DATES = {
  '2.4-1': { startDate: '2025-12-05', endDate: '2025-12-19' },
  '2.4-2': { startDate: '2025-12-19', endDate: '2025-12-29' },
  '2.5-1': { startDate: '2025-12-30', endDate: '2026-01-09' },
  '2.5-2': { startDate: '2026-01-09', endDate: '2026-01-23' },
  '2.5-3': { startDate: '2026-01-23', endDate: '2026-02-06' },
  '2.6-1': { startDate: '2026-02-06', endDate: '2026-02-20' },
  '2.6-2': { startDate: '2026-02-20', endDate: '2026-03-06' },
  '2.6-3': { startDate: '2026-03-06', endDate: '2026-03-20' },
  '2.6-4': { startDate: '2026-03-20', endDate: '2026-04-03' },
  '2.7-1': { startDate: '2026-04-03', endDate: '2026-04-17' },
  '2.7-2': { startDate: '2026-04-17', endDate: '2026-05-01' },
  '2.7-3': { startDate: '2026-05-01', endDate: '2026-05-15' },
  '2.8-1': { startDate: '2026-05-15', endDate: '2026-05-29' },
  '2.8-2': { startDate: '2026-05-29', endDate: '2026-06-12' },
  '2.8-3': { startDate: '2026-06-12', endDate: '2026-06-26' },
  '3.0-1': { startDate: '2026-06-26', endDate: '2026-07-10' },
  '3.0-2': { startDate: '2026-07-10', endDate: '2026-07-24' },
  '3.0-3': { startDate: '2026-07-24', endDate: '2026-08-07' },
  '3.0-4': { startDate: '2026-07-29', endDate: '2026-08-12' },
}

function buildCatalogEntry(item) {
  const dates = DEFENSE_SEASON_DATES[item.seasonKey] ?? null
  return {
    version: item.version,
    phase: String(item.phase),
    seasonId: item.displayId,
    startDate: dates?.startDate ?? null,
    endDate: dates?.endDate ?? null,
  }
}

export const DEFENSE_SEASON_CATALOG = getDefenseSeasonIdTable().map(buildCatalogEntry)

const catalogByKey = new Map(
  DEFENSE_SEASON_CATALOG.map((item) => [`${item.version}-${item.phase}`, item]),
)

const catalogBySeasonId = new Map(
  DEFENSE_SEASON_CATALOG.map((item) => [item.seasonId, item]),
)

export function getDefenseSeasonMeta(version, phase) {
  const phaseNum = String(phase).replace(/\D/g, '')
  const key = `${String(version).trim()}-${phaseNum}`
  const fromCatalog = catalogByKey.get(key)
  if (fromCatalog) return fromCatalog

  const displayId = versionPhaseToDisplayId(version, phase)
  if (!displayId) return null

  const dates = DEFENSE_SEASON_DATES[key] ?? null
  return {
    version: String(version).trim(),
    phase: phaseNum,
    seasonId: displayId,
    startDate: dates?.startDate ?? null,
    endDate: dates?.endDate ?? null,
  }
}

export function getDefenseSeasonMetaById(seasonId) {
  const fromCatalog = catalogBySeasonId.get(String(seasonId))
  if (fromCatalog) return fromCatalog

  const mapped = displayIdToVersionPhase(seasonId)
  if (!mapped) return null

  return getDefenseSeasonMeta(mapped.version, mapped.phase)
}

export { getDefenseSeasonIdTable }
