<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fetchCrisisAssaultPhases, findPhaseIndexFromChartPoint, type HpChartPoint } from '@/api/crisisAssault'
import {
  FS_HP_RATIO_NORMAL,
  HARD_SCORE_MARKERS,
  scaleHpByRatio,
} from '@/data/crisisScoreHpTable'
import { historyData } from '@/data/historyData'
import { modeTitles, type ModeKey, type PhaseData } from '@/types/history'
import { formatHp, formatHpDelta, formatHpExpansionPercent, parseHpString } from '@/utils/gameData'

const props = defineProps<{
  mode: ModeKey
  embedded?: boolean
  chartPoint?: HpChartPoint | null
}>()

const crisisPhases = ref<PhaseData[]>([])
const loading = ref(false)
const loadError = ref('')

const phases = computed(() =>
  props.mode === 'crisis-assault' ? crisisPhases.value : historyData[props.mode],
)

const currentIndex = ref(0)
const showPicker = ref(false)
const pickerScrollRef = ref<HTMLElement | null>(null)
const isPickerDragging = ref(false)
const pickerDragMoved = ref(false)
const pickerDragStartY = ref(0)
const pickerDragScrollTop = ref(0)

const currentPhase = computed(() => phases.value[currentIndex.value])

const pageTitle = computed(() => modeTitles[props.mode])

const phaseTotalHpComparison = computed(() => {
  const index = currentIndex.value
  if (index <= 0) return null

  const current = phases.value[index]
  const previous = phases.value[index - 1]
  if (!current || !previous) return null

  const currentHp = current.totalHp ?? parseHpString(current.rawHp)
  const previousHp = previous.totalHp ?? parseHpString(previous.rawHp)
  if (currentHp == null || previousHp == null) return null

  const diff = currentHp - previousHp
  if (diff === 0) return null

  return {
    diff,
    expansion: formatHpExpansionPercent(currentHp, previousHp),
  }
})

const showConvertedTotalHp = computed(() => {
  const phase = currentPhase.value
  if (!phase || props.mode !== 'crisis-assault') return false
  if (
    phase.enemies.some(
      (enemy) => !enemy.isHardRoom && enemy.defense != null && enemy.defense !== 953,
    )
  ) {
    return true
  }
  if (
    phase.totalHp != null &&
    phase.totalHpConverted953 != null &&
    phase.totalHpConverted953 !== phase.totalHp
  ) {
    return true
  }
  return Boolean(phase.rawHpConverted953 && phase.rawHpConverted953 !== phase.rawHp)
})

const showHardTotalHp = computed(() => {
  const phase = currentPhase.value
  if (!phase || props.mode !== 'crisis-assault') return false
  return (phase.hardTotalHp ?? 0) > 0
})

const showConvertedHardTotalHp = computed(() => {
  const phase = currentPhase.value
  if (!phase || !showHardTotalHp.value) return false
  if (
    phase.enemies.some(
      (enemy) => enemy.isHardRoom && enemy.defense != null && enemy.defense !== 953,
    )
  ) {
    return true
  }
  return (
    phase.hardTotalHp != null &&
    phase.hardTotalHpConverted953 != null &&
    phase.hardTotalHpConverted953 !== phase.hardTotalHp
  )
})

const phaseFsHp = computed(() => {
  const phase = currentPhase.value
  if (!phase || props.mode !== 'crisis-assault') return null
  const total = phase.totalHp ?? parseHpString(phase.rawHp)
  if (total == null || total <= 0) return null
  const hp = scaleHpByRatio(total, FS_HP_RATIO_NORMAL)
  const converted =
    phase.totalHpConverted953 != null && phase.totalHpConverted953 > 0
      ? scaleHpByRatio(phase.totalHpConverted953, FS_HP_RATIO_NORMAL)
      : null
  return { hp, converted }
})

const phaseHardScoreHps = computed(() => {
  const phase = currentPhase.value
  if (!phase || !showHardTotalHp.value) return []
  const total = phase.hardTotalHp ?? 0
  if (total <= 0) return []
  const convertedTotal = phase.hardTotalHpConverted953 ?? null
  return HARD_SCORE_MARKERS.map((marker) => ({
    ...marker,
    hp: scaleHpByRatio(total, marker.hpRatio),
    converted:
      convertedTotal != null && convertedTotal > 0
        ? scaleHpByRatio(convertedTotal, marker.hpRatio)
        : null,
  }))
})

const phaseHardTotalHpComparison = computed(() => {
  const index = currentIndex.value
  if (index <= 0 || props.mode !== 'crisis-assault') return null

  const current = phases.value[index]
  const previous = phases.value[index - 1]
  if (!current || !previous) return null

  const currentHp = current.hardTotalHp ?? 0
  const previousHp = previous.hardTotalHp ?? 0
  if (!currentHp && !previousHp) return null
  const diff = currentHp - previousHp
  if (diff === 0) return null

  return {
    diff,
    expansion: formatHpExpansionPercent(currentHp, previousHp),
  }
})

