import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import {
  computeFinalPanel,
  type PanelBuffBreakdown,
  type PanelCalcContext,
} from '@/utils/panelBuffCalc'
import {
  computeMutationZone,
  resolveLuminousEquivalentElement,
  type RemielSelfRadianceCalcInput,
} from '@/utils/remielUtils'

/** 蕾米埃尔本人耀变：局内攻/精仅含局外+音擎+盘子+自身转模/自身 Buff，不含队友增益与邦布 */
export function computeRemielSelfInCombatPanel(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
): PanelBuffBreakdown {
  return computeFinalPanel(externalPanel, {
    ...ctx,
    mainSlotIndex: remielSlotIndex,
    restrictToSlotIndex: remielSlotIndex,
    excludeBangboo: true,
  })
}

export function extractRemielSelfInCombatStats(
  breakdown: PanelBuffBreakdown,
): {
  inCombatAtk: number
  inCombatMastery: number
  mutationZone: number
  penRate: number
  pen: number
  resPen: number
  radianceResPen: number
} {
  const panel = breakdown.finalPanel
  return {
    inCombatAtk: panel.atk,
    inCombatMastery: panel.mastery,
    mutationZone: computeMutationZone(panel),
    penRate: panel.penRate,
    pen: panel.pen,
    resPen: panel.resPen,
    radianceResPen: panel.radianceResPen,
  }
}

export function resolveRemielSelfRadianceCalcInput(options: {
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  externalPanel: PanelStats
  panelCtx: PanelCalcContext
  remielSlotIndex: number
  agentLevel: number
  isMb: boolean
}): RemielSelfRadianceCalcInput {
  const breakdown = computeRemielSelfInCombatPanel(
    options.externalPanel,
    options.panelCtx,
    options.remielSlotIndex,
  )
  const stats = extractRemielSelfInCombatStats(breakdown)
  return {
    agentLevel: options.agentLevel,
    inCombatAtk: stats.inCombatAtk,
    inCombatMastery: stats.inCombatMastery,
    mutationZone: stats.mutationZone,
    penRate: stats.penRate,
    pen: stats.pen,
    resPen: stats.resPen,
    radianceResPen: stats.radianceResPen,
    resistanceElement: resolveLuminousEquivalentElement(
      options.teamSlots,
      options.agents,
      options.remielSlotIndex,
    ) ?? null,
    isMb: options.isMb,
  }
}
