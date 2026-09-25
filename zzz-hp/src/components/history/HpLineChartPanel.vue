<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import PhaseDetailModal from '@/components/history/PhaseDetailModal.vue'
import {
  fetchCrisisAssaultHpChart,
  type CrisisHpChartMode,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { fetchDeductionPeriodHpChart } from '@/api/deduction'
import { usePhaseDetailModal } from '@/composables/usePhaseDetailModal'
import { modeTitles, type ModeKey } from '@/types/history'
import {
  buildQueryWithValues,
  PANEL_MODE_HARD,
  PANEL_QUERY_KEYS,
  readSingleQueryValue,
} from '@/utils/panelUrlState'
import { createRequestEpoch } from '@/utils/requestEpoch'

const props = defineProps<{
  mode: ModeKey
}>()

const route = useRoute()
const router = useRouter()

/** 只有危局强袭战有「正常 / 绝境」切换，其余模式不参与 `?mode=` 同步 */
const supportsHardMode = computed(() => props.mode === 'crisis-assault')

function readHpModeFromQuery(): CrisisHpChartMode {
  return readSingleQueryValue(route.query, PANEL_QUERY_KEYS.mode) === PANEL_MODE_HARD
    ? 'hard'
    : 'normal'
}

const hpMode = ref<CrisisHpChartMode>(readHpModeFromQuery())
const points = ref<HpChartPoint[]>([])
const chartLoadEpoch = createRequestEpoch()
const loading = ref(false)
const loadError = ref('')
const { visible: detailVisible, point: detailPoint, open: openPhaseDetail, close: closePhaseDetail } =
  usePhaseDetailModal()

const pageTitle = computed(() => modeTitles[props.mode])
const isHardMode = computed(() => hpMode.value === 'hard')
const isDeductionMode = computed(() => props.mode === 'deduction')

const panelTitle = computed(() =>
  isHardMode.value ? `${pageTitle.value} · 绝境血量折线图` : `${pageTitle.value} · 血量折线图`,
)

const panelDesc = computed(() => {
  if (isDeductionMode.value) {
    return '每期一点：当期全部节点总血量 ÷ 当期 Boss 数（含各 STAGE，不限终局）；可勾选 953 防御换算（T）'
  }
  return isHardMode.value
    ? '上方为绝境模式血量与星级线，下方为相对膨胀；可勾选 953 防御换算（T）'
    : '上方为血量与分数线，下方为相对膨胀；可勾选 953 防御换算（T）'
})

async function loadChartData() {
  const token = chartLoadEpoch.next()
  if (props.mode !== 'crisis-assault' && props.mode !== 'deduction') return

  loading.value = true
  loadError.value = ''
  try {
    const data =
      props.mode === 'crisis-assault'
        ? await fetchCrisisAssaultHpChart(hpMode.value)
        : await fetchDeductionPeriodHpChart()
    if (!chartLoadEpoch.isCurrent(token)) return
    points.value = data
  } catch (error) {
    if (!chartLoadEpoch.isCurrent(token)) return
    loadError.value = error instanceof Error ? error.message : '加载失败'
    points.value = []
  } finally {
    if (!chartLoadEpoch.isCurrent(token)) return
    loading.value = false
  }
}

/**
 * 面板内切换 → 写入 URL（`?mode=hard`），使「绝境」也能分享 / 收藏。
 * 用 replace 而非 push：与对应表一致地反映当前状态，且不往历史里堆条目。
 */
function syncHpModeToQuery(value: CrisisHpChartMode) {
  if (!supportsHardMode.value) return
  const current = readSingleQueryValue(route.query, PANEL_QUERY_KEYS.mode)
  const next = value === 'hard' ? PANEL_MODE_HARD : null
  if ((next ?? undefined) === current) return
  void router.replace({
    path: route.path,
    query: buildQueryWithValues(route.query, { [PANEL_QUERY_KEYS.mode]: next }),
    hash: route.hash,
  })
}

watch(hpMode, (value) => {
  syncHpModeToQuery(value)
  loadChartData()
})

// URL 变化（浏览器前进后退 / 直接改地址）→ 同步回面板状态
watch(
  () => route.query[PANEL_QUERY_KEYS.mode],
  () => {
    if (!supportsHardMode.value) return
    const next = readHpModeFromQuery()
    if (next !== hpMode.value) hpMode.value = next
  },
)

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
      {{ isHardMode ? '暂无绝境模式数据' : '暂无数据' }}
    </p>

    <DualLineChartView
      v-else
      class="chart-view"
      v-model:hp-mode="hpMode"
      :show-hp-mode-toggle="props.mode === 'crisis-assault'"
      :enable-score-hp-overlays="props.mode === 'crisis-assault'"
      :enable-boss-preview="false"
      :points="points"
      :hp-chart-title="isHardMode ? '绝境血量折线图' : '血量折线图'"
      :expansion-chart-title="isHardMode ? '绝境血量相对膨胀折线图' : '血量相对膨胀折线图'"
      :hp-aria-label="`${pageTitle}${isHardMode ? '绝境' : ''}血量折线图`"
      :expansion-aria-label="`${pageTitle}${isHardMode ? '绝境' : ''}血量相对膨胀折线图`"
      :enable-hp-converted953-toggle="props.mode === 'crisis-assault' || props.mode === 'deduction'"
      :enable-point-click="props.mode !== 'deduction'"
      @point-click="openPhaseDetail"
    />

    <PhaseDetailModal
      v-if="props.mode !== 'deduction'"
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
