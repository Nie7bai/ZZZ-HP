import pool from '../config/db.js'
import {
  notifyBroadcastPost,
  notifyFollowersNewPost,
  notifyPostAuthor,
  notifyUsers,
} from './guestbookNotificationService.js'
import { notifyMentionedUsers, resolveMentionUserIds } from './guestbookMentionService.js'
import { getBlockClause, listModeratorUserIds } from './guestbookSocialService.js'
import { awardGuestbookExp } from './guestbookExpService.js'

let ensured = false

export const GUESTBOOK_CATEGORIES = [
  '灌水',
  '求助',
  '攻略',
  '情报',
  '同人',
  '数据',
  '公告',
  '更新日志',
]

export const ADMIN_ONLY_CATEGORIES = ['公告', '更新日志']
const MAX_IMAGES = 9

async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      nickname VARCHAR(40) NOT NULL DEFAULT '匿名',
      title VARCHAR(120) NOT NULL DEFAULT '',
      category VARCHAR(20) NOT NULL DEFAULT '灌水',
      content TEXT NOT NULL,
      cover VARCHAR(255) NOT NULL DEFAULT '',
      images_json TEXT NULL,
      is_hidden TINYINT(1) NOT NULL DEFAULT 0,
      is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_guestbook_visible_created (is_hidden, created_at),
      KEY idx_guestbook_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_comment (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      post_id INT UNSIGNED NOT NULL,
      nickname VARCHAR(40) NOT NULL DEFAULT '匿名',
      content VARCHAR(1000) NOT NULL,
      is_hidden TINYINT(1) NOT NULL DEFAULT 0,
      is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_gb_comment_post_created (post_id, created_at),
      KEY idx_gb_comment_visible (post_id, is_hidden, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guestbook'`,
  )
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('title')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN title VARCHAR(120) NOT NULL DEFAULT '' COMMENT '标题' AFTER nickname`,
    )
  }
  if (!names.has('category')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT '灌水' COMMENT '分类' AFTER title`,
    )
  }
  if (!names.has('cover')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN cover VARCHAR(255) NOT NULL DEFAULT '' COMMENT '封面图' AFTER content`,
    )
  }
  if (!names.has('images_json')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN images_json TEXT NULL COMMENT '图片列表JSON' AFTER cover`,
    )
  }
  if (!names.has('user_id')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN user_id INT UNSIGNED NULL COMMENT '登录用户ID' AFTER nickname`,
    )
  }
  if (!names.has('is_anonymous')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN is_anonymous TINYINT(1) NOT NULL DEFAULT 0 COMMENT '匿名发布' AFTER is_hidden`,
    )
  }

  const [commentCols] = await pool.query(
    `SELECT COLUMN_NAME AS name
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guestbook_comment'`,
  )
  const commentNames = new Set(commentCols.map((c) => c.name))
  if (!commentNames.has('user_id')) {
    await pool.query(
      `ALTER TABLE guestbook_comment ADD COLUMN user_id INT UNSIGNED NULL COMMENT '登录用户ID' AFTER nickname`,
    )
  }
  if (!commentNames.has('images_json')) {
    await pool.query(
      `ALTER TABLE guestbook_comment ADD COLUMN images_json TEXT NULL COMMENT '图片列表JSON' AFTER content`,
    )
  }
  if (!commentNames.has('is_anonymous')) {
    await pool.query(
      `ALTER TABLE guestbook_comment ADD COLUMN is_anonymous TINYINT(1) NOT NULL DEFAULT 0 COMMENT '匿名评论' AFTER is_hidden`,
    )
  }

  if (!names.has('is_pinned')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0 COMMENT '全局置顶' AFTER is_hidden`,
    )
  }
  if (!names.has('pinned_at')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN pinned_at TIMESTAMP NULL DEFAULT NULL COMMENT '置顶时间' AFTER is_pinned`,
    )
  }
  if (!names.has('profile_pinned')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN profile_pinned TINYINT(1) NOT NULL DEFAULT 0 COMMENT '个人主页置顶' AFTER pinned_at`,
    )
  }
  if (!names.has('is_deleted')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0 COMMENT '软删除' AFTER profile_pinned`,
    )
  }
  if (!names.has('deleted_at')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL COMMENT '删除时间' AFTER is_deleted`,
    )
  }
  if (!names.has('view_count')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN view_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '浏览量' AFTER deleted_at`,
    )
  }
  if (!names.has('moderation_message')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN moderation_message VARCHAR(500) NULL COMMENT '管理员屏蔽/删除留言' AFTER view_count`,
    )
  }
  if (!names.has('restore_requested_at')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN restore_requested_at TIMESTAMP NULL DEFAULT NULL COMMENT '用户申请恢复时间' AFTER moderation_message`,
    )
  }
  if (!names.has('is_sensitive')) {
    await pool.query(
      `ALTER TABLE guestbook ADD COLUMN is_sensitive TINYINT(1) NOT NULL DEFAULT 0 COMMENT '敏感内容（图片默认模糊）' AFTER restore_requested_at`,
    )
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_like (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      post_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_like_user_post (user_id, post_id),
      KEY idx_gb_like_post (post_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_favorite (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      post_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_fav_user_post (user_id, post_id),
      KEY idx_gb_fav_post (post_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_comment_mute (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      comment_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_mute_user_comment (user_id, comment_id),
      KEY idx_gb_mute_comment (comment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_comment_like (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      comment_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_clike_user_comment (user_id, comment_id),
      KEY idx_gb_clike_comment (comment_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_post_view (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      post_id INT UNSIGNED NOT NULL,
      viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_view_user_post (user_id, post_id),
      KEY idx_gb_view_post (post_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_setting (
      setting_key VARCHAR(64) NOT NULL,
      setting_value VARCHAR(255) NOT NULL DEFAULT '',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 旧表可能仍是较短 VARCHAR，与接口上限不一致会导致发布失败
  const [lenRows] = await pool.query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, CHARACTER_MAXIMUM_LENGTH AS len
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'guestbook'
       AND COLUMN_NAME IN ('title', 'content')`,
  )
  for (const col of lenRows) {
    const len = Number(col.len) || 0
    const dataType = String(col.dataType || '').toLowerCase()
    if (col.name === 'title' && len < 120) {
      await pool.query(
        `ALTER TABLE guestbook MODIFY COLUMN title VARCHAR(120) NOT NULL DEFAULT '' COMMENT '标题'`,
      )
    }
    if (col.name === 'content' && (dataType !== 'text' && dataType !== 'mediumtext' && dataType !== 'longtext')) {
      await pool.query(
        `ALTER TABLE guestbook MODIFY COLUMN content TEXT NOT NULL COMMENT '正文'`,
      )
    }
  }

  ensured = true
  void purgeExpiredDeletedPosts()
}

const DEFAULT_MODERATION_MESSAGES = {
  hidden: '您的委托暂时不符合委托规约，已被屏蔽，若想恢复帖子请联系管理员',
  deleted: '您的委托暂时不符合委托规约，已被删除，若想恢复帖子请联系管理员',
}

let lastPurgeAt = 0

function normalizeModerationMessage(value, action) {
  const trimmed = String(value || '').trim()
  if (trimmed) return trimmed.slice(0, 500)
  return DEFAULT_MODERATION_MESSAGES[action] || DEFAULT_MODERATION_MESSAGES.hidden
}

async function permanentlyDeleteGuestbook(id) {
  const pid = Number(id)
  if (!Number.isFinite(pid) || pid <= 0) return false

  const [commentRows] = await pool.query(
    `SELECT id FROM guestbook_comment WHERE post_id = ?`,
    [pid],
  )
  const commentIds = commentRows.map((row) => row.id).filter(Boolean)
  if (commentIds.length) {
    await pool.query(
      `DELETE FROM guestbook_comment_mute WHERE comment_id IN (${commentIds.map(() => '?').join(',')})`,
      commentIds,
    )
  }
  await pool.query(`DELETE FROM guestbook_comment WHERE post_id = ?`, [pid])
  await pool.query(`DELETE FROM guestbook_like WHERE post_id = ?`, [pid])
  await pool.query(`DELETE FROM guestbook_favorite WHERE post_id = ?`, [pid])
  await pool.query(`DELETE FROM guestbook_notification WHERE post_id = ?`, [pid])
  const [result] = await pool.query(`DELETE FROM guestbook WHERE id = ?`, [pid])
  return result.affectedRows > 0
}

export async function purgeExpiredDeletedPosts() {
  await ensureTable()
  const now = Date.now()
  if (now - lastPurgeAt < 60 * 60 * 1000) return 0
  lastPurgeAt = now

  const [rows] = await pool.query(
    `SELECT id FROM guestbook
     WHERE is_deleted = 1
       AND deleted_at IS NOT NULL
       AND deleted_at < DATE_SUB(NOW(), INTERVAL 15 DAY)`,
  )
  let count = 0
  for (const row of rows) {
    if (await permanentlyDeleteGuestbook(row.id)) count += 1
  }
  return count
}

function parseImages(row) {
  if (row.images_json) {
    try {
      const parsed = JSON.parse(row.images_json)
      if (Array.isArray(parsed)) {
        return parsed.filter((x) => typeof x === 'string' && x.trim()).slice(0, MAX_IMAGES)
      }
    } catch {
      /* ignore */
    }
  }
  if (row.cover) return [row.cover]
  return []
}

function mapPost(row, viewerUserId = null, exposeAnonymousIdentity = false) {
  const images = parseImages(row)
  const viewerId = Number(viewerUserId)
  const hasViewer = Number.isFinite(viewerId) && viewerId > 0
  const ownerUserId = row.user_id != null ? Number(row.user_id) : null
  const isAnonymous = Boolean(row.is_anonymous)
  const isMine = Boolean(hasViewer && ownerUserId && ownerUserId === viewerId)
  const post = {
    id: row.id,
    userId: isAnonymous ? null : ownerUserId,
    nickname: isAnonymous ? '匿名' : row.nickname,
    avatar: isAnonymous ? '' : row.user_avatar || '',
    isAnonymous,
    isMine,
    level: isAnonymous ? undefined : Number(row.user_level || 1),
    exp: isAnonymous ? undefined : Number(row.user_exp || 0),
    anonymousAuthor:
      isAnonymous && exposeAnonymousIdentity && ownerUserId
        ? {
            id: ownerUserId,
            uid: ownerUserId,
            nickname: row.account_nickname || '绳网旅人',
            avatar: row.user_avatar || '',
          }
        : undefined,
    title: row.title || '',
    category: row.category || '灌水',
    content: row.content || '',
    cover: row.cover || images[0] || '',
    images,
    isHidden: Boolean(row.is_hidden),
    isSensitive: Boolean(row.is_sensitive),
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at || null,
    isPinned: Boolean(row.is_pinned),
    pinnedAt: row.pinned_at || null,
    profilePinned: Boolean(row.profile_pinned),
    viewCount: Number(row.view_count || 0),
    moderationMessage: row.moderation_message || '',
    restoreRequestedAt: row.restore_requested_at || null,
    commentCount: Number(row.comment_count || 0),
    likeCount: Number(row.like_count || 0),
    favoriteCount: Number(row.favorite_count || 0),
    likedByMe: hasViewer ? Boolean(Number(row.liked_by_me || 0)) : undefined,
    favoritedByMe: hasViewer ? Boolean(Number(row.favorited_by_me || 0)) : undefined,
    viewedByMe: hasViewer
      ? Boolean(Number(row.viewed_by_me || 0)) ||
        ownerUserId === viewerId
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  Object.defineProperty(post, '_ownerUserId', { value: ownerUserId, enumerable: false })
  return post
}

function mapComment(row, floor, ctx = {}) {
  const viewerId = Number(ctx.viewerUserId)
  const hasViewer = Number.isFinite(viewerId) && viewerId > 0
  const postAuthorId = Number(ctx.postAuthorId)
  const mutedByMe = hasViewer ? Boolean(Number(row.muted_by_me || 0)) : false
  const isHidden = Boolean(row.is_hidden)
  const blockedForMe = isHidden || mutedByMe
  const canRestoreGlobal =
    hasViewer && Number.isFinite(postAuthorId) && viewerId === postAuthorId && isHidden
  const canRestoreMute = mutedByMe
  const ownerUserId = row.user_id != null ? Number(row.user_id) : null
  const isAnonymous = Boolean(row.is_anonymous)
  const isMine = Boolean(hasViewer && ownerUserId && ownerUserId === viewerId)
  let images = []
  try {
    images = row.images_json ? JSON.parse(row.images_json) : []
    if (!Array.isArray(images)) images = []
  } catch {
    images = []
  }
  const comment = {
    id: row.id,
    postId: row.post_id,
    userId: isAnonymous ? null : ownerUserId,
    nickname: isAnonymous ? '匿名' : row.nickname,
    avatar: isAnonymous ? '' : row.user_avatar || '',
    isAnonymous,
    isMine,
    level: isAnonymous ? undefined : Number(row.user_level || 1),
    exp: isAnonymous ? undefined : Number(row.user_exp || 0),
    anonymousAuthor:
      isAnonymous && ctx.exposeAnonymousIdentity && ownerUserId
        ? {
            id: ownerUserId,
            uid: ownerUserId,
            nickname: row.account_nickname || '绳网旅人',
            avatar: row.user_avatar || '',
          }
        : undefined,
    content: row.content,
    images,
    isHidden,
    mutedByMe,
    blockedForMe,
    canRestoreGlobal,
    canRestoreMute,
    floor,
    likeCount: Number(row.like_count || 0),
    likedByMe: hasViewer ? Boolean(Number(row.liked_by_me || 0)) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  Object.defineProperty(comment, '_ownerUserId', { value: ownerUserId, enumerable: false })
  return comment
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return []
  return images
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim())
    .slice(0, MAX_IMAGES)
}

function sanitizeKeyword(value) {
  return String(value || '')
    .trim()
    .replace(/[%_\\]/g, '')
    .slice(0, 80)
}

/** 校验 YYYY-MM-DD，非法则返回空串 */
function normalizeDateParam(value) {
  const raw = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return ''
  const d = new Date(`${raw}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return raw
}

function postSelectFields(viewerUserId = null) {
  const viewerId = Number(viewerUserId)
  const hasViewer = Number.isFinite(viewerId) && viewerId > 0
  const likedByMe = hasViewer
    ? `(SELECT COUNT(*) FROM guestbook_like lk WHERE lk.post_id = g.id AND lk.user_id = ${viewerId}) AS liked_by_me`
    : '0 AS liked_by_me'
  const favoritedByMe = hasViewer
    ? `(SELECT COUNT(*) FROM guestbook_favorite fk WHERE fk.post_id = g.id AND fk.user_id = ${viewerId}) AS favorited_by_me`
    : '0 AS favorited_by_me'
  const viewedByMe = hasViewer
    ? `(SELECT COUNT(*) FROM guestbook_post_view v WHERE v.post_id = g.id AND v.user_id = ${viewerId}) AS viewed_by_me`
    : '0 AS viewed_by_me'
  return `
    g.id, g.user_id, g.nickname, g.title, g.category, g.content, g.cover, g.images_json,
    g.is_hidden, g.is_anonymous, g.is_sensitive, g.is_deleted, g.deleted_at, g.view_count, g.moderation_message, g.restore_requested_at,
    g.is_pinned, g.pinned_at, g.profile_pinned,
    g.created_at, g.updated_at,
    u.nickname AS account_nickname, u.avatar AS user_avatar,
    u.level AS user_level, u.exp AS user_exp,
    (SELECT COUNT(*) FROM guestbook_comment c
     WHERE c.post_id = g.id AND c.is_hidden = 0) AS comment_count,
    (SELECT COUNT(*) FROM guestbook_like lk2 WHERE lk2.post_id = g.id) AS like_count,
    (SELECT COUNT(*) FROM guestbook_favorite fk2 WHERE fk2.post_id = g.id) AS favorite_count,
    ${likedByMe},
    ${favoritedByMe},
    ${viewedByMe}
  `
}

function listOrderBy(userId = null) {
  const activityAt = `GREATEST(
    g.updated_at,
    COALESCE(
      (SELECT MAX(c.created_at) FROM guestbook_comment c WHERE c.post_id = g.id AND c.is_hidden = 0),
      g.created_at
    )
  )`
  const uid = Number(userId)
  if (Number.isFinite(uid) && uid > 0) {
    return `g.profile_pinned DESC, g.is_pinned DESC, g.pinned_at DESC, ${activityAt} DESC, g.id DESC`
  }
  return `g.is_pinned DESC, g.pinned_at DESC, ${activityAt} DESC, g.id DESC`
}

export async function listGuestbook({
  includeHidden = false,
  category = '',
  keyword = '',
  startDate = '',
  endDate = '',
  userId = null,
  viewerUserId = null,
  anonymousOnly = false,
  following = false,
  limit = 100,
} = {}) {
  await ensureTable()
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const clauses = []
  const params = []

  const uid = Number(userId)
  const viewerId = Number(viewerUserId)
  const ownerView = Number.isFinite(uid) && uid > 0 && uid === viewerId
  const hideSensitive = await getHideSensitivePosts()

  if (!ownerView) {
    if (!includeHidden) clauses.push('g.is_hidden = 0')
    clauses.push('g.is_deleted = 0')
    if (hideSensitive) clauses.push('g.is_sensitive = 0')
  }
  if (following) {
    if (!Number.isFinite(viewerId) || viewerId <= 0) return []
    clauses.push(
      'g.user_id IN (SELECT following_id FROM guestbook_follow WHERE follower_id = ?)',
    )
    clauses.push('g.is_anonymous = 0')
    params.push(viewerId)
  } else if (category && GUESTBOOK_CATEGORIES.includes(category)) {
    clauses.push('g.category = ?')
    params.push(category)
  }
  if (Number.isFinite(uid) && uid > 0) {
    clauses.push('g.user_id = ?')
    params.push(uid)
    clauses.push(anonymousOnly && ownerView ? 'g.is_anonymous = 1' : 'g.is_anonymous = 0')
  }

  if (Number.isFinite(viewerId) && viewerId > 0 && !ownerView) {
    const block = await getBlockClause(viewerId, 'g')
    if (block.clause) {
      clauses.push(block.clause)
      params.push(...block.params)
    }
  }

  const q = sanitizeKeyword(keyword)
  if (q) {
    const like = `%${q}%`
    clauses.push('(g.title LIKE ? OR g.content LIKE ? OR g.nickname LIKE ?)')
    params.push(like, like, like)
  }

  const from = normalizeDateParam(startDate)
  const to = normalizeDateParam(endDate)
  if (from) {
    clauses.push('g.created_at >= ?')
    params.push(`${from} 00:00:00`)
  }
  if (to) {
    clauses.push('g.created_at < DATE_ADD(?, INTERVAL 1 DAY)')
    params.push(to)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const [rows] = await pool.query(
    `SELECT ${postSelectFields(viewerUserId)}
     FROM guestbook g
     LEFT JOIN guestbook_user u ON u.id = g.user_id
     ${where}
     ORDER BY ${listOrderBy(userId)}
     LIMIT ${safeLimit}`,
    params,
  )
  return rows.map((row) => mapPost(row, viewerUserId))
}

export async function listGuestbookManage({ status = 'normal', viewerUserId = null, limit = 100 } = {}) {
  await ensureTable()
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const clauses = []
  if (status === 'hidden') {
    clauses.push('g.is_deleted = 0', 'g.is_hidden = 1')
  } else if (status === 'deleted') {
    clauses.push('g.is_deleted = 1')
  } else if (status === 'sensitive') {
    clauses.push('g.is_deleted = 0', 'g.is_sensitive = 1')
  } else {
    clauses.push('g.is_deleted = 0', 'g.is_hidden = 0')
  }
  const where = `WHERE ${clauses.join(' AND ')}`
  const [rows] = await pool.query(
    `SELECT ${postSelectFields(viewerUserId)}
     FROM guestbook g
     LEFT JOIN guestbook_user u ON u.id = g.user_id
     ${where}
     ORDER BY g.restore_requested_at IS NULL, g.restore_requested_at DESC, g.updated_at DESC, g.id DESC
     LIMIT ${safeLimit}`,
  )
  return rows.map((row) => mapPost(row, viewerUserId, true))
}

export async function getHideSensitivePosts() {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT setting_value FROM guestbook_setting WHERE setting_key = 'hide_sensitive_posts' LIMIT 1`,
  )
  return rows[0]?.setting_value === '1'
}

export async function setHideSensitivePosts(hidden) {
  await ensureTable()
  await pool.query(
    `INSERT INTO guestbook_setting (setting_key, setting_value)
     VALUES ('hide_sensitive_posts', ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [hidden ? '1' : '0'],
  )
  return Boolean(hidden)
}

export async function incrementGuestbookView(
  id,
  viewerUserId = null,
  exposeAnonymousIdentity = false,
) {
  await ensureTable()
  const pid = Number(id)
  if (!Number.isFinite(pid) || pid <= 0) return null
  await pool.query(
    `UPDATE guestbook SET view_count = view_count + 1 WHERE id = ? AND is_deleted = 0`,
    [pid],
  )
  const viewerId = Number(viewerUserId)
  if (Number.isFinite(viewerId) && viewerId > 0) {
    await pool.query(
      `INSERT INTO guestbook_post_view (user_id, post_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE viewed_at = viewed_at`,
      [viewerId, pid],
    )
  }
  return getGuestbookById(pid, {
    includeHidden: true,
    viewerUserId: Number.isFinite(viewerId) && viewerId > 0 ? viewerId : null,
    exposeAnonymousIdentity,
  })
}

export async function getGuestbookById(
  id,
  { includeHidden = false, viewerUserId = null, exposeAnonymousIdentity = false } = {},
) {
  await ensureTable()
  const [rows] = await pool.query(
    `SELECT ${postSelectFields(viewerUserId)}
     FROM guestbook g
     LEFT JOIN guestbook_user u ON u.id = g.user_id
     WHERE g.id = ? LIMIT 1`,
    [id],
  )
  return rows[0] ? mapPost(rows[0], viewerUserId, exposeAnonymousIdentity) : null
}

export async function createGuestbook({
  nickname,
  title,
  category,
  content,
  images,
  isAnonymous = false,
  isSensitive = false,
  userId = null,
  notify = true,
  actor = null,
}) {
  await ensureTable()
  const list = normalizeImages(images)
  const cover = list[0] || ''
  const [result] = await pool.query(
    `INSERT INTO guestbook (nickname, user_id, title, category, content, cover, images_json, is_anonymous, is_sensitive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nickname,
      userId || null,
      title,
      category,
      content || '',
      cover,
      JSON.stringify(list),
      isAnonymous ? 1 : 0,
      isSensitive ? 1 : 0,
    ],
  )
  const post = await getGuestbookById(result.insertId, {
    includeHidden: true,
    viewerUserId: userId || null,
  })
  if (post && notify) {
    const who = actor || { id: userId, nickname }
    if (category === '公告') {
      await notifyBroadcastPost(post, 'announcement', who)
    } else if (category === '更新日志') {
      await notifyBroadcastPost(post, 'changelog', who)
    } else if (userId && !isAnonymous) {
      await notifyFollowersNewPost(post, who)
    }
  }
  if (userId) {
    await awardGuestbookExp(userId, 'post')
  }
  return post
}

export async function updateGuestbook(id, payload, { authUser = null, isAdmin = false } = {}) {
  await ensureTable()
  const existing = await getGuestbookById(id, { includeHidden: true })
  if (!existing) return { error: 'not_found' }

  if (!isAdmin) {
    if (!authUser?.id) return { error: 'unauthorized' }
    if (!existing._ownerUserId || existing._ownerUserId !== authUser.id) return { error: 'forbidden' }
  }

  const list = normalizeImages(payload.images)
  const cover = list[0] || ''
  const extraSets = []
  const extraParams = []
  if (payload.isSensitive !== undefined) {
    extraSets.push('is_sensitive = ?')
    extraParams.push(payload.isSensitive ? 1 : 0)
  }
  // 仅作者本人编辑时可切换匿名状态；同时同步展示昵称
  const editorIsOwner = Boolean(
    authUser?.id && existing._ownerUserId && existing._ownerUserId === authUser.id,
  )
  if (payload.isAnonymous !== undefined && editorIsOwner) {
    extraSets.push('is_anonymous = ?')
    extraParams.push(payload.isAnonymous ? 1 : 0)
    if (payload.nickname) {
      extraSets.push('nickname = ?')
      extraParams.push(payload.isAnonymous ? '匿名' : payload.nickname)
    }
  }
  const extraSql = extraSets.length ? `, ${extraSets.join(', ')}` : ''
  await pool.query(
    `UPDATE guestbook
     SET title = ?, category = ?, content = ?, cover = ?, images_json = ?${extraSql}
     WHERE id = ?`,
    [
      payload.title,
      payload.category,
      payload.content || '',
      cover,
      JSON.stringify(list),
      ...extraParams,
      id,
    ],
  )
  return getGuestbookById(id, { includeHidden: true, viewerUserId: authUser?.id || null })
}

export async function setGuestbookSensitive(id, isSensitive) {
  await ensureTable()
  const existing = await getGuestbookById(id, { includeHidden: true })
  if (!existing) return null
  await pool.query(`UPDATE guestbook SET is_sensitive = ? WHERE id = ?`, [
    isSensitive ? 1 : 0,
    id,
  ])
  return getGuestbookById(id, { includeHidden: true })
}

export async function setGuestbookPinned(id, isPinned) {
  await ensureTable()
  const existing = await getGuestbookById(id, { includeHidden: true })
  if (!existing) return null
  if (isPinned) {
    await pool.query(
      `UPDATE guestbook SET is_pinned = 1, pinned_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id],
    )
  } else {
    await pool.query(
      `UPDATE guestbook SET is_pinned = 0, pinned_at = NULL WHERE id = ?`,
      [id],
    )
  }
  return getGuestbookById(id, { includeHidden: true })
}

export async function setProfilePinned(id, userId, isPinned) {
  await ensureTable()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return { error: 'unauthorized' }

  const existing = await getGuestbookById(id, { includeHidden: true })
  if (!existing) return { error: 'not_found' }
  if (!existing._ownerUserId || existing._ownerUserId !== uid) return { error: 'forbidden' }

  if (isPinned) {
    await pool.query(`UPDATE guestbook SET profile_pinned = 1 WHERE id = ?`, [id])
  } else {
    await pool.query(`UPDATE guestbook SET profile_pinned = 0 WHERE id = ?`, [id])
  }
  return getGuestbookById(id, { includeHidden: true, viewerUserId: uid })
}

export async function toggleGuestbookLike(userId, postId, actor = null) {
  await ensureTable()
  const uid = Number(userId)
  const pid = Number(postId)
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(pid) || pid <= 0) {
    return { error: 'invalid' }
  }

  const post = await getGuestbookById(pid)
  if (!post || post.isHidden || post.isDeleted) return { error: 'not_found' }

  const [existing] = await pool.query(
    `SELECT id FROM guestbook_like WHERE user_id = ? AND post_id = ? LIMIT 1`,
    [uid, pid],
  )
  let liked = false
  if (existing.length) {
    await pool.query(`DELETE FROM guestbook_like WHERE user_id = ? AND post_id = ?`, [uid, pid])
    liked = false
  } else {
    await pool.query(`INSERT INTO guestbook_like (user_id, post_id) VALUES (?, ?)`, [uid, pid])
    liked = true
  }

  const updated = await getGuestbookById(pid, { viewerUserId: uid })
  if (liked) {
    await notifyPostAuthor(updated, 'like', actor || { id: uid, nickname: '有人' })
    await awardGuestbookExp(uid, 'like')
    const ownerId = updated._ownerUserId
    if (ownerId && ownerId !== uid) {
      await awardGuestbookExp(ownerId, 'receive_like')
    }
  }
  return { liked, post: updated }
}

export async function toggleGuestbookFavorite(userId, postId, actor = null) {
  await ensureTable()
  const uid = Number(userId)
  const pid = Number(postId)
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(pid) || pid <= 0) {
    return { error: 'invalid' }
  }

  const post = await getGuestbookById(pid)
  if (!post || post.isHidden || post.isDeleted) return { error: 'not_found' }

  const [existing] = await pool.query(
    `SELECT id FROM guestbook_favorite WHERE user_id = ? AND post_id = ? LIMIT 1`,
    [uid, pid],
  )
  let favorited = false
  if (existing.length) {
    await pool.query(`DELETE FROM guestbook_favorite WHERE user_id = ? AND post_id = ?`, [uid, pid])
    favorited = false
  } else {
    await pool.query(`INSERT INTO guestbook_favorite (user_id, post_id) VALUES (?, ?)`, [uid, pid])
    favorited = true
  }

  const updated = await getGuestbookById(pid, { viewerUserId: uid })
  if (favorited) {
    await notifyPostAuthor(updated, 'favorite', actor || { id: uid, nickname: '有人' })
    const ownerId = updated._ownerUserId
    if (ownerId && ownerId !== uid) {
      await awardGuestbookExp(ownerId, 'receive_favorite')
    }
  }
  return { favorited, post: updated }
}

export async function listFavoritePosts(userId, { limit = 100 } = {}) {
  await ensureTable()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const hideSensitive = await getHideSensitivePosts()
  const [rows] = await pool.query(
    `SELECT ${postSelectFields(uid)}
     FROM guestbook_favorite fav
     INNER JOIN guestbook g ON g.id = fav.post_id
     LEFT JOIN guestbook_user u ON u.id = g.user_id
     WHERE fav.user_id = ? AND g.is_hidden = 0 AND g.is_deleted = 0
       ${hideSensitive ? 'AND g.is_sensitive = 0' : ''}
     ORDER BY fav.created_at DESC, fav.id DESC
     LIMIT ${safeLimit}`,
    [uid],
  )
  return rows.map((row) => mapPost(row, uid))
}

export async function listLikedPosts(userId, { limit = 100 } = {}) {
  await ensureTable()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const hideSensitive = await getHideSensitivePosts()
  const [rows] = await pool.query(
    `SELECT ${postSelectFields(uid)}
     FROM guestbook_like lk
     INNER JOIN guestbook g ON g.id = lk.post_id
     LEFT JOIN guestbook_user u ON u.id = g.user_id
     WHERE lk.user_id = ? AND g.is_hidden = 0 AND g.is_deleted = 0
       ${hideSensitive ? 'AND g.is_sensitive = 0' : ''}
     ORDER BY lk.created_at DESC, lk.id DESC
     LIMIT ${safeLimit}`,
    [uid],
  )
  return rows.map((row) => mapPost(row, uid))
}

export async function listCommentsByUser(userId, { limit = 100 } = {}) {
  await ensureTable()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const hideSensitive = await getHideSensitivePosts()
  const [rows] = await pool.query(
    `SELECT c.id, c.post_id, c.user_id, c.nickname, c.content, c.images_json, c.is_hidden, c.is_anonymous, c.created_at, c.updated_at,
            u.nickname AS account_nickname, u.avatar AS user_avatar,
            u.level AS user_level, u.exp AS user_exp,
            g.title AS post_title, g.category AS post_category, g.is_hidden AS post_is_hidden
     FROM guestbook_comment c
     LEFT JOIN guestbook_user u ON u.id = c.user_id
     LEFT JOIN guestbook g ON g.id = c.post_id
     WHERE c.user_id = ? AND c.is_hidden = 0 AND g.is_hidden = 0 AND g.is_deleted = 0
       ${hideSensitive ? 'AND g.is_sensitive = 0' : ''}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ${safeLimit}`,
    [uid],
  )
  return rows.map((row, index) => ({
    ...mapComment(row, index + 1, { viewerUserId: uid }),
    postTitle: row.post_title || '',
    postCategory: row.post_category || '',
  }))
}

export async function setGuestbookHidden(id, isHidden, actor = null, message = '') {
  await ensureTable()
  const existing = await getGuestbookById(id, { includeHidden: true })
  if (!existing || existing.isDeleted) return null
  const modMessage = isHidden ? normalizeModerationMessage(message, 'hidden') : null
  await pool.query(
    `UPDATE guestbook SET is_hidden = ?, moderation_message = IF(? = 1, ?, NULL), restore_requested_at = NULL WHERE id = ?`,
    [isHidden ? 1 : 0, isHidden ? 1 : 0, modMessage, id],
  )
  const updated = await getGuestbookById(id, { includeHidden: true })
  if (existing._ownerUserId) {
    if (isHidden && !existing.isHidden) {
      await notifyPostAuthor(updated, 'post_hidden', actor || { label: '管理员' }, modMessage)
    } else if (!isHidden && existing.isHidden) {
      await notifyPostAuthor(updated, 'post_restored', actor || { label: '管理员' })
    }
  }
  return updated
}

export async function softDeleteGuestbook(id, actor = null, message = '') {
  await ensureTable()
  const existing = await getGuestbookById(id, { includeHidden: true })
  if (!existing || existing.isDeleted) return false
  const modMessage = normalizeModerationMessage(message, 'deleted')
  await pool.query(
    `UPDATE guestbook
     SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, moderation_message = ?, restore_requested_at = NULL
     WHERE id = ?`,
    [modMessage, id],
  )
  const updated = await getGuestbookById(id, { includeHidden: true })
  if (existing._ownerUserId) {
    await notifyPostAuthor(updated, 'post_deleted', actor || { label: '管理员' }, modMessage)
  }
  return true
}

export async function restoreGuestbook(id, actor = null) {
  await ensureTable()
  const existing = await getGuestbookById(id, { includeHidden: true })
  if (!existing) return null
  if (!existing.isDeleted && !existing.isHidden) return existing
  await pool.query(
    `UPDATE guestbook
     SET is_deleted = 0, deleted_at = NULL, is_hidden = 0, moderation_message = NULL, restore_requested_at = NULL
     WHERE id = ?`,
    [id],
  )
  const updated = await getGuestbookById(id, { includeHidden: true })
  if (existing._ownerUserId && (existing.isDeleted || existing.isHidden)) {
    await notifyPostAuthor(updated, 'post_restored', actor || { label: '管理员' })
  }
  return updated
}

export async function requestRestoreGuestbook(id, userId) {
  await ensureTable()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return { error: 'unauthorized' }

  const existing = await getGuestbookById(id, { includeHidden: true })
  if (!existing) return { error: 'not_found' }
  if (!existing._ownerUserId || existing._ownerUserId !== uid) return { error: 'forbidden' }
  if (!existing.isHidden && !existing.isDeleted) return { error: 'not_moderated' }
  if (existing.restoreRequestedAt) return { post: existing, alreadyRequested: true }

  await pool.query(`UPDATE guestbook SET restore_requested_at = CURRENT_TIMESTAMP WHERE id = ?`, [id])
  const updated = await getGuestbookById(id, { includeHidden: true, viewerUserId: uid })

  const modUserIds = await listModeratorUserIds()
  if (modUserIds.length) {
    await notifyUsers(
      modUserIds.filter((modId) => modId !== uid),
      {
        type: 'restore_request',
        postId: updated.id,
        postTitle: updated.title || '',
        actorUserId: uid,
        actorNickname: existing.nickname || '用户',
        message: `用户申请恢复委托「${updated.title || '无标题'}」`,
      },
    )
  }

  return { post: updated, alreadyRequested: false }
}

export async function deleteGuestbook(id, actor = null, message = '') {
  await ensureTable()
  return softDeleteGuestbook(id, actor, message)
}

export async function listComments(
  postId,
  { viewerUserId = null, postAuthorId = null, exposeAnonymousIdentity = false } = {},
) {
  await ensureTable()
  const viewerId = Number(viewerUserId)
  const hasViewer = Number.isFinite(viewerId) && viewerId > 0
  const mutedSelect = hasViewer
    ? `(SELECT COUNT(*) FROM guestbook_comment_mute m
        WHERE m.comment_id = c.id AND m.user_id = ${viewerId}) AS muted_by_me`
    : '0 AS muted_by_me'
  const likedByMe = hasViewer
    ? `(SELECT COUNT(*) FROM guestbook_comment_like cl
        WHERE cl.comment_id = c.id AND cl.user_id = ${viewerId}) AS liked_by_me`
    : '0 AS liked_by_me'
  const [rows] = await pool.query(
    `SELECT c.id, c.post_id, c.user_id, c.nickname, c.content, c.images_json, c.is_hidden, c.is_anonymous, c.created_at, c.updated_at,
            u.nickname AS account_nickname, u.avatar AS user_avatar,
            u.level AS user_level, u.exp AS user_exp,
            (SELECT COUNT(*) FROM guestbook_comment_like cl2 WHERE cl2.comment_id = c.id) AS like_count,
            ${mutedSelect},
            ${likedByMe}
     FROM guestbook_comment c
     LEFT JOIN guestbook_user u ON u.id = c.user_id
     WHERE c.post_id = ?
     ORDER BY c.created_at ASC, c.id ASC`,
    [postId],
  )
  const ctx = { viewerUserId, postAuthorId, exposeAnonymousIdentity }
  return rows.map((row, index) => mapComment(row, index + 1, ctx))
}

async function getCommentById(commentId) {
  await ensureTable()
  const id = Number(commentId)
  if (!Number.isFinite(id) || id <= 0) return null
  const [rows] = await pool.query(
    `SELECT c.id, c.post_id, c.user_id, c.nickname, c.content, c.images_json, c.is_hidden, c.is_anonymous, c.created_at, c.updated_at,
            u.nickname AS account_nickname, u.avatar AS user_avatar,
            u.level AS user_level, u.exp AS user_exp
     FROM guestbook_comment c
     LEFT JOIN guestbook_user u ON u.id = c.user_id
     WHERE c.id = ? LIMIT 1`,
    [id],
  )
  return rows[0] || null
}

export async function createComment(
  postId,
  { nickname, content, userId = null, images = [], isAnonymous = false },
) {
  await ensureTable()
  const post = await getGuestbookById(postId, { includeHidden: true })
  if (!post || post.isHidden || post.isDeleted) return null

  const imageList = normalizeImages(images).slice(0, 3)
  const text = String(content || '').trim()
  if (!text && !imageList.length) return null

  const [result] = await pool.query(
    `INSERT INTO guestbook_comment (post_id, nickname, user_id, content, images_json, is_anonymous) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      postId,
      nickname,
      userId || null,
      text,
      imageList.length ? JSON.stringify(imageList) : null,
      isAnonymous ? 1 : 0,
    ],
  )

  await pool.query(`UPDATE guestbook SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [postId])

  const [rows] = await pool.query(
    `SELECT c.id, c.post_id, c.user_id, c.nickname, c.content, c.images_json, c.is_hidden, c.is_anonymous, c.created_at, c.updated_at,
            u.nickname AS account_nickname, u.avatar AS user_avatar,
            u.level AS user_level, u.exp AS user_exp
     FROM guestbook_comment c
     LEFT JOIN guestbook_user u ON u.id = c.user_id
     WHERE c.id = ? LIMIT 1`,
    [result.insertId],
  )
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM guestbook_comment WHERE post_id = ? AND is_hidden = 0`,
    [postId],
  )
  const floor = Number(countRows[0]?.total || 1)
  const postOwnerId = post._ownerUserId
  const comment = mapComment(rows[0], floor, {
    viewerUserId: userId || null,
    postAuthorId: postOwnerId,
  })
  if (postOwnerId && userId && postOwnerId !== userId) {
    await notifyPostAuthor(post, 'comment', {
      id: isAnonymous ? null : userId,
      nickname,
      commentId: comment.id,
    })
  }
  if (text) {
    const mentionIds = await resolveMentionUserIds(text, userId || null)
    const filtered = mentionIds.filter((id) => id !== postOwnerId)
    if (filtered.length) {
      await notifyMentionedUsers({
        userIds: filtered,
        post,
        actor: { id: isAnonymous ? null : userId, nickname },
        commentId: comment.id,
      })
    }
  }
  if (userId) {
    await awardGuestbookExp(userId, 'comment')
  }
  if (postOwnerId && userId && postOwnerId !== userId) {
    await awardGuestbookExp(postOwnerId, 'receive_comment')
  }
  return comment
}

export async function deleteComment(id) {
  await ensureTable()
  const [result] = await pool.query(`DELETE FROM guestbook_comment WHERE id = ?`, [id])
  if (result.affectedRows > 0) {
    await pool.query(`DELETE FROM guestbook_comment_mute WHERE comment_id = ?`, [id])
    await pool.query(`DELETE FROM guestbook_comment_like WHERE comment_id = ?`, [id])
  }
  return result.affectedRows > 0
}

export async function deleteCommentWithAuth(
  commentId,
  { authUser = null, isSiteAdmin = false, isModerator = false } = {},
) {
  await ensureTable()
  const row = await getCommentById(commentId)
  if (!row) return { error: 'not_found' }

  const commentUserId = row.user_id != null ? Number(row.user_id) : null
  const authId = authUser?.id != null ? Number(authUser.id) : null
  if (!isSiteAdmin && !isModerator && (!authId || commentUserId !== authId)) {
    return { error: 'forbidden' }
  }

  const postId = Number(row.post_id)
  const ok = await deleteComment(commentId)
  if (!ok) return { error: 'not_found' }
  return { ok: true, postId }
}

export async function blockComment(commentId, authUser) {
  await ensureTable()
  const authId = authUser?.id != null ? Number(authUser.id) : null
  if (!authId) return { error: 'unauthorized' }

  const row = await getCommentById(commentId)
  if (!row) return { error: 'not_found' }

  const commentUserId = row.user_id != null ? Number(row.user_id) : null
  if (commentUserId === authId) return { error: 'forbidden' }

  const post = await getGuestbookById(row.post_id, { includeHidden: true })
  if (!post) return { error: 'not_found' }

  const postAuthorId = post._ownerUserId != null ? Number(post._ownerUserId) : null
  if (postAuthorId === authId) {
    const nextHidden = row.is_hidden ? 0 : 1
    await pool.query(`UPDATE guestbook_comment SET is_hidden = ? WHERE id = ?`, [nextHidden, commentId])
    if (nextHidden) {
      await pool.query(`DELETE FROM guestbook_comment_mute WHERE comment_id = ?`, [commentId])
    }
    return { type: 'global', blocked: Boolean(nextHidden), postId: post.id }
  }

  const [existing] = await pool.query(
    `SELECT id FROM guestbook_comment_mute WHERE user_id = ? AND comment_id = ? LIMIT 1`,
    [authId, commentId],
  )
  if (existing.length) {
    await pool.query(`DELETE FROM guestbook_comment_mute WHERE user_id = ? AND comment_id = ?`, [
      authId,
      commentId,
    ])
    return { type: 'mute', blocked: false, postId: post.id }
  }

  await pool.query(`INSERT INTO guestbook_comment_mute (user_id, comment_id) VALUES (?, ?)`, [
    authId,
    commentId,
  ])
  return { type: 'mute', blocked: true, postId: post.id }
}

export async function toggleCommentLike(userId, commentId) {
  await ensureTable()
  const uid = Number(userId)
  const cid = Number(commentId)
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(cid) || cid <= 0) {
    return { error: 'invalid' }
  }

  const row = await getCommentById(cid)
  if (!row) return { error: 'not_found' }

  const post = await getGuestbookById(row.post_id)
  if (!post || post.isHidden || post.isDeleted) return { error: 'not_found' }

  const [existing] = await pool.query(
    `SELECT id FROM guestbook_comment_like WHERE user_id = ? AND comment_id = ? LIMIT 1`,
    [uid, cid],
  )
  let liked = false
  if (existing.length) {
    await pool.query(`DELETE FROM guestbook_comment_like WHERE user_id = ? AND comment_id = ?`, [uid, cid])
    liked = false
  } else {
    await pool.query(`INSERT INTO guestbook_comment_like (user_id, comment_id) VALUES (?, ?)`, [uid, cid])
    liked = true
  }

  const comments = await listComments(row.post_id, {
    viewerUserId: uid,
    postAuthorId: post._ownerUserId,
  })
  const comment = comments.find((item) => item.id === cid)
  if (liked) {
    await awardGuestbookExp(uid, 'like')
    const ownerId = row.user_id != null ? Number(row.user_id) : null
    if (ownerId && ownerId !== uid) {
      await awardGuestbookExp(ownerId, 'receive_like')
    }
  }
  return { liked, comment }
}

export { MAX_IMAGES }
