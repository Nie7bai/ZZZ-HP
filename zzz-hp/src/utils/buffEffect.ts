import type {
  AgentMindscapeRankBuffs,
  BuffApplySituation,
  BuffApplyTarget,
  BuffEffect,
  BuffEffectBlock,
  BuffEffectConvert,
  BuffEffectKind,
  BuffScope,
  BuffSkillTarget,
  BuffSkillTargetId,
  BuffStatKey,
  BuffStatModifiers,
  CharacterAttrKey,
  FollowUpSkillRule,
  SkillCalcContext,
  SkillCategoryId,
  SkillSubcategory,
} from '@/types/calculator'
import { CHARACTER_ATTR_OPTIONS } from '@/types/calculator'

const BUFF_STAT_KEYS: BuffStatKey[] = [
  'hp',
  'inCombatHpPercent',
  'inCombatAtkPercent',
  'externalHpPercent',
  'externalAtkPercent',
  'atk',
  'dmgBonus',
  'critRate',
  'critDmg',
  'penRate',
  'reduceDefense',
  'resPen',
  'mastery',
  'anomalyControl',
  'anomalyControlPercent',
  'energyRegen',
  'pierce',
  'pierceDmgBonus',
  'vulnerable',
  'globalStaggerVulnerable',
  'staggerVulnerable',
  'staggerVulnerableOnly',
  'special',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyDmgBonus',
  'anomalyReleaseDmgBonus',
  'anomalyReleaseCritRate',
  'anomalyReleaseCritDmg',
  'anomalyReleaseMult',
  'directDmgMult',
  'anomalyMult',
  'disorderBaseMult',
  'anomalyDuration',
  'disorderCompMult',
  'turbulenceBaseMult',
  'turbulenceCompMult',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
  'skillDmgBonus',
  'skillMultiplierBonus',
]

const SKILL_CATEGORIES: SkillCategoryId[] = [
  'basic',
  'dodge',
  'assist',
  'special',
  'chain',
  'ultimate',
]

const BUFF_SKILL_TARGETS: BuffSkillTargetId[] = [...SKILL_CATEGORIES, 'follow_up']

const CHARACTER_ATTRS: CharacterAttrKey[] = [
  'hp',
  'atk',
  'mastery',
  'anomalyControl',
  'energyRegen',
  'penRate',
  'impact',
  'def',
  'level',
]

/** 旧转模 from 字段映射到新 CharacterAttrKey + panelSource */
const LEGACY_CONVERT_FROM: Record<
  string,
  { from: CharacterAttrKey; panelSource: 'external' | 'final' }
> = {
  externalHp: { from: 'hp', panelSource: 'external' },
  inCombatHp: { from: 'hp', panelSource: 'final' },
  externalAtk: { from: 'atk', panelSource: 'external' },
  inCombatAtk: { from: 'atk', panelSource: 'final' },
}

