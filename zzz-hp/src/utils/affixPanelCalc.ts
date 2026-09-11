import type { BuffStatModifiers, DriveDiscBuffDoc } from '@/types/calculator'
import type { AffixCounts, AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'
import {
  createDefaultAffixDriveDiscMainStats,
  createEmptyAffixCounts,
} from '@/types/calculatorPanel'
import type { AgentBasePanel, WengineAdvancedStats } from '@/types/calculator'
import {
  AFFIX_DRIVE_DISC_SLOT_1_HP,
  AFFIX_DRIVE_DISC_SLOT_2_ATK,
  AFFIX_DRIVE_DISC_SLOT_3_DEF,
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
  defFlat: 15,
  defPercent: 4.8,
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
  /** 音擎基础防御力。锋御音擎的基础属性为防御力，计入局内防御力基数 */
  wengineBaseDef?: number
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
    externalDefPercent: mods.externalDefPercent + mods.inCombatDefPercent,
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
  affixDefPercent: number,
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
    defPercent:
      affixDefPercent +
      wengineAdvanced.externalDefPercent +
      twoPieceExternal.externalDefPercent +
      mainStats.externalDefPercent,
  }
}

export type TeamSlotAffixPanelInput = {
  agentId?: string | null
  wengineId?: string | null
  twoPieceDriveDiscId?: string | null
  fourPieceDriveDiscId?: string | null
  affixCounts?: AffixCounts | null
  affixDriveDiscMainStats?: AffixDriveDiscMainStats | null
}

/** 按编队槽位自己的角色 / 音擎 / 2+4 / 词条算出局外。全队转模必须按来源槽位取这份面板。 */
export function computeExternalPanelFromTeamSlot(input: {
  slot: TeamSlotAffixPanelInput
  agents: Array<{ id: string; basePanel: AgentBasePanel }>
  wengines: Array<{
    id: string
    baseAtk: number
    baseDef?: number
    advancedStats?: WengineAdvancedStats
  }>
  driveDiscs: DriveDiscBuffDoc[]
  overrideAffix?: {
    affixCounts: AffixCounts
    affixDriveDiscMainStats: AffixDriveDiscMainStats
  }
}): PanelStats {
  const { slot } = input
  const agent = slot.agentId ? input.agents.find((item) => item.id === slot.agentId) : undefined
  const wengineId = slot.wengineId
  const wengine =
    wengineId && wengineId !== 'none'
      ? input.wengines.find((item) => item.id === wengineId)
      : undefined
  return computeExternalPanelFromAffixes({
    agentBase: agent?.basePanel ?? createEmptyAgentBasePanel(),
    wengineBaseAtk: wengine?.baseAtk ?? 0,
    wengineBaseDef: wengine?.baseDef ?? 0,
    wengineAdvanced: wengine?.advancedStats ?? createEmptyWengineAdvancedStats(),
    affixCounts: {
      ...createEmptyAffixCounts(),
      ...(input.overrideAffix?.affixCounts ?? slot.affixCounts ?? undefined),
    },
    driveDiscSelection: {
      twoPieceDriveDiscId: slot.twoPieceDriveDiscId ?? 'none',
      fourPieceDriveDiscId: slot.fourPieceDriveDiscId ?? 'none',
    },
    driveDiscMainStats: {
      ...createDefaultAffixDriveDiscMainStats(),
      ...(input.overrideAffix?.affixDriveDiscMainStats ?? slot.affixDriveDiscMainStats ?? undefined),
    },
    driveDiscs: input.driveDiscs,
  })
}

/** 局外里不随词条数变化的部分。改词条时只再套 `applyAffixCountsToFixedParts`。 */
export type AffixExternalFixedParts = {
  agentHp: number
  atkBase: number
  agentDef: number
  fixedHpPercent: number
  fixedAtkPercent: number
  fixedDefPercent: number
  critRate: number
  critDmg: number
  dmgBonus: number
  reduceDefense: number
  penRate: number
  pen: number
  resPen: number
  mastery: number
  anomalyControl: number
  energyRegen: number
  anomalyCritRate: number
  anomalyCritDmg: number
  anomalyDmgBonus: number
  directDmgMult: number
  anomalyMult: number
  disorderBaseMult: number
  anomalyDuration: number
  disorderCompMult: number
  turbulenceBaseMult: number
  turbulenceCompMult: number
  disorderDmgBonus: number
  turbulenceDmgBonus: number
  radianceMult: number
  radianceDmgBonus: number
  radianceResPen: number
  specialMult: number
}

