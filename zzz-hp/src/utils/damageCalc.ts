import type { AnomalyDamageSubKind, BaseDamageSource, SkillSubcategory } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import { effectiveAnomalyDuration } from '@/utils/calculatorUi'
import {
  normalizeDamageEnemyInput,
  resolveEnemyResistanceForElement,
  type DamageEnemyInput,
  type EnemyResistanceType,
} from '@/utils/enemyResistance'
import {
  computeRemielSelfAnomalyBase,
  computeRemielSelfRadianceSpecialLevelZone,
  computeRemielSelfRadianceStandardLevelZone,
  type RemielSelfRadianceCalcInput,
  computeRadianceMultZone,
  computeSpecialMultZone,
} from '@/utils/remielUtils'
import { resolveSkillMults } from '@/utils/skillSubcategoryMult'

export type { DamageEnemyInput, EnemyResistanceType }

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
  /** 招式持有者属性（直伤抗性区回落） */
  ownerAgentElement?: string
  /** 招式持有者抗性区基准属性（流明则取下一位非流明队友） */
  ownerAgentResistanceElement?: string | null
  /** 异常类触发者属性，用于火/以太异常持续时间 ÷0.5 */
  anomalyTriggerElement?: string
  /** @deprecated 结算不再取主C；未传 owner/触发者时的页级预览回落 */
  mainAgentElement?: string
  /** @deprecated 结算不再取主C；未传 owner 抗性时的页级预览回落 */
  mainAgentResistanceElement?: string | null
  /** 主C id（展示用，不参与结算） */
  mainAgentId?: string
  /** 主C 名称（展示用，不参与结算） */
  mainAgentName?: string
  /** 异常子类 */
  anomalySubKind?: AnomalyDamageSubKind
  /**
   * 异常强度提供者最终面板（乱流/异放/紊乱/耀变的异常基础期望等）。
   * 命名含 trigger，实为 power provider，勿与 anomalyTriggerPanel（触发者）混淆。
   * 缺省时异常基础仍用 finalPanel（招式持有者）。
   */
  triggerFinalPanel?: PanelStats
  /** 异常强度提供者元素（与 triggerFinalPanel 同角色） */
  triggerAgentElement?: string
  /** 异常强度提供者抗性区基准属性（流明则取下一位非流明队友） */
  triggerAgentResistanceElement?: string | null
  /** 异常强度提供者 piercePower（命破等）；缺省用持有者 piercePower */
  triggerPiercePower?: number
  triggerBaseDamageSource?: BaseDamageSource
  triggerIsMb?: boolean
  /** 当前招式小类（有则优先采用小类倍率） */
  skillSubcategory?: SkillSubcategory | null
  /** @deprecated 直伤等级区请传 ownerAgentLevel */
  mainAgentLevel?: number
  /** 招式持有者等级（直伤等级区） */
  ownerAgentLevel?: number
  /** 异常强度提供者等级（异常基础等级区） */
  triggerAgentLevel?: number
  /**
   * 异常类触发者局内最终面板（与 triggerFinalPanel 不是同一角色语义）：
   * 异放/耀变增伤与倍率，以及所有异常类的减防/无视防御。
   */
  anomalyTriggerPanel?: PanelStats
  /** 队伍有蕾米埃尔时的异化系数乘区（预计算） */
  mutationZone?: number
  /** 耀变：蕾米埃尔耀变抗性穿透（非本人耀变时并入产生角色抗性区） */
  remielRadianceResPen?: number
