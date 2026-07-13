import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  BuffStatModifiers,
  DriveDiscBuffDoc,
  WengineBuffDoc,
} from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import {
  collectMindscapeRankBuffs,
  createEmptyBuffStatModifiers,
  createEmptySelfTeamBuffs,
  getMindscapeNote,
  hasNonZeroBuffMods,
  mergeBuffStatModifiers,
} from '@/utils/calculatorUi'

export interface DriveDiscSelection {
  twoPieceId: string
  fourPieceId: string
}

export interface PanelCalcContext {
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboo: BangbooBuffDoc
  bangbooRefine: number
  mainSlotIndex: number
  driveDiscs: DriveDiscBuffDoc[]
  extraMods?: BuffStatModifiers
}

export interface CombatBuffMods {
  vulnerable: number
  staggerVulnerable: number
  special: number
}

export interface PanelBuffBreakdown {
  totalMods: BuffStatModifiers
  combatMods: CombatBuffMods
  finalPanel: PanelStats
  sources: BuffModSource[]
}

export interface BuffModSource {
  key: string
  label: string
  mods: BuffStatModifiers
  note?: string
}

function clampRefine(value: number) {
  return Math.min(5, Math.max(1, Math.round(value)))
}

export function collectSlotDriveDiscMods(
  driveDiscs: DriveDiscBuffDoc[],
  selection: DriveDiscSelection,
  isMain: boolean,
  options?: { includeTwoPiece?: boolean },
): BuffStatModifiers {
  const includeTwoPiece = options?.includeTwoPiece ?? false
  let total = createEmptyBuffStatModifiers()

  const fourDisc =
    selection.fourPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.fourPieceId)
      : undefined
  const twoDisc =
    selection.twoPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.twoPieceId)
      : undefined

  if (isMain) {
    if (fourDisc) {
      if (includeTwoPiece) {
        total = mergeBuffStatModifiers(total, fourDisc.twoPieceMods)
      }
      total = mergeBuffStatModifiers(total, fourDisc.fourPieceBuffs.selfMods)
    }
    if (includeTwoPiece && twoDisc && twoDisc.id !== fourDisc?.id) {
      total = mergeBuffStatModifiers(total, twoDisc.twoPieceMods)
    }
    return total
  }

  if (fourDisc) {
    total = mergeBuffStatModifiers(total, fourDisc.fourPieceBuffs.teamMods)
  }

  return total
}

export function collectTeamDriveDiscMods(
  driveDiscs: DriveDiscBuffDoc[],
  teamSlots: TeamSlot[],
  mainIndex: number,
): BuffStatModifiers {
  let total = createEmptyBuffStatModifiers()

  teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    total = mergeBuffStatModifiers(
      total,
      collectSlotDriveDiscMods(
        driveDiscs,
        {
          twoPieceId: slot.twoPieceDriveDiscId,
          fourPieceId: slot.fourPieceDriveDiscId,
        },
        index === mainIndex,
      ),
    )
  })

  return total
}

function mergeSelfTeamMods(
  buffs: { selfMods: BuffStatModifiers; teamMods: BuffStatModifiers },
  isMain: boolean,
): BuffStatModifiers {
  return isMain ? buffs.selfMods : buffs.teamMods
}

function driveDiscSourceLabel(
  driveDiscs: DriveDiscBuffDoc[],
  selection: DriveDiscSelection,
): string {
  const fourDisc =
    selection.fourPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.fourPieceId)
      : undefined
  const twoDisc =
    selection.twoPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.twoPieceId)
      : undefined
  const parts: string[] = []
  if (fourDisc) parts.push(`4件：${fourDisc.name}`)
  if (twoDisc && twoDisc.id !== fourDisc?.id) parts.push(`2件：${twoDisc.name}`)
  return parts.join(' · ')
}

