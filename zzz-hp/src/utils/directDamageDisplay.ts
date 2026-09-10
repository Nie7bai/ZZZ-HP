import type { SkillSubcategory } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import type { DamageCalcResult } from '@/utils/damageCalc'
import { multFactorPercentToRatio } from '@/utils/multFactorPercent'
import {
  normalizeSkillSubcategoryMultFields,
  unsetSkillMult,
} from '@/utils/skillSubcategoryMult'

export interface DirectFormulaTerm {
  label: string
  value: string
  tipsKey: string
}

export interface AlignedDirectFormulaGroup {
  key: 'directDamageExpected'
  title: string
  terms: DirectFormulaTerm[]
  /** 基础链后与各倍率区相乘再加算（直伤 + 决算） */
  sumMultZones?: DirectFormulaTerm[]
  baseChainValue?: number
  result: string
}

/**
 * 锐爆区明细文案（锋御专用，与常规暴击区口径不同）。
 * B = 锐爆伤害加成%/100（无内置基础值）；r = clamp(暴击率%/100, 0, 2)。
 * B 与 r 均直接取自结算结果，保证展示与引擎计算同源，不会各算一套。
 */
export function buildSharpenCritZoneLines(
  p: DamageCalcResult,
  formatNumber: (value: number, precision?: number) => string,
): string[] {
  const B = p.sharpenCritDmgRatio
  const r = p.critRateRatio
  const lines = [
    `锐爆伤害加成 ${formatNumber(B * 100, 2)}% → B = ${formatNumber(B, 4)}`,
    `暴击率 ${formatNumber(r * 100, 2)}% → r = ${formatNumber(r, 4)}（上限 200%）`,
  ]
  if (r <= 1) {
    lines.push(
      `锐爆区 = 1 + r × B = 1 + ${formatNumber(r, 4)} × ${formatNumber(B, 4)} = ${formatNumber(p.sharpenCritZone, 4)}`,
    )
  } else {
    const overflow = r - 1
    const left = 1 + B
    const right = 1 + B * overflow
    lines.push(
      '锐爆区 = (1 + B) × [1 + B × (r − 1)]（首段必暴，溢出段再判一次）',
      `= (1 + ${formatNumber(B, 4)}) × [1 + ${formatNumber(B, 4)} × ${formatNumber(overflow, 4)}]`,
      `= ${formatNumber(left, 4)} × ${formatNumber(right, 4)} = ${formatNumber(p.sharpenCritZone, 4)}`,
    )
  }
  return lines
}

export function computeDirectBaseChain(p: DamageCalcResult): number {
  if (p.useSharpenFormula) {
    return (
      p.generalMultiplier *
      Math.max(0, p.directVulnerableMultiplier) *
      p.critMultiplier *
      Math.max(0, p.specialMultiplier) *
      Math.max(0, p.sharpenDmgMultiplier)
    )
  }
  return (
    p.generalMultiplier *
    Math.max(0, p.directVulnerableMultiplier) *
    p.critMultiplier *
    Math.max(0, p.specialMultiplier) *
    Math.max(0, p.pierceDmgMultiplier)
  )
}

export function buildDirectBaseChainFactorLabels(p: DamageCalcResult): string[] {
  const parts = [
    String(p.generalMultiplier),
    String(p.directVulnerableMultiplier),
    String(p.critMultiplier),
    String(p.specialMultiplier),
  ]
  if (p.useSharpenFormula) {
    parts.push(String(p.sharpenDmgMultiplier))
  } else if (p.baseDamageSource === 'pierce') {
    parts.push(String(p.pierceDmgMultiplier))
  }
  return parts
}