/** 耀变：蕾米埃尔本人作异常强度提供者时的专用结算输入 */
  remielSelfRadianceCalc?: RemielSelfRadianceCalcInput | null
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
  /** 等级区所采用的角色等级（展示用） */
  levelZoneAgentLevel: number
  anomalyDmgBonusZone: number
  anomalyMultZone: number
  anomalyCritRateRatio: number
  anomalyCritDmgRatio: number
  anomalyCritZone: number
  /** 普通异常暴击区（暴击率强制为 1） */
  anomalyFullCritZone: number
  /** 异常基础期望（不含异常增伤/倍率/暴击区；本人耀变时为蕾米埃尔异常基础） */
  anomalyBaseExpected: number
  /** 是否走蕾米埃尔本人耀变专用公式 */
  remielSelfRadianceActive?: boolean
  remielSelfAnomalyBase?: number
  remielSelfSpecialLevelZone?: number
  remielSelfStandardLevelZone?: number
  remielSelfInCombatAtk?: number
  remielSelfInCombatMasteryZone?: number
  /** 本人耀变异常基础实际使用的异化系数区（本槽口径，可能与页级 mutationZone 不同） */
  remielSelfMutationZone?: number
  remielSelfResistanceElement?: string | null
  remielSelfDefenseMultiplier?: number
  remielSelfResistanceMultiplier?: number
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
  /** 耀变综合增伤区 */
  radianceCombinedDmgBonusZone: number
  /** 耀变倍率区 */
  radianceMultZone: number
  /** 特殊倍率乘区 */
  specialMultZone: number
  /** 异化系数乘区 */
  mutationZone: number
  /** 耀变期望伤害 */
  radianceExpected: number
  radianceExpectedNoCrit: number
  radianceExpectedFullCrit: number
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

