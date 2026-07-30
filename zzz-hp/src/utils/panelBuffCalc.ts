import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  BuffEffect,
  BuffStatKey,
  BuffStatModifiers,
  CharacterAttrKey,
  DamageCalcKind,
  DriveDiscBuffDoc,
  SkillCalcContext,
  SkillCategoryId,
  WengineBuffDoc,
} from '@/types/calculator'
import { createDefaultExternalPanel, type PanelStats } from '@/types/calculatorPanel'
import {
  combineMultFactorPercent,
  normalizeBuffMultFactorDelta,
  normalizePanelMultFactorPercent,
} from '@/utils/multFactorPercent'
import {
  cloneEffectInstance,
  collectBlockEntriesFromPack,
  collectEffectsFromPack,
  effectMatchesContext,
  effectMatchesElement,
  flatModsToEffects,
  isEffectEnabled,
  resolveEffectsToMods,
} from '@/utils/buffEffect'
import {
  createEmptyBuffStatModifiers,
  createEmptySelfTeamBuffs,
  getMindscapeNote,
  hasNonZeroBuffMods,
  isWengineProfessionMatch,
  mergeBuffStatModifiers,
} from '@/utils/calculatorUi'

function flattenBlocks(blocks: { effects?: BuffEffect[] }[]): BuffEffect[] {
  return blocks.flatMap((block) => block.effects ?? [])
}

/** 2 件套：优先按效果块（保留名称/注释），否则回退扁平效果 */
function collectTwoPieceBlockEntries(disc: DriveDiscBuffDoc) {
  if (disc.twoPieceEffectBlocks?.length) {
    return collectBlockEntriesFromPack({
      effectBlocks: disc.twoPieceEffectBlocks,
      effects: disc.twoPieceEffects,
    })
  }
  const effects = disc.twoPieceEffects?.length
    ? disc.twoPieceEffects
    : flatModsToEffects(disc.twoPieceMods, 'self', 'general', `${disc.id}-2pc`)
  if (!effects.length) return []
  return [
    {
      blockId: `${disc.id}-2pc`,
      blockName: `${disc.name} · 2件套`,
      blockNote: disc.twoPieceNote?.trim() || '',
      effects,
    },
  ]
}

/**
 * 邦布/音擎精炼：任一精炼勾选了「异常计算时也生效」，则当前精炼同身份效果也生效。
 */
function withRefinementAnomalyFlags(
  activeEffects: BuffEffect[],
  allRefineEffects: BuffEffect[][],
  allRefineBlocks?: { effects?: BuffEffect[] }[][] | null,
): BuffEffect[] {
  const flagged = new Set<string>()
  const mark = (effect: BuffEffect) => {
    if (effect.appliesToAnomaly === true) {
      const targets = (effect.skillTargets ?? [])
        .map((item) => `${item.category}:${item.subcategoryId ?? ''}`)
        .join('|')
      flagged.add(
        `${effect.stat}|${effect.kind}|${effect.scope}|${effect.applyTarget}|${targets || `${effect.skillCategory ?? ''}|${effect.skillSubcategoryId ?? ''}`}`,
      )
    }
  }
  for (const list of allRefineEffects) {
    for (const effect of list ?? []) mark(effect)
  }
  if (allRefineBlocks) {
    for (const blocks of allRefineBlocks) {
      for (const block of blocks ?? []) {
        for (const effect of block.effects ?? []) mark(effect)
      }
    }
  }
  if (!flagged.size) return activeEffects
  return activeEffects.map((effect) => {
    const targets = (effect.skillTargets ?? [])
      .map((item) => `${item.category}:${item.subcategoryId ?? ''}`)
      .join('|')
    const key = `${effect.stat}|${effect.kind}|${effect.scope}|${effect.applyTarget}|${targets || `${effect.skillCategory ?? ''}|${effect.skillSubcategoryId ?? ''}`}`
    if (!flagged.has(key) || effect.appliesToAnomaly === true) return effect
    return { ...effect, appliesToAnomaly: true }
  })
}

function applyAnomalyFlagsToPack<T extends {
  effectBlocks?: { effects?: BuffEffect[] }[] | null
  effects?: BuffEffect[] | null
}>(
  pack: T,
  allRefineEffects: BuffEffect[][],
  allRefineBlocks?: { effects?: BuffEffect[] }[][] | null,
): T {
  if (pack.effectBlocks?.length) {
    return {
      ...pack,
      effectBlocks: pack.effectBlocks.map((block) => ({
        ...block,
        effects: withRefinementAnomalyFlags(
          block.effects ?? [],
          allRefineEffects,
          allRefineBlocks,
        ),
      })),
    } as T
  }
  return {
    ...pack,
    effects: withRefinementAnomalyFlags(
      pack.effects ?? [],
      allRefineEffects,
      allRefineBlocks,
    ),
  } as T
}

export interface DriveDiscSelection {
  twoPieceId: string
  fourPieceId: string
}

export interface BuffSelectionState {
  enabledIds: Record<string, boolean>
  stacksByEffectId: Record<string, number>
  /** 转模：用户手动输入的被转模基础数值 */
  convertInputs: Record<string, number>
}

/** 按角色槽位的 Buff 勾选：全队增益共享，自身增益分槽位 */
export interface MultiSlotBuffSelection {
  team: BuffSelectionState
  bySlot: Record<number, BuffSelectionState>
}

export function createEmptyBuffSelectionState(): BuffSelectionState {
  return { enabledIds: {}, stacksByEffectId: {}, convertInputs: {} }
}

export function createEmptyMultiSlotBuffSelection(): MultiSlotBuffSelection {
  return { team: createEmptyBuffSelectionState(), bySlot: {} }
}

export function ensureSlotSelfBuffSelection(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
): BuffSelectionState {
  if (!multi.bySlot[slotIndex]) {
    multi.bySlot[slotIndex] = createEmptyBuffSelectionState()
  }
  return multi.bySlot[slotIndex]
}

export function isTeamBuffApplyTarget(applyTarget: string | undefined): boolean {
  return applyTarget === 'team'
}

function buffStoreForEffect(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  applyTarget: string | undefined,
): BuffSelectionState {
  return isTeamBuffApplyTarget(applyTarget)
    ? multi.team
    : ensureSlotSelfBuffSelection(multi, slotIndex)
}

/** 合并全队共享与槽位自身勾选，供 computeFinalPanel 使用 */
export function resolveBuffSelectionForSlot(
  multi: MultiSlotBuffSelection | null | undefined,
  slotIndex: number,
): BuffSelectionState | null {
  if (!multi) return null
  const self = multi.bySlot[slotIndex] ?? createEmptyBuffSelectionState()
  return {
    enabledIds: { ...multi.team.enabledIds, ...self.enabledIds },
    stacksByEffectId: { ...multi.team.stacksByEffectId, ...self.stacksByEffectId },
    convertInputs: { ...multi.team.convertInputs, ...self.convertInputs },
  }
}

