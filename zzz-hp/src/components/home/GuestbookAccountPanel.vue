<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  bindPhone,
  fetchAccountSecurity,
  sendPhoneCode,
  setPassword,
  type AccountSecurity,
} from '@/api/auth'
import { resolveAssetUrl } from '@/utils/gameData'
import { useUserAuthStore } from '@/stores/userAuth'

const emit = defineEmits<{
  close: []
  backToProfile: []
  logout: []
}>()

type MenuKey = 'security' | 'mihoyo'
type SubView = '' | 'phone' | 'password'

const auth = useUserAuthStore()

const activeMenu = ref<MenuKey>('security')
const subView = ref<SubView>('')
const isNarrow = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const hint = ref('')
const security = ref<AccountSecurity | null>(null)

const phoneInput = ref('')
const codeInput = ref('')
const passwordInput = ref('')
const passwordConfirm = ref('')
const oldPasswordInput = ref('')
const codeCooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

const accountMeta = computed(() => {
  if (loading.value) return '加载中'
  if (security.value?.hasPhone) return security.value.phone
  if (security.value?.hasPassword) return '已设置密码'
  return '未绑定手机号'
})
const mihoyoMeta = computed(() => {
  if (loading.value) return '加载中'
  return security.value?.mihoyoAid ? `AID ${security.value.mihoyoAid}` : '未连接'
})

function updateNarrow() {
  isNarrow.value = window.innerWidth <= 900
}