export function collectPanelBuffModSources(ctx: PanelCalcContext): BuffModSource[] {
  const sources: BuffModSource[] = []
  const mainIndex = ctx.mainSlotIndex

  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return

    const agent = ctx.agents.find((item) => item.id === slot.agentId)
    if (!agent) return

    const isMain = index === mainIndex
    const roleLabel = isMain ? '主C' : '辅助'
    const clampedRank = Math.min(6, Math.max(0, Math.round(slot.rank)))

    for (let rank = 0; rank <= clampedRank; rank++) {
      const rankBuffs = agent.mindscapeBuffs[rank] ?? createEmptySelfTeamBuffs()
      const mindscapeMods = mergeSelfTeamMods(rankBuffs, isMain)
      const note = getMindscapeNote(agent, rank)
      if (!hasNonZeroBuffMods(mindscapeMods) && !note) continue

      sources.push({
        key: `agent-${index}-${rank}`,
        label: `${roleLabel} · ${agent.name} · ${rank}影`,
        mods: mindscapeMods,
        note: note || undefined,
      })
    }

    if (slot.wengineId !== 'none') {
      const wengine = ctx.wengines.find((item) => item.id === slot.wengineId)
      if (wengine) {
        const refineIndex = clampRefine(slot.wengineRefine) - 1
        const refineBuffs = wengine.refinementBuffs[refineIndex] ?? {
          selfMods: createEmptyBuffStatModifiers(),
          teamMods: createEmptyBuffStatModifiers(),
        }
        let wengineMods = createEmptyBuffStatModifiers()
        if (isMain) {
          wengineMods = mergeBuffStatModifiers(wengineMods, wengine.fixedBuffs.selfMods)
          wengineMods = mergeBuffStatModifiers(wengineMods, refineBuffs.selfMods)
        } else {
          wengineMods = mergeBuffStatModifiers(wengineMods, wengine.fixedBuffs.teamMods)
          wengineMods = mergeBuffStatModifiers(wengineMods, refineBuffs.teamMods)
        }
        sources.push({
          key: `wengine-${index}`,
          label: `${roleLabel} · ${agent.name} · 音擎 · ${wengine.name}（精${slot.wengineRefine}）`,
          mods: wengineMods,
        })
      }
    }

    const discMods = collectSlotDriveDiscMods(
      ctx.driveDiscs,
      {
        twoPieceId: slot.twoPieceDriveDiscId,
        fourPieceId: slot.fourPieceDriveDiscId,
      },
      isMain,
    )
    const discLabel = driveDiscSourceLabel(ctx.driveDiscs, {
      twoPieceId: slot.twoPieceDriveDiscId,
      fourPieceId: slot.fourPieceDriveDiscId,
    })
    if (discLabel) {
      sources.push({
        key: `drive-disc-${index}`,
        label: `${roleLabel} · ${agent.name} · 驱动盘 · ${discLabel}`,
        mods: discMods,
      })
    }
  })

  if (ctx.bangboo?.id && ctx.bangboo.id !== 'none') {
    const refineIndex = clampRefine(ctx.bangbooRefine) - 1
    let bangbooMods = mergeBuffStatModifiers(
      createEmptyBuffStatModifiers(),
      ctx.bangboo.fixedMods,
    )
    bangbooMods = mergeBuffStatModifiers(
      bangbooMods,
      ctx.bangboo.refinementMods[refineIndex] ?? createEmptyBuffStatModifiers(),
    )
    sources.push({
      key: 'bangboo',
      label: `邦布 · ${ctx.bangboo.name}（精${ctx.bangbooRefine}）`,
      mods: bangbooMods,
    })
  }

  if (ctx.extraMods) {
    sources.push({
      key: 'extra',
      label: '额外 Buff',
      mods: ctx.extraMods,
    })
  }

  return sources
}

