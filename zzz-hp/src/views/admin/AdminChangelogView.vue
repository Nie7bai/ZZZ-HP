<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  createChangelog,
  deleteChangelog,
  fetchChangelogs,
  updateChangelog,
  type ChangelogEntry,
} from '@/api/changelog'
import { clearAdminAuthenticated } from '@/utils/adminAuth'

const router = useRouter()

const entries = ref<ChangelogEntry[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')
const editingId = ref<number | null>(null)

const form = reactive({
  version: '',
  title: '',
  content: '',
  publishedAt: '',
})

function toDateInputValue(value?: string) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDate(value: string) {
  return toDateInputValue(value) || value
}

function resetForm() {
  editingId.value = null
  form.version = ''
  form.title = ''
  form.content = ''
  form.publishedAt = ''
}

function startCreate() {
  resetForm()
  message.value = ''
  error.value = ''
}

function startEdit(entry: ChangelogEntry) {
  editingId.value = entry.id
  form.version = entry.version
  form.title = entry.title
  form.content = entry.content
  form.publishedAt = toDateInputValue(entry.publishedAt)
  message.value = ''
  error.value = ''
}

async function loadEntries() {
  loading.value = true
  error.value = ''
  try {
    entries.value = await fetchChangelogs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function submitForm() {
  message.value = ''
  error.value = ''
  const version = form.version.trim()
  const title = form.title.trim()
  const content = form.content.trim()
  if (!version || !title || !content) {
    error.value = '版本号、标题、内容均为必填'
    return
  }

  saving.value = true
  try {
    const payload = {
      version,
      title,
      content,
      publishedAt: form.publishedAt.trim() || null,
    }
    if (editingId.value != null) {
      await updateChangelog(editingId.value, payload)
      message.value = `已更新 v${version}`
    } else {
      await createChangelog(payload)
      message.value = `已创建 v${version}`
    }
    resetForm()
    await loadEntries()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeEntry(entry: ChangelogEntry) {
  if (!window.confirm(`确认删除 v${entry.version}「${entry.title}」？`)) return
  message.value = ''
  error.value = ''
  try {
    await deleteChangelog(entry.id)
    if (editingId.value === entry.id) resetForm()
    message.value = `已删除 v${entry.version}`
    await loadEntries()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

function logout() {
  clearAdminAuthenticated()
  router.push('/admin/login')
}

onMounted(() => {
  void loadEntries()
})
</script>

<template>
  <main class="changelog-admin">
    <RouterLink to="/admin" class="back">← 返回管理员入口</RouterLink>
    <button type="button" class="logout" @click="logout">退出登录</button>

    <header class="page-header">
      <h1>更新日志管理</h1>
      <p>维护首页展示的版本说明；最新一条会显示为当前版本。</p>
    </header>

    <div class="layout">
      <section class="card form-card">
        <div class="card-head">
          <h2>{{ editingId != null ? `编辑 #${editingId}` : '新增版本' }}</h2>
          <button v-if="editingId != null" type="button" class="ghost-btn" @click="startCreate">
            改为新增
          </button>
        </div>

        <label class="field">
          <span>版本号</span>
          <input v-model="form.version" type="text" placeholder="如 3.0.1" />
        </label>
        <label class="field">
          <span>标题</span>
          <input v-model="form.title" type="text" placeholder="简短标题" />
        </label>
        <label class="field">
          <span>发布日期</span>
          <input v-model="form.publishedAt" type="date" />
        </label>
        <label class="field">
          <span>更新内容</span>
          <textarea
            v-model="form.content"
            rows="12"
            placeholder="每行一条，可写 · 开头的列表"
          />
        </label>

        <div class="actions">
          <button type="button" class="primary" :disabled="saving" @click="submitForm">
            {{ saving ? '保存中…' : editingId != null ? '保存修改' : '创建日志' }}
          </button>
          <button type="button" class="ghost-btn" :disabled="saving" @click="resetForm">清空</button>
        </div>

        <p v-if="message" class="msg ok">{{ message }}</p>
        <p v-if="error" class="msg err">{{ error }}</p>
      </section>

      <section class="card list-card">
        <div class="card-head">
          <h2>已有日志</h2>
          <button type="button" class="ghost-btn" :disabled="loading" @click="loadEntries">
            刷新
          </button>
        </div>
        <p v-if="loading" class="hint">加载中…</p>
        <p v-else-if="!entries.length" class="hint">暂无记录</p>
        <ul v-else class="entry-list">
          <li v-for="entry in entries" :key="entry.id" class="entry">
            <div class="entry-top">
              <strong>v{{ entry.version }}</strong>
              <span class="entry-date">{{ formatDate(entry.publishedAt) }}</span>
            </div>
            <p class="entry-title">{{ entry.title }}</p>
            <pre class="entry-preview">{{ entry.content }}</pre>
            <div class="entry-actions">
              <button type="button" class="ghost-btn" @click="startEdit(entry)">编辑</button>
              <button type="button" class="danger-btn" @click="removeEntry(entry)">删除</button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </main>
</template>

<style scoped>
.changelog-admin {
  min-height: 100vh;
  padding: 1.5rem 1.25rem 2.5rem;
  position: relative;
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
  max-width: 1100px;
  margin: 2.5rem auto 1.25rem;
  text-align: center;
}

.page-header h1 {
  margin: 0 0 0.4rem;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  color: var(--color-heading);
}

.page-header p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text);
  opacity: 0.7;
}

.layout {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
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
.field textarea {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.field textarea {
  resize: vertical;
  min-height: 180px;
  line-height: 1.5;
}

.actions {
  display: flex;
  gap: 0.55rem;
  margin-top: 0.25rem;
}

.primary,
.ghost-btn,
.danger-btn {
  border-radius: 8px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.45rem 0.85rem;
}

.primary {
  border: none;
  background: #3d7a5a;
  color: #fff;
}

.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ghost-btn {
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text);
}

.danger-btn {
  border: 1px solid color-mix(in srgb, #c44 45%, transparent);
  background: transparent;
  color: #c44;
}

.msg {
  margin: 0.75rem 0 0;
  font-size: 0.85rem;
}

.msg.ok {
  color: #2f6f4e;
}

.msg.err {
  color: #c44;
}

.hint {
  margin: 0;
  font-size: 0.88rem;
  opacity: 0.7;
}

.entry-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: min(70vh, 720px);
  overflow: auto;
}

.entry {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.75rem 0.8rem;
  background: var(--color-background);
}

.entry-top {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.entry-top strong {
  color: #c4a35a;
}

.entry-date {
  font-size: 0.78rem;
  opacity: 0.6;
}

.entry-title {
  margin: 0 0 0.45rem;
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--color-heading);
}

.entry-preview {
  margin: 0 0 0.65rem;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 0.8rem;
  line-height: 1.45;
  opacity: 0.85;
  max-height: 8.5rem;
  overflow: auto;
}

.entry-actions {
  display: flex;
  gap: 0.45rem;
}

@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .back,
  .logout {
    position: static;
    display: inline-flex;
    margin-bottom: 0.5rem;
  }

  .page-header {
    margin-top: 0.75rem;
    text-align: left;
  }
}
</style>