function shouldShowConvertedEnemyHp(enemy: PhaseData['enemies'][number]) {
  return (
    props.mode === 'crisis-assault' &&
    enemy.defense != null &&
    enemy.defense !== 953 &&
    Boolean(enemy.hpConverted953)
  )
}

function getBossHpComparison(
  bossName: string | undefined,
  hpValue: number | undefined,
  hpText: string,
) {
  if (!bossName) return null

  const currentHp = hpValue ?? parseHpString(hpText)
  if (currentHp == null) return null

  for (let index = currentIndex.value - 1; index >= 0; index--) {
    const phase = phases.value[index]
    if (!phase) continue

    for (const enemy of phase.enemies) {
      if (enemy.bossName !== bossName) continue

      const previousHp = enemy.hpValue ?? parseHpString(enemy.hp)
      if (previousHp == null) continue

      const diff = currentHp - previousHp
      if (diff === 0) return null

      return {
        diff,
        expansion: formatHpExpansionPercent(currentHp, previousHp),
      }
    }
  }

  return null
}

function getBossHpCoeffComparison(
  bossName: string | undefined,
  currentCoeff: number | null | undefined,
) {
  if (!bossName) return null
  if (currentCoeff == null || !Number.isFinite(currentCoeff)) return null

  for (let index = currentIndex.value - 1; index >= 0; index--) {
    const phase = phases.value[index]
    if (!phase) continue

    for (const enemy of phase.enemies) {
      if (enemy.bossName !== bossName) continue
      const previousCoeff = enemy.hpCoeffPercent
      if (previousCoeff == null || !Number.isFinite(previousCoeff)) continue

      const diff = currentCoeff - previousCoeff
      if (Math.abs(diff) < 1e-6) return null

      const signed = diff >= 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`
      return {
        diff,
        deltaLabel: signed,
      }
    }
  }

  return null
}

const currentEnemyHpComparisons = computed(() => {
  const phase = currentPhase.value
  if (!phase) return []

  return phase.enemies.map((enemy) =>
    getBossHpComparison(enemy.bossName, enemy.hpValue, enemy.hp),
  )
})

const currentEnemyHpCoeffComparisons = computed(() => {
  const phase = currentPhase.value
  if (!phase) return []

  return phase.enemies.map((enemy) =>
    getBossHpCoeffComparison(enemy.bossName, enemy.hpCoeffPercent ?? null),
  )
})

function defaultPublicPhaseIndex(list: { isHidden?: boolean }[]): number {
  if (!list.length) return 0
  for (let index = list.length - 1; index >= 0; index--) {
    if (!list[index]?.isHidden) return index
  }
  return list.length - 1
}

async function loadCrisisAssaultData() {
  if (props.mode !== 'crisis-assault') return

  loading.value = true
  loadError.value = ''
  try {
    crisisPhases.value = await fetchCrisisAssaultPhases()
    if (props.chartPoint) {
      applyChartPointSelection()
    } else {
      currentIndex.value = defaultPublicPhaseIndex(crisisPhases.value)
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    crisisPhases.value = []
  } finally {
    loading.value = false
  }
}

function applyChartPointSelection() {
  if (!props.chartPoint || !phases.value.length) return
  const index = findPhaseIndexFromChartPoint(phases.value, props.chartPoint)
  if (index >= 0) currentIndex.value = index
}

onMounted(loadCrisisAssaultData)

watch(
  () => props.mode,
  () => {
    currentIndex.value = 0
    showPicker.value = false
    loadCrisisAssaultData()
  },
)

watch(
  () => props.chartPoint,
  () => {
    applyChartPointSelection()
  },
)

watch(phases, () => {
  applyChartPointSelection()
})

function prevPhase() {
  if (currentIndex.value > 0) currentIndex.value--
}

function nextPhase() {
  if (currentIndex.value < phases.value.length - 1) currentIndex.value++
}

function onNavZoneClick(direction: 'prev' | 'next') {
  if (direction === 'prev') prevPhase()
  else nextPhase()
}

function selectPhase(index: number) {
  currentIndex.value = index
  showPicker.value = false
}

function openPhasePicker() {
  showPicker.value = true
}

function closePhasePicker() {
  showPicker.value = false
}

function onPickerPointerDown(event: PointerEvent) {
  if (!pickerScrollRef.value || event.button !== 0) return
  isPickerDragging.value = true
  pickerDragMoved.value = false
  pickerDragStartY.value = event.clientY
  pickerDragScrollTop.value = pickerScrollRef.value.scrollTop
}

function onPickerPointerMove(event: PointerEvent) {
  if (!isPickerDragging.value || !pickerScrollRef.value) return
  const deltaY = event.clientY - pickerDragStartY.value
  if (Math.abs(deltaY) <= 4) return

  if (!pickerDragMoved.value) {
    pickerDragMoved.value = true
    pickerScrollRef.value.setPointerCapture(event.pointerId)
  }
  pickerScrollRef.value.scrollTop = pickerDragScrollTop.value - deltaY
}

function onPickerPointerUp(event: PointerEvent) {
  if (!pickerScrollRef.value) return

  const wasDrag = pickerDragMoved.value

  isPickerDragging.value = false
  if (pickerScrollRef.value.hasPointerCapture(event.pointerId)) {
    pickerScrollRef.value.releasePointerCapture(event.pointerId)
  }

  if (!wasDrag) {
    const card = (event.target as HTMLElement).closest('.phase-card') as HTMLElement | null
    if (card) {
      const index = Number(card.dataset.index)
      if (!Number.isNaN(index)) selectPhase(index)
    }
  }

  pickerDragMoved.value = false
}

function onPickerWheel(event: WheelEvent) {
  if (!pickerScrollRef.value) return
  event.preventDefault()
  pickerScrollRef.value.scrollTop += event.deltaY
}
</script>

<template>
  <div class="history-panel-wrapper" :class="{ 'history-panel-wrapper--embedded': embedded }">
    <div
      v-if="currentPhase && !loading && !embedded"
      class="nav-zone nav-zone--left"
      :class="{ 'nav-zone--disabled': currentIndex === 0 }"
      role="button"
      aria-label="上一期"
      tabindex="0"
      @click="onNavZoneClick('prev')"
      @keydown.enter="onNavZoneClick('prev')"
      @keydown.space.prevent="onNavZoneClick('prev')"
    />

    <div class="history-panel" :class="{ 'history-panel--embedded': embedded }">
      <header class="panel-header">
        <h1 v-if="!embedded" class="page-title">{{ pageTitle }}</h1>

        <p v-if="loading" class="status-text">加载中...</p>
        <p v-else-if="loadError" class="status-text error">{{ loadError }}</p>

        <template v-else-if="currentPhase">
          <div v-if="!embedded" class="mobile-phase-stepper">
            <button
              type="button"
              class="mobile-step-btn"
              :disabled="currentIndex === 0"
              @click="prevPhase"
            >
              上一期
            </button>
            <button type="button" class="mobile-step-btn mobile-step-btn--primary" @click="openPhasePicker">
              选期
            </button>
            <button
              type="button"
              class="mobile-step-btn"
              :disabled="currentIndex >= phases.length - 1"
              @click="nextPhase"
            >
              下一期
            </button>
          </div>

          <div class="header-info-row">
            <div class="phase-selector">
              <button type="button" class="phase-btn" @click="openPhasePicker">
                <span class="phase-version">
                  {{ currentPhase.version }} {{ currentPhase.phase }}
                  <span v-if="currentPhase.isHidden" class="phase-hidden-badge">未公开</span>
                </span>
                <span class="phase-date">{{ currentPhase.dateRange }}</span>
                <span class="phase-id">ID: {{ currentPhase.tid }}</span>
              </button>
            </div>

            <div class="hp-summary">
              <span class="hp-label">总血量</span>
              <div class="hp-metrics">
                <div class="hp-metric-row">
                  <span class="hp-tag">HP</span>
                  <span class="hp-number">{{ currentPhase.rawHp }}</span>
                  <span v-if="phaseTotalHpComparison?.expansion" class="hp-expansion">
                    {{ phaseTotalHpComparison.expansion }}
                  </span>
                </div>
                <div v-if="phaseTotalHpComparison" class="hp-metric-row">
                  <span class="hp-tag hp-tag--ghost" aria-hidden="true">HP</span>
                  <span class="hp-delta">{{ formatHpDelta(phaseTotalHpComparison.diff) }}</span>
                </div>
                <div v-if="showConvertedTotalHp" class="hp-metric-row">
                  <span class="hp-tag hp-tag--converted">953</span>
                  <span class="hp-number">{{ currentPhase.rawHpConverted953 }}</span>
                </div>
                <div v-if="phaseFsHp" class="hp-metric-row hp-metric-row--score">
                  <span class="hp-tag hp-tag--fs">FS</span>
                  <span class="hp-number">{{ formatHp(phaseFsHp.hp) }}</span>
                  <span class="hp-score-hint">2万满星S</span>
                </div>
                <div
                  v-if="phaseFsHp?.converted != null && showConvertedTotalHp"
                  class="hp-metric-row hp-metric-row--score"
                >
                  <span class="hp-tag hp-tag--converted">953</span>
                  <span class="hp-number">{{ formatHp(phaseFsHp.converted) }}</span>
                  <span class="hp-score-hint">FS-HP</span>
                </div>
              </div>
            </div>

            <div v-if="showHardTotalHp" class="hp-summary hp-summary--hard">
              <span class="hp-label">困难总血量</span>
              <div class="hp-metrics">
                <div class="hp-metric-row">
                  <span class="hp-tag hp-tag--hard">H-HP</span>
                  <span class="hp-number">{{ currentPhase.rawHardHp }}</span>
                  <span v-if="phaseHardTotalHpComparison?.expansion" class="hp-expansion">
                    {{ phaseHardTotalHpComparison.expansion }}
                  </span>
                </div>
                <div v-if="phaseHardTotalHpComparison" class="hp-metric-row">
                  <span class="hp-tag hp-tag--ghost" aria-hidden="true">H-HP</span>
                  <span class="hp-delta">{{ formatHpDelta(phaseHardTotalHpComparison.diff) }}</span>
                </div>
                <div v-if="showConvertedHardTotalHp" class="hp-metric-row">
                  <span class="hp-tag hp-tag--converted">953</span>
                  <span class="hp-number">{{ currentPhase.rawHardHpConverted953 }}</span>
                </div>
                <div
                  v-for="item in phaseHardScoreHps"
                  :key="item.id"
                  class="hp-metric-row hp-metric-row--score"
                >
                  <span class="hp-tag hp-tag--star" :style="{ color: item.color }">{{ item.shortLabel }}</span>
                  <span class="hp-number">{{ formatHp(item.hp) }}</span>
                </div>
                <template v-if="showConvertedHardTotalHp">
                  <div
                    v-for="item in phaseHardScoreHps"
                    :key="`953-${item.id}`"
                    class="hp-metric-row hp-metric-row--score"
                  >
                    <span class="hp-tag hp-tag--converted">953</span>
                    <span class="hp-number">{{ formatHp(item.converted ?? 0) }}</span>
                    <span class="hp-score-hint">{{ item.shortLabel }}</span>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <Teleport to="body">
            <div
              v-if="showPicker"
              class="phase-modal-overlay"
              @click.self="closePhasePicker"
            >
              <div class="phase-modal">
                <button
                  type="button"
                  class="phase-modal-close"
                  aria-label="关闭"
                  @click="closePhasePicker"
                >
                  ×
                </button>
                <h2 class="phase-modal-title">{{ pageTitle }}</h2>
                <div
                  ref="pickerScrollRef"
                  class="phase-grid-scroll"
                  :class="{ 'is-dragging': isPickerDragging }"
                  @pointerdown="onPickerPointerDown"
                  @pointermove="onPickerPointerMove"
                  @pointerup="onPickerPointerUp"
                  @pointercancel="onPickerPointerUp"
                  @wheel="onPickerWheel"
                >
                  <div class="phase-grid">
                    <button
                      v-for="(phase, index) in phases"
                      :key="phase.id"
                      type="button"
                      class="phase-card"
                      :class="{ active: index === currentIndex, 'phase-card--hidden': phase.isHidden }"
                      :data-index="index"
                    >
                      <span class="phase-card-version">
                        {{ phase.version }} {{ phase.phase }}
                        <span v-if="phase.isHidden" class="phase-hidden-badge">未公开</span>
                      </span>
                      <span class="phase-card-date">{{ phase.dateRange }}</span>
                      <span class="phase-card-id">ID: {{ phase.tid }}</span>
                    </button>
                  </div>
                </div>
                <p class="phase-picker-hint">拖拽或滚轮上下浏览</p>
              </div>
            </div>
          </Teleport>
        </template>
      </header>

        <div v-if="currentPhase && !loading" class="content-grid" :class="{ 'content-grid--embedded': embedded }">
        <div class="buff-row">
          <article
            v-for="(buff, index) in currentPhase.buffs"
            :key="`${currentPhase.id}-buff-${index}`"
            class="buff-card"
          >
            <div v-if="buff.imageUrl" class="buff-image">
              <img :src="buff.imageUrl" :alt="buff.name" />
            </div>
            <div v-else class="buff-icon">{{ buff.icon }}</div>
            <h3 class="buff-name">{{ buff.name }}</h3>
            <ul class="buff-lines">
              <li v-for="(line, lineIndex) in buff.lines" :key="lineIndex">{{ line }}</li>
            </ul>
          </article>
        </div>

        <div class="enemy-row">
          <article
            v-for="(enemy, index) in currentPhase.enemies"
            :key="`${currentPhase.id}-enemy-${index}`"
            class="enemy-card"
            :class="{ 'enemy-card--hard': enemy.isHardRoom }"
          >
            <p class="enemy-label">{{ enemy.label }}</p>
            <div class="enemy-body">
              <div class="enemy-image">
                <img v-if="enemy.imageUrl" :src="enemy.imageUrl" :alt="enemy.label" />
                <span v-else class="image-placeholder">怪物图片</span>
              </div>
              <div class="enemy-info">
                <h3 v-if="enemy.bossName" class="enemy-name">{{ enemy.bossName }}</h3>
                <p v-else-if="enemy.subStats" class="enemy-stats">{{ enemy.subStats }}</p>
                <div class="enemy-hp-block">
                  <p class="enemy-hp-row">
                    <span class="enemy-hp-prefix">血量：</span>
                    <span class="enemy-hp-number">{{ enemy.hp }}</span>
                    <span
                      v-if="currentEnemyHpComparisons[index]?.expansion"
                      class="enemy-hp-expansion"
                    >
                      {{ currentEnemyHpComparisons[index]!.expansion }}
                    </span>
                  </p>
                  <p v-if="currentEnemyHpComparisons[index]" class="enemy-hp-row enemy-hp-row--diff">
                    <span class="enemy-hp-prefix enemy-hp-prefix--ghost" aria-hidden="true">血量：</span>
                    <span class="enemy-hp-delta">
                      {{ formatHpDelta(currentEnemyHpComparisons[index]!.diff) }}
                    </span>
                  </p>
                  <p
                    v-if="shouldShowConvertedEnemyHp(enemy)"
                    class="enemy-hp-row enemy-hp-row--meta enemy-hp-row--converted"
                  >
                    <span class="enemy-hp-prefix">953防御换算：</span>
                    <span class="enemy-hp-number">{{ enemy.hpConverted953 }}</span>
                  </p>
                  <p v-if="enemy.crisisBaseHp != null" class="enemy-hp-row enemy-hp-row--meta">
                    <span class="enemy-hp-prefix">基础血量：</span>
                    <span class="enemy-hp-number">{{ formatHp(enemy.crisisBaseHp) }}</span>
                  </p>
                  <p v-if="enemy.hpCoeffLabel" class="enemy-hp-row enemy-hp-row--meta">
                    <span class="enemy-hp-prefix">危局血量系数：</span>
                    <span class="enemy-hp-number">{{ enemy.hpCoeffLabel }}</span>
                    <span
                      v-if="currentEnemyHpCoeffComparisons[index]?.deltaLabel"
                      class="enemy-hp-expansion"
                    >
                      {{ currentEnemyHpCoeffComparisons[index]!.deltaLabel }}
                    </span>
                  </p>
                </div>
                <p v-if="enemy.defense !== undefined" class="enemy-defense">防御：{{ enemy.defense }}</p>
                <p v-if="enemy.weakness" class="enemy-weakness">弱点：{{ enemy.weakness }}</p>
                <p v-if="enemy.resistance" class="enemy-resistance">抗性：{{ enemy.resistance }}</p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>

    <div
      v-if="currentPhase && !loading && !embedded"
      class="nav-zone nav-zone--right"
      :class="{ 'nav-zone--disabled': currentIndex === phases.length - 1 }"
      role="button"
      aria-label="下一期"
      tabindex="0"
      @click="onNavZoneClick('next')"
      @keydown.enter="onNavZoneClick('next')"
      @keydown.space.prevent="onNavZoneClick('next')"
    />
  </div>
</template>

<style scoped>
.history-panel-wrapper {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 100%;
  height: auto;
  overflow: visible;
}

.history-panel-wrapper::-webkit-scrollbar {
  display: none;
}

.history-panel {
  flex: 1;
  min-width: 0;
  max-width: min(1440px, 100%);
  margin: 0 auto;
  padding: clamp(0.75rem, 1.5vh, 1.5rem) 0.75rem clamp(1.25rem, 2.5vh, 2rem);
  box-sizing: border-box;
}

.history-panel-wrapper--embedded {
  flex: none;
  height: auto;
  min-height: 100%;
  overflow: visible;
}

.history-panel--embedded {
  display: flex;
  flex-direction: column;
  height: auto;
  min-height: 100%;
  max-width: none;
  padding: 0.65rem 1.25rem 0.85rem;
  overflow: visible;
}

.history-panel--embedded .panel-header {
  flex-shrink: 0;
  margin-bottom: 0.65rem;
  gap: 0.65rem;
}

.history-panel--embedded .header-info-row {
  max-width: none;
  gap: 0.75rem;
}

.history-panel--embedded .phase-btn {
  min-height: 76px;
  min-width: 240px;
  padding: 0.6rem 1rem;
}

.history-panel--embedded .hp-summary {
  min-height: 76px;
  max-width: 340px;
  padding: 0.6rem 1rem;
}

.content-grid--embedded {
  flex: none;
  min-height: 0;
  overflow: visible;
  display: grid;
  grid-template-rows: auto auto;
  gap: 0.6rem;
}

.content-grid--embedded .buff-row {
  min-height: 0;
  overflow: visible;
  gap: 0.65rem;
}

.content-grid--embedded .buff-card {
  min-height: 0;
  overflow: visible;
  padding: 0.55rem 0.65rem;
}

.content-grid--embedded .buff-image {
  width: 40px;
  height: 40px;
  margin-bottom: 0.25rem;
}

.content-grid--embedded .buff-name {
  font-size: 0.86rem;
  margin-bottom: 0.35rem;
}

.content-grid--embedded .buff-lines {
  font-size: clamp(0.62rem, 1.05vh, 0.72rem);
  line-height: 1.42;
  overflow: visible;
}

.content-grid--embedded .enemy-row {
  min-height: 0;
  overflow: visible;
  align-items: stretch;
  gap: 0.75rem;
}

.content-grid--embedded .enemy-card {
  height: auto;
  min-height: 0;
  overflow: visible;
  padding: 0.55rem 0.75rem 0.65rem;
}

.content-grid--embedded .enemy-card--hard {
  width: min(100%, 320px);
}

.content-grid--embedded .enemy-label {
  margin-bottom: 0.25rem;
  font-size: clamp(0.82rem, 1.4vh, 0.95rem);
}

.content-grid--embedded .enemy-body {
  flex: none;
  min-height: 0;
  align-items: center;
  gap: 0.55rem;
}

.content-grid--embedded .enemy-image {
  width: auto;
  height: auto;
  max-height: min(320px, 42vh);
  max-width: min(220px, 44%);
  aspect-ratio: 3 / 4;
}

.content-grid--embedded .enemy-name {
  font-size: clamp(0.82rem, 1.45vh, 0.98rem);
  padding: 0.28rem 0.65rem;
}

.content-grid--embedded .enemy-hp-prefix,
.content-grid--embedded .enemy-hp-number {
  font-size: clamp(0.88rem, 1.5vh, 1rem);
}

.content-grid--embedded .enemy-hp-row--meta .enemy-hp-prefix,
.content-grid--embedded .enemy-hp-row--meta .enemy-hp-number {
  font-size: clamp(0.72rem, 1.2vh, 0.84rem);
  font-weight: 600;
  color: var(--color-heading);
  opacity: 0.88;
}

.content-grid--embedded .enemy-hp-row--converted .enemy-hp-prefix,
.content-grid--embedded .enemy-hp-row--converted .enemy-hp-number {
  color: #4c8fe8;
  opacity: 1;
}

.content-grid--embedded .enemy-hp-delta,
.content-grid--embedded .enemy-hp-expansion {
  font-size: clamp(0.68rem, 1.15vh, 0.78rem);
}

.content-grid--embedded .enemy-defense,
.content-grid--embedded .enemy-weakness,
.content-grid--embedded .enemy-resistance {
  font-size: clamp(0.72rem, 1.2vh, 0.84rem);
  line-height: 1.35;
}

.content-grid--embedded .enemy-info {
  gap: 0.28rem;
  overflow: visible;
}

.nav-zone {
  flex: 1;
  min-width: 56px;
  max-width: 140px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.nav-zone:hover:not(.nav-zone--disabled) {
  background: color-mix(in srgb, var(--color-background-mute) 60%, transparent);
}

.nav-zone--disabled {
  cursor: default;
  pointer-events: none;
}

.nav-zone:focus-visible {
  outline: 2px solid var(--color-border);
  outline-offset: -2px;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
  margin-bottom: 1.25rem;
  position: relative;
}

.page-title {
  font-size: clamp(1.35rem, 3vw, 1.75rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
}

.phase-selector {
  display: flex;
  align-items: stretch;
  justify-content: center;
  flex: 1;
  min-width: 0;
}

.header-info-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 1rem;
  width: 100%;
  max-width: 1100px;
  flex-wrap: wrap;
}

.phase-btn {
  width: 100%;
  min-width: 240px;
  min-height: 88px;
  padding: 0.75rem 1.15rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  transition: background-color 0.2s;
}

.phase-btn:hover {
  background: var(--color-background-mute);
}

.phase-version {
  font-weight: 700;
  font-size: clamp(0.92rem, 1.8vw, 1.08rem);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: center;
}

.phase-hidden-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #f5c451;
  background: color-mix(in srgb, #f5c451 18%, transparent);
  border: 1px solid color-mix(in srgb, #f5c451 45%, transparent);
}

.phase-date,
.phase-id {
  font-size: clamp(0.72rem, 1.35vw, 0.82rem);
  opacity: 0.72;
}

.phase-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(4px);
}

.phase-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1120px, 96vw);
  max-height: min(90vh, 860px);
  padding: 2.75rem 1.75rem 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background);
  overflow: hidden;
}

.phase-grid-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  cursor: grab;
  touch-action: pan-y;
  scrollbar-width: none;
  padding-right: 0.15rem;
}

.phase-grid-scroll::-webkit-scrollbar {
  display: none;
}

.phase-grid-scroll.is-dragging {
  cursor: grabbing;
  user-select: none;
}

.phase-picker-hint {
  flex-shrink: 0;
  margin: 0.75rem 0 0;
  text-align: center;
  font-size: 0.74rem;
  color: var(--color-text);
  opacity: 0.55;
}

.phase-modal-close {
  position: absolute;
  top: 0.85rem;
  left: 0.85rem;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-heading);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.phase-modal-close:hover {
  background: var(--color-background-mute);
}

.phase-modal-title {
  margin: 0 0 1.35rem;
  text-align: center;
  font-size: clamp(1.55rem, 3.2vw, 2rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
}

.phase-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.85rem;
}

.phase-card {
  min-height: 102px;
  padding: 0.85rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  text-align: center;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.phase-card:hover,
.phase-card.active {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.phase-card--hidden {
  border-style: dashed;
  border-color: color-mix(in srgb, #f5c451 55%, var(--color-border));
}

.phase-card-version {
  font-size: 0.98rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.phase-card-date,
.phase-card-id {
  font-size: 0.74rem;
  opacity: 0.72;
  line-height: 1.35;
}

.hp-summary {
  flex: 1;
  min-width: 0;
  min-height: 88px;
  max-width: 320px;
  padding: 0.75rem 1.15rem;
  border-radius: 12px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.hp-summary--hard {
  border-color: color-mix(in srgb, #c084fc 45%, var(--color-border));
}

.hp-summary--hard .hp-label {
  color: #c084fc;
}

.hp-label {
  font-size: clamp(0.78rem, 1.5vw, 0.88rem);
  color: #e85d4c;
  font-weight: 700;
}

.hp-metrics {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  margin-top: 0.25rem;
  width: fit-content;
}

.hp-metric-row {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
}

.hp-number {
  font-size: clamp(0.88rem, 1.8vw, 1.05rem);
  color: var(--color-heading);
  font-weight: 600;
}

.hp-delta {
  font-size: clamp(0.66rem, 1.2vw, 0.74rem);
  color: #e85d4c;
  font-weight: 600;
  line-height: 1.4;
}

.hp-expansion {
  font-size: clamp(0.7rem, 1.3vw, 0.8rem);
  color: #4d9fff;
  font-weight: 600;
}

.hp-tag {
  flex-shrink: 0;
  min-width: 1.45rem;
  color: #e85d4c;
  font-weight: 600;
  font-size: clamp(0.88rem, 1.8vw, 1.02rem);
}

.hp-tag--ghost {
  visibility: hidden;
}

.hp-tag--converted {
  color: #4c8fe8;
}

.hp-tag--hard {
  color: #c084fc;
  font-size: clamp(0.72rem, 1.4vw, 0.82rem);
  min-width: 2.6rem;
}

.hp-tag--fs {
  color: #e8a838;
  font-size: clamp(0.72rem, 1.4vw, 0.82rem);
  min-width: 1.6rem;
}

.hp-tag--star {
  font-size: clamp(0.62rem, 1.2vw, 0.72rem);
  min-width: 2.4rem;
  font-weight: 700;
}

.hp-metric-row--score {
  margin-top: 0.12rem;
}

.hp-score-hint {
  font-size: clamp(0.62rem, 1.15vw, 0.7rem);
  opacity: 0.68;
  color: var(--color-text);
}

.status-text {
  font-size: 0.9rem;
  opacity: 0.75;
}

.status-text.error {
  color: #e85d4c;
  opacity: 1;
}

.content-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.buff-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  align-items: stretch;
}

.enemy-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
  align-items: start;
}

.enemy-card--hard {
  grid-column: 1 / -1;
  width: min(100%, 360px);
  justify-self: center;
}

.buff-card {
  height: 100%;
  padding: 0.75rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
}

.buff-icon {
  font-size: 1.05rem;
  margin-bottom: 0.25rem;
  align-self: center;
  text-align: center;
}

.buff-image {
  width: 40px;
  height: 40px;
  margin: 0 auto 0.3rem;
}

.buff-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.buff-name {
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 0.4rem;
  text-align: center;
  width: 100%;
}

.buff-lines {
  list-style: disc;
  padding-left: 1rem;
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--color-text);
  flex: 1;
}

.enemy-card {
  display: flex;
  flex-direction: column;
  padding: 0.75rem 0.85rem 0.9rem;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.enemy-label {
  flex-shrink: 0;
  margin: 0 0 0.25rem;
  text-align: center;
  font-size: clamp(0.8rem, 1.5vw, 0.92rem);
  font-weight: 700;
  color: #e8a838;
}

.enemy-body {
  display: flex;
  align-items: flex-start;
  gap: clamp(0.75rem, 2vw, 1.15rem);
}

.enemy-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0.45rem;
  text-align: left;
  padding-top: 0.15rem;
}

.enemy-name {
  margin: 0;
  padding: 0.28rem 0.7rem;
  max-width: 100%;
  font-size: clamp(0.82rem, 1.55vw, 0.95rem);
  font-weight: 700;
  line-height: 1.35;
  letter-spacing: 0.03em;
  color: #f0c060;
  text-shadow: 0 0 12px rgba(232, 168, 56, 0.35);
  border: 1px solid rgba(232, 168, 56, 0.45);
  border-radius: 999px;
  background: linear-gradient(
    180deg,
    rgba(232, 168, 56, 0.16) 0%,
    rgba(232, 168, 56, 0.05) 100%
  );
}

[data-theme='dark'] .enemy-name {
  color: #ffd98a;
  text-shadow: 0 0 14px rgba(255, 217, 138, 0.28);
  background: linear-gradient(
    180deg,
    rgba(255, 217, 138, 0.12) 0%,
    rgba(255, 217, 138, 0.03) 100%
  );
}

.enemy-stats {
  margin: 0;
  font-size: 0.74rem;
  opacity: 0.75;
}

.enemy-image {
  flex-shrink: 0;
  width: clamp(120px, 38%, 260px);
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-background-mute);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.enemy-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-placeholder {
  font-size: 0.85rem;
  opacity: 0.45;
  padding: 0.5rem;
  text-align: center;
}

.enemy-hp-block {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.enemy-hp-row {
  display: flex;
  align-items: baseline;
  gap: 0;
  margin: 0;
}

.enemy-hp-prefix {
  flex-shrink: 0;
  min-width: 2.6rem;
  font-size: clamp(0.84rem, 1.6vw, 0.95rem);
  font-weight: 700;
  color: #e85d4c;
}

.enemy-hp-prefix--ghost {
  visibility: hidden;
}

.enemy-hp-row--meta .enemy-hp-prefix,
.enemy-hp-row--meta .enemy-hp-number {
  font-size: clamp(0.74rem, 1.35vw, 0.84rem);
  font-weight: 600;
  color: var(--color-heading);
  opacity: 0.88;
  min-width: 0;
}

.enemy-hp-row--converted .enemy-hp-prefix,
.enemy-hp-row--converted .enemy-hp-number {
  color: #4c8fe8;
  opacity: 1;
}

.enemy-hp-number {
  font-size: clamp(0.84rem, 1.6vw, 0.95rem);
  font-weight: 700;
  color: #e85d4c;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.enemy-hp-delta {
  font-size: clamp(0.66rem, 1.2vw, 0.74rem);
  font-weight: 600;
  color: #e85d4c;
  line-height: 1.4;
  min-width: 0;
  overflow-wrap: anywhere;
}

.enemy-hp-expansion {
  margin-left: 0.3rem;
  font-size: clamp(0.7rem, 1.3vw, 0.8rem);
  font-weight: 600;
  color: #4d9fff;
  white-space: nowrap;
}

.enemy-defense,
.enemy-weakness,
.enemy-resistance {
  margin: 0;
  font-size: clamp(0.74rem, 1.35vw, 0.84rem);
  color: var(--color-heading);
  opacity: 0.88;
  line-height: 1.4;
}

@media (max-width: 1100px) {
  .enemy-row {
    grid-template-columns: 1fr;
  }

  .enemy-image {
    width: clamp(140px, 42vw, 220px);
  }
}

@media (max-height: 820px) {
  .history-panel {
    padding-top: 0.65rem;
    padding-bottom: 1rem;
  }

  .enemy-image {
    width: clamp(100px, 28%, 180px);
  }
}

.mobile-phase-stepper {
  display: none;
}

@media (max-width: 768px) {
  .history-panel-wrapper {
    min-height: auto;
  }

  .nav-zone {
    display: none;
  }

  .mobile-phase-stepper {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 0.45rem;
    width: 100%;
    max-width: 420px;
  }

  .mobile-step-btn {
    min-height: 2.4rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-background);
    color: var(--color-heading);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mobile-step-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .mobile-step-btn--primary {
    border-color: color-mix(in srgb, #e8a838 55%, var(--color-border));
    background: color-mix(in srgb, #e8a838 14%, var(--color-background));
  }

  .page-title {
    font-size: 1.2rem;
  }

  .panel-header {
    gap: 0.65rem;
    margin-bottom: 0.85rem;
  }

  .buff-row,
  .enemy-row {
    grid-template-columns: 1fr;
    gap: 0.65rem;
  }

  .enemy-body {
    flex-direction: column;
    align-items: center;
  }

  .enemy-info {
    width: 100%;
    align-items: center;
    text-align: center;
  }

  .enemy-image {
    width: min(200px, 58vw);
  }

  .enemy-name {
    margin-inline: auto;
  }

  .phase-btn {
    min-width: 0;
    min-height: 72px;
    padding: 0.65rem 0.85rem;
  }

  .header-info-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 100%;
    gap: 0.55rem;
  }

  .hp-summary {
    width: 100%;
    max-width: 100%;
    min-height: 72px;
  }

  .buff-lines {
    font-size: 0.68rem;
  }

  .phase-modal {
    width: min(100vw - 1rem, 1120px);
    max-height: min(88dvh, 860px);
    padding: 2.1rem 0.85rem 0.85rem;
  }

  .phase-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 0.45rem;
  }

  .phase-card {
    padding: 0.55rem 0.4rem;
  }

  .phase-card-version {
    font-size: 0.82rem;
  }

  .phase-card-date,
  .phase-card-id {
    font-size: 0.66rem;
  }

  /* 图表点开的嵌入详细：允许竖向滚动，避免被裁切 */
  .history-panel-wrapper--embedded {
    height: auto;
    overflow: visible;
  }

  .history-panel--embedded {
    height: auto;
    overflow: visible;
    padding: 0.45rem 0.55rem 0.85rem;
  }

  .history-panel--embedded .panel-header {
    margin-bottom: 0.55rem;
    gap: 0.5rem;
  }

  .history-panel--embedded .header-info-row {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }

  .history-panel--embedded .phase-btn {
    min-width: 0;
    width: 100%;
    min-height: 64px;
  }

  .history-panel--embedded .hp-summary {
    max-width: 100%;
    width: 100%;
    min-height: 64px;
  }

  .content-grid--embedded {
    display: flex;
    flex-direction: column;
    height: auto;
    overflow: visible;
    gap: 0.75rem;
  }

  .content-grid--embedded .buff-row,
  .content-grid--embedded .enemy-row {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .content-grid--embedded .buff-card,
  .content-grid--embedded .enemy-card {
    height: auto;
    overflow: visible;
  }

  .content-grid--embedded .buff-lines {
    overflow: visible;
    font-size: 0.68rem;
  }

  .content-grid--embedded .enemy-body {
    flex-direction: column;
    align-items: center;
  }

  .content-grid--embedded .enemy-info {
    width: 100%;
    align-items: center;
    text-align: center;
    overflow: visible;
  }

  .content-grid--embedded .enemy-image {
    width: min(180px, 52vw);
    max-width: min(180px, 52vw);
    height: auto;
  }
}
</style>
