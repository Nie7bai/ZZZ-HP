<script setup lang="ts">
import { computed, nextTick, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BangbooPickerSection from '@/components/calculator/BangbooPickerSection.vue'
import BuffEffectPickerModal from '@/components/calculator/BuffEffectPickerModal.vue'
import EnvironmentBuffFilterBar from '@/components/calculator/EnvironmentBuffFilterBar.vue'
import DamageCalcHistorySection from '@/components/calculator/DamageCalcHistorySection.vue'
import SkillFlowSection from '@/components/calculator/SkillFlowSection.vue'
import OptimalAffixAllocSection from '@/components/calculator/OptimalAffixAllocSection.vue'
import PanelCalcSection from '@/components/calculator/PanelCalcSection.vue'
import ExtraBuffGainModal from '@/components/calculator/ExtraBuffGainModal.vue'
import type { ExtraBuffGain } from '@/components/calculator/ExtraBuffGainEditor.vue'
import EnemyEnvironmentSection from '@/components/calculator/EnemyEnvironmentSection.vue'
import BuffModSourcesDisplay from '@/components/calculator/BuffModSourcesDisplay.vue'
import TeamBuilderSection from '@/components/calculator/TeamBuilderSection.vue'
import TeamSlotSwitcher from '@/components/calculator/TeamSlotSwitcher.vue'
import UnifiedPresetPicker, {
  type UnifiedPresetConfirmPayload,
} from '@/components/calculator/UnifiedPresetPicker.vue'
import type { DamageCalcSectionId } from '@/constants/damageCalcNav'
import type {
  DamageCalcHistoryEntry,
  DamageCalcSchemePanelSnapshot,
  DamageCalcWorkingDraft,
  SchemeSlot,
} from '@/types/damageCalcHistory'
import type {
  AffixCounts,
  AffixDriveDiscMainStats,
  PanelCalcMode,
  PanelStats,
} from '@/types/calculatorPanel'
import {
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
  createEmptyAffixCounts,
  createExternalPanelFromAgentBase,
  fillPanelStatsDefaults,
  isPlaceholderExternalPanel,
  resetSchemeExcludedPanelFields,
} from '@/types/calculatorPanel'
import type {
  AnomalyDamageSubKind,
  BangbooBuffDoc,
  DamageCalcKind,
  StaggerPhase,
} from '@/types/calculator'
import type { DefenseSeason } from '@/types/defense'
import type { PhaseData } from '@/types/history'
import { fetchCrisisAssaultPhases } from '@/api/crisisAssault'
import { fetchDefenseSeasons } from '@/api/defense'
import {
  deductionPeriodDisplay,
  fetchDeductionPhases,
  type DeductionPeriod,
} from '@/api/deduction'
import { lookupBossInfo } from '@/api/bossInfo'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  createHistoryEntryId,
  findDamageCalcHistory,
  getLoadedSchemeId,
  listAllDamageCalcHistory,
  loadWorkingDraft,
  nameConflictType,
  saveDamageCalcHistory,
  saveWorkingDraft,
  setLoadedSchemeId,
} from '@/utils/damageCalcHistory'
import {
  buildDefaultBuffSelection,
  collectAllBuffEffects,
  createEmptyMultiSlotBuffSelection,
  getBuffEffectEnabled,
  isEnvironmentBuffSourceKey,
  mergeDefaultBuffSelectionIntoMulti,
  resolveBuffSelectionForSlot,
  setBuffEffectEnabled,
  slotHasPanelConvertEffect,
  syncTeamProfessionAutoEnabled,
  type MultiSlotBuffSelection,
  type ConvertSlotPanels,
  type BuffSelectionState,
} from '@/utils/panelBuffCalc'
import { computeExternalPanelFromTeamSlot } from '@/utils/affixPanelCalc'
import {
  listCrisisEnvironmentBuffs,
  listDefenseEnvironmentBuffs,
  listDeductionEnvironmentBuffs,
  listDeductionEnvNodeFilterOptions,
  listDefenseEnvFrontierFilterOptions,
  parseBossFieldBossName,
  type EnvironmentBuffEntry,
} from '@/utils/environmentBuffCalc'
import type { EnvironmentBuffFilterMode } from '@/components/calculator/EnvironmentBuffFilterBar.vue'
import { mapBossInfoToDamageEnemyInput } from '@/utils/enemyInputFromBoss'
import {
  DEFAULT_ENEMY_STAGGER_MULTIPLIER,
  normalizeDamageEnemyInput,
  type DamageEnemyInput,
} from '@/utils/enemyResistance'
import { BUFF_STAT_FIELDS, buffStatFieldLabel, createEmptyBuffStatModifiers, createEmptyRefinementMods } from '@/utils/calculatorUi'
import {
  ensureSchemeSlots,
  resolveFlow,
  resolveSkillPreviews,
  buildGenericPanelSkillContext,
  schemeSlotsHaveContent,
} from '@/utils/resolvedHit'
import type { DamageCalcResult } from '@/utils/damageCalc'

export interface TeamSlot {
  agentId: string
  rank: number
  wengineId: string
  wengineRefine: number
  isMainC: boolean
  twoPieceDriveDiscId: string
  fourPieceDriveDiscId: string
  affixDriveDiscMainStats?: AffixDriveDiscMainStats
  affixCounts?: AffixCounts
}

const calculatorBuffStore = useCalculatorBuffStore()
const { agents, wengines, bangboos, driveDiscs, skillSubcategories } =
  storeToRefs(calculatorBuffStore)

const teamSlots = reactive<TeamSlot[]>([
  {
    agentId: '',
    rank: 0,
    wengineId: 'none',
    wengineRefine: 1,
    isMainC: true,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  },
  {
    agentId: '',
    rank: 0,
    wengineId: 'none',
    wengineRefine: 1,
    isMainC: false,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  },
  {
    agentId: '',
    rank: 0,
    wengineId: 'none',
    wengineRefine: 1,
    isMainC: false,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  },
])

const activeSlot = ref(0)
const selectedBangbooId = ref('none')
const bangbooRefine = ref(1)
const panelCalcMode = ref<PanelCalcMode>('panel')
const enemyInput = ref<DamageEnemyInput>(
  normalizeDamageEnemyInput({
    defense: 953,
    vulnerableMultiplier: 1,
    staggerMultiplier: DEFAULT_ENEMY_STAGGER_MULTIPLIER,
    specialMultiplier: 1,
    level: 60,
  }),
)
const historyEntries = ref<DamageCalcHistoryEntry[]>(listAllDamageCalcHistory())
const activeHistoryId = ref('')
const historyMessage = ref('')
const currentSchemeName = computed(
  () => historyEntries.value.find((entry) => entry.id === activeHistoryId.value)?.name ?? '',
)

const staggerPhase = ref<StaggerPhase>('stagger')
const anomalySlotPanels = reactive<Record<string, PanelStats>>({})
const convertSlotPanels = reactive<ConvertSlotPanels>({})
const extraGains = ref<ExtraBuffGain[]>([])
const schemeSlots = ref<SchemeSlot[]>(ensureSchemeSlots([], 3))
const hitDamages = ref<Record<string, number>>({})
const hitCalcResults = ref<Record<string, DamageCalcResult>>({})
const resolvedFlow = computed(() =>
  resolveFlow({
    slots: schemeSlots.value,
    teamSlots,
    findSkill: (id) => calculatorBuffStore.findSkill(id),
    skillSubcategories: skillSubcategories.value,
  }),
)
const hits = computed(() => resolvedFlow.value.hits)
const previewHits = computed(() =>
  resolveSkillPreviews({
    slots: schemeSlots.value,
    teamSlots,
    findSkill: (id) => calculatorBuffStore.findSkill(id),
    skillSubcategories: skillSubcategories.value,
  }),
)
const firstHit = computed(() => hits.value[0] ?? null)

const anomalySubKind = computed<AnomalyDamageSubKind>(
  () => firstHit.value?.anomalySubKind ?? 'anomaly',
)
/** 页级回落：第一击的异常强度提供者（非触发者）；逐 hit 请用 hit 字段 */
const triggerAnomalyAgentId = computed(() => firstHit.value?.anomalyPowerAgentId ?? null)
const damageKind = computed<DamageCalcKind>(() => firstHit.value?.damageKind ?? 'direct')
const skillCategoryId = computed(() => firstHit.value?.coords[0]?.category ?? 'basic')
const skillSubcategoryId = computed(() => firstHit.value?.coords[0]?.subcategoryId ?? null)

const buffPickerOpen = ref(false)
const extraBuffModalOpen = ref(false)
const teamPresetPickerOpen = ref(false)
const buffPickerViewSlotIndex = ref(0)
const multiSlotBuffSelection = reactive<MultiSlotBuffSelection>(createEmptyMultiSlotBuffSelection())

const envBuffMode = ref<EnvironmentBuffFilterMode>('none')
const envBuffVersion = ref('')
const envBuffPhaseId = ref('')
const envBuffFrontierId = ref('')
const envBuffNodeId = ref('')
const crisisPhases = ref<PhaseData[]>([])
const defenseSeasons = ref<DefenseSeason[]>([])
const deductionPeriods = ref<DeductionPeriod[]>([])
const envBuffLoadError = ref('')
let syncingBossFieldBuff = false
let syncingEnemyFromEnv = false
let draftHydrated = false
/** 恢复草稿/方案期间跳过 Buff 默认同步与场地 Buff 反写怪物 */
let restoringWorkingState = false
let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
const prevEnabledBossFieldKeys = ref<string[]>([])
const prevEnabledDefenseKeys = ref<string[]>([])
/** 临界节点 Buff（deduction-buff-*）单选：记录上一轮已勾选 sourceKey */
const prevEnabledDeductionNodeKeys = ref<string[]>([])

