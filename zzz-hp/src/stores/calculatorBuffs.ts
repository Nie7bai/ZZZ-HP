import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  deleteAgentBuff,
  deleteBangbooBuff,
  deleteDriveDiscBuff,
  deleteDamageEventMode,
  deleteFollowUpSkillRule,
  deleteSkillSubcategory,
  deleteWengineBuff,
  fetchCalculatorBuffs,
  fetchDamageEventModes,
  saveAgentBuff,
  saveBangbooBuff,
  saveDamageEventMode,
  saveDriveDiscBuff,
  saveFollowUpSkillRule,
  saveSkillSubcategory,
  saveWengineBuff,
} from '@/api/calculatorBuffs'
import { defaultAgentBuffDocs } from '@/data/calculatorBuffDefaults'
import type {
  AgentBuffDoc,
  AgentMindscapeRankBuffs,
  BangbooBuffDoc,
  DamageEvent,
  DamageEventMode,
  DriveDiscBuffDoc,
  FollowUpSkillRule,
  SkillCategoryId,
  SkillSubcategory,
  SupportStatNeed,
  WengineBuffDoc,
} from '@/types/calculator'
import {
  normalizeSkillSubcategoryMultFields,
} from '@/utils/skillSubcategoryMult'
import {
  AGENT_MINDSCAPE_RANKS,
  createEmptyMindscapeBuffs,
  createEmptyRefinementMods,
  defaultTurbulenceStats,
  normalizeAgentBasePanel,
  normalizeBuffStatModifiers,
  normalizeMindscapeNotes,
  normalizeSelfTeamBuffs,
  normalizeTwoPieceMods,
  normalizeWengineAdvancedStats,
  normalizeWengineRarity,
  normalizeWengineRefinementBuffs,
  REFINEMENT_RANKS,
  SUPPORT_STAT_OPTIONS,
} from '@/utils/calculatorUi'
import {
  flatModsToEffects,
  flattenEffectBlocks,
  normalizeBuffEffectBlocks,
  normalizeBuffEffects,
  packFromBlocks,
  packFromEffects,
} from '@/utils/buffEffect'

function normalizeSupportNeeds(value: unknown): SupportStatNeed[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set(SUPPORT_STAT_OPTIONS.map((option) => option.id))
  return value.filter(
    (item): item is SupportStatNeed =>
      typeof item === 'string' && allowed.has(item as SupportStatNeed),
  )
}

function normalizeAvatarImage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return null
}

function normalizeMindscapeBuffs(item: Record<string, unknown>) {
  if (Array.isArray(item.mindscapeBuffs)) {
    const ranks = item.mindscapeBuffs as unknown[]
    return AGENT_MINDSCAPE_RANKS.map((_, index) =>
      normalizeSelfTeamBuffs(ranks[index] ?? {}),
    )
  }

  const mindscapeBuffs = createEmptyMindscapeBuffs()
  mindscapeBuffs[0] = normalizeSelfTeamBuffs({
    selfMods: item.selfBuffs,
    teamMods: item.teamBuffs,
  })
  return mindscapeBuffs
}

function mergeMissingDefaultAgents(docs: AgentBuffDoc[]): AgentBuffDoc[] {
  const merged = [...docs]
  const ids = new Set(merged.map((item) => item.id))
  for (const placeholder of defaultAgentBuffDocs) {
    if (ids.has(placeholder.id)) continue
    merged.push(normalizeAgent(placeholder as unknown as Record<string, unknown>))
    ids.add(placeholder.id)
  }
  return merged.sort((a, b) => a.id.localeCompare(b.id))
}