export function computeDefenseZone(options: {
  defensePanel: Pick<PanelStats, 'penRate' | 'pen' | 'ignoreDefense' | 'reduceDefense'>
  isMb: boolean
  enemyDefense: number
}) {
  const defense = options.defensePanel
  const penRateRatio = clamp(defense.penRate / 100, 0, 0.95)
  const ignoreDefenseRatio = clamp(defense.ignoreDefense / 100, 0, 1)
  const reduceDefenseRatio = clamp(defense.reduceDefense / 100, 0, 1)
  const defenseFactor = Math.max(0, 1 - ignoreDefenseRatio - reduceDefenseRatio)
  const defenseAfterModifiers = options.enemyDefense * defenseFactor * (1 - penRateRatio)
  const effectiveDefense = Math.max(0, defenseAfterModifiers) - defense.pen
  const defenseMultiplier = options.isMb ? 1 : 794 / (794 + effectiveDefense)
  return {
    penRateRatio,
    ignoreDefenseRatio,
    reduceDefenseRatio,
    defenseFactor,
    effectiveDefense,
    defenseMultiplier,
  }
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
  /** 等级区所用角色等级 */
  agentLevel: number
  /** 抗性区所参照的属性（缺省回退全局 resistanceType） */
  resistanceElement?: string | null
  /** 抗性穿透额外加算（耀变：蕾米埃尔耀变抗性穿透） */
  extraResPen?: number
}) {
  const panel = options.panel
  const defense = options.defensePanel ?? panel
  const enemyRes = resolveEnemyResistanceForElement(
    normalizeDamageEnemyInput(options.enemyInput),
    options.resistanceElement,
  )
  const extraResPen = options.extraResPen ?? 0

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
  const resistanceMultiplier = 1 - enemyRes + clamp((panel.resPen + extraResPen) / 100, -2, 2)

  const vulnerableMultiplier =
    options.enemyInput.vulnerableMultiplier + options.combatVulnerable / 100
  const globalStagger = options.combatGlobalStaggerVulnerable / 100
  const phaseStagger =
    (options.combatStaggerVulnerable + options.combatStaggerVulnerableOnly) / 100
  /** 非失衡：乘区固定为 1。失衡易伤只在流程勾了失衡时进入。 */
  const staggerMultiplier =
    options.staggerPhase === 'stagger'
      ? options.enemyInput.staggerMultiplier + globalStagger + phaseStagger
      : 1
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
  const levelZone = computeLevelZone(options.agentLevel)
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
    (subKind === 'anomaly' ||
      subKind === 'turbulence' ||
      subKind === 'anomalyRelease' ||
      subKind === 'disorder' ||
      subKind === 'radiance') &&
    Boolean(input.triggerFinalPanel)

  const triggerPanel = input.triggerFinalPanel ?? panel
  const usesProducerMultPanel =
    useTriggerBase && (subKind === 'turbulence' || subKind === 'disorder')
  const multPanel = usesProducerMultPanel ? triggerPanel : panel

  const mainAgentLevel = input.mainAgentLevel ?? input.enemyInput.level
  const ownerAgentLevel = input.ownerAgentLevel ?? mainAgentLevel
  const triggerAgentLevel = input.triggerAgentLevel ?? mainAgentLevel
  const triggerAgentPanel = input.anomalyTriggerPanel ?? panel
  const ownerElement = input.ownerAgentElement ?? input.mainAgentElement
  const ownerResistanceElement =
    input.ownerAgentResistanceElement ?? input.mainAgentResistanceElement ?? ownerElement
  const durationElement =
    input.anomalyTriggerElement ?? ownerElement ?? ''
  /** 异放/耀变/属性异常：增伤与倍率取异常类触发者；紊乱/乱流增伤取持有者；异常基础取异常强度提供者 */
  const bonusPanel =
    useTriggerBase &&
    (subKind === 'anomalyRelease' || subKind === 'radiance' || subKind === 'anomaly')
      ? triggerAgentPanel
      : panel

  const skillMults = input.skillSubcategory
    ? resolveSkillMults(
        usesProducerMultPanel ? triggerPanel : bonusPanel,
        input.skillSubcategory,
      )
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
    agentLevel: ownerAgentLevel,
    resistanceElement: ownerResistanceElement,
    defensePanel: {
      penRate: panel.penRate,
      pen: panel.pen,
      ignoreDefense: triggerAgentPanel.ignoreDefense,
      reduceDefense: triggerAgentPanel.reduceDefense,
    },
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
        agentLevel: triggerAgentLevel,
        resistanceElement:
          input.triggerAgentResistanceElement ??
          input.triggerAgentElement ??
          ownerResistanceElement,
        // 异常基础防御区：穿透率/穿透值取异常强度提供者，减防/无视防御取异常类触发者
        defensePanel: {
          penRate: triggerPanel.penRate,
          pen: triggerPanel.pen,
          ignoreDefense: triggerAgentPanel.ignoreDefense,
          reduceDefense: triggerAgentPanel.reduceDefense,
        },
        extraResPen: subKind === 'radiance' ? (input.remielRadianceResPen ?? 0) : 0,
      })
    : mainParts

  const baseParts = useTriggerBase ? triggerParts : mainParts

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

  // 异常乘区：属性异常/异放/耀变取异常类触发者（bonusPanel）；紊乱/乱流取持有者；基础期望取异常强度提供者
  const anomalyDmgBonusZone = 1 + bonusPanel.anomalyDmgBonus / 100
  const anomalyMultZone =
    Math.max(0, bonusPanel.anomalyMult / 100) * readFactor(bonusPanel.anomalyMultFactor)
  const anomalyCritRateRatio = bonusPanel.anomalyCritRate / 100
  const anomalyCritDmgRatio = clamp(bonusPanel.anomalyCritDmg / 100, 0, 20)
  const anomalyCritZone = 1 + anomalyCritRateRatio * anomalyCritDmgRatio
  const anomalyFullCritZone = 1 + anomalyCritDmgRatio
  const anomalyNoCritZone = 1

  const remielSelf = subKind === 'radiance' ? (input.remielSelfRadianceCalc ?? null) : null
  const remielSelfRadianceActive = Boolean(remielSelf)

  let remielSelfDefenseMultiplier = 1
  let remielSelfResistanceMultiplier = 1
  let remielSelfAnomalyBase: number | undefined
  let remielSelfSpecialLevelZone: number | undefined
  let remielSelfStandardLevelZone: number | undefined
  let remielSelfInCombatAtk: number | undefined
  let remielSelfInCombatMasteryZone: number | undefined
  let remielSelfMutationZone: number | undefined

  let anomalyBaseExpected = triggerParts.anomalyBaseExpected
  if (remielSelf) {
    remielSelfAnomalyBase = computeRemielSelfAnomalyBase(remielSelf)
    anomalyBaseExpected = remielSelfAnomalyBase
    remielSelfSpecialLevelZone = computeRemielSelfRadianceSpecialLevelZone(remielSelf.agentLevel)
    remielSelfStandardLevelZone = computeRemielSelfRadianceStandardLevelZone(remielSelf.agentLevel)
    remielSelfInCombatAtk = remielSelf.inCombatAtk
    remielSelfInCombatMasteryZone = remielSelf.inCombatMastery / 100
    remielSelfMutationZone = remielSelf.mutationZone

    const defenseParts = computeDefenseZone({
      defensePanel: {
        penRate: remielSelf.penRate,
        pen: remielSelf.pen,
        ignoreDefense: triggerAgentPanel.ignoreDefense,
        reduceDefense: triggerAgentPanel.reduceDefense,
      },
      isMb: remielSelf.isMb,
      enemyDefense: input.enemyInput.defense,
    })
    remielSelfDefenseMultiplier = defenseParts.defenseMultiplier

    const enemyRes = remielSelf.resistanceElement
      ? resolveEnemyResistanceForElement(
          normalizeDamageEnemyInput(input.enemyInput),
          remielSelf.resistanceElement,
        )
      : 0
    remielSelfResistanceMultiplier =
      1 -
      enemyRes +
      clamp((remielSelf.resPen + remielSelf.radianceResPen) / 100, -2, 2)
  }
  const anomalyPreCrit =
    anomalyBaseExpected * anomalyDmgBonusZone * anomalyMultZone
  const anomalyExpected = anomalyPreCrit * anomalyCritZone
  const anomalyExpectedNoCrit = anomalyPreCrit * anomalyNoCritZone
  const anomalyExpectedFullCrit = anomalyPreCrit * anomalyFullCritZone

  // 异放：基础用触发面板；综合增伤加算；综合暴击率/爆伤加算后再乘
  const anomalyReleaseDmgBonusZone = 1 + bonusPanel.anomalyReleaseDmgBonus / 100
  const anomalyReleaseCombinedDmgBonusZone =
    1 + (bonusPanel.anomalyReleaseDmgBonus + bonusPanel.anomalyDmgBonus) / 100
  const anomalyReleaseMultZone = skillMults
    ? skillMults.anomalyReleaseMultZone
    : Math.max(0, bonusPanel.anomalyReleaseMult / 100) *
        readFactor(bonusPanel.anomalyReleaseMultFactor)
  const releaseCritRateRatio = bonusPanel.anomalyReleaseCritRate / 100
  const releaseCritDmgRatio = clamp(bonusPanel.anomalyReleaseCritDmg / 100, 0, 20)
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

  const effectiveDuration = effectiveAnomalyDuration(
    (useTriggerBase ? triggerPanel : panel).anomalyDuration || bonusPanel.anomalyDuration,
    durationElement,
  )

  const disorderDmgBonusZone = 1 + bonusPanel.disorderDmgBonus / 100
  const disorderBaseMultRatio = skillMults
    ? skillMults.disorderMultZone
    : Math.max(0, multPanel.disorderBaseMult / 100) *
        readFactor(multPanel.disorderBaseMultFactor)
  const disorderCompMultRatio = multPanel.disorderCompMult / 100
  const disorderZone = Math.max(
    0,
    disorderBaseMultRatio + effectiveDuration * disorderCompMultRatio,
  )
  const disorderBase = useTriggerBase ? triggerParts.anomalyBaseExpected : mainParts.anomalyBaseExpected
  const disorderExpected = disorderBase * disorderZone * disorderDmgBonusZone

  const turbulenceDmgBonusZone = 1 + bonusPanel.turbulenceDmgBonus / 100
  const turbulenceCombinedDmgBonusZone =
    1 + (bonusPanel.turbulenceDmgBonus + bonusPanel.anomalyDmgBonus) / 100
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

  const radianceDmgBonusForCombined = remielSelf
    ? remielSelf.radianceDmgBonus
    : bonusPanel.radianceDmgBonus
  const anomalyDmgBonusForCombined = remielSelf
    ? remielSelf.anomalyDmgBonus
    : bonusPanel.anomalyDmgBonus
  const radianceCombinedDmgBonusZone =
    1 + (radianceDmgBonusForCombined + anomalyDmgBonusForCombined) / 100
  const radianceMultZone = computeRadianceMultZone(bonusPanel)
  const specialMultZone = computeSpecialMultZone(bonusPanel)
  const radiancePreCrit = remielSelfRadianceActive
    ? anomalyBaseExpected *
      remielSelfDefenseMultiplier *
      remielSelfResistanceMultiplier *
      Math.max(0, mainParts.vulnerableMultiplier) *
      Math.max(0, mainParts.staggerMultiplier) *
      radianceCombinedDmgBonusZone *
      radianceMultZone *
      specialMultZone *
      Math.max(0, mainParts.specialMultiplier)
    : anomalyBaseExpected * radianceCombinedDmgBonusZone * radianceMultZone
  const radianceExpectedRaw = radiancePreCrit
  const radianceExpectedNoCritRaw = radiancePreCrit
  const radianceExpectedFullCritRaw = radiancePreCrit

  const mutationMultRaw = input.mutationZone
  const mutationMult =
    mutationMultRaw != null && Number.isFinite(mutationMultRaw) ? mutationMultRaw : 1
  const applyMutation = (value: number) =>
    remielSelfRadianceActive ? value : value * mutationMult

  return {
    baseDamage: round(baseParts.baseDamage, 2),
    baseDamageSource: baseParts.usedBaseSource,
    dmgMultiplier: round(baseParts.dmgMultiplier, 4),
    critRateRatio: round(mainParts.critRateRatio, 4),
    critDmgRatio: round(mainParts.critDmgRatio, 4),
    critMultiplier: round(mainParts.critMultiplier, 4),
    penRateRatio: round(baseParts.penRateRatio, 4),
    ignoreDefenseRatio: round(baseParts.ignoreDefenseRatio, 4),
    reduceDefenseRatio: round(baseParts.reduceDefenseRatio, 4),
    defenseFactor: round(baseParts.defenseFactor, 4),
    enemyResistance: baseParts.enemyRes,
    effectiveDefense: round(baseParts.effectiveDefense, 2),
    defenseMultiplier: round(baseParts.defenseMultiplier, 4),
    resistanceMultiplier: round(baseParts.resistanceMultiplier, 4),
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
    levelZone: round(baseParts.levelZone, 4),
    levelZoneAgentLevel: useTriggerBase ? triggerAgentLevel : ownerAgentLevel,
    anomalyDmgBonusZone: round(anomalyDmgBonusZone, 4),
    anomalyMultZone: round(anomalyMultZone, 4),
    anomalyCritRateRatio: round(anomalyCritRateRatio, 4),
    anomalyCritDmgRatio: round(anomalyCritDmgRatio, 4),
    anomalyCritZone: round(anomalyCritZone, 4),
    anomalyFullCritZone: round(anomalyFullCritZone, 4),
    anomalyBaseExpected: round(anomalyBaseExpected, 0),
    remielSelfRadianceActive,
    remielSelfAnomalyBase: remielSelfAnomalyBase
      ? round(remielSelfAnomalyBase, 0)
      : undefined,
    remielSelfSpecialLevelZone: remielSelfSpecialLevelZone
      ? round(remielSelfSpecialLevelZone, 4)
      : undefined,
    remielSelfStandardLevelZone: remielSelfStandardLevelZone
      ? round(remielSelfStandardLevelZone, 4)
      : undefined,
    remielSelfInCombatAtk:
      remielSelfInCombatAtk != null ? round(remielSelfInCombatAtk, 4) : undefined,
    remielSelfInCombatMasteryZone: remielSelfInCombatMasteryZone
      ? round(remielSelfInCombatMasteryZone, 4)
      : undefined,
    remielSelfMutationZone: remielSelfMutationZone
      ? round(remielSelfMutationZone, 4)
      : undefined,
    remielSelfResistanceElement: remielSelf?.resistanceElement ?? undefined,
    remielSelfDefenseMultiplier: remielSelfRadianceActive
      ? round(remielSelfDefenseMultiplier, 4)
      : undefined,
    remielSelfResistanceMultiplier: remielSelfRadianceActive
      ? round(remielSelfResistanceMultiplier, 4)
      : undefined,
    anomalyExpected: round(applyMutation(anomalyExpected), 0),
    anomalyExpectedNoCrit: round(applyMutation(anomalyExpectedNoCrit), 0),
    anomalyExpectedFullCrit: round(applyMutation(anomalyExpectedFullCrit), 0),
    anomalyReleaseDmgBonusZone: round(anomalyReleaseDmgBonusZone, 4),
    anomalyReleaseCombinedDmgBonusZone: round(anomalyReleaseCombinedDmgBonusZone, 4),
    anomalyReleaseMultZone: round(anomalyReleaseMultZone, 4),
    anomalyReleaseCritZone: round(anomalyReleaseCritZone, 4),
    anomalyCombinedCritRateRatio: round(anomalyCombinedCritRateRatio, 4),
    anomalyCombinedCritDmgRatio: round(anomalyCombinedCritDmgRatio, 4),
    anomalyCombinedCritZone: round(anomalyCombinedCritZone, 4),
    anomalyCombinedFullCritZone: round(anomalyCombinedFullCritZone, 4),
    anomalyReleaseExpected: round(applyMutation(anomalyReleaseExpected), 0),
    anomalyReleaseExpectedNoCrit: round(applyMutation(anomalyReleaseExpectedNoCrit), 0),
    anomalyReleaseExpectedFullCrit: round(applyMutation(anomalyReleaseExpectedFullCrit), 0),
    effectiveAnomalyDuration: round(effectiveDuration, 4),
    disorderBaseMultRatio: round(disorderBaseMultRatio, 4),
    disorderCompMultRatio: round(disorderCompMultRatio, 4),
    disorderZone: round(disorderZone, 4),
    disorderDmgBonusZone: round(disorderDmgBonusZone, 4),
    disorderExpected: round(applyMutation(disorderExpected), 0),
    turbulenceBaseMultRatio: round(turbulenceBaseMultRatio, 4),
    turbulenceCompMultRatio: round(turbulenceCompMultRatio, 4),
    turbulenceZone: round(turbulenceZone, 4),
    turbulenceDmgBonusZone: round(turbulenceDmgBonusZone, 4),
    turbulenceCombinedDmgBonusZone: round(turbulenceCombinedDmgBonusZone, 4),
    turbulenceUsesAnomalyCrit: useTurbulenceAnomalyCrit,
    turbulenceExpected: round(applyMutation(turbulenceExpected), 0),
    turbulenceExpectedNoCrit: round(applyMutation(turbulenceExpectedNoCrit), 0),
    turbulenceExpectedFullCrit: round(applyMutation(turbulenceExpectedFullCrit), 0),
    hasPolarDisorder,
    radianceCombinedDmgBonusZone: round(radianceCombinedDmgBonusZone, 4),
    radianceMultZone: round(radianceMultZone, 4),
    specialMultZone: round(specialMultZone, 4),
    mutationZone: round(mutationMult, 4),
    radianceExpected: round(applyMutation(radianceExpectedRaw), 0),
    radianceExpectedNoCrit: round(applyMutation(radianceExpectedNoCritRaw), 0),
    radianceExpectedFullCrit: round(applyMutation(radianceExpectedFullCritRaw), 0),
  }
}
