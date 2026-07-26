/**
 * Backfill character.base_panel with anomalyCritRate / anomalyCritDmg / anomalyDmgBonus.
 *
 * Usage:
 *   node scripts/migrate-agent-anomaly-base-stats.mjs
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { normalizeAgentBasePanel } from '../src/utils/calculatorBuffFields.js'

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
  const [rows] = await conn.query('SELECT id, name, base_panel, raw_json FROM `character`')
  let updated = 0

  await conn.beginTransaction()

  for (const row of rows) {
    const currentBase = parseJson(row.base_panel, {})
    const normalizedBase = normalizeAgentBasePanel(currentBase)
    const raw = parseJson(row.raw_json, {})
    const nextRaw = {
      ...raw,
      basePanel: normalizedBase,
    }

    const changed =
      asJson(currentBase) !== asJson(normalizedBase) ||
      asJson(raw.basePanel ?? null) !== asJson(normalizedBase)

    if (!changed) continue

    await conn.execute(
      `UPDATE \`character\`
       SET base_panel = CAST(? AS JSON), raw_json = CAST(? AS JSON)
       WHERE id = ?`,
      [asJson(normalizedBase), asJson(nextRaw), row.id],
    )
    updated += 1
    console.log(`Updated ${row.id} (${row.name})`)
  }

  await conn.commit()
  console.log(`Done. Updated ${updated} / ${rows.length} characters.`)
} catch (err) {
  await conn.rollback()
  throw err
} finally {
  await conn.end()
}
