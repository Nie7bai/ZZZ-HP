import type { DamageEnemyInput } from '@/utils/enemyResistance'
import type { ResolvedHit } from '@/utils/resolvedHit'
import {
  buildOptimalEvalContext,
  buildGlobalPanelContext,
  resolveEventBuffPreviewInputs,
  resolveContextConfigurationParameters,
  withAffixLibraryExtraGains,
  evaluateOptimalEventDetail,
  type OptimalEvalContext,
  type OptimalEventEvalDetail,
} from '@/utils/optimalAffixAlloc'
import { readHitEvalCache, writeHitEvalCache, buildHitEvalFingerprint, createHitEvalKeyBuilder, internHitEvalContext, type HitEvalCacheEntry } from '@/utils/hitEvalCache'
import { computePanelStages, buffMasterDataVersion, buildPanelSourceValuesBySlotRecord, type ConvertResolveInputs, type PanelSourceValues } from '@/utils/panelBuffCalc'
import { resolveSlotExternalPanel } from '@/utils/panelSourceResolution'
import { buildSkillFlowHitContextSignature } from '@/utils/skillFlowPanelSource'
import { getRuntimeConfigVersions } from '@/zones/schemeSource'
import { buildGenericPanelSkillContext } from '@/utils/resolvedHit'
import type { DamageCalcKind, StaggerPhase } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import type { ExtraBuffGain } from '@/types/extraBuff'
import type { FlowBuffOverride } from '@/types/damageCalcHistory'
import { snapshotCalculationInput } from '@/utils/reactiveUnwrap'
export interface BuffCalculationRuntimeInput {
  contextInput: Omit<Parameters<typeof buildOptimalEvalContext>[0], 'slotExternalPanels' | 'skillContext'>
  externalPanelPolicy: 'configured' | 'analysis'
  mainExternal: PanelStats | null
  sourceExtraGains: readonly ExtraBuffGain[]
  staggerPhase?: StaggerPhase
  globalDamageKind?: DamageCalcKind
}

export interface BuffCalculationRuntime {
  readonly signature: string
  getGlobalPanelStages(slotIndex: number): Readonly<ReturnType<typeof computePanelStages>>
  getGlobalPanelSources(slotIndex: number): Readonly<Record<number, PanelSourceValues>>
  getConfigurationInputs(slotIndex: number, scope: 'global' | 'group', rowOverride?: FlowBuffOverride | null): ConvertResolveInputs
  getHitNumbers(hit: ResolvedHit): HitEvalCacheEntry | null
  getHitDetail(hit: ResolvedHit): SkillFlowCalculationDetail | null
  getHitBuffPreview(slotIndex: number, hit: ResolvedHit | null, rowOverride?: FlowBuffOverride | null): ConvertResolveInputs
}

