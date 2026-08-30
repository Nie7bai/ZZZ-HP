<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchBossInfoList, lookupBossInfo, type BossInfoRecord } from '@/api/bossInfo'
import { searchBossRecords, type BossRecord } from '@/api/admin'
import { fetchCrisisAssaultPhases } from '@/api/crisisAssault'
import { fetchDefenseSeasons } from '@/api/defense'
import type { DamageEnemyInput } from '@/utils/enemyResistance'
import {
  mapBossInfoToDamageEnemyInput,
  mapBossRecordToDamageEnemyInput,
} from '@/utils/enemyInputFromBoss'
import { hasBossDisplayImage, resolveAssetUrl } from '@/utils/gameData'

type PickerTab = 'catalog' | 'record'
type RecordScheme = 'crisis' | 'defense'

const props = defineProps<{
  open: boolean
  currentInput: DamageEnemyInput
}>()

const emit = defineEmits<{
  close: []
  apply: [value: DamageEnemyInput]
}>()

const activeTab = ref<PickerTab>('catalog')
const catalogKeyword = ref('')
const catalogItems = ref<BossInfoRecord[]>([])
const catalogLoading = ref(false)
const catalogError = ref('')

const recordScheme = ref<RecordScheme>('crisis')
const recordVersion = ref('')
const recordPhase = ref('')
const recordKeyword = ref('')
const recordResults = ref<BossRecord[]>([])
const recordLoading = ref(false)
const recordError = ref('')

const applying = ref(false)
const brokenCatalogIds = ref(new Set<number>())
const brokenRecordIds = ref(new Set<number>())
const bossImageByName = ref(new Map<string, string>())

let catalogTimer: ReturnType<typeof setTimeout> | null = null
let applyingRecordDefaults = false

const modalTitle = computed(() =>
  activeTab.value === 'catalog' ? '选择怪物 · 基础库' : '选择怪物 · 期数记录',
)

const visibleCatalogItems = computed(() =>
  catalogItems.value.filter((item) => !brokenCatalogIds.value.has(item.id)),
)

function resolveRecordImage(record: BossRecord): string | null | undefined {
  if (hasBossDisplayImage(record.boss_image)) return record.boss_image
  return bossImageByName.value.get(record.boss_name) ?? null
}

const visibleRecordResults = computed(() =>
  recordResults.value.filter((record) => {
    if (brokenRecordIds.value.has(record.id)) return false
    return hasBossDisplayImage(resolveRecordImage(record))
  }),
)

