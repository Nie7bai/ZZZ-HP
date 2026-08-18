import type { PanelStats } from '@/types/calculatorPanel'
import { formatCalcDecimal } from '@/utils/calcNumberFormat'
import { computeDefenseZone } from '@/utils/damageCalc'
import { multFactorPercentToRatio } from '@/utils/multFactorPercent'
import type { BuffModSource } from '@/utils/panelBuffCalc'
import {
  computeRemielSelfRadianceSpecialLevelZone,
  computeRemielSelfRadianceStandardLevelZone,
} from '@/utils/remielUtils'
import { buildStatSourceGroups, type StatSourceGroup } from '@/utils/statSourceTips'

function fmt(value: number, precision = 4) {
  return formatCalcDecimal(value, precision)
}

function withTotal(
  groups: StatSourceGroup[],
  totalText: string,
  processItems?: string[],
): StatSourceGroup[] {
  const result = [...groups]
  if (processItems?.length) {
    result.push({ label: '加减过程', items: processItems, fullWidth: true })
  }
  if (!result.length) {
    return [{ label: '合计', items: [totalText] }]
  }
  return [...result, { label: '合计', items: [totalText], fullWidth: true }]
}

export function buildDefenseZoneFormulaItems(options: {
  enemyDefense: number
  ignoreDefense: number
  reduceDefense: number
  penRate: number
  pen: number
  isMb?: boolean
  penRateRole?: string
  defCutRole?: string
}): string[] {
  if (options.isMb) return ['防御区固定为 1']
  const parts = computeDefenseZone({
    defensePanel: {
      penRate: options.penRate,
      pen: options.pen,
      ignoreDefense: options.ignoreDefense,
      reduceDefense: options.reduceDefense,
    },
    isMb: false,
    enemyDefense: options.enemyDefense,
  })
  const defenseCut = options.ignoreDefense + options.reduceDefense
  const defenseAfter = options.enemyDefense * parts.defenseFactor * (1 - parts.penRateRatio)
  const penRateLabel = options.penRateRole ? `（${options.penRateRole}）` : ''
  const defCutLabel = options.defCutRole ? `（${options.defCutRole}）` : ''
  return [
    `敌方防御 ${fmt(options.enemyDefense, 2)}`,
    `无视防御 ${fmt(options.ignoreDefense, 2)}% + 减防 ${fmt(options.reduceDefense, 2)}%${defCutLabel}`,
    `防御因子 = max(0, 1 − 无视 − 减防) = max(0, 1 − ${fmt(defenseCut / 100)}) = ${fmt(parts.defenseFactor)}`,
    `穿透率 ${fmt(options.penRate, 2)}%${penRateLabel} → ${fmt(parts.penRateRatio)}`,
    `折后防御 = 敌方防御 × 防御因子 × (1 − 穿透率) = ${fmt(options.enemyDefense, 2)} × ${fmt(parts.defenseFactor)} × (1 − ${fmt(parts.penRateRatio)}) = ${fmt(defenseAfter, 2)}`,
    `穿透值 ${fmt(options.pen, 2)}（局外面板，不受增益）`,
    `有效防御 = max(0, 折后防御) − 穿透值 = max(0, ${fmt(defenseAfter, 2)}) − ${fmt(options.pen, 2)} = ${fmt(parts.effectiveDefense, 2)}`,
    `防御区 = 794 / (794 + 有效防御) = 794 / (794 + ${fmt(parts.effectiveDefense, 2)}) = ${fmt(parts.defenseMultiplier)}`,
  ]
}

