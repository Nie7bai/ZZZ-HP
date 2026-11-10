import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import { toRaw } from 'vue'
import {
  isSkillConvertFromKey,
  type SkillTalentLevels,
} from '@/utils/skillTalentLevels'
import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  BuffEffect,
  BuffStatKey,
  BuffStatModifiers,
  CharacterAttrKey,
  CustomBuffStatKey,
  DamageCalcKind,
  DriveDiscBuffDoc,
  SkillCalcContext,
  SkillCategoryId,
  WengineBuffDoc,
} from '@/types/calculator'
import type { FlowBuffOverride } from '@/types/damageCalcHistory'
// 只作类型导入：记录里的「实际采用」要按真实字段/结果键描述（Spec §3.3）
import type { DamageCalcInput, DamageCalcResult } from '@/utils/damageCalc'
import type { DamageZoneId } from '@/utils/damageZoneSourcePolicy'
import type { PanelViewPolicyId } from '@/utils/panelViewPolicy'
import type { RemielSelfRadianceCalcInput } from '@/utils/remielUtils'
import { damageTypesOf } from '@/utils/buffDamageTypes'
import {
  createEmptyExternalPanel,
  createDefaultExternalPanel,
  fillPanelStatsDefaults,
  type PanelStats,
} from '@/types/calculatorPanel'
import { combineMultFactorPercent } from '@/utils/multFactorPercent'
import {
  cloneEffectInstance,
  collectBlockEntriesFromPack,
  collectEffectsFromPack,
  countTeamProfession,
  effectMatchesTeamProfessionGate,
  expandBuffOverrideToEffectIds,
  flatModsToEffects,
  isEffectEnabled,
  resolveBuffEffectParameters,
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
import type { EnvironmentBuffEntry } from '@/utils/environmentBuffCalc'
import { resolveAssetUrl } from '@/utils/gameData'
import {
  extraGainToEffects,
  resolveExtraGainApplySlot,
} from '@/utils/extraBuffCalc'
import type { ExtraBuffGain, ExtraBuffSlotIndex } from '@/types/extraBuff'
import {
  effectInstanceToBuffEffect,
  instantiateBuffEffect,
} from '@/utils/effectAdapters'

/** 局内 Buff 选择：模块注释与效果块注释相同（或空白）时只保留一条 */
function mergeBuffDisplayNotes(...parts: Array<string | null | undefined>): string {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const part of parts) {
    const trimmed = typeof part === 'string' ? part.trim() : ''
    if (!trimmed) continue
    const key = trimmed.replace(/\s+/g, '\n')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(trimmed)
  }
  return unique.join('\n')
}

/** 危局 / Boss 场地 / 防线 / 临界 Buff 分组 */
export const ENVIRONMENT_BUFF_GROUPS = new Set([
  '危局 Buff',
  'Boss 场地 Buff',
  '防线 Buff',
  '临界 Buff',
])

/**
 * 增益弹窗顶部「分类」tab 的顺序（**唯一事实来源**：局内增益选择器与本行增益例外弹窗共用）。
 *
 * 只列 `CollectedEffect.group` 里出现过的（`全部` 恒在）；表里没有的分组
 * （如「额外 Buff」）不单开 tab，仍能从「全部」看到。
 */
export const BUFF_GROUP_TABS = [
  '全部',
  '自身',
  '自身音擎',
  '自身驱动盘',
  '全队（含自身）',
  '全队音擎',
  '队友',
  '队友音擎',
  '队友驱动盘',
  '邦布',
  '危局 Buff',
  'Boss 场地 Buff',
  '防线 Buff',
  '临界 Buff',
] as const

/** 当前面板/勾选里实际存在的分类 tab（`全部` 恒在，顺序照 `BUFF_GROUP_TABS`） */
export function availableBuffGroupTabs(
  groups: Iterable<string | null | undefined>,
  forceGroups?: Iterable<string> | null,
): string[] {
  const set = new Set<string>()
  for (const group of groups) if (group) set.add(group)
  for (const group of forceGroups ?? []) if (group) set.add(group)
  return BUFF_GROUP_TABS.filter((tab) => tab === '全部' || set.has(tab))
}

/**
 * 转模解析输入：某槽位的属性默认值 + 局外/局内面板取值 + 全槽位取值表。
 * 局内增益选择器与本行增益例外弹窗共用这一份形状（页面按槽位现给，见 `SkillBuffOverrideModal`）。
 */
export interface ConvertResolveInputs {
  contextKind: 'global' | 'group' | 'event' | 'unavailable'
  effectAmounts?: Record<string, number>
  /**
   * 逐效果投影（计算链路收敛 Spec §2.2 第 2 项 / §3.5）：按 effect id 给出
   * 实际采用状态与受益者。`effectAmounts` 只是它的兼容投影，不能再被当成唯一事实。
   */
  effectSummaries?: Record<string, EventEffectSummary>
  /**
   * 配置参数（Spec §5.1）：全局选择器 / 组配置 / 不可结算事件的**待选配置**，
   * 与实际贡献分离，不进入 `effectAmounts`，不参与结算。
   */
  configurationParameters: Record<string, ResolvedEffectParameters>
  configurationOnly?: boolean
  attrDefaults: Partial<Record<CharacterAttrKey, number>>
  panelSourceValues?: PanelSourceValues
  panelSourceValuesBySlot?: Record<number, PanelSourceValues>
}

export function isEnvironmentBuffGroup(group: string) {
  return ENVIRONMENT_BUFF_GROUPS.has(group)
}

export function isEnvironmentBuffSourceKey(sourceKey: string) {
  return (
    sourceKey.startsWith('crisis-buff-') ||
    sourceKey.startsWith('boss-field-') ||
    sourceKey.startsWith('defense-buff-') ||
    sourceKey.startsWith('deduction-buff-') ||
    sourceKey.startsWith('deduction-field-')
  )
}

function isBossFieldEnvironmentKind(kind: import('@/utils/environmentBuffCalc').EnvironmentBuffKind) {
  return kind === 'boss-field' || kind === 'deduction-field'
}

function environmentBuffKindLabel(
  kind: import('@/utils/environmentBuffCalc').EnvironmentBuffKind,
): string {
  if (kind === 'crisis') return '危局 Buff'
  if (isBossFieldEnvironmentKind(kind)) return 'Boss 场地 Buff'
  if (kind === 'deduction-node') return '临界 Buff'
  return '防线 Buff'
}

function mapEnvBuffBlockDisplayName(
  env: EnvironmentBuffEntry,
  block: { name?: string },
): string {
  if (isBossFieldEnvironmentKind(env.kind)) return '场地 Buff'
  if (env.kind === 'defense-room' && env.roomIndex != null) {
    return `第${env.roomIndex}间`
  }
  if (env.kind === 'deduction-node' && env.nodeLabel) {
    const blockName = block.name?.trim() || ''
    if (blockName && blockName !== env.name) {
      return `${env.nodeLabel} · ${blockName}`
    }
    return env.nodeLabel
  }
  return block.name?.trim() || '增益'
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

export interface DriveDiscSelection {
  twoPieceId: string
  fourPieceId: string
}

export interface BuffSelectionState {
  enabledIds: Record<string, boolean>
  stacksByEffectId: Record<string, number>
  /** 转模：用户手动输入的被转模基础数值 */
  convertInputs: Record<string, number>
  /** 用户亲手点过的效果：之后不再被队内职业条件自动改勾选 */
  manualTouchedIds?: Record<string, true>
}

/** 按角色槽位的 Buff 勾选：全队增益共享，自身增益分槽位 */
export interface MultiSlotBuffSelection {
  team: BuffSelectionState
  bySlot: Record<number, BuffSelectionState>
}

export function createEmptyBuffSelectionState(): BuffSelectionState {
  return { enabledIds: {}, stacksByEffectId: {}, convertInputs: {}, manualTouchedIds: {} }
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
    manualTouchedIds: { ...multi.team.manualTouchedIds, ...self.manualTouchedIds },
  }
}

/** 捕获的配置复用已合并输入；未捕获的低层调用保留现有实时解析。 */
export function resolvePanelBuffSelectionForSlot(ctx: PanelCalcContext, slotIndex: number): BuffSelectionState | null {
  if (ctx.resolvedSlotBuffSelections) return ctx.resolvedSlotBuffSelections[slotIndex] ?? null
  return ctx.slotBuffSelections ? resolveBuffSelectionForSlot(ctx.slotBuffSelections, slotIndex) : ctx.buffSelection ?? null
}

export function setBuffEffectEnabled(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effectId: string,
  applyTarget: string | undefined,
  enabled: boolean,
  options?: { manual?: boolean },
): void {
  const store = buffStoreForEffect(multi, slotIndex, applyTarget)
  store.enabledIds = { ...store.enabledIds, [effectId]: enabled }
  if (options?.manual === false) {
    if (store.manualTouchedIds?.[effectId]) {
      const next = { ...store.manualTouchedIds }
      delete next[effectId]
      store.manualTouchedIds = next
    }
    return
  }
  store.manualTouchedIds = { ...store.manualTouchedIds, [effectId]: true }
}

/**
 * 危局 / Boss 场地 / 防线：勾选整块效果时，单条是否应开启。
 * - 有队内职业人数条件 → 按当前队伍恰好 N 人
 * - 否则 → 仅「默认启用」开启
 */
export function resolveEnvironmentBlockItemEnabled(
  effect: BuffEffect,
  teamSlots: Array<{ agentId?: string | null }>,
  agents: Array<{ id: string; profession?: string | null }>,
): boolean {
  const required = effect.teamProfession?.trim()
  if (required) {
    const count = countTeamProfession(teamSlots, agents, required)
    return effectMatchesTeamProfessionGate(effect, count)
  }
  return effect.enabledDefault !== false
}

function environmentBlockKey(item: CollectedEffect): string {
  return `${item.sourceKey}::${item.blockName ?? ''}`
}

/**
 * 按队内职业人数条件自动勾选：条件满足→已勾选，否则未勾选。
 * 用户亲手点过的效果（manualTouchedIds）不改。
 * 场地 Buff：仅当同效果块已有任意条目勾选（用户已选过整块/单项）时才同步，避免目录默认被人数条件提前勾上。
 */
