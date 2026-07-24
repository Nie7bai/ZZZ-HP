<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchCrisisAssaultPhases, formatPhaseCompactCode } from '@/api/crisisAssault'
import { fetchDefenseSeasons } from '@/api/defense'
import { useCrisisAssaultCompareStore } from '@/stores/crisisAssaultCompare'
import { useDefenseCompareStore } from '@/stores/defenseCompare'
import type { DefenseVariant } from '@/types/defense'
import { modeTitles, type BuffInfo, type ModeKey, type PhaseData } from '@/types/history'
import { defenseSeasonsToPhaseData } from '@/utils/defenseCompare'

type BuffViewMode = 'horizontal' | 'card'

interface BuffActionTarget {
  phase: PhaseData
  buffIndex: number
  buff: BuffInfo
  entryId: string
}

interface MenuAnchor {
  top: number
  left: number
  minWidth: number
}

interface SearchBuffEntry {
  id: string
  phase: PhaseData
  buffIndex: number
  buff: BuffInfo
}

interface SearchResultGroup {
  phaseId: string
  phaseDisplay: string
  dateRange: string
  tid: string
  entries: SearchBuffEntry[]
}

const props = defineProps<{
  mode: ModeKey
}>()

const route = useRoute()
const crisisCompareStore = useCrisisAssaultCompareStore()
const defenseCompareStore = useDefenseCompareStore()

const defenseVariant = computed<DefenseVariant>(() =>
  route.name === 'defense-new' ? 'new' : 'old',
)

const phases = ref<PhaseData[]>([])
const loading = ref(false)
const loadError = ref('')
const viewMode = ref<BuffViewMode>('card')
const buffSearchInput = ref('')
const actionTarget = ref<BuffActionTarget | null>(null)
const menuAnchor = ref<MenuAnchor | null>(null)

const pageTitle = computed(() => modeTitles[props.mode])
const panelDesc = computed(() =>
  props.mode === 'defense'
    ? '每期各房间关卡增益集中展示，便于快速浏览与对照'
    : '每期三个 Buff 集中展示，便于快速浏览与对照',
)
const isHorizontalMode = computed(() => viewMode.value === 'horizontal')
const isCardMode = computed(() => viewMode.value === 'card')

const isMenuOpen = computed(() => actionTarget.value !== null && menuAnchor.value !== null)

const actionAlreadyAdded = computed(() => {
  if (!actionTarget.value) return false
  if (props.mode === 'defense') {
    return defenseCompareStore.hasBuffId(actionTarget.value.entryId)
  }
  return crisisCompareStore.hasBuffId(actionTarget.value.entryId)
})

const normalizedSearchQuery = computed(() => normalizeQuery(buffSearchInput.value))

const isSearchActive = computed(() => normalizedSearchQuery.value.length > 0)

const searchResultGroups = computed<SearchResultGroup[]>(() => {
  const query = normalizedSearchQuery.value
  if (!query) return []

  const groups: SearchResultGroup[] = []

  for (const phase of phases.value) {
    if (!phaseMatchesSearch(phase, query)) continue

    const entries: SearchBuffEntry[] = []
    phase.buffs.forEach((buff, buffIndex) => {
      if (!shouldShowBuff(phase, buff, query) || !isValidBuff(buff)) return
      entries.push({
        id: getBuffEntryId(phase, buffIndex),
        phase,
        buffIndex,
        buff,
      })
    })

    if (!entries.length) continue

    entries.sort((a, b) => a.buffIndex - b.buffIndex)
    groups.push({
      phaseId: phase.id,
      phaseDisplay: formatPhaseTitle(phase),
      dateRange: phase.dateRange,
      tid: phase.tid,
      entries,
    })
  }

  return groups
})

