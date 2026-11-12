import { handleAdminSessionExpired, withAdminAuthHeaders } from '@/utils/adminAuth'
import { BUILT_IN_DAMAGE_CHAINS, type StageAction, type StageKind } from '@/zones/pipeline'

/**
 * 计算链路管理接口（Phase 4f）。
 *
 * 后端 `/api/admin/calculator/damage-chains`（GET/POST/PUT/DELETE，全部 `requireAdmin`）。
 * 字段口径按后端契约的 camelCase（`chainKey` / `appliesTo` / `targetId`）。
 * 阶段只提交契约里的十个字段（`id/kind/module/label/group/order/inputs/params/when/enabled`）——
 * 后端会拒绝未知字段，因此不能直接透传 `action`：
 * 禁用 = `enabled: false`，继承 = 只提交 id/kind/module/order + `enabled: true`。
 */

/** 与后端 `calculatorZoneService.ZONE_SCOPES` 对齐；顺序即合并优先级（global 最弱） */
export const DAMAGE_CHAIN_SCOPES = ['global', 'profession', 'agent', 'skill_group', 'skill'] as const

export type DamageChainScope = (typeof DAMAGE_CHAIN_SCOPES)[number]

export const DAMAGE_CHAIN_SCOPE_LABELS: Record<DamageChainScope, string> = {
  global: '全局',
  profession: '职业',
  agent: '角色',
  skill_group: '技能组',
  skill: '招式',
}

/** 内置链路键；`custom:<slug>` 为管理员新增链路。直接从内置定义派生，避免新增链路后漏更新。 */
export const DAMAGE_CHAIN_KEY_OPTIONS = BUILT_IN_DAMAGE_CHAINS.map((chain) => ({
  id: chain.id,
  label: chain.label,
}))

export interface DamageChainStageDoc {
  id: string
  kind: StageKind
  label?: string
  group?: string
  order?: number
  module?: string
  inputs?: string[]
  params?: Record<string, unknown>
  when?: unknown
  enabled?: boolean
  /** 与内置阶段的关系（前端口径；后端用 enabled 表达，不落库 action） */
  action?: StageAction
}

export interface DamageChainAppliesTo {
  damageKinds: string[]
  /** 表单不编辑，原样回传（后端允许该字段） */
  subKinds?: string[]
}

export interface DamageChainDoc {
  id: number
  chainKey: string
  label: string
  appliesTo: DamageChainAppliesTo
  scope: DamageChainScope
  targetId: string
  priority: number
  version: number
  enabled: boolean
  stages: DamageChainStageDoc[]
  updatedBy: string | null
  updatedAt: string | null
}

/** 保存请求体（版本由服务端递增） */
export interface DamageChainInput {
  chainKey: string
  label: string
  appliesTo: DamageChainAppliesTo
  scope: DamageChainScope
  targetId: string
  priority: number
  enabled: boolean
  stages: DamageChainStageDoc[]
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export class AdminDamageChainApiError extends Error {
  status: number
  apiCode: string

  constructor(message: string, status: number, apiCode = '') {
    super(message)
    this.name = 'AdminDamageChainApiError'
    this.status = status
    this.apiCode = apiCode
  }
}

/** 会话失效（401 / ADMIN_AUTH_REQUIRED）：面板据此弹「重新登录」 */
export function isAdminDamageChainAuthError(err: unknown): boolean {
  return (
    err instanceof AdminDamageChainApiError &&
    (err.status === 401 || err.apiCode === 'ADMIN_AUTH_REQUIRED')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pickField(raw: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (raw[name] !== undefined) return raw[name]
  }
  return undefined
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 0 || value === 1) return value === 1
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'true' || text === '1') return true
    if (text === 'false' || text === '0') return false
  }
  return fallback
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

const STAGE_KINDS: readonly StageKind[] = ['source', 'multiplier', 'combine', 'final']
const STAGE_ACTIONS: readonly StageAction[] = ['inherit', 'replace', 'disable']

/** 单条阶段归一：缺 id 返回 null；kind 非法回落 multiplier */
export function normalizeDamageChainStage(raw: unknown): DamageChainStageDoc | null {
  if (!isRecord(raw)) return null
  const id = readText(pickField(raw, 'id', 'stageId', 'stage_id')).trim()
  if (!id) return null
  const kindText = readText(raw.kind)
  const stage: DamageChainStageDoc = {
    id,
    kind: (STAGE_KINDS as readonly string[]).includes(kindText) ? (kindText as StageKind) : 'multiplier',
  }
  const label = readText(raw.label).trim()
  if (label) stage.label = label
  const group = readText(raw.group).trim()
  if (group) stage.group = group
  if (raw.order !== undefined && raw.order !== null) stage.order = readNumber(raw.order, 0)
  const module = readText(pickField(raw, 'module', 'primitive')).trim()
  if (module) stage.module = module
  if (Array.isArray(raw.inputs)) stage.inputs = readStringList(raw.inputs)
  const params = readJsonObject(raw.params)
  if (params && Object.keys(params).length) stage.params = params
  if (isRecord(raw.when) && Object.keys(raw.when).length) stage.when = raw.when
  if (raw.enabled !== undefined) stage.enabled = readBoolean(raw.enabled, true)
  const action = readText(raw.action)
  if ((STAGE_ACTIONS as readonly string[]).includes(action)) {
    stage.action = action as StageAction
  }
  return stage
}

