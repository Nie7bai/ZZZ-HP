import { withAdminAuthHeaders } from '@/utils/adminAuth'

export interface BossInfoFieldBuffSet {
  id: string
  label?: string | null
  name: string
  text?: string
  image?: string | null
  effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
}

export interface BossInfoRecord {
  id: number
  boss_name: string
  defense: number
  level: number
  boss_image: string | null
  weakness: string | null
  resistance: string | null
  crisis_base_hp?: number | null
  stagger_multiplier?: number | null
  field_buff_name?: string | null
  field_buff_text?: string | null
  field_buff_image?: string | null
  field_buff_effect_blocks?: import('@/types/calculator').BuffEffectBlock[] | null
  field_buff_sets?: BossInfoFieldBuffSet[] | null
}

export interface BossInfoListResult {
  items: BossInfoRecord[]
  total: number
  limit: number
  offset: number
  catalog?: BossInfoCatalog
}

export type BossInfoCatalog = 'all' | 'crisis' | 'defense' | 'deduction'

interface ApiResult<T> {
  code: number
  message: string
  data: T
  error?: string
}

function extractApiErrorDetail(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  if ('error' in data && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error
  }
  return ''
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiResult<T>
  const isSuccessCode = body.code >= 200 && body.code < 300
  if (!response.ok || !isSuccessCode) {
    const detail = extractApiErrorDetail(body.data)
    throw new Error(detail ? `${body.message}：${detail}` : body.message || '请求失败')
  }
  return body.data
}

export async function lookupBossInfo(bossName: string) {
  const query = new URLSearchParams({ boss_name: bossName.trim() })
  const response = await fetch(`/api/boss-info/lookup?${query}`)
  return parseResponse<BossInfoRecord | null>(response)
}

export async function searchBossInfoNames(keyword: string, limit = 20) {
  const query = new URLSearchParams()
  if (keyword.trim()) query.set('q', keyword.trim())
  query.set('limit', String(limit))
  const response = await fetch(`/api/boss-info/search?${query}`)
  return parseResponse<string[]>(response)
}

export async function fetchBossInfoList(params: {
  keyword?: string
  limit?: number
  offset?: number
  catalog?: BossInfoCatalog
} = {}) {
  const query = new URLSearchParams()
  if (params.keyword?.trim()) query.set('q', params.keyword.trim())
  if (params.limit != null) query.set('limit', String(params.limit))
  if (params.offset != null) query.set('offset', String(params.offset))
  if (params.catalog && params.catalog !== 'all') query.set('catalog', params.catalog)
  const suffix = query.toString()
  const response = await fetch(`/api/boss-info/list${suffix ? `?${suffix}` : ''}`)
  return parseResponse<BossInfoListResult>(response)
}

export async function updateBossInfoRecord(
  id: number,
  payload: Partial<Omit<BossInfoRecord, 'id'>>,
) {
  const response = await fetch(`/api/boss-info/${id}`, {
    method: 'PUT',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return parseResponse<BossInfoRecord>(response)
}

export async function deleteBossInfoRecord(id: number) {
  const response = await fetch(`/api/boss-info/${id}`, {
    method: 'DELETE',
    headers: withAdminAuthHeaders(),
  })
  return parseResponse<{
    action: 'deleted'
    id: number
    boss_name: string
    referenced_count: number
  }>(response)
}

export interface BossInfoSnapshotRow {
  id: number
  bossName: string
  defense: number
  level: number
  bossImage: string | null
  weakness: string | null
  resistance: string | null
  crisisBaseHp: number | null
  staggerMultiplier: number
  fieldBuffSets?: BossInfoFieldBuffSet[]
  fieldBuffName?: string | null
  fieldBuffText?: string | null
  fieldBuffImage?: string | null
  fieldBuffEffectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
}

export interface BossInfoSnapshot {
  kind?: string
  version?: number
  exportedAt?: string
  count: number
  rows: BossInfoSnapshotRow[]
}

export interface BossInfoImportSummary {
  total: number
  inserted: number
  updated: number
  skipped: number
  replaced: boolean
}

export interface BossInfoFromBossSyncResult {
  mode: BossInfoCatalog | null
  scanned: number
  created: number
  updatedImage: number
  unchanged: number
}

export async function fetchBossInfoSnapshot() {
  const response = await fetch('/api/boss-info/export', {
    headers: withAdminAuthHeaders(),
  })
  return parseResponse<BossInfoSnapshot>(response)
}

export async function importBossInfoSnapshotFile(file: File, options?: { replace?: boolean }) {
  const form = new FormData()
  form.append('file', file)
  const query = new URLSearchParams()
  if (options?.replace) query.set('replace', '1')
  const qs = query.toString()
  const response = await fetch(`/api/boss-info/import${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    headers: withAdminAuthHeaders(),
    body: form,
  })
  return parseResponse<BossInfoImportSummary>(response)
}

export async function syncBossInfoFromBoss(mode?: Exclude<BossInfoCatalog, 'all'> | null) {
  const response = await fetch('/api/boss-info/sync-from-boss', {
    method: 'POST',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mode: mode || null }),
  })
  return parseResponse<BossInfoFromBossSyncResult>(response)
}

