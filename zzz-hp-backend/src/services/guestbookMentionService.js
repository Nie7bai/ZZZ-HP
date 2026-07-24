import pool from '../config/db.js'
import { notifyUsers } from './guestbookNotificationService.js'

export async function resolveMentionUserIds(content, excludeUserId = null) {
  const text = String(content || '')
  const ids = new Set()
  const exclude = excludeUserId != null ? Number(excludeUserId) : null

  for (const match of text.matchAll(/@\[([^\[\]\n]{1,40})\]\((\d{1,10})\)/g)) {
    const id = Number(match[2])
    if (Number.isFinite(id) && id > 0 && id !== exclude) ids.add(id)
  }

  for (const match of text.matchAll(/@(\d{1,10})\b/g)) {
    const id = Number(match[1])
    if (Number.isFinite(id) && id > 0 && id !== exclude) ids.add(id)
  }

  const nickTokens = new Set()
  for (const match of text.matchAll(/@([^\s@]{1,20})/g)) {
    const token = match[1]
    if (/^\d+$/.test(token)) continue
    nickTokens.add(token)
  }

  for (const nick of nickTokens) {
    const [rows] = await pool.query(`SELECT id FROM guestbook_user WHERE nickname = ? LIMIT 1`, [nick])
    const id = Number(rows[0]?.id)
    if (Number.isFinite(id) && id > 0 && id !== exclude) ids.add(id)
  }

  return [...ids]
}

export async function notifyMentionedUsers({ userIds, post, actor, commentId = null }) {
  if (!userIds?.length || !post?.id) return []
  return notifyUsers(userIds, {
    type: 'mention',
    postId: post.id,
    postTitle: post.title || '',
    actorUserId: actor.id || null,
    actorNickname: actor.nickname || '有人',
    commentId,
  })
}
