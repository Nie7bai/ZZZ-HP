import { clearAdminAuthenticated, getAdminToken, getOrCreateOcrClientId } from '@/utils/adminAuth'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface OcrQuotaInfo {
  month: string
  limit: number
  used: number
  remaining: number
  /** 未扣全站限制前的个人剩余（仅普通用户） */
  personalRemaining?: number
  scope?: 'user' | 'global'
  isAdmin?: boolean
  userLimit?: number
  globalLimit?: number
  globalUsed?: number
  globalRemaining?: number
}

export interface PanelOcrApiData {
  Response?: unknown
  TextDetections?: unknown[]
  RequestId?: string | null
  quota?: OcrQuotaInfo
}

export interface PanelOcrStatus {
  configured: boolean
  quota: OcrQuotaInfo
  isAdmin?: boolean
  /** status 接口是否真正请求成功（区别于「服务端未配置 OCR」） */
  ok?: boolean
}

const defaultUserQuota = (): OcrQuotaInfo => ({
  month: '',
  limit: 50,
  used: 0,
  remaining: 50,
  personalRemaining: 50,
  scope: 'user',
  globalLimit: 1000,
  globalUsed: 0,
  globalRemaining: 1000,
})

function normalizeQuota(raw: OcrQuotaInfo | undefined, isAdmin: boolean): OcrQuotaInfo {
  const base = raw ?? defaultUserQuota()
  if (isAdmin || base.scope === 'global') {
    return {
      month: base.month || '',
      limit: Number(base.limit) || 1000,
      used: Number(base.used) || 0,
      remaining: Math.max(0, Number(base.remaining) || 0),
      scope: 'global',
      isAdmin: true,
      userLimit: Number(base.userLimit) || 50,
      globalLimit: Number(base.globalLimit ?? base.limit) || 1000,
      globalUsed: Number(base.globalUsed ?? base.used) || 0,
      globalRemaining: Math.max(
        0,
        Number(base.globalRemaining ?? base.remaining) || 0,
      ),
    }
  }

  const userLimit = Number(base.limit) || 50
  const used = Number(base.used) || 0
  const personalRemaining =
    typeof base.personalRemaining === 'number'
      ? Math.max(0, base.personalRemaining)
      : Math.max(0, userLimit - used)
  const globalLimit = Number(base.globalLimit) || 1000
  const globalUsed = Number(base.globalUsed) || 0
  const globalRemaining =
    typeof base.globalRemaining === 'number'
      ? Math.max(0, base.globalRemaining)
      : Math.max(0, globalLimit - globalUsed)
  const remaining = Math.min(
    typeof base.remaining === 'number' ? Math.max(0, base.remaining) : personalRemaining,
    globalRemaining,
  )

  return {
    month: base.month || '',
    limit: userLimit,
    used,
    remaining,
    personalRemaining,
    scope: 'user',
    globalLimit,
    globalUsed,
    globalRemaining,
  }
}

function buildOcrHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  headers.set('X-OCR-Client-Id', getOrCreateOcrClientId())
  const token = getAdminToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
    headers.set('X-Admin-Token', token)
  }
  return headers
}

function withClientQuery(url: string): string {
  const id = encodeURIComponent(getOrCreateOcrClientId())
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}clientId=${id}`
}

export async function fetchPanelOcrStatus(): Promise<PanelOcrStatus> {
  try {
    const response = await fetch(withClientQuery('/api/ocr/status'), {
      headers: buildOcrHeaders(),
      cache: 'no-store',
    })
    const json = (await response.json()) as ApiResponse<PanelOcrStatus>
    if (!response.ok || json.code !== 200) {
      return { configured: false, quota: defaultUserQuota(), isAdmin: false, ok: false }
    }

    const isAdmin = Boolean(json.data?.isAdmin)
    // 本地仍留着失效 token 时，清掉以免前端误判
    if (getAdminToken() && !isAdmin) {
      clearAdminAuthenticated()
    }

    return {
      configured: Boolean(json.data?.configured),
      quota: normalizeQuota(json.data?.quota, isAdmin),
      isAdmin,
      ok: true,
    }
  } catch {
    return { configured: false, quota: defaultUserQuota(), isAdmin: false, ok: false }
  }
}

/** 上传面板截图到后端，走腾讯云 GeneralAccurateOCR（计入月额度） */
export async function recognizePanelViaTencentOcr(file: File): Promise<PanelOcrApiData> {
  const body = new FormData()
  body.append('image', file)
  body.append('clientId', getOrCreateOcrClientId())
  const response = await fetch(withClientQuery('/api/ocr/panel'), {
    method: 'POST',
    headers: buildOcrHeaders(),
    body,
    cache: 'no-store',
  })
  const json = (await response.json()) as ApiResponse<PanelOcrApiData> & {
    data?: { code?: string; quota?: OcrQuotaInfo }
  }
  if (!response.ok || json.code !== 200) {
    const err = new Error(json.message || `OCR 请求失败: ${response.status}`) as Error & {
      code?: string
      quota?: OcrQuotaInfo
    }
    err.code = (json.data as { code?: string } | null)?.code || String(json.code)
    err.quota = json.data?.quota
      ? normalizeQuota(json.data.quota, Boolean(json.data.quota.isAdmin || json.data.quota.scope === 'global'))
      : undefined
    throw err
  }
  const data = json.data
  if (data?.quota) {
    data.quota = normalizeQuota(
      data.quota,
      Boolean(data.quota.isAdmin || data.quota.scope === 'global'),
    )
  }
  return data
}