export function setBuffEffectEnabled(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effectId: string,
  applyTarget: string | undefined,
  enabled: boolean,
): void {
  buffStoreForEffect(multi, slotIndex, applyTarget).enabledIds[effectId] = enabled
}

export function setBuffEffectStacks(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effectId: string,
  applyTarget: string | undefined,
  stacks: number,
): void {
  buffStoreForEffect(multi, slotIndex, applyTarget).stacksByEffectId[effectId] = stacks
}

export function setBuffEffectConvertInput(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effectId: string,
  applyTarget: string | undefined,
  value: number,
): void {
  buffStoreForEffect(multi, slotIndex, applyTarget).convertInputs[effectId] = value
}

export function getBuffEffectEnabled(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effectId: string,
  applyTarget: string | undefined,
  fallback: boolean,
): boolean {
  const store = buffStoreForEffect(multi, slotIndex, applyTarget)
  if (effectId in store.enabledIds) return Boolean(store.enabledIds[effectId])
  return fallback
}

export function getBuffEffectStacks(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effectId: string,
  applyTarget: string | undefined,
  fallback: number,
): number {
  const store = buffStoreForEffect(multi, slotIndex, applyTarget)
  if (effectId in store.stacksByEffectId) return store.stacksByEffectId[effectId]!
  return fallback
}

export function getBuffEffectConvertInput(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effectId: string,
  applyTarget: string | undefined,
): number | undefined {
  const store = buffStoreForEffect(multi, slotIndex, applyTarget)
  if (effectId in store.convertInputs) return store.convertInputs[effectId]
  return undefined
}

/** 将默认勾选合并进多槽位存储（不覆盖已有项） */
export function mergeDefaultBuffSelectionIntoMulti(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effects: CollectedEffect[],
  defaults: BuffSelectionState,
): void {
  const effectById = new Map(effects.map((item) => [item.effect.id, item.effect]))
  const validIds = new Set(effectById.keys())

  for (const store of [multi.team, ...Object.values(multi.bySlot)]) {
    for (const id of Object.keys(store.enabledIds)) {
      if (!validIds.has(id)) delete store.enabledIds[id]
    }
    for (const id of Object.keys(store.stacksByEffectId)) {
      if (!validIds.has(id)) delete store.stacksByEffectId[id]
    }
    for (const id of Object.keys(store.convertInputs)) {
      if (!validIds.has(id)) delete store.convertInputs[id]
    }
  }

  for (const [id, enabled] of Object.entries(defaults.enabledIds)) {
    const effect = effectById.get(id)
    if (!effect) continue
    const store = buffStoreForEffect(multi, slotIndex, effect.applyTarget)
    if (!(id in store.enabledIds)) store.enabledIds[id] = enabled
  }
  for (const [id, stacks] of Object.entries(defaults.stacksByEffectId)) {
    const effect = effectById.get(id)
    if (!effect) continue
    const store = buffStoreForEffect(multi, slotIndex, effect.applyTarget)
    if (!(id in store.stacksByEffectId)) store.stacksByEffectId[id] = stacks
  }
  for (const [id, value] of Object.entries(defaults.convertInputs)) {
    const effect = effectById.get(id)
    if (!effect) continue
    const store = buffStoreForEffect(multi, slotIndex, effect.applyTarget)
    if (!(id in store.convertInputs)) store.convertInputs[id] = value
  }
}

/** 从旧版单槽 Buff 选择迁移（主 C 视角） */
export function migrateLegacyBuffSelection(
  legacy: BuffSelectionState,
  effects: CollectedEffect[],
): MultiSlotBuffSelection {
  const multi = createEmptyMultiSlotBuffSelection()
  const effectById = new Map(effects.map((item) => [item.effect.id, item.effect]))
  for (const [id, enabled] of Object.entries(legacy.enabledIds)) {
    const effect = effectById.get(id)
    buffStoreForEffect(multi, 0, effect?.applyTarget).enabledIds[id] = enabled
  }
  for (const [id, stacks] of Object.entries(legacy.stacksByEffectId)) {
    const effect = effectById.get(id)
    buffStoreForEffect(multi, 0, effect?.applyTarget).stacksByEffectId[id] = stacks
  }
  for (const [id, value] of Object.entries(legacy.convertInputs)) {
    const effect = effectById.get(id)
    buffStoreForEffect(multi, 0, effect?.applyTarget).convertInputs[id] = value
  }
  return multi
}

/** 转模增益角色局外面板：仅录入转模来源属性 */
export type ConvertSlotPanels = Record<string, Partial<Record<CharacterAttrKey, number>>>

export interface ConvertSupportSlot {
  agentId: string
  slotIndex: number
  requiredAttrs: CharacterAttrKey[]
}

type PanelStatAttrKey = Extract<CharacterAttrKey, keyof PanelStats>

const PANEL_STAT_ATTR_KEYS: PanelStatAttrKey[] = [
  'hp',
  'atk',
  'critRate',
  'critDmg',
  'mastery',
  'anomalyControl',
  'energyRegen',
  'penRate',
  'def',
]

export type PanelSourceValues = {
  external?: Partial<Record<CharacterAttrKey, number>>
  final?: Partial<Record<CharacterAttrKey, number>>
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
  skillContext?: SkillCalcContext | null
  buffSelection?: BuffSelectionState | null
  attrValues?: Partial<Record<CharacterAttrKey, number>>
  panelSourceValues?: PanelSourceValues
  /** 主 C 局外面板（按槽位转模时用于主槽位） */
  mainExternalPanel?: PanelStats
  /** 异常产生角色局外面板 */
  anomalySlotPanels?: Record<string, PanelStats>
  /** 转模增益角色局外面板（仅转模来源属性） */
  convertSlotPanels?: ConvertSlotPanels
  /** 各槽位局外/局内转模取值（按 effect 来源槽位解析） */
  panelSourceValuesBySlot?: Map<number, PanelSourceValues>
  /** 异常掌控% 的换算基数；缺省时取结算角色基础面板的初始异常掌控 */
  baseAnomalyControl?: number
  /** 能量回复效率% 的换算基数；缺省时取结算角色基础面板的初始值 */
  baseEnergyRegen?: number
  /** 跳过转模（两阶段结算用） */
  skipConvert?: boolean
}

/** 从增益 sourceKey 解析队伍槽位索引（agent / 音擎 / 驱动盘） */
export function parseSourceKeySlotIndex(sourceKey: string): number | null {
  const match = sourceKey.match(/^(?:agent|wengine|drive-disc)-(\d+)-/)
  if (!match) return null
  const index = Number(match[1])
  return Number.isFinite(index) ? index : null
}

