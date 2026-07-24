import pool from '../config/db.js'
import { createGuestbookNotification, notifyUsers } from './guestbookNotificationService.js'
import { ensureUserSecurityColumns, getUserById } from './userAuthService.js'
import { listSiteAdminUserIds } from './guestbookSocialService.js'

let ensured = false

async function ensureUnbanTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_unban_request (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      reason VARCHAR(500) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handled_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_gb_unban_user_status (user_id, status),
      KEY idx_gb_unban_status_created (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  ensured = true
}

export function formatBanRemaining(banUntil) {
  if (!banUntil) return '永久'
  const ms = new Date(banUntil).getTime() - Date.now()
  if (ms <= 0) return '已到期'
  const totalMin = Math.ceil(ms / 60000)
  if (totalMin < 60) return `${totalMin} 分钟`
  const hours = Math.floor(totalMin / 60)
  if (hours < 48) return `${hours} 小时`
  const days = Math.ceil(hours / 24)
  return `${days} 天`
}

export async function notifyUserBanned(userId, { reason = '', banUntil = null } = {}) {
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return
  const remain = formatBanRemaining(banUntil)
  const reasonText = String(reason || '').trim()
  let message = `你的账号已被管理员封禁（${remain === '永久' ? '永久' : `剩余 ${remain}`}）`
  if (reasonText) message += `：${reasonText}`
  await createGuestbookNotification({
    userId: uid,
    type: 'user_banned',
    postId: 0,
    postTitle: '账号封禁',
    actorUserId: null,
    actorNickname: '管理员',
    commentId: null,
    message,
  })
}

export async function submitUnbanRequest(userId, reason = '') {
  await ensureUnbanTable()
  await ensureUserSecurityColumns()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return { error: 'invalid' }

  const user = await getUserById(uid)
  if (!user) return { error: 'not_found' }
  if (!user.isBanned) return { error: 'not_banned' }

  const text = String(reason || '').trim().slice(0, 500)
  if (!text) return { error: 'empty' }

  const [pending] = await pool.query(
    `SELECT id FROM guestbook_unban_request
     WHERE user_id = ? AND status = 'pending' LIMIT 1`,
    [uid],
  )
  if (pending.length) return { error: 'duplicate', id: pending[0].id }

  const [result] = await pool.query(
    `INSERT INTO guestbook_unban_request (user_id, reason, status) VALUES (?, ?, 'pending')`,
    [uid, text],
  )

  const adminIds = await listSiteAdminUserIds()
  if (adminIds.length) {
    await notifyUsers(
      adminIds.filter((id) => id !== uid),
      {
        type: 'unban_request',
        postId: 0,
        postTitle: user.nickname || '用户',
        actorUserId: uid,
        actorNickname: user.nickname || '用户',
        commentId: null,
        message: text,
      },
    )
  }

  return { ok: true, id: result.insertId }
}
