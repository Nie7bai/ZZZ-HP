<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AdminCalculatorSidebar from '@/components/admin/calculator/AdminCalculatorSidebar.vue'
import AdminAgentBuffPanel from '@/components/admin/calculator/AdminAgentBuffPanel.vue'
import AdminWengineBuffPanel from '@/components/admin/calculator/AdminWengineBuffPanel.vue'
import AdminBangbooBuffPanel from '@/components/admin/calculator/AdminBangbooBuffPanel.vue'
import AdminDriveDiscBuffPanel from '@/components/admin/calculator/AdminDriveDiscBuffPanel.vue'
import AdminSkillSubcategoryPanel from '@/components/admin/calculator/AdminSkillSubcategoryPanel.vue'
import type { AgentBuffEditActionId, AgentBuffEditSectionId } from '@/constants/agentBuffEditNav'
import type { BangbooBuffEditActionId, BangbooBuffEditSectionId } from '@/constants/bangbooBuffEditNav'
import type { DriveDiscBuffEditActionId, DriveDiscBuffEditSectionId } from '@/constants/driveDiscBuffEditNav'
import type { WengineBuffEditActionId, WengineBuffEditSectionId } from '@/constants/wengineBuffEditNav'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type { AdminCalculatorPanel } from '@/types/calculator'

const activePanel = ref<AdminCalculatorPanel>('agent')
const agentPanelRef = ref<InstanceType<typeof AdminAgentBuffPanel> | null>(null)
const wenginePanelRef = ref<InstanceType<typeof AdminWengineBuffPanel> | null>(null)
const bangbooPanelRef = ref<InstanceType<typeof AdminBangbooBuffPanel> | null>(null)
const driveDiscPanelRef = ref<InstanceType<typeof AdminDriveDiscBuffPanel> | null>(null)

const calculatorBuffStore = useCalculatorBuffStore()
const { loading, loaded, error } = storeToRefs(calculatorBuffStore)

const agentSaving = computed(() => agentPanelRef.value?.saving ?? false)
const agentCanDelete = computed(() => Boolean(agentPanelRef.value?.selectedId))
const wengineSaving = computed(() => wenginePanelRef.value?.saving ?? false)
const wengineCanDelete = computed(() => Boolean(wenginePanelRef.value?.selectedId))
const bangbooSaving = computed(() => bangbooPanelRef.value?.saving ?? false)
const bangbooCanDelete = computed(() => Boolean(bangbooPanelRef.value?.selectedId))
const driveDiscSaving = computed(() => driveDiscPanelRef.value?.saving ?? false)
const driveDiscCanDelete = computed(() => Boolean(driveDiscPanelRef.value?.selectedId))

onMounted(() => {
  void calculatorBuffStore.ensureLoaded().catch(() => {
    // error 已写入 store
  })
})

watch(
  () => calculatorBuffStore.loaded,
  (isLoaded) => {
    if (!isLoaded && !calculatorBuffStore.loading) {
      void calculatorBuffStore.loadAll(true)
    }
  },
)

async function scrollToAgentSection(sectionId: AgentBuffEditSectionId) {
  const wasAgent = activePanel.value === 'agent'
  activePanel.value = 'agent'
  await nextTick()
  if (!wasAgent) await nextTick()
  await agentPanelRef.value?.scrollToSection(sectionId)
}

async function handleAgentAction(actionId: AgentBuffEditActionId) {
  activePanel.value = 'agent'
  await nextTick()
  if (actionId === 'save') {
    await agentPanelRef.value?.saveAgent()
    return
  }
  await agentPanelRef.value?.removeAgent()
}

async function scrollToWengineSection(sectionId: WengineBuffEditSectionId) {
  const wasWengine = activePanel.value === 'wengine'
  activePanel.value = 'wengine'
  await nextTick()
  if (!wasWengine) await nextTick()
  await wenginePanelRef.value?.scrollToSection(sectionId)
}

