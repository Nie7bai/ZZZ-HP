import { createDefaultExternalPanel } from '@/types/calculatorPanel'
import { computeDamageResult } from '@/utils/damageCalc'
import { getDamageChain, type StageDefinition, type StageTraceEntry } from './pipeline'

/**
 * 管理端链路预览（Phase 4f-4）。
 *
 * 用一组内置示例命中（`DAMAGE_CHAIN_SAMPLE_HITS`）跑一次结算，返回：
 * - 当前方案的逐阶段值；
 * - 当前方案最终伤害；
 * - 同链路内置阶段的最终伤害（用于对比）。
 *
 * 只用于管理端预览，不写库、不影响用户端；示例面板/敌人是合成值，
 * 与线上真实面板无关，差异只用于判断「这条链路改了什么」。
 */
export interface DamageChainPreview {
  chainId: string
  stages: StageTraceEntry[]
  final: number
  baselineFinal: number
  /** 预览使用的示例命中 id */
  sampleId: string
  /** 示例命中的展示名 */
  sampleLabel: string
}

/** 示例命中：覆盖直伤 / 锋御 / 命破 / 异常各子类，让预览能选伤害类型 */
export interface DamageChainSampleHit {
  id: string
  label: string
  /** 预览用伤害类型（与链路 `appliesTo.damageKinds` 对齐） */
  damageKind: string
  baseDamageSource: 'atk' | 'def' | 'pierce'
  anomalySubKind: 'attributeAnomaly' | 'anomalyRelease' | 'disorder' | 'turbulence' | 'radiance'
  useSharpen?: boolean
  /** 蕾米埃尔本人耀变：走独立自结算链路 */
  selfRadiance?: boolean
}

export const DAMAGE_CHAIN_SAMPLE_HITS: readonly DamageChainSampleHit[] = Object.freeze([
  { id: 'direct', label: '普通直伤', damageKind: 'direct', baseDamageSource: 'atk', anomalySubKind: 'attributeAnomaly' },
  { id: 'sharpen', label: '锋御', damageKind: 'sharpen', baseDamageSource: 'def', anomalySubKind: 'attributeAnomaly', useSharpen: true },
  { id: 'pierce', label: '命破', damageKind: 'direct', baseDamageSource: 'pierce', anomalySubKind: 'attributeAnomaly' },
  { id: 'attributeAnomaly', label: '属性异常', damageKind: 'attributeAnomaly', baseDamageSource: 'atk', anomalySubKind: 'attributeAnomaly' },
  { id: 'anomalyRelease', label: '异放', damageKind: 'anomalyRelease', baseDamageSource: 'atk', anomalySubKind: 'anomalyRelease' },
  { id: 'disorder', label: '紊乱', damageKind: 'disorder', baseDamageSource: 'atk', anomalySubKind: 'disorder' },
  { id: 'turbulence', label: '乱流', damageKind: 'turbulence', baseDamageSource: 'atk', anomalySubKind: 'turbulence' },
  { id: 'radiance', label: '耀变（非本人）', damageKind: 'radiance', baseDamageSource: 'atk', anomalySubKind: 'radiance' },
  { id: 'radianceSelf', label: '蕾米埃尔本人耀变', damageKind: 'radiance', baseDamageSource: 'atk', anomalySubKind: 'radiance', selfRadiance: true },
])

export function getDamageChainSampleHit(sampleId: string | null | undefined): DamageChainSampleHit {
  const fallback = DAMAGE_CHAIN_SAMPLE_HITS[0]!
  return DAMAGE_CHAIN_SAMPLE_HITS.find((item) => item.id === sampleId) ?? fallback
}

function sampleEnemy() {
  return {
    defense: 953,
    resistanceType: 'normal' as const,
    vulnerableMultiplier: 1,
    staggerMultiplier: 1.5,
    specialMultiplier: 1,
    level: 60,
  }
}

function samplePanel() {
  const panel = createDefaultExternalPanel()
  panel.atk = 3000
  panel.dmgBonus = 50
  panel.critRate = 50
  panel.critDmg = 100
  panel.mastery = 300
  panel.directDmgMult = 100
  return panel
}

function pickFinal(result: ReturnType<typeof computeDamageResult>, chainId: string): number {
  if (chainId === 'direct' || chainId === 'sharpen' || chainId === 'pierce') return result.directDamageExpected
  if (chainId === 'radiance-self' || chainId === 'radiance') return result.radianceExpected
  if (chainId === 'attributeAnomaly' || chainId === 'anomaly') return result.attributeAnomalyExpected
  if (chainId === 'anomalyRelease') return result.anomalyReleaseExpected
  if (chainId === 'disorder') return result.disorderExpected
  if (chainId === 'turbulence') return result.turbulenceExpected
  return result.directDamageExpected
}

export function previewDamageChain(
  chainId: string,
  stages: readonly StageDefinition[],
  customMods: Record<string, number> = {},
  sampleId?: string | null,
): DamageChainPreview {
  const builtin = getDamageChain(chainId)?.stages ?? []
  const sample = getDamageChainSampleHit(sampleId)
  const baseInput = {
    finalPanel: samplePanel(),
    piercePower: sample.baseDamageSource === 'pierce' ? 1200 : 0,
    baseDamageSource: sample.baseDamageSource,
    isMbMainAgent: sample.baseDamageSource === 'pierce',
    useSharpenFormula: sample.useSharpen === true,
    enemyInput: sampleEnemy(),
    combatVulnerable: 0,
    combatDirectVulnerable: 0,
    combatAnomalyVulnerable: 0,
    combatDmgReduction: 0,
    combatDirectDmgReduction: 0,
    combatAnomalyDmgReduction: 0,
    combatGlobalStaggerVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatStaggerVulnerableOnly: 0,
    combatSpecial: 0,
    combatPierceDmgBonus: 0,
    staggerPhase: 'normal' as const,
    ownerAgentLevel: 60,
    anomalySubKind: sample.anomalySubKind,
    combatCustom: customMods,
  }
  const current = computeDamageResult({ ...baseInput, chainId, chainStages: [...stages] })
  const baseline = computeDamageResult({ ...baseInput, chainId, chainStages: [...builtin] })
  return {
    chainId,
    stages: current.pipeline?.stages ?? [],
    final: pickFinal(current, chainId),
    baselineFinal: pickFinal(baseline, chainId),
    sampleId: sample.id,
    sampleLabel: sample.label,
  }
}