/** 同一份捕获输入同时决定身份与求值；组件只消费本运行期，不再另配 key/context。 */
export function createBuffCalculationRuntime(input: BuffCalculationRuntimeInput): BuffCalculationRuntime {
  const source = input.contextInput
  // 在隔离/解包前完成响应式依赖采集。主数据按加载版本共享，元素是可变事件依赖。
  const runtimeVersions = getRuntimeConfigVersions()
  const signature = buildSkillFlowHitContextSignature({
    baseDamageSource: source.baseDamageSource, teamSlots: source.teamSlots, mainSlotIndex: source.mainSlotIndex,
    agentElements: source.agents.map(agent => [agent.id, agent.element]),
    enemy: source.enemyInput, extraGains: source.extraGains, sourceExtraGains: input.sourceExtraGains,
    buffSelection: source.buffSelection, slotBuffSelections: source.slotBuffSelections,
    convertSlotPanels: source.convertSlotPanels, activeSlotPanels: source.activeSlotPanels,
    environmentBuffIds: (source.environmentBuffs ?? []).map(item => item.id),
    bangbooId: source.bangboo.id, bangbooRefine: source.bangbooRefine,
    driveDiscMainStats: source.driveDiscMainStats, skillTalentLevelsByAgent: source.skillTalentLevelsByAgent,
    damageKind: input.globalDamageKind ?? null, staggerPhase: input.staggerPhase,
    mainExternalPanel: input.mainExternal, calcMode: input.externalPanelPolicy,
    triggerAnomalyAgentId: source.triggerAnomalyAgentId,
  }) + '|catalog=' + buffMasterDataVersion(source)
    + '|zones=' + (runtimeVersions.zoneSchemeVersion ?? '')
    + '|chains=' + JSON.stringify(runtimeVersions.damageChainVersions)
    + '|configuration=' + JSON.stringify(
    Object.fromEntries(Object.entries(source).filter(([key, value]) =>
      // `hits` 不进上下文：单条求值只读传进来的那一条命中，命中内容由整条指纹承担
      // （`buildHitEvalFingerprint`）。带上它会让「加一行 / 调序 / 加准备预览」把整条流程全部重算。
      !['agents', 'wengines', 'driveDiscs', 'bangboo', 'hits'].includes(key) && typeof value !== 'function')),
  )
  const mainSlotIndex = source.mainSlotIndex
  const mainExternal = snapshotCalculationInput(input.mainExternal)
  const slotExternalPanels = input.externalPanelPolicy === 'configured'
    ? Object.fromEntries(source.teamSlots.flatMap((slot, slotIndex) => slot.agentId
      ? [[slotIndex, resolveSlotExternalPanel({ ...source, slotIndex })]] : []))
    : undefined
  const subcategories = new Map((source.skillSubcategories ?? []).map(item => [item.id, snapshotCalculationInput(item)]))
  for (const id of new Set([...(source.skillSubcategories ?? []).map(item => item.id),
    ...(source.hits ?? []).flatMap(hit => hit.skill.buffAnchorId ? [hit.skill.buffAnchorId] : [])])) {
    const resolved = source.resolveSubcategory?.(id)
    if (resolved) subcategories.set(id, snapshotCalculationInput(resolved))
  }
  const base = buildOptimalEvalContext({ ...source, slotExternalPanels,
    resolveSubcategory: id => id ? subcategories.get(id) ?? null : null,
    skillContext: buildGenericPanelSkillContext({ damageKind: input.globalDamageKind, staggerPhase: input.staggerPhase ?? 'stagger' }),
  })
  const context = withAffixLibraryExtraGains(base, snapshotCalculationInput([...input.sourceExtraGains]))
  const mainPanel = mainExternal ?? context.panelContext.slotExternalPanels![mainSlotIndex]!
  // 令牌与主 C 面板键在运行时内固定：建一次，逐条命中复用（键格式仍由 hitEvalCache 单点维护）
  const token = internHitEvalContext(signature)
  const cacheKey = createHitEvalKeyBuilder(token, mainPanel)
  const previews = new Map<string, ConvertResolveInputs>()
  const globalStages = new Map<number, ReturnType<typeof computePanelStages>>()
  function stagesForSlot(slotIndex: number) {
    let stages = globalStages.get(slotIndex)
    if (!stages) {
      const ctx = globalContext(slotIndex)
      const external = slotIndex === mainSlotIndex ? mainPanel : context.panelContext.slotExternalPanels![slotIndex]!
      stages = computePanelStages(external, ctx)
      globalStages.set(slotIndex, stages)
    }
    return stages
  }
  function globalContext(slotIndex: number, rowOverride: FlowBuffOverride | null = null) {
    const ctx = buildGlobalPanelContext(context, mainExternal, slotIndex)
    if (!rowOverride) return ctx
    const changed = { ...ctx, rowBuffOverride: snapshotCalculationInput(rowOverride) }
    // 组覆盖只属于本次配置查询，不能复用未覆盖的惰性来源地图。
    changed.panelSourceValuesBySlot = undefined
    changed.panelSourceValues = undefined
    return changed
  }
  function configuration(slotIndex: number, scope: 'global' | 'group', rowOverride?: FlowBuffOverride | null): ConvertResolveInputs {
    const ctx = globalContext(slotIndex, scope === 'group' ? rowOverride ?? null : null)
    const external = context.panelContext.slotExternalPanels?.[slotIndex] ?? mainPanel
    const sources = scope === 'global'
      ? Object.fromEntries(stagesForSlot(slotIndex).panelSourceValuesBySlot)
      : buildPanelSourceValuesBySlotRecord(ctx, slotIndex === mainSlotIndex ? mainPanel : external)
    ctx.panelSourceValuesBySlot = new Map(Object.entries(sources).map(([slot, values]) => [Number(slot), values]))
    return { contextKind: scope, configurationOnly: true, attrDefaults: ctx.attrValues ?? {},
      panelSourceValues: sources[slotIndex], panelSourceValuesBySlot: sources,
      configurationParameters: resolveContextConfigurationParameters(context, ctx, slotIndex),
    }
  }
  function detail(inputHit: ResolvedHit) {
    const hit = snapshotCalculationInput(inputHit)
    return resolveSkillFlowCalculationDetail(context, mainExternal, hit,
      cacheKey(buildHitEvalFingerprint(hit), true))
  }
  return Object.freeze({
    signature,
    getGlobalPanelStages: stagesForSlot,
    getGlobalPanelSources(slotIndex: number) { return Object.fromEntries(stagesForSlot(slotIndex).panelSourceValuesBySlot) },
    getConfigurationInputs: configuration,
    getHitNumbers(inputHit: ResolvedHit) {
      const hit = snapshotCalculationInput(inputHit)
      const key = cacheKey(buildHitEvalFingerprint(hit), false)
      const cached = readHitEvalCache(key)
      if (cached) return cached
      const value = evaluateSkillFlowHit(context, mainExternal, hit, false)
      if (!value) return null
      const entry = { hitId: hit.id, perHit: value.perHit, total: value.total, result: value.result }
      writeHitEvalCache(key, entry)
      return entry
    },
    getHitDetail: detail,
    getHitBuffPreview(slotIndex: number, hit: ResolvedHit | null, rowOverride?: FlowBuffOverride | null) {
      if (!hit) return { ...configuration(slotIndex, 'group', rowOverride), contextKind: 'unavailable' as const }
      const effectiveHit = rowOverride === undefined ? snapshotCalculationInput(hit) : { ...snapshotCalculationInput(hit), buffOverride: snapshotCalculationInput(rowOverride) }
      const key = `${slotIndex}|${token}|${buildHitEvalFingerprint(effectiveHit)}`
      const cached = previews.get(key)
      if (cached) return cached
      const value = resolveEventBuffPreviewInputs(context, mainExternal, effectiveHit, slotIndex, detail(effectiveHit)?.evaluation ?? null)
      if (previews.size >= 128) previews.delete(previews.keys().next().value!)
      previews.set(key, value)
      return value
    },
  })
}

