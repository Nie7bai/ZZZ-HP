<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import PhaseDetailModal from '@/components/history/PhaseDetailModal.vue'
import {
  fetchCrisisAssaultHpChart,
  type CrisisHpChartMode,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { usePhaseDetailModal } from '@/composables/usePhaseDetailModal'
import { modeTitles, type ModeKey } from '@/types/history'

const props = defineProps<{
  mode: ModeKey
}>()

const hpMode = ref<CrisisHpChartMode>('normal')
const points = ref<HpChartPoint[]>([])
const loading = ref(false)
const loadError = ref('')
const { visible: detailVisible, point: detailPoint, open: openPhaseDetail, close: closePhaseDetail } =
  usePhaseDetailModal()

const pageTitle = computed(() => modeTitles[props.mode])
const isHardMode = computed(() => hpMode.value === 'hard')

const panelTitle = computed(() =>
  isHardMode.value ? `${pageTitle.value} · 困难血量折线图` : `${pageTitle.value} · 血量折线图`,
)

const panelDesc = computed(() =>
  isHardMode.value
    ? '上方为困难模式血量与星级线，下方为相对膨胀；可勾选 953 防御换算（T）'
    : '上方为血量与分数线，下方为相对膨胀；可勾选 953 防御换算（T）',
)

async function loadChartData() {
  if (props.mode !== 'crisis-assault') return

  loading.value = true
  loadError.value = ''
  try {
    points.value = await fetchCrisisAssaultHpChart(hpMode.value)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    points.value = []
  } finally {
    loading.value = false
  }
}

watch(hpMode, () => {
  loadChartData()
})

onMounted(loadChartData)
</script>

<template>
  <div class="hp-chart-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ panelTitle }}</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
    </header>

    <p v-if="loading" class="status-text">加载中...</p>
    <p v-else-if="loadError" class="status-text error">{{ loadError }}</p>
    <p v-else-if="!points.length" class="status-text">
      {{ isHardMode ? '暂无困难模式数据' : '暂无数据' }}
    </p>

    <DualLineChartView
      v-else
      class="chart-view"
      v-model:hp-mode="hpMode"
      show-hp-mode-toggle
      enable-score-hp-overlays
      :enable-boss-preview="false"
      :points="points"
      :hp-chart-title="isHardMode ? '困难血量折线图' : '血量折线图'"
      :expansion-chart-title="isHardMode ? '困难血量相对膨胀折线图' : '血量相对膨胀折线图'"
      :hp-aria-label="`危局强袭战${isHardMode ? '困难' : ''}血量折线图`"
      :expansion-aria-label="`危局强袭战${isHardMode ? '困难' : ''}血量相对膨胀折线图`"
      enable-hp-converted953-toggle
      @point-click="openPhaseDetail"
    />

    <PhaseDetailModal
      :visible="detailVisible"
      :point="detailPoint"
      :mode="mode"
      @close="closePhaseDetail"
    />
  </div>
</template>

<style scoped>
.hp-chart-panel {
  width: 100%;
  max-width: none;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 0.35rem 0.25rem 0.5rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  margin-bottom: 0.4rem;
  flex-shrink: 0;
}

.page-title {
  font-size: clamp(1.15rem, 2.6vw, 1.75rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
  text-align: center;
}

.panel-desc {
  font-size: 0.8rem;
  opacity: 0.7;
  color: var(--color-text);
  text-align: center;
}

.status-text {
  min-height: 40vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  opacity: 0.75;
}

.status-text.error {
  color: #e85d4c;
  opacity: 1;
}

.chart-view {
  flex: 1;
  min-height: 0;
  display: flex;
}

@media (max-height: 760px) {
  .panel-header {
    margin-bottom: 0.25rem;
  }

  .panel-desc {
    display: none;
  }
}

@media (max-width: 768px) {
  .hp-chart-panel {
    padding: 0.2rem 0.1rem 0.35rem;
  }
}
</style>