function readNumber(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function emptyMods(): BuffStatModifiers {
  const mods = {} as BuffStatModifiers
  for (const key of BUFF_STAT_KEYS) mods[key] = 0
  return mods
}

function newEffectId() {
  return `eff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyBuffEffect(
  overrides: Partial<BuffEffect> = {},
): BuffEffect {
  const skillTargets = normalizeSkillTargets(
    overrides.skillTargets,
    overrides.skillCategory,
    overrides.skillSubcategoryId,
  )
  const primary = skillTargets[0]
  return {
    id: overrides.id ?? newEffectId(),
    origin: overrides.origin ?? '',
    scope: overrides.scope ?? 'general',
    applyTarget: overrides.applyTarget ?? 'self',
    applySituation: overrides.applySituation ?? 'global',
    skillTargets: skillTargets.length ? skillTargets : undefined,
    skillCategory: primary?.category ?? overrides.skillCategory,
    skillSubcategoryId: primary?.subcategoryId ?? overrides.skillSubcategoryId ?? null,
    elementFilter: overrides.elementFilter ?? 'all',
    kind: overrides.kind ?? 'fixed',
    stat: overrides.stat ?? 'dmgBonus',
    value: overrides.value ?? 0,
    stackable: overrides.stackable ?? false,
    maxStacks: overrides.maxStacks ?? 1,
    valuePerStack: overrides.valuePerStack ?? 0,
    defaultStacks: overrides.defaultStacks ?? 1,
    convert: overrides.convert,
    appliesToAnomaly: overrides.appliesToAnomaly,
    enabledDefault: overrides.enabledDefault ?? true,
    note: overrides.note ?? '',
  }
}

/** 读取效果的招式目标列表（兼容旧单字段） */
export function getEffectSkillTargets(effect: BuffEffect): BuffSkillTarget[] {
  return normalizeSkillTargets(
    effect.skillTargets,
    effect.skillCategory,
    effect.skillSubcategoryId,
  )
}

/** 写入招式目标列表，并同步旧字段为首项 */
export function setEffectSkillTargets(effect: BuffEffect, targets: BuffSkillTarget[]) {
  const normalized = normalizeSkillTargets(targets)
  effect.skillTargets = normalized.length ? normalized : undefined
  effect.skillCategory = normalized[0]?.category
  effect.skillSubcategoryId = normalized[0]?.subcategoryId ?? null
}

function normalizeSkillTargets(
  targets?: BuffSkillTarget[] | null,
  legacyCategory?: BuffSkillTargetId | null,
  legacySubId?: string | null,
): BuffSkillTarget[] {
  if (Array.isArray(targets) && targets.length) {
    const result: BuffSkillTarget[] = []
    for (const item of targets) {
      const category = normalizeSkillCategory(item?.category)
      if (!category) continue
      const subcategoryId =
        item.subcategoryId == null || item.subcategoryId === ''
          ? null
          : String(item.subcategoryId)
      result.push({ category, subcategoryId })
    }
    return result
  }
  const category = normalizeSkillCategory(legacyCategory)
  if (!category) return []
  return [
    {
      category,
      subcategoryId:
        legacySubId == null || legacySubId === '' ? null : String(legacySubId),
    },
  ]
}

/** 旧扁平 mods → fixed effects */
export function flatModsToEffects(
  mods: BuffStatModifiers,
  applyTarget: BuffApplyTarget,
  scope: BuffScope = 'general',
  idPrefix = '',
): BuffEffect[] {
  const effects: BuffEffect[] = []
  for (const key of BUFF_STAT_KEYS) {
    const value = mods[key]
    if (!value) continue
    effects.push(
      createEmptyBuffEffect({
        id: idPrefix ? `${idPrefix}-${applyTarget}-${key}` : undefined,
        scope,
        applyTarget,
        kind: 'fixed',
        stat: key,
        value,
        enabledDefault: true,
      }),
    )
  }
  return effects
}

/** 收集/结算时生成全局唯一实例 ID，避免不同来源同 id 互相捆绑 */
export function effectInstanceId(
  sourceKey: string,
  blockId: string,
  effectId: string,
) {
  return `${sourceKey}::${blockId}::${effectId}`
}

export function cloneEffectInstance(
  effect: BuffEffect,
  sourceKey: string,
  blockId: string,
): BuffEffect {
  return {
    ...effect,
    id: effectInstanceId(sourceKey, blockId, effect.id),
    skillTargets: effect.skillTargets?.map((item) => ({ ...item })),
    elementFilter: Array.isArray(effect.elementFilter)
      ? [...effect.elementFilter]
      : effect.elementFilter,
    convert: effect.convert ? { ...effect.convert } : undefined,
  }
}

export function effectsToFlatMods(
  effects: BuffEffect[],
  applyTarget?: BuffApplyTarget,
): BuffStatModifiers {
  let total = emptyMods()
  for (const effect of effects) {
    if (applyTarget && effect.applyTarget !== applyTarget) continue
    if (effect.scope !== 'general') continue
    const amount = resolveEffectBaseValue(effect, effect.defaultStacks ?? 1)
    if (!amount) continue
    total = addStat(total, effect.stat, amount)
  }
  return total
}

export function addStat(
  mods: BuffStatModifiers,
  stat: BuffStatKey,
  amount: number,
): BuffStatModifiers {
  return { ...mods, [stat]: mods[stat] + amount }
}

export function resolveEffectBaseValue(effect: BuffEffect, stacks: number): number {
  if (effect.kind === 'stacked' || effect.stackable) {
    const per = effect.valuePerStack ?? effect.value ?? 0
    const max = Math.max(1, effect.maxStacks ?? 1)
    const used = Math.min(max, Math.max(0, stacks))
    return per * used
  }
  if (effect.kind === 'convert') {
    return 0
  }
  return effect.value ?? 0
}

export function resolveConvertValue(
  effect: BuffEffect,
  attrValues: Partial<Record<CharacterAttrKey, number>>,
  overrideBase?: number | null,
  panelSourceValues?: {
    external?: Partial<Record<CharacterAttrKey, number>>
    final?: Partial<Record<CharacterAttrKey, number>>
  },
): number {
  if (effect.kind !== 'convert' || !effect.convert) return 0
  const source = effect.convert.panelSource ?? 'external'
  let from: number
  if (source === 'manual') {
    // 自行设置：不读面板，优先用计算页输入，其次配置的 defaultBase
    from =
      overrideBase != null && Number.isFinite(overrideBase)
        ? overrideBase
        : effect.convert.defaultBase != null && Number.isFinite(effect.convert.defaultBase)
          ? effect.convert.defaultBase
          : 0
  } else {
    const sourceMap =
      panelSourceValues?.[source] ??
      (source === 'final' ? panelSourceValues?.final : panelSourceValues?.external) ??
      attrValues
    from =
      overrideBase != null && Number.isFinite(overrideBase)
        ? overrideBase
        : (sourceMap[effect.convert.from] ?? attrValues[effect.convert.from] ?? 0)
  }
  let amount = (from * effect.convert.ratioPercent) / 100
  if (effect.convert.cap != null && Number.isFinite(effect.convert.cap)) {
    amount = Math.min(amount, effect.convert.cap)
  }
  return amount
}

export function effectMatchesContext(
  effect: BuffEffect,
  ctx: SkillCalcContext | null | undefined,
): boolean {
  if (!ctx) {
    return effect.scope === 'general'
  }

  const situation = effect.applySituation ?? 'global'
  if (situation !== 'global') {
    const phase = ctx.staggerPhase ?? 'stagger'
    if (situation === 'stagger' && phase !== 'stagger') return false
    if (situation === 'non_stagger' && phase !== 'normal') return false
  }

  if (ctx.damageKind === 'anomaly') {
    const skillStat =
      effect.stat === 'skillDmgBonus' || effect.stat === 'skillMultiplierBonus'
    const allowsAnomaly =
      effect.appliesToAnomaly === true ||
      (effect.appliesToAnomaly !== false && effect.scope === 'general' && !skillStat)
    if (!allowsAnomaly) return false
    if (effect.scope === 'skill' && effect.appliesToAnomaly !== true) return false
  }

  if (
    effect.stat === 'staggerVulnerableOnly' &&
    ctx.staggerPhase &&
    ctx.staggerPhase !== 'stagger'
  ) {
    return false
  }

  if (effect.scope === 'general') return true

  if (effect.scope === 'skill') {
    if (ctx.damageKind === 'anomaly' && effect.appliesToAnomaly !== true) return false
    const targets = getEffectSkillTargets(effect)
    if (!targets.length) return false
    return targets.some((target) => skillTargetMatchesContext(target, ctx))
  }

  return false
}

function skillTargetMatchesContext(
  target: BuffSkillTarget,
  ctx: SkillCalcContext,
): boolean {
  if (target.category === 'follow_up') {
    if (!ctx.isFollowUp) return false
    if (target.subcategoryId) {
      return target.subcategoryId === ctx.subcategoryId
    }
    return true
  }
  if (target.category !== ctx.categoryId) return false
  if (target.subcategoryId) {
    return target.subcategoryId === ctx.subcategoryId
  }
  return true
}

/** 根据小类打标与整大类规则判断当前招式是否视为追加攻击 */
export function resolveIsFollowUp(options: {
  agentId?: string | null
  categoryId: SkillCategoryId
  subcategoryId?: string | null
  skillSubcategories?: SkillSubcategory[] | null
  followUpSkillRules?: FollowUpSkillRule[] | null
}): boolean {
  const agentId = options.agentId?.trim() || ''
  const subcategoryId = options.subcategoryId ?? null
  const subs = options.skillSubcategories ?? []
  const rules = options.followUpSkillRules ?? []

  if (subcategoryId) {
    const sub = subs.find((item) => item.id === subcategoryId)
    if (sub?.countsAsFollowUp) return true
  }

  for (const rule of rules) {
    if (rule.agentId && rule.agentId !== agentId) continue
    if (rule.categoryId !== options.categoryId) continue
    if (rule.subcategoryId == null) return true
    if (subcategoryId && rule.subcategoryId === subcategoryId) return true
  }
  return false
}

export function effectMatchesElement(effect: BuffEffect, element?: string): boolean {
  const filter = effect.elementFilter
  if (!filter || filter === 'all') return true
  if (!element) return true
  return filter.includes(element)
}

export function filterEffects(
  effects: BuffEffect[],
  options: {
    applyTarget?: BuffApplyTarget
    ctx?: SkillCalcContext | null
    element?: string
    enabledIds?: Set<string> | null
    disabledIds?: Set<string> | null
  } = {},
): BuffEffect[] {
  return effects.filter((effect) => {
    if (options.applyTarget && effect.applyTarget !== options.applyTarget) return false
    if (options.enabledIds && !options.enabledIds.has(effect.id)) {
      if (effect.enabledDefault === false) return false
      if (options.disabledIds?.has(effect.id)) return false
      if (options.enabledIds.size > 0 && !options.enabledIds.has(effect.id)) {
        // enabledIds 非空表示显式勾选集合
        return false
      }
    }
    if (options.disabledIds?.has(effect.id)) return false
    if (!effectMatchesContext(effect, options.ctx)) return false
    if (!effectMatchesElement(effect, options.element ?? options.ctx?.element)) return false
    return true
  })
}

export function isEffectEnabled(
  effect: BuffEffect,
  selection: { enabledIds?: Record<string, boolean> } | null | undefined,
): boolean {
  if (!selection?.enabledIds || !(effect.id in selection.enabledIds)) {
    return effect.enabledDefault !== false
  }
  return Boolean(selection.enabledIds[effect.id])
}

export function resolveEffectsToMods(
  effects: BuffEffect[],
  options: {
    applyTarget?: BuffApplyTarget
    /** 主C 时同时吃 self + team */
    applyTargets?: BuffApplyTarget[]
    ctx?: SkillCalcContext | null
    element?: string
    stacksByEffectId?: Record<string, number>
    convertInputs?: Record<string, number>
    attrValues?: Partial<Record<CharacterAttrKey, number>>
    panelSourceValues?: {
      external?: Partial<Record<CharacterAttrKey, number>>
      final?: Partial<Record<CharacterAttrKey, number>>
    }
    /** 跳过转模效果（用于先叠非转模再算转模） */
    skipConvert?: boolean
    selection?: { enabledIds?: Record<string, boolean> } | null
  } = {},
): BuffStatModifiers {
  let total = emptyMods()
  for (const effect of effects) {
    if (options.applyTargets?.length) {
      if (!options.applyTargets.includes(effect.applyTarget)) continue
    } else if (options.applyTarget && effect.applyTarget !== options.applyTarget) {
      continue
    }
    if (!isEffectEnabled(effect, options.selection)) continue
    if (!effectMatchesContext(effect, options.ctx)) continue
    if (!effectMatchesElement(effect, options.element ?? options.ctx?.element)) continue
    if (options.skipConvert && effect.kind === 'convert') continue

    const stacks =
      options.stacksByEffectId?.[effect.id] ?? effect.defaultStacks ?? 1
    let amount =
      effect.kind === 'convert'
        ? resolveConvertValue(
            effect,
            options.attrValues ?? {},
            options.convertInputs && effect.id in options.convertInputs
              ? options.convertInputs[effect.id]
              : null,
            options.panelSourceValues,
          )
        : resolveEffectBaseValue(effect, stacks)
    if (!amount) continue
    total = addStat(total, effect.stat, amount)
  }
  return total
}

function normalizeScope(value: unknown): BuffScope {
  return value === 'skill' ? 'skill' : 'general'
}

function normalizeApplyTarget(value: unknown): BuffApplyTarget {
  return value === 'team' ? 'team' : 'self'
}

function normalizeApplySituation(value: unknown): BuffApplySituation {
  if (value === 'stagger' || value === 'non_stagger') return value
  return 'global'
}

function normalizeKind(value: unknown): BuffEffectKind {
  if (value === 'stacked' || value === 'convert') return value
  return 'fixed'
}

function normalizeStat(value: unknown): BuffStatKey {
  if (typeof value === 'string' && (BUFF_STAT_KEYS as string[]).includes(value)) {
    return value as BuffStatKey
  }
  return 'dmgBonus'
}

function normalizeSkillCategory(value: unknown): BuffSkillTargetId | undefined {
  if (typeof value === 'string' && (BUFF_SKILL_TARGETS as string[]).includes(value)) {
    return value as BuffSkillTargetId
  }
  return undefined
}

function normalizeConvert(value: unknown): BuffEffect['convert'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entry = value as Record<string, unknown>
  const rawFrom = entry.from
  if (typeof rawFrom !== 'string') return undefined

  let from: CharacterAttrKey
  let panelSource: 'external' | 'final' | 'manual' =
    entry.panelSource === 'final'
      ? 'final'
      : entry.panelSource === 'manual'
        ? 'manual'
        : 'external'

  const legacy = LEGACY_CONVERT_FROM[rawFrom]
  if (legacy) {
    from = legacy.from
    if (
      entry.panelSource !== 'external' &&
      entry.panelSource !== 'final' &&
      entry.panelSource !== 'manual'
    ) {
      panelSource = legacy.panelSource
    }
  } else if ((CHARACTER_ATTRS as string[]).includes(rawFrom)) {
    from = rawFrom as CharacterAttrKey
  } else {
    return undefined
  }

  const capRaw = entry.cap
  const defaultBaseRaw = entry.defaultBase
  return {
    from,
    panelSource,
    ratioPercent: readNumber(entry.ratioPercent),
    cap: capRaw == null || capRaw === '' ? null : readNumber(capRaw),
    defaultBase:
      defaultBaseRaw == null || defaultBaseRaw === '' ? null : readNumber(defaultBaseRaw),
  }
}

function normalizeElementFilter(value: unknown): BuffEffect['elementFilter'] {
  if (value == null || value === 'all') return 'all'
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  }
  return 'all'
}

export function normalizeBuffEffect(value: unknown): BuffEffect | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entry = value as Record<string, unknown>
  const effect = createEmptyBuffEffect({
    id: typeof entry.id === 'string' && entry.id ? entry.id : newEffectId(),
    origin: typeof entry.origin === 'string' ? entry.origin : '',
    scope: normalizeScope(entry.scope),
    applyTarget: normalizeApplyTarget(entry.applyTarget),
    applySituation: normalizeApplySituation(entry.applySituation),
    skillTargets: Array.isArray(entry.skillTargets)
      ? (entry.skillTargets as BuffSkillTarget[])
      : undefined,
    skillCategory: normalizeSkillCategory(entry.skillCategory),
    skillSubcategoryId:
      entry.skillSubcategoryId == null || entry.skillSubcategoryId === ''
        ? null
        : String(entry.skillSubcategoryId),
    elementFilter: normalizeElementFilter(entry.elementFilter),
    kind: normalizeKind(entry.kind),
    stat: normalizeStat(entry.stat),
    value: readNumber(entry.value),
    stackable: Boolean(entry.stackable),
    maxStacks: Math.max(1, readNumber(entry.maxStacks) || 1),
    valuePerStack: readNumber(entry.valuePerStack),
    defaultStacks: Math.max(0, readNumber(entry.defaultStacks) || 1),
    convert: normalizeConvert(entry.convert),
    appliesToAnomaly:
      entry.appliesToAnomaly == null ? undefined : Boolean(entry.appliesToAnomaly),
    enabledDefault: entry.enabledDefault === false ? false : true,
    note: typeof entry.note === 'string' ? entry.note : '',
  })
  if (effect.kind === 'convert' && !effect.convert) {
    effect.kind = 'fixed'
  }
  if (effect.scope === 'skill') {
    const targets = getEffectSkillTargets(effect)
    if (!targets.length) {
      setEffectSkillTargets(effect, [{ category: 'basic', subcategoryId: null }])
    } else {
      setEffectSkillTargets(effect, targets)
    }
  }
  return effect
}

export function normalizeBuffEffects(value: unknown): BuffEffect[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeBuffEffect(item))
    .filter((item): item is BuffEffect => item != null)
}

function newBlockId() {
  return `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyBuffEffectBlock(
  overrides: Partial<BuffEffectBlock> = {},
): BuffEffectBlock {
  return {
    id: overrides.id ?? newBlockId(),
    name: overrides.name ?? '效果块',
    note: typeof overrides.note === 'string' ? overrides.note : '',
    effects: overrides.effects ?? [],
    enabledDefault: overrides.enabledDefault ?? true,
  }
}

export function flattenEffectBlocks(
  blocks: Array<{ effects?: BuffEffect[] | null }>,
): BuffEffect[] {
  return blocks.flatMap((block) => block.effects ?? [])
}

export function wrapEffectsAsBlocks(effects: BuffEffect[]): BuffEffectBlock[] {
  if (!effects.length) return []
  return [
    createEmptyBuffEffectBlock({
      name: '效果块 1',
      effects,
    }),
  ]
}

export function normalizeBuffEffectBlocks(value: unknown): BuffEffectBlock[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const entry = item as Record<string, unknown>
      return createEmptyBuffEffectBlock({
        id: typeof entry.id === 'string' && entry.id ? entry.id : `blk-${index}`,
        name: typeof entry.name === 'string' && entry.name ? entry.name : `效果块 ${index + 1}`,
        note: typeof entry.note === 'string' ? entry.note : '',
        effects: normalizeBuffEffects(entry.effects),
        enabledDefault: entry.enabledDefault === false ? false : true,
      })
    })
}