export function convertSlotPartialToExternalPanel(
  partial: Partial<Record<CharacterAttrKey, number>> | undefined,
  fallback?: PanelStats,
): PanelStats {
  const panel = fallback ? { ...fallback } : createDefaultExternalPanel()
  if (!partial) return panel
  for (const key of PANEL_STAT_ATTR_KEYS) {
    const value = partial[key]
    if (value != null && Number.isFinite(value)) {
      panel[key] = value
    }
  }
  return panel
}

export function externalPanelToConvertPartial(
  panel: PanelStats,
  keys: CharacterAttrKey[],
  options?: { level?: number; pierceMod?: number },
): Partial<Record<CharacterAttrKey, number>> {
  const attrs = panelToConvertAttrValues(panel, {
    level: options?.level ?? 60,
    pierceMod: options?.pierceMod ?? 0,
  })
  const result: Partial<Record<CharacterAttrKey, number>> = {}
  for (const key of keys) {
    if (attrs[key] != null) result[key] = attrs[key]!
  }
  return result
}

export function applyConvertPartialToExternalPanel(
  partial: Partial<Record<CharacterAttrKey, number>>,
  target: PanelStats,
) {
  const merged = convertSlotPartialToExternalPanel(partial, target)
  for (const key of PANEL_STAT_ATTR_KEYS) {
    target[key] = merged[key]
  }
}

function resolveExternalPanelForSlot(
  slotIndex: number,
  ctx: PanelCalcContext,
  mainExternalPanel: PanelStats,
): PanelStats {
  if (slotIndex === ctx.mainSlotIndex) {
    return mainExternalPanel
  }
  const agentId = ctx.teamSlots[slotIndex]?.agentId
  if (!agentId) return createDefaultExternalPanel()
  const anomaly = ctx.anomalySlotPanels?.[agentId]
  if (anomaly) return { ...anomaly }
  const convertPartial = ctx.convertSlotPanels?.[agentId]
  if (convertPartial) {
    return convertSlotPartialToExternalPanel(convertPartial)
  }
  return createDefaultExternalPanel()
}

function resolveConvertAttrExtras(
  slotIndex: number,
  ctx: PanelCalcContext,
): Partial<Record<CharacterAttrKey, number>> {
  const agentId = ctx.teamSlots[slotIndex]?.agentId
  const partial = agentId ? ctx.convertSlotPanels?.[agentId] : undefined
  const extras: Partial<Record<CharacterAttrKey, number>> = {
    level: partial?.level ?? ctx.attrValues?.level ?? 60,
    impact: partial?.impact ?? ctx.attrValues?.impact ?? 0,
  }
  if (partial?.pierce != null && Number.isFinite(partial.pierce)) {
    extras.pierce = partial.pierce
  }
  return extras
}

function buildPanelSourceValuesForSlot(
  slotIndex: number,
  ctx: PanelCalcContext,
  mainExternalPanel: PanelStats,
): PanelSourceValues {
  const externalPanel = resolveExternalPanelForSlot(slotIndex, ctx, mainExternalPanel)
  const slotCtx: PanelCalcContext = {
    ...ctx,
    mainSlotIndex: slotIndex,
    mainExternalPanel: externalPanel,
    skipConvert: true,
  }
  const baseAnomalyControl = resolveBaseAnomalyControl(slotCtx)
  const baseEnergyRegen = resolveBaseEnergyRegen(slotCtx)
  const interimMods = collectPanelBuffMods(slotCtx)
  const interimPanel = applyBuffModsToPanel(externalPanel, interimMods, {
    baseAnomalyControl,
    baseEnergyRegen,
  })
  const extras = resolveConvertAttrExtras(slotIndex, ctx)
  return {
    external: panelToConvertAttrValues(externalPanel, { ...extras, pierceMod: 0 }),
    final: panelToConvertAttrValues(interimPanel, {
      ...extras,
      pierceMod: interimMods.pierce,
    }),
  }
}

function buildAllPanelSourceValuesBySlot(
  ctx: PanelCalcContext,
  mainExternalPanel: PanelStats,
): Map<number, PanelSourceValues> {
  const map = new Map<number, PanelSourceValues>()
  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    map.set(index, buildPanelSourceValuesForSlot(index, ctx, mainExternalPanel))
  })
  return map
}

/** 各槽位局外/局内转模取值（供 Buff 展示等 UI 按来源槽位解析） */
export function buildPanelSourceValuesBySlotRecord(
  ctx: PanelCalcContext,
  mainExternalPanel: PanelStats,
): Record<number, PanelSourceValues> {
  return Object.fromEntries(buildAllPanelSourceValuesBySlot(ctx, mainExternalPanel).entries())
}

/** 需录入局外面板的转模增益角色（非主 C、非异常产生角色） */
export function collectConvertSupportSlots(
  ctx: PanelCalcContext,
  options?: { excludeAnomalyAgentIds?: Iterable<string> },
): ConvertSupportSlot[] {
  const mainId = ctx.teamSlots[ctx.mainSlotIndex]?.agentId
  const anomalyIds = new Set(options?.excludeAnomalyAgentIds ?? [])
  const attrByAgent = new Map<string, Set<CharacterAttrKey>>()
  const slotByAgent = new Map<string, number>()

  for (const item of collectAllBuffEffects(ctx)) {
    const effect = item.effect
    if (effect.kind !== 'convert' || !effect.convert) continue
    const source = effect.convert.panelSource ?? 'external'
    if (source === 'manual') continue
    if (!isEffectEnabled(effect, ctx.buffSelection)) continue

    const slotIndex = parseSourceKeySlotIndex(item.sourceKey)
    if (slotIndex == null) continue

    const agentId = ctx.teamSlots[slotIndex]?.agentId
    if (!agentId || agentId === mainId || anomalyIds.has(agentId)) continue

    slotByAgent.set(agentId, slotIndex)
    const set = attrByAgent.get(agentId) ?? new Set<CharacterAttrKey>()
    set.add(effect.convert.from)
    attrByAgent.set(agentId, set)
  }

  return [...attrByAgent.entries()].map(([agentId, attrs]) => ({
    agentId,
    slotIndex: slotByAgent.get(agentId)!,
    requiredAttrs: [...attrs],
  }))
}

/** 异常掌控% 按结算角色（主 C 槽位）的初始异常掌控换算 */
export function resolveBaseAnomalyControl(ctx: PanelCalcContext): number {
  if (ctx.baseAnomalyControl != null && Number.isFinite(ctx.baseAnomalyControl)) {
    return ctx.baseAnomalyControl
  }
  const agentId = ctx.teamSlots[ctx.mainSlotIndex]?.agentId
  if (!agentId) return 0
  return ctx.agents.find((item) => item.id === agentId)?.basePanel.anomalyControl ?? 0
}

