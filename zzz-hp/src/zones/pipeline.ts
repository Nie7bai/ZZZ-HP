import { ZONE_SCOPE_RANK, isZoneScope, type ZoneCondition, type ZoneScope } from './scheme'

/**
 * 计算链路（Pipeline）阶段模型（Phase 4c / 4f）。
 *
 * 目标：把一次结算拆成有序阶段（source / multiplier / combine / final），
 * 为「管理端编辑链路 + 用户端逐阶段展示」提供稳定结构。
 *
 * 阶段轨迹的值仍来自现有计算（`damageCalc` 按阶段 id 映射），
 * 运行时链路只决定「有哪些阶段、什么顺序、叫什么」，不改任何数值。
 */
export type StageKind = 'source' | 'multiplier' | 'combine' | 'final'

/** 阶段类型展示名（用户端与管理端共用，避免两处各写一份） */
export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  source: '基础',
  multiplier: '乘数',
  combine: '合并',
  final: '结算',
}

/** 运行时阶段与内置阶段的关系：inherit 保留内置、replace 覆盖、disable 移除 */
export type StageAction = 'inherit' | 'replace' | 'disable'

export interface StageDefinition {
  id: string
  kind: StageKind
  label: string
  group: string
  order: number
  /** 求值模块白名单名；只用于配置与展示，求值仍按阶段 id 映射现有数值 */
  module?: string
  /** 依赖的阶段 id（final 汇总用） */
  inputs?: readonly string[]
  params?: Record<string, unknown>
  /** 阶段条件；命中上下文由调用方求值（缺省 = 恒成立） */
  when?: ZoneCondition
  /** `false` = 本次不展示该阶段 */
  enabled?: boolean
  /** 与内置阶段的关系；缺省按 replace 处理 */
  action?: StageAction
}

export interface DamageChainDefinition {
  id: string
  label: string
  appliesTo: {
    damageKinds: readonly string[]
    /** 基础伤害来源（atk/def/pierce）；缺省 = 不限 */
    baseDamageSources?: readonly string[]
  }
  stages: readonly StageDefinition[]
  /** 作用域：内置链路为 global，运行时链路可覆盖到更具体的作用域 */
  scope?: ZoneScope
  /** global 为空；profession = 职业；agent = 角色 id；skillGroup = 技能组；skill = 招式 */
  targetId?: string
  /** 同作用域内的覆盖顺序：大的后应用 */
  priority?: number
  version?: number
  enabled?: boolean
}

export interface StageTraceEntry extends StageDefinition {
  value: number
}

const DIRECT_STAGE_IDS = ['base', 'dmg', 'defense', 'resistance', 'stagger', 'vulnerable', 'crit', 'directMult', 'settlement', 'pierce', 'sharpen', 'special'] as const
const ANOMALY_STAGE_IDS = ['base', 'dmg', 'defense', 'resistance', 'stagger', 'vulnerable', 'mastery', 'level', 'dmgBonus', 'mult', 'crit', 'special'] as const
const RADIANCE_SELF_STAGE_IDS = ['selfAtk', 'selfMastery', 'specialLevel', 'mutation', 'defense', 'resistance', 'vulnerable', 'stagger', 'radianceBonus', 'radianceMult', 'crit', 'special'] as const

