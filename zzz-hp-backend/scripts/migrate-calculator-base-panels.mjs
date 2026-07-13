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
  directDmgMult: 100,
  anomalyMult: 0,
  disorderBaseMult: 0,
  anomalyDuration: 0,
  disorderCompMult: 0,
  turbulenceBaseMult: 0,
  turbulenceCompMult: 0,
  disorderDmgBonus: 0,
  turbulenceDmgBonus: 0,
}

const EMPTY_WENGINE_ADVANCED_STATS = {
  critRate: 0,
  critDmg: 0,
  energyRegen: 0,
  mastery: 0,
  externalAtkPercent: 0,
  externalHpPercent: 0,
  penRate: 0,
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
    directDmgMult: value.directDmgMult == null ? 100 : readNumber(value.directDmgMult),
    anomalyMult: readNumber(value.anomalyMult),
    disorderBaseMult: readNumber(value.disorderBaseMult),
    anomalyDuration: readNumber(value.anomalyDuration),
    disorderCompMult: readNumber(value.disorderCompMult),
    turbulenceBaseMult: readNumber(value.turbulenceBaseMult),
    turbulenceCompMult: readNumber(value.turbulenceCompMult),
    disorderDmgBonus: readNumber(value.disorderDmgBonus),
    turbulenceDmgBonus: readNumber(value.turbulenceDmgBonus),
  }
}

function normalizeWengineAdvancedStats(value) {
  const empty = { ...EMPTY_WENGINE_ADVANCED_STATS }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  return {
    critRate: readNumber(value.critRate),
    critDmg: readNumber(value.critDmg),
    energyRegen: readNumber(value.energyRegen),
    mastery: readNumber(value.mastery),
    externalAtkPercent: readNumber(value.externalAtkPercent),
    externalHpPercent: readNumber(value.externalHpPercent),
    penRate: readNumber(value.penRate),
  }
}

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
})

const [agentColumns] = await conn.query("SHOW COLUMNS FROM `character` LIKE 'base_panel'")
if (!agentColumns.length) {
  await conn.query(
    "ALTER TABLE `character` ADD COLUMN `base_panel` JSON NULL COMMENT '基础面板属性' AFTER `note`",
  )
  console.log('Added character.base_panel column')
} else {
  console.log('character.base_panel already exists')
}

const [wengineColumns] = await conn.query("SHOW COLUMNS FROM `W-Engine` LIKE 'base_atk'")
if (!wengineColumns.length) {
  await conn.query(
    "ALTER TABLE `W-Engine` ADD COLUMN `base_atk` DECIMAL(12, 2) NOT NULL DEFAULT 0 COMMENT '基础攻击力' AFTER `avatar_image`",
  )
  await conn.query(
    "ALTER TABLE `W-Engine` ADD COLUMN `advanced_stats` JSON NULL COMMENT '高级属性' AFTER `base_atk`",
  )
  console.log('Added W-Engine.base_atk and advanced_stats columns')
} else {
  console.log('W-Engine.base_atk already exists')
}

const [agents] = await conn.query('SELECT id, raw_json FROM `character`')
for (const row of agents) {
  const raw = parseJson(row.raw_json, {})
  const basePanel = normalizeAgentBasePanel(raw.basePanel)
  raw.basePanel = basePanel
  await conn.execute(
    'UPDATE `character` SET base_panel = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
    [JSON.stringify(basePanel), JSON.stringify(raw), row.id],
  )
}
console.log(`Backfilled base_panel for ${agents.length} characters`)

const [wengines] = await conn.query('SELECT id, raw_json FROM `W-Engine`')
for (const row of wengines) {
  const raw = parseJson(row.raw_json, {})
  const baseAtk = readNumber(raw.baseAtk)
  const advancedStats = normalizeWengineAdvancedStats(raw.advancedStats)
  raw.baseAtk = baseAtk
  raw.advancedStats = advancedStats
  await conn.execute(
    'UPDATE `W-Engine` SET base_atk = ?, advanced_stats = CAST(? AS JSON), raw_json = CAST(? AS JSON) WHERE id = ?',
    [baseAtk, JSON.stringify(advancedStats), JSON.stringify(raw), row.id],
  )
}
console.log(`Backfilled base_atk/advanced_stats for ${wengines.length} wengines`)

await conn.query('ALTER TABLE `character` MODIFY COLUMN `base_panel` JSON NOT NULL')
await conn.query('ALTER TABLE `W-Engine` MODIFY COLUMN `advanced_stats` JSON NOT NULL')

await conn.end()
