<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import {
  getWengineStatSuggestions,
  removeWengineStatSuggestion,
} from '@/utils/wengineStatSuggestions'

const props = defineProps<{
  fieldKey: string
  label: string
  unit?: 'flat' | 'percent'
  refreshToken?: number
}>()

const model = defineModel<number>({ required: true })

const suggestions = ref<number[]>([])
const menuOpen = ref(false)
const rootRef = ref<HTMLElement | null>(null)

function fieldLabel() {
  return props.unit === 'percent' ? `${props.label}%` : props.label
}

function refreshSuggestions() {
  suggestions.value = getWengineStatSuggestions(props.fieldKey)
  if (!suggestions.value.length) menuOpen.value = false
}

function toggleMenu() {
  if (!suggestions.value.length) return
  refreshSuggestions()
  menuOpen.value = !menuOpen.value
}

function selectValue(value: number) {
  model.value = value
  menuOpen.value = false
}

function deleteValue(value: number) {
  suggestions.value = removeWengineStatSuggestion(props.fieldKey, value)
  if (!suggestions.value.length) menuOpen.value = false
}

function onDocumentClick(event: MouseEvent) {
  if (!rootRef.value?.contains(event.target as Node)) {
    menuOpen.value = false
  }
}

watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener('click', onDocumentClick)
  } else {
    document.removeEventListener('click', onDocumentClick)
  }
})

watch(
  () => props.fieldKey,
  () => {
    menuOpen.value = false
    refreshSuggestions()
  },
)

watch(
  () => props.refreshToken,
  () => {
    refreshSuggestions()
  },
)

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
})

refreshSuggestions()
</script>

<template>
  <label class="field stat-field">
    <span class="field-label">{{ fieldLabel() }}</span>
    <div ref="rootRef" class="remembered-number-input">
      <input v-model.number="model" type="number" step="any" class="remembered-input" />
      <button
        type="button"
        class="history-trigger"
        :disabled="!suggestions.length"
        :title="suggestions.length ? '选择已保存数值' : '暂无已保存数值'"
        :aria-expanded="menuOpen"
        aria-haspopup="listbox"
        @click.stop="toggleMenu"
      />
      <ul v-if="menuOpen && suggestions.length" class="history-menu" role="listbox">
        <li v-for="item in suggestions" :key="item" class="history-item" role="option">
          <button type="button" class="history-value" @click="selectValue(item)">
            {{ item }}
          </button>
          <button
            type="button"
            class="history-delete"
            title="从历史中删除"
            aria-label="删除"
            @click.stop="deleteValue(item)"
          >
            ×
          </button>
        </li>
      </ul>
    </div>
  </label>
</template>

<style scoped src="./adminCalculatorPanel.css"></style>
<style scoped>
.stat-field .field-label {
  font-size: 0.76rem;
  font-weight: 400;
  color: var(--color-text);
  opacity: 0.78;
}

.remembered-number-input {
  position: relative;
  display: flex;
  align-items: stretch;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  transition: border-color 0.2s;
}

.remembered-number-input:focus-within {
  border-color: #e8a838;
}

.remembered-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-heading);
  font-size: 0.9rem;
  font-family: inherit;
  line-height: 1.25;
  min-height: 2.35rem;
  padding: 0.5rem 0.65rem;
}

.history-trigger {
  flex-shrink: 0;
  width: 2.25rem;
  margin: 0;
  padding: 0;
  border: none;
  border-left: 1px solid var(--color-border);
  border-radius: 0 7px 7px 0;
  background-color: var(--color-background);
  background-repeat: no-repeat;
  background-position: center;
  background-size: 0.75rem;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1.5 5 5.5 9 1.5' stroke='%23555555' fill='none' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  cursor: pointer;
}

[data-theme='dark'] .history-trigger {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1.5 5 5.5 9 1.5' stroke='%23aaaaaa' fill='none' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}

.history-trigger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.history-menu {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  z-index: 20;
  min-width: 9rem;
  max-width: min(14rem, 70vw);
  max-height: 12rem;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18);
  overflow-y: auto;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.history-value {
  flex: 1;
  min-width: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-heading);
  font-size: 0.88rem;
  text-align: left;
  padding: 0.38rem 0.45rem;
  cursor: pointer;
}

.history-value:hover {
  background: var(--color-background-mute);
}

.history-delete {
  flex-shrink: 0;
  width: 1.65rem;
  height: 1.65rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  opacity: 0.65;
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
}

.history-delete:hover {
  opacity: 1;
  background: color-mix(in srgb, #e85d4c 14%, var(--color-background-mute));
  color: #e85d4c;
}
</style>
