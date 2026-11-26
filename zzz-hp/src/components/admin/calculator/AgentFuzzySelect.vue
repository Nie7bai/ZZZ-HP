<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'

interface SelectOption {
  id: string
  name: string
  meta?: string
}

const props = withDefaults(
  defineProps<{
    agents: SelectOption[]
    allowEmpty?: boolean
    emptyLabel?: string
    noMatchLabel?: string
    disabled?: boolean
    placeholder?: string
    inputId?: string
  }>(),
  {
    allowEmpty: true,
    emptyLabel: '全部角色',
    noMatchLabel: '无匹配角色',
    disabled: false,
    placeholder: '输入角色名搜索…',
  },
)

const model = defineModel<string>({ default: '' })

const query = ref('')
const open = ref(false)
const activeIndex = ref(-1)
const listId = useId()

const selectedLabel = computed(() => {
  if (!model.value) return props.emptyLabel
  const option = props.agents.find((item) => item.id === model.value)
  return option ? optionLabel(option) : model.value
})

const filteredAgents = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return props.agents
  return props.agents.filter((agent) => {
    const name = agent.name.toLowerCase()
    const id = agent.id.toLowerCase()
    return name.includes(keyword) || id.includes(keyword)
  })
})

const options = computed(() =>
  props.allowEmpty
    ? [{ id: '', name: props.emptyLabel }, ...filteredAgents.value]
    : filteredAgents.value,
)

function optionLabel(option: SelectOption): string {
  return option.meta ? `${option.name}（${option.meta}）` : option.name
}

function optionId(index: number): string {
  return `${listId}-${index}`
}

function closeMenu() {
  open.value = false
  activeIndex.value = -1
}

watch(model, closeMenu)
watch(() => props.disabled, (disabled) => {
  if (disabled) closeMenu()
})

function pick(id: string) {
  if (props.disabled) return
  model.value = id
  closeMenu()
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  activeIndex.value = -1
  open.value = true
}

function openMenu() {
  if (props.disabled || open.value) return
  query.value = ''
  open.value = true
}

function onKeydown(event: KeyboardEvent) {
  if (props.disabled || event.isComposing) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    openMenu()
    const count = options.value.length
    if (!count) return
    const index = activeIndex.value < count ? activeIndex.value : -1
    activeIndex.value = event.key === 'ArrowDown'
      ? (index + 1) % count
      : (index > 0 ? index - 1 : count - 1)
    void nextTick(() => {
      document.getElementById(optionId(activeIndex.value))?.scrollIntoView?.({ block: 'nearest' })
    })
  } else if (event.key === 'Enter' && open.value) {
    event.preventDefault()
    const option = options.value[activeIndex.value]
      ?? (query.value.trim() ? filteredAgents.value[0] : undefined)
    if (option) pick(option.id)
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    closeMenu()
  }
}
</script>

<template>
  <div class="agent-fuzzy-select" :class="{ disabled, open }">
    <input
      :id="inputId"
      class="search-input"
      type="search"
      role="combobox"
      aria-autocomplete="list"
      :aria-controls="open ? listId : undefined"
      :aria-expanded="open && !disabled"
      :aria-activedescendant="open && options[activeIndex] ? optionId(activeIndex) : undefined"
      :value="open ? query : selectedLabel"
      :placeholder="placeholder"
      :disabled="disabled"
      autocomplete="off"
      @focus="openMenu"
      @click="openMenu"
      @blur="closeMenu"
      @input="onInput"
      @keydown="onKeydown"
    />
    <ul v-if="open && !disabled" :id="listId" class="suggest-list" role="listbox">
      <li v-for="(option, index) in options" :key="option.id" role="presentation">
        <button
          :id="optionId(index)"
          type="button"
          role="option"
          tabindex="-1"
          :aria-selected="model === option.id"
          class="suggest-item"
          :class="{ active: model === option.id, 'keyboard-active': activeIndex === index }"
          @mousedown.prevent
          @click="pick(option.id)"
        >
          {{ optionLabel(option) }}
        </button>
      </li>
      <li v-if="!filteredAgents.length" class="suggest-empty" role="presentation">{{ noMatchLabel }}</li>
    </ul>
  </div>
</template>

<style scoped>
.agent-fuzzy-select {
  position: relative;
  width: 100%;
}

.agent-fuzzy-select::after {
  position: absolute;
  top: 50%;
  right: 0.75rem;
  width: 0.38rem;
  height: 0.38rem;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: translateY(-75%) rotate(45deg);
  color: var(--color-text);
  pointer-events: none;
  content: '';
}

.agent-fuzzy-select.open::after {
  transform: translateY(-25%) rotate(225deg);
}

/* 与 adminCalculatorPanel.css 的 .field-input 对齐（子组件拿不到父级 scoped 样式） */
.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 1.75rem 0.5rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.2s;
  font-family: inherit;
  line-height: 1.25;
  min-height: 2.35rem;
  color-scheme: inherit;
}

.search-input:focus {
  border-color: var(--color-border-hover);
}

.search-input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.suggest-list {
  position: absolute;
  z-index: 40;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.suggest-item {
  width: 100%;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-heading);
  text-align: left;
  padding: 0.4rem 0.55rem;
  font-size: 0.84rem;
  cursor: pointer;
}

.suggest-item:hover,
.suggest-item.active,
.suggest-item.keyboard-active {
  background: var(--color-background-mute);
}

.suggest-item.keyboard-active {
  box-shadow: inset 0 0 0 1px var(--color-border-hover);
}

.suggest-empty {
  padding: 0.45rem 0.55rem;
  font-size: 0.8rem;
  color: var(--color-text);
  opacity: 0.65;
}

.disabled {
  opacity: 0.65;
}
</style>
