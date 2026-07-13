<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchCrisisAssaultPhases, formatPhaseCompactCode } from '@/api/crisisAssault'
import { fetchDefenseSeasons } from '@/api/defense'
import { useCrisisAssaultCompareStore } from '@/stores/crisisAssaultCompare'
import { useDefenseCompareStore } from '@/stores/defenseCompare'
import type { DefenseVariant } from '@/types/defense'
import { modeTitles, type BuffInfo, type ModeKey, type PhaseData } from '@/types/history'
import { defenseSeasonsToPhaseData } from '@/utils/defenseCompare'

const QUICK_ADD_ROW_LIMIT = 10

interface BuffEntry {
  id: string
  phaseId: string
  phaseLabel: string
  phaseCode: string
  phaseDisplay: string
  dateRange: string
  tid: string
  buffIndex: number
  buff: BuffInfo
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

const allPhases = ref<PhaseData[]>([])

const selectedIds = computed({
  get() {
    return props.mode === 'defense'
      ? defenseCompareStore.selectedBuffIds
      : crisisCompareStore.selectedBuffIds
  },
  set(value: string[]) {
    if (props.mode === 'defense') {
      defenseCompareStore.selectedBuffIds = value
    } else {
      crisisCompareStore.selectedBuffIds = value
    }
  },
})
const buffSearchInput = ref('')
const inputError = ref('')
const quickAddDropdownValue = ref('')
const loading = ref(false)
const loadError = ref('')
const hoveredBuffId = ref<string | null>(null)

const pageTitle = computed(() => modeTitles[props.mode])

const allBuffEntries = computed<BuffEntry[]>(() => {
  const entries: BuffEntry[] = []

  for (const phase of allPhases.value) {
    const phaseNum = phase.phase.match(/\d+/)?.[0] ?? '1'
    const phaseLabel = `${phase.version}第${phaseNum}期`
    const phaseCode = formatPhaseCompactCode({
      label: phaseLabel,
      dateRange: phase.dateRange,
      totalHp: phase.totalHp ?? 0,
      version: phase.version,
      phase: phaseNum,
    })
    const phaseDisplay = `${phase.version} ${phase.phase}`

    phase.buffs.forEach((buff, buffIndex) => {
      if (!buff.name || buff.name.startsWith('Buff ')) return
      entries.push({
        id: `${phase.id}-buff-${buffIndex}`,
        phaseId: phase.id,
        phaseLabel,
        phaseCode,
        phaseDisplay,
        dateRange: phase.dateRange,
        tid: phase.tid,
        buffIndex,
        buff,
      })
    })
  }

  return entries
})

const entryById = computed(() => {
  const map = new Map<string, BuffEntry>()
  for (const entry of allBuffEntries.value) {
    map.set(entry.id, entry)
  }
  return map
})

const selectedEntries = computed(() =>
  selectedIds.value
    .map((id) => entryById.value.get(id))
    .filter((entry): entry is BuffEntry => !!entry),
)

interface ComparePhaseGroup {
  phaseId: string
  phaseDisplay: string
  dateRange: string
  tid: string
  entries: BuffEntry[]
}

const comparePhaseGroups = computed<ComparePhaseGroup[]>(() => {
  const groups: ComparePhaseGroup[] = []
  const groupByPhase = new Map<string, ComparePhaseGroup>()

  for (const id of selectedIds.value) {
    const entry = entryById.value.get(id)
    if (!entry) continue

    let group = groupByPhase.get(entry.phaseId)
    if (!group) {
      group = {
        phaseId: entry.phaseId,
        phaseDisplay: entry.phaseDisplay,
        dateRange: entry.dateRange,
        tid: entry.tid,
        entries: [],
      }
      groupByPhase.set(entry.phaseId, group)
      groups.push(group)
    }
    group.entries.push(entry)
  }

  for (const group of groups) {
    group.entries.sort((a, b) => a.buffIndex - b.buffIndex)
  }

  return groups
})

const availableEntries = computed(() =>
  allBuffEntries.value.filter((entry) => !selectedIds.value.includes(entry.id)),
)

const quickAddInlineEntries = computed(() => availableEntries.value.slice(0, QUICK_ADD_ROW_LIMIT))

const quickAddDropdownEntries = computed(() => availableEntries.value.slice(QUICK_ADD_ROW_LIMIT))

function normalizeQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function matchesEntry(entry: BuffEntry, query: string) {
  const normalized = normalizeQuery(query)
  if (!normalized) return false

  const candidates = [
    entry.buff.name,
    entry.phaseLabel,
    entry.phaseCode,
    entry.phaseDisplay,
    entry.tid,
    `${entry.phaseCode}${entry.buff.name}`,
    `${entry.phaseLabel}${entry.buff.name}`,
  ]

  return candidates.some((item) => normalizeQuery(item).includes(normalized))
}

async function loadPhases() {
  loading.value = true
  loadError.value = ''
  try {
    if (props.mode === 'defense') {
      const seasons = await fetchDefenseSeasons(defenseVariant.value)
      allPhases.value = defenseSeasonsToPhaseData(seasons)
    } else if (props.mode === 'crisis-assault') {
      allPhases.value = await fetchCrisisAssaultPhases()
    } else {
      allPhases.value = []
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '加载失败'
    allPhases.value = []
  } finally {
    loading.value = false
  }
}

function addEntry(entry: BuffEntry) {
  if (selectedIds.value.includes(entry.id)) return
  selectedIds.value = [...selectedIds.value, entry.id]
}

function addBuffFromSearch(rawInput?: string) {
  const query = (rawInput ?? buffSearchInput.value).trim()
  if (!query) return

  const matched = availableEntries.value.filter((entry) => matchesEntry(entry, query))
  if (!matched.length) {
    inputError.value = '未找到该 Buff，可试 Buff 名 / 3.01 / 3.0第1期'
    return
  }

  if (matched.length === 1) {
    addEntry(matched[0]!)
    buffSearchInput.value = ''
    inputError.value = ''
    return
  }

  const exactName = matched.filter(
    (entry) => normalizeQuery(entry.buff.name) === normalizeQuery(query),
  )
  if (exactName.length === 1) {
    addEntry(exactName[0]!)
    buffSearchInput.value = ''
    inputError.value = ''
    return
  }

  inputError.value = `匹配到 ${matched.length} 个 Buff，请写更具体，如 ${matched[0]!.phaseCode}${matched[0]!.buff.name}`
}

function removeEntry(id: string) {
  selectedIds.value = selectedIds.value.filter((item) => item !== id)
  if (hoveredBuffId.value === id) {
    hoveredBuffId.value = null
  }
}

function clearEntries() {
  selectedIds.value = []
  hoveredBuffId.value = null
}

function onQuickAddDropdownChange() {
  if (!quickAddDropdownValue.value) return
  const entry = entryById.value.get(quickAddDropdownValue.value)
  if (entry) addEntry(entry)
  quickAddDropdownValue.value = ''
}

function formatEntryTag(entry: BuffEntry) {
  return `${entry.phaseCode} · ${entry.buff.name}`
}

onMounted(loadPhases)

watch(defenseVariant, () => {
  if (props.mode === 'defense') loadPhases()
})

watch(buffSearchInput, () => {
  if (inputError.value) inputError.value = ''
})

watch(
  () => props.mode,
  () => {
    loadPhases()
  },
)
</script>

<template>
  <div class="buff-compare-panel">
    <header class="panel-header">
      <h1 class="page-title">{{ pageTitle }} · Buff 对比</h1>
      <p class="panel-desc">逐个添加 Buff，对照所属期数与效果描述</p>
    </header>

    <p v-if="loading && !allPhases.length" class="status-text">加载中...</p>
    <p v-else-if="loadError && !allPhases.length" class="status-text error">{{ loadError }}</p>

    <template v-else>
      <section class="buff-selector">
        <form class="buff-search-form" @submit.prevent="addBuffFromSearch()">
          <label class="selector-label" for="buff-compare-search-input">搜索添加</label>
          <div class="selector-actions">
            <input
              id="buff-compare-search-input"
              v-model="buffSearchInput"
              type="text"
              class="buff-search-input"
              placeholder="Buff 名 / 3.01朔风"
              spellcheck="false"
            />
            <button type="submit" class="add-btn">添加</button>
          </div>
          <p v-if="inputError" class="input-error">{{ inputError }}</p>
        </form>

        <div v-if="availableEntries.length" class="quick-add">
          <span class="quick-add-label">快捷添加（单个 Buff）</span>
          <div class="quick-add-row">
            <button
              v-for="entry in quickAddInlineEntries"
              :key="entry.id"
              type="button"
              class="quick-add-btn"
              :title="`${entry.phaseDisplay} · ${entry.buff.name}`"
              @click="addEntry(entry)"
            >
              {{ entry.phaseCode }}{{ entry.buff.name }}
            </button>
            <select
              v-if="quickAddDropdownEntries.length"
              v-model="quickAddDropdownValue"
              class="quick-add-select"
              @change="onQuickAddDropdownChange"
            >
              <option value="">更多 Buff</option>
              <option
                v-for="entry in quickAddDropdownEntries"
                :key="entry.id"
                :value="entry.id"
              >
                {{ formatEntryTag(entry) }}
              </option>
            </select>
          </div>
        </div>

        <div v-if="selectedEntries.length" class="selected-summary-row">
          <span class="selected-summary">已选 Buff（{{ selectedEntries.length }}）</span>
          <button type="button" class="clear-btn" @click="clearEntries">清空</button>
        </div>
      </section>

      <p v-if="loadError" class="inline-error">{{ loadError }}</p>

      <div v-if="!selectedEntries.length" class="compare-empty">
        <p>逐个添加 Buff 后，在此对照期数与效果</p>
      </div>

      <div v-else class="phase-list phase-list--compare">
        <article
          v-for="group in comparePhaseGroups"
          :key="group.phaseId"
          class="phase-card phase-card--compare"
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
              class="buff-item buff-item--card buff-item--interactive"
              @mouseenter="hoveredBuffId = entry.id"
              @mouseleave="hoveredBuffId = null"
            >
              <button
                type="button"
                class="buff-remove-btn"
                :class="{ visible: hoveredBuffId === entry.id }"
                :title="`移除 ${formatEntryTag(entry)}`"
                :aria-label="`移除 ${formatEntryTag(entry)}`"
                @click.stop="removeEntry(entry.id)"
              >
                ×
              </button>
              <div class="buff-item-head buff-item-head--card">
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
    </template>
  </div>
</template>

<style scoped>
.buff-compare-panel {
  width: 100%;
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

.buff-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.buff-search-form {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
}

.selector-label,
.quick-add-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.selected-summary-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
}

.selected-summary {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.inline-error {
  margin: 0 0 0.5rem;
  text-align: center;
  font-size: 0.78rem;
  color: #e85d4c;
}

.selector-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.buff-search-input {
  width: 11rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}

.buff-search-input:focus {
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
  min-width: 4.2rem;
  max-width: 8.5rem;
  padding-inline: 0.55rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-add-select {
  flex-shrink: 0;
  min-width: 10rem;
  max-width: 16rem;
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

.status-text,
.compare-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  opacity: 0.75;
  color: var(--color-text);
}

.status-text.error {
  color: #e85d4c;
  opacity: 1;
}

.compare-empty p {
  margin: 0;
}

.phase-list {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0.15rem 0.25rem 0.75rem;
}

.phase-list--compare {
  display: grid;
  grid-template-columns: repeat(2, max-content);
  gap: 0.85rem;
  align-content: start;
  justify-content: start;
  align-items: start;
}

.phase-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background);
  overflow: visible;
}

.phase-card--compare {
  width: max-content;
  max-width: 100%;
  height: fit-content;
  align-self: start;
}

.phase-card-header {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.7rem 0.75rem 0.45rem;
  background: var(--color-background);
}

.phase-card-title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.phase-card-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-heading);
}

