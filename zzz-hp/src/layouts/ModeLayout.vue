<script setup lang="ts">
import { ref } from 'vue'
import ModeSidebar, { type SidebarPanel } from '@/components/ModeSidebar.vue'
import HistoryDetailPanel from '@/components/history/HistoryDetailPanel.vue'
import HpLineChartPanel from '@/components/history/HpLineChartPanel.vue'
import PhaseComparePanel from '@/components/history/PhaseComparePanel.vue'
import MonsterComparePanel from '@/components/history/MonsterComparePanel.vue'
import BuffOverviewPanel from '@/components/history/BuffOverviewPanel.vue'
import BuffComparePanel from '@/components/history/BuffComparePanel.vue'
import DefenseDetailPanel from '@/components/defense/DefenseDetailPanel.vue'
import DefenseHpLineChartPanel from '@/components/defense/DefenseHpLineChartPanel.vue'
import type { ModeKey } from '@/types/history'

defineProps<{
  title: string
  mode: ModeKey
  backTo?: string
  backLabel?: string
}>()

const activePanel = ref<SidebarPanel>('history')

const panelLabels: Record<SidebarPanel, string> = {
  history: '往期详细',
  'hp-chart': '总血量折线图',
  'phase-compare': '期数对比折线图',
  'monster-compare': '单独怪物对比',
  'buff-overview': 'Buff 总览',
  'buff-compare': 'Buff 对比',
}
</script>

<template>
  <div class="mode-layout">
    <ModeSidebar
      v-model:active-panel="activePanel"
      :title="title"
      :mode="mode"
      :back-to="backTo"
      :back-label="backLabel"
    />
    <main
      class="mode-content"
      :class="{ 'mode-content--page-scroll': mode === 'defense' && activePanel === 'history' }"
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
          class="panel-fill"
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
          class="panel-fill"
          :mode="mode"
        />
        <BuffComparePanel
          v-else-if="activePanel === 'buff-compare' && (mode === 'crisis-assault' || mode === 'defense')"
          key="buff-compare"
          class="panel-fill"
          :mode="mode"
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
</style>
