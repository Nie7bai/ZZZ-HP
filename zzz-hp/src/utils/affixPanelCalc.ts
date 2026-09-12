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

/**
 * 词条计数 → 局外面板。
 *
 * `valuePerCount` 可覆盖「每档值」：词条库里的条目各自带 `perRoll`，用户在界面改了
 * 每档数值就必须按新值算（历史缺陷：副词条这条路写死读 `AFFIX_VALUE_PER_COUNT`，
 * 界面改了每档、伤害却不变）。默认参数保证柱图等既有调用点行为完全不变。
 */
export function applyAffixCountsToFixedParts(
  parts: AffixExternalFixedParts,
  counts: AffixCounts,
  valuePerCount: Record<keyof AffixCounts, number> = AFFIX_VALUE_PER_COUNT,
): PanelStats {
  const hpPercent = parts.fixedHpPercent + affixStatTotal(counts.hpPercent, valuePerCount.hpPercent)
  const atkPercent =
    parts.fixedAtkPercent + affixStatTotal(counts.atkPercent, valuePerCount.atkPercent)
  const defPercent =
    parts.fixedDefPercent + affixStatTotal(counts.defPercent, valuePerCount.defPercent)
  return {
    hp: roundPanelValue(
      parts.agentHp * (1 + hpPercent / 100) +
        affixStatTotal(counts.hpFlat, valuePerCount.hpFlat) +
        AFFIX_DRIVE_DISC_SLOT_1_HP,
    ),
    atk: roundPanelValue(
      parts.atkBase * (1 + atkPercent / 100) +
        affixStatTotal(counts.atkFlat, valuePerCount.atkFlat) +
        AFFIX_DRIVE_DISC_SLOT_2_ATK,
    ),
    def: roundPanelValue(
      parts.agentDef * (1 + defPercent / 100) +
        affixStatTotal(counts.defFlat, valuePerCount.defFlat) +
        AFFIX_DRIVE_DISC_SLOT_3_DEF,
    ),
    critRate: roundPanelValue(
      parts.critRate + affixStatTotal(counts.critRate, valuePerCount.critRate),
    ),
    critDmg: roundPanelValue(
      parts.critDmg + affixStatTotal(counts.critDmg, valuePerCount.critDmg),
    ),
    sharpenCritDmgBonus: 0,
    dmgBonus: roundPanelValue(parts.dmgBonus),
    ignoreDefense: 0,
    reduceDefense: roundPanelValue(parts.reduceDefense),
    penRate: roundPanelValue(parts.penRate),
    pen: roundPanelValue(parts.pen + affixStatTotal(counts.pen, valuePerCount.pen)),
    resPen: roundPanelValue(parts.resPen),
    mastery: roundPanelValue(
      parts.mastery + affixStatTotal(counts.mastery, valuePerCount.mastery),
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

/** 百分比词条折算所用的基础值：角色基础 + 音擎基础，不含任何词条。 */
export type AffixPercentBases = {
  hp: number
  atk: number
  def: number
}

/**
 * 在**已有局外面板**上叠加词条增量。
 *
 * 与 `applyAffixCountsToFixedParts` 的区别：那个函数把整份面板算出来（含角色 / 音擎 /
 * 驱动盘 / 主属性），这个函数假定面板已经由「角色配置」给好 —— 面板导入、截图识别或
 * 词条推导写入 `anomalySlotPanels` 的那一份 —— 只把词条那部分加在上面。
 *
 * 面板里已有的副词条**不参与扣减**：词条是「在面板上再加 N 条」，用户自行判断上限。
 * 驱动盘主属性、套装效果、音擎高级属性都已在面板里，此处不重复叠加。
 *
 * 百分比词条按基础值折算（与游戏口径、与 `applyAffixCountsToFixedParts` 一致）：
 * 大攻击 +3%/条 的增量是 `(角色基础攻 + 音擎基础攻) × 3%`，而不是面板攻击 × 3%。
 *
 * `valuePerCount` 可覆盖「每档值」：用户在词条库改了每档，界面显示 4% 就必须按 4% 算，
 * 不能又回落到写死的常量表。省略时用常量表（改造前行为）。
 */
export function applyAffixCountsOntoExternalPanel(
  base: PanelStats,
  counts: AffixCounts,
  bases: AffixPercentBases,
  valuePerCount: Record<keyof AffixCounts, number> = AFFIX_VALUE_PER_COUNT,
): PanelStats {
  const hpPercent = affixStatTotal(counts.hpPercent, valuePerCount.hpPercent)
  const atkPercent = affixStatTotal(counts.atkPercent, valuePerCount.atkPercent)
  const defPercent = affixStatTotal(counts.defPercent, valuePerCount.defPercent)
  return {
    ...base,
    hp: roundPanelValue(
      base.hp +
        (bases.hp * hpPercent) / 100 +
        affixStatTotal(counts.hpFlat, valuePerCount.hpFlat),
    ),
    atk: roundPanelValue(
      base.atk +
        (bases.atk * atkPercent) / 100 +
        affixStatTotal(counts.atkFlat, valuePerCount.atkFlat),
    ),
    def: roundPanelValue(
      base.def +
        (bases.def * defPercent) / 100 +
        affixStatTotal(counts.defFlat, valuePerCount.defFlat),
    ),
    critRate: roundPanelValue(
      base.critRate + affixStatTotal(counts.critRate, valuePerCount.critRate),
    ),
    critDmg: roundPanelValue(
      base.critDmg + affixStatTotal(counts.critDmg, valuePerCount.critDmg),
    ),
    pen: roundPanelValue(base.pen + affixStatTotal(counts.pen, valuePerCount.pen)),
    mastery: roundPanelValue(
      base.mastery + affixStatTotal(counts.mastery, valuePerCount.mastery),
    ),
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
