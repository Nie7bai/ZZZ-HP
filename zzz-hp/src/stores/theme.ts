import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'zzz-hp-theme'

function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(
    (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'light',
  )

  function toggleTheme() {
    mode.value = mode.value === 'light' ? 'dark' : 'light'
  }

  watch(
    mode,
    (value) => {
      localStorage.setItem(STORAGE_KEY, value)
      applyTheme(value)
    },
    { immediate: true },
  )

  return { mode, toggleTheme }
})

export function initTheme() {
  const saved = (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'light'
  applyTheme(saved)
}