export function packFromEffects(effects: BuffEffect[]): AgentMindscapeRankBuffs {
  const effectBlocks = wrapEffectsAsBlocks(effects)
  return {
    effectBlocks,
    effects,
    selfMods: effectsToFlatMods(effects, 'self'),
    teamMods: effectsToFlatMods(effects, 'team'),
  }
}

export function packFromBlocks(blocks: BuffEffectBlock[]): AgentMindscapeRankBuffs {
  const effectBlocks = blocks.map((block) =>
    createEmptyBuffEffectBlock({
      ...block,
      effects: normalizeBuffEffects(block.effects),
    }),
  )
  const effects = flattenEffectBlocks(effectBlocks)
  return {
    effectBlocks,
    effects,
    selfMods: effectsToFlatMods(effects, 'self'),
    teamMods: effectsToFlatMods(effects, 'team'),
  }
}

export function normalizeSelfTeamBuffsWithEffects(value: unknown): AgentMindscapeRankBuffs {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entry = value as Record<string, unknown>
    if (Array.isArray(entry.effectBlocks) && entry.effectBlocks.length > 0) {
      return packFromBlocks(normalizeBuffEffectBlocks(entry.effectBlocks))
    }
    if (Array.isArray(entry.effects) && entry.effects.length > 0) {
      return packFromEffects(normalizeBuffEffects(entry.effects))
    }
    if (entry.selfMods || entry.teamMods) {
      const effects = [
        ...flatModsToEffects(normalizeLooseMods(entry.selfMods), 'self'),
        ...flatModsToEffects(normalizeLooseMods(entry.teamMods), 'team'),
      ]
      return packFromEffects(effects)
    }
  }
  return packFromEffects([])
}

