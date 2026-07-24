import crypto from 'crypto'
import pool from '../config/db.js'
import { isGuestbookModerator } from './guestbookModeratorService.js'
import { getUserExpProgress } from './guestbookExpService.js'
import {
  createUserSession,
  getBanKickMark,
  clearBanKickMark,
  getUserSession,
  touchUserSession,
} from './userSessionService.js'

const DEFAULT_PROFILE_SHOW_TABS = ['posts', 'favorites', 'likes', 'comments']

let ensured = false

const USER_SELECT = `id, mihoyo_aid, mihoyo_mid, nickname, avatar, bio, banner, phone,
  profile_public_social, profile_show_tabs,
  is_banned, banned_at, ban_until, ban_reason, is_site_admin, level, exp,
  (CASE WHEN password_hash IS NULL OR password_hash = '' THEN 0 ELSE 1 END) AS has_password,
  created_at, updated_at`
const SECURITY_SELECT = `id, mihoyo_aid, mihoyo_mid, nickname, avatar, phone, password_hash,
  is_banned, banned_at, ban_until, ban_reason, is_site_admin, created_at, updated_at`

export async function ensureUserSecurityColumns() {
  await ensureUserTable()
}

async function ensureUserTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guestbook_user (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      mihoyo_aid VARCHAR(64) NOT NULL,
      mihoyo_mid VARCHAR(64) NOT NULL DEFAULT '',
      nickname VARCHAR(40) NOT NULL DEFAULT '绳网旅人',
      avatar VARCHAR(512) NOT NULL DEFAULT '',
      bio VARCHAR(120) NOT NULL DEFAULT '',
      banner VARCHAR(512) NOT NULL DEFAULT '',
      phone VARCHAR(20) NOT NULL DEFAULT '',
      password_hash VARCHAR(160) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_guestbook_user_aid (mihoyo_aid),
      KEY idx_guestbook_user_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  const [cols] = await pool.query(`SHOW COLUMNS FROM guestbook_user`)
  const names = new Set(cols.map((c) => c.Field))
  if (!names.has('bio')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN bio VARCHAR(120) NOT NULL DEFAULT '' COMMENT '个性签名' AFTER avatar`,
    )
  }
  if (!names.has('banner')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN banner VARCHAR(512) NOT NULL DEFAULT '' COMMENT '名片背景' AFTER bio`,
    )
  }
  if (!names.has('phone')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN phone VARCHAR(20) NOT NULL DEFAULT '' COMMENT '绑定手机号' AFTER banner`,
    )
  }
  if (!names.has('password_hash')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN password_hash VARCHAR(160) NOT NULL DEFAULT '' COMMENT '登录密码哈希' AFTER phone`,
    )
  }
  if (!names.has('profile_public_social')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN profile_public_social TINYINT(1) NOT NULL DEFAULT 0 COMMENT '公开粉丝与关注' AFTER password_hash`,
    )
  }
  if (!names.has('profile_show_tabs')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN profile_show_tabs VARCHAR(256) NOT NULL DEFAULT '["posts","favorites","likes","comments"]' COMMENT '名片展示 Tab JSON' AFTER profile_public_social`,
    )
  }
  if (!names.has('is_banned')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN is_banned TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否封禁' AFTER profile_show_tabs`,
    )
  }
  if (!names.has('banned_at')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN banned_at TIMESTAMP NULL DEFAULT NULL COMMENT '封禁时间' AFTER is_banned`,
    )
  }
  if (!names.has('ban_reason')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN ban_reason VARCHAR(200) NOT NULL DEFAULT '' COMMENT '封禁原因' AFTER banned_at`,
    )
  }
  if (!names.has('ban_until')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN ban_until TIMESTAMP NULL DEFAULT NULL COMMENT '封禁截止时间，空=永久' AFTER ban_reason`,
    )
  }
  if (!names.has('is_site_admin')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN is_site_admin TINYINT(1) NOT NULL DEFAULT 0 COMMENT '站点管理员（接收用户举报等）' AFTER ban_until`,
    )
  }
  if (!names.has('level')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN level INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '等级' AFTER is_site_admin`,
    )
  }
  if (!names.has('exp')) {
    await pool.query(
      `ALTER TABLE guestbook_user ADD COLUMN exp INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前等级经验' AFTER level`,
    )
  }
  ensured = true
}

function parseProfileShowTabs(raw) {
  try {
    const arr = JSON.parse(raw || '[]')
    if (!Array.isArray(arr)) return [...DEFAULT_PROFILE_SHOW_TABS]
    const allowed = new Set(DEFAULT_PROFILE_SHOW_TABS)
    const picked = arr.filter((t) => typeof t === 'string' && allowed.has(t))
    return picked.length ? picked : ['posts']
  } catch {
    return [...DEFAULT_PROFILE_SHOW_TABS]
  }
}