async function loadPhases() {
  loading.value = true
  loadError.value = ''
  try {
    if (props.mode === 'defense') {
      const seasons = await fetchDefenseSeasons(defenseVariant.value)
      phases.value = defenseSeasonsToPhaseData(seasons)
    } else if (props.mode === 'crisis-assault') {
      phases.value = await fetchCrisisAssaultPhases()
    } else {
      phases.value = []
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    phases.value = []
  } finally {
    loading.value = false
  }
}

function formatPhaseTitle(phase: PhaseData) {
  return `${phase.version} ${phase.phase}`
}

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function getPhaseCompactCode(phase: PhaseData) {
  const phaseNum = phase.phase.match(/\d+/)?.[0] ?? '1'
  const phaseLabel = `${phase.version}第${phaseNum}期`
  return formatPhaseCompactCode({
    label: phaseLabel,
    dateRange: phase.dateRange,
    totalHp: phase.totalHp ?? 0,
    version: phase.version,
    phase: phaseNum,
  })
}

function phaseMetaMatchesSearch(phase: PhaseData, query: string) {
  const normalized = normalizeQuery(query)
  const candidates = [
    phase.version,
    phase.phase,
    formatPhaseTitle(phase),
    getPhaseCompactCode(phase),
    phase.dateRange,
    phase.tid,
    `${phase.version}第${phase.phase.match(/\d+/)?.[0] ?? '1'}期`,
  ]

  return candidates.some((item) => normalizeQuery(item).includes(normalized))
}

function buffMatchesSearch(buff: BuffInfo, query: string) {
  if (!isValidBuff(buff)) return false

  const normalized = normalizeQuery(query)
  const candidates = [buff.name, ...buff.lines]

  return candidates.some((item) => normalizeQuery(item).includes(normalized))
}

function phaseMatchesSearch(phase: PhaseData, query: string) {
  if (phaseMetaMatchesSearch(phase, query)) return true
  return phase.buffs.some((buff) => buffMatchesSearch(buff, query))
}

function shouldShowBuff(phase: PhaseData, buff: BuffInfo, query: string) {
  if (!query) return true
  if (phaseMetaMatchesSearch(phase, query)) return true
  return buffMatchesSearch(buff, query)
}

function hasBuffContent(phase: PhaseData) {
  return phase.buffs.some((buff) => isValidBuff(buff))
}

function isValidBuff(buff: BuffInfo) {
  return Boolean(buff.name && !buff.name.startsWith('Buff '))
}

function getBuffEntryId(phase: PhaseData, buffIndex: number) {
  return `${phase.id}-buff-${buffIndex}`
}

function setViewMode(mode: BuffViewMode) {
  viewMode.value = mode
  closeBuffMenu()
}

function closeBuffMenu() {
  actionTarget.value = null
  menuAnchor.value = null
}

function openBuffMenu(phase: PhaseData, buffIndex: number, element: HTMLElement) {
  const buff = phase.buffs[buffIndex]
  if (!buff || !isValidBuff(buff)) return

  const entryId = getBuffEntryId(phase, buffIndex)
  if (actionTarget.value?.entryId === entryId) {
    closeBuffMenu()
    return
  }

  const rect = element.getBoundingClientRect()
  const menuWidth = Math.max(rect.width, 168)
  let left = rect.left
  let top = rect.bottom + 6

  if (left + menuWidth > window.innerWidth - 8) {
    left = window.innerWidth - menuWidth - 8
  }
  if (top + 44 > window.innerHeight - 8) {
    top = rect.top - 6 - 36
  }

  actionTarget.value = {
    phase,
    buffIndex,
    buff,
    entryId,
  }
  menuAnchor.value = {
    top,
    left,
    minWidth: menuWidth,
  }
}

function onBuffClick(phase: PhaseData, buffIndex: number, event: MouseEvent) {
  const buff = phase.buffs[buffIndex]
  if (!buff || !isValidBuff(buff)) return

  event.stopPropagation()
  openBuffMenu(phase, buffIndex, event.currentTarget as HTMLElement)
}

function addCurrentBuffToCompare() {
  if (!actionTarget.value || actionAlreadyAdded.value) return
  if (props.mode === 'defense') {
    defenseCompareStore.addBuffId(actionTarget.value.entryId)
  } else {
    crisisCompareStore.addBuffId(actionTarget.value.entryId)
  }
  closeBuffMenu()
}

function onDocumentClick() {
  closeBuffMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeBuffMenu()
}

watch(isMenuOpen, (open) => {
  if (open) {
    nextTick(() => {
      document.addEventListener('click', onDocumentClick)
      document.addEventListener('keydown', onDocumentKeydown)
    })
    return
  }

  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})

onMounted(loadPhases)

watch(defenseVariant, () => {
  if (props.mode === 'defense') loadPhases()
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})

watch(
  () => props.mode,
  () => {
    closeBuffMenu()
    buffSearchInput.value = ''
    loadPhases()
  },
)

watch(buffSearchInput, () => {
  closeBuffMenu()
})
</script>

<template>
  <div class="buff-overview-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }} · Buff 总览</h1>
      <p class="panel-desc">{{ panelDesc }}</p>
      <div class="header-toolbar">
        <div class="mode-toggle" role="group" aria-label="Buff 展示模式">
          <button
            type="button"
            class="mode-btn"
            :class="{ active: isCardMode }"
            @click="setViewMode('card')"
          >
            卡片
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ active: isHorizontalMode }"
            @click="setViewMode('horizontal')"
          >
            横版
          </button>
        </div>
        <input
          v-model="buffSearchInput"
          type="search"
          class="buff-search-input"
          placeholder="Buff 名 / 期数"
          spellcheck="false"
          aria-label="搜索 Buff 或期数"
        />
      </div>
    </header>

    <p v-if="loading" class="status-text">加载中...</p>
    <p v-else-if="loadError" class="status-text error">{{ loadError }}</p>
    <p v-else-if="!phases.length" class="status-text">暂无 Buff 数据</p>
    <p v-else-if="isSearchActive && !searchResultGroups.length" class="status-text">
      未找到匹配的 Buff 或期数
    </p>

    <div v-else-if="isSearchActive" class="phase-list search-results">
      <article
        v-for="group in searchResultGroups"
        :key="group.phaseId"
        class="phase-card search-result-card"
      >
        <header class="phase-card-header">
          <div class="phase-card-title-row">
            <h2 class="phase-card-title">{{ group.phaseDisplay }}</h2>
            <span class="phase-card-id">ID: {{ group.tid }}</span>
          </div>
          <p class="phase-card-date">{{ group.dateRange }}</p>
        </header>

        <div class="buff-row">
          <div
            v-for="entry in group.entries"
            :key="entry.id"
            class="buff-item buff-item--search buff-item--clickable"
            :class="{ 'buff-item--active': actionTarget?.entryId === entry.id }"
            role="button"
            tabindex="0"
            @click="onBuffClick(entry.phase, entry.buffIndex, $event)"
            @keydown.enter.prevent="openBuffMenu(entry.phase, entry.buffIndex, $event.currentTarget as HTMLElement)"
            @keydown.space.prevent="openBuffMenu(entry.phase, entry.buffIndex, $event.currentTarget as HTMLElement)"
          >
            <div class="buff-item-head buff-item-head--search">
              <div v-if="entry.buff.imageUrl" class="buff-image">
                <img :src="entry.buff.imageUrl" :alt="entry.buff.name" />
              </div>
              <div v-else class="buff-icon">{{ entry.buff.icon }}</div>
              <h3 class="buff-name">{{ entry.buff.name }}</h3>
            </div>
            <ul class="buff-lines">
              <li v-for="(line, lineIndex) in entry.buff.lines" :key="lineIndex">{{ line }}</li>
            </ul>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="phase-list" :class="`phase-list--${viewMode}`">
      <article
        v-for="phase in phases"
        :key="phase.id"
        class="phase-card"
        :class="{
          'phase-card--empty': !hasBuffContent(phase),
          'phase-card--horizontal': isHorizontalMode,
          'phase-card--card': isCardMode,
        }"
      >
        <header class="phase-card-header">
          <div class="phase-card-title-row">
            <h2 class="phase-card-title">{{ formatPhaseTitle(phase) }}</h2>
            <span class="phase-card-id">ID: {{ phase.tid }}</span>
          </div>
          <p class="phase-card-date">{{ phase.dateRange }}</p>
        </header>

        <div class="buff-grid" :class="`buff-grid--${viewMode}`">
          <div
            v-for="(buff, index) in phase.buffs"
            :key="`${phase.id}-buff-${index}`"
            class="buff-item"
            :class="[
              `buff-item--${viewMode}`,
              {
                'buff-item--clickable': isValidBuff(buff),
                'buff-item--active': actionTarget?.entryId === getBuffEntryId(phase, index),
              },
            ]"
            :role="isValidBuff(buff) ? 'button' : undefined"
            :tabindex="isValidBuff(buff) ? 0 : undefined"
            @click="onBuffClick(phase, index, $event)"
            @keydown.enter.prevent="openBuffMenu(phase, index, $event.currentTarget as HTMLElement)"
            @keydown.space.prevent="openBuffMenu(phase, index, $event.currentTarget as HTMLElement)"
          >
            <div class="buff-item-head" :class="`buff-item-head--${viewMode}`">
              <div v-if="buff.imageUrl" class="buff-image">
                <img :src="buff.imageUrl" :alt="buff.name" />
              </div>
              <div v-else class="buff-icon">{{ buff.icon }}</div>
              <h3 class="buff-name">{{ buff.name }}</h3>
            </div>
            <ul class="buff-lines">
              <li v-for="(line, lineIndex) in buff.lines" :key="lineIndex">{{ line }}</li>
            </ul>
          </div>
        </div>
      </article>
    </div>

    <Teleport to="body">
      <div
        v-if="isMenuOpen && actionTarget && menuAnchor"
        class="buff-option-menu"
        :style="{
          top: `${menuAnchor.top}px`,
          left: `${menuAnchor.left}px`,
          minWidth: `${menuAnchor.minWidth}px`,
        }"
        role="menu"
        @click.stop
      >
        <button
          type="button"
          class="buff-option-item"
          role="menuitem"
          :disabled="actionAlreadyAdded"
          @click="addCurrentBuffToCompare"
        >
          {{ actionAlreadyAdded ? '已在 Buff 对比中' : '将当前 Buff 添加到 Buff 对比' }}
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.buff-overview-panel {
  width: 100%;
  height: auto;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.85rem;
  flex-shrink: 0;
}

