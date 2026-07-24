<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  fetchAdminGuestbookUsers,
  setAdminGuestbookUserBanned,
  updateAdminGuestbookUser,
  type AdminGuestbookUser,
} from '@/api/adminGuestbookUsers'
import { resolveAssetUrl } from '@/utils/gameData'

const users = ref<AdminGuestbookUser[]>([])
const total = ref(0)
const loading = ref(false)
const saving = ref(false)
const message = ref('')
const error = ref('')

const filters = reactive({
  q: '',
  banned: '' as '' | '0' | '1',
})

const editing = ref<AdminGuestbookUser | null>(null)
const editForm = reactive({
  nickname: '',
  bio: '',
})

const banTarget = ref<AdminGuestbookUser | null>(null)
const banReason = ref('')
/** 0 = 永久；其余为小时 */
const banDurationHours = ref(0)

const resultText = computed(() => {
  if (loading.value) return ''
  return `共 ${total.value} 个账号，当前显示 ${users.value.length} 条`
})

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function avatarSrc(user: AdminGuestbookUser) {
  return resolveAssetUrl(user.avatar) || ''
}

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchAdminGuestbookUsers({
      q: filters.q,
      banned: filters.banned,
      limit: 200,
    })
    users.value = data.users
    total.value = data.total
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function openEdit(user: AdminGuestbookUser) {
  editing.value = user
  editForm.nickname = user.nickname
  editForm.bio = user.bio
  message.value = ''
  error.value = ''
}

function closeEdit() {
  editing.value = null
}