export function syncTeamProfessionAutoEnabled(
  multi: MultiSlotBuffSelection,
  slotIndex: number,
  effects: CollectedEffect[],
  teamSlots: Array<{ agentId?: string | null }>,
  agents: Array<{ id: string; profession?: string | null }>,
): void {
  const envBlockActive = new Set<string>()
  for (const item of effects) {
    if (!isEnvironmentBuffSourceKey(item.sourceKey)) continue
    const key = environmentBlockKey(item)
    if (envBlockActive.has(key)) continue
    const active = effects.some((sibling) => {
      if (environmentBlockKey(sibling) !== key) return false
      return getBuffEffectEnabled(
        multi,
        slotIndex,
        sibling.effect.id,
        sibling.effect.applyTarget,
        false,
      )
    })
    if (active) envBlockActive.add(key)
  }

  for (const item of effects) {
    // 额外 Buff 不由选择器启用：不写 enabledIds / 层数 / 转模输入（Spec §5.1 第 6、8 项）
    if (item.effect.extraGain) continue
    const effect = item.effect
    if (!effect.teamProfession?.trim()) continue
    const store = buffStoreForEffect(multi, slotIndex, effect.applyTarget)
    if (store.manualTouchedIds?.[effect.id]) continue
    if (isEnvironmentBuffSourceKey(item.sourceKey)) {
      if (!envBlockActive.has(environmentBlockKey(item))) {
        store.enabledIds = { ...store.enabledIds, [effect.id]: false }
        continue
      }
    }
    const count = countTeamProfession(teamSlots, agents, effect.teamProfession.trim())
    const on = effectMatchesTeamProfessionGate(effect, count)
    store.enabledIds = { ...store.enabledIds, [effect.id]: on }
  }
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

  // 只清理本槽自身勾选：全队 store 与其它槽不能按「当前主视角 effects」剪枝，否则换人/改影画会误删
  const selfStore = ensureSlotSelfBuffSelection(multi, slotIndex)
  for (const id of Object.keys(selfStore.enabledIds)) {
    if (!validIds.has(id)) delete selfStore.enabledIds[id]
  }
  for (const id of Object.keys(selfStore.stacksByEffectId)) {
    if (!validIds.has(id)) delete selfStore.stacksByEffectId[id]
  }
  for (const id of Object.keys(selfStore.convertInputs)) {
    if (!validIds.has(id)) delete selfStore.convertInputs[id]
  }
  if (selfStore.manualTouchedIds) {
    for (const id of Object.keys(selfStore.manualTouchedIds)) {
      if (!validIds.has(id)) delete selfStore.manualTouchedIds[id]
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
  'impact',
]

export type PanelSourceValues = {
  external?: Partial<Record<CharacterAttrKey, number>>
  final?: Partial<Record<CharacterAttrKey, number>>
  viewKey?: string
}

export interface PanelCalcContext {
  masterDataVersion?: string
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboo: BangbooBuffDoc
  bangbooRefine: number
  /** 当前正在汇总面板的槽位（自身 / 队友 的「自身」） */
  mainSlotIndex: number
  driveDiscs: DriveDiscBuffDoc[]
  /**
   * 行级增益例外（**只有命中链的 `buildInput(hit)` 才设**；面板级/目录缓存路径一律不设）。
   *
   * - 语义：只关"这一刀吃不吃"，**不改计算**（不碰面板、不碰层数累计）
   * - 为什么放 ctx：`buildInput(hit)` 手里有 hit，而 mods 组装要经过
   *   `resolvePackModsViaEffectSpec` → `resolveEffectsToMods` 多层；
   *   从 ctx 透传比逐层加参数小得多
   * - ✅ 已并入目录缓存键（`rowBuffOverrideKey`，排序后稳定序列化）：同一例外的重复求值命中缓存，
   *   不同例外各自成键 —— 因此**不再**需要绕开缓存（2026-09-22 改）
   */
  rowBuffOverride?: FlowBuffOverride | null
  /**
   * 额外 Buff 条目。转模按来源槽位取局内时，必须按该槽重算，
   * 不能把当前结算角色的 extraMods 整包套到蕾米等人身上。
   */
  extraGains?: ExtraBuffGain[]
  skillContext?: SkillCalcContext | null
  buffSelection?: BuffSelectionState | null
  slotBuffSelections?: MultiSlotBuffSelection | null
  resolvedSlotBuffSelections?: Readonly<Record<number, BuffSelectionState | null>>
  attrValues?: Partial<Record<CharacterAttrKey, number>>
  panelSourceValues?: PanelSourceValues
  /** 本次结算的主 C 槽位下标（调用方传的是编队「编辑中」槽位）；见下方 `resolveExternalPanelForSlot` */
  liveExternalSlotIndex?: number
  /** 主 C 那份局外面板（已解析好的激活面板，不问来历） */
  mainExternalPanel?: PanelStats
  /** 每人一份的激活局外面板（面板导入 / 词条导入已解析，不问来历） */
  activeSlotPanels?: Record<string, PanelStats>
  /** 转模增益角色局外面板（仅转模来源属性） */
  convertSlotPanels?: ConvertSlotPanels
  /**
   * 各槽位完整局外（该角色激活那份；无记录 → 空面板，转模链另有部分面板兜底）。
   * 全队转模必须按来源槽位取这里，不能拿编辑中角色的面板去套队友。
   */
  slotExternalPanels?: Record<number, PanelStats>
  /** 各槽位局外/局内转模取值（按 effect 来源槽位解析） */
  panelSourceValuesBySlot?: Map<number, PanelSourceValues>
  /** 异常掌控% 的换算基数；缺省时取结算角色基础面板的初始异常掌控 */
  baseAnomalyControl?: number
  /** 能量回复效率% 的换算基数；缺省时取结算角色基础面板的初始值 */
  baseEnergyRegen?: number
  /** 跳过转模（两阶段结算用） */
  skipConvert?: boolean
  /** 技能等级转模来源：按角色 id 的五大类技能等级（缺省 = 无等级转模值） */
  skillTalentLevelsByAgent?: Record<string, Partial<SkillTalentLevels> | null>
  /** 仅收集指定槽位的 Buff 来源（蕾米埃尔本人耀变：不含队友/邦布） */
  restrictToSlotIndex?: number
  /** 场地 / 环境 Buff（危局全局、Boss 场地、防卫房间） */
  environmentBuffs?: EnvironmentBuffEntry[]
  /** 跳过邦布 Buff（默认随 restrictToSlotIndex 启用） */
  excludeBangboo?: boolean
  /** 本人耀变基础的既有来源资格；共同条件仍交给效果判定循环。 */
  effectSourcePolicy?: 'remiel-self-base'
  /**
   * 按需追踪（Spec §2.2 第 2 项）：设置后 `computePanelStages` 把同一份 trace 透传给
   * 正式包解析，逐效果回调贡献；不设置时不生成任何记录。
   */
  trace?: ComputeFinalPanelOptions['trace']
  /** 追踪时的阶段标签（特殊视图用；缺省按 skipConvert 推断） */
  traceStage?: BuffEffectContribution['stage']
  /** 追踪时的前置排除映射（行级禁用 / 来源政策排除），由候选判定方给出 */
  traceExcluded?: Readonly<Record<string, 'disabled' | 'source-excluded'>>
  traceIdentities?: ReadonlyMap<string, CollectedEffect>
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

function resolveLiveExternalSlotIndex(ctx: PanelCalcContext): number {
  if (ctx.liveExternalSlotIndex != null && ctx.liveExternalSlotIndex >= 0) {
    return ctx.liveExternalSlotIndex
  }
  return ctx.mainSlotIndex
}

function resolveExternalPanelForSlot(
  slotIndex: number,
  ctx: PanelCalcContext,
  currentSlotExternalPanel: PanelStats,
): PanelStats {
  const liveIndex = resolveLiveExternalSlotIndex(ctx)
  if (slotIndex === liveIndex && ctx.mainExternalPanel) {
    return fillPanelStatsDefaults(ctx.mainExternalPanel)
  }
  const mapped = ctx.slotExternalPanels?.[slotIndex]
  if (mapped) {
    return fillPanelStatsDefaults(mapped)
  }
  if (slotIndex === ctx.mainSlotIndex) {
    return fillPanelStatsDefaults(currentSlotExternalPanel)
  }
  const agentId = ctx.teamSlots[slotIndex]?.agentId
  if (!agentId) return createEmptyExternalPanel()
  const active = ctx.activeSlotPanels?.[agentId]
  if (active) return fillPanelStatsDefaults(active)
  const convertPartial = ctx.convertSlotPanels?.[agentId]
  if (convertPartial) {
    return convertSlotPartialToExternalPanel(convertPartial)
  }
  // 没有面板记录 → 空面板：没有面板就不出伤害（不再拿占位毕业面板顶替）
  return createEmptyExternalPanel()
}

/**
 * 该槽位**有没有面板** —— 面板只由「确定导入」/ 手动切换来源 / 读盘恢复产生，
 * 没有就不该算出伤害（所有者口径 2026-09-12）。
 *
 * 只认用户侧的那份（`activeSlotPanels` = 已解析的激活面板）与转模部分面板；
 * 不认凭空推导出来的兜底值 —— 那正是「工具自己造面板」的老毛病。
 */
export function hasExternalPanelForSlot(slotIndex: number, ctx: PanelCalcContext): boolean {
  if (slotIndex < 0 || slotIndex >= ctx.teamSlots.length) return false
  const agentId = ctx.teamSlots[slotIndex]?.agentId
  if (!agentId) return false
  if (ctx.activeSlotPanels?.[agentId]) return true
  if (ctx.convertSlotPanels?.[agentId]) return true
  return false
}

function resolveConvertAttrExtras(
  slotIndex: number,
  ctx: PanelCalcContext,
): Partial<Record<CharacterAttrKey, number>> {
  const agentId = ctx.teamSlots[slotIndex]?.agentId
  const partial = agentId ? ctx.convertSlotPanels?.[agentId] : undefined
  const extras: Partial<Record<CharacterAttrKey, number>> = {
    level: partial?.level ?? ctx.attrValues?.level ?? 60,
  }
  /**
   * 冲击力：只有真知道时才写进 extras —— 不能用 `?? 0` 兜底。
   *
   * 兜底成 0 会把 `panelToConvertAttrValues` 里「取面板的 impact」又顶掉，
   * 面板填了冲击力也白填（青衣那条链就是这样断掉的，见 affix-calc-manual.md §1.9）。
   */
  const impact = partial?.impact ?? ctx.attrValues?.impact
  if (impact != null && Number.isFinite(impact)) extras.impact = impact
  if (partial?.pierce != null && Number.isFinite(partial.pierce)) {
    extras.pierce = partial.pierce
  }
  return extras
}

function buildPanelSourceValuesForSlot(
  slotIndex: number,
  ctx: PanelCalcContext,
  currentSlotExternalPanel: PanelStats,
): PanelSourceValues {
  const externalPanel = resolveExternalPanelForSlot(slotIndex, ctx, currentSlotExternalPanel)
  const slotCtx: PanelCalcContext = {
    ...ctx,
    mainSlotIndex: slotIndex,
    buffSelection: resolvePanelBuffSelectionForSlot(ctx, slotIndex),
    mainExternalPanel: externalPanel,
    skipConvert: true,
    /**
     * 必须在这里切断对「按槽位惰性求值的源值地图」的引用 —— 这是自递归的源头。
     *
     * 本次调用只算非转模部分（`skipConvert: true` 会让所有 `kind === 'convert'` 效果
     * 在 `resolveEffectsToMods` 里被整段跳过，因此源值不可能被消费）。但下面几处会
     * **eager** 地读它，读的时候并不看 skipConvert：
     *   - `resolvePackMods` 的 `ctx.panelSourceValuesBySlot.has/get(slotIndex)`
     *   - 邦布分支的 `ctx.panelSourceValuesBySlot?.get(ctx.mainSlotIndex)`
     *   - `resolvePackEffectMods` 的同类读取
     * 而此刻 `mainSlotIndex` / `slotIndex` 正是「正在被计算的那个槽位」，地图的 `get()`
     * 会再次触发该槽位的计算 → 又回到本函数 → 无限递归（实测 830 层后栈溢出）。
     *
     * 缺口只在「地图的闭包 ctx 自带同一张地图」时才闭合，因此带 `undefined` 是零成本的
     * 结构性防护：既保留 `ctx.panelSourceValues` 作为回退，也不改变任何转模路径
     * （那些路径的 skipConvert 为 false，源值照旧从地图取）。
     */
    panelSourceValuesBySlot: undefined,
    // 转模来源先算非转模快照；来源资格不反向限制用来折算的基数。
    effectSourcePolicy: undefined,
    trace: undefined,
    traceExcluded: undefined,
    traceStage: undefined,
  }
  const sourceTrace = ctx.trace?.resolveView?.(externalPanel, slotCtx, 'convertSourcePanel', ctx.trace.policy)
  if (sourceTrace) slotCtx.trace = sourceTrace
  const baseAnomalyControl = resolveBaseAnomalyControl(slotCtx)
  const baseEnergyRegen = resolveBaseEnergyRegen(slotCtx)
  const snapshot = sourceTrace ? resolvePreConvertSnapshot(externalPanel, slotCtx) : undefined
  const interimMods = snapshot?.mods ?? collectPanelBuffMods(slotCtx)
  const interimPanel = snapshot?.preConvertPanel ?? applyBuffModsToPanel(externalPanel, interimMods, {
    baseAnomalyControl,
    baseEnergyRegen,
  })
  const extras = resolveConvertAttrExtras(slotIndex, ctx)
  const values: PanelSourceValues = {
    ...(sourceTrace ? { viewKey: sourceTrace.viewKey } : {}),
    external: panelToConvertAttrValues(externalPanel, { ...extras, pierceMod: 0 }),
    final: panelToConvertAttrValues(interimPanel, {
      ...extras,
      pierceMod: interimMods.pierce,
    }),
  }
  sourceTrace?.onSourceValues?.(values)
  return values
}

/**
 * 按槽位惰性求值的源值地图。
 *
 * 背景（2026-09-10 实测，真实方案 30 词条）：一次求解里
 * `buildAllPanelSourceValuesBySlot` 被调用 20,121 次，每次都把 3 个槽位全算一遍
 * （合计约 6 万次 `buildPanelSourceValuesForSlot`；这些调用里的 `collectPanelBuffMods`
 * 占求解总耗时的约 74%）。而真正读到源值的次数远小于构建次数：槽位 0 读了 3,060 次、
 * 槽位 2 读了 4,000 次，其余大量调用根本没读。
 *
 * 因此把「按槽位算」推迟到首次读取：`get` 命中未算的槽位才计算并缓存，`has` 只回答
 * 「该槽位是否在队伍里」而不触发计算。所有会暴露全景的 API（size / keys / values /
 * entries / forEach / 迭代）都会先把全部槽位补齐，因此对调用方而言语义与普通 Map 一致 ——
 * 变的只是「什么时候算」，算出来的值不变。
 *
 * 构建/读取次数的原始数据见 `scripts/count-slot-source-usage.mjs`。
 *
 * 只读视图：不要对它 set/delete（求解器与面板计算都只读它）。
 */
class PanelSourceValuesBySlotMap extends Map<number, PanelSourceValues> {
  private readonly slotIndices: readonly number[]
  private readonly computeSlot: (slotIndex: number) => PanelSourceValues

  constructor(
    slotIndices: readonly number[],
    computeSlot: (slotIndex: number) => PanelSourceValues,
  ) {
    super()
    this.slotIndices = slotIndices
    this.computeSlot = computeSlot
  }

  private ensure(slotIndex: number): PanelSourceValues {
    const cached = super.get(slotIndex)
    if (cached !== undefined) return cached
    const computed = this.computeSlot(slotIndex)
    super.set(slotIndex, computed)
    return computed
  }

  private ensureAll(): void {
    for (const slotIndex of this.slotIndices) this.ensure(slotIndex)
  }

  override get(slotIndex: number): PanelSourceValues | undefined {
    return this.slotIndices.includes(slotIndex) ? this.ensure(slotIndex) : undefined
  }

  override has(slotIndex: number): boolean {
    return this.slotIndices.includes(slotIndex)
  }

  override get size(): number {
    return this.slotIndices.length
  }

  override keys(): MapIterator<number> {
    this.ensureAll()
    return super.keys()
  }

  override values(): MapIterator<PanelSourceValues> {
    this.ensureAll()
    return super.values()
  }

  override entries(): MapIterator<[number, PanelSourceValues]> {
    this.ensureAll()
    return super.entries()
  }

  override forEach(
    callback: (value: PanelSourceValues, key: number, map: Map<number, PanelSourceValues>) => void,
    thisArg?: unknown,
  ): void {
    this.ensureAll()
    super.forEach(callback, thisArg)
  }

  override [Symbol.iterator](): MapIterator<[number, PanelSourceValues]> {
    this.ensureAll()
    return super[Symbol.iterator]()
  }
}

/**
 * 求解器/面板计算用的源值地图（惰性）。
 * UI 要展示全部槽位时才走 `buildPanelSourceValuesBySlotRecord`（那里会立刻补齐）。
 */
export function buildPanelSourceValuesBySlotMap(
  ctx: PanelCalcContext,
  currentSlotExternalPanel: PanelStats,
): Map<number, PanelSourceValues> {
  const slotIndices = ctx.teamSlots
    .map((slot, index) => (slot.agentId ? index : -1))
    .filter((index) => index >= 0)
  return new PanelSourceValuesBySlotMap(slotIndices, (slotIndex) =>
    buildPanelSourceValuesForSlot(slotIndex, ctx, currentSlotExternalPanel),
  )
}

function buildAllPanelSourceValuesBySlot(
  ctx: PanelCalcContext,
  currentSlotExternalPanel: PanelStats,
): Map<number, PanelSourceValues> {
  return buildPanelSourceValuesBySlotMap(ctx, currentSlotExternalPanel)
}

/** 各槽位局外/局内转模取值（供 Buff 展示等 UI 按来源槽位解析） */
export function buildPanelSourceValuesBySlotRecord(
  ctx: PanelCalcContext,
  currentSlotExternalPanel: PanelStats,
): Record<number, PanelSourceValues> {
  return Object.fromEntries(buildAllPanelSourceValuesBySlot(ctx, currentSlotExternalPanel).entries())
}

/** 该槽位装备/影画是否含局外或局内转模（不论当前是否勾选，供顶栏标记） */
export function slotHasPanelConvertEffect(
  ctx: PanelCalcContext,
  slotIndex: number,
): boolean {
  for (const item of collectAllBuffEffects(ctx)) {
    const effect = item.effect
    if (effect.kind !== 'convert' || !effect.convert) continue
    if ((effect.convert.panelSource ?? 'external') === 'manual') continue
    // 额外 Buff 的来源槽位在 `extraGainSourceSlot` 上（providerSlot 恒 null），统一走这个解析
    if (resolveCollectedEffectSourceSlot(item) === slotIndex) return true
  }
  return false
}

/** 该槽位是否存在启用的局外/局内转模（非自行设置） */
export function slotParticipatesInConvertBuff(
  ctx: PanelCalcContext,
  slotIndex: number,
): boolean {
  for (const item of collectAllBuffEffects(ctx)) {
    const effect = item.effect
    if (effect.kind !== 'convert' || !effect.convert) continue
    if ((effect.convert.panelSource ?? 'external') === 'manual') continue
    if (!isEffectEnabled(effect, ctx.buffSelection)) continue
    if (resolveCollectedEffectSourceSlot(item) === slotIndex) return true
  }
  return false
}

export type ConvertSourceMark = {
  attr: CharacterAttrKey
  panelSource: 'external' | 'final'
}

/** 转模来源属性中不在常规面板网格上的（冲击力、等级等） */
export const CONVERT_SOURCE_ATTRS_OFF_PANEL: readonly CharacterAttrKey[] = ['impact', 'level']

/** 当前槽位作为转模来源时，涉及哪些属性、读局外还是局内 */
export function collectConvertSourceMarksForSlot(
  ctx: PanelCalcContext,
  slotIndex: number,
  options?: { requireEnabled?: boolean },
): ConvertSourceMark[] {
  const requireEnabled = options?.requireEnabled !== false
  const marks = new Map<string, ConvertSourceMark>()
  for (const item of collectAllBuffEffects(ctx)) {
    const effect = item.effect
    if (effect.kind !== 'convert' || !effect.convert) continue
    const source = effect.convert.panelSource ?? 'external'
    if (source !== 'external' && source !== 'final') continue
    // 技能等级转模没有面板属性值，不参与「转模来源面板属性」收集
    if (isSkillConvertFromKey(effect.convert.from)) continue
    if (requireEnabled && !isEffectEnabled(effect, ctx.buffSelection)) continue
    if (resolveCollectedEffectSourceSlot(item) !== slotIndex) continue
    const key = `${source}:${effect.convert.from}`
    if (!marks.has(key)) {
      marks.set(key, { attr: effect.convert.from, panelSource: source })
    }
  }
  return [...marks.values()]
}

export function convertSourceAttrMatchesPanelSlot(
  attr: CharacterAttrKey,
  slot: { kind?: string; key?: string; id?: string },
): boolean {
  if (attr === 'pierce') {
    return slot.kind === 'pierce' || slot.id === 'pierce' || slot.key === 'pierce'
  }
  if (CONVERT_SOURCE_ATTRS_OFF_PANEL.includes(attr)) return false
  return slot.key === attr || slot.id === attr
}

export function panelSlotUsesConvertSource(
  slot: { kind?: string; key?: string; id?: string },
  attrs: Set<CharacterAttrKey>,
): boolean {
  for (const attr of attrs) {
    if (convertSourceAttrMatchesPanelSlot(attr, slot)) return true
  }
  return false
}

export function externalConvertFieldClass(
  field: { kind?: string; key?: string; id?: string },
  attrs: { external: Set<CharacterAttrKey>; final: Set<CharacterAttrKey> },
) {
  const usesExternal = panelSlotUsesConvertSource(field, attrs.external)
  const usesFinal = panelSlotUsesConvertSource(field, attrs.final)
  return {
    'is-convert-source': usesExternal,
    'is-convert-source-via-final': !usesExternal && usesFinal,
  }
}

/** 队伍是否存在需录入面板的转模增益角色 */
export function teamHasConvertSupportSlots(
  ctx: PanelCalcContext,
  options?: { excludeAnomalyAgentIds?: Iterable<string> },
): boolean {
  return collectConvertSupportSlots(ctx, options).length > 0
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

    const slotIndex = resolveCollectedEffectSourceSlot(item)
    if (slotIndex == null) continue

    const agentId = ctx.teamSlots[slotIndex]?.agentId
    if (!agentId || agentId === mainId || anomalyIds.has(agentId)) continue
    // 技能等级转模没有面板属性值，不参与「转模来源属性收集」
    if (isSkillConvertFromKey(effect.convert.from)) continue

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

function resolveMainAgent(ctx: PanelCalcContext) {
  const agentId = ctx.teamSlots[ctx.mainSlotIndex]?.agentId
  if (!agentId) return undefined
  return ctx.agents.find((item) => item.id === agentId)
}

/** 锋御：仅角色基础面板的初始锐爆计入锐爆区；音擎/驱动盘/Buff 的爆伤仍走面板爆伤 */
function applyFengYuSharpenCritMods(combatMods: CombatBuffMods, ctx: PanelCalcContext) {
  const mainAgent = resolveMainAgent(ctx)
  if (mainAgent?.profession !== '锋御') return
  combatMods.sharpenCritDmgBonus += mainAgent.basePanel.sharpenCritDmgBonus
}

export interface CombatBuffMods {
  vulnerable: number
  directVulnerable: number
  anomalyVulnerable: number
  dmgReduction: number
  directDmgReduction: number
  anomalyDmgReduction: number
  globalStaggerVulnerable: number
  staggerVulnerable: number
  staggerVulnerableOnly: number
  special: number
  pierceDmgBonus: number
  /** 锐化伤害提升%（独立乘区，仅锐化路径；锋御专属） */
  sharpenDmgBonus: number
  sharpenCritDmgBonus: number
  dmgPenalty: number
  /** 自定义乘区增益（Phase 3b）：键由乘区定义登记，值按百分点加总 */
  custom: Record<string, number>
}

export interface PanelBuffBreakdown {
  totalMods: BuffStatModifiers
  combatMods: CombatBuffMods
  finalPanel: PanelStats
  sources: BuffModSource[]
  effectContributions?: BuffEffectContribution[]
}

/** 一条效果在本次判定里的终态（计算链路收敛 Spec §3.1）。 */
export type BuffEffectApplyStatus =
  | 'applied'
  | 'zero'
  | 'disabled'
  | 'source-excluded'
  | 'not-enabled'
  | 'target-mismatch'
  | 'context-mismatch'
  | 'element-mismatch'
  | 'profession-mismatch'
  | 'team-count-mismatch'
  | 'convert-skipped'

/** 共享参数解析的输入（正式求值与配置预览共用，Spec §3.2）。 */
export interface EffectParameterInputs {
  stacks?: number
  overrideBase?: number | null
  attrValues?: Partial<Record<CharacterAttrKey, number>>
  panelSourceValues?: PanelSourceValues
  skillTalentLevels?: Partial<SkillTalentLevels> | null
}

/** 共享参数解析的结果：有效层数、实际采用的基数及其来历、配置折算值。 */
export interface ResolvedEffectParameters {
  amount: number
  stacks?: number
  convertBase?: {
    from: CharacterAttrKey | string
    value: number
    source: 'manual' | 'external' | 'final' | 'skillLevel' | 'default'
    stage: 'manual' | 'external' | 'preConvert' | 'skillLevel'
    sourceViewKey?: string
  }
}

/** 判定循环产出的原始记录（不含来源元数据；`buffEffect.ts` 回调给的就是它）。 */
export interface ResolvedEffectRecord extends ResolvedEffectParameters {
  effectId: string
  stat: BuffStatKey | CustomBuffStatKey
  status: BuffEffectApplyStatus
  matchElement?: string | null
}

/** 一条效果在某个面板视图里的贡献（补齐来源与阶段）。 */
export interface BuffEffectContribution extends ResolvedEffectRecord {
  viewKey: string
  sourceKey: string
  blockId: string
  providerSlot: number | null
  providerName?: string
  sourceSlot: number | null
  beneficiarySlot: number
  policy: PanelViewPolicyId
  stage: 'preConvert' | 'convert' | 'releaseMult' | 'radianceSelf'
}

/** 一个面板视图（同一份有效输入 + 同一政策）的全部贡献。 */
export interface PanelStageTrace {
  viewKey: string
  slotIndex: number
  policy: PanelViewPolicyId
  contributions: BuffEffectContribution[]
}

/** 事件实际用到的那张面板（Spec §3.3）。 */
export type EventEffectUseView =
  | 'ownerPanel'
  | 'powerProviderPanel'
  | 'anomalyTriggerPanel'
  | 'radianceSelfPanel'
  | 'mutationPanel'
  | 'releaseMult'
  | 'convertSourcePanel'

export interface DamageInputUsage {
  inputKey: Exclude<keyof DamageCalcInput, 'onInputUsed' | 'eventDamageType' | 'eventCritMode'>
  field: keyof PanelStats | BuffStatKey | keyof RemielSelfRadianceCalcInput
  resultKey: keyof DamageCalcResult
  usedZones: DamageZoneId[]
}

export interface EventDamageInputUsage extends DamageInputUsage {
  viewKey: string
  slotIndex: number
  policy: PanelViewPolicyId
  usedView: EventEffectUseView
}

/** 正式求值已采用的面板视图；仅完整详情保存，不作为另一条计算链。 */
export interface EventViewSnapshot {
  agentName: string
  viewKey: string
  slotIndex: number
  policy: PanelViewPolicyId
  externalPanel: PanelStats
  panel: PanelStats
  sources: readonly BuffModSource[]
  convertValues?: PanelSourceValues
}

/** 事件级的最终贡献记录：每条候选在最终面板视图里的实际结果。 */
export interface EventEffectRecord extends BuffEffectContribution {
  eventId: string
  providerName: string
  beneficiaryAgentId: string
  beneficiaryName: string
  beneficiaryLabel: string
  usedInputs: EventDamageInputUsage[]
  usedViews: EventEffectUseView[]
  usedZones: DamageZoneId[]
}

/** 一个事件**实际采用**的受益项（按视图）。 */
export interface EventEffectRecipient {
  viewKey: string
  slotIndex: number
  agentId: string
  label: string
  policy: PanelViewPolicyId
  stage: BuffEffectContribution['stage']
  amount: number
  status: 'applied' | 'zero'
  usedViews: EventEffectUseView[]
  usedZones: DamageZoneId[]
}

/** 同一 effect id 的投影（Spec §3.3 / §3.5）。 */
export interface EventEffectSummary {
  effectId: string
  stat: BuffStatKey | CustomBuffStatKey
  sourceKey: string
  blockId: string
  providerName: string
  candidates: EventEffectRecord[]
  recipients: EventEffectRecipient[]
  state: 'single' | 'same' | 'multiple' | 'inactive'
  amount?: number
}

export interface ComputeFinalPanelOptions {
  includeDetails?: boolean
  /**
   * 按需追踪（Spec §2.2 第 2 项）。设置后本次求值会在正式运算处回调逐效果贡献；
   * 不设置时不分配任何记录（数值快路径零开销）。
   */
  trace?: {
    onSourceValues?: (values: PanelSourceValues) => void
    viewKey: string
    policy: PanelViewPolicyId
    onContribution: (item: BuffEffectContribution) => void
    resolveView?: (
      external: PanelStats,
      context: PanelCalcContext,
      usedView: EventEffectUseView,
      policy?: PanelViewPolicyId,
    ) => NonNullable<ComputeFinalPanelOptions['trace']>
    preConvertCache?: Map<string, PanelPreConvertSnapshot>
    panelCache?: Map<string, PanelBuffBreakdown>
    bindInput?: (inputKey: DamageInputUsage['inputKey'], field: DamageInputUsage['field'], viewKey: string) => void
  }
}

export interface PanelPreConvertSnapshot {
  externalPanel: PanelStats
  preConvertPanel: PanelStats
  mods: BuffStatModifiers
  sources: BuffModSource[]
  effectContributions?: BuffEffectContribution[]
}

/** 唯一编排：局外 → 转模前 → 最终。`computeFinalPanel` / `runPanelPipeline` 都走这里。 */
export interface PanelStages {
  panelSourceValuesBySlot: ReadonlyMap<number, PanelSourceValues>
  externalPanel: PanelStats
  preConvertPanel: PanelStats
  finalBreakdown: PanelBuffBreakdown
}

export interface BuffModSource {
  key: string
  label: string
  mods: BuffStatModifiers
  note?: string
  effects?: BuffEffect[]
  blockName?: string
  /** 缓存重建运算包时保留真实来源及选择器隔离策略。 */
  sourceOptions?: PackSourceOptions
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
  /**
   * 适用槽位集合：这条增益作用于哪些槽位（升序、去重）。
   * 「全队」性质 / 无主来源（邦布、场地）= 当前全部槽位。
   * 2026-09-24 起由收集器统一填（施工规格 `dev-docs/specs/buff-build-refactor-spec.md` §2.1）。
   */
  applicableSlots: number[]
  /** 提供者槽位：这条是谁给的；null = 无主（邦布 / 场地 / 额外 Buff） */
  providerSlot: number | null
  /**
   * 额外 Buff 的**来源槽位**（读面板/技能等级的槽位）；非额外 Buff 不填。
   * 用 `resolveCollectedEffectSourceSlot` 取值，别拿 `providerSlot` 冒充（会改变 restrictToSlotIndex 语义）。
   */
  extraGainSourceSlot?: ExtraBuffSlotIndex
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
    coords: [],
    element,
    isFollowUp: false,
    directSubKind: 'normal',
    generic: true,
  }
}

function resolveBeneficiaryElement(ctx: PanelCalcContext): string | undefined {
  const mainIndex = ctx.mainSlotIndex ?? 0
  const agentId = ctx.teamSlots[mainIndex]?.agentId
  if (!agentId) return undefined
  return ctx.agents.find((item) => item.id === agentId)?.element
}

function resolveTeamProfessionCountOption(ctx: PanelCalcContext) {
  return (profession: string) => countTeamProfession(ctx.teamSlots, ctx.agents, profession)
}

/** 运算包的来源侧覆盖：额外 Buff 的来源槽位与"来源不可用"的显式零值（Spec §5.1 第 4 项、§5.2 第 6 项） */
interface PackSourceOptions {
  /** 读面板/技能等级用的来源槽位（与"受益槽位"无关） */
  sourceSlotIndex?: number | null
  /** 显式给出的来源面板值（例如来源不可用时全 0），优先于按槽位取 */
  panelSourceValuesOverride?: PanelSourceValues
  /** 额外 Buff 运算包：不读选择器里的层数/转模输入 */
  extraGainPack?: boolean
  /**
   * 追踪用的来源身份（内部）：只在 `ctx.trace` 存在时被读取。
   * 由收集器按 `CollectedEffect` 填，其它排序/求值语义不受影响。
   */
  traceSource?: { sourceKey: string; blockId: string; providerSlot: number | null }
  /** 追踪：被前置排除、但仍需由判定循环报告状态的候选 */
  traceExcludedEffects?: BuffEffect[]
}

/** 来源不可用时的零值：只覆盖这些效果真正会读的 `from` 键，避免回落受益槽位的面板 */
function zeroSourceValuesFor(effects: readonly BuffEffect[]): PanelSourceValues {
  const zero: Partial<Record<CharacterAttrKey, number>> = {}
  for (const effect of effects) {
    const convert = effect.convert
    if (!convert || effect.kind !== 'convert') continue
    if (isSkillConvertFromKey(convert.from)) continue
    zero[convert.from] = 0
  }
  return { external: { ...zero }, final: { ...zero } }
}

function sourceOptionsForCollectedEffect(
  item: CollectedEffect,
  ctx: PanelCalcContext,
  effects: readonly BuffEffect[],
): PackSourceOptions | undefined {
  // 追踪身份：只在带 trace 时填，数值路径多一点字段也没有行为影响
  const traceSource = ctx.trace
    ? {
        sourceKey: item.sourceKey,
        blockId: item.blockId,
        providerSlot: item.providerSlot ?? null,
      }
    : undefined
  if (!item.effect.extraGain) return traceSource ? { traceSource } : undefined
  const sourceSlotIndex = resolveCollectedEffectSourceSlot(item)
  const available = sourceSlotIndex != null && Boolean(ctx.teamSlots[sourceSlotIndex]?.agentId)
  return {
    sourceSlotIndex,
    panelSourceValuesOverride: available ? undefined : zeroSourceValuesFor(effects),
    extraGainPack: true,
    traceSource,
  }
}

/**
 * 本事件的候选集合（Spec §2.2 第 2 项）：目标槽位适用的条目，以及**被前置排除**的候选
 * （行级禁用 / 来源政策排除）。两者不重叠，顺序即目录顺序。
 *
 * 被排除者不参加运算，但必须能被统一判定循环报告成 `disabled` / `source-excluded`——
 * 否则预览与详情里「禁用后应有状态」的一侧会凭空消失（Review R6）。
 */
export function collectEventCandidateEffects(ctx: PanelCalcContext): {
  items: CollectedEffect[]
  excluded: Array<{ item: CollectedEffect; reason: 'disabled' | 'source-excluded' }>
} {
  const build = buildBuffCatalog({
    masterDataVersion: ctx.masterDataVersion,
    teamSlots: ctx.teamSlots,
    agents: ctx.agents,
    wengines: ctx.wengines,
    driveDiscs: ctx.driveDiscs,
    bangboo: ctx.bangboo ?? null,
    bangbooRefine: ctx.bangbooRefine,
    environmentBuffs: ctx.environmentBuffs ?? [],
    extraGains: ctx.extraGains ?? [],
  })
  const restrict = ctx.restrictToSlotIndex ?? null
  const items: CollectedEffect[] = []
  const excluded: Array<{ item: CollectedEffect; reason: 'disabled' | 'source-excluded' }> = []
  for (const entry of build.entries) {
    if (!entry.applicableSlots.includes(ctx.mainSlotIndex)) continue
    const sameSlotView = entry.providerSlot === ctx.mainSlotIndex ? entry : applyTeammateView(entry)
    if (!isEffectSourceAllowed(entry, ctx.mainSlotIndex, ctx.effectSourcePolicy)) {
      excluded.push({ item: sameSlotView, reason: 'source-excluded' })
      continue
    }
    if (restrict != null) {
      if (entry.providerSlot != null && entry.providerSlot !== restrict) {
        excluded.push({ item: sameSlotView, reason: 'source-excluded' })
        continue
      }
      if (entry.sourceKey.startsWith('bangboo')) {
        excluded.push({ item: sameSlotView, reason: 'source-excluded' })
        continue
      }
    }
    if (ctx.excludeBangboo && entry.sourceKey.startsWith('bangboo')) {
      excluded.push({ item: sameSlotView, reason: 'source-excluded' })
      continue
    }
    if (isEntryDisabledByRowOverride(entry, ctx.rowBuffOverride ?? null)) {
      excluded.push({ item: sameSlotView, reason: 'disabled' })
      continue
    }
    items.push(sameSlotView)
  }
  return { items, excluded }
}

/** 展示与结算共用来源缺失规则，不能把有主的空来源替换为受益者面板。 */
export function resolveCollectedEffectPanelSourceValues(
  item: CollectedEffect,
  inputs: {
    panelSourceValues?: PanelSourceValues
    panelSourceValuesBySlot?: Record<number, PanelSourceValues | undefined>
  },
): PanelSourceValues | undefined {
  const sourceSlot = resolveCollectedEffectSourceSlot(item)
  if (sourceSlot != null && inputs.panelSourceValuesBySlot?.[sourceSlot]) {
    return inputs.panelSourceValuesBySlot[sourceSlot]
  }
  if (item.effect.extraGain || (sourceSlot != null && inputs.panelSourceValuesBySlot)) {
    return zeroSourceValuesFor([item.effect])
  }
  return inputs.panelSourceValues
}

/** 正式运算与只读配置共用有效参数输入，启用/匹配只在运算循环处理。 */
function resolveEffectParameterInputs(
  ctx: PanelCalcContext,
  sourceSlotIndex: number | null | undefined,
  extraGainPack: boolean,
  panelSourceValuesOverride?: PanelSourceValues,
  needsPanelSourceValues = true,
) {
  const selection = extraGainPack ? null : ctx.buffSelection
  const overlay = rowBuffSelectionOverlay(ctx.rowBuffOverride, selection)
  const agentId = sourceSlotIndex != null ? ctx.teamSlots[sourceSlotIndex]?.agentId : undefined
  return {
    stacksByEffectId: overlay?.stacksByEffectId ?? selection?.stacksByEffectId,
    convertInputs: overlay?.convertInputs ?? selection?.convertInputs,
    attrValues: ctx.attrValues,
    panelSourceValues: needsPanelSourceValues
      ? panelSourceValuesOverride ??
        (sourceSlotIndex != null ? ctx.panelSourceValuesBySlot?.get(sourceSlotIndex) : undefined) ?? ctx.panelSourceValues
      : undefined,
    skillTalentLevels: agentId ? ctx.skillTalentLevelsByAgent?.[agentId] : undefined,
  }
}

function resolvePackMods(
  effects: BuffEffect[],
  isMain: boolean,
  ctx: PanelCalcContext,
  slotIndex?: number,
  sourceOptions?: PackSourceOptions,
): BuffStatModifiers {
  const skillCtx = ctx.skillContext ?? defaultSkillContext('direct')
  const sourceSlotIndex = sourceOptions?.sourceSlotIndex ?? slotIndex
  const parameters = resolveEffectParameterInputs(ctx, sourceSlotIndex,
    sourceOptions?.extraGainPack === true, sourceOptions?.panelSourceValuesOverride,
    !ctx.skipConvert && effects.some(effect => effect.kind === 'convert'))
  const panelSourceValues = parameters.panelSourceValues
  const slotElement =
    slotIndex != null
      ? ctx.agents.find((item) => item.id === ctx.teamSlots[slotIndex]?.agentId)?.element
      : undefined
  const beneficiaryProfession = ctx.agents.find(
    (item) => item.id === ctx.teamSlots[ctx.mainSlotIndex]?.agentId,
  )?.profession
  const trace = ctx.trace
  const stage: BuffEffectContribution['stage'] =
    ctx.traceStage ?? (ctx.skipConvert ? 'preConvert' : 'convert')
  const traceSource = sourceOptions?.traceSource
  // 前置排除的候选要由**同一判定循环**报告状态（Spec §4 第 2 项）：把它们一并送进循环，
  // 由 excludedByEffectId 短路，不匹配、不解析参数、不运算。
  const excludedEffects = trace ? (sourceOptions?.traceExcludedEffects ?? []) : []
  const loopEffects = excludedEffects.length ? [...effects, ...excludedEffects] : effects
  return resolveEffectsToMods(loopEffects, {
    applyTargets: isMain ? ['self', 'team'] : ['team'],
    ctx: skillCtx,
    element: isMain ? skillCtx.element : slotElement,
    beneficiaryElement: resolveBeneficiaryElement(ctx),
    beneficiaryProfession,
    stacksByEffectId: parameters.stacksByEffectId,
    convertInputs: parameters.convertInputs,
    attrValues: parameters.attrValues,
    panelSourceValues,
    skillTalentLevels: parameters.skillTalentLevels,
    skipConvert: ctx.skipConvert,
    selection: ctx.buffSelection,
    resolveTeamProfessionCount: resolveTeamProfessionCountOption(ctx),
    excludedByEffectId: excludedEffects.length ? ctx.traceExcluded : undefined,
    // 只有带追踪时才分配记录对象；数值路径完全不受影响
    onEffectResolved: trace
      ? (record) => {
          // 来源身份来自收集器的规范条目，不能由运行期效果 id 猜测。
          const identity = ctx.traceIdentities?.get(record.effectId)
          trace.onContribution({
            ...record,
            viewKey: trace.viewKey,
            policy: trace.policy,
            sourceKey: identity?.sourceKey ?? traceSource?.sourceKey ?? '',
            blockId: identity?.blockId ?? traceSource?.blockId ?? '',
            providerSlot: identity?.providerSlot ?? traceSource?.providerSlot ?? null,
            providerName: identity?.providerName,
            sourceSlot: sourceSlotIndex ?? null,
            beneficiarySlot: ctx.mainSlotIndex,
            stage,
            ...(record.convertBase?.stage === 'preConvert' && panelSourceValues?.viewKey
              ? { convertBase: { ...record.convertBase, sourceViewKey: panelSourceValues.viewKey } }
              : {}),
          })
        }
      : undefined,
  })
}

/**
 * 配置参数解析（Spec §2.2 第 4 项 / §5.1）：复用正式求值那套参数组装
 * （行级覆盖、来源槽位、技能等级），只解析「有效层数 / 有效基数 / 配置折算值」。
 *
 * 它**跳过启用、匹配与数值施加**：不产出实际贡献，也不能当贡献用。
 */
export function resolveCollectedEffectParameters(
  item: CollectedEffect,
  ctx: PanelCalcContext,
): ResolvedEffectParameters {
  const sourceSlotIndex = resolveCollectedEffectSourceSlot(item) ?? item.providerSlot
  const isExtraPack = item.effect.extraGain === true
  const sourceAvailable = sourceSlotIndex != null && Boolean(ctx.teamSlots[sourceSlotIndex]?.agentId)
  const parameters = resolveEffectParameterInputs(ctx, sourceSlotIndex, isExtraPack,
    isExtraPack && !sourceAvailable ? zeroSourceValuesFor([item.effect]) : undefined)
  return resolveBuffEffectParameters(item.effect, {
    stacks: parameters.stacksByEffectId?.[item.effect.id],
    overrideBase: parameters.convertInputs?.[item.effect.id] ?? null,
    attrValues: parameters.attrValues,
    panelSourceValues: parameters.panelSourceValues,
    skillTalentLevels: parameters.skillTalentLevels,
  })
}

/** 旧路径：直接 resolveEffectsToMods。阶段 6 双跑对照用。 */
export function resolvePackModsDirect(
  effects: BuffEffect[],
  isMain: boolean,
  ctx: PanelCalcContext,
  slotIndex?: number,
): BuffStatModifiers {
  return resolvePackMods(effects, isMain, ctx, slotIndex)
}

/**
 * Buff pack 执行：BuffEffect → EffectInstance → 往返 BuffEffect → 同一套 resolveEffectsToMods。
 * 往返不读 legacyBuffEffect。影画 / 音擎 / 驱动盘 / 邦布 / 场地共用。
 */
export function resolvePackModsViaEffectSpec(
  effects: BuffEffect[],
  isMain: boolean,
  ctx: PanelCalcContext,
  slotIndex?: number,
  sourceOptions?: PackSourceOptions,
): BuffStatModifiers {
  if (!effects.length) return createEmptyBuffStatModifiers()
  const reconstructed = effects.map((effect) =>
    effectInstanceToBuffEffect(instantiateBuffEffect(effect, { sourceKey: 'buff' })),
  )
  return resolvePackMods(reconstructed, isMain, ctx, slotIndex, sourceOptions)
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
    // 当前结算角色：4 件套含其 2 件效果；另选的 2 件套也计入
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
  return resolvePackModsViaEffectSpec(effects, isMain, ctx)
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

/** 收集一趟所需的上下文（只含收集真正读到的字段；完整 `PanelCalcContext` 结构上兼容） */
interface CollectPassContext {
  teamSlots: PanelCalcContext['teamSlots']
  agents: PanelCalcContext['agents']
  wengines: PanelCalcContext['wengines']
  driveDiscs: PanelCalcContext['driveDiscs']
  bangboo: PanelCalcContext['bangboo'] | null
  bangbooRefine: PanelCalcContext['bangbooRefine']
  environmentBuffs: PanelCalcContext['environmentBuffs']
  mainSlotIndex: PanelCalcContext['mainSlotIndex']
  restrictToSlotIndex: PanelCalcContext['restrictToSlotIndex'] | null
  excludeBangboo: PanelCalcContext['excludeBangboo']
  rowBuffOverride: PanelCalcContext['rowBuffOverride'] | null
}

/**
 * 收集一趟（把某个槽位当作「这份面板的归属槽位」）。
 *
 * ⚠️ **不要直接调用**：对外入口是 `collectAllBuffEffects`（= 构建 + 筛选）；
 * 构建层 `buildBuffCatalog` 会用它逐个槽位跑（每个槽位各当一次 `mainSlotIndex`）。
 * 保留"按单一归属槽位收一次"的原始实现，是为了保持与拆分前逐位等价。
 */
function collectForMainSlot(ctx: CollectPassContext): CollectedEffect[] {
  const collected: CollectedEffect[] = []
  const mainIndex = ctx.mainSlotIndex

  /** 当前全部槽位（`applicableSlots` 的「全队 / 无主」取值） */
  const allSlots = ctx.teamSlots.map((_, index) => index)
  /**
   * 作用对象（2026-09-24，施工规格 §2.1）：`team` 或无主来源 → 全部槽位；否则 → `[提供者槽位]`。
   * 提供者槽位从来源标记解析（`agent-<i>-…` / `wengine-<i>-…` / `drive-disc-<i>-…`；邦布 / 场地解析不出 = 无主）。
   */
  function describeSlots(effect: BuffEffect, sourceKey: string) {
    const providerSlot = parseSourceKeySlotIndex(sourceKey)
    const applicableSlots =
      effect.applyTarget === 'team' || providerSlot == null ? allSlots : [providerSlot]
    return { applicableSlots, providerSlot }
  }

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
          blockNote: mergeBuffDisplayNotes(extraNote, entry.blockNote),
          ...describeSlots(effect, sourceKey),
        })
      }
    }
  }

  ctx.teamSlots.forEach((slot, index) => {
    if (ctx.restrictToSlotIndex != null && index !== ctx.restrictToSlotIndex) return
    if (!slot.agentId) return
    const agent = ctx.agents.find((item) => item.id === slot.agentId)
    if (!agent) return

    const isMain = index === mainIndex
    const roleLabel = isMain ? '自身' : '队友'
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
        const refineBuffs = refineBuffsRaw
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

    // 2 件套按口径只应有「自身」类效果（2026-09-24 实测数据：30 个盘 / 54 条 self / team 0 条）——
    // 因此**不再按"这一趟的归属槽位"筛**：统一走 `applicableSlots`（自身 → [该槽位]），结果不变且少一个特例。
    if (fourDisc) {
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
            blockNote: mergeBuffDisplayNotes(fourDisc.twoPieceNote, entry.blockNote),
            ...describeSlots(effect, twoKey),
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
            blockNote: mergeBuffDisplayNotes(fourDisc.fourPieceNote, entry.blockNote),
            ...describeSlots(effect, fourKey),
          })
        }
      }
    }
    if (twoDisc && twoDisc.id !== fourDisc?.id) {
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
            blockNote: mergeBuffDisplayNotes(twoDisc.twoPieceNote, entry.blockNote),
            ...describeSlots(effect, twoKey),
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
            blockNote: mergeBuffDisplayNotes(fourDisc.fourPieceNote, entry.blockNote),
            ...describeSlots(effect, fourKey),
          })
        }
      }
    }
  })

  if (
    !ctx.excludeBangboo &&
    ctx.restrictToSlotIndex == null &&
    ctx.bangboo?.id &&
    ctx.bangboo.id !== 'none'
  ) {
    const refineIndex = clampRefine(ctx.bangbooRefine) - 1
    const fixedPack = {
      effectBlocks: ctx.bangboo.effectBlocks?.length
        ? ctx.bangboo.effectBlocks
        : undefined,
      effects: ctx.bangboo.effects ?? [],
    }
    const refineBlocks = ctx.bangboo.refinementEffectBlocks?.[refineIndex]
    const refinePack = {
      effectBlocks: refineBlocks?.length ? refineBlocks : undefined,
      effects: ctx.bangboo.refinementEffects?.[refineIndex] ?? [],
    }
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

  for (const env of ctx.environmentBuffs ?? []) {
    if (!env.effectBlocks?.length) continue
    const pack = {
      effectBlocks: env.effectBlocks,
      effects: [] as BuffEffect[],
    }
    const kindLabel = environmentBuffKindLabel(env.kind)
    // Boss 场地：卡片写 Boss 名，效果块名固定「场地 Buff」
    // 防卫战：卡片写「buff名 | 第x间」
    const providerName = isBossFieldEnvironmentKind(env.kind)
      ? env.bossName || env.name || 'Boss 场地 Buff'
      : env.name
    const sourceLabel = [
      kindLabel,
      env.version && env.phase ? `${env.version}第${env.phase}期` : '',
      env.kind === 'deduction-node' && env.nodeLabel ? env.nodeLabel : '',
      isBossFieldEnvironmentKind(env.kind) ? '' : env.roomLabel || '',
      isBossFieldEnvironmentKind(env.kind) ? providerName : '',
    ]
      .filter(Boolean)
      .join(' · ')
    // Buff 原文照常作为注释；与效果块注释相同时由 mergeBuffDisplayNotes 去重
    const noteParts = [env.text?.trim() || '']
    if (env.kind === 'defense-room' && env.roomBosses?.length) {
      noteParts.push(`房间 Boss：${env.roomBosses.map((b) => b.name).join('、')}`)
    }
    pushPack(
      {
        ...pack,
        effectBlocks: pack.effectBlocks.map((block) => ({
          ...block,
          name: mapEnvBuffBlockDisplayName(env, block),
        })),
      },
      env.sourceKey,
      sourceLabel,
      providerName,
      env.imageUrl ? (resolveAssetUrl(env.imageUrl) ?? env.imageUrl) : null,
      () => kindLabel,
      () => true,
      noteParts.filter(Boolean).join('\n'),
    )
    // 保留数据里的 enabledDefault，供首次勾选效果块时只开「默认启用」项；
    // 初始不勾选由 buildDefaultBuffSelection 对场地分组写 false。
  }

  const rowOverride = ctx.rowBuffOverride ?? null
  if (!rowOverride) return collected
  // 行级例外：在**公共收集器**这一层滤掉 —— 普通路径（collectPanelBuffMods）与
  // 明细路径（collectPanelBuffModSourcesUncached）都从这里出发，改一处即全覆盖
  const disabled = expandBuffOverrideToEffectIds(
    rowOverride,
    collected.map((item) => ({ effect: item.effect, blockKey: blockKeyOfCollected(item) })),
  )
  if (!disabled) return collected
  return collected.filter((item) => !disabled.has(item.effect.id))
}

