import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import {
  isEffectEnabled,
  effectMatchesContext,
  resolveConvertValue,
  resolveEffectBaseValue,
} from '@/utils/buffEffect'
import {
  applyBuffModsToPanel,
  collectAllBuffEffects,
  collectPanelBuffMods,
  collectPanelBuffModSources,
  computeFinalPanel,
  panelToConvertAttrValues,
  type PanelBuffBreakdown,
  type PanelCalcContext,
} from '@/utils/panelBuffCalc'
import { compileCollectedBuffs } from '@/utils/effectCompiler'
import { effectInstanceToBuffEffect } from '@/utils/effectAdapters'
import type { EffectInstance } from '@/types/effectSpec'
import {
  computeMutationZone,
  resolveLuminousEquivalentElement,
  type RemielSelfRadianceCalcInput,
} from '@/utils/remielUtils'

/**
 * 蕾米本人耀变：仅本槽、不含邦布（用于穿透/抗穿/增伤等仍取本槽面板的部分）。
 * 生产入口走 `panelViewPolicy.ts` 的 `remiel-self-radiance`；本文件仍是规则实现。
 */
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

function formatSignedContribution(value: number) {
  if (value > 0) return `+${value}`
  return String(value)
}

function remielAgentPrefix(slotIndex: number) {
  return `agent-${slotIndex}-`
}

function remielFourPiecePrefix(slotIndex: number) {
  return `drive-disc-${slotIndex}-4set`
}

function remielWenginePrefix(slotIndex: number) {
  return `wengine-${slotIndex}-`
}

function isRemielSelfAtkConvert(instance: EffectInstance, slotIndex: number) {
  return (
    instance.sourceKey.startsWith(remielAgentPrefix(slotIndex)) &&
    instance.stat === 'atk' &&
    (instance.operation === 'convert' || instance.buffKind === 'convert')
  )
}

function isRemielSelfMasterySource(sourceKey: string, slotIndex: number) {
  const fourPiece = remielFourPiecePrefix(slotIndex)
  const isFourPiece = sourceKey.startsWith(fourPiece) && !sourceKey.includes('-4set-2pc')
  const isWengine = sourceKey.startsWith(remielWenginePrefix(slotIndex))
  return { isFourPiece, isWengine, match: isFourPiece || isWengine }
}

/**
 * 本人耀变专用（`collectRemielSelfRestrictedContributions` 的产物）：
 * - 局内攻击 = 局外攻击 + 蕾米埃尔自身（影画/角色）攻击力转模
 * - 局内精通 = 局外精通 + 驱动盘4件套全局精通 + 音擎全局精通
 * 不含局内攻击%、队友/邦布，也不吃角色其它固定攻击/精通。
 */
export interface RemielSelfRestrictedContributions {
  inCombatAtk: number
  inCombatMastery: number
  atkItems: string[]
  masteryItems: string[]
}

function finishRestrictedContributions(
  externalPanel: PanelStats,
  atkConvert: number,
  masteryBonus: number,
  atkItems: string[],
  masteryItems: string[],
): RemielSelfRestrictedContributions {
  return {
    inCombatAtk: Math.max(0, externalPanel.atk + atkConvert),
    inCombatMastery: Math.max(0, externalPanel.mastery + masteryBonus),
    atkItems,
    masteryItems,
  }
}

