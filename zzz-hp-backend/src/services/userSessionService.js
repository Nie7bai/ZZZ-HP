import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../../data/user-sessions.json')

/** 用户会话有效期，默认 30 天 */
const USER_SESSION_TTL_MS =
  Number(process.env.USER_SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000

function ensureStore() {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions: {} }, null, 2), 'utf8')
  }
}

function readStore() {
  ensureStore()
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    const sessions =
      raw.sessions && typeof raw.sessions === 'object' && !Array.isArray(raw.sessions)
        ? raw.sessions
        : {}
    return { sessions }
  } catch {
    return { sessions: {} }
  }
}

function writeStore(store) {
  ensureStore()
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8')
}

function purgeExpiredSessions(store) {
  const now = Date.now()
  let changed = false
  for (const [token, session] of Object.entries(store.sessions)) {
    const expiresAt = Number(session?.expiresAt) || 0
    if (expiresAt <= now) {
      delete store.sessions[token]
      changed = true
    }
  }
  if (changed) writeStore(store)
  return store
}

export function createUserSession(userId) {
  const store = purgeExpiredSessions(readStore())
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + USER_SESSION_TTL_MS
  store.sessions[token] = { userId: Number(userId), expiresAt }
  writeStore(store)
  return { token, expiresAt }
}

export function getUserSession(token) {
  if (typeof token !== 'string' || !token.trim()) return null
  const store = purgeExpiredSessions(readStore())
  const session = store.sessions[token.trim()]
  if (!session) return null
  if (Number(session.expiresAt) <= Date.now()) {
    delete store.sessions[token.trim()]
    writeStore(store)
    return null
  }
  return { userId: Number(session.userId), expiresAt: Number(session.expiresAt) }
}

/** 访问时续期，避免频繁重新扫码 */
export function touchUserSession(token) {
  if (typeof token !== 'string' || !token.trim()) return null
  const key = token.trim()
  const store = purgeExpiredSessions(readStore())
  const session = store.sessions[key]
  if (!session) return null
  if (Number(session.expiresAt) <= Date.now()) {
    delete store.sessions[key]
    writeStore(store)
    return null
  }
  session.expiresAt = Date.now() + USER_SESSION_TTL_MS
  store.sessions[key] = session
  writeStore(store)
  return { userId: Number(session.userId), expiresAt: Number(session.expiresAt) }
}

export function revokeUserSession(token) {
  if (typeof token !== 'string' || !token.trim()) return
  const store = readStore()
  if (store.sessions[token.trim()]) {
    delete store.sessions[token.trim()]
    writeStore(store)
  }
}

/**
 * 封禁踢下线后，仍用原 token 反查用户，以便返回「账号已被封禁」而不是「登录已失效」。
 * token -> { userId, expiresAt }
 */
const banKickMarks = new Map()

function pruneBanKickMarks() {
  const now = Date.now()
  for (const [token, mark] of banKickMarks.entries()) {
    if (!mark || Number(mark.expiresAt) <= now) banKickMarks.delete(token)
  }
}

/** 吊销某用户的全部会话（封禁时使用） */
export function revokeAllSessionsForUser(userId, { markBanned = false } = {}) {
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return 0
  const store = readStore()
  let removed = 0
  const markExpiresAt = Date.now() + USER_SESSION_TTL_MS
  for (const [token, session] of Object.entries(store.sessions)) {
    if (Number(session?.userId) === uid) {
      if (markBanned) {
        banKickMarks.set(token, { userId: uid, expiresAt: markExpiresAt })
      }
      delete store.sessions[token]
      removed += 1
    }
  }
  if (removed) writeStore(store)
  return removed
}

/** 被封禁踢下线的 token 标记（用于提示封禁原因） */
export function getBanKickMark(token) {
  if (typeof token !== 'string' || !token.trim()) return null
  pruneBanKickMarks()
  const mark = banKickMarks.get(token.trim())
  if (!mark) return null
  if (Number(mark.expiresAt) <= Date.now()) {
    banKickMarks.delete(token.trim())
    return null
  }
  return { userId: Number(mark.userId), expiresAt: Number(mark.expiresAt) }
}

export function clearBanKickMark(token) {
  if (typeof token !== 'string' || !token.trim()) return
  banKickMarks.delete(token.trim())
}
