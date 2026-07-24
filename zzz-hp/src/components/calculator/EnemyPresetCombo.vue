<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{
  modelValue: number
  presets: readonly number[]
  step?: number | string
  ariaLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const displayValue = computed({
  get: () => props.modelValue,
  set: (raw: number | string) => {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n)) emit('update:modelValue', n)
  },
})

const activePreset = computed(() => {
  const hit = props.presets.find((v) => Math.abs(v - Number(props.modelValue)) < 1e-6)
  return hit ?? null
})

function pick(value: number) {
  emit('update:modelValue', value)
  open.value = false
}

function toggle() {
  open.value = !open.value
}

function onDocPointer(event: PointerEvent) {
  const el = rootRef.value
  if (!el || !open.value) return
  if (event.target instanceof Node && !el.contains(event.target)) open.value = false
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onKey, true)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div
    ref="rootRef"
    class="preset-combo"
    :class="{ 'is-open': open }"
    @click.stop
  >
    <button
      type="button"
      class="preset-combo__trigger"
      :aria-label="ariaLabel || '选择预设'"
      :aria-expanded="open"
      @click.prevent="toggle"
    >
      <span>{{ activePreset ?? '自定义' }}</span>
      <span class="preset-combo__caret" aria-hidden="true" />
    </button>
    <input
      v-model.number="displayValue"
      class="preset-combo__input"
      type="number"
      :step="step ?? 1"
    />
    <ul v-if="open" class="preset-combo__menu" role="listbox">
      <li
        v-for="item in presets"
        :key="item"
        role="option"
        :aria-selected="activePreset === item"
        :class="{ 'is-active': activePreset === item }"
        @click="pick(item)"
      >
        {{ item }}
      </li>
      <li
        role="option"
        :aria-selected="activePreset == null"
        :class="{ 'is-active': activePreset == null }"
        @click="open = false"
      >
        自定义
      </li>
    </ul>
  </div>
</template>

<style scoped>
.preset-combo {
  position: relative;
  display: flex;
  align-items: stretch;
  min-width: 0;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color-scheme: dark;
  box-sizing: border-box;
}

.preset-combo.is-open,
.preset-combo:focus-within {
  border-color: #4a5568;
}

.preset-combo__trigger,
.preset-combo__input {
  margin: 0;
  border: 0;
  background: transparent;
  color: #ebedf0;
  font: inherit;
  line-height: 1.2;
  outline: none;
  box-shadow: none;
}

.preset-combo__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex: 0 0 auto;
  min-width: 5.2rem;
  padding: 0.44rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
}

.preset-combo__caret {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid #8b93a0;
  margin-left: auto;
}

.preset-combo__input {
  flex: 1 1 auto;
  min-width: 0;
  width: auto;
  padding: 0.44rem 0.54rem;
  border-left: 1px solid #2d323a;
}

.preset-combo__menu {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 40;
  margin: 0;
  padding: 0.28rem;
  list-style: none;
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #12161d;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
}

.preset-combo__menu li {
  padding: 0.42rem 0.55rem;
  border-radius: 6px;
  color: #ebedf0;
  cursor: pointer;
  font-size: 0.88rem;
}

.preset-combo__menu li:hover {
  background: rgba(255, 255, 255, 0.06);
}

.preset-combo__menu li.is-active {
  background: rgba(110, 182, 255, 0.18);
  color: #dceeff;
}
</style>
