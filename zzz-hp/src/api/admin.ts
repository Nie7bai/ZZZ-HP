import type { DefenseMonsterCategory, RecordScheme } from '@/types/admin'
import { withAdminAuthHeaders } from '@/utils/adminAuth'

interface ApiResult<T> {
  code: number
  message: string
  data: T
  error?: string
}

export interface CreateBossPayload {
  recordScheme?: RecordScheme
  mode?: 'crisis' | 'defense' | 'deduction'
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
  stagger_multiplier?: number | null
  /** 危局当期绑定的场地 Buff 套 id */
  field_buff_set_id?: string | null
}

export interface CreateBuffPayload {
  recordScheme?: RecordScheme
  mode?: 'crisis' | 'defense' | 'deduction'
  id?: number
  version: string
  phase: string
  buff_name: string
  buff?: string | null
  buff_image?: string | null
  /** 计算器结构化效果块 */
  effect_blocks?: unknown[] | null
  stage?: number
  roomInStage?: number
  buffIndex?: number
}

export interface CreateBuffResult {
  id: number
  action?: 'created' | 'updated'
  reusedFromName?: boolean
}

export interface BuffNameTemplate {
  name: string
  desc: string | null
  buff_image: string | null
  effect_blocks?: import('@/types/calculator').BuffEffectBlock[] | null
}

export interface UploadImageResult {
  url: string
  filename: string
  stable?: boolean
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
  field_buff_sets?: Array<{
    id: string
    label?: string | null
    name: string
    text?: string
    image?: string | null
    effectBlocks?: unknown[] | null
  }> | null
  field_buff_name?: string | null
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
  stagger_multiplier?: number | null
  field_buff_set_id?: string | null
}

export interface BuffRecord {
  id: number
  version: string
  phase: string
  buff_name: string
  buff: string | null
  buff_image: string | null
  effect_blocks?: import('@/types/calculator').BuffEffectBlock[] | null
  mode?: 'crisis' | 'defense' | 'deduction' | string | null
}

export type BuffTableMode = 'crisis' | 'defense' | 'deduction'

export interface BuffTableSnapshotRow {
  id: number
  version: string
  phase: string
  buffName: string
  buff: string | null
  buffImage: string | null
  effectBlocks?: import('@/types/calculator').BuffEffectBlock[] | null
  mode: BuffTableMode | string
}

export interface BuffTableSnapshot {
  kind?: string
  version?: number
  exportedAt?: string
  modeFilter?: BuffTableMode | null
  count: number
  byMode?: Record<string, number>
  rows: BuffTableSnapshotRow[]
}

export interface BuffTableImportSummary {
  total: number
  inserted: number
  updated: number
  skipped: number
  replaced: boolean
  modeFilter: BuffTableMode | null
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

export async function uploadBossImage(
  file: File,
  opts: { bossName?: string; id?: string | number } = {},
) {
  const formData = new FormData()
  if (opts.bossName?.trim()) formData.append('bossName', opts.bossName.trim())
  if (opts.id != null && String(opts.id).trim()) formData.append('id', String(opts.id).trim())
  formData.append('image', file)

  const response = await fetch('/api/upload/boss', {
    method: 'POST',
    headers: withAdminAuthHeaders(),
    body: formData,
  })

  return parseResponse<UploadImageResult>(response)
}

export async function uploadBuffImage(
  file: File,
  opts: { buffName?: string; id?: string | number } = {},
) {
  const formData = new FormData()
  if (opts.id != null && String(opts.id).trim()) formData.append('id', String(opts.id).trim())
  if (opts.buffName?.trim()) formData.append('buffName', opts.buffName.trim())
  formData.append('image', file)

  const response = await fetch('/api/upload/buff', {
    method: 'POST',
    headers: withAdminAuthHeaders(),
    body: formData,
  })

  return parseResponse<UploadImageResult>(response)
}

export async function uploadCalculatorImage(file: File) {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch('/api/upload/calculator', {
    method: 'POST',
    headers: withAdminAuthHeaders(),
    body: formData,
  })

  return parseResponse<UploadImageResult>(response)
}

export type CalculatorPublicAvatarKind = 'agent' | 'wengine' | 'drive_disc' | 'bangboo'

export async function uploadCalculatorPublicImage(
  file: File,
  kind: CalculatorPublicAvatarKind,
  entityId: string,
) {
  const formData = new FormData()
  formData.append('image', file)
  const query = new URLSearchParams({ kind, entityId: entityId.trim() })

  const response = await fetch(`/api/upload/calculator-public?${query}`, {
    method: 'POST',
    headers: withAdminAuthHeaders(),
    body: formData,
  })

  return parseResponse<UploadImageResult>(response)
}

/** 将旧 calculator_image 等路径迁到 /character/{id}.webp 固定路径 */
export async function ensureCalculatorPublicAvatar(
  kind: CalculatorPublicAvatarKind,
  entityId: string,
  url: string,
) {
  const query = new URLSearchParams({ kind, entityId: entityId.trim() })
  const response = await fetch(`/api/upload/calculator-public/ensure?${query}`, {
    method: 'POST',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url }),
  })
  return parseResponse<{ url: string; action: string }>(response)
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
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })

  return parseResponse<CreateBossResult>(response)
}