function compareVersionDesc(a: string, b: string) {
  const parse = (value: string) =>
    value.split('.').map((part) => Number(part.replace(/\D/g, '')) || 0)
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function sortPhaseOptionsDesc<T extends { version?: string; phase?: string; isHidden?: boolean }>(
  options: T[],
) {
  return options.slice().sort((a, b) => {
    const versionDiff = compareVersionDesc(a.version || '', b.version || '')
    if (versionDiff !== 0) return versionDiff
    return Number(b.phase || 0) - Number(a.phase || 0)
  })
}

function pickLatestPublicOptionId<T extends { id: string; isHidden?: boolean }>(options: T[]) {
  const publicOpt = options.find((opt) => !opt.isHidden)
  return publicOpt?.id ?? options[0]?.id ?? ''
}

function findFifthFrontierId(frontiers: { id: string; title: string }[]) {
  const byTitle = frontiers.find((frontier) => /第五防线/.test(frontier.title))
  if (byTitle) return byTitle.id
  const byId = frontiers.find((frontier) => frontier.id.endsWith('05'))
  return byId?.id ?? frontiers[0]?.id ?? ''
}

const crisisPhaseOptions = computed(() =>
  sortPhaseOptionsDesc(
    crisisPhases.value.map((phase) => {
      const phaseNum = phase.phase.replace(/\D/g, '') || phase.phase
      return {
        id: phase.id,
        label: `${phase.version} 第${phaseNum}期`,
        version: phase.version,
        phase: phaseNum,
        isHidden: Boolean(phase.isHidden),
      }
    }),
  ),
)

const defensePhaseOptions = computed(() =>
  sortPhaseOptionsDesc(
    defenseSeasons.value.map((season) => {
      const phaseNum = season.phase.replace(/\D/g, '') || season.phase
      return {
        id: season.seasonId,
        label: `${season.version} 第${phaseNum}期`,
        version: season.version,
        phase: phaseNum,
        isHidden: Boolean(season.isHidden),
      }
    }),
  ),
)

const deductionPhaseOptions = computed(() =>
  sortPhaseOptionsDesc(
    deductionPeriods.value.map((period) => {
      const pid = period.periodId
      const versionKey =
        pid.length >= 3 ? pid.slice(0, pid.length - 2) : pid
      const phaseNum =
        pid.length >= 2 ? pid.slice(-2) : period.phase.replace(/\D/g, '') || period.phase
      return {
        id: pid,
        label: deductionPeriodDisplay(period),
        version: versionKey,
        phase: phaseNum,
        isHidden: false,
      }
    }),
  ),
)

const deductionNodeOptions = computed(() =>
  listDeductionEnvNodeFilterOptions(selectedDeductionPeriod.value),
)

const envPhaseOptions = computed(() => {
  if (envBuffMode.value === 'crisis') return crisisPhaseOptions.value
  if (envBuffMode.value === 'defense') return defensePhaseOptions.value
  if (envBuffMode.value === 'deduction') return deductionPhaseOptions.value
  return []
})

function pickLatestEnvPhaseId(mode: EnvironmentBuffFilterMode) {
  if (mode === 'crisis') return pickLatestPublicOptionId(crisisPhaseOptions.value)
  if (mode === 'defense') return pickLatestPublicOptionId(defensePhaseOptions.value)
  if (mode === 'deduction') return pickLatestPublicOptionId(deductionPhaseOptions.value)
  return ''
}

function applyDefaultDefenseFrontier() {
  const season = selectedDefenseSeason.value
  if (!season) {
    envBuffFrontierId.value = ''
    return
  }
  const preferred = findFifthFrontierId(season.frontiers)
  const options = listDefenseEnvFrontierFilterOptions(season)
  if (preferred && options.some((opt) => opt.id === preferred)) {
    envBuffFrontierId.value = preferred
    return
  }
  envBuffFrontierId.value = options[0]?.id ?? ''
}

function applyDefaultDeductionNode() {
  const options = deductionNodeOptions.value
  if (!options.length) {
    envBuffNodeId.value = ''
    return
  }
  envBuffNodeId.value = options[0]?.id ?? ''
}

const selectedCrisisPhase = computed(
  () => crisisPhases.value.find((phase) => phase.id === envBuffPhaseId.value) ?? null,
)

const selectedDefenseSeason = computed(
  () => defenseSeasons.value.find((season) => season.seasonId === envBuffPhaseId.value) ?? null,
)

const selectedDeductionPeriod = computed(
  () => deductionPeriods.value.find((period) => period.periodId === envBuffPhaseId.value) ?? null,
)

const defenseFrontierOptions = computed(() =>
  listDefenseEnvFrontierFilterOptions(selectedDefenseSeason.value),
)

const activeEnvironmentBuffs = computed<EnvironmentBuffEntry[]>(() => {
  if (envBuffMode.value === 'none' || !envBuffPhaseId.value) return []
  if (envBuffMode.value === 'crisis') {
    const phase = selectedCrisisPhase.value
    if (!phase) return []
    return listCrisisEnvironmentBuffs(phase)
  }
  if (envBuffMode.value === 'deduction') {
    const period = selectedDeductionPeriod.value
    if (!period) return []
    return listDeductionEnvironmentBuffs(period, {
      nodeId: envBuffNodeId.value || undefined,
    })
  }
  if (!envBuffFrontierId.value) return []
  const season = selectedDefenseSeason.value
  if (!season) return []
  // 选中防线后展示该防线全部房间 Buff
  return listDefenseEnvironmentBuffs(season, {
    frontierId: envBuffFrontierId.value,
  })
})

const envBuffForceGroups = computed(() => {
  if (envBuffMode.value === 'crisis') return ['危局 Buff', 'Boss 场地 Buff']
  if (envBuffMode.value === 'defense') return ['防线 Buff']
  if (envBuffMode.value === 'deduction') return ['临界 Buff', 'Boss 场地 Buff']
  return []
})

const envBuffFilterHint = computed(() => {
  if (envBuffLoadError.value) return envBuffLoadError.value
  if (envBuffMode.value === 'none') {
    return '默认不显示危局 / Boss 场地 / 防线 / 临界 Buff。选择模式后出现对应分组。'
  }
  if (!envBuffPhaseId.value) {
    return envBuffMode.value === 'deduction'
      ? '请选择期数（默认最新一期）。'
      : '请选择版本与期数（默认已公开最新一期）。'
  }
  if (envBuffMode.value === 'crisis') {
    const list = activeEnvironmentBuffs.value
    const crisisCount = list.filter((item) => item.kind === 'crisis').length
    const bossCount = list.filter((item) => item.kind === 'boss-field').length
    return `危局 Buff ${crisisCount} 条 · Boss 场地 Buff ${bossCount} 条（默认不勾选；勾选 Boss 场地会联动敌方）。`
  }
  if (envBuffMode.value === 'deduction') {
    const list = activeEnvironmentBuffs.value
    const nodeCount = list.filter((item) => item.kind === 'deduction-node').length
    const fieldCount = list.filter((item) => item.kind === 'deduction-field').length
    const nodeHint = envBuffNodeId.value
      ? deductionNodeOptions.value.find((opt) => opt.id === envBuffNodeId.value)?.label ?? ''
      : '全部战斗节点'
    return `节点：${nodeHint} · 临界 Buff ${nodeCount} 条 · Boss 场地 Buff ${fieldCount} 条（仅含已录入结构化效果；默认不勾选；临界 / Boss 场地均为单选）。`
  }
  if (!envBuffFrontierId.value) return '请选择防线后显示该防线全部房间 Buff。'
  const count = activeEnvironmentBuffs.value.length
  return count
    ? `已加载该防线 ${count} 条 Buff（全部房间）。勾选时展示对应房间 Boss，并同步到敌方与环境。`
    : '该防线暂无已录入结构化效果的 Buff。'
})

async function loadEnvironmentBuffCatalogs() {
  envBuffLoadError.value = ''
  const errors: string[] = []

  const crisisResult = await Promise.allSettled([fetchCrisisAssaultPhases()])
  if (crisisResult[0]?.status === 'fulfilled') {
    crisisPhases.value = crisisResult[0].value
  } else {
    crisisPhases.value = []
    const reason = crisisResult[0]?.reason
    errors.push(
      `危局：${reason instanceof Error ? reason.message : '加载失败'}`,
    )
  }

  const defenseResult = await Promise.allSettled([
    fetchDefenseSeasons('new'),
    fetchDefenseSeasons('old'),
  ])
  const defenseLoaded: import('@/types/defense').DefenseSeason[] = []
  if (defenseResult[0]?.status === 'fulfilled') {
    defenseLoaded.push(...defenseResult[0].value)
  } else {
    const reason = defenseResult[0]?.reason
    errors.push(
      `防卫(新)：${reason instanceof Error ? reason.message : '加载失败'}`,
    )
  }
  if (defenseResult[1]?.status === 'fulfilled') {
    defenseLoaded.push(...defenseResult[1].value)
  } else {
    const reason = defenseResult[1]?.reason
    errors.push(
      `防卫(旧)：${reason instanceof Error ? reason.message : '加载失败'}`,
    )
  }
  defenseSeasons.value = defenseLoaded

  const deductionResult = await Promise.allSettled([fetchDeductionPhases()])
  if (deductionResult[0]?.status === 'fulfilled') {
    deductionPeriods.value = deductionResult[0].value
  } else {
    deductionPeriods.value = []
    const reason = deductionResult[0]?.reason
    errors.push(
      `临界：${reason instanceof Error ? reason.message : '加载失败'}`,
    )
  }

  if (
    errors.length &&
    !crisisPhases.value.length &&
    !defenseSeasons.value.length &&
    !deductionPeriods.value.length
  ) {
    envBuffLoadError.value = errors.join('；')
  } else if (errors.length) {
    envBuffLoadError.value = `部分数据加载失败：${errors.join('；')}`
  }

  if (envBuffMode.value !== 'none' && !envBuffPhaseId.value) {
    envBuffPhaseId.value = pickLatestEnvPhaseId(envBuffMode.value)
    if (envBuffMode.value === 'defense') applyDefaultDefenseFrontier()
    if (envBuffMode.value === 'deduction') applyDefaultDeductionNode()
  }
}

watch(envBuffMode, (mode) => {
  if (restoringWorkingState) return
  clearEnvironmentBuffSelections()
  envBuffFrontierId.value = ''
  envBuffNodeId.value = ''
  if (mode === 'none') {
    envBuffVersion.value = ''
    envBuffPhaseId.value = ''
    return
  }
  envBuffPhaseId.value = pickLatestEnvPhaseId(mode)
  if (mode === 'defense') applyDefaultDefenseFrontier()
  if (mode === 'deduction') applyDefaultDeductionNode()
})

watch(envBuffPhaseId, () => {
  if (restoringWorkingState) return
  clearEnvironmentBuffSelections()
  if (envBuffMode.value === 'defense') applyDefaultDefenseFrontier()
  if (envBuffMode.value === 'deduction') applyDefaultDeductionNode()
})

watch(envBuffNodeId, () => {
  if (restoringWorkingState) return
  // 临界换节点：上一节点勾选的局内环境 Buff 清空
  clearEnvironmentBuffSelections()
})

watch(envBuffFrontierId, () => {
  if (restoringWorkingState) return
  clearEnvironmentBuffSelections()
})

watch(defenseFrontierOptions, (options) => {
  if (!envBuffFrontierId.value) return
  if (!options.some((opt) => opt.id === envBuffFrontierId.value)) {
    envBuffFrontierId.value = options[0]?.id ?? ''
  }
})

watch(buffPickerOpen, (open) => {
  if (!open) return
  if (crisisPhases.value.length || defenseSeasons.value.length || deductionPeriods.value.length) {
    if (envBuffMode.value !== 'none' && !envBuffPhaseId.value) {
      envBuffPhaseId.value = pickLatestEnvPhaseId(envBuffMode.value)
      if (envBuffMode.value === 'defense') applyDefaultDefenseFrontier()
      if (envBuffMode.value === 'deduction') applyDefaultDeductionNode()
    }
    return
  }
  void loadEnvironmentBuffCatalogs()
})

function onPageHide() {
  persistWorkingDraftNow()
}

onMounted(() => {
  void loadEnvironmentBuffCatalogs()
  // Teleport defer 可能比本组件 onMounted 更晚挂上招式流程；晚一拍再恢复，避免子组件把空 slots 写回。
  void nextTick(() => {
    restoreWorkingState()
  })
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onDraftVisibilityChange)
})

