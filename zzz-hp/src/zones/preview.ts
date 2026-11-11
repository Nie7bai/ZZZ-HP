import { createDefaultExternalPanel } from '@/types/calculatorPanel'
import { computeDamageResult } from '@/utils/damageCalc'
import { getDamageChain, type StageDefinition, type StageTraceEntry } from './pipeline'

/**
 * 管理端链路预览（Phase 4f-4）。
 *
 * 用固定示例面板/敌人跑一次结算，返回：
 * - 当前方案的逐阶段值；
 * - 当前方案最终伤害；
 * - 同链路内置阶段的最终伤害（用于对比）。
 *
 * 只用于管理端预览，不写库、不影响用户端。
 */
export interface DamageChainPreview {
  chainId: string
  stages: StageTraceEntry[]
  final: number
  baselineFinal: number
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
  if (chainId === 'attributeAnomaly') return result.attributeAnomalyExpected
  if (chainId === 'anomalyRelease') return result.anomalyReleaseExpected
  if (chainId === 'disorder') return result.disorderExpected
  if (chainId === 'turbulence') return result.turbulenceExpected
  return result.directDamageExpected
}

export function previewDamageChain(
  chainId: string,
  stages: readonly StageDefinition[],
  customMods: Record<string, number> = {},
): DamageChainPreview {
  const builtin = getDamageChain(chainId)?.stages ?? []
  const baseInput = {
    finalPanel: samplePanel(),
    piercePower: 0,
    baseDamageSource: 'atk' as const,
    isMbMainAgent: false,
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
    anomalySubKind: 'attributeAnomaly' as const,
    combatCustom: customMods,
  }
  const current = computeDamageResult({ ...baseInput, chainId, chainStages: [...stages] })
  const baseline = computeDamageResult({ ...baseInput, chainId, chainStages: [...builtin] })
  return {
    chainId,
    stages: current.pipeline?.stages ?? [],
    final: pickFinal(current, chainId),
    baselineFinal: pickFinal(baseline, chainId),
  }
}