/** 内置链路定义：阶段顺序、展示名与模块名。数值仍由 damageCalc 现有链路产生。 */
export const BUILT_IN_DAMAGE_CHAINS: readonly DamageChainDefinition[] = Object.freeze([
  {
    id: 'direct',
    label: '纯直伤链路',
    appliesTo: { damageKinds: ['direct'], baseDamageSources: ['atk', 'def'] },
    scope: 'global',
    targetId: '',
    priority: 0,
    stages: [
      { id: 'base', kind: 'source', label: '基础伤害', group: 'direct', order: 10, module: 'baseDamage' },
      { id: 'dmg', kind: 'multiplier', label: '增伤区', group: 'direct', order: 20, module: 'percentSum' },
      { id: 'defense', kind: 'multiplier', label: '防御区', group: 'direct', order: 30, module: 'defenseMultiplier' },
      { id: 'resistance', kind: 'multiplier', label: '抗性区', group: 'direct', order: 40, module: 'resistanceMultiplier' },
      { id: 'stagger', kind: 'multiplier', label: '失衡易伤区', group: 'direct', order: 45, module: 'stagger' },
      { id: 'vulnerable', kind: 'multiplier', label: '易伤区', group: 'direct', order: 50, module: 'vulnerable' },
      { id: 'crit', kind: 'multiplier', label: '暴击区', group: 'direct', order: 60, module: 'crit' },
      { id: 'directMult', kind: 'multiplier', label: '直伤倍率区', group: 'direct', order: 70, module: 'directMult' },
      { id: 'settlement', kind: 'multiplier', label: '决算倍率区', group: 'direct', order: 80, module: 'settlementMult' },
      { id: 'pierce', kind: 'multiplier', label: '贯穿增伤区', group: 'direct', order: 90, module: 'pierceBonus' },
      { id: 'sharpen', kind: 'multiplier', label: '锐化伤害提升区', group: 'direct', order: 100, module: 'sharpenBonus' },
      { id: 'special', kind: 'multiplier', label: '特殊乘区', group: 'direct', order: 110, module: 'specialMult' },
      { id: 'final', kind: 'final', label: '期望伤害', group: 'direct', order: 120, module: 'product', inputs: DIRECT_STAGE_IDS },
    ],
  },
  {
    id: 'sharpen',
    label: '锋御·锐化链路',
    appliesTo: { damageKinds: ['sharpen'], baseDamageSources: ['def'] },
    scope: 'global',
    targetId: '',
    priority: 0,
    stages: [
      { id: 'base', kind: 'source', label: '防御力基础', group: 'sharpen', order: 10, module: 'baseDamage' },
      { id: 'dmg', kind: 'multiplier', label: '增伤区', group: 'sharpen', order: 20, module: 'percentSum' },
      { id: 'defense', kind: 'multiplier', label: '防御区', group: 'sharpen', order: 30, module: 'defenseMultiplier' },
      { id: 'resistance', kind: 'multiplier', label: '抗性区', group: 'sharpen', order: 40, module: 'resistanceMultiplier' },
      { id: 'stagger', kind: 'multiplier', label: '失衡易伤区', group: 'sharpen', order: 45, module: 'stagger' },
      { id: 'vulnerable', kind: 'multiplier', label: '易伤区', group: 'sharpen', order: 50, module: 'vulnerable' },
      { id: 'crit', kind: 'multiplier', label: '锐爆区', group: 'sharpen', order: 60, module: 'sharpenCrit' },
      { id: 'directMult', kind: 'multiplier', label: '直伤倍率区', group: 'sharpen', order: 70, module: 'directMult' },
      { id: 'sharpen', kind: 'multiplier', label: '锐化伤害提升区', group: 'sharpen', order: 100, module: 'sharpenBonus' },
      { id: 'special', kind: 'multiplier', label: '特殊乘区', group: 'sharpen', order: 110, module: 'specialMult' },
      { id: 'final', kind: 'final', label: '期望伤害', group: 'sharpen', order: 120, module: 'product', inputs: ['base', 'dmg', 'defense', 'resistance', 'stagger', 'vulnerable', 'crit', 'directMult', 'sharpen', 'special'] },
    ],
  },
  {
    id: 'pierce',
    label: '命破链路',
    appliesTo: { damageKinds: ['direct'], baseDamageSources: ['pierce'] },
    scope: 'global',
    targetId: '',
    priority: 0,
    stages: [
      { id: 'base', kind: 'source', label: '贯穿力基础', group: 'direct', order: 10, module: 'baseDamage' },
      { id: 'dmg', kind: 'multiplier', label: '增伤区', group: 'direct', order: 20, module: 'percentSum' },
      { id: 'defense', kind: 'multiplier', label: '防御区', group: 'direct', order: 30, module: 'defenseMultiplier' },
      { id: 'resistance', kind: 'multiplier', label: '抗性区', group: 'direct', order: 40, module: 'resistanceMultiplier' },
      { id: 'stagger', kind: 'multiplier', label: '失衡易伤区', group: 'direct', order: 45, module: 'stagger' },
      { id: 'vulnerable', kind: 'multiplier', label: '易伤区', group: 'direct', order: 50, module: 'vulnerable' },
      { id: 'crit', kind: 'multiplier', label: '暴击区', group: 'direct', order: 60, module: 'crit' },
      { id: 'directMult', kind: 'multiplier', label: '直伤倍率区', group: 'direct', order: 70, module: 'directMult' },
      { id: 'settlement', kind: 'multiplier', label: '决算倍率区', group: 'direct', order: 80, module: 'settlementMult' },
      { id: 'pierce', kind: 'multiplier', label: '贯穿增伤区', group: 'direct', order: 90, module: 'pierceBonus' },
      { id: 'special', kind: 'multiplier', label: '特殊乘区', group: 'direct', order: 110, module: 'specialMult' },
      { id: 'final', kind: 'final', label: '期望伤害', group: 'direct', order: 120, module: 'product', inputs: ['base', 'dmg', 'defense', 'resistance', 'stagger', 'vulnerable', 'crit', 'directMult', 'settlement', 'pierce', 'special'] },
    ],
  },
  {
    id: 'anomaly',
    label: '异常链路',
    appliesTo: { damageKinds: ['attributeAnomaly', 'anomalyRelease', 'disorder', 'turbulence', 'radiance'] },
    scope: 'global',
    targetId: '',
    priority: 0,
    stages: [
      { id: 'base', kind: 'source', label: '异常基础伤害', group: 'anomaly', order: 10, module: 'anomalyBase' },
      { id: 'dmg', kind: 'multiplier', label: '增伤区', group: 'anomaly', order: 20, module: 'percentSum' },
      { id: 'defense', kind: 'multiplier', label: '防御区', group: 'anomaly', order: 30, module: 'defenseMultiplier' },
      { id: 'resistance', kind: 'multiplier', label: '抗性区', group: 'anomaly', order: 40, module: 'resistanceMultiplier' },
      { id: 'stagger', kind: 'multiplier', label: '失衡易伤区', group: 'anomaly', order: 45, module: 'stagger' },
      { id: 'vulnerable', kind: 'multiplier', label: '易伤区', group: 'anomaly', order: 50, module: 'vulnerable' },
      { id: 'mastery', kind: 'multiplier', label: '精通区', group: 'anomaly', order: 60, module: 'masteryZone' },
      { id: 'level', kind: 'multiplier', label: '等级区', group: 'anomaly', order: 70, module: 'levelZone' },
      { id: 'dmgBonus', kind: 'multiplier', label: '子类增伤区', group: 'anomaly', order: 80, module: 'subtypeBonus' },
      { id: 'mult', kind: 'multiplier', label: '子类倍率区', group: 'anomaly', order: 90, module: 'subtypeMult' },
      { id: 'crit', kind: 'multiplier', label: '子类暴击区', group: 'anomaly', order: 100, module: 'crit' },
      { id: 'special', kind: 'multiplier', label: '特殊乘区', group: 'anomaly', order: 110, module: 'specialMult' },
      { id: 'final', kind: 'final', label: '期望伤害', group: 'anomaly', order: 120, module: 'product', inputs: ANOMALY_STAGE_IDS },
    ],
  },
  {
    id: 'radiance-self',
    label: '蕾米埃尔本人耀变链路',
    appliesTo: { damageKinds: ['radiance'] },
    scope: 'global',
    targetId: '',
    priority: 0,
    stages: [
      { id: 'selfAtk', kind: 'source', label: '局内攻击力', group: 'radianceSelf', order: 10, module: 'panel.atk' },
      { id: 'selfMastery', kind: 'multiplier', label: '局内精通区', group: 'radianceSelf', order: 20, module: 'masteryZone' },
      { id: 'specialLevel', kind: 'multiplier', label: '特殊等级区', group: 'radianceSelf', order: 30, module: 'specialLevelZone' },
      { id: 'mutation', kind: 'multiplier', label: '异化系数区', group: 'radianceSelf', order: 40, module: 'mutationZone' },
      { id: 'defense', kind: 'multiplier', label: '防御区', group: 'radianceSelf', order: 50, module: 'defenseMultiplier' },
      { id: 'resistance', kind: 'multiplier', label: '抗性区', group: 'radianceSelf', order: 60, module: 'resistanceMultiplier' },
      { id: 'vulnerable', kind: 'multiplier', label: '易伤区', group: 'radianceSelf', order: 70, module: 'vulnerable' },
      { id: 'stagger', kind: 'multiplier', label: '失衡易伤区', group: 'radianceSelf', order: 80, module: 'stagger' },
      { id: 'radianceBonus', kind: 'multiplier', label: '耀变增伤区', group: 'radianceSelf', order: 90, module: 'subtypeBonus' },
      { id: 'radianceMult', kind: 'multiplier', label: '耀变倍率区', group: 'radianceSelf', order: 100, module: 'subtypeMult' },
      { id: 'crit', kind: 'multiplier', label: '耀变暴击区', group: 'radianceSelf', order: 110, module: 'crit' },
      { id: 'special', kind: 'multiplier', label: '特殊乘区', group: 'radianceSelf', order: 120, module: 'specialMult' },
      { id: 'final', kind: 'final', label: '期望伤害', group: 'radianceSelf', order: 130, module: 'product', inputs: RADIANCE_SELF_STAGE_IDS },
    ],
  },
])