function serializeProfileShowTabs(tabs) {
  const allowed = new Set(DEFAULT_PROFILE_SHOW_TABS)
  const picked = (Array.isArray(tabs) ? tabs : []).filter(
    (t) => typeof t === 'string' && allowed.has(t),
  )
  return JSON.stringify(picked.length ? picked : ['posts'])
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) return ''
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function mapUser(row) {
  if (!row) return null
  const banUntil = row.ban_until || null
  const flagged = Boolean(Number(row.is_banned || 0))
  const expired =
    flagged && banUntil != null && new Date(banUntil).getTime() <= Date.now()
  return {
    id: row.id,
    mihoyoAid: row.mihoyo_aid,
    mihoyoMid: row.mihoyo_mid || '',
    nickname: row.nickname || '绳网旅人',
    avatar: row.avatar || '',
    bio: row.bio || '',
    banner: row.banner || '',
    phone: maskPhone(row.phone || ''),
    hasPhone: Boolean(row.phone),
    hasPassword: Boolean(row.has_password || row.password_hash),
    profilePublicSocial: Boolean(row.profile_public_social),
    profileShowTabs: parseProfileShowTabs(row.profile_show_tabs),
    isBanned: flagged && !expired,
    bannedAt: row.banned_at || null,
    banUntil,
    banReason: row.ban_reason || '',
    isSiteAdmin: Boolean(Number(row.is_site_admin || 0)),
    level: Number(row.level || 1),
    exp: Number(row.exp || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 账号封禁：可登录，但禁止发帖/评论等互动写作 */
export function assertUserCanPost(user) {
  if (user?.isBanned) {
    const reason = user.banReason ? `：${user.banReason}` : ''
    const err = new Error(`账号处于封禁状态，暂时无法发帖或评论${reason}`)
    err.code = 'USER_BANNED_POST'
    throw err
  }
}

export function assertUserNotBanned(user) {
  // 兼容旧调用：现改为仅限制发帖/评论
  assertUserCanPost(user)
}

function pickNickname(userInfo = {}) {
  const candidates = [
    userInfo.account_name,
    userInfo.nickname,
    userInfo.name,
    userInfo.aid ? `旅人${String(userInfo.aid).slice(-4)}` : '',
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 40)
  }
  return '绳网旅人'
}

export async function upsertMihoyoUser(userInfo = {}) {
  await ensureUserTable()
  const aid = String(userInfo.aid || userInfo.account_id || '').trim()
  if (!aid) throw new Error('米游社账号信息不完整')

  const mid = String(userInfo.mid || '').trim()
  const nickname = pickNickname(userInfo)
  const avatar = typeof userInfo.avatar_url === 'string' ? userInfo.avatar_url.trim() : ''

  const [existing] = await pool.query(
    `SELECT ${USER_SELECT} FROM guestbook_user WHERE mihoyo_aid = ? LIMIT 1`,
    [aid],
  )

  if (existing[0]) {
    // 再次登录只同步 mid，保留用户自定义的昵称 / 头像 / 签名 / 背景
    await pool.query(
      `UPDATE guestbook_user SET mihoyo_mid = ? WHERE id = ?`,
      [mid || existing[0].mihoyo_mid, existing[0].id],
    )
    const [rows] = await pool.query(
      `SELECT ${USER_SELECT} FROM guestbook_user WHERE id = ? LIMIT 1`,
      [existing[0].id],
    )
    return { user: mapUser(rows[0]), isNewUser: false }
  }

  const [result] = await pool.query(
    `INSERT INTO guestbook_user (mihoyo_aid, mihoyo_mid, nickname, avatar)
     VALUES (?, ?, ?, ?)`,
    [aid, mid, nickname, avatar],
  )
  const [rows] = await pool.query(
    `SELECT ${USER_SELECT} FROM guestbook_user WHERE id = ? LIMIT 1`,
    [result.insertId],
  )
  return { user: mapUser(rows[0]), isNewUser: true }
}

export async function getUserById(id) {
  await ensureUserTable()
  const [rows] = await pool.query(
    `SELECT ${USER_SELECT} FROM guestbook_user WHERE id = ? LIMIT 1`,
    [id],
  )
  const user = mapUser(rows[0])
  if (!user) return null
  // 到期自动解封
  if (
    rows[0] &&
    Number(rows[0].is_banned || 0) === 1 &&
    rows[0].ban_until &&
    new Date(rows[0].ban_until).getTime() <= Date.now()
  ) {
    await pool.query(
      `UPDATE guestbook_user
       SET is_banned = 0, banned_at = NULL, ban_until = NULL, ban_reason = ''
       WHERE id = ?`,
      [user.id],
    )
    return {
      ...user,
      isBanned: false,
      bannedAt: null,
      banUntil: null,
      banReason: '',
    }
  }
  return user
}

export async function getUserSecurityRow(id) {
  await ensureUserTable()
  const [rows] = await pool.query(
    `SELECT ${SECURITY_SELECT} FROM guestbook_user WHERE id = ? LIMIT 1`,
    [id],
  )
  return rows[0] || null
}

async function getUserStats(userId) {
  const id = Number(userId)
  if (!Number.isFinite(id) || id <= 0) {
    return { postCount: 0, totalViews: 0, totalLikes: 0, totalFavorites: 0 }
  }

  const [[postRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM guestbook WHERE user_id = ? AND is_hidden = 0`,
    [id],
  )
  const [[likeRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM guestbook_like lk
     INNER JOIN guestbook g ON g.id = lk.post_id
     WHERE g.user_id = ? AND g.is_hidden = 0`,
    [id],
  )
  const [[favoriteRow]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM guestbook_favorite fv
     INNER JOIN guestbook g ON g.id = fv.post_id
     WHERE g.user_id = ? AND g.is_hidden = 0`,
    [id],
  )
  const [[viewRow]] = await pool.query(
    `SELECT COALESCE(SUM(view_count), 0) AS cnt
     FROM guestbook WHERE user_id = ? AND is_deleted = 0`,
    [id],
  )

  return {
    postCount: Number(postRow?.cnt || 0),
    totalViews: Number(viewRow?.cnt || 0),
    totalLikes: Number(likeRow?.cnt || 0),
    totalFavorites: Number(favoriteRow?.cnt || 0),
  }
}

export async function getUserProfileById(id) {
  const user = await getUserById(id)
  if (!user) return null
  const stats = await getUserStats(id)
  const moderator = await isGuestbookModerator(user.mihoyoAid, user.mihoyoMid)
  const expProgress = await getUserExpProgress(user.id)
  return {
    ...user,
    uid: user.id,
    ...expProgress,
    isGuestbookModerator: moderator,
    stats: {
      totalViews: stats.totalViews,
      totalFavorites: stats.totalFavorites,
      totalLikes: stats.totalLikes,
      postCount: stats.postCount,
    },
  }
}

export async function updateUserProfile(userId, patch = {}) {
  await ensureUserTable()
  const id = Number(userId)
  if (!Number.isFinite(id) || id <= 0) throw new Error('用户无效')

  const existing = await getUserById(id)
  if (!existing) throw new Error('用户不存在')

  const next = {
    nickname: existing.nickname,
    avatar: existing.avatar,
    bio: existing.bio,
    banner: existing.banner,
    profilePublicSocial: existing.profilePublicSocial,
    profileShowTabs: [...(existing.profileShowTabs || DEFAULT_PROFILE_SHOW_TABS)],
  }

  if (typeof patch.nickname === 'string') {
    const name = patch.nickname.trim()
    if (!name) throw new Error('昵称不能为空')
    if (name.length > 20) throw new Error('昵称不能超过 20 个字符')
    next.nickname = name
  }
  if (typeof patch.bio === 'string') {
    const bio = patch.bio.trim()
    if (bio.length > 100) throw new Error('签名不能超过 100 个字符')
    next.bio = bio
  }
  if (typeof patch.avatar === 'string') {
    next.avatar = patch.avatar.trim().slice(0, 512)
  }
  if (typeof patch.banner === 'string') {
    next.banner = patch.banner.trim().slice(0, 512)
  }
  if (typeof patch.profilePublicSocial === 'boolean') {
    next.profilePublicSocial = patch.profilePublicSocial
  }
  if (Array.isArray(patch.profileShowTabs)) {
    next.profileShowTabs = parseProfileShowTabs(JSON.stringify(patch.profileShowTabs))
  }

  await pool.query(
    `UPDATE guestbook_user
     SET nickname = ?, avatar = ?, bio = ?, banner = ?,
         profile_public_social = ?, profile_show_tabs = ?
     WHERE id = ?`,
    [
      next.nickname,
      next.avatar,
      next.bio,
      next.banner,
      next.profilePublicSocial ? 1 : 0,
      serializeProfileShowTabs(next.profileShowTabs),
      id,
    ],
  )

  // 同步历史帖子 / 评论展示名
  if (next.nickname !== existing.nickname) {
    await pool.query(`UPDATE guestbook SET nickname = ? WHERE user_id = ?`, [next.nickname, id])
    await pool.query(`UPDATE guestbook_comment SET nickname = ? WHERE user_id = ?`, [
      next.nickname,
      id,
    ])
  }

  return getUserProfileById(id)
}

export async function issueSessionForMihoyoUser(userInfo) {
  const { user, isNewUser } = await upsertMihoyoUser(userInfo)
  const { token, expiresAt } = createUserSession(user.id)
  const profile = await getUserProfileById(user.id)
  return { token, expiresAt, user: profile || user, isNewUser }
}

export async function getUserByToken(token) {
  const session = touchUserSession(token) || getUserSession(token)
  if (!session) {
    // 旧版封禁踢下线标记：允许重新登录，这里仅清理无效 token
    const mark = getBanKickMark(token)
    if (mark) clearBanKickMark(token)
    return null
  }
  const user = await getUserProfileById(session.userId)
  if (!user) return null
  return user
}

export function logoutByToken(token) {
  revokeUserSession(token)
}

export function extractBearerToken(req) {
  const header = req.headers?.authorization
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim()
  }
  return ''
}

export function newDeviceId() {
  return crypto.randomUUID().toUpperCase()
}