function startCooldown(seconds: number) {
  if (cooldownTimer) clearInterval(cooldownTimer)
  codeCooldown.value = seconds
  cooldownTimer = setInterval(() => {
    codeCooldown.value -= 1
    if (codeCooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

async function loadSecurity() {
  if (!auth.token) return
  loading.value = true
  error.value = ''
  try {
    security.value = await fetchAccountSecurity(auth.token)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function selectMenu(key: MenuKey) {
  activeMenu.value = key
  subView.value = ''
  error.value = ''
  hint.value = ''
}

function openPhone() {
  subView.value = 'phone'
  phoneInput.value = ''
  codeInput.value = ''
  error.value = ''
  hint.value = ''
}

function openPassword() {
  subView.value = 'password'
  passwordInput.value = ''
  passwordConfirm.value = ''
  oldPasswordInput.value = ''
  codeInput.value = ''
  error.value = ''
  hint.value = ''
}

function goBack() {
  subView.value = ''
  error.value = ''
  hint.value = ''
}

async function onSendCode(purpose: 'bind' | 'password') {
  if (!auth.token) return
  saving.value = true
  error.value = ''
  hint.value = ''
  try {
    const res = await sendPhoneCode(auth.token, {
      phone: purpose === 'bind' ? phoneInput.value.trim() : undefined,
      purpose,
    })
    startCooldown(res.cooldown || 60)
    hint.value = res.mockCode
      ? `验证码已发送（调试码：${res.mockCode}）`
      : '验证码已发送，请查收短信'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '发送失败'
  } finally {
    saving.value = false
  }
}

async function onBindPhone() {
  if (!auth.token) return
  saving.value = true
  error.value = ''
  try {
    security.value = await bindPhone(auth.token, {
      phone: phoneInput.value.trim(),
      code: codeInput.value.trim(),
    })
    await auth.refreshMe()
    hint.value = '手机号绑定成功'
    goBack()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '绑定失败'
  } finally {
    saving.value = false
  }
}

async function onSetPassword() {
  if (!auth.token) return
  if (passwordInput.value !== passwordConfirm.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  saving.value = true
  error.value = ''
  try {
    security.value = await setPassword(auth.token, {
      password: passwordInput.value,
      oldPassword: oldPasswordInput.value || undefined,
      code: codeInput.value || undefined,
    })
    await auth.refreshMe()
    hint.value = '密码已保存'
    goBack()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '设置失败'
  } finally {
    saving.value = false
  }
}

function onLogout() {
  emit('logout')
}

onMounted(() => {
  updateNarrow()
  window.addEventListener('resize', updateNarrow)
  void loadSecurity()
})

onUnmounted(() => {
  window.removeEventListener('resize', updateNarrow)
  if (cooldownTimer) clearInterval(cooldownTimer)
})
</script>

<template>
  <div class="gb-account">
    <div class="gb-account__toolbar">
      <button type="button" class="gb-account__link" @click="emit('backToProfile')">
        ← 返回名片
      </button>
      <button type="button" class="gb-account__link" @click="onLogout">退出登录</button>
    </div>

    <div class="ac-layout" :class="{ 'ac-layout--stack': isNarrow }">
      <aside class="ac-nav">
        <button
          type="button"
          class="ac-nav__item"
          :class="{ active: activeMenu === 'security' }"
          @click="selectMenu('security')"
        >
          <strong>账号安全</strong>
          <span>{{ accountMeta }}</span>
        </button>
        <button
          type="button"
          class="ac-nav__item"
          :class="{ active: activeMenu === 'mihoyo' }"
          @click="selectMenu('mihoyo')"
        >
          <strong>米游社登录</strong>
          <span>{{ mihoyoMeta }}</span>
        </button>
      </aside>

      <main class="ac-panel">
        <template v-if="activeMenu === 'security' && subView === ''">
          <div class="ac-section">
            <h2 class="ac-section__title">账号安全</h2>
            <p class="ac-section__desc">绑定手机号与密码后，可使用手机号登录留言板账号。</p>
            <button type="button" class="ac-row" @click="openPhone">
              <span>手机号</span>
              <em :class="{ empty: !security?.hasPhone }">
                {{ loading ? '加载中' : security?.hasPhone ? security.phone : '未绑定' }}
              </em>
            </button>
            <button type="button" class="ac-row" @click="openPassword">
              <span>登录密码</span>
              <em :class="{ empty: !security?.hasPassword }">
                {{ loading ? '加载中' : security?.hasPassword ? '已设置' : '未设置' }}
              </em>
            </button>
          </div>
        </template>

        <template v-else-if="activeMenu === 'security' && subView === 'phone'">
          <header class="ac-detail-head">
            <button type="button" class="ac-back" @click="goBack">←</button>
            <h2>{{ security?.hasPhone ? '更换手机号' : '绑定手机号' }}</h2>
          </header>
          <div class="ac-form">
            <p v-if="security?.hasPhone" class="ac-form__tip">
              当前已绑定：{{ security.phone }}。输入新号码完成更换。
            </p>
            <label class="ac-field">
              <span>手机号</span>
              <input v-model="phoneInput" type="tel" maxlength="11" placeholder="请输入 11 位手机号" />
            </label>
            <label class="ac-field">
              <span>验证码</span>
              <div class="ac-field__row">
                <input v-model="codeInput" type="text" maxlength="6" placeholder="6 位验证码" />
                <button
                  type="button"
                  class="ac-code-btn"
                  :disabled="saving || codeCooldown > 0"
                  @click="onSendCode('bind')"
                >
                  {{ codeCooldown > 0 ? `${codeCooldown}s` : '发送' }}
                </button>
              </div>
            </label>
            <p v-if="hint" class="ac-hint">{{ hint }}</p>
            <p v-if="error" class="ac-error">{{ error }}</p>
            <button
              type="button"
              class="ac-submit"
              :disabled="saving || !phoneInput.trim() || !codeInput.trim()"
              @click="onBindPhone"
            >
              {{ saving ? '提交中…' : '确认绑定' }}
            </button>
          </div>
        </template>

        <template v-else-if="activeMenu === 'security' && subView === 'password'">
          <header class="ac-detail-head">
            <button type="button" class="ac-back" @click="goBack">←</button>
            <h2>{{ security?.hasPassword ? '修改密码' : '设置密码' }}</h2>
          </header>
          <div class="ac-form">
            <template v-if="security?.hasPassword">
              <label class="ac-field">
                <span>原密码</span>
                <input
                  v-model="oldPasswordInput"
                  type="password"
                  maxlength="64"
                  placeholder="已设置密码时填写原密码"
                />
              </label>
              <p class="ac-form__tip">也可不填原密码，改用已绑定手机号验证码验证。</p>
              <label v-if="security.hasPhone" class="ac-field">
                <span>手机验证码（可选）</span>
                <div class="ac-field__row">
                  <input
                    v-model="codeInput"
                    type="text"
                    maxlength="6"
                    :placeholder="`发往 ${security.phone}`"
                  />
                  <button
                    type="button"
                    class="ac-code-btn"
                    :disabled="saving || codeCooldown > 0"
                    @click="onSendCode('password')"
                  >
                    {{ codeCooldown > 0 ? `${codeCooldown}s` : '发送' }}
                  </button>
                </div>
              </label>
            </template>
            <label class="ac-field">
              <span>新密码</span>
              <input
                v-model="passwordInput"
                type="password"
                maxlength="64"
                placeholder="至少 6 位"
              />
            </label>
            <label class="ac-field">
              <span>确认密码</span>
              <input
                v-model="passwordConfirm"
                type="password"
                maxlength="64"
                placeholder="再次输入新密码"
              />
            </label>
            <p v-if="hint" class="ac-hint">{{ hint }}</p>
            <p v-if="error" class="ac-error">{{ error }}</p>
            <button
              type="button"
              class="ac-submit"
              :disabled="saving || !passwordInput || !passwordConfirm"
              @click="onSetPassword"
            >
              {{ saving ? '保存中…' : '保存密码' }}
            </button>
          </div>
        </template>

        <template v-else-if="activeMenu === 'mihoyo'">
          <div class="ac-section">
            <h2 class="ac-section__title">米哈游 / 米游社账号</h2>
            <p class="ac-section__desc">当前通过米游社扫码登录绑定的账号信息。</p>

            <div class="ac-mihoyo">
              <div class="ac-mihoyo__avatar">
                <img
                  v-if="auth.user?.avatar"
                  :src="resolveAssetUrl(auth.user.avatar) || ''"
                  alt=""
                />
                <span v-else>{{ (auth.user?.nickname || '旅').charAt(0) }}</span>
              </div>
              <div class="ac-mihoyo__info">
                <strong>{{ auth.user?.nickname || security?.nickname || '绳网旅人' }}</strong>
                <span>UID {{ auth.user?.id || '—' }}</span>
              </div>
            </div>

            <div class="ac-kv">
              <div class="ac-kv__row">
                <span>连接状态</span>
                <em class="ok">已连接</em>
              </div>
              <div class="ac-kv__row">
                <span>米游社 AID</span>
                <em>{{ security?.mihoyoAid || auth.user?.mihoyoAid || '—' }}</em>
              </div>
              <div class="ac-kv__row">
                <span>米游社 MID</span>
                <em>{{ security?.mihoyoMid || auth.user?.mihoyoMid || '—' }}</em>
              </div>
              <div class="ac-kv__row">
                <span>注册时间</span>
                <em>{{ String(security?.createdAt || auth.user?.createdAt || '—').slice(0, 19) }}</em>
              </div>
            </div>
            <p class="ac-form__tip">
              米游社扫码是主登录方式。绑定手机号并设置密码后，也可在登录弹窗使用「手机号登录」。
            </p>
          </div>
        </template>

        <p v-if="hint && subView === ''" class="ac-hint ac-hint--page">{{ hint }}</p>
        <p v-if="error && subView === ''" class="ac-error ac-error--page">{{ error }}</p>
      </main>
    </div>
  </div>
</template>

<style scoped>
.gb-account {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px 24px;
  min-height: 0;
  flex: 1;
  overflow: auto;
  color: #f0f0f0;
}

.gb-account__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.gb-account__link {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 4px 0;
}

.gb-account__link:hover {
  color: #bfff09;
}

.ac-layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
}

.ac-layout--stack {
  grid-template-columns: 1fr;
}

.ac-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ac-layout--stack .ac-nav {
  flex-direction: row;
}

.ac-layout--stack .ac-nav__item {
  flex: 1;
}

.ac-nav__item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  border: 1px solid #222;
  border-radius: 14px;
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.55);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ac-nav__item strong {
  font-size: 14px;
  font-weight: 800;
}

.ac-nav__item span {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.ac-nav__item.active {
  border-color: rgba(191, 255, 9, 0.45);
  box-shadow: inset 0 0 0 1px rgba(191, 255, 9, 0.2);
}

.ac-panel {
  min-width: 0;
  border: 1px solid #222;
  border-radius: 16px;
  background: rgba(12, 12, 12, 0.88);
  padding: 8px 0 16px;
}

.ac-section {
  padding: 8px 16px 4px;
}

.ac-section__title {
  margin: 8px 4px 6px;
  font-size: 12px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.45);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.ac-section__desc {
  margin: 0 4px 12px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.5;
}

.ac-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: transparent;
  color: #fff;
  padding: 14px 8px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}

.ac-row:last-child {
  border-bottom: 0;
}

.ac-row em {
  font-style: normal;
  color: rgba(255, 255, 255, 0.45);
  font-size: 14px;
  font-weight: 600;
}

.ac-row em.empty {
  color: rgba(255, 255, 255, 0.28);
}

.ac-detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px 8px;
}

.ac-detail-head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 900;
}

.ac-back {
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
}

.ac-form {
  padding: 8px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 420px;
}

.ac-form__tip {
  margin: 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.5;
}

.ac-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.7);
}

.ac-field input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  background: #0a0a0a;
  color: #fff;
  padding: 11px 12px;
  font-size: 14px;
  outline: none;
}

