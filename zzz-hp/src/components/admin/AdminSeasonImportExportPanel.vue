<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import {
  fetchSeasonSnapshot,
  importSeasonSnapshotFile,
  isSeasonSnapshotAuthError,
  type SeasonSnapshotData,
  type SeasonSnapshotImportSummary,
  type SeasonSnapshotScheme,
  type SeasonSnapshotVariant,
} from '@/api/seasonSnapshot'
import type { AdminScope } from '@/types/admin'
import { adminScopeTitles, isDefenseScope, isDeductionScope } from '@/types/admin'
import { clearAdminAuthenticated } from '@/utils/adminAuth'

const props = defineProps<{
  scope: AdminScope
}>()

const emit = defineEmits<{
  imported: []
}>()

const router = useRouter()

const unsupported = computed(() => false)

const scheme = computed<SeasonSnapshotScheme>(() => {
  if (isDeductionScope(props.scope)) return 'deduction'
  return isDefenseScope(props.scope) ? 'defense' : 'crisis'
})
const variant = computed<SeasonSnapshotVariant | null>(() => {
  if (props.scope === 'defense-old') return 'old'
  if (props.scope === 'defense-new') return 'new'
  return null
})
const scopeTitle = computed(() => adminScopeTitles[props.scope] || '危局 / 防卫战')

const snapshot = ref<SeasonSnapshotData | null>(null)
const loading = ref(false)
const exportScope = ref<'picked' | 'all'>('picked')
const pickQuery = ref('')
const selectedKeys = ref<string[]>([])
const exporting = ref(false)
const importing = ref(false)
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const importSummary = ref<SeasonSnapshotImportSummary | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const pendingPreview = ref<{ label: string; count: number }[]>([])
const pendingScheme = ref<string>('')
const importConfirmVisible = ref(false)
const authDialogVisible = ref(false)

function seasonKey(version: string, phase: string) {
  return `${String(version).trim()}|${String(phase).replace(/\D/g, '') || String(phase).trim()}`
}

const seasons = computed(() => snapshot.value?.seasons ?? [])

const filteredSeasons = computed(() => {
  const keyword = pickQuery.value.trim().toLowerCase()
  if (!keyword) return seasons.value
  return seasons.value.filter((row) => {
    const label = `${row.version} 第${row.phase}期`
    return label.toLowerCase().includes(keyword) || seasonKey(row.version, row.phase).includes(keyword)
  })
})

const counts = computed(() => [
  { label: '期数', count: seasons.value.length },
  { label: '怪物', count: snapshot.value?.bosses.length ?? 0 },
  { label: 'Buff', count: snapshot.value?.buffs.length ?? 0 },
  { label: '日期', count: snapshot.value?.dates.length ?? 0 },
  { label: '怪物图鉴', count: snapshot.value?.bossInfos.length ?? 0 },
])

const selectedCount = computed(() => selectedKeys.value.length)

const selectedSummary = computed(() => {
  if (!selectedCount.value) return ''
  const keys = new Set(selectedKeys.value)
  const picked = seasons.value.filter((row) => keys.has(seasonKey(row.version, row.phase)))
  const bosses = picked.reduce((sum, row) => sum + row.bossCount, 0)
  const buffs = picked.reduce((sum, row) => sum + row.buffCount, 0)
  return `${picked.length} 期 · 怪物 ${bosses} · Buff ${buffs}`
})

function isPicked(version: string, phase: string) {
  return selectedKeys.value.includes(seasonKey(version, phase))
}

function togglePicked(version: string, phase: string) {
  const key = seasonKey(version, phase)
  selectedKeys.value = selectedKeys.value.includes(key)
    ? selectedKeys.value.filter((item) => item !== key)
    : [...selectedKeys.value, key]
}

function selectFiltered() {
  const ids = new Set(selectedKeys.value)
  for (const row of filteredSeasons.value) ids.add(seasonKey(row.version, row.phase))
  selectedKeys.value = [...ids]
}

function clearPicked() {
  selectedKeys.value = []
}

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

function openAuthDialog() {
  authDialogVisible.value = true
  messageKind.value = 'err'
  message.value = '管理员会话无效或已过期，请重新登录后再导入 / 导出'
}

