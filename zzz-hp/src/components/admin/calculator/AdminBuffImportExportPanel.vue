<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import {
  fetchCalculatorBuffSnapshot,
  importCalculatorBuffSnapshotFile,
  isAdminAuthError,
} from '@/api/calculatorBuffs'
import AdminConfirmDialog from '@/components/admin/AdminConfirmDialog.vue'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import type {
  CalculatorBuffData,
  CalculatorBuffImportSummary,
} from '@/types/calculator'
import { clearAdminAuthenticated } from '@/utils/adminAuth'
import '@/components/admin/calculator/adminCalculatorPanel.css'

const router = useRouter()

const store = useCalculatorBuffStore()
const {
  agents,
  wengines,
  bangboos,
  driveDiscs,
  skillSubcategories,
  followUpSkillRules,
  damageEventModes,
  presetSkills,
} = storeToRefs(store)

type SnapshotKey = keyof Pick<
  CalculatorBuffData,
  | 'agents'
  | 'wengines'
  | 'bangboos'
  | 'driveDiscs'
  | 'skillSubcategories'
  | 'followUpSkillRules'
  | 'damageEventModes'
  | 'skills'
>
type ExportScope = 'all' | SnapshotKey | 'picked'

interface PickRow {
  id: string
  title: string
  hint: string
}

const TYPE_LABELS: Record<SnapshotKey, string> = {
  agents: '角色',
  wengines: '音擎',
  bangboos: '邦布',
  driveDiscs: '驱动盘',
  skillSubcategories: '招式小类',
  followUpSkillRules: '追击规则',
  damageEventModes: '伤害事件模式',
  skills: '招式库',
}

const SNAPSHOT_KEYS = Object.keys(TYPE_LABELS) as SnapshotKey[]

const exportScope = ref<ExportScope>('picked')
const pickType = ref<SnapshotKey>('agents')
const pickQuery = ref('')
const selectedIds = ref<Record<SnapshotKey, string[]>>({
  agents: [],
  wengines: [],
  bangboos: [],
  driveDiscs: [],
  skillSubcategories: [],
  followUpSkillRules: [],
  damageEventModes: [],
  skills: [],
})

const exporting = ref(false)
const importing = ref(false)
const message = ref('')
const messageKind = ref<'ok' | 'err'>('ok')
const importSummary = ref<CalculatorBuffImportSummary | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingFile = ref<File | null>(null)
const pendingPreview = ref<{ label: string; count: number }[]>([])
const importConfirmVisible = ref(false)
const authDialogVisible = ref(false)

const agentNameById = computed(() => {
  const map = new Map<string, string>()
  for (const item of agents.value) map.set(item.id, item.name)
  return map
})

function agentHint(agentId: string | undefined) {
  if (!agentId) return '通用'
  return agentNameById.value.get(agentId) || agentId
}

const pickLists = computed<Record<SnapshotKey, PickRow[]>>(() => ({
  agents: agents.value.map((item) => ({
    id: item.id,
    title: item.name,
    hint: [item.profession, item.element, item.id].filter(Boolean).join(' · '),
  })),
  wengines: wengines.value.map((item) => ({
    id: item.id,
    title: item.name,
    hint: [item.profession, item.rarity ? `${item.rarity}星` : '', item.id].filter(Boolean).join(' · '),
  })),
  bangboos: bangboos.value.map((item) => ({
    id: item.id,
    title: item.name,
    hint: item.id,
  })),
  driveDiscs: driveDiscs.value.map((item) => ({
    id: item.id,
    title: item.name,
    hint: item.id,
  })),
  skillSubcategories: skillSubcategories.value.map((item) => ({
    id: item.id,
    title: item.name,
    hint: `${agentHint(item.agentId)} · ${item.categoryId}`,
  })),
  followUpSkillRules: followUpSkillRules.value.map((item) => ({
    id: item.id,
    title: item.id,
    hint: `${agentHint(item.agentId)} · ${item.categoryId}${item.subcategoryId ? ` · ${item.subcategoryId}` : ' · 整大类'}`,
  })),
  damageEventModes: damageEventModes.value.map((item) => ({
    id: item.id,
    title: item.name,
    hint: `${agentHint(item.agentId)} · ${item.id}`,
  })),
  skills: presetSkills.value.map((item) => ({
    id: item.id,
    title: item.name,
    hint: `${agentHint(item.agentId)}${item.element ? ` · ${item.element}` : ''} · ${item.id}`,
  })),
}))

