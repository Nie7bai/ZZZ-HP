import pool from '../config/db.js'

let staggerSchemaEnsured = false

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column],
  )
  return Number(rows[0]?.c) > 0
}

/** boss / boss_info：失衡易伤 + 失衡时间 */
export async function ensureBossStaggerSchema() {
  if (staggerSchemaEnsured) return

  if (!(await columnExists('boss_info', 'stagger_multiplier'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN stagger_multiplier DECIMAL(5,3) NOT NULL DEFAULT 1.500 COMMENT '失衡易伤区基础乘数（1.5=150%）'`,
    )
    await pool.query(`UPDATE boss_info SET stagger_multiplier = 1.500 WHERE stagger_multiplier <= 0`)
  }

  if (!(await columnExists('boss', 'stagger_multiplier'))) {
    await pool.query(
      `ALTER TABLE boss
       ADD COLUMN stagger_multiplier DECIMAL(5,3) NULL COMMENT '失衡易伤区基础乘数；空则回退 boss_info'`,
    )
  }

  if (!(await columnExists('boss_info', 'stagger_time'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN stagger_time DECIMAL(8,2) NULL COMMENT '失衡时间（秒）'`,
    )
  }

  if (!(await columnExists('boss', 'stagger_time'))) {
    await pool.query(
      `ALTER TABLE boss
       ADD COLUMN stagger_time DECIMAL(8,2) NULL COMMENT '失衡时间（秒）；空则回退 boss_info'`,
    )
  }

  staggerSchemaEnsured = true
}

export const DEFAULT_BOSS_STAGGER_MULTIPLIER = 1.5

export function normalizeStaggerMultiplier(value, fallback = DEFAULT_BOSS_STAGGER_MULTIPLIER) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return fallback
  return Math.round(num * 1000) / 1000
}

/** 失衡时间（秒）；空 / 非法 → null */
export function normalizeStaggerTime(value) {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return Math.round(num * 100) / 100
}