/** 旧路径：手写遍历来源前缀。阶段 4 收尾双跑对照用。 */
export function collectRemielSelfRestrictedContributionsFromSources(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
): RemielSelfRestrictedContributions {
  const restrictedCtx: PanelCalcContext = {
    ...ctx,
    mainSlotIndex: remielSlotIndex,
    restrictToSlotIndex: remielSlotIndex,
    excludeBangboo: true,
  }

  const interimMods = collectPanelBuffMods({ ...restrictedCtx, skipConvert: true })
  const interimPanel = applyBuffModsToPanel(externalPanel, interimMods)
  const panelSourceValues = {
    external: panelToConvertAttrValues(externalPanel),
    final: panelToConvertAttrValues(interimPanel),
  }
  const sources = collectPanelBuffModSources({
    ...restrictedCtx,
    skipConvert: false,
    panelSourceValues,
  })

  const skillCtx = ctx.skillContext
  let atkConvert = 0
  let masteryBonus = 0
  const atkItems: string[] = []
  const masteryItems: string[] = []

  for (const source of sources) {
    for (const effect of source.effects ?? []) {
      if (!isEffectEnabled(effect, ctx.buffSelection)) continue
      if (!effectMatchesContext(effect, skillCtx)) continue

      const stacks =
        ctx.buffSelection?.stacksByEffectId?.[effect.id] ?? effect.defaultStacks ?? 1
      const convertOverride = ctx.buffSelection?.convertInputs?.[effect.id]

      if (
        source.key.startsWith(remielAgentPrefix(remielSlotIndex)) &&
        effect.kind === 'convert' &&
        effect.stat === 'atk'
      ) {
        const value = resolveConvertValue(effect, {}, convertOverride, panelSourceValues)
        if (!value) continue
        atkConvert += value
        atkItems.push(`${source.label} 攻击力转模 ${formatSignedContribution(value)}`)
        continue
      }

      const masterySource = isRemielSelfMasterySource(source.key, remielSlotIndex)
      if (!masterySource.match || effect.stat !== 'mastery') continue

      const value =
        effect.kind === 'convert'
          ? resolveConvertValue(effect, {}, convertOverride, panelSourceValues)
          : resolveEffectBaseValue(effect, stacks)
      if (!value) continue
      masteryBonus += value
      const kindLabel = masterySource.isFourPiece ? '四件套全局精通' : '音擎全局精通'
      masteryItems.push(`${source.label} ${kindLabel} ${formatSignedContribution(value)}`)
    }
  }

  return finishRestrictedContributions(
    externalPanel,
    atkConvert,
    masteryBonus,
    atkItems,
    masteryItems,
  )
}

export function collectRemielSelfRestrictedContributions(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
): RemielSelfRestrictedContributions {
  const restrictedCtx: PanelCalcContext = {
    ...ctx,
    mainSlotIndex: remielSlotIndex,
    restrictToSlotIndex: remielSlotIndex,
    excludeBangboo: true,
  }

  const interimMods = collectPanelBuffMods({ ...restrictedCtx, skipConvert: true })
  const interimPanel = applyBuffModsToPanel(externalPanel, interimMods)
  const panelSourceValues = {
    external: panelToConvertAttrValues(externalPanel),
    final: panelToConvertAttrValues(interimPanel),
  }
  const plan = compileCollectedBuffs(collectAllBuffEffects(restrictedCtx))
  const skillCtx = ctx.skillContext

  let atkConvert = 0
  let masteryBonus = 0
  const atkItems: string[] = []
  const masteryItems: string[] = []

  for (const instance of plan.instances) {
    const effect = effectInstanceToBuffEffect(instance)
    if (!isEffectEnabled(effect, ctx.buffSelection)) continue
    if (!effectMatchesContext(effect, skillCtx)) continue

    const stacks =
      ctx.buffSelection?.stacksByEffectId?.[effect.id] ?? effect.defaultStacks ?? 1
    const convertOverride = ctx.buffSelection?.convertInputs?.[effect.id]
    const label = instance.displayName ?? instance.sourceKey

    if (isRemielSelfAtkConvert(instance, remielSlotIndex)) {
      const value = resolveConvertValue(effect, {}, convertOverride, panelSourceValues)
      if (!value) continue
      atkConvert += value
      atkItems.push(`${label} 攻击力转模 ${formatSignedContribution(value)}`)
      continue
    }

    const masterySource = isRemielSelfMasterySource(instance.sourceKey, remielSlotIndex)
    if (!masterySource.match || instance.stat !== 'mastery') continue

    const value =
      effect.kind === 'convert'
        ? resolveConvertValue(effect, {}, convertOverride, panelSourceValues)
        : resolveEffectBaseValue(effect, stacks)
    if (!value) continue
    masteryBonus += value
    const kindLabel = masterySource.isFourPiece ? '四件套全局精通' : '音擎全局精通'
    masteryItems.push(`${label} ${kindLabel} ${formatSignedContribution(value)}`)
  }

  return finishRestrictedContributions(
    externalPanel,
    atkConvert,
    masteryBonus,
    atkItems,
    masteryItems,
  )
}

