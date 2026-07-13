import type { BuffStatModifiers, DriveDiscBuffDoc } from '@/types/calculator'
import type { AffixCounts, AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'
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

export const AFFIX_COUNT_FIELDS: {
  key: keyof AffixCounts
  label: string
  unitLabel: string
  perCount: number
}[] = [
  { key: 'hpFlat', label: '生命值', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.hpFlat },
  {
    key: 'hpPercent',
    label: '局外生命值%',
    unitLabel: '条',
    perCount: AFFIX_VALUE_PER_COUNT.hpPercent,
  },
  { key: 'atkFlat', label: '攻击力', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.atkFlat },
  {
    key: 'atkPercent',
    label: '局内攻击力%',
    unitLabel: '条',
    perCount: AFFIX_VALUE_PER_COUNT.atkPercent,
  },
  { key: 'pen', label: '穿透值', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.pen },
  { key: 'critRate', label: '暴击', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.critRate },
  { key: 'critDmg', label: '爆伤', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.critDmg },
  { key: 'mastery', label: '精通', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.mastery },
]