/** 能量回复效率% 按结算角色（主 C 槽位）的初始能量回复效率换算 */
export function resolveBaseEnergyRegen(ctx: PanelCalcContext): number {
  if (ctx.baseEnergyRegen != null && Number.isFinite(ctx.baseEnergyRegen)) {
    return ctx.baseEnergyRegen
  }
  const agentId = ctx.teamSlots[ctx.mainSlotIndex]?.agentId
  if (!agentId) return 0
  return ctx.agents.find((item) => item.id === agentId)?.basePanel.energyRegen ?? 0
}

export interface CombatBuffMods {
  vulnerable: number
  globalStaggerVulnerable: number
  staggerVulnerable: number
  staggerVulnerableOnly: number
  special: number
  pierceDmgBonus: number
}

export interface PanelBuffBreakdown {
  totalMods: BuffStatModifiers
  combatMods: CombatBuffMods
  finalPanel: PanelStats
  sources: BuffModSource[]
  collectedEffects: CollectedEffect[]
}

export interface BuffModSource {
  key: string
  label: string
  mods: BuffStatModifiers
  note?: string
  effects?: BuffEffect[]
  blockName?: string
}

export interface CollectedEffect {
  effect: BuffEffect
  sourceKey: string
  sourceLabel: string
  /** 卡片标题用：只要昵称，如「叶瞬光」 */
  providerName: string
  providerAvatar?: string | null
  group: string
  blockId: string
  blockName: string
  /** 块备注 / 影画注释等 */
  blockNote?: string
}

function clampRefine(value: number) {
  return Math.min(5, Math.max(1, Math.round(value)))
}

function defaultSkillContext(
  damageKind: DamageCalcKind = 'direct',
  element?: string,
): SkillCalcContext {
  return {
    damageKind,
    categoryId: 'basic',
    subcategoryId: null,
    element,
  }
}

function resolvePackMods(
  effects: BuffEffect[],
  isMain: boolean,
  ctx: PanelCalcContext,
  slotIndex?: number,
): BuffStatModifiers {
  const skillCtx = ctx.skillContext ?? defaultSkillContext('direct')
  let panelSourceValues = ctx.panelSourceValues
  if (slotIndex != null && ctx.panelSourceValuesBySlot?.has(slotIndex)) {
    panelSourceValues = ctx.panelSourceValuesBySlot.get(slotIndex)
  }
  return resolveEffectsToMods(effects, {
    applyTargets: isMain ? ['self', 'team'] : ['team'],
    ctx: skillCtx,
    element: skillCtx.element,
    stacksByEffectId: ctx.buffSelection?.stacksByEffectId,
    convertInputs: ctx.buffSelection?.convertInputs,
    attrValues: ctx.attrValues,
    panelSourceValues,
    skipConvert: ctx.skipConvert,
    selection: ctx.buffSelection,
  })
}

export function collectSlotDriveDiscEffects(
  driveDiscs: DriveDiscBuffDoc[],
  selection: DriveDiscSelection,
  isMain: boolean,
  _options?: { includeTwoPiece?: boolean },
): BuffEffect[] {
  const effects: BuffEffect[] = []

  const fourDisc =
    selection.fourPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.fourPieceId)
      : undefined
  const twoDisc =
    selection.twoPieceId !== 'none'
      ? driveDiscs.find((item) => item.id === selection.twoPieceId)
      : undefined

  function pushTwoPiece(disc: DriveDiscBuffDoc) {
    for (const entry of collectTwoPieceBlockEntries(disc)) {
      // 2 件套默认不参与面板 Buff 结算，需用户自行勾选；词条/最优仍走 twoPieceMods
      effects.push(
        ...entry.effects.map((effect) => ({
          ...effect,
          enabledDefault: false,
        })),
      )
    }
  }

  if (isMain) {
    // 主 C：4 件套含其 2 件效果；另选的 2 件套也计入
    if (fourDisc) {
      pushTwoPiece(fourDisc)
      effects.push(...collectEffectsFromPack(fourDisc.fourPieceBuffs))
    }
    if (twoDisc && twoDisc.id !== fourDisc?.id) {
      pushTwoPiece(twoDisc)
    }
    return effects
  }

  if (fourDisc) {
    effects.push(
      ...collectEffectsFromPack(fourDisc.fourPieceBuffs).filter((e) => e.applyTarget === 'team'),
    )
  }
  return effects
}

export function collectSlotDriveDiscMods(
  driveDiscs: DriveDiscBuffDoc[],
  selection: DriveDiscSelection,
  isMain: boolean,
  options?: { includeTwoPiece?: boolean },
  ctx?: PanelCalcContext,
): BuffStatModifiers {
  const effects = collectSlotDriveDiscEffects(driveDiscs, selection, isMain, options)
  if (!ctx) {
    return resolveEffectsToMods(effects, {
      applyTargets: isMain ? ['self', 'team'] : ['team'],
      ctx: defaultSkillContext('direct'),
    })
  }
  return resolvePackMods(effects, isMain, ctx)
}

export function collectTeamDriveDiscMods(
  driveDiscs: DriveDiscBuffDoc[],
  teamSlots: TeamSlot[],
  mainIndex: number,
  ctx?: PanelCalcContext,
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
        undefined,
        ctx,
      ),
    )
  })

  return total
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

