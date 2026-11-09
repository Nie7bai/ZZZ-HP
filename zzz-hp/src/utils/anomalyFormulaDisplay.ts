import type { AnomalyDamageSubKind, DamageEventCritMode } from '@/types/calculator'
import type { DamageCalcResult } from '@/utils/damageCalc'
import { pickEventCritMultiplier, pickEventDamage } from '@/utils/damageEvent'
import { staggerZoneLabel } from '@/utils/skillCalcZones'

export interface AnomalyFormulaAgentLabels {
  /**
   * 异常基础乘区所属角色展示名（建议带身份前缀，如「异常强度提供者 · 爱丽丝」）
   */
  baseAgent?: string
  /**
   * 增伤/倍率/暴击等 bonus 乘区所属角色展示名
   * 全部异常子类（含紊乱/乱流）→ 异常类触发者；异常结算中不出现招式持有者
   */
  bonusAgent?: string
  /** 异化系数区所属角色展示名（如「异化系数 · 蕾米埃尔」） */
  mutationAgent?: string
}

/** 公式标题上的身份前缀，避免只显示角色名时误解来源 */
export function formatAnomalyFormulaAgentLabel(
  role: 'anomalyPower' | 'owner' | 'trigger' | 'mutation',
  agentName: string | null | undefined,
): string | undefined {
  const name = agentName?.trim()
  if (!name) return undefined
  if (role === 'anomalyPower') return `异常强度提供者 · ${name}`
  if (role === 'owner') return `招式持有者 · ${name}`
  if (role === 'trigger') return `异常类触发者 · ${name}`
  return `异化系数 · ${name}`
}

export interface AlignedFormulaTerm {
  label: string
  value: string
  tipsKey: string
  /**
   * 该因子的实际输入方身份（与所在组标题不同时才标），如「异常类触发者 · 菲欧妮」。
   * 易伤区即属此类：数值参与「异常基础期望」连乘，但加成来源是异常类触发者。
   */
  ownerLabel?: string
}

export type AlignedAnomalyFormulaKey =
  | 'anomalyBaseExpected'
  | 'attributeAnomalyExpected'
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
}

