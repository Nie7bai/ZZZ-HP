const ADMIN_AUTH_STORAGE_KEY = 'zzz-hp-admin-authed'
const ADMIN_TOKEN_STORAGE_KEY = 'zzz-hp-admin-token'
const OCR_CLIENT_ID_KEY = 'zzz-hp-ocr-client-id'

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value == null) {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, value)
    // 同步清理旧版 sessionStorage，避免两套状态不一致
    sessionStorage.removeItem(key)
  } catch {
    /* ignore quota / private mode */
  }
}

export function isAdminAuthenticated(): boolean {
  return readStorage(ADMIN_AUTH_STORAGE_KEY) === '1' && Boolean(getAdminToken())
}

export function getAdminToken(): string {
  return readStorage(ADMIN_TOKEN_STORAGE_KEY)?.trim() || ''
}

export function setAdminAuthenticated(value: boolean, token?: string) {
  if (value) {
    if (!token?.trim()) {
      writeStorage(ADMIN_AUTH_STORAGE_KEY, null)
      writeStorage(ADMIN_TOKEN_STORAGE_KEY, null)
      return
    }
    writeStorage(ADMIN_AUTH_STORAGE_KEY, '1')
    writeStorage(ADMIN_TOKEN_STORAGE_KEY, token.trim())
    return
  }
  writeStorage(ADMIN_AUTH_STORAGE_KEY, null)
  writeStorage(ADMIN_TOKEN_STORAGE_KEY, null)
}

export function clearAdminAuthenticated() {
  setAdminAuthenticated(false)
}

function writeCookie(name: string, value: string) {
  try {
    const maxAge = 60 * 60 * 24 * 400
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`
  } catch {
    /* ignore */
  }
}

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/** 浏览器端稳定客户端 ID，用于普通用户每月额度统计 */
export function getOrCreateOcrClientId(): string {
  try {
    const existing =
      localStorage.getItem(OCR_CLIENT_ID_KEY)?.trim() ||
      sessionStorage.getItem(OCR_CLIENT_ID_KEY)?.trim() ||
      readCookie(OCR_CLIENT_ID_KEY)?.trim()
    if (existing) {
      try {
        localStorage.setItem(OCR_CLIENT_ID_KEY, existing)
        sessionStorage.setItem(OCR_CLIENT_ID_KEY, existing)
      } catch {
        /* ignore */
      }
      writeCookie(OCR_CLIENT_ID_KEY, existing)
      return existing
    }
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `ocr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    try {
      localStorage.setItem(OCR_CLIENT_ID_KEY, id)
      sessionStorage.setItem(OCR_CLIENT_ID_KEY, id)
    } catch {
      /* ignore */
    }
    writeCookie(OCR_CLIENT_ID_KEY, id)
    return id
  } catch {
    return `ocr-temp-${Date.now().toString(36)}`
  }
}