export function collectAllBuffEffects(ctx: PanelCalcContext): CollectedEffect[] {
  const collected: CollectedEffect[] = []
  const mainIndex = ctx.mainSlotIndex

  function pushPack(
    pack: Parameters<typeof collectBlockEntriesFromPack>[0],
    sourceKey: string,
    sourceLabel: string,
    providerName: string,
    providerAvatar: string | null | undefined,
    groupFor: (effect: BuffEffect) => string,
    matchesTarget: (e: BuffEffect) => boolean,
    extraNote = '',
  ) {
    for (const entry of collectBlockEntriesFromPack(pack)) {
      const effects = entry.effects.filter(matchesTarget)
      for (const effect of effects) {
        const instanced = cloneEffectInstance(effect, sourceKey, entry.blockId)
        collected.push({
          effect: instanced,
          sourceKey,
          sourceLabel,
          providerName,
          providerAvatar: providerAvatar ?? null,
          group: groupFor(effect),
          blockId: entry.blockId,
          blockName: entry.blockName,
          blockNote: [extraNote, entry.blockNote].filter((part) => part.trim()).join('\n'),
        })
      }
    }
  }

  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    const agent = ctx.agents.find((item) => item.id === slot.agentId)
    if (!agent) return

    const isMain = index === mainIndex
    const roleLabel = isMain ? '主C' : '辅助'
    const matchesTarget = (e: BuffEffect) =>
      isMain ? e.applyTarget === 'self' || e.applyTarget === 'team' : e.applyTarget === 'team'
    const clampedRank = Math.min(6, Math.max(0, Math.round(slot.rank)))

    for (let rank = 0; rank <= clampedRank; rank++) {
      const rankBuffs = agent.mindscapeBuffs[rank] ?? createEmptySelfTeamBuffs()
      const mindscapeNote = getMindscapeNote(agent, rank)
      pushPack(
        rankBuffs,
        `agent-${index}-${rank}`,
        `${roleLabel} · ${agent.name} · ${rank}影`,
        agent.name,
        agent.avatar_image,
        (effect) =>
          isMain
            ? effect.applyTarget === 'team'
              ? '全队（含自身）'
              : '自身'
            : '队友',
        matchesTarget,
        mindscapeNote,
      )
    }

    if (slot.wengineId !== 'none') {
      const wengine = ctx.wengines.find((item) => item.id === slot.wengineId)
      // 异职音擎：仅基础属性（baseAtk / advancedStats）生效，不收集增益
      if (wengine && isWengineProfessionMatch(agent.profession, wengine.profession)) {
        const refineIndex = clampRefine(slot.wengineRefine) - 1
        const refineBuffsRaw = wengine.refinementBuffs[refineIndex] ?? createEmptySelfTeamBuffs()
        const allRefineEffects = wengine.refinementBuffs.map((rank) => rank.effects ?? [])
        const allRefineBlocks = wengine.refinementBuffs.map((rank) => rank.effectBlocks ?? [])
        const refineBuffs = applyAnomalyFlagsToPack(
          refineBuffsRaw,
          allRefineEffects,
          allRefineBlocks,
        )
        const sourceLabel = `${roleLabel} · ${agent.name} · 音擎 · ${wengine.name}（精${slot.wengineRefine}）`
        const groupFor = (effect: BuffEffect) =>
          isMain
            ? effect.applyTarget === 'team'
              ? '全队音擎'
              : '自身音擎'
            : '队友音擎'
        pushPack(
          wengine.fixedBuffs,
          `wengine-${index}-fixed`,
          sourceLabel,
          wengine.name,
          wengine.avatar_image,
          groupFor,
          matchesTarget,
        )
        pushPack(
          refineBuffs,
          `wengine-${index}-refine`,
          sourceLabel,
          wengine.name,
          wengine.avatar_image,
          groupFor,
          matchesTarget,
        )
      }
    }

    const selection = {
      twoPieceId: slot.twoPieceDriveDiscId,
      fourPieceId: slot.fourPieceDriveDiscId,
    }
    const fourDisc =
      selection.fourPieceId !== 'none'
        ? ctx.driveDiscs.find((item) => item.id === selection.fourPieceId)
        : undefined
    const twoDisc =
      selection.twoPieceId !== 'none'
        ? ctx.driveDiscs.find((item) => item.id === selection.twoPieceId)
        : undefined
    const group = isMain ? '自身驱动盘' : '队友驱动盘'
    const sourceKey = `drive-disc-${index}`

    if (isMain && fourDisc) {
      const twoKey = `${sourceKey}-4set-2pc`
      for (const entry of collectTwoPieceBlockEntries(fourDisc)) {
        for (const effect of entry.effects.filter(matchesTarget)) {
          collected.push({
            effect: {
              ...cloneEffectInstance(effect, twoKey, entry.blockId),
              enabledDefault: false,
            },
            sourceKey: twoKey,
            sourceLabel: `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（2件）`,
            providerName: fourDisc.name,
            providerAvatar: fourDisc.avatar_image,
            group,
            blockId: entry.blockId,
            blockName: entry.blockName,
            blockNote: [fourDisc.twoPieceNote?.trim() || '', entry.blockNote]
              .filter(Boolean)
              .join('\n'),
          })
        }
      }
      const fourKey = `${sourceKey}-4set`
      for (const entry of collectBlockEntriesFromPack(fourDisc.fourPieceBuffs)) {
        for (const effect of entry.effects.filter(matchesTarget)) {
          collected.push({
            effect: cloneEffectInstance(effect, fourKey, entry.blockId),
            sourceKey: fourKey,
            sourceLabel: `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（4件）`,
            providerName: fourDisc.name,
            providerAvatar: fourDisc.avatar_image,
            group,
            blockId: entry.blockId,
            blockName: entry.blockName,
            blockNote: [fourDisc.fourPieceNote?.trim() || '', entry.blockNote]
              .filter(Boolean)
              .join('\n'),
          })
        }
      }
    }
    if (isMain && twoDisc && twoDisc.id !== fourDisc?.id) {
      const twoKey = `${sourceKey}-2set`
      for (const entry of collectTwoPieceBlockEntries(twoDisc)) {
        for (const effect of entry.effects.filter(matchesTarget)) {
          collected.push({
            effect: {
              ...cloneEffectInstance(effect, twoKey, entry.blockId),
              enabledDefault: false,
            },
            sourceKey: twoKey,
            sourceLabel: `${roleLabel} · ${agent.name} · 驱动盘 · ${twoDisc.name}（2件）`,
            providerName: twoDisc.name,
            providerAvatar: twoDisc.avatar_image,
            group,
            blockId: entry.blockId,
            blockName: entry.blockName,
            blockNote: [twoDisc.twoPieceNote?.trim() || '', entry.blockNote]
              .filter(Boolean)
              .join('\n'),
          })
        }
      }
    }
    if (!isMain && fourDisc) {
      const fourKey = `${sourceKey}-4set`
      for (const entry of collectBlockEntriesFromPack(fourDisc.fourPieceBuffs)) {
        for (const effect of entry.effects.filter(matchesTarget)) {
          collected.push({
            effect: cloneEffectInstance(effect, fourKey, entry.blockId),
            sourceKey: fourKey,
            sourceLabel: `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（4件）`,
            providerName: fourDisc.name,
            providerAvatar: fourDisc.avatar_image,
            group,
            blockId: entry.blockId,
            blockName: entry.blockName,
            blockNote: [fourDisc.fourPieceNote?.trim() || '', entry.blockNote]
              .filter(Boolean)
              .join('\n'),
          })
        }
      }
    }
  })

  if (ctx.bangboo?.id && ctx.bangboo.id !== 'none') {
    const refineIndex = clampRefine(ctx.bangbooRefine) - 1
    const fixedPack = {
      effectBlocks: ctx.bangboo.effectBlocks?.length
        ? ctx.bangboo.effectBlocks
        : undefined,
      effects: ctx.bangboo.effects ?? [],
    }
    const refineBlocks = ctx.bangboo.refinementEffectBlocks?.[refineIndex]
    const refinePack = applyAnomalyFlagsToPack(
      {
        effectBlocks: refineBlocks?.length ? refineBlocks : undefined,
        effects: ctx.bangboo.refinementEffects?.[refineIndex] ?? [],
      },
      ctx.bangboo.refinementEffects ?? [],
      ctx.bangboo.refinementEffectBlocks,
    )
    pushPack(
      fixedPack,
      'bangboo-fixed',
      `邦布 · ${ctx.bangboo.name}（精${ctx.bangbooRefine}）`,
      ctx.bangboo.name,
      ctx.bangboo.avatar_image,
      () => '邦布',
      () => true,
    )
    pushPack(
      refinePack,
      'bangboo-refine',
      `邦布 · ${ctx.bangboo.name}（精${ctx.bangbooRefine}）`,
      ctx.bangboo.name,
      ctx.bangboo.avatar_image,
      () => '邦布',
      () => true,
    )
  }

  return collected
}

