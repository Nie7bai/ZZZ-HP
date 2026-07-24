import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import {
  CRISIS_BASE_HP_BY_NAME,
  calcCrisisHpCoeffPercent,
} from '../src/utils/crisisHpCoeff.js'

dotenv.config()

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'zzz',
  charset: 'utf8mb4',
  multipleStatements: true,
})

async function columnExists(table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column],
  )
  return Number(rows[0]?.c) > 0
}

async function indexExists(table, indexName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [table, indexName],
  )
  return Number(rows[0]?.c) > 0
}

if (!(await columnExists('boss_info', 'crisis_base_hp'))) {
  await conn.query(
    `ALTER TABLE boss_info
     ADD COLUMN crisis_base_hp DOUBLE NULL COMMENT '怪物危局基础血量' AFTER resistance`,
  )
  console.log('Added boss_info.crisis_base_hp')
}

if (!(await columnExists('boss', 'hp_coeff_percent'))) {
  await conn.query(
    `ALTER TABLE boss
     ADD COLUMN hp_coeff_percent INT NULL COMMENT '危局血量系数%（手动覆盖，空则自动计算）' AFTER hp`,
  )
  console.log('Added boss.hp_coeff_percent')
}

if (!(await columnExists('date', 'mode'))) {
  await conn.query(
    `ALTER TABLE \`date\`
     ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'crisis' COMMENT 'crisis|defense' AFTER id`,
  )
  console.log('Added date.mode')
}

await conn.query(`UPDATE \`date\` SET mode = 'crisis' WHERE mode IS NULL OR mode = ''`)

if (!(await indexExists('date', 'uk_date_mode_version_phase'))) {
  // Drop loose duplicates before unique index if needed
  try {
    await conn.query(
      `ALTER TABLE \`date\`
       ADD UNIQUE KEY uk_date_mode_version_phase (mode, version, phase)`,
    )
    console.log('Added uk_date_mode_version_phase')
  } catch (err) {
    console.warn('Unique index skipped:', err.message)
  }
}

let seeded = 0
for (const [name, baseHp] of Object.entries(CRISIS_BASE_HP_BY_NAME)) {
  const [existing] = await conn.query(
    'SELECT id, crisis_base_hp FROM boss_info WHERE boss_name = ? LIMIT 1',
    [name],
  )
  if (existing.length) {
    await conn.query('UPDATE boss_info SET crisis_base_hp = ? WHERE id = ?', [
      baseHp,
      existing[0].id,
    ])
  } else {
    await conn.query(
      `INSERT INTO boss_info (boss_name, defense, level, crisis_base_hp)
       VALUES (?, 0, 1, ?)`,
      [name, baseHp],
    )
  }
  seeded += 1
}
console.log(`Seeded crisis_base_hp for ${seeded} monsters`)

const [bossRows] = await conn.query(
  `SELECT b.id, b.boss_name, b.hp, b.hp_coeff_percent, i.crisis_base_hp
   FROM boss b
   LEFT JOIN boss_info i ON i.boss_name = b.boss_name`,
)
let preview = 0
for (const row of bossRows) {
  const base = row.crisis_base_hp != null ? Number(row.crisis_base_hp) : null
  const auto = calcCrisisHpCoeffPercent(row.hp, base)
  if (auto != null) preview += 1
}
console.log(`Bosses with auto-computable coeff: ${preview}/${bossRows.length}`)

await conn.end()
console.log('Migration done')