const CHAIN_BY_ID = new Map(BUILT_IN_DAMAGE_CHAINS.map((chain) => [chain.id, chain]))

export function getDamageChain(id: string): DamageChainDefinition | null {
  return CHAIN_BY_ID.get(id) ?? null
}

/** 运行时链路注册（由 `chainSource` 注入；避免 zones 模型层反向依赖数据源） */
let extraDamageChains: readonly DamageChainDefinition[] = []

export function registerRuntimeDamageChains(
  chains: readonly DamageChainDefinition[] | null | undefined,
): void {
  extraDamageChains = [...(chains ?? [])]
}

function defaultDamageChains(): readonly DamageChainDefinition[] {
  return extraDamageChains.length
    ? [...BUILT_IN_DAMAGE_CHAINS, ...extraDamageChains]
    : BUILT_IN_DAMAGE_CHAINS
}

/** 阶段模块白名单：管理端下拉用；求值仍按阶段 id 取现有数值。 */
export interface ChainModuleOption {
  id: string
  label: string
  kind: StageKind
}

export const DAMAGE_CHAIN_MODULE_OPTIONS: readonly ChainModuleOption[] = Object.freeze([
  { id: 'baseDamage', label: 'baseDamage（基础伤害）', kind: 'source' },
  { id: 'anomalyBase', label: 'anomalyBase（异常基础伤害）', kind: 'source' },
  { id: 'panel.atk', label: 'panel.atk（局内攻击力）', kind: 'source' },
  { id: 'panel.field', label: 'panel.field（面板字段）', kind: 'source' },
  { id: 'constant', label: 'constant（常量）', kind: 'source' },
  { id: 'percentSum', label: 'percentSum（1 + Σ%）', kind: 'multiplier' },
  { id: 'defenseMultiplier', label: 'defenseMultiplier（防御区）', kind: 'multiplier' },
  { id: 'resistanceMultiplier', label: 'resistanceMultiplier（抗性区）', kind: 'multiplier' },
  { id: 'stagger', label: 'stagger（失衡 / 帷幕易伤）', kind: 'multiplier' },
  { id: 'vulnerable', label: 'vulnerable（易伤区）', kind: 'multiplier' },
  { id: 'crit', label: 'crit（暴击区）', kind: 'multiplier' },
  { id: 'directMult', label: 'directMult（直伤倍率区）', kind: 'multiplier' },
  { id: 'settlementMult', label: 'settlementMult（决算倍率区）', kind: 'multiplier' },
  { id: 'pierceBonus', label: 'pierceBonus（贯穿增伤区）', kind: 'multiplier' },
  { id: 'sharpenBonus', label: 'sharpenBonus（锐化伤害提升区）', kind: 'multiplier' },
  { id: 'specialMult', label: 'specialMult（特殊乘区）', kind: 'multiplier' },
  { id: 'masteryZone', label: 'masteryZone（精通区）', kind: 'multiplier' },
  { id: 'levelZone', label: 'levelZone（等级区）', kind: 'multiplier' },
  { id: 'subtypeBonus', label: 'subtypeBonus（子类增伤区）', kind: 'multiplier' },
  { id: 'subtypeMult', label: 'subtypeMult（子类倍率区）', kind: 'multiplier' },
  { id: 'specialLevelZone', label: 'specialLevelZone（特殊等级区）', kind: 'multiplier' },
  { id: 'mutationZone', label: 'mutationZone（异化系数区）', kind: 'multiplier' },
  { id: 'min', label: 'min（取小）', kind: 'combine' },
  { id: 'max', label: 'max（取大）', kind: 'combine' },
  { id: 'override', label: 'override（条件覆盖）', kind: 'combine' },
  { id: 'product', label: 'product（连乘汇总）', kind: 'final' },
  { id: 'sum', label: 'sum（求和汇总）', kind: 'final' },
  { id: 'round', label: 'round（取整结算）', kind: 'final' },
])

