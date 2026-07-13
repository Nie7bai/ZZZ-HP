<script setup lang="ts">
import { ref } from 'vue'
import AdminSidebar from '@/components/admin/AdminSidebar.vue'
import AdminMonsterPanel from '@/components/admin/AdminMonsterPanel.vue'
import AdminDeleteMonsterPanel from '@/components/admin/AdminDeleteMonsterPanel.vue'
import AdminBuffPanel from '@/components/admin/AdminBuffPanel.vue'
import AdminDeleteBuffPanel from '@/components/admin/AdminDeleteBuffPanel.vue'
import type { AdminPanel, AdminScope } from '@/types/admin'

defineProps<{
  title: string
  scope: AdminScope
  backTo: string
  backLabel?: string
}>()

const activePanel = ref<AdminPanel>('monster')
</script>

<template>
  <div class="admin-layout">
    <AdminSidebar
      v-model:active-panel="activePanel"
      :title="title"
      :back-to="backTo"
      :back-label="backLabel"
    />
    <main class="admin-content">
      <AdminMonsterPanel v-if="activePanel === 'monster'" :scope="scope" />
      <AdminDeleteMonsterPanel v-else-if="activePanel === 'delete-monster'" :scope="scope" />
      <AdminBuffPanel v-else-if="activePanel === 'buff'" :scope="scope" />
      <AdminDeleteBuffPanel v-else :scope="scope" />
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
</style>
