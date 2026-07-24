import type { PanelStats } from '@/types/calculatorPanel'
import { effectiveAnomalyDuration, turbulenceUsesAnomalyCrit } from '@/utils/calculatorUi'

export type EnemyResistanceType = 'weak' | 'normal' | 'res20' | 'res40'

export interface DamageEnemyInput {
  defense: number
  resistanceType: EnemyResistanceType
  vulnerableMultiplier: number
  staggerMultiplier: number
  specialMultiplier: number
  level: number
}

export interface DamageCalcInput {
  finalPanel: PanelStats
  piercePower: number
  baseDamageSource: 'atk' | 'pierce'
  isMbMainAgent: boolean
  enemyInput: DamageEnemyInput
  combatVulnerable: number
  /** 全局失衡易伤%（失衡/非失衡均生效） */
  combatGlobalStaggerVulnerable?: number
  /** 失衡易伤%（仅失衡期生效） */
  combatStaggerVulnerable: number
  /** 失衡易伤（仅失衡）% */
  combatStaggerVulnerableOnly?: number
  combatSpecial: number
  /** 贯穿增伤%（独立乘区，仅贯穿力基础直伤生效） */
  combatPierceDmgBonus?: number
  /** 当前是否处于失衡期 */
  staggerPhase?: 'normal' | 'stagger'
  /** 主C 属性，用于火/以太异常持续时间 ÷0.5 */
  mainAgentElement?: string
  /** 主C id，用于角色特例（如简乱流计入异常暴击） */
  mainAgentId?: string
  /** 主C 名称 */
  mainAgentName?: string
}