export function buildDefenseZoneSourceGroups(options: {
  enemyDefense: number
  penRatePanel: PanelStats
  penRateExternal: PanelStats
  penRateSources: BuffModSource[]
  defCutPanel: PanelStats
  defCutExternal: PanelStats
  defCutSources: BuffModSource[]
  defCutLabel: string
  splitDefCut: boolean
  isMb?: boolean
  mbLabel?: string
  penRateRole?: string
  defCutRole?: string
}): StatSourceGroup[] {
  if (options.isMb) {
    return [{ label: options.mbLabel ?? '命破', items: ['防御区固定为 1'] }]
  }
  const parts = computeDefenseZone({
    defensePanel: {
      penRate: options.penRatePanel.penRate,
      pen: options.penRateExternal.pen,
      ignoreDefense: options.defCutPanel.ignoreDefense,
      reduceDefense: options.defCutPanel.reduceDefense,
    },
    isMb: false,
    enemyDefense: options.enemyDefense,
  })
  const extraGroups: StatSourceGroup[] = [
    {
      label: '敌方与环境 / 局外面板',
      items: [
        `敌方防御 ${fmt(options.enemyDefense, 2)}`,
        `无视防御 ${fmt(options.defCutExternal.ignoreDefense, 2)}%（局外，不受增益）`,
        `穿透值 ${fmt(options.penRateExternal.pen, 2)}（局外，不受增益）`,
      ],
    },
  ]
  if (options.splitDefCut) {
    extraGroups.unshift(
      { label: options.defCutLabel, items: ['减防/无视防御取此角色'] },
      ...buildStatSourceGroups({
        keys: ['reduceDefense'],
        externalPanel: options.defCutExternal,
        sources: options.defCutSources,
        finalValues: { reduceDefense: options.defCutPanel.reduceDefense },
      }),
    )
  }
  return withTotal(
    buildStatSourceGroups({
      keys: options.splitDefCut ? ['penRate'] : ['reduceDefense', 'penRate'],
      externalPanel: options.penRateExternal,
      sources: options.penRateSources,
      finalValues: options.splitDefCut
        ? { penRate: options.penRatePanel.penRate }
        : {
            reduceDefense: options.penRatePanel.reduceDefense,
            penRate: options.penRatePanel.penRate,
          },
      extraGroups,
    }),
    `有效防御 ${fmt(parts.effectiveDefense, 2)} → 防御区 794 / (794 + ${fmt(parts.effectiveDefense, 2)}) = ${fmt(parts.defenseMultiplier)}`,
    buildDefenseZoneFormulaItems({
      enemyDefense: options.enemyDefense,
      ignoreDefense: options.defCutPanel.ignoreDefense,
      reduceDefense: options.defCutPanel.reduceDefense,
      penRate: options.penRatePanel.penRate,
      pen: options.penRateExternal.pen,
      penRateRole: options.penRateRole,
      defCutRole: options.defCutRole,
    }),
  )
}

export function buildMutationZoneTipGroups(options: {
  zone: number
  title?: string
  noteItems?: string[]
  externalPanel?: PanelStats | null
  sources?: BuffModSource[]
  finalPanel?: PanelStats | null
}): StatSourceGroup[] {
  const groups: StatSourceGroup[] = []
  if (options.noteItems?.length) {
    groups.push({ label: options.title ?? '异化系数', items: options.noteItems })
  }
  const external = options.externalPanel
  const panel = options.finalPanel
  if (external && panel) {
    groups.push(
      ...buildStatSourceGroups({
        keys: ['mutationCoeff', 'mutationCoeffFactor'],
        externalPanel: external,
        sources: options.sources ?? [],
        finalValues: {
          mutationCoeff: panel.mutationCoeff,
          mutationCoeffFactor: panel.mutationCoeffFactor,
        },
      }),
    )
    const coeff = panel.mutationCoeff
    const factor = panel.mutationCoeffFactor
    const factorRatio = multFactorPercentToRatio(factor) || 1
    groups.push({
      label: '加减过程',
      fullWidth: true,
      items: [
        `异化系数 ${fmt(coeff, 2)}% → 1 + ${fmt(coeff, 2)}% = ${fmt(Math.max(0, 1 + coeff / 100))}`,
        `异化系数修正 ${fmt(factor ?? 100, 2)}% → ×${fmt(factorRatio)}`,
        `(1 + 异化系数%) × 修正 = ${fmt(Math.max(0, 1 + coeff / 100))} × ${fmt(factorRatio)} = ${fmt(options.zone)}`,
      ],
    })
  } else if (!options.noteItems?.length) {
    groups.push({
      label: options.title ?? '异化系数',
      items: [`异化系数区 ${fmt(options.zone)}`],
    })
  }
  return withTotal(groups, `异化系数区 ${fmt(options.zone)}`)
}

export function buildResistanceZoneProcessItems(options: {
  enemyResistance: number
  resPen: number
  zone: number
  extraLines?: string[]
}): string[] {
  return [
    `敌方抗性 ${fmt(options.enemyResistance)}`,
    ...((options.extraLines ?? []).filter(Boolean)),
    `局内抗穿 ${fmt(options.resPen, 2)}%`,
    `1 - ${fmt(options.enemyResistance)} + ${fmt(options.resPen, 2)}% = ${fmt(options.zone)}`,
  ]
}

export function buildPierceDmgZoneProcessItems(options: {
  active: boolean
  bonusPercent: number
  zone: number
}): string[] {
  if (!options.active) {
    return ['基础伤害来源非贯穿力，贯穿增伤区固定为 1']
  }
  return [
    `贯穿增伤 ${fmt(options.bonusPercent, 2)}%`,
    `贯穿增伤区 1 + ${fmt(options.bonusPercent, 2)}% = ${fmt(options.zone)}`,
  ]
}

export function buildRemielSpecialLevelZoneGroups(level: number, zone?: number): StatSourceGroup[] {
  const safeLevel = Math.min(60, Math.max(1, Math.round(level)))
  const value = zone ?? computeRemielSelfRadianceSpecialLevelZone(safeLevel)
  return [
    {
      label: '特殊等级区（本人耀变）',
      items: [
        `角色等级 ${safeLevel}`,
        `特殊等级区 = 1 + 0.025 × 等级`,
        `1 + 0.025 × ${safeLevel} = ${fmt(value)}`,
      ],
    },
    { label: '合计', items: [`特殊等级区 ${fmt(value)}`], fullWidth: true },
  ]
}

