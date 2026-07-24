import pool from '../config/db.js'
import { isBlockedBetween } from './guestbookSocialService.js'
import { getUserById } from './userAuthService.js'

let ensured = false

async function ensureTables() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_dm_conversation (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_low_id INT UNSIGNED NOT NULL,
      user_high_id INT UNSIGNED NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_dm_pair (user_low_id, user_high_id),
      KEY idx_gb_dm_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_dm_message (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      conversation_id INT UNSIGNED NOT NULL,
      sender_id INT UNSIGNED NOT NULL,
      content VARCHAR(2000) NOT NULL DEFAULT '',
      images_json TEXT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_gb_dm_msg_conv_created (conversation_id, created_at),
      KEY idx_gb_dm_msg_unread (conversation_id, is_read, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guestbook_dm_message'`,
  )
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('images_json')) {
    await pool.query(
      `ALTER TABLE guestbook_dm_message ADD COLUMN images_json TEXT NULL COMMENT '图片列表JSON' AFTER content`,
    )
  }
  ensured = true
}

function normalizePair(userA, userB) {
  const a = Number(userA)
  const b = Number(userB)
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return null
  if (a === b) return null
  return a < b ? { low: a, high: b, self: a, peer: b } : { low: b, high: a, self: b, peer: a }
}

function mapConversation(row, viewerId) {
  const viewer = Number(viewerId)
  const low = Number(row.user_low_id)
  const high = Number(row.user_high_id)
  const peerId = viewer === low ? high : low
  const isPeerLow = peerId === low
  return {
    id: row.id,
    peerId,
    peerNickname: isPeerLow ? row.peer_low_nickname : row.peer_high_nickname,
    peerAvatar: isPeerLow ? row.peer_low_avatar : row.peer_high_avatar,
    lastMessage: row.last_message || '',
    lastMessageAt: row.last_message_at || row.updated_at,
    unreadCount: Number(row.unread_count || 0),
    updatedAt: row.updated_at,
  }
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return []
  return images
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim())
    .slice(0, 3)
}

function parseImagesJson(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function stripQuoteTokens(text) {
  let raw = String(text || '')
  for (let i = 0; i < 8; i++) {
    const next = raw
      .replace(/\[\[quote:(?:comment|dm):\d+\|[^|\]]+\|[\s\S]*\]\]\n?/g, '')
      .replace(/\[\[quote:(?:comment|dm):\d+[\s\S]*?\]\]\n?/g, '')
      .replace(/\[\[quote:(?:comment|dm):[\s\S]*?\]\]/g, '')
      .replace(/quote:(?:comment|dm):\d+\|[^|\]]+\|/g, '')
      .replace(/quote:(?:comment|dm):\d+/g, '')
    if (next === raw) break
    raw = next
  }
  return raw.trim()
}

function cleanPreviewField(text) {
  let raw = String(text || '').trim()
  if (!raw) return ''
  const token =
    /^\[\[quote:(?:comment|dm):(\d+)\|([^|\]]+)\|([\s\S]*)\]\]\n?/.exec(raw)
  if (token) {
    const inner = cleanPreviewField(token[3] || '')
    if (inner) return inner
    return stripQuoteTokens(token[3] || '')
  }
  raw = stripQuoteTokens(raw)
  if (/\[\[|quote:(?:comment|dm):/i.test(raw)) {
    raw = raw
      .replace(/\[\[/g, '')
      .replace(/\]\]/g, '')
      .replace(/quote:(?:comment|dm):\d+/gi, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return raw.replace(/\s+/g, ' ').trim()
}

function previewMessage(content, images) {
  const raw = String(content || '')
  const token =
    /^\[\[quote:(?:comment|dm):(\d+)\|([^|\]]+)\|([\s\S]*)\]\]\n?/.exec(raw)
  let text = ''
  if (token) {
    text = stripQuoteTokens(raw.slice(token[0].length)).replace(/\s+/g, ' ').trim()
    if (!text) text = cleanPreviewField(token[3] || '')
  } else {
    text = cleanPreviewField(raw)
  }
  if (text) return text.slice(0, 120)
  if (images?.length) return '[图片]'
  return ''
}

function mapMessage(row) {
  const images = parseImagesJson(row.images_json)
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderNickname: row.sender_nickname || '',
    senderAvatar: row.sender_avatar || '',
    content: row.content || '',
    images,
    isRead: Boolean(row.is_read),
    isMine: Boolean(row.is_mine),
    createdAt: row.created_at,
  }
}

export async function getOrCreateConversation(userId, peerUserId) {
  await ensureTables()
  const pair = normalizePair(userId, peerUserId)
  if (!pair) return { error: 'invalid' }
  if (!(await getUserById(pair.peer))) return { error: 'not_found' }
  if (await isBlockedBetween(pair.self, pair.peer)) return { error: 'blocked' }

  const [existing] = await pool.query(
    `SELECT id FROM guestbook_dm_conversation WHERE user_low_id = ? AND user_high_id = ? LIMIT 1`,
    [pair.low, pair.high],
  )
  if (existing.length) {
    return getConversationById(existing[0].id, pair.self)
  }

  const [result] = await pool.query(
    `INSERT INTO guestbook_dm_conversation (user_low_id, user_high_id) VALUES (?, ?)`,
    [pair.low, pair.high],
  )
  return getConversationById(result.insertId, pair.self)
}

export async function getConversationById(conversationId, viewerUserId) {
  await ensureTables()
  const cid = Number(conversationId)
  const viewerId = Number(viewerUserId)
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(viewerId) || viewerId <= 0) return null

  const [rows] = await pool.query(
    `SELECT c.*,
            ul.nickname AS peer_low_nickname, ul.avatar AS peer_low_avatar,
            uh.nickname AS peer_high_nickname, uh.avatar AS peer_high_avatar,
            (
              SELECT m.content FROM guestbook_dm_message m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1
            ) AS last_message,
            (
              SELECT m.created_at FROM guestbook_dm_message m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1
            ) AS last_message_at,
            (
              SELECT COUNT(*) FROM guestbook_dm_message m
              WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.is_read = 0
            ) AS unread_count
     FROM guestbook_dm_conversation c
     LEFT JOIN guestbook_user ul ON ul.id = c.user_low_id
     LEFT JOIN guestbook_user uh ON uh.id = c.user_high_id
     WHERE c.id = ?
       AND (c.user_low_id = ? OR c.user_high_id = ?)
     LIMIT 1`,
    [viewerId, cid, viewerId, viewerId],
  )
  return rows[0] ? mapConversation(rows[0], viewerId) : null
}

