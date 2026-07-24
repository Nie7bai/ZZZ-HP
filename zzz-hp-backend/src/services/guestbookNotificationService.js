import pool from '../config/db.js'

let ensured = false

function sanitizeNotifyText(text, maxLen = 500) {
  let raw = String(text || '')
  for (let i = 0; i < 8; i++) {
    const next = raw
      .replace(/\[\[quote:(?:comment|dm):\d+\|[^|\]]+\|[\s\S]*?\]\]\n?/g, '')
      .replace(/\[\[quote:(?:comment|dm):\d+[\s\S]*?\]\]\n?/g, '')
      .replace(/\[\[quote:(?:comment|dm):[\s\S]*?\]\]/g, '')
      .replace(/quote:(?:comment|dm):\d+\|[^|\]]+\|/g, '')
      .replace(/quote:(?:comment|dm):\d+/g, '')
      .replace(/\[\[/g, '')
      .replace(/\]\]/g, '')
    if (next === raw) break
    raw = next
  }
  return raw.replace(/\s+/g, ' ').trim().slice(0, maxLen)
}

export const NOTIFICATION_TYPES = [
  'like',
  'favorite',
  'comment',
  'mention',
  'post_hidden',
  'post_deleted',
  'post_restored',
  'restore_request',
  'announcement',
  'changelog',
  'follow_post',
  'report',
  'report_handled',
  'user_banned',
  'unban_request',
]

export const SYSTEM_NOTIFICATION_TYPES = new Set([
  'like',
  'favorite',
  'comment',
  'post_hidden',
  'post_deleted',
  'post_restored',
  'restore_request',
  'announcement',
  'changelog',
  'report',
  'report_handled',
  'user_banned',
  'unban_request',
])

export const FOLLOW_NOTIFICATION_TYPES = new Set(['follow_post'])

const SELF_SUPPRESS_TYPES = new Set(['like', 'favorite', 'comment', 'mention'])
const SYSTEM_ACTOR_TYPES = new Set(['post_hidden', 'post_deleted', 'post_restored', 'restore_request'])

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_notification (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      type VARCHAR(24) NOT NULL,
      post_id INT UNSIGNED NOT NULL,
      post_title VARCHAR(120) NOT NULL DEFAULT '',
      actor_user_id INT UNSIGNED NULL,
      actor_nickname VARCHAR(40) NOT NULL DEFAULT '',
      comment_id INT UNSIGNED NULL,
      message VARCHAR(500) NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_gb_notify_user_created (user_id, created_at),
      KEY idx_gb_notify_user_read (user_id, is_read, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guestbook_notification'`,
  )
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('message')) {
    await pool.query(
      `ALTER TABLE guestbook_notification ADD COLUMN message VARCHAR(500) NULL COMMENT '附加说明' AFTER comment_id`,
    )
  }
  ensured = true
}

function mapNotification(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    postId: row.post_id,
    postTitle: sanitizeNotifyText(row.post_title || '', 120),
    actorUserId: row.actor_user_id != null ? Number(row.actor_user_id) : null,
    actorNickname: row.actor_nickname || '',
    actorAvatar: row.actor_avatar || '',
    commentId: row.comment_id != null ? Number(row.comment_id) : null,
    message: sanitizeNotifyText(row.message || '', 500),
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  }
}