.page-title {
  margin: 0;
  font-size: clamp(1.5rem, 3.5vw, 2rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
  text-align: center;
}

.panel-desc {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.7;
  color: var(--color-text);
  text-align: center;
}

.mode-toggle {
  display: inline-flex;
  padding: 0.15rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  flex-shrink: 0;
}

.header-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.65rem;
  width: 100%;
  max-width: min(560px, 100%);
}

.buff-search-input {
  flex: 1 1 11rem;
  min-width: 9rem;
  max-width: 16rem;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.2s;
}

.buff-search-input:focus {
  border-color: #e8a838;
}

.buff-search-input::placeholder {
  color: var(--color-text);
  opacity: 0.55;
}

.mode-btn {
  min-width: 4.5rem;
  padding: 0.35rem 0.85rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.mode-btn:hover {
  background: var(--color-background-mute);
}

.mode-btn.active {
  background: var(--color-background-soft);
  color: var(--color-heading);
  box-shadow: inset 0 0 0 1px var(--color-border);
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

.phase-list {
  flex: none;
  min-height: 0;
  overflow: visible;
  display: block;
  padding: 0.15rem 0.25rem 0.75rem;
}

.phase-list--card {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  align-items: start;
}

.phase-card {
  display: block;
  flex-shrink: 0;
  margin-bottom: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  overflow: visible;
  min-width: 0;
}

.phase-list--card .phase-card {
  margin-bottom: 0;
  height: 100%;
}

.phase-card:last-child {
  margin-bottom: 0;
}

.phase-list--card .phase-card:last-child {
  margin-bottom: 0;
}

.phase-card--empty {
  opacity: 0.72;
}

.phase-card--card {
  background: var(--color-background);
}

.phase-card-header {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.85rem 1rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
  flex-shrink: 0;
}

.phase-card--card .phase-card-header {
  border-bottom: none;
  padding-bottom: 0.55rem;
}

.phase-card-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.phase-card-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-heading);
}

