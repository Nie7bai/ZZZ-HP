<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BangbooPickerSection from '@/components/calculator/BangbooPickerSection.vue'
import BuffEffectPickerModal from '@/components/calculator/BuffEffectPickerModal.vue'
import DamageCalcHistorySection from '@/components/calculator/DamageCalcHistorySection.vue'
import DamageEventModeModal from '@/components/calculator/DamageEventModeModal.vue'
import DriveDiscPickerSection from '@/components/calculator/DriveDiscPickerSection.vue'
import OptimalAffixAllocSection from '@/components/calculator/OptimalAffixAllocSection.vue'
import PanelCalcSection from '@/components/calculator/PanelCalcSection.vue'
import PanelScreenshotUploadSection from '@/components/calculator/PanelScreenshotUploadSection.vue'
import TeamBuilderSection from '@/components/calculator/TeamBuilderSection.vue'
import type { DamageCalcSectionId } from '@/constants/damageCalcNav'
import type { DamageCalcHistoryEntry } from '@/types/damageCalcHistory'
import type { PanelCalcMode } from '@/types/calculatorPanel'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import type {
  AnomalyDamageSubKind,
  BangbooBuffDoc,
  DamageCalcKind,
  DamageEvent,
  DamageEventMultOverrides,
  StaggerPhase,
} from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import { createDefaultExternalPanel } from '@/types/calculatorPanel'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  createHistoryEntryId,
  listDamageCalcHistory,
  removeDamageCalcHistory,
  saveDamageCalcHistory,
} from '@/utils/damageCalcHistory'
import {
  buildDefaultBuffSelection,
  collectAllBuffEffects,
  collectConvertSupportSlots,
  createEmptyMultiSlotBuffSelection,
  mergeDefaultBuffSelectionIntoMulti,
  resolveBuffSelectionForSlot,
  type MultiSlotBuffSelection,
  type ConvertSlotPanels,
} from '@/utils/panelBuffCalc'
import { resolveIsFollowUp } from '@/utils/buffEffect'
import { canSelectTurbulenceDamageEvent, eventNeedsAnomalyProducer } from '@/utils/damageEvent'
import { createEmptyBuffStatModifiers, createEmptyRefinementMods } from '@/utils/calculatorUi'

export interface TeamSlot {
  agentId: string
  rank: number
  wengineId: string
  wengineRefine: number
  isMainC: boolean
  twoPieceDriveDiscId: string
  fourPieceDriveDiscId: string
}

const calculatorBuffStore = useCalculatorBuffStore()
const { agents, wengines, bangboos, driveDiscs, skillSubcategories, followUpSkillRules, damageEventModes } =
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
const historyEntries = ref<DamageCalcHistoryEntry[]>(listDamageCalcHistory())
const activeHistoryId = ref('')
const historyMessage = ref('')

const damageKind = ref<DamageCalcKind>('direct')
const staggerPhase = ref<StaggerPhase>('stagger')
const anomalySlotPanels = reactive<Record<string, PanelStats>>({})
const convertSlotPanels = reactive<ConvertSlotPanels>({})
const directEventModeId = ref<string | null>(null)
const directEventModeName = ref('')
const directEventModalOpen = ref(false)
const directEvents = ref<DamageEvent[]>([])
const anomalyEventModeId = ref<string | null>(null)
const anomalyEventModeName = ref('')
const anomalyEventModalOpen = ref(false)
const anomalyEvents = ref<DamageEvent[]>([])

const anomalySubKind = computed<AnomalyDamageSubKind>(() => {
  const first = anomalyEvents.value[0]
  if (!first) return 'anomaly'
  if (first.kind === 'disorder') return 'disorder'
  if (first.kind === 'turbulence') return 'turbulence'
  if (first.kind === 'anomalyRelease') return 'anomalyRelease'
  return 'anomaly'
})
const triggerAnomalyAgentId = computed(() => {
  const withTrigger = anomalyEvents.value.find(
    (e) => e.triggerAgentId && e.triggerAgentId !== '__at_calc__',
  )
  return withTrigger?.triggerAgentId ?? null
})