function normalizeAgent(item: Record<string, unknown>): AgentBuffDoc {
  const id = String(item.id ?? '')
  const element = String(item.element ?? '')
  const rawBase = item.basePanel
  let basePanel = normalizeAgentBasePanel(rawBase)
  if (rawBase && typeof rawBase === 'object' && !Array.isArray(rawBase)) {
    const entry = rawBase as Record<string, unknown>
    const turbulence = defaultTurbulenceStats(element, id)
    if (entry.turbulenceBaseMult == null) {
      basePanel = { ...basePanel, turbulenceBaseMult: turbulence.turbulenceBaseMult }
    }
    if (entry.turbulenceCompMult == null) {
      basePanel = { ...basePanel, turbulenceCompMult: turbulence.turbulenceCompMult }
    }
  }
  return {
    id,
    name: String(item.name ?? ''),
    profession: String(item.profession ?? item.role ?? ''),
    element,
    supportNeeds: normalizeSupportNeeds(item.supportNeeds),
    avatar_image:
      normalizeAvatarImage(item.avatar_image) ?? normalizeAvatarImage(item.avatar),
    note: typeof item.note === 'string' ? item.note : '',
    basePanel,
    mindscapeNotes: normalizeMindscapeNotes(item.mindscapeNotes),
    mindscapeBuffs: normalizeMindscapeBuffs(item),
  }
}

function normalizeWengine(item: Record<string, unknown>): WengineBuffDoc {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    profession: String(item.profession ?? item.role ?? ''),
    rarity: normalizeWengineRarity(item.rarity),
    avatar_image:
      normalizeAvatarImage(item.avatar_image) ?? normalizeAvatarImage(item.avatar),
    note: typeof item.note === 'string' ? item.note : '',
    baseAtk: Number(item.baseAtk) || 0,
    advancedStats: normalizeWengineAdvancedStats(item.advancedStats),
    fixedBuffs: normalizeSelfTeamBuffs(item.fixedBuffs),
    refinementBuffs: normalizeWengineRefinementBuffs(item.refinementBuffs).map(
      migrateWengineRefinementEnergyRegen,
    ),
  }
}

/** 音擎精炼能量回复统一为百分比：旧 energyRegenFlat 迁回 energyRegen（1.2 → 120） */
function migrateWengineRefinementEnergyRegen(
  pack: AgentMindscapeRankBuffs,
): AgentMindscapeRankBuffs {
  const migrateEffect = (effect: AgentMindscapeRankBuffs['effects'][number]) => {
    if (effect.stat !== 'energyRegenFlat') return effect
    const raw = Number(effect.value ?? effect.valuePerStack ?? 0)
    // 旧固定值若按 1.2 这类小数存，改为百分点 120；已是大数则视为已是百分点
    const asPercent = Number.isFinite(raw) && Math.abs(raw) > 0 && Math.abs(raw) < 10 ? raw * 100 : raw
    return {
      ...effect,
      stat: 'energyRegen' as const,
      value: effect.kind === 'stacked' ? effect.value : asPercent,
      valuePerStack: effect.kind === 'stacked' || effect.stackable ? asPercent : effect.valuePerStack,
    }
  }
  if (pack.effectBlocks?.length) {
    return packFromBlocks(
      pack.effectBlocks.map((block) => ({
        ...block,
        effects: block.effects.map(migrateEffect),
      })),
    )
  }
  return packFromEffects((pack.effects ?? []).map(migrateEffect))
}

