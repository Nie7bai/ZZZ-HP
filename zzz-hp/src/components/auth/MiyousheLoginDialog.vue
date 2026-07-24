<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import {
  createMihoyoQr,
  loginWithPassword,
  pollMihoyoQr,
  type MihoyoQrStatus,
} from '@/api/auth'
import { useUserAuthStore, type SavedAccount } from '@/stores/userAuth'

const auth = useUserAuthStore()

type LoginTab = 'mihoyo' | 'phone'
const loginTab = ref<LoginTab>('mihoyo')
const phoneInput = ref('')
const passwordInput = ref('')
const phoneError = ref('')
const phoneLoading = ref(false)

const qrStatus = ref<MihoyoQrStatus | 'loading'>('loading')
const qrDataUrl = ref('')
const statusMessage = ref('')

let ticket = ''
let pollTimer: ReturnType<typeof setTimeout> | null = null
let polling = false
let starting = false
let consecutiveErrors = 0

const needRefresh = computed(
  () =>
    qrStatus.value === 'expired' ||
    qrStatus.value === 'cancelled' ||
    qrStatus.value === 'error',
)

const statusText = computed(() => {
  switch (qrStatus.value) {
    case 'loading':
      return '二维码生成中…'
    case 'waiting':
      return '请使用米游社 App 扫码登录'
    case 'scanned':
      return '已扫码，请在米游社 App 中确认'
    case 'confirmed':
      return '登录中…'
    case 'expired':
      return '二维码已过期，点击刷新'
    case 'cancelled':
      return '已取消扫码，点击刷新重试'
    case 'error':
      return statusMessage.value || '二维码获取失败，点击刷新重试'
    default:
      return ''
  }
})

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  polling = false
  ticket = ''
}

function schedulePoll(delayMs: number) {
  if (!polling || pollTimer) return
  pollTimer = setTimeout(() => {
    pollTimer = null
    void doPoll()
  }, delayMs)
}

async function startQr() {
  if (starting) return
  starting = true
  stopPolling()
  qrStatus.value = 'loading'
  qrDataUrl.value = ''
  statusMessage.value = ''
  consecutiveErrors = 0

  try {
    const res = await createMihoyoQr()
    if (!auth.loginDialogOpen) return
    qrDataUrl.value = await QRCode.toDataURL(res.qrUrl, { width: 220, margin: 1 })
    if (!auth.loginDialogOpen) return
    ticket = res.ticket
    qrStatus.value = 'waiting'
    polling = true
    schedulePoll(1500)
  } catch (err) {
    qrStatus.value = 'error'
    statusMessage.value = err instanceof Error ? err.message : '获取二维码失败'
  } finally {
    starting = false
  }
}

async function doPoll() {
  if (!polling || !ticket || !auth.loginDialogOpen) return

  try {
    const res = await pollMihoyoQr(ticket)
    if (!polling || !auth.loginDialogOpen) return
    consecutiveErrors = 0

    if (res.status === 'confirmed') {
      polling = false
      qrStatus.value = 'confirmed'
      if (!res.auth?.token || !res.auth.user) {
        qrStatus.value = 'error'
        statusMessage.value = '登录失败：未获取到 Token'
        return
      }
      auth.setSession(res.auth.token, res.auth.user)
      auth.closeLoginDialog()
      return
    }

    if (res.status === 'expired' || res.status === 'cancelled' || res.status === 'error') {
      polling = false
      qrStatus.value = res.status
      statusMessage.value = res.message || ''
      return
    }

    qrStatus.value = res.status
    schedulePoll(res.status === 'scanned' ? 3000 : 1500)
  } catch (err) {
    consecutiveErrors += 1
    const msg = err instanceof Error ? err.message : '轮询失败'
    if (/封禁/.test(msg)) {
      polling = false
      auth.setBanNotice(msg)
      qrStatus.value = 'error'
      statusMessage.value = msg
      return
    }
    if (consecutiveErrors >= 3) {
      polling = false
      qrStatus.value = 'error'
      statusMessage.value = msg
      return
    }
    schedulePoll(Math.min(1500 * consecutiveErrors, 5000))
  }
}

