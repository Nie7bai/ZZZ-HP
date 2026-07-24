<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    step?: number
    disabled?: boolean
  }>(),
  {
    min: 0,
    max: 999999,
    step: 1,
    disabled: false,
  },
)

const model = defineModel<number>({ required: true })

function stepDecimals(step: number) {
  if (!Number.isFinite(step) || step <= 0) return 0
  const text = String(step)
  if (/e/i.test(text)) return 6
  const idx = text.indexOf('.')
  return idx === -1 ? 0 : text.length - idx - 1
}

function snap(value: number) {
  const decimals = stepDecimals(props.step)
  if (decimals <= 0) return Math.round(value)
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function clamp(value: number) {
  const n = Number.isFinite(value) ? value : props.min
  return snap(Math.min(props.max, Math.max(props.min, n)))
}

function bump(delta: number) {
  if (props.disabled) return
  model.value = clamp((Number(model.value) || 0) + delta)
}

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return
  const n = Number(raw)
  if (!Number.isFinite(n)) return
  model.value = clamp(n)
}

function onBlur() {
  const n = Number(model.value)
  model.value = clamp(Number.isFinite(n) ? n : props.min)
}
</script>

<template>
  <div class="num-stepper" :class="{ disabled }">
    <input
      class="step-input"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :value="model"
      @input="onInput"
      @blur="onBlur"
    />
    <div class="step-btns">
      <button
        type="button"
        class="step-btn"
        :disabled="disabled || model <= min"
        @click="bump(-step)"
      >
        −
      </button>
      <button
        type="button"
        class="step-btn"
        :disabled="disabled || model >= max"
        @click="bump(step)"
      >
        +
      </button>
    </div>
  </div>
</template>

<style scoped>
.num-stepper {
  display: inline-flex;
  align-items: stretch;
  width: 100%;
  max-width: 14rem;
  min-width: 9.5rem;
  border: 1px solid var(--color-border, #2d323a);
  border-radius: 8px;
  background: var(--color-background, #0f1217);
  overflow: hidden;
}

.num-stepper.disabled {
  opacity: 0.5;
}

.step-input {
  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  border: none;
  background: transparent;
  color: var(--color-text, #ebedf0);
  text-align: left;
  padding: 0.35rem 0.55rem;
  font: inherit;
  font-size: 0.85rem;
  -moz-appearance: textfield;
}

.step-input::-webkit-outer-spin-button,
.step-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.step-btns {
  display: inline-flex;
  flex: 0 0 auto;
  border-left: 1px solid var(--color-border, #2d323a);
}

.step-btn {
  flex: 0 0 1.85rem;
  width: 1.85rem;
  height: 1.85rem;
  border: none;
  border-left: 1px solid var(--color-border, #2d323a);
  background: transparent;
  color: var(--color-heading, #ebedf0);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.step-btns .step-btn:first-child {
  border-left: none;
}

.step-btn:hover:not(:disabled) {
  background: var(--color-background-mute, #1a1e25);
}

.step-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
