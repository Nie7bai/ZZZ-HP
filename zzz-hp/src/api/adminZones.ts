import { handleAdminSessionExpired, withAdminAuthHeaders } from '@/utils/adminAuth'

/**
 * 乘区定义 / 乘区方案管理接口（Phase 4b）。
 *
 * 后端 Phase 4a：`/api/admin/calculator/zone-definitions`、`/zone-schemes`，全部 `requireAdmin`。
 * 请求体接受表列口径（`zone_key` / `sort_order` / `applies_to` / `target_id`，后端有别名兼容），
 * 响应体是 camelCase（`zoneKey` / `sortOrder` / `appliesTo` / `targetId`），这里统一归一成
 * 表列/方案文档的 snake_case 口径，面板只认一种形状。
 */

/** 与后端 `calculatorZoneService.ZONE_SCOPES` 对齐；顺序即合并优先级（global 最弱） */
export const ZONE_SCHEME_SCOPES = [
  'global',
  'profession',
  'agent',
  'skill_group',
  'skill',
] as const

export type ZoneSchemeScope = (typeof ZONE_SCHEME_SCOPES)[number]

/**
 * 求值原语白名单，与后端 `ZONE_PRIMITIVES` 对齐。
 *
 * 前端只用于下拉与提示，不做求值；后端拒收白名单外的值，所以两边必须同步维护。
 */
export const ZONE_PRIMITIVE_OPTIONS = [
  { id: 'percentSum', label: 'percentSum（自定义百分比加总）' },
  { id: 'panel.percent', label: 'panel.percent（面板字段百分比）' },
  { id: 'stagger', label: 'stagger（失衡 / 帷幕易伤）' },
  { id: 'vulnerable', label: 'vulnerable（易伤 + 增减伤合成）' },
] as const

/** 作用域展示名 */
export const ZONE_SCHEME_SCOPE_LABELS: Record<ZoneSchemeScope, string> = {
  global: '全局',
  profession: '职业',
  agent: '角色',
  skill_group: '技能组',
  skill: '招式',
}

/** 乘区定义里的适用范围（方案文档 10.5：任一命中即生效） */
export interface ZoneDefinitionAppliesTo {
  damageKinds: string[]
  agents: string[]
  skills: string[]
}

/** 乘区可吃的增益键（方案文档 10.2） */
export interface ZoneStatRow {
  key: string
  label: string
  valueType: 'percent' | 'flat' | 'multiplier'
  sign?: 'increase' | 'decrease' | 'both'
  appliesToPanel?: boolean
  supportsConvert?: boolean
  supportsFactor?: boolean
}

export interface ZoneDefinitionDoc {
  id: number | null
  /** upsert 主键：内置键（如 stagger）或 `custom:<slug>` */
  zone_key: string
  label: string
  sort_order: number
  applies_to: ZoneDefinitionAppliesTo
  /** 提供者范围：owner / team / all；表里没有独立列，随 `applies_to.providers` 落库 */
  providers: string
  primitive: string
  params: Record<string, unknown>
  stats: ZoneStatRow[] | null
  display: Record<string, unknown> | null
  enabled: boolean
  version: number
  updated_at: string | null
}

/** 保存定义时的请求体（版本由服务端递增，不显式提交） */
export interface ZoneDefinitionInput {
  zone_key: string
  label: string
  sort_order: number
  applies_to: ZoneDefinitionAppliesTo
  providers: string
  primitive: string
  params: Record<string, unknown>
  /** JSON 文本原样提交，逐条字段由后端 `normalizeZoneStats` 校验 */
  stats: unknown[] | null
  display: Record<string, unknown> | null
  enabled: boolean
}

/** 方案条目；字段口径与后端 `normalizeZoneRule` 的允许集合一致 */
export interface ZoneSchemeRule {
  key: string
  label?: string
  action?: 'inherit' | 'replace' | 'disable'
  module?: string
  params?: Record<string, unknown>
  display?: Record<string, unknown>
  when?: unknown
  order?: number
  enabled?: boolean
  note?: string
}

export interface ZoneSchemeDoc {
  id: number
  scope: ZoneSchemeScope
  target_id: string
  name: string
  priority: number
  enabled: boolean
  version: number
  rules: ZoneSchemeRule[]
  updated_by: string | null
  updated_at: string | null
}

export interface ZoneSchemeInput {
  id?: number
  scope: ZoneSchemeScope
  target_id: string
  name: string
  priority: number
  enabled: boolean
  rules: ZoneSchemeRule[]
}