export function collectPanelBuffMods(ctx: PanelCalcContext): BuffStatModifiers {
  let total = createEmptyBuffStatModifiers()
  const mainIndex = ctx.mainSlotIndex

  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return

    const agent = ctx.agents.find((item) => item.id === slot.agentId)
    if (!agent) return

    const rankBuffs = collectMindscapeRankBuffs(agent.mindscapeBuffs, slot.rank)
    if (index === mainIndex) {
      total = mergeBuffStatModifiers(total, rankBuffs.selfMods)
    } else {
      total = mergeBuffStatModifiers(total, rankBuffs.teamMods)
    }

    if (slot.wengineId === 'none') return
    const wengine = ctx.wengines.find((item) => item.id === slot.wengineId)
    if (!wengine) return

    const refineIndex = clampRefine(slot.wengineRefine) - 1
    const refineBuffs = wengine.refinementBuffs[refineIndex] ?? {
      selfMods: createEmptyBuffStatModifiers(),
      teamMods: createEmptyBuffStatModifiers(),
    }
    if (index === mainIndex) {
      total = mergeBuffStatModifiers(total, wengine.fixedBuffs.selfMods)
      total = mergeBuffStatModifiers(total, refineBuffs.selfMods)
    } else {
      total = mergeBuffStatModifiers(total, wengine.fixedBuffs.teamMods)
      total = mergeBuffStatModifiers(total, refineBuffs.teamMods)
    }
  })

  if (ctx.bangboo?.id && ctx.bangboo.id !== 'none') {
    const refineIndex = clampRefine(ctx.bangbooRefine) - 1
    total = mergeBuffStatModifiers(total, ctx.bangboo.fixedMods)
    total = mergeBuffStatModifiers(
      total,
      ctx.bangboo.refinementMods[refineIndex] ?? createEmptyBuffStatModifiers(),
    )
  }

  total = mergeBuffStatModifiers(
    total,
    collectTeamDriveDiscMods(ctx.driveDiscs, ctx.teamSlots, mainIndex),
  )

  if (ctx.extraMods) {
    total = mergeBuffStatModifiers(total, ctx.extraMods)
  }

  return total
}

export function applyBuffModsToPanel(
  externalPanel: PanelStats,
  mods: BuffStatModifiers,
): PanelStats {
  return {
    hp: externalPanel.hp * (1 + mods.inCombatHpPercent / 100),
    atk: externalPanel.atk * (1 + mods.inCombatAtkPercent / 100) + mods.atk,
    critRate: externalPanel.critRate + mods.critRate,
    critDmg: externalPanel.critDmg + mods.critDmg,
    dmgBonus: externalPanel.dmgBonus + mods.dmgBonus,
    ignoreDefense: externalPanel.ignoreDefense,
    reduceDefense: externalPanel.reduceDefense + mods.reduceDefense,
    penRate: externalPanel.penRate + mods.penRate,
    pen: externalPanel.pen,
    resPen: externalPanel.resPen + mods.resPen,
    mastery: externalPanel.mastery + mods.mastery,
    anomalyCritRate: externalPanel.anomalyCritRate + mods.anomalyCritRate,
    anomalyCritDmg: externalPanel.anomalyCritDmg + mods.anomalyCritDmg,
    anomalyDmgBonus: externalPanel.anomalyDmgBonus + mods.anomalyDmgBonus,
    directDmgMult: externalPanel.directDmgMult + mods.directDmgMult,
    anomalyMult: externalPanel.anomalyMult + mods.anomalyMult,
    disorderBaseMult: externalPanel.disorderBaseMult + mods.disorderBaseMult,
    anomalyDuration: externalPanel.anomalyDuration + mods.anomalyDuration,
    disorderCompMult: externalPanel.disorderCompMult + mods.disorderCompMult,
    turbulenceBaseMult: externalPanel.turbulenceBaseMult + mods.turbulenceBaseMult,
    turbulenceCompMult: externalPanel.turbulenceCompMult + mods.turbulenceCompMult,
    disorderDmgBonus: externalPanel.disorderDmgBonus + mods.disorderDmgBonus,
    turbulenceDmgBonus: externalPanel.turbulenceDmgBonus + mods.turbulenceDmgBonus,
  }
}

export function extractCombatMods(mods: BuffStatModifiers): CombatBuffMods {
  return {
    vulnerable: mods.vulnerable,
    staggerVulnerable: mods.staggerVulnerable,
    special: mods.special,
  }
}

export function computeFinalPanel(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
): PanelBuffBreakdown {
  const totalMods = collectPanelBuffMods(ctx)
  return {
    totalMods,
    combatMods: extractCombatMods(totalMods),
    finalPanel: applyBuffModsToPanel(externalPanel, totalMods),
    sources: collectPanelBuffModSources(ctx),
  }
}
