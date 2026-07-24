<script setup lang="ts">
import { ref, toRef } from 'vue'
import { deleteBuffRecord, searchBuffRecords } from '@/api/admin'
import type { BuffRecord } from '@/api/admin'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import { useAdminVersionPhaseSelect } from '@/composables/useAdminVersionPhaseSelect'
import type { AdminScope } from '@/types/admin'
import { adminScopeTitles, isDefenseScope, recordSchemeFromScope } from '@/types/admin'
import { formatDefenseBuffIdSummary, isDefenseBuffId } from '@/utils/defenseId'
import { resolveAssetUrl } from '@/utils/gameData'

const props = defineProps<{
  scope: AdminScope
}>()

const {
  version,
  phase,
  customVersion,
  customPhase,
  resolvedVersion,
  resolvedPhase,
  availableVersions,
  availablePhases,
} = useAdminVersionPhaseSelect(toRef(props, 'scope'), { source: 'buff' })

const keyword = ref('')
const records = ref<BuffRecord[]>([])
const loading = ref(false)
const deletingId = ref<number | null>(null)
const confirmVisible = ref(false)
const pendingRecord = ref<BuffRecord | null>(null)
const confirmMessage = ref('')
const message = ref('')
const error = ref('')

async function searchRecords() {
  message.value = ''
  error.value = ''
  loading.value = true

  try {
    records.value = await searchBuffRecords({
      version: resolvedVersion.value,
      phase: resolvedPhase.value,
      keyword: keyword.value,
      limit: 80,
      recordScheme: recordSchemeFromScope(props.scope) ?? undefined,
    })
    if (records.value.length === 0) {
      message.value = '未找到匹配的 Buff 记录'
    }
  } catch (err) {
    records.value = []
    error.value = err instanceof Error ? err.message : '检索失败'
  } finally {
    loading.value = false
  }
}

function formatRecordMeta(record: BuffRecord) {
  if (isDefenseScope(props.scope) && isDefenseBuffId(record.id)) {
    return formatDefenseBuffIdSummary(record.id)
  }
  return `版本 ${record.version} · 期数 ${record.phase} · ID ${record.id}`
}

function openDeleteConfirm(record: BuffRecord) {
  pendingRecord.value = record
  confirmMessage.value = [
    `确定删除 Buff「${record.buff_name}」吗？`,
    formatRecordMeta(record),
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
    await deleteBuffRecord(record.id)
    records.value = records.value.filter((item) => item.id !== record.id)
    message.value = `已删除 Buff「${record.buff_name}」`
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
  <div class="admin-form-panel">
    <header class="panel-header">
      <h1 class="panel-title">删除 Buff</h1>
      <p class="panel-desc">当前模式：{{ adminScopeTitles[scope] }}</p>
    </header>

    <form class="admin-form" @submit.prevent="searchRecords">
      <label class="field">
        <span class="field-label">版本</span>
        <select v-model="version" class="field-input">
          <option v-if="!availableVersions.length" value="" disabled>暂无可选版本</option>
          <option v-for="item in availableVersions" :key="item" :value="item">
            {{ item }}
          </option>
        </select>
        <input
          v-model="customVersion"
          type="text"
          class="field-input"
          placeholder="新版本（填写后覆盖上方选择）"
        />
      </label>

      <label class="field">
        <span class="field-label">期数</span>
        <select v-model="phase" class="field-input">
          <option v-if="!availablePhases.length" value="" disabled>
            {{ resolvedVersion ? '该版本暂无期数，可在下方输入' : '请先选择版本' }}
          </option>
          <option v-for="item in availablePhases" :key="item" :value="item">
            第 {{ item }} 期
          </option>
        </select>
        <input
          v-model="customPhase"
          type="text"
          class="field-input"
          placeholder="新期数（填写后覆盖上方选择）"
        />
      </label>

      <label class="field">
        <span class="field-label">Buff 名称</span>
        <input v-model="keyword" type="text" class="field-input" placeholder="支持模糊搜索" />
      </label>

      <button type="submit" class="submit-btn" :disabled="loading">
        {{ loading ? '检索中...' : '检索' }}
      </button>
    </form>

    <p v-if="error" class="form-error">{{ error }}</p>
    <p v-if="message" class="form-success">{{ message }}</p>

    <ul v-if="records.length" class="record-list">
      <li v-for="record in records" :key="record.id" class="record-item">
        <img
          v-if="record.buff_image"
          :src="resolveAssetUrl(record.buff_image) ?? ''"
          :alt="record.buff_name"
          class="record-thumb"
        />
        <div class="record-main">
          <p class="record-title">{{ record.buff_name }}</p>
          <p class="record-meta">{{ formatRecordMeta(record) }}</p>
          <p v-if="record.buff" class="record-desc">{{ record.buff }}</p>
        </div>
        <button
          type="button"
          class="delete-btn"
          :disabled="deletingId === record.id"
          @click="openDeleteConfirm(record)"
        >
          {{ deletingId === record.id ? '删除中...' : '删除' }}
        </button>
      </li>
    </ul>

    <AdminConfirmDialog
      :visible="confirmVisible"
      title="确认删除 Buff"
      :message="confirmMessage"
      confirm-text="删除"
      :danger="true"
      :loading="deletingId !== null"
      @confirm="executeDelete"
      @cancel="closeDeleteConfirm"
    />
  </div>
</template>

<style scoped>
.admin-form-panel {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
}

.panel-header {
  margin-bottom: 1.25rem;
  text-align: center;
}

.panel-title {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 1.85rem);
  font-weight: 700;
  color: var(--color-heading);
}

.panel-desc {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
}

.admin-form {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-bottom: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.field-input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
}

.field > .field-input + .field-input {
  margin-top: 0;
}

.field-input:focus {
  border-color: #e8a838;
}

.submit-btn,
.delete-btn {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.submit-btn {
  align-self: center;
  min-width: 8rem;
  padding: 0.55rem 1.2rem;
  font-size: 0.9rem;
}

.delete-btn {
  flex-shrink: 0;
  padding: 0.45rem 0.9rem;
  font-size: 0.82rem;
}

.submit-btn:hover:not(:disabled),
.delete-btn:hover:not(:disabled) {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.delete-btn:hover:not(:disabled) {
  border-color: #e85d4c;
  color: #e85d4c;
}

.submit-btn:disabled,
.delete-btn:disabled {
  opacity: 0.65;
  cursor: default;
}

.form-error {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  color: #e85d4c;
}

.form-success {
  margin: 0 0 0.75rem;
  font-size: 0.82rem;
  color: #e8a838;
}

.record-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.record-item {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
}

.record-thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  flex-shrink: 0;
}

.record-main {
  flex: 1;
  min-width: 0;
}

.record-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-heading);
}

.record-meta {
  margin: 0.2rem 0 0;
  font-size: 0.76rem;
  color: var(--color-text);
  opacity: 0.75;
}

.record-desc {
  margin: 0.35rem 0 0;
  font-size: 0.76rem;
  color: var(--color-text);
  opacity: 0.85;
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

@media (max-width: 640px) {
  .record-item {
    flex-wrap: wrap;
  }

  .delete-btn {
    width: 100%;
  }
}
</style>
