import pool from '../config/db.js'

export const MAX_LEVEL = 16

/** 当前等级升下一级所需经验（经验槽目标） */
export const LEVEL_EXP_REQUIRED = {
  1: 30,
  2: 110,
  3: 290,
  4: 592,
  5: 1168,
  6: 2190,
  7: 2190,
  8: 2190,
  9: 2920,
  10: 3650,
  11: 3650,
  12: 3942,
  13: 4818,
  14: 5840,
  15: 8030,
}

const EXP_RULES = {
  checkin: { exp: 5, dailyLimit: 1, label: '打卡' },
  post: { exp: 6, dailyLimit: 2, label: '发主帖' },
  comment: { exp: 3, dailyLimit: 3, label: '发评论' },
  like: { exp: 1, dailyLimit: 10, label: '点赞' },
  receive_like: { exp: 2, dailyLimit: 10, label: '被点赞' },
  receive_comment: { exp: 4, dailyLimit: 10, label: '被回复' },
  receive_favorite: { exp: 2, dailyLimit: 10, label: '被收藏' },
}

let ensured = false

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function mapExpProgress(levelRaw, expRaw) {
  const level = Math.min(Math.max(Number(levelRaw) || 1, 1), MAX_LEVEL)
  const exp = Math.max(Number(expRaw) || 0, 0)
  if (level >= MAX_LEVEL) {
    return { level, exp, expRequired: null, isMaxLevel: true }
  }
  return {
    level,
    exp,
    expRequired: LEVEL_EXP_REQUIRED[level] || null,
    isMaxLevel: false,
  }
}

async function ensureTables() {
  if (ensured) return
  const [cols] = await pool.query(`SHOW COLUMNS FROM guestbook_user`)
  const names = new Set(cols.map((c) => c.Field))
  if (!names.has('level')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '等级' AFTER ban_reason`,
    )
  }
  if (!names.has('exp')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN exp INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前等级经验' AFTER level`,
    )
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_exp_daily (
      user_id INT UNSIGNED NOT NULL,
      action_type VARCHAR(32) NOT NULL,
      action_date DATE NOT NULL,
      action_count INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, action_type, action_date),
      KEY idx_gb_exp_daily_date (action_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  ensured = true
}

async function applyExpGain(userId, amount) {
  await ensureTables()
  const id = Number(userId)
  if (!Number.isFinite(id) || id <= 0 || amount <= 0) return null

  const [rows] = await pool.query(
    `SELECT id, level, exp FROM guestbook_user WHERE id = ? LIMIT 1`,
    [id],
  )
  if (!rows[0]) return null

  let level = Math.max(Number(rows[0].level) || 1, 1)
  let exp = Math.max(Number(rows[0].exp) || 0, 0) + amount
  const startLevel = level

  while (level < MAX_LEVEL) {
    const need = LEVEL_EXP_REQUIRED[level]
    if (!need || exp < need) break
    exp -= need
    level += 1
  }

  await pool.query(`UPDATE guestbook_user SET level = ?, exp = ? WHERE id = ?`, [level, exp, id])
  return {
    ...mapExpProgress(level, exp),
    leveledUp: level > startLevel,
  }
}

export async function getUserExpProgress(userId) {
  await ensureTables()
  const id = Number(userId)
  if (!Number.isFinite(id) || id <= 0) return mapExpProgress(1, 0)
  const [rows] = await pool.query(`SELECT level, exp FROM guestbook_user WHERE id = ? LIMIT 1`, [id])
  if (!rows[0]) return mapExpProgress(1, 0)
  return mapExpProgress(rows[0].level, rows[0].exp)
}

export async function awardGuestbookExp(userId, actionType) {
  await ensureTables()
  const rule = EXP_RULES[actionType]
  const id = Number(userId)
  if (!rule || !Number.isFinite(id) || id <= 0) return null

  const date = todayKey()
  const [rows] = await pool.query(
    `SELECT action_count FROM guestbook_exp_daily
     WHERE user_id = ? AND action_type = ? AND action_date = ? LIMIT 1`,
    [id, actionType, date],
  )
  const used = Number(rows[0]?.action_count || 0)
  if (used >= rule.dailyLimit) return { awarded: false, reason: 'daily_limit' }

  await pool.query(
    `INSERT INTO guestbook_exp_daily (user_id, action_type, action_date, action_count)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE action_count = action_count + 1`,
    [id, actionType, date],
  )

  const progress = await applyExpGain(id, rule.exp)
  return { awarded: true, gained: rule.exp, progress }
}

export async function getUserExpDailyStatus(userId) {
  await ensureTables()
  const id = Number(userId)
  const progress = await getUserExpProgress(id)
  if (!Number.isFinite(id) || id <= 0) {
    return { ...progress, dailyTasks: [] }
  }

  const date = todayKey()
  const [rows] = await pool.query(
    `SELECT action_type, action_count FROM guestbook_exp_daily
     WHERE user_id = ? AND action_date = ?`,
    [id, date],
  )
  const countMap = new Map(rows.map((row) => [row.action_type, Number(row.action_count || 0)]))
  const dailyTasks = Object.entries(EXP_RULES).map(([key, rule]) => ({
    key,
    label: rule.label,
    exp: rule.exp,
    dailyLimit: rule.dailyLimit,
    used: countMap.get(key) || 0,
  }))

  return { ...progress, dailyTasks }
}

export async function checkInGuestbook(userId) {
  const result = await awardGuestbookExp(userId, 'checkin')
  if (!result) return { error: 'invalid' }
  if (!result.awarded && result.reason === 'daily_limit') {
    return { error: 'already_checked_in', progress: await getUserExpProgress(userId) }
  }
  return { ok: true, gained: result.gained, progress: result.progress }
}
