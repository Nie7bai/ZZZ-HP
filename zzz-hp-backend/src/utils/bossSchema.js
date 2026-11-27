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

let resistanceSchemaEnsured = false

/** boss / boss_info：高抗性属性（40%） */
export async function ensureBossResistanceSchema() {
  if (resistanceSchemaEnsured) return

  if (!(await columnExists('boss_info', 'resistance_high'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN resistance_high VARCHAR(255) NULL COMMENT '高抗性属性（40%）；为 resistance 的子集'`,
    )
  }

  if (!(await columnExists('boss', 'resistance_high'))) {
    await pool.query(
      `ALTER TABLE boss
       ADD COLUMN resistance_high VARCHAR(255) NULL COMMENT '高抗性属性（40%）；为 resistance 的子集；空则回退 boss_info'`,
    )
  }

  resistanceSchemaEnsured = true
}

let anomalySchemaEnsured = false

/** boss_info：异常条系数（怪物库属性，boss 表不按期数存列） */
export async function ensureBossAnomalySchema() {
  if (anomalySchemaEnsured) return

  if (!(await columnExists('boss_info', 'anomaly_bar_coefficient'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN anomaly_bar_coefficient DECIMAL(6,4) NULL COMMENT '异常条系数；初始异常积蓄 = 基础异常条 × 系数；空按 1 处理'`,
    )
  }

  anomalySchemaEnsured = true
}

let scoringNoteSchemaEnsured = false

/**
 * `boss_info.scoring_note`：得分机制（纯文本，无增益）。
 *
 * 得分机制与怪物绑定、一般不会随期数更换，所以存在怪物库而不是赛季表；
 * 危局详情页把它显示在「场地 Buff」上方。
 */
export async function ensureBossScoringNoteSchema() {
  if (scoringNoteSchemaEnsured) return

  if (!(await columnExists('boss_info', 'scoring_note'))) {
    await pool.query(
      `ALTER TABLE boss_info
       ADD COLUMN scoring_note TEXT NULL COMMENT '得分机制（纯文本，无增益；危局详情显示在场地 Buff 上方）'`,
    )
  }

  // 期数行覆盖：某些期会改得分机制；空 = 沿用怪物库那份
  if (!(await columnExists('boss', 'scoring_note'))) {
    await pool.query(
      `ALTER TABLE boss
       ADD COLUMN scoring_note TEXT NULL COMMENT '本期覆盖的得分机制；空则回退 boss_info.scoring_note'`,
    )
  }

  scoringNoteSchemaEnsured = true
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

/** 异常条系数；初始异常积蓄 = 基础异常条 × 系数；空 / 非法 / ≤0 → null（展示按 1 处理） */
export function normalizeAnomalyBarCoefficient(value) {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num * 10000) / 10000
}