export async function listConversations(userId, { limit = 50 } = {}) {
  await ensureTables()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100)
  const [rows] = await pool.query(
    `SELECT c.*,
            ul.nickname AS peer_low_nickname, ul.avatar AS peer_low_avatar,
            uh.nickname AS peer_high_nickname, uh.avatar AS peer_high_avatar,
            (
              SELECT m.content FROM guestbook_dm_message m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1
            ) AS last_message,
            (
              SELECT m.created_at FROM guestbook_dm_message m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1
            ) AS last_message_at,
            (
              SELECT COUNT(*) FROM guestbook_dm_message m
              WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.is_read = 0
            ) AS unread_count
     FROM guestbook_dm_conversation c
     LEFT JOIN guestbook_user ul ON ul.id = c.user_low_id
     LEFT JOIN guestbook_user uh ON uh.id = c.user_high_id
     WHERE c.user_low_id = ? OR c.user_high_id = ?
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT ${safeLimit}`,
    [uid, uid, uid],
  )
  return rows.map((row) => mapConversation(row, uid))
}

export async function listMessages(conversationId, viewerUserId, { limit = 100 } = {}) {
  await ensureTables()
  const conv = await getConversationById(conversationId, viewerUserId)
  if (!conv) return { error: 'not_found' }

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  // 取最近 N 条，再按时间正序返回，避免 LIMIT + ASC 只拿到最旧消息
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT m.*, u.nickname AS sender_nickname, u.avatar AS sender_avatar,
              (m.sender_id = ?) AS is_mine
       FROM guestbook_dm_message m
       LEFT JOIN guestbook_user u ON u.id = m.sender_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${safeLimit}
     ) recent
     ORDER BY recent.created_at ASC, recent.id ASC`,
    [viewerUserId, conversationId],
  )
  return { conversation: conv, messages: rows.map(mapMessage) }
}

export async function sendMessage(conversationId, senderId, payload = {}) {
  await ensureTables()
  const cid = Number(conversationId)
  const sid = Number(senderId)
  const text = typeof payload === 'string' ? String(payload).trim() : String(payload?.content || '').trim()
  const images = typeof payload === 'object' && payload ? normalizeImages(payload.images) : []
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(sid) || sid <= 0) return { error: 'invalid' }
  if (!text && !images.length) return { error: 'empty' }
  if (text.length > 2000) return { error: 'too_long' }

  const conv = await getConversationById(cid, sid)
  if (!conv) return { error: 'not_found' }
  if (await isBlockedBetween(sid, conv.peerId)) return { error: 'blocked' }

  const [result] = await pool.query(
    `INSERT INTO guestbook_dm_message (conversation_id, sender_id, content, images_json) VALUES (?, ?, ?, ?)`,
    [cid, sid, text, images.length ? JSON.stringify(images) : null],
  )
  await pool.query(`UPDATE guestbook_dm_conversation SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
    cid,
  ])

  const [rows] = await pool.query(
    `SELECT m.*, u.nickname AS sender_nickname, u.avatar AS sender_avatar,
            (m.sender_id = ?) AS is_mine
     FROM guestbook_dm_message m
     LEFT JOIN guestbook_user u ON u.id = m.sender_id
     WHERE m.id = ? LIMIT 1`,
    [sid, result.insertId],
  )
  const message = rows[0] ? mapMessage(rows[0]) : null
  const updatedConv = {
    ...conv,
    lastMessage: previewMessage(text, images),
    lastMessageAt: message?.createdAt || conv.lastMessageAt,
  }
  return { message, conversation: updatedConv }
}

export async function markConversationRead(conversationId, viewerUserId) {
  await ensureTables()
  const conv = await getConversationById(conversationId, viewerUserId)
  if (!conv) return 0
  const [result] = await pool.query(
    `UPDATE guestbook_dm_message SET is_read = 1
     WHERE conversation_id = ? AND sender_id != ? AND is_read = 0`,
    [conversationId, viewerUserId],
  )
  return result.affectedRows
}

export async function countUnreadDmMessages(userId) {
  await ensureTables()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return 0
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM guestbook_dm_message m
     INNER JOIN guestbook_dm_conversation c ON c.id = m.conversation_id
     WHERE (c.user_low_id = ? OR c.user_high_id = ?)
       AND m.sender_id != ?
       AND m.is_read = 0`,
    [uid, uid, uid],
  )
  return Number(row?.cnt || 0)
}