/** 选择链路：蕾米本人耀变优先；其余异常走 `anomaly`；直伤/锐化走 `direct`。 */
export function resolveDamageChainId(options: {
  damageKind: string
  isSelfRadiance?: boolean
  baseDamageSource?: string | null
  useSharpen?: boolean
}): string {
  if (options.isSelfRadiance && options.damageKind === 'radiance') return 'radiance-self'
  if (options.useSharpen || options.damageKind === 'sharpen') return 'sharpen'
  if (options.damageKind === 'direct') {
    return options.baseDamageSource === 'pierce' ? 'pierce' : 'direct'
  }
  return 'anomaly'
}

/** 链路解析读取的命中上下文（与乘区方案的作用域口径一致） */
export interface DamageChainResolveContext {
  /** 伤害类型；用于链路 `appliesTo.damageKinds` 过滤 */
  damageKind?: string
  /** 基础伤害来源；用于区分纯直伤 / 命破 */
  baseDamageSource?: string | null
  /** 锋御锐化公式（职业锋御或招式 damageType=sharpen） */
  useSharpen?: boolean
  agentId?: string | null
  profession?: string | null
  skillGroupId?: string | null
  skillId?: string | null
  /**
   * 阶段条件求值：拿得到命中上下文时传入（`evaluateZoneCondition`），
   * 缺省表示不判定条件（一律视为成立）。
   */
  matchesCondition?: (when: ZoneCondition | undefined) => boolean
}

