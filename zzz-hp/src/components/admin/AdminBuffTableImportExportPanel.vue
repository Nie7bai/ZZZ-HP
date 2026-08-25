<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import {
  fetchBuffTableSnapshot,
  importBuffTableSnapshotFile,
  type BuffTableImportSummary,
  type BuffTableMode,
  type BuffTableSnapshot,
} from '@/api/admin'
import { clearAdminAuthenticated, getAdminToken } from '@/utils/adminAuth'

const emit = defineEmits<{
  imported: []
}>()

const router = useRouter()

const exportMode = ref<'all' | BuffTableMode>('all')
const importMode = ref<'file' | BuffTableMode | 'all'>('file')
const replaceOnImport = ref(false)

const exporting = ref(false)
const importing = ref(false)
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const importSummary = ref<BuffTableImportSummary | null>(null)
const preview = ref<BuffTableSnapshot | null>(null)
const previewLoading = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const pendingCount = ref(0)
const importConfirmVisible = ref(false)
const authDialogVisible = ref(false)

const modeOptions: { id: 'all' | BuffTableMode; label: string }[] = [
  { id: 'all', label: '全部模式' },
  { id: 'crisis', label: '危局' },
  { id: 'defense', label: '防卫战' },
  { id: 'deduction', label: '临界' },
]

const exportModeLabel = computed(
  () => modeOptions.find((item) => item.id === exportMode.value)?.label ?? '全部',
)

