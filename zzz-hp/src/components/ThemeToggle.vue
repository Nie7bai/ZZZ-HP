<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
const { mode } = storeToRefs(themeStore)
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-label="mode === 'light' ? '切换为暗夜模式' : '切换为白天模式'"
    @click="themeStore.toggleTheme()"
  >
    <span class="theme-toggle-icon">{{ mode === 'light' ? '☀️' : '🌙' }}</span>
    <span class="theme-toggle-text">{{ mode === 'light' ? '白天' : '暗夜' }}</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  position: fixed;
  left: 1rem;
  bottom: 1rem;
  z-index: 1100;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.85rem;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  transition:
    background-color 0.2s,
    border-color 0.2s,
    transform 0.2s;
}

.theme-toggle:hover {
  background: var(--color-background-mute);
  transform: translateY(-1px);
}

.theme-toggle-icon {
  font-size: 1rem;
  line-height: 1;
}

.theme-toggle-text {
  font-weight: 600;
}
</style>