onDeactivated(() => {
  persistWorkingDraftNow()
})

onUnmounted(() => {
  persistWorkingDraftNow()
  window.removeEventListener('pagehide', onPageHide)
  document.removeEventListener('visibilitychange', onDraftVisibilityChange)
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
})

function disableCollectedEffects(
  effects: ReturnType<typeof collectAllBuffEffects>,
  predicate: (item: (typeof effects)[number]) => boolean,
) {
  for (const item of effects) {
    if (!predicate(item)) continue
    setBuffEffectEnabled(
      multiSlotBuffSelection,
      buffPickerViewSlotIndex.value,
      item.effect.id,
      item.effect.applyTarget,
      false,
      { manual: false },
    )
  }
}

/** 切换模式 / 期数 / 节点 / 防线时清空已勾环境 Buff（含全队 store 残留） */
function clearEnvironmentBuffSelections() {
  const clearStore = (store: BuffSelectionState | undefined) => {
    if (!store) return
    for (const id of Object.keys(store.enabledIds)) {
      if (!isEnvironmentBuffSourceKey(id)) continue
      delete store.enabledIds[id]
    }
    for (const id of Object.keys(store.stacksByEffectId)) {
      if (!isEnvironmentBuffSourceKey(id)) continue
      delete store.stacksByEffectId[id]
    }
    for (const id of Object.keys(store.convertInputs)) {
      if (!isEnvironmentBuffSourceKey(id)) continue
      delete store.convertInputs[id]
    }
    if (store.manualTouchedIds) {
      for (const id of Object.keys(store.manualTouchedIds)) {
        if (!isEnvironmentBuffSourceKey(id)) continue
        delete store.manualTouchedIds[id]
      }
    }
  }
  clearStore(multiSlotBuffSelection.team)
  for (const store of Object.values(multiSlotBuffSelection.bySlot)) {
    clearStore(store)
  }
  prevEnabledBossFieldKeys.value = []
  prevEnabledDefenseKeys.value = []
  prevEnabledDeductionNodeKeys.value = []
  // 立刻写入环境 Buff 默认「未勾选」，避免缺省回退 enabledDefault 造成全选观感
  for (const opt of buffPickerSlotOptions.value) {
    syncBuffDefaultsForSlot(opt.index)
  }
}

async function applyEnemyBossByName(bossName: string, meta?: { version?: string; phase?: string }) {
  const name = bossName.trim()
  if (!name || syncingEnemyFromEnv) return
  syncingEnemyFromEnv = true
  try {
    const info = await lookupBossInfo(name)
    if (!info) return
    const next = mapBossInfoToDamageEnemyInput(info, enemyInput.value)
    if (meta?.version && meta?.phase) {
      next.bossRecordLabel = `${meta.version} 第${meta.phase}期 · ${name}`
    }
    Object.assign(enemyInput.value, normalizeDamageEnemyInput(next))
  } finally {
    // pre-flush 的 bossName watch 在本函数返回后才跑；须拖到 nextTick 再清标志，避免刚勾选的场地 Buff 被清掉
    await nextTick()
    syncingEnemyFromEnv = false
  }
}

function getParticipantAgentIds(): string[] {
  const ids = new Set<string>()
  for (const hit of [...hits.value, ...previewHits.value]) {
    for (const id of [hit.ownerAgentId, hit.anomalyPowerAgentId, hit.triggerAgentId]) {
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

function ensureAnomalySlotPanel(agentId: string) {
  const existing = anomalySlotPanels[agentId]
  if (existing && !isPlaceholderExternalPanel(existing)) {
    if (!Number.isFinite(existing.mutationCoeff) || !Number.isFinite(existing.mutationCoeffFactor)) {
      anomalySlotPanels[agentId] = fillPanelStatsDefaults(existing)
    }
    return
  }
  const agent = agents.value.find((item) => item.id === agentId)
  anomalySlotPanels[agentId] = createExternalPanelFromAgentBase(agent?.basePanel)
}

watch(
  () =>
    [...hits.value, ...previewHits.value]
      .map(
        (hit) =>
          `${hit.id}:${hit.ownerAgentId}:${hit.anomalyPowerAgentId ?? ''}:${hit.triggerAgentId ?? ''}`,
      )
      .join(','),
  () => {
    if (restoringWorkingState) return
    for (const agentId of getParticipantAgentIds()) {
      ensureAnomalySlotPanel(agentId)
    }
  },
)

const emptyBangboo: BangbooBuffDoc = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  effects: [],
  refinementEffects: createEmptyRefinementMods().map(() => []),
  fixedMods: createEmptyBuffStatModifiers(),
  refinementMods: createEmptyRefinementMods(),
}

const emit = defineEmits<{
  'update:calcMode': [mode: PanelCalcMode]
}>()

const skillFlowTeleportTo = computed(() =>
  panelCalcMode.value === 'optimal' ? '#skill-flow-anchor-optimal' : '#skill-flow-anchor-panel',
)

const panelCalcSectionRef = ref<InstanceType<typeof PanelCalcSection> | null>(null)
const optimalAffixSectionRef = ref<InstanceType<typeof OptimalAffixAllocSection> | null>(null)

const buffSelectionSignature = computed(() => JSON.stringify(multiSlotBuffSelection))
const combatBuffBreakdown = computed(() => {
  void extraGains.value
  void buffSelectionSignature.value
  void teamSlots.map((s) => s.agentId)
  void selectedBangbooId.value
  void bangbooRefine.value
  void hits.value.length
  void staggerPhase.value
  if (panelCalcMode.value === 'optimal') {
    return optimalAffixSectionRef.value?.buffBreakdown ?? null
  }
  return panelCalcSectionRef.value?.panelBreakdown ?? null
})

const activeSlotData = computed(() => teamSlots[activeSlot.value]!)
const activeAgent = computed(() =>
  agents.value.find((item) => item.id === activeSlotData.value.agentId),
)

const mainSlotIndex = computed(() => {
  const index = activeSlot.value
  return index >= 0 && index < teamSlots.length ? index : 0
})

const selectedBangboo = computed(
  () =>
    bangboos.value.find((item) => item.id === selectedBangbooId.value) ??
    bangboos.value.find((item) => item.id === 'none') ??
    emptyBangboo,
)

/** 队伍/音擎/驱动盘/邦布配置签名：变化时补默认 Buff，不整表清空勾选 */
const teamBuffSignature = computed(() =>
  JSON.stringify({
    slots: teamSlots.map((slot) => ({
      agentId: slot.agentId,
      rank: slot.rank,
      wengineId: slot.wengineId,
      wengineRefine: slot.wengineRefine,
      twoPieceDriveDiscId: slot.twoPieceDriveDiscId,
      fourPieceDriveDiscId: slot.fourPieceDriveDiscId,
    })),
    bangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
  }),
)

/** 异放/乱流/紊乱有产生角色时，增益属性过滤跟随该角色属性；否则跟当前编辑槽位 */
const damageElement = computed(() => {
  const needsTrigger =
    damageKind.value === 'anomaly' &&
    (anomalySubKind.value === 'disorder' ||
      anomalySubKind.value === 'turbulence' ||
      anomalySubKind.value === 'anomalyRelease')
  if (needsTrigger && triggerAnomalyAgentId.value) {
    const trigger = agents.value.find((item) => item.id === triggerAnomalyAgentId.value)
    if (trigger?.element) return trigger.element
  }
  return activeAgent.value?.element
})

const buffPickerSlotOptions = computed(() => {
  const options: { index: number; label: string }[] = []
  teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    const agent = agents.value.find((item) => item.id === slot.agentId)
    if (!agent) return
    options.push({
      index,
      label: `${agent.name} · ${agent.element}`,
    })
  })
  return options
})

function buildBuffCollectContext(mainSlotIdx: number) {
  const agent = agents.value.find((item) => item.id === teamSlots[mainSlotIdx]?.agentId)
  return {
    teamSlots,
    agents: agents.value,
    wengines: wengines.value,
    bangboo: selectedBangboo.value,
    bangbooRefine: bangbooRefine.value,
    mainSlotIndex: mainSlotIdx,
    driveDiscs: driveDiscs.value,
    environmentBuffs: activeEnvironmentBuffs.value,
    skillContext: buildGenericPanelSkillContext({
      element: agent?.element ?? damageElement.value,
      staggerPhase: staggerPhase.value,
    }),
  }
}

const collectedEffectsForPicker = computed(() =>
  collectAllBuffEffects(buildBuffCollectContext(buffPickerViewSlotIndex.value)),
)

const mainSlotBuffSelection = computed(() =>
  resolveBuffSelectionForSlot(multiSlotBuffSelection, mainSlotIndex.value),
)