function stamp() {
  return new Date().toISOString().slice(0, 10)
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function handleAuthError() {
  clearAdminAuthenticated()
  authDialogVisible.value = true
}

function isAuthError(err: unknown) {
  if (!(err instanceof Error)) return false
  return /401|未登录|登录|管理员|ADMIN_AUTH/i.test(err.message)
}

async function refreshPreview() {
  if (!getAdminToken()) {
    handleAuthError()
    return
  }
  previewLoading.value = true
  try {
    preview.value = await fetchBuffTableSnapshot(
      exportMode.value === 'all' ? null : exportMode.value,
    )
  } catch (err) {
    if (isAuthError(err)) handleAuthError()
    preview.value = null
  } finally {
    previewLoading.value = false
  }
}

async function exportSnapshot() {
  if (!getAdminToken()) {
    handleAuthError()
    return
  }
  exporting.value = true
  message.value = ''
  importSummary.value = null
  try {
    const mode = exportMode.value === 'all' ? null : exportMode.value
    const snapshot = await fetchBuffTableSnapshot(mode)
    const filename =
      mode == null
        ? `zzz-hp-buff-table-${stamp()}.json`
        : `zzz-hp-buff-${mode}-${stamp()}.json`
    downloadJson(filename, snapshot)
    preview.value = snapshot
    messageKind.value = 'ok'
    message.value = `已导出 ${exportModeLabel.value} ${snapshot.count} 条 Buff`
  } catch (err) {
    if (isAuthError(err)) {
      handleAuthError()
      return
    }
    messageKind.value = 'err'
    message.value = err instanceof Error ? err.message : '导出失败'
  } finally {
    exporting.value = false
  }
}

function openFilePicker() {
  fileInputRef.value?.click()
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  pendingFile.value = null
  pendingCount.value = 0
  importSummary.value = null
  if (!file) return
  try {
    const text = await file.text()
    const json = JSON.parse(text) as BuffTableSnapshot
    const rows = Array.isArray(json.rows) ? json.rows : Array.isArray(json) ? json : []
    if (!rows.length) throw new Error('文件中没有 Buff 行（rows）')
    pendingFile.value = file
    pendingCount.value = rows.length
    messageKind.value = 'ok'
    message.value = `已选择 ${file.name}（${rows.length} 条），确认后导入`
  } catch (err) {
    messageKind.value = 'err'
    message.value = err instanceof Error ? err.message : '读取文件失败'
  }
}

function cancelPending() {
  pendingFile.value = null
  pendingCount.value = 0
}

function askImport() {
  if (!pendingFile.value) return
  if (!getAdminToken()) {
    handleAuthError()
    return
  }
  importConfirmVisible.value = true
}

async function confirmImport() {
  if (!pendingFile.value || importing.value) return
  importing.value = true
  message.value = ''
  try {
    const mode =
      importMode.value === 'file' || importMode.value === 'all'
        ? null
        : importMode.value
    const summary = await importBuffTableSnapshotFile(pendingFile.value, {
      replace: replaceOnImport.value,
      mode,
    })
    importSummary.value = summary
    importConfirmVisible.value = false
    pendingFile.value = null
    pendingCount.value = 0
    messageKind.value = 'ok'
    message.value = replaceOnImport.value
      ? `覆盖导入完成：写入 ${summary.inserted} 条（跳过 ${summary.skipped}）`
      : `导入完成：新增 ${summary.inserted} · 更新 ${summary.updated} · 跳过 ${summary.skipped}`
    emit('imported')
    await refreshPreview()
  } catch (err) {
    importConfirmVisible.value = false
    if (isAuthError(err)) {
      handleAuthError()
      return
    }
    messageKind.value = 'err'
    message.value = err instanceof Error ? err.message : '导入失败'
  } finally {
    importing.value = false
  }
}

function goLogin() {
  authDialogVisible.value = false
  router.push({ name: 'admin-login', query: { redirect: '/admin/buffs' } })
}

void refreshPreview()
</script>

<template>
  <section class="buff-io">
    <header class="io-header">
      <h2 class="io-title">Buff 表 · 导入 / 导出</h2>
      <p class="io-desc">
        导出 / 导入环境 Buff 表（含效果块）。可按危局 / 防卫 / 临界筛选；覆盖导入会先删除目标范围再写入。
      </p>
    </header>

    <p v-if="message" class="io-msg" :class="messageKind">{{ message }}</p>

    <div class="io-grid">
      <article class="io-card">
        <h3>导出</h3>
        <label class="field">
          <span>范围</span>
          <select v-model="exportMode" @change="refreshPreview">
            <option v-for="item in modeOptions" :key="item.id" :value="item.id">
              {{ item.label }}
            </option>
          </select>
        </label>
        <p class="hint">
          <template v-if="previewLoading">统计加载中…</template>
          <template v-else-if="preview">
            当前可导出 {{ preview.count }} 条
            <template v-if="preview.byMode">
              （{{
                Object.entries(preview.byMode)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')
              }}）
            </template>
          </template>
          <template v-else>无法预览数量</template>
        </p>
        <button type="button" class="btn primary" :disabled="exporting" @click="exportSnapshot">
          {{ exporting ? '导出中…' : `导出 ${exportModeLabel} JSON` }}
        </button>
      </article>

      <article class="io-card">
        <h3>导入</h3>
        <label class="field">
          <span>写入范围</span>
          <select v-model="importMode">
            <option value="file">按文件内容（全部模式）</option>
            <option value="crisis">仅危局</option>
            <option value="defense">仅防卫战</option>
            <option value="deduction">仅临界</option>
          </select>
        </label>
        <label class="check">
          <input v-model="replaceOnImport" type="checkbox" />
          <span>覆盖写入（先删目标范围再插入，不可撤销）</span>
        </label>
        <p class="hint">默认按 id 或「模式+版本+期数+名称」增量更新；覆盖前请先导出备份。</p>
        <input
          ref="fileInputRef"
          type="file"
          accept="application/json,.json"
          class="file-input"
          @change="onFilePicked"
        />
        <div class="btn-row">
          <button type="button" class="btn" :disabled="importing" @click="openFilePicker">
            选择 JSON
          </button>
          <button
            v-if="pendingFile"
            type="button"
            class="btn primary"
            :disabled="importing"
            @click="askImport"
          >
            {{ importing ? '导入中…' : `确认导入 ${pendingCount} 条` }}
          </button>
          <button
            v-if="pendingFile"
            type="button"
            class="btn"
            :disabled="importing"
            @click="cancelPending"
          >
            取消
          </button>
        </div>
        <p v-if="pendingFile" class="hint">待导入：{{ pendingFile.name }}</p>
      </article>
    </div>

    <article v-if="importSummary" class="io-card">
      <h3>导入结果</h3>
      <ul class="summary">
        <li>源文件条目：{{ importSummary.total }}</li>
        <li>新增：{{ importSummary.inserted }}</li>
        <li>更新：{{ importSummary.updated }}</li>
        <li>跳过：{{ importSummary.skipped }}</li>
        <li>模式：{{ importSummary.modeFilter || '全部' }}</li>
        <li>方式：{{ importSummary.replaced ? '覆盖' : '增量' }}</li>
      </ul>
    </article>

    <AdminConfirmDialog
      :visible="importConfirmVisible"
      title="确认导入 Buff 表"
      :message="
        replaceOnImport
          ? '将先删除目标范围内的 Buff 再写入文件内容，不可撤销。建议先导出备份。'
          : '将按 ID 或（模式+版本+期数+名称）新增/更新，不会删除文件中没有的条目。'
      "
      confirm-text="导入"
      :loading="importing"
      @confirm="confirmImport"
      @cancel="importConfirmVisible = false"
    />

    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，无法导入 / 导出。请重新登录管理员账号后再试。"
      confirm-text="去登录"
      @confirm="goLogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped>
.buff-io {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.io-header {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.io-title {
  margin: 0;
  font-size: 1.15rem;
  color: var(--color-heading);
}

.io-desc {
  margin: 0;
  font-size: 0.86rem;
  opacity: 0.75;
  color: var(--color-text);
}

.io-msg {
  margin: 0;
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
  font-size: 0.88rem;
}

.io-msg.ok {
  background: hsla(160, 100%, 37%, 0.12);
  border: 1px solid hsla(160, 100%, 37%, 0.35);
}

.io-msg.err {
  background: hsla(0, 70%, 55%, 0.1);
  border: 1px solid hsla(0, 70%, 55%, 0.35);
  color: #e85d4c;
}

.io-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0.85rem;
}

.io-card {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 1rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-soft);
}

.io-card h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-heading);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--color-heading);
}

.field select {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
}

.check {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  font-size: 0.84rem;
  color: var(--color-text);
}

.hint {
  margin: 0;
  font-size: 0.8rem;
  opacity: 0.7;
  color: var(--color-text);
}

.file-input {
  display: none;
}

.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.btn {
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn.primary {
  border-color: #e8a838;
  background: hsla(40, 80%, 55%, 0.16);
}

.summary {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.88rem;
  color: var(--color-text);
}
</style>
