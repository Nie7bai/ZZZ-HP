<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { HpChartPoint } from '@/api/crisisAssault'
import { fetchDefenseSeasons } from '@/api/defense'
import type { DefenseEnemy, DefenseSeason, DefenseVariant } from '@/types/defense'
import {
  buildDefenseRoomHpOptions,
  findDefenseEnemyHpComparison,
  findDefenseRoomHpComparison,
  formatDefenseRoomHpTitle,
} from '@/utils/defenseHp'
import { findDefenseSeasonIndexFromChartPoint } from '@/utils/defenseCompare'
import { formatHpDelta } from '@/utils/gameData'

const props = defineProps<{
  embedded?: boolean
  chartPoint?: HpChartPoint | null
}>()

const route = useRoute()

const defenseVariant = computed<DefenseVariant>(() =>
  route.name === 'defense-new' ? 'new' : 'old',
)

const seasons = ref<DefenseSeason[]>([])
const loading = ref(false)
const loadError = ref('')
const currentIndex = ref(0)
const roomHpIndex = ref(0)
const showPicker = ref(false)

async function loadSeasons() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await fetchDefenseSeasons(defenseVariant.value)
    seasons.value = data
    if (props.chartPoint) {
      applyChartPointSelection()
    } else {
      currentIndex.value = Math.max(data.length - 1, 0)
    }
    roomHpIndex.value = 0
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    seasons.value = []
    currentIndex.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(loadSeasons)

watch(defenseVariant, () => {
  loadSeasons()
})

function applyChartPointSelection() {
  if (!props.chartPoint || !seasons.value.length) return
  const index = findDefenseSeasonIndexFromChartPoint(seasons.value, props.chartPoint)
  if (index >= 0) currentIndex.value = index
}

watch(
  () => props.chartPoint,
  () => {
    applyChartPointSelection()
  },
)

const currentSeason = computed(() => seasons.value[currentIndex.value])

const roomHpOptions = computed(() => {
  if (!currentSeason.value) return []
  return buildDefenseRoomHpOptions(currentSeason.value)
})

const currentRoomHpOption = computed(() => {
  const options = roomHpOptions.value
  if (!options.length) return null
  const safeIndex = Math.min(Math.max(roomHpIndex.value, 0), options.length - 1)
  return options[safeIndex] ?? options[0]!
})

watch(currentIndex, () => {
  roomHpIndex.value = 0
})

watch(roomHpOptions, (options) => {
  if (roomHpIndex.value > options.length - 1) {
    roomHpIndex.value = 0
  }
})

const pageTitle = computed(() =>
  defenseVariant.value === 'new' ? '新·式舆防卫战' : '旧·式舆防卫战',
)

const roomHpComparison = computed(() => {
  const currentOption = currentRoomHpOption.value
  if (!currentOption) return null

  return findDefenseRoomHpComparison(seasons.value, currentIndex.value, currentOption)
})

function getEnemyHpComparison(enemy: DefenseEnemy) {
  return findDefenseEnemyHpComparison(seasons.value, currentIndex.value, enemy)
}

function prevRoomHp() {
  if (roomHpIndex.value > 0) roomHpIndex.value--
}

function nextRoomHp() {
  if (roomHpIndex.value < roomHpOptions.value.length - 1) roomHpIndex.value++
}

function prevSeason() {
  if (currentIndex.value > 0) currentIndex.value--
}

function nextSeason() {
  if (currentIndex.value < seasons.value.length - 1) currentIndex.value++
}

function onNavZoneClick(direction: 'prev' | 'next') {
  if (direction === 'prev') prevSeason()
  else nextSeason()
}

function selectSeason(index: number) {
  currentIndex.value = index
  showPicker.value = false
}

function filterMeaningfulResistanceTraits(items: string[]) {
  return items.filter((item) => {
    const trimmed = item.trim()
    return trimmed && trimmed !== '无'
  })
}

function formatWeaknessText(items: string[]) {
  return items.filter(Boolean).join('、')
}

function formatResistanceTraitText(items: string[]) {
  return filterMeaningfulResistanceTraits(items).join('、')
}

function formatEnemyResistance(value?: string) {
  if (!value?.trim() || value.trim() === '无') return ''
  return filterMeaningfulResistanceTraits(
    value.split(/[、,，]/).map((item) => item.trim()),
  ).join('、')
}
</script>

