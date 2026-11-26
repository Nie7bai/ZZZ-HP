import type { PanelStats } from '@/types/calculatorPanel'
import { multFactorPercentToRatio } from '@/utils/multFactorPercent'
import { computeRadianceMultZone, computeSpecialMultZone } from '@/utils/remielUtils'
import type { ResolvedSkillMults } from '@/utils/skillSubcategoryMult'

/**
 * 异常类乘区原语（Phase 1d）。
 *
 * 覆盖属性异常 / 异放 / 紊乱 / 乱流 / 耀变五类子区的增伤区、倍率区、暴击区与期望伤害，
 * 以及异化系数（`mutationZone`）的取值与施加。纯函数、无副作用、入参显式。
 *
 * 口径约定：
 * - 只返回**未取整**的原始因子；`round` 仍留在 `damageCalc` 组装结果时做（取整时机不变）。
 * - 公式、运算顺序、`Math.max` / `clamp` 位置与迁移前的 `damageCalc.computeDamageResult`
 *   逐位一致（黄金对照 `test:zone-golden` 把关），不做代数化简。
 * - 面板归属（bonusPanel / multPanel / skillMults）由调用方按路由政策选好后传入。
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 倍率修正（百分点 → 乘数；非法或 0 视为 100%） */
function readFactor(value: number | undefined | null, fallback = 1): number {
  return multFactorPercentToRatio(value) || fallback
}

/** 异常类「不暴击区」恒为 1（历史口径：属性异常与乱流都按 ×1 计） */
const ANOMALY_NO_CRIT_ZONE = 1

export interface AnomalyCritZones {
  /** 暴击率比（异常类只 ÷100，不截上限） */
  critRateRatio: number
  /** 爆伤比（0–20 截断） */
  critDmgRatio: number
  /** 期望暴击区：1 + 暴击率 × 爆伤 */
  critZone: number
  /** 必暴区：1 + 爆伤 */
  fullCritZone: number
}

/** 异常类暴击区（属性异常/异放/紊乱/乱流/耀变共用同一形态，字段各自独立） */
export function computeAnomalyCritZones(
  critRatePercent: number,
  critDmgPercent: number,
): AnomalyCritZones {
  const critRateRatio = critRatePercent / 100
  const critDmgRatio = clamp(critDmgPercent / 100, 0, 20)
  return {
    critRateRatio,
    critDmgRatio,
    critZone: 1 + critRateRatio * critDmgRatio,
    fullCritZone: 1 + critDmgRatio,
  }
}

export interface AnomalyExpectedZones {
  /** 期望伤害（按自身暴击率加权） */
  expected: number
  /** 不暴击伤害（暴击率为 0） */
  expectedNoCrit: number
  /** 必暴击伤害（暴击率为 1） */
  expectedFullCrit: number
}

function splitCritExpectations(
  preCrit: number,
  crit: Pick<AnomalyCritZones, 'critZone' | 'fullCritZone'>,
): AnomalyExpectedZones {
  return {
    expected: preCrit * crit.critZone,
    expectedNoCrit: preCrit * ANOMALY_NO_CRIT_ZONE,
    expectedFullCrit: preCrit * crit.fullCritZone,
  }
}

type AttributeAnomalyPanel = Pick<
  PanelStats,
  | 'attributeAnomalyDmgBonus'
  | 'attributeAnomalyMult'
  | 'attributeAnomalyMultFactor'
  | 'attributeAnomalyCritRate'
  | 'attributeAnomalyCritDmg'
>

export interface AttributeAnomalyZones extends AnomalyCritZones, AnomalyExpectedZones {
  dmgBonusZone: number
  multZone: number
}

/** 属性异常：增伤区、倍率区、暴击区与三段期望伤害 */
export function computeAttributeAnomalyZones(options: {
  panel: AttributeAnomalyPanel
  anomalyBaseExpected: number
}): AttributeAnomalyZones {
  const panel = options.panel
  const dmgBonusZone = 1 + panel.attributeAnomalyDmgBonus / 100
  const multZone =
    Math.max(0, panel.attributeAnomalyMult / 100) *
    readFactor(panel.attributeAnomalyMultFactor)
  const crit = computeAnomalyCritZones(panel.attributeAnomalyCritRate, panel.attributeAnomalyCritDmg)
  const preCrit = options.anomalyBaseExpected * dmgBonusZone * multZone
  return {
    dmgBonusZone,
    multZone,
    ...crit,
    ...splitCritExpectations(preCrit, crit),
  }
}

type AnomalyReleasePanel = Pick<
  PanelStats,
  | 'anomalyReleaseDmgBonus'
  | 'anomalyReleaseMult'
  | 'anomalyReleaseMultFactor'
  | 'anomalyReleaseCritRate'
  | 'anomalyReleaseCritDmg'
>

