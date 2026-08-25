<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AdminSidebar from '@/components/admin/AdminSidebar.vue'
import AdminVisualMonsterPanel from '@/components/admin/AdminVisualMonsterPanel.vue'
import AdminMonsterPanel from '@/components/admin/AdminMonsterPanel.vue'
import AdminBuffPanel from '@/components/admin/AdminBuffPanel.vue'
import AdminSeasonDatePanel from '@/components/admin/AdminSeasonDatePanel.vue'
import AdminSeasonImportExportPanel from '@/components/admin/AdminSeasonImportExportPanel.vue'
import AdminDeductionVisualPanel from '@/components/admin/AdminDeductionVisualPanel.vue'
import type { AdminPanel, AdminScope } from '@/types/admin'

const props = defineProps<{
  title: string
  scope: AdminScope
  backTo: string
  backLabel?: string
}>()

const activePanel = ref<AdminPanel>('monster')
const visualPanelRef = ref<{ reload?: () => Promise<void> } | null>(null)

/** 推演走专属节点管理面板（不落危局/防卫战的 boss/buff 表单） */
const isDeduction = computed(() => props.scope === 'deduction')

watch(
  isDeduction,
  (deduction) => {
    if (
      deduction &&
      (activePanel.value === 'monster-form' || activePanel.value === 'buff-form')
    ) {
      activePanel.value = 'monster'
    }
  },
  { immediate: true },
)

async function onSeasonDatesChanged() {
  await visualPanelRef.value?.reload?.()
}
</script>

<template>
  <div class="admin-layout">
    <AdminSidebar
      v-model:active-panel="activePanel"
      :title="title"
      :back-to="backTo"
      :back-label="backLabel"
      :scope="scope"
    />
    <main
      class="admin-content"
      :class="{
        'admin-content--fill': activePanel === 'season-date' || activePanel === 'monster',
      }"
    >
      <AdminDeductionVisualPanel
        v-if="isDeduction && activePanel === 'monster'"
        key="deduction-monster"
      />
      <AdminVisualMonsterPanel
        v-else-if="activePanel === 'monster'"
        ref="visualPanelRef"
        :scope="scope"
      />
      <AdminMonsterPanel v-else-if="activePanel === 'monster-form'" :scope="scope" />
      <AdminBuffPanel v-else-if="activePanel === 'buff-form'" :scope="scope" />
      <AdminSeasonDatePanel
        v-else-if="activePanel === 'season-date'"
        :scope="scope"
        @changed="onSeasonDatesChanged"
      />
      <AdminSeasonImportExportPanel
        v-else-if="activePanel === 'import-export'"
        :scope="scope"
        @imported="onSeasonDatesChanged"
      />
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

.admin-content--fill {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.admin-content--fill > * {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
