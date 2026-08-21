import { withAdminAuthHeaders } from '@/utils/adminAuth'

interface ApiResult<T> {
  code: number
  message: string
  data: T
}

export class SeasonSnapshotApiError extends Error {
  status: number
  apiCode: string

  constructor(message: string, status: number, apiCode = '') {
    super(message)
    this.name = 'SeasonSnapshotApiError'
    this.status = status
    this.apiCode = apiCode
  }
}

export type SeasonSnapshotScheme = 'crisis' | 'defense'
export type SeasonSnapshotVariant = 'old' | 'new'

export interface SeasonSnapshotSeason {
  version: string
  phase: string
  bossCount: number
  buffCount: number
  dateCount: number
}

export interface SeasonSnapshotBoss {
  id: number
  version: string
  phase: string
  boss_name: string
  hp: number
  hp_coeff_percent: number | null
  defense: number
  level: number
  room: string | null
  weakness: string | null
  resistance: string | null
  boss_image: string | null
  stagger_multiplier: number | null
}

export interface SeasonSnapshotBuff {
  id: number
  version: string
  phase: string
  buff_name: string
  buff: string | null
  buff_image: string | null
  effect_blocks: unknown[] | null
}

export interface SeasonSnapshotDate {
  mode: SeasonSnapshotScheme
  version: string
  phase: string
  startDate: string | null
  endDate: string | null
}

export interface SeasonSnapshotBossInfo {
  boss_name: string
  defense: number
  level: number
  weakness: string | null
  resistance: string | null
  boss_image: string | null
  crisis_base_hp: number | null
  stagger_multiplier: number | null
  field_buff_name: string | null
  field_buff_text: string | null
  field_buff_image: string | null
  field_buff_effect_blocks: unknown[] | null
}

export interface SeasonSnapshotData {
  kind: string
  scheme: SeasonSnapshotScheme
  variant: SeasonSnapshotVariant | null
  exportedAt?: string
  seasons: SeasonSnapshotSeason[]
  bosses: SeasonSnapshotBoss[]
  buffs: SeasonSnapshotBuff[]
  dates: SeasonSnapshotDate[]
  bossInfos: SeasonSnapshotBossInfo[]
}

export interface SeasonSnapshotImportTypeResult {
  created: number
  updated: number
  skipped: number
  errors: { id: string; message: string }[]
}

export interface SeasonSnapshotImportSummary {
  scheme: SeasonSnapshotScheme
  bosses: SeasonSnapshotImportTypeResult
  buffs: SeasonSnapshotImportTypeResult
  dates: SeasonSnapshotImportTypeResult
  bossInfos: SeasonSnapshotImportTypeResult
}

function readApiCode(data: unknown): string {
  if (!data || typeof data !== 'object' || !('code' in data)) return ''
  const code = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: withAdminAuthHeaders(init?.headers),
  })
  let json: ApiResult<T>
  try {
    json = (await response.json()) as ApiResult<T>
  } catch {
    throw new SeasonSnapshotApiError(`请求失败: ${response.status}`, response.status)
  }
  if (!response.ok || json.code < 200 || json.code >= 300) {
    throw new SeasonSnapshotApiError(
      json.message || `请求失败: ${response.status}`,
      response.status,
      readApiCode(json.data),
    )
  }
  return json.data
}

export function isSeasonSnapshotAuthError(err: unknown): boolean {
  return (
    err instanceof SeasonSnapshotApiError &&
    (err.status === 401 || err.apiCode === 'ADMIN_AUTH_REQUIRED')
  )
}

export async function fetchSeasonSnapshot(
  scheme: SeasonSnapshotScheme,
  variant?: SeasonSnapshotVariant | null,
): Promise<SeasonSnapshotData> {
  const query = new URLSearchParams({ scheme })
  if (scheme === 'defense' && variant) query.set('variant', variant)
  return requestJson<SeasonSnapshotData>(`/api/admin/season-content/export?${query}`)
}

export async function importSeasonSnapshotFile(file: File): Promise<SeasonSnapshotImportSummary> {
  const form = new FormData()
  form.append('file', file)
  return requestJson<SeasonSnapshotImportSummary>('/api/admin/season-content/import', {
    method: 'POST',
    body: form,
  })
}
