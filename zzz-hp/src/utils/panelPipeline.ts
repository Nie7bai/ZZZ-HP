import type { ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import type { BuffStatKey, BuffStatModifiers, DriveDiscBuffDoc } from '@/types/calculator'
import type { AffixCounts, AffixDriveDiscMainStats, PanelStats } from '@/types/calculatorPanel'
import { createEmptyAffixCounts } from '@/types/calculatorPanel'
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
  collectAllBuffEffects,
  collectExtraGainEffects,
  computePanelStages,
  type PanelBuffBreakdown,
  type PanelCalcContext,
} from '@/utils/panelBuffCalc'
import {
  AFFIX_VALUE_PER_COUNT,
  collectAffixTwoPieceMods,
  readTwoPieceExternalPercents,
  roundPanelValue,
  type RemapImportedExternalPanelForMainComboInput,
} from '@/utils/affixPanelCalc'
import { collectAffixDriveDiscMainStatContribution } from '@/utils/affixDriveDiscConfig'

export interface PanelPipelineResult {
  externalPanel: PanelStats
  /** skipConvert 之后、转模之前 */
  preConvertPanel: PanelStats
  finalBreakdown: PanelBuffBreakdown
  plan: EffectExecutionPlan
}

/**
 * 分阶段编排：与 `computeFinalPanel` 同一入口 `computePanelStages`。
 * 目录 Buff 从 `collectAllBuffEffects` 编来源；本函数附上 EffectPlan。
 */
export function runPanelPipeline(
  rawExternalPanel: PanelStats,
  ctx: PanelCalcContext,
  options?: { includeDetails?: boolean },
): PanelPipelineResult {
  const stages = computePanelStages(rawExternalPanel, ctx, options)
  const plan = compileCollectedBuffs([
    ...collectAllBuffEffects(ctx),
    ...collectExtraGainEffects(ctx),
  ])
  return {
    externalPanel: stages.externalPanel,
    preConvertPanel: stages.preConvertPanel,
    finalBreakdown: stages.finalBreakdown,
    plan,
  }
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

type ImportedMainComboPanelEffects = {
  deltas: AffixDeltaMap
  leftoverAnomalyControl: number
  leftoverEnergyRegen: number
}

function addComboDelta(deltas: AffixDeltaMap, key: keyof AffixDeltaMap, value: number) {
  if (!value) return
  deltas[key] = (deltas[key] ?? 0) + value
}

function compileImportedMainComboPanelEffects(
  mains: AffixDriveDiscMainStats,
  twoPieceId: string,
  fourPieceDriveDiscId: string,
  driveDiscs: DriveDiscBuffDoc[],
): ImportedMainComboPanelEffects {
  const main = collectAffixDriveDiscMainStatContribution(mains)
  const mods: BuffStatModifiers = collectAffixTwoPieceMods(driveDiscs, {
    twoPieceDriveDiscId: twoPieceId || 'none',
    fourPieceDriveDiscId: fourPieceDriveDiscId || 'none',
  })
  const ext = readTwoPieceExternalPercents(mods)
  const deltas: AffixDeltaMap = {}
  addComboDelta(deltas, 'hpPercent', main.externalHpPercent + ext.externalHpPercent)
  addComboDelta(deltas, 'atkPercent', main.externalAtkPercent + ext.externalAtkPercent)
  addComboDelta(deltas, 'defPercent', main.externalDefPercent + ext.externalDefPercent)
  addComboDelta(deltas, 'hpFlat', mods.hp)
  addComboDelta(deltas, 'atkFlat', mods.atk)
  addComboDelta(deltas, 'defFlat', mods.def)
  addComboDelta(deltas, 'critRate', main.critRate + mods.critRate)
  addComboDelta(deltas, 'critDmg', main.critDmg + mods.critDmg)
  addComboDelta(deltas, 'dmgBonus', main.dmgBonus + mods.dmgBonus)
  addComboDelta(deltas, 'penRate', main.penRate + mods.penRate)
  addComboDelta(deltas, 'mastery', main.mastery + mods.mastery)
  addComboDelta(deltas, 'impact', main.impact)
  addComboDelta(deltas, 'anomalyControl', main.anomalyControl + mods.anomalyControlPercent)
  addComboDelta(deltas, 'energyRegen', main.energyRegen + mods.energyRegen)
  addComboDelta(deltas, 'reduceDefense', mods.reduceDefense)
  addComboDelta(deltas, 'resPen', mods.resPen)
  return {
    deltas,
    leftoverAnomalyControl: mods.anomalyControl,
    leftoverEnergyRegen: mods.energyRegenFlat,
  }
}

function scaleComboDeltas(deltas: AffixDeltaMap, sign: 1 | -1): AffixDeltaMap {
  const scaled: AffixDeltaMap = {}
  for (const [key, value] of Object.entries(deltas)) {
    if (typeof value === 'number' && value) {
      scaled[key as keyof AffixDeltaMap] = value * sign
    }
  }
  return scaled
}

function applyImportedComboEffects(
  panel: PanelStats,
  combo: ImportedMainComboPanelEffects,
  bases: AffixPanelDeltaBases,
  sign: 1 | -1,
): PanelStats {
  let next = applyPanelDeltas(panel, scaleComboDeltas(combo.deltas, sign), bases)
  if (combo.leftoverAnomalyControl) {
    next = {
      ...next,
      anomalyControl: next.anomalyControl + sign * combo.leftoverAnomalyControl,
    }
  }
  if (combo.leftoverEnergyRegen) {
    next = { ...next, energyRegen: next.energyRegen + sign * combo.leftoverEnergyRegen }
  }
  return next
}

function roundRemappedImportedPanel(panel: PanelStats): PanelStats {
  return {
    ...panel,
    hp: roundPanelValue(panel.hp),
    atk: roundPanelValue(panel.atk),
    def: roundPanelValue(panel.def),
    critRate: roundPanelValue(panel.critRate),
    critDmg: roundPanelValue(panel.critDmg),
    dmgBonus: roundPanelValue(panel.dmgBonus),
    penRate: roundPanelValue(panel.penRate),
    mastery: roundPanelValue(panel.mastery),
    impact: roundPanelValue(panel.impact),
    anomalyControl: roundPanelValue(panel.anomalyControl),
    energyRegen: roundPanelValue(panel.energyRegen),
    reduceDefense: roundPanelValue(panel.reduceDefense),
    resPen: roundPanelValue(panel.resPen),
  }
}

/**
 * 导入局外快照上换 4/5/6 + 2 件套：撤掉旧组合效果，再加上试算组合。
 * 局外增量走 `applyPanelDeltas`（与词条分配同一施加函数）。
 */
export function remapImportedPanelViaEffects(
  input: RemapImportedExternalPanelForMainComboInput,
): PanelStats {
  const bases: AffixPanelDeltaBases = {
    hp: input.agentHp,
    atk: input.atkBase,
    def: input.agentDef,
    anomalyControl: input.anomalyControlBase,
    energyRegen: input.energyRegenBase,
  }
  const from = compileImportedMainComboPanelEffects(
    input.fromMains,
    input.fromTwoPieceId,
    input.fourPieceDriveDiscId,
    input.driveDiscs,
  )
  const to = compileImportedMainComboPanelEffects(
    input.toMains,
    input.toTwoPieceId,
    input.fourPieceDriveDiscId,
    input.driveDiscs,
  )
  const withdrawn = applyImportedComboEffects(input.panel, from, bases, -1)
  const added = applyImportedComboEffects(withdrawn, to, bases, 1)
  return roundRemappedImportedPanel(added)
}