export interface DamageCalcResult {
  baseDamage: number
  baseDamageSource: 'atk' | 'pierce'
  dmgMultiplier: number
  critRateRatio: number
  critDmgRatio: number
  critMultiplier: number
  penRateRatio: number
  ignoreDefenseRatio: number
  reduceDefenseRatio: number
  defenseFactor: number
  enemyResistance: number
  effectiveDefense: number
  defenseMultiplier: number
  resistanceMultiplier: number
  vulnerableMultiplier: number
  staggerMultiplier: number
  specialMultiplier: number
  /** 贯穿增伤乘区（非贯穿基础时为 1） */
  pierceDmgMultiplier: number
  generalMultiplier: number
  directDmgMultZone: number
  directDamageExpected: number
  masteryZone: number
  levelZone: number
  anomalyDmgBonusZone: number
  anomalyMultZone: number
  anomalyCritRateRatio: number
  anomalyCritDmgRatio: number
  anomalyCritZone: number
  anomalyFullCritZone: number
  /** 异常基础期望（不含异常增伤/倍率/暴击区） */
  anomalyBaseExpected: number
  /** 异常期望伤害（含异常增伤/倍率/暴击区） */
  anomalyExpected: number
  effectiveAnomalyDuration: number
  disorderBaseMultRatio: number
  disorderCompMultRatio: number
  disorderZone: number
  disorderDmgBonusZone: number
  disorderExpected: number
  turbulenceBaseMultRatio: number
  turbulenceCompMultRatio: number
  turbulenceZone: number
  turbulenceDmgBonusZone: number
  /** 乱流增伤区 + 异常增伤区（百分点加算后乘区） */
  turbulenceCombinedDmgBonusZone: number
  /** 乱流期望是否计入异常暴击区（简） */
  turbulenceUsesAnomalyCrit: boolean
  turbulenceExpected: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

const RESISTANCE_MAP: Record<EnemyResistanceType, number> = {
  weak: -0.2,
  normal: 0,
  res20: 0.2,
  res40: 0.4,
}

export function computeLevelZone(level: number) {
  const safeLevel = clamp(Math.round(level), 1, 60)
  return 1 + (safeLevel - 1) / 59
}

export function computeDamageResult(input: DamageCalcInput): DamageCalcResult {
  const panel = input.finalPanel
  const enemyRes = RESISTANCE_MAP[input.enemyInput.resistanceType]
  const element = input.mainAgentElement ?? ''

  const baseDamage =
    input.baseDamageSource === 'atk' && !input.isMbMainAgent
      ? panel.atk
      : input.piercePower

  const dmgMultiplier = 1 + clamp(panel.dmgBonus / 100, -0.95, 20)
  const critRateRatio = clamp(panel.critRate / 100, 0, 1)
  const critDmgRatio = clamp(panel.critDmg / 100, 0, 20)
  const critMultiplier = 1 + critRateRatio * critDmgRatio

  const penRateRatio = clamp(panel.penRate / 100, 0, 0.95)
  const ignoreDefenseRatio = clamp(panel.ignoreDefense / 100, 0, 1)
  const reduceDefenseRatio = clamp(panel.reduceDefense / 100, 0, 1)
  const defenseFactor = Math.max(0, 1 - ignoreDefenseRatio - reduceDefenseRatio)
  const defenseAfterModifiers = input.enemyInput.defense * defenseFactor * (1 - penRateRatio)
  const effectiveDefense = Math.max(0, defenseAfterModifiers) - panel.pen
  const defenseMultiplier = input.isMbMainAgent ? 1 : 794 / (794 + effectiveDefense)
  const resistanceMultiplier = 1 - enemyRes + clamp(panel.resPen / 100, -2, 2)

  const vulnerableMultiplier =
    input.enemyInput.vulnerableMultiplier + input.combatVulnerable / 100
  const staggerPhase = input.staggerPhase ?? 'stagger'
  const globalStagger = (input.combatGlobalStaggerVulnerable ?? 0) / 100
  const phaseStagger =
    staggerPhase === 'stagger'
      ? (input.combatStaggerVulnerable + (input.combatStaggerVulnerableOnly ?? 0)) / 100
      : 0
  const staggerMultiplier =
    input.enemyInput.staggerMultiplier + globalStagger + phaseStagger
  const specialMultiplier = input.enemyInput.specialMultiplier + input.combatSpecial / 100
  const pierceDmgBonusRatio = (input.combatPierceDmgBonus ?? 0) / 100

  const generalMultiplier =
    baseDamage *
    dmgMultiplier *
    defenseMultiplier *
    resistanceMultiplier *
    Math.max(0, vulnerableMultiplier) *
    Math.max(0, staggerMultiplier)

  const usedBaseSource: 'atk' | 'pierce' =
    input.baseDamageSource === 'atk' && !input.isMbMainAgent ? 'atk' : 'pierce'
  const pierceDmgMultiplier =
    usedBaseSource === 'pierce' ? 1 + pierceDmgBonusRatio : 1

  const directDmgMultZone = Math.max(0, panel.directDmgMult / 100)
  const directDamageExpected =
    generalMultiplier *
    critMultiplier *
    Math.max(0, specialMultiplier) *
    Math.max(0, pierceDmgMultiplier) *
    directDmgMultZone

  const masteryZone = panel.mastery / 100
  const levelZone = computeLevelZone(input.enemyInput.level)
  const anomalyDmgBonusZone =
    1 + (panel.anomalyDmgBonus + panel.anomalyReleaseDmgBonus) / 100
  const anomalyMultZone = Math.max(
    0,
    (panel.anomalyMult + panel.anomalyReleaseMult) / 100,
  )
  const disorderDmgBonusZone = 1 + panel.disorderDmgBonus / 100
  const turbulenceDmgBonusZone = 1 + panel.turbulenceDmgBonus / 100
  const turbulenceCombinedDmgBonusZone =
    1 +
    (panel.turbulenceDmgBonus + panel.anomalyDmgBonus + panel.anomalyReleaseDmgBonus) /
      100

  const anomalyCritRateRatio =
    (panel.anomalyCritRate + panel.anomalyReleaseCritRate) / 100
  const anomalyCritDmgRatio = clamp(
    (panel.anomalyCritDmg + panel.anomalyReleaseCritDmg) / 100,
    0,
    20,
  )
  const anomalyCritZone = 1 + anomalyCritRateRatio * anomalyCritDmgRatio
  const anomalyFullCritZone = 1 + anomalyCritDmgRatio

  // 异常基础期望：通用 × 精通 × 等级 × 特殊补充（不含异常增伤/倍率/暴击）
  const anomalyBaseExpected =
    generalMultiplier * masteryZone * levelZone * Math.max(0, specialMultiplier)
  // 异常期望伤害：异常基础 × 异常增伤 × 异常倍率 × 异常暴击
  const anomalyExpected =
    anomalyBaseExpected * anomalyDmgBonusZone * anomalyMultZone * anomalyCritZone

  const effectiveDuration = effectiveAnomalyDuration(panel.anomalyDuration, element)
  const disorderBaseMultRatio = panel.disorderBaseMult / 100
  const disorderCompMultRatio = panel.disorderCompMult / 100
  const disorderZone = Math.max(
    0,
    disorderBaseMultRatio + effectiveDuration * disorderCompMultRatio,
  )
  const disorderExpected = anomalyBaseExpected * disorderZone * disorderDmgBonusZone

  const turbulenceBaseMultRatio = panel.turbulenceBaseMult / 100
  const turbulenceCompMultRatio = panel.turbulenceCompMult / 100
  const turbulenceZone = Math.max(
    0,
    turbulenceBaseMultRatio + effectiveDuration * turbulenceCompMultRatio,
  )
  const useTurbulenceAnomalyCrit = turbulenceUsesAnomalyCrit(
    input.mainAgentId ?? '',
    input.mainAgentName ?? '',
  )
  let turbulenceExpected =
    anomalyBaseExpected * turbulenceZone * turbulenceCombinedDmgBonusZone
  if (useTurbulenceAnomalyCrit) {
    turbulenceExpected *= anomalyCritZone
  }

  return {
    baseDamage: round(baseDamage, 2),
    baseDamageSource: usedBaseSource,
    dmgMultiplier: round(dmgMultiplier, 4),
    critRateRatio: round(critRateRatio, 4),
    critDmgRatio: round(critDmgRatio, 4),
    critMultiplier: round(critMultiplier, 4),
    penRateRatio: round(penRateRatio, 4),
    ignoreDefenseRatio: round(ignoreDefenseRatio, 4),
    reduceDefenseRatio: round(reduceDefenseRatio, 4),
    defenseFactor: round(defenseFactor, 4),
    enemyResistance: enemyRes,
    effectiveDefense: round(effectiveDefense, 2),
    defenseMultiplier: round(defenseMultiplier, 4),
    resistanceMultiplier: round(resistanceMultiplier, 4),
    vulnerableMultiplier: round(vulnerableMultiplier, 4),
    staggerMultiplier: round(staggerMultiplier, 4),
    specialMultiplier: round(specialMultiplier, 4),
    pierceDmgMultiplier: round(pierceDmgMultiplier, 4),
    generalMultiplier: round(generalMultiplier, 2),
    directDmgMultZone: round(directDmgMultZone, 4),
    directDamageExpected: round(directDamageExpected, 0),
    masteryZone: round(masteryZone, 4),
    levelZone: round(levelZone, 4),
    anomalyDmgBonusZone: round(anomalyDmgBonusZone, 4),
    anomalyMultZone: round(anomalyMultZone, 4),
    anomalyCritRateRatio: round(anomalyCritRateRatio, 4),
    anomalyCritDmgRatio: round(anomalyCritDmgRatio, 4),
    anomalyCritZone: round(anomalyCritZone, 4),
    anomalyFullCritZone: round(anomalyFullCritZone, 4),
    anomalyBaseExpected: round(anomalyBaseExpected, 0),
    anomalyExpected: round(anomalyExpected, 0),
    effectiveAnomalyDuration: round(effectiveDuration, 4),
    disorderBaseMultRatio: round(disorderBaseMultRatio, 4),
    disorderCompMultRatio: round(disorderCompMultRatio, 4),
    disorderZone: round(disorderZone, 4),
    disorderDmgBonusZone: round(disorderDmgBonusZone, 4),
    disorderExpected: round(disorderExpected, 0),
    turbulenceBaseMultRatio: round(turbulenceBaseMultRatio, 4),
    turbulenceCompMultRatio: round(turbulenceCompMultRatio, 4),
    turbulenceZone: round(turbulenceZone, 4),
    turbulenceDmgBonusZone: round(turbulenceDmgBonusZone, 4),
    turbulenceCombinedDmgBonusZone: round(turbulenceCombinedDmgBonusZone, 4),
    turbulenceUsesAnomalyCrit: useTurbulenceAnomalyCrit,
    turbulenceExpected: round(turbulenceExpected, 0),
  }
}