function compareVersionDesc(a: string, b: string) {
  const parse = (value: string) =>
    value.split('.').map((part) => Number(part.replace(/\D/g, '')) || 0)
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (right[i] ?? 0) - (left[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function normalizePhaseNum(phase: string) {
  const text = String(phase ?? '').trim()
  return text.replace(/\D/g, '') || text
}

function pickLatestPublicPhase(
  items: Array<{ version: string; phase: string; isHidden?: boolean }>,
): { version: string; phase: string } | null {
  const visible = items.filter((item) => !item.isHidden)
  const pool = visible.length ? visible : items
  if (!pool.length) return null
  const sorted = pool.slice().sort((a, b) => {
    const versionDiff = compareVersionDesc(a.version || '', b.version || '')
    if (versionDiff !== 0) return versionDiff
    return Number(normalizePhaseNum(b.phase)) - Number(normalizePhaseNum(a.phase))
  })
  const top = sorted[0]
  if (!top) return null
  return {
    version: top.version,
    phase: normalizePhaseNum(top.phase),
  }
}

async function applyLatestRecordDefaults() {
  applyingRecordDefaults = true
  try {
    if (recordScheme.value === 'crisis') {
      const phases = await fetchCrisisAssaultPhases()
      const latest = pickLatestPublicPhase(
        phases.map((phase) => ({
          version: phase.version,
          phase: phase.phase,
          isHidden: Boolean(phase.isHidden),
        })),
      )
      recordVersion.value = latest?.version ?? ''
      recordPhase.value = latest?.phase ?? ''
      return
    }

    const [defenseNew, defenseOld] = await Promise.all([
      fetchDefenseSeasons('new'),
      fetchDefenseSeasons('old'),
    ])
    const latest = pickLatestPublicPhase(
      [...defenseNew, ...defenseOld].map((season) => ({
        version: season.version,
        phase: season.phase,
        isHidden: Boolean(season.isHidden),
      })),
    )
    recordVersion.value = latest?.version ?? ''
    recordPhase.value = latest?.phase ?? ''
  } catch {
    // 保留已有输入；检索时再提示错误
  } finally {
    applyingRecordDefaults = false
  }
}

async function openRecordTab() {
  await applyLatestRecordDefaults()
  await searchRecords()
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    catalogError.value = ''
    recordError.value = ''
    brokenCatalogIds.value = new Set()
    brokenRecordIds.value = new Set()
    if (activeTab.value === 'catalog') {
      loadCatalogList()
    } else {
      void openRecordTab()
    }
  },
)

watch(activeTab, (tab) => {
  if (!props.open) return
  if (tab === 'catalog') loadCatalogList()
  else void openRecordTab()
})

watch(recordScheme, () => {
  if (!props.open || activeTab.value !== 'record' || applyingRecordDefaults) return
  void openRecordTab()
})

function rememberBossImages(items: BossInfoRecord[]) {
  const next = new Map(bossImageByName.value)
  for (const item of items) {
    if (hasBossDisplayImage(item.boss_image)) {
      next.set(item.boss_name, item.boss_image!.trim())
    }
  }
  bossImageByName.value = next
}

async function loadCatalogList() {
  catalogLoading.value = true
  catalogError.value = ''
  brokenCatalogIds.value = new Set()
  try {
    const result = await fetchBossInfoList({
      keyword: catalogKeyword.value.trim(),
      limit: 120,
      offset: 0,
    })
    const withImage = result.items.filter((item) => hasBossDisplayImage(item.boss_image))
    catalogItems.value = withImage
    rememberBossImages(withImage)
    if (!withImage.length) {
      catalogError.value = catalogKeyword.value.trim()
        ? '未找到带图片的匹配怪物'
        : '基础库暂无有图片的怪物'
    }
  } catch (error) {
    catalogItems.value = []
    catalogError.value = error instanceof Error ? error.message : '加载失败'
  } finally {
    catalogLoading.value = false
  }
}

function scheduleCatalogSearch() {
  if (catalogTimer) clearTimeout(catalogTimer)
  catalogTimer = setTimeout(loadCatalogList, 280)
}

watch(catalogKeyword, scheduleCatalogSearch)

function markCatalogImageBroken(id: number) {
  brokenCatalogIds.value = new Set([...brokenCatalogIds.value, id])
}

function markRecordImageBroken(id: number) {
  brokenRecordIds.value = new Set([...brokenRecordIds.value, id])
}

async function applyCatalogItem(item: BossInfoRecord) {
  applying.value = true
  try {
    const info = await lookupBossInfo(item.boss_name)
    if (!info) {
      catalogError.value = '怪物数据不存在'
      return
    }
    emit('apply', mapBossInfoToDamageEnemyInput(info, props.currentInput))
    emit('close')
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : '应用失败'
  } finally {
    applying.value = false
  }
}

async function searchRecords() {
  recordLoading.value = true
  recordError.value = ''
  brokenRecordIds.value = new Set()
  try {
    if (!bossImageByName.value.size) {
      const result = await fetchBossInfoList({ limit: 500, offset: 0 })
      rememberBossImages(result.items.filter((item) => hasBossDisplayImage(item.boss_image)))
    }

    const results = await searchBossRecords({
      recordScheme: recordScheme.value,
      version: recordVersion.value.trim() || undefined,
      phase: recordPhase.value.trim() || undefined,
      keyword: recordKeyword.value.trim() || undefined,
      limit: 50,
    })
    recordResults.value = results

    const withImage = results.filter((record) => hasBossDisplayImage(resolveRecordImage(record)))
    if (!results.length) {
      recordError.value = '未找到匹配的期数记录'
    } else if (!withImage.length) {
      recordError.value = '未找到带图片的期数记录'
    }
  } catch (error) {
    recordResults.value = []
    recordError.value = error instanceof Error ? error.message : '检索失败'
  } finally {
    recordLoading.value = false
  }
}

async function applyRecord(record: BossRecord) {
  applying.value = true
  recordError.value = ''
  try {
    const info = await lookupBossInfo(record.boss_name)
    emit('apply', mapBossRecordToDamageEnemyInput(record, info, props.currentInput))
    emit('close')
  } catch (error) {
    recordError.value = error instanceof Error ? error.message : '应用失败'
  } finally {
    applying.value = false
  }
}

function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="boss-picker-overlay" role="presentation" @click.self="close">
      <div class="boss-picker-modal" role="dialog" aria-modal="true" :aria-label="modalTitle">
        <header class="boss-picker-header">
          <div>
            <h3>{{ modalTitle }}</h3>
            <p>选中后自动填入防御、弱点/抗性、失衡易伤；不改动代理人等级。</p>
          </div>
          <button type="button" class="close-btn" aria-label="关闭" :disabled="applying" @click="close">
            ×
          </button>
        </header>

        <div class="mode-tabs">
          <button
            type="button"
            class="mode-tab"
            :class="{ active: activeTab === 'catalog' }"
            @click="activeTab = 'catalog'"
          >
            基础库
          </button>
          <button
            type="button"
            class="mode-tab"
            :class="{ active: activeTab === 'record' }"
            @click="activeTab = 'record'"
          >
            期数记录
          </button>
        </div>

        <div v-if="activeTab === 'catalog'" class="boss-picker-body">
          <input
            v-model="catalogKeyword"
            type="search"
            class="search-input"
            placeholder="搜索怪物名称…"
          />

          <p v-if="catalogLoading" class="status-text">加载中…</p>
          <p v-else-if="catalogError" class="error-text">{{ catalogError }}</p>

          <div v-else class="boss-grid">
            <button
              v-for="item in visibleCatalogItems"
              :key="item.id"
              type="button"
              class="boss-card"
              :disabled="applying"
              @click="applyCatalogItem(item)"
            >
              <img
                class="boss-thumb"
                :src="resolveAssetUrl(item.boss_image)"
                :alt="item.boss_name"
                loading="lazy"
                @error="markCatalogImageBroken(item.id)"
              />
              <span class="boss-name">{{ item.boss_name }}</span>
              <span class="boss-meta">防御 {{ item.defense }} · 失衡 {{ item.stagger_multiplier ?? 1.5 }}</span>
              <span v-if="item.weakness" class="boss-trait weak">弱 {{ item.weakness }}</span>
              <span v-if="item.resistance" class="boss-trait res">抗 {{ item.resistance }}</span>
            </button>
          </div>
        </div>

        <div v-else class="boss-picker-body">
          <div class="record-filters">
            <label class="filter-field">
              <span>模式</span>
              <select v-model="recordScheme">
                <option value="crisis">危局</option>
                <option value="defense">防卫战</option>
              </select>
            </label>
            <label class="filter-field">
              <span>版本</span>
              <input v-model="recordVersion" type="text" placeholder="3.1" />
            </label>
            <label class="filter-field">
              <span>期数</span>
              <input v-model="recordPhase" type="text" placeholder="1" />
            </label>
            <label class="filter-field grow">
              <span>名称</span>
              <input v-model="recordKeyword" type="search" placeholder="关键词" />
            </label>
            <button type="button" class="search-btn" :disabled="recordLoading" @click="searchRecords">
              {{ recordLoading ? '检索中…' : '检索' }}
            </button>
          </div>

          <p v-if="recordError" class="error-text">{{ recordError }}</p>

          <ul v-if="visibleRecordResults.length" class="record-list">
            <li v-for="item in visibleRecordResults" :key="item.id">
              <button type="button" class="record-row" :disabled="applying" @click="applyRecord(item)">
                <img
                  class="record-thumb"
                  :src="resolveAssetUrl(resolveRecordImage(item))"
                  :alt="item.boss_name"
                  loading="lazy"
                  @error="markRecordImageBroken(item.id)"
                />
                <div class="record-copy">
                  <strong>{{ item.boss_name }}</strong>
                  <span>
                    {{ item.version }} 第{{ item.phase }}期
                    <template v-if="item.room"> · {{ item.room }}</template>
                    · 防御 {{ item.defense }}
                  </span>
                </div>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.boss-picker-overlay {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: rgba(0, 0, 0, 0.58);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.boss-picker-modal {
  width: min(720px, 100%);
  max-height: min(88vh, 820px);
  display: flex;
  flex-direction: column;
  border: 1px solid #3a4455;
  border-radius: 14px;
  background: #0f1217;
  box-shadow: 0 20px 56px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.boss-picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem 0.75rem;
  border-bottom: 1px solid #2d323a;
}

.boss-picker-header h3 {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  color: #e8d4a8;
}

.boss-picker-header p {
  margin: 0;
  font-size: 0.78rem;
  color: #9aa3b2;
}

.close-btn {
  border: none;
  background: transparent;
  color: #c5cdd8;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.8;
}

.close-btn:hover:not(:disabled) {
  opacity: 1;
}

.mode-tabs {
  display: flex;
  gap: 0.35rem;
  padding: 0.65rem 1rem 0;
}

.mode-tab {
  border: 1px solid #2d323a;
  border-radius: 999px;
  background: #141820;
  color: #c5cdd8;
  padding: 0.28rem 0.85rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.mode-tab.active {
  border-color: #c9a55c;
  color: #e8d4a8;
  background: rgba(201, 165, 92, 0.12);
}

.boss-picker-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.75rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.search-input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  border: 1px solid #2d323a;
  background: #141820;
  color: #e8eaed;
}

.boss-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 0.55rem;
}

.boss-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.65rem 0.5rem;
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #141820;
  cursor: pointer;
  text-align: center;
  transition:
    border-color 0.18s,
    background-color 0.18s;
}

.boss-card:hover:not(:disabled) {
  border-color: #c9a55c;
  background: #181d26;
}

.boss-card:disabled {
  opacity: 0.6;
  cursor: wait;
}

.boss-thumb {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  border: 1px solid #343a44;
  object-fit: cover;
  background: #1f2736;
}

.boss-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #e8eaed;
  line-height: 1.25;
}

