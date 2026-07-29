import type { AnomalyDamageSubKind, BaseDamageSource, SkillSubcategory } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import { effectiveAnomalyDuration } from '@/utils/calculatorUi'
import { resolveSkillMults } from '@/utils/skillSubcategoryMult'

export type EnemyResistanceType = 'weak' | 'normal' | 'res20' | 'res40'

export interface DamageEnemyInput {
  defense: number
  resistanceType: EnemyResistanceType
  vulnerableMultiplier: number
  staggerMultiplier: number
  specialMultiplier: number
  level: number
}

export type { BaseDamageSource }

export interface DamageCalcInput {
  finalPanel: PanelStats
  piercePower: number
  baseDamageSource: BaseDamageSource
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
  /** 主C id（预留） */
  mainAgentId?: string
  /** 主C 名称 */
  mainAgentName?: string
  /** 异常子类 */
  anomalySubKind?: AnomalyDamageSubKind
  /**
   * 触发异常角色最终面板（乱流/异放的异常基础乘区）。
   * 缺省时异常基础仍用 finalPanel（主 C）。
   */
  triggerFinalPanel?: PanelStats
  /** 触发角色元素（影响异常有效持续时间，若走触发面板） */
  triggerAgentElement?: string
  /** 触发角色 piercePower（命破等）；缺省用主 C piercePower */
  triggerPiercePower?: number
  triggerBaseDamageSource?: BaseDamageSource
  triggerIsMb?: boolean
  /** 当前招式小类（有则优先采用小类倍率） */
  skillSubcategory?: SkillSubcategory | null
}