function normalizeBangboo(item: Record<string, unknown>): BangbooBuffDoc {
  const bangbooId = String(item.id ?? '')
  const effectBlocks = Array.isArray(item.effectBlocks)
    ? normalizeBuffEffectBlocks(item.effectBlocks)
    : []

  let effects = effectBlocks.length
    ? flattenEffectBlocks(effectBlocks)
    : normalizeBuffEffects(item.effects ?? item.fixedEffects)
  const fixedMods = normalizeBuffStatModifiers(item.fixedMods ?? item.fixedBuffs)
  if (!effects.length && Object.values(fixedMods).some((v) => v !== 0)) {
    effects = flatModsToEffects(fixedMods, 'team', 'general', `${bangbooId || 'bangboo'}-fixed`)
  }

  let refinementEffectBlocks: ReturnType<typeof normalizeBuffEffectBlocks>[] | undefined
  if (Array.isArray(item.refinementEffectBlocks)) {
    const rawRanks = item.refinementEffectBlocks as unknown[]
    refinementEffectBlocks = REFINEMENT_RANKS.map((_, index) =>
      normalizeBuffEffectBlocks(rawRanks[index] ?? []),
    )
  }

  let refinementEffects: ReturnType<typeof normalizeBuffEffects>[] = []
  if (refinementEffectBlocks?.some((blocks) => blocks.length)) {
    refinementEffects = refinementEffectBlocks.map((blocks) => flattenEffectBlocks(blocks))
  } else if (Array.isArray(item.refinementEffects)) {
    refinementEffects = item.refinementEffects.map((list) => normalizeBuffEffects(list))
  } else {
    const refinementMods = Array.isArray(item.refinementMods)
      ? item.refinementMods
      : Array.isArray(item.refinementBuffs)
        ? item.refinementBuffs
        : createEmptyRefinementMods()
    refinementEffects = REFINEMENT_RANKS.map((_, index) => {
      const mods = normalizeBuffStatModifiers(refinementMods[index])
      return flatModsToEffects(
        mods,
        'team',
        'general',
        `${bangbooId || 'bangboo'}-r${index + 1}`,
      )
    })
  }

  while (refinementEffects.length < REFINEMENT_RANKS.length) {
    refinementEffects.push([])
  }

  const mergedFixed = normalizeBuffStatModifiers({})
  for (const effect of effects) {
    const amount = Number(effect.value ?? effect.valuePerStack) || 0
    if (amount) mergedFixed[effect.stat] += amount
  }

  return {
    id: bangbooId,
    name: String(item.name ?? ''),
    avatar_image:
      normalizeAvatarImage(item.avatar_image) ?? normalizeAvatarImage(item.avatar),
    effectBlocks: effectBlocks.length ? effectBlocks : undefined,
    effects,
    refinementEffectBlocks: refinementEffectBlocks?.some((blocks) => blocks.length)
      ? refinementEffectBlocks
      : undefined,
    refinementEffects: refinementEffects.slice(0, REFINEMENT_RANKS.length),
    fixedMods: Object.values(mergedFixed).some((v) => v) ? mergedFixed : fixedMods,
    refinementMods: refinementEffects.slice(0, REFINEMENT_RANKS.length).map((list) => {
      const mods = normalizeBuffStatModifiers({})
      for (const effect of list) {
        const amount = Number(effect.value ?? effect.valuePerStack) || 0
        if (amount) mods[effect.stat] += amount
      }
      return mods
    }),
  }
}

function normalizeDriveDisc(item: Record<string, unknown>): DriveDiscBuffDoc {
  const discId = String(item.id ?? '')
  const twoPieceEffectBlocks = Array.isArray(item.twoPieceEffectBlocks)
    ? normalizeBuffEffectBlocks(item.twoPieceEffectBlocks)
    : []

  let twoPieceEffects = twoPieceEffectBlocks.length
    ? flattenEffectBlocks(twoPieceEffectBlocks)
    : normalizeBuffEffects(item.twoPieceEffects)
  let twoPieceMods = normalizeTwoPieceMods(item.twoPieceMods ?? item.twoPiece)

  if (!twoPieceEffects.length && Object.values(twoPieceMods).some((v) => v !== 0)) {
    twoPieceEffects = flatModsToEffects(
      twoPieceMods,
      'self',
      'general',
      `${discId || 'disc'}-2pc`,
    )
  } else if (twoPieceEffects.length) {
    const mods = normalizeBuffStatModifiers({})
    for (const effect of twoPieceEffects) {
      const amount = Number(effect.value ?? effect.valuePerStack) || 0
      if (amount) mods[effect.stat] += amount
    }
    twoPieceMods = normalizeTwoPieceMods(mods)
  }

  return {
    id: discId,
    name: String(item.name ?? ''),
    avatar_image:
      normalizeAvatarImage(item.avatar_image) ?? normalizeAvatarImage(item.avatar),
    twoPieceEffectBlocks: twoPieceEffectBlocks.length ? twoPieceEffectBlocks : undefined,
    twoPieceEffects,
    twoPieceMods,
    fourPieceBuffs: normalizeSelfTeamBuffs(
      item.fourPieceBuffs ?? item.fourPieceMods ?? item.fourPiece,
    ),
    twoPieceNote: typeof item.twoPieceNote === 'string' ? item.twoPieceNote : '',
    fourPieceNote:
      typeof item.fourPieceNote === 'string'
        ? item.fourPieceNote
        : typeof item.note === 'string'
          ? item.note
          : '',
  }
}