/* ============================================================
 * 构建 / 筛选分离（2026-09-24，施工规格 dev-docs/specs/buff-build-refactor-spec.md §3）
 * ------------------------------------------------------------
 * 构建：只依赖「配置」（队伍 / 装备 / 邦布 / 场地）→ 全量条目 + 纯配置键 + 缓存；
 * 消费：按「这次给哪个槽位算」+ 行级例外 + 两个开关筛（`selectEntriesForSlot`）。
 * `collectAllBuffEffects` 签名不变，内部改为「构建 + 筛选」—— 调用点零改动。
 * ============================================================ */

/** 构建层输入：纯配置（不含任何运行期输入） */
export interface BuffBuildConfig {
  masterDataVersion?: string
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  bangboo: BangbooBuffDoc | null
  bangbooRefine: number
  environmentBuffs: EnvironmentBuffEntry[]
  /** 用户侧额外增益（2026-09-24 阶段 3 起并入这份构建） */
  extraGains: ExtraBuffGain[]
}

export interface BuffBuild {
  /** 全量条目（**与"这次给哪个槽位算"无关**；不含额外增益 —— 额外增益仍走自己的收集器） */
  entries: CollectedEffect[]
  /** 只含配置的键 */
  key: string
}

const buffBuildCache = new Map<string, BuffBuild>()
const masterDataVersions = new WeakMap<object, number>()
let masterDataVersionSequence = 0
export function buffMasterDataVersion(input: Pick<BuffBuildConfig, 'agents' | 'wengines' | 'driveDiscs' | 'bangboo'>): string {
  return [input.agents, input.wengines, input.driveDiscs, input.bangboo].map(value => {
    if (!value) return 0
    const raw = toRaw(value)
    let version = masterDataVersions.get(raw)
    if (version == null) { version = ++masterDataVersionSequence; masterDataVersions.set(raw, version) }
    return version
  }).join(',')
}