const buffEnabledCount = computed(() => {
  const resolved = mainSlotBuffSelection.value
  if (!resolved) return 0
  return Object.values(resolved.enabledIds).filter(Boolean).length
})

/** 顶栏「转模」标签：该槽位影画/音擎/驱动盘含局外或局内转模 */
const convertSlotIndexes = computed(() => {
  void teamSlots.map(
    (slot) =>
      `${slot.agentId}:${slot.rank}:${slot.wengineId}:${slot.wengineRefine}:${slot.twoPieceDriveDiscId}:${slot.fourPieceDriveDiscId}`,
  )
  const indexes = new Set<number>()
  for (let i = 0; i < teamSlots.length; i++) {
    if (!teamSlots[i]?.agentId) continue
    // 以该槽为主槽收集，才能看到其「自身」转模
    const ctx = buildBuffCollectContext(i)
    if (slotHasPanelConvertEffect(ctx, i)) indexes.add(i)
  }
  return indexes
})

watch(
  panelCalcMode,
  (mode) => {
    emit('update:calcMode', mode)
  },
  { immediate: true },
)

watch(
  () => teamSlots.map((slot) => slot.agentId).join(','),
  () => {
    if (restoringWorkingState) return
    for (const slot of teamSlots) {
      if (slot.agentId) ensureAgentExternalPanel(slot.agentId)
    }
  },
  { immediate: true },
)

function syncBuffDefaultsForSlot(slotIndex: number) {
  const effects = collectAllBuffEffects(buildBuffCollectContext(slotIndex))
  const attrDefaults =
    panelCalcSectionRef.value?.getAttrDefaultsForSlot?.(slotIndex) ??
    panelCalcSectionRef.value?.convertAttrDefaults ??
    {}
  const defaults = buildDefaultBuffSelection(effects, attrDefaults)
  mergeDefaultBuffSelectionIntoMulti(multiSlotBuffSelection, slotIndex, effects, defaults)
  syncTeamProfessionAutoEnabled(
    multiSlotBuffSelection,
    slotIndex,
    effects,
    teamSlots,
    agents.value,
  )
}

watch(teamBuffSignature, () => {
  if (restoringWorkingState) return
  for (const opt of buffPickerSlotOptions.value) {
    syncBuffDefaultsForSlot(opt.index)
  }
})

watch(
  () => teamSlots.map((slot) => slot.agentId).join(','),
  () => {
    if (restoringWorkingState) return
    const options = buffPickerSlotOptions.value
    if (!options.length) return
    if (!options.some((opt) => opt.index === buffPickerViewSlotIndex.value)) {
      buffPickerViewSlotIndex.value = activeSlot.value
    }
    for (const opt of options) {
      syncBuffDefaultsForSlot(opt.index)
    }
  },
  { immediate: true },
)

watch(
  [collectedEffectsForPicker, buffPickerViewSlotIndex],
  () => {
    if (restoringWorkingState) return
    syncBuffDefaultsForSlot(buffPickerViewSlotIndex.value)
  },
  { immediate: true },
)

/** 仅队伍职业构成变化时重同步人数条件勾选（保留人工勾选） */
watch(
  () =>
    [
      ...teamSlots.map((slot) => slot.agentId),
      ...agents.value.map((agent) => `${agent.id}:${agent.profession}`),
    ].join('|'),
  () => {
    if (restoringWorkingState) return
    for (const opt of buffPickerSlotOptions.value) {
      const effects = collectAllBuffEffects(buildBuffCollectContext(opt.index))
      syncTeamProfessionAutoEnabled(
        multiSlotBuffSelection,
        opt.index,
        effects,
        teamSlots,
        agents.value,
      )
    }
  },
)

watch(
  () => panelCalcSectionRef.value?.convertAttrDefaults,
  () => {
    if (restoringWorkingState) return
    for (const opt of buffPickerSlotOptions.value) {
      const effects = collectAllBuffEffects(buildBuffCollectContext(opt.index))
      for (const item of effects) {
        if (item.effect.kind !== 'convert' || !item.effect.convert) continue
        const source = item.effect.convert.panelSource ?? 'external'
        if (source !== 'manual') continue
        const store =
          item.effect.applyTarget === 'team'
            ? multiSlotBuffSelection.team
            : multiSlotBuffSelection.bySlot[opt.index]
        if (!store) continue
        const id = item.effect.id
        if (id in store.convertInputs) continue
        const configured = item.effect.convert.defaultBase
        store.convertInputs[id] =
          configured != null && Number.isFinite(configured) ? configured : 0
      }
    }
  },
)

watch(
  [activeEnvironmentBuffs, () => multiSlotBuffSelection, buffPickerViewSlotIndex],
  async () => {
    if (syncingBossFieldBuff || restoringWorkingState) return
    const catalog = activeEnvironmentBuffs.value
    if (!catalog.length) return
    const effects = collectAllBuffEffects(buildBuffCollectContext(buffPickerViewSlotIndex.value))
    const enabledBossFieldKeys = new Set<string>()
    for (const item of effects) {
      const bossName = parseBossFieldBossName(item.sourceKey)
      if (!bossName) continue
      const enabled = getBuffEffectEnabled(
        multiSlotBuffSelection,
        buffPickerViewSlotIndex.value,
        item.effect.id,
        item.effect.applyTarget,
        false,
      )
      if (enabled) enabledBossFieldKeys.add(item.sourceKey)
    }

    if (enabledBossFieldKeys.size > 1) {
      syncingBossFieldBuff = true
      try {
        const current = [...enabledBossFieldKeys]
        const newly = current.filter((key) => !prevEnabledBossFieldKeys.value.includes(key))
        const keepKey = newly[0] ?? current[current.length - 1]!
        disableCollectedEffects(effects, (item) => {
          const fieldBoss = parseBossFieldBossName(item.sourceKey)
          return Boolean(fieldBoss) && item.sourceKey !== keepKey
        })
        enabledBossFieldKeys.clear()
        enabledBossFieldKeys.add(keepKey)
      } finally {
        syncingBossFieldBuff = false
      }
    }
    prevEnabledBossFieldKeys.value = [...enabledBossFieldKeys]

    // 临界节点 Buff：只能勾选一个（后点覆盖先前）
    const enabledDeductionNodeKeys = new Set<string>()
    for (const item of effects) {
      if (!item.sourceKey.startsWith('deduction-buff-')) continue
      const enabled = getBuffEffectEnabled(
        multiSlotBuffSelection,
        buffPickerViewSlotIndex.value,
        item.effect.id,
        item.effect.applyTarget,
        false,
      )
      if (enabled) enabledDeductionNodeKeys.add(item.sourceKey)
    }
    if (enabledDeductionNodeKeys.size > 1) {
      const current = [...enabledDeductionNodeKeys]
      const newly = current.filter((key) => !prevEnabledDeductionNodeKeys.value.includes(key))
      const keepKey = newly[0] ?? current[current.length - 1]!
      disableCollectedEffects(
        effects,
        (item) => item.sourceKey.startsWith('deduction-buff-') && item.sourceKey !== keepKey,
      )
      enabledDeductionNodeKeys.clear()
      enabledDeductionNodeKeys.add(keepKey)
    }
    prevEnabledDeductionNodeKeys.value = [...enabledDeductionNodeKeys]

    if (enabledBossFieldKeys.size === 1) {
      const sourceKey = [...enabledBossFieldKeys][0]!
      const entry = catalog.find((item) => item.sourceKey === sourceKey)
      const bossName = entry?.bossName ?? parseBossFieldBossName(sourceKey)
      const currentBoss = enemyInput.value.bossName
      if (bossName && bossName !== currentBoss) {
        await applyEnemyBossByName(bossName, {
          version: entry?.version,
          phase: entry?.phase,
        })
      }
    }

    const enabledDefenseKeys = catalog
      .filter((entry) => {
        if (entry.kind !== 'defense-room') return false
        return effects.some((item) => {
          if (item.sourceKey !== entry.sourceKey) return false
          return getBuffEffectEnabled(
            multiSlotBuffSelection,
            buffPickerViewSlotIndex.value,
            item.effect.id,
            item.effect.applyTarget,
            false,
          )
        })
      })
      .map((entry) => entry.sourceKey)
    const newlyDefense = enabledDefenseKeys.filter(
      (key) => !prevEnabledDefenseKeys.value.includes(key),
    )
    prevEnabledDefenseKeys.value = enabledDefenseKeys
    const defenseKey =
      newlyDefense[0] ?? (enabledDefenseKeys.length === 1 ? enabledDefenseKeys[0] : null)
    if (!defenseKey) return
    const defenseEntry = catalog.find((entry) => entry.sourceKey === defenseKey)
    const roomBoss = defenseEntry?.roomBosses?.[0]
    const currentBoss = enemyInput.value.bossName
    if (roomBoss?.name && roomBoss.name !== currentBoss) {
      await applyEnemyBossByName(roomBoss.name, {
        version: defenseEntry?.version,
        phase: defenseEntry?.phase,
      })
    }
  },
  { deep: true },
)

watch(
  () => enemyInput.value.bossName,
  (bossName) => {
    if (syncingEnemyFromEnv || syncingBossFieldBuff || restoringWorkingState) return
    const effects = collectAllBuffEffects(buildBuffCollectContext(buffPickerViewSlotIndex.value))
    // 按 Boss 名匹配，兼容危局 boss-field-* 与临界 deduction-field-*
    disableCollectedEffects(effects, (item) => {
      const fieldBoss = parseBossFieldBossName(item.sourceKey)
      if (!fieldBoss) return false
      return !bossName || fieldBoss !== bossName
    })
  },
)

function selectSlot(index: number) {
  activeSlot.value = index
}

function openTeamPresetPicker(index: number) {
  activeSlot.value = index
  teamPresetPickerOpen.value = true
}

function assignAgent(agentId: string) {
  activeSlotData.value.agentId = agentId
  ensureAgentExternalPanel(agentId)
}

function clearSlot(index: number) {
  const slot = teamSlots[index]!
  const oldId = slot.agentId
  slot.agentId = ''
  slot.rank = 0
  slot.wengineId = 'none'
  slot.wengineRefine = 1
  slot.twoPieceDriveDiscId = 'none'
  slot.fourPieceDriveDiscId = 'none'
  slot.affixDriveDiscMainStats = undefined
  slot.affixCounts = undefined
  if (oldId && !teamSlots.some((item) => item.agentId === oldId)) {
    delete anomalySlotPanels[oldId]
    delete convertSlotPanels[oldId]
  }
}

