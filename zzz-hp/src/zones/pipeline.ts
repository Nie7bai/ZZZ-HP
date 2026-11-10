/**
 * 计算链路（Pipeline）阶段模型（Phase 4c）。
 *
 * 目标：把一次结算拆成有序阶段（source / multiplier / combine / final），
 * 为后续「管理端编辑链路 + 用户端逐阶段展示」提供稳定结构。
 *
 * 本阶段只生成阶段轨迹（值来自现有计算），**不改任何数值**；
 * 配置化求值在 Phase 4e/4f 接入。黄金对照 `test:zone-golden` 把关。
 */
export type StageKind = 'source' | 'multiplier' | 'combine' | 'final'

export interface StageDefinition {
  id: string
  kind: StageKind
  label: string
  group: string
  order: number
}

export interface DamageChainDefinition {
  id: string
  label: string
  appliesTo: { damageKinds: readonly string[] }
  stages: readonly StageDefinition[]
}

export interface StageTraceEntry extends StageDefinition {
  value: number
}

/** 内置链路定义：阶段顺序与展示名。数值仍由 damageCalc 现有链路产生。 */
export const BUILT_IN_DAMAGE_CHAINS: readonly DamageChainDefinition[] = Object.freeze([
  {
    id: 'direct',
    label: '直伤链路',
    appliesTo: { damageKinds: ['direct', 'sharpen'] },
    stages: [
      { id: 'base', kind: 'source', label: '基础伤害', group: 'direct', order: 10 },
      { id: 'dmg', kind: 'multiplier', label: '增伤区', group: 'direct', order: 20 },
      { id: 'defense', kind: 'multiplier', label: '防御区', group: 'direct', order: 30 },
      { id: 'resistance', kind: 'multiplier', label: '抗性区', group: 'direct', order: 40 },
      { id: 'stagger', kind: 'multiplier', label: '失衡易伤区', group: 'direct', order: 45 },
      { id: 'vulnerable', kind: 'multiplier', label: '易伤区', group: 'direct', order: 50 },
      { id: 'crit', kind: 'multiplier', label: '暴击区', group: 'direct', order: 60 },
      { id: 'directMult', kind: 'multiplier', label: '直伤倍率区', group: 'direct', order: 70 },
      { id: 'settlement', kind: 'multiplier', label: '决算倍率区', group: 'direct', order: 80 },
      { id: 'pierce', kind: 'multiplier', label: '贯穿增伤区', group: 'direct', order: 90 },
      { id: 'sharpen', kind: 'multiplier', label: '锐化伤害提升区', group: 'direct', order: 100 },
      { id: 'special', kind: 'multiplier', label: '特殊乘区', group: 'direct', order: 110 },
      { id: 'final', kind: 'final', label: '期望伤害', group: 'direct', order: 120 },
    ],
  },
  {
    id: 'anomaly',
    label: '异常链路',
    appliesTo: { damageKinds: ['attributeAnomaly', 'anomalyRelease', 'disorder', 'turbulence', 'radiance'] },
    stages: [
      { id: 'base', kind: 'source', label: '异常基础伤害', group: 'anomaly', order: 10 },
      { id: 'dmg', kind: 'multiplier', label: '增伤区', group: 'anomaly', order: 20 },
      { id: 'defense', kind: 'multiplier', label: '防御区', group: 'anomaly', order: 30 },
      { id: 'resistance', kind: 'multiplier', label: '抗性区', group: 'anomaly', order: 40 },
      { id: 'stagger', kind: 'multiplier', label: '失衡易伤区', group: 'anomaly', order: 45 },
      { id: 'vulnerable', kind: 'multiplier', label: '易伤区', group: 'anomaly', order: 50 },
      { id: 'mastery', kind: 'multiplier', label: '精通区', group: 'anomaly', order: 60 },
      { id: 'level', kind: 'multiplier', label: '等级区', group: 'anomaly', order: 70 },
      { id: 'dmgBonus', kind: 'multiplier', label: '子类增伤区', group: 'anomaly', order: 80 },
      { id: 'mult', kind: 'multiplier', label: '子类倍率区', group: 'anomaly', order: 90 },
      { id: 'crit', kind: 'multiplier', label: '子类暴击区', group: 'anomaly', order: 100 },
      { id: 'special', kind: 'multiplier', label: '特殊乘区', group: 'anomaly', order: 110 },
      { id: 'final', kind: 'final', label: '期望伤害', group: 'anomaly', order: 120 },
    ],
  },
  {
    id: 'radiance-self',
    label: '蕾米埃尔本人耀变链路',
    appliesTo: { damageKinds: ['radiance'] },
    stages: [
      { id: 'selfAtk', kind: 'source', label: '局内攻击力', group: 'radianceSelf', order: 10 },
      { id: 'selfMastery', kind: 'multiplier', label: '局内精通区', group: 'radianceSelf', order: 20 },
      { id: 'specialLevel', kind: 'multiplier', label: '特殊等级区', group: 'radianceSelf', order: 30 },
      { id: 'mutation', kind: 'multiplier', label: '异化系数区', group: 'radianceSelf', order: 40 },
      { id: 'defense', kind: 'multiplier', label: '防御区', group: 'radianceSelf', order: 50 },
      { id: 'resistance', kind: 'multiplier', label: '抗性区', group: 'radianceSelf', order: 60 },
      { id: 'vulnerable', kind: 'multiplier', label: '易伤区', group: 'radianceSelf', order: 70 },
      { id: 'stagger', kind: 'multiplier', label: '失衡易伤区', group: 'radianceSelf', order: 80 },
      { id: 'radianceBonus', kind: 'multiplier', label: '耀变增伤区', group: 'radianceSelf', order: 90 },
      { id: 'radianceMult', kind: 'multiplier', label: '耀变倍率区', group: 'radianceSelf', order: 100 },
      { id: 'crit', kind: 'multiplier', label: '耀变暴击区', group: 'radianceSelf', order: 110 },
      { id: 'special', kind: 'multiplier', label: '特殊乘区', group: 'radianceSelf', order: 120 },
      { id: 'final', kind: 'final', label: '期望伤害', group: 'radianceSelf', order: 130 },
    ],
  },
])

const CHAIN_BY_ID = new Map(BUILT_IN_DAMAGE_CHAINS.map((chain) => [chain.id, chain]))

export function getDamageChain(id: string): DamageChainDefinition | null {
  return CHAIN_BY_ID.get(id) ?? null
}

/**
 * 选择链路：蕾米本人耀变优先；其余异常走 `anomaly`；直伤/锐化走 `direct`。
 */
export function resolveDamageChainId(options: {
  damageKind: string
  isSelfRadiance?: boolean
}): string {
  if (options.isSelfRadiance && options.damageKind === 'radiance') return 'radiance-self'
  if (options.damageKind === 'direct' || options.damageKind === 'sharpen') return 'direct'
  return 'anomaly'
}

/**
 * 生成阶段轨迹：只保留有有限数值的阶段，按定义顺序返回。
 * `values` 缺省的阶段跳过（例如直伤链里的贯穿/锐化只在实际路径出现时才有值）。
 */
export function buildStageTrace(
  chainId: string,
  values: Record<string, number | undefined | null>,
): { chainId: string; stages: StageTraceEntry[] } {
  const chain = getDamageChain(chainId)
  if (!chain) return { chainId, stages: [] }
  const stages: StageTraceEntry[] = []
  for (const definition of chain.stages) {
    const value = values[definition.id]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    stages.push({ ...definition, value })
  }
  return { chainId, stages }
}