export interface AnomalyReleaseZones extends AnomalyCritZones, AnomalyExpectedZones {
  dmgBonusZone: number
  multZone: number
}

/** 异放：增伤区只吃异放自身字段，倍率可走招式小类，暴击只吃异放字段 */
export function computeAnomalyReleaseZones(options: {
  panel: AnomalyReleasePanel
  /** 招式小类倍率（有则优先采用 `anomalyReleaseMultZone`） */
  skillMults: Pick<ResolvedSkillMults, 'anomalyReleaseMultZone'> | null
  anomalyBaseExpected: number
}): AnomalyReleaseZones {
  const panel = options.panel
  const dmgBonusZone = 1 + panel.anomalyReleaseDmgBonus / 100
  const multZone = options.skillMults
    ? options.skillMults.anomalyReleaseMultZone
    : Math.max(0, panel.anomalyReleaseMult / 100) *
      readFactor(panel.anomalyReleaseMultFactor)
  const crit = computeAnomalyCritZones(panel.anomalyReleaseCritRate, panel.anomalyReleaseCritDmg)
  const preCrit = options.anomalyBaseExpected * dmgBonusZone * multZone
  return {
    dmgBonusZone,
    multZone,
    ...crit,
    ...splitCritExpectations(preCrit, crit),
  }
}

type DisorderBonusPanel = Pick<PanelStats, 'disorderDmgBonus' | 'disorderCritRate' | 'disorderCritDmg'>

type DisorderMultPanel = Pick<
  PanelStats,
  'disorderCompMult' | 'disorderBaseMult' | 'disorderBaseMultFactor'
>

export interface DisorderZones extends AnomalyCritZones, AnomalyExpectedZones {
  dmgBonusZone: number
  /** 基础倍率分量（不含倍率修正、不含持续时间补偿） */
  baseMultRatio: number
  compMultRatio: number
  /** 倍率修正（乘在倍率区上） */
  multFactor: number
  /** 最终倍率区 */
  zone: number
}

/**
 * 紊乱：增伤区、倍率区（基础 × 持续时间 × 补偿）、暴击区与三段期望伤害。
 *
 * `effectiveDuration` 由调用方按持续时间面板与属性算好后传入（火/以太按 0.5s 取整是路由政策的一部分）。
 */
export function computeDisorderZones(options: {
  /** 增伤与暴击字段来源（异常类触发者） */
  panel: DisorderBonusPanel
  /** 倍率与补偿字段来源（紊乱/乱流取异常强度提供者） */
  multPanel: DisorderMultPanel
  skillMults: Pick<ResolvedSkillMults, 'disorderBaseMultRatio' | 'disorderMultFactor'> | null
  effectiveDuration: number
  /** 招式手填「最终倍率区%」：填写值已含有效持续时间 × 补偿倍率 */
  zoneMultOverride?: number | null
  zoneMultFactorOverride?: number | null
  anomalyBaseExpected: number
}): DisorderZones {
  const panel = options.panel
  const multPanel = options.multPanel
  const skillMults = options.skillMults
  const effectiveDuration = options.effectiveDuration

  const dmgBonusZone = 1 + panel.disorderDmgBonus / 100
  const compMultRatio = multPanel.disorderCompMult / 100
  const panelFactor = readFactor(multPanel.disorderBaseMultFactor)

  let baseMultRatio: number
  let multFactor: number
  let zone: number
  if (options.zoneMultOverride != null) {
    const providedZoneRatio = Math.max(0, options.zoneMultOverride / 100)
    multFactor = readFactor(options.zoneMultFactorOverride) * panelFactor
    zone = Math.max(0, providedZoneRatio * multFactor)
    baseMultRatio = Math.max(0, providedZoneRatio - effectiveDuration * compMultRatio)
  } else {
    baseMultRatio = skillMults
      ? skillMults.disorderBaseMultRatio
      : Math.max(0, multPanel.disorderBaseMult / 100)
    multFactor = skillMults ? skillMults.disorderMultFactor : panelFactor
    zone = Math.max(0, (baseMultRatio + effectiveDuration * compMultRatio) * multFactor)
  }

  const crit = computeAnomalyCritZones(panel.disorderCritRate, panel.disorderCritDmg)
  const preCrit = options.anomalyBaseExpected * zone * dmgBonusZone
  return {
    dmgBonusZone,
    baseMultRatio,
    compMultRatio,
    multFactor,
    zone,
    ...crit,
    ...splitCritExpectations(preCrit, crit),
  }
}

type TurbulenceBonusPanel = Pick<
  PanelStats,
  'turbulenceDmgBonus' | 'turbulenceCritRate' | 'turbulenceCritDmg'
>

type TurbulenceMultPanel = Pick<
  PanelStats,
  'turbulenceCompMult' | 'turbulenceBaseMult' | 'turbulenceBaseMultFactor'
>