export async function createGuestbookNotification({
  userId,
  type,
  postId,
  postTitle = '',
  actorUserId = null,
  actorNickname = '',
  commentId = null,
  message = '',
}) {
  await ensureTable()
  const uid = Number(userId)
  const pid = Number(postId)
  if (!Number.isFinite(uid) || uid <= 0) return null
  if (!NOTIFICATION_TYPES.includes(type)) return null
  const allowZeroPost =
    type === 'report' ||
    type === 'report_handled' ||
    type === 'user_banned' ||
    type === 'unban_request'
  if (!allowZeroPost && (!Number.isFinite(pid) || pid <= 0)) return null
  const safePostId = Number.isFinite(pid) && pid > 0 ? pid : 0

  const actorId = actorUserId != null ? Number(actorUserId) : null
  if (actorId && actorId === uid && SELF_SUPPRESS_TYPES.has(type)) return null

  const [result] = await pool.query(
    `INSERT INTO guestbook_notification
       (user_id, type, post_id, post_title, actor_user_id, actor_nickname, comment_id, message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid,
      type,
      safePostId,
      sanitizeNotifyText(postTitle || '', 120),
      actorId && actorId > 0 ? actorId : null,
      String(actorNickname || '').slice(0, 40),
      commentId != null ? Number(commentId) : null,
      sanitizeNotifyText(message || '', 500) || null,
    ],
  )
  const [rows] = await pool.query(`SELECT * FROM guestbook_notification WHERE id = ? LIMIT 1`, [
    result.insertId,
  ])
  return rows[0] ? mapNotification(rows[0]) : null
}

export async function notifyPostAuthor(post, type, actor = {}, message = '') {
  const ownerUserId = post?._ownerUserId || post?.userId
  if (!ownerUserId) return null
  const isSystem = SYSTEM_ACTOR_TYPES.has(type)
  const modMessage =
    message ||
    (type === 'post_hidden' || type === 'post_deleted' ? post.moderationMessage || '' : '')
  return createGuestbookNotification({
    userId: ownerUserId,
    type,
    postId: post.id,
    postTitle: post.title || '',
    actorUserId: isSystem ? null : actor.id || null,
    actorNickname: isSystem ? '管理员' : actor.nickname || actor.label || '有人',
    commentId: actor.commentId || null,
    message: modMessage,
  })
}

export async function notifyUsers(userIds, payload) {
  await ensureTable()
  const ids = [...new Set(userIds.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0))]
  const results = []
  for (const userId of ids) {
    const item = await createGuestbookNotification({ ...payload, userId })
    if (item) results.push(item)
  }
  return results
}

export async function listAllGuestbookUserIds({ excludeUserId = null } = {}) {
  await ensureTable()
  const exclude = excludeUserId != null ? Number(excludeUserId) : null
  const [rows] = await pool.query(`SELECT id FROM guestbook_user`)
  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0 && id !== exclude)
}

export async function notifyBroadcastPost(post, type, actor = {}) {
  if (!post?.id) return []
  const userIds = await listAllGuestbookUserIds({ excludeUserId: null })
  if (!userIds.length) return []
  return notifyUsers(userIds, {
    type,
    postId: post.id,
    postTitle: post.title || '',
    actorUserId: actor.id || post.userId || null,
    actorNickname: actor.nickname || actor.label || '管理员',
  })
}

export async function notifyFollowersNewPost(post, actor = {}) {
  if (!post?.id || !post.userId) return []
  const { listFollowerIds } = await import('./guestbookSocialService.js')
  const followerIds = await listFollowerIds(post.userId)
  const authorId = Number(post.userId)
  const targets = followerIds.filter((id) => id !== authorId)
  if (!targets.length) return []
  return notifyUsers(targets, {
    type: 'follow_post',
    postId: post.id,
    postTitle: post.title || '',
    actorUserId: actor.id || authorId,
    actorNickname: actor.nickname || post.nickname || '有人',
  })
}

export async function listGuestbookNotifications(userId, { limit = 50 } = {}) {
  await ensureTable()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100)
  const [rows] = await pool.query(
    `SELECT n.*, u.avatar AS actor_avatar
     FROM guestbook_notification n
     LEFT JOIN guestbook_user u ON u.id = n.actor_user_id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT ${safeLimit}`,
    [uid],
  )
  return rows.map(mapNotification)
}

export async function countUnreadNotifications(userId) {
  await ensureTable()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return 0
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM guestbook_notification WHERE user_id = ? AND is_read = 0`,
    [uid],
  )
  let total = Number(row?.cnt || 0)
  try {
    const { countUnreadDmMessages } = await import('./guestbookDmService.js')
    total += await countUnreadDmMessages(uid)
  } catch {
    /* ignore if DM tables not ready */
  }
  return total
}

export async function markNotificationsRead(userId, ids = null) {
  await ensureTable()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return 0

  if (Array.isArray(ids) && ids.length) {
    const safeIds = ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
    if (!safeIds.length) return 0
    const [result] = await pool.query(
      `UPDATE guestbook_notification SET is_read = 1
       WHERE user_id = ? AND id IN (${safeIds.map(() => '?').join(',')})`,
      [uid, ...safeIds],
    )
    return result.affectedRows
  }

  const [result] = await pool.query(
    `UPDATE guestbook_notification SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
    [uid],
  )
  return result.affectedRows
}