function ensureAgentExternalPanel(agentId: string) {
  if (!agentId) return
  if (anomalySlotPanels[agentId] && !isPlaceholderExternalPanel(anomalySlotPanels[agentId]!)) return
  const agent = agents.value.find((item) => item.id === agentId)
  anomalySlotPanels[agentId] = createExternalPanelFromAgentBase(agent?.basePanel)
}

function syncMainCFlagToActiveSlot() {
  teamSlots.forEach((slot, idx) => {
    slot.isMainC = idx === activeSlot.value
  })
}

function selectWengine(wengineId: string) {
  if (wengineId !== 'none' && activeSlotData.value.wengineId === wengineId) {
    activeSlotData.value.wengineId = 'none'
    return
  }
  activeSlotData.value.wengineId = wengineId
  if (wengineId !== 'none') {
    const wengine = wengines.value.find((item) => item.id === wengineId)
    if (wengine && wengine.rarity !== 'S') {
      activeSlotData.value.wengineRefine = 5
    }
  }
}

function selectBangboo(bangbooId: string) {
  if (bangbooId !== 'none' && selectedBangbooId.value === bangbooId) {
    selectedBangbooId.value = 'none'
    return
  }
  selectedBangbooId.value = bangbooId
}

const stickySlotPanelPreviews = computed(() => {
  // 显式依赖：增益/邦布/环境变化时必须重读子组件预览（template ref 不会自动串联子 computed）
  void buffSelectionSignature.value
  void extraGains.value
  void selectedBangbooId.value
  void bangbooRefine.value
  void staggerPhase.value
  void activeEnvironmentBuffs.value
  void panelCalcMode.value
  void anomalySlotPanels
  void convertSlotPanels
  void teamSlots.map((s) => [
    s.agentId,
    s.affixCounts,
    s.affixDriveDiscMainStats,
    s.wengineId,
    s.twoPieceDriveDiscId,
    s.fourPieceDriveDiscId,
  ])

  // 面板/词条模式：用 PanelCalcSection 的预览（含局内，随增益重算）
  if (panelCalcMode.value !== 'optimal') {
    const fromPanel = panelCalcSectionRef.value?.slotPanelPreviews
    if (fromPanel) return fromPanel
  }

  // 最优模式：用最优区预览（主 C 含局内；其余槽亦算局内）
  if (panelCalcMode.value === 'optimal') {
    const fromOptimal = optimalAffixSectionRef.value?.slotPanelPreviews
    if (fromOptimal?.length) return fromOptimal
  }

  // 兜底：轻量局外（页级导入值）
  return teamSlots.map((slot) => {
    if (!slot.agentId) return null
    const saved = anomalySlotPanels[slot.agentId]
    const external =
      saved && !isPlaceholderExternalPanel(saved)
        ? fillPanelStatsDefaults(saved)
        : computeExternalPanelFromTeamSlot({
            slot,
            agents: agents.value,
            wengines: wengines.value,
            driveDiscs: driveDiscs.value,
          })
    return { external, final: null as PanelStats | null }
  })
})

/** 导入弹窗局内预览：随草稿局外 + 当前增益实时重算（对齐改前内嵌面板行为） */
const importFinalPanelToken = computed(() =>
  JSON.stringify({
    buffs: buffSelectionSignature.value,
    extra: extraGains.value,
    bangboo: selectedBangbooId.value,
    refine: bangbooRefine.value,
    stagger: staggerPhase.value,
    env: activeEnvironmentBuffs.value.map((e) => e.sourceKey),
    mode: panelCalcMode.value,
    slot: activeSlot.value,
  }),
)

function resolveImportFinalPanel(external: PanelStats): PanelStats | null {
  const slotIndex = activeSlot.value
  if (panelCalcMode.value === 'optimal') {
    return (
      optimalAffixSectionRef.value?.previewFinalPanel?.(external, slotIndex) ??
      panelCalcSectionRef.value?.previewFinalPanel?.(external, slotIndex) ??
      null
    )
  }
  return panelCalcSectionRef.value?.previewFinalPanel?.(external, slotIndex) ?? null
}

const activeFinalPanelPreview = computed(() => {
  if (panelCalcMode.value === 'optimal') {
    const evalResult = optimalAffixSectionRef.value?.displayEval as
      | { finalPanel?: PanelStats }
      | undefined
    return evalResult?.finalPanel ?? null
  }
  return panelCalcSectionRef.value?.panelBreakdown?.finalPanel ?? null
})

watch(
  teamSlots,
  (slots) => {
    for (const slot of slots) {
      if (slot.agentId) ensureAgentExternalPanel(slot.agentId)
    }
  },
  { deep: true, immediate: true },
)

function applyUnifiedImport(payload: UnifiedPresetConfirmPayload) {
  const slot = teamSlots[activeSlot.value]
  if (!slot) return
  slot.rank = payload.rank
  slot.wengineId = payload.wengineId
  slot.wengineRefine = payload.wengineRefine
  slot.twoPieceDriveDiscId = payload.twoPieceDriveDiscId
  slot.fourPieceDriveDiscId = payload.fourPieceDriveDiscId
  slot.affixCounts = { ...createEmptyAffixCounts(), ...payload.affixCounts }
  slot.affixDriveDiscMainStats = {
    ...createDefaultAffixDriveDiscMainStats(),
    ...payload.affixDriveDiscMainStats,
  }
  anomalySlotPanels[payload.agentId] = fillPanelStatsDefaults(payload.externalPanel)
  slot.agentId = payload.agentId
  syncMainCFlagToActiveSlot()
  nextTick(() => {
    panelCalcSectionRef.value?.syncLivePanelFromCommitted?.()
  })
}

function cloneTeamSlots(): DamageCalcHistoryEntry['teamSlots'] {
  panelCalcSectionRef.value?.flushAffixOntoTeamSlots?.()
  return teamSlots.map((slot) => ({
    agentId: slot.agentId,
    rank: slot.rank,
    wengineId: slot.wengineId,
    wengineRefine: slot.wengineRefine,
    isMainC: slot.isMainC,
    twoPieceDriveDiscId: slot.twoPieceDriveDiscId || 'none',
    fourPieceDriveDiscId: slot.fourPieceDriveDiscId || 'none',
    affixDriveDiscMainStats: slot.affixDriveDiscMainStats
      ? { ...slot.affixDriveDiscMainStats }
      : undefined,
    affixCounts: slot.affixCounts ? { ...slot.affixCounts } : undefined,
  }))
}

function applyTeamSlots(slots: DamageCalcHistoryEntry['teamSlots']) {
  slots.forEach((slot, index) => {
    const target = teamSlots[index]
    if (!target) return
    // 先写装备/词条，再改 agentId：换人 watch 若仍跑到，读到的是方案里的盘，而不是空槽默认。
    target.rank = slot.rank
    target.wengineId = slot.wengineId
    target.wengineRefine = slot.wengineRefine
    target.isMainC = slot.isMainC
    target.twoPieceDriveDiscId =
      typeof slot.twoPieceDriveDiscId === 'string' && slot.twoPieceDriveDiscId
        ? slot.twoPieceDriveDiscId
        : 'none'
    target.fourPieceDriveDiscId =
      typeof slot.fourPieceDriveDiscId === 'string' && slot.fourPieceDriveDiscId
        ? slot.fourPieceDriveDiscId
        : 'none'
    target.affixDriveDiscMainStats = slot.affixDriveDiscMainStats
      ? { ...slot.affixDriveDiscMainStats }
      : undefined
    target.affixCounts = slot.affixCounts ? { ...slot.affixCounts } : undefined
    target.agentId = slot.agentId
  })
  syncMainCFlagToActiveSlot()
}

function cloneAnomalySlotPanels(): Record<string, PanelStats> {
  return JSON.parse(JSON.stringify(anomalySlotPanels)) as Record<string, PanelStats>
}

function captureSchemeAnomalySlotPanels(): Record<string, PanelStats> {
  const cloned = cloneAnomalySlotPanels()
  for (const [agentId, panel] of Object.entries(cloned)) {
    cloned[agentId] = resetSchemeExcludedPanelFields(panel)
  }
  return cloned
}

function cloneConvertSlotPanels(): ConvertSlotPanels {
  return JSON.parse(JSON.stringify(convertSlotPanels)) as ConvertSlotPanels
}

function applyAnomalySlotPanels(panels?: Record<string, PanelStats>) {
  for (const key of Object.keys(anomalySlotPanels)) {
    delete anomalySlotPanels[key]
  }
  if (!panels) return
  const cloned = JSON.parse(JSON.stringify(panels)) as Record<string, PanelStats>
  for (const [agentId, panel] of Object.entries(cloned)) {
    cloned[agentId] = resetSchemeExcludedPanelFields(fillPanelStatsDefaults(panel))
  }
  Object.assign(anomalySlotPanels, cloned)
}

function applyConvertSlotPanels(panels?: ConvertSlotPanels) {
  for (const key of Object.keys(convertSlotPanels)) {
    delete convertSlotPanels[key]
  }
  if (!panels) return
  Object.assign(convertSlotPanels, JSON.parse(JSON.stringify(panels)))
}

function pickSlotsToRestore(entry: { slots?: SchemeSlot[]; loadedSchemeId?: string }) {
  if (schemeSlotsHaveContent(entry.slots)) return entry.slots
  const schemeId = entry.loadedSchemeId || getLoadedSchemeId()
  const scheme = findDamageCalcHistory(schemeId)
  if (schemeSlotsHaveContent(scheme?.slots)) return scheme!.slots
  return entry.slots
}

