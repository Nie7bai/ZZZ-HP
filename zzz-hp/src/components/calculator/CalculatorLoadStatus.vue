<script setup lang="ts">
import { useTemplateRef } from 'vue'

interface Props {
  state: 'loading' | 'error' | 'ready'
  error: string
}

defineProps<Props>()

const emit = defineEmits<{
  retry: []
}>()

const statusRegionRef = useTemplateRef<HTMLDivElement>('statusRegion')
const retryButtonRef = useTemplateRef<HTMLButtonElement>('retryButton')

function focusStatusRegion() {
  statusRegionRef.value?.focus({ preventScroll: true })
}

function hasStatusFocus() {
  return document.activeElement === statusRegionRef.value
}

function focusRetryButton() {
  retryButtonRef.value?.focus({ preventScroll: true })
}

defineExpose({ focusStatusRegion, hasStatusFocus, focusRetryButton })
</script>

<template>
  <div
    ref="statusRegion"
    class="load-status-region"
    :role="state === 'loading' ? 'status' : undefined"
    :aria-live="state === 'loading' ? 'polite' : undefined"
    :aria-atomic="state === 'loading' ? 'true' : undefined"
    tabindex="-1"
  >
    <p v-if="state === 'loading'" class="load-hint">正在从数据库加载计算器数据...</p>
    <div v-else-if="state === 'error'" class="load-error">
      <p class="load-error-message" role="alert">{{ error }}</p>
      <button ref="retryButton" type="button" class="load-retry-btn" @click="emit('retry')">
        重新加载
      </button>
    </div>
  </div>
</template>

<style scoped>
.load-status-region {
  min-width: 0;
}

.load-hint,
.load-error {
  margin: 0 0 1rem;
  padding: 0.85rem 1rem;
  border-radius: 10px;
  font-size: 0.9rem;
}

.load-hint {
  border: 1px solid #34302a;
  background: #14120f;
  color: #d8c39a;
}

.load-status-region:focus-visible .load-hint {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.load-error {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  border: 1px solid #5a2f2f;
  background: #241515;
  color: #ffb4b4;
}

.load-error-message {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.load-retry-btn {
  flex-shrink: 0;
  padding: 0.4rem 0.7rem;
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.load-retry-btn:hover {
  background: rgba(255, 180, 180, 0.12);
}

.load-retry-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

:global(.calculator-page.theme-light) .load-hint {
  border-color: #e6d7b0;
  background: #fff9ef;
  color: #6b5420;
}
</style>