export function buildAffixExternalFixedParts(
  input: Omit<AffixPanelCalcInput, 'affixCounts'>,
): AffixExternalFixedParts {
  const agentBase = input.agentBase ?? createEmptyAgentBasePanel()
  const wengineAdvanced = input.wengineAdvanced ?? createEmptyWengineAdvancedStats()
  const twoPieceMods = collectAffixTwoPieceMods(input.driveDiscs, input.driveDiscSelection)
  const mainStats = collectAffixDriveDiscMainStatContribution(input.driveDiscMainStats)
  const externalPercents = sumExternalPercents(0, 0, 0, wengineAdvanced, twoPieceMods, mainStats)
  return {
    agentHp: agentBase.hp,
    atkBase: agentBase.atk + input.wengineBaseAtk,
    agentDef: agentBase.def + (input.wengineBaseDef ?? 0),
    fixedHpPercent: externalPercents.hpPercent,
    fixedAtkPercent: externalPercents.atkPercent,
    fixedDefPercent: externalPercents.defPercent,
    critRate: agentBase.critRate + wengineAdvanced.critRate + twoPieceMods.critRate + mainStats.critRate,
    critDmg: agentBase.critDmg + wengineAdvanced.critDmg + twoPieceMods.critDmg + mainStats.critDmg,
    dmgBonus: agentBase.dmgBonus + twoPieceMods.dmgBonus + mainStats.dmgBonus,
    reduceDefense: twoPieceMods.reduceDefense,
    penRate: agentBase.penRate + wengineAdvanced.penRate + twoPieceMods.penRate + mainStats.penRate,
    pen: agentBase.pen,
    resPen: twoPieceMods.resPen,
    mastery: agentBase.mastery + wengineAdvanced.mastery + twoPieceMods.mastery + mainStats.mastery,
    anomalyControl:
      agentBase.anomalyControl *
        (1 +
          (wengineAdvanced.anomalyControlPercent +
            twoPieceMods.anomalyControlPercent +
            mainStats.anomalyControl) /
            100) +
      twoPieceMods.anomalyControl,
    energyRegen:
      agentBase.energyRegen *
        (1 +
          (wengineAdvanced.energyRegen + twoPieceMods.energyRegen + mainStats.energyRegen) / 100) +
      twoPieceMods.energyRegenFlat,
    anomalyCritRate: agentBase.anomalyCritRate,
    anomalyCritDmg: agentBase.anomalyCritDmg,
    anomalyDmgBonus: agentBase.anomalyDmgBonus,
    directDmgMult: agentBase.directDmgMult,
    anomalyMult: agentBase.anomalyMult,
    disorderBaseMult: agentBase.disorderBaseMult,
    anomalyDuration: agentBase.anomalyDuration,
    disorderCompMult: agentBase.disorderCompMult,
    turbulenceBaseMult: agentBase.turbulenceBaseMult,
    turbulenceCompMult: agentBase.turbulenceCompMult,
    disorderDmgBonus: agentBase.disorderDmgBonus,
    turbulenceDmgBonus: agentBase.turbulenceDmgBonus,
    radianceMult: agentBase.radianceMult,
    radianceDmgBonus: agentBase.radianceDmgBonus,
    radianceResPen: agentBase.radianceResPen,
    specialMult: agentBase.specialMult,
  }
}

