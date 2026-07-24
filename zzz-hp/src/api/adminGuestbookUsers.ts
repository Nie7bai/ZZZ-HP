import { getAdminToken } from '@/utils/adminAuth'

export interface AdminGuestbookUser {
  id: number
  mihoyoAid: string
  mihoyoMid: string
  nickname: string
  avatar: string
  bio: string
  banner: string
  phone: string
  hasPhone: boolean
  hasPassword: boolean
  profilePublicSocial: boolean
  isBanned: boolean
  bannedAt?: string | null
  banUntil?: string | null
  banReason: string
  isSiteAdmin?: boolean
  isGuestbookModerator: boolean
  stats: {
    postCount: number
    commentCount: number
    totalViews: number
  }
  createdAt: string
  updatedAt?: string
}

export interface AdminGuestbookUserList {
  total: number
  limit: number
  offset: number
  users: AdminGuestbookUser[]
}

export interface AdminGuestbookUserPatch {
  nickname?: string
  bio?: string
  avatar?: string
  banner?: string
  profilePublicSocial?: boolean
  isSiteAdmin?: boolean
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

function withAdminHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const token = getAdminToken()
  if (!token) return headers
  return { ...headers, 'X-Admin-Token': token }
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const json = (await response.json()) as ApiResponse<T>
  if (!response.ok || json.code !== 200) {
    throw new Error(json.message || `请求失败: ${response.status}`)
  }
  return json.data
}

export async function fetchAdminGuestbookUsers(params: {
  q?: string
  banned?: '' | '0' | '1'
  limit?: number
  offset?: number
} = {}): Promise<AdminGuestbookUserList> {
  const query = new URLSearchParams()
  if (params.q?.trim()) query.set('q', params.q.trim())
  if (params.banned) query.set('banned', params.banned)
  if (params.limit != null) query.set('limit', String(params.limit))
  if (params.offset != null) query.set('offset', String(params.offset))
  const qs = query.toString()
  return requestJson<AdminGuestbookUserList>(`/api/admin/guestbook-users${qs ? `?${qs}` : ''}`, {
    headers: withAdminHeaders(),
  })
}

export async function updateAdminGuestbookUser(
  id: number,
  patch: AdminGuestbookUserPatch,
): Promise<AdminGuestbookUser> {
  return requestJson<AdminGuestbookUser>(`/api/admin/guestbook-users/${id}`, {
    method: 'PATCH',
    headers: withAdminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(patch),
  })
}

export async function setAdminGuestbookUserBanned(
  id: number,
  banned: boolean,
  reason = '',
  durationHours: number | null = null,
): Promise<AdminGuestbookUser> {
  return requestJson<AdminGuestbookUser>(`/api/admin/guestbook-users/${id}/ban`, {
    method: 'PATCH',
    headers: withAdminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ banned, reason, durationHours }),
  })
}
