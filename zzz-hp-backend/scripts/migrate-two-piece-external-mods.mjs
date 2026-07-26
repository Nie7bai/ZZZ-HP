/**
 * Migrate drive_disc.two_piece_mods to include externalHpPercent / externalAtkPercent.
 *
 * Usage:
 *   node scripts/migrate-two-piece-external-mods.mjs
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { normalizeTwoPieceMods } from '../src/utils/calculatorBuffFields.js'

dotenv.config()

function parseJson(value, fallback) {
  if (value == null) return fallback
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return fallback
}

function asJson(value) {
  return JSON.stringify(value ?? null)
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

try {
  const [rows] = await conn.query('SELECT id, name, two_piece_mods, raw_json FROM `drive_disc`')
  let updated = 0

  await conn.beginTransaction()

  for (const row of rows) {
    const currentMods = parseJson(row.two_piece_mods, {})
    const normalizedMods = normalizeTwoPieceMods(currentMods)
    const raw = parseJson(row.raw_json, {})
    const nextRaw = {
      ...raw,
      twoPieceMods: normalizedMods,
    }

    const changed =
      asJson(currentMods) !== asJson(normalizedMods) ||
      asJson(raw.twoPieceMods ?? null) !== asJson(normalizedMods)

    if (!changed) continue

    await conn.execute(
      `UPDATE \`drive_disc\`
       SET two_piece_mods = CAST(? AS JSON), raw_json = CAST(? AS JSON)
       WHERE id = ?`,
      [asJson(normalizedMods), asJson(nextRaw), row.id],
    )
    updated += 1
    console.log(`Updated ${row.id} (${row.name})`)
  }

  await conn.commit()
  console.log(`Done. Updated ${updated} / ${rows.length} drive discs.`)
} catch (err) {
  await conn.rollback()
  throw err
} finally {
  await conn.end()
}
