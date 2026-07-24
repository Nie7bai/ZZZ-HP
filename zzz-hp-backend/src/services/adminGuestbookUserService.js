import pool from '../config/db.js'
import {
  ensureUserSecurityColumns,
  getUserProfileById,
  updateUserProfile,
} from './userAuthService.js'
import { isGuestbookModerator } from './guestbookModeratorService.js'
import { notifyUserBanned } from './guestbookBanService.js'

function sanitizeKeyword(value) {
  return String(value || '')
    .trim()
    .replace(/[%_\\]/g, '')
    .slice(0, 80)
}

function mapAdminUser(row, extras = {}) {
  if (!row) return null
  const banUntil = row.banned_until || row.ban_until || null
  const flagged = Boolean(Number(row.is_banned || 0))
  const expired =
    flagged && banUntil != null && new Date(banUntil).getTime() <= Date.now()
  return {
    id: Number(row.id),
    mihoyoAid: row.mihoyo_aid || '',
    mihoyoMid: row.mihoyo_mid || '',
    nickname: row.nickname || '绳网旅人',
    avatar: row.avatar || '',
    bio: row.bio || '',
    banner: row.banner || '',
    phone: row.phone || '',
    hasPhone: Boolean(row.phone),
    hasPassword: Boolean(Number(row.has_password || 0)),
    profilePublicSocial: Boolean(Number(row.profile_public_social || 0)),
    isBanned: flagged && !expired,
    bannedAt: row.banned_at || null,
    banUntil,
    banReason: row.ban_reason || '',
    isSiteAdmin: Boolean(Number(row.is_site_admin || 0)),
    isGuestbookModerator: Boolean(extras.isGuestbookModerator),
    stats: {
      postCount: Number(extras.postCount || 0),
      commentCount: Number(extras.commentCount || 0),
      totalViews: Number(extras.totalViews || 0),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ADMIN_USER_SELECT = `u.id, u.mihoyo_aid, u.mihoyo_mid, u.nickname, u.avatar, u.bio, u.banner, u.phone,
            u.profile_public_social, u.is_banned, u.banned_at, u.ban_until, u.ban_reason, u.is_site_admin,
            u.created_at, u.updated_at,
            (CASE WHEN u.password_hash IS NULL OR u.password_hash = '' THEN 0 ELSE 1 END) AS has_password,
            (SELECT COUNT(*) FROM guestbook g WHERE g.user_id = u.id AND g.is_deleted = 0) AS post_count,
            (SELECT COUNT(*) FROM guestbook_comment c WHERE c.user_id = u.id) AS comment_count,
            (SELECT COALESCE(SUM(g2.view_count), 0) FROM guestbook g2 WHERE g2.user_id = u.id AND g2.is_deleted = 0) AS total_views`

export async function listGuestbookUsers({ q = '', banned = '', limit = 100, offset = 0 } = {}) {
  await ensureUserSecurityColumns()
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const safeOffset = Math.max(Number(offset) || 0, 0)
  const clauses = []
  const params = []

  const keyword = sanitizeKeyword(q)
  if (keyword) {
    if (/^\d+$/.test(keyword)) {
      clauses.push('(u.id = ? OR u.mihoyo_aid LIKE ? OR u.phone LIKE ? OR u.nickname LIKE ?)')
      params.push(Number(keyword), `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    } else {
      clauses.push('(u.nickname LIKE ? OR u.mihoyo_aid LIKE ? OR u.mihoyo_mid LIKE ? OR u.phone LIKE ?)')
      const like = `%${keyword}%`
      params.push(like, like, like, like)
    }
  }

  if (banned === '1' || banned === 'true') {
    clauses.push(
      `(u.is_banned = 1 AND (u.ban_until IS NULL OR u.ban_until > CURRENT_TIMESTAMP))`,
    )
  } else if (banned === '0' || banned === 'false') {
    clauses.push(
      `(u.is_banned = 0 OR (u.ban_until IS NOT NULL AND u.ban_until <= CURRENT_TIMESTAMP))`,
    )
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM guestbook_user u ${where}`,
    params,
  )

  const [rows] = await pool.query(
    `SELECT ${ADMIN_USER_SELECT}
     FROM guestbook_user u
     ${where}
     ORDER BY u.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  )

  const list = []
  for (const row of rows) {
    const moderator = await isGuestbookModerator(row.mihoyo_aid, row.mihoyo_mid || '')
    list.push(
      mapAdminUser(row, {
        isGuestbookModerator: moderator,
        postCount: row.post_count,
        commentCount: row.comment_count,
        totalViews: row.total_views,
      }),
    )
  }

  return {
    total: Number(countRow?.cnt || 0),
    limit: safeLimit,
    offset: safeOffset,
    users: list,
  }
}

export async function getGuestbookUserAdmin(id) {
  await ensureUserSecurityColumns()
  const uid = Number(id)
  if (!Number.isFinite(uid) || uid <= 0) return null

  const [rows] = await pool.query(
    `SELECT ${ADMIN_USER_SELECT}
     FROM guestbook_user u
     WHERE u.id = ?
     LIMIT 1`,
    [uid],
  )
  const row = rows[0]
  if (!row) return null
  const moderator = await isGuestbookModerator(row.mihoyo_aid, row.mihoyo_mid || '')
  return mapAdminUser(row, {
    isGuestbookModerator: moderator,
    postCount: row.post_count,
    commentCount: row.comment_count,
    totalViews: row.total_views,
  })
}

export async function adminUpdateGuestbookUser(id, patch = {}) {
  await ensureUserSecurityColumns()
  const uid = Number(id)
  if (!Number.isFinite(uid) || uid <= 0) return { error: '无效用户 ID' }

  try {
    await updateUserProfile(uid, patch)
  } catch (err) {
    return { error: err.message || '更新失败' }
  }

  if (typeof patch.isSiteAdmin === 'boolean') {
    await pool.query(`UPDATE guestbook_user SET is_site_admin = ? WHERE id = ?`, [
      patch.isSiteAdmin ? 1 : 0,
      uid,
    ])
  }

  return getGuestbookUserAdmin(uid)
}

/**
 * @param {{ banned: boolean, reason?: string, durationHours?: number | null }} options
 * durationHours: null/undefined/0 = 永久；正数为小时数
 */
export async function setGuestbookUserBanned(
  id,
  { banned, reason = '', durationHours = null } = {},
) {
  await ensureUserSecurityColumns()
  const uid = Number(id)
  if (!Number.isFinite(uid) || uid <= 0) return { error: '无效用户 ID' }

  const existing = await getGuestbookUserAdmin(uid)
  if (!existing) return { error: '用户不存在' }

  const nextBanned = Boolean(banned)
  const banReason = String(reason || '').trim().slice(0, 200)

  if (nextBanned) {
    let banUntil = null
    const hours = Number(durationHours)
    if (Number.isFinite(hours) && hours > 0) {
      banUntil = new Date(Date.now() + hours * 3600 * 1000)
    }
    await pool.query(
      `UPDATE guestbook_user
       SET is_banned = 1, banned_at = CURRENT_TIMESTAMP, ban_until = ?, ban_reason = ?
       WHERE id = ?`,
      [banUntil, banReason, uid],
    )
    await notifyUserBanned(uid, { reason: banReason, banUntil })
  } else {
    await pool.query(
      `UPDATE guestbook_user
       SET is_banned = 0, banned_at = NULL, ban_until = NULL, ban_reason = ''
       WHERE id = ?`,
      [uid],
    )
    try {
      await pool.query(
        `UPDATE guestbook_unban_request SET status = 'handled', handled_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND status = 'pending'`,
        [uid],
      )
    } catch {
      /* 表可能尚未创建 */
    }
  }

  return getGuestbookUserAdmin(uid)
}

export async function adminGetUserProfile(id) {
  return getUserProfileById(id)
}
