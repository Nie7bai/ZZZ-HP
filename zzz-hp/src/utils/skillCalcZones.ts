import type { SkillDamageType } from '@/types/calculator'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import type { DamageCalcResult } from '@/utils/damageCalc'

export interface SkillCalcZoneRow {
  label: string
  value: string
}

function formatZoneValue(value: number, asDamage = false) {
  if (!Number.isFinite(value)) return '—'
  if (asDamage) {
    return Math.round(value).toLocaleString('en-US')
  }
  return formatCalcDecimal(value)
}

function push(
  rows: SkillCalcZoneRow[],
  label: string,
  value: number,
  asDamage = false,
) {
  rows.push({ label, value: formatZoneValue(value, asDamage) })
}

/** 乘区是否实质参与（非恒等于 1） */
function isActiveZone(value: number) {
  return Number.isFinite(value) && Math.abs(value - 1) > 1e-6
}

/**
 * 流程「计算过程」最终格（仅异常类）：
 * - 有暴击区 → 同时展示暴击伤害 / 期望伤害 / 不暴击伤害
 * - 无暴击区 → 只展示期望伤害
 * 直伤仍始终展示期望暴击区 + 期望伤害。
 * 流程卡外侧数字对异常类取必暴击，见 resolveFlowHitCritMode。
 */
function pushAnomalyFinalDamages(
  rows: SkillCalcZoneRow[],
  options: {
    hasCritZone: boolean
    critDamage: number
    expectedDamage: number
    noCritDamage?: number
  },
) {
  if (options.hasCritZone) {
    push(rows, '暴击伤害', options.critDamage, true)
    push(rows, '期望伤害', options.expectedDamage, true)
    if (options.noCritDamage != null) {
      push(rows, '不暴击伤害', options.noCritDamage, true)
    }
  } else {
    push(rows, '期望伤害', options.expectedDamage, true)
  }
}

/** 计算过程用：该伤害类型对应的最终倍率区（紊乱/乱流含持续时间×补偿） */
export function pickSkillMultZone(
  result: DamageCalcResult,
  damageType: SkillDamageType,
): number | null {
  switch (damageType) {
    case 'direct':
      return result.directDmgMultZone
    case 'anomaly':
      return result.anomalyMultZone
    case 'anomalyRelease':
      return result.anomalyReleaseMultZone
    case 'disorder':
      return result.disorderZone
    case 'turbulence':
      return result.turbulenceZone
    case 'radiance':
      return result.radianceMultZone
    default:
      return null
  }
}

/**
 * 招式卡片 / 详情「倍率%」用：最终倍率区换算成百分点前的比率。
 * 紊乱/乱流为含「持续时间×补偿」的完整倍率区（非基础分量）。
 * 计算过程仍用 formatSkillMultZone 展示区小数，勿混用本函数的 % 语义。
 */
export function pickSkillMultPercentRatio(
  result: DamageCalcResult,
  damageType: SkillDamageType,
): number | null {
  return pickSkillMultZone(result, damageType)
}

export function formatSkillMultZone(value: number): string {
  return formatZoneValue(value)
}

/**
 * 招式「倍率%」字段用：比率换算成百分点（0.712 → 71.2）。
 * 计算过程里的倍率区仍用 formatSkillMultZone，不带 %。
 */