export interface ResolvedDamageChainSource {
  scope: ZoneScope
  targetId: string
  priority: number
}

export interface ResolvedDamageChain {
  chainId: string
  label: string
  /** 合并后的阶段（已按 order 升序；已剔除 disable / enabled=false / 条件不成立） */
  stages: StageDefinition[]
  /** 实际参与覆盖的运行时链路（诊断用，按应用顺序） */
  sources: ResolvedDamageChainSource[]
  /** 被运行时方案禁用的阶段 id（用于把禁用反映到结算） */
  disabledStageIds: string[]
  /** 阶段参数里的 `adjustment`（倍率调整，按阶段 id） */
  stageAdjustments: Record<string, number>
}

function chainScopeMatches(chain: DamageChainDefinition, context: DamageChainResolveContext): boolean {
  const scope = chain.scope ?? 'global'
  if (!isZoneScope(scope)) return false
  const targetId = (chain.targetId ?? '').trim()
  if (scope === 'global') return true
  if (!targetId) return false
  switch (scope) {
    case 'profession':
      return Boolean(context.profession) && context.profession === targetId
    case 'agent':
      return Boolean(context.agentId) && context.agentId === targetId
    case 'skillGroup':
      return Boolean(context.skillGroupId) && context.skillGroupId === targetId
    case 'skill':
      return Boolean(context.skillId) && context.skillId === targetId
    default:
      return false
  }
}

function chainDamageKindMatches(
  chain: DamageChainDefinition,
  context: DamageChainResolveContext,
): boolean {
  const kinds = chain.appliesTo?.damageKinds ?? []
  if (kinds.length && context.damageKind && !kinds.includes(context.damageKind)) return false
  const sources = chain.appliesTo?.baseDamageSources ?? []
  if (sources.length && context.baseDamageSource && !sources.includes(context.baseDamageSource)) return false
  return true
}

