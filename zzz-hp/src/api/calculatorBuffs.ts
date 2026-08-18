import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  CalculatorBuffData,
  CalculatorBuffImportSummary,
  DamageEventMode,
  DriveDiscBuffDoc,
  FollowUpSkillRule,
  Skill,
  SkillSubcategory,
  WengineBuffDoc,
} from '@/types/calculator'
import { withAdminAuthHeaders } from '@/utils/adminAuth'

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export class CalculatorBuffApiError extends Error {
  status: number
  apiCode: string

  constructor(message: string, status: number, apiCode = '') {
    super(message)
    this.name = 'CalculatorBuffApiError'
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
    throw new CalculatorBuffApiError(`请求失败: ${response.status}`, response.status)
  }
  if (!response.ok || json.code !== 200) {
    throw new CalculatorBuffApiError(
      json.message || `请求失败: ${response.status}`,
      response.status,
      readApiCode(json.data),
    )
  }
  return json.data
}

export function isAdminAuthError(err: unknown): boolean {
  return (
    err instanceof CalculatorBuffApiError &&
    (err.status === 401 || err.apiCode === 'ADMIN_AUTH_REQUIRED')
  )
}

export async function fetchCalculatorBuffs(): Promise<CalculatorBuffData> {
  return requestJson<CalculatorBuffData>('/api/calculator-buffs')
}

export async function saveAgentBuff(doc: AgentBuffDoc): Promise<AgentBuffDoc> {
  return requestJson<AgentBuffDoc>('/api/calculator-buffs/agents', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function fetchSkillSubcategories(): Promise<SkillSubcategory[]> {
  return requestJson<SkillSubcategory[]>('/api/calculator-buffs/skill-subcategories')
}

export async function saveSkillSubcategory(
  doc: SkillSubcategory,
): Promise<SkillSubcategory> {
  return requestJson<SkillSubcategory>('/api/calculator-buffs/skill-subcategories', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteSkillSubcategory(id: string): Promise<void> {
  await requestJson<{ id: string }>(
    `/api/calculator-buffs/skill-subcategories/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function fetchPresetSkills(): Promise<Skill[]> {
  return requestJson<Skill[]>('/api/calculator-buffs/skills')
}

export async function savePresetSkill(doc: Skill): Promise<Skill> {
  return requestJson<Skill>('/api/calculator-buffs/skills', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deletePresetSkill(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/skills/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveFollowUpSkillRule(
  doc: FollowUpSkillRule,
): Promise<FollowUpSkillRule> {
  return requestJson<FollowUpSkillRule>('/api/calculator-buffs/follow-up-rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteFollowUpSkillRule(id: string): Promise<void> {
  await requestJson<{ id: string }>(
    `/api/calculator-buffs/follow-up-rules/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function fetchDamageEventModes(): Promise<DamageEventMode[]> {
  return requestJson<DamageEventMode[]>('/api/calculator-buffs/damage-event-modes')
}

export async function saveDamageEventMode(doc: DamageEventMode): Promise<DamageEventMode> {
  return requestJson<DamageEventMode>('/api/calculator-buffs/damage-event-modes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteDamageEventMode(id: string): Promise<void> {
  await requestJson<{ id: string }>(
    `/api/calculator-buffs/damage-event-modes/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function deleteAgentBuff(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/agents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveWengineBuff(doc: WengineBuffDoc): Promise<WengineBuffDoc> {
  return requestJson<WengineBuffDoc>('/api/calculator-buffs/wengines', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteWengineBuff(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/wengines/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveBangbooBuff(doc: BangbooBuffDoc): Promise<BangbooBuffDoc> {
  return requestJson<BangbooBuffDoc>('/api/calculator-buffs/bangboos', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteBangbooBuff(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/bangboos/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function saveDriveDiscBuff(doc: DriveDiscBuffDoc): Promise<DriveDiscBuffDoc> {
  return requestJson<DriveDiscBuffDoc>('/api/calculator-buffs/drive-discs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  })
}

export async function deleteDriveDiscBuff(id: string): Promise<void> {
  await requestJson<{ id: string }>(`/api/calculator-buffs/drive-discs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function fetchCalculatorBuffSnapshot(): Promise<CalculatorBuffData> {
  return requestJson<CalculatorBuffData>('/api/calculator-buffs/export')
}

export async function importCalculatorBuffSnapshotFile(
  file: File,
): Promise<CalculatorBuffImportSummary> {
  const form = new FormData()
  form.append('file', file)
  return requestJson<CalculatorBuffImportSummary>('/api/calculator-buffs/import', {
    method: 'POST',
    body: form,
  })
}