/** 删除定义被拒（409 `ZONE_IN_USE`）时后端给出的方案引用 */
export interface ZoneSchemeReference {
  id: number
  scope: string
  target_id: string
  name: string
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export class AdminZoneApiError extends Error {
  status: number
  apiCode: string
  references: ZoneSchemeReference[]

  constructor(
    message: string,
    status: number,
    apiCode = '',
    references: ZoneSchemeReference[] = [],
  ) {
    super(message)
    this.name = 'AdminZoneApiError'
    this.status = status
    this.apiCode = apiCode
    this.references = references
  }
}

/** 会话失效（401 / ADMIN_AUTH_REQUIRED）：面板据此弹「重新登录」 */
export function isAdminZoneAuthError(err: unknown): boolean {
  return (
    err instanceof AdminZoneApiError &&
    (err.status === 401 || err.apiCode === 'ADMIN_AUTH_REQUIRED')
  )
}

/** 删除被引用拦下：409 `ZONE_IN_USE`，需展示 references 而不是当普通失败 */
export function isZoneInUseError(err: unknown): err is AdminZoneApiError {
  return err instanceof AdminZoneApiError && err.apiCode === 'ZONE_IN_USE'
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

function readStats(value: unknown): ZoneStatRow[] | null {
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value
  if (!Array.isArray(parsed)) return null
  return parsed.filter(isRecord).map((item) => ({
    key: readText(item.key),
    label: readText(item.label),
    valueType: readText(item.valueType) === 'flat'
      ? 'flat'
      : readText(item.valueType) === 'multiplier'
        ? 'multiplier'
        : 'percent',
    sign: readText(item.sign) === 'increase'
      ? 'increase'
      : readText(item.sign) === 'decrease'
        ? 'decrease'
        : 'both',
    ...(item.appliesToPanel === undefined ? {} : { appliesToPanel: readBoolean(item.appliesToPanel, false) }),
    ...(item.supportsConvert === undefined ? {} : { supportsConvert: readBoolean(item.supportsConvert, false) }),
    ...(item.supportsFactor === undefined ? {} : { supportsFactor: readBoolean(item.supportsFactor, false) }),
  }))
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function normalizeDefinition(raw: unknown): ZoneDefinitionDoc {
  const row = isRecord(raw) ? raw : {}
  const appliesToRaw = pickField(row, 'appliesTo', 'applies_to')
  const appliesToRow = isRecord(appliesToRaw) ? appliesToRaw : {}
  return {
    id: row.id === undefined || row.id === null ? null : readNumber(row.id, 0),
    zone_key: readText(pickField(row, 'zoneKey', 'zone_key')),
    label: readText(row.label),
    sort_order: readNumber(pickField(row, 'sortOrder', 'sort_order'), 100),
    applies_to: {
      damageKinds: readStringList(appliesToRow.damageKinds),
      agents: readStringList(appliesToRow.agents),
      skills: readStringList(appliesToRow.skills),
    },
    providers: readText(row.providers) || readText(appliesToRow.providers) || 'team',
    primitive: readText(pickField(row, 'primitive', 'module')),
    params: readJsonObject(row.params) ?? {},
    stats: readStats(row.stats),
    display: readJsonObject(row.display),
    enabled: readBoolean(row.enabled, true),
    version: readNumber(row.version, 1),
    updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  }
}

/**
 * 归一单条方案条目：只保留后端 `normalizeZoneRule` 允许的字段，缺 `key` 返回 `null`。
 *
 * 面板保存 / 预览前都走这一步，避免把任意 JSON 直接塞进计算侧的类型。
 */
export function normalizeZoneSchemeRule(raw: unknown): ZoneSchemeRule | null {
  if (!isRecord(raw)) return null
  const key = readText(pickField(raw, 'key', 'zoneKey', 'zone_key'))
  if (!key) return null
  const rule: ZoneSchemeRule = { key }
  if (typeof raw.label === 'string' && raw.label) rule.label = raw.label
  const action = readText(raw.action)
  if (action === 'inherit' || action === 'replace' || action === 'disable') rule.action = action
  const module = readText(pickField(raw, 'module', 'primitive'))
  if (module) rule.module = module
  const params = readJsonObject(raw.params)
  if (params) rule.params = params
  const display = readJsonObject(raw.display)
  if (display) rule.display = display
  if (raw.when !== undefined && raw.when !== null) rule.when = raw.when
  if (raw.order !== undefined) rule.order = readNumber(raw.order, 0)
  if (raw.enabled !== undefined) rule.enabled = readBoolean(raw.enabled, true)
  if (typeof raw.note === 'string' && raw.note) rule.note = raw.note
  return rule
}

function normalizeScheme(raw: unknown): ZoneSchemeDoc {
  const row = isRecord(raw) ? raw : {}
  const scope = readText(row.scope)
  const rules = Array.isArray(row.rules) ? row.rules : []
  return {
    id: readNumber(row.id, 0),
    scope: (ZONE_SCHEME_SCOPES as readonly string[]).includes(scope)
      ? (scope as ZoneSchemeScope)
      : 'global',
    target_id: readText(pickField(row, 'targetId', 'target_id')),
    name: readText(row.name),
    priority: readNumber(row.priority, 10),
    enabled: readBoolean(row.enabled, true),
    version: readNumber(row.version, 1),
    rules: rules
      .map(normalizeZoneSchemeRule)
      .filter((rule): rule is ZoneSchemeRule => rule !== null),
    updated_by: typeof row.updatedBy === 'string' ? row.updatedBy : null,
    updated_at: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  }
}

function readReferences(data: unknown): ZoneSchemeReference[] {
  if (!isRecord(data) || !Array.isArray(data.references)) return []
  return data.references.filter(isRecord).map((item) => ({
    id: readNumber(item.id, 0),
    scope: readText(item.scope),
    target_id: readText(pickField(item, 'targetId', 'target_id')),
    name: readText(item.name),
  }))
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: withAdminAuthHeaders(init?.headers) })
  let body: ApiResponse<T>
  try {
    body = (await response.json()) as ApiResponse<T>
  } catch {
    throw new AdminZoneApiError(`请求失败: ${response.status}`, response.status)
  }
  const isSuccessCode = body.code >= 200 && body.code < 300
  if (!response.ok || !isSuccessCode) {
    const data = body.data as unknown
    const apiCode = isRecord(data) ? readText(data.code) : ''
    if (response.status === 401 || apiCode === 'ADMIN_AUTH_REQUIRED') {
      handleAdminSessionExpired()
    }
    throw new AdminZoneApiError(
      body.message || `请求失败: ${response.status}`,
      response.status,
      apiCode,
      readReferences(data),
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

/** 定义的请求体：`applies_to.providers` 是后端的读入兼容位置，保存时并回一份 */
function toDefinitionPayload(input: ZoneDefinitionInput) {
  return {
    zone_key: input.zone_key,
    label: input.label,
    sort_order: input.sort_order,
    applies_to: { ...input.applies_to, providers: input.providers },
    providers: input.providers,
    primitive: input.primitive,
    params: input.params,
    stats: input.stats,
    display: input.display,
    enabled: input.enabled,
  }
}

function toSchemePayload(input: ZoneSchemeInput) {
  return {
    scope: input.scope,
    target_id: input.target_id,
    name: input.name,
    priority: input.priority,
    enabled: input.enabled,
    rules: input.rules,
  }
}

export async function fetchZoneDefinitions(): Promise<ZoneDefinitionDoc[]> {
  const data = await requestJson<unknown>('/api/admin/calculator/zone-definitions')
  const rows = Array.isArray(data) ? data : []
  return rows.map(normalizeDefinition)
}

export async function upsertZoneDefinition(
  input: ZoneDefinitionInput,
): Promise<ZoneDefinitionDoc> {
  const data = await requestJson<unknown>(
    '/api/admin/calculator/zone-definitions',
    jsonInit('POST', toDefinitionPayload(input)),
  )
  return normalizeDefinition(data)
}

export async function deleteZoneDefinition(zoneKey: string): Promise<{ zone_key: string }> {
  const data = await requestJson<unknown>(
    `/api/admin/calculator/zone-definitions/${encodeURIComponent(zoneKey)}`,
    { method: 'DELETE' },
  )
  return { zone_key: isRecord(data) ? readText(pickField(data, 'zoneKey', 'zone_key')) : zoneKey }
}

export async function fetchZoneSchemes(): Promise<ZoneSchemeDoc[]> {
  const data = await requestJson<unknown>('/api/admin/calculator/zone-schemes')
  const rows = Array.isArray(data) ? data : []
  return rows.map(normalizeScheme)
}

/** 按 scope + target_id upsert（管理端「保存」= 整份覆盖） */
export async function upsertZoneScheme(input: ZoneSchemeInput): Promise<ZoneSchemeDoc> {
  const data = await requestJson<unknown>(
    '/api/admin/calculator/zone-schemes',
    jsonInit('POST', toSchemePayload(input)),
  )
  return normalizeScheme(data)
}

/** 按 id 覆盖保存（改了 scope/target_id 且撞唯一键会回 409） */
export async function updateZoneScheme(
  id: number,
  input: ZoneSchemeInput,
): Promise<ZoneSchemeDoc> {
  const data = await requestJson<unknown>(
    `/api/admin/calculator/zone-schemes/${id}`,
    jsonInit('PUT', toSchemePayload(input)),
  )
  return normalizeScheme(data)
}

export async function deleteZoneScheme(id: number): Promise<{ id: number }> {
  const data = await requestJson<unknown>(`/api/admin/calculator/zone-schemes/${id}`, {
    method: 'DELETE',
  })
  return { id: isRecord(data) ? readNumber(data.id, id) : id }
}
