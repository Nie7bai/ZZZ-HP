import { withAdminAuthHeaders } from '@/utils/adminAuth'

/**
 * 官方预设词条库（服务端）
 *
 * 口径（用户 2026-09-12 拍板）：官方预设的唯一来源＝数据库，管理员维护，用户侧只读。
 * 用户自己的词条库仍在 localStorage（`zzz-hp-affix-library`），不上服务器。
 * 见 `dev-docs/affix-optimizer-impl-log.md` 步骤 33。
 *
 * 读公开（进计算页就要拿）；写一律带管理员凭据 —— 用户侧「改不了」靠的是写接口鉴权，
 * 不是界面上藏按钮。
 */

/** 服务端返回的条目形状（比前端 `AffixLibraryEntry` 多 `sortOrder` / `raw`） */
export interface AffixPresetEntryDoc {
  id: string
  label: string
  target: string
  perRoll: number
  cap: number
  group: string
  rollCost: number
  enabledByDefault: boolean
  sortOrder?: number
  raw?: Record<string, unknown> | null
}

export interface AffixPresetGroupDoc {
  name: string
  cap: number
  sortOrder?: number
  raw?: Record<string, unknown> | null
}

export interface AffixPresetSnapshot {
  entries: AffixPresetEntryDoc[]
  groups: AffixPresetGroupDoc[]
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = withAdminAuthHeaders(init?.headers)
  const response = await fetch(input, { ...init, headers })
  let json: ApiResponse<T>
  try {
    json = (await response.json()) as ApiResponse<T>
  } catch {
    throw new Error(`请求失败: ${response.status}`)
  }
  if (!response.ok || json.code !== 200) {
    throw new Error(json.message || `请求失败: ${response.status}`)
  }
  return json.data
}

/** 拉官方预设（条目 + 分组）。失败由调用方决定回落策略，这里只抛错。 */
export async function fetchAffixPreset(): Promise<AffixPresetSnapshot> {
  return requestJson<AffixPresetSnapshot>('/api/affix-preset')
}

export async function saveAffixPresetEntry(
  doc: AffixPresetEntryDoc,
): Promise<AffixPresetEntryDoc> {
  return requestJson<AffixPresetEntryDoc>('/api/affix-preset/entries', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteAffixPresetEntry(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/affix-preset/entries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveAffixPresetGroup(
  doc: AffixPresetGroupDoc,
): Promise<AffixPresetGroupDoc> {
  return requestJson<AffixPresetGroupDoc>('/api/affix-preset/groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteAffixPresetGroup(name: string): Promise<void> {
  await requestJson<{ name: string }>(
    `/api/affix-preset/groups/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
}

/** 整份替换（灌种子 / 管理端导入） */
export async function replaceAffixPreset(
  snapshot: AffixPresetSnapshot,
): Promise<AffixPresetSnapshot> {
  return requestJson<AffixPresetSnapshot>('/api/affix-preset', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
}