export interface TurbulenceZones extends AnomalyCritZones, AnomalyExpectedZones {
  dmgBonusZone: number
  baseMultRatio: number
  compMultRatio: number
  multFactor: number
  zone: number
}

/** 乱流：增伤区只吃乱流自身字段；暴击只吃乱流自身暴击（不蹭异常暴击） */
export function computeTurbulenceZones(options: {
  panel: TurbulenceBonusPanel
  multPanel: TurbulenceMultPanel
  effectiveDuration: number
  zoneMultOverride?: number | null
  zoneMultFactorOverride?: number | null
  anomalyBaseExpected: number
}): TurbulenceZones {
  const panel = options.panel
  const multPanel = options.multPanel
  const effectiveDuration = options.effectiveDuration

  const dmgBonusZone = 1 + panel.turbulenceDmgBonus / 100
  const compMultRatio = multPanel.turbulenceCompMult / 100
  const panelFactor = readFactor(multPanel.turbulenceBaseMultFactor)

  let baseMultRatio: number
  let multFactor: number
  let zone: number
  if (options.zoneMultOverride != null) {
    const providedZoneRatio = Math.max(0, options.zoneMultOverride / 100)
    multFactor = readFactor(options.zoneMultFactorOverride) * panelFactor
    zone = Math.max(0, providedZoneRatio * multFactor)
    baseMultRatio = Math.max(0, providedZoneRatio - effectiveDuration * compMultRatio)
  } else {
    baseMultRatio = Math.max(0, multPanel.turbulenceBaseMult / 100)
    multFactor = panelFactor
    zone = Math.max(0, (baseMultRatio + effectiveDuration * compMultRatio) * multFactor)
  }

  const crit = computeAnomalyCritZones(panel.turbulenceCritRate, panel.turbulenceCritDmg)
  const preCrit = options.anomalyBaseExpected * zone * dmgBonusZone
  return {
    dmgBonusZone,
    baseMultRatio,
    compMultRatio,
    multFactor,
    zone,
    ...crit,
    ...splitCritExpectations(preCrit, crit),
  }
}

type RadiancePanel = Pick<
  PanelStats,
  | 'radianceDmgBonus'
  | 'radianceMult'
  | 'radianceMultFactor'
  | 'radianceCritRate'
  | 'radianceCritDmg'
  | 'specialMult'
  | 'specialMultFactor'
>

/**
 * 蕾米埃尔本人耀变链额外连乘的因子（本人作异常强度提供者时）。
 * 这些值由 `damageCalc` 的专用基础/防御/抗性求解得出，本模块只按既有顺序连乘。
 */
export interface SelfRadianceChain {
  defenseMultiplier: number
  resistanceMultiplier: number
  anomalyVulnerableMultiplier: number
  staggerMultiplier: number
  specialMultiplier: number
}

export interface RadianceZones extends AnomalyCritZones, AnomalyExpectedZones {
  dmgBonusZone: number
  multZone: number
  specialMultZone: number
}

/** 耀变：增伤区只吃耀变自身字段；倍率区与小类特殊倍率取异常类触发者面板 */
export function computeRadianceZones(options: {
  panel: RadiancePanel
  anomalyBaseExpected: number
  /** 本人耀变链；缺省走普通耀变链（基础 × 增伤 × 倍率） */
  selfRadianceChain?: SelfRadianceChain | null
}): RadianceZones {
  const panel = options.panel
  const dmgBonusZone = 1 + panel.radianceDmgBonus / 100
  const multZone = computeRadianceMultZone(panel)
  const specialMultZone = computeSpecialMultZone(panel)
  const crit = computeAnomalyCritZones(panel.radianceCritRate, panel.radianceCritDmg)

  const chain = options.selfRadianceChain
  const preCrit = chain
    ? options.anomalyBaseExpected *
      chain.defenseMultiplier *
      chain.resistanceMultiplier *
      Math.max(0, chain.anomalyVulnerableMultiplier) *
      Math.max(0, chain.staggerMultiplier) *
      dmgBonusZone *
      multZone *
      specialMultZone *
      Math.max(0, chain.specialMultiplier)
    : options.anomalyBaseExpected * dmgBonusZone * multZone

  return {
    dmgBonusZone,
    multZone,
    specialMultZone,
    ...crit,
    ...splitCritExpectations(preCrit, crit),
  }
}

/** 异化系数乘区：缺省或非有限值回落 1 */
export function resolveMutationMultiplier(value: number | null | undefined): number {
  return value != null && Number.isFinite(value) ? value : 1
}

/**
 * 异化系数只作用于非「蕾米埃尔本人耀变」事件：本人耀变链的异化已折进专用异常基础，
 * 这里不再重复乘（与迁移前一致）。
 */
export function applyMutationZone(value: number, options: {
  mutationMultiplier: number
  selfRadianceActive: boolean
}): number {
  return options.selfRadianceActive ? value : value * options.mutationMultiplier
}