<template>
  <div class="defense-panel-wrapper" :class="{ 'defense-panel-wrapper--embedded': embedded }">
    <p v-if="loading" class="defense-status">加载中...</p>
    <p v-else-if="loadError" class="defense-status defense-status--error">{{ loadError }}</p>
    <p v-else-if="!currentSeason" class="defense-status">暂无式舆防卫战数据</p>

    <div
      v-if="currentSeason && !embedded"
      class="nav-zone nav-zone--left"
      :class="{ 'nav-zone--disabled': currentIndex === 0 }"
      role="button"
      aria-label="上一期"
      tabindex="0"
      @click="onNavZoneClick('prev')"
      @keydown.enter="onNavZoneClick('prev')"
      @keydown.space.prevent="onNavZoneClick('prev')"
    />

    <div class="defense-panel" :class="{ 'defense-panel--embedded': embedded }">
      <header class="panel-header">
        <h1 v-if="!embedded" class="page-title">{{ pageTitle }}</h1>

        <template v-if="currentSeason">
          <div class="header-info-row">
            <div class="phase-selector">
              <button type="button" class="phase-btn" @click="showPicker = true">
                <span class="phase-version">{{ currentSeason.version }} {{ currentSeason.phase }}</span>
                <span class="phase-date">{{ currentSeason.dateRange }}</span>
                <span class="phase-id">ID: {{ currentSeason.seasonId }} · {{ currentSeason.nodeType }}</span>
              </button>
            </div>

            <div v-if="currentRoomHpOption" class="hp-summary">
              <div class="hp-room-nav">
                <button
                  type="button"
                  class="hp-room-btn"
                  :disabled="roomHpIndex === 0"
                  aria-label="上一项"
                  @click="prevRoomHp"
                >
                  ‹
                </button>
                <div class="hp-room-label">
                  <span class="hp-room-title">{{ currentRoomHpOption.title }}</span>
                  <span v-if="currentRoomHpOption.subtitle" class="hp-room-subtitle">
                    {{ currentRoomHpOption.subtitle }}
                  </span>
                  <span class="hp-room-index">{{ roomHpIndex + 1 }} / {{ roomHpOptions.length }}</span>
                </div>
                <button
                  type="button"
                  class="hp-room-btn"
                  :disabled="roomHpIndex >= roomHpOptions.length - 1"
                  aria-label="下一项"
                  @click="nextRoomHp"
                >
                  ›
                </button>
              </div>

              <span class="hp-label">总血量</span>
              <div class="hp-metrics">
                <div class="hp-metric-row">
                  <span class="hp-tag">Raw</span>
                  <span class="hp-number">{{ currentRoomHpOption.rawHpText }}</span>
                  <span v-if="roomHpComparison?.expansion" class="hp-expansion">
                    {{ roomHpComparison.expansion }}
                  </span>
                </div>
                <div v-if="roomHpComparison" class="hp-metric-row">
                  <span class="hp-tag hp-tag--ghost" aria-hidden="true">Raw</span>
                  <span class="hp-delta">{{ formatHpDelta(roomHpComparison.diff) }}</span>
                </div>
              </div>
            </div>
          </div>

          <Teleport to="body">
            <div v-if="showPicker" class="phase-modal-overlay" @click.self="showPicker = false">
              <div class="phase-modal">
                <button
                  type="button"
                  class="phase-modal-close"
                  aria-label="关闭"
                  @click="showPicker = false"
                >
                  ×
                </button>
                <h2 class="phase-modal-title">{{ pageTitle }}</h2>
                <div class="phase-grid-scroll">
                  <div class="phase-grid">
                    <button
                      v-for="(season, index) in seasons"
                      :key="season.id"
                      type="button"
                      class="phase-card"
                      :class="{ active: index === currentIndex }"
                      @click="selectSeason(index)"
                    >
                      <span class="phase-card-version">{{ season.version }} {{ season.phase }}</span>
                      <span class="phase-card-date">{{ season.dateRange }}</span>
                      <span class="phase-card-id">ID: {{ season.seasonId }}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Teleport>
        </template>
      </header>

      <div v-if="currentSeason" class="frontier-scroll">
        <section
          v-for="frontier in currentSeason.frontiers"
          :key="frontier.id"
          class="frontier-section"
        >
          <header class="frontier-header">
            <div class="frontier-title-wrap">
              <h2 class="frontier-title">{{ frontier.title }}</h2>
              <p class="frontier-meta">Lv.{{ frontier.level }} · ID {{ frontier.id }}</p>
            </div>
          </header>

          <div class="room-list">
            <article
              v-for="room in frontier.rooms"
              :key="room.id"
              class="room-card"
            >
              <header class="room-card-header">
                <div>
                  <h3 class="room-title">{{ formatDefenseRoomHpTitle(frontier.title, room.label) }}</h3>
                  <p class="room-meta">Lv.{{ room.level }} · ID {{ room.id }}</p>
                </div>
                <div v-if="room.rankRequirements" class="rank-block">
                  <p class="rank-line">S: {{ room.rankRequirements.s }}</p>
                  <p class="rank-line">A: {{ room.rankRequirements.a }}</p>
                  <p class="rank-line">B: {{ room.rankRequirements.b }}</p>
                </div>
              </header>

              <div
                v-if="room.roomBuff.name || room.roomBuff.lines.length"
                class="room-buff-section"
              >
                <p class="block-label">关卡增益</p>
                <div class="room-buff-card">
                  <h4 v-if="room.roomBuff.name" class="buff-name">{{ room.roomBuff.name }}</h4>
                  <ul v-if="room.roomBuff.lines.length" class="buff-lines">
                    <li v-for="(line, index) in room.roomBuff.lines" :key="index">{{ line }}</li>
                  </ul>
                </div>
              </div>

              <section
                v-for="battleRoom in room.battleRooms"
                :key="battleRoom.id"
                class="battle-room"
              >
                <header class="battle-room-header">
                  <div>
                    <h4 class="battle-room-title">{{ battleRoom.label }}</h4>
                    <p class="battle-room-meta">波次 {{ battleRoom.waveCount }}</p>
                  </div>
                  <div
                    v-if="
                      battleRoom.weakness.length ||
                      filterMeaningfulResistanceTraits(battleRoom.resistance ?? []).length
                    "
                    class="trait-row"
                  >
                    <p v-if="battleRoom.weakness.length" class="trait-line">
                      <span class="trait-label">弱点</span>
                      {{ formatWeaknessText(battleRoom.weakness) }}
                    </p>
                    <p
                      v-if="filterMeaningfulResistanceTraits(battleRoom.resistance ?? []).length"
                      class="trait-line"
                    >
                      <span class="trait-label">抗性</span>
                      {{ formatResistanceTraitText(battleRoom.resistance ?? []) }}
                    </p>
                  </div>
                </header>

                <div
                  v-for="wave in battleRoom.waves"
                  :key="`${battleRoom.id}-${wave.label}`"
                  class="wave-block"
                >
                  <p class="wave-label">{{ wave.label }}</p>
                  <div class="enemy-grid">
                    <article
                      v-for="(enemy, enemyIndex) in wave.enemies"
                      :key="`${battleRoom.id}-${wave.label}-${enemyIndex}`"
                      class="enemy-chip"
                      :class="{ 'enemy-chip--boss': enemy.isBoss }"
                    >
                      <div class="enemy-chip-image">
                        <img v-if="enemy.imageUrl" :src="enemy.imageUrl" :alt="enemy.name" />
                        <span v-else class="image-placeholder">{{ enemy.isBoss ? 'Boss' : '怪' }}</span>
                      </div>
                      <div class="enemy-chip-body">
                        <p class="enemy-chip-name">
                          <span v-if="enemy.isBoss" class="boss-mark">✦</span>
                          {{ enemy.name }}
                          <span v-if="enemy.count && enemy.count > 1" class="enemy-count">x{{ enemy.count }}</span>
                        </p>
                        <div class="enemy-chip-hp-block">
                          <p class="enemy-chip-hp-row">
                            <span class="enemy-hp-prefix">血量：</span>
                            <span class="enemy-chip-hp">{{ enemy.hp }}</span>
                            <span
                              v-if="getEnemyHpComparison(enemy)?.expansion"
                              class="enemy-hp-expansion"
                            >
                              {{ getEnemyHpComparison(enemy)!.expansion }}
                            </span>
                          </p>
                          <p
                            v-if="getEnemyHpComparison(enemy)"
                            class="enemy-chip-hp-row enemy-chip-hp-row--diff"
                          >
                            <span class="enemy-hp-prefix enemy-hp-prefix--ghost" aria-hidden="true">血量：</span>
                            <span class="enemy-hp-delta">
                              {{ formatHpDelta(getEnemyHpComparison(enemy)!.diff) }}
                            </span>
                          </p>
                        </div>
                        <p v-if="enemy.defense !== undefined" class="enemy-chip-def">防御 {{ enemy.defense }}</p>
                        <p v-if="enemy.weakness" class="enemy-chip-trait">
                          <span class="trait-label">弱点</span>{{ enemy.weakness }}
                        </p>
                        <p v-if="formatEnemyResistance(enemy.resistance)" class="enemy-chip-trait">
                          <span class="trait-label">抗性</span>{{ formatEnemyResistance(enemy.resistance) }}
                        </p>
                      </div>
                    </article>
                  </div>
                </div>
              </section>
            </article>
          </div>
        </section>
      </div>
    </div>

    <div
      v-if="currentSeason && !embedded"
      class="nav-zone nav-zone--right"
      :class="{ 'nav-zone--disabled': currentIndex === seasons.length - 1 }"
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
.defense-status {
  width: 100%;
  min-height: 40vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  opacity: 0.75;
}