function goRelogin() {
  authDialogVisible.value = false
  clearAdminAuthenticated()
  void router.push({
    path: '/admin/login',
    query: { redirect: router.currentRoute.value.fullPath },
  })
}

function handleError(err: unknown, fallback: string) {
  if (isSeasonSnapshotAuthError(err)) {
    openAuthDialog()
    return
  }
  messageKind.value = 'err'
  message.value = err instanceof Error ? err.message : fallback
}

function filterSnapshot(source: SeasonSnapshotData, keys: Set<string>): SeasonSnapshotData {
  const bosses = source.bosses.filter((row) => keys.has(seasonKey(row.version, row.phase)))
  const buffs = source.buffs.filter((row) => keys.has(seasonKey(row.version, row.phase)))
  const dates = source.dates.filter((row) => keys.has(seasonKey(row.version, row.phase)))
  const names = new Set(bosses.map((row) => row.boss_name))
  return {
    ...source,
    exportedAt: new Date().toISOString(),
    seasons: source.seasons.filter((row) => keys.has(seasonKey(row.version, row.phase))),
    bosses,
    buffs,
    dates,
    bossInfos: source.bossInfos.filter((row) => names.has(row.boss_name)),
  }
}

async function loadSnapshot() {
  if (unsupported.value) {
    snapshot.value = null
    return
  }  loading.value = true
  message.value = ''
  try {
    snapshot.value = await fetchSeasonSnapshot(scheme.value, variant.value)
    const valid = new Set(
      snapshot.value.seasons.map((row) => seasonKey(row.version, row.phase)),
    )
    selectedKeys.value = selectedKeys.value.filter((key) => valid.has(key))
  } catch (err) {
    snapshot.value = null
    handleError(err, '加载快照失败')
  } finally {
    loading.value = false
  }
}

async function exportSnapshot() {
  exporting.value = true
  message.value = ''
  importSummary.value = null
  try {
    if (exportScope.value === 'picked' && !selectedCount.value) {
      throw new Error('请先勾选要导出的期数')
    }
    const fresh = await fetchSeasonSnapshot(scheme.value, variant.value)
    snapshot.value = fresh
    const payload =
      exportScope.value === 'all'
        ? fresh
        : filterSnapshot(fresh, new Set(selectedKeys.value))
    const seasonCount = payload.seasons.length
    if (!seasonCount && exportScope.value === 'picked') {
      throw new Error('勾选的期数在数据库中已不存在，请刷新后再试')
    }
    const tag = variant.value ? `${scheme.value}-${variant.value}` : scheme.value
    const filename =
      exportScope.value === 'all'
        ? `zzz-hp-${tag}-all-${stamp()}.json`
        : `zzz-hp-${tag}-picked-${seasonCount}-${stamp()}.json`
    downloadJson(filename, payload)
    messageKind.value = 'ok'
    message.value =
      exportScope.value === 'all'
        ? `已导出全部${scopeTitle.value}快照（${fresh.seasons.length} 期）`
        : `已导出 ${selectedSummary.value}`
  } catch (err) {
    handleError(err, '导出失败')
  } finally {
    exporting.value = false
  }
}

function openFilePicker() {
  importSummary.value = null
  message.value = ''
  fileInputRef.value?.click()
}

async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  pendingFile.value = file
  pendingPreview.value = []
  pendingScheme.value = ''
  try {
    const text = await file.text()
    const raw = JSON.parse(text.replace(/^\uFEFF/, '')) as Record<string, unknown>
    const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>
    const bosses = Array.isArray(data.bosses) ? data.bosses.length : 0
    const buffs = Array.isArray(data.buffs) ? data.buffs.length : 0
    const dates = Array.isArray(data.dates) ? data.dates.length : 0
    const infos = Array.isArray(data.bossInfos) ? data.bossInfos.length : 0
    if (data.kind === 'zzz-hp-calculator-buffs' || Array.isArray(data.agents)) {
      throw new Error('这是计算器增益快照，请到角色计算器后台的导入 / 导出页使用')
    }
    if (!bosses && !buffs && !dates && !infos && !data.boss_name && !data.buff_name) {
      throw new Error('文件中没有可识别的危局 / 防卫战条目')
    }
    pendingScheme.value = typeof data.scheme === 'string' ? data.scheme : ''
    pendingPreview.value = [
      { label: '怪物', count: bosses || (data.boss_name ? 1 : 0) },
      { label: 'Buff', count: buffs || (data.buff_name ? 1 : 0) },
      { label: '日期', count: dates || (data.startDate || data.start_date ? 1 : 0) },
      { label: '怪物图鉴', count: infos },
    ].filter((row) => row.count > 0)
    messageKind.value = 'ok'
    message.value = `已读取 ${file.name}，确认后按 ID 写入数据库（不删除未出现的条目）`
  } catch (err) {
    pendingFile.value = null
    pendingPreview.value = []
    handleError(err, '读取文件失败')
  }
}