export interface SkillFlowCalculationDetail {
  evaluation: OptimalEventEvalDetail
  enemyInput: DamageEnemyInput
  isMb: boolean
}

/** 流程数字与完整来源共用同一入口；需要该条详情时才生成来源。 */
export function evaluateSkillFlowHit(
  context: OptimalEvalContext,
  external: OptimalEventEvalDetail['external'] | null,
  hit: ResolvedHit,
  includeDetails = false,
) {
  return evaluateOptimalEventDetail(context, external, hit, {
    includeDetails,
    requirePanel: true,
  })
}

export function resolveSkillFlowCalculationDetail(
  context: OptimalEvalContext,
  external: OptimalEventEvalDetail['external'] | null,
  hit: ResolvedHit,
  /**
   * 同快照的 detail 轴缓存键（Spec §3.4 第 3 项）。
   * 提供时**只**接受同一快照的完整 detail 条目：命中直接复用，未命中才正式重放一次并写回；
   * 不提供时保持原来的纯求值行为（不读写缓存）。
   */
  cacheKey?: string,
): SkillFlowCalculationDetail | null {
  if (cacheKey) {
    const cached = readHitEvalCache(cacheKey)
    if (cached?.evaluation) return toDetail(cached.evaluation, context)
  }
  const evaluation = evaluateSkillFlowHit(context, external, hit, true)
  if (!evaluation) return null
  if (cacheKey) {
    writeHitEvalCache(cacheKey, {
      hitId: hit.id,
      perHit: evaluation.perHit,
      total: evaluation.total,
      result: evaluation.result,
      evaluation,
    })
  }
  return toDetail(evaluation, context)
}

function toDetail(
  evaluation: OptimalEventEvalDetail,
  context: OptimalEvalContext,
): SkillFlowCalculationDetail {
  return {
    evaluation,
    enemyInput: context.enemyInput,
    isMb: evaluation.kind === 'direct' && evaluation.result.baseDamageSource === 'pierce',
  }
}
