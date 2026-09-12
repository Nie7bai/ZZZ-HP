<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  deleteAffixPresetEntry,
  deleteAffixPresetGroup,
  fetchAffixPreset,
  replaceAffixPreset,
  saveAffixPresetEntry,
  saveAffixPresetGroup,
  type AffixPresetEntryDoc,
  type AffixPresetGroupDoc,
} from '@/api/affixPreset'
import { clearAdminAuthenticated } from '@/utils/adminAuth'

/**
 * 官方预设词条库管理（用户 2026-09-12 口径）
 *
 * 官方预设的唯一来源＝数据库；这个页面是**管理员改它的唯一入口**。
 * 用户侧只读：他们能把自己浏览器里的库改成任何样子，但改不到这里。
 *
 * ⚠️ **id 不可改**：用户本地的启用状态 / 每档覆盖 / 删除记录都按 id 索引，
 *    改 id 等于让那些记录全部失配。要改数值就改数值，别动 id
 *    （真要换 id 请删掉再新增，并接受用户侧记录失配）。
 */

const router = useRouter()

const entries = ref<AffixPresetEntryDoc[]>([])
const groups = ref<AffixPresetGroupDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')

const entryForm = reactive({
  id: '',
  label: '',
  target: 'panel:dmgBonus',
  perRoll: 30,
  cap: 1,
  group: '副词条',
  rollCost: 1,
  enabledByDefault: false,
  sortOrder: 0,
})
const editingId = ref('')

const groupForm = reactive({ name: '', cap: 1, sortOrder: 0 })
const editingGroupName = ref('')

const groupOptions = computed(() => groups.value.map((g) => g.name))
const enabledCount = computed(() => entries.value.filter((e) => e.enabledByDefault).length)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchAffixPreset()
    entries.value = data.entries
    groups.value = data.groups
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function resetEntryForm() {
  editingId.value = ''
  entryForm.id = ''
  entryForm.label = ''
  entryForm.target = 'panel:dmgBonus'
  entryForm.perRoll = 30
  entryForm.cap = 1
  entryForm.group = groupOptions.value[0] ?? '副词条'
  entryForm.rollCost = 1
  entryForm.enabledByDefault = false
  entryForm.sortOrder = entries.value.length
}