.defense-status--error {
  color: #e85d4c;
  opacity: 1;
}

.defense-panel-wrapper {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 100%;
}

.defense-panel-wrapper--embedded {
  min-height: 0;
  height: 100%;
}

.defense-panel--embedded {
  padding: 0;
  overflow: auto;
}

.defense-panel--embedded .panel-header {
  padding-top: 0;
}

.defense-panel {
  flex: 1;
  min-width: 0;
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 1.5rem 1.25rem 2.5rem;
}

.nav-zone {
  flex: 0 0 clamp(48px, 6vw, 96px);
  min-width: 48px;
  max-width: 96px;
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

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
  flex-shrink: 0;
}

.page-title {
  font-size: clamp(1.75rem, 4vw, 2.25rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
}

.header-info-row {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 1rem;
  width: 100%;
  max-width: min(1200px, 100%);
}

.phase-selector {
  display: flex;
  flex: 1;
  min-width: 0;
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
  text-align: center;
}

.hp-summary {
  flex: 1;
  min-width: 0;
  min-height: 108px;
  max-width: 400px;
  padding: 0.85rem 1rem;
  border-radius: 12px;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.hp-room-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: 100%;
}

.hp-room-btn {
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 1.15rem;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.2s, opacity 0.2s;
}

.hp-room-btn:hover:not(:disabled) {
  background: var(--color-background-mute);
}

.hp-room-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.hp-room-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
}