export function collectPanelBuffModSources(ctx: PanelCalcContext): BuffModSource[] {
  const sources: BuffModSource[] = []
  const mainIndex = ctx.mainSlotIndex
  const skillCtx = ctx.skillContext ?? defaultSkillContext('direct')

  ctx.teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return

    const agent = ctx.agents.find((item) => item.id === slot.agentId)
    if (!agent) return

    const isMain = index === mainIndex
    const roleLabel = isMain ? '主C' : '辅助'
    const matchesTarget = (e: BuffEffect) =>
      isMain ? e.applyTarget === 'self' || e.applyTarget === 'team' : e.applyTarget === 'team'
    const clampedRank = Math.min(6, Math.max(0, Math.round(slot.rank)))

    for (let rank = 0; rank <= clampedRank; rank++) {
      const rankBuffs = agent.mindscapeBuffs[rank] ?? createEmptySelfTeamBuffs()
      const note = getMindscapeNote(agent, rank)
      const blockEntries = collectBlockEntriesFromPack(rankBuffs)
      if (!blockEntries.length && note) {
        sources.push({
          key: `agent-${index}-${rank}`,
          label: `${roleLabel} · ${agent.name} · ${rank}影`,
          mods: createEmptyBuffStatModifiers(),
          note: note || undefined,
          effects: [],
        })
        continue
      }
      blockEntries.forEach((entry, blockIndex) => {
        const sourceKey = `agent-${index}-${rank}`
        const effects = entry.effects
          .filter(matchesTarget)
          .map((effect) => cloneEffectInstance(effect, sourceKey, entry.blockId))
        const mindscapeMods = resolvePackMods(effects, isMain, {
          ...ctx,
          skillContext: skillCtx,
        }, index)
        if (!hasNonZeroBuffMods(mindscapeMods) && !note && !effects.length) return
        sources.push({
          key: `agent-${index}-${rank}-${entry.blockId}`,
          label: `${roleLabel} · ${agent.name} · ${rank}影`,
          mods: mindscapeMods,
          note: blockIndex === 0 ? note || undefined : undefined,
          effects,
          blockName: entry.blockName,
        })
      })
    }

    if (slot.wengineId !== 'none') {
      const wengine = ctx.wengines.find((item) => item.id === slot.wengineId)
      if (wengine && isWengineProfessionMatch(agent.profession, wengine.profession)) {
        const refineIndex = clampRefine(slot.wengineRefine) - 1
        const refineBuffsRaw = wengine.refinementBuffs[refineIndex] ?? createEmptySelfTeamBuffs()
        const allRefineEffects = wengine.refinementBuffs.map((rank) => rank.effects ?? [])
        const allRefineBlocks = wengine.refinementBuffs.map((rank) => rank.effectBlocks ?? [])
        const refineBuffs = applyAnomalyFlagsToPack(
          refineBuffsRaw,
          allRefineEffects,
          allRefineBlocks,
        )
        const packs = [
          { key: 'fixed', pack: wengine.fixedBuffs },
          { key: 'refine', pack: refineBuffs },
        ]
        for (const item of packs) {
          const sourceKey = `wengine-${index}-${item.key}`
          for (const entry of collectBlockEntriesFromPack(item.pack)) {
            const effects = entry.effects
              .filter(matchesTarget)
              .map((effect) => cloneEffectInstance(effect, sourceKey, entry.blockId))
            const wengineMods = resolvePackMods(effects, isMain, {
              ...ctx,
              skillContext: skillCtx,
            }, index)
            if (!hasNonZeroBuffMods(wengineMods) && !effects.length) continue
            sources.push({
              key: `wengine-${index}-${item.key}-${entry.blockId}`,
              label: `${roleLabel} · ${agent.name} · 音擎 · ${wengine.name}（精${slot.wengineRefine}）`,
              mods: wengineMods,
              effects,
              blockName: entry.blockName,
            })
          }
        }
      }
    }

    // 驱动盘：与 collectAllBuffEffects 相同拆分，避免与影画/其他来源串 id
    {
      const selection = {
        twoPieceId: slot.twoPieceDriveDiscId,
        fourPieceId: slot.fourPieceDriveDiscId,
      }
      const fourDisc =
        selection.fourPieceId !== 'none'
          ? ctx.driveDiscs.find((item) => item.id === selection.fourPieceId)
          : undefined
      const twoDisc =
        selection.twoPieceId !== 'none'
          ? ctx.driveDiscs.find((item) => item.id === selection.twoPieceId)
          : undefined
      const baseKey = `drive-disc-${index}`

      const pushDiscSource = (
        key: string,
        label: string,
        blockId: string,
        blockName: string,
        rawEffects: BuffEffect[],
      ) => {
        const effects = rawEffects
          .filter(matchesTarget)
          .map((effect) => cloneEffectInstance(effect, key, blockId))
        const mods = resolvePackMods(effects, isMain, {
          ...ctx,
          skillContext: skillCtx,
        }, index)
        if (!hasNonZeroBuffMods(mods) && !effects.length) return
        sources.push({
          key: `${key}-${blockId}`,
          label,
          mods,
          effects,
          blockName,
        })
      }

      if (isMain && fourDisc) {
        for (const entry of collectTwoPieceBlockEntries(fourDisc)) {
          pushDiscSource(
            `${baseKey}-4set-2pc`,
            `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（2件）`,
            entry.blockId,
            entry.blockName,
            entry.effects.map((effect) => ({ ...effect, enabledDefault: false })),
          )
        }
        for (const entry of collectBlockEntriesFromPack(fourDisc.fourPieceBuffs)) {
          pushDiscSource(
            `${baseKey}-4set`,
            `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（4件）`,
            entry.blockId,
            entry.blockName,
            entry.effects,
          )
        }
      }
      if (isMain && twoDisc && twoDisc.id !== fourDisc?.id) {
        for (const entry of collectTwoPieceBlockEntries(twoDisc)) {
          pushDiscSource(
            `${baseKey}-2set`,
            `${roleLabel} · ${agent.name} · 驱动盘 · ${twoDisc.name}（2件）`,
            entry.blockId,
            entry.blockName,
            entry.effects.map((effect) => ({ ...effect, enabledDefault: false })),
          )
        }
      }
      if (!isMain && fourDisc) {
        for (const entry of collectBlockEntriesFromPack(fourDisc.fourPieceBuffs)) {
          pushDiscSource(
            `${baseKey}-4set`,
            `${roleLabel} · ${agent.name} · 驱动盘 · ${fourDisc.name}（4件）`,
            entry.blockId,
            entry.blockName,
            entry.effects,
          )
        }
      }
    }
  })

  if (ctx.bangboo?.id && ctx.bangboo.id !== 'none') {
    const refineIndex = clampRefine(ctx.bangbooRefine) - 1
    const fixedEffects = ctx.bangboo.effectBlocks?.length
      ? flattenBlocks(ctx.bangboo.effectBlocks)
      : (ctx.bangboo.effects ?? [])
    const refineEffects = withRefinementAnomalyFlags(
      ctx.bangboo.refinementEffectBlocks?.[refineIndex]?.length
        ? flattenBlocks(ctx.bangboo.refinementEffectBlocks[refineIndex]!)
        : (ctx.bangboo.refinementEffects?.[refineIndex] ?? []),
      ctx.bangboo.refinementEffects ?? [],
      ctx.bangboo.refinementEffectBlocks,
    )
    const effects = [...fixedEffects, ...refineEffects].map((effect) =>
      cloneEffectInstance(effect, 'bangboo', 'bangboo'),
    )
    const bangbooMods = resolveEffectsToMods(effects, {
      ctx: skillCtx,
      stacksByEffectId: ctx.buffSelection?.stacksByEffectId,
      convertInputs: ctx.buffSelection?.convertInputs,
      attrValues: ctx.attrValues,
      panelSourceValues:
        ctx.panelSourceValuesBySlot?.get(ctx.mainSlotIndex) ?? ctx.panelSourceValues,
      skipConvert: ctx.skipConvert,
      selection: ctx.buffSelection,
    })
    const refineBlockName =
      ctx.bangboo.refinementEffectBlocks?.[refineIndex]?.[0]?.name?.trim() ||
      `精${ctx.bangbooRefine}`
    sources.push({
      key: 'bangboo',
      label: `邦布 · ${ctx.bangboo.name}（精${ctx.bangbooRefine}）`,
      mods: bangbooMods,
      effects,
      blockName: refineBlockName,
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
  const sources = collectPanelBuffModSources(ctx)
  for (const source of sources) {
    total = mergeBuffStatModifiers(total, source.mods)
  }
  return total
}

export function applyBuffModsToPanel(
  externalPanel: PanelStats,
  mods: BuffStatModifiers,
  options?: { baseAnomalyControl?: number; baseEnergyRegen?: number },
): PanelStats {
  const baseAnomalyControl = options?.baseAnomalyControl ?? 0
  const baseEnergyRegen = options?.baseEnergyRegen ?? 0
  return {
    hp: externalPanel.hp * (1 + mods.inCombatHpPercent / 100) + mods.hp,
    atk: externalPanel.atk * (1 + mods.inCombatAtkPercent / 100) + mods.atk,
    def: externalPanel.def * (1 + mods.inCombatDefPercent / 100) + mods.def,
    critRate: externalPanel.critRate + mods.critRate,
    critDmg: externalPanel.critDmg + mods.critDmg,
    dmgBonus: externalPanel.dmgBonus + mods.dmgBonus + mods.skillDmgBonus,
    ignoreDefense: externalPanel.ignoreDefense,
    reduceDefense: externalPanel.reduceDefense + mods.reduceDefense,
    penRate: externalPanel.penRate + mods.penRate,
    pen: externalPanel.pen,
    resPen: externalPanel.resPen + mods.resPen,
    mastery: externalPanel.mastery + mods.mastery,
    anomalyControl:
      externalPanel.anomalyControl +
      mods.anomalyControl +
      (baseAnomalyControl * mods.anomalyControlPercent) / 100,
    energyRegen:
      externalPanel.energyRegen +
      (baseEnergyRegen * mods.energyRegen) / 100 +
      mods.energyRegenFlat,
    anomalyCritRate: externalPanel.anomalyCritRate + mods.anomalyCritRate,
    anomalyCritDmg: externalPanel.anomalyCritDmg + mods.anomalyCritDmg,
    anomalyDmgBonus: externalPanel.anomalyDmgBonus + mods.anomalyDmgBonus,
    anomalyReleaseCritRate:
      externalPanel.anomalyReleaseCritRate + mods.anomalyReleaseCritRate,
    anomalyReleaseCritDmg:
      externalPanel.anomalyReleaseCritDmg + mods.anomalyReleaseCritDmg,
    anomalyReleaseMult: externalPanel.anomalyReleaseMult + mods.anomalyReleaseMult,
    anomalyReleaseDmgBonus:
      externalPanel.anomalyReleaseDmgBonus + mods.anomalyReleaseDmgBonus,
    directDmgMult:
      externalPanel.directDmgMult + mods.directDmgMult + mods.skillMultiplierBonus,
    settlementDmgMult: mods.settlementDmgMult,
    anomalyMult: externalPanel.anomalyMult + mods.anomalyMult,
    disorderBaseMult: externalPanel.disorderBaseMult + mods.disorderBaseMult,
    anomalyDuration: externalPanel.anomalyDuration + mods.anomalyDuration,
    disorderCompMult: externalPanel.disorderCompMult + mods.disorderCompMult,
    turbulenceBaseMult: externalPanel.turbulenceBaseMult + mods.turbulenceBaseMult,
    turbulenceCompMult: externalPanel.turbulenceCompMult + mods.turbulenceCompMult,
    disorderDmgBonus: externalPanel.disorderDmgBonus + mods.disorderDmgBonus,
    turbulenceDmgBonus: externalPanel.turbulenceDmgBonus + mods.turbulenceDmgBonus,
    directDmgMultFactor: combineMultFactorPercent(
      externalPanel.directDmgMultFactor,
      mods.directDmgMultFactor,
    ),
    anomalyMultFactor: combineMultFactorPercent(
      externalPanel.anomalyMultFactor,
      mods.anomalyMultFactor,
    ),
    anomalyReleaseMultFactor: combineMultFactorPercent(
      externalPanel.anomalyReleaseMultFactor,
      mods.anomalyReleaseMultFactor,
    ),
    disorderBaseMultFactor: combineMultFactorPercent(
      externalPanel.disorderBaseMultFactor,
      mods.disorderBaseMultFactor,
    ),
    turbulenceBaseMultFactor: combineMultFactorPercent(
      externalPanel.turbulenceBaseMultFactor,
      mods.turbulenceBaseMultFactor,
    ),
  }
}

export function computePiercePower(hp: number, atk: number, pierceMod = 0) {
  return Math.round((0.1 * hp + 0.3 * atk + pierceMod) * 100) / 100
}

export function panelToConvertAttrValues(
  panel: PanelStats,
  options?: Partial<Record<CharacterAttrKey, number>> & { pierceMod?: number },
): Partial<Record<CharacterAttrKey, number>> {
  const pierceMod = options?.pierceMod ?? 0
  const { pierceMod: _pierceMod, ...extras } = options ?? {}
  return {
    hp: panel.hp,
    atk: panel.atk,
    critRate: panel.critRate,
    critDmg: panel.critDmg,
    mastery: panel.mastery,
    anomalyControl: panel.anomalyControl,
    energyRegen: panel.energyRegen,
    penRate: panel.penRate,
    def: panel.def,
    pierce: computePiercePower(panel.hp, panel.atk, pierceMod),
    impact: extras.impact ?? 0,
    level: extras.level ?? 60,
    ...extras,
  }
}

export function extractCombatMods(mods: BuffStatModifiers): CombatBuffMods {
  return {
    vulnerable: mods.vulnerable,
    globalStaggerVulnerable: mods.globalStaggerVulnerable,
    staggerVulnerable: mods.staggerVulnerable,
    staggerVulnerableOnly: mods.staggerVulnerableOnly,
    special: mods.special,
    pierceDmgBonus: mods.pierceDmgBonus,
  }
}

/**
 * 主 C 异放倍率：局外基础 + 增益；仅异放倍率类增益按产生角色属性（elementFilter）筛选。
 */
const RELEASE_MULT_STATS = new Set<BuffStatKey>([
  'anomalyReleaseMult',
  'anomalyReleaseMultFactor',
])

function effectMatchesReleaseMultElement(effect: BuffEffect, triggerElement?: string): boolean {
  const filter = effect.elementFilter
  if (!filter || filter === 'all') return true
  if (!triggerElement) return false
  return filter.includes(triggerElement)
}

export function resolveMainCAnomalyReleaseMultFields(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  triggerElement?: string,
): Pick<PanelStats, 'anomalyReleaseMult' | 'anomalyReleaseMultFactor'> {
  const skillCtx: SkillCalcContext = {
    ...(ctx.skillContext ?? defaultSkillContext('anomaly', triggerElement)),
    damageKind: 'anomaly',
    anomalySubKind: 'anomalyRelease',
    element: triggerElement,
  }

  const collected = collectAllBuffEffects({ ...ctx, skillContext: skillCtx })
  const releaseMultEffects: BuffEffect[] = []
  for (const item of collected) {
    const effect = item.effect
    if (!RELEASE_MULT_STATS.has(effect.stat)) continue
    if (!isEffectEnabled(effect, ctx.buffSelection)) continue
    if (!effectMatchesContext(effect, skillCtx)) continue
    if (!effectMatchesReleaseMultElement(effect, triggerElement)) continue
    if (!effectMatchesElement(effect, triggerElement)) continue
    releaseMultEffects.push(effect)
  }

  const mods = resolveEffectsToMods(releaseMultEffects, {
    ctx: skillCtx,
    element: triggerElement,
    stacksByEffectId: ctx.buffSelection?.stacksByEffectId,
    convertInputs: ctx.buffSelection?.convertInputs,
    attrValues: ctx.attrValues,
    panelSourceValues: ctx.panelSourceValues,
    selection: ctx.buffSelection,
  })

  return {
    anomalyReleaseMult: externalPanel.anomalyReleaseMult + mods.anomalyReleaseMult,
    anomalyReleaseMultFactor: combineMultFactorPercent(
      externalPanel.anomalyReleaseMultFactor,
      mods.anomalyReleaseMultFactor,
    ),
  }
}

export function computeFinalPanel(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
): PanelBuffBreakdown {
  const panelSourceValuesBySlot = buildAllPanelSourceValuesBySlot(ctx, externalPanel)
  const mainPanelSources = panelSourceValuesBySlot.get(ctx.mainSlotIndex)

  // 先叠非转模，再用局外/局内面板实时折算转模，避免环依赖
  const baseCtx: PanelCalcContext = {
    ...ctx,
    mainExternalPanel: externalPanel,
    panelSourceValuesBySlot,
    panelSourceValues: mainPanelSources,
    skipConvert: true,
  }
  const baseAnomalyControl = resolveBaseAnomalyControl(baseCtx)
  const baseEnergyRegen = resolveBaseEnergyRegen(baseCtx)
  const interimMods = collectPanelBuffMods(baseCtx)
  const interimPanel = applyBuffModsToPanel(externalPanel, interimMods, {
    baseAnomalyControl,
    baseEnergyRegen,
  })
  const mainExtras = resolveConvertAttrExtras(ctx.mainSlotIndex, ctx)
  const externalAttrs = panelToConvertAttrValues(externalPanel, {
    ...mainExtras,
    pierceMod: 0,
  })
  const finalAttrs = panelToConvertAttrValues(interimPanel, {
    ...mainExtras,
    pierceMod: interimMods.pierce,
  })
  const attrValues = {
    ...externalAttrs,
    ...ctx.attrValues,
  }
  const fullCtx: PanelCalcContext = {
    ...baseCtx,
    skipConvert: false,
    attrValues,
    panelSourceValues: {
      external: externalAttrs,
      final: finalAttrs,
    },
  }
  const totalMods = collectPanelBuffMods(fullCtx)
  return {
    totalMods,
    combatMods: extractCombatMods(totalMods),
    finalPanel: applyBuffModsToPanel(externalPanel, totalMods, {
      baseAnomalyControl,
      baseEnergyRegen,
    }),
    sources: collectPanelBuffModSources(fullCtx),
    collectedEffects: collectAllBuffEffects(fullCtx),
  }
}

export function buildDefaultBuffSelection(
  collected: CollectedEffect[],
  attrValues?: Partial<Record<CharacterAttrKey, number>>,
): BuffSelectionState {
  const enabledIds: Record<string, boolean> = {}
  const stacksByEffectId: Record<string, number> = {}
  const convertInputs: Record<string, number> = {}
  for (const item of collected) {
    enabledIds[item.effect.id] = isEffectEnabled(item.effect, { enabledIds: {} })
    if (item.effect.kind === 'stacked' || item.effect.stackable) {
      stacksByEffectId[item.effect.id] = item.effect.defaultStacks ?? 1
    }
    // 自行设置：仅预填默认值；局外/局内转模运行时读面板，不写入 convertInputs
    if (item.effect.kind === 'convert' && item.effect.convert) {
      const source = item.effect.convert.panelSource ?? 'external'
      const configured = item.effect.convert.defaultBase
      if (source === 'manual') {
        convertInputs[item.effect.id] =
          configured != null && Number.isFinite(configured) ? configured : 0
      }
    }
  }
  void attrValues
  return { enabledIds, stacksByEffectId, convertInputs }
}

export type { SkillCategoryId }