function normalizeSkillSubcategory(item: Record<string, unknown>): SkillSubcategory {
  const mults = normalizeSkillSubcategoryMultFields(item as Partial<SkillSubcategory>)
  return {
    id: String(item.id ?? ''),
    agentId: String(item.agentId ?? ''),
    categoryId: (item.categoryId as SkillSubcategory['categoryId']) || 'basic',
    name: String(item.name ?? ''),
    countsAsFollowUp: Boolean(item.countsAsFollowUp),
    ...mults,
  }
}

function normalizeDamageEventMode(item: Record<string, unknown>): DamageEventMode {
  const events = Array.isArray(item.events) ? item.events : []
  const rawModeType = String(item.modeType ?? '')
  const modeType =
    rawModeType === 'anomaly' ? 'anomaly' as const : 'direct' as const
  return {
    id: String(item.id ?? ''),
    agentId: String(item.agentId ?? ''),
    name: String(item.name ?? ''),
    modeType,
    events: events.map((raw, index) => {
      const entry = raw as Record<string, unknown>
      return {
        id: String(entry.id ?? `evt-${index}`),
        kind: (entry.kind as DamageEventMode['events'][number]['kind']) ?? 'direct',
        categoryId: (entry.categoryId as SkillCategoryId) || 'basic',
        skillSubcategoryId:
          entry.skillSubcategoryId == null || entry.skillSubcategoryId === ''
            ? null
            : String(entry.skillSubcategoryId),
        count: Math.max(0, Number(entry.count) || 1),
        staggerPhase: entry.staggerPhase === 'normal' ? 'normal' : 'stagger',
        critMode:
          entry.critMode === 'noCrit' || entry.critMode === 'fullCrit'
            ? entry.critMode
            : 'expected',
        triggerAgentId:
          entry.triggerAgentId == null || entry.triggerAgentId === ''
            ? null
            : String(entry.triggerAgentId),
        skillBound: entry.skillBound === false ? false : entry.skillBound === true ? true : undefined,
        multOverrides: (entry.multOverrides as DamageEvent['multOverrides']) ?? null,
      }
    }),
  }
}

function normalizeFollowUpSkillRule(item: Record<string, unknown>): FollowUpSkillRule {
  return {
    id: String(item.id ?? ''),
    agentId: String(item.agentId ?? ''),
    categoryId: (item.categoryId as SkillCategoryId) || 'basic',
    subcategoryId:
      item.subcategoryId == null || item.subcategoryId === ''
        ? null
        : String(item.subcategoryId),
  }
}