async function saveEdit() {
  if (!editing.value) return
  saving.value = true
  message.value = ''
  error.value = ''
  try {
    await updateAdminGuestbookUser(editing.value.id, {
      nickname: editForm.nickname.trim(),
      bio: editForm.bio.trim(),
    })
    message.value = `已更新 UID ${editing.value.id}`
    closeEdit()
    await loadUsers()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

function openBan(user: AdminGuestbookUser) {
  banTarget.value = user
  banReason.value = user.banReason || ''
  banDurationHours.value = 0
  message.value = ''
  error.value = ''
}

function closeBan() {
  banTarget.value = null
  banReason.value = ''
  banDurationHours.value = 0
}

async function confirmBan() {
  if (!banTarget.value) return
  saving.value = true
  message.value = ''
  error.value = ''
  try {
    await setAdminGuestbookUserBanned(
      banTarget.value.id,
      true,
      banReason.value.trim(),
      banDurationHours.value > 0 ? banDurationHours.value : null,
    )
    message.value = `已封禁 UID ${banTarget.value.id}`
    closeBan()
    await loadUsers()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '封禁失败'
  } finally {
    saving.value = false
  }
}

async function toggleSiteAdmin(user: AdminGuestbookUser) {
  saving.value = true
  message.value = ''
  error.value = ''
  try {
    await updateAdminGuestbookUser(user.id, { isSiteAdmin: !user.isSiteAdmin })
    message.value = user.isSiteAdmin
      ? `已取消 UID ${user.id} 的站点管理员`
      : `已设 UID ${user.id} 为站点管理员`
    await loadUsers()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '更新失败'
  } finally {
    saving.value = false
  }
}

async function unbanUser(user: AdminGuestbookUser) {
  if (!window.confirm(`确认解封 UID ${user.id}「${user.nickname}」？`)) return
  message.value = ''
  error.value = ''
  try {
    await setAdminGuestbookUserBanned(user.id, false)
    message.value = `已解封 UID ${user.id}`
    await loadUsers()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '解封失败'
  }
}

onMounted(() => {
  void loadUsers()
})
</script>

<template>
  <div class="acc-manage">
    <form class="acc-toolbar" @submit.prevent="loadUsers">
      <label class="acc-search">
        <span class="acc-search__icon" aria-hidden="true">⌕</span>
        <input
          v-model="filters.q"
          type="search"
          maxlength="80"
          placeholder="UID / 昵称 / AID / 手机号"
        />
      </label>
      <select v-model="filters.banned" class="acc-select">
        <option value="">全部状态</option>
        <option value="0">正常</option>
        <option value="1">已封禁</option>
      </select>
      <button type="submit" class="acc-btn" :disabled="loading">搜索</button>
      <button type="button" class="acc-btn ghost" :disabled="loading" @click="loadUsers">刷新</button>
    </form>

    <p v-if="resultText" class="acc-hint">{{ resultText }}</p>
    <p v-if="message" class="acc-hint ok">{{ message }}</p>
    <p v-if="error" class="acc-hint err">{{ error }}</p>

    <p v-if="loading" class="acc-empty">加载中…</p>
    <p v-else-if="!users.length" class="acc-empty">暂无账号</p>

    <ul v-else class="acc-list">
      <li
        v-for="user in users"
        :key="user.id"
        class="acc-card"
        :class="{ 'is-banned': user.isBanned }"
      >
        <div class="acc-card__head">
          <span class="acc-avatar">
            <img v-if="avatarSrc(user)" :src="avatarSrc(user)" alt="" />
            <span v-else>{{ (user.nickname || '?').slice(0, 1) }}</span>
          </span>
          <div class="acc-card__identity">
            <strong>{{ user.nickname }}</strong>
            <span>UID {{ user.id }}</span>
          </div>
          <span v-if="user.isBanned" class="acc-badge bad">已封禁</span>
          <span v-else class="acc-badge ok">正常</span>
          <span v-if="user.isSiteAdmin" class="acc-badge accent">站点管理</span>
        </div>

        <div class="acc-card__meta">
          <span>AID {{ user.mihoyoAid || '—' }}</span>
          <span>MID {{ user.mihoyoMid || '—' }}</span>
          <span>手机 {{ user.phone || (user.hasPhone ? '已绑定' : '未绑定') }}</span>
          <span>注册 {{ formatDateTime(user.createdAt) }}</span>
        </div>

        <div class="acc-card__stats">
          <span>帖子 {{ user.stats.postCount }}</span>
          <span>评论 {{ user.stats.commentCount }}</span>
          <span>浏览 {{ user.stats.totalViews }}</span>
          <span v-if="user.hasPassword" class="acc-chip">有密码</span>
          <span v-if="user.isGuestbookModerator" class="acc-chip accent">留言板管理</span>
        </div>

        <p v-if="user.isBanned && user.banReason" class="acc-reason">原因：{{ user.banReason }}</p>
        <p v-if="user.isBanned" class="acc-reason">
          期限：{{ user.banUntil ? formatDateTime(user.banUntil) : '永久' }}
        </p>

        <div class="acc-card__actions">
          <button type="button" class="acc-action" @click="openEdit(user)">编辑</button>
          <button type="button" class="acc-action" :disabled="saving" @click="toggleSiteAdmin(user)">
            {{ user.isSiteAdmin ? '取消站点管理' : '设为站点管理' }}
          </button>
          <button
            v-if="!user.isBanned"
            type="button"
            class="acc-action danger"
            @click="openBan(user)"
          >
            封禁
          </button>
          <button v-else type="button" class="acc-action" @click="unbanUser(user)">解封</button>
        </div>
      </li>
    </ul>

    <div v-if="editing" class="acc-dialog" role="dialog" aria-modal="true">
      <button type="button" class="acc-dialog__mask" aria-label="关闭" @click="closeEdit" />
      <div class="acc-dialog__panel">
        <h3>编辑 UID {{ editing.id }}</h3>
        <label class="acc-field">
          <span>昵称</span>
          <input v-model="editForm.nickname" type="text" maxlength="20" />
        </label>
        <label class="acc-field">
          <span>签名</span>
          <textarea v-model="editForm.bio" rows="3" maxlength="100" />
        </label>
        <div class="acc-dialog__actions">
          <button type="button" class="acc-action" @click="closeEdit">取消</button>
          <button type="button" class="acc-btn" :disabled="saving" @click="saveEdit">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="banTarget" class="acc-dialog" role="dialog" aria-modal="true">
      <button type="button" class="acc-dialog__mask" aria-label="关闭" @click="closeBan" />
      <div class="acc-dialog__panel">
        <h3>封禁 UID {{ banTarget.id }}</h3>
        <p class="acc-dialog__hint">可登录但无法发帖/评论；敲敲仍可用。将通知当事人封禁原因。</p>
        <label class="acc-field">
          <span>封禁时长</span>
          <select v-model.number="banDurationHours">
            <option :value="0">永久</option>
            <option :value="24">1 天</option>
            <option :value="72">3 天</option>
            <option :value="168">7 天</option>
            <option :value="720">30 天</option>
          </select>
        </label>
        <label class="acc-field">
          <span>封禁原因（建议填写）</span>
          <input v-model="banReason" type="text" maxlength="200" placeholder="将展示给用户" />
        </label>
        <div class="acc-dialog__actions">
          <button type="button" class="acc-action" @click="closeBan">取消</button>
          <button type="button" class="acc-action danger" :disabled="saving" @click="confirmBan">
            {{ saving ? '处理中…' : '确认封禁' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.acc-manage {
  --acc-primary: #bfff09;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 0;
  flex: 1;
  color: #f0f0f0;
}

.acc-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  padding: 0.55rem 0.15rem 0.35rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background:
    linear-gradient(90deg, rgba(191, 255, 9, 0.04), transparent 28%),
    transparent;
}

.acc-search {
  position: relative;
  flex: 1 1 12rem;
  min-width: 10rem;
}

.acc-search__icon {
  position: absolute;
  left: 0.7rem;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(191, 255, 9, 0.55);
  font-size: 0.9rem;
  pointer-events: none;
}

.acc-search input,
.acc-select,
.acc-field input,
.acc-field textarea,
.acc-field select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #333;
  border-radius: 10px 10px 0 10px;
  background: #161616;
  color: #eee;
  padding: 0.5rem 0.7rem;
  font: inherit;
}

.acc-search input {
  padding-left: 1.85rem;
}

.acc-search input:focus,
.acc-select:focus,
.acc-field input:focus,
.acc-field textarea:focus,
.acc-field select:focus {
  outline: none;
  border-color: rgba(191, 255, 9, 0.45);
}

.acc-field select {
  cursor: pointer;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, rgba(191, 255, 9, 0.75) 50%),
    linear-gradient(135deg, rgba(191, 255, 9, 0.75) 50%, transparent 50%);
  background-position:
    calc(100% - 14px) 50%,
    calc(100% - 9px) 50%;
  background-size:
    5px 5px,
    5px 5px;
  background-repeat: no-repeat;
  padding-right: 1.6rem;
}

.acc-select {
  width: auto;
  min-width: 7.5rem;
  cursor: pointer;
}

.acc-btn {
  border: none;
  border-radius: 999px;
  background: var(--acc-primary);
  color: #111;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 800;
  padding: 0.4rem 1rem;
  cursor: pointer;
}

.acc-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.acc-btn.ghost {
  background: #1a1a1a;
  color: #ddd;
  border: 1px solid #333;
}

.acc-hint {
  margin: 0;
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.45);
}