const counts = computed(() =>
  SNAPSHOT_KEYS.map((key) => ({
    key,
    label: TYPE_LABELS[key],
    count: pickLists.value[key].length,
  })),
)

const filteredPickRows = computed(() => {
  const keyword = pickQuery.value.trim().toLowerCase()
  const rows = pickLists.value[pickType.value]
  if (!keyword) return rows
  return rows.filter(
    (row) =>
      row.title.toLowerCase().includes(keyword) ||
      row.hint.toLowerCase().includes(keyword) ||
      row.id.toLowerCase().includes(keyword),
  )
})

const selectedCount = computed(() =>
  SNAPSHOT_KEYS.reduce((sum, key) => sum + selectedIds.value[key].length, 0),
)

const selectedSummary = computed(() =>
  SNAPSHOT_KEYS.filter((key) => selectedIds.value[key].length)
    .map((key) => `${TYPE_LABELS[key]} ${selectedIds.value[key].length}`)
    .join('、'),
)

function isPicked(id: string) {
  return selectedIds.value[pickType.value].includes(id)
}

function togglePicked(id: string) {
  const current = selectedIds.value[pickType.value]
  selectedIds.value[pickType.value] = current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id]
}

function selectFiltered() {
  const ids = new Set(selectedIds.value[pickType.value])
  for (const row of filteredPickRows.value) ids.add(row.id)
  selectedIds.value[pickType.value] = [...ids]
}

function clearCurrentType() {
  selectedIds.value[pickType.value] = []
}

function clearAllPicked() {
  for (const key of SNAPSHOT_KEYS) selectedIds.value[key] = []
}

function openPickedType(key: SnapshotKey) {
  exportScope.value = 'picked'
  pickType.value = key
  pickQuery.value = ''
}

