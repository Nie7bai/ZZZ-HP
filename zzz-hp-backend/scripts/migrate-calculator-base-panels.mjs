import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import {
  normalizeAgentBasePanel,
  normalizeWengineAdvancedStats,
  readNumber,
} from '../src/utils/calculatorBuffFields.js'

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
