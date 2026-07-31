import type { AnomalyDamageSubKind } from '@/types/calculator'
import type { DamageCalcResult } from '@/utils/damageCalc'

export interface AnomalyFormulaAgentLabels {
  /** 异常基础乘区所属角色（产生角色或 owner） */
  baseAgent?: string
  /** 增伤/倍率/暴击等 bonus 乘区所属角色（紊乱/乱流为事件 owner，异放/耀变为 main C） */
  bonusAgent?: string
  /** 异化系数区所属角色（蕾米埃尔） */
  mutationAgent?: string
}

export interface AlignedFormulaTerm {
  label: string
  value: string
  tipsKey: string
}

export type AlignedAnomalyFormulaKey =
  | 'anomalyBaseExpected'
  | 'anomalyExpected'
  | 'anomalyReleaseExpected'
  | 'radianceExpected'
  | 'radianceMutation'
  | 'disorderExpected'
  | 'turbulenceExpected'

export interface AlignedAnomalyFormulaGroup {
  key: AlignedAnomalyFormulaKey
  title: string
  hint?: string
  /** 乘区所属角色名，展示在标题开头 */
  agentLabel?: string
  terms: AlignedFormulaTerm[]
  result: string
  dualResults?: { label: string; value: string }[]
}

export function buildAlignedAnomalyFormulaGroups(
  p: DamageCalcResult,
  sub: AnomalyDamageSubKind,
  disorderLabel: string,
  formatFormulaNumber: (v: number, precision?: number) => string,
  formatNumber: (v: number) => string,
  labels?: AnomalyFormulaAgentLabels,
): AlignedAnomalyFormulaGroup[] {
  const hasMutation = p.mutationZone > 1
  const baseWithMutation = hasMutation
    ? Math.round(p.anomalyBaseExpected * p.mutationZone)
    : p.anomalyBaseExpected
  const baseTerms: AlignedFormulaTerm[] = [
    { label: '通用乘区', value: formatFormulaNumber(p.generalMultiplier, 2), tipsKey: 'generalMultiplier' },
    { label: '精通区', value: formatFormulaNumber(p.masteryZone), tipsKey: 'masteryZone' },
    { label: '等级区', value: formatFormulaNumber(p.levelZone), tipsKey: 'levelZone' },
    { label: '特殊乘区', value: formatFormulaNumber(p.specialMultiplier), tipsKey: 'specialMultiplier' },
  ]
  if (hasMutation) {
    baseTerms.push({
      label: '异化系数区',
      value: formatFormulaNumber(p.mutationZone),
      tipsKey: 'mutationZone',
    })
  }
  const base: AlignedAnomalyFormulaGroup = {
    key: 'anomalyBaseExpected',
    title: '异常基础',
    hint: hasMutation ? '（含异化系数；不含异常增伤/倍率/暴击）' : '（不含异常增伤/倍率/暴击）',
    agentLabel: labels?.baseAgent,
    terms: baseTerms,
    result: formatNumber(baseWithMutation),
  }
  const anomaly: AlignedAnomalyFormulaGroup = {
    key: 'anomalyExpected',
    title: '异常伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '异常增伤区', value: formatFormulaNumber(p.anomalyDmgBonusZone), tipsKey: 'anomalyDmgBonusZone' },
      { label: '异常倍率区', value: formatFormulaNumber(p.anomalyMultZone), tipsKey: 'anomalyMultZone' },
      {
        label: '异常暴击区',
        value: `1 / ${formatFormulaNumber(p.anomalyFullCritZone)}`,
        tipsKey: 'anomalyCritZone',
      },
    ],
    result: formatNumber(p.anomalyExpected),
    dualResults: [
      { label: '暴击率=0', value: formatNumber(p.anomalyExpectedNoCrit) },
      { label: '暴击率=1', value: formatNumber(p.anomalyExpectedFullCrit) },
    ],
  }
  const disorder: AlignedAnomalyFormulaGroup = {
    key: 'disorderExpected',
    title: `${disorderLabel}期望`,
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '紊乱倍率区', value: formatFormulaNumber(p.disorderZone), tipsKey: 'disorderZone' },
      { label: '紊乱增伤区', value: formatFormulaNumber(p.disorderDmgBonusZone), tipsKey: 'disorderDmgBonusZone' },
    ],
    result: formatNumber(p.disorderExpected),
  }
  const turbulence: AlignedAnomalyFormulaGroup = {
    key: 'turbulenceExpected',
    title: '乱流伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '乱流倍率区', value: formatFormulaNumber(p.turbulenceZone), tipsKey: 'turbulenceZone' },
      {
        label: '乱流增伤区+异常增伤区',
        value: formatFormulaNumber(p.turbulenceCombinedDmgBonusZone),
        tipsKey: 'turbulenceCombinedDmgBonusZone',
      },
      {
        label: '异常暴击区',
        value: `1 / ${formatFormulaNumber(p.anomalyFullCritZone)}`,
        tipsKey: 'anomalyCritZone',
      },
    ],
    result: formatNumber(p.turbulenceExpected),
    dualResults: [
      { label: '暴击率=0', value: formatNumber(p.turbulenceExpectedNoCrit) },
      { label: '暴击率=1', value: formatNumber(p.turbulenceExpectedFullCrit) },
    ],
  }
  const release: AlignedAnomalyFormulaGroup = {
    key: 'anomalyReleaseExpected',
    title: '异放伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      {
        label: '异放综合增伤区',
        value: formatFormulaNumber(p.anomalyReleaseCombinedDmgBonusZone),
        tipsKey: 'anomalyReleaseCombinedDmgBonusZone',
      },
      {
        label: '异放倍率区',
        value: formatFormulaNumber(p.anomalyReleaseMultZone),
        tipsKey: 'anomalyReleaseMultZone',
      },
      {
        label: '异常综合暴击区',
        value: `1 / ${formatFormulaNumber(p.anomalyCombinedFullCritZone)}`,
        tipsKey: 'anomalyCombinedCritZone',
      },
    ],
    result: formatNumber(p.anomalyReleaseExpected),
    dualResults: [
      { label: '暴击率=0', value: formatNumber(p.anomalyReleaseExpectedNoCrit) },
      { label: '暴击率=1', value: formatNumber(p.anomalyReleaseExpectedFullCrit) },
    ],
  }
  const radianceChain: AlignedAnomalyFormulaGroup = {
    key: 'radianceExpected',
    title: '耀变伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      {
        label: '耀变综合增伤区',
        value: formatFormulaNumber(p.radianceCombinedDmgBonusZone),
        tipsKey: 'radianceCombinedDmgBonusZone',
      },
      {
        label: '耀变倍率区',
        value: formatFormulaNumber(p.radianceMultZone),
        tipsKey: 'radianceMultZone',
      },
    ],
    result: formatNumber(p.radianceExpected),
  }

  if (sub === 'disorder') return [base, disorder]
  if (sub === 'turbulence') return [base, turbulence]
  if (sub === 'anomalyRelease') return [base, release]
  if (sub === 'radiance') return [base, radianceChain]
  return [base, anomaly]
}

export function formatFormulaGroupTitle(group: Pick<AlignedAnomalyFormulaGroup, 'title' | 'agentLabel' | 'hint'>) {
  const prefix = group.agentLabel ? `${group.agentLabel} · ` : ''
  return { prefix, title: group.title, hint: group.hint }
}

export function resolveAnomalyBaseWithMutation(
  p: Pick<DamageCalcResult, 'anomalyBaseExpected' | 'mutationZone'>,
): number {
  return p.mutationZone > 1 ? Math.round(p.anomalyBaseExpected * p.mutationZone) : p.anomalyBaseExpected
}
