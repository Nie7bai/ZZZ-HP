<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  createSeasonDate,
  deleteSeasonDate,
  fetchSeasonDates,
  updateSeasonDate,
  type SeasonDateMode,
  type SeasonDateRecord,
} from '@/api/admin'
import type { AdminScope } from '@/types/admin'
import { isDefenseScope } from '@/types/admin'

const props = defineProps<{
  scope: AdminScope
}>()

const mode = computed<SeasonDateMode>(() =>
  isDefenseScope(props.scope) ? 'defense' : 'crisis',
)

const modeTitle = computed(() =>
  mode.value === 'defense' ? '式舆防卫战' : '危局强袭战',
)

const rows = ref<SeasonDateRecord[]>([])
const loading = ref(false)
const error = ref('')
const message = ref('')
const submitting = ref(false)

const editingId = ref<number | null>(null)
const version = ref('')
const phase = ref('')
const customVersion = ref('')
const customPhase = ref('')
const startDate = ref('')
const endDate = ref('')

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

const availableVersions = computed(() => {
  const set = new Set(rows.value.map((row) => row.version).filter(Boolean))
  return [...set].sort(compareVersionDesc)
})

const availablePhases = computed(() => {
  const currentVersion = (customVersion.value.trim() || version.value).trim()
  if (!currentVersion) return []
  const set = new Set(
    rows.value
      .filter((row) => row.version === currentVersion)
      .map((row) => String(row.phase))
      .filter(Boolean),
  )
  return [...set].sort((a, b) => Number(b) - Number(a))
})

const resolvedVersion = computed(() => customVersion.value.trim() || version.value.trim())
const resolvedPhase = computed(() => customPhase.value.trim() || phase.value.trim())

function applyDefaultVersionPhase() {
  if (editingId.value != null) return
  const latestVersion = availableVersions.value[0] ?? ''
  if (!version.value && latestVersion) version.value = latestVersion
  const phases = availablePhases.value
  if (!phase.value && phases.length) phase.value = phases[0] ?? ''
}

async function loadRows() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await fetchSeasonDates(mode.value)
    applyDefaultVersionPhase()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
    rows.value = []
  } finally {
    loading.value = false
  }
}

function resetForm() {
  editingId.value = null
  version.value = ''
  phase.value = ''
  customVersion.value = ''
  customPhase.value = ''
  startDate.value = ''
  endDate.value = ''
  applyDefaultVersionPhase()
}

function startEdit(row: SeasonDateRecord) {
  editingId.value = row.id
  version.value = row.version
  phase.value = row.phase
  customVersion.value = ''
  customPhase.value = ''
  startDate.value = row.startDate || ''
  endDate.value = row.endDate || ''
  message.value = ''
  error.value = ''
}

async function submitForm() {
  message.value = ''
  error.value = ''
  if (!resolvedVersion.value || !resolvedPhase.value || !startDate.value || !endDate.value) {
    error.value = '版本、期数、开始/结束日期均为必填'
    return
  }

  submitting.value = true
  try {
    const payload = {
      mode: mode.value,
      version: resolvedVersion.value,
      phase: resolvedPhase.value,
      startDate: startDate.value,
      endDate: endDate.value,
    }
    if (editingId.value != null) {
      await updateSeasonDate(editingId.value, payload)
      message.value = '版本日期已更新'
    } else {
      await createSeasonDate(payload)
      message.value = '版本日期已新增'
    }
    resetForm()
    await loadRows()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    submitting.value = false
  }
}

