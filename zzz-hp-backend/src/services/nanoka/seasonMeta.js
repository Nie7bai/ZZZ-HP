import pool from '../../config/db.js'
import { getDefenseSeasonMetaById } from './defenseSeasonCatalog.js'

function normalizeDate(value) {
  if (!value) return null
  return String(value).slice(0, 10)
}

export async function resolveSeasonVersionPhase({
  seasonId,
  beginTime,
  endTime,
  version,
  phase,
}) {
  if (version && phase) {
    return {
      version: String(version).trim(),
      phase: String(phase).trim(),
      source: 'request',
    }
  }

  const catalog = seasonId ? getDefenseSeasonMetaById(seasonId) : null
  if (catalog) {
    return {
      version: catalog.version,
      phase: catalog.phase,
      source: 'defense-catalog',
    }
  }

  const startDate = normalizeDate(beginTime)
  const endDate = normalizeDate(endTime)

  if (startDate) {
    const [rows] = await pool.execute(
      `SELECT version, phase, start_date, end_date
       FROM date
       WHERE start_date <= ? AND end_date >= ?
       ORDER BY start_date DESC
       LIMIT 1`,
      [startDate, startDate],
    )
    if (rows[0]) {
      return {
        version: rows[0].version,
        phase: String(rows[0].phase),
        source: 'date-table',
      }
    }

    const [nearestRows] = await pool.execute(
      `SELECT version, phase, start_date, end_date
       FROM date
       ORDER BY ABS(DATEDIFF(start_date, ?))
       LIMIT 1`,
      [startDate],
    )
    if (nearestRows[0]) {
      return {
        version: nearestRows[0].version,
        phase: String(nearestRows[0].phase),
        source: 'date-table-nearest',
      }
    }
  }

  const suffix = String(seasonId).slice(-2)
  const guessedPhase = Number(suffix[0]) || 1
  return {
    version: version ?? '3.0',
    phase: phase ?? String(guessedPhase),
    source: 'fallback',
    warning: '未能从日期表匹配版本期数，已使用回退规则',
    beginTime,
    endTime,
  }
}
