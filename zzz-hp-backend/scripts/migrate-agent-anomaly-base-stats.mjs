/**
 * Backfill character.base_panel with anomalyCritRate / anomalyCritDmg / anomalyDmgBonus.
 *
 * Usage:
 *   node scripts/migrate-agent-anomaly-base-stats.mjs
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

const EMPTY_AGENT_BASE_PANEL = {
  hp: 0,
  atk: 0,
  def: 0,
  critRate: 0,
  critDmg: 0,
  mastery: 0,
  penRate: 0,
  dmgBonus: 0,
  pen: 0,
  anomalyCritRate: 0,
  anomalyCritDmg: 0,
  anomalyDmgBonus: 0,
}

function readNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

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

function normalizeAgentBasePanel(value) {
  const empty = { ...EMPTY_AGENT_BASE_PANEL }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  return {
    hp: readNumber(value.hp),
    atk: readNumber(value.atk),
    def: readNumber(value.def),
    critRate: readNumber(value.critRate),
    critDmg: readNumber(value.critDmg),
    mastery: readNumber(value.mastery),
    penRate: readNumber(value.penRate),
    dmgBonus: readNumber(value.dmgBonus),
    pen: readNumber(value.pen),
    anomalyCritRate: readNumber(value.anomalyCritRate),
    anomalyCritDmg: readNumber(value.anomalyCritDmg),
    anomalyDmgBonus: readNumber(value.anomalyDmgBonus),
  }
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
