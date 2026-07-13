<script setup lang="ts">
import { ref } from 'vue'

withDefaults(
  defineProps<{
    accept?: string
    buttonText?: string
  }>(),
  {
    accept: 'image/*',
    buttonText: '选择图片',
  },
)

const emit = defineEmits<{
  change: [file: File | null]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const fileName = ref('')

function openPicker() {
  fileInput.value?.click()
}

function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  fileName.value = file?.name ?? ''
  emit('change', file)
}

function reset() {
  if (fileInput.value) fileInput.value.value = ''
  fileName.value = ''
}

defineExpose({ reset })
</script>

<template>
  <div class="image-picker">
    <input
      ref="fileInput"
      type="file"
      class="image-picker-input"
      :accept="accept"
      @change="onChange"
    />
    <button type="button" class="image-picker-btn" @click="openPicker">
      {{ buttonText }}
    </button>
    <span class="image-picker-name">{{ fileName || '未选择文件' }}</span>
  </div>
</template>

<style scoped>
.image-picker {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
}

.image-picker-input {
  display: none;
}

.image-picker-btn {
  flex-shrink: 0;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.image-picker-btn:hover {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.image-picker-name {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  color: var(--color-text);
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