.phase-card-id {
  font-size: 0.78rem;
  color: var(--color-text);
  opacity: 0.65;
  white-space: nowrap;
}

.phase-card-date {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text);
  opacity: 0.7;
}

.buff-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  min-height: 0;
}

.buff-grid--horizontal {
  gap: 0;
}

.buff-grid--card {
  gap: 0.55rem;
  padding: 0 0.65rem 0.75rem;
  align-items: stretch;
}

.buff-item--horizontal {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.85rem 0.9rem 1rem;
  min-width: 0;
  min-height: 8rem;
}

.buff-item--horizontal + .buff-item--horizontal {
  border-left: 1px solid var(--color-border);
}

.buff-item-head--horizontal {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.buff-item--horizontal .buff-image,
.buff-item--horizontal .buff-icon {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
}

.buff-item--horizontal .buff-name {
  margin: 0;
  min-width: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-heading);
  line-height: 1.3;
  text-align: left;
}

.buff-item--card {
  height: 100%;
  min-width: 0;
  padding: 0.7rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
}

.buff-item--clickable {
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.buff-item--clickable:hover {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.buff-item--horizontal.buff-item--clickable:hover {
  background: var(--color-background-mute);
}

.buff-item--clickable:focus-visible {
  outline: 2px solid #e8a838;
  outline-offset: 2px;
}

.buff-item--active {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.buff-item-head--card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.28rem;
  margin-bottom: 0.4rem;
}

.buff-item--card .buff-image {
  width: 40px;
  height: 40px;
  margin: 0 auto;
}

.buff-item--card .buff-icon {
  width: auto;
  height: auto;
  font-size: 1.1rem;
  margin-bottom: 0;
  align-self: center;
  text-align: center;
}

.buff-item--card .buff-name {
  margin: 0;
  width: 100%;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-heading);
  text-align: center;
  line-height: 1.3;
}

.buff-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.buff-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.15rem;
}