export interface DamageCalcResult {
  baseDamage: number
  baseDamageSource: BaseDamageSource
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
  /** 决算倍率区（直伤大类下的独立伤害分量） */
  settlementDmgMultZone: number
  /** 直伤倍率分量期望伤害 */
  directDamageFromDirectMult: number
  /** 决算倍率分量期望伤害 */
  settlementDamageExpected: number
  directDamageExpected: number
  masteryZone: number
  levelZone: number
  anomalyDmgBonusZone: number
  anomalyMultZone: number
  anomalyCritRateRatio: number
  anomalyCritDmgRatio: number
  anomalyCritZone: number
  /** 普通异常暴击区（暴击率强制为 1） */
  anomalyFullCritZone: number
  /** 异常基础期望（不含异常增伤/倍率/暴击区） */
  anomalyBaseExpected: number
  /** 异常期望伤害（实际暴击率加权；不含异放） */
  anomalyExpected: number
  /** 异常伤害（暴击率=0，不触发暴击） */
  anomalyExpectedNoCrit: number
  /** 异常伤害（暴击率=1，必定暴击） */
  anomalyExpectedFullCrit: number
  /** 异放增伤区 */
  anomalyReleaseDmgBonusZone: number
  /** 异放综合增伤区 = 异放增伤区 + 异常增伤区 */
  anomalyReleaseCombinedDmgBonusZone: number
  /** 异放倍率区 */
  anomalyReleaseMultZone: number
  /** 异放暴击区（单独期望形式，仅展示参考） */
  anomalyReleaseCritZone: number
  /** 综合暴击率比值 = 异常暴击率 + 异放暴击率 */
  anomalyCombinedCritRateRatio: number
  /** 综合爆伤比值 = 异常爆伤 + 异放爆伤 */
  anomalyCombinedCritDmgRatio: number
  /**
   * 异常综合暴击区 =
   * 1 + (异常暴击 + 异放暴击) × (异常爆伤 + 异放爆伤)
   */
  anomalyCombinedCritZone: number
  /** 异常综合暴击区（暴击率强制为 1） */
  anomalyCombinedFullCritZone: number
  /** 异放期望伤害（实际综合暴击率加权） */
  anomalyReleaseExpected: number
  /** 异放伤害（暴击率=0） */
  anomalyReleaseExpectedNoCrit: number
  /** 异放伤害（暴击率=1） */
  anomalyReleaseExpectedFullCrit: number
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
  /** 乱流增伤区 + 异常增伤区（百分点加算后乘区；不含异放） */
  turbulenceCombinedDmgBonusZone: number
  /** 乱流是否乘了非 1 的异常暴击区（有普通异常暴击时为 true） */
  turbulenceUsesAnomalyCrit: boolean
  turbulenceExpected: number
  /** 乱流伤害（暴击率=0） */
  turbulenceExpectedNoCrit: number
  /** 乱流伤害（暴击率=1） */
  turbulenceExpectedFullCrit: number
  /** 有招式紊乱倍率贡献时为极性紊乱 */
  hasPolarDisorder: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

import { multFactorPercentToRatio } from '@/utils/multFactorPercent'

function readFactor(value: number | undefined | null, fallback = 1): number {
  return multFactorPercentToRatio(value) || fallback
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

function resolveBaseDamageParts(options: {
  panel: PanelStats
  piercePower: number
  baseDamageSource: BaseDamageSource
  isMb: boolean
}) {
  if (options.isMb || options.baseDamageSource === 'pierce') {
    return { baseDamage: options.piercePower, usedBaseSource: 'pierce' as const }
  }
  if (options.baseDamageSource === 'def') {
    return { baseDamage: options.panel.def, usedBaseSource: 'def' as const }
  }
  return { baseDamage: options.panel.atk, usedBaseSource: 'atk' as const }
}

function computeGeneralAndAnomalyBase(options: {
  panel: PanelStats
  piercePower: number
  baseDamageSource: BaseDamageSource
  isMb: boolean
  enemyInput: DamageEnemyInput
  combatVulnerable: number
  combatGlobalStaggerVulnerable: number
  combatStaggerVulnerable: number
  combatStaggerVulnerableOnly: number
  combatSpecial: number
  combatPierceDmgBonus: number
  staggerPhase: 'normal' | 'stagger'
  /** 防御区穿透/减防分项；缺省与 panel 一致 */
  defensePanel?: Pick<PanelStats, 'penRate' | 'pen' | 'ignoreDefense' | 'reduceDefense'>
}) {
  const panel = options.panel
  const defense = options.defensePanel ?? panel
  const enemyRes = RESISTANCE_MAP[options.enemyInput.resistanceType]

  const { baseDamage, usedBaseSource } = resolveBaseDamageParts({
    panel,
    piercePower: options.piercePower,
    baseDamageSource: options.baseDamageSource,
    isMb: options.isMb,
  })

  const dmgMultiplier = 1 + clamp(panel.dmgBonus / 100, -0.95, 20)
  const critRateRatio = clamp(panel.critRate / 100, 0, 1)
  const critDmgRatio = clamp(panel.critDmg / 100, 0, 20)
  const critMultiplier = 1 + critRateRatio * critDmgRatio

  const penRateRatio = clamp(defense.penRate / 100, 0, 0.95)
  const ignoreDefenseRatio = clamp(defense.ignoreDefense / 100, 0, 1)
  const reduceDefenseRatio = clamp(defense.reduceDefense / 100, 0, 1)
  const defenseFactor = Math.max(0, 1 - ignoreDefenseRatio - reduceDefenseRatio)
  const defenseAfterModifiers = options.enemyInput.defense * defenseFactor * (1 - penRateRatio)
  const effectiveDefense = Math.max(0, defenseAfterModifiers) - defense.pen
  const defenseMultiplier = options.isMb ? 1 : 794 / (794 + effectiveDefense)
  const resistanceMultiplier = 1 - enemyRes + clamp(panel.resPen / 100, -2, 2)

  const vulnerableMultiplier =
    options.enemyInput.vulnerableMultiplier + options.combatVulnerable / 100
  const globalStagger = options.combatGlobalStaggerVulnerable / 100
  const phaseStagger =
    options.staggerPhase === 'stagger'
      ? (options.combatStaggerVulnerable + options.combatStaggerVulnerableOnly) / 100
      : 0
  const staggerMultiplier =
    options.enemyInput.staggerMultiplier + globalStagger + phaseStagger
  const specialMultiplier = options.enemyInput.specialMultiplier + options.combatSpecial / 100
  const pierceDmgBonusRatio = options.combatPierceDmgBonus / 100

  const generalMultiplier =
    baseDamage *
    dmgMultiplier *
    defenseMultiplier *
    resistanceMultiplier *
    Math.max(0, vulnerableMultiplier) *
    Math.max(0, staggerMultiplier)

  const pierceDmgMultiplier =
    usedBaseSource === 'pierce' ? 1 + pierceDmgBonusRatio : 1

  const masteryZone = panel.mastery / 100
  const levelZone = computeLevelZone(options.enemyInput.level)
  const anomalyBaseExpected =
    generalMultiplier * masteryZone * levelZone * Math.max(0, specialMultiplier)

  return {
    baseDamage,
    usedBaseSource,
    dmgMultiplier,
    critRateRatio,
    critDmgRatio,
    critMultiplier,
    penRateRatio,
    ignoreDefenseRatio,
    reduceDefenseRatio,
    defenseFactor,
    enemyRes,
    effectiveDefense,
    defenseMultiplier,
    resistanceMultiplier,
    vulnerableMultiplier,
    staggerMultiplier,
    specialMultiplier,
    pierceDmgMultiplier,
    generalMultiplier,
    masteryZone,
    levelZone,
    anomalyBaseExpected,
  }
}

export function computeDamageResult(input: DamageCalcInput): DamageCalcResult {
  const panel = input.finalPanel
  const staggerPhase = input.staggerPhase ?? 'stagger'
  const subKind = input.anomalySubKind ?? 'anomaly'
  const useTriggerBase =
    (subKind === 'turbulence' || subKind === 'anomalyRelease' || subKind === 'disorder') &&
    Boolean(input.triggerFinalPanel)

  const triggerPanel = input.triggerFinalPanel ?? panel
  const usesProducerMultPanel =
    useTriggerBase && (subKind === 'turbulence' || subKind === 'disorder')
  const multPanel = usesProducerMultPanel ? triggerPanel : panel

  const skillMults = input.skillSubcategory
    ? resolveSkillMults(multPanel, input.skillSubcategory)
    : null
  const hasPolarDisorder = skillMults?.hasPolarDisorder ?? false

  const mainParts = computeGeneralAndAnomalyBase({
    panel,
    piercePower: input.piercePower,
    baseDamageSource: input.baseDamageSource,
    isMb: input.isMbMainAgent,
    enemyInput: input.enemyInput,
    combatVulnerable: input.combatVulnerable,
    combatGlobalStaggerVulnerable: input.combatGlobalStaggerVulnerable ?? 0,
    combatStaggerVulnerable: input.combatStaggerVulnerable,
    combatStaggerVulnerableOnly: input.combatStaggerVulnerableOnly ?? 0,
    combatSpecial: input.combatSpecial,
    combatPierceDmgBonus: input.combatPierceDmgBonus ?? 0,
    staggerPhase,
  })

  const triggerParts = useTriggerBase
    ? computeGeneralAndAnomalyBase({
        panel: triggerPanel,
        piercePower: input.triggerPiercePower ?? input.piercePower,
        baseDamageSource: input.triggerBaseDamageSource ?? input.baseDamageSource,
        isMb: input.triggerIsMb ?? false,
        enemyInput: input.enemyInput,
        combatVulnerable: input.combatVulnerable,
        combatGlobalStaggerVulnerable: input.combatGlobalStaggerVulnerable ?? 0,
        combatStaggerVulnerable: input.combatStaggerVulnerable,
        combatStaggerVulnerableOnly: input.combatStaggerVulnerableOnly ?? 0,
        combatSpecial: input.combatSpecial,
        combatPierceDmgBonus: input.combatPierceDmgBonus ?? 0,
        staggerPhase,
        // 异常基础防御区：穿透率/穿透值取产生角色，减防/无视防御取主 C
        defensePanel: {
          penRate: triggerPanel.penRate,
          pen: triggerPanel.pen,
          ignoreDefense: panel.ignoreDefense,
          reduceDefense: panel.reduceDefense,
        },
      })
    : mainParts

  const directDmgMultZone = skillMults
    ? skillMults.directDmgMultZone
    : Math.max(0, panel.directDmgMult / 100) * readFactor(panel.directDmgMultFactor)
  const settlementDmgMultZone = skillMults
    ? skillMults.settlementDmgMultZone
    : Math.max(0, panel.settlementDmgMult / 100) * readFactor(panel.directDmgMultFactor)
  const directBaseChain =
    mainParts.generalMultiplier *
    mainParts.critMultiplier *
    Math.max(0, mainParts.specialMultiplier) *
    Math.max(0, mainParts.pierceDmgMultiplier)
  const directDamageFromDirectMult = directBaseChain * directDmgMultZone
  const settlementDamageExpected = directBaseChain * settlementDmgMultZone
  const directDamageExpected = directDamageFromDirectMult + settlementDamageExpected

  // 异常乘区：仅异常字段，不再并入异放
  const anomalyDmgBonusZone = 1 + panel.anomalyDmgBonus / 100
  const anomalyMultZone =
    Math.max(0, panel.anomalyMult / 100) * readFactor(panel.anomalyMultFactor)
  const anomalyCritRateRatio = panel.anomalyCritRate / 100
  const anomalyCritDmgRatio = clamp(panel.anomalyCritDmg / 100, 0, 20)
  const anomalyCritZone = 1 + anomalyCritRateRatio * anomalyCritDmgRatio
  const anomalyFullCritZone = 1 + anomalyCritDmgRatio
  const anomalyNoCritZone = 1

  const anomalyBaseExpected = triggerParts.anomalyBaseExpected
  const anomalyPreCrit =
    anomalyBaseExpected * anomalyDmgBonusZone * anomalyMultZone
  const anomalyExpected = anomalyPreCrit * anomalyCritZone
  const anomalyExpectedNoCrit = anomalyPreCrit * anomalyNoCritZone
  const anomalyExpectedFullCrit = anomalyPreCrit * anomalyFullCritZone

  // 异放：基础用触发面板；综合增伤加算；综合暴击率/爆伤加算后再乘
  const anomalyReleaseDmgBonusZone = 1 + panel.anomalyReleaseDmgBonus / 100
  const anomalyReleaseCombinedDmgBonusZone =
    1 + (panel.anomalyReleaseDmgBonus + panel.anomalyDmgBonus) / 100
  const anomalyReleaseMultZone = skillMults
    ? skillMults.anomalyReleaseMultZone
    : Math.max(0, panel.anomalyReleaseMult / 100) *
        readFactor(panel.anomalyReleaseMultFactor)
  const releaseCritRateRatio = panel.anomalyReleaseCritRate / 100
  const releaseCritDmgRatio = clamp(panel.anomalyReleaseCritDmg / 100, 0, 20)
  const anomalyReleaseCritZone = 1 + releaseCritRateRatio * releaseCritDmgRatio
  const anomalyCombinedCritRateRatio = anomalyCritRateRatio + releaseCritRateRatio
  const anomalyCombinedCritDmgRatio = anomalyCritDmgRatio + releaseCritDmgRatio
  /** 1 + (异常暴击 + 异放暴击) × (异常爆伤 + 异放爆伤) */
  const anomalyCombinedCritZone =
    1 + anomalyCombinedCritRateRatio * anomalyCombinedCritDmgRatio
  const anomalyCombinedFullCritZone = 1 + anomalyCombinedCritDmgRatio
  const anomalyCombinedNoCritZone = 1
  const anomalyReleasePreCrit =
    anomalyBaseExpected *
    anomalyReleaseCombinedDmgBonusZone *
    anomalyReleaseMultZone
  const anomalyReleaseExpected = anomalyReleasePreCrit * anomalyCombinedCritZone
  const anomalyReleaseExpectedNoCrit =
    anomalyReleasePreCrit * anomalyCombinedNoCritZone
  const anomalyReleaseExpectedFullCrit =
    anomalyReleasePreCrit * anomalyCombinedFullCritZone

  const durationElement = useTriggerBase
    ? (input.triggerAgentElement ?? input.mainAgentElement ?? '')
    : (input.mainAgentElement ?? '')
  const effectiveDuration = effectiveAnomalyDuration(
    (useTriggerBase ? triggerPanel : panel).anomalyDuration || panel.anomalyDuration,
    durationElement,
  )

  const disorderDmgBonusZone = 1 + panel.disorderDmgBonus / 100
  const disorderBaseMultRatio = skillMults
    ? skillMults.disorderMultZone
    : Math.max(0, multPanel.disorderBaseMult / 100) * readFactor(multPanel.disorderBaseMultFactor)
  const disorderCompMultRatio = multPanel.disorderCompMult / 100
  const disorderZone = Math.max(
    0,
    disorderBaseMultRatio + effectiveDuration * disorderCompMultRatio,
  )
  const disorderBase = useTriggerBase ? triggerParts.anomalyBaseExpected : mainParts.anomalyBaseExpected
  const disorderExpected = disorderBase * disorderZone * disorderDmgBonusZone

  const turbulenceDmgBonusZone = 1 + panel.turbulenceDmgBonus / 100
  const turbulenceCombinedDmgBonusZone =
    1 + (panel.turbulenceDmgBonus + panel.anomalyDmgBonus) / 100
  const turbulenceBaseMultRatio =
    Math.max(0, multPanel.turbulenceBaseMult / 100) *
      readFactor(multPanel.turbulenceBaseMultFactor)
  const turbulenceCompMultRatio = multPanel.turbulenceCompMult / 100
  const turbulenceZone = Math.max(
    0,
    turbulenceBaseMultRatio + effectiveDuration * turbulenceCompMultRatio,
  )
  // 有普通异常暴击区则乘算，否则 anomalyCritZone 本身为 1
  const useTurbulenceAnomalyCrit = Math.abs(anomalyCritZone - 1) > 1e-9
  const turbulencePreCrit =
    anomalyBaseExpected * turbulenceZone * turbulenceCombinedDmgBonusZone
  const turbulenceExpected = turbulencePreCrit * anomalyCritZone
  const turbulenceExpectedNoCrit = turbulencePreCrit * anomalyNoCritZone
  const turbulenceExpectedFullCrit = turbulencePreCrit * anomalyFullCritZone

  return {
    baseDamage: round(mainParts.baseDamage, 2),
    baseDamageSource: mainParts.usedBaseSource,
    dmgMultiplier: round(mainParts.dmgMultiplier, 4),
    critRateRatio: round(mainParts.critRateRatio, 4),
    critDmgRatio: round(mainParts.critDmgRatio, 4),
    critMultiplier: round(mainParts.critMultiplier, 4),
    penRateRatio: round(mainParts.penRateRatio, 4),
    ignoreDefenseRatio: round(mainParts.ignoreDefenseRatio, 4),
    reduceDefenseRatio: round(mainParts.reduceDefenseRatio, 4),
    defenseFactor: round(mainParts.defenseFactor, 4),
    enemyResistance: mainParts.enemyRes,
    effectiveDefense: round(mainParts.effectiveDefense, 2),
    defenseMultiplier: round(mainParts.defenseMultiplier, 4),
    resistanceMultiplier: round(mainParts.resistanceMultiplier, 4),
    vulnerableMultiplier: round(mainParts.vulnerableMultiplier, 4),
    staggerMultiplier: round(mainParts.staggerMultiplier, 4),
    specialMultiplier: round(mainParts.specialMultiplier, 4),
    pierceDmgMultiplier: round(mainParts.pierceDmgMultiplier, 4),
    generalMultiplier: round(
      useTriggerBase ? triggerParts.generalMultiplier : mainParts.generalMultiplier,
      2,
    ),
    directDmgMultZone: round(directDmgMultZone, 4),
    settlementDmgMultZone: round(settlementDmgMultZone, 4),
    directDamageFromDirectMult: round(directDamageFromDirectMult, 0),
    settlementDamageExpected: round(settlementDamageExpected, 0),
    directDamageExpected: round(directDamageExpected, 0),
    masteryZone: round(
      useTriggerBase ? triggerParts.masteryZone : mainParts.masteryZone,
      4,
    ),
    levelZone: round(mainParts.levelZone, 4),
    anomalyDmgBonusZone: round(anomalyDmgBonusZone, 4),
    anomalyMultZone: round(anomalyMultZone, 4),
    anomalyCritRateRatio: round(anomalyCritRateRatio, 4),
    anomalyCritDmgRatio: round(anomalyCritDmgRatio, 4),
    anomalyCritZone: round(anomalyCritZone, 4),
    anomalyFullCritZone: round(anomalyFullCritZone, 4),
    anomalyBaseExpected: round(anomalyBaseExpected, 0),
    anomalyExpected: round(anomalyExpected, 0),
    anomalyExpectedNoCrit: round(anomalyExpectedNoCrit, 0),
    anomalyExpectedFullCrit: round(anomalyExpectedFullCrit, 0),
    anomalyReleaseDmgBonusZone: round(anomalyReleaseDmgBonusZone, 4),
    anomalyReleaseCombinedDmgBonusZone: round(anomalyReleaseCombinedDmgBonusZone, 4),
    anomalyReleaseMultZone: round(anomalyReleaseMultZone, 4),
    anomalyReleaseCritZone: round(anomalyReleaseCritZone, 4),
    anomalyCombinedCritRateRatio: round(anomalyCombinedCritRateRatio, 4),
    anomalyCombinedCritDmgRatio: round(anomalyCombinedCritDmgRatio, 4),
    anomalyCombinedCritZone: round(anomalyCombinedCritZone, 4),
    anomalyCombinedFullCritZone: round(anomalyCombinedFullCritZone, 4),
    anomalyReleaseExpected: round(anomalyReleaseExpected, 0),
    anomalyReleaseExpectedNoCrit: round(anomalyReleaseExpectedNoCrit, 0),
    anomalyReleaseExpectedFullCrit: round(anomalyReleaseExpectedFullCrit, 0),
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
    turbulenceExpectedNoCrit: round(turbulenceExpectedNoCrit, 0),
    turbulenceExpectedFullCrit: round(turbulenceExpectedFullCrit, 0),
    hasPolarDisorder,
  }
}
