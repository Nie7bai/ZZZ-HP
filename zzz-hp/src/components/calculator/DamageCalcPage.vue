<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import BangbooPickerSection from '@/components/calculator/BangbooPickerSection.vue'
import DamageCalcHistorySection from '@/components/calculator/DamageCalcHistorySection.vue'
import DriveDiscPickerSection from '@/components/calculator/DriveDiscPickerSection.vue'
import PanelCalcSection from '@/components/calculator/PanelCalcSection.vue'
import TeamBuilderSection from '@/components/calculator/TeamBuilderSection.vue'
import type { DamageCalcSectionId } from '@/constants/damageCalcNav'
import type { DamageCalcHistoryEntry } from '@/types/damageCalcHistory'
import type { PanelCalcMode } from '@/types/calculatorPanel'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import {
  createHistoryEntryId,
  listDamageCalcHistory,
  removeDamageCalcHistory,
  saveDamageCalcHistory,
} from '@/utils/damageCalcHistory'

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
const { agents, wengines, bangboos, driveDiscs } = storeToRefs(calculatorBuffStore)

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

const panelCalcSectionRef = ref<InstanceType<typeof PanelCalcSection> | null>(null)

const activeSlotData = computed(() => teamSlots[activeSlot.value]!)
const activeAgent = computed(() =>
  agents.value.find((item) => item.id === activeSlotData.value.agentId),
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
  activeSlotData.value.wengineId = wengineId
}

function selectBangboo(bangbooId: string) {
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

function saveHistoryEntry(name: string) {
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
  panelCalcMode.value = entry.panelCalcMode
  panelCalcSectionRef.value?.loadSnapshot(entry.panelState)
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
  const target = pageRootRef.value?.querySelector<HTMLElement>(`#${sectionId}`)
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

defineExpose({ scrollToSection })
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

    <section id="damage-calc-mode" class="calc-mode-section damage-anchor">
      <header class="calc-mode-header">
        <h2>计算方式</h2>
        <p class="calc-mode-desc">面板计算直接录入局外面板；词条计算通过副词条条数推导局外面板，便于对比词条收益。</p>
      </header>
      <div class="calc-mode-tabs" role="tablist" aria-label="面板计算方式">
        <button
          type="button"
          role="tab"
          class="calc-mode-tab"
          :class="{ active: panelCalcMode === 'panel' }"
          :aria-selected="panelCalcMode === 'panel'"
          @click="panelCalcMode = 'panel'"
        >
          面板计算
        </button>
        <button
          type="button"
          role="tab"
          class="calc-mode-tab"
          :class="{ active: panelCalcMode === 'affix' }"
          :aria-selected="panelCalcMode === 'affix'"
          @click="panelCalcMode = 'affix'"
        >
          词条计算
        </button>
      </div>
    </section>

    <PanelCalcSection
      ref="panelCalcSectionRef"
      :team-slots="teamSlots"
      :agents="agents"
      :wengines="wengines"
      :bangboos="bangboos"
      :drive-discs="driveDiscs"
      :selected-bangboo-id="selectedBangbooId"
      :bangboo-refine="bangbooRefine"
      :calc-mode="panelCalcMode"
      @apply-recognition="applyPanelRecognition"
    />
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
</style>