export async function createBuff(payload: CreateBuffPayload) {
  const response = await fetch('/api/buff', {
    method: 'POST',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
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
  const response = await fetch(`/api/boss/${id}`, {
    method: 'DELETE',
    headers: withAdminAuthHeaders(),
  })
  return parseResponse<{ id: number }>(response)
}

export async function searchBuffRecords(params: AdminSearchParams = {}) {
  const query = buildSearchQuery(params)
  const response = await fetch(`/api/buff/search${query ? `?${query}` : ''}`)
  return parseResponse<BuffRecord[]>(response)
}

export async function fetchBuffNameTemplates(recordScheme?: RecordScheme) {
  const query = recordScheme ? `?recordScheme=${encodeURIComponent(recordScheme)}` : ''
  const response = await fetch(`/api/buff/templates${query}`)
  return parseResponse<BuffNameTemplate[]>(response)
}

export async function fetchBuffTableSnapshot(mode?: BuffTableMode | null) {
  const query = new URLSearchParams()
  if (mode) query.set('mode', mode)
  const qs = query.toString()
  const response = await fetch(`/api/buff/export${qs ? `?${qs}` : ''}`, {
    headers: withAdminAuthHeaders(),
  })
  return parseResponse<BuffTableSnapshot>(response)
}

export async function importBuffTableSnapshotFile(
  file: File,
  options?: { replace?: boolean; mode?: BuffTableMode | null },
) {
  const form = new FormData()
  form.append('file', file)
  const query = new URLSearchParams()
  if (options?.replace) query.set('replace', '1')
  if (options?.mode) query.set('mode', options.mode)
  const qs = query.toString()
  const response = await fetch(`/api/buff/import${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    headers: withAdminAuthHeaders(),
    body: form,
  })
  return parseResponse<BuffTableImportSummary>(response)
}

export async function deleteBuffRecord(id: number) {
  const response = await fetch(`/api/buff/${id}`, {
    method: 'DELETE',
    headers: withAdminAuthHeaders(),
  })
  return parseResponse<{ id: number; buff_name?: string; mode?: string; cleanedNodes?: number }>(
    response,
  )
}

export type SeasonDateMode = 'crisis' | 'defense' | 'deduction'

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
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return parseResponse<SeasonDateRecord>(response)
}

export async function updateSeasonDate(id: number, payload: SeasonDatePayload) {
  const response = await fetch(`/api/season-dates/${id}`, {
    method: 'PUT',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return parseResponse<SeasonDateRecord>(response)
}

export async function deleteSeasonDate(id: number) {
  const response = await fetch(`/api/season-dates/${id}`, {
    method: 'DELETE',
    headers: withAdminAuthHeaders(),
  })
  return parseResponse<{ id: number }>(response)
}

export interface SeasonContentPreview {
  version: string
  phase: string
  scheme: RecordScheme
  bossCount: number
  buffCount: number
  dateCount: number
  pendingCleanup?: boolean
  deletedAt?: string | null
  warnings?: string[]
  canSoftDelete?: boolean
  canRestore?: boolean
  canCleanup?: boolean
}

export interface SeasonContentSoftDeleteResult {
  version: string
  phase: string
  scheme: RecordScheme
  action: 'soft_deleted' | 'already_soft_deleted'
  bossCount: number
  buffCount: number
  dateCount: number
  pendingCleanup: boolean
  deletedAt?: string | null
}

export interface SeasonContentRestoreResult {
  version: string
  phase: string
  scheme: RecordScheme
  action: 'restored'
  bossCount: number
  buffCount: number
  dateCount: number
  pendingCleanup: boolean
  deletedAt?: string | null
}

export interface SeasonContentCleanupResult {
  version: string
  phase: string
  scheme: RecordScheme
  bossesDeleted: number
  buffsDeleted: number
  datesDeleted: number
  alsoDeleteDates: boolean
  action: 'cleaned'
}

/** @deprecated 兼容旧调用 */
export type SeasonContentPurgeResult = SeasonContentSoftDeleteResult | SeasonContentCleanupResult

export async function previewSeasonContent(payload: {
  scheme: RecordScheme
  version: string
  phase: string
}) {
  const response = await fetch('/api/admin/season-content/preview', {
    method: 'POST',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return parseResponse<SeasonContentPreview>(response)
}

export async function softDeleteSeasonContent(payload: {
  scheme: RecordScheme
  version: string
  phase: string
  confirmText: string
}) {
  const response = await fetch('/api/admin/season-content/soft-delete', {
    method: 'POST',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return parseResponse<SeasonContentSoftDeleteResult>(response)
}

export async function restoreSeasonContent(payload: {
  scheme: RecordScheme
  version: string
  phase: string
  confirmText: string
}) {
  const response = await fetch('/api/admin/season-content/restore', {
    method: 'POST',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return parseResponse<SeasonContentRestoreResult>(response)
}

export async function cleanupSeasonContent(payload: {
  scheme: RecordScheme
  version: string
  phase: string
  alsoDeleteDates?: boolean
  confirmText: string
}) {
  const response = await fetch('/api/admin/season-content/cleanup', {
    method: 'POST',
    headers: withAdminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return parseResponse<SeasonContentCleanupResult>(response)
}

/** @deprecated 请改用 softDeleteSeasonContent */
export async function purgeSeasonContent(payload: {
  scheme: RecordScheme
  version: string
  phase: string
  alsoDeleteDates?: boolean
  confirmText: string
}) {
  return softDeleteSeasonContent({
    scheme: payload.scheme,
    version: payload.version,
    phase: payload.phase,
    confirmText: payload.confirmText,
  })
}
