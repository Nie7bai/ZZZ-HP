import type { BuffStatModifiers, DriveDiscBuffDoc } from '@/types/calculator'
import type { AffixCounts, AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'
import { createEmptyAffixCounts } from '@/types/calculatorPanel'
import type { AgentBasePanel, WengineAdvancedStats } from '@/types/calculator'
import {
  AFFIX_DRIVE_DISC_SLOT_1_HP,
  AFFIX_DRIVE_DISC_SLOT_2_ATK,
  collectAffixDriveDiscMainStatContribution,
  type AffixDriveDiscMainStatContribution,
} from '@/utils/affixDriveDiscConfig'
import {
  createEmptyAgentBasePanel,
  createEmptyBuffStatModifiers,
  createEmptyWengineAdvancedStats,
  mergeBuffStatModifiers,
  normalizeTwoPieceMods,
} from '@/utils/calculatorUi'

/** 每条副词条折算数值（可按版本调整） */
export const AFFIX_VALUE_PER_COUNT = {
  hpFlat: 112,
  hpPercent: 3,
  atkFlat: 19,
  atkPercent: 3,
  pen: 9,
  critRate: 2.4,
  critDmg: 4.8,
  mastery: 9,
} as const satisfies Record<keyof AffixCounts, number>

export interface AffixDriveDiscSelection {
  twoPieceDriveDiscId: string
  fourPieceDriveDiscId: string
}

export interface AffixPanelCalcInput {
  agentBase: AgentBasePanel
  wengineBaseAtk: number
  wengineAdvanced: WengineAdvancedStats
  affixCounts: AffixCounts
  driveDiscSelection: AffixDriveDiscSelection
  driveDiscMainStats: AffixDriveDiscMainStats
  driveDiscs: DriveDiscBuffDoc[]
}

function affixStatTotal(count: number, perCount: number) {
  const safeCount = Number.isFinite(count) ? count : 0
  return safeCount * perCount
}

function roundPanelValue(value: number) {
  return Math.round(value * 100) / 100
}

function readTwoPieceExternalPercents(mods: BuffStatModifiers) {
  return {
    externalHpPercent: mods.externalHpPercent + mods.inCombatHpPercent,
    externalAtkPercent: mods.externalAtkPercent + mods.inCombatAtkPercent,
  }
}

export function collectAffixTwoPieceMods(
  driveDiscs: DriveDiscBuffDoc[],
  selection: AffixDriveDiscSelection,
): BuffStatModifiers {
  let total = createEmptyBuffStatModifiers()

  const fourDisc =
    selection.fourPieceDriveDiscId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.fourPieceDriveDiscId)
      : undefined
  const twoDisc =
    selection.twoPieceDriveDiscId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.twoPieceDriveDiscId)
      : undefined

  if (fourDisc) {
    total = mergeBuffStatModifiers(total, normalizeTwoPieceMods(fourDisc.twoPieceMods))
  }
  if (twoDisc && twoDisc.id !== fourDisc?.id) {
    total = mergeBuffStatModifiers(total, normalizeTwoPieceMods(twoDisc.twoPieceMods))
  }

  return total
}

function sumExternalPercents(
  affixHpPercent: number,
  affixAtkPercent: number,
  wengineAdvanced: WengineAdvancedStats,
  twoPieceMods: BuffStatModifiers,
  mainStats: AffixDriveDiscMainStatContribution,
) {
  const twoPieceExternal = readTwoPieceExternalPercents(twoPieceMods)
  return {
    hpPercent:
      affixHpPercent +
      wengineAdvanced.externalHpPercent +
      twoPieceExternal.externalHpPercent +
      mainStats.externalHpPercent,
    atkPercent:
      affixAtkPercent +
      wengineAdvanced.externalAtkPercent +
      twoPieceExternal.externalAtkPercent +
      mainStats.externalAtkPercent,
  }
}

