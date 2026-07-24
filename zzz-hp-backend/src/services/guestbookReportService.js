import pool from '../config/db.js'
import { notifyUsers, createGuestbookNotification } from './guestbookNotificationService.js'
import { listModeratorUserIds, listSiteAdminUserIds } from './guestbookSocialService.js'

let ensured = false

/** 去掉引用 token 等内部标记，避免泄露到通知/预览 */
export function sanitizePublicText(text, maxLen = 500) {
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

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_report (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      reporter_user_id INT UNSIGNED NOT NULL,
      target_type VARCHAR(16) NOT NULL,
      post_id INT UNSIGNED NOT NULL DEFAULT 0,
      comment_id INT UNSIGNED NULL,
      reported_user_id INT UNSIGNED NULL,
      reason VARCHAR(500) NULL,
      handler_message VARCHAR(500) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      handled_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_gb_report_status_created (status, created_at),
      KEY idx_gb_report_post (post_id),
      KEY idx_gb_report_user (reported_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guestbook_report'`,
  )
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('reported_user_id')) {
    await pool.query(
      `ALTER TABLE guestbook_report ADD COLUMN reported_user_id INT UNSIGNED NULL COMMENT '被举报用户' AFTER comment_id`,
    )
  }
  if (!names.has('handler_message')) {
    await pool.query(
      `ALTER TABLE guestbook_report ADD COLUMN handler_message VARCHAR(500) NULL COMMENT '处理反馈留言' AFTER reason`,
    )
  }
  ensured = true
}

function mapReport(row) {
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    reporterNickname: row.reporter_nickname || '用户',
    targetType: row.target_type,
    postId: Number(row.post_id || 0),
    postTitle: sanitizePublicText(row.post_title || '', 120),
    commentId: row.comment_id != null ? Number(row.comment_id) : null,
    commentPreview: sanitizePublicText(row.comment_preview || '', 80),
    reportedUserId: row.reported_user_id != null ? Number(row.reported_user_id) : null,
    reportedUserNickname: row.reported_user_nickname || '',
    reason: sanitizePublicText(row.reason || '', 500),
    handlerMessage: sanitizePublicText(row.handler_message || '', 500),
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  }
}