/** 构建层键：**只含配置**（不得含主角 / 勾选 / 招式上下文 / 行级例外 / 两个开关） */
function buildBuffConfigKey(config: BuffBuildConfig): string {
  return [
    config.masterDataVersion ?? buffMasterDataVersion(config),
    teamSlotsKey(config.teamSlots),
    `${config.bangboo?.id ?? ''},${config.bangbooRefine}`,
    environmentBuffsKey(config.environmentBuffs ?? []),
    stringifyKeyPart(config.extraGains ?? []),
  ].join(KEY_SEP)
}

/**
 * 构建全量条目：对每个槽位各跑一次「把它当作这份面板的归属槽位」的收集，再合并。
 *
 * 合并规则：同一个实效 id 只留一条 —— **优先留"产出它的那一趟 == 它所属槽位"** 的那份
 * （即标签按「自身」写的那一份，下称 canonical），否则留先出现的；
 * 消费侧按 `applicableSlots` 筛，**与"这次给哪个槽位算"无关**。
 */
export function buildBuffCatalog(config: BuffBuildConfig): BuffBuild {
  const key = buildBuffConfigKey(config)
  const cached = buffBuildCache.get(key)
  if (cached) return cached
  const entries: CollectedEffect[] = []
  const indexById = new Map<string, number>()
  /** 每个条目是"哪一趟"产出的（用于 canonical 替换判据：要看趟次，不能只看条目的 providerSlot） */
  const passById: number[] = []
  for (let index = 0; index < config.teamSlots.length; index += 1) {
    const pass = collectForMainSlot({
      teamSlots: config.teamSlots,
      agents: config.agents,
      wengines: config.wengines,
      driveDiscs: config.driveDiscs,
      bangboo: config.bangboo,
      bangbooRefine: config.bangbooRefine,
      environmentBuffs: config.environmentBuffs,
      mainSlotIndex: index,
      restrictToSlotIndex: null,
      excludeBangboo: false,
      rowBuffOverride: null,
    })
    for (const item of pass) {
      const existing = indexById.get(item.effect.id)
      if (existing == null) {
        indexById.set(item.effect.id, entries.length)
        passById.push(index)
        entries.push(item)
        continue
      }
      // canonical 优先：**产出它的那一趟 == 它所属槽位**（即标签按"自身"写的那一份）
      if (index === item.providerSlot && passById[existing] !== item.providerSlot) {
        entries[existing] = item
        passById[existing] = index
      }
    }
  }
  // 额外增益：并入同一份构建（2026-09-24 阶段 3）。**一条底层效果 = 一个条目**（Spec §5.1 第 1 项）；
  // 适用槽位按卡片的 applySlot 折算；来源槽位写进 `extraGainSourceSlot`（providerSlot 仍为 null）；
  // 行级例外由消费侧按 `extra-<id>` 判（键不变）。
  for (const gain of config.extraGains ?? []) {
    const applySlot = resolveExtraGainApplySlot(gain)
    const applicableSlots =
      applySlot === 'team' ? config.teamSlots.map((_, index) => index) : [applySlot]
    for (const effect of extraGainToEffects(gain)) {
      entries.push({
        effect,
        sourceKey: `extra-${gain.id}`,
        sourceLabel: '额外 Buff',
        providerName: gain.name || '额外 Buff',
        providerAvatar: null,
        group: '额外 Buff',
        blockId: gain.id,
        blockName: gain.name || '额外 Buff',
        applicableSlots,
        providerSlot: null,
        extraGainSourceSlot: gain.sourceSlot,
      })
    }
  }
  const build: BuffBuild = { entries, key }
  // 淘汰策略沿用现有行为：超限删最旧
  if (buffBuildCache.size > BUFF_CATALOG_CACHE_LIMIT) {
    const oldest = buffBuildCache.keys().next().value
    if (oldest != null) buffBuildCache.delete(oldest)
  }
  buffBuildCache.set(key, build)
  return build
}

