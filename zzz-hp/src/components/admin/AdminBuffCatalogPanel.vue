<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import {
  deleteBuffRecord,
  searchBuffRecords,
  type BuffRecord,
} from '@/api/admin'
import AdminBuffEditModal from '@/components/admin/AdminBuffEditModal.vue'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import BuffEffectBlocksDisplay from '@/components/calculator/BuffEffectBlocksDisplay.vue'
import { useAdminVersionPhaseSelect } from '@/composables/useAdminVersionPhaseSelect'
import type { AdminBuffSlotContext, AdminScope, RecordScheme } from '@/types/admin'
import { adminScopeTitles, recordSchemeFromScope } from '@/types/admin'
import type { BuffEffectBlock } from '@/types/calculator'
import { normalizeBuffEffectBlocks } from '@/utils/buffEffect'
import { decodeDefenseBuffId, formatDefenseBuffIdSummary, isDefenseBuffId } from '@/utils/defenseId'
import { resolveAssetUrl } from '@/utils/gameData'

/** 展示用：效果块注释与正文相同时去掉，避免重复 */
function blocksForDisplay(
  blocks: BuffEffectBlock[] | null | undefined,
  content: string,
) {
  const normalized = normalizeBuffEffectBlocks(blocks ?? []).filter((b) => b.effects?.length)
  if (!normalized.length) return null
  const text = content.trim()
  return normalized.map((block) => ({
    ...block,
    note: block.note?.trim() && block.note.trim() !== text ? block.note : '',
  }))
}

type CatalogTab = RecordScheme

const catalog = ref<CatalogTab>('crisis')

const scope = computed<AdminScope>(() => {
  if (catalog.value === 'defense') return 'defense-new'
  if (catalog.value === 'deduction') return 'deduction'
  return 'crisis-assault'
})

const {
  version,
  phase,
  customVersion,
  customPhase,
  resolvedVersion,
  resolvedPhase,
  availableVersions,
  availablePhases,
} = useAdminVersionPhaseSelect(toRef(scope), { source: 'buff' })

const keyword = ref('')
const records = ref<BuffRecord[]>([])
const loading = ref(false)
const deletingId = ref<number | null>(null)
const confirmVisible = ref(false)
const pendingRecord = ref<BuffRecord | null>(null)
const confirmMessage = ref('')
const message = ref('')
const error = ref('')

const editOpen = ref(false)
const editContext = ref<AdminBuffSlotContext | null>(null)

const catalogTabs: { id: CatalogTab; label: string; desc: string }[] = [
  { id: 'crisis', label: '危局', desc: '危局强袭战环境 Buff（buff 表）' },
  { id: 'defense', label: '防卫战', desc: '式舆防卫战环境 Buff（buff 表）' },
  { id: 'deduction', label: '临界', desc: '临界推演环境 Buff（buff 表）' },
]

watch(catalog, () => {
  records.value = []
  message.value = ''
  error.value = ''
  keyword.value = ''
})

async function searchRecords() {
  message.value = ''
  error.value = ''
  loading.value = true
  try {
    records.value = await searchBuffRecords({
      version: resolvedVersion.value || undefined,
      phase: resolvedPhase.value || undefined,
      keyword: keyword.value,
      limit: 120,
      recordScheme: recordSchemeFromScope(scope.value) ?? catalog.value,
    })
    if (!records.value.length) message.value = '未找到匹配的 Buff 记录'
  } catch (err) {
    records.value = []
    error.value = err instanceof Error ? err.message : '检索失败'
  } finally {
    loading.value = false
  }
}

function formatRecordMeta(record: BuffRecord) {
  if (catalog.value === 'defense' && isDefenseBuffId(record.id)) {
    return formatDefenseBuffIdSummary(record.id)
  }
  return `版本 ${record.version} · 期数 ${record.phase} · ID ${record.id}`
}

function hasBlocks(record: BuffRecord) {
  return Boolean(blocksForDisplay(record.effect_blocks, record.buff ?? '')?.length)
}

function openCreate() {
  error.value = ''
  message.value = ''
  const ver = resolvedVersion.value || version.value || customVersion.value
  const ph = resolvedPhase.value || phase.value || customPhase.value || '1'
  if (!String(ver).trim()) {
    error.value = '新增前请先选择或填写版本'
    return
  }
  editContext.value = {
    mode: 'create',
    version: String(ver).trim(),
    phase: String(ph).trim() || '1',
    buffIndex: 1,
  }
  editOpen.value = true
}

