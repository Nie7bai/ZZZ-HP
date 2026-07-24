<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import PhaseDetailModal from '@/components/history/PhaseDetailModal.vue'
import {
  buildDefenseHpChartPoints,
  fetchDefenseSeasons,
  formatDefenseHpOptionLabel,
  getDefenseHpChartOptions,
} from '@/api/defense'
import type { HpChartPoint } from '@/api/crisisAssault'
import type { DefenseSeason, DefenseVariant } from '@/types/defense'
import { usePhaseDetailModal } from '@/composables/usePhaseDetailModal'
import { getDefenseHpOptionKey } from '@/utils/defenseHp'

const route = useRoute()

const defenseVariant = computed<DefenseVariant>(() =>
  route.name === 'defense-new' ? 'new' : 'old',
)

const pageTitle = computed(() =>
  defenseVariant.value === 'new' ? '新·式舆防卫战' : '旧·式舆防卫战',
)

const seasons = ref<DefenseSeason[]>([])
const seasonsLoading = ref(false)
const seasonsError = ref('')
const selectedOptionKey = ref('')
const points = ref<HpChartPoint[]>([])
const chartLoading = ref(false)
const loadError = ref('')
const { visible: detailVisible, point: detailPoint, open: openPhaseDetail, close: closePhaseDetail } =
  usePhaseDetailModal()

const hpOptions = computed(() => getDefenseHpChartOptions(seasons.value))

const selectedOption = computed(() =>
  hpOptions.value.find((option) => getDefenseHpOptionKey(option) === selectedOptionKey.value),
)

const selectedOptionLabel = computed(() => {
  const option = selectedOption.value
  return option ? formatDefenseHpOptionLabel(option) : ''
})

function loadChartData() {
  if (!selectedOptionKey.value || !seasons.value.length) {
    points.value = []
    return
  }

  chartLoading.value = true
  loadError.value = ''
  try {
    points.value = buildDefenseHpChartPoints(seasons.value, selectedOptionKey.value)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    points.value = []
  } finally {
    chartLoading.value = false
  }
}

function initOptions() {
  const options = hpOptions.value
  if (!options.length) {
    selectedOptionKey.value = ''
    points.value = []
    return
  }

  const hasCurrent = options.some(
    (option) => getDefenseHpOptionKey(option) === selectedOptionKey.value,
  )
  if (!hasCurrent) {
    selectedOptionKey.value = getDefenseHpOptionKey(options[0]!)
  }
  loadChartData()
}

async function loadSeasons() {
  seasonsLoading.value = true
  seasonsError.value = ''
  try {
    seasons.value = await fetchDefenseSeasons(defenseVariant.value)
    initOptions()
  } catch (error) {
    seasonsError.value = error instanceof Error ? error.message : '加载失败'
    seasons.value = []
    points.value = []
  } finally {
    seasonsLoading.value = false
  }
}

onMounted(loadSeasons)

watch(defenseVariant, loadSeasons)
watch(selectedOptionKey, loadChartData)
</script>

<template>
  <div class="hp-chart-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }} · 总血量折线图</h1>
      <p class="panel-desc">上方为总血量，下方为相对上一期的血量膨胀倍率</p>
    </header>

    <p v-if="seasonsLoading" class="status-text">加载中...</p>
    <p v-else-if="seasonsError" class="status-text error">{{ seasonsError }}</p>
    <p v-else-if="!hpOptions.length" class="status-text">暂无可选防线或房间</p>

    <template v-else>
      <div class="target-selector">
        <label class="selector-label" for="defense-hp-select">选择防线 / 房间</label>
        <select id="defense-hp-select" v-model="selectedOptionKey" class="target-select">
          <option
            v-for="option in hpOptions"
            :key="getDefenseHpOptionKey(option)"
            :value="getDefenseHpOptionKey(option)"
          >
            {{ formatDefenseHpOptionLabel(option) }}
          </option>
        </select>
      </div>

      <p v-if="chartLoading" class="status-text">加载中...</p>
      <p v-else-if="loadError" class="status-text error">{{ loadError }}</p>
      <p v-else-if="selectedOptionKey && !points.length" class="status-text">暂无数据</p>

      <DualLineChartView
        v-else-if="points.length"
        class="chart-view"
        :points="points"
        :hp-chart-title="`${selectedOptionLabel} 总血量折线图`"
        :expansion-chart-title="`${selectedOptionLabel} 血量相对膨胀折线图`"
        :hp-aria-label="`${selectedOptionLabel} 总血量折线图`"
        :expansion-aria-label="`${selectedOptionLabel} 血量相对膨胀折线图`"
        boss-preview-mode="embedded"
        @point-click="openPhaseDetail"
      />

      <PhaseDetailModal
        :visible="detailVisible"
        :point="detailPoint"
        mode="defense"
        @close="closePhaseDetail"
      />
    </template>
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

.target-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.selector-label {
  font-size: 0.85rem;
  opacity: 0.75;
}

.target-select {
  min-width: min(100%, 360px);
  max-width: 100%;
  padding: 0.55rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.92rem;
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

@media (max-width: 768px) {
  .hp-chart-panel {
    padding: 0.2rem 0.1rem 0.35rem;
  }

  .page-title {
    font-size: 1.05rem;
  }

  .panel-desc {
    font-size: 0.72rem;
    padding-inline: 0.35rem;
  }

  .target-selector {
    align-items: stretch;
    gap: 0.4rem;
    margin-bottom: 0.55rem;
    padding-inline: 0.25rem;
  }

  .selector-label {
    font-size: 0.78rem;
    text-align: center;
  }

  .target-select {
    min-width: 0;
    width: 100%;
    font-size: 0.85rem;
  }
}
</style>
