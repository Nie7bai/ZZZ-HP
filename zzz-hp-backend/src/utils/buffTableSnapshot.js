/**
 * buff 表整表 / 按 mode 快照导出导入（危局 / 防卫 / 临界环境 Buff）
 */
import pool from '../config/db.js'
import { ensureEnvironmentBuffSchema } from './environmentBuffSchema.js'

export const BUFF_TABLE_SNAPSHOT_KIND = 'zzz-hp-buff-table'

function parseEffectBlocks(value) {
  if (value == null) return null
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  if (typeof value === 'object') return value
  return null
}

function asJsonColumn(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function normalizeMode(raw) {
  const mode = String(raw ?? '').trim()
  if (mode === 'crisis' || mode === 'defense' || mode === 'deduction') return mode
  return null
}

function normalizeRow(item) {
  const idRaw = item.id ?? item.Id
  const id =
    idRaw == null || idRaw === ''
      ? null
      : Number.isFinite(Number(idRaw))
        ? Number(idRaw)
        : null
  return {
    id: id != null && id > 0 ? id : null,
    version: String(item.version ?? item.Version ?? '').trim(),
    phase: String(item.phase ?? item.Phase ?? '').trim(),
    buffName: String(item.buffName ?? item.buff_name ?? '').trim(),
    buff: item.buff == null ? null : String(item.buff),
    buffImage:
      item.buffImage == null && item.buff_image == null
        ? null
        : String(item.buffImage ?? item.buff_image),
    effectBlocks: item.effectBlocks ?? item.effect_blocks ?? null,
    mode: normalizeMode(item.mode) || 'crisis',
  }
}

export async function exportBuffTableSnapshot(modeFilter = null) {
  await ensureEnvironmentBuffSchema()
  const mode = normalizeMode(modeFilter)
  const params = []
  let sql = `
    SELECT id, version, phase, buff_name, buff, buff_image, effect_blocks, mode
    FROM buff
  `
  if (mode) {
    sql += ` WHERE mode = ?`
    params.push(mode)
  }
  sql += ` ORDER BY mode, version, phase, id`

  const [rows] = await pool.query(sql, params)
  const byMode = {}
  for (const row of rows) {
    const m = String(row.mode ?? 'crisis')
    byMode[m] = (byMode[m] ?? 0) + 1
  }

  return {
    kind: BUFF_TABLE_SNAPSHOT_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    modeFilter: mode,
    count: rows.length,
    byMode,
    rows: rows.map((row) => ({
      id: Number(row.id),
      version: String(row.version ?? ''),
      phase: String(row.phase ?? ''),
      buffName: String(row.buff_name ?? ''),
      buff: row.buff == null ? null : String(row.buff),
      buffImage: row.buff_image == null ? null : String(row.buff_image),
      effectBlocks: parseEffectBlocks(row.effect_blocks),
      mode: String(row.mode ?? 'crisis'),
    })),
  }
}

/**
 * @param {object} payload
 * @param {{ replace?: boolean, mode?: string|null }} options
 */
export async function importBuffTableSnapshot(payload, options = {}) {
  await ensureEnvironmentBuffSchema()
  const replaceAll = Boolean(options.replace)
  const modeFilter = normalizeMode(options.mode ?? payload?.modeFilter)

  let items = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload)
      ? payload
      : []
  if (modeFilter) {
    items = items.filter((item) => (normalizeMode(item.mode) || 'crisis') === modeFilter)
  }

  const summary = {
    total: items.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    replaced: replaceAll,
    modeFilter,
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    if (replaceAll) {
      if (modeFilter) {
        await conn.execute(`DELETE FROM buff WHERE mode = ?`, [modeFilter])
      } else {
        await conn.query(`DELETE FROM buff`)
      }
    }

    for (const rawItem of items) {
      const item = normalizeRow(rawItem)
      if (!item.buffName || !item.version || !item.phase) {
        summary.skipped += 1
        continue
      }

      const effectJson = asJsonColumn(item.effectBlocks)
      const paramsBase = [
        item.version,
        item.phase,
        item.buffName,
        item.buff,
        item.buffImage,
        effectJson,
        item.mode,
      ]

      if (replaceAll) {
        if (item.id != null) {
          await conn.execute(
            `INSERT INTO buff (id, version, phase, buff_name, buff, buff_image, effect_blocks, mode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [item.id, ...paramsBase],
          )
        } else {
          await conn.execute(
            `INSERT INTO buff (version, phase, buff_name, buff, buff_image, effect_blocks, mode)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            paramsBase,
          )
        }
        summary.inserted += 1
        continue
      }

      let targetId = null
      if (item.id != null) {
        const [byId] = await conn.execute(`SELECT id FROM buff WHERE id = ? LIMIT 1`, [item.id])
        if (byId[0]?.id != null) targetId = Number(byId[0].id)
      }
      if (targetId == null) {
        const [byKey] = await conn.execute(
          `SELECT id FROM buff
           WHERE mode = ? AND version = ? AND phase = ? AND buff_name = ?
           LIMIT 1`,
          [item.mode, item.version, item.phase, item.buffName],
        )
        if (byKey[0]?.id != null) targetId = Number(byKey[0].id)
      }

      if (targetId != null) {
        await conn.execute(
          `UPDATE buff
           SET version = ?, phase = ?, buff_name = ?, buff = ?, buff_image = ?,
               effect_blocks = ?, mode = ?
           WHERE id = ?`,
          [...paramsBase, targetId],
        )
        summary.updated += 1
        continue
      }

      if (item.id != null) {
        await conn.execute(
          `INSERT INTO buff (id, version, phase, buff_name, buff, buff_image, effect_blocks, mode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [item.id, ...paramsBase],
        )
      } else {
        await conn.execute(
          `INSERT INTO buff (version, phase, buff_name, buff, buff_image, effect_blocks, mode)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          paramsBase,
        )
      }
      summary.inserted += 1
    }

    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }

  return summary
}