export function computeRemielSelfRestrictedAtkAndMastery(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
): { inCombatAtk: number; inCombatMastery: number } {
  const collected = collectRemielSelfRestrictedContributions(
    externalPanel,
    ctx,
    remielSlotIndex,
  )
  return {
    inCombatAtk: collected.inCombatAtk,
    inCombatMastery: collected.inCombatMastery,
  }
}

export function extractRemielSelfInCombatStats(
  breakdown: PanelBuffBreakdown,
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  remielSlotIndex: number,
  /** 异化系数取最终局内面板（含队友等）；未传则回落到本槽受限面板 */
  finalPanelForMutation?: PanelStats,
): {
  inCombatAtk: number
  inCombatMastery: number
  mutationZone: number
  penRate: number
  pen: number
  resPen: number
  radianceResPen: number
  radianceDmgBonus: number
  anomalyDmgBonus: number
} {
  const panel = breakdown.finalPanel
  const restricted = computeRemielSelfRestrictedAtkAndMastery(
    externalPanel,
    ctx,
    remielSlotIndex,
  )
  return {
    inCombatAtk: restricted.inCombatAtk,
    inCombatMastery: restricted.inCombatMastery,
    mutationZone: computeMutationZone(finalPanelForMutation ?? panel),
    penRate: panel.penRate,
    pen: panel.pen,
    resPen: panel.resPen,
    radianceResPen: panel.radianceResPen,
    radianceDmgBonus: panel.radianceDmgBonus,
    anomalyDmgBonus: panel.anomalyDmgBonus,
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
  const restrictedCtx: PanelCalcContext = {
    ...options.panelCtx,
    mainSlotIndex: options.remielSlotIndex,
    restrictToSlotIndex: options.remielSlotIndex,
    excludeBangboo: true,
  }
  const breakdown = computeRemielSelfInCombatPanel(
    options.externalPanel,
    options.panelCtx,
    options.remielSlotIndex,
  )
  // 异化系数：蕾米最终局内面板（含队友/邦布等），与页级 luminous 异化同源口径。
  // scope=mutation 仅在 anomaly 上下文生效，缺省或直伤上下文时强制 anomaly。
  const baseSkillCtx = options.panelCtx.skillContext
  const mutationSkillContext = {
    damageKind: 'anomaly' as const,
    categoryId: baseSkillCtx?.categoryId ?? 'basic',
    subcategoryId: baseSkillCtx?.subcategoryId ?? null,
    coords: baseSkillCtx?.coords ?? [],
    element: baseSkillCtx?.element,
    staggerPhase: baseSkillCtx?.staggerPhase,
    isFollowUp: baseSkillCtx?.isFollowUp ?? false,
    anomalySubKind: baseSkillCtx?.anomalySubKind ?? 'radiance',
  }
  const finalMutationPanel = computeFinalPanel(options.externalPanel, {
    ...options.panelCtx,
    mainSlotIndex: options.remielSlotIndex,
    skillContext: mutationSkillContext,
  }).finalPanel
  const stats = extractRemielSelfInCombatStats(
    breakdown,
    options.externalPanel,
    restrictedCtx,
    options.remielSlotIndex,
    finalMutationPanel,
  )
  return {
    agentLevel: options.agentLevel,
    inCombatAtk: stats.inCombatAtk,
    inCombatMastery: stats.inCombatMastery,
    mutationZone: stats.mutationZone,
    penRate: stats.penRate,
    pen: stats.pen,
    resPen: stats.resPen,
    radianceResPen: stats.radianceResPen,
    radianceDmgBonus: stats.radianceDmgBonus,
    anomalyDmgBonus: stats.anomalyDmgBonus,
    resistanceElement: resolveLuminousEquivalentElement(
      options.teamSlots,
      options.agents,
      options.remielSlotIndex,
    ) ?? null,
    isMb: options.isMb,
  }
}