function applyWorkingState(entry: {
  teamSlots: DamageCalcHistoryEntry['teamSlots']
  activeSlot: number
  selectedBangbooId: string
  bangbooRefine: number
  panelCalcMode: PanelCalcMode
  anomalySlotPanels?: Record<string, PanelStats>
  convertSlotPanels?: ConvertSlotPanels
  slots?: SchemeSlot[]
  loadedSchemeId?: string
  staggerPhase?: StaggerPhase
  multiSlotBuffSelection?: MultiSlotBuffSelection
  panelState?: DamageCalcHistoryEntry['panelState'] | null
  envBuffMode?: EnvironmentBuffFilterMode
  envBuffVersion?: string
  envBuffPhaseId?: string
  envBuffFrontierId?: string
  envBuffNodeId?: string
  preserveBaseDamageSource?: boolean
}) {
  restoringWorkingState = true
  panelCalcSectionRef.value?.beginRestore()
  const restoredBuff = entry.multiSlotBuffSelection
    ? (JSON.parse(JSON.stringify(entry.multiSlotBuffSelection)) as MultiSlotBuffSelection)
    : createEmptyMultiSlotBuffSelection()
  activeSlot.value = entry.activeSlot
  applyTeamSlots(entry.teamSlots)
  selectedBangbooId.value = entry.selectedBangbooId
  bangbooRefine.value = entry.bangbooRefine
  panelCalcMode.value = entry.panelCalcMode === 'optimal' ? 'affix' : entry.panelCalcMode
  applyAnomalySlotPanels(entry.anomalySlotPanels)
  applyConvertSlotPanels(entry.convertSlotPanels)
  schemeSlots.value = ensureSchemeSlots(pickSlotsToRestore(entry), 3)
  staggerPhase.value = entry.staggerPhase ?? 'stagger'
  if (entry.envBuffMode != null) envBuffMode.value = entry.envBuffMode
  if (entry.envBuffVersion != null) envBuffVersion.value = entry.envBuffVersion
  if (entry.envBuffPhaseId != null) envBuffPhaseId.value = entry.envBuffPhaseId
  if (entry.envBuffFrontierId != null) envBuffFrontierId.value = entry.envBuffFrontierId
  if (entry.envBuffNodeId != null) envBuffNodeId.value = entry.envBuffNodeId

  const applyPanelSnapshot = () => {
    if (!entry.panelState) return
    const panelState = {
      ...entry.panelState,
      externalPanel: resetSchemeExcludedPanelFields({
        ...entry.panelState.externalPanel,
      }),
    }
    panelCalcSectionRef.value?.loadSnapshot(panelState, {
      preserveBaseDamageSource: entry.preserveBaseDamageSource,
    })
  }
  // 必须在换人 watch 同一轮里写回快照，不能拖到 nextTick：
  // 否则默认 4/5/6（爆伤/攻击/生命）会先被 flush 进槽位，再被草稿 persist 写死。
  applyPanelSnapshot()

  // Buff 默认同步仍等队伍签名 watch 跑完再覆盖
  void nextTick(() => {
    multiSlotBuffSelection.team = restoredBuff.team
    multiSlotBuffSelection.bySlot = restoredBuff.bySlot
    applyPanelSnapshot()
    void nextTick(() => {
      persistWorkingDraftNow(true)
      restoringWorkingState = false
      panelCalcSectionRef.value?.endRestore()
    })
  })
}

function captureSchemePanelState(): DamageCalcSchemePanelSnapshot | null {
  const snapshot = panelCalcSectionRef.value?.getSnapshot()
  if (!snapshot) return null

  // 方案快照白名单：只保留用户侧配置。
  // 不跟方案走的内部字段：
  // - 基础伤害来源开关
  // - 异化系数乘区输入（mutationCoeff / mutationCoeffFactor）
  const { baseDamageSource: _ignored, ...schemeSnapshot } = snapshot
  const externalPanel = resetSchemeExcludedPanelFields({ ...schemeSnapshot.externalPanel })
  return { ...schemeSnapshot, externalPanel }
}

function captureWorkingDraft(): DamageCalcWorkingDraft | null {
  const panelState = panelCalcSectionRef.value?.getSnapshot() ?? null
  return {
    savedAt: Date.now(),
    loadedSchemeId: activeHistoryId.value || getLoadedSchemeId(),
    teamSlots: cloneTeamSlots(),
    activeSlot: activeSlot.value,
    selectedBangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
    panelCalcMode: panelCalcMode.value,
    panelState,
    anomalySlotPanels: captureSchemeAnomalySlotPanels(),
    convertSlotPanels: cloneConvertSlotPanels(),
    slots: JSON.parse(JSON.stringify(schemeSlots.value)),
    staggerPhase: staggerPhase.value,
    multiSlotBuffSelection: JSON.parse(JSON.stringify(multiSlotBuffSelection)),
    envBuffMode: envBuffMode.value,
    envBuffVersion: envBuffVersion.value,
    envBuffPhaseId: envBuffPhaseId.value,
    envBuffFrontierId: envBuffFrontierId.value,
    envBuffNodeId: envBuffNodeId.value,
  }
}

function persistWorkingDraftNow(force = false) {
  if (!force && (!draftHydrated || restoringWorkingState)) return
  const draft = captureWorkingDraft()
  if (!draft) return
  saveWorkingDraft(draft)
}

function schedulePersistWorkingDraft() {
  if (!draftHydrated || restoringWorkingState) return
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null
    persistWorkingDraftNow()
  }, 400)
}

function onDraftVisibilityChange() {
  if (document.visibilityState === 'hidden') persistWorkingDraftNow()
}

function restoreWorkingState() {
  const loadedId = getLoadedSchemeId()
  activeHistoryId.value = loadedId
  const draft = loadWorkingDraft()
  if (draft) {
    applyWorkingState({
      ...draft,
      loadedSchemeId: draft.loadedSchemeId || loadedId,
      preserveBaseDamageSource: true,
    })
    if (draft.loadedSchemeId) activeHistoryId.value = draft.loadedSchemeId
  } else if (loadedId) {
    const entry = findDamageCalcHistory(loadedId)
    if (entry) applyWorkingState({ ...entry, preserveBaseDamageSource: false })
  }
  void nextTick(() => {
    void nextTick(() => {
      draftHydrated = true
      persistWorkingDraftNow(true)
    })
  })
}

function saveHistoryEntry(payload: { name: string; folder: string }) {
  if (panelCalcMode.value === 'optimal') {
    historyMessage.value = '最优词条分配模式暂不支持写入历史，请切换到面板/词条计算后再保存'
    return
  }
  const panelState = captureSchemePanelState()
  if (!panelState) return

  const folder = payload.folder?.trim() || ''
  // 同名保护：「保存当前配置」只用于新建方案，不能覆盖同名方案，也不能与目录重名。
  // 要覆盖已有方案，必须点该方案卡片上的「保存」按钮（走 overwriteHistoryEntry）。
  const name = payload.name.trim()
  const conflict = nameConflictType(folder, name, 'scheme')
  if (conflict === 'scheme') {
    historyMessage.value = `已存在同名方案「${name}」；覆盖请点击该方案上的「保存」按钮`
    return
  }
  const entry: DamageCalcHistoryEntry = {
    id: createHistoryEntryId(),
    name: payload.name,
    savedAt: Date.now(),
    teamSlots: cloneTeamSlots(),
    activeSlot: activeSlot.value,
    selectedBangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
    panelCalcMode: panelCalcMode.value,
    panelState,
    anomalySlotPanels: captureSchemeAnomalySlotPanels(),
    convertSlotPanels: cloneConvertSlotPanels(),
    slots: JSON.parse(JSON.stringify(schemeSlots.value)),
    staggerPhase: staggerPhase.value,
    multiSlotBuffSelection: JSON.parse(JSON.stringify(multiSlotBuffSelection)),
    folder,
    order: Date.now(),
  }

  historyEntries.value = saveDamageCalcHistory(entry)
  activeHistoryId.value = entry.id
  setLoadedSchemeId(entry.id)
  historyMessage.value = `已保存「${payload.name}」${folder ? `（${folder}）` : ''}`
  persistWorkingDraftNow()
}

function loadHistoryEntry(entry: DamageCalcHistoryEntry) {
  applyWorkingState({ ...entry, preserveBaseDamageSource: false })
  activeHistoryId.value = entry.id
  setLoadedSchemeId(entry.id)
  historyMessage.value = `已加载「${entry.name}」`
}

/** 用当前页面配置覆盖指定方案（保留其 id / 名称 / 目录） */
function overwriteHistoryEntry(id: string) {
  if (panelCalcMode.value === 'optimal') {
    historyMessage.value = '最优词条分配模式暂不支持写入，请切换到面板/词条计算后再保存'
    return
  }
  const panelState = captureSchemePanelState()
  if (!panelState) return
  const existing = historyEntries.value.find((item) => item.id === id)
  if (!existing) return
  const updated: DamageCalcHistoryEntry = {
    ...existing,
    savedAt: Date.now(),
    order: Date.now(),
    teamSlots: cloneTeamSlots(),
    activeSlot: activeSlot.value,
    selectedBangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
    panelCalcMode: panelCalcMode.value,
    panelState,
    anomalySlotPanels: captureSchemeAnomalySlotPanels(),
    convertSlotPanels: cloneConvertSlotPanels(),
    slots: JSON.parse(JSON.stringify(schemeSlots.value)),
    staggerPhase: staggerPhase.value,
    multiSlotBuffSelection: JSON.parse(JSON.stringify(multiSlotBuffSelection)),
  }
  historyEntries.value = saveDamageCalcHistory(updated)
  activeHistoryId.value = updated.id
  historyMessage.value = `已用当前配置覆盖「${updated.name}」`
  persistWorkingDraftNow()
}

/** 方案库内部直接改了 localStorage（复制/重命名/删除/批量/目录/导入），在此刷新列表（全量） */
function onSchemeLibraryChanged() {
  historyEntries.value = listAllDamageCalcHistory()
}

function blankTeamSlots(): TeamSlot[] {
  return [
    {
      agentId: '',
      rank: 0,
      wengineId: 'none',
      wengineRefine: 1,
      isMainC: true,
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
    },
    {
      agentId: '',
      rank: 0,
      wengineId: 'none',
      wengineRefine: 1,
      isMainC: false,
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
    },
    {
      agentId: '',
      rank: 0,
      wengineId: 'none',
      wengineRefine: 1,
      isMainC: false,
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
    },
  ]
}

function defaultEnemyInput(): DamageEnemyInput {
  return normalizeDamageEnemyInput({
    defense: 953,
    vulnerableMultiplier: 1,
    staggerMultiplier: DEFAULT_ENEMY_STAGGER_MULTIPLIER,
    specialMultiplier: 1,
    level: 60,
  })
}