const damageEvents = computed(() =>
  damageKind.value === 'direct' ? directEvents.value : anomalyEvents.value,
)
const skillCategoryId = computed(() => damageEvents.value[0]?.categoryId ?? 'basic')
const skillSubcategoryId = computed(() => damageEvents.value[0]?.skillSubcategoryId ?? null)

const buffPickerOpen = ref(false)
const buffPickerViewSlotIndex = ref(0)
const multiSlotBuffSelection = reactive<MultiSlotBuffSelection>(createEmptyMultiSlotBuffSelection())

const anomalyTriggerOptions = computed(() =>
  teamSlots
    .map((slot) => {
      const agent = agents.value.find((item) => item.id === slot.agentId)
      if (!agent) return null
      return {
        id: agent.id,
        label: `${agent.name}·${agent.element}`,
        element: agent.element,
      }
    })
    .filter((item): item is { id: string; label: string; element: string } => Boolean(item)),
)

function getAnomalySlotAgentIds(): string[] {
  const mainAgentId = teamSlots.find((slot) => slot.isMainC)?.agentId
  const ids = new Set<string>()
  for (const event of anomalyEvents.value) {
    if (!eventNeedsAnomalyProducer(event.kind)) continue
    const id = event.triggerAgentId
    if (!id || id === '__at_calc__' || id === mainAgentId) continue
    ids.add(id)
  }
  return [...ids]
}

function ensureAnomalySlotPanel(agentId: string) {
  if (anomalySlotPanels[agentId]) return
  const agent = agents.value.find((item) => item.id === agentId)
  const panel = createDefaultExternalPanel()
  if (agent?.basePanel) {
    panel.def = agent.basePanel.def
    panel.mastery = agent.basePanel.mastery
    panel.anomalyControl = agent.basePanel.anomalyControl
    panel.energyRegen = agent.basePanel.energyRegen
    panel.anomalyMult = agent.basePanel.anomalyMult
    panel.anomalyCritRate = agent.basePanel.anomalyCritRate
    panel.anomalyCritDmg = agent.basePanel.anomalyCritDmg
    panel.anomalyDmgBonus = agent.basePanel.anomalyDmgBonus
    panel.anomalyDuration = agent.basePanel.anomalyDuration
    panel.disorderBaseMult = agent.basePanel.disorderBaseMult
    panel.disorderCompMult = agent.basePanel.disorderCompMult
    panel.turbulenceBaseMult = agent.basePanel.turbulenceBaseMult
    panel.turbulenceCompMult = agent.basePanel.turbulenceCompMult
    panel.disorderDmgBonus = agent.basePanel.disorderDmgBonus
    panel.turbulenceDmgBonus = agent.basePanel.turbulenceDmgBonus
    panel.directDmgMult = agent.basePanel.directDmgMult
  }
  anomalySlotPanels[agentId] = panel
}

const triggerAgentOptionsForEditor = computed(() =>
  anomalyTriggerOptions.value.map((opt) => ({ id: opt.id, name: opt.label })),
)

function syncStaggerPhaseToEvents(phase: StaggerPhase) {
  for (const event of directEvents.value) {
    event.staggerPhase = phase
  }
  for (const event of anomalyEvents.value) {
    event.staggerPhase = phase
  }
}

watch(staggerPhase, (phase) => {
  syncStaggerPhaseToEvents(phase)
})

watch(
  () =>
    [
      ...directEvents.value.map((event) => event.id),
      ...anomalyEvents.value.map((event) => event.id),
    ].join(','),
  () => {
    syncStaggerPhaseToEvents(staggerPhase.value)
  },
)

watch(anomalyTriggerOptions, (opts) => {
  const validIds = new Set(opts.map((item) => item.id))
  for (const event of anomalyEvents.value) {
    // 计算页不保留「计算时选择」哨兵
    if (event.triggerAgentId === '__at_calc__') {
      event.triggerAgentId = null
      continue
    }
    if (event.triggerAgentId && !validIds.has(event.triggerAgentId)) {
      event.triggerAgentId = null
    }
  }
})

