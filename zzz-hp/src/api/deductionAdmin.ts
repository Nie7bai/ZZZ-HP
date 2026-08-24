import { withAdminAuthHeaders } from '@/utils/adminAuth'

interface ApiResult<T> {
  code: number
  message: string
  data: T
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: withAdminAuthHeaders(init?.headers),
  })
  const json = (await response.json()) as ApiResult<T>
  if (!response.ok || json.code < 200 || json.code >= 300) {
    throw new Error(json.message || `请求失败: ${response.status}`)
  }
  return json.data
}

export interface AdminDeductionPeriod {
  version: string
  phase: string
  periodName: string | null
  nodeCount: number
}

export interface AdminDeductionMonster {
  name: string
  hp: number
  defense: number
  level: number
  weakness: string | null
  resistance: string | null
  /** 管理端选中候选时写入的本地 Boss 图片路径（/boss_image/...），可能为空 */
  boss_image?: string | null
}

export interface AdminDeductionLayer {
  name: string
  monsters: AdminDeductionMonster[]
  /** 是否 Boss 关：true=Boss 层（危局数据源），false/缺省=小怪层（shiyu 数据源） */
  isBoss?: boolean
}

export interface AdminDeductionBuff {
  title: string
  desc: string | null
  /** 管理端选中候选时写入的本地 Buff 图片路径（/buff_image/...），可能为空 */
  buff_image?: string | null
}

export interface AdminDeductionNode {
  id: number
  version: string
  phase: string
  nodeId: string
  name: string
  type: number
  prevNode: string | null
  storyText: string | null
  /** 剧情选项（nanoka story_event.choice）：{ name, desc } */
  storyOptions?: { name: string; desc: string | null }[]
  layers: AdminDeductionLayer[]
  buffs: AdminDeductionBuff[]
  sortOrder: number
  periodName: string | null
}

// 下拉数据源（全局去重）
export interface AdminPickBoss {
  name: string
  level: number
  hp: number
  defense: number
  weakness: string | null
  resistance: string | null
  boss_image: string | null
}

export interface AdminPickBuff {
  name: string
  desc: string | null
  buff_image: string | null
}

/** 管理端新增后自动进入编辑状态的定位目标 */
export type AdminEditFocus =
  | { kind: 'monster'; layer: number; index: number }
  | { kind: 'buff'; index: number }
  | { kind: 'storyOption'; index: number }

export async function fetchDeductionPickBosses(): Promise<AdminPickBoss[]> {
  return request('/api/admin/deduction/picker/bosses')
}

export async function fetchDeductionPickBuffs(): Promise<AdminPickBuff[]> {
  return request('/api/admin/deduction/picker/buffs')
}

/** shiyu 小怪数据源（推演非 STAGE 小怪层编辑使用） */
export async function fetchDeductionShiyuMinions(): Promise<AdminPickBoss[]> {
  return request('/api/admin/deduction/picker/shiyu-minions')
}

// 期数
export async function fetchDeductionAdminPeriods(): Promise<AdminDeductionPeriod[]> {
  return request('/api/admin/deduction/periods')
}

export async function createDeductionAdminPeriod(payload: {
  version: string
  phase?: string
  periodName?: string
}): Promise<AdminDeductionPeriod> {
  return request('/api/admin/deduction/periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function renameDeductionAdminPeriod(
  version: string,
  periodName: string,
): Promise<{ version: string; periodName: string | null }> {
  return request(`/api/admin/deduction/periods/${encodeURIComponent(version)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ periodName }),
  })
}

export async function deleteDeductionAdminPeriod(version: string): Promise<{ version: string }> {
  return request(`/api/admin/deduction/periods/${encodeURIComponent(version)}`, {
    method: 'DELETE',
  })
}

// 节点
export async function fetchDeductionAdminNodes(version: string): Promise<AdminDeductionNode[]> {
  return request(`/api/admin/deduction/periods/${encodeURIComponent(version)}/nodes`)
}

export async function createDeductionAdminNode(
  version: string,
  payload: {
    phase?: string
    name: string
    type: number
    storyText?: string | null
    layers?: AdminDeductionNode['layers']
    buffs?: AdminDeductionNode['buffs']
  },
): Promise<{ id: number; nodeId: string; sortOrder: number }> {
  return request(`/api/admin/deduction/periods/${encodeURIComponent(version)}/nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateDeductionAdminNode(
  id: number,
  payload: {
    name: string
    type: number
    storyText?: string | null
    storyOptions?: { name: string; desc: string | null }[]
    layers?: AdminDeductionNode['layers']
    buffs?: AdminDeductionNode['buffs']
    sortOrder?: number
  },
): Promise<{ id: number }> {
  return request(`/api/admin/deduction/nodes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteDeductionAdminNode(id: number): Promise<{ id: number }> {
  return request(`/api/admin/deduction/nodes/${id}`, { method: 'DELETE' })
}

/** 整期节点重排：按 nodeIds 顺序（管理端 id 列表）重写 sort_order */
export async function reorderDeductionAdminNodes(
  version: string,
  nodeIds: number[],
): Promise<{ version: string; count: number }> {
  return request(`/api/admin/deduction/periods/${encodeURIComponent(version)}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds }),
  })
}

/** 前战(小怪)怪物：仅登记 boss_info 基础库（按名 upsert，不写 boss 表） */
export async function createDeductionBossInfo(payload: {
  boss_name: string
  defense?: number
  level?: number
  weakness?: string | null
  resistance?: string | null
  boss_image?: string | null
}): Promise<{ action: string; id: number }> {
  return request('/api/admin/deduction/boss-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