export async function submitGuestbookReport(
  reporterId,
  { targetType, postId = 0, commentId = null, reportedUserId = null, reason = '' },
  actor = null,
) {
  await ensureTable()
  const uid = Number(reporterId)
  const type =
    targetType === 'comment' ? 'comment' : targetType === 'user' ? 'user' : 'post'
  const pid = Number(postId) || 0
  const cid = type === 'comment' ? Number(commentId) : null
  const reportedUid = type === 'user' ? Number(reportedUserId) : null

  if (!Number.isFinite(uid) || uid <= 0) return { error: 'invalid' }
  if (type === 'post' && (!Number.isFinite(pid) || pid <= 0)) return { error: 'invalid' }
  if (type === 'comment' && (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(cid) || cid <= 0)) {
    return { error: 'invalid' }
  }
  if (type === 'user' && (!Number.isFinite(reportedUid) || reportedUid <= 0)) {
    return { error: 'invalid' }
  }
  if (type === 'user' && reportedUid === uid) return { error: 'forbidden' }

  const text = sanitizePublicText(reason, 500)

  if (type === 'user') {
    const [existing] = await pool.query(
      `SELECT id FROM guestbook_report
       WHERE reporter_user_id = ? AND target_type = 'user' AND reported_user_id = ?
         AND created_at >= CURDATE()
       LIMIT 1`,
      [uid, reportedUid],
    )
    if (existing.length) return { ok: true, duplicate: true, id: existing[0].id }

    const [userRows] = await pool.query(
      `SELECT id, nickname FROM guestbook_user WHERE id = ? LIMIT 1`,
      [reportedUid],
    )
    if (!userRows[0]) return { error: 'not_found' }
    const reportedName = userRows[0].nickname || '用户'

    const [result] = await pool.query(
      `INSERT INTO guestbook_report
         (reporter_user_id, target_type, post_id, comment_id, reported_user_id, reason)
       VALUES (?, 'user', 0, NULL, ?, ?)`,
      [uid, reportedUid, text || null],
    )
    const reportId = result.insertId
    const adminUserIds = await listSiteAdminUserIds()
    const who = actor?.nickname || '有人'
    if (adminUserIds.length) {
      await notifyUsers(
        adminUserIds.filter((id) => id !== uid),
        {
          type: 'report',
          postId: 0,
          postTitle: reportedName,
          actorUserId: uid,
          actorNickname: who,
          commentId: null,
          // 仅存举报原因，摘要由前端用标题拼；避免重复且不露出内部 token
          message: text || null,
        },
      )
    }
    return { ok: true, id: reportId, duplicate: false }
  }

  const [existing] = await pool.query(
    type === 'comment'
      ? `SELECT id FROM guestbook_report
         WHERE reporter_user_id = ? AND target_type = 'comment' AND comment_id = ?
           AND created_at >= CURDATE()
         LIMIT 1`
      : `SELECT id FROM guestbook_report
         WHERE reporter_user_id = ? AND target_type = 'post' AND post_id = ?
           AND created_at >= CURDATE()
         LIMIT 1`,
    type === 'comment' ? [uid, cid] : [uid, pid],
  )
  if (existing.length) {
    return { ok: true, duplicate: true, id: existing[0].id }
  }

  const [postRows] = await pool.query(`SELECT title FROM guestbook WHERE id = ? LIMIT 1`, [pid])
  const postTitle = sanitizePublicText(postRows[0]?.title || '', 120)

  const [result] = await pool.query(
    `INSERT INTO guestbook_report
       (reporter_user_id, target_type, post_id, comment_id, reported_user_id, reason)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [uid, type, pid, type === 'comment' ? cid : null, text || null],
  )
  const reportId = result.insertId

  const modUserIds = await listModeratorUserIds()
  if (modUserIds.length) {
    const who = actor?.nickname || '有人'
    await notifyUsers(
      modUserIds.filter((id) => id !== uid),
      {
        type: 'report',
        postId: pid,
        postTitle,
        actorUserId: uid,
        actorNickname: who,
        commentId: type === 'comment' ? cid : null,
        message: text || null,
      },
    )
  }

  return { ok: true, id: reportId, duplicate: false }
}

export async function listGuestbookReports({
  status = 'pending',
  targetType = 'all',
  limit = 100,
} = {}) {
  await ensureTable()
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const where = []
  const params = []
  if (status && status !== 'all') {
    where.push('r.status = ?')
    params.push(status)
  }
  if (targetType === 'post' || targetType === 'comment' || targetType === 'user') {
    where.push('r.target_type = ?')
    params.push(targetType)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [rows] = await pool.query(
    `SELECT r.*, u.nickname AS reporter_nickname, g.title AS post_title,
            LEFT(c.content, 120) AS comment_preview,
            ru.nickname AS reported_user_nickname
     FROM guestbook_report r
     LEFT JOIN guestbook_user u ON u.id = r.reporter_user_id
     LEFT JOIN guestbook g ON g.id = r.post_id
     LEFT JOIN guestbook_comment c ON c.id = r.comment_id
     LEFT JOIN guestbook_user ru ON ru.id = r.reported_user_id
     ${whereSql}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${safeLimit}`,
    params,
  )
  return rows.map(mapReport)
}

export async function markGuestbookReportHandled(reportId, handler = null, handlerMessage = '') {
  await ensureTable()
  const id = Number(reportId)
  if (!Number.isFinite(id) || id <= 0) return { error: 'invalid' }

  const [rows] = await pool.query(
    `SELECT r.*, g.title AS post_title, ru.nickname AS reported_user_nickname
     FROM guestbook_report r
     LEFT JOIN guestbook g ON g.id = r.post_id
     LEFT JOIN guestbook_user ru ON ru.id = r.reported_user_id
     WHERE r.id = ? LIMIT 1`,
    [id],
  )
  const report = rows[0]
  if (!report) return { error: 'not_found' }
  if (report.status !== 'pending') return { error: 'already_handled', report: mapReport(report) }

  const note = sanitizePublicText(handlerMessage, 500)

  await pool.query(
    `UPDATE guestbook_report
     SET status = 'handled', handled_at = CURRENT_TIMESTAMP, handler_message = ?
     WHERE id = ? AND status = 'pending'`,
    [note || null, id],
  )

  const label =
    report.target_type === 'comment' ? '评论' : report.target_type === 'user' ? '用户' : '委托'
  const title =
    report.target_type === 'user'
      ? report.reported_user_nickname || '用户'
      : sanitizePublicText(report.post_title || '无标题', 120)
  const handlerName = handler?.nickname || '管理员'

  await createGuestbookNotification({
    userId: report.reporter_user_id,
    type: 'report_handled',
    postId: Number(report.post_id) || 0,
    postTitle: title,
    actorUserId: handler?.id || null,
    actorNickname: handlerName,
    commentId: report.comment_id,
    // 仅存管理员反馈话术；摘要「已处理」由前端拼
    message: note || null,
  })

  return { ok: true, id }
}