.boss-meta {
  font-size: 0.72rem;
  color: #9aa3b2;
}

.boss-trait {
  font-size: 0.68rem;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.boss-trait.weak {
  color: #8fd4ff;
  background: rgba(143, 212, 255, 0.1);
}

.boss-trait.res {
  color: #ffb4a2;
  background: rgba(255, 180, 162, 0.1);
}

.record-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: end;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 88px;
}

.filter-field.grow {
  flex: 1 1 140px;
}

.filter-field span {
  font-size: 0.72rem;
  color: #9aa3b2;
}

.filter-field input,
.filter-field select {
  padding: 0.38rem 0.5rem;
  border-radius: 8px;
  border: 1px solid #2d323a;
  background: #141820;
  color: #e8eaed;
}

.search-btn {
  border: 1px solid #c9a55c;
  border-radius: 8px;
  background: rgba(201, 165, 92, 0.14);
  color: #e8d4a8;
  padding: 0.4rem 0.85rem;
  font-size: 0.82rem;
  cursor: pointer;
}

.record-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.record-row {
  width: 100%;
  text-align: left;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #141820;
  padding: 0.5rem 0.65rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.record-thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  border: 1px solid #343a44;
  object-fit: cover;
  background: #1f2736;
  flex-shrink: 0;
}

.record-copy {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.record-row strong {
  font-size: 0.86rem;
  color: #e8eaed;
}

.record-row span {
  font-size: 0.76rem;
  color: #9aa3b2;
}

.record-row:hover:not(:disabled) {
  border-color: #c9a55c;
}

.status-text {
  margin: 0;
  font-size: 0.82rem;
  color: #9aa3b2;
}

.error-text {
  margin: 0;
  font-size: 0.82rem;
  color: #e57373;
}
</style>