/** 方案边界内的空白页：队伍/面板/额外 Buff/准备流程/敌方。不含方案库、自建招式、流程伤害记录、危局筛选、公式开关。 */
function emptySchemePanelState(): DamageCalcSchemePanelSnapshot {
  return {
    externalPanel: resetSchemeExcludedPanelFields(createDefaultExternalPanel()),
    affixCounts: createEmptyAffixCounts(),
    affixDriveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
    affixStateByAgent: {},
    extraMods: createEmptyBuffStatModifiers(),
    extraGains: [],
    enemyInput: defaultEnemyInput(),
  }
}

function resetPageSchemeConfig() {
  applyWorkingState({
    teamSlots: blankTeamSlots(),
    activeSlot: 0,
    selectedBangbooId: 'none',
    bangbooRefine: 1,
    panelCalcMode: 'panel',
    anomalySlotPanels: {},
    convertSlotPanels: {},
    slots: ensureSchemeSlots([], 3),
    staggerPhase: 'stagger',
    multiSlotBuffSelection: createEmptyMultiSlotBuffSelection(),
    panelState: emptySchemePanelState(),
    preserveBaseDamageSource: true,
  })
  extraGains.value = []
  enemyInput.value = defaultEnemyInput()
  activeHistoryId.value = ''
  setLoadedSchemeId('')
}

function onSchemeImported(loadedId: string) {
  calculatorBuffStore.reloadCustomSkillsFromStorage()
  historyEntries.value = listAllDamageCalcHistory()
  const entry = loadedId ? findDamageCalcHistory(loadedId) : null
  if (entry) {
    loadHistoryEntry(entry)
    return
  }
  resetPageSchemeConfig()
}

watch(
  [
    teamSlots,
    schemeSlots,
    activeSlot,
    selectedBangbooId,
    bangbooRefine,
    panelCalcMode,
    staggerPhase,
    extraGains,
    enemyInput,
    anomalySlotPanels,
    convertSlotPanels,
    multiSlotBuffSelection,
  ],
  schedulePersistWorkingDraft,
  { deep: true },
)

watch(activeSlot, syncMainCFlagToActiveSlot)

const pageRootRef = ref<HTMLElement | null>(null)
const skillFlowSectionRef = ref<InstanceType<typeof SkillFlowSection> | null>(null)
const historySectionRef = ref<InstanceType<typeof DamageCalcHistorySection> | null>(null)

function openSchemeLibrary() {
  historySectionRef.value?.openModal()
}

function clearCurrentScheme() {
  historySectionRef.value?.clearLoadedScheme()
}

function onClearLoadedScheme() {
  resetPageSchemeConfig()
}