function normalizeLooseMods(value: unknown): BuffStatModifiers {
  const empty = emptyMods()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const entry = value as Record<string, unknown>
  const result = { ...empty }
  for (const key of BUFF_STAT_KEYS) {
    result[key] = readNumber(entry[key])
  }
  return result
}

/** 收集效果时允许只带 blocks/effects 的轻量 pack（如邦布精炼临时对象） */
export type BuffEffectPackLike = {
  effectBlocks?: Array<{
    id?: string
    name?: string
    note?: string
    effects?: BuffEffect[] | null
  }> | null
  effects?: BuffEffect[] | null
  selfMods?: BuffStatModifiers | null
  teamMods?: BuffStatModifiers | null
}

export function collectEffectsFromPack(
  pack: BuffEffectPackLike | null | undefined,
): BuffEffect[] {
  if (!pack) return []
  if (Array.isArray(pack.effectBlocks) && pack.effectBlocks.length > 0) {
    const fromBlocks = flattenEffectBlocks(pack.effectBlocks)
    if (fromBlocks.length) return fromBlocks
  }
  if (Array.isArray(pack.effects) && pack.effects.length > 0) return pack.effects
  // 稳定 id，避免每次收集随机 id 导致勾选串源（如影画与驱动盘互相捆绑）
  return [
    ...flatModsToEffects(pack.selfMods ?? emptyMods(), 'self', 'general', 'legacy-self'),
    ...flatModsToEffects(pack.teamMods ?? emptyMods(), 'team', 'general', 'legacy-team'),
  ]
}

