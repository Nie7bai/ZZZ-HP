<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import PhaseDetailModal from '@/components/history/PhaseDetailModal.vue'
import {
  fetchBossChart,
  fetchBossList,
  type BossOption,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { fetchDefenseBossChart, fetchDefenseBossList } from '@/api/defense'
import { usePhaseDetailModal } from '@/composables/usePhaseDetailModal'
import type { DefenseVariant } from '@/types/defense'
import { modeTitles, type ModeKey } from '@/types/history'
import type { DefenseCompareMonsterCategory } from '@/utils/defenseCompare'
import { resolveAssetUrl } from '@/utils/gameData'

const props = defineProps<{
  mode: ModeKey
}>()

const route = useRoute()
const bossList = ref<BossOption[]>([])
const selectedBoss = ref('')
const selectedCategory = ref<DefenseCompareMonsterCategory>('elite')
const crisisRoomType = ref<'normal' | 'hard'>('normal')
const points = ref<HpChartPoint[]>([])
const listLoading = ref(false)
const chartLoading = ref(false)
const listError = ref('')
const chartError = ref('')
const { visible: detailVisible, point: detailPoint, open: openPhaseDetail, close: closePhaseDetail } =
  usePhaseDetailModal()

const defenseVariant = computed<DefenseVariant>(() =>
  route.name === 'defense-new' ? 'new' : 'old',
)

const isDefenseMode = computed(() => props.mode === 'defense')

const pageTitle = computed(() => modeTitles[props.mode])

const panelDesc = computed(() => {
  if (isDefenseMode.value) {
    return '先选择精英或 Boss，再选择怪物，查看其在各期出现时的血量与相对膨胀变化'
  }
  return crisisRoomType.value === 'hard'
    ? '选择困难模式 Boss 后，查看其在各期出现时的血量、危局血量系数与相对变化'
    : '选择正常模式 Boss（房间 1/2/3）后，查看其在各期出现时的血量、危局血量系数与相对变化'
})

const selectedBossInfo = computed(() =>
  bossList.value.find((boss) => boss.boss_name === selectedBoss.value),
)

const categoryLabel = computed(() => (selectedCategory.value === 'elite' ? '精英' : 'Boss'))

async function loadBossList() {
  if (props.mode !== 'crisis-assault' && props.mode !== 'defense') return

  listLoading.value = true
  listError.value = ''
  try {
    if (isDefenseMode.value) {
      bossList.value = await fetchDefenseBossList(defenseVariant.value, selectedCategory.value)
    } else {
      bossList.value = await fetchBossList(crisisRoomType.value)
    }

    if (bossList.value.some((boss) => boss.boss_name === selectedBoss.value)) return
    selectedBoss.value = bossList.value[0]?.boss_name ?? ''
  } catch (error) {
    listError.value = error instanceof Error ? error.message : '加载怪物列表失败'
    bossList.value = []
    selectedBoss.value = ''
  } finally {
    listLoading.value = false
  }
}

async function loadBossChart() {
  if (!selectedBoss.value) {
    points.value = []
    return
  }

  chartLoading.value = true
  chartError.value = ''
  try {
    if (isDefenseMode.value) {
      points.value = await fetchDefenseBossChart(
        defenseVariant.value,
        selectedBoss.value,
        selectedCategory.value,
      )
    } else {
      points.value = await fetchBossChart(selectedBoss.value, crisisRoomType.value)
    }
  } catch (error) {
    chartError.value = error instanceof Error ? error.message : '加载折线图失败'
    points.value = []
  } finally {
    chartLoading.value = false
  }
}

onMounted(loadBossList)

watch(defenseVariant, () => {
  if (isDefenseMode.value) {
    selectedBoss.value = ''
    loadBossList()
  }
})

watch(selectedCategory, () => {
  if (!isDefenseMode.value) return
  selectedBoss.value = ''
  loadBossList()
})

watch(crisisRoomType, () => {
  if (isDefenseMode.value) return
  selectedBoss.value = ''
  loadBossList()
})

watch(selectedBoss, () => {
  loadBossChart()
})
</script>

<template>
  <div class="monster-compare-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }} · 单独怪物对比</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
    </header>

    <p v-if="listLoading" class="status-text">加载怪物列表中...</p>
    <p v-else-if="listError" class="status-text error">{{ listError }}</p>

    <template v-else>
      <div class="selector-toolbar" :class="{ 'selector-toolbar--defense': isDefenseMode }">
        <div v-if="isDefenseMode" class="selector-field">
          <label class="selector-label" for="category-select">怪物类型</label>
          <select id="category-select" v-model="selectedCategory" class="boss-select">
            <option value="elite">精英</option>
            <option value="boss">Boss</option>
          </select>
        </div>

        <div class="selector-field">
          <label class="selector-label" for="boss-select">
            {{
              isDefenseMode
                ? `选择${categoryLabel}`
                : crisisRoomType === 'hard'
                  ? '选择困难 Boss'
                  : '选择正常 Boss'
            }}
          </label>
          <div class="selector-row">
            <img
              v-if="selectedBossInfo?.boss_image"
              :src="resolveAssetUrl(selectedBossInfo.boss_image)"
              :alt="selectedBoss"
              class="boss-thumb"
            />
            <select
              id="boss-select"
              v-model="selectedBoss"
              class="boss-select"
              :disabled="!bossList.length"
            >
              <option v-if="!bossList.length" value="">
                暂无{{ isDefenseMode ? categoryLabel : 'Boss' }}
              </option>
              <option v-for="boss in bossList" :key="boss.boss_name" :value="boss.boss_name">
                {{ boss.boss_name }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <p v-if="chartLoading" class="status-text">图表加载中...</p>
      <p v-else-if="chartError" class="status-text error">{{ chartError }}</p>
      <p v-else-if="selectedBoss && !points.length" class="status-text">该怪物暂无历史数据</p>

      <DualLineChartView
        v-else-if="points.length"
        class="chart-view"
        v-model:hp-mode="crisisRoomType"
        :show-hp-mode-toggle="!isDefenseMode"
        :enable-hp-coeff-charts="!isDefenseMode"
        :points="points"
        :hp-chart-title="`${selectedBoss} 血量折线图`"
        :expansion-chart-title="`${selectedBoss} 血量相对膨胀折线图`"
        :hp-aria-label="`${selectedBoss} 血量折线图`"
        :expansion-aria-label="`${selectedBoss} 血量相对膨胀折线图`"
        :enable-point-click="!isDefenseMode"
        :enable-boss-preview="false"
        :enable-room-buff-preview="isDefenseMode"
        :enable-hp-converted953-toggle="!isDefenseMode"
        @point-click="openPhaseDetail"
      />

      <PhaseDetailModal
        v-if="!isDefenseMode"
        :visible="detailVisible"
        :point="detailPoint"
        :mode="mode"
        @close="closePhaseDetail"
      />
    </template>
  </div>
</template>

<style scoped>
.monster-compare-panel {
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

.category-selector,
.boss-selector,
.selector-toolbar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.selector-toolbar--defense {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: center;
  gap: 1rem 1.25rem;
}

.selector-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.selector-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-heading);
}

.selector-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.boss-thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.boss-select {
  min-width: 240px;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.95rem;
}

.status-text {
  min-height: 30vh;
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
  .monster-compare-panel {
    min-height: auto;
    padding: 0.35rem 0.15rem 0.55rem;
  }

  .page-title {
    font-size: 1.05rem;
  }

  .panel-desc {
    font-size: 0.72rem;
    padding-inline: 0.35rem;
  }

  .selector-toolbar--defense {
    flex-direction: column;
    align-items: stretch;
    gap: 0.55rem;
  }

  .selector-field {
    align-items: stretch;
    width: 100%;
  }

  .selector-row {
    width: 100%;
    justify-content: center;
  }

  .boss-select {
    min-width: 0;
    flex: 1;
    width: 100%;
  }
}
</style>