export function buildRemielStandardLevelZoneGroups(level: number, zone?: number): StatSourceGroup[] {
  const safeLevel = Math.min(60, Math.max(1, Math.round(level)))
  const value = zone ?? computeRemielSelfRadianceStandardLevelZone(safeLevel)
  return [
    {
      label: '等级区（本人耀变）',
      items: [
        `角色等级 ${safeLevel}`,
        `等级区 = 1 + (等级 − 1) / 59`,
        `1 + (${safeLevel} − 1) / 59 = ${fmt(value)}`,
      ],
    },
    { label: '合计', items: [`等级区 ${fmt(value)}`], fullWidth: true },
  ]
}

export function buildRemielSelfAtkTipGroups(options: {
  externalAtk: number
  inCombatAtk: number
  sourceItems: string[]
  fullPanelAtk?: number
  editorPanelAtk?: number
}): StatSourceGroup[] {
  const convertTotal = Math.max(0, options.inCombatAtk - options.externalAtk)
  const process = [
    `局外攻击力 ${fmt(options.externalAtk, 2)}`,
    ...options.sourceItems,
    options.sourceItems.length
      ? `${fmt(options.externalAtk, 2)} + ${fmt(convertTotal, 2)} = ${fmt(options.inCombatAtk, 2)}`
      : `无自身攻击力转模 → ${fmt(options.inCombatAtk, 2)}`,
    '仅：局外攻击 + 蕾米埃尔角色/影画「攻击力转模」',
    '不含局内攻击%、队友/邦布、音擎/驱动盘其它攻击增益',
  ]
  const groups: StatSourceGroup[] = [
    {
      label: '本人耀变局内攻击（特殊口径）',
      items: process,
    },
  ]
  if (options.sourceItems.length) {
    groups.push({ label: '来源', items: options.sourceItems })
  }
  if (options.fullPanelAtk != null || options.editorPanelAtk != null) {
    groups.push({
      label: '对照（本人耀变不用）',
      items: [
        ...(options.fullPanelAtk != null
          ? [`完整局内攻击（仅本槽） ${fmt(options.fullPanelAtk, 2)}`]
          : []),
        ...(options.editorPanelAtk != null
          ? [`当前编辑槽局内攻击 ${fmt(options.editorPanelAtk, 2)}`]
          : []),
      ],
    })
  }
  groups.push({
    label: '加减过程',
    fullWidth: true,
    items: process.filter((item) => !item.startsWith('仅') && !item.startsWith('不含')),
  })
  return groups
}

export function buildRemielSelfMasteryTipGroups(options: {
  externalMastery: number
  inCombatMasteryZone: number
  sourceItems: string[]
  fullPanelMastery?: number
  editorPanelMastery?: number
  editorMasteryZone?: number
}): StatSourceGroup[] {
  const inCombatMastery = options.inCombatMasteryZone * 100
  const bonus = Math.max(0, inCombatMastery - options.externalMastery)
  const process = [
    `局外精通 ${fmt(options.externalMastery, 2)}`,
    ...options.sourceItems,
    options.sourceItems.length
      ? `${fmt(options.externalMastery, 2)} + ${fmt(bonus, 2)} = ${fmt(inCombatMastery, 2)}`
      : `无四件套/音擎全局精通 → ${fmt(inCombatMastery, 2)}`,
    `局内精通区 ÷100 → ${fmt(options.inCombatMasteryZone)}`,
    '仅：局外精通 + 驱动盘4件套全局精通 + 音擎全局精通',
    '不含队友/邦布及其它精通增益',
  ]
  const groups: StatSourceGroup[] = [
    {
      label: '本人耀变局内精通（特殊口径）',
      items: process,
    },
  ]
  if (options.sourceItems.length) {
    groups.push({ label: '来源', items: options.sourceItems })
  }
  if (options.fullPanelMastery != null || options.editorPanelMastery != null) {
    groups.push({
      label: '对照（本人耀变不用）',
      items: [
        ...(options.fullPanelMastery != null
          ? [
              `完整局内精通（仅本槽） ${fmt(options.fullPanelMastery, 2)} → 区 ${fmt(options.fullPanelMastery / 100)}`,
            ]
          : []),
        ...(options.editorPanelMastery != null
          ? [
              `当前编辑槽局内精通 ${fmt(options.editorPanelMastery, 2)} → 区 ${fmt(options.editorMasteryZone ?? options.editorPanelMastery / 100)}`,
            ]
          : []),
      ],
    })
  }
  groups.push({
    label: '加减过程',
    fullWidth: true,
    items: process.filter((item) => !item.startsWith('仅') && !item.startsWith('不含')),
  })
  return groups
}
