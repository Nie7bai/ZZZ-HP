<script setup lang="ts">
import { computed } from 'vue'
import type { ModeKey } from '@/types/history'

export type SidebarPanel =
  | 'history'
  | 'hp-chart'
  | 'phase-compare'
  | 'monster-compare'
  | 'buff-overview'
  | 'buff-compare'

const props = defineProps<{
  title: string
  backTo?: string
  backLabel?: string
  mode?: ModeKey
}>()

const activePanel = defineModel<SidebarPanel>('activePanel', { default: 'history' })

const allPanels: { id: SidebarPanel; label: string }[] = [
  { id: 'history', label: '往期详细' },
  { id: 'hp-chart', label: '总血量折线图' },
  { id: 'phase-compare', label: '期数对比折线图' },
  { id: 'monster-compare', label: '单独怪物对比' },
  { id: 'buff-overview', label: 'Buff 总览' },
  { id: 'buff-compare', label: 'Buff 对比' },
]

const panels = computed(() => allPanels)
</script>

<template>
  <aside class="sidebar">
    <RouterLink :to="backTo ?? '/'" class="back">{{ backLabel ?? '← 返回首页' }}</RouterLink>

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
        {{ panel.label }}
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
  color: var(--color-heading);
  font-weight: 600;
}
</style>