async function scrollToSection(sectionId: DamageCalcSectionId) {
  await nextTick()
  if (sectionId === 'damage-calc-panel') panelCalcMode.value = 'panel'
  if (sectionId === 'damage-calc-affix') panelCalcMode.value = 'affix'
  if (sectionId === 'damage-calc-optimal') panelCalcMode.value = 'optimal'
  if (sectionId === 'skill-flow') {
    skillFlowSectionRef.value?.expand()
    await nextTick()
  }
  const anchorId =
    sectionId === 'damage-calc-panel' ||
    sectionId === 'damage-calc-affix' ||
    sectionId === 'damage-calc-optimal'
      ? 'damage-calc-mode'
      : sectionId
  const target = pageRootRef.value?.querySelector<HTMLElement>(`#${anchorId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function setCalcMode(mode: PanelCalcMode) {
  if (panelCalcMode.value === mode) return
  panelCalcMode.value = mode
}

function selectPanelCalcMode(mode: PanelCalcMode) {
  const changed = panelCalcMode.value !== mode
  if (changed) {
    // 先让 Tab 高亮，把重 DOM 切换放到下一帧，避免点击瞬时卡死
    panelCalcMode.value = mode
  }
  const anchor =
    mode === 'panel'
      ? 'damage-calc-panel'
      : mode === 'affix'
        ? 'damage-calc-affix'
        : 'damage-calc-optimal'
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void scrollToSection(anchor)
    })
  })
}

defineExpose({ scrollToSection, setCalcMode, panelCalcMode })
</script>

<template>
  <div ref="pageRootRef" class="damage-page">
    <div class="team-slot-sticky">
      <TeamSlotSwitcher
        :team-slots="teamSlots"
        :agents="agents"
        :wengines="wengines"
        :drive-discs="driveDiscs"
        :active-index="activeSlot"
        :panel-previews="stickySlotPanelPreviews"
        :convert-slot-indexes="convertSlotIndexes"
        @select="selectSlot"
        @import="openTeamPresetPicker"
        @clear="clearSlot"
      />
      <div class="scheme-lib-actions">
        <button type="button" class="scheme-lib-btn" @click="openSchemeLibrary">方案库</button>
        <button
          type="button"
          class="scheme-clear-btn"
          title="清空当前页面配置，不删除方案库里的存档"
          @click="clearCurrentScheme"
        >
          清空当前配置
        </button>
      </div>
    </div>
    <UnifiedPresetPicker
      v-model:open="teamPresetPickerOpen"
      hide-trigger
      :agents="agents"
      :wengines="wengines"
      :drive-discs="driveDiscs"
      :team-slots="teamSlots"
      :active-slot="activeSlot"
      :preferred-entry-mode="panelCalcMode === 'affix' ? 'affix' : 'panel'"
      :anomaly-slot-panels="anomalySlotPanels"
      :final-panel-preview="activeFinalPanelPreview"
      :final-panel-token="importFinalPanelToken"
      :resolve-final-panel="resolveImportFinalPanel"
      @confirm="applyUnifiedImport"
    />
    <!-- 构图：方案库 → 编队/邦布 → 局内Buff → 敌方与环境 → 计算方式 → 伤害 → 招式流程 -->
    <DamageCalcHistorySection
      ref="historySectionRef"
      :entries="historyEntries"
      :agents="agents"
      :active-entry-id="activeHistoryId"
      :message="historyMessage"
      @save="saveHistoryEntry"
      @overwrite="overwriteHistoryEntry"
      @load="loadHistoryEntry"
      @changed="onSchemeLibraryChanged"
      @imported="onSchemeImported"
      @clear-loaded="onClearLoadedScheme"
    />

    <TeamBuilderSection
      :agents="agents"
      :wengines="wengines"
      :drive-discs="driveDiscs"
      :team-slots="teamSlots"
      :active-slot="activeSlot"
      :active-agent="activeAgent"
      :preferred-entry-mode="panelCalcMode === 'affix' ? 'affix' : 'panel'"
      :anomaly-slot-panels="anomalySlotPanels"
      :final-panel-preview="activeFinalPanelPreview"
      :final-panel-token="importFinalPanelToken"
      :resolve-final-panel="resolveImportFinalPanel"
      @select-slot="selectSlot"
      @assign-agent="assignAgent"
      @clear-slot="clearSlot"
      @select-wengine="selectWengine"
      @confirm-import="applyUnifiedImport"
    />

    <BangbooPickerSection
      :bangboos="bangboos"
      :selected-id="selectedBangbooId"
      :refine="bangbooRefine"
      @select="selectBangboo"
      @update:refine="bangbooRefine = $event"
    />

    <section
      id="damage-combat-buff"
      class="calc-mode-section combat-buff-section damage-anchor"
    >
      <header class="calc-mode-header">
        <h2>局内 Buff 增益</h2>
        <p class="calc-mode-desc">
          勾选局内 Buff、补充额外增益，并查看当前局内增益汇总。失衡判定跟招式流程条目走。
        </p>
      </header>
      <div class="skill-context-row">
        <button type="button" class="buff-open-btn" @click="buffPickerOpen = true">
          选择局内 Buff（已选 {{ buffEnabledCount }} ）
        </button>
        <button type="button" class="buff-open-btn" @click="extraBuffModalOpen = true">
          额外 Buff 增益（已加 {{ extraGains.length }} ）
        </button>
        <p class="buff-set-hint">2件套数值均已自动配置，无需选择2件套。</p>
      </div>

      <details v-if="combatBuffBreakdown" class="buff-breakdown">
        <summary>查看局内增益汇总数值</summary>
        <ul class="mods-summary">
          <li v-for="field in BUFF_STAT_FIELDS" :key="field.key">
            <span>{{ buffStatFieldLabel(field) }}</span>
            <strong>{{ combatBuffBreakdown.totalMods[field.key] }}</strong>
          </li>
        </ul>
        <BuffModSourcesDisplay
          :sources="combatBuffBreakdown.sources"
          :skill-subcategories="skillSubcategories"
        />
      </details>
    </section>

    <ExtraBuffGainModal
      v-model:open="extraBuffModalOpen"
      v-model:gains="extraGains"
      :skill-subcategories="skillSubcategories"
      :team-slots="teamSlots"
      :agents="agents"
    />

    <BuffEffectPickerModal
      v-model:open="buffPickerOpen"
      v-model:multi-selection="multiSlotBuffSelection"
      v-model:view-slot-index="buffPickerViewSlotIndex"
      :effects="collectedEffectsForPicker"
      :force-groups="envBuffForceGroups"
      :slot-options="buffPickerSlotOptions"
      :team-slots="teamSlots"
      :agents="agents"
      :attr-defaults="panelCalcSectionRef?.getAttrDefaultsForSlot?.(buffPickerViewSlotIndex) ?? panelCalcSectionRef?.convertAttrDefaults ?? {}"
      :panel-source-values="panelCalcSectionRef?.getPanelSourceValuesForSlot?.(buffPickerViewSlotIndex) ?? panelCalcSectionRef?.convertPanelSourceValues ?? undefined"
      :panel-source-values-by-slot="panelCalcSectionRef?.panelSourceValuesBySlot ?? undefined"
      :skill-subcategories="skillSubcategories"
    >
      <template #environment-filter>
        <EnvironmentBuffFilterBar
          v-model:mode="envBuffMode"
          v-model:version="envBuffVersion"
          v-model:phase-id="envBuffPhaseId"
          v-model:frontier-id="envBuffFrontierId"
          v-model:node-id="envBuffNodeId"
          :phase-options="envPhaseOptions"
          :phase-label-mode="envBuffMode === 'deduction' ? 'deduction' : 'default'"
          :frontier-options="defenseFrontierOptions"
          :node-options="deductionNodeOptions"
          :hint="envBuffFilterHint"
        />
      </template>
    </BuffEffectPickerModal>

    <section id="damage-enemy" class="calc-mode-section enemy-env-section damage-anchor">
      <EnemyEnvironmentSection
        v-model="enemyInput"
        title="敌方与环境"
        description="选择 Boss 或手动录入防御、抗性与失衡倍率，供面板计算与最优词条共用。"
      />
    </section>

    <section id="damage-calc-mode" class="calc-mode-section damage-anchor">
      <header class="calc-mode-header">
        <h2>计算方式</h2>
        <p class="calc-mode-desc">
          局外 / 词条在「代理人 → 导入」的面板 Tab 录入（含截图识别）；面板计算用手填局外，词条计算用副词条推导；最优词条在约束下扫描并绘制期望伤害曲线。
        </p>
      </header>
      <div class="calc-mode-tabs" role="tablist" aria-label="面板计算方式">
        <button
          type="button"
          role="tab"
          class="calc-mode-tab"
          :class="{ active: panelCalcMode === 'panel' }"
          :aria-selected="panelCalcMode === 'panel'"
          @click="selectPanelCalcMode('panel')"
        >
          面板计算
        </button>
        <button
          type="button"
          role="tab"
          class="calc-mode-tab"
          :class="{ active: panelCalcMode === 'affix' }"
          :aria-selected="panelCalcMode === 'affix'"
          @click="selectPanelCalcMode('affix')"
        >
          词条计算
        </button>
        <button
          type="button"
          role="tab"
          class="calc-mode-tab"
          :class="{ active: panelCalcMode === 'optimal' }"
          :aria-selected="panelCalcMode === 'optimal'"
          @click="selectPanelCalcMode('optimal')"
        >
          最优词条分配
        </button>
      </div>
    </section>

    <PanelCalcSection
      v-show="panelCalcMode !== 'optimal'"
      ref="panelCalcSectionRef"
      :calc-suspended="panelCalcMode === 'optimal'"
      :section-id="panelCalcMode !== 'optimal' ? 'damage-panel' : undefined"
      :team-slots="teamSlots"
      :agents="agents"
      :wengines="wengines"
      :bangboos="bangboos"
      :drive-discs="driveDiscs"
      :selected-bangboo-id="selectedBangbooId"
      :bangboo-refine="bangbooRefine"
      :edited-slot-index="activeSlot"
      :calc-mode="panelCalcMode === 'optimal' ? 'panel' : panelCalcMode"
      :damage-kind="damageKind"
      :anomaly-sub-kind="anomalySubKind"
      :trigger-anomaly-agent-id="triggerAnomalyAgentId"
      :anomaly-slot-panels="anomalySlotPanels"
      :convert-slot-panels="convertSlotPanels"
      :skill-category-id="skillCategoryId"
      :skill-subcategory-id="skillSubcategoryId"
      :slot-buff-selections="multiSlotBuffSelection"
      :stagger-phase="staggerPhase"
      :hits="hits"
      :preview-hits="previewHits"
      :environment-buffs="activeEnvironmentBuffs"
      v-model:enemy-input="enemyInput"
      v-model:extra-gains="extraGains"
      @update:anomaly-slot-panels="Object.assign(anomalySlotPanels, $event)"
      @update:convert-slot-panels="Object.assign(convertSlotPanels, $event)"
      @update:hit-damages="hitDamages = $event"
      @update:hit-calc-results="hitCalcResults = $event"
    >
      <!-- 锚点常驻，招式流程经 Teleport 插入，避免双实例销毁重建 -->
      <template #after-setup>
        <div id="skill-flow-anchor-panel" class="skill-flow-anchor" />
      </template>
    </PanelCalcSection>

    <KeepAlive>
      <OptimalAffixAllocSection
        v-if="panelCalcMode === 'optimal'"
        ref="optimalAffixSectionRef"
        id="damage-panel"
        class="damage-anchor"
        :active="panelCalcMode === 'optimal'"
        :team-slots="teamSlots"
        :agents="agents"
        :wengines="wengines"
        :bangboos="bangboos"
        :drive-discs="driveDiscs"
        :selected-bangboo-id="selectedBangbooId"
        :bangboo-refine="bangbooRefine"
        :edited-slot-index="activeSlot"
        :damage-kind="damageKind"
        :anomaly-sub-kind="anomalySubKind"
        :trigger-anomaly-agent-id="triggerAnomalyAgentId"
        :anomaly-slot-panels="anomalySlotPanels"
        :skill-category-id="skillCategoryId"
        :skill-subcategory-id="skillSubcategoryId"
        :buff-selection="mainSlotBuffSelection"
        :slot-buff-selections="multiSlotBuffSelection"
        :stagger-phase="staggerPhase"
        :hits="hits"
        :preview-hits="previewHits"
        :environment-buffs="activeEnvironmentBuffs"
        v-model:enemy-input="enemyInput"
        v-model:extra-gains="extraGains"
        :convert-slot-panels="convertSlotPanels"
        @update:hit-damages="hitDamages = $event"
        @update:hit-calc-results="hitCalcResults = $event"
      />
    </KeepAlive>

    <div
      id="skill-flow-anchor-optimal"
      v-show="panelCalcMode === 'optimal'"
      class="skill-flow-anchor"
    />

    <!-- 单实例 Teleport：面板时插在录入后，最优时插在模块后 -->
    <Teleport defer :to="skillFlowTeleportTo">
      <SkillFlowSection
        ref="skillFlowSectionRef"
        :team-slots="teamSlots"
        :agents="agents"
        :hits="hits"
        :hit-damages="hitDamages"
        :hit-calc-results="hitCalcResults"
        :scheme-name="currentSchemeName"
        v-model:slots="schemeSlots"
        v-model:edited-slot-index="activeSlot"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.damage-page {
  display: flex;
  flex-direction: column;
  gap: 1.35rem;
}

.team-slot-sticky {
  position: sticky;
  top: 0;
  z-index: 30;
  overflow: visible;
  display: flex;
  align-items: stretch;
  gap: 0.65rem;
  width: calc(100% + 2rem);
  margin: 0 -1rem 0;
  padding: 0.55rem 1rem 0.6rem;
  border: none;
  border-bottom: 1px solid rgba(201, 165, 92, 0.35);
  border-radius: 0;
  background: linear-gradient(180deg, #1c222c 0%, #151920 100%);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.04) inset,
    0 8px 20px rgba(0, 0, 0, 0.28);
}

.team-slot-sticky :deep(.team-slot-switcher) {
  flex: 1;
  min-width: 0;
}

.scheme-lib-actions {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
  gap: 0.28rem;
  padding-left: 0.55rem;
  border-left: 1px solid rgba(201, 165, 92, 0.22);
}

.scheme-lib-btn,
.scheme-clear-btn {
  appearance: none;
  border-radius: 8px;
  font: inherit;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: none;
  transition:
    background 0.12s ease,
    border-color 0.12s ease,
    color 0.12s ease;
  padding: 0.38rem 0.8rem;
  font-size: 0.78rem;
  border: 1px solid #343a44;
  background: #12161d;
  color: #d5dae4;
}

.scheme-lib-btn:hover,
.scheme-clear-btn:hover {
  border-color: #c9a55c;
  color: #f0d7a2;
  background: #161b24;
}

.skill-flow-anchor {
  /* Teleport 挂载点：保持块级容器，避免 display:contents 在部分浏览器下丢子树 */
  min-height: 0;
}

.damage-page :deep(.damage-anchor) {
  scroll-margin-top: 4.2rem;
}

.calc-mode-section {
  border: 1px solid #343a44;
  border-radius: 14px;
  background: linear-gradient(180deg, #1a1e26 0%, #12151a 100%);
  padding: 1.05rem 1.1rem 1.15rem;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.04) inset,
    0 10px 28px rgba(0, 0, 0, 0.22);
}

.calc-mode-section + .calc-mode-section,
.damage-page > .opt-section,
.damage-page > :deep(.panel-section),
.damage-page > :deep(.history-section),
.damage-page > :deep(.team-section),
.damage-page > :deep(.upload-section) {
  position: relative;
}

.calc-mode-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.65rem 1rem;
}

.calc-mode-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.calc-mode-desc {
  margin: 0.25rem 0 0.75rem;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.calc-mode-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.calc-mode-tab {
  border: 1px solid #2d323a;
  border-radius: 999px;
  background: #0f1217;
  color: #d5dae4;
  padding: 0.35rem 0.95rem;
  font-size: 0.84rem;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.calc-mode-tab.active {
  border-color: #c9a55c;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  font-weight: 600;
}

.skill-context-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  margin-top: 0;
  align-items: center;
}

.combat-buff-section {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.enemy-env-section :deep(.enemy-environment) {
  margin-top: 0;
  border: none;
  padding: 0;
  background: transparent;
}

.combat-buff-section .buff-breakdown {
  border: 1px solid #2d323a;
  border-radius: 10px;
  padding: 0.55rem 0.75rem;
  background: #0f1217;
}

.combat-buff-section .buff-breakdown summary {
  cursor: pointer;
  color: #d5dae4;
  font-size: 0.86rem;
}

.combat-buff-section .mods-summary {
  list-style: none;
  margin: 0.65rem 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  gap: 0.35rem 0.75rem;
}

.combat-buff-section .mods-summary li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: #9aa3b0;
}

.combat-buff-section .mods-summary strong {
  color: #e8edf5;
  font-weight: 600;
}

.buff-open-btn {
  align-self: center;
  border: 1px solid #c9a55c;
  border-radius: 8px;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  padding: 0.45rem 0.85rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.buff-set-hint {
  align-self: center;
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: #9aa3b0;
  flex: 1 1 12rem;
  min-width: 0;
}

@media (max-width: 768px) {
  .damage-page {
    gap: 0.75rem;
  }

  .damage-page :deep(.damage-anchor) {
    scroll-margin-top: 0.65rem;
  }

  .calc-mode-section {
    padding: 0.75rem;
  }

  .calc-mode-header h2 {
    font-size: 0.98rem;
  }

  .calc-mode-desc {
    font-size: 0.72rem;
    line-height: 1.4;
  }

  .calc-mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }

  .calc-mode-tab {
    width: 100%;
    min-height: 2.4rem;
    border-radius: 8px;
    text-align: center;
  }
}
</style>