function cancelPending() {
  pendingFile.value = null
  pendingPreview.value = []
  pendingScheme.value = ''
}

function askImportConfirm() {
  if (!pendingFile.value) return
  importConfirmVisible.value = true
}

function closeImportConfirm() {
  if (importing.value) return
  importConfirmVisible.value = false
}

function summaryRows(summary: SeasonSnapshotImportSummary) {
  return [
    { key: 'bosses', label: '怪物', ...summary.bosses },
    { key: 'buffs', label: 'Buff', ...summary.buffs },
    { key: 'dates', label: '日期', ...summary.dates },
    { key: 'bossInfos', label: '怪物图鉴', ...summary.bossInfos },
  ]
}

async function confirmImport() {
  if (!pendingFile.value) return
  importing.value = true
  message.value = ''
  try {
    const summary = await importSeasonSnapshotFile(pendingFile.value)
    importSummary.value = summary
    pendingFile.value = null
    pendingPreview.value = []
    pendingScheme.value = ''
    importConfirmVisible.value = false
    await loadSnapshot()
    emit('imported')
    const rows = summaryRows(summary)
    const totalCreated = rows.reduce((sum, row) => sum + row.created, 0)
    const totalUpdated = rows.reduce((sum, row) => sum + row.updated, 0)
    const totalErrors = rows.reduce((sum, row) => sum + row.errors.length, 0)
    messageKind.value = totalErrors ? 'err' : 'ok'
    message.value = totalErrors
      ? `导入完成：新增 ${totalCreated}，更新 ${totalUpdated}，失败 ${totalErrors} 条`
      : `导入完成：新增 ${totalCreated}，更新 ${totalUpdated}`
  } catch (err) {
    importConfirmVisible.value = false
    handleError(err, '导入失败')
  } finally {
    importing.value = false
  }
}

const schemeMismatch = computed(() => {
  if (!pendingScheme.value) return false
  return pendingScheme.value !== scheme.value
})

onMounted(() => {
  if (!unsupported.value) void loadSnapshot()
})

watch(
  () => props.scope,
  () => {
    selectedKeys.value = []
    if (!unsupported.value) void loadSnapshot()
    else {
      snapshot.value = null
      message.value = ''
    }
  },
)
</script>

