import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pool from '../config/db.js'
import { createUserSession } from './userSessionService.js'
import { ensureUserSecurityColumns, getUserSecurityRow, getUserProfileById } from './userAuthService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CODE_FILE = path.join(__dirname, '../../data/phone-codes.json')
const CODE_TTL_MS = 5 * 60 * 1000
const CODE_COOLDOWN_MS = 60 * 1000

function ensureDataDir() {
  const dir = path.dirname(CODE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function readCodes() {
  ensureDataDir()
  if (!fs.existsSync(CODE_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(CODE_FILE, 'utf8')) || {}
  } catch {
    return {}
  }
}

function writeCodes(data) {
  ensureDataDir()
  fs.writeFileSync(CODE_FILE, JSON.stringify(data, null, 2), 'utf8')
}

function normalizePhone(raw) {
  const phone = String(raw || '').trim()
  if (!/^1\d{10}$/.test(phone)) throw new Error('请输入正确的手机号')
  return phone
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) return ''
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  const next = crypto.scryptSync(password, salt, 64).toString('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex'))
  } catch {
    return false
  }
}

export function getSecuritySummary(row) {
  if (!row) return null
  return {
    hasPassword: Boolean(row.password_hash),
    hasPhone: Boolean(row.phone),
    phone: maskPhone(row.phone || ''),
    phoneRawBound: Boolean(row.phone),
    mihoyoAid: row.mihoyo_aid || '',
    mihoyoMid: row.mihoyo_mid || '',
    nickname: row.nickname || '绳网旅人',
    avatar: row.avatar || '',
    createdAt: row.created_at,
  }
}

export async function getSecurityByUserId(userId) {
  await ensureUserSecurityColumns()
  const row = await getUserSecurityRow(userId)
  return getSecuritySummary(row)
}

export async function sendPhoneCode({ userId, phone, purpose = 'bind' }) {
  await ensureUserSecurityColumns()
  const id = Number(userId)
  let normalized = ''

  if (purpose === 'password') {
    const row = await getUserSecurityRow(id)
    if (!row?.phone) throw new Error('请先绑定手机号')
    // 改密验证码默认发到已绑定手机；也可传入同号校验
    normalized = row.phone
    if (phone && String(phone).trim()) {
      const input = normalizePhone(phone)
      if (input !== row.phone) throw new Error('手机号与绑定号码不一致')
      normalized = input
    }
  } else {
    normalized = normalizePhone(phone)
    const [taken] = await pool.query(
      `SELECT id FROM guestbook_user WHERE phone = ? AND id <> ? LIMIT 1`,
      [normalized, id],
    )
    if (taken[0]) throw new Error('该手机号已被其他账号绑定')
  }

  const key = `${purpose}:${id}:${normalized}`
  const codes = readCodes()
  const prev = codes[key]
  const now = Date.now()
  if (prev?.sentAt && now - prev.sentAt < CODE_COOLDOWN_MS) {
    const wait = Math.ceil((CODE_COOLDOWN_MS - (now - prev.sentAt)) / 1000)
    throw new Error(`请 ${wait} 秒后再试`)
  }

  const code = String(Math.floor(100000 + Math.random() * 900000))
  codes[key] = { code, sentAt: now, expiresAt: now + CODE_TTL_MS }
  writeCodes(codes)

  // 暂未接入短信网关：开发/默认模式下回传验证码便于联调
  const exposeCode =
    process.env.SMS_MOCK !== '0' &&
    (process.env.NODE_ENV !== 'production' || process.env.SMS_MOCK === '1')

  console.info(`[phone-code] user=${id} phone=${normalized} purpose=${purpose} code=${code}`)

  return {
    ok: true,
    expiresIn: Math.floor(CODE_TTL_MS / 1000),
    cooldown: Math.floor(CODE_COOLDOWN_MS / 1000),
    ...(exposeCode ? { mockCode: code } : {}),
  }
}

function consumePhoneCode({ userId, phone, purpose, code }) {
  const normalized = normalizePhone(phone)
  const input = String(code || '').trim()
  if (!/^\d{6}$/.test(input)) throw new Error('请输入 6 位验证码')

  const key = `${purpose}:${Number(userId)}:${normalized}`
  const codes = readCodes()
  const entry = codes[key]
  if (!entry) throw new Error('请先获取验证码')
  if (Date.now() > entry.expiresAt) {
    delete codes[key]
    writeCodes(codes)
    throw new Error('验证码已过期')
  }
  if (entry.code !== input) throw new Error('验证码错误')

  delete codes[key]
  writeCodes(codes)
  return normalized
}

export async function bindPhone({ userId, phone, code }) {
  await ensureUserSecurityColumns()
  const normalized = consumePhoneCode({ userId, phone, purpose: 'bind', code })

  const [taken] = await pool.query(
    `SELECT id FROM guestbook_user WHERE phone = ? AND id <> ? LIMIT 1`,
    [normalized, userId],
  )
  if (taken[0]) throw new Error('该手机号已被其他账号绑定')

  await pool.query(`UPDATE guestbook_user SET phone = ? WHERE id = ?`, [normalized, userId])
  return getSecurityByUserId(userId)
}

export async function setPassword({ userId, password, oldPassword = '', code = '', phone = '' }) {
  await ensureUserSecurityColumns()
  const pwd = String(password || '')
  if (pwd.length < 6 || pwd.length > 64) throw new Error('密码长度需为 6-64 位')

  const row = await getUserSecurityRow(userId)
  if (!row) throw new Error('用户不存在')

  if (row.password_hash) {
    // 已有密码：旧密码 或 手机验证码
    const oldOk = oldPassword && verifyPassword(String(oldPassword), row.password_hash)
    if (!oldOk) {
      if (!row.phone) throw new Error('请输入正确的原密码')
      consumePhoneCode({
        userId,
        phone: row.phone,
        purpose: 'password',
        code,
      })
    }
  }

  const passwordHash = hashPassword(pwd)
  await pool.query(`UPDATE guestbook_user SET password_hash = ? WHERE id = ?`, [
    passwordHash,
    userId,
  ])
  return getSecurityByUserId(userId)
}

export async function loginWithPhonePassword(phone, password) {
  await ensureUserSecurityColumns()
  const normalized = normalizePhone(phone)
  const pwd = String(password || '')
  if (!pwd) throw new Error('请输入密码')

  const [rows] = await pool.query(
    `SELECT id, password_hash, is_banned, ban_reason FROM guestbook_user WHERE phone = ? LIMIT 1`,
    [normalized],
  )
  const row = rows[0]
  if (!row?.password_hash || !verifyPassword(pwd, row.password_hash)) {
    throw new Error('手机号或密码错误')
  }

  const { token, expiresAt } = createUserSession(row.id)
  const user = await getUserProfileById(row.id)
  return { token, expiresAt, user }
}

export { maskPhone, verifyPassword, hashPassword }