export function computeExternalPanelFromAffixes(input: AffixPanelCalcInput): PanelStats {
  const agentBase = input.agentBase ?? createEmptyAgentBasePanel()
  const wengineAdvanced = input.wengineAdvanced ?? createEmptyWengineAdvancedStats()
  const counts = input.affixCounts
  const twoPieceMods = collectAffixTwoPieceMods(input.driveDiscs, input.driveDiscSelection)
  const mainStats = collectAffixDriveDiscMainStatContribution(input.driveDiscMainStats)

  const hpFlatFromAffix = affixStatTotal(counts.hpFlat, AFFIX_VALUE_PER_COUNT.hpFlat)
  const hpPercentFromAffix = affixStatTotal(counts.hpPercent, AFFIX_VALUE_PER_COUNT.hpPercent)
  const atkFlatFromAffix = affixStatTotal(counts.atkFlat, AFFIX_VALUE_PER_COUNT.atkFlat)
  const atkPercentFromAffix = affixStatTotal(counts.atkPercent, AFFIX_VALUE_PER_COUNT.atkPercent)

  const externalPercents = sumExternalPercents(
    hpPercentFromAffix,
    atkPercentFromAffix,
    wengineAdvanced,
    twoPieceMods,
    mainStats,
  )

  const hp =
    agentBase.hp * (1 + externalPercents.hpPercent / 100) +
    hpFlatFromAffix +
    AFFIX_DRIVE_DISC_SLOT_1_HP

  const atk =
    (agentBase.atk + input.wengineBaseAtk) * (1 + externalPercents.atkPercent / 100) +
    atkFlatFromAffix +
    AFFIX_DRIVE_DISC_SLOT_2_ATK

  return {
    hp: roundPanelValue(hp),
    atk: roundPanelValue(atk),
    def: roundPanelValue(agentBase.def),
    critRate: roundPanelValue(
      agentBase.critRate +
        wengineAdvanced.critRate +
        twoPieceMods.critRate +
        mainStats.critRate +
        affixStatTotal(counts.critRate, AFFIX_VALUE_PER_COUNT.critRate),
    ),
    critDmg: roundPanelValue(
      agentBase.critDmg +
        wengineAdvanced.critDmg +
        twoPieceMods.critDmg +
        mainStats.critDmg +
        affixStatTotal(counts.critDmg, AFFIX_VALUE_PER_COUNT.critDmg),
    ),
    dmgBonus: roundPanelValue(agentBase.dmgBonus + twoPieceMods.dmgBonus + mainStats.dmgBonus),
    ignoreDefense: 0,
    reduceDefense: roundPanelValue(twoPieceMods.reduceDefense),
    penRate: roundPanelValue(
      agentBase.penRate + wengineAdvanced.penRate + twoPieceMods.penRate + mainStats.penRate,
    ),
    pen: roundPanelValue(
      agentBase.pen + affixStatTotal(counts.pen, AFFIX_VALUE_PER_COUNT.pen),
    ),
    resPen: roundPanelValue(twoPieceMods.resPen),
    mastery: roundPanelValue(
      agentBase.mastery +
        wengineAdvanced.mastery +
        twoPieceMods.mastery +
        mainStats.mastery +
        affixStatTotal(counts.mastery, AFFIX_VALUE_PER_COUNT.mastery),
    ),
    anomalyCritRate: roundPanelValue(agentBase.anomalyCritRate),
    anomalyCritDmg: roundPanelValue(agentBase.anomalyCritDmg),
    anomalyDmgBonus: roundPanelValue(agentBase.anomalyDmgBonus),
    anomalyReleaseCritRate: 0,
    anomalyReleaseCritDmg: 0,
    anomalyReleaseMult: 0,
    anomalyReleaseDmgBonus: 0,
    directDmgMult: roundPanelValue(agentBase.directDmgMult),
    anomalyMult: roundPanelValue(agentBase.anomalyMult),
    disorderBaseMult: roundPanelValue(agentBase.disorderBaseMult),
    anomalyDuration: roundPanelValue(agentBase.anomalyDuration),
    disorderCompMult: roundPanelValue(agentBase.disorderCompMult),
    turbulenceBaseMult: roundPanelValue(agentBase.turbulenceBaseMult),
    turbulenceCompMult: roundPanelValue(agentBase.turbulenceCompMult),
    disorderDmgBonus: roundPanelValue(agentBase.disorderDmgBonus),
    turbulenceDmgBonus: roundPanelValue(agentBase.turbulenceDmgBonus),
  }
}

function clampCount(value: number, max = 40) {
  if (!Number.isFinite(value)) return 0
  return Math.min(max, Math.max(0, Math.round(value)))
}

/**
 * 由局外面板反推词条数（逆用 computeExternalPanelFromAffixes）。
 * 生命/攻击存在「固定值词条 × 百分比词条」耦合，以网格搜索取误差最小的非负整数解。
 */