.hp-room-title {
  font-size: clamp(0.82rem, 1.6vw, 0.92rem);
  font-weight: 700;
  color: var(--color-heading);
  line-height: 1.3;
}

.hp-room-subtitle {
  font-size: clamp(0.72rem, 1.4vw, 0.8rem);
  opacity: 0.72;
  line-height: 1.3;
}

.hp-room-index {
  font-size: 0.68rem;
  opacity: 0.55;
  line-height: 1.2;
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
  gap: 0.15rem;
  margin-top: 0.35rem;
  width: fit-content;
}

.hp-metric-row {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}

.hp-metric-row--sub {
  opacity: 0.88;
}

.hp-number {
  font-size: clamp(0.92rem, 1.8vw, 1.05rem);
  color: var(--color-heading);
  font-weight: 600;
}

.hp-number--sub {
  font-size: clamp(0.82rem, 1.5vw, 0.92rem);
}

.hp-delta {
  font-size: clamp(0.72rem, 1.4vw, 0.82rem);
  color: #e85d4c;
  font-weight: 600;
}

.hp-expansion {
  font-size: clamp(0.78rem, 1.5vw, 0.9rem);
  color: #4d9fff;
  font-weight: 600;
}

.hp-tag {
  flex-shrink: 0;
  min-width: 2rem;
  color: #e85d4c;
  font-weight: 600;
  font-size: clamp(0.82rem, 1.6vw, 0.95rem);
}

.hp-tag--ghost {
  visibility: hidden;
}

.hp-tag--aoe {
  color: #4d9fff;
}

.hp-tag--alt {
  color: #e8a838;
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
  width: min(1120px, 96vw);
  max-height: min(90vh, 860px);
  padding: 2.75rem 1.75rem 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-background);
  overflow: hidden;
}

.phase-modal-close {
  position: absolute;
  top: 0.85rem;
  right: 0.85rem;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}

.phase-modal-title {
  margin: 0 0 1.35rem;
  text-align: center;
  font-size: clamp(1.55rem, 3.2vw, 2rem);
  font-weight: 700;
  color: var(--color-heading);
}