.buff-lines {
  margin: 0;
  padding-left: 1.05rem;
  list-style: disc;
  font-size: 0.78rem;
  line-height: 1.55;
  color: var(--color-text);
  flex: 1;
}

.buff-item--card .buff-lines {
  padding-left: 0.95rem;
  font-size: 0.7rem;
  line-height: 1.45;
}

.phase-card--card .phase-card-header {
  padding: 0.7rem 0.75rem 0.45rem;
}

.phase-card--card .phase-card-title {
  font-size: 0.95rem;
}

.phase-card--card .phase-card-id,
.phase-card--card .phase-card-date {
  font-size: 0.72rem;
}

@media (max-width: 1100px) {
  .phase-list--card {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .buff-grid {
    grid-template-columns: 1fr;
  }

  .buff-item--horizontal + .buff-item--horizontal {
    border-left: none;
    border-top: 1px solid var(--color-border);
  }
}

.buff-option-menu {
  position: fixed;
  z-index: 1200;
  padding: 0.2rem 0;
  border: 1.5px solid var(--color-border-hover);
  border-radius: 8px;
  background: var(--color-background);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.16);
}

.buff-option-item {
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

.buff-option-item:hover:not(:disabled) {
  background: var(--color-background-mute);
}

.buff-option-item:disabled {
  opacity: 0.55;
  cursor: default;
}

.search-results {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  gap: 0.85rem;
  align-content: start;
  justify-content: start;
  align-items: start;
}

.search-result-card {
  width: max-content;
  max-width: 100%;
  margin-bottom: 0;
  height: fit-content;
  align-self: start;
  background: var(--color-background);
}

.search-results .phase-card-header {
  border-bottom: none;
  padding: 0.7rem 0.75rem 0.45rem;
}

.search-results .phase-card-title {
  font-size: 0.95rem;
}

.search-results .phase-card-id,
.search-results .phase-card-date {
  font-size: 0.72rem;
}

.search-results .buff-row {
  --buff-slot-width: 11.5rem;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 0.55rem;
  padding: 0 0.65rem 0.75rem;
  align-items: flex-start;
  width: fit-content;
  max-width: 100%;
}

.buff-item--search {
  flex: 0 0 var(--buff-slot-width);
  width: var(--buff-slot-width);
  box-sizing: border-box;
  padding: 0.7rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  display: flex;
  flex-direction: column;
  align-self: flex-start;
  height: auto;
}

.buff-item-head--search {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.28rem;
  margin-bottom: 0.4rem;
}

.buff-item--search .buff-image {
  width: 40px;
  height: 40px;
  margin: 0 auto;
}

.buff-item--search .buff-icon {
  width: auto;
  height: auto;
  font-size: 1.1rem;
  margin-bottom: 0;
  align-self: center;
  text-align: center;
}

.buff-item--search .buff-name {
  margin: 0;
  width: 100%;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-heading);
  text-align: center;
  line-height: 1.3;
}

.buff-item--search .buff-lines {
  margin: 0;
  padding-left: 0.95rem;
  list-style: disc;
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--color-text);
}

@media (max-width: 1100px) {
  .search-results {
    grid-template-columns: max-content;
  }
}

@media (max-width: 900px) {
  .search-results .buff-row {
    flex-wrap: wrap;
  }
}

@media (max-width: 768px) {
  .buff-overview-panel {
    min-height: auto;
    padding: 0.35rem 0.15rem 0.55rem;
  }

  .page-title {
    font-size: 1.05rem;
  }

  .panel-desc {
    font-size: 0.72rem;
  }

  .panel-header {
    gap: 0.35rem;
    margin-bottom: 0.55rem;
  }

  .phase-list--card {
    grid-template-columns: 1fr;
  }

  .search-results {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .search-results .buff-row {
    flex-direction: column;
    width: 100%;
  }
}
</style>
