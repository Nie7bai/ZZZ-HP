export type SiteInfoPanelId = 'about' | 'features' | 'credits' | 'legal'

export interface SiteInfoSection {
  panelKey: SiteInfoPanelId
  title: string
  content: string
  updatedAt?: string
}

export interface SiteInfoSectionPayload {
  title: string
  content: string
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const json = (await response.json()) as ApiResponse<T>
  if (!response.ok || json.code !== 200) {
    throw new Error(json.message || `请求失败: ${response.status}`)
  }
  return json.data
}

export async function fetchSiteInfoSections(): Promise<SiteInfoSection[]> {
  return requestJson<SiteInfoSection[]>('/api/site-info')
}

export async function updateSiteInfoSection(
  panelKey: SiteInfoPanelId,
  payload: SiteInfoSectionPayload,
): Promise<SiteInfoSection> {
  return requestJson<SiteInfoSection>(`/api/site-info/${panelKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export const SITE_INFO_PANEL_LABELS: Record<SiteInfoPanelId, string> = {
  about: '关于本站',
  features: '网站内容',
  credits: '借鉴与参考',
  legal: '版权声明',
}

export const SITE_INFO_PANEL_ORDER: SiteInfoPanelId[] = [
  'about',
  'features',
  'credits',
  'legal',
]