/**
 * 队友视角的展示改写：构建产物按「自己是主角」写标签，被别的槽位消费时改成「队友」。
 * 键是现状里出现过的分组值（来自收集器的 `groupFor` / 驱动盘分支）；表里没有的一律原样保留。
 */
const TEAMMATE_GROUP: Record<string, string> = {
  自身: '队友',
  '全队（含自身）': '队友',
  自身音擎: '队友音擎',
  全队音擎: '队友音擎',
  自身驱动盘: '队友驱动盘',
}

function applyTeammateView(entry: CollectedEffect): CollectedEffect {
  const group = TEAMMATE_GROUP[entry.group] ?? entry.group
  const sourceLabel = entry.sourceLabel.startsWith('自身 · ')
    ? `队友 · ${entry.sourceLabel.slice('自身 · '.length)}`
    : entry.sourceLabel
  if (group === entry.group && sourceLabel === entry.sourceLabel) return entry
  return { ...entry, group, sourceLabel }
}

/**
 * 队友视角改写（对外版）：`自身 → 队友`、`自身音擎 → 队友音擎`、`全队（含自身）→ 队友`…
 *
 * 给「把各槽位收集结果**合并**起来用」的地方（流程增益表 / 本行增益例外弹窗的候选列表）：
 * 合并进来的条目可能来自**别人那次收集**，标签是别人的主视角 —— 直接展示会出现
 * 「南宫的行里，属于雅自己的增益却写着『自身』」。凡 `providerSlot !== 当前槽位` 的条目都要过一次。
 */
export function toTeammateView(entry: CollectedEffect): CollectedEffect {
  return applyTeammateView(entry)
}

/** 行级减法（唯一实现；目录条目与将来的额外增益共用） */
export function isEntryDisabledByRowOverride(
  entry: CollectedEffect,
  override: FlowBuffOverride | null | undefined,
): boolean {
  if (!override) return false
  if ((override.disabledEffectIds ?? []).includes(entry.effect.id)) return true
  return (override.disabledBlockIds ?? []).includes(blockKeyOfCollected(entry))
}

/**
 * 消费层：从构建产物里取"这次给哪个槽位算"要用的条目（唯一筛选入口）。
 *
 * 四条筛规则都照抄现状语义（施工规格 §4）：适用槽位集合 / 2 件套的「只在当主角时」/
 * `restrictToSlotIndex`（无主条目里**场地保留、邦布排除**）/ `excludeBangboo`（按 `bangboo` 前缀）。
 */
function isEffectSourceAllowed(
  item: CollectedEffect,
  slotIndex: number,
  policy: PanelCalcContext['effectSourcePolicy'],
): boolean {
  if (policy !== 'remiel-self-base') return true
  if (item.effect.stat === 'atk') {
    return item.effect.kind === 'convert' && item.sourceKey.startsWith(`agent-${slotIndex}-`)
  }
  if (item.effect.stat === 'mastery') {
    return item.sourceKey.startsWith(`wengine-${slotIndex}-`) ||
      (item.sourceKey.startsWith(`drive-disc-${slotIndex}-4set`) && !item.sourceKey.includes('-4set-2pc'))
  }
  return false
}

export function selectEntriesForSlot(input: {
  build: BuffBuild
  slotIndex: number
  rowBuffOverride?: FlowBuffOverride | null
  restrictToSlotIndex?: number | null
  excludeBangboo?: boolean
  effectSourcePolicy?: PanelCalcContext['effectSourcePolicy']
}): CollectedEffect[] {
  const restrict = input.restrictToSlotIndex ?? null
  const out: CollectedEffect[] = []
  for (const entry of input.build.entries) {
    if (!entry.applicableSlots.includes(input.slotIndex)) continue
    if (!isEffectSourceAllowed(entry, input.slotIndex, input.effectSourcePolicy)) continue
    if (restrict != null) {
      if (entry.providerSlot != null && entry.providerSlot !== restrict) continue
      if (entry.sourceKey.startsWith('bangboo')) continue
    }
    if (input.excludeBangboo && entry.sourceKey.startsWith('bangboo')) continue
    if (isEntryDisabledByRowOverride(entry, input.rowBuffOverride ?? null)) continue
    out.push(entry.providerSlot === input.slotIndex ? entry : applyTeammateView(entry))
  }
  return out
}

/** 收集（对外唯一入口）：**签名与语义保持不变** —— 内部 = 构建 + 筛选 */
export function collectAllBuffEffects(ctx: PanelCalcContext): CollectedEffect[] {
  return selectEntriesForSlot({
    build: buildBuffCatalog({
      masterDataVersion: ctx.masterDataVersion,
      teamSlots: ctx.teamSlots,
      agents: ctx.agents,
      wengines: ctx.wengines,
      driveDiscs: ctx.driveDiscs,
      bangboo: ctx.bangboo ?? null,
      bangbooRefine: ctx.bangbooRefine,
      environmentBuffs: ctx.environmentBuffs ?? [],
      extraGains: ctx.extraGains ?? [],
    }),
    slotIndex: ctx.mainSlotIndex,
    rowBuffOverride: ctx.rowBuffOverride ?? null,
    restrictToSlotIndex: ctx.restrictToSlotIndex ?? null,
    excludeBangboo: ctx.excludeBangboo ?? false,
    effectSourcePolicy: ctx.effectSourcePolicy,
  })
}

/** 额外 Buff 的稳定块键（显示与行级过滤必须用同一个，否则表里关得掉、结算里关不掉） */
export function extraGainBlockKey(gainId: string): string {
  return `extra-${gainId}`
}

/** 效果块的稳定键（与目录一致：`${sourceKey}-${blockId}`；邦布为 `bangboo`；额外 Buff 为 `extra-<id>`） */
export function blockKeyOfCollected(item: CollectedEffect): string {
  const blockId = (item as unknown as { blockId?: string | null }).blockId ?? ''
  // 额外 Buff：sourceKey 本身就是 `extra-<id>`，不再拼 blockId（否则拼成 `extra-x-x`）
  if (item.sourceKey.startsWith('extra-')) return item.sourceKey
  return item.sourceKey.startsWith('bangboo') ? 'bangboo' : `${item.sourceKey}-${blockId}`
}

/**
 * 收集条目的**来源槽位**（Spec §5.1 第 4 项）。
 *
 * 额外 Buff 用收集时写入的 `extraGainSourceSlot`；普通增益仍按 sourceKey 解析。
 * 缺元数据返回 null（调用方按"来源不可用"处理，不回落当前受益槽位）。
 */
export function resolveCollectedEffectSourceSlot(item: CollectedEffect): number | null {
  if (item.sourceKey.startsWith('extra-')) return item.extraGainSourceSlot ?? null
  return parseSourceKeySlotIndex(item.sourceKey)
}

/**
 * 局内 Buff 选择器只列普通增益（Spec §4.3 第 3 项、§5.1 第 6 项）：
 * 额外 Buff 由自己的模块管理，不进选择器列表（流程表仍按同一收集走）。
 */
export function excludeExtraGainEntries(
  items: readonly CollectedEffect[],
): CollectedEffect[] {
  return items.filter((item) => !item.sourceKey.startsWith('extra-'))
}

function mergeModsFromSources(sources: BuffModSource[]): BuffStatModifiers {
  let total = createEmptyBuffStatModifiers()
  for (const source of sources) {
    total = mergeBuffStatModifiers(total, source.mods)
  }
  return total
}

type BuffCatalogPackKind = 'slot' | 'bangboo' | 'env' | 'extra'

type BuffCatalogPack = {
  kind: BuffCatalogPackKind
  key: string
  label: string
  note?: string
  blockName?: string
  effects: BuffEffect[]
  nonConvertEffects: BuffEffect[]
  convertEffects: BuffEffect[]
  slotIndex?: number
  sourceOptions?: PackSourceOptions
}

type BuffCatalogEntry = {
  packs: BuffCatalogPack[]
  nonConvertModsByPackKey: Record<string, BuffStatModifiers>
  nonConvertMods?: BuffStatModifiers
  /**
   * 该目录条目里是否存在**转模运算包**（`pack.convertEffects.length > 0`）。
   *
   * 纯结构标记，由 `makeCatalogEntryFromSources` 建条目时按包算一次（包和 `convertEffects`
   * 在条目建立后不再变），命中路径直接读，省掉每次命中重扫 `packs`。
   *
   * 它与「上一次转模算出来是不是 0」**无关**：有转模包就必须照常实时求值，
   * 不能拿"上次结果 0"当成"本目录没有转模"（Spec §4.3.3）。
   */
  hasConvertPacks: boolean
}

