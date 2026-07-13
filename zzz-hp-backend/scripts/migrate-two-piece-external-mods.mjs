/**
 * Migrate drive_disc.two_piece_mods to include externalHpPercent / externalAtkPercent.
 *
 * Usage:
 *   node scripts/migrate-two-piece-external-mods.mjs
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

const BUFF_STAT_KEYS = [
  'inCombatHpPercent',
  'inCombatAtkPercent',
  'externalHpPercent',
  'externalAtkPercent',
  'atk',
  'dmgBonus',
  'critRate',
  'critDmg',
  'penRate',
  'reduceDefense',
  'resPen',
  'mastery',
  'pierce',
  'vulnerable',
  'staggerVulnerable',
  'special',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyDmgBonus',
  'directDmgMult',
  'anomalyMult',
  'disorderBaseMult',
  'anomalyDuration',
  'disorderCompMult',
  'turbulenceBaseMult',
  'turbulenceCompMult',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
]

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

function createEmptyBuffStatModifiers() {
  return Object.fromEntries(BUFF_STAT_KEYS.map((key) => [key, 0]))
}

function normalizeBuffStatModifiers(value) {
  const result = createEmptyBuffStatModifiers()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of BUFF_STAT_KEYS) {
    result[key] = readNumber(value[key])
  }
  if (readNumber(value.externalAtkPercent) && !result.inCombatAtkPercent) {
    result.inCombatAtkPercent = readNumber(value.externalAtkPercent)
  }
  return result
}

function normalizeTwoPieceMods(value) {
  const mods = normalizeBuffStatModifiers(value)
  if (!mods.externalHpPercent && mods.inCombatHpPercent) {
    mods.externalHpPercent = mods.inCombatHpPercent
  }
  if (!mods.externalAtkPercent && mods.inCombatAtkPercent) {
    mods.externalAtkPercent = mods.inCombatAtkPercent
  }
  mods.inCombatHpPercent = 0
  mods.inCombatAtkPercent = 0
  return mods
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
