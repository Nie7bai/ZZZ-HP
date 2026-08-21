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

export interface AdminDeductionNode {
  id: number
  version: string
  phase: string
  nodeId: string
  name: string
  type: number
  prevNode: string | null
  storyText: string | null
  layers: { name: string; monsters: { name: string; hp: number; defense: number; level: number; weakness: string | null; resistance: string | null }[] }[]
  buffs: { title: string; desc: string | null }[]
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