function close() {
  stopPolling()
  auth.closeLoginDialog()
}

function switchTab(tab: LoginTab) {
  loginTab.value = tab
  phoneError.value = ''
  if (tab === 'mihoyo') {
    if (!polling && auth.loginDialogOpen) void startQr()
  } else {
    stopPolling()
  }
}

async function submitPhoneLogin() {
  phoneError.value = ''
  auth.clearBanNotice()
  phoneLoading.value = true
  try {
    const res = await loginWithPassword(phoneInput.value.trim(), passwordInput.value)
    auth.setSession(res.token, res.user)
    auth.closeLoginDialog()
  } catch (err) {
    const msg = err instanceof Error ? err.message : '登录失败'
    if (/封禁/.test(msg)) auth.setBanNotice(msg)
    phoneError.value = msg
  } finally {
    phoneLoading.value = false
  }
}

const switchingAccountId = ref<number | null>(null)

async function switchSavedAccount(acc: SavedAccount) {
  if (switchingAccountId.value !== null) return
  phoneError.value = ''
  switchingAccountId.value = acc.userId
  try {
    await auth.switchAccount(acc)
    stopPolling()
  } catch (err) {
    phoneError.value =
      err instanceof Error ? err.message : '切换失败，请重新扫码登录'
  } finally {
    switchingAccountId.value = null
  }
}

