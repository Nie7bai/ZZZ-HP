<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import BangbooPickerSection from '@/components/calculator/BangbooPickerSection.vue'
import BuffEffectPickerModal from '@/components/calculator/BuffEffectPickerModal.vue'
import DamageCalcHistorySection from '@/components/calculator/DamageCalcHistorySection.vue'
import DriveDiscPickerSection from '@/components/calculator/DriveDiscPickerSection.vue'
import OptimalAffixAllocSection from '@/components/calculator/OptimalAffixAllocSection.vue'
import PanelCalcSection from '@/components/calculator/PanelCalcSection.vue'
import PanelScreenshotUploadSection from '@/components/calculator/PanelScreenshotUploadSection.vue'
import TeamBuilderSection from '@/components/calculator/TeamBuilderSection.vue'
import type { DamageCalcSectionId } from '@/constants/damageCalcNav'
import type { DamageCalcHistoryEntry } from '@/types/damageCalcHistory'
import type { PanelCalcMode } from '@/types/calculatorPanel'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import type { BangbooBuffDoc, DamageCalcKind, SkillCategoryId, StaggerPhase } from '@/types/calculator'
import { SKILL_CATEGORY_OPTIONS } from '@/types/calculator'
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
  type BuffSelectionState,
} from '@/utils/panelBuffCalc'
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
const historyEntries = ref<DamageCalcHistoryEntry[]>(listDamageCalcHistory())
const activeHistoryId = ref('')
const historyMessage = ref('')

const damageKind = ref<DamageCalcKind>('direct')
const skillCategoryId = ref<SkillCategoryId>('basic')
const skillSubcategoryId = ref<string | null>(null)
const staggerPhase = ref<StaggerPhase>('stagger')
const buffPickerOpen = ref(false)
const buffSelection = reactive<BuffSelectionState>({
  enabledIds: {},
  stacksByEffectId: {},
  convertInputs: {},
})

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

const collectedEffects = computed(() =>
  collectAllBuffEffects({
    teamSlots,
    agents: agents.value,
    wengines: wengines.value,
    bangboo: selectedBangboo.value,
    bangbooRefine: bangbooRefine.value,
    mainSlotIndex: mainSlotIndex.value,
    driveDiscs: driveDiscs.value,
    skillContext: {
      damageKind: damageKind.value,
      categoryId: skillCategoryId.value,
      subcategoryId: skillSubcategoryId.value,
      element: mainAgent.value?.element,
      staggerPhase: staggerPhase.value,
    },
  }),
)

const filteredSubcategories = computed(() =>
  skillSubcategories.value.filter((item) => {
    if (item.categoryId !== skillCategoryId.value) return false
    const agentId = mainAgent.value?.id
    if (!agentId) return true
    return !item.agentId || item.agentId === agentId
  }),
)

watch(teamBuffSignature, () => {
  buffSelection.enabledIds = {}
  buffSelection.stacksByEffectId = {}
  buffSelection.convertInputs = {}
})

watch(
  collectedEffects,
  (list) => {
    const defaults = buildDefaultBuffSelection(
      list,
      panelCalcSectionRef.value?.convertAttrDefaults ?? {},
    )
    const validIds = new Set(list.map((item) => item.effect.id))
    for (const id of Object.keys(buffSelection.enabledIds)) {
      if (!validIds.has(id)) delete buffSelection.enabledIds[id]
    }
    for (const id of Object.keys(buffSelection.stacksByEffectId)) {
      if (!validIds.has(id)) delete buffSelection.stacksByEffectId[id]
    }
    for (const id of Object.keys(buffSelection.convertInputs)) {
      if (!validIds.has(id)) delete buffSelection.convertInputs[id]
    }
    for (const [id, enabled] of Object.entries(defaults.enabledIds)) {
      if (!(id in buffSelection.enabledIds)) {
        buffSelection.enabledIds[id] = enabled
      }
    }
    for (const [id, stacks] of Object.entries(defaults.stacksByEffectId)) {
      if (!(id in buffSelection.stacksByEffectId)) {
        buffSelection.stacksByEffectId[id] = stacks
      }
    }
    for (const [id, value] of Object.entries(defaults.convertInputs)) {
      if (!(id in buffSelection.convertInputs)) {
        buffSelection.convertInputs[id] = value
      }
    }
  },
  { immediate: true },
)

watch(
  () => panelCalcSectionRef.value?.convertAttrDefaults,
  (attrs) => {
    if (!attrs) return
    for (const item of collectedEffects.value) {
      if (item.effect.kind !== 'convert' || !item.effect.convert) continue
      const id = item.effect.id
      if (id in buffSelection.convertInputs) continue
      const configured = item.effect.convert.defaultBase
      buffSelection.convertInputs[id] =
        configured != null && Number.isFinite(configured)
          ? configured
          : (attrs[item.effect.convert.from] ?? 0)
    }
  },
)

watch(skillCategoryId, () => {
  skillSubcategoryId.value = null
})

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
          直伤/异常只在此处选择一次；招式增益按大类·小类过滤（未选小类则整大类生效）。最优词条跟随该选择。
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
      <div v-if="damageKind === 'direct'" class="skill-context-row">
        <label>
          <span>招式大类</span>
          <select v-model="skillCategoryId">
            <option v-for="opt in SKILL_CATEGORY_OPTIONS" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label>
          <span>招式小类</span>
          <select v-model="skillSubcategoryId">
            <option :value="null">整大类</option>
            <option v-for="sub in filteredSubcategories" :key="sub.id" :value="sub.id">
              {{ sub.name }}
            </option>
          </select>
        </label>
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
          选择局内 Buff（已选
          {{
            Object.values(buffSelection.enabledIds).filter(Boolean).length
          }}
          ）
        </button>
      </div>
    </section>

    <BuffEffectPickerModal
      v-model:open="buffPickerOpen"
      v-model:selection="buffSelection"
      :effects="collectedEffects"
      :attr-defaults="panelCalcSectionRef?.convertAttrDefaults ?? {}"
    />

    <section id="damage-calc-mode" class="calc-mode-section damage-anchor">
      <header class="calc-mode-header">
        <h2>计算方式</h2>
        <p class="calc-mode-desc">
          面板计算直接录入局外面板；词条计算通过副词条条数推导局外面板；最优词条分配在约束下扫掠分配并绘制期望伤害曲线。
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
      :skill-category-id="skillCategoryId"
      :skill-subcategory-id="skillSubcategoryId"
      :buff-selection="buffSelection"
      :stagger-phase="staggerPhase"
    />

    <OptimalAffixAllocSection
      v-show="panelCalcMode === 'optimal'"
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
      :skill-category-id="skillCategoryId"
      :skill-subcategory-id="skillSubcategoryId"
      :buff-selection="buffSelection"
      :stagger-phase="staggerPhase"
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

.skill-context-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  margin-top: 0.85rem;
}

.skill-context-row label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.skill-context-row select {
  min-width: 10rem;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.4rem 0.55rem;
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
