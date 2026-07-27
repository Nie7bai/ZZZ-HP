<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    agents: Array<{ id: string; name: string }>
    allowEmpty?: boolean
    emptyLabel?: string
    disabled?: boolean
    placeholder?: string
  }>(),
  {
    allowEmpty: true,
    emptyLabel: '全部角色',
    disabled: false,
    placeholder: '输入角色名搜索…',
  },
)

const model = defineModel<string>({ default: '' })

const query = ref('')
const open = ref(false)

const selectedLabel = computed(() => {
  if (!model.value) return props.emptyLabel
  return props.agents.find((item) => item.id === model.value)?.name ?? model.value
})

watch(
  model,
  () => {
    query.value = model.value ? selectedLabel.value : ''
  },
  { immediate: true },
)

const filteredAgents = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword || keyword === selectedLabel.value.toLowerCase()) {
    return props.agents
  }
  return props.agents.filter((agent) => {
    const name = agent.name.toLowerCase()
    const id = agent.id.toLowerCase()
    return name.includes(keyword) || id.includes(keyword)
  })
})

function pick(id: string) {
  model.value = id
  open.value = false
  query.value = id ? props.agents.find((item) => item.id === id)?.name ?? id : ''
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value
  open.value = true
}

function onFocus() {
  if (props.disabled) return
  open.value = true
  query.value = ''
}

function onBlur() {
  window.setTimeout(() => {
    open.value = false
    query.value = model.value ? selectedLabel.value : ''
  }, 150)
}
</script>

<template>
  <div class="agent-fuzzy-select" :class="{ disabled }">
    <input
      class="search-input"
      type="search"
      :value="open ? query : selectedLabel"
      :placeholder="placeholder"
      :disabled="disabled"
      autocomplete="off"
      @focus="onFocus"
      @blur="onBlur"
      @input="onInput"
    />
    <ul v-if="open && !disabled" class="suggest-list" role="listbox">
      <li v-if="allowEmpty">
        <button type="button" class="suggest-item" @mousedown.prevent="pick('')">
          {{ emptyLabel }}
        </button>
      </li>
      <li v-for="agent in filteredAgents" :key="agent.id">
        <button
          type="button"
          class="suggest-item"
          :class="{ active: model === agent.id }"
          @mousedown.prevent="pick(agent.id)"
        >
          {{ agent.name }}
        </button>
      </li>
      <li v-if="!filteredAgents.length" class="suggest-empty">无匹配角色</li>
    </ul>
  </div>
</template>

<style scoped>
.agent-fuzzy-select {
  position: relative;
  width: 100%;
}

/* 与 adminCalculatorPanel.css 的 .field-input 对齐（子组件拿不到父级 scoped 样式） */
.search-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.65rem;
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
.suggest-item.active {
  background: var(--color-background-mute);
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