export function applyAffixCountsToFixedParts(
  parts: AffixExternalFixedParts,
  counts: AffixCounts,
): PanelStats {
  const hpPercent =
    parts.fixedHpPercent + affixStatTotal(counts.hpPercent, AFFIX_VALUE_PER_COUNT.hpPercent)
  const atkPercent =
    parts.fixedAtkPercent + affixStatTotal(counts.atkPercent, AFFIX_VALUE_PER_COUNT.atkPercent)
  const defPercent =
    parts.fixedDefPercent + affixStatTotal(counts.defPercent, AFFIX_VALUE_PER_COUNT.defPercent)
  return {
    hp: roundPanelValue(
      parts.agentHp * (1 + hpPercent / 100) +
        affixStatTotal(counts.hpFlat, AFFIX_VALUE_PER_COUNT.hpFlat) +
        AFFIX_DRIVE_DISC_SLOT_1_HP,
    ),
    atk: roundPanelValue(
      parts.atkBase * (1 + atkPercent / 100) +
        affixStatTotal(counts.atkFlat, AFFIX_VALUE_PER_COUNT.atkFlat) +
        AFFIX_DRIVE_DISC_SLOT_2_ATK,
    ),
    def: roundPanelValue(
      parts.agentDef * (1 + defPercent / 100) +
        affixStatTotal(counts.defFlat, AFFIX_VALUE_PER_COUNT.defFlat) +
        AFFIX_DRIVE_DISC_SLOT_3_DEF,
    ),
    critRate: roundPanelValue(
      parts.critRate + affixStatTotal(counts.critRate, AFFIX_VALUE_PER_COUNT.critRate),
    ),
    critDmg: roundPanelValue(
      parts.critDmg + affixStatTotal(counts.critDmg, AFFIX_VALUE_PER_COUNT.critDmg),
    ),
    sharpenCritDmgBonus: 0,
    dmgBonus: roundPanelValue(parts.dmgBonus),
    ignoreDefense: 0,
    reduceDefense: roundPanelValue(parts.reduceDefense),
    penRate: roundPanelValue(parts.penRate),
    pen: roundPanelValue(parts.pen + affixStatTotal(counts.pen, AFFIX_VALUE_PER_COUNT.pen)),
    resPen: roundPanelValue(parts.resPen),
    mastery: roundPanelValue(
      parts.mastery + affixStatTotal(counts.mastery, AFFIX_VALUE_PER_COUNT.mastery),
    ),
    anomalyControl: roundPanelValue(parts.anomalyControl),
    energyRegen: roundPanelValue(parts.energyRegen),
    anomalyCritRate: roundPanelValue(parts.anomalyCritRate),
    anomalyCritDmg: roundPanelValue(parts.anomalyCritDmg),
    anomalyDmgBonus: roundPanelValue(parts.anomalyDmgBonus),
    anomalyReleaseCritRate: 0,
    anomalyReleaseCritDmg: 0,
    anomalyReleaseMult: 0,
    anomalyReleaseDmgBonus: 0,
    directDmgMult: roundPanelValue(parts.directDmgMult),
    settlementDmgMult: 0,
    anomalyMult: roundPanelValue(parts.anomalyMult),
    disorderBaseMult: roundPanelValue(parts.disorderBaseMult),
    anomalyDuration: roundPanelValue(parts.anomalyDuration),
    disorderCompMult: roundPanelValue(parts.disorderCompMult),
    turbulenceBaseMult: roundPanelValue(parts.turbulenceBaseMult),
    turbulenceCompMult: roundPanelValue(parts.turbulenceCompMult),
    disorderDmgBonus: roundPanelValue(parts.disorderDmgBonus),
    turbulenceDmgBonus: roundPanelValue(parts.turbulenceDmgBonus),
    radianceMult: roundPanelValue(parts.radianceMult),
    radianceDmgBonus: roundPanelValue(parts.radianceDmgBonus),
    radianceResPen: roundPanelValue(parts.radianceResPen),
    specialMult: roundPanelValue(parts.specialMult),
    mutationCoeff: 0,
    directDmgMultFactor: 100,
    anomalyMultFactor: 100,
    anomalyReleaseMultFactor: 100,
    disorderBaseMultFactor: 100,
    turbulenceBaseMultFactor: 100,
    radianceMultFactor: 100,
    specialMultFactor: 100,
    mutationCoeffFactor: 100,
  }
}

export function computeExternalPanelFromAffixes(input: AffixPanelCalcInput): PanelStats {
  const { affixCounts, ...fixedInput } = input
  return applyAffixCountsToFixedParts(buildAffixExternalFixedParts(fixedInput), affixCounts)
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
  /** 锋御音擎基础防御，计入防御基数 */
  wengineBaseDef?: number
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
      warnings.push(`生命反推残差较大（Δ${roundPanelValue(best.err)}），请核对当前角色基础面板与驱动盘主属性`)
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

  const targetDef = input.target.def
  if (typeof targetDef === 'number' && Number.isFinite(targetDef) && targetDef > 0) {
    const fixedDefPercent =
      wengineAdvanced.externalDefPercent +
      readTwoPieceExternalPercents(twoPieceMods).externalDefPercent +
      mainStats.externalDefPercent
    const defBase = agentBase.def + (input.wengineBaseDef ?? 0)
    let best = { pct: 0, flat: 0, err: Number.POSITIVE_INFINITY }
    for (let pct = 0; pct <= 36; pct++) {
      const withPct =
        defBase * (1 + (fixedDefPercent + pct * AFFIX_VALUE_PER_COUNT.defPercent) / 100) +
        AFFIX_DRIVE_DISC_SLOT_3_DEF
      const flat = clampCount((targetDef - withPct) / AFFIX_VALUE_PER_COUNT.defFlat)
      const actual =
        defBase * (1 + (fixedDefPercent + pct * AFFIX_VALUE_PER_COUNT.defPercent) / 100) +
        flat * AFFIX_VALUE_PER_COUNT.defFlat +
        AFFIX_DRIVE_DISC_SLOT_3_DEF
      const err = Math.abs(actual - targetDef)
      if (err < best.err || (err === best.err && pct + flat < best.pct + best.flat)) {
        best = { pct, flat, err }
      }
    }
    counts.defPercent = best.pct
    counts.defFlat = best.flat
    if (best.err > 30) {
      warnings.push(`防御反推残差较大（Δ${roundPanelValue(best.err)}），已吸附到最近词条组合`)
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
    (typeof targetDef === 'number' && targetDef > 0) ||
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
  { key: 'defFlat', label: '防御力', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.defFlat },
  {
    key: 'defPercent',
    label: '局外大防御',
    unitLabel: '条',
    perCount: AFFIX_VALUE_PER_COUNT.defPercent,
  },
  { key: 'pen', label: '穿透值', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.pen },
  { key: 'critRate', label: '暴击', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.critRate },
  { key: 'critDmg', label: '爆伤', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.critDmg },
  { key: 'mastery', label: '精通', unitLabel: '条', perCount: AFFIX_VALUE_PER_COUNT.mastery },
]
