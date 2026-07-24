import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../../data/admin-sessions.json')

/** 管理员会话有效期（毫秒），默认 12 小时 */
const ADMIN_SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS) || 12 * 60 * 60 * 1000

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

export function createAdminSession() {
  const store = purgeExpiredSessions(readStore())
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS
  store.sessions[token] = { expiresAt }
  writeStore(store)
  return { token, expiresAt }
}

export function isValidAdminSession(token) {
  if (typeof token !== 'string' || !token.trim()) return false
  const store = purgeExpiredSessions(readStore())
  const session = store.sessions[token.trim()]
  if (!session) return false
  if (Number(session.expiresAt) <= Date.now()) {
    delete store.sessions[token.trim()]
    writeStore(store)
    return false
  }
  return true
}

export function revokeAdminSession(token) {
  if (typeof token !== 'string' || !token.trim()) return
  const store = readStore()
  if (store.sessions[token.trim()]) {
    delete store.sessions[token.trim()]
    writeStore(store)
  }
}