const buffCatalogCache = new Map<string, BuffCatalogEntry>()
/**
 * 缓存条数上限。
 *
 * 实测（2026-09-10，42 招式 / 3 人队 / 主 C 派派）：
 * **单次评估会产生 138 个不同的缓存键**（每条目 × 每个结算槽位各占一条），
 * 且相邻两次评估的键**完全相同**。旧上限 128 小于工作集 → LRU 颠簸：
 * 键在被复用前就被淘汰，于是每次评估稳定 **123 次未命中**，
 * 每次未命中都要重跑整套 buff 效果收集（collectAllBuffEffects → 克隆 → 合并）。
 * 上限提到工作集之上后，第 2 次起未命中降到 ~0。
 */
const BUFF_CATALOG_CACHE_LIMIT = 1024

/** 目录文档（角色/音擎/邦布/驱动盘）内容变更后须调用，避免同 ID 命中旧效果 */
export function invalidateBuffCatalogCache() {
  buffCatalogCache.clear()
  // 构建层缓存（2026-09-24 起）也要清：定义库变了，构建产物就失效
  buffBuildCache.clear()
  // 部件记忆化一并清：属防御性处理（已核对 src/ 内无调用方就地修改这些对象，
  // 因此当前不会因不清而出现可复现的错误）。留着是为了让「就地改 + 失效」这条
  // 契约即使将来被误用也仍然成立。
  clearBuffCatalogKeyPartCaches()
}

function touchBuffCatalogEntry(key: string, entry: BuffCatalogEntry) {
  buffCatalogCache.delete(key)
  buffCatalogCache.set(key, entry)
}

/**
 * 目录缓存/转模收集的**真实执行路径**计数（回归观察用，不属于业务逻辑）。
 *
 * 用途只有一个：让 `scripts/test-buff-catalog-empty-convert.mjs` 能断言
 * 「目录命中且没有转模包时，不再执行空转模收集再全字段空合并」，
 * 而不是靠 mock 或预设计数证明（Spec §4.3.2 / §6 B1）。
 *
 * 不是计时、不是性能测量工具：只在真实调用点上 +1，不记录耗时。
 */
export const buffCatalogCacheDebugCounters = {
  /** `collectConvertOnlyMods` 的真实调用次数（只有存在转模包时才允许增长） */
  convertCollectCalls: 0,
  /** 「目录命中 + 条目里一个转模包都没有」的短路次数 */
  emptyConvertShortCircuits: 0,
  /** 目录未命中次数（合法冷算：必须照常重算，不得算成重复工作） */
  catalogMisses: 0,
  /** 进入正式追踪分支的次数（追踪路径不走跨轮缓存） */
  tracedCalls: 0,
}

/** 清零上面的计数（测试用；不影响任何缓存内容） */
export function resetBuffCatalogCacheDebugCounters() {
  buffCatalogCacheDebugCounters.convertCollectCalls = 0
  buffCatalogCacheDebugCounters.emptyConvertShortCircuits = 0
  buffCatalogCacheDebugCounters.catalogMisses = 0
  buffCatalogCacheDebugCounters.tracedCalls = 0
}

function splitConvertEffects(effects: BuffEffect[]) {
  const nonConvertEffects: BuffEffect[] = []
  const convertEffects: BuffEffect[] = []
  for (const effect of effects) {
    if (effect.kind === 'convert') convertEffects.push(effect)
    else nonConvertEffects.push(effect)
  }
  return { nonConvertEffects, convertEffects }
}

/**
 * 缓存键的部件级记忆化。
 *
 * 实测（2026-09-10）：单次评估要构建 ~800 次缓存键，而键的部件对象
 * （buffSelection / extraMods / skillContext）是同一批对象反复出现。
 * 按**对象身份**记住序列化结果，同一对象只 stringify 一次。
 *
 * 与本文件既有契约一致：内容变更（就地改文档对象）本就必须调用
 * `invalidateBuffCatalogCache()` 才生效（见 scripts/test-buff-catalog-cache.mjs）。
 *
 * **已知边界**：记忆化后键不再随这些对象的**内容**变化（只随身份）。
 * 契约内的做法不受影响；契约外「就地改而不失效」在 skipConvert=true 下会返回旧值，
 * 而修复前会因键变化意外重算。已核对 `src/` 内无就地修改这些对象的调用方（2026-09-10）。
 */
let partKeyCache = new WeakMap<object, string>()

function stringifyKeyPart(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  const cached = partKeyCache.get(value as object)
  if (cached !== undefined) return cached
  const serialized = JSON.stringify(value)
  partKeyCache.set(value as object, serialized)
  return serialized
}

/** 用 NUL 拼接：JSON 输出里控制字符一律转义成 `\u0000`，不会与分隔符混淆 */
const KEY_SEP = '\u0000'

/**
 * 槽位键 / 环境键**不做按对象身份的记忆化**。
 *
 * 曾尝试过（2026-09-10）：用 WeakMap 按 `ctx.teamSlots` 数组身份缓存序列化结果，
 * 理由是「一次求解调用 8 万次、每次都重建键」。**实测证明这是错的**：
 * 真实 UI 里 `DamageCalcPage.vue` 的 `teamSlots` 是 `reactive()` 数组，
 * 全生命周期只有一个实例，换人/换音擎/改影画都是**就地赋值**；而
 * `buildOptimalEvalContext` 里的 `deepUnwrapReactive` 用的是 `toRaw`，
 * **不改变数组身份**。于是按身份缓存会把槽位键永久冻结在首次计算那一刻。
 *
 * 实测证据（scripts/probe-inplace-team-mutation.mjs，真实方案）：
 *   队友影画 0→6：真值 62114191 → 71083794，就地路径 62114191 → 62114191（错，不更新）
 *   队友影画 6→0：真值 71083794 → 62114191，就地路径 71083794 → 71083794（错，不更新）
 *   队友 4 件套： 真值 58731561 → 58891841，就地路径 58731561 → 58731561（错，不更新）
 *
 * 而该记忆化本身几乎没有收益（剖析：`buildBuffCatalogKey` 子树占比 16.7% → 17.5%，
 * 噪音级）。真正的收益来自「按需计算转模源值」（见 PanelSourceValuesBySlotMap）。
 */
function teamSlotsKey(teamSlots: readonly TeamSlot[]): string {
  return teamSlots
    .map((slot) =>
      [
        slot.agentId,
        slot.rank,
        slot.wengineId,
        slot.wengineRefine,
        slot.twoPieceDriveDiscId,
        slot.fourPieceDriveDiscId,
      ].join(','),
    )
    .join(';')
}

/**
 * 环境 Buff 的键必须含**内容**，不能只用 `sourceKey`。
 *
 * 缺陷与实测（2026-09-11，`scripts/test-env-buff-cache-key.mjs`）：
 * 只要 `sourceKey` 不变，同一 effect 的数值从 +30% 改成 +60% 也不换键 ——
 * 面板与词条两条链路都会继续用旧 mods（实测两次都是 1484，应更高）。
 *
 * 与 `teamSlotsKey` 一样**不做按对象身份的记忆化**（原因见上方注释：
 * 真实 UI 里集合被就地赋值，按身份缓存会把键冻结在首次计算那一刻）。
 */
function environmentBuffsKey(environmentBuffs: readonly EnvironmentBuffEntry[]): string {
  if (!environmentBuffs.length) return ''
  return JSON.stringify(environmentBuffs)
}

/** 缓存清空时一并丢弃按键对象身份记忆化的部件，避免旧契约下的陈旧串留存 */
export function clearBuffCatalogKeyPartCaches() {
  partKeyCache = new WeakMap()
}

/**
 * 行级例外的稳定令牌（进目录缓存键）。
 *
 * - 同一例外必须得到**同一个键**：集合内容相同但写入顺序不同（UI 勾选顺序）也要同键，
 *   否则缓存永不命中 —— 所以先排序再拼。
 * - 不同例外必须得到**不同键**：这正是它必须进缓存键的原因，否则跨行串味。
 */
function rowBuffOverrideKey(override: FlowBuffOverride | null | undefined): string {
  if (!override) return ''
  const blocks = [...(override.disabledBlockIds ?? [])].sort()
  const effects = [...(override.disabledEffectIds ?? [])].sort()
  const stacks = Object.entries(override.stacksByEffectId ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, n]) => `${id}:${n}`)
  const converts = Object.entries(override.convertInputsByEffectId ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, n]) => `${id}:${n}`)
  if (!blocks.length && !effects.length && !stacks.length && !converts.length) return ''
  return [blocks.join(','), effects.join(','), stacks.join(','), converts.join(',')].join('|')
}

/**
 * 行级例外携带的层数 / 转模覆盖，覆盖合并到全局勾选状态上（行级优先）。
 * 没有任何覆盖键时返回 null —— 调用方直接沿用全局映射，零开销。
 */
export function rowBuffSelectionOverlay(
  rowOverride: FlowBuffOverride | null | undefined,
  selection: BuffSelectionState | null | undefined,
): { stacksByEffectId?: Record<string, number>; convertInputs?: Record<string, number> } | null {
  const stacks = rowOverride?.stacksByEffectId
  const converts = rowOverride?.convertInputsByEffectId
  const hasStacks = !!stacks && Object.keys(stacks).length > 0
  const hasConverts = !!converts && Object.keys(converts).length > 0
  if (!hasStacks && !hasConverts) return null
  return {
    stacksByEffectId: hasStacks
      ? { ...selection?.stacksByEffectId, ...stacks }
      : selection?.stacksByEffectId,
    convertInputs: hasConverts
      ? { ...selection?.convertInputs, ...converts }
      : selection?.convertInputs,
  }
}

function buildBuffCatalogKey(ctx: PanelCalcContext): string {
  // 注意：这里**不能**用外层 JSON.stringify 包住这些部件 —— 那会把已经序列化好的
  // 字符串再转义一遍，部件级记忆化就白做了（2026-09-10 实测：那样反而略慢）。
  const slotsKey = teamSlotsKey(ctx.teamSlots)
  const bangbooKey = `${ctx.bangboo?.id ?? ''},${ctx.bangbooRefine},${ctx.excludeBangboo ? 1 : 0}`
  const envKey = environmentBuffsKey(ctx.environmentBuffs ?? [])
  return [
    ctx.masterDataVersion ?? buffMasterDataVersion(ctx),
    slotsKey,
    bangbooKey,
    String(ctx.mainSlotIndex),
    String(ctx.restrictToSlotIndex ?? ''),
    ctx.effectSourcePolicy ?? '',
    stringifyKeyPart(ctx.extraGains ?? null),
    stringifyKeyPart(ctx.buffSelection ?? null),
    stringifyKeyPart(ctx.skillContext ?? null),
    envKey,
    // 行级例外也是"这一行算出来的清单"的输入之一，必须进键：
    // 同一例外重复求值 → 命中；不同例外 → 各自成键，天然隔离（不跨行串味）
    rowBuffOverrideKey(ctx.rowBuffOverride),
  ].join(KEY_SEP)
}

function packsFromSources(sources: BuffModSource[]): BuffCatalogPack[] {
  return sources.map((source) => {
    const effects = source.effects ?? []
    const split = splitConvertEffects(effects)
    if (source.key === 'extra') {
      return {
        kind: 'extra',
        key: source.key,
        label: source.label,
        effects: [],
        nonConvertEffects: [],
        convertEffects: [],
      }
    }
    if (source.key === 'bangboo') {
      return {
        kind: 'bangboo',
        key: source.key,
        label: source.label,
        blockName: source.blockName,
        effects,
        ...split,
      }
    }
    const slotIndex = parseSourceKeySlotIndex(source.key)
    if (slotIndex != null) {
      return {
        kind: 'slot',
        key: source.key,
        label: source.label,
        note: source.note,
        blockName: source.blockName,
        effects,
        slotIndex,
        ...split,
      }
    }
    return {
      kind: 'env',
      key: source.key,
      label: source.label,
      note: source.note,
      blockName: source.blockName,
      effects,
      sourceOptions: source.sourceOptions,
      ...split,
    }
  })
}

function resolvePackEffectMods(
  pack: BuffCatalogPack,
  effects: BuffEffect[],
  ctx: PanelCalcContext,
  skipConvert: boolean,
): BuffStatModifiers {
  // 额外增益不再单独折包（阶段 3.3）：它的效果由统一收集产出，这里只保留“包”的形状
  if (pack.kind === 'extra') return createEmptyBuffStatModifiers()
  const skillCtx = ctx.skillContext ?? defaultSkillContext('direct')
  if (pack.kind === 'bangboo') {
    if (!effects.length) return createEmptyBuffStatModifiers()
    return resolvePackModsViaEffectSpec(effects, true, {
      ...ctx,
      skillContext: skillCtx,
      skipConvert,
    }, ctx.mainSlotIndex)
  }
  if (!effects.length) return createEmptyBuffStatModifiers()
  const isMain = pack.kind !== 'slot' || pack.slotIndex === ctx.mainSlotIndex
  return resolvePackModsViaEffectSpec(
    effects,
    isMain,
    { ...ctx, skillContext: skillCtx, skipConvert },
    pack.slotIndex,
    pack.sourceOptions,
  )
}

function ensureNonConvertMods(entry: BuffCatalogEntry, ctx: PanelCalcContext) {
  if (entry.nonConvertMods) return
  let merged = createEmptyBuffStatModifiers()
  for (const pack of entry.packs) {
    let mods = entry.nonConvertModsByPackKey[pack.key]
    if (!mods) {
      mods = resolvePackEffectMods(pack, pack.nonConvertEffects, ctx, true)
      entry.nonConvertModsByPackKey[pack.key] = mods
    }
    merged = mergeBuffStatModifiers(merged, mods)
  }
  entry.nonConvertMods = merged
}

function collectConvertOnlyMods(packs: BuffCatalogPack[], ctx: PanelCalcContext): BuffStatModifiers {
  buffCatalogCacheDebugCounters.convertCollectCalls += 1
  let total = createEmptyBuffStatModifiers()
  for (const pack of packs) {
    if (!pack.convertEffects.length) continue
    total = mergeBuffStatModifiers(
      total,
      resolvePackEffectMods(pack, pack.convertEffects, ctx, false),
    )
  }
  return total
}

function materializeBuffCatalogPacks(
  entry: BuffCatalogEntry,
  ctx: PanelCalcContext,
): BuffModSource[] {
  ensureNonConvertMods(entry, ctx)
  return entry.packs.map((pack) => {
    const nonConvert =
      entry.nonConvertModsByPackKey[pack.key] ?? createEmptyBuffStatModifiers()
    const mods = ctx.skipConvert
      ? nonConvert
      : pack.convertEffects.length
        ? mergeBuffStatModifiers(
            nonConvert,
            resolvePackEffectMods(pack, pack.convertEffects, ctx, false),
          )
        : nonConvert
    return {
      key: pack.key,
      label: pack.label,
      note: pack.note,
      blockName: pack.blockName,
      effects: pack.effects,
      mods,
      sourceOptions: pack.sourceOptions,
    }
  })
}

function rememberBuffCatalogEntry(key: string, entry: BuffCatalogEntry) {
  touchBuffCatalogEntry(key, entry)
  if (buffCatalogCache.size <= BUFF_CATALOG_CACHE_LIMIT) return
  const oldest = buffCatalogCache.keys().next().value
  if (oldest != null) buffCatalogCache.delete(oldest)
}

