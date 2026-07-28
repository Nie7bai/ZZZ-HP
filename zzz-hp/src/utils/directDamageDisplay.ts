import type { SkillSubcategory } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import type { DamageCalcResult } from '@/utils/damageCalc'
import { multFactorPercentToRatio } from '@/utils/multFactorPercent'
import { normalizeSkillSubcategoryMultFields } from '@/utils/skillSubcategoryMult'

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

export function computeDirectBaseChain(p: DamageCalcResult): number {
  return (
    p.generalMultiplier *
    p.critMultiplier *
    Math.max(0, p.specialMultiplier) *
    Math.max(0, p.pierceDmgMultiplier)
  )
}

export function buildDirectBaseChainFactorLabels(p: DamageCalcResult): string[] {
  const parts = [
    String(p.generalMultiplier),
    String(p.critMultiplier),
    String(p.specialMultiplier),
  ]
  if (p.baseDamageSource === 'pierce') {
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
    { label: '暴击区', value: formatFormulaNumber(p.critMultiplier), tipsKey: 'critMultiplier' },
    {
      label: '特殊乘区',
      value: formatFormulaNumber(p.specialMultiplier),
      tipsKey: 'specialMultiplier',
    },
  ]
  if (p.baseDamageSource === 'pierce') {
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
    return `直伤倍率区 max(0, ${sub.directDmgMult}%) × 小类修正 ${subFactor} × 直伤倍率修正 ${panelFactor} = ${zone}`
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
