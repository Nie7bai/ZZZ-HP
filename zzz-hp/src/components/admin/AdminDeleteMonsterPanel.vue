<script setup lang="ts">
import { ref } from 'vue'
import { deleteBossRecord, searchBossRecords } from '@/api/admin'
import type { BossRecord } from '@/api/admin'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import type { AdminScope } from '@/types/admin'
import { adminScopeTitles, isDefenseScope, recordSchemeFromScope } from '@/types/admin'
import { formatDefenseBossIdSummary, isDefenseBossId } from '@/utils/defenseId'
import { resolveAssetUrl } from '@/utils/gameData'

const props = defineProps<{
  scope: AdminScope
}>()

const version = ref('')
const phase = ref('')
const keyword = ref('')
const records = ref<BossRecord[]>([])
const loading = ref(false)
const deletingId = ref<number | null>(null)
const confirmVisible = ref(false)
const pendingRecord = ref<BossRecord | null>(null)
const confirmMessage = ref('')
const message = ref('')
const error = ref('')

async function searchRecords() {
  message.value = ''
  error.value = ''
  loading.value = true

  try {
    records.value = await searchBossRecords({
      version: version.value,
      phase: phase.value,
      keyword: keyword.value,
      limit: 80,
      recordScheme: recordSchemeFromScope(props.scope) ?? undefined,
    })
    if (records.value.length === 0) {
      message.value = '未找到匹配的怪物记录'
    }
  } catch (err) {
    records.value = []
    error.value = err instanceof Error ? err.message : '检索失败'
  } finally {
    loading.value = false
  }
}

function formatRecordMeta(record: BossRecord) {
  if (isDefenseScope(props.scope) && isDefenseBossId(record.id)) {
    return formatDefenseBossIdSummary(record.id)
  }
  return `版本 ${record.version} · 期数 ${record.phase} · 房间 ${record.room ?? '-'} · ID ${record.id}`
}

function openDeleteConfirm(record: BossRecord) {
  pendingRecord.value = record
  confirmMessage.value = [
    `确定删除怪物「${record.boss_name}」吗？`,
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
    await deleteBossRecord(record.id)
    records.value = records.value.filter((item) => item.id !== record.id)
    message.value = `已删除怪物「${record.boss_name}」`
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
      <h1 class="panel-title">删除怪物</h1>
      <p class="panel-desc">当前模式：{{ adminScopeTitles[scope] }}</p>
    </header>

    <form class="admin-form" @submit.prevent="searchRecords">
      <div class="field-row">
        <label class="field">
          <span class="field-label">版本</span>
          <input v-model="version" type="text" class="field-input" placeholder="如 3.0" />
        </label>
        <label class="field">
          <span class="field-label">期数</span>
          <input v-model="phase" type="text" class="field-input" placeholder="如 4" />
        </label>
      </div>

      <label class="field">
        <span class="field-label">怪物名称</span>
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
          v-if="record.boss_image"
          :src="resolveAssetUrl(record.boss_image) ?? ''"
          :alt="record.boss_name"
          class="record-thumb"
        />
        <div class="record-main">
          <p class="record-title">{{ record.boss_name }}</p>
          <p class="record-meta">{{ formatRecordMeta(record) }}</p>
          <p class="record-meta">血量 {{ record.hp }} · 防御 {{ record.defense }} · 等级 {{ record.level }}</p>
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
      title="确认删除怪物"
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

.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
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
  align-items: center;
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

@media (max-width: 640px) {
  .field-row {
    grid-template-columns: 1fr;
  }

  .record-item {
    flex-wrap: wrap;
  }

  .delete-btn {
    width: 100%;
  }
}
</style>