watch(
  () => auth.loginDialogOpen,
  (open) => {
    if (open) {
      loginTab.value = 'mihoyo'
      phoneInput.value = ''
      passwordInput.value = ''
      phoneError.value = ''
      void startQr()
    } else stopPolling()
  },
)

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="mhy-login">
      <div
        v-if="auth.loginDialogOpen"
        class="mhy-login"
        role="dialog"
        aria-modal="true"
        aria-label="米游社登录"
        @mousedown.self="close"
      >
        <div class="mhy-login__backdrop" aria-hidden="true" />
        <div class="mhy-login__stripe" aria-hidden="true" />
        <div class="mhy-login__dialog" @click.stop>
          <div class="mhy-login__outer">
            <div class="mhy-login__inner">
              <header class="mhy-login__header">
                <strong>{{ loginTab === 'mihoyo' ? '米游社登录' : '手机号登录' }}</strong>
                <button type="button" class="mhy-login__close" aria-label="关闭" @click="close">
                  ×
                </button>
              </header>

              <p v-if="auth.banNotice" class="mhy-login__ban">{{ auth.banNotice }}</p>

              <div v-if="auth.savedAccounts.length" class="mhy-login__accounts">
                <p class="mhy-login__accounts-title">已保存账号（最多 3 个）</p>
                <div class="mhy-login__accounts-list">
                  <button
                    v-for="acc in auth.savedAccounts"
                    :key="acc.userId"
                    type="button"
                    class="mhy-login__account"
                    :class="{ 'is-active': auth.user?.id === acc.userId }"
                    :disabled="switchingAccountId === acc.userId"
                    @click="switchSavedAccount(acc)"
                  >
                    <span v-if="acc.avatar" class="mhy-login__account-avatar">
                      <img :src="acc.avatar" alt="" />
                    </span>
                    <span v-else class="mhy-login__account-avatar mhy-login__account-avatar--letter">
                      {{ acc.nickname.slice(0, 1) }}
                    </span>
                    <span class="mhy-login__account-meta">
                      <strong>{{ acc.nickname }}</strong>
                      <span>{{
                        switchingAccountId === acc.userId ? '切换中…' : `UID ${acc.userId}`
                      }}</span>
                    </span>
                  </button>
                </div>
                <p v-if="phoneError" class="mhy-login__phone-error mhy-login__accounts-error">{{ phoneError }}</p>
              </div>

              <div class="mhy-login__tabs">
                <button
                  type="button"
                  class="mhy-login__tab"
                  :class="{ active: loginTab === 'mihoyo' }"
                  @click="switchTab('mihoyo')"
                >
                  米游社扫码
                </button>
                <button
                  type="button"
                  class="mhy-login__tab"
                  :class="{ active: loginTab === 'phone' }"
                  @click="switchTab('phone')"
                >
                  手机号密码
                </button>
              </div>

              <div v-if="loginTab === 'mihoyo'" class="mhy-login__body">
                <div class="mhy-login__qr-box" :class="{ 'is-dimmed': needRefresh }">
                  <img
                    v-if="qrDataUrl"
                    :src="qrDataUrl"
                    alt="米游社登录二维码"
                    class="mhy-login__qr"
                    draggable="false"
                  />
                  <div v-else class="mhy-login__qr-placeholder" />
                  <button
                    v-if="needRefresh"
                    type="button"
                    class="mhy-login__refresh"
                    @click="startQr"
                  >
                    刷新二维码
                  </button>
                </div>
                <p class="mhy-login__status" :class="`is-${qrStatus}`">{{ statusText }}</p>
                <p class="mhy-login__hint">
                  打开米游社 App → 我的 → 扫一扫。确认后自动登录，新用户将自动创建账号。
                </p>
                <button type="button" class="mhy-login__back" @click="close">返回</button>
              </div>

              <div v-else class="mhy-login__body mhy-login__body--phone">
                <label class="mhy-login__field">
                  <span>手机号</span>
                  <input
                    v-model="phoneInput"
                    type="tel"
                    maxlength="11"
                    placeholder="已绑定的手机号"
                    @keydown.enter="submitPhoneLogin"
                  />
                </label>
                <label class="mhy-login__field">
                  <span>密码</span>
                  <input
                    v-model="passwordInput"
                    type="password"
                    maxlength="64"
                    placeholder="登录密码"
                    @keydown.enter="submitPhoneLogin"
                  />
                </label>
                <p v-if="phoneError" class="mhy-login__phone-error">{{ phoneError }}</p>
                <p class="mhy-login__hint">
                  需先在账号中心绑定手机号并设置密码。首次请使用米游社扫码登录。
                </p>
                <button
                  type="button"
                  class="mhy-login__phone-submit"
                  :disabled="phoneLoading || !phoneInput.trim() || !passwordInput"
                  @click="submitPhoneLogin"
                >
                  {{ phoneLoading ? '登录中…' : '登录' }}
                </button>
                <button type="button" class="mhy-login__back" @click="close">返回</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mhy-login {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: transparent;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.mhy-login__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
}

.mhy-login__stripe {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    40deg,
    transparent,
    transparent 3.5px,
    rgba(255, 255, 255, 0.09) 4.5px,
    rgba(255, 255, 255, 0.09) 7.5px,
    transparent 8.5px
  );
}

.mhy-login__dialog {
  position: relative;
  z-index: 1;
  width: min(420px, 100%);
}

.mhy-login__outer {
  padding: 4px;
  background: #2d2c2d;
  border-radius: 24px 0 24px 24px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}

.mhy-login__inner {
  background: #000;
  border-radius: 22px 0 22px 22px;
  overflow: hidden;
}

.mhy-login__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 0.9rem;
  background: #0a0a0a;
}

.mhy-login__header strong {
  color: #fff;
  font-size: 1rem;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.mhy-login__ban {
  margin: 0.75rem 0.9rem 0;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 120, 120, 0.4);
  background: rgba(120, 24, 24, 0.45);
  color: #ffb4b4;
  font-size: 0.88rem;
  font-weight: 700;
  line-height: 1.45;
}

.mhy-login__tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  background: #0a0a0a;
  border-bottom: 1px solid #1f1f1f;
}

.mhy-login__tab {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  padding: 0.65rem 0.5rem;
  font-size: 0.85rem;
  font-weight: 800;
  cursor: pointer;
}