function openEdit(record: BuffRecord) {
  error.value = ''
  message.value = ''
  let stage: number | undefined
  let roomInStage: number | undefined
  let buffIndex = 1
  if (catalog.value === 'defense' && isDefenseBuffId(record.id)) {
    try {
      const decoded = decodeDefenseBuffId(record.id)
      stage = decoded.stage
      roomInStage = decoded.roomInStage
      buffIndex = decoded.buffIndex
    } catch {
      /* 编码异常时仍可编辑名称/文案/结构 */
    }
  } else if (catalog.value === 'crisis') {
    const idStr = String(record.id)
    const idx = Number(idStr.slice(-2))
    if (Number.isFinite(idx) && idx > 0) buffIndex = idx
  }

  editContext.value = {
    mode: 'edit',
    recordId: record.id,
    version: record.version,
    phase: record.phase,
    buffIndex,
    stage,
    roomInStage,
    buffName: record.buff_name,
    buffText: record.buff ?? '',
    buffImage: record.buff_image,
    effectBlocks: record.effect_blocks ?? null,
  }
  editOpen.value = true
}

function onEditSaved() {
  message.value = 'Buff 已保存'
  void searchRecords()
}

function openDeleteConfirm(record: BuffRecord) {
  pendingRecord.value = record
  confirmMessage.value = [
    `确定删除 Buff「${record.buff_name}」本身吗？`,
    formatRecordMeta(record),
    catalog.value === 'deduction'
      ? '将从 buff 表删除，并同步从同期临界节点增益列表中移除同名项。'
      : '将从 buff 表永久删除该记录（与「从本期移除」不同的是：这是环境库删除）。',
    '此操作不可撤销。',
  ].join('\n')
  confirmVisible.value = true
}

function closeDeleteConfirm() {
  if (deletingId.value !== null) return
  confirmVisible.value = false
  pendingRecord.value = null
}

