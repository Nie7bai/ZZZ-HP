<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import DualLineChartView from '@/components/history/DualLineChartView.vue'
import PhaseDetailModal from '@/components/history/PhaseDetailModal.vue'
import {
  fetchCrisisAssaultHpChart,
  filterChartPointsByLabels,
  formatPhaseCompactCode,
  resolvePhaseFromInput,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { fetchDefensePhaseCompareChart } from '@/api/defense'
import { usePhaseDetailModal } from '@/composables/usePhaseDetailModal'
import { useCrisisAssaultCompareStore } from '@/stores/crisisAssaultCompare'
import { useDefenseCompareStore } from '@/stores/defenseCompare'
import type { DefenseVariant } from '@/types/defense'
import { modeTitles, type ModeKey } from '@/types/history'

const QUICK_ADD_ROW_LIMIT = 10

type DefenseRemoveMode = 'direct' | 'menu'

interface RemoveMenuAnchor {
  top: number
  left: number
  minWidth: number
}

const props = defineProps<{
  mode: ModeKey
}>()

const route = useRoute()
const allPoints = ref<HpChartPoint[]>([])
const crisisCompareStore = useCrisisAssaultCompareStore()
const defenseCompareStore = useDefenseCompareStore()
const phaseSearchInput = ref('')
const inputError = ref('')
const quickAddDropdownValue = ref('')
const loading = ref(false)
const loadError = ref('')
const defenseRemoveMode = ref<DefenseRemoveMode>('menu')
const removeMenuPoint = ref<HpChartPoint | null>(null)
const removeMenuAnchor = ref<RemoveMenuAnchor | null>(null)
const { visible: detailVisible, point: detailPoint, open: openPhaseDetail, close: closePhaseDetail } =
  usePhaseDetailModal()

const defenseVariant = computed<DefenseVariant>(() =>
  route.name === 'defense-new' ? 'new' : 'old',
)

const selectedLabels = computed({
  get() {
    return props.mode === 'defense'
      ? defenseCompareStore.selectedPhaseLabels
      : crisisCompareStore.selectedPhaseLabels
  },
  set(value: string[]) {
    if (props.mode === 'defense') {
      defenseCompareStore.selectedPhaseLabels = value
    } else {
      crisisCompareStore.selectedPhaseLabels = value
    }
  },
})

const pageTitle = computed(() => modeTitles[props.mode])

const isDefenseMode = computed(() => props.mode === 'defense')

const panelDesc = computed(() =>
  isDefenseMode.value
    ? '添加任意期数，对比最后一防线总血量与相对膨胀变化；点击图表数据点可移除期数'
    : '添加任意期数，对比总血量与相对膨胀变化',
)

const defensePointClickHint = computed(() =>
  defenseRemoveMode.value === 'direct' ? '点击数据点移除该期' : '点击数据点选择是否移除',
)

const isRemoveMenuOpen = computed(() => removeMenuPoint.value !== null && removeMenuAnchor.value !== null)

const chartPoints = computed(() =>
  filterChartPointsByLabels(allPoints.value, selectedLabels.value),
)

const selectedPoints = computed(() => chartPoints.value)

const quickAddPoints = computed(() =>
  allPoints.value.filter((point) => !selectedLabels.value.includes(point.label)),
)

const quickAddInlinePoints = computed(() => quickAddPoints.value.slice(0, QUICK_ADD_ROW_LIMIT))

const quickAddDropdownPoints = computed(() => quickAddPoints.value.slice(QUICK_ADD_ROW_LIMIT))

function formatPhaseDisplay(point: HpChartPoint) {
  if (point.version && point.phase) {
    return `${point.version} 第 ${point.phase} 期`
  }
  return point.label
}

async function loadChartData() {
  loading.value = true
  loadError.value = ''
  try {
    if (props.mode === 'defense') {
      allPoints.value = await fetchDefensePhaseCompareChart(defenseVariant.value)
    } else if (props.mode === 'crisis-assault') {
      allPoints.value = await fetchCrisisAssaultHpChart()
    } else {
      allPoints.value = []
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    allPoints.value = []
  } finally {
    loading.value = false
  }
}

function addPhase(label: string) {
  if (selectedLabels.value.includes(label)) return
  selectedLabels.value = [...selectedLabels.value, label]
}

function addPhaseFromSearch(rawInput?: string) {
  const query = (rawInput ?? phaseSearchInput.value).trim()
  if (!query) return

  const point = resolvePhaseFromInput(allPoints.value, query)
  if (!point) {
    inputError.value = '未找到该期数，可试 1.41 / 1.4第1期'
    return
  }

  if (selectedLabels.value.includes(point.label)) {
    inputError.value = '该期数已添加'
    return
  }

  addPhase(point.label)
  phaseSearchInput.value = ''
  inputError.value = ''
}

function removePhase(label: string) {
  selectedLabels.value = selectedLabels.value.filter((item) => item !== label)
}

function clearPhases() {
  selectedLabels.value = []
  closeRemoveMenu()
}

function closeRemoveMenu() {
  removeMenuPoint.value = null
  removeMenuAnchor.value = null
}

function openRemoveMenu(point: HpChartPoint, event: MouseEvent) {
  const menuWidth = 200
  let left = event.clientX - menuWidth / 2
  let top = event.clientY + 10

  if (left + menuWidth > window.innerWidth - 8) {
    left = window.innerWidth - menuWidth - 8
  }
  if (left < 8) left = 8
  if (top + 88 > window.innerHeight - 8) {
    top = event.clientY - 88
  }

  removeMenuPoint.value = point
  removeMenuAnchor.value = { top, left, minWidth: menuWidth }
}

function confirmRemoveFromMenu() {
  if (removeMenuPoint.value) {
    removePhase(removeMenuPoint.value.label)
  }
  closeRemoveMenu()
}

function onChartPointClick(point: HpChartPoint, _index: number, event?: MouseEvent) {
  if (isDefenseMode.value) {
    if (event) event.stopPropagation()

    if (defenseRemoveMode.value === 'direct') {
      removePhase(point.label)
      return
    }

    if (removeMenuPoint.value?.label === point.label && isRemoveMenuOpen.value) {
      closeRemoveMenu()
      return
    }

    if (event) openRemoveMenu(point, event)
    return
  }

  openPhaseDetail(point)
}

function onDocumentClick() {
  closeRemoveMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeRemoveMenu()
}

watch(isRemoveMenuOpen, (open) => {
  if (open) {
    window.setTimeout(() => {
      document.addEventListener('click', onDocumentClick)
      document.addEventListener('keydown', onDocumentKeydown)
    }, 0)
    return
  }

  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})

function onQuickAddDropdownChange() {
  if (!quickAddDropdownValue.value) return
  addPhase(quickAddDropdownValue.value)
  quickAddDropdownValue.value = ''
}

onMounted(loadChartData)

watch(defenseRemoveMode, closeRemoveMenu)

watch(defenseVariant, () => {
  if (props.mode === 'defense') loadChartData()
})

watch(phaseSearchInput, () => {
  if (inputError.value) inputError.value = ''
})
</script>

<template>
  <div class="phase-compare-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }} · 期数对比折线图</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
    </header>

    <p v-if="loading" class="status-text">加载中...</p>
    <p v-else-if="loadError" class="status-text error">{{ loadError }}</p>

    <template v-else>
      <section class="phase-selector">
        <form class="phase-search-form" @submit.prevent="addPhaseFromSearch()">
          <label class="selector-label" for="phase-search-input">搜索添加</label>
          <div class="selector-actions">
            <input
              id="phase-search-input"
              v-model="phaseSearchInput"
              type="text"
              class="phase-search-input"
              placeholder="1.41 / 1.4第1期"
              spellcheck="false"
            />
            <button type="submit" class="add-btn">添加</button>
          </div>
          <p v-if="inputError" class="input-error">{{ inputError }}</p>
        </form>

        <div v-if="quickAddPoints.length" class="quick-add">
          <span class="quick-add-label">快捷添加</span>
          <div class="quick-add-row">
            <button
              v-for="point in quickAddInlinePoints"
              :key="point.label"
              type="button"
              class="quick-add-btn"
              :title="formatPhaseDisplay(point)"
              @click="addPhaseFromSearch(formatPhaseCompactCode(point))"
            >
              {{ formatPhaseCompactCode(point) }}
            </button>
            <select
              v-if="quickAddDropdownPoints.length"
              v-model="quickAddDropdownValue"
              class="quick-add-select"
              @change="onQuickAddDropdownChange"
            >
              <option value="">更多期数</option>
              <option
                v-for="point in quickAddDropdownPoints"
                :key="point.label"
                :value="point.label"
              >
                {{ formatPhaseCompactCode(point) }} · {{ formatPhaseDisplay(point) }}
              </option>
            </select>
          </div>
        </div>

        <div v-if="selectedPoints.length" class="selected-phases">
          <div class="selected-phases-header">
            <span class="selected-label">已选期数（{{ selectedPoints.length }}）</span>
            <button type="button" class="clear-btn" @click="clearPhases">清空</button>
          </div>

          <div v-if="!isDefenseMode" class="phase-tags">
            <button
              v-for="point in selectedPoints"
              :key="point.label"
              type="button"
              class="phase-tag"
              :title="`移除 ${formatPhaseDisplay(point)}`"
              @click="removePhase(point.label)"
            >
              <span>{{ formatPhaseDisplay(point) }}</span>
              <span class="tag-remove" aria-hidden="true">×</span>
            </button>
          </div>
        </div>
      </section>

      <DualLineChartView
        v-model:remove-mode="defenseRemoveMode"
        class="chart-view"
        :points="chartPoints"
        show-when-empty
        hp-chart-title="期数对比 · 总血量折线图"
        expansion-chart-title="期数对比 · 血量相对膨胀折线图"
        :hp-aria-label="isDefenseMode ? '式舆防卫战期数对比总血量折线图' : '危局强袭战期数对比总血量折线图'"
        :expansion-aria-label="isDefenseMode ? '式舆防卫战期数对比血量相对膨胀折线图' : '危局强袭战期数对比血量相对膨胀折线图'"
        :enable-point-click="isDefenseMode ? chartPoints.length > 0 : true"
        :point-click-hint="isDefenseMode && chartPoints.length > 0 ? defensePointClickHint : undefined"
        :show-remove-mode-toggle="isDefenseMode && chartPoints.length > 0"
        :boss-preview-mode="isDefenseMode ? 'embedded' : 'crisis'"
        @point-click="onChartPointClick"
      />

      <Teleport to="body">
        <div
          v-if="isDefenseMode && isRemoveMenuOpen && removeMenuPoint && removeMenuAnchor"
          class="phase-remove-menu"
          :style="{
            top: `${removeMenuAnchor.top}px`,
            left: `${removeMenuAnchor.left}px`,
            minWidth: `${removeMenuAnchor.minWidth}px`,
          }"
          role="menu"
          @click.stop
        >
          <p class="phase-remove-menu-title">{{ formatPhaseDisplay(removeMenuPoint) }}</p>
          <button
            type="button"
            class="phase-remove-menu-item phase-remove-menu-item--danger"
            role="menuitem"
            @mousedown.prevent
            @click="confirmRemoveFromMenu"
          >
            移除当前期数
          </button>
          <button
            type="button"
            class="phase-remove-menu-item"
            role="menuitem"
            @mousedown.prevent
            @click="closeRemoveMenu"
          >
            取消
          </button>
        </div>
      </Teleport>

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
.phase-compare-panel {
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

.phase-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.phase-search-form {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
}

.selector-label,
.quick-add-label,
.selected-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.selector-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.phase-search-input {
  width: 9.5rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}

.phase-search-input:focus {
  border-color: #e8a838;
}

.add-btn,
.clear-btn,
.quick-add-btn {
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.add-btn:hover,
.quick-add-btn:hover {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.clear-btn:hover {
  border-color: #e85d4c;
  color: #e85d4c;
}

.input-error {
  margin: 0;
  font-size: 0.78rem;
  color: #e85d4c;
}

.quick-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.quick-add-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 0.4rem;
  width: 100%;
  max-width: min(960px, 100%);
  overflow: hidden;
}

.quick-add-btn {
  flex-shrink: 0;
  min-width: 3.2rem;
  padding-inline: 0.55rem;
}

.quick-add-select {
  flex-shrink: 0;
  min-width: 8.5rem;
  max-width: 12rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.85rem;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s;
}

.quick-add-select:hover,
.quick-add-select:focus {
  border-color: var(--color-border-hover);
}

.selected-phases {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.selected-phases-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
}

.phase-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
  max-width: min(960px, 100%);
}

.phase-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.55rem 0.35rem 0.7rem;
  border: 1px solid hsla(160, 100%, 37%, 0.45);
  border-radius: 999px;
  background: hsla(160, 100%, 37%, 0.12);
  color: var(--color-heading);
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.phase-tag:hover {
  border-color: #e85d4c;
  background: hsla(0, 70%, 55%, 0.1);
}

.tag-remove {
  font-size: 1rem;
  line-height: 1;
  opacity: 0.75;
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
</style>

<style>
.phase-remove-menu {
  position: fixed;
  z-index: 1200;
  padding: 0.35rem 0 0.2rem;
  border: 1.5px solid var(--color-border-hover);
  border-radius: 8px;
  background: var(--color-background);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.16);
}

.phase-remove-menu-title {
  margin: 0;
  padding: 0.2rem 0.75rem 0.35rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: #e8a838;
  text-align: center;
}

.phase-remove-menu-item {
  display: block;
  width: 100%;
  padding: 0.48rem 0.75rem;
  border: none;
  background: transparent;
  color: var(--color-heading);
  font-size: 0.82rem;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s;
}

.phase-remove-menu-item:hover {
  background: var(--color-background-mute);
}

.phase-remove-menu-item--danger {
  color: #e85d4c;
}

.phase-remove-menu-item--danger:hover {
  background: hsla(0, 70%, 55%, 0.1);
}
</style>