/** 按效果块收集，便于选择器/明细按块展示 */
export function collectBlockEntriesFromPack(
  pack: BuffEffectPackLike | null | undefined,
): Array<{ blockId: string; blockName: string; blockNote: string; effects: BuffEffect[] }> {
  if (!pack) return []
  if (Array.isArray(pack.effectBlocks) && pack.effectBlocks.length > 0) {
    const blocks = pack.effectBlocks
      .map((block) => ({
        blockId: block.id || 'legacy',
        blockName: block.name?.trim() || '效果块',
        blockNote: block.note?.trim() || '',
        effects: Array.isArray(block.effects) ? block.effects : [],
      }))
      .filter((entry) => entry.effects.length > 0)
    if (blocks.length) return blocks
  }
  const effects = collectEffectsFromPack({
    ...pack,
    effectBlocks: [],
    effects: Array.isArray(pack.effects) && pack.effects.length ? pack.effects : [],
  })
  if (!effects.length) return []
  return [{ blockId: 'legacy', blockName: '增益', blockNote: '', effects }]
}

export function mergeEffectLists(...lists: BuffEffect[][]): BuffEffect[] {
  return lists.flat()
}

export const SKILL_CATEGORY_LABELS: Record<BuffSkillTargetId, string> = {
  basic: '普通攻击',
  dodge: '闪避',
  assist: '支援技',
  special: '特殊技',
  chain: '连携技',
  ultimate: '终结技',
  follow_up: '追加攻击',
}

