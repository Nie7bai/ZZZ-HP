<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    visible: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
    loading?: boolean
  }>(),
  {
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
    loading: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible && !props.loading) {
    emit('cancel')
  }
}

watch(
  () => props.visible,
  (isVisible) => {
    document.body.style.overflow = isVisible ? 'hidden' : ''
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="confirm-overlay"
      @click.self="!loading && emit('cancel')"
    >
      <div class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="title">
        <h3 class="confirm-title">{{ title }}</h3>
        <p class="confirm-message">{{ message }}</p>
        <div class="confirm-actions">
          <button
            type="button"
            class="confirm-btn cancel-btn"
            :disabled="loading"
            @click="emit('cancel')"
          >
            {{ cancelText }}
          </button>
          <button
            type="button"
            class="confirm-btn confirm-btn-primary"
            :class="{ danger }"
            :disabled="loading"
            @click="emit('confirm')"
          >
            {{ loading ? '处理中...' : confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.confirm-dialog {
  width: min(420px, 100%);
  padding: 1.35rem 1.25rem 1.1rem;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.35);
}

.confirm-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--color-heading);
  text-align: center;
}

.confirm-message {
  margin: 0.85rem 0 1.15rem;
  font-size: 0.86rem;
  line-height: 1.65;
  color: var(--color-text);
  opacity: 0.88;
  text-align: center;
  white-space: pre-line;
}

.confirm-actions {
  display: flex;
  justify-content: center;
  gap: 0.65rem;
}

.confirm-btn {
  min-width: 5.5rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-heading);
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s,
    color 0.2s;
}

.cancel-btn:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  background: var(--color-background-mute);
}

.confirm-btn-primary:hover:not(:disabled) {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.confirm-btn-primary.danger {
  border-color: rgba(232, 93, 76, 0.55);
  color: #e85d4c;
}

.confirm-btn-primary.danger:hover:not(:disabled) {
  border-color: #e85d4c;
  background: rgba(232, 93, 76, 0.1);
}

.confirm-btn:disabled {
  opacity: 0.65;
  cursor: default;
}
</style>
