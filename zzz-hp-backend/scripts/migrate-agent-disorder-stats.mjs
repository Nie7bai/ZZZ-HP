/**
 * Backfill character.base_panel with disorderBaseMult / anomalyDuration / disorderCompMult.
 *
 * Usage:
 *   node scripts/migrate-agent-disorder-stats.mjs
 */
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

function isMiyabiAgent(id = '', name = '') {
  const text = `${id} ${name}`.toLowerCase()
  return text.includes('miyabi') || text.includes('星见雅')
}

function defaultDisorderStats(element, id = '', name = '') {
  if (element === '风') {
    return { disorderBaseMult: 0, anomalyDuration: 30, disorderCompMult: 0 }
  }
  if (isMiyabiAgent(id, name)) {
    return { disorderBaseMult: 600, anomalyDuration: 20, disorderCompMult: 75 }
  }
  const disorderCompByElement = {
    物理: 7.5,
    冰: 7.5,
    火: 50,
    电: 125,
    以太: 62.5,
  }
  return {
    disorderBaseMult: 450,
    anomalyDuration: 10,
    disorderCompMult: disorderCompByElement[element] ?? 0,
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
  const defaults = defaultDisorderStats(element, id, name)
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
    disorderBaseMult:
      base.disorderBaseMult == null ? defaults.disorderBaseMult : readNumber(base.disorderBaseMult),
    anomalyDuration:
      base.anomalyDuration == null ? defaults.anomalyDuration : readNumber(base.anomalyDuration),
    disorderCompMult:
      base.disorderCompMult == null ? defaults.disorderCompMult : readNumber(base.disorderCompMult),
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
    console.log(
      `Updated ${row.id} (${row.name} / ${row.element}) base=${normalizedBase.disorderBaseMult} dur=${normalizedBase.anomalyDuration} comp=${normalizedBase.disorderCompMult}`,
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
