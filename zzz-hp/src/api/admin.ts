import type { DefenseMonsterCategory, RecordScheme } from '@/types/admin'

interface ApiResult<T> {
  code: number
  message: string
  data: T
  error?: string
}

export interface CreateBossPayload {
  recordScheme?: RecordScheme
  id?: number
  version: string
  phase: string
  boss_name: string
  hp?: number
  defense?: number
  level?: number
  room?: string | null
  weakness?: string | null
  resistance?: string | null
  boss_image?: string | null
  stage?: number
  roomInStage?: number
  wave?: number
  monsterCategory?: DefenseMonsterCategory
  monsterSubType?: number
  count?: number
  crisis_base_hp?: number
  hp_coeff_percent?: number
  hp_coeff_manual?: boolean
}

export interface CreateBuffPayload {
  recordScheme?: RecordScheme
  id?: number
  version: string
  phase: string
  buff_name: string
  buff?: string | null
  buff_image?: string | null
  stage?: number
  roomInStage?: number
  buffIndex?: number
}

export interface CreateBuffResult {
  id: number
  action?: 'created' | 'updated'
}

export interface UploadImageResult {
  url: string
  filename: string
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
}

export interface BossInfoSyncResult {
  action: 'created' | 'updated' | 'unchanged'
  id: number
  boss_name: string
  defense: number
  level: number
  boss_image: string | null
  weakness: string | null
  resistance: string | null
}

export interface CreateBossResult {
  id: number
  action?: 'created' | 'updated'
  bossInfoSync?: BossInfoSyncResult
}

export interface BossRecord {
  id: number
  version: string
  phase: string
  boss_name: string
  hp: number
  defense: number
  level: number
  room: string | null
  weakness: string | null
  resistance: string | null
  boss_image: string | null
}

export interface BuffRecord {
  id: number
  version: string
  phase: string
  buff_name: string
  buff: string | null
  buff_image: string | null
}

export interface AdminSearchParams {
  version?: string
  phase?: string
  keyword?: string
  limit?: number
  recordScheme?: RecordScheme
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

export async function uploadBossImage(file: File) {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch('/api/upload/boss', {
    method: 'POST',
    body: formData,
  })

  return parseResponse<UploadImageResult>(response)
}

export async function uploadBuffImage(file: File) {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch('/api/upload/buff', {
    method: 'POST',
    body: formData,
  })

  return parseResponse<UploadImageResult>(response)
}

export async function uploadCalculatorImage(file: File) {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch('/api/upload/calculator', {
    method: 'POST',
    body: formData,
  })

  return parseResponse<UploadImageResult>(response)
}

export async function lookupBossInfo(bossName: string) {
  const query = bossName.trim()
  if (!query) return null

  const response = await fetch(`/api/boss-info/lookup?boss_name=${encodeURIComponent(query)}`)
  return parseResponse<BossInfoRecord | null>(response)
}

export async function searchBossInfoNames(keyword: string) {
  const query = keyword.trim()
  if (!query) return []

  const response = await fetch(`/api/boss-info/search?q=${encodeURIComponent(query)}`)
  return parseResponse<string[]>(response)
}

export async function createBoss(payload: CreateBossPayload) {
  const response = await fetch('/api/boss', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  return parseResponse<CreateBossResult>(response)
}

export async function createBuff(payload: CreateBuffPayload) {
  const response = await fetch('/api/buff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  return parseResponse<CreateBuffResult>(response)
}

function buildSearchQuery(params: AdminSearchParams) {
  const query = new URLSearchParams()
  if (params.version?.trim()) query.set('version', params.version.trim())
  if (params.phase?.trim()) query.set('phase', params.phase.trim())
  if (params.keyword?.trim()) query.set('q', params.keyword.trim())
  if (params.limit) query.set('limit', String(params.limit))
  if (params.recordScheme) query.set('recordScheme', params.recordScheme)
  return query.toString()
}

export async function searchBossRecords(params: AdminSearchParams = {}) {
  const query = buildSearchQuery(params)
  const response = await fetch(`/api/boss/search${query ? `?${query}` : ''}`)
  return parseResponse<BossRecord[]>(response)
}

export async function deleteBossRecord(id: number) {
  const response = await fetch(`/api/boss/${id}`, { method: 'DELETE' })
  return parseResponse<{ id: number }>(response)
}

export async function searchBuffRecords(params: AdminSearchParams = {}) {
  const query = buildSearchQuery(params)
  const response = await fetch(`/api/buff/search${query ? `?${query}` : ''}`)
  return parseResponse<BuffRecord[]>(response)
}

export async function deleteBuffRecord(id: number) {
  const response = await fetch(`/api/buff/${id}`, { method: 'DELETE' })
  return parseResponse<{ id: number }>(response)
}

export type SeasonDateMode = 'crisis' | 'defense'

export interface SeasonDateRecord {
  id: number
  mode: SeasonDateMode
  version: string
  phase: string
  startDate: string | null
  endDate: string | null
}

export interface SeasonDatePayload {
  mode: SeasonDateMode
  version: string
  phase: string
  startDate: string
  endDate: string
}

export async function fetchSeasonDates(mode: SeasonDateMode) {
  const response = await fetch(`/api/season-dates?mode=${mode}`)
  return parseResponse<SeasonDateRecord[]>(response)
}

export async function createSeasonDate(payload: SeasonDatePayload) {
  const response = await fetch('/api/season-dates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseResponse<SeasonDateRecord>(response)
}

export async function updateSeasonDate(id: number, payload: SeasonDatePayload) {
  const response = await fetch(`/api/season-dates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return parseResponse<SeasonDateRecord>(response)
}

export async function deleteSeasonDate(id: number) {
  const response = await fetch(`/api/season-dates/${id}`, { method: 'DELETE' })
  return parseResponse<{ id: number }>(response)
}
