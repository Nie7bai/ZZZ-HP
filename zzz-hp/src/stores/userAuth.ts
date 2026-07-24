import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  fetchAuthMe,
  isAccountBannedError,
  logoutAuth,
  updateAuthProfile,
  uploadAuthImage,
  type AuthUser,
  type UpdateProfilePayload,
} from '@/api/auth'

const TOKEN_KEY = 'zzz-hp-user-token'
const ACCOUNTS_KEY = 'zzz-hp-saved-accounts'
const MAX_ACCOUNTS = 3

export interface SavedAccount {
  token: string
  userId: number
  nickname: string
  avatar?: string
}

function readSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.token === 'string' &&
          Number.isFinite(Number(item.userId)) &&
          typeof item.nickname === 'string',
      )
      .slice(0, MAX_ACCOUNTS)
      .map((item) => ({
        token: item.token,
        userId: Number(item.userId),
        nickname: item.nickname,
        avatar: typeof item.avatar === 'string' ? item.avatar : '',
      }))
  } catch {
    return []
  }
}

function writeSavedAccounts(list: SavedAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS)))
}

export const useUserAuthStore = defineStore('userAuth', () => {
  const token = ref(localStorage.getItem(TOKEN_KEY) || '')
  const user = ref<AuthUser | null>(null)
  const ready = ref(false)
  const loginDialogOpen = ref(false)
  const banNotice = ref('')
  const savedAccounts = ref<SavedAccount[]>(readSavedAccounts())

  const isLoggedIn = computed(() => Boolean(token.value && user.value))

  function upsertSavedAccount(nextToken: string, nextUser: AuthUser) {
    const entry: SavedAccount = {
      token: nextToken,
      userId: nextUser.id,
      nickname: nextUser.nickname,
      avatar: nextUser.avatar || '',
    }
    const rest = savedAccounts.value.filter(
      (a) => a.userId !== entry.userId && a.token !== entry.token,
    )
    savedAccounts.value = [entry, ...rest].slice(0, MAX_ACCOUNTS)
    writeSavedAccounts(savedAccounts.value)
  }

  function setSession(nextToken: string, nextUser: AuthUser) {
    token.value = nextToken
    user.value = nextUser
    banNotice.value = ''
    localStorage.setItem(TOKEN_KEY, nextToken)
    upsertSavedAccount(nextToken, nextUser)
  }

  function clearSession() {
    token.value = ''
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
  }

  function setBanNotice(message: string) {
    banNotice.value = message || '账号已被封禁'
  }

  function clearBanNotice() {
    banNotice.value = ''
  }

  function openLoginDialog() {
    loginDialogOpen.value = true
  }

  function closeLoginDialog() {
    loginDialogOpen.value = false
  }

  function handleAuthFailure(err: unknown) {
    clearSession()
    if (isAccountBannedError(err)) {
      setBanNotice(err instanceof Error ? err.message : '账号已被封禁')
      openLoginDialog()
      return true
    }
    return false
  }

  async function restoreSession() {
    savedAccounts.value = readSavedAccounts()
    const saved = localStorage.getItem(TOKEN_KEY) || ''
    if (!saved) {
      ready.value = true
      return
    }
    token.value = saved
    try {
      user.value = await fetchAuthMe(saved)
      if (user.value) upsertSavedAccount(saved, user.value)
    } catch (err) {
      handleAuthFailure(err)
    } finally {
      ready.value = true
    }
  }

  async function switchAccount(saved: SavedAccount) {
    const prevToken = token.value
    const prevUser = user.value
    token.value = saved.token
    localStorage.setItem(TOKEN_KEY, saved.token)
    try {
      const me = await fetchAuthMe(saved.token)
      user.value = me
      banNotice.value = ''
      upsertSavedAccount(saved.token, me)
      closeLoginDialog()
    } catch (err) {
      token.value = prevToken
      user.value = prevUser
      if (prevToken) localStorage.setItem(TOKEN_KEY, prevToken)
      else localStorage.removeItem(TOKEN_KEY)
      if (isAccountBannedError(err)) {
        setBanNotice(err instanceof Error ? err.message : '账号已被封禁')
      }
      throw err
    }
  }

  async function removeSavedAccount(userId: number) {
    const target = savedAccounts.value.find((a) => a.userId === userId)
    savedAccounts.value = savedAccounts.value.filter((a) => a.userId !== userId)
    writeSavedAccounts(savedAccounts.value)
    if (target?.token) {
      try {
        await logoutAuth(target.token)
      } catch {
        /* ignore */
      }
    }
  }

  async function refreshMe() {
    if (!token.value) return null
    try {
      user.value = await fetchAuthMe(token.value)
      if (user.value) upsertSavedAccount(token.value, user.value)
      return user.value
    } catch (err) {
      handleAuthFailure(err)
      throw err
    }
  }

  async function updateProfile(payload: UpdateProfilePayload) {
    if (!token.value) throw new Error('未登录')
    user.value = await updateAuthProfile(token.value, payload)
    if (user.value) upsertSavedAccount(token.value, user.value)
    return user.value
  }

  async function uploadProfileImage(file: File, field: 'avatar' | 'banner' = 'avatar') {
    if (!token.value) throw new Error('未登录')
    const result = await uploadAuthImage(token.value, file, field)
    user.value = result.user
    if (user.value) upsertSavedAccount(token.value, user.value)
    return result
  }

  async function logout() {
    // 仅清除本地会话，保留服务端 token 以便已保存账号可再次切换
    clearSession()
    clearBanNotice()
  }

  function authHeaders(): Record<string, string> {
    if (!token.value) return {}
    return { Authorization: `Bearer ${token.value}` }
  }

  return {
    token,
    user,
    ready,
    isLoggedIn,
    loginDialogOpen,
    banNotice,
    savedAccounts,
    setSession,
    clearSession,
    setBanNotice,
    clearBanNotice,
    openLoginDialog,
    closeLoginDialog,
    restoreSession,
    switchAccount,
    removeSavedAccount,
    refreshMe,
    updateProfile,
    uploadProfileImage,
    logout,
    authHeaders,
  }
})