<template>
  <section class="io-panel">
    <header class="panel-header">
      <h2 class="panel-title">{{ scopeTitle }} · 导入 / 导出</h2>
      <p v-if="unsupported" class="panel-desc">
        临界推演的期数快照导入导出尚未单独开通，避免与危局/防卫战数据互相覆盖。请继续使用危局或防卫战页的导入导出。
      </p>
      <p v-else class="panel-desc">
        按期数备份怪物、Buff、版本日期；危局还会带上对应怪物图鉴（含 Boss 场地 Buff）。导入按 ID
        新增或覆盖，不会删除文件中没有的条目。JSON 只含图片路径、不含图片文件；若路径在服务器上不存在，会保留本机已有可用图片，避免再次裂图。新图仍需先放到
        boss_image / buff_image 目录或管理端上传。
      </p>
    </header>

    <template v-if="!unsupported">
    <div class="count-grid">
      <div v-for="item in counts" :key="item.label" class="count-card">
        <p class="count-label">{{ item.label }}</p>
        <p class="count-value">{{ item.count }}</p>
      </div>
    </div>

    <section class="io-card">
      <h3>导出</h3>
      <p class="io-hint">勾选下方期数即可导出某几期；也可以一次导出当前范围的全部数据。</p>
      <div class="io-row">
        <label class="field">
          <span>范围</span>
          <select v-model="exportScope">
            <option value="picked">自选若干期</option>
            <option value="all">当前范围全部</option>
          </select>
        </label>
        <button type="button" class="secondary-btn compact" :disabled="loading" @click="loadSnapshot">
          {{ loading ? '刷新中...' : '刷新列表' }}
        </button>
      </div>

      <div v-if="exportScope === 'picked'" class="picker">
        <div class="picker-toolbar">
          <input
            v-model="pickQuery"
            class="search-input"
            type="search"
            placeholder="搜索版本或期数，例如 2.1 或 第1期"
          />
          <button type="button" class="secondary-btn compact" @click="selectFiltered">全选当前筛选</button>
          <button type="button" class="secondary-btn compact" @click="clearPicked">清空</button>
        </div>
        <p class="current-note">
          {{ selectedCount ? `已选 ${selectedSummary}` : '未勾选。勾选要导出的期数。' }}
        </p>
        <div class="pick-list">
          <label v-for="row in filteredSeasons" :key="seasonKey(row.version, row.phase)" class="pick-item">
            <input
              type="checkbox"
              :checked="isPicked(row.version, row.phase)"
              @change="togglePicked(row.version, row.phase)"
            />
            <span class="pick-text">
              <span class="pick-title">{{ row.version }} · 第 {{ row.phase }} 期</span>
              <span class="pick-hint">怪物 {{ row.bossCount }} · Buff {{ row.buffCount }} · 日期 {{ row.dateCount }}</span>
            </span>
          </label>
          <p v-if="loading" class="empty-hint">加载中...</p>
          <p v-else-if="!filteredSeasons.length" class="empty-hint">没有匹配的期数</p>
        </div>
      </div>

      <div class="io-actions">
        <button
          type="button"
          class="primary-btn"
          :disabled="exporting || loading || (exportScope === 'picked' && !selectedCount)"
          @click="exportSnapshot"
        >
          {{
            exporting
              ? '导出中...'
              : exportScope === 'picked'
                ? `导出已选 ${selectedCount} 期`
                : '导出 JSON'
          }}
        </button>
      </div>
    </section>

    <section class="io-card">
      <h3>导入</h3>
      <p class="io-hint">支持完整快照、若干期，或单条怪物 / Buff / 日期对象。请先导出备份。</p>
      <input
        ref="fileInputRef"
        class="hidden-input"
        type="file"
        accept="application/json,.json"
        @change="onFileChosen"
      />
      <div class="io-actions">
        <button type="button" class="secondary-btn" :disabled="importing" @click="openFilePicker">
          选择 JSON 文件
        </button>
        <button
          v-if="pendingFile"
          type="button"
          class="primary-btn"
          :disabled="importing"
          @click="askImportConfirm"
        >
          {{ importing ? '导入中...' : `确认导入 ${pendingFile.name}` }}
        </button>
        <button v-if="pendingFile" type="button" class="secondary-btn" :disabled="importing" @click="cancelPending">
          取消
        </button>
      </div>
      <p v-if="schemeMismatch" class="mismatch-hint">
        文件标记为 {{ pendingScheme === 'defense' ? '式舆防卫战' : '危局强袭战' }}，与当前页不完全相同，仍可导入（ID 互不覆盖）。
      </p>
      <ul v-if="pendingPreview.length" class="preview-list">
        <li v-for="row in pendingPreview" :key="row.label">{{ row.label }}：{{ row.count }} 条</li>
      </ul>
    </section>

    <p v-if="message" class="io-message" :class="messageKind">{{ message }}</p>

    <section v-if="importSummary" class="io-card">
      <h3>导入结果</h3>
      <table class="result-table">
        <thead>
          <tr>
            <th>类型</th>
            <th>新增</th>
            <th>更新</th>
            <th>跳过</th>
            <th>失败</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in summaryRows(importSummary)" :key="row.key">
            <td>{{ row.label }}</td>
            <td>{{ row.created }}</td>
            <td>{{ row.updated }}</td>
            <td>{{ row.skipped }}</td>
            <td>{{ row.errors.length }}</td>
          </tr>
        </tbody>
      </table>
      <ul v-if="summaryRows(importSummary).some((row) => row.errors.length)" class="error-list">
        <template v-for="row in summaryRows(importSummary)" :key="`err-${row.key}`">
          <li v-for="item in row.errors" :key="`${row.key}-${item.id}`">
            {{ row.label }} {{ item.id }}：{{ item.message }}
          </li>
        </template>
      </ul>
    </section>
    </template>

    <AdminConfirmDialog
      :visible="importConfirmVisible"
      title="确认导入"
      :message="
        schemeMismatch
          ? '文件类型与当前页不完全相同。将按 ID 新增或覆盖对应怪物 / Buff / 日期，不会删除未出现的条目。'
          : '将按 ID 新增或覆盖对应怪物、Buff、日期与怪物图鉴，不会删除文件中没有的条目。导入前建议先导出备份。'
      "
      confirm-text="导入"
      :danger="true"
      :loading="importing"
      @confirm="confirmImport"
      @cancel="closeImportConfirm"
    />
    <AdminConfirmDialog
      :visible="authDialogVisible"
      title="需要重新登录"
      message="当前后台会话无效或已过期，无法导入 / 导出。请重新登录管理员账号后再试。"
      confirm-text="去登录"
      cancel-text="稍后"
      @confirm="goRelogin"
      @cancel="authDialogVisible = false"
    />
  </section>
