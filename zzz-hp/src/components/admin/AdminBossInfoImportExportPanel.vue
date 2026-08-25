<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import {
  fetchBossInfoSnapshot,
  importBossInfoSnapshotFile,
  type BossInfoImportSummary,
  type BossInfoSnapshot,
} from '@/api/bossInfo'
import { clearAdminAuthenticated, getAdminToken } from '@/utils/adminAuth'

const emit = defineEmits<{
  imported: []
}>()

const router = useRouter()

const replaceOnImport = ref(false)
const exporting = ref(false)
const importing = ref(false)
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const importSummary = ref<BossInfoImportSummary | null>(null)
const preview = ref<BossInfoSnapshot | null>(null)
const previewLoading = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const pendingCount = ref(0)
const importConfirmVisible = ref(false)
const authDialogVisible = ref(false)

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
    preview.value = await fetchBossInfoSnapshot()
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
    const snapshot = await fetchBossInfoSnapshot()
    downloadJson(`zzz-hp-boss-info-${stamp()}.json`, snapshot)
    preview.value = snapshot
    messageKind.value = 'ok'
    message.value = `已导出怪物基础库 ${snapshot.count} 条`
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
    const json = JSON.parse(text) as BossInfoSnapshot
    const rows = Array.isArray(json.rows) ? json.rows : Array.isArray(json) ? json : []
    if (!rows.length) throw new Error('文件中没有怪物行（rows）')
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
    const summary = await importBossInfoSnapshotFile(pendingFile.value, {
      replace: replaceOnImport.value,
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
  router.push({ name: 'admin-login', query: { redirect: '/admin/boss-info' } })
}

void refreshPreview()
</script>

<template>
  <section class="boss-io">
    <header class="io-header">
      <h2 class="io-title">怪物基础库 · 导入 / 导出</h2>
      <p class="io-desc">
        导出 / 导入 boss_info（含场地 Buff 多套、失衡易伤、危局基础血量）。覆盖导入会先清空整表再写入。
      </p>
    </header>

    <p v-if="message" class="io-msg" :class="messageKind">{{ message }}</p>

    <div class="io-grid">
      <article class="io-card">
        <h3>导出</h3>
        <p class="hint">
          <template v-if="previewLoading">统计加载中…</template>
          <template v-else-if="preview">当前可导出 {{ preview.count }} 条</template>
          <template v-else>无法预览数量</template>
        </p>
        <button type="button" class="btn primary" :disabled="exporting" @click="exportSnapshot">
          {{ exporting ? '导出中…' : '导出 JSON' }}
        </button>
      </article>

      <article class="io-card">
        <h3>导入</h3>
        <label class="check">
          <input v-model="replaceOnImport" type="checkbox" />
          <span>覆盖写入（先清空 boss_info 再插入，不可撤销）</span>
        </label>
        <p class="hint">默认按 id 或怪物名增量更新；导入图片会优先保留本地可用路径。</p>
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
        <li>方式：{{ importSummary.replaced ? '覆盖' : '增量' }}</li>
      </ul>
    </article>

    <AdminConfirmDialog
      :visible="importConfirmVisible"
      title="确认导入怪物基础库"
      :message="
        replaceOnImport
          ? '将先清空 boss_info 再写入文件内容，不可撤销。建议先导出备份。'
          : '将按 ID 或怪物名新增/更新，不会删除文件中没有的条目。'
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
.boss-io {
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