/** 只覆盖补丁里真正写了的字段，避免 `undefined` 把内置值冲掉 */
function mergeStage(base: StageDefinition, patch: StageDefinition): StageDefinition {
  const merged: StageDefinition = { ...base }
  if (patch.kind) merged.kind = patch.kind
  if (patch.label) merged.label = patch.label
  if (patch.group) merged.group = patch.group
  if (typeof patch.order === 'number' && Number.isFinite(patch.order)) merged.order = patch.order
  if (patch.module !== undefined) merged.module = patch.module
  if (patch.inputs !== undefined) merged.inputs = patch.inputs
  if (patch.params !== undefined) merged.params = patch.params
  if (patch.when !== undefined) merged.when = patch.when
  if (patch.enabled !== undefined) merged.enabled = patch.enabled
  delete merged.action
  return merged
}

/** 输出前补齐展示名/分组：空 label 用阶段 id、空 group 用链路默认分组 */
function finalizeStage(stage: StageDefinition, fallbackGroup: string): StageDefinition {
  return {
    ...stage,
    label: stage.label || stage.id,
    group: stage.group || fallbackGroup,
  }
}

function newStage(patch: StageDefinition, fallbackGroup: string, fallbackOrder: number): StageDefinition {
  const stage: StageDefinition = {
    id: patch.id,
    kind: patch.kind || 'multiplier',
    label: patch.label || patch.id,
    group: patch.group || fallbackGroup,
    order: typeof patch.order === 'number' && Number.isFinite(patch.order) ? patch.order : fallbackOrder,
  }
  if (patch.module !== undefined) stage.module = patch.module
  if (patch.inputs !== undefined) stage.inputs = patch.inputs
  if (patch.params !== undefined) stage.params = patch.params
  if (patch.when !== undefined) stage.when = patch.when
  if (patch.enabled !== undefined) stage.enabled = patch.enabled
  return stage
}

/**
 * 解析链路：内置定义 + 运行时链路按 `scope/priority` 合并。
 *
 * 规则：
 * - 同 `chainKey`（前端 `id`）的运行时链路由弱到强应用（global → 职业 → 角色 → 技能组 → 招式，
 *   同作用域按 `priority`）；`enabled=false` 的运行时链路整条跳过；
 * - 阶段按 `id` 合并：`inherit` 保留内置、`disable` 或 `enabled=false` 移除、其余字段覆盖；
 * - 合并后按 `order` 升序（同 order 保持定义顺序），再剔除条件不成立的阶段。
 */
/**
 * 自定义链路自动选择：id 以 `custom:` 开头、enabled、作用域命中、伤害类型/基础来源匹配的链路，
 * 按作用域优先级 + priority 取最具体的一条。没有则返回 null（继续用内置链路）。
 */
export function findCustomDamageChain(
  context: DamageChainResolveContext = {},
  chains: readonly DamageChainDefinition[] = defaultDamageChains(),
): DamageChainDefinition | null {
  const candidates = chains
    .filter((chain) => chain.id.startsWith('custom:'))
    .filter((chain) => chain.enabled !== false)
    .filter((chain) => chainScopeMatches(chain, context))
    .filter((chain) => chainDamageKindMatches(chain, context))
    .map((chain, index) => ({ chain, index }))
    .sort((a, b) => {
      const rankA = ZONE_SCOPE_RANK[(a.chain.scope ?? 'global') as ZoneScope] ?? 0
      const rankB = ZONE_SCOPE_RANK[(b.chain.scope ?? 'global') as ZoneScope] ?? 0
      if (rankA !== rankB) return rankA - rankB
      const priorityA = a.chain.priority ?? 0
      const priorityB = b.chain.priority ?? 0
      if (priorityA !== priorityB) return priorityA - priorityB
      return a.index - b.index
    })
  return candidates.at(-1)?.chain ?? null
}

