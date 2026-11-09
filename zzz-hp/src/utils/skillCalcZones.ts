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
 * - 有暴击区 → 同时展示暴击伤害 / 期望伤害 / 不暴击伤害（**展示层对照**，不参与汇总）
 * - 无暴击区 → 只展示期望伤害
 * 直伤仍始终展示期望暴击区 + 期望伤害。
 * 流程卡外侧数字与所有汇总一律取**期望**（2026-10-22 用户裁定：流程不允许指定必暴/必不暴）。
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
    case 'sharpen':
      return result.directDmgMultZone
    case 'attributeAnomaly':
      return result.attributeAnomalyMultZone
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

/**
 * 失衡易伤区标签：叶瞬光指定招式走「帷幕易伤」时带上限说明，
 * 其余（缺省）保持「失衡易伤区」。
 */
export function staggerZoneLabel(
  result: Pick<DamageCalcResult, 'staggerZoneKind' | 'staggerZoneCap'>,
): string {
  if (result.staggerZoneKind !== 'curtain') return '失衡易伤区'
  const cap = result.staggerZoneCap
  return cap != null ? `帷幕易伤区（上限 ${Math.round(cap * 100)}%）` : '帷幕易伤区'
}

function pushCommon(rows: SkillCalcZoneRow[], result: DamageCalcResult) {
  const baseSourceLabel =
    result.baseDamageSource === 'pierce'
      ? '面板贯穿力'
      : result.baseDamageSource === 'def'
        ? '面板防御力'
        : '面板攻击力'
  push(rows, baseSourceLabel, result.baseDamage, true)
  push(rows, '防御区', result.defenseMultiplier)
  push(rows, '抗性区', result.resistanceMultiplier)
  push(rows, staggerZoneLabel(result), result.staggerMultiplier)
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
  // 「蕾米埃尔异常基础」= 上面 5 项连乘，属中间结果，与「通用乘区」同口径不显示
  push(rows, '防御区', result.remielSelfDefenseMultiplier ?? result.defenseMultiplier)
  push(rows, '抗性区', result.remielSelfResistanceMultiplier ?? result.resistanceMultiplier)
  push(rows, '易伤区', result.anomalyVulnerableMultiplier)
  push(rows, staggerZoneLabel(result), result.staggerMultiplier)
  push(rows, '耀变增伤区', result.radianceDmgBonusZone)
  // 耀变倍率区按百分比展示（3.6 → 360）：倍率区与防御/抗性等乘数区分开，避免误读成 3.6%
  // （用户口径 2026-09-16；仅耀变如此展示，其他类型倍率区保持区小数）
  push(rows, '耀变倍率区', result.radianceMultZone * 100)
  push(rows, '特殊倍率乘区', result.specialMultZone)
  push(rows, '特殊乘区', result.specialMultiplier)
  const hasCritZone = isActiveZone(result.radianceFullCritZone)
  if (hasCritZone) {
    push(rows, '耀变暴击区', result.radianceFullCritZone)
  }
  pushAnomalyFinalDamages(rows, {
    hasCritZone,
    critDamage: result.radianceExpectedFullCrit,
    expectedDamage: result.radianceExpected,
    noCritDamage: result.radianceExpectedNoCrit,
  })
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

  if (damageType === 'direct' || damageType === 'sharpen') {
    push(rows, '易伤区', result.directVulnerableMultiplier)
    if (result.useSharpenFormula) {
      push(rows, '锐爆区', result.sharpenCritZone)
    } else {
      push(rows, '暴击区', result.critMultiplier)
    }
    push(rows, '增伤', result.dmgMultiplier)
    if (!result.useSharpenFormula && result.baseDamageSource === 'pierce') {
      push(rows, '贯穿增伤区', result.pierceDmgMultiplier)
    }
    push(rows, result.useSharpenFormula ? '技能倍率区' : '直伤倍率区', result.directDmgMultZone)
    if (!result.useSharpenFormula && result.settlementDmgMultZone > 0) {
      push(rows, '决算倍率区', result.settlementDmgMultZone)
    }
    push(rows, '期望伤害', result.directDamageExpected, true)
    return rows
  }

  push(rows, '易伤区', result.anomalyVulnerableMultiplier)
  push(rows, '精通区', result.masteryZone)
  push(rows, '等级区', result.levelZone)
  if (Number.isFinite(result.mutationZone) && Math.abs(result.mutationZone - 1) > 1e-6) {
    push(rows, '异化系数', result.mutationZone)
  }

  if (damageType === 'attributeAnomaly') {
  push(rows, '增伤区', result.dmgMultiplier)

    const hasCritZone = isActiveZone(result.attributeAnomalyFullCritZone)
    push(rows, '属性异常增伤区', result.attributeAnomalyDmgBonusZone)
    push(rows, '属性异常倍率区', result.attributeAnomalyMultZone)
    if (hasCritZone) {
      push(rows, '属性异常暴击区', result.attributeAnomalyFullCritZone)
    }
    pushAnomalyFinalDamages(rows, {
      hasCritZone,
      critDamage: result.attributeAnomalyExpectedFullCrit,
      expectedDamage: result.attributeAnomalyExpected,
      noCritDamage: result.attributeAnomalyExpectedNoCrit,
    })
    return rows
  }

  if (damageType === 'disorder') {
  push(rows, '增伤区', result.dmgMultiplier)

    // 紊乱**只吃自己的**暴击（紊乱暴击率/爆伤），与乱流同款判断
    const hasCritZone = isActiveZone(result.disorderFullCritZone)
    push(rows, '紊乱基础倍率', result.disorderBaseMultRatio)
    push(rows, '异常持续时间', result.effectiveAnomalyDuration)
    push(rows, '紊乱补偿倍率', result.disorderCompMultRatio)
    if (isActiveZone(result.disorderMultFactor)) {
      push(rows, '紊乱倍率修正', result.disorderMultFactor)
    }
    push(rows, '紊乱倍率区', result.disorderZone)
    push(rows, '紊乱增伤区', result.disorderDmgBonusZone)
    if (hasCritZone) {
      push(rows, '紊乱暴击区', result.disorderFullCritZone)
    }
    pushAnomalyFinalDamages(rows, {
      hasCritZone,
      critDamage: result.disorderExpectedFullCrit,
      expectedDamage: result.disorderExpected,
      noCritDamage: result.disorderExpectedNoCrit,
    })
    return rows
  }

  if (damageType === 'turbulence') {
  push(rows, '增伤区', result.dmgMultiplier)

    // 乱流**只吃自己的**暴击（用户 2026-10-16：不再蹭异常暴击）
    const hasCritZone = isActiveZone(result.turbulenceFullCritZone)
    push(rows, '乱流基础倍率', result.turbulenceBaseMultRatio)
    push(rows, '异常持续时间', result.effectiveAnomalyDuration)
    push(rows, '乱流补偿倍率', result.turbulenceCompMultRatio)
    if (isActiveZone(result.turbulenceMultFactor)) {
      push(rows, '乱流倍率修正', result.turbulenceMultFactor)
    }
    push(rows, '乱流倍率区', result.turbulenceZone)
    push(rows, '乱流增伤区', result.turbulenceDmgBonusZone)
    if (hasCritZone) {
      push(rows, '乱流暴击区', result.turbulenceFullCritZone)
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
  push(rows, '增伤区', result.dmgMultiplier)

    push(rows, '异放增伤区', result.anomalyReleaseDmgBonusZone)
    push(rows, '异放倍率区', result.anomalyReleaseMultZone)
    // 「异常综合暴击区」已删除 → 异放用自己的暴击区（用户 2026-10-16）
    const hasCritZone = isActiveZone(result.anomalyReleaseFullCritZone)
    if (hasCritZone) {
      push(rows, '异放暴击区', result.anomalyReleaseFullCritZone)
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
  push(rows, '增伤区', result.dmgMultiplier)

    // 耀变暴击对所有触发者成立（蕾米本人链见 pushRemielSelfRadianceRows）
    const hasCritZone = isActiveZone(result.radianceFullCritZone)
    push(rows, '耀变增伤区', result.radianceDmgBonusZone)
    // 百分比展示，同 pushRemielSelfRadianceRows 的耀变倍率区
    push(rows, '耀变倍率区', result.radianceMultZone * 100)
    if (hasCritZone) {
      push(rows, '耀变暴击区', result.radianceFullCritZone)
    }
    pushAnomalyFinalDamages(rows, {
      hasCritZone,
      critDamage: result.radianceExpectedFullCrit,
      expectedDamage: result.radianceExpected,
      noCritDamage: result.radianceExpectedNoCrit,
    })
  }

  return rows
}

/* ===================== 格子归属与口径说明（2026-10-26） ===================== */

/** 乘区归属：异常强度提供者 / 异常类触发者 / 最终伤害 */
export type SkillCalcZoneGroup = 'producer' | 'trigger' | 'mixed' | 'result'

const PRODUCER_ZONE_LABELS = new Set([
  '局内攻击力',
  '局内精通区',
  '精通区',
  '特殊等级区',
  '异化系数区',
  '异化系数',
  '等级区',
  '基础伤害',
  '面板攻击力',
  '面板防御力',
  '面板贯穿力',
  '增伤区',
  // 紊乱 / 乱流的「倍率与持续时间」取异常强度提供者
  // （口径见 DamageResultDetail 的 valueTips：multPanel = producer）
  '增伤',
  '紊乱基础倍率',
  '异常持续时间',
  '紊乱补偿倍率',
  '紊乱倍率修正',
  '紊乱倍率区',
  '乱流基础倍率',
  '乱流补偿倍率',
  '乱流倍率修正',
  '乱流倍率区',
])

const MIXED_ZONE_LABELS = new Set(['通用乘区', '防御区'])

const RESULT_ZONE_LABELS = new Set(['暴击伤害', '期望伤害', '不暴击伤害'])

/**
 * 易伤区 / 直伤易伤区 / 非直伤易伤区是**同一个乘区**，只是按伤害类型取其中一档，
 * 加成来源统一是异常类触发者（所有者 2026-11-01 口径）。
 */
const VULNERABLE_ZONE_LABELS = new Set(['易伤区'])

export function skillCalcZoneGroup(label: string): SkillCalcZoneGroup {
  if (MIXED_ZONE_LABELS.has(label)) return 'mixed'
  if (PRODUCER_ZONE_LABELS.has(label)) return 'producer'
  if (VULNERABLE_ZONE_LABELS.has(label)) return 'trigger'
  if (RESULT_ZONE_LABELS.has(label)) return 'result'
  return 'trigger'
}

const VULNERABLE_ZONE_HINT =
  '易伤区 / 直伤易伤区 / 非直伤易伤区是同一个乘区，按伤害类型取对应的一档；加成与减伤都在这里加算（异常类路径的加成来源取异常类触发者）。'

const ZONE_HINTS: Record<string, string> = {
  局内攻击力: '本人耀变链：局外攻击 + 蕾米埃尔角色/影画「攻击力转模」；不含局内攻击%、队友/邦布、音擎/驱动盘其它攻击增益。',
  局内精通区: '本人耀变链：局外精通 + 驱动盘4件套全局精通 + 音擎全局精通，再 ÷100 得区；不含队友/邦布及其它精通增益。',
  精通区: '局内精通 ÷ 100（取异常强度提供者面板）。',
  特殊等级区: '本人耀变链的特殊等级区 = 1 + 0.025 × 角色等级（等级取提供者）。',
  异化系数区: '数值由队伍中的蕾米埃尔提供：取她的局内面板「异化系数」与修正，计算式 max(0, 1 + 异化系数%) × 修正%。提供者只是该乘区归属角色。',
  异化系数: '数值由队伍中的蕾米埃尔提供：取她的局内面板「异化系数」与修正，计算式 max(0, 1 + 异化系数%) × 修正%。',
  等级区: '角色等级对应的等级区。',
  基础伤害: '面板攻击力（倍率见倍率区，不在此处重复）。',
  面板攻击力: '基础伤害取异常强度提供者的面板攻击力（不含招式倍率，倍率见倍率区）。',
  面板防御力: '基础伤害取异常强度提供者的面板防御力（不含招式倍率，倍率见倍率区）。',
  面板贯穿力: '基础伤害取贯穿力（0.1×生命 + 0.3×攻击 + 贯穿加成），不含招式倍率。',
  增伤区: '1 + 增伤加成（取异常强度提供者）。',
  防御区: '穿透率与穿透值取异常强度提供者，减防 / 无视防御取异常类触发者；794 / (794 + 敌方防御 × 防御因子 × (1 − 穿透率))。',
  抗性区: '1 − 敌方抗性 + 抗性穿透。',
  易伤区: VULNERABLE_ZONE_HINT,
  失衡易伤区: '1 + 失衡易伤（全局与本期加算，取异常类触发者）。',
  通用乘区: '由基础伤害 × 增伤区 × 防御区 × 抗性区 × 失衡易伤区连乘；基础/增伤/失衡取异常强度提供者，防御/抗性取异常类触发者。',
  特殊乘区: '招式与增益提供的独立乘区连乘（取异常类触发者）。',
  增伤: '1 + 增伤加成。',
  暴击区: '1 + 暴击率 × 暴击伤害（期望暴击）。',
  锐爆区: '锐化路径的暴击区：1 + 锐爆率 × 锐爆伤害。',
  贯穿增伤区: '贯穿伤害路径的独立增伤乘区。',
  技能倍率区: '招式倍率对应的乘区。',
  直伤倍率区: '直伤倍率对应的乘区。',
  决算倍率区: '决算倍率（结算额外倍率）。',
  特殊倍率乘区: '特殊倍率乘区（如耀变倍率之外的额外倍率）。',
  属性异常增伤区: '1 + 属性异常增伤（触发者）。只影响属性异常子类。',
  属性异常倍率区: '属性异常倍率区（触发者）。只影响属性异常子类。',
  属性异常暴击区: '1 + 属性异常暴击率 × 属性异常爆伤（触发者）。只影响属性异常子类。',
  耀变增伤区: '1 + 耀变增伤（触发者）；不再叠加属性异常增伤。',
  耀变倍率区: '耀变倍率 × 100（百分数展示）。',
  耀变暴击区: '1 + 耀变暴击率 × 耀变爆伤（触发者）。',
  异放增伤区: '1 + 异放增伤（触发者）；不再叠加属性异常增伤。',
  异放倍率区: '异放倍率区（触发者）。',
  异放暴击区: '1 + 异放暴击率 × 异放爆伤（触发者）。',
  紊乱基础倍率: '紊乱基础倍率（含异常基础伤害，取异常强度提供者）。',
  异常持续时间: '异常效果的实际持续时间（秒，取异常强度提供者）。',
  紊乱补偿倍率: '紊乱补偿倍率 = 1 + 补偿系数 / 100（取异常强度提供者）。',
  紊乱倍率修正: '紊乱倍率修正（乱流 / 紊乱专用乘区，取异常强度提供者）。',
  紊乱倍率区: '紊乱倍率区（取异常强度提供者）。',
  紊乱增伤区: '1 + 紊乱增伤（触发者）。',
  紊乱暴击区: '1 + 紊乱暴击率 × 紊乱爆伤（触发者）。',
  乱流基础倍率: '乱流基础倍率（含异常基础伤害，取异常强度提供者）。',
  乱流补偿倍率: '乱流补偿倍率 = 1 + 补偿系数 / 100（取异常强度提供者）。',
  乱流倍率修正: '乱流倍率修正（频率 / 触发相关，取异常强度提供者）。',
  乱流倍率区: '乱流倍率区（取异常强度提供者）。',
  乱流增伤区: '1 + 乱流增伤（触发者）；不再叠加属性异常增伤。',
  乱流暴击区: '1 + 乱流暴击率 × 乱流爆伤（触发者）。',
  暴击伤害: '按必暴计算的单次伤害（仅对照展示）。',
  期望伤害: '单次期望伤害（暴击按概率加权）。',
  不暴击伤害: '按不暴击计算的单次伤害（仅对照展示）。',
}

export function skillCalcZoneHint(label: string): string {
  if (label.startsWith('帷幕易伤区')) {
    return '叶瞬光指定招式：取最终失衡易伤（基础 + 全局/失衡/仅失衡加成）后截断到上限，且不分失衡阶段。'
  }
  return ZONE_HINTS[label] ?? '由结算链路直接给出该乘区数值。'
}