function makeCatalogEntryFromSources(
  sources: BuffModSource[],
  ctx: PanelCalcContext,
): BuffCatalogEntry {
  const packs = packsFromSources(sources)
  const entry: BuffCatalogEntry = {
    packs,
    nonConvertModsByPackKey: {},
    hasConvertPacks: packs.some((pack) => pack.convertEffects.length > 0),
  }
  if (ctx.skipConvert) {
    for (const source of sources) {
      entry.nonConvertModsByPackKey[source.key] = source.mods
    }
    entry.nonConvertMods = mergeModsFromSources(sources)
  }
  return entry
}

export function collectPanelBuffModSources(ctx: PanelCalcContext): BuffModSource[] {
  if (ctx.trace) return collectPanelBuffSourcesTraced(ctx)
  // 行级例外已并入缓存键（`rowBuffOverrideKey`）：同一例外命中缓存，不同例外各自成键，
  // 因此这里**不再**需要绕开目录缓存。
  const key = buildBuffCatalogKey(ctx)
  const cached = buffCatalogCache.get(key)
  if (cached) {
    touchBuffCatalogEntry(key, cached)
    return materializeBuffCatalogPacks(cached, ctx)
  }
  const sources = collectPanelBuffModSourcesUncached(ctx)
  rememberBuffCatalogEntry(key, makeCatalogEntryFromSources(sources, ctx))
  return sources
}

function collectPanelBuffModSourcesUncached(
  ctx: PanelCalcContext,
  traceOptions?: {
    /** 追踪：不因「本包没有非零 mods」丢掉包（否则未命中/零值候选就没有状态记录） */
    keepEmpty?: boolean
    /** 追踪：按包键归并被前置排除的候选，交给同一判定循环报告状态 */
    excludedByGroupKey?: Map<string, { effects: BuffEffect[]; slotIndex: number | null }>
  },
): BuffModSource[] {
  const skillCtx = ctx.skillContext ?? defaultSkillContext('direct')
  const ctxForResolve: PanelCalcContext = { ...ctx, skillContext: skillCtx }
  const sources: BuffModSource[] = []
  const grouped = new Map<string, CollectedEffect[]>()

  for (const item of collectAllBuffEffects(ctx)) {
    const key = item.sourceKey.startsWith('bangboo')
      ? 'bangboo'
      : `${item.sourceKey}-${item.blockId}`
    const list = grouped.get(key)
    if (list) list.push(item)
    else grouped.set(key, [item])
  }

  for (const [key, items] of grouped) {
    const first = items[0]
    if (!first) continue
    const effects = items.map((item) => item.effect)
    const slotIndex = key === 'bangboo' ? ctx.mainSlotIndex : parseSourceKeySlotIndex(first.sourceKey)
    const isMain = slotIndex == null || slotIndex === ctx.mainSlotIndex
    /**
     * 额外 Buff：受益槽位由 `applicableSlots` 决定，**来源槽位**由卡片单独给（Spec §5.1 第 4 项）。
     * 来源不可用时按显式零值算，不回退到受益槽位的面板（§5.2 第 6 项）。
     */
    const baseOptions = sourceOptionsForCollectedEffect(first, ctx, effects)
    const excludedEffects = traceOptions?.excludedByGroupKey?.get(key)?.effects
    const sourceOptions =
      excludedEffects?.length
        ? { ...(baseOptions ?? {}), traceExcludedEffects: excludedEffects }
        : baseOptions
    const mods = resolvePackModsViaEffectSpec(
      effects,
      isMain,
      ctxForResolve,
      slotIndex ?? undefined,
      sourceOptions,
    )
    if (!traceOptions?.keepEmpty && !hasNonZeroBuffMods(mods) && !effects.length && !first.blockNote) continue
    sources.push({
      key,
      label: first.sourceLabel,
      mods,
      effects,
      blockName: first.blockName,
      note: first.blockNote || undefined,
      sourceOptions,
    })
  }

  // 追踪：只被排除、没有有效候选的包也要留下（否则禁用块的状态记录会消失）
  for (const [key, excluded] of traceOptions?.excludedByGroupKey ?? []) {
    if (grouped.has(key)) continue
    if (!excluded.effects.length) continue
    const slotIndex = key === 'bangboo' ? ctx.mainSlotIndex : excluded.slotIndex
    // 直接走判定循环（`resolvePackModsViaEffectSpec` 对空 effects 会提前返回，
    // 那样排除项就永远拿不到状态记录）
    const mods = resolvePackMods(
      [],
      slotIndex == null || slotIndex === ctx.mainSlotIndex,
      ctxForResolve,
      slotIndex ?? undefined,
      { traceExcludedEffects: excluded.effects },
    )
    sources.push({
      key,
      label: '',
      mods,
      effects: [],
      sourceOptions: { traceExcludedEffects: excluded.effects },
    })
  }

  const mainIndex = ctx.mainSlotIndex
  ctx.teamSlots.forEach((slot, index) => {
    if (ctx.restrictToSlotIndex != null && index !== ctx.restrictToSlotIndex) return
    if (!slot.agentId) return
    const agent = ctx.agents.find((item) => item.id === slot.agentId)
    if (!agent) return
    const clampedRank = Math.min(6, Math.max(0, Math.round(slot.rank)))
    const roleLabel = index === mainIndex ? '自身' : '队友'
    for (let rank = 0; rank <= clampedRank; rank++) {
      const note = getMindscapeNote(agent, rank)
      if (!note) continue
      const rankBuffs = agent.mindscapeBuffs[rank] ?? createEmptySelfTeamBuffs()
      if (collectBlockEntriesFromPack(rankBuffs).length) continue
      sources.push({
        key: `agent-${index}-${rank}`,
        label: `${roleLabel} · ${agent.name} · ${rank}影`,
        mods: createEmptyBuffStatModifiers(),
        note,
        effects: [],
      })
    }
  })

  return sources
}

export function collectPanelBuffMods(ctx: PanelCalcContext): BuffStatModifiers {
  // 带追踪时不走跨轮缓存：记录必须来自本次正式运算（缓存的 mods 里没有逐效果身份）。
  // 两边的数值由同一批函数产出，K8 逐属性比对保证相等。
  if (ctx.trace) {
    buffCatalogCacheDebugCounters.tracedCalls += 1
    return collectPanelBuffModsTraced(ctx)
  }
  // 行级例外已并入缓存键（`rowBuffOverrideKey`），与 collectPanelBuffModSources 统一走缓存：
  // 同一例外命中缓存、不同例外各自成键。此前"带例外绕开缓存"的写法已删（每次求值重建整份清单，
  // 2026-09-22 实测：42 行全带例外时单次评估 3.76 → 24.42 ms）。
  const key = buildBuffCatalogKey(ctx)
  let entry = buffCatalogCache.get(key)
  if (!entry) {
    buffCatalogCacheDebugCounters.catalogMisses += 1
    const sources = collectPanelBuffModSourcesUncached(ctx)
    entry = makeCatalogEntryFromSources(sources, ctx)
    rememberBuffCatalogEntry(key, entry)
    if (ctx.skipConvert) {
      ensureNonConvertMods(entry, ctx)
      return entry.nonConvertMods ?? mergeModsFromSources(sources)
    }
    return mergeModsFromSources(sources)
  }
  touchBuffCatalogEntry(key, entry)
  ensureNonConvertMods(entry, ctx)
  if (ctx.skipConvert) return entry.nonConvertMods ?? createEmptyBuffStatModifiers()
  /**
   * 目录命中、且该条目里**一个转模运算包都没有**：`collectConvertOnlyMods` 只能返回全 0，
   * 再拿它做一次全字段合并（`createEmptyBuffStatModifiers()` + 逐字段加法，返回新对象）
   * 是纯浪费 —— 直接交出非转模合并结果本身（Spec §4.3.2）。
   *
   * 判据是**条目结构**（建条目时算好的 `hasConvertPacks`），不是"上次转模算出来是 0"：
   * 只要存在转模包就照常走下面的实时求值，源值 0 → 1000 必须跟着变（Spec §4.3.3）。
   *
   * 返回值共享说明：`entry.nonConvertMods` 是目录条目持有的对象，与 `skipConvert=true`
   * 命中原有的返回语义一致。消费者审计（`scripts/test-buff-catalog-empty-convert.mjs` 文件头）
   * 覆盖了生产侧全部 3 个调用点及其后续落点：没有任何写入方，因此不复制。
   */
  if (!entry.hasConvertPacks) {
    buffCatalogCacheDebugCounters.emptyConvertShortCircuits += 1
    return entry.nonConvertMods ?? createEmptyBuffStatModifiers()
  }
  return mergeBuffStatModifiers(
    entry.nonConvertMods ?? createEmptyBuffStatModifiers(),
    collectConvertOnlyMods(entry.packs, ctx),
  )
}

/**
 * 带追踪的 mods 求值：与缓存路径用**同一批**包解析函数（`resolvePackModsViaEffectSpec` →
 * `resolvePackMods` → `resolveEffectsToMods`），只是不读跨轮缓存、并保留未命中包。
 *
 * 前置排除的候选按包键并入同一判定循环，由 `excludedByEffectId` 短路报告状态。
 */
function collectPanelBuffModsTraced(ctx: PanelCalcContext): BuffStatModifiers {
  return mergeModsFromSources(collectPanelBuffSourcesTraced(ctx))
}