function normalizeDamageChain(raw: unknown): DamageChainDoc {
  const row = isRecord(raw) ? raw : {}
  const scopeText = readText(row.scope)
  const appliesToRaw = pickField(row, 'appliesTo', 'applies_to')
  const appliesTo = isRecord(appliesToRaw) ? appliesToRaw : { damageKinds: appliesToRaw }
  const subKinds = readStringList(appliesTo.subKinds)
  return {
    id: readNumber(row.id, 0),
    chainKey: readText(pickField(row, 'chainKey', 'chain_key')),
    label: readText(row.label),
    appliesTo: { damageKinds: readStringList(appliesTo.damageKinds), ...(subKinds.length ? { subKinds } : {}) },
    scope: (DAMAGE_CHAIN_SCOPES as readonly string[]).includes(scopeText)
      ? (scopeText as DamageChainScope)
      : 'global',
    targetId: readText(pickField(row, 'targetId', 'target_id')),
    priority: readNumber(row.priority, 0),
    version: readNumber(row.version, 1),
    enabled: readBoolean(row.enabled, true),
    stages: (Array.isArray(row.stages) ? row.stages : [])
      .map(normalizeDamageChainStage)
      .filter((stage): stage is DamageChainStageDoc => stage !== null),
    updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : null,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  }
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: withAdminAuthHeaders(init?.headers) })
  let body: ApiResponse<T>
  try {
    body = (await response.json()) as ApiResponse<T>
  } catch {
    throw new AdminDamageChainApiError(`请求失败: ${response.status}`, response.status)
  }
  const isSuccessCode = typeof body.code !== 'number' || (body.code >= 200 && body.code < 300)
  if (!response.ok || !isSuccessCode) {
    const data = body.data as unknown
    const apiCode = isRecord(data) ? readText(data.code) : ''
    if (response.status === 401 || apiCode === 'ADMIN_AUTH_REQUIRED') {
      handleAdminSessionExpired()
    }
    throw new AdminDamageChainApiError(
      body.message || `请求失败: ${response.status}`,
      response.status,
      apiCode,
    )
  }
  return body.data
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

/** 阶段请求体：只含后端允许的十个字段；disable= enabled:false、inherit= 只提交 id/kind/module/order */
export function toDamageChainStagePayload(stage: DamageChainStageDoc): Record<string, unknown> {
  const enabled = stage.enabled !== false && stage.action !== 'disable'
  const base: Record<string, unknown> = {
    id: stage.id,
    kind: stage.kind,
    // 后端要求 module 必填：原样回传阶段自身的模块，空则回落 percentSum
    module: stage.module || 'percentSum',
    order: typeof stage.order === 'number' ? stage.order : 0,
    enabled,
  }
  // 继承：不提交 label/group/params/when，合并时沿用内置阶段的值
  if (stage.action === 'inherit') return base
  return {
    ...base,
    label: stage.label || stage.id,
    group: stage.group || '',
    inputs: stage.inputs ?? [],
    params: stage.params ?? {},
    when: stage.when ?? {},
  }
}

function toChainPayload(input: DamageChainInput) {
  const appliesTo: Record<string, unknown> = {
    damageKinds: [...input.appliesTo.damageKinds],
  }
  if (input.appliesTo.subKinds?.length) appliesTo.subKinds = [...input.appliesTo.subKinds]
  return {
    chainKey: input.chainKey,
    label: input.label,
    appliesTo,
    scope: input.scope,
    targetId: input.targetId,
    priority: input.priority,
    enabled: input.enabled,
    stages: input.stages.map(toDamageChainStagePayload),
  }
}

/** 后端只允许删除 `custom:*` 链路；内置 chainKey 的覆盖请改为停用 */
export function isCustomDamageChainKey(chainKey: string): boolean {
  return /^custom:[A-Za-z0-9][A-Za-z0-9_-]*$/.test(chainKey.trim())
}

export async function fetchDamageChains(): Promise<DamageChainDoc[]> {
  const data = await requestJson<unknown>('/api/admin/calculator/damage-chains')
  const rows = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.chains)
      ? data.chains
      : []
  return rows.map(normalizeDamageChain)
}

/** 新建（同 chainKey + scope + targetId 由后端判定冲突） */
export async function createDamageChain(input: DamageChainInput): Promise<DamageChainDoc> {
  const data = await requestJson<unknown>(
    '/api/admin/calculator/damage-chains',
    jsonInit('POST', toChainPayload(input)),
  )
  return normalizeDamageChain(data)
}

/** 按 id 覆盖保存 */
export async function updateDamageChain(
  id: number,
  input: DamageChainInput,
): Promise<DamageChainDoc> {
  const data = await requestJson<unknown>(
    `/api/admin/calculator/damage-chains/${id}`,
    jsonInit('PUT', toChainPayload(input)),
  )
  return normalizeDamageChain(data)
}

export async function deleteDamageChain(id: number): Promise<{ id: number }> {
  const data = await requestJson<unknown>(`/api/admin/calculator/damage-chains/${id}`, {
    method: 'DELETE',
  })
  return { id: isRecord(data) ? readNumber(data.id, id) : id }
}
