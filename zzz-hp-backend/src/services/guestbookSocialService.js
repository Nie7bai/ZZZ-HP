import pool from '../config/db.js'
import { getUserById } from './userAuthService.js'
import { getUserExpProgress, getUserExpDailyStatus } from './guestbookExpService.js'

let ensured = false

async function ensureTables() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_follow (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      follower_id INT UNSIGNED NOT NULL,
      following_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_follow_pair (follower_id, following_id),
      KEY idx_gb_follow_following (following_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_block (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      blocker_id INT UNSIGNED NOT NULL,
      blocked_id INT UNSIGNED NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_gb_block_pair (blocker_id, blocked_id),
      KEY idx_gb_block_blocked (blocked_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  ensured = true
}

function mapSocialUser(row) {
  return {
    id: row.id,
    nickname: row.nickname || '绳网旅人',
    avatar: row.avatar || '',
    bio: row.bio || '',
    banner: row.banner || '',
    followedAt: row.followed_at || row.created_at || null,
  }
}

export async function isBlockedBetween(userA, userB) {
  await ensureTables()
  const a = Number(userA)
  const b = Number(userB)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || a === b) return false
  const [[row]] = await pool.query(
    `SELECT id FROM guestbook_block
     WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
     LIMIT 1`,
    [a, b, b, a],
  )
  return Boolean(row?.id)
}

export async function isBlockedByViewer(viewerId, targetUserId) {
  await ensureTables()
  const viewer = Number(viewerId)
  const target = Number(targetUserId)
  if (!Number.isFinite(viewer) || viewer <= 0 || !Number.isFinite(target) || target <= 0) return false
  const [[row]] = await pool.query(
    `SELECT id FROM guestbook_block WHERE blocker_id = ? AND blocked_id = ? LIMIT 1`,
    [viewer, target],
  )
  return Boolean(row?.id)
}

export async function getBlockClause(viewerUserId, alias = 'g') {
  await ensureTables()
  const viewerId = Number(viewerUserId)
  if (!Number.isFinite(viewerId) || viewerId <= 0) return { clause: '', params: [] }
  return {
    clause: `NOT EXISTS (
      SELECT 1 FROM guestbook_block b
      WHERE (b.blocker_id = ? AND b.blocked_id = ${alias}.user_id)
         OR (b.blocker_id = ${alias}.user_id AND b.blocked_id = ?)
    )`,
    params: [viewerId, viewerId],
  }
}

async function getSocialCounts(userId) {
  await ensureTables()
  const uid = Number(userId)
  const [[followerRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM guestbook_follow WHERE following_id = ?`,
    [uid],
  )
  const [[followingRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM guestbook_follow WHERE follower_id = ?`,
    [uid],
  )
  return {
    followerCount: Number(followerRow?.cnt || 0),
    followingCount: Number(followingRow?.cnt || 0),
  }
}

export async function isFollowing(followerId, followingId) {
  await ensureTables()
  const a = Number(followerId)
  const b = Number(followingId)
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return false
  const [[row]] = await pool.query(
    `SELECT id FROM guestbook_follow WHERE follower_id = ? AND following_id = ? LIMIT 1`,
    [a, b],
  )
  return Boolean(row?.id)
}

export async function getPublicUserProfile(targetUserId, viewerUserId = null) {
  await ensureTables()
  const target = await getUserById(targetUserId)
  if (!target) return null

  const viewerId = Number(viewerUserId)
  const hasViewer = Number.isFinite(viewerId) && viewerId > 0
  const isSelf = hasViewer && viewerId === target.id

  if (!isSelf && hasViewer) {
    const blocked = await isBlockedBetween(viewerId, target.id)
    if (blocked) return { error: 'blocked' }
  }

  const counts = await getSocialCounts(target.id)
  const anonymousClause = isSelf ? '' : ' AND is_anonymous = 0'
  const [[postRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM guestbook
     WHERE user_id = ? AND is_hidden = 0 AND is_deleted = 0${anonymousClause}`,
    [target.id],
  )
  const [[viewRow]] = await pool.query(
    `SELECT COALESCE(SUM(view_count), 0) AS cnt FROM guestbook
     WHERE user_id = ? AND is_deleted = 0${anonymousClause}`,
    [target.id],
  )
  const [[likeRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM guestbook_like lk
     INNER JOIN guestbook g ON g.id = lk.post_id
     WHERE g.user_id = ? AND g.is_hidden = 0 AND g.is_deleted = 0${anonymousClause.replaceAll('is_anonymous', 'g.is_anonymous')}`,
    [target.id],
  )
  const [[favoriteRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM guestbook_favorite fv
     INNER JOIN guestbook g ON g.id = fv.post_id
     WHERE g.user_id = ? AND g.is_hidden = 0 AND g.is_deleted = 0${anonymousClause.replaceAll('is_anonymous', 'g.is_anonymous')}`,
    [target.id],
  )

  const expProgress = isSelf
    ? await getUserExpDailyStatus(target.id)
    : await getUserExpProgress(target.id)
  return {
    id: target.id,
    uid: target.id,
    nickname: target.nickname,
    avatar: target.avatar || '',
    bio: target.bio || '',
    banner: target.banner || '',
    ...expProgress,
    dailyTasks: isSelf ? expProgress.dailyTasks : undefined,
    isSelf,
    isBanned: Boolean(target.isBanned),
    bannedAt: isSelf || Boolean(target.isBanned) ? target.bannedAt || null : null,
    banUntil: isSelf || Boolean(target.isBanned) ? target.banUntil || null : null,
    banReason: isSelf || Boolean(target.isBanned) ? target.banReason || '' : '',
    profilePublicSocial: Boolean(target.profilePublicSocial),
    profileShowTabs: Array.isArray(target.profileShowTabs) ? target.profileShowTabs : ['posts'],
    followerCount: counts.followerCount,
    followingCount: counts.followingCount,
    postCount: Number(postRow?.cnt || 0),
    totalViews: Number(viewRow?.cnt || 0),
    totalLikes: Number(likeRow?.cnt || 0),
    totalFavorites: Number(favoriteRow?.cnt || 0),
    isFollowing: hasViewer && !isSelf ? await isFollowing(viewerId, target.id) : false,
    isBlockedByMe: hasViewer && !isSelf ? await isBlockedByViewer(viewerId, target.id) : false,
  }
}

export async function followUser(followerId, followingId) {
  await ensureTables()
  const a = Number(followerId)
  const b = Number(followingId)
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return { error: 'invalid' }
  if (a === b) return { error: 'self' }
  if (!(await getUserById(b))) return { error: 'not_found' }
  if (await isBlockedBetween(a, b)) return { error: 'blocked' }
  if (await isFollowing(a, b)) return { following: true }

  await pool.query(`INSERT INTO guestbook_follow (follower_id, following_id) VALUES (?, ?)`, [a, b])
  return { following: true }
}

export async function unfollowUser(followerId, followingId) {
  await ensureTables()
  const a = Number(followerId)
  const b = Number(followingId)
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return { error: 'invalid' }
  await pool.query(`DELETE FROM guestbook_follow WHERE follower_id = ? AND following_id = ?`, [a, b])
  return { following: false }
}

export async function blockUser(blockerId, blockedId) {
  await ensureTables()
  const a = Number(blockerId)
  const b = Number(blockedId)
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return { error: 'invalid' }
  if (a === b) return { error: 'self' }
  if (!(await getUserById(b))) return { error: 'not_found' }

  await pool.query(`DELETE FROM guestbook_follow WHERE follower_id = ? AND following_id = ?`, [a, b])
  await pool.query(`DELETE FROM guestbook_follow WHERE follower_id = ? AND following_id = ?`, [b, a])
  await pool.query(
    `INSERT INTO guestbook_block (blocker_id, blocked_id) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE blocker_id = blocker_id`,
    [a, b],
  )
  return { blocked: true }
}

export async function unblockUser(blockerId, blockedId) {
  await ensureTables()
  const a = Number(blockerId)
  const b = Number(blockedId)
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) return { error: 'invalid' }
  await pool.query(`DELETE FROM guestbook_block WHERE blocker_id = ? AND blocked_id = ?`, [a, b])
  return { blocked: false }
}

export async function listFollowerIds(userId) {
  await ensureTables()
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return []
  const [rows] = await pool.query(
    `SELECT follower_id FROM guestbook_follow WHERE following_id = ?`,
    [uid],
  )
  return rows.map((row) => Number(row.follower_id)).filter((id) => Number.isFinite(id) && id > 0)
}

export async function listFollowers(userId, { limit = 100 } = {}) {
  await ensureTables()
  const uid = Number(userId)
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const [rows] = await pool.query(
    `SELECT u.id, u.nickname, u.avatar, u.bio, u.banner, f.created_at AS followed_at
     FROM guestbook_follow f
     INNER JOIN guestbook_user u ON u.id = f.follower_id
     WHERE f.following_id = ?
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT ${safeLimit}`,
    [uid],
  )
  return rows.map(mapSocialUser)
}

export async function listFollowing(userId, { limit = 100 } = {}) {
  await ensureTables()
  const uid = Number(userId)
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const [rows] = await pool.query(
    `SELECT u.id, u.nickname, u.avatar, u.bio, u.banner, f.created_at AS followed_at
     FROM guestbook_follow f
     INNER JOIN guestbook_user u ON u.id = f.following_id
     WHERE f.follower_id = ?
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT ${safeLimit}`,
    [uid],
  )
  return rows.map(mapSocialUser)
}

export async function listBlockedUsers(userId, { limit = 100 } = {}) {
  await ensureTables()
  const uid = Number(userId)
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200)
  const [rows] = await pool.query(
    `SELECT u.id, u.nickname, u.avatar, u.bio, b.created_at AS followed_at
     FROM guestbook_block b
     INNER JOIN guestbook_user u ON u.id = b.blocked_id
     WHERE b.blocker_id = ?
     ORDER BY b.created_at DESC, b.id DESC
     LIMIT ${safeLimit}`,
    [uid],
  )
  return rows.map(mapSocialUser)
}

export async function listModeratorUserIds() {
  await ensureTables()
  const [rows] = await pool.query(
    `SELECT u.id
     FROM guestbook_moderator m
     INNER JOIN guestbook_user u ON u.mihoyo_aid = m.mihoyo_aid
     WHERE m.is_enabled = 1`,
  )
  return rows.map((row) => Number(row.id)).filter((id) => id > 0)
}

/** 站点管理员账号（接收用户举报 / 解封申请） */
export async function listSiteAdminUserIds() {
  await ensureTables()
  await getUserById(0)
  const ids = new Set()

  const envAids = String(process.env.SITE_ADMIN_MIHOYO_AIDS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (envAids.length) {
    const placeholders = envAids.map(() => '?').join(',')
    const [aidRows] = await pool.query(
      `SELECT id FROM guestbook_user WHERE mihoyo_aid IN (${placeholders})`,
      envAids,
    )
    for (const row of aidRows) {
      const id = Number(row.id)
      if (id > 0) ids.add(id)
    }
  }

  const [flagRows] = await pool.query(
    `SELECT id FROM guestbook_user WHERE is_site_admin = 1`,
  )
  for (const row of flagRows) {
    const id = Number(row.id)
    if (id > 0) ids.add(id)
  }

  return [...ids]
}

export async function searchUsers(query, limit = 20) {
  await getUserById(0)
  const q = String(query || '').trim()
  if (!q) return []

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 30)
  const isUid = /^\d+$/.test(q)

  let rows = []
  if (isUid) {
    ;[rows] = await pool.query(
      `SELECT id, nickname, avatar, bio, banner
       FROM guestbook_user
       WHERE id = ? OR CAST(id AS CHAR) LIKE ?
       ORDER BY id DESC
       LIMIT ${safeLimit}`,
      [Number(q), `%${q}%`],
    )
  } else {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    ;[rows] = await pool.query(
      `SELECT id, nickname, avatar, bio, banner
       FROM guestbook_user
       WHERE nickname LIKE ? OR CAST(id AS CHAR) LIKE ?
       ORDER BY
         CASE WHEN nickname = ? THEN 0 WHEN nickname LIKE ? THEN 1 ELSE 2 END,
         id DESC
       LIMIT ${safeLimit}`,
      [like, like, q, `${q}%`],
    )
  }

  return rows.map((row) => ({
    id: row.id,
    uid: row.id,
    nickname: row.nickname || '绳网旅人',
    avatar: row.avatar || '',
    bio: row.bio || '',
    banner: row.banner || '',
  }))
}