</template>

<style scoped>
.io-panel {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem 0;
}

.panel-header {
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

.count-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
}

.count-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.85rem 1rem;
}

.count-label,
.count-value {
  margin: 0;
}

.count-label {
  font-size: 0.78rem;
  color: var(--color-text);
  opacity: 0.72;
}

.count-value {
  margin-top: 0.2rem;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--color-heading);
}

.io-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.io-card h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--color-heading);
}

.io-hint,
.current-note,
.empty-hint,
.mismatch-hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.75;
}

.mismatch-hint {
  color: #c94a3c;
  opacity: 1;
}

.io-row,
.io-actions,
.picker-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  align-items: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.82rem;
  color: var(--color-text);
}

.field select,
.search-input {
  min-width: 14rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
}

.search-input {
  flex: 1;
  min-width: 12rem;
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.compact {
  min-width: 0;
  padding: 0.4rem 0.75rem;
  font-size: 0.8rem;
}

.pick-list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  padding: 0.4rem;
}

.pick-item {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  cursor: pointer;
}

.pick-item:hover {
  background: var(--color-background-mute);
}

.pick-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.pick-title {
  font-size: 0.88rem;
  color: var(--color-heading);
}

.pick-hint {
  font-size: 0.75rem;
  color: var(--color-text);
  opacity: 0.7;
}

.hidden-input {
  display: none;
}

.primary-btn,
.secondary-btn {
  padding: 0.55rem 1.2rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn {
  min-width: 7.5rem;
  border-color: color-mix(in srgb, #e8a838 55%, var(--color-border));
  background: color-mix(in srgb, #e8a838 16%, var(--color-background-soft));
  color: var(--color-heading);
}

.secondary-btn {
  background: var(--color-background);
  color: var(--color-heading);
}

.primary-btn:disabled,
.secondary-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.preview-list,
.error-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.85rem;
  color: var(--color-text);
}

.io-message {
  margin: 0;
  padding: 0.7rem 0.85rem;
  border-radius: 10px;
  font-size: 0.86rem;
  line-height: 1.55;
}

.io-message.ok {
  border: 1px solid color-mix(in srgb, #e8a838 40%, var(--color-border));
  background: color-mix(in srgb, #e8a838 12%, var(--color-background-soft));
  color: var(--color-heading);
}

.io-message.err {
  border: 1px solid color-mix(in srgb, #e85d4c 35%, var(--color-border));
  background: color-mix(in srgb, #e85d4c 10%, var(--color-background-soft));
  color: #c94a3c;
}

.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.result-table th,
.result-table td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
}

@media (max-width: 900px) {
  .count-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