export function formatSkillMultZoneAsPercent(zone: number): string {
  if (!Number.isFinite(zone)) return '—'
  const percent = zone * 100
  if (Number.isInteger(percent) || Math.abs(percent - Math.round(percent)) < 1e-6) {
    return String(Math.round(percent))
  }
  // 保留合理精度，去掉多余尾零
  const text = formatCalcDecimal(percent)
  return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function pushCommon(rows: SkillCalcZoneRow[], result: DamageCalcResult) {
  push(rows, '基础伤害', result.baseDamage, true)
  push(rows, '防御区', result.defenseMultiplier)
  push(rows, '抗性区', result.resistanceMultiplier)
  push(rows, '易伤区', result.vulnerableMultiplier)
  push(rows, '失衡易伤区', result.staggerMultiplier)
  push(rows, '通用乘区', result.generalMultiplier)
  push(rows, '特殊乘区', result.specialMultiplier)
}

/** 蕾米本人耀变：与面板公式分解同一套乘区，不用普通异常的通用/精通链 */
function pushRemielSelfRadianceRows(rows: SkillCalcZoneRow[], result: DamageCalcResult) {
  push(rows, '局内攻击力', result.remielSelfInCombatAtk ?? 0)
  push(rows, '局内精通区', result.remielSelfInCombatMasteryZone ?? 0)
  push(rows, '特殊等级区', result.remielSelfSpecialLevelZone ?? 1)
  push(rows, '异化系数区', result.remielSelfMutationZone ?? result.mutationZone)
  push(rows, '等级区', result.remielSelfStandardLevelZone ?? result.levelZone)
  push(rows, '蕾米埃尔异常基础', result.anomalyBaseExpected, true)
  push(rows, '防御区', result.remielSelfDefenseMultiplier ?? result.defenseMultiplier)
  push(rows, '抗性区', result.remielSelfResistanceMultiplier ?? result.resistanceMultiplier)
  push(rows, '易伤区', result.vulnerableMultiplier)
  push(rows, '失衡易伤区', result.staggerMultiplier)
  push(rows, '耀变综合增伤区', result.radianceCombinedDmgBonusZone)
  push(rows, '耀变倍率区', result.radianceMultZone)
  push(rows, '特殊倍率乘区', result.specialMultZone)
  push(rows, '特殊乘区', result.specialMultiplier)
  push(rows, '期望伤害', result.radianceExpected, true)
}

/** 按伤害类型列出本条招式实际用到的乘区，风格对齐 zzz-dev 招式详情的 key / value。 */
export function buildSkillCalcZoneRows(
  result: DamageCalcResult,
  damageType: SkillDamageType,
): SkillCalcZoneRow[] {
  const rows: SkillCalcZoneRow[] = []

  if (damageType === 'radiance' && result.remielSelfRadianceActive) {
    pushRemielSelfRadianceRows(rows, result)
    return rows
  }

  pushCommon(rows, result)

  if (damageType === 'direct') {
    push(rows, '暴击区', result.critMultiplier)
    push(rows, '增伤', result.dmgMultiplier)
    if (result.baseDamageSource === 'pierce') {
      push(rows, '贯穿增伤区', result.pierceDmgMultiplier)
    }
    push(rows, '直伤倍率区', result.directDmgMultZone)
    if (result.settlementDmgMultZone > 0) {
      push(rows, '决算倍率区', result.settlementDmgMultZone)
    }
    push(rows, '期望伤害', result.directDamageExpected, true)
    return rows
  }

  push(rows, '精通区', result.masteryZone)
  push(rows, '等级区', result.levelZone)
  if (Number.isFinite(result.mutationZone) && Math.abs(result.mutationZone - 1) > 1e-6) {
    push(rows, '异化系数', result.mutationZone)
  }

  if (damageType === 'anomaly') {
    const hasCritZone = isActiveZone(result.anomalyFullCritZone)
    push(rows, '异常增伤区', result.anomalyDmgBonusZone)
    push(rows, '异常倍率区', result.anomalyMultZone)
    if (hasCritZone) {
      push(rows, '异常暴击区', result.anomalyFullCritZone)
    }
    pushAnomalyFinalDamages(rows, {
      hasCritZone,
      critDamage: result.anomalyExpectedFullCrit,
      expectedDamage: result.anomalyExpected,
      noCritDamage: result.anomalyExpectedNoCrit,
    })
    return rows
  }

  if (damageType === 'disorder') {
    push(rows, '紊乱基础倍率', result.disorderBaseMultRatio)
    push(rows, '异常持续时间', result.effectiveAnomalyDuration)
    push(rows, '紊乱补偿倍率', result.disorderCompMultRatio)
    push(rows, '紊乱倍率区', result.disorderZone)
    push(rows, '紊乱增伤区', result.disorderDmgBonusZone)
    push(rows, '期望伤害', result.disorderExpected, true)
    return rows
  }

  if (damageType === 'turbulence') {
    const hasCritZone =
      result.turbulenceUsesAnomalyCrit && isActiveZone(result.anomalyFullCritZone)
    push(rows, '乱流基础倍率', result.turbulenceBaseMultRatio)
    push(rows, '异常持续时间', result.effectiveAnomalyDuration)
    push(rows, '乱流补偿倍率', result.turbulenceCompMultRatio)
    push(rows, '乱流倍率区', result.turbulenceZone)
    push(rows, '乱流综合增伤区', result.turbulenceCombinedDmgBonusZone)
    if (hasCritZone) {
      push(rows, '异常暴击区', result.anomalyFullCritZone)
    }
    pushAnomalyFinalDamages(rows, {
      hasCritZone,
      critDamage: result.turbulenceExpectedFullCrit,
      expectedDamage: result.turbulenceExpected,
      noCritDamage: result.turbulenceExpectedNoCrit,
    })
    return rows
  }

  if (damageType === 'anomalyRelease') {
    const hasCritZone = isActiveZone(result.anomalyCombinedFullCritZone)
    push(rows, '异放综合增伤区', result.anomalyReleaseCombinedDmgBonusZone)
    push(rows, '异放倍率区', result.anomalyReleaseMultZone)
    if (hasCritZone) {
      push(rows, '异常综合暴击区', result.anomalyCombinedFullCritZone)
    }
    pushAnomalyFinalDamages(rows, {
      hasCritZone,
      critDamage: result.anomalyReleaseExpectedFullCrit,
      expectedDamage: result.anomalyReleaseExpected,
      noCritDamage: result.anomalyReleaseExpectedNoCrit,
    })
    return rows
  }

  if (damageType === 'radiance') {
    push(rows, '耀变综合增伤区', result.radianceCombinedDmgBonusZone)
    push(rows, '耀变倍率区', result.radianceMultZone)
    push(rows, '期望伤害', result.radianceExpected, true)
  }

  return rows
}