export const useCalculatorBuffStore = defineStore('calculatorBuffs', () => {
  const agents = ref<AgentBuffDoc[]>([])
  const wengines = ref<WengineBuffDoc[]>([])
  const bangboos = ref<BangbooBuffDoc[]>([])
  const driveDiscs = ref<DriveDiscBuffDoc[]>([])
  const skillSubcategories = ref<SkillSubcategory[]>([])
  const followUpSkillRules = ref<FollowUpSkillRule[]>([])
  const damageEventModes = ref<DamageEventMode[]>([])
  const loading = ref(true)
  const loaded = ref(false)
  const error = ref('')

  let loadPromise: Promise<void> | null = null

  function applyLocalAgent(doc: AgentBuffDoc) {
    const index = agents.value.findIndex((item) => item.id === doc.id)
    if (index >= 0) {
      agents.value[index] = doc
      return
    }
    agents.value.push(doc)
  }

  function applyLocalWengine(doc: WengineBuffDoc) {
    const index = wengines.value.findIndex((item) => item.id === doc.id)
    if (index >= 0) {
      wengines.value[index] = doc
      return
    }
    wengines.value.push(doc)
  }

  function applyLocalBangboo(doc: BangbooBuffDoc) {
    const index = bangboos.value.findIndex((item) => item.id === doc.id)
    if (index >= 0) {
      bangboos.value[index] = doc
      return
    }
    bangboos.value.push(doc)
  }

  function applyLocalDriveDisc(doc: DriveDiscBuffDoc) {
    const index = driveDiscs.value.findIndex((item) => item.id === doc.id)
    if (index >= 0) {
      driveDiscs.value[index] = doc
      return
    }
    driveDiscs.value.push(doc)
  }

  async function loadAll(force = false) {
    if (loaded.value && !force) {
      loading.value = false
      return
    }
    if (loadPromise && !force) {
      await loadPromise
      loading.value = false
      return
    }

    loading.value = true
    error.value = ''

    loadPromise = (async () => {
      try {
        const data = await fetchCalculatorBuffs()
        agents.value = mergeMissingDefaultAgents(
          (data.agents ?? []).map((item) =>
            normalizeAgent(item as unknown as Record<string, unknown>),
          ),
        )
        wengines.value = (data.wengines ?? []).map((item) =>
          normalizeWengine(item as unknown as Record<string, unknown>),
        )
        bangboos.value = (data.bangboos ?? []).map((item) =>
          normalizeBangboo(item as unknown as Record<string, unknown>),
        )
        driveDiscs.value = (data.driveDiscs ?? []).map((item) =>
          normalizeDriveDisc(item as unknown as Record<string, unknown>),
        )
        skillSubcategories.value = (data.skillSubcategories ?? []).map((item) =>
          normalizeSkillSubcategory(item as unknown as Record<string, unknown>),
        )
        followUpSkillRules.value = (data.followUpSkillRules ?? []).map((item) =>
          normalizeFollowUpSkillRule(item as unknown as Record<string, unknown>),
        )
        try {
          const modes = await fetchDamageEventModes()
          damageEventModes.value = modes.map((item) =>
            normalizeDamageEventMode(item as unknown as Record<string, unknown>),
          )
        } catch {
          damageEventModes.value = []
        }
        loaded.value = true
        error.value = ''
      } catch (err) {
        error.value = err instanceof Error ? err.message : '加载计算器数据失败'
        throw err
      } finally {
        loading.value = false
        loadPromise = null
      }
    })()

    await loadPromise
  }

  async function ensureLoaded() {
    await loadAll(false)
  }

  async function upsertAgent(doc: AgentBuffDoc) {
    const saved = await saveAgentBuff(doc)
    applyLocalAgent(normalizeAgent(saved as unknown as Record<string, unknown>))
    return saved
  }

  async function deleteAgent(id: string) {
    await deleteAgentBuff(id)
    agents.value = agents.value.filter((item) => item.id !== id)
  }

  async function upsertWengine(doc: WengineBuffDoc) {
    const saved = await saveWengineBuff(doc)
    applyLocalWengine(normalizeWengine(saved as unknown as Record<string, unknown>))
    return saved
  }

  async function deleteWengine(id: string) {
    await deleteWengineBuff(id)
    wengines.value = wengines.value.filter((item) => item.id !== id)
  }

  async function upsertBangboo(doc: BangbooBuffDoc) {
    const saved = await saveBangbooBuff(doc)
    applyLocalBangboo(normalizeBangboo(saved as unknown as Record<string, unknown>))
    return saved
  }

  async function deleteBangboo(id: string) {
    await deleteBangbooBuff(id)
    bangboos.value = bangboos.value.filter((item) => item.id !== id)
  }

  async function upsertDriveDisc(doc: DriveDiscBuffDoc) {
    const payload: DriveDiscBuffDoc = {
      ...doc,
      twoPieceMods: normalizeTwoPieceMods(doc.twoPieceMods),
    }
    const saved = await saveDriveDiscBuff(payload)
    applyLocalDriveDisc(normalizeDriveDisc(saved as unknown as Record<string, unknown>))
    return saved
  }

  async function deleteDriveDisc(id: string) {
    await deleteDriveDiscBuff(id)
    driveDiscs.value = driveDiscs.value.filter((item) => item.id !== id)
  }

  async function upsertSkillSubcategoryDoc(doc: SkillSubcategory) {
    const saved = await saveSkillSubcategory(doc)
    const normalized = normalizeSkillSubcategory(saved as unknown as Record<string, unknown>)
    const index = skillSubcategories.value.findIndex((item) => item.id === normalized.id)
    if (index >= 0) skillSubcategories.value[index] = normalized
    else skillSubcategories.value.push(normalized)
    skillSubcategories.value.sort(
      (a, b) =>
        a.agentId.localeCompare(b.agentId) ||
        a.categoryId.localeCompare(b.categoryId) ||
        a.name.localeCompare(b.name),
    )
    return normalized
  }

  async function removeSkillSubcategoryDoc(id: string) {
    await deleteSkillSubcategory(id)
    skillSubcategories.value = skillSubcategories.value.filter((item) => item.id !== id)
  }

  async function upsertFollowUpSkillRuleDoc(doc: FollowUpSkillRule) {
    const saved = await saveFollowUpSkillRule(doc)
    const normalized = normalizeFollowUpSkillRule(saved as unknown as Record<string, unknown>)
    const index = followUpSkillRules.value.findIndex((item) => item.id === normalized.id)
    if (index >= 0) followUpSkillRules.value[index] = normalized
    else followUpSkillRules.value.push(normalized)
    followUpSkillRules.value.sort(
      (a, b) =>
        a.agentId.localeCompare(b.agentId) ||
        a.categoryId.localeCompare(b.categoryId) ||
        a.id.localeCompare(b.id),
    )
    return normalized
  }

  async function removeFollowUpSkillRuleDoc(id: string) {
    await deleteFollowUpSkillRule(id)
    followUpSkillRules.value = followUpSkillRules.value.filter((item) => item.id !== id)
  }

  async function upsertDamageEventModeDoc(doc: DamageEventMode) {
    const saved = await saveDamageEventMode(doc)
    const normalized = normalizeDamageEventMode(saved as unknown as Record<string, unknown>)
    const index = damageEventModes.value.findIndex((item) => item.id === normalized.id)
    if (index >= 0) damageEventModes.value[index] = normalized
    else damageEventModes.value.push(normalized)
    damageEventModes.value.sort(
      (a, b) => a.agentId.localeCompare(b.agentId) || a.name.localeCompare(b.name),
    )
    return normalized
  }

  async function removeDamageEventModeDoc(id: string) {
    await deleteDamageEventMode(id)
    damageEventModes.value = damageEventModes.value.filter((item) => item.id !== id)
  }

  return {
    agents,
    wengines,
    bangboos,
    driveDiscs,
    skillSubcategories,
    followUpSkillRules,
    damageEventModes,
    loading,
    loaded,
    error,
    loadAll,
    ensureLoaded,
    upsertAgent,
    deleteAgent,
    upsertWengine,
    deleteWengine,
    upsertBangboo,
    deleteBangboo,
    upsertDriveDisc,
    deleteDriveDisc,
    upsertSkillSubcategoryDoc,
    removeSkillSubcategoryDoc,
    upsertFollowUpSkillRuleDoc,
    removeFollowUpSkillRuleDoc,
    upsertDamageEventModeDoc,
    removeDamageEventModeDoc,
  }
})
