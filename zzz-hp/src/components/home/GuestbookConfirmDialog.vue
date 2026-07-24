<script setup lang="ts">
defineProps<{
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  showReason?: boolean
  reason?: string
  reasonPlaceholder?: string
  details?: { label: string; value: string }[]
}>()

const emit = defineEmits<{
  close: []
  confirm: []
  'update:reason': [value: string]
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="gb-confirm">
      <div
        v-if="open"
        class="gb-confirm"
        role="dialog"
        aria-modal="true"
        @keydown.esc.prevent="emit('close')"
      >
        <button type="button" class="gb-confirm__mask" aria-label="关闭" @click="emit('close')" />
        <div class="gb-confirm__panel" @click.stop>
          <h3 class="gb-confirm__title">{{ title }}</h3>
          <p v-if="message" class="gb-confirm__hint">{{ message }}</p>
          <dl v-if="details?.length" class="gb-confirm__details">
            <div v-for="row in details" :key="row.label" class="gb-confirm__detail-row">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
          <textarea
            v-if="showReason"
            class="gb-confirm__input"
            :value="reason"
            rows="4"
            maxlength="500"
            :placeholder="reasonPlaceholder || '可选，说明举报原因…'"
            @input="emit('update:reason', ($event.target as HTMLTextAreaElement).value)"
          />
          <div class="gb-confirm__actions">
            <button type="button" class="gb-confirm__btn" @click="emit('close')">
              {{ cancelLabel || '取消' }}
            </button>
            <button
              type="button"
              class="gb-confirm__btn"
              :class="{ 'is-danger': danger, 'is-primary': !danger }"
              :disabled="busy"
              @click="emit('confirm')"
            >
              {{ busy ? '处理中…' : confirmLabel || '确定' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gb-confirm {
  position: fixed;
  inset: 0;
  z-index: 14000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.25rem;
  box-sizing: border-box;
}

.gb-confirm__mask {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.62);
  cursor: pointer;
}

.gb-confirm__panel {
  position: relative;
  z-index: 1;
  width: min(420px, 100%);
  padding: 1.1rem 1.2rem 1.2rem;
  border-radius: 10px 10px 0 10px;
  border: 1px solid #333;
  background: #161616;
  box-shadow:
    0 16px 48px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(191, 255, 9, 0.08);
  box-sizing: border-box;
}

.gb-confirm__title {
  margin: 0 0 0.45rem;
  color: #fff;
  font-size: 1.02rem;
  font-weight: 800;
  line-height: 1.35;
  text-align: left;
}

.gb-confirm__hint {
  margin: 0 0 0.85rem;
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.82rem;
  line-height: 1.55;
  text-align: left;
}

.gb-confirm__details {
  margin: 0 0 0.9rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #333;
  border-radius: 10px 10px 0 10px;
  background: #121212;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.gb-confirm__detail-row {
  display: grid;
  grid-template-columns: 4.5rem 1fr;
  gap: 0.55rem;
  align-items: start;
}

.gb-confirm__detail-row dt {
  margin: 0;
  color: rgba(191, 255, 9, 0.78);
  font-size: 0.75rem;
  font-weight: 800;
}

.gb-confirm__detail-row dd {
  margin: 0;
  color: rgba(255, 255, 255, 0.88);
  font-size: 0.84rem;
  font-weight: 600;
  line-height: 1.4;
  word-break: break-word;
}

.gb-confirm__input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 0.7rem 0.8rem;
  border-radius: 10px 10px 0 10px;
  border: 1px solid #333;
  background: #121212;
  color: #fff;
  font: inherit;
  font-size: 0.88rem;
  line-height: 1.5;
  resize: vertical;
  min-height: 96px;
}

.gb-confirm__input:focus {
  outline: none;
  border-color: rgba(191, 255, 9, 0.45);
}

.gb-confirm__input::placeholder {
  color: rgba(255, 255, 255, 0.32);
}

.gb-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.95rem;
}

.gb-confirm__btn {
  border: 1px solid #333;
  background: #1a1a1a;
  color: rgba(255, 255, 255, 0.88);
  border-radius: 999px;
  padding: 7px 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.gb-confirm__btn:hover:not(:disabled) {
  border-color: rgba(191, 255, 9, 0.45);
  color: #bfff09;
}

.gb-confirm__btn.is-primary {
  border-color: transparent;
  background: #bfff09;
  color: #111;
}

.gb-confirm__btn.is-primary:hover:not(:disabled) {
  border-color: transparent;
  background: #d4ff4d;
  color: #111;
}

.gb-confirm__btn.is-danger {
  border-color: rgba(255, 120, 120, 0.35);
  background: rgba(255, 107, 107, 0.12);
  color: #ff9a9a;
}

.gb-confirm__btn.is-danger:hover:not(:disabled) {
  border-color: rgba(255, 150, 150, 0.55);
  color: #ffb4b4;
}

.gb-confirm__btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.gb-confirm-enter-active,
.gb-confirm-leave-active {
  transition: opacity 0.16s ease;
}

.gb-confirm-enter-active .gb-confirm__panel,
.gb-confirm-leave-active .gb-confirm__panel {
  transition: transform 0.16s ease, opacity 0.16s ease;
}

.gb-confirm-enter-from,
.gb-confirm-leave-to {
  opacity: 0;
}

.gb-confirm-enter-from .gb-confirm__panel,
.gb-confirm-leave-to .gb-confirm__panel {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}
</style>
