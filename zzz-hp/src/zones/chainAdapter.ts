import type {
  DamageChainDefinition,
  StageAction,
  StageDefinition,
  StageKind,
} from './pipeline'
import type { ZoneScope } from './scheme'
import { adaptCondition, adaptZoneScope } from './schemeAdapter'

/**
 * 计算链路运行时格式适配（Phase 4f）。
 *
 * 后端公共只读 `GET /api/calculator/damage-chains`：
 * `{ version, chains: [{ id, chainKey, label, appliesTo, scope, targetId, priority, version, stages }] }`。
 * 这里只做形状归一（`skill_group` → `skillGroup`、条件写法、阶段字段），不做校验与求值：
 * 脏数据由 `resolveDamageChain` 忽略。
 */
export interface RemoteDamageChainStage {
  id?: string | null
  kind?: string | null
  /** 与内置阶段的关系；缺省 = replace（后端也可用 enabled=false 表达 disable） */
  action?: string | null
  module?: string | null
  label?: string | null
  group?: string | null
  order?: number | null
  inputs?: unknown
  params?: Record<string, unknown> | null
  when?: unknown
  enabled?: boolean | null
}

export interface RemoteDamageChain {
  id?: number | null
  chainKey?: string | null
  /** 表列口径兼容 */
  chain_key?: string | null
  label?: string | null
  appliesTo?: unknown
  scope?: string | null
  targetId?: string | null
  target_id?: string | null
  priority?: number | null
  version?: number | null
  enabled?: boolean | null
  stages?: RemoteDamageChainStage[] | null
}

export interface RemoteDamageChainConfig {
  version?: number
  chains?: RemoteDamageChain[] | null
}

const STAGE_KINDS: readonly StageKind[] = ['source', 'multiplier', 'combine', 'final']
const STAGE_ACTIONS: readonly StageAction[] = ['inherit', 'replace', 'disable']

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFiniteNumber(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 0 || value === 1) return value === 1
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === 'true' || text === '1') return true
    if (text === 'false' || text === '0') return false
  }
  return undefined
}

function readStageKind(value: unknown): StageKind {
  const text = readText(value)
  return (STAGE_KINDS as readonly string[]).includes(text) ? (text as StageKind) : 'multiplier'
}

function readStageAction(value: unknown): StageAction | undefined {
  const text = readText(value)
  return (STAGE_ACTIONS as readonly string[]).includes(text) ? (text as StageAction) : undefined
}

function readInputs(value: unknown, fallback: readonly string[] | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) return fallback
  const ids = value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
  return ids.filter(Boolean)
}

function readDamageKinds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (value && typeof value === 'object') {
    const kinds = (value as Record<string, unknown>).damageKinds
    if (Array.isArray(kinds)) return kinds.filter((item): item is string => typeof item === 'string')
  }
  return []
}

/** 后端阶段 → 前端阶段；缺 id 返回 null（阶段以 id 为合并键） */
export function adaptDamageChainStage(
  raw: RemoteDamageChainStage | null | undefined,
  options: { index: number; group: string },
): StageDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const id = readText(raw.id)
  if (!id) return null
  const stage: StageDefinition = {
    id,
    kind: readStageKind(raw.kind),
    // 空 = 后端没配展示名/分组：合并时沿用内置阶段，独立链路回落到阶段 id
    label: readText(raw.label),
    group: readText(raw.group),
    order: readFiniteNumber(raw.order) ?? options.index * 10,
  }
  const module = readText(raw.module)
  if (module) stage.module = module
  const inputs = readInputs(raw.inputs, undefined)
  if (inputs?.length) stage.inputs = inputs
  if (raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)) {
    if (Object.keys(raw.params).length) stage.params = raw.params
  }
  const when = adaptCondition(raw.when)
  if (when) stage.when = when
  const enabled = readBoolean(raw.enabled)
  if (enabled !== undefined) stage.enabled = enabled
  const action = readStageAction(raw.action)
  if (action) stage.action = action
  return stage
}

/** 后端链路 → 前端链路；缺 chainKey 返回 null */
export function adaptDamageChain(
  raw: RemoteDamageChain | null | undefined,
): DamageChainDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const chainKey = readText(raw.chainKey) || readText(raw.chain_key)
  if (!chainKey) return null
  const scope: ZoneScope = adaptZoneScope(raw.scope) ?? 'global'
  const targetId = scope === 'global' ? '' : readText(raw.targetId) || readText(raw.target_id)
  const rawStages = Array.isArray(raw.stages) ? raw.stages : []
  const stages = rawStages
    .map((stage, index) =>
      adaptDamageChainStage(stage, { index, group: chainKey }),
    )
    .filter((stage): stage is StageDefinition => Boolean(stage))
  const chain: DamageChainDefinition = {
    id: chainKey,
    // 空 = 没写展示名；解析时回落内置链路名
    label: readText(raw.label),
    appliesTo: { damageKinds: readDamageKinds(raw.appliesTo) },
    stages,
    scope,
    targetId,
    priority: readFiniteNumber(raw.priority) ?? 10,
    version: readFiniteNumber(raw.version) ?? 1,
    enabled: readBoolean(raw.enabled) ?? true,
  }
  return chain
}

export function adaptDamageChains(
  config: RemoteDamageChainConfig | null | undefined,
): DamageChainDefinition[] {
  if (!config || !Array.isArray(config.chains)) return []
  return config.chains
    .map(adaptDamageChain)
    .filter((chain): chain is DamageChainDefinition => Boolean(chain))
}
