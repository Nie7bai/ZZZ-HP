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
  | 'score-hp-table'

const props = defineProps<{
  title: string
  backTo?: string
  backLabel?: string
  mode?: ModeKey
}>()

const activePanel = defineModel<SidebarPanel>('activePanel', { default: 'history' })
const mobileOpen = defineModel<boolean>('mobileOpen', { default: false })

const allPanels: { id: SidebarPanel; label: string; crisisOnly?: boolean }[] = [
  { id: 'history', label: '往期详细' },
  { id: 'hp-chart', label: '血量折线图' },
  { id: 'phase-compare', label: '期数对比折线图' },
  { id: 'monster-compare', label: '单独怪物对比' },
  { id: 'buff-overview', label: 'Buff 总览' },
  { id: 'buff-compare', label: 'Buff 对比' },
  { id: 'score-hp-table', label: '分数与血量对应表', crisisOnly: true },
]

const panels = computed(() =>
  allPanels.filter((panel) => !panel.crisisOnly || props.mode === 'crisis-assault'),
)

function selectPanel(id: SidebarPanel) {
  activePanel.value = id
  mobileOpen.value = false
}

function closeMobileNav() {
  mobileOpen.value = false
}
</script>

<template>
  <div class="sidebar-root">
    <button
      v-show="mobileOpen"
      type="button"
      class="sidebar-backdrop"
      aria-label="关闭菜单"
      @click="closeMobileNav"
    />
    <aside class="sidebar" :class="{ 'sidebar--open': mobileOpen }">
      <RouterLink :to="backTo ?? '/'" class="back" @click="closeMobileNav">
        {{ backLabel ?? '← 返回首页' }}
      </RouterLink>

      <h2 class="sidebar-title">{{ title }}</h2>

      <nav class="sidebar-nav">
        <button
          v-for="panel in panels"
          :key="panel.id"
          type="button"
          class="nav-btn"
          :class="{ active: activePanel === panel.id }"
          @click="selectPanel(panel.id)"
        >
          {{ panel.label }}
        </button>
      </nav>
    </aside>
  </div>
</template>

<style scoped>
.sidebar-root {
  flex-shrink: 0;
}

.sidebar-backdrop {
  display: none;
}

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
  text-decoration: none;
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

/* 仅手机：侧栏改为抽屉，桌面样式不变 */
@media (max-width: 768px) {
  .sidebar-root {
    width: 0;
    height: 0;
    overflow: visible;
  }

  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 1190;
    border: none;
    padding: 0;
    margin: 0;
    background: rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1200;
    width: min(280px, 86vw);
    height: 100dvh;
    border-right: 1px solid var(--color-border);
    box-shadow: 8px 0 28px rgba(0, 0, 0, 0.28);
    transform: translateX(-105%);
    transition: transform 0.22s ease;
    padding-top: max(1.25rem, env(safe-area-inset-top));
    padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .nav-btn {
    min-height: 2.75rem;
    font-size: 0.9rem;
  }
}
</style>
