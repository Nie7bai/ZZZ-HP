<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    options: { name: string; [key: string]: unknown }[]
    modelValue: string
    placeholder?: string
    label?: string
    /** 选中后是否保留搜索词还是回填 name */
    fillOnSelect?: boolean
  }>(),
  {
    placeholder: '搜索…',
    label: '',
    fillOnSelect: true,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  select: [option: { name: string; [key: string]: unknown }]
}>()

const open = ref(false)
const query = ref('')

watch(
  () => props.modelValue,
  (value) => {
    if (!open.value) query.value = value
  },
  { immediate: true },
)

const filtered = computed(() => {
  const kw = query.value.trim().toLowerCase()
  if (!kw) return props.options
  return props.options.filter((opt) => opt.name.toLowerCase().includes(kw))
})

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  open.value = true
}

function selectOption(option: { name: string; [key: string]: unknown }) {
  if (props.fillOnSelect) query.value = option.name
  emit('update:modelValue', option.name)
  emit('select', option)
  open.value = false
}

function onBlur() {
  window.setTimeout(() => {
    open.value = false
  }, 150)
}
</script>

<template>
  <div class="adfs">
    <span v-if="label" class="adfs-label">{{ label }}</span>
    <div class="adfs-box">
      <input
        class="adfs-input"
        type="text"
        :value="query"
        :placeholder="placeholder"
        @input="onInput"
        @focus="open = true"
        @blur="onBlur"
      />
      <div v-if="open && filtered.length" class="adfs-list">
        <button
          v-for="opt in filtered"
          :key="opt.name"
          type="button"
          class="adfs-item"
          @mousedown.prevent
          @click="selectOption(opt)"
        >
          {{ opt.name }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.adfs {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
}

.adfs-label {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text);
  opacity: 0.8;
}

.adfs-box {
  position: relative;
  flex: 1;
  min-width: 0;
}

.adfs-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-mute);
  color: var(--color-heading);
  font-size: 0.85rem;
}

.adfs-list {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 60;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background-soft);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}

.adfs-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.55rem;
  border: none;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-heading);
  font-size: 0.82rem;
  cursor: pointer;
}

.adfs-item:hover {
  background: var(--color-background-mute);
}
</style>
