import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../../data/ocr-quota.json')

/** 全站每月云识别上限（腾讯云总配额） */
export const OCR_MONTHLY_LIMIT = Number(process.env.OCR_MONTHLY_LIMIT) || 1000

/** 普通用户每人每月上传识别次数 */
export const OCR_USER_MONTHLY_LIMIT = Number(process.env.OCR_USER_MONTHLY_LIMIT) || 50

function monthKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function ensureStore() {
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(DATA_FILE)) {
    const initialUsed = Math.max(
      0,
      Math.min(OCR_MONTHLY_LIMIT, Number(process.env.OCR_MONTH_USED_SEED) || 4),
    )
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ month: monthKey(), globalUsed: initialUsed, users: {} }, null, 2),
      'utf8',
    )
  }
}

function readStore() {
  ensureStore()
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    const month = typeof raw.month === 'string' ? raw.month : monthKey()
    const globalUsed = Number(raw.globalUsed ?? raw.used) || 0
    const users =
      raw.users && typeof raw.users === 'object' && !Array.isArray(raw.users) ? raw.users : {}
    const normalizedUsers = {}
    for (const [key, value] of Object.entries(users)) {
      const used = Number(value) || 0
      if (used > 0) normalizedUsers[key] = used
    }
    return { month, globalUsed, users: normalizedUsers }
  } catch {
    return { month: monthKey(), globalUsed: 0, users: {} }
  }
}

function writeStore(store) {
  ensureStore()
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      {
        month: store.month,
        globalUsed: store.globalUsed,
        users: store.users,
      },
      null,
      2,
    ),
    'utf8',
  )
}

function syncMonth(store) {
  const current = monthKey()
  if (store.month !== current) {
    store.month = current
    store.globalUsed = 0
    store.users = {}
    writeStore(store)
  }
  return store
}

function getUserUsed(store, clientId) {
  if (!clientId) return 0
  return Math.max(0, Number(store.users[clientId]) || 0)
}

function buildGlobalQuota(store) {
  const limit = OCR_MONTHLY_LIMIT
  const used = Math.min(limit, Math.max(0, store.globalUsed))
  const remaining = Math.max(0, limit - used)
  return { month: store.month, limit, used, remaining }
}

function buildUserQuota(store, clientId) {
  const global = buildGlobalQuota(store)
  const userLimit = OCR_USER_MONTHLY_LIMIT
  const userUsed = Math.min(userLimit, getUserUsed(store, clientId))
  const userRemaining = Math.max(0, userLimit - userUsed)
  // 个人可用 = min(个人剩余, 全站剩余)；全站用尽后即使个人还有次数也不能识别
  const remaining = Math.min(userRemaining, global.remaining)
  return {
    month: store.month,
    limit: userLimit,
    used: userUsed,
    remaining,
    personalRemaining: userRemaining,
    scope: 'user',
    globalLimit: global.limit,
    globalUsed: global.used,
    globalRemaining: global.remaining,
  }
}

/**
 * @param {{ clientId?: string, isAdmin?: boolean }} options
 */
export function getOcrQuota(options = {}) {
  const store = syncMonth(readStore())
  const { clientId, isAdmin = false } = options

  if (isAdmin) {
    const global = buildGlobalQuota(store)
    return {
      ...global,
      scope: 'global',
      isAdmin: true,
      userLimit: OCR_USER_MONTHLY_LIMIT,
    }
  }

  return buildUserQuota(store, clientId)
}

function quotaExceededError(code, message, store, clientId, isAdmin) {
  const err = new Error(message)
  err.code = code
  err.quota = getOcrQuota({ clientId, isAdmin })
  return err
}

/**
 * 占用云识别额度：先扣全站，再扣个人（管理员仅扣全站）。
 * @param {number} count
 * @param {{ clientId?: string, isAdmin?: boolean }} options
 */
export function consumeOcrQuota(count = 1, options = {}) {
  const { clientId, isAdmin = false } = options
  const store = syncMonth(readStore())
  const globalLimit = OCR_MONTHLY_LIMIT
  const userLimit = OCR_USER_MONTHLY_LIMIT

  if (store.globalUsed + count > globalLimit) {
    throw quotaExceededError(
      'OCR_GLOBAL_QUOTA_EXCEEDED',
      `本月全站云识别次数已用尽（上限 ${globalLimit} 次）`,
      store,
      clientId,
      isAdmin,
    )
  }

  if (!isAdmin) {
    if (!clientId) {
      throw quotaExceededError(
        'OCR_CLIENT_REQUIRED',
        '缺少识别客户端标识，请刷新页面后重试',
        store,
        clientId,
        false,
      )
    }
    const userUsed = getUserUsed(store, clientId)
    if (userUsed + count > userLimit) {
      throw quotaExceededError(
        'OCR_USER_QUOTA_EXCEEDED',
        `您本月云识别次数已用尽（每人 ${userLimit} 次）`,
        store,
        clientId,
        false,
      )
    }
    store.users[clientId] = userUsed + count
  }

  store.globalUsed += count
  writeStore(store)
  return getOcrQuota({ clientId, isAdmin })
}
