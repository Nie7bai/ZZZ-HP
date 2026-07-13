<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { fetchCrisisAssaultPhases, findPhaseIndexFromChartPoint, type HpChartPoint } from '@/api/crisisAssault'
import { historyData } from '@/data/historyData'
import { modeTitles, type ModeKey, type PhaseData } from '@/types/history'
import { formatHpDelta, formatHpExpansionPercent, parseHpString } from '@/utils/gameData'

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

const currentEnemyHpComparisons = computed(() => {
  const phase = currentPhase.value
  if (!phase) return []

  return phase.enemies.map((enemy) =>
    getBossHpComparison(enemy.bossName, enemy.hpValue, enemy.hp),
  )
})

async function loadCrisisAssaultData() {
  if (props.mode !== 'crisis-assault') return

  loading.value = true
  loadError.value = ''
  try {
    crisisPhases.value = await fetchCrisisAssaultPhases()
    if (props.chartPoint) {
      applyChartPointSelection()
    } else {
      currentIndex.value = 0
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
          <div class="header-info-row">
            <div class="phase-selector">
              <button type="button" class="phase-btn" @click="openPhasePicker">
                <span class="phase-version">{{ currentPhase.version }} {{ currentPhase.phase }}</span>
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
                      :class="{ active: index === currentIndex }"
                      :data-index="index"
                    >
                      <span class="phase-card-version">{{ phase.version }} {{ phase.phase }}</span>
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
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.history-panel-wrapper::-webkit-scrollbar {
  display: none;
}

.history-panel {
  flex: 1;
  min-width: 0;
  max-width: min(1440px, 100%);
  margin: 0 auto;
  padding: 1.5rem 0.75rem 2rem;
}

.history-panel-wrapper--embedded {
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.history-panel--embedded {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  max-width: none;
  padding: 0.65rem 1.25rem 0.85rem;
  overflow: hidden;
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
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: minmax(0, 0.4fr) minmax(0, 0.6fr);
  gap: 0.6rem;
}

.content-grid--embedded .buff-row {
  min-height: 0;
  overflow: hidden;
  gap: 0.65rem;
}

.content-grid--embedded .buff-card {
  min-height: 0;
  overflow: hidden;
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
  overflow: hidden;
}

.content-grid--embedded .enemy-row {
  min-height: 0;
  overflow: hidden;
  align-items: stretch;
  gap: 0.75rem;
}

.content-grid--embedded .enemy-card {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 0.55rem 0.75rem 0.65rem;
}

.content-grid--embedded .enemy-label {
  margin-bottom: 0.25rem;
  font-size: clamp(0.82rem, 1.4vh, 0.95rem);
}

.content-grid--embedded .enemy-body {
  flex: 1;
  min-height: 0;
  align-items: center;
  gap: 0.55rem;
}

.content-grid--embedded .enemy-image {
  width: auto;
  height: min(100%, 26vh);
  max-width: 44%;
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
  overflow: hidden;
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
  gap: 1.25rem;
  margin-bottom: 2rem;
  position: relative;
}

.page-title {
  font-size: clamp(1.75rem, 4vw, 2.25rem);
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
  max-width: 900px;
}

.phase-btn {
  width: 100%;
  min-width: 280px;
  min-height: 108px;
  padding: 1rem 1.5rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  transition: background-color 0.2s;
}

.phase-btn:hover {
  background: var(--color-background-mute);
}

.phase-version {
  font-weight: 700;
  font-size: clamp(1.05rem, 2.2vw, 1.25rem);
}

.phase-date,
.phase-id {
  font-size: clamp(0.82rem, 1.6vw, 0.92rem);
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

.phase-card-version {
  font-size: 0.98rem;
  font-weight: 700;
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
  min-height: 108px;
  max-width: 360px;
  padding: 1rem 1.5rem;
  border-radius: 12px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.hp-label {
  font-size: clamp(0.9rem, 1.8vw, 1rem);
  color: #e85d4c;
  font-weight: 700;
}

.hp-metrics {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  margin-top: 0.35rem;
  width: fit-content;
}

.hp-metric-row {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}

.hp-number {
  font-size: clamp(1rem, 2.2vw, 1.2rem);
  color: var(--color-heading);
  font-weight: 600;
}

.hp-delta {
  font-size: clamp(0.72rem, 1.4vw, 0.82rem);
  color: #e85d4c;
  font-weight: 600;
  line-height: 1.4;
}

.hp-expansion {
  font-size: clamp(0.78rem, 1.5vw, 0.9rem);
  color: #4d9fff;
  font-weight: 600;
}

.hp-tag {
  flex-shrink: 0;
  min-width: 1.65rem;
  color: #e85d4c;
  font-weight: 600;
  font-size: clamp(1rem, 2.2vw, 1.2rem);
}

.hp-tag--ghost {
  visibility: hidden;
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
  gap: 1rem;
}

.buff-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  align-items: stretch;
}

.enemy-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.25rem;
  align-items: start;
}

.buff-card {
  height: 100%;
  padding: 1rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
}

.buff-icon {
  font-size: 1.25rem;
  margin-bottom: 0.35rem;
  align-self: center;
  text-align: center;
}

.buff-image {
  width: 48px;
  height: 48px;
  margin: 0 auto 0.35rem;
}

.buff-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.buff-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-heading);
  margin-bottom: 0.5rem;
  text-align: center;
  width: 100%;
}

.buff-lines {
  list-style: disc;
  padding-left: 1.1rem;
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--color-text);
  flex: 1;
}

.enemy-card {
  display: flex;
  flex-direction: column;
  padding: 1rem 1.1rem 1.25rem;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.enemy-label {
  flex-shrink: 0;
  margin: 0 0 0.35rem;
  text-align: center;
  font-size: clamp(0.92rem, 1.8vw, 1.08rem);
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
  padding: 0.4rem 0.85rem;
  max-width: 100%;
  font-size: clamp(0.95rem, 1.9vw, 1.12rem);
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
  font-size: 0.82rem;
  opacity: 0.75;
}

.enemy-image {
  flex-shrink: 0;
  width: clamp(158px, 52%, 300px);
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
  min-width: 3rem;
  font-size: clamp(1rem, 2vw, 1.15rem);
  font-weight: 700;
  color: #e85d4c;
}

.enemy-hp-prefix--ghost {
  visibility: hidden;
}

.enemy-hp-number {
  font-size: clamp(1rem, 2vw, 1.15rem);
  font-weight: 700;
  color: #e85d4c;
}

.enemy-hp-delta {
  font-size: clamp(0.72rem, 1.4vw, 0.82rem);
  font-weight: 600;
  color: #e85d4c;
  line-height: 1.4;
}

.enemy-hp-expansion {
  margin-left: 0.35rem;
  font-size: clamp(0.78rem, 1.5vw, 0.9rem);
  font-weight: 600;
  color: #4d9fff;
}

.enemy-defense,
.enemy-weakness,
.enemy-resistance {
  margin: 0;
  font-size: clamp(0.84rem, 1.6vw, 0.95rem);
  color: var(--color-heading);
  opacity: 0.88;
  line-height: 1.45;
}

@media (max-width: 768px) {
  .history-panel-wrapper {
    min-height: auto;
  }

  .nav-zone {
    min-width: 32px;
    max-width: 48px;
  }

  .buff-row,
  .enemy-row {
    grid-template-columns: 1fr;
  }

  .enemy-image {
    width: clamp(140px, 52vw, 220px);
  }

  .phase-btn {
    min-width: 0;
    min-height: 96px;
    padding: 0.85rem 1rem;
  }

  .header-info-row {
    flex-direction: column;
    align-items: center;
    max-width: 100%;
  }

  .hp-summary {
    width: 100%;
    max-width: 100%;
    min-height: 96px;
  }

  .phase-modal {
    padding: 2.25rem 1rem 1rem;
  }

  .phase-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
