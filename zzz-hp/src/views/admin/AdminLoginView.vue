<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loginAdmin } from '@/api/adminAuth'
import { setAdminAuthenticated } from '@/utils/adminAuth'

const router = useRouter()
const route = useRoute()

const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')

async function submitLogin() {
  error.value = ''
  const value = password.value.trim()
  if (!value) {
    error.value = '请输入密码'
    return
  }

  loading.value = true
  try {
    const result = await loginAdmin(value)
    if (!result.token) {
      throw new Error('登录成功但未返回管理员凭证，请重启后端后重试')
    }
    setAdminAuthenticated(true, result.token)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/admin'
    await router.replace(redirect.startsWith('/admin') ? redirect : '/admin')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="admin-login">
    <RouterLink to="/" class="back">← 返回首页</RouterLink>

    <h1 class="title">管理员登录</h1>
    <p class="desc">请输入管理员密码后进入后台</p>

    <form class="login-panel" @submit.prevent="submitLogin">
      <label class="field">
        <span class="field-label">密码</span>
        <div class="password-row">
          <input
            v-model="password"
            class="password-input"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="current-password"
            placeholder="请输入密码"
            :disabled="loading"
          />
          <button
            type="button"
            class="toggle-visibility"
            :disabled="loading"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? '隐藏' : '显示' }}
          </button>
        </div>
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="submit" type="submit" :disabled="loading">
        {{ loading ? '验证中…' : '进入管理后台' }}
      </button>
    </form>
  </main>
</template>

<style scoped>
.admin-login {
  --accent: #3f8cff;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 1.5rem;
  position: relative;
}

.back {
  position: absolute;
  top: 1.25rem;
  left: 1.25rem;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.7;
  text-decoration: none;
  transition: opacity 0.2s;
}

.back:hover {
  opacity: 1;
}

.title {
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  color: var(--color-heading);
  letter-spacing: 0.04em;
  text-align: center;
}

.desc {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text);
  opacity: 0.7;
  text-align: center;
}

.login-panel {
  width: min(100%, 360px);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 0.5rem;
  padding: 2rem 1.5rem;
  border: 2px solid var(--accent);
  border-radius: 12px;
  background: var(--color-background-soft);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.login-panel:focus-within {
  box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 35%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, var(--color-background-soft));
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.field-label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-heading);
}

.password-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.password-input {
  flex: 1;
  min-width: 0;
  height: 2.6rem;
  padding: 0 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background-color: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.95rem;
  color-scheme: inherit;
}

.password-input::placeholder {
  color: var(--color-text);
  opacity: 0.55;
}

.password-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.password-input:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.password-input:-webkit-autofill,
.password-input:-webkit-autofill:hover,
.password-input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--color-heading);
  caret-color: var(--color-heading);
  box-shadow: 0 0 0 1000px var(--color-background-mute) inset;
  transition: background-color 99999s ease-out;
}

.toggle-visibility {
  flex-shrink: 0;
  min-width: 3.6rem;
  padding: 0 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background-mute);
  color: var(--color-text);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.2s,
    border-color 0.2s,
    color 0.2s,
    opacity 0.2s;
}

.toggle-visibility:hover:not(:disabled) {
  color: var(--color-heading);
  border-color: var(--color-border-hover);
  background: color-mix(in srgb, var(--accent) 14%, var(--color-background-mute));
}

.toggle-visibility:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.error {
  margin: 0;
  font-size: 0.85rem;
  color: #ef4444;
  text-align: center;
}

.submit {
  height: 2.7rem;
  border: 2px solid var(--accent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--color-heading);
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease,
    opacity 0.2s ease;
}

.submit:hover:not(:disabled) {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--accent) 28%, transparent);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--accent) 28%, transparent);
}

.submit:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
</style>