.ac-field input:focus {
  border-color: #bfff09;
}

.ac-field__row {
  display: flex;
  gap: 8px;
}

.ac-field__row input {
  flex: 1;
}

.ac-code-btn,
.ac-submit {
  border: 0;
  border-radius: 999px;
  padding: 11px 16px;
  font-size: 13px;
  font-weight: 800;
  font-style: italic;
  cursor: pointer;
}

.ac-code-btn {
  flex-shrink: 0;
  min-width: 84px;
  color: #111;
  background: #bfff09;
}

.ac-code-btn:disabled,
.ac-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ac-submit {
  margin-top: 6px;
  color: #111;
  background: linear-gradient(180deg, #d8ff4a 0%, #bfff09 100%);
}

.ac-hint {
  margin: 0;
  color: #bfff09;
  font-size: 13px;
  font-weight: 700;
}

.ac-error {
  margin: 0;
  color: #ff8f8f;
  font-size: 13px;
  font-weight: 700;
}

.ac-hint--page,
.ac-error--page {
  padding: 0 18px;
}

.ac-mihoyo {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 8px 0 16px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.35);
}

.ac-mihoyo__avatar {
  width: 56px;
  height: 56px;
  border-radius: 999px;
  overflow: hidden;
  background: #222;
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 900;
  border: 3px solid #000;
}

.ac-mihoyo__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ac-mihoyo__info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ac-mihoyo__info strong {
  font-size: 18px;
}

.ac-mihoyo__info span {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
}

.ac-kv {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.35);
}

.ac-kv__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 14px;
}

.ac-kv__row:last-child {
  border-bottom: 0;
}

.ac-kv__row span {
  color: rgba(255, 255, 255, 0.45);
  font-weight: 700;
}

.ac-kv__row em {
  font-style: normal;
  font-weight: 700;
  color: #fff;
  word-break: break-all;
  text-align: right;
}

.ac-kv__row em.ok {
  color: #bfff09;
}
</style>