async function executeDelete() {
  const record = pendingRecord.value
  if (!record) return
  message.value = ''
  error.value = ''
  deletingId.value = record.id
  try {
    const result = await deleteBuffRecord(record.id)
    records.value = records.value.filter((item) => item.id !== record.id)
    const nodeHint =
      result.cleanedNodes && result.cleanedNodes > 0
        ? `（已从 ${result.cleanedNodes} 个节点移除同名增益）`
        : ''
    message.value = `已删除 Buff「${record.buff_name}」${nodeHint}`
    confirmVisible.value = false
    pendingRecord.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="buff-catalog">
    <header class="panel-header">
      <h1 class="panel-title">环境 Buff 管理</h1>
      <p class="panel-desc">
        管理危局 / 防卫战 / 临界的环境 Buff（含结构化效果）。Boss 场地 Buff 请到「怪物基础库」。
        各模式内容页的「从本期/本节点移除」只是去掉当期使用；在本页删除才是删除 Buff 记录本身。
      </p>
    </header>

    <div class="catalog-tabs" role="tablist">
      <button
        v-for="tab in catalogTabs"
        :key="tab.id"
        type="button"
        class="catalog-tab"
        :class="{ active: catalog === tab.id }"
        role="tab"
        :aria-selected="catalog === tab.id"
        @click="catalog = tab.id"
      >
        <strong>{{ tab.label }}</strong>
        <span>{{ tab.desc }}</span>
      </button>
    </div>

    <form class="search-form" @submit.prevent="searchRecords">
      <label class="field">
        <span class="field-label">版本</span>
        <select v-model="version" class="field-input">
          <option value="">全部</option>
          <option v-for="item in availableVersions" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">自定义版本</span>
        <input v-model="customVersion" class="field-input" placeholder="可覆盖上方" />
      </label>
      <label class="field">
        <span class="field-label">期数</span>
        <select v-model="phase" class="field-input">
          <option value="">全部</option>
          <option v-for="item in availablePhases" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">自定义期数</span>
        <input v-model="customPhase" class="field-input" placeholder="可覆盖上方" />
      </label>
      <label class="field field--grow">
        <span class="field-label">名称关键词</span>
        <input v-model="keyword" class="field-input" placeholder="模糊搜索 Buff 名" />
      </label>
      <div class="actions">
        <button type="submit" class="btn primary" :disabled="loading">
          {{ loading ? '检索中…' : '检索' }}
        </button>
        <button type="button" class="btn" :disabled="loading" @click="openCreate">
          新增 {{ adminScopeTitles[scope] }} Buff
        </button>
      </div>
    </form>

    <p v-if="error" class="form-error">{{ error }}</p>
    <p v-else-if="message" class="form-success">{{ message }}</p>

    <ul v-if="records.length" class="record-list">
      <li v-for="record in records" :key="record.id" class="record-card">
        <img
          v-if="record.buff_image"
          class="record-thumb"
          :src="resolveAssetUrl(record.buff_image) || record.buff_image"
          :alt="record.buff_name"
          loading="lazy"
        />
        <div class="record-body">
          <div class="record-title-row">
            <strong>{{ record.buff_name }}</strong>
            <span v-if="hasBlocks(record)" class="badge">已结构化</span>
            <span v-else class="badge badge--muted">无结构</span>
          </div>
          <p class="record-meta">{{ formatRecordMeta(record) }}</p>
          <p v-if="record.buff" class="record-desc">{{ record.buff }}</p>
          <BuffEffectBlocksDisplay
            v-if="hasBlocks(record)"
            class="record-effects"
            compact
            :title="record.buff_name"
            :blocks="blocksForDisplay(record.effect_blocks, record.buff ?? '')"
          />
          <p v-else class="record-effects-empty">暂无结构化增益</p>
        </div>
        <div class="record-actions">
          <button type="button" class="btn" @click="openEdit(record)">编辑</button>
          <button
            type="button"
            class="btn danger"
            :disabled="deletingId === record.id"
            @click="openDeleteConfirm(record)"
          >
            删除
          </button>
        </div>
      </li>
    </ul>

    <AdminBuffEditModal v-model:open="editOpen" :scope="scope" :context="editContext" @saved="onEditSaved" />
    <AdminConfirmDialog
      :visible="confirmVisible"
      title="删除 Buff"
      :message="confirmMessage"
      confirm-text="确认删除"
      danger
      :loading="deletingId !== null"
      @cancel="closeDeleteConfirm"
      @confirm="executeDelete"
    />
  </div>
</template>

<style scoped>
.buff-catalog {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.panel-header {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.panel-title {
  margin: 0;
  font-size: 1.45rem;
}

.panel-desc {
  margin: 0;
  opacity: 0.75;
  font-size: 0.9rem;
  line-height: 1.45;
  max-width: 52rem;
}

.catalog-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.catalog-tab {
  text-align: left;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  color: var(--color-text);
  padding: 0.75rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  cursor: pointer;
}

.catalog-tab span {
  font-size: 0.78rem;
  opacity: 0.7;
}

.catalog-tab.active {
  border-color: #c4a35a;
  box-shadow: inset 0 0 0 1px #c4a35a;
}

.search-form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.75rem;
  align-items: end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.field--grow {
  grid-column: span 2;
}

.field-label {
  font-size: 0.8rem;
  opacity: 0.75;
}

.field-input {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.45rem 0.55rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  grid-column: 1 / -1;
}

.btn {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-text);
  padding: 0.45rem 0.75rem;
  cursor: pointer;
}

.btn.primary {
  background: #c4a35a;
  border-color: #c4a35a;
  color: #1a1510;
}

.btn.danger {
  border-color: #b54a4a;
  color: #ffb4b4;
}

.form-error {
  color: #ff8e8e;
  margin: 0;
}

.form-success {
  color: #8fd49a;
  margin: 0;
}

.record-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.record-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: start;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 0.75rem;
  background: var(--color-background-soft);
}

.record-thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
}

.record-title-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}

.badge {
  font-size: 0.72rem;
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  background: rgba(143, 212, 154, 0.2);
  color: #8fd49a;
}

.badge--muted {
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  opacity: 0.7;
}

.record-meta {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  opacity: 0.7;
}

.record-desc {
  margin: 0.4rem 0 0;
  font-size: 0.85rem;
  line-height: 1.4;
  white-space: pre-wrap;
  opacity: 0.9;
}

.record-effects {
  margin-top: 0.5rem;
}

.record-effects-empty {
  margin: 0.4rem 0 0;
  font-size: 0.78rem;
  opacity: 0.55;
}

.record-actions {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

@media (max-width: 720px) {
  .catalog-tabs {
    grid-template-columns: 1fr;
  }
  .field--grow {
    grid-column: span 1;
  }
  .record-card {
    grid-template-columns: 1fr;
  }
  .record-actions {
    flex-direction: row;
  }
}
</style>