export function resolveDamageChain(
  chainId: string,
  context: DamageChainResolveContext = {},
  chains: readonly DamageChainDefinition[] = defaultDamageChains(),
): ResolvedDamageChain {
  const base = chains.find((chain) => chain.id === chainId)
  if (!base) {
    return { chainId, label: chainId, stages: [], sources: [], disabledStageIds: [], stageAdjustments: {} }
  }

  const candidates = chains
    .map((chain, index) => ({ chain, index }))
    .filter(({ chain }) => chain.id === chainId && chain !== base)
    .filter(({ chain }) => chain.enabled !== false)
    .filter(({ chain }) => chainScopeMatches(chain, context))
    .filter(({ chain }) => chainDamageKindMatches(chain, context))
    .sort((a, b) => {
      const rankA = ZONE_SCOPE_RANK[(a.chain.scope ?? 'global') as ZoneScope] ?? 0
      const rankB = ZONE_SCOPE_RANK[(b.chain.scope ?? 'global') as ZoneScope] ?? 0
      if (rankA !== rankB) return rankA - rankB
      const priorityA = a.chain.priority ?? 0
      const priorityB = b.chain.priority ?? 0
      if (priorityA !== priorityB) return priorityA - priorityB
      return a.index - b.index
    })

  let label = base.label || chainId
  const sources: ResolvedDamageChainSource[] = []
  const disabledStageIds: string[] = []
  const stageAdjustments: Record<string, number> = {}
  /** 无运行时覆盖：直接返回内置阶段（不含合并/排序开销） */
  if (!candidates.length) {
    const fallbackGroup = base.stages[0]?.group || chainId
    const stages = base.stages
      .filter((stage) => stage.enabled !== false && stage.action !== 'disable')
      .filter((stage) => (context.matchesCondition ? context.matchesCondition(stage.when) : true))
      .map((stage) => finalizeStage(stage, fallbackGroup))
    return { chainId, label, stages, sources, disabledStageIds, stageAdjustments }
  }

  const stages = base.stages.map((stage) => ({ ...stage }))
  const fallbackGroup = base.stages[0]?.group ?? chainId
  let nextOrder = stages.reduce((max, stage) => Math.max(max, stage.order), 0) + 10

  for (const { chain } of candidates) {
    const scope = (chain.scope ?? 'global') as ZoneScope
    sources.push({ scope, targetId: chain.targetId ?? '', priority: chain.priority ?? 0 })
    if (chain.label) label = chain.label
    for (const patch of chain.stages) {
      const id = typeof patch.id === 'string' ? patch.id.trim() : ''
      if (!id) continue
      const action: StageAction = patch.action ?? (patch.enabled === false ? 'disable' : 'replace')
      const index = stages.findIndex((stage) => stage.id === id)
      if (action === 'disable') {
        if (index >= 0) stages.splice(index, 1)
        if (!disabledStageIds.includes(id)) disabledStageIds.push(id)
        continue
      }
      if (action === 'inherit') continue
      const existing = index >= 0 ? stages[index] : undefined
      if (patch.params && typeof patch.params.adjustment === 'number' && Number.isFinite(patch.params.adjustment)) {
        stageAdjustments[id] = patch.params.adjustment
      }
      if (existing) {
        stages[index] = mergeStage(existing, { ...patch, id })
      } else {
        const created = newStage({ ...patch, id }, fallbackGroup, nextOrder)
        nextOrder = Math.max(nextOrder, created.order) + 10
        stages.push(created)
      }
    }
  }

  const sorted = stages
    .map((stage, index) => ({ stage, index }))
    .sort((a, b) => a.stage.order - b.stage.order || a.index - b.index)
    .map(({ stage }) => finalizeStage(stage, fallbackGroup))
    .filter((stage) => stage.enabled !== false && stage.action !== 'disable')
    .filter((stage) => (context.matchesCondition ? context.matchesCondition(stage.when) : true))

  return { chainId, label, stages: sorted, sources, disabledStageIds, stageAdjustments }
}

/**
 * 生成阶段轨迹：只保留有有限数值的阶段，按阶段顺序返回。
 * `values` 缺省的阶段跳过（例如直伤链里的贯穿/锐化只在实际路径出现时才有值）。
 * `stages` 缺省用内置链路定义；运行时链路解析结果通过第三个参数传入。
 */
export function buildStageTrace(
  chainId: string,
  values: Record<string, number | undefined | null>,
  stages?: readonly StageDefinition[],
): { chainId: string; stages: StageTraceEntry[] } {
  const definitions = stages ?? getDamageChain(chainId)?.stages ?? []
  const entries: StageTraceEntry[] = []
  for (const definition of definitions) {
    if (definition.enabled === false) continue
    const value = values[definition.id]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    entries.push({ ...definition, value })
  }
  return { chainId, stages: entries }
}