const APPLY_SITUATION_LABELS: Record<string, string> = {
  global: '全局',
  stagger: '失衡期',
  non_stagger: '非失衡期',
}

function convertSourceAttrLabel(convert: BuffEffectConvert): string {
  const source =
    convert.panelSource === 'final'
      ? '局内'
      : convert.panelSource === 'manual'
        ? '自行'
        : '局外'
  const from =
    CHARACTER_ATTR_OPTIONS.find((item) => item.id === convert.from)?.label ?? convert.from
  return `${source}·${from}`
}

/** 转模说明：如「自行·等级转模120%」「局外·生命转模30%」 */
export function convertSummaryLabel(convert: BuffEffectConvert | null | undefined): string {
  if (!convert) return '转模'
  return `${convertSourceAttrLabel(convert)}转模${convert.ratioPercent ?? 0}%`
}

/** 招式目标展示：`[终结技：斩妄开天]`；找不到名称时只显示大类，不露内部 id */
export function formatSkillTargetBracket(
  target: BuffSkillTarget,
  skillSubcategories?: SkillSubcategory[] | null,
): string {
  const catLabel = SKILL_CATEGORY_LABELS[target.category] ?? '招式'
  if (!target.subcategoryId) {
    return `[${catLabel}]`
  }
  const name = skillSubcategories?.find((item) => item.id === target.subcategoryId)?.name?.trim()
  if (name) return `[${catLabel}：${name}]`
  return `[${catLabel}]`
}

