import type { ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import type { BuffStatKey } from '@/types/calculator'
import type { AffixCounts, PanelStats } from '@/types/calculatorPanel'
import { createEmptyAffixCounts } from '@/types/calculatorPanel'
import { fillPanelStatsDefaults } from '@/types/calculatorPanel'
import type { EffectExecutionPlan, EffectInstance } from '@/types/effectSpec'
import { adaptAffixLibraryEntry, type AllocatedAffix } from '@/utils/effectAdapters'
import { compileCollectedBuffs, compileEffectPlan } from '@/utils/effectCompiler'
import {
  applyPanelDeltas,
  isPanelDeltaField,
  type AffixDeltaMap,
  type AffixLibraryEntry,
  type AffixPanelDeltaBases,
} from '@/utils/affixLibrary'
import {
  applyBuffModsToPanel,
  collectAllBuffEffects,
  collectExtraGainEffects,
  collectPanelBuffMods,
  computeFinalPanel,
  resolveBaseAnomalyControl,
  resolveBaseEnergyRegen,
  type PanelBuffBreakdown,
  type PanelCalcContext,
} from '@/utils/panelBuffCalc'
import { remapImportedExternalPanelForMainCombo, AFFIX_VALUE_PER_COUNT } from '@/utils/affixPanelCalc'
import type { AffixDriveDiscMainStats } from '@/types/calculatorPanel'
import type { DriveDiscBuffDoc } from '@/types/calculator'

export interface PanelPipelineResult {
  externalPanel: PanelStats
  /** skipConvert 之后、转模之前 */
  preConvertPanel: PanelStats
  finalBreakdown: PanelBuffBreakdown
  plan: EffectExecutionPlan
}

/**
 * 分阶段编排：与 `computeFinalPanel` 同构。
 * 目录 Buff 仍走 collectPanelBuffMods；本函数把阶段命名写死，并附上 EffectPlan。
 * 阶段 3 的 final 仍委托旧函数，生产路径未切换。
 */
export function runPanelPipeline(
  rawExternalPanel: PanelStats,
  ctx: PanelCalcContext,
  options?: { includeDetails?: boolean },
): PanelPipelineResult {
  const externalPanel = fillPanelStatsDefaults(rawExternalPanel)
  const preCtx: PanelCalcContext = { ...ctx, skipConvert: true }
  const preMods = collectPanelBuffMods(preCtx)
  const preConvertPanel = applyBuffModsToPanel(externalPanel, preMods, {
    baseAnomalyControl: resolveBaseAnomalyControl(preCtx),
    baseEnergyRegen: resolveBaseEnergyRegen(preCtx),
  })
  const finalBreakdown = computeFinalPanel(externalPanel, ctx, options)
  const plan = compileCollectedBuffs([
    ...collectAllBuffEffects(ctx),
    ...collectExtraGainEffects(ctx),
  ])
  return { externalPanel, preConvertPanel, finalBreakdown, plan }
}

export interface PanelNumericSnapshot {
  atk: number
  hp: number
  def: number
  critRate: number
  critDmg: number
  dmgBonus: number
  penRate: number
  pen: number
  resPen: number
  reduceDefense: number
  mastery: number
  impact: number
  anomalyControl: number
  energyRegen: number
}

export function snapshotPanel(panel: PanelStats): PanelNumericSnapshot {
  return {
    atk: panel.atk,
    hp: panel.hp,
    def: panel.def,
    critRate: panel.critRate,
    critDmg: panel.critDmg,
    dmgBonus: panel.dmgBonus,
    penRate: panel.penRate,
    resPen: panel.resPen,
    reduceDefense: panel.reduceDefense,
    pen: panel.pen,
    mastery: panel.mastery,
    impact: panel.impact ?? 0,
    anomalyControl: panel.anomalyControl,
    energyRegen: panel.energyRegen,
  }
}

export function diffSnapshots(
  a: PanelNumericSnapshot,
  b: PanelNumericSnapshot,
  eps = 1e-6,
): string[] {
  const diffs: string[] = []
  for (const key of Object.keys(a) as (keyof PanelNumericSnapshot)[]) {
    if (Math.abs(a[key] - b[key]) > eps) {
      diffs.push(`${key}: ${a[key]} vs ${b[key]}`)
    }
  }
  return diffs
}

export function allocateAffixEffects(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): AllocatedAffix[] {
  const allocated: AllocatedAffix[] = []
  for (const entry of entries) {
    const item = adaptAffixLibraryEntry(entry, rollsByEntryId[entry.id] ?? 0)
    if (item) allocated.push(item)
  }
  return allocated
}

export function applyAllocatedAffixEffects(
  baseExternal: PanelStats,
  allocated: AllocatedAffix[],
  bases: AffixPanelDeltaBases,
  applySlot: number,
): {
  counts: AffixCounts
  external: PanelStats
  extraGains: ExtraBuffGain[]
  plan: EffectExecutionPlan
} {
  const counts = createEmptyAffixCounts()
  const panelDeltas: AffixDeltaMap = {}
  const extraGains: ExtraBuffGain[] = []
  const effectInstances: EffectInstance[] = []

  for (const item of allocated) {
    if (item.type === 'count') {
      panelDeltas[item.statKey] =
        (panelDeltas[item.statKey] ?? 0) +
        item.equivalentRolls * AFFIX_VALUE_PER_COUNT[item.statKey]
      continue
    }
    const inst = item.instance
    effectInstances.push(inst)
    if (inst.stage === 'external' && isPanelDeltaField(inst.stat)) {
      const field = inst.stat
      panelDeltas[field] = (panelDeltas[field] ?? 0) + inst.magnitude
      continue
    }
    extraGains.push({
      id: inst.instanceId,
      name: inst.displayName ?? '词条增益',
      stat: inst.stat as BuffStatKey,
      value: inst.magnitude,
      applySituation: inst.conditions.applySituation ?? 'global',
      scope: inst.conditions.skillTargets?.length ? 'skill' : 'general',
      applyTarget: 'self',
      applySlot,
      skillCategory: inst.conditions.skillTargets?.[0]?.category,
      skillSubcategoryId: inst.conditions.skillTargets?.[0]?.subcategoryId ?? null,
      appliesToAnomaly: inst.conditions.appliesToAnomaly,
    })
  }

  return {
    counts,
    external: applyPanelDeltas(baseExternal, panelDeltas, bases),
    extraGains,
    plan: compileEffectPlan(effectInstances),
  }
}

export function remapImportedPanelViaEffects(input: {
  panel: PanelStats
  fromMains: AffixDriveDiscMainStats
  toMains: AffixDriveDiscMainStats
  fromTwoPieceId: string
  toTwoPieceId: string
  fourPieceDriveDiscId: string
  driveDiscs: DriveDiscBuffDoc[]
  agentHp: number
  atkBase: number
  agentDef: number
  anomalyControlBase: number
  energyRegenBase: number
}): PanelStats {
  // 阶段 3：数值对齐现 remap。阶段 7 再改成撤效果实例。
  return remapImportedExternalPanelForMainCombo(input)
}