function startEditEntry(entry: AffixPresetEntryDoc) {
  editingId.value = entry.id
  entryForm.id = entry.id
  entryForm.label = entry.label
  entryForm.target = entry.target
  entryForm.perRoll = entry.perRoll
  entryForm.cap = entry.cap
  entryForm.group = entry.group
  entryForm.rollCost = entry.rollCost
  entryForm.enabledByDefault = entry.enabledByDefault
  entryForm.sortOrder = entry.sortOrder ?? 0
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function submitEntry() {
  message.value = ''
  error.value = ''
  saving.value = true
  try {
    const saved = await saveAffixPresetEntry({ ...entryForm })
    message.value = `已保存「${saved.label}」`
    await loadAll()
    resetEntryForm()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeEntry(entry: AffixPresetEntryDoc) {
  if (!window.confirm(`确认删除「${entry.label}」（${entry.id}）？\n用户本地若存着这条的状态会失配（他们那边的勾选/覆盖会失效）。`)) return
  message.value = ''
  error.value = ''
  try {
    await deleteAffixPresetEntry(entry.id)
    if (editingId.value === entry.id) resetEntryForm()
    message.value = `已删除「${entry.label}」`
    await loadAll()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

function resetGroupForm() {
  editingGroupName.value = ''
  groupForm.name = ''
  groupForm.cap = 1
  groupForm.sortOrder = groups.value.length
}

function startEditGroup(group: AffixPresetGroupDoc) {
  editingGroupName.value = group.name
  groupForm.name = group.name
  groupForm.cap = group.cap
  groupForm.sortOrder = group.sortOrder ?? 0
}

async function submitGroup() {
  message.value = ''
  error.value = ''
  saving.value = true
  try {
    const saved = await saveAffixPresetGroup({ ...groupForm })
    message.value = `已保存分组「${saved.name}」（额度 ${saved.cap}）`
    await loadAll()
    resetGroupForm()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存分组失败'
  } finally {
    saving.value = false
  }
}

async function removeGroup(group: AffixPresetGroupDoc) {
  const used = entries.value.filter((e) => e.group === group.name).length
  const hint = used
    ? `\n该组下有 ${used} 条条目，删组后它们的分组名会指向一个不存在的组（读盘时会被兜底补回）。`
    : ''
  if (!window.confirm(`确认删除分组「${group.name}」？${hint}`)) return
  message.value = ''
  error.value = ''
  try {
    await deleteAffixPresetGroup(group.name)
    if (editingGroupName.value === group.name) resetGroupForm()
    message.value = `已删除分组「${group.name}」`
    await loadAll()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除分组失败'
  }
}

/** 用数据库里现有内容整份重写（走事务，失败不留半份）—— 用于「我改乱了想确认一次」 */
async function replaceAll() {
  if (!window.confirm(`把当前这 ${entries.value.length} 条 / ${groups.value.length} 组整份重写一遍？`)) return
  message.value = ''
  error.value = ''
  saving.value = true
  try {
    const data = await replaceAffixPreset({
      entries: entries.value,
      groups: groups.value,
    })
    message.value = `已重写：${data.entries.length} 条 / ${data.groups.length} 组`
    await loadAll()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '重写失败'
  } finally {
    saving.value = false
  }
}

function logout() {
  clearAdminAuthenticated()
  router.push('/admin/login')
}

onMounted(() => {
  void loadAll().then(resetEntryForm)
})
</script>

<template>
  <main class="affix-preset-admin">
    <RouterLink to="/admin" class="back">← 返回管理员入口</RouterLink>
    <button type="button" class="logout" @click="logout">退出登录</button>

    <header class="page-header">
      <h1>官方预设词条库</h1>
      <p>
        这里是<strong>官方预设的唯一来源</strong>：进计算页的人都会拿到这份。用户能复制一份到自己浏览器里随便改，
        但改不回这里。<strong>条目 ID 一旦发布不要改</strong> —— 用户本地的勾选、每档覆盖、删除记录都按 ID 索引。
      </p>
    </header>

    <p v-if="message" class="ok-msg">{{ message }}</p>
    <p v-if="error" class="err">{{ error }}</p>

    <section class="stat-row">
      <span>条目 <strong>{{ entries.length }}</strong> 条</span>
      <span>默认启用 <strong>{{ enabledCount }}</strong> 条</span>
      <span>分组 <strong>{{ groups.length }}</strong> 个</span>
      <button type="button" class="ghost-btn" :disabled="loading || saving" @click="loadAll">
        {{ loading ? '读取中…' : '重新读取' }}
      </button>
      <button type="button" class="ghost-btn" :disabled="loading || saving" @click="replaceAll">
        整份重写
      </button>
    </section>

    <div class="layout">
      <section class="card">
        <div class="card-head">
          <h2>{{ editingId ? `编辑条目 ${editingId}` : '新增条目' }}</h2>
          <button v-if="editingId" type="button" class="ghost-btn" @click="resetEntryForm">
            改为新增
          </button>
        </div>

        <label class="field">
          <span>ID（稳定，不可改）</span>
          <input
            v-model="entryForm.id"
            type="text"
            :disabled="Boolean(editingId)"
            placeholder="如 main:slot4:critDmg"
          />
        </label>
        <label class="field">
          <span>名称</span>
          <input v-model="entryForm.label" type="text" placeholder="如 爆伤 48%" />
        </label>
        <label class="field">
          <span>目标（实际效果）</span>
          <input v-model="entryForm.target" type="text" placeholder="stat:critDmg 或 panel:dmgBonus" />
        </label>
        <p class="hint">
          `stat:` 走词条计数桶、`panel:` 走面板字段；两者折算口径相同。
          字段名必须是前端认识的（认不出的会被跳过并计数）。
        </p>
        <div class="field-row">
          <label class="field">
            <span>每档</span>
            <input v-model.number="entryForm.perRoll" type="number" step="0.1" min="0" />
          </label>
          <label class="field">
            <span>上限（0=不限）</span>
            <input v-model.number="entryForm.cap" type="number" min="0" step="1" />
          </label>
          <label class="field">
            <span>每档占用</span>
            <input v-model.number="entryForm.rollCost" type="number" min="0" step="1" />
          </label>
        </div>
        <div class="field-row">
          <label class="field">
            <span>分组</span>
            <select v-model="entryForm.group">
              <option value="">（未分组）</option>
              <option v-for="name in groupOptions" :key="name" :value="name">{{ name }}</option>
            </select>
          </label>
          <label class="field">
            <span>排序</span>
            <input v-model.number="entryForm.sortOrder" type="number" step="1" />
          </label>
          <label class="field field--check">
            <span>默认启用</span>
            <input v-model="entryForm.enabledByDefault" type="checkbox" />
          </label>
        </div>

        <div class="actions">
          <button type="button" class="primary-btn" :disabled="saving" @click="submitEntry">
            {{ saving ? '保存中…' : editingId ? '保存修改' : '新增' }}
          </button>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>{{ editingGroupName ? `编辑分组 ${editingGroupName}` : '新增分组' }}</h2>
          <button v-if="editingGroupName" type="button" class="ghost-btn" @click="resetGroupForm">
            改为新增
          </button>
        </div>
        <label class="field">
          <span>组名</span>
          <input
            v-model="groupForm.name"
            type="text"
            :disabled="Boolean(editingGroupName)"
            placeholder="如 4号位"
          />
        </label>
        <label class="field">
          <span>组额度（0=不限）</span>
          <input v-model.number="groupForm.cap" type="number" min="0" step="1" />
        </label>
        <label class="field">
          <span>排序</span>
          <input v-model.number="groupForm.sortOrder" type="number" step="1" />
        </label>
        <p class="hint">组额度 = 组内各条档数之和的上限。4/5/6 号位、2 件套都用 1（只能选一条）。</p>
        <div class="actions">
          <button type="button" class="primary-btn" :disabled="saving" @click="submitGroup">
            {{ saving ? '保存中…' : editingGroupName ? '保存分组' : '新增分组' }}
          </button>
        </div>

        <ul class="group-list">
          <li v-for="group in groups" :key="group.name">
            <span class="group-name">{{ group.name }}</span>
            <span class="group-cap">额度 {{ group.cap === 0 ? '不限' : group.cap }}</span>
            <button type="button" class="ghost-btn" @click="startEditGroup(group)">编辑</button>
            <button type="button" class="ghost-btn danger" @click="removeGroup(group)">删除</button>
          </li>
        </ul>
      </section>
    </div>

    <section class="card table-card">
      <div class="card-head">
        <h2>条目（{{ entries.length }}）</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>目标</th>
              <th>每档</th>
              <th>上限</th>
              <th>每档占用</th>
              <th>分组</th>
              <th>默认启用</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.id">
              <td class="mono">{{ entry.id }}</td>
              <td>{{ entry.label }}</td>
              <td class="mono">{{ entry.target }}</td>
              <td class="num">{{ entry.perRoll }}</td>
              <td class="num">{{ entry.cap === 0 ? '不限' : entry.cap }}</td>
              <td class="num">{{ entry.rollCost }}</td>
              <td>{{ entry.group || '—' }}</td>
              <td>{{ entry.enabledByDefault ? '✓' : '' }}</td>
              <td class="row-actions">
                <button type="button" class="ghost-btn" @click="startEditEntry(entry)">编辑</button>
                <button type="button" class="ghost-btn danger" @click="removeEntry(entry)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>
</template>

<style scoped>
/* 配色一律走主题变量（与其他管理页一致）：写死深色在白天模式下会变成
   「浅色页面上浮着深色卡片」，2026-09-12 实测发现并修正。 */
.affix-preset-admin {
  min-height: 100vh;
  max-width: 1180px;
  margin: 0 auto;
  padding: 1.5rem 1.25rem 2.5rem;
  position: relative;
  color: var(--color-text);
}

.back,
.logout {
  position: absolute;
  top: 1.25rem;
  font-size: 0.85rem;
  text-decoration: none;
  color: var(--color-text);
  opacity: 0.75;
}

.back {
  left: 1.25rem;
}

.logout {
  right: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background-soft);
  padding: 0.35rem 0.8rem;
  cursor: pointer;
}

.back:hover,
.logout:hover {
  opacity: 1;
}

.page-header {
  margin: 2.5rem auto 1.25rem;
  text-align: center;
}

.page-header h1 {
  margin: 0 0 0.4rem;
  font-size: clamp(1.5rem, 3vw, 1.9rem);
  color: var(--color-heading);
}

.page-header p {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
  line-height: 1.6;
}

.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin: 1rem 0;
  font-size: 0.85rem;
  opacity: 0.85;
}

/* 强调色：浅底用深金、深底用浅金（主题挂在 <html data-theme> 上，见 stores/theme.ts） */
.stat-row strong {
  color: #a8781f;
}

[data-theme='dark'] .stat-row strong {
  color: #f0d7a2;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

.card {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem 1.05rem 1.15rem;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.card-head h2 {
  margin: 0;
  font-size: 1.05rem;
  color: var(--color-heading);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
  color: var(--color-text);
}

.field input,
.field select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.5rem 0.6rem;
  font: inherit;
}

.field--check {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
}

.field--check input {
  width: auto;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.6rem;
}

.hint {
  margin: 0 0 0.75rem;
  font-size: 0.78rem;
  opacity: 0.65;
  line-height: 1.5;
}

.actions {
  display: flex;
  gap: 0.55rem;
  margin-top: 0.25rem;
}

.primary-btn {
  border: none;
  border-radius: 8px;
  background: #3d7a5a;
  color: #fff;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.45rem 0.85rem;
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ghost-btn {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0.3rem 0.65rem;
}

.ghost-btn.danger {
  border-color: color-mix(in srgb, #c44 45%, transparent);
  color: #c44;
}

.group-list {
  margin: 0.9rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
}

.group-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-top: 1px solid var(--color-border);
}

.group-name {
  flex: 1;
}

.group-cap {
  opacity: 0.65;
}

.table-card {
  margin-top: 1rem;
}

.table-wrap {
  overflow: auto;
  max-height: 60vh;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

th,
td {
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  white-space: nowrap;
}

th {
  position: sticky;
  top: 0;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-weight: 600;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  opacity: 0.7;
}

.num {
  text-align: right;
}

.row-actions {
  display: flex;
  gap: 0.35rem;
}

.ok-msg {
  color: #2f6f4e;
  font-size: 0.85rem;
}

.err {
  color: #c44;
  font-size: 0.85rem;
}
</style>