export function buildAlignedDirectFormulaGroup(
  p: DamageCalcResult,
  formatFormulaNumber: (value: number, precision?: number) => string,
  formatNumber: (value: number) => string,
  resultValue?: string,
): AlignedDirectFormulaGroup {
  const baseTerms: DirectFormulaTerm[] = [
    {
      label: '通用乘区',
      value: formatFormulaNumber(p.generalMultiplier, 2),
      tipsKey: 'generalMultiplier',
    },
    {
      label: '直伤易伤区',
      value: formatFormulaNumber(p.directVulnerableMultiplier),
      tipsKey: 'directVulnerableMultiplier',
    },
    {
      label: p.useSharpenFormula ? '锐爆区' : '暴击区',
      value: formatFormulaNumber(p.critMultiplier),
      tipsKey: 'critMultiplier',
    },
    {
      label: '特殊乘区',
      value: formatFormulaNumber(p.specialMultiplier),
      tipsKey: 'specialMultiplier',
    },
  ]
  if (p.useSharpenFormula) {
    baseTerms.push({
      label: '锐化伤害提升区',
      value: formatFormulaNumber(p.sharpenDmgMultiplier),
      tipsKey: 'sharpenDmgMultiplier',
    })
  } else if (p.baseDamageSource === 'pierce') {
    baseTerms.push({
      label: '贯穿增伤区',
      value: formatFormulaNumber(p.pierceDmgMultiplier),
      tipsKey: 'pierceDmgMultiplier',
    })
  }

  const directZone: DirectFormulaTerm = {
    label: '直伤倍率区',
    value: formatFormulaNumber(p.directDmgMultZone),
    tipsKey: 'directDmgMultZone',
  }
  const settlementZone: DirectFormulaTerm | null =
    p.settlementDmgMultZone > 0
      ? {
          label: '决算倍率区',
          value: formatFormulaNumber(p.settlementDmgMultZone),
          tipsKey: 'settlementDmgMultZone',
        }
      : null

  if (!settlementZone) {
    return {
      key: 'directDamageExpected',
      title: '公式',
      terms: [...baseTerms, directZone],
      result: resultValue ?? formatNumber(p.directDamageExpected),
    }
  }

  return {
    key: 'directDamageExpected',
    title: '公式',
    terms: baseTerms,
    sumMultZones: [directZone, settlementZone],
    baseChainValue: computeDirectBaseChain(p),
    result: resultValue ?? formatNumber(p.directDamageExpected),
  }
}

function readPanelFactor(value: number | undefined | null): number {
  return multFactorPercentToRatio(value) || 1
}

export function formatDirectDmgMultZoneFormula(
  panel: PanelStats,
  zone: number,
  skillSubcategory?: SkillSubcategory | null,
): string {
  const panelFactor = readPanelFactor(panel.directDmgMultFactor)
  if (skillSubcategory) {
    const sub = normalizeSkillSubcategoryMultFields(skillSubcategory)
    const subFactor = readPanelFactor(sub.directDmgMultFactor)
    const directMult = unsetSkillMult(sub.directDmgMult)
      ? panel.directDmgMult
      : sub.directDmgMult
    return `直伤倍率区 max(0, ${directMult}%) × 小类修正 ${subFactor} × 直伤倍率修正 ${panelFactor} = ${zone}`
  }
  return `直伤倍率区 max(0, ${panel.directDmgMult}%) × 直伤倍率修正 ${panelFactor} = ${zone}`
}

export function formatSettlementDmgMultZoneFormula(
  panel: PanelStats,
  zone: number,
  skillSubcategory?: SkillSubcategory | null,
): string {
  const panelFactor = readPanelFactor(panel.directDmgMultFactor)
  if (skillSubcategory) {
    const sub = normalizeSkillSubcategoryMultFields(skillSubcategory)
    const subFactor = readPanelFactor(sub.directDmgMultFactor)
    return `决算倍率区 max(0, ${sub.settlementDmgMult}%) × 小类修正 ${subFactor} × 直伤倍率修正 ${panelFactor} = ${zone}`
  }
  return `决算倍率区 max(0, ${panel.settlementDmgMult}%) × 直伤倍率修正 ${panelFactor} = ${zone}`
}

export function buildDirectDamageExpectedProcessItems(
  p: DamageCalcResult,
  formatFormulaNumber: (value: number, precision?: number) => string,
  formatNumber: (value: number) => string,
): string[] {
  const baseChain = computeDirectBaseChain(p)
  const baseChainText = formatFormulaNumber(baseChain, 2)

  if (p.settlementDmgMultZone > 0) {
    return [
      `基础链 ${baseChainText}`,
      `${baseChainText} × ${formatFormulaNumber(p.directDmgMultZone)} = ${formatNumber(p.directDamageFromDirectMult)}`,
      `${baseChainText} × ${formatFormulaNumber(p.settlementDmgMultZone)} = ${formatNumber(p.settlementDamageExpected)}`,
      `${formatNumber(p.directDamageFromDirectMult)} + ${formatNumber(p.settlementDamageExpected)} = ${formatNumber(p.directDamageExpected)}`,
    ]
  }

  const factors = buildDirectBaseChainFactorLabels(p).map((item) => formatFormulaNumber(Number(item)))
  factors.push(formatFormulaNumber(p.directDmgMultZone))
  return [`${factors.join(' × ')} = ${formatNumber(p.directDamageExpected)}`]
}