function emptySnapshot(exportedAt?: string): CalculatorBuffData {
  return {
    agents: [],
    wengines: [],
    bangboos: [],
    driveDiscs: [],
    skillSubcategories: [],
    followUpSkillRules: [],
    damageEventModes: [],
    skills: [],
    exportedAt,
  }
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

function pickSnapshotSlice(snapshot: CalculatorBuffData, scope: SnapshotKey): CalculatorBuffData {
  const empty = emptySnapshot(snapshot.exportedAt)
  empty[scope] = (snapshot[scope] ?? []) as never
  return empty
}

function filterSnapshotByPicks(snapshot: CalculatorBuffData): CalculatorBuffData {
  const empty = emptySnapshot(snapshot.exportedAt)
  for (const key of SNAPSHOT_KEYS) {
    const ids = new Set(selectedIds.value[key])
    if (!ids.size) continue
    empty[key] = (snapshot[key] ?? []).filter((item) => ids.has(item.id)) as never
  }
  return empty
}

async function exportSnapshot() {
  exporting.value = true
  message.value = ''
  importSummary.value = null
  try {
    if (exportScope.value === 'picked') {
      if (!selectedCount.value) throw new Error('请先勾选要导出的条目')
      const snapshot = await fetchCalculatorBuffSnapshot()
      const payload = filterSnapshotByPicks(snapshot)
      const total = SNAPSHOT_KEYS.reduce((sum, key) => sum + (payload[key]?.length ?? 0), 0)
      if (!total) throw new Error('勾选的条目在数据库中已不存在，请刷新后再试')
      const onlyKey = SNAPSHOT_KEYS.find((key) => (payload[key]?.length ?? 0) === total)
      const filename = onlyKey
        ? `zzz-hp-${onlyKey}-picked-${total}-${stamp()}.json`
        : `zzz-hp-picked-${total}-${stamp()}.json`
      downloadJson(filename, payload)
      messageKind.value = 'ok'
      message.value = `已导出 ${selectedSummary.value}`
      return
    }

    const snapshot = await fetchCalculatorBuffSnapshot()
    const payload =
      exportScope.value === 'all' ? snapshot : pickSnapshotSlice(snapshot, exportScope.value)
    const filename =
      exportScope.value === 'all'
        ? `zzz-hp-calculator-buffs-${stamp()}.json`
        : `zzz-hp-${exportScope.value}-${stamp()}.json`
    downloadJson(filename, payload)
    messageKind.value = 'ok'
    message.value =
      exportScope.value === 'all'
        ? '已导出全部计算器增益快照'
        : `已导出全部${TYPE_LABELS[exportScope.value]}`
  } catch (err) {
    if (isAdminAuthError(err)) {
      openAuthDialog()
      return
    }
    messageKind.value = 'err'
    message.value = err instanceof Error ? err.message : '导出失败'
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
  try {
    const text = await file.text()
    const raw = JSON.parse(text.replace(/^\uFEFF/, '')) as Record<string, unknown>
    const data = (raw.data && typeof raw.data === 'object' ? raw.data : raw) as Record<string, unknown>
    pendingPreview.value = SNAPSHOT_KEYS.map((key) => ({
      label: TYPE_LABELS[key],
      count: Array.isArray(data[key]) ? data[key].length : 0,
    })).filter((row) => row.count > 0)
    if (!pendingPreview.value.length) {
      if (data.id) {
        pendingPreview.value = [{ label: '单条增益（导入时自动识别类型）', count: 1 }]
      } else {
        throw new Error('文件中没有可识别的增益条目')
      }
    }
    messageKind.value = 'ok'
    message.value = `已读取 ${file.name}，确认后写入数据库（按 ID 更新，不删除未出现的条目）`
  } catch (err) {
    pendingFile.value = null
    pendingPreview.value = []
    messageKind.value = 'err'
    message.value = err instanceof Error ? err.message : '读取文件失败'
  }
}

function cancelPending() {
  pendingFile.value = null
  pendingPreview.value = []
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

function askImportConfirm() {
  if (!pendingFile.value) return
  importConfirmVisible.value = true
}

function closeImportConfirm() {
  if (importing.value) return
  importConfirmVisible.value = false
}

async function confirmImport() {
  if (!pendingFile.value) return
  importing.value = true
  message.value = ''
  try {
    const summary = await importCalculatorBuffSnapshotFile(pendingFile.value)
    importSummary.value = summary
    pendingFile.value = null
    pendingPreview.value = []
    importConfirmVisible.value = false
    await store.loadAll(true)
    const totalCreated = Object.values(summary).reduce((sum, row) => sum + row.created, 0)
    const totalUpdated = Object.values(summary).reduce((sum, row) => sum + row.updated, 0)
    const totalErrors = Object.values(summary).reduce((sum, row) => sum + row.errors.length, 0)
    messageKind.value = totalErrors ? 'err' : 'ok'
    message.value = totalErrors
      ? `导入完成：新增 ${totalCreated}，更新 ${totalUpdated}，失败 ${totalErrors} 条`
      : `导入完成：新增 ${totalCreated}，更新 ${totalUpdated}`
  } catch (err) {
    importConfirmVisible.value = false
    if (isAdminAuthError(err)) {
      openAuthDialog()
      return
    }
    messageKind.value = 'err'
    message.value = err instanceof Error ? err.message : '导入失败'
  } finally {
    importing.value = false
  }
}

function summaryRows(summary: CalculatorBuffImportSummary) {
  return SNAPSHOT_KEYS.map((key) => ({
    key,
    label: TYPE_LABELS[key],
    ...summary[key],
  }))
}
</script>

<template>
  <section class="editor-panel import-export-panel">
    <header class="panel-header">
      <h2 class="panel-title">增益导入 / 导出</h2>
      <p class="panel-desc">
        用于备份和批量维护角色、音擎、邦布、驱动盘、招式小类、招式库等计算器增益。导入按 ID
        新增或覆盖，不会清空文件中没有的条目。
      </p>
    </header>

    <div class="count-grid">
      <button
        v-for="item in counts"
        :key="item.key"
        type="button"
        class="count-card"
        :class="{ active: exportScope === 'picked' && pickType === item.key }"
        @click="openPickedType(item.key)"
      >
        <p class="count-label">{{ item.label }}</p>
        <p class="count-value">{{ item.count }}</p>
      </button>
    </div>

    <section class="io-card">
      <h3>导出</h3>
      <p class="io-hint">完整快照从数据库拉取。要改某几条时，在下方搜索勾选即可，不必去编辑页点选。</p>
      <div class="io-row">
        <label class="field">
          <span>范围</span>
          <select v-model="exportScope">
            <option value="picked">自选若干条</option>
            <option value="all">全部增益</option>
            <option value="agents">全部角色</option>
            <option value="wengines">全部音擎</option>
            <option value="bangboos">全部邦布</option>
            <option value="driveDiscs">全部驱动盘</option>
            <option value="skillSubcategories">全部招式小类</option>
            <option value="followUpSkillRules">全部追击规则</option>
            <option value="damageEventModes">全部伤害事件模式</option>
            <option value="skills">全部招式库</option>
          </select>
        </label>
      </div>

      <div v-if="exportScope === 'picked'" class="picker">
        <div class="picker-tabs">
          <button
            v-for="key in SNAPSHOT_KEYS"
            :key="key"
            type="button"
            class="picker-tab"
            :class="{ active: pickType === key }"
            @click="pickType = key"
          >
            {{ TYPE_LABELS[key] }}
            <span v-if="selectedIds[key].length" class="tab-count">{{ selectedIds[key].length }}</span>
          </button>
        </div>
        <div class="picker-toolbar">
          <input
            v-model="pickQuery"
            class="search-input"
            type="search"
            :placeholder="`搜索${TYPE_LABELS[pickType]}名称或 ID`"
          />
          <button type="button" class="secondary-btn compact" @click="selectFiltered">
            全选当前筛选
          </button>
          <button type="button" class="secondary-btn compact" @click="clearCurrentType">清空此类</button>
          <button type="button" class="secondary-btn compact" @click="clearAllPicked">清空全部</button>
        </div>
        <p class="current-note">
          {{
            selectedCount
              ? `已选 ${selectedCount} 条（${selectedSummary}）`
              : `未勾选。点选上方分类后勾选要导出的${TYPE_LABELS[pickType]}。`
          }}
        </p>
        <div class="pick-list" role="listbox" aria-multiselectable="true">
          <label v-for="row in filteredPickRows" :key="row.id" class="pick-item">
            <input type="checkbox" :checked="isPicked(row.id)" @change="togglePicked(row.id)" />
            <span class="pick-text">
              <span class="pick-title">{{ row.title }}</span>
              <span class="pick-hint">{{ row.hint }}</span>
            </span>
          </label>
          <p v-if="!filteredPickRows.length" class="empty-hint">没有匹配的条目</p>
        </div>
      </div>

      <div class="io-actions">
        <button
          type="button"
          class="primary-btn"
          :disabled="exporting || (exportScope === 'picked' && !selectedCount)"
          @click="exportSnapshot"
        >
          {{
            exporting
              ? '导出中...'
              : exportScope === 'picked'
                ? `导出已选 ${selectedCount} 条`
                : '导出 JSON'
          }}
        </button>
      </div>
    </section>

    <section class="io-card">
      <h3>导入</h3>
      <p class="io-hint">支持完整快照、某一类数组，或单条增益对象。请先导出备份。</p>
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

    <AdminConfirmDialog
      :visible="importConfirmVisible"
      title="确认导入增益"
      message="将按 ID 新增或覆盖对应增益，不会删除文件中没有的条目。导入前建议先导出备份。"
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
.import-export-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.count-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.count-card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 0.85rem 1rem;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.count-card:hover,
.count-card.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
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
.empty-hint {
  margin: 0;
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.75;
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
  min-width: 16rem;
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

.picker-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.picker-tab {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background);
  color: var(--color-heading);
  padding: 0.28rem 0.75rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.picker-tab.active {
  border-color: hsla(160, 100%, 37%, 0.6);
  background: hsla(160, 100%, 37%, 0.12);
  font-weight: 600;
}

.tab-count {
  margin-left: 0.25rem;
  color: hsl(160, 100%, 32%);
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