async function onDelete(row: SeasonDateRecord) {
  if (!window.confirm(`确认删除 ${row.version} 第 ${row.phase} 期？`)) return
  error.value = ''
  message.value = ''
  try {
    await deleteSeasonDate(row.id)
    if (editingId.value === row.id) resetForm()
    message.value = '已删除'
    await loadRows()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

watch(
  () => props.scope,
  () => {
    resetForm()
    loadRows()
  },
)

watch([version, customVersion], () => {
  if (editingId.value != null) return
  const phases = availablePhases.value
  if (phase.value && !phases.includes(phase.value)) {
    phase.value = phases[0] ?? ''
  } else if (!phase.value && phases.length) {
    phase.value = phases[0] ?? ''
  }
})

onMounted(loadRows)
</script>

<template>
  <div class="admin-form-panel">
    <div class="panel-freeze">
      <header class="panel-header">
        <h1 class="panel-title">版本日期管理</h1>
        <p class="panel-desc">当前模式：{{ modeTitle }}（仅显示本模式记录）</p>
      </header>

      <form class="admin-form" novalidate @submit.prevent="submitForm">
        <div class="field-row">
          <label class="field">
            <span class="field-label">版本 *</span>
            <select v-model="version" class="field-input">
              <option v-if="!availableVersions.length" value="" disabled>暂无可选版本</option>
              <option v-for="item in availableVersions" :key="item" :value="item">
                {{ item }}
              </option>
            </select>
            <input
              v-model="customVersion"
              type="text"
              class="field-input field-input--secondary"
              placeholder="新版本（填写后覆盖上方选择）"
            />
          </label>
          <label class="field">
            <span class="field-label">期数 *</span>
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
              class="field-input field-input--secondary"
              placeholder="新期数（填写后覆盖上方选择）"
            />
          </label>
        </div>
        <div class="field-row">
          <label class="field">
            <span class="field-label">开始日期 *</span>
            <input v-model="startDate" type="date" class="field-input" />
          </label>
          <label class="field">
            <span class="field-label">结束日期 *</span>
            <input v-model="endDate" type="date" class="field-input" />
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="submit-btn" :disabled="submitting">
            {{ submitting ? '保存中…' : editingId != null ? '保存修改' : '新增期数' }}
          </button>
          <button v-if="editingId != null" type="button" class="ghost-btn" @click="resetForm">
            取消编辑
          </button>
        </div>
        <p v-if="message" class="form-success">{{ message }}</p>
        <p v-if="error" class="form-error">{{ error }}</p>
      </form>
    </div>

    <p v-if="loading" class="status">加载中…</p>
    <div v-else class="table-wrap">
      <table class="date-table">
        <thead>
          <tr>
            <th>版本</th>
            <th>期数</th>
            <th>开始</th>
            <th>结束</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!rows.length">
            <td colspan="5" class="empty">暂无记录</td>
          </tr>
          <tr v-for="row in rows" :key="row.id">
            <td>{{ row.version }}</td>
            <td>第 {{ row.phase }} 期</td>
            <td>{{ row.startDate || '—' }}</td>
            <td>{{ row.endDate || '—' }}</td>
            <td class="actions">
              <button type="button" class="link-btn" @click="startEdit(row)">编辑</button>
              <button type="button" class="link-btn danger" @click="onDelete(row)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.admin-form-panel {
  max-width: 860px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-freeze {
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--color-background);
  padding-bottom: 0.25rem;
}

.panel-header {
  margin-bottom: 1rem;
}

.panel-title {
  margin: 0;
  font-size: 1.4rem;
  color: var(--color-heading);
}

.panel-desc {
  margin: 0.35rem 0 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.admin-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.85rem;
  color: var(--color-heading);
}

.field-input {
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
}

.field-input--secondary {
  font-size: 0.85rem;
}

.form-actions {
  display: flex;
  gap: 0.6rem;
}

.submit-btn,
.ghost-btn {
  padding: 0.55rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  cursor: pointer;
}

.submit-btn {
  background: hsla(160, 100%, 37%, 0.18);
  border-color: hsla(160, 100%, 37%, 0.45);
  color: var(--color-heading);
  font-weight: 600;
}

.ghost-btn {
  background: transparent;
  color: var(--color-text);
}

.form-success {
  color: #3dd68c;
  margin: 0;
}

.form-error {
  color: #f87171;
  margin: 0;
}

.status {
  opacity: 0.7;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.date-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}

.date-table th,
.date-table td {
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
}

.date-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-background-soft);
  color: var(--color-heading);
}

.empty {
  text-align: center;
  opacity: 0.6;
}

.actions {
  display: flex;
  gap: 0.65rem;
}

.link-btn {
  border: none;
  background: transparent;
  color: #6eb6ff;
  cursor: pointer;
  padding: 0;
}

.link-btn.danger {
  color: #f87171;
}

@media (max-width: 720px) {
  .field-row {
    grid-template-columns: 1fr;
  }
}
</style>
