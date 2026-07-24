import pool from '../config/db.js'

let ensured = false

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_moderator (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      mihoyo_aid VARCHAR(64) NOT NULL,
      mihoyo_mid VARCHAR(64) NOT NULL DEFAULT '',
      note VARCHAR(80) NOT NULL DEFAULT '',
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_mod_aid (mihoyo_aid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guestbook_moderator'`,
  )
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('is_enabled')) {
    await pool.query(
      `ALTER TABLE guestbook_moderator ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用' AFTER note`,
    )
  }
  ensured = true
}

function mapModerator(row) {
  return {
    id: row.id,
    mihoyoAid: row.mihoyo_aid,
    mihoyoMid: row.mihoyo_mid || '',
    note: row.note || '',
    isEnabled: row.is_enabled == null ? true : Boolean(Number(row.is_enabled)),
    createdAt: row.created_at,
  }
}

export async function listGuestbookModerators() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT id, mihoyo_aid, mihoyo_mid, note, is_enabled, created_at
     FROM guestbook_moderator
     ORDER BY created_at DESC, id DESC`,
  )
  return rows.map(mapModerator)
}

export async function addGuestbookModerator({ mihoyoAid, mihoyoMid = '', note = '' }) {
  await ensureTable()
  const aid = String(mihoyoAid || '').trim()
  const mid = String(mihoyoMid || '').trim()
  const label = String(note || '').trim().slice(0, 80)
  if (!aid) return { error: 'AID 不能为空' }

  try {
    const [result] = await pool.query(
      `INSERT INTO guestbook_moderator (mihoyo_aid, mihoyo_mid, note) VALUES (?, ?, ?)`,
      [aid, mid, label],
    )
    const [rows] = await pool.query(
      `SELECT id, mihoyo_aid, mihoyo_mid, note, is_enabled, created_at FROM guestbook_moderator WHERE id = ? LIMIT 1`,
      [result.insertId],
    )
    return mapModerator(rows[0])
  } catch (err) {
    if (String(err?.code) === 'ER_DUP_ENTRY') return { error: '该 AID 已是留言板管理员' }
    throw err
  }
}

export async function removeGuestbookModerator(id) {
  await ensureTable()
  const [result] = await pool.query(`DELETE FROM guestbook_moderator WHERE id = ?`, [id])
  return result.affectedRows > 0
}

export async function isGuestbookModerator(aid, mid = '') {
  await ensureTable()
  const normalizedAid = String(aid || '').trim()
  if (!normalizedAid) return false
  const [rows] = await pool.query(
    `SELECT id FROM guestbook_moderator WHERE mihoyo_aid = ? AND is_enabled = 1 LIMIT 1`,
    [normalizedAid],
  )
  return rows.length > 0
}

export async function setGuestbookModeratorEnabled(id, enabled) {
  await ensureTable()
  const rowId = Number(id)
  if (!Number.isFinite(rowId) || rowId <= 0) return null
  await pool.query(`UPDATE guestbook_moderator SET is_enabled = ? WHERE id = ?`, [enabled ? 1 : 0, rowId])
  const [rows] = await pool.query(
    `SELECT id, mihoyo_aid, mihoyo_mid, note, is_enabled, created_at FROM guestbook_moderator WHERE id = ? LIMIT 1`,
    [rowId],
  )
  return rows[0] ? mapModerator(rows[0]) : null
}
