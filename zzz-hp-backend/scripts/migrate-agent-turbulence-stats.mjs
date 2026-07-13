/**
 * Backfill character.base_panel with turbulence + disorder/turbulence dmg bonus fields.
 *
 * Usage:
 *   node scripts/migrate-agent-turbulence-stats.mjs
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

function isMiyabiAgent(id = '', name = '') {
  const text = `${id} ${name}`.toLowerCase()
  return text.includes('miyabi') || text.includes('星见雅')
}

function defaultDisorderCompMultByElement(element, id = '', name = '') {
  if (element === '风') return 0
  if (isMiyabiAgent(id, name)) return 75
  const map = { 物理: 7.5, 冰: 7.5, 火: 50, 电: 125, 以太: 62.5 }
  return map[element] ?? 0
}

function defaultTurbulenceStats(element, id = '', name = '') {
  if (isMiyabiAgent(id, name)) {
    return {
      turbulenceBaseMult: 0,
      turbulenceCompMult: defaultDisorderCompMultByElement(element, id, name),
    }
  }
  const turbulenceBaseByElement = { 物理: 800, 冰: 1300, 火: 900, 电: 650, 以太: 650 }
  return {
    turbulenceBaseMult: turbulenceBaseByElement[element] ?? 0,
    turbulenceCompMult: defaultDisorderCompMultByElement(element, id, name),
  }
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

function normalizeAgentBasePanel(value, element, id, name) {
  const turbulence = defaultTurbulenceStats(element, id, name)
  const base = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    hp: readNumber(base.hp),
    atk: readNumber(base.atk),
    def: readNumber(base.def),
    critRate: readNumber(base.critRate),
    critDmg: readNumber(base.critDmg),
    mastery: readNumber(base.mastery),
    penRate: readNumber(base.penRate),
    dmgBonus: readNumber(base.dmgBonus),
    pen: readNumber(base.pen),
    anomalyCritRate: readNumber(base.anomalyCritRate),
    anomalyCritDmg: readNumber(base.anomalyCritDmg),
    anomalyDmgBonus: readNumber(base.anomalyDmgBonus),
    directDmgMult: base.directDmgMult == null ? 100 : readNumber(base.directDmgMult),
    anomalyMult: readNumber(base.anomalyMult),
    disorderBaseMult: readNumber(base.disorderBaseMult),
    anomalyDuration: readNumber(base.anomalyDuration),
    disorderCompMult: readNumber(base.disorderCompMult),
    turbulenceBaseMult:
      base.turbulenceBaseMult == null
        ? turbulence.turbulenceBaseMult
        : readNumber(base.turbulenceBaseMult),
    turbulenceCompMult:
      base.turbulenceCompMult == null
        ? turbulence.turbulenceCompMult
        : readNumber(base.turbulenceCompMult),
    disorderDmgBonus: readNumber(base.disorderDmgBonus),
    turbulenceDmgBonus: readNumber(base.turbulenceDmgBonus),
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
  const [rows] = await conn.query(
    'SELECT id, name, element, base_panel, raw_json FROM `character`',
  )
  let updated = 0

  await conn.beginTransaction()

  for (const row of rows) {
    const currentBase = parseJson(row.base_panel, {})
    const normalizedBase = normalizeAgentBasePanel(
      currentBase,
      row.element,
      row.id,
      row.name,
    )
    const raw = parseJson(row.raw_json, {})
    const nextRaw = { ...raw, basePanel: normalizedBase }

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
    console.log(
      `Updated ${row.id} (${row.name} / ${row.element}) turbBase=${normalizedBase.turbulenceBaseMult} turbComp=${normalizedBase.turbulenceCompMult}`,
    )
  }

  await conn.commit()
  console.log(`Done. Updated ${updated} / ${rows.length} characters.`)
} catch (err) {
  await conn.rollback()
  throw err
} finally {
  await conn.end()
}