async function handleWengineAction(actionId: WengineBuffEditActionId) {
  activePanel.value = 'wengine'
  await nextTick()
  if (actionId === 'save') {
    await wenginePanelRef.value?.saveItem()
    return
  }
  await wenginePanelRef.value?.removeItem()
}

async function scrollToBangbooSection(sectionId: BangbooBuffEditSectionId) {
  const wasBangboo = activePanel.value === 'bangboo'
  activePanel.value = 'bangboo'
  await nextTick()
  if (!wasBangboo) await nextTick()
  await bangbooPanelRef.value?.scrollToSection(sectionId)
}

async function handleBangbooAction(actionId: BangbooBuffEditActionId) {
  activePanel.value = 'bangboo'
  await nextTick()
  if (actionId === 'save') {
    await bangbooPanelRef.value?.saveItem()
    return
  }
  await bangbooPanelRef.value?.removeItem()
}

async function scrollToDriveDiscSection(sectionId: DriveDiscBuffEditSectionId) {
  const wasDriveDisc = activePanel.value === 'drive-disc'
  activePanel.value = 'drive-disc'
  await nextTick()
  if (!wasDriveDisc) await nextTick()
  await driveDiscPanelRef.value?.scrollToSection(sectionId)
}

async function handleDriveDiscAction(actionId: DriveDiscBuffEditActionId) {
  activePanel.value = 'drive-disc'
  await nextTick()
  if (actionId === 'save') {
    await driveDiscPanelRef.value?.saveItem()
    return
  }
  await driveDiscPanelRef.value?.removeItem()
}
</script>

<template>
  <div class="admin-layout">
    <AdminCalculatorSidebar
      v-model:active-panel="activePanel"
      title="角色计算器"
      back-to="/admin"
      back-label="← 返回管理员入口"
      :agent-saving="agentSaving"
      :agent-can-delete="agentCanDelete"
      :wengine-saving="wengineSaving"
      :wengine-can-delete="wengineCanDelete"
      :bangboo-saving="bangbooSaving"
      :bangboo-can-delete="bangbooCanDelete"
      :drive-disc-saving="driveDiscSaving"
      :drive-disc-can-delete="driveDiscCanDelete"
      @scroll-agent-section="scrollToAgentSection"
      @agent-action="handleAgentAction"
      @scroll-wengine-section="scrollToWengineSection"
      @wengine-action="handleWengineAction"
      @scroll-bangboo-section="scrollToBangbooSection"
      @bangboo-action="handleBangbooAction"
      @scroll-drive-disc-section="scrollToDriveDiscSection"
      @drive-disc-action="handleDriveDiscAction"
    />

    <main class="admin-content">
      <p v-if="loading && !loaded" class="load-hint">正在从数据库加载...</p>
      <p v-else-if="error && !loaded" class="load-error">{{ error }}</p>
      <template v-else>
        <p v-if="error" class="load-error">{{ error }}（显示缓存数据）</p>
        <AdminAgentBuffPanel v-show="activePanel === 'agent'" ref="agentPanelRef" />
        <AdminWengineBuffPanel v-show="activePanel === 'wengine'" ref="wenginePanelRef" />
        <AdminBangbooBuffPanel v-show="activePanel === 'bangboo'" ref="bangbooPanelRef" />
        <AdminDriveDiscBuffPanel v-show="activePanel === 'drive-disc'" ref="driveDiscPanelRef" />
        <AdminSkillSubcategoryPanel v-show="activePanel === 'skill-subcategory'" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.admin-layout {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
}

.admin-content {
  flex: 1;
  min-height: 0;
  padding: 1.5rem 1rem;
  overflow-y: auto;
}

.load-hint,
.load-error {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  font-size: 0.9rem;
}

.load-hint {
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-heading);
}

.load-error {
  border: 1px solid #5a2f2f;
  background: #241515;
  color: #ffb4b4;
}
</style>