export function buildAlignedAnomalyFormulaGroups(
  p: DamageCalcResult,
  sub: AnomalyDamageSubKind,
  disorderLabel: string,
  formatFormulaNumber: (v: number, precision?: number) => string,
  formatNumber: (v: number) => string,
  labels?: AnomalyFormulaAgentLabels,
  critMode: DamageEventCritMode = 'expected',
): AlignedAnomalyFormulaGroup[] {
  const remielSelf = p.remielSelfRadianceActive
  const baseWithMutation = resolveAnomalyBaseWithMutation(p)
  const baseTerms: AlignedFormulaTerm[] = remielSelf
    ? [
        {
          label: '局内攻击力',
          value: formatFormulaNumber(p.remielSelfInCombatAtk ?? 0, 4),
          tipsKey: 'remielSelfInCombatAtk',
        },
        {
          label: '局内精通区',
          value: formatFormulaNumber(p.remielSelfInCombatMasteryZone ?? 0),
          tipsKey: 'remielSelfInCombatMasteryZone',
        },
        {
          label: '特殊等级区',
          value: formatFormulaNumber(p.remielSelfSpecialLevelZone ?? 1),
          tipsKey: 'remielSelfSpecialLevelZone',
        },
        {
          label: '异化系数区',
          value: formatFormulaNumber(p.remielSelfMutationZone ?? p.mutationZone),
          tipsKey: 'mutationZone',
        },
        {
          label: '等级区',
          value: formatFormulaNumber(p.remielSelfStandardLevelZone ?? 1),
          tipsKey: 'remielSelfStandardLevelZone',
        },
      ]
    : [
        { label: '通用乘区', value: formatFormulaNumber(p.generalMultiplier, 2), tipsKey: 'generalMultiplier' },
        {
          label: '易伤区',
          value: formatFormulaNumber(p.anomalyVulnerableMultiplier),
          tipsKey: 'anomalyVulnerableMultiplier',
          // 与直伤易伤 / 非直伤易伤是同一个乘区，只按伤害类型取一档；加成来源是异常类触发者
          ownerLabel: labels?.bonusAgent,
        },
        { label: '精通区', value: formatFormulaNumber(p.masteryZone), tipsKey: 'masteryZone' },
        { label: '等级区', value: formatFormulaNumber(p.levelZone), tipsKey: 'levelZone' },
        { label: '特殊乘区', value: formatFormulaNumber(p.specialMultiplier), tipsKey: 'specialMultiplier' },
      ]
  if (!remielSelf && p.mutationZone > 1) {
    baseTerms.push({
      label: '异化系数区',
      value: formatFormulaNumber(p.mutationZone),
      tipsKey: 'mutationZone',
    })
  }
  const base: AlignedAnomalyFormulaGroup = {
    key: 'anomalyBaseExpected',
    title: remielSelf ? '蕾米埃尔异常基础' : '异常基础期望',
    agentLabel: labels?.baseAgent,
    terms: baseTerms,
    result: formatNumber(baseWithMutation),
  }
  const anomaly: AlignedAnomalyFormulaGroup = {
    key: 'attributeAnomalyExpected',
    title: '属性异常伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatFormulaNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '属性异常增伤区', value: formatFormulaNumber(p.attributeAnomalyDmgBonusZone), tipsKey: 'attributeAnomalyDmgBonusZone' },
      { label: '属性异常倍率区', value: formatFormulaNumber(p.attributeAnomalyMultZone), tipsKey: 'attributeAnomalyMultZone' },
      {
        label: '属性异常暴击区',
        value: formatFormulaNumber(pickEventCritMultiplier(p, 'attributeAnomaly', critMode)),
        tipsKey: 'attributeAnomalyCritZone',
      },
    ],
    result: formatNumber(pickEventDamage(p, 'attributeAnomaly', critMode)),
  }
  const disorder: AlignedAnomalyFormulaGroup = {
    key: 'disorderExpected',
    title: disorderLabel,
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatFormulaNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '紊乱倍率区', value: formatFormulaNumber(p.disorderZone), tipsKey: 'disorderZone' },
      { label: '紊乱增伤区', value: formatFormulaNumber(p.disorderDmgBonusZone), tipsKey: 'disorderDmgBonusZone' },
      // 紊乱只吃自己的暴击字段（紊乱暴击率/爆伤），与乱流同构
      {
        label: '紊乱暴击区',
        value: formatFormulaNumber(pickEventCritMultiplier(p, 'disorder', critMode)),
        tipsKey: 'disorderCritZone',
      },
    ],
    result: formatNumber(pickEventDamage(p, 'disorder', critMode)),
  }
  const turbulence: AlignedAnomalyFormulaGroup = {
    key: 'turbulenceExpected',
    title: '乱流伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatFormulaNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      { label: '乱流倍率区', value: formatFormulaNumber(p.turbulenceZone), tipsKey: 'turbulenceZone' },
      {
        label: '乱流增伤区',
        value: formatFormulaNumber(p.turbulenceDmgBonusZone),
        tipsKey: 'turbulenceDmgBonusZone',
      },
      {
        // 乱流只吃自己的暴击字段（用户 2026-10-16）；此前这里错用属性异常暴击区
        label: '乱流暴击区',
        value: formatFormulaNumber(pickEventCritMultiplier(p, 'turbulence', critMode)),
        tipsKey: 'turbulenceCritZone',
      },
    ],
    result: formatNumber(pickEventDamage(p, 'turbulence', critMode)),
  }
  const release: AlignedAnomalyFormulaGroup = {
    key: 'anomalyReleaseExpected',
    title: '异放伤害',
    agentLabel: labels?.bonusAgent,
    terms: [
      { label: '异常基础期望', value: formatFormulaNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
      {
        label: '异放增伤区',
        value: formatFormulaNumber(p.anomalyReleaseDmgBonusZone),
        tipsKey: 'anomalyReleaseDmgBonusZone',
      },
      {
        label: '异放倍率区',
        value: formatFormulaNumber(p.anomalyReleaseMultZone),
        tipsKey: 'anomalyReleaseMultZone',
      },
      // 「异常综合暴击区」已删除（用户 2026-10-16：暴击按子类拆开，异放只吃自己的暴击字段）
      {
        label: '异放暴击区',
        value: formatFormulaNumber(pickEventCritMultiplier(p, 'anomalyRelease', critMode)),
        tipsKey: 'anomalyReleaseCritZone',
      },
    ],
    result: formatNumber(pickEventDamage(p, 'anomalyRelease', critMode)),
  }
  const radianceChain: AlignedAnomalyFormulaGroup = {
    key: 'radianceExpected',
    title: '耀变伤害',
    agentLabel: labels?.bonusAgent,
    terms: remielSelf
      ? [
          {
            label: '蕾米埃尔异常基础',
            value: formatFormulaNumber(baseWithMutation),
            tipsKey: 'anomalyBaseExpected',
          },
          {
            label: '防御区',
            value: formatFormulaNumber(p.remielSelfDefenseMultiplier ?? 1),
            tipsKey: 'remielSelfDefenseMultiplier',
          },
          {
            label: '抗性区',
            value: formatFormulaNumber(p.remielSelfResistanceMultiplier ?? 1),
            tipsKey: 'remielSelfResistanceMultiplier',
          },
          {
            label: '易伤区',
            value: formatFormulaNumber(p.anomalyVulnerableMultiplier),
            tipsKey: 'anomalyVulnerableMultiplier',
          },
          {
            label: staggerZoneLabel(p),
            value: formatFormulaNumber(p.staggerMultiplier),
            tipsKey: 'staggerMultiplier',
          },
          {
            label: '耀变增伤区',
            value: formatFormulaNumber(p.radianceDmgBonusZone),
            tipsKey: 'radianceDmgBonusZone',
          },
          {
            label: '耀变倍率区',
            value: formatFormulaNumber(p.radianceMultZone),
            tipsKey: 'radianceMultZone',
          },
          {
            label: '特殊倍率乘区',
            value: formatFormulaNumber(p.specialMultZone),
            tipsKey: 'specialMultZone',
          },
          {
            label: '特殊乘区',
            value: formatFormulaNumber(p.specialMultiplier),
            tipsKey: 'specialMultiplier',
          },
          {
            // 耀变的触发者无论是蕾米还是其他人都允许暴击（游戏规则）
            label: '耀变暴击区',
            value: formatFormulaNumber(pickEventCritMultiplier(p, 'radiance', critMode)),
            tipsKey: 'radianceCritZone',
          },
        ]
      : [
          { label: '异常基础期望', value: formatFormulaNumber(baseWithMutation), tipsKey: 'anomalyBaseExpected' },
          {
            label: '耀变增伤区',
            value: formatFormulaNumber(p.radianceDmgBonusZone),
            tipsKey: 'radianceDmgBonusZone',
          },
          {
            label: '耀变倍率区',
            value: formatFormulaNumber(p.radianceMultZone),
            tipsKey: 'radianceMultZone',
          },
          {
            label: '耀变暴击区',
            value: formatFormulaNumber(pickEventCritMultiplier(p, 'radiance', critMode)),
            tipsKey: 'radianceCritZone',
          },
        ],
    result: formatNumber(pickEventDamage(p, 'radiance', critMode)),
  }

  if (sub === 'disorder') return [base, disorder]
  if (sub === 'turbulence') return [base, turbulence]
  if (sub === 'anomalyRelease') return [base, release]
  if (sub === 'radiance') return [base, radianceChain]
  return [base, anomaly]
}

export function resolveAnomalyBaseWithMutation(
  p: Pick<DamageCalcResult, 'anomalyBaseExpected' | 'mutationZone' | 'remielSelfRadianceActive'>,
): number {
  if (p.remielSelfRadianceActive) return p.anomalyBaseExpected
  return p.mutationZone > 1 ? Math.round(p.anomalyBaseExpected * p.mutationZone) : p.anomalyBaseExpected
}