export function inferAffixCountsFromExternalPanel(input: {
  target: Partial<PanelStats>
  agentBase: AgentBasePanel
  wengineBaseAtk: number
  wengineAdvanced: WengineAdvancedStats
  driveDiscSelection: AffixDriveDiscSelection
  driveDiscMainStats: AffixDriveDiscMainStats
  driveDiscs: DriveDiscBuffDoc[]
}): { affixCounts: AffixCounts; warnings: string[] } {
  const warnings: string[] = []
  const agentBase = input.agentBase ?? createEmptyAgentBasePanel()
  const wengineAdvanced = input.wengineAdvanced ?? createEmptyWengineAdvancedStats()
  const twoPieceMods = collectAffixTwoPieceMods(input.driveDiscs, input.driveDiscSelection)
  const mainStats = collectAffixDriveDiscMainStatContribution(input.driveDiscMainStats)
  const counts = createEmptyAffixCounts()

  const fixedHpPercent =
    wengineAdvanced.externalHpPercent +
    readTwoPieceExternalPercents(twoPieceMods).externalHpPercent +
    mainStats.externalHpPercent
  const fixedAtkPercent =
    wengineAdvanced.externalAtkPercent +
    readTwoPieceExternalPercents(twoPieceMods).externalAtkPercent +
    mainStats.externalAtkPercent

  const targetHp = input.target.hp
  if (typeof targetHp === 'number' && Number.isFinite(targetHp) && targetHp > 0) {
    let best = { pct: 0, flat: 0, err: Number.POSITIVE_INFINITY }
    for (let pct = 0; pct <= 36; pct++) {
      const withPct =
        agentBase.hp * (1 + (fixedHpPercent + pct * AFFIX_VALUE_PER_COUNT.hpPercent) / 100) +
        AFFIX_DRIVE_DISC_SLOT_1_HP
      const flat = clampCount((targetHp - withPct) / AFFIX_VALUE_PER_COUNT.hpFlat)
      const actual =
        agentBase.hp * (1 + (fixedHpPercent + pct * AFFIX_VALUE_PER_COUNT.hpPercent) / 100) +
        flat * AFFIX_VALUE_PER_COUNT.hpFlat +
        AFFIX_DRIVE_DISC_SLOT_1_HP
      const err = Math.abs(actual - targetHp)
      if (err < best.err || (err === best.err && pct + flat < best.pct + best.flat)) {
        best = { pct, flat, err }
      }
    }
    counts.hpPercent = best.pct
    counts.hpFlat = best.flat
    if (best.err > 80) {
      warnings.push(`生命反推残差较大（Δ${roundPanelValue(best.err)}），请核对主C基础面板与驱动盘主属性`)
    }
  }

  const targetAtk = input.target.atk
  if (typeof targetAtk === 'number' && Number.isFinite(targetAtk) && targetAtk > 0) {
    const atkBase = agentBase.atk + input.wengineBaseAtk
    let best = { pct: 0, flat: 0, err: Number.POSITIVE_INFINITY }
    for (let pct = 0; pct <= 36; pct++) {
      const withPct =
        atkBase * (1 + (fixedAtkPercent + pct * AFFIX_VALUE_PER_COUNT.atkPercent) / 100) +
        AFFIX_DRIVE_DISC_SLOT_2_ATK
      const flat = clampCount((targetAtk - withPct) / AFFIX_VALUE_PER_COUNT.atkFlat)
      const actual =
        atkBase * (1 + (fixedAtkPercent + pct * AFFIX_VALUE_PER_COUNT.atkPercent) / 100) +
        flat * AFFIX_VALUE_PER_COUNT.atkFlat +
        AFFIX_DRIVE_DISC_SLOT_2_ATK
      const err = Math.abs(actual - targetAtk)
      if (err < best.err || (err === best.err && pct + flat < best.pct + best.flat)) {
        best = { pct, flat, err }
      }
    }
    counts.atkPercent = best.pct
    counts.atkFlat = best.flat
    if (best.err > 30) {
      warnings.push(`攻击反推残差较大（Δ${roundPanelValue(best.err)}），请核对音擎与驱动盘主属性`)
    }
  }

  const independent: {
    key: keyof Pick<AffixCounts, 'pen' | 'critRate' | 'critDmg' | 'mastery'>
    panelKey: keyof PanelStats
    base: number
  }[] = [
    {
      key: 'critRate',
      panelKey: 'critRate',
      base: agentBase.critRate + wengineAdvanced.critRate + twoPieceMods.critRate + mainStats.critRate,
    },
    {
      key: 'critDmg',
      panelKey: 'critDmg',
      base: agentBase.critDmg + wengineAdvanced.critDmg + twoPieceMods.critDmg + mainStats.critDmg,
    },
    {
      key: 'pen',
      panelKey: 'pen',
      base: agentBase.pen,
    },
    {
      key: 'mastery',
      panelKey: 'mastery',
      base: agentBase.mastery + wengineAdvanced.mastery + twoPieceMods.mastery + mainStats.mastery,
    },
  ]

  for (const item of independent) {
    const observed = input.target[item.panelKey]
    if (typeof observed !== 'number' || !Number.isFinite(observed)) continue
    const rem = observed - item.base
    counts[item.key] = clampCount(rem / AFFIX_VALUE_PER_COUNT[item.key])
  }

  const hasAnyTarget =
    (typeof targetHp === 'number' && targetHp > 0) ||
    (typeof targetAtk === 'number' && targetAtk > 0) ||
    independent.some((item) => typeof input.target[item.panelKey] === 'number')
  if (!hasAnyTarget) {
    warnings.push('识别局外面板缺少可用数值，未能反推词条数')
  }

  return { affixCounts: counts, warnings }
}

export const AFFIX_COUNT_FIELDS: {
  key: keyof AffixCounts
  label: string
  unitLabel: string
  perCount: number
}[] = [
  { key: 'hpFlat', label: '生命值', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.hpFlat },
  {
    key: 'hpPercent',
    label: '局外大生命',
    unitLabel: '条',
    perCount: AFFIX_VALUE_PER_COUNT.hpPercent,
  },
  { key: 'atkFlat', label: '攻击力', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.atkFlat },
  {
    key: 'atkPercent',
    label: '局外大攻击',
    unitLabel: '条',
    perCount: AFFIX_VALUE_PER_COUNT.atkPercent,
  },
  { key: 'pen', label: '穿透值', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.pen },
  { key: 'critRate', label: '暴击', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.critRate },
  { key: 'critDmg', label: '爆伤', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.critDmg },
  { key: 'mastery', label: '精通', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.mastery },
]
