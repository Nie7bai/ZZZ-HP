export interface AuthUserStats {
  totalViews: number
  totalFavorites: number
  totalLikes: number
  postCount: number
}

export interface AuthUser {
  id: number
  uid?: number
  mihoyoAid: string
  mihoyoMid?: string
  nickname: string
  avatar?: string
  bio?: string
  banner?: string
  phone?: string
  hasPhone?: boolean
  hasPassword?: boolean
  profilePublicSocial?: boolean
  profileShowTabs?: string[]
  isGuestbookModerator?: boolean
  isSiteAdmin?: boolean
  isBanned?: boolean
  bannedAt?: string | null
  banUntil?: string | null
  banReason?: string
  level?: number
  exp?: number
  expRequired?: number | null
  isMaxLevel?: boolean
  stats?: AuthUserStats
  createdAt?: string
  updatedAt?: string
}

export interface AccountSecurity {
  hasPassword: boolean
  hasPhone: boolean
  phone: string
  phoneRawBound?: boolean
  mihoyoAid: string
  mihoyoMid: string
  nickname: string
  avatar?: string
  createdAt?: string
}

export type MihoyoQrStatus =
  | 'waiting'
  | 'scanned'
  | 'confirmed'
  | 'expired'
  | 'cancelled'
  | 'error'

export interface MihoyoQrCreateResult {
  qrUrl: string
  ticket: string
  expiresIn: number
  mode: 'login' | 'bind'
}

export type MihoyoQrPollResult =
  | { status: 'waiting' | 'scanned'; mode?: 'login' | 'bind' }
  | { status: 'expired' | 'cancelled' | 'error'; message?: string }
  | {
      status: 'confirmed'
      mode: 'login' | 'bind'
      isNewUser?: boolean
      auth: {
        token: string
        expiresAt?: number
        user: AuthUser
      }
    }

export interface UpdateProfilePayload {
  nickname?: string
  bio?: string
  avatar?: string
  banner?: string
  profilePublicSocial?: boolean
  profileShowTabs?: string[]
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isAccountBannedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  // 软封禁（可登录不可发帖）不再视为登录失败
  if (/发帖或评论|无法发帖|无法评论/.test(err.message)) return false
  if (!/封禁/.test(err.message)) return false
  if (err instanceof ApiError) return err.status === 403 || err.status >= 400
  return true
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const json = (await response.json()) as ApiResponse<T>
  if (!response.ok || json.code !== 200) {
    const detail =
      json.data && typeof json.data === 'object' && 'error' in (json.data as object)
        ? String((json.data as { error?: string }).error || '')
        : ''
    throw new ApiError(detail || json.message || `请求失败: ${response.status}`, response.status)
  }
  return json.data
}

export async function createMihoyoQr(): Promise<MihoyoQrCreateResult> {
  return requestJson<MihoyoQrCreateResult>('/api/auth/mihoyo/qr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
}

export async function pollMihoyoQr(ticket: string): Promise<MihoyoQrPollResult> {
  return requestJson<MihoyoQrPollResult>('/api/auth/mihoyo/qr/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket }),
  })
}

export async function fetchAuthMe(token: string): Promise<AuthUser> {
  return requestJson<AuthUser>('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function updateAuthProfile(
  token: string,
  payload: UpdateProfilePayload,
): Promise<AuthUser> {
  return requestJson<AuthUser>('/api/auth/me', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function uploadAuthImage(
  token: string,
  file: File,
  field: 'avatar' | 'banner' = 'avatar',
): Promise<{ url: string; filename: string; user: AuthUser }> {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('field', field)
  const response = await fetch('/api/auth/me/avatar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  const json = (await response.json()) as ApiResponse<{
    url: string
    filename: string
    user: AuthUser
  }>
  if (!response.ok || (json.code !== 200 && json.code !== 201)) {
    throw new ApiError(json.message || `上传失败: ${response.status}`, response.status)
  }
  return json.data
}

export async function logoutAuth(token: string): Promise<void> {
  await requestJson<null>('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function fetchAccountSecurity(token: string): Promise<AccountSecurity> {
  return requestJson<AccountSecurity>('/api/auth/security', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function sendPhoneCode(
  token: string,
  payload: { phone?: string; purpose?: 'bind' | 'password' },
): Promise<{ ok: boolean; expiresIn: number; cooldown: number; mockCode?: string }> {
  return requestJson('/api/auth/phone/send-code', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function bindPhone(
  token: string,
  payload: { phone: string; code: string },
): Promise<AccountSecurity> {
  return requestJson<AccountSecurity>('/api/auth/phone/bind', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function setPassword(
  token: string,
  payload: { password: string; oldPassword?: string; code?: string },
): Promise<AccountSecurity> {
  return requestJson<AccountSecurity>('/api/auth/password', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function loginWithPassword(
  phone: string,
  password: string,
): Promise<{ token: string; expiresAt?: number; user: AuthUser }> {
  return requestJson('/api/auth/login/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  })
}