/** 按顺序拼接全部招式目标括号 */
export function formatSkillTargetsPrefix(
  effect: BuffEffect,
  skillSubcategories?: SkillSubcategory[] | null,
): string {
  if (effect.scope !== 'skill') return ''
  return getEffectSkillTargets(effect)
    .map((target) => formatSkillTargetBracket(target, skillSubcategories))
    .join('')
}

export function effectSummaryLabel(
  effect: BuffEffect,
  statLabelFn?: (stat: BuffStatKey) => string,
  skillSubcategories?: SkillSubcategory[] | null,
): string {
  const target = effect.applyTarget === 'team' ? '全队' : '自身'
  const skillPrefix = formatSkillTargetsPrefix(effect, skillSubcategories)
  const scope =
    effect.scope === 'skill'
      ? skillPrefix
        ? `招式·${skillPrefix}`
        : '招式'
      : '通用'
  const situation =
    APPLY_SITUATION_LABELS[effect.applySituation ?? 'global'] ?? '全局'
  const statText = statLabelFn?.(effect.stat) ?? effect.stat
  const kind =
    effect.kind === 'stacked'
      ? `叠层×${effect.valuePerStack ?? 0}`
      : effect.kind === 'convert'
        ? convertSummaryLabel(effect.convert)
        : `${effect.value ?? 0}`
  return `${target} · ${scope} · ${situation} · ${statText} ${kind}`
}

/** 局内 Buff 卡片效果行：`[终结技：斩妄开天]无视防御/减防% +40` */
export function formatBuffEffectResultText(
  effect: BuffEffect,
  amountText: string,
  options?: {
    statLabelFn?: (stat: BuffStatKey) => string
    skillSubcategories?: SkillSubcategory[] | null
  },
): string {
  const skillPrefix = formatSkillTargetsPrefix(effect, options?.skillSubcategories)
  const label = options?.statLabelFn?.(effect.stat) ?? effect.stat
  return `${skillPrefix}${label} ${amountText}`
}

export { BUFF_STAT_KEYS }