.acc-hint.ok {
  color: rgba(191, 255, 9, 0.85);
}

.acc-hint.err {
  color: #ff6b6b;
}

.acc-empty {
  margin: 2.5rem 0;
  text-align: center;
  color: #888;
  font-size: 0.95rem;
}

.acc-list {
  list-style: none;
  margin: 0;
  padding: 0.25rem 0 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.acc-card {
  border: 1px solid #222;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.55);
  padding: 0.85rem 0.95rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.acc-card.is-banned {
  border-color: rgba(255, 107, 107, 0.35);
  background: rgba(80, 16, 16, 0.35);
}

.acc-card__head {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.acc-avatar {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid #333;
  background: #1a1a1a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  color: #fff;
}

.acc-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.acc-card__identity {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.acc-card__identity strong {
  font-size: 0.95rem;
  font-weight: 800;
  color: #fff;
}

.acc-card__identity span {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
}

.acc-badge {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 800;
  border: 1px solid transparent;
}

.acc-badge.ok {
  color: var(--acc-primary);
  background: rgba(191, 255, 9, 0.1);
  border-color: rgba(191, 255, 9, 0.35);
}

.acc-badge.bad {
  color: #ff9a9a;
  background: rgba(255, 107, 107, 0.12);
  border-color: rgba(255, 120, 120, 0.35);
}

.acc-badge.accent {
  color: #9ad0ff;
  background: rgba(90, 160, 255, 0.12);
  border-color: rgba(110, 170, 255, 0.35);
}

.acc-card__meta,
.acc-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.62);
}

.acc-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  border: 1px solid #333;
  background: #1a1a1a;
  color: #ddd;
  font-size: 0.72rem;
  font-weight: 700;
}

.acc-chip.accent {
  border-color: rgba(191, 255, 9, 0.4);
  color: var(--acc-primary);
  background: rgba(191, 255, 9, 0.08);
}

.acc-reason {
  margin: 0;
  font-size: 0.78rem;
  color: #ff9a9a;
}

.acc-card__actions,
.acc-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.acc-dialog__actions {
  justify-content: flex-end;
  margin-top: 0.35rem;
}

.acc-action {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.88);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.acc-action:hover:not(:disabled) {
  border-color: rgba(191, 255, 9, 0.45);
  color: #bfff09;
}

.acc-action.danger {
  border-color: rgba(255, 120, 120, 0.35);
  color: #ff9a9a;
}

.acc-action.danger:hover:not(:disabled) {
  border-color: rgba(255, 120, 120, 0.65);
  color: #ffbdbd;
}

.acc-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.acc-dialog {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.acc-dialog__mask {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
  cursor: pointer;
}

.acc-dialog__panel {
  position: relative;
  z-index: 1;
  width: min(420px, 100%);
  padding: 1rem 1.1rem 1.1rem;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #1a1a1a;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.acc-dialog__panel h3 {
  margin: 0;
  color: #fff;
  font-size: 1rem;
}

.acc-dialog__hint {
  margin: 0;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.82rem;
}

.acc-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.55);
}

.acc-field textarea {
  resize: vertical;
}
</style>
