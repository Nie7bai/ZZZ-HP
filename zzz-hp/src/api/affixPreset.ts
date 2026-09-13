import { withAdminAuthHeaders } from '@/utils/adminAuth'

/**
 * 官方预设词条库（服务端）
 *
 * 口径（用户 2026-09-12 拍板）：官方预设的唯一来源＝数据库，管理员维护，用户侧只读。
 * 用户自己的词条库仍在 localStorage（`zzz-hp-affix-library`），不上服务器。
 * 见 `dev-docs/affix-optimizer-impl-log.md` 步骤 33 / 44。
 *
 * 读公开（进计算页就要拿）；写一律带管理员凭据 —— 用户侧「改不了」靠的是写接口鉴权，
 * 不是界面上藏按钮。
 *
 * 多套方案（步骤 44）：不带 `scheme` 读到的就是**默认方案** —— 用户侧走的就是这条路，
 * 所以用户侧不需要知道「方案」这个概念。
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

/** 一套方案的登记信息（管理页画 chip、新建时选「复制自哪套」都用它） */
export interface AffixPresetSchemeDoc {
  name: string
  isDefault: boolean
  sortOrder: number
  entryCount: number
}

export interface AffixPresetSnapshot {
  /** 这次读到的是哪套方案 */
  scheme: string
  /** 服务端现有全部方案 */
  schemes: AffixPresetSchemeDoc[]
  entries: AffixPresetEntryDoc[]
  groups: AffixPresetGroupDoc[]
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

/**
 * 管理端写接口的错误。
 *
 * 带上 `status` 与 `apiCode` 是为了让界面能分辨「会话过期」这类**该去登录**的失败 ——
 * 与 `api/calculatorBuffs.ts` 的 `CalculatorBuffApiError` 同一套形状（仓库既有约定）。
 */
export class AffixPresetApiError extends Error {
  status: number
  apiCode: string

  constructor(message: string, status: number, apiCode = '') {
    super(message)
    this.name = 'AffixPresetApiError'
    this.status = status
    this.apiCode = apiCode
  }
}

function readApiCode(data: unknown): string {
  if (!data || typeof data !== 'object' || !('code' in data)) return ''
  const code = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = withAdminAuthHeaders(init?.headers)
  const response = await fetch(input, { ...init, headers })
  let json: ApiResponse<T>
  try {
    json = (await response.json()) as ApiResponse<T>
  } catch {
    throw new AffixPresetApiError(`请求失败: ${response.status}`, response.status)
  }
  if (!response.ok || json.code !== 200) {
    throw new AffixPresetApiError(
      json.message || `请求失败: ${response.status}`,
      response.status,
      readApiCode(json.data),
    )
  }
  return json.data
}

/** 这次失败是不是「管理员会话无效」——界面据此弹「去登录」，而不是干瞪着一行红字 */
export function isAffixPresetAuthError(err: unknown): boolean {
  return (
    err instanceof AffixPresetApiError &&
    (err.status === 401 || err.apiCode === 'ADMIN_AUTH_REQUIRED')
  )
}

/**
 * 拉官方预设（条目 + 分组 + 方案清单）。
 *
 * 不传 `scheme` = 默认方案（用户侧就是这么调的）；管理页传具体方案名。
 * 失败由调用方决定回落策略，这里只抛错。
 */
export async function fetchAffixPreset(scheme?: string): Promise<AffixPresetSnapshot> {
  const query = scheme ? `?scheme=${encodeURIComponent(scheme)}` : ''
  return requestJson<AffixPresetSnapshot>(`/api/affix-preset${query}`)
}

/**
 * 整份替换**一套方案**的内容（管理页「保存」）。
 *
 * 事务提交：这套方案要么整份是新内容、要么维持原样，不会出现改了一半的中间状态。
 */
export async function replaceAffixPreset(snapshot: {
  scheme: string
  entries: AffixPresetEntryDoc[]
  groups: AffixPresetGroupDoc[]
}): Promise<AffixPresetSnapshot> {
  return requestJson<AffixPresetSnapshot>('/api/affix-preset', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
}

/** 新建方案：`copyFrom` 给了就整份复制那套方案，不给就是空方案 */
export async function createAffixPresetScheme(payload: {
  name: string
  copyFrom?: string
}): Promise<{ name: string; copiedFrom: string | null; entryCount: number; groupCount: number }> {
  return requestJson('/api/affix-preset/schemes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** 删除方案（默认方案服务端会拒绝） */
export async function deleteAffixPresetScheme(name: string): Promise<{ name: string }> {
  return requestJson(`/api/affix-preset/schemes/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
}

/**
 * 重命名方案（默认方案也能改 —— 服务端按 `is_default` 判默认，不看名字）。
 *
 * 名字是三张表的外键，所以服务端是一次事务里改完的；这里只负责发请求。
 */
export async function renameAffixPresetScheme(
  name: string,
  newName: string,
): Promise<{ name: string; renamedFrom: string; isDefault: boolean }> {
  return requestJson(`/api/affix-preset/schemes/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  })
}