.phase-grid-scroll {
  max-height: min(62vh, 640px);
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.phase-grid-scroll::-webkit-scrollbar {
  display: none;
}

.phase-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
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
}

.frontier-scroll {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

.frontier-section {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem;
}

.frontier-header {
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.frontier-title {
  margin: 0;
  font-size: clamp(1.15rem, 2.4vw, 1.4rem);
  font-weight: 700;
  color: var(--color-heading);
}

.frontier-meta {
  margin: 0.25rem 0 0;
  font-size: 0.82rem;
  opacity: 0.72;
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.room-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.room-card-header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: flex-start;
}

.room-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-heading);
}

.room-meta {
  margin: 0.2rem 0 0;
  font-size: 0.76rem;
  opacity: 0.72;
}

.rank-block {
  flex-shrink: 0;
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  font-size: 0.72rem;
  line-height: 1.45;
}

.rank-line {
  margin: 0;
  opacity: 0.85;
}

.block-label {
  margin: 0 0 0.35rem;
  font-size: 0.76rem;
  font-weight: 600;
  color: #e8a838;
}

.room-buff-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.room-buff-card {
  padding: 0.75rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.buff-name {
  margin: 0 0 0.4rem;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--color-heading);
}

.buff-name:only-child {
  margin-bottom: 0;
}

.buff-lines {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.76rem;
  line-height: 1.5;
  opacity: 0.9;
}

.battle-room {
  border-top: 1px dashed var(--color-border);
  padding-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.battle-room-header {
  display: flex;
  justify-content: space-between;
  gap: 0.65rem;
  align-items: flex-start;
}

.battle-room-title {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--color-heading);
}

.battle-room-meta {
  margin: 0.15rem 0 0;
  font-size: 0.74rem;
  opacity: 0.72;
}

.trait-row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex-shrink: 0;
  text-align: right;
}

.trait-line {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.45;
  color: var(--color-heading);
}

.trait-label {
  margin-right: 0.35rem;
  font-size: 0.72rem;
  opacity: 0.7;
}

.wave-block {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.wave-label {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: #e8a838;
  letter-spacing: 0.04em;
}

.enemy-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.enemy-chip {
  flex: 1 1 220px;
  max-width: 100%;
  display: flex;
  gap: 0.55rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
}

.enemy-chip--boss {
  border-color: rgba(232, 168, 56, 0.45);
  background: color-mix(in srgb, #e8a838 8%, var(--color-background-soft));
}

.enemy-chip-image {
  width: 52px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.enemy-chip-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-placeholder {
  font-size: 0.72rem;
  opacity: 0.55;
}

.enemy-chip-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.enemy-chip-name {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
  line-height: 1.35;
}

.boss-mark {
  color: #e8a838;
  margin-right: 0.15rem;
}

.enemy-count {
  margin-left: 0.25rem;
  font-size: 0.76rem;
  opacity: 0.8;
}

.enemy-chip-hp-block {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.enemy-chip-hp-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.2rem;
  margin: 0;
  line-height: 1.4;
}

.enemy-chip-hp-row--diff {
  margin-top: 0.05rem;
}

.enemy-hp-prefix {
  font-size: 0.76rem;
  color: var(--color-heading);
  opacity: 0.82;
}

.enemy-hp-prefix--ghost {
  visibility: hidden;
}

.enemy-chip-hp {
  margin: 0;
  font-size: 0.8rem;
  color: #e85d4c;
  font-weight: 600;
}

.enemy-hp-delta {
  font-size: clamp(0.64rem, 1.15vw, 0.72rem);
  font-weight: 500;
  color: #e85d4c;
  opacity: 0.92;
}

.enemy-hp-expansion {
  font-size: clamp(0.78rem, 1.5vw, 0.9rem);
  font-weight: 600;
  color: #4d9fff;
}

.enemy-chip-def {
  margin: 0;
  font-size: 0.74rem;
  opacity: 0.8;
}

.enemy-chip-trait {
  margin: 0;
  font-size: 0.74rem;
  line-height: 1.4;
  color: var(--color-heading);
  opacity: 0.88;
}

@media (max-width: 900px) {
  .header-info-row {
    flex-direction: column;
    align-items: stretch;
  }

  .hp-summary {
    max-width: none;
  }

  .phase-btn {
    min-width: 0;
  }
}

@media (max-width: 640px) {
  .defense-panel-wrapper {
    flex-direction: column;
  }

  .nav-zone {
    display: none;
  }
}
</style>
