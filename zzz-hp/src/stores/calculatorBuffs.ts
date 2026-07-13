import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  deleteAgentBuff,
  deleteBangbooBuff,
  deleteDriveDiscBuff,
  deleteWengineBuff,
  fetchCalculatorBuffs,
  saveAgentBuff,
  saveBangbooBuff,
  saveDriveDiscBuff,
  saveWengineBuff,
} from '@/api/calculatorBuffs'
import type {
  AgentBuffDoc,
  BangbooBuffDoc,
  DriveDiscBuffDoc,
  WengineBuffDoc,
} from '@/types/calculator'
import {
  createEmptyMindscapeBuffs,
  createEmptyAgentBasePanel,
  defaultTurbulenceStats,
  normalizeAgentBasePanel,
  normalizeMindscapeNotes,
  normalizeBuffStatModifiers,
  normalizeRefinementMods,
  normalizeSelfTeamBuffs,
  normalizeTwoPieceMods,
  normalizeWengineAdvancedStats,
  normalizeWengineRarity,
  normalizeWengineRefinementBuffs,
  SUPPORT_STAT_OPTIONS,
} from '@/utils/calculatorUi'
import type { SupportStatNeed } from '@/types/calculator'

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

function normalizeMindscapeRank(entry: unknown) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const rank = entry as Record<string, unknown>
    if (rank.selfMods || rank.teamMods) {
      return {
        selfMods: normalizeBuffStatModifiers(rank.selfMods),
        teamMods: normalizeBuffStatModifiers(rank.teamMods),
      }
    }
  }
  return normalizeSelfTeamBuffs(entry)
}

function normalizeMindscapeBuffs(item: Record<string, unknown>) {
  if (Array.isArray(item.mindscapeBuffs) && item.mindscapeBuffs.length === 7) {
    return item.mindscapeBuffs.map((rank) => normalizeMindscapeRank(rank))
  }

  const mindscapeBuffs = createEmptyMindscapeBuffs()
  mindscapeBuffs[0] = normalizeMindscapeRank({
    selfMods: item.selfBuffs,
    teamMods: item.teamBuffs,
  })
  return mindscapeBuffs
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
    refinementBuffs: normalizeWengineRefinementBuffs(item.refinementBuffs),
  }
}

function normalizeBangboo(item: Record<string, unknown>): BangbooBuffDoc {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    avatar_image:
      normalizeAvatarImage(item.avatar_image) ?? normalizeAvatarImage(item.avatar),
    fixedMods: normalizeBuffStatModifiers(item.fixedMods ?? item.fixedBuffs),
    refinementMods: normalizeRefinementMods(item.refinementMods ?? item.refinementBuffs),
  }
}

function normalizeDriveDisc(item: Record<string, unknown>): DriveDiscBuffDoc {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    avatar_image:
      normalizeAvatarImage(item.avatar_image) ?? normalizeAvatarImage(item.avatar),
    twoPieceMods: normalizeTwoPieceMods(item.twoPieceMods ?? item.twoPiece),
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

export const useCalculatorBuffStore = defineStore('calculatorBuffs', () => {
  const agents = ref<AgentBuffDoc[]>([])
  const wengines = ref<WengineBuffDoc[]>([])
  const bangboos = ref<BangbooBuffDoc[]>([])
  const driveDiscs = ref<DriveDiscBuffDoc[]>([])
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
    if (loaded.value && !force) return
    if (loadPromise && !force) {
      await loadPromise
      return
    }

    loading.value = true
    error.value = ''

    loadPromise = (async () => {
      try {
        const data = await fetchCalculatorBuffs()
        agents.value = (data.agents ?? []).map((item) =>
          normalizeAgent(item as unknown as Record<string, unknown>),
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
        loaded.value = true
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

  return {
    agents,
    wengines,
    bangboos,
    driveDiscs,
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
  }
})
