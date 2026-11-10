import type { ZoneCondition, ZoneSchemeEntry } from './scheme'

/** 后端公共接口的原始行（camelCase，对应 Phase 4a 的返回） */
export interface RemoteZoneRule {
  key: string
  action?: 'inherit' | 'replace' | 'disable' | null
  label?: string | null
  module?: string | null
  primitive?: string | null
  params?: Record<string, unknown> | null
  when?: unknown
  order?: number | null
  enabled?: boolean | null
}

export interface RemoteZoneScheme {
  id?: number
  scope: string
  targetId: string
  name: string
  priority: number
  version: number
  rules: RemoteZoneRule[]
}

export interface RemoteZoneDefinition {
  zoneKey: string
  label: string
  sortOrder: number
  appliesTo?: unknown
  providers?: string
  primitive: string
  params?: Record<string, unknown> | null
  stats?: unknown
  display?: unknown
  version: number
}

export interface RemoteZoneConfig {
  version: number
  definitions: RemoteZoneDefinition[]
  schemes: RemoteZoneScheme[]
}

const SCOPE_MAP: Record<string, 'global' | 'profession' | 'agent' | 'skillGroup' | 'skill'> = {
  global: 'global',
  profession: 'profession',
  agent: 'agent',
  skill_group: 'skillGroup',
  skillGroup: 'skillGroup',
  skill: 'skill',
}

/** 后端作用域写法 → 前端作用域；未知值返回 null（脏配置不参与计算） */
export function adaptZoneScope(raw: unknown): 'global' | 'profession' | 'agent' | 'skillGroup' | 'skill' | null {
  if (typeof raw !== 'string') return null
  return SCOPE_MAP[raw.trim()] ?? null
}

const OP_MAP: Record<string, 'eq' | 'neq' | 'in' | 'gte' | 'lte'> = {
  '==': 'eq',
  '!=': 'neq',
  in: 'in',
  '>=': 'gte',
  '<=': 'lte',
}

/** 后端条件写法 → 前端条件（单键/比较/and/or/not）；无法识别返回 undefined */
export function adaptCondition(raw: unknown): ZoneCondition | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  if ('and' in record && Array.isArray(record.and)) {
    const children = record.and.map(adaptCondition).filter((item): item is ZoneCondition => Boolean(item))
    return children.length ? { and: children } : undefined
  }
  if ('or' in record && Array.isArray(record.or)) {
    const children = record.or.map(adaptCondition).filter((item): item is ZoneCondition => Boolean(item))
    return children.length ? { or: children } : undefined
  }
  if ('not' in record) {
    const child = adaptCondition(record.not)
    return child ? { not: child } : undefined
  }
  const entries = Object.entries(record)
  if (entries.length !== 1) return undefined
  const entry = entries[0]
  if (!entry) return undefined
  const [variable, value] = entry
  if (value && typeof value === 'object' && !Array.isArray(value) && 'op' in value) {
    const operator = OP_MAP[String((value as Record<string, unknown>).op ?? '')]
    if (!operator) return undefined
    return {
      var: variable as ZoneCondition extends { var: infer V } ? V : never,
      op: operator,
      value: (value as Record<string, unknown>).value as ZoneCondition extends { value: infer V } ? V : never,
    } as ZoneCondition
  }
  return {
    var: variable as ZoneCondition extends { var: infer V } ? V : never,
    op: 'eq',
    value: value as ZoneCondition extends { value: infer V } ? V : never,
  } as ZoneCondition
}

/** 后端规则 → 前端方案条目；`inherit` 且无覆盖时返回 null（等价于不写） */
export function adaptZoneRule(rule: RemoteZoneRule): ZoneSchemeEntry | null {
  const action = rule.action ?? 'inherit'
  const module = rule.module ?? rule.primitive ?? null
  if (action === 'inherit' && !module && !rule.params) return null
  if (action !== 'disable' && !module) return null
  return {
    key: rule.key,
    module: action === 'disable' ? '__disabled' : module!,
    action,
    label: rule.label ?? undefined,
    params: (rule.params ?? undefined) as ZoneSchemeEntry['params'],
    when: adaptCondition(rule.when),
  }
}

export function adaptZoneScheme(remote: RemoteZoneScheme): {
  scope: 'global' | 'profession' | 'agent' | 'skillGroup' | 'skill'
  targetId: string
  priority: number
  entries: ZoneSchemeEntry[]
} | null {
  const scope = adaptZoneScope(remote.scope)
  if (!scope) return null
  const entries = remote.rules
    .map(adaptZoneRule)
    .filter((entry): entry is ZoneSchemeEntry => Boolean(entry))
  if (!entries.length) return null
  return { scope, targetId: String(remote.targetId ?? '').trim(), priority: Number(remote.priority) || 0, entries }
}

export function adaptZoneSchemes(config: RemoteZoneConfig | null | undefined): Array<{
  scope: 'global' | 'profession' | 'agent' | 'skillGroup' | 'skill'
  targetId: string
  priority: number
  entries: ZoneSchemeEntry[]
}> {
  if (!config?.schemes?.length) return []
  return config.schemes
    .map(adaptZoneScheme)
    .filter((scheme): scheme is NonNullable<typeof scheme> => Boolean(scheme))
}
