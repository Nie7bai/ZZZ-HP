<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import PhaseDetailModal from '@/components/history/PhaseDetailModal.vue'
import { fetchCrisisAssaultHpChart, type HpChartPoint } from '@/api/crisisAssault'
import { usePhaseDetailModal } from '@/composables/usePhaseDetailModal'
import { modeTitles, type ModeKey } from '@/types/history'

const props = defineProps<{
  mode: ModeKey
}>()

const points = ref<HpChartPoint[]>([])
const loading = ref(false)
const loadError = ref('')
const { visible: detailVisible, point: detailPoint, open: openPhaseDetail, close: closePhaseDetail } =
  usePhaseDetailModal()

const pageTitle = computed(() => modeTitles[props.mode])

async function loadChartData() {
  if (props.mode !== 'crisis-assault') return

  loading.value = true
  loadError.value = ''
  try {
    points.value = await fetchCrisisAssaultHpChart()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    points.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadChartData)
</script>

<template>
  <div class="hp-chart-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }} · 血量折线图</h1>
      <p class="panel-desc">上方为总血量，下方为相对上一期的血量膨胀倍率</p>
    </header>

    <p v-if="loading" class="status-text">加载中...</p>
    <p v-else-if="loadError" class="status-text error">{{ loadError }}</p>
    <p v-else-if="!points.length" class="status-text">暂无数据</p>

    <DualLineChartView
      v-else
      class="chart-view"
      :points="points"
      hp-chart-title="总血量折线图"
      expansion-chart-title="血量相对膨胀折线图"
      hp-aria-label="危局强袭战总血量折线图"
      expansion-aria-label="危局强袭战血量相对膨胀折线图"
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
  padding: 0.5rem 0.25rem 0.75rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.65rem;
  flex-shrink: 0;
}

.page-title {
  font-size: clamp(1.5rem, 3.5vw, 2rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
  text-align: center;
}

.panel-desc {
  font-size: 0.85rem;
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
</style>