.phase-card-id {
  font-size: 0.72rem;
  color: var(--color-text);
  opacity: 0.65;
  white-space: nowrap;
}

.phase-card-date {
  margin: 0;
  font-size: 0.72rem;
  color: var(--color-text);
  opacity: 0.7;
}

.buff-row {
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

.buff-item--card {
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

.buff-item--interactive {
  position: relative;
}

.buff-remove-btn {
  position: absolute;
  top: 0.15rem;
  right: 0.2rem;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: auto;
  padding: 0.1rem;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: var(--color-text);
  font-size: 0.82rem;
  font-weight: 300;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.15s ease,
    visibility 0.15s ease,
    color 0.15s ease;
}

.buff-remove-btn.visible {
  opacity: 0.45;
  visibility: visible;
}

.buff-remove-btn:hover {
  opacity: 0.85;
  color: var(--color-heading);
  background: transparent;
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

.buff-item--card .buff-name {
  margin: 0;
  width: 100%;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--color-heading);
  text-align: center;
  line-height: 1.3;
}

.buff-lines {
  margin: 0;
  padding-left: 0.95rem;
  list-style: disc;
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--color-text);
}

@media (max-width: 1100px) {
  .phase-list--compare {
    grid-template-columns: max-content;
  }
}

@media (max-width: 900px) {
  .buff-row {
    flex-wrap: wrap;
  }
}
</style>
