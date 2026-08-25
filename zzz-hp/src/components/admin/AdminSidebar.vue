<script setup lang="ts">
import { computed } from 'vue'
import type { AdminPanel, AdminScope } from '@/types/admin'

const props = defineProps<{
  title: string
  backTo: string
  backLabel?: string
  scope?: AdminScope
}>()

const activePanel = defineModel<AdminPanel>('activePanel', { default: 'monster' })

const allPanels: {
  id: AdminPanel
  label: string
  deductionLabel?: string
  deductionExclude?: boolean
}[] = [
  { id: 'monster', label: '内容管理', deductionLabel: '节点编辑（怪物 / Buff）' },
  { id: 'monster-form', label: '表单添加怪物', deductionExclude: true },
  { id: 'buff-form', label: '表单添加 Buff', deductionExclude: true },
  { id: 'season-date', label: '版本日期管理', deductionExclude: true },
  { id: 'import-export', label: '导入 / 导出' },
]

function panelLabel(panel: { label: string; deductionLabel?: string }) {
  if (props.scope === 'deduction' && panel.deductionLabel) return panel.deductionLabel
  return panel.label
}

const panels = computed(() =>
  allPanels.filter(
    (panel) => !panel.deductionExclude || props.scope !== 'deduction',
  ),
)
</script>

<template>
  <aside class="sidebar">
    <RouterLink :to="backTo" class="back">{{ backLabel ?? '← 返回' }}</RouterLink>

    <h2 class="sidebar-title">{{ title }}</h2>

    <nav class="sidebar-nav">
      <button
        v-for="panel in panels"
        :key="panel.id"
        type="button"
        class="nav-btn"
        :class="{ active: activePanel === panel.id }"
        @click="activePanel = panel.id"
      >
        {{ panelLabel(panel) }}
      </button>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  height: 100vh;
  flex-shrink: 0;
  padding: 1.5rem 1rem;
  border-right: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  overflow-y: auto;
}

.back {
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
  text-decoration: none;
  transition: opacity 0.2s;
}

.back:hover {
  opacity: 1;
}

.sidebar-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-heading);
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nav-btn {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
  transition:
    background-color 0.2s,
    border-color 0.2s,
    color 0.2s;
}

.nav-btn:hover {
  border-color: var(--color-border-hover);
  background: var(--color-background-mute);
}

.nav-btn.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
  font-weight: 600;
}
</style>
