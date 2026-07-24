<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import ModeSidebar, { type SidebarPanel } from '@/components/ModeSidebar.vue'
import HistoryDetailPanel from '@/components/history/HistoryDetailPanel.vue'
import HpLineChartPanel from '@/components/history/HpLineChartPanel.vue'
import PhaseComparePanel from '@/components/history/PhaseComparePanel.vue'
import MonsterComparePanel from '@/components/history/MonsterComparePanel.vue'
import BuffOverviewPanel from '@/components/history/BuffOverviewPanel.vue'
import BuffComparePanel from '@/components/history/BuffComparePanel.vue'
import CrisisScoreHpTablePanel from '@/components/history/CrisisScoreHpTablePanel.vue'
import DefenseDetailPanel from '@/components/defense/DefenseDetailPanel.vue'
import DefenseHpLineChartPanel from '@/components/defense/DefenseHpLineChartPanel.vue'
import type { ModeKey } from '@/types/history'

const props = defineProps<{
  title: string
  mode: ModeKey
  backTo?: string
  backLabel?: string
}>()

const activePanel = ref<SidebarPanel>('history')
const mobileNavOpen = ref(false)

const panelLabels: Record<SidebarPanel, string> = {
  history: '往期详细',
  'hp-chart': '血量折线图',
  'phase-compare': '期数对比折线图',
  'monster-compare': '单独怪物对比',
  'buff-overview': 'Buff 总览',
  'buff-compare': 'Buff 对比',
  'score-hp-table': '分数与血量对应表',
}

const mobileSubtitle = computed(() => panelLabels[activePanel.value])

watch(activePanel, () => {
  mobileNavOpen.value = false
})

watch(mobileNavOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.style.overflow = open ? 'hidden' : ''
})

onUnmounted(() => {
  document.body.style.overflow = ''
})
</script>

<template>
  <div class="mode-layout" :class="{ 'mode-layout--nav-open': mobileNavOpen }">
    <header class="mobile-topbar">
      <button
        type="button"
        class="mobile-menu-btn"
        aria-label="打开菜单"
        @click="mobileNavOpen = true"
      >
        菜单
      </button>
      <div class="mobile-topbar-text">
        <strong>{{ props.title }}</strong>
        <span>{{ mobileSubtitle }}</span>
      </div>
    </header>

    <ModeSidebar
      v-model:active-panel="activePanel"
      v-model:mobile-open="mobileNavOpen"
      :title="title"
      :mode="mode"
      :back-to="backTo"
      :back-label="backLabel"
    />
    <main
      class="mode-content"
      :class="{
        'mode-content--page-scroll':
          (activePanel === 'history' && (mode === 'defense' || mode === 'crisis-assault')) ||
          (activePanel === 'phase-compare' && mode === 'defense') ||
          activePanel === 'buff-compare' ||
          activePanel === 'buff-overview' ||
          activePanel === 'score-hp-table',
      }"
    >
      <div id="mode-content-portal" class="mode-content-portal" />
      <KeepAlive>
        <DefenseDetailPanel
          v-if="activePanel === 'history' && mode === 'defense'"
          key="defense-history"
          class="panel-fill panel-fill--page"
        />
        <HistoryDetailPanel
          v-else-if="activePanel === 'history'"
          key="history"
          class="panel-fill panel-fill--page"
          :mode="mode"
        />
        <DefenseHpLineChartPanel
          v-else-if="activePanel === 'hp-chart' && mode === 'defense'"
          key="defense-hp-chart"
          class="panel-fill"
        />
        <HpLineChartPanel
          v-else-if="activePanel === 'hp-chart' && mode === 'crisis-assault'"
          key="hp-chart"
          class="panel-fill"
          :mode="mode"
        />
        <PhaseComparePanel
          v-else-if="activePanel === 'phase-compare' && (mode === 'crisis-assault' || mode === 'defense')"
          key="phase-compare"
          class="panel-fill"
          :class="{ 'panel-fill--page': mode === 'defense' }"
          :mode="mode"
        />
        <MonsterComparePanel
          v-else-if="activePanel === 'monster-compare' && (mode === 'crisis-assault' || mode === 'defense')"
          key="monster-compare"
          class="panel-fill"
          :mode="mode"
        />
        <BuffOverviewPanel
          v-else-if="activePanel === 'buff-overview' && (mode === 'crisis-assault' || mode === 'defense')"
          key="buff-overview"
          class="panel-fill panel-fill--page"
          :mode="mode"
        />
        <BuffComparePanel
          v-else-if="activePanel === 'buff-compare' && (mode === 'crisis-assault' || mode === 'defense')"
          key="buff-compare"
          class="panel-fill panel-fill--page"
          :mode="mode"
        />
        <CrisisScoreHpTablePanel
          v-else-if="activePanel === 'score-hp-table' && mode === 'crisis-assault'"
          key="score-hp-table"
          class="panel-fill panel-fill--page"
        />
        <p v-else key="placeholder" class="placeholder">
          {{ panelLabels[activePanel] }} — 内容开发中...
        </p>
      </KeepAlive>
    </main>
  </div>
</template>

<style scoped>
.mode-layout {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
}

.mobile-topbar {
  display: none;
}

.mode-content {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 0.75rem 1rem 1rem;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.mode-content-portal:not(:empty) {
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: none;
}

.mode-content-portal:not(:empty) > * {
  pointer-events: auto;
}

.placeholder {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text);
  opacity: 0.6;
  font-size: 1.1rem;
}

.panel-fill {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.mode-content--page-scroll {
  overflow-x: hidden;
  overflow-y: auto;
}

.panel-fill--page {
  flex: none;
  min-height: auto;
  overflow: visible;
}

@media (max-width: 768px) {
  .mode-layout {
    flex-direction: column;
    height: 100dvh;
  }

  .mobile-topbar {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-shrink: 0;
    padding: 0.55rem 0.75rem;
    padding-top: max(0.55rem, env(safe-area-inset-top));
    border-bottom: 1px solid var(--color-border);
    background: var(--color-background-soft);
  }

  .mobile-menu-btn {
    flex-shrink: 0;
    min-height: 2.4rem;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-background);
    color: var(--color-heading);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mobile-topbar-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .mobile-topbar-text strong {
    font-size: 0.92rem;
    color: var(--color-heading);
    line-height: 1.2;
  }

  .mobile-topbar-text span {
    font-size: 0.75rem;
    color: var(--color-text);
    opacity: 0.7;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mode-content {
    padding: 0.55rem 0.6rem 0.85rem;
  }
}
</style>