.mhy-login__tab.active {
  color: #bfff09;
  box-shadow: inset 0 -2px 0 #bfff09;
}

.mhy-login__close {
  width: 2.2rem;
  height: 2.2rem;
  border: none;
  border-radius: 8px;
  background: #e53935;
  color: #fff;
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.mhy-login__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1.4rem 1.2rem 1.2rem;
}

.mhy-login__body--phone {
  align-items: stretch;
  width: 100%;
  box-sizing: border-box;
}

.mhy-login__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.65);
}

.mhy-login__field input {
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  background: #111;
  color: #fff;
  padding: 0.7rem 0.8rem;
  font-size: 0.95rem;
  outline: none;
}

.mhy-login__field input:focus {
  border-color: #bfff09;
}

.mhy-login__phone-error {
  margin: 0;
  color: #ff8f8f;
  font-size: 0.85rem;
  font-weight: 700;
}

.mhy-login__phone-submit {
  border: 0;
  border-radius: 999px;
  padding: 0.75rem 1rem;
  background: #bfff09;
  color: #111;
  font-size: 0.95rem;
  font-weight: 900;
  font-style: italic;
  cursor: pointer;
}

.mhy-login__phone-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mhy-login__qr-box {
  position: relative;
  width: 220px;
  height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #2a2a2a;
  border-radius: 12px 12px 0 12px;
  background: #fff;
  overflow: hidden;
}

.mhy-login__qr-box.is-dimmed {
  filter: brightness(0.45);
}

.mhy-login__qr {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.mhy-login__qr-placeholder {
  width: 64px;
  height: 64px;
  border: 3px solid #ddd;
  border-top-color: #111;
  border-radius: 50%;
  animation: mhy-spin 0.8s linear infinite;
}

.mhy-login__refresh {
  position: absolute;
  inset: 0;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #bfff09;
  font-size: 0.95rem;
  font-weight: 900;
  cursor: pointer;
  filter: none;
}

.mhy-login__qr-box.is-dimmed .mhy-login__refresh {
  filter: none;
}

.mhy-login__status {
  margin: 0;
  color: #e8e8e8;
  font-size: 0.9rem;
  font-weight: 800;
  text-align: center;
}

.mhy-login__status.is-scanned {
  color: #bfff09;
}

.mhy-login__status.is-error,
.mhy-login__status.is-expired,
.mhy-login__status.is-cancelled {
  color: #ff8a80;
}

.mhy-login__hint {
  margin: 0;
  max-width: 280px;
  color: #777;
  font-size: 0.78rem;
  line-height: 1.5;
  text-align: center;
}

.mhy-login__accounts-error {
  margin-top: 8px;
}

.mhy-login__account:disabled {
  opacity: 0.65;
  cursor: wait;
}

.mhy-login__accounts-title {
  margin: 0 0 8px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.75rem;
  font-weight: 700;
}

.mhy-login__accounts-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mhy-login__account {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 2px solid #333;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
  text-align: left;
}

.mhy-login__account.is-active {
  border-color: #bfff09;
}

.mhy-login__account-avatar {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
  border: 2px solid #000;
}

.mhy-login__account-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mhy-login__account-avatar--letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #333;
  color: #fff;
  font-weight: 900;
}

.mhy-login__account-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mhy-login__account-meta strong {
  color: #fff;
  font-size: 0.88rem;
}

.mhy-login__account-meta span {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.72rem;
}

.mhy-login__back {
  margin-top: 0.25rem;
  min-width: 7rem;
  height: 2.2rem;
  border: 1px solid #333;
  border-radius: 10px 10px 0 10px;
  background: #161616;
  color: #ddd;
  font-size: 0.85rem;
  font-weight: 800;
  cursor: pointer;
}

.mhy-login-enter-active,
.mhy-login-leave-active {
  transition: opacity 0.2s ease;
}

.mhy-login-enter-from,
.mhy-login-leave-to {
  opacity: 0;
}

@keyframes mhy-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