function collectPanelBuffSourcesTraced(ctx: PanelCalcContext): BuffModSource[] {
  const excludedByGroupKey = new Map<string, { effects: BuffEffect[]; slotIndex: number | null }>()
  const excludedMap: Record<string, 'disabled' | 'source-excluded'> = {}
  const candidates = collectEventCandidateEffects(ctx)
  const traceIdentities = new Map([
    ...candidates.items.map(item => [item.effect.id, item] as const),
    ...candidates.excluded.map(({ item }) => [item.effect.id, item] as const),
  ])
  for (const entry of candidates.excluded) {
    const groupKey = entry.item.sourceKey.startsWith('bangboo')
      ? 'bangboo'
      : `${entry.item.sourceKey}-${entry.item.blockId}`
    const bucket = excludedByGroupKey.get(groupKey)
    if (bucket) bucket.effects.push(entry.item.effect)
    else
      excludedByGroupKey.set(groupKey, {
        effects: [entry.item.effect],
        slotIndex: resolveCollectedEffectSourceSlot(entry.item),
      })
    excludedMap[entry.item.effect.id] = entry.reason
  }
  const ctxForResolve: PanelCalcContext = { ...ctx, traceExcluded: excludedMap, traceIdentities }
  const sources = collectPanelBuffModSourcesUncached(ctxForResolve, {
    keepEmpty: true,
    excludedByGroupKey,
  })
  return sources
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
    sharpenCritDmgBonus: externalPanel.sharpenCritDmgBonus ?? 0,
    dmgBonus: externalPanel.dmgBonus + mods.dmgBonus + mods.skillDmgBonus,
    ignoreDefense: externalPanel.ignoreDefense,
    reduceDefense: externalPanel.reduceDefense + mods.reduceDefense,
    penRate: externalPanel.penRate + mods.penRate,
    pen: externalPanel.pen,
    resPen: externalPanel.resPen + mods.resPen,
    // 冲击力不进乘区、也没有任何增益改它：原样带过去，局内转模（青衣）才读得到
    impact: externalPanel.impact ?? 0,
    mastery: externalPanel.mastery + mods.mastery,
    // 异常掌控是**唯一保留整数**的属性：局外已是整数，加上固定值/百分比后再舍弃小数
    //（游戏口径是「舍弃」不是四舍五入）。不 floor 的话小数会流进转模，
    // 算出 (209.76 − 155) × 0.7 = 38.332 这种暴击率（2026-10-18 用户指出）。
    anomalyControl: Math.floor(
      externalPanel.anomalyControl +
        mods.anomalyControl +
        (baseAnomalyControl * mods.anomalyControlPercent) / 100,
    ),
    energyRegen:
      externalPanel.energyRegen +
      (baseEnergyRegen * mods.energyRegen) / 100 +
      mods.energyRegenFlat,
    attributeAnomalyCritRate: externalPanel.attributeAnomalyCritRate + mods.attributeAnomalyCritRate,
    // 子类暴击**各自独立**：每类只吃「自己的局外面板值 + 自己的增益」，彼此没有父类。
    // 2026-10-18 前这里错写成 externalPanel.anomalyCrit*（把异常暴击当父类），
    // 与下方异放（anomalyReleaseCrit*）、上方异常（anomalyCrit*）的写法不一致；
    // 今天 externalPanel 里这六格恒为 0，所以改前改后数字相同，只是把结构摆正。
    turbulenceCritRate: externalPanel.turbulenceCritRate + mods.turbulenceCritRate,
    turbulenceCritDmg: externalPanel.turbulenceCritDmg + mods.turbulenceCritDmg,
    radianceCritRate: externalPanel.radianceCritRate + mods.radianceCritRate,
    radianceCritDmg: externalPanel.radianceCritDmg + mods.radianceCritDmg,
    disorderCritRate: externalPanel.disorderCritRate + mods.disorderCritRate,
    disorderCritDmg: externalPanel.disorderCritDmg + mods.disorderCritDmg,
    attributeAnomalyCritDmg: externalPanel.attributeAnomalyCritDmg + mods.attributeAnomalyCritDmg,
    attributeAnomalyDmgBonus: externalPanel.attributeAnomalyDmgBonus + mods.attributeAnomalyDmgBonus,
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
    attributeAnomalyMult: externalPanel.attributeAnomalyMult + mods.attributeAnomalyMult,
    disorderBaseMult: externalPanel.disorderBaseMult + mods.disorderBaseMult,
    anomalyDuration: externalPanel.anomalyDuration + mods.anomalyDuration,
    disorderCompMult: externalPanel.disorderCompMult + mods.disorderCompMult,
    turbulenceBaseMult: externalPanel.turbulenceBaseMult + mods.turbulenceBaseMult,
    turbulenceCompMult: externalPanel.turbulenceCompMult + mods.turbulenceCompMult,
    disorderDmgBonus: externalPanel.disorderDmgBonus + mods.disorderDmgBonus,
    turbulenceDmgBonus: externalPanel.turbulenceDmgBonus + mods.turbulenceDmgBonus,
    radianceMult: externalPanel.radianceMult + mods.radianceMult,
    radianceDmgBonus: externalPanel.radianceDmgBonus + mods.radianceDmgBonus,
    radianceResPen: externalPanel.radianceResPen + mods.radianceResPen,
    specialMult: (externalPanel.specialMult ?? 100) + mods.specialMult,
    mutationCoeff: (Number(externalPanel.mutationCoeff) || 0) + (mods.mutationCoeff || 0),
    directDmgMultFactor: combineMultFactorPercent(
      externalPanel.directDmgMultFactor,
      mods.directDmgMultFactor,
    ),
    attributeAnomalyMultFactor: combineMultFactorPercent(
      externalPanel.attributeAnomalyMultFactor,
      mods.attributeAnomalyMultFactor,
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
    radianceMultFactor: combineMultFactorPercent(
      externalPanel.radianceMultFactor,
      mods.radianceMultFactor,
    ),
    specialMultFactor: combineMultFactorPercent(
      externalPanel.specialMultFactor ?? 100,
      mods.specialMultFactor,
    ),
    mutationCoeffFactor: combineMultFactorPercent(
      externalPanel.mutationCoeffFactor,
      mods.mutationCoeffFactor,
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
    // 冲击力取自面板（转模来源属性）；extras 里有明确值时优先（转模角色单独录入的那份）
    impact: extras.impact ?? panel.impact ?? 0,
    level: extras.level ?? 60,
    ...extras,
  }
}

export function extractCombatMods(mods: BuffStatModifiers): CombatBuffMods {
  return {
    vulnerable: mods.vulnerable,
    directVulnerable: mods.directVulnerable,
    anomalyVulnerable: mods.anomalyVulnerable,
    dmgReduction: mods.dmgReduction,
    directDmgReduction: mods.directDmgReduction,
    anomalyDmgReduction: mods.anomalyDmgReduction,
    globalStaggerVulnerable: mods.globalStaggerVulnerable,
    staggerVulnerable: mods.staggerVulnerable,
    staggerVulnerableOnly: mods.staggerVulnerableOnly,
    special: mods.special,
    pierceDmgBonus: mods.pierceDmgBonus,
    sharpenDmgBonus: mods.sharpenDmgBonus,
    sharpenCritDmgBonus: mods.sharpenCritDmgBonus,
    dmgPenalty: mods.dmgPenalty,
    custom: { ...(mods.custom ?? {}) },
  }
}

/**
 * 主 C 异放倍率：局外基础 + 增益；仅异放倍率类增益按产生角色属性（elementFilter）筛选。
 */
const RELEASE_MULT_STATS = new Set<string>([
  'anomalyReleaseMult',
  'anomalyReleaseMultFactor',
])

/** 异放结算上下文：子类固定异放，元素参数由事件的共享解析入口提供。 */
function buildReleaseMultSkillContext(
  ctx: PanelCalcContext,
  triggerElement?: string,
): SkillCalcContext {
  return {
    ...(ctx.skillContext ?? defaultSkillContext('anomaly', triggerElement)),
    damageKind: 'anomaly',
    anomalySubKind: 'anomalyRelease',
    element: triggerElement,
    // 这里是「异放结算」而不是面板汇总，带伤害类型条件的效果要能命中。
    generic: false,
  }
}

function resolveReleaseMultMods(ctx: PanelCalcContext, skillCtx: SkillCalcContext, onlyConvert = false): { mods: BuffStatModifiers; convertMods: BuffStatModifiers } {
  const candidates = collectEventCandidateEffects({ ...ctx, skillContext: skillCtx })
  const qualifies = (item: CollectedEffect) => RELEASE_MULT_STATS.has(item.effect.stat) && (!onlyConvert || item.effect.kind === 'convert')
  const items = candidates.items.filter(qualifies)
  const excluded = candidates.excluded.filter(({ item }) => qualifies(item))
  const all = ctx.trace ? [...items, ...excluded.map(entry => entry.item)] : items
  const bySource = new Map<string, CollectedEffect[]>()
  for (const item of all) {
    const key = item.sourceKey + '-' + item.blockId
    const group = bySource.get(key)
    if (group) group.push(item)
    else bySource.set(key, [item])
  }
  const resolveContext: PanelCalcContext = { ...ctx, skillContext: skillCtx,
    traceIdentities: new Map(all.map(item => [item.effect.id, item])),
    traceExcluded: Object.fromEntries(excluded.map(({item,reason}) => [item.effect.id,reason])),
  }
  let mods = createEmptyBuffStatModifiers()
  let convertMods = createEmptyBuffStatModifiers()
  for (const group of bySource.values()) for (const convert of [false, true]) {
    const selected = group.filter(item => (item.effect.kind === 'convert') === convert)
    if (!selected.length) continue
    const allowed = selected.filter(item => !resolveContext.traceExcluded?.[item.effect.id])
    const effects = allowed.map(item => item.effect)
    const first = selected[0]!
    const sourceOptions = { ...sourceOptionsForCollectedEffect(first, resolveContext, effects),
      traceExcludedEffects: selected.filter(item => resolveContext.traceExcluded?.[item.effect.id]).map(item => item.effect),
    }
    const resolve = effects.length ? resolvePackModsViaEffectSpec : resolvePackMods
    const result = resolve(effects, first.providerSlot == null || first.providerSlot === ctx.mainSlotIndex,
      resolveContext, first.providerSlot ?? undefined, sourceOptions)
    mods = mergeBuffStatModifiers(mods, result)
    if (convert) convertMods = mergeBuffStatModifiers(convertMods, result)
  }
  return { mods, convertMods }
}

export function resolveAnomalyReleaseMultEvaluation(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  triggerElement?: string,
): { fields: Pick<PanelStats, 'anomalyReleaseMult' | 'anomalyReleaseMultFactor'>; convertMods: BuffStatModifiers } {
  const skillCtx = buildReleaseMultSkillContext(ctx, triggerElement)
  const { mods, convertMods } = resolveReleaseMultMods(ctx, skillCtx)
  return {
    fields: {
      anomalyReleaseMult: externalPanel.anomalyReleaseMult + mods.anomalyReleaseMult,
      anomalyReleaseMultFactor: combineMultFactorPercent(externalPanel.anomalyReleaseMultFactor, mods.anomalyReleaseMultFactor),
    },
    convertMods,
  }
}

export function resolveAnomalyReleaseMultFields(
  externalPanel: PanelStats,
  ctx: PanelCalcContext,
  triggerElement?: string,
): Pick<PanelStats, 'anomalyReleaseMult' | 'anomalyReleaseMultFactor'> {
  return resolveAnomalyReleaseMultEvaluation(externalPanel, ctx, triggerElement).fields
}

export function resolveAnomalyReleaseSkillConvertMods(ctx: PanelCalcContext, triggerElement?: string): BuffStatModifiers {
  return resolveReleaseMultMods(ctx, buildReleaseMultSkillContext(ctx, triggerElement), true).convertMods
}

function resolvePreConvertSnapshot(externalPanel: PanelStats, ctx: PanelCalcContext): PanelPreConvertSnapshot {
  const trace = ctx.trace
  const cached = trace?.preConvertCache?.get(trace.viewKey)
  if (cached) return cached
  const effectContributions: BuffEffectContribution[] = []
  const sources = collectPanelBuffModSources({
    ...ctx,
    trace: trace ? { ...trace, onContribution(item) { effectContributions.push(item); trace.onContribution(item) } } : undefined,
    skipConvert: true,
    panelSourceValuesBySlot: undefined,
  })
  const mods = mergeModsFromSources(sources)
  if (trace) {
    const numericContext = { ...ctx, skipConvert: true }
    rememberBuffCatalogEntry(buildBuffCatalogKey(numericContext), makeCatalogEntryFromSources(sources, numericContext))
  }
  const snapshot = {
    externalPanel,
    preConvertPanel: applyBuffModsToPanel(externalPanel, mods, {
      baseAnomalyControl: resolveBaseAnomalyControl(ctx),
      baseEnergyRegen: resolveBaseEnergyRegen(ctx),
    }),
    mods,
    sources,
    ...(trace ? { effectContributions } : {}),
  }
  trace?.preConvertCache?.set(trace.viewKey, snapshot)
  return snapshot
}

/** 同一份正式阶段结果同时供数值、来源说明与转模依赖读取。 */
function computeTracedPanelStages(
  rawExternalPanel: PanelStats,
  ctx: PanelCalcContext,
  options?: ComputeFinalPanelOptions,
): PanelStages {
  const externalPanel = fillPanelStatsDefaults(rawExternalPanel)
  const parentTrace = (options?.trace ?? ctx.trace)!
  const trace = parentTrace.resolveView?.(externalPanel, ctx, 'ownerPanel', parentTrace.policy) ?? parentTrace
  const contributions: BuffEffectContribution[] = []
  const sourceCtx: PanelCalcContext = { ...ctx, trace: {
    ...trace,
    onContribution(item) { contributions.push(item); trace.onContribution(item) },
  } }
  const pre = resolvePreConvertSnapshot(externalPanel, sourceCtx)
  if (!contributions.length) contributions.push(...pre.effectContributions ?? [])
  // 命中阶段缓存时原始记录已留在事件收集器；局部快照仍保留该阶段的身份。
  const panelSourceValuesBySlot = buildPanelSourceValuesBySlotMap(sourceCtx, externalPanel)
  const extras = resolveConvertAttrExtras(ctx.mainSlotIndex, ctx)
  const fullCtx: PanelCalcContext = {
    ...sourceCtx,
    skipConvert: false,
    panelSourceValuesBySlot,
    panelSourceValues: {
      external: panelToConvertAttrValues(externalPanel, { ...extras, pierceMod: 0 }),
      final: panelToConvertAttrValues(pre.preConvertPanel, { ...extras, pierceMod: pre.mods.pierce }),
      viewKey: trace.viewKey,
    },
  }
  const candidates = collectEventCandidateEffects(fullCtx)
  panelSourceValuesBySlot.set(ctx.mainSlotIndex, fullCtx.panelSourceValues!)
  fullCtx.traceIdentities = new Map([
    ...candidates.items.map(item => [item.effect.id, item] as const),
    ...candidates.excluded.map(({ item }) => [item.effect.id, item] as const),
  ])
  fullCtx.traceExcluded = Object.fromEntries(candidates.excluded.map(({ item, reason }) => [item.effect.id, reason]))
  const sources = pre.sources.map(source => {
    const effects = (source.effects ?? []).filter(effect => effect.kind === 'convert')
    const excluded = source.sourceOptions?.traceExcludedEffects?.filter(effect => effect.kind === 'convert') ?? []
    if (!effects.length && !excluded.length) return source
    const item = fullCtx.traceIdentities?.get((effects[0] ?? excluded[0])!.id)
    const providerSlot = item?.providerSlot ?? undefined
    const resolve = effects.length ? resolvePackModsViaEffectSpec : resolvePackMods
    const mods = resolve(effects, providerSlot == null || providerSlot === ctx.mainSlotIndex, fullCtx, providerSlot,
      { ...source.sourceOptions, traceExcludedEffects: excluded })
    return { ...source, mods: mergeBuffStatModifiers(source.mods, mods) }
  })
  const totalMods = mergeModsFromSources(sources)
  const finalPanel = applyBuffModsToPanel(externalPanel, totalMods, {
    baseAnomalyControl: resolveBaseAnomalyControl(ctx),
    baseEnergyRegen: resolveBaseEnergyRegen(ctx),
  })
  const combatMods = extractCombatMods(totalMods)
  applyFengYuSharpenCritMods(combatMods, fullCtx)
  return {
    externalPanel,
    preConvertPanel: pre.preConvertPanel,
    panelSourceValuesBySlot,
    finalBreakdown: {
      totalMods,
      combatMods,
      finalPanel: { ...finalPanel, sharpenCritDmgBonus: combatMods.sharpenCritDmgBonus },
      sources,
      effectContributions: contributions,
    },
  }
}

export function computePanelStages(
  rawExternalPanel: PanelStats,
  ctx: PanelCalcContext,
  options?: ComputeFinalPanelOptions,
): PanelStages {
  if (options?.trace ?? ctx.trace) return computeTracedPanelStages(rawExternalPanel, ctx, options)
  const externalPanel = fillPanelStatsDefaults(rawExternalPanel)
  const includeDetails = options?.includeDetails !== false
  const liveIndex = resolveLiveExternalSlotIndex(ctx)
  const ctxForSources: PanelCalcContext = {
    ...ctx,
    mainExternalPanel:
      ctx.mainExternalPanel ??
      (ctx.mainSlotIndex === liveIndex ? externalPanel : undefined),
    // 追踪只在带记录的一侧生效：数值模式（includeDetails=false）由调用方不传 trace 保证零分配
    trace: options?.trace ?? ctx.trace,
  }
  const panelSourceValuesBySlot = buildAllPanelSourceValuesBySlot(ctxForSources, externalPanel)
  const mainPanelSources = panelSourceValuesBySlot.get(ctx.mainSlotIndex)

  // 先叠非转模，再用局外/局内面板实时折算转模，避免环依赖
  const baseCtx: PanelCalcContext = {
    ...ctxForSources,
    // 行级例外必须显式带上：baseCtx/fullCtx 是本函数重建的 ctx，
    // 任何一处漏掉都会让"取消勾选不影响伤害"（2026-09-20 实测踩过）
    rowBuffOverride: ctx.rowBuffOverride ?? ctxForSources.rowBuffOverride ?? null,
    mainExternalPanel: ctxForSources.mainExternalPanel ?? externalPanel,
    panelSourceValuesBySlot,
    panelSourceValues: mainPanelSources,
    skipConvert: true,
  }
  const baseAnomalyControl = resolveBaseAnomalyControl(baseCtx)
  const baseEnergyRegen = resolveBaseEnergyRegen(baseCtx)
  const interimMods = collectPanelBuffMods(baseCtx)
  const preConvertPanel = applyBuffModsToPanel(externalPanel, interimMods, {
    baseAnomalyControl,
    baseEnergyRegen,
  })
  const mainExtras = resolveConvertAttrExtras(ctx.mainSlotIndex, ctx)
  const externalAttrs = panelToConvertAttrValues(externalPanel, {
    ...mainExtras,
    pierceMod: 0,
  })
  const finalAttrs = panelToConvertAttrValues(preConvertPanel, {
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
  const totalSources = includeDetails ? collectPanelBuffModSources(fullCtx) : []
  panelSourceValuesBySlot.set(ctx.mainSlotIndex, fullCtx.panelSourceValues!)
  const totalMods = includeDetails
    ? mergeModsFromSources(totalSources)
    : collectPanelBuffMods(fullCtx)
  const finalPanel = applyBuffModsToPanel(externalPanel, totalMods, {
    baseAnomalyControl,
    baseEnergyRegen,
  })
  const combatMods = extractCombatMods(totalMods)
  applyFengYuSharpenCritMods(combatMods, fullCtx)
  return {
    externalPanel,
    preConvertPanel,
    panelSourceValuesBySlot,
    finalBreakdown: {
      totalMods,
      combatMods,
      finalPanel: {
        ...finalPanel,
        sharpenCritDmgBonus: combatMods.sharpenCritDmgBonus,
      },
      sources: includeDetails ? totalSources : [],
    },
  }
}

export function computeFinalPanel(
  rawExternalPanel: PanelStats,
  ctx: PanelCalcContext,
  options?: ComputeFinalPanelOptions,
): PanelBuffBreakdown {
  const parentTrace = options?.trace ?? ctx.trace
  const trace = parentTrace?.resolveView?.(fillPanelStatsDefaults(rawExternalPanel), ctx, 'ownerPanel', parentTrace.policy) ?? parentTrace
  const cached = trace?.panelCache?.get(trace.viewKey)
  if (cached) return cached
  const result = computePanelStages(rawExternalPanel, ctx, trace ? { ...options, trace } : options).finalBreakdown
  trace?.panelCache?.set(trace.viewKey, result)
  return result
}

export function buildDefaultBuffSelection(
  collected: CollectedEffect[],
  attrValues?: Partial<Record<CharacterAttrKey, number>>,
): BuffSelectionState {
  const enabledIds: Record<string, boolean> = {}
  const stacksByEffectId: Record<string, number> = {}
  const convertInputs: Record<string, number> = {}
  for (const item of collected) {
    // 额外 Buff 直接参与计算，不进选择器状态（Spec §5.1 第 6、8 项）
    if (item.effect.extraGain) continue
    // 危局 / Boss 场地 / 防线：目录默认不勾选；点效果块时按 enabledDefault + 队内职业人数开启
    // 非场地的队内职业人数条件：默认不勾，由 syncTeamProfessionAutoEnabled 按恰好 N 人写入
    const startEnabled = isEnvironmentBuffSourceKey(item.sourceKey)
      ? false
      : item.effect.teamProfession?.trim()
        ? false
        : isEffectEnabled(item.effect, { enabledIds: {} })
    enabledIds[item.effect.id] = startEnabled
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
