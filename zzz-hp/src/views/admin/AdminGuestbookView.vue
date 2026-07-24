<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  addGuestbookModerator,
  fetchGuestbookModerators,
  removeGuestbookModerator,
  toggleGuestbookModerator,
  type GuestbookModerator,
} from '@/api/guestbook'
import { clearAdminAuthenticated } from '@/utils/adminAuth'

const router = useRouter()

const moderators = ref<GuestbookModerator[]>([])
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')

const form = reactive({
  mihoyoAid: '',
  mihoyoMid: '',
  note: '',
})

function formatDateTime(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

async function loadModerators() {
  loading.value = true
  error.value = ''
  try {
    moderators.value = await fetchGuestbookModerators()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function submitModerator() {
  message.value = ''
  error.value = ''
  const aid = form.mihoyoAid.trim()
  if (!aid) {
    error.value = '请填写米游社 AID'
    return
  }
  saving.value = true
  try {
    await addGuestbookModerator({
      mihoyoAid: aid,
      mihoyoMid: form.mihoyoMid.trim() || undefined,
      note: form.note.trim() || undefined,
    })
    message.value = `已添加 AID ${aid}`
    form.mihoyoAid = ''
    form.mihoyoMid = ''
    form.note = ''
    await loadModerators()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '添加失败'
  } finally {
    saving.value = false
  }
}

async function removeModerator(item: GuestbookModerator) {
  if (!window.confirm(`确认移除留言板管理员 AID ${item.mihoyoAid}？`)) return
  message.value = ''
  error.value = ''
  try {
    await removeGuestbookModerator(item.id)
    message.value = `已移除 AID ${item.mihoyoAid}`
    await loadModerators()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '移除失败'
  }
}

async function toggleModerator(item: GuestbookModerator) {
  message.value = ''
  error.value = ''
  try {
    await toggleGuestbookModerator(item.id, !item.isEnabled)
    message.value = `AID ${item.mihoyoAid} 已${item.isEnabled ? '停用' : '启用'}`
    await loadModerators()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '更新状态失败'
  }
}

function logout() {
  clearAdminAuthenticated()
  router.push('/admin/login')
}

onMounted(() => {
  void loadModerators()
})
</script>

<template>
  <main class="guestbook-admin">
    <RouterLink to="/admin" class="back">← 返回管理员入口</RouterLink>
    <button type="button" class="logout" @click="logout">退出登录</button>

    <header class="page-header">
      <h1>留言板管理员</h1>
      <p>通过米游社 AID / MID 添加可在留言板内管理帖子的账号。帖子管理已移至留言板内。</p>
    </header>

    <section class="card">
      <h2>添加管理员</h2>
      <form class="form-grid" @submit.prevent="submitModerator">
        <label>
          <span>米游社 AID</span>
          <input v-model="form.mihoyoAid" type="text" maxlength="64" placeholder="必填" required />
        </label>
        <label>
          <span>米游社 MID</span>
          <input v-model="form.mihoyoMid" type="text" maxlength="64" placeholder="可选" />
        </label>
        <label class="span-2">
          <span>备注</span>
          <input v-model="form.note" type="text" maxlength="80" placeholder="可选，如昵称或说明" />
        </label>
        <div class="span-2 form-actions">
          <button type="submit" class="primary-btn" :disabled="saving">
            {{ saving ? '添加中…' : '添加管理员' }}
          </button>
        </div>
      </form>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>已授权账号（{{ moderators.length }}）</h2>
        <button type="button" class="ghost-btn" :disabled="loading" @click="loadModerators">刷新</button>
      </div>

      <p v-if="message" class="msg ok">{{ message }}</p>
      <p v-if="error" class="msg err">{{ error }}</p>
      <p v-if="loading" class="hint">加载中…</p>
      <p v-else-if="!moderators.length" class="hint">还没有留言板管理员</p>

      <ul v-else class="mod-list">
        <li v-for="item in moderators" :key="item.id" class="mod-item">
          <div class="mod-item__main">
            <strong>AID {{ item.mihoyoAid }}</strong>
            <span v-if="item.mihoyoMid" class="mod-item__mid">MID {{ item.mihoyoMid }}</span>
            <span v-if="item.note" class="mod-item__note">{{ item.note }}</span>
          </div>
          <div class="mod-item__meta">
            <span class="mod-item__status" :class="{ off: item.isEnabled === false }">
              {{ item.isEnabled === false ? '已停用' : '已启用' }}
            </span>
            <span>{{ formatDateTime(item.createdAt) }}</span>
            <button type="button" class="ghost-btn" @click="toggleModerator(item)">
              {{ item.isEnabled === false ? '启用' : '停用' }}
            </button>
            <button type="button" class="danger-btn" @click="removeModerator(item)">移除</button>
          </div>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.guestbook-admin {
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

.page-header {
  max-width: 860px;
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

.card {
  max-width: 860px;
  margin: 0 auto 1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  padding: 1rem 1.05rem 1.15rem;
}

.card h2 {
  margin: 0 0 0.85rem;
  font-size: 1.05rem;
  color: var(--color-heading);
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
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.82rem;
  color: var(--color-text);
}

.form-grid label.span-2 {
  grid-column: span 2;
}

.form-grid input {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-text);
  font: inherit;
  padding: 0.55rem 0.65rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.primary-btn,
.ghost-btn,
.danger-btn {
  border-radius: 8px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.45rem 0.85rem;
}

.primary-btn {
  border: 1px solid color-mix(in srgb, #6b9fd4 45%, transparent);
  background: color-mix(in srgb, #6b9fd4 14%, transparent);
  color: #3d6a9a;
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
  margin: 0 0 0.65rem;
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

.mod-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.mod-item {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0.75rem 0.8rem;
  background: var(--color-background);
}

.mod-item__main {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}

.mod-item__main strong {
  color: #c4a35a;
}

.mod-item__mid,
.mod-item__note {
  font-size: 0.82rem;
  opacity: 0.75;
}

.mod-item__meta {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.78rem;
  opacity: 0.65;
}

.mod-item__status {
  font-size: 0.78rem;
  color: #bfff09;
  opacity: 1;
}

.mod-item__status.off {
  color: #ff8a8a;
}

@media (max-width: 720px) {
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

  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-grid label.span-2,
  .form-actions {
    grid-column: span 1;
  }

  .mod-item {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