watch(
  () =>
    [
      ...getAnomalySlotAgentIds(),
      ...anomalyEvents.value.map(
        (event) => `${event.id}:${event.kind}:${event.triggerAgentId ?? ''}`,
      ),
    ].join(','),
  () => {
    for (const agentId of getAnomalySlotAgentIds()) {
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

watch(panelCalcMode, (mode) => emit('update:calcMode', mode), { immediate: true })

const panelCalcSectionRef = ref<InstanceType<typeof PanelCalcSection> | null>(null)

const activeSlotData = computed(() => teamSlots[activeSlot.value]!)
const activeAgent = computed(() =>
  agents.value.find((item) => item.id === activeSlotData.value.agentId),
)

const mainSlotIndex = computed(() => {
  const index = teamSlots.findIndex((slot) => slot.isMainC)
  return index >= 0 ? index : 0
})

const mainAgent = computed(() =>
  agents.value.find((item) => item.id === teamSlots[mainSlotIndex.value]?.agentId),
)

const turbulenceCalculable = computed(() =>
  canSelectTurbulenceDamageEvent(teamSlots, agents.value, mainAgent.value?.element),
)

const selectedBangboo = computed(
  () =>
    bangboos.value.find((item) => item.id === selectedBangbooId.value) ??
    bangboos.value.find((item) => item.id === 'none') ??
    emptyBangboo,
)

/** 队伍/音擎/驱动盘/邦布配置签名：变化时重置 Buff 勾选 */
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

const skillIsFollowUp = computed(() =>
  resolveIsFollowUp({
    agentId: mainAgent.value?.id,
    categoryId: skillCategoryId.value,
    subcategoryId: skillSubcategoryId.value,
    skillSubcategories: skillSubcategories.value,
    followUpSkillRules: followUpSkillRules.value,
  }),
)

/** 异放/乱流/紊乱有产生角色时，增益属性过滤跟随该角色属性 */
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
  return mainAgent.value?.element
})

const buffPickerSlotOptions = computed(() => {
  const options: { index: number; label: string }[] = []
  teamSlots.forEach((slot, index) => {
    if (!slot.agentId) return
    const agent = agents.value.find((item) => item.id === slot.agentId)
    if (!agent) return
    options.push({
      index,
      label: slot.isMainC ? `${agent.name}（主C）` : `${agent.name} · ${agent.element}`,
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
    skillContext: {
      damageKind: damageKind.value,
      categoryId: skillCategoryId.value,
      subcategoryId: skillSubcategoryId.value,
      element: agent?.element ?? damageElement.value,
      staggerPhase: staggerPhase.value,
      isFollowUp: resolveIsFollowUp({
        agentId: agent?.id,
        categoryId: skillCategoryId.value,
        subcategoryId: skillSubcategoryId.value,
        skillSubcategories: skillSubcategories.value,
        followUpSkillRules: followUpSkillRules.value,
      }),
      anomalySubKind: damageKind.value === 'anomaly' ? anomalySubKind.value : undefined,
    },
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

const convertSupportSlots = computed(() =>
  collectConvertSupportSlots(
    {
      teamSlots,
      agents: agents.value,
      wengines: wengines.value,
      bangboo: selectedBangboo.value,
      bangbooRefine: bangbooRefine.value,
      mainSlotIndex: mainSlotIndex.value,
      driveDiscs: driveDiscs.value,
      buffSelection: resolveBuffSelectionForSlot(multiSlotBuffSelection, mainSlotIndex.value),
      anomalySlotPanels,
      convertSlotPanels,
      skillContext: {
        damageKind: damageKind.value,
        categoryId: skillCategoryId.value,
        subcategoryId: skillSubcategoryId.value,
        element: damageElement.value,
        staggerPhase: staggerPhase.value,
        isFollowUp: skillIsFollowUp.value,
        anomalySubKind: damageKind.value === 'anomaly' ? anomalySubKind.value : undefined,
      },
    },
    { excludeAnomalyAgentIds: getAnomalySlotAgentIds() },
  ),
)

function ensureConvertSlotPanel(agentId: string, requiredAttrs: string[]) {
  if (!convertSlotPanels[agentId]) {
    convertSlotPanels[agentId] = {}
  }
  const agent = agents.value.find((item) => item.id === agentId)
  const partial = convertSlotPanels[agentId]!
  for (const attr of requiredAttrs) {
    if (partial[attr as keyof typeof partial] != null) continue
    if (attr === 'level') {
      partial.level = 60
      continue
    }
    if (attr === 'impact') {
      partial.impact = 0
      continue
    }
    const base = agent?.basePanel
    if (!base) continue
    if (attr === 'hp' || attr === 'atk' || attr === 'def') {
      partial[attr] = base[attr]
    } else if (attr in base) {
      partial[attr as 'mastery'] = (base as Record<string, number>)[attr] ?? 0
    }
  }
}

watch(
  convertSupportSlots,
  (slots) => {
    for (const slot of slots) {
      ensureConvertSlotPanel(slot.agentId, slot.requiredAttrs)
    }
  },
  { immediate: true, deep: true },
)

function resolveMultDefaultsForEvent(
  event: DamageEvent,
): Partial<Record<keyof DamageEventMultOverrides, number>> {
  return panelCalcSectionRef.value?.resolveMultDefaultsForEvent?.(event) ?? {}
}

function syncBuffDefaultsForSlot(slotIndex: number) {
  const effects = collectAllBuffEffects(buildBuffCollectContext(slotIndex))
  const attrDefaults =
    panelCalcSectionRef.value?.getAttrDefaultsForSlot?.(slotIndex) ??
    panelCalcSectionRef.value?.convertAttrDefaults ??
    {}
  const defaults = buildDefaultBuffSelection(effects, attrDefaults)
  mergeDefaultBuffSelectionIntoMulti(multiSlotBuffSelection, slotIndex, effects, defaults)
}

watch(teamBuffSignature, () => {
  Object.assign(multiSlotBuffSelection, createEmptyMultiSlotBuffSelection())
})

watch(
  buffPickerSlotOptions,
  (options) => {
    if (!options.length) return
    if (!options.some((opt) => opt.index === buffPickerViewSlotIndex.value)) {
      buffPickerViewSlotIndex.value = mainSlotIndex.value
    }
    for (const opt of options) {
      syncBuffDefaultsForSlot(opt.index)
    }
  },
  { immediate: true, deep: true },
)

watch(
  [collectedEffectsForPicker, buffPickerViewSlotIndex],
  () => {
    syncBuffDefaultsForSlot(buffPickerViewSlotIndex.value)
  },
  { immediate: true },
)

watch(
  () => panelCalcSectionRef.value?.convertAttrDefaults,
  () => {
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

function selectSlot(index: number) {
  activeSlot.value = index
}

function assignAgent(agentId: string) {
  activeSlotData.value.agentId = agentId
}

function clearSlot(index: number) {
  const slot = teamSlots[index]!
  slot.agentId = ''
  slot.rank = 0
  slot.wengineId = 'none'
  slot.wengineRefine = 1
  slot.twoPieceDriveDiscId = 'none'
  slot.fourPieceDriveDiscId = 'none'
  if (slot.isMainC) {
    const fallback = teamSlots.find((item, idx) => idx !== index && item.agentId)
    if (fallback) fallback.isMainC = true
    else slot.isMainC = true
  } else {
    slot.isMainC = false
  }
}

function toggleMainC(index: number) {
  teamSlots.forEach((slot, idx) => {
    slot.isMainC = idx === index
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

function applyPanelRecognition(result: PanelScreenshotRecognition) {
  const mainIndex = teamSlots.findIndex((slot) => slot.isMainC)
  const slot = teamSlots[mainIndex >= 0 ? mainIndex : 0]!
  if (result.agentId) {
    slot.agentId = result.agentId
    activeSlot.value = mainIndex >= 0 ? mainIndex : 0
  }
  slot.rank = result.rank
  if (result.wengineId) slot.wengineId = result.wengineId
  slot.wengineRefine = result.wengineRefine
  if (result.twoPieceDriveDiscId) slot.twoPieceDriveDiscId = result.twoPieceDriveDiscId
  if (result.fourPieceDriveDiscId) slot.fourPieceDriveDiscId = result.fourPieceDriveDiscId
  panelCalcSectionRef.value?.applyRecognitionToExternalPanel(result)
}

function cloneTeamSlots(): DamageCalcHistoryEntry['teamSlots'] {
  return teamSlots.map((slot) => ({ ...slot }))
}

function applyTeamSlots(slots: DamageCalcHistoryEntry['teamSlots']) {
  slots.forEach((slot, index) => {
    const target = teamSlots[index]
    if (!target) return
    Object.assign(target, slot)
  })
}

function cloneAnomalySlotPanels(): Record<string, PanelStats> {
  return JSON.parse(JSON.stringify(anomalySlotPanels)) as Record<string, PanelStats>
}

function cloneConvertSlotPanels(): ConvertSlotPanels {
  return JSON.parse(JSON.stringify(convertSlotPanels)) as ConvertSlotPanels
}

function applyAnomalySlotPanels(panels?: Record<string, PanelStats>) {
  for (const key of Object.keys(anomalySlotPanels)) {
    delete anomalySlotPanels[key]
  }
  if (!panels) return
  Object.assign(anomalySlotPanels, JSON.parse(JSON.stringify(panels)))
}

function applyConvertSlotPanels(panels?: ConvertSlotPanels) {
  for (const key of Object.keys(convertSlotPanels)) {
    delete convertSlotPanels[key]
  }
  if (!panels) return
  Object.assign(convertSlotPanels, JSON.parse(JSON.stringify(panels)))
}

function saveHistoryEntry(name: string) {
  if (panelCalcMode.value === 'optimal') {
    historyMessage.value = '最优词条分配模式暂不支持写入历史，请切换到面板/词条计算后再保存'
    return
  }
  const panelState = panelCalcSectionRef.value?.getSnapshot()
  if (!panelState) return

  const entry: DamageCalcHistoryEntry = {
    id: createHistoryEntryId(),
    name,
    savedAt: Date.now(),
    teamSlots: cloneTeamSlots(),
    activeSlot: activeSlot.value,
    selectedBangbooId: selectedBangbooId.value,
    bangbooRefine: bangbooRefine.value,
    panelCalcMode: panelCalcMode.value,
    panelState,
    anomalySlotPanels: cloneAnomalySlotPanels(),
    convertSlotPanels: cloneConvertSlotPanels(),
  }

  historyEntries.value = saveDamageCalcHistory(entry)
  activeHistoryId.value = entry.id
  historyMessage.value = `已保存「${name}」`
}

function loadHistoryEntry(entry: DamageCalcHistoryEntry) {
  applyTeamSlots(entry.teamSlots)
  activeSlot.value = entry.activeSlot
  selectedBangbooId.value = entry.selectedBangbooId
  bangbooRefine.value = entry.bangbooRefine
  panelCalcMode.value = entry.panelCalcMode === 'optimal' ? 'affix' : entry.panelCalcMode
  applyAnomalySlotPanels(entry.anomalySlotPanels)
  applyConvertSlotPanels(entry.convertSlotPanels)
  void nextTick(() => {
    panelCalcSectionRef.value?.loadSnapshot(entry.panelState)
  })
  activeHistoryId.value = entry.id
  historyMessage.value = `已加载「${entry.name}」`
}

function removeHistoryEntry(id: string) {
  historyEntries.value = removeDamageCalcHistory(id)
  if (activeHistoryId.value === id) {
    activeHistoryId.value = ''
    historyMessage.value = ''
  }
}

const pageRootRef = ref<HTMLElement | null>(null)

async function scrollToSection(sectionId: DamageCalcSectionId) {
  await nextTick()
  if (sectionId === 'damage-calc-panel') panelCalcMode.value = 'panel'
  if (sectionId === 'damage-calc-affix') panelCalcMode.value = 'affix'
  if (sectionId === 'damage-calc-optimal') panelCalcMode.value = 'optimal'
  // 计算方式及其子项：跳到伤害类型与招式上下文
  const anchorId =
    sectionId === 'damage-calc-mode' ||
    sectionId === 'damage-calc-panel' ||
    sectionId === 'damage-calc-affix' ||
    sectionId === 'damage-calc-optimal'
      ? 'damage-kind-context'
      : sectionId
  const target = pageRootRef.value?.querySelector<HTMLElement>(`#${anchorId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function setCalcMode(mode: PanelCalcMode) {
  panelCalcMode.value = mode
}

function selectPanelCalcMode(mode: PanelCalcMode) {
  panelCalcMode.value = mode
  void scrollToSection(
    mode === 'panel'
      ? 'damage-calc-panel'
      : mode === 'affix'
        ? 'damage-calc-affix'
        : 'damage-calc-optimal',
  )
}

defineExpose({ scrollToSection, setCalcMode, panelCalcMode })
</script>

<template>
  <div ref="pageRootRef" class="damage-page">
    <DamageCalcHistorySection
      :entries="historyEntries"
      :agents="agents"
      :active-entry-id="activeHistoryId"
      :message="historyMessage"
      @save="saveHistoryEntry"
      @load="loadHistoryEntry"
      @remove="removeHistoryEntry"
    />

    <PanelScreenshotUploadSection
      :agents="agents"
      :wengines="wengines"
      :drive-discs="driveDiscs"
      @apply-recognition="applyPanelRecognition"
    />

    <TeamBuilderSection
      :agents="agents"
      :wengines="wengines"
      :drive-discs="driveDiscs"
      :team-slots="teamSlots"
      :active-slot="activeSlot"
      :active-agent="activeAgent"
      @select-slot="selectSlot"
      @assign-agent="assignAgent"
      @clear-slot="clearSlot"
      @toggle-main-c="toggleMainC"
      @select-wengine="selectWengine"
    />

    <DriveDiscPickerSection
      :drive-discs="driveDiscs"
      :agents="agents"
      :team-slots="teamSlots"
      :active-slot="activeSlot"
      :active-agent="activeAgent"
    />

    <BangbooPickerSection
      :bangboos="bangboos"
      :selected-id="selectedBangbooId"
      :refine="bangbooRefine"
      @select="selectBangboo"
      @update:refine="bangbooRefine = $event"
    />

    <section id="damage-kind-context" class="calc-mode-section damage-anchor">
      <header class="calc-mode-header">
        <h2>伤害类型与招式上下文</h2>
        <p class="calc-mode-desc">
          直伤/异常在此切换；招式与「当前属性异常的产生角色」在伤害事件中按条配置。最优词条跟随事件总伤。
        </p>
      </header>
      <div class="calc-mode-tabs" role="tablist" aria-label="伤害类型">
        <button
          type="button"
          class="calc-mode-tab"
          :class="{ active: damageKind === 'direct' }"
          @click="damageKind = 'direct'"
        >
          直伤
        </button>
        <button
          type="button"
          class="calc-mode-tab"
          :class="{ active: damageKind === 'anomaly' }"
          @click="damageKind = 'anomaly'"
        >
          异常
        </button>
      </div>

      <div v-if="damageKind === 'direct'" class="skill-context-row event-mode-row">
        <div class="event-mode-block">
          <span class="event-mode-label">直伤事件模式</span>
          <DamageEventModeModal
            v-model:open="directEventModalOpen"
            v-model:events="directEvents"
            v-model:mode-id="directEventModeId"
            v-model:mode-name="directEventModeName"
            mode-type="direct"
            :agent-id="mainAgent?.id"
            :agent-name="mainAgent?.name"
            :preset-modes="damageEventModes"
            :skill-subcategories="skillSubcategories"
            :trigger-agent-options="triggerAgentOptionsForEditor"
            :resolve-mult-defaults="resolveMultDefaultsForEvent"
            :turbulence-calculable="turbulenceCalculable"
            :main-agent-element="mainAgent?.element"
          />
        </div>
      </div>
      <div v-else class="skill-context-row event-mode-row">
        <div class="event-mode-block">
          <span class="event-mode-label">异常事件模式</span>
          <DamageEventModeModal
            v-model:open="anomalyEventModalOpen"
            v-model:events="anomalyEvents"
            v-model:mode-id="anomalyEventModeId"
            v-model:mode-name="anomalyEventModeName"
            mode-type="anomaly"
            :agent-id="mainAgent?.id"
            :agent-name="mainAgent?.name"
            :preset-modes="damageEventModes"
            :skill-subcategories="skillSubcategories"
            :trigger-agent-options="triggerAgentOptionsForEditor"
            :resolve-mult-defaults="resolveMultDefaultsForEvent"
            :turbulence-calculable="turbulenceCalculable"
            :main-agent-element="mainAgent?.element"
          />
        </div>
      </div>

      <div class="skill-context-row">
        <label>
          <span>失衡状态</span>
          <select v-model="staggerPhase">
            <option value="stagger">失衡期</option>
            <option value="normal">非失衡期</option>
          </select>
        </label>
        <button type="button" class="buff-open-btn" @click="buffPickerOpen = true">
          选择局内 Buff（已选 {{ buffEnabledCount }} ）
        </button>
        <p class="buff-set-hint">2件套数值均已自动配置，无需选择2件套。</p>
      </div>
    </section>

    <BuffEffectPickerModal
      v-model:open="buffPickerOpen"
      v-model:multi-selection="multiSlotBuffSelection"
      v-model:view-slot-index="buffPickerViewSlotIndex"
      :effects="collectedEffectsForPicker"
      :slot-options="buffPickerSlotOptions"
      :attr-defaults="panelCalcSectionRef?.getAttrDefaultsForSlot?.(buffPickerViewSlotIndex) ?? panelCalcSectionRef?.convertAttrDefaults ?? {}"
      :panel-source-values="panelCalcSectionRef?.getPanelSourceValuesForSlot?.(buffPickerViewSlotIndex) ?? panelCalcSectionRef?.convertPanelSourceValues ?? undefined"
      :panel-source-values-by-slot="panelCalcSectionRef?.panelSourceValuesBySlot ?? undefined"
      :skill-subcategories="skillSubcategories"
    />

    <section id="damage-calc-mode" class="calc-mode-section damage-anchor">
      <header class="calc-mode-header">
        <h2>计算方式</h2>
        <p class="calc-mode-desc">
          面板计算直接录入局外面板；词条计算通过副词条条数推导局外面板；最优词条分配在约束下扫描分配并绘制期望伤害曲线。
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
      :calc-mode="panelCalcMode"
      :damage-kind="damageKind"
      :anomaly-sub-kind="anomalySubKind"
      :trigger-anomaly-agent-id="triggerAnomalyAgentId"
      :anomaly-slot-panels="anomalySlotPanels"
      :convert-slot-panels="convertSlotPanels"
      :skill-category-id="skillCategoryId"
      :skill-subcategory-id="skillSubcategoryId"
      :slot-buff-selections="multiSlotBuffSelection"
      :stagger-phase="staggerPhase"
      :damage-events="damageEvents"
      @update:anomaly-slot-panels="Object.assign(anomalySlotPanels, $event)"
      @update:convert-slot-panels="Object.assign(convertSlotPanels, $event)"
    />

    <KeepAlive>
      <OptimalAffixAllocSection
        v-if="panelCalcMode === 'optimal'"
        :id="panelCalcMode === 'optimal' ? 'damage-panel' : undefined"
        class="damage-anchor"
        :team-slots="teamSlots"
        :agents="agents"
        :wengines="wengines"
        :bangboos="bangboos"
        :drive-discs="driveDiscs"
        :selected-bangboo-id="selectedBangbooId"
        :bangboo-refine="bangbooRefine"
        :damage-kind="damageKind"
        :anomaly-sub-kind="anomalySubKind"
        :trigger-anomaly-agent-id="triggerAnomalyAgentId"
        :anomaly-slot-panels="anomalySlotPanels"
        :skill-category-id="skillCategoryId"
        :skill-subcategory-id="skillSubcategoryId"
        :buff-selection="mainSlotBuffSelection"
        :slot-buff-selections="multiSlotBuffSelection"
        :stagger-phase="staggerPhase"
        :damage-events="damageEvents"
      />
    </KeepAlive>
  </div>
</template>

<style scoped>
.damage-page {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.damage-page :deep(.damage-anchor) {
  scroll-margin-top: 1rem;
}

.calc-mode-section {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
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
  margin-top: 0.85rem;
}

.skill-context-row > label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 9rem;
}

.skill-context-row > label > span {
  font-size: 0.8rem;
  color: #9aa3b0;
}

.skill-context-row > label > select {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #e8edf5;
  padding: 0.4rem 0.55rem;
  font-size: 0.84rem;
}

.event-mode-row {
  width: 100%;
}

.event-mode-block {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
}

.event-mode-label {
  font-size: 0.8rem;
  color: #9aa3b0;
}

.buff-open-btn {
  align-self: end;
  border: 1px solid #c9a55c;
  border-radius: 8px;
  background: rgba(201, 165, 92, 0.14);
  color: #f0d7a2;
  padding: 0.45rem 0.85rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.buff-set-hint {
  align-self: end;
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
