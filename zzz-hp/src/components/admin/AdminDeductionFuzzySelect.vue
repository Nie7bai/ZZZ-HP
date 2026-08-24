<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    options: { name: string }[]
    modelValue: string
    placeholder?: string
    label?: string
    /** 选中后是否保留搜索词还是回填 name */
    fillOnSelect?: boolean
    /** 数据源加载中（尚未返回候选时显示加载态） */
    loading?: boolean
    /** 下拉最多展示条数，超出显示计数提示 */
    maxResults?: number
  }>(),
  {
    placeholder: '搜索…',
    label: '',
    fillOnSelect: true,
    loading: false,
    maxResults: 50,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  select: [option: { name: string; [key: string]: unknown }]
}>()

const open = ref(false)
const query = ref('')
/** 用户是否已手动输入（区别于初始回填的已选名） */
const dirty = ref(false)

watch(
  () => props.modelValue,
  (value) => {
    if (!open.value) {
      query.value = value ?? ''
      dirty.value = false
    }
  },
  { immediate: true },
)

/** 未输入时展示全部候选；输入后按名字模糊过滤 */
const filtered = computed(() => {
  const kw = dirty.value ? query.value.trim().toLowerCase() : ''
  if (!kw) return props.options
  return props.options.filter((opt) => opt.name.toLowerCase().includes(kw))
})

const visible = computed(() => filtered.value.slice(0, props.maxResults))
const totalCount = computed(() => filtered.value.length)

function onFocus(event: FocusEvent) {
  open.value = true
  dirty.value = false
  // 全选当前文字：直接输入即覆盖，不会残留旧名字过滤
  const input = event.target as HTMLInputElement
  window.setTimeout(() => input.select(), 0)
}

function onInput(event: Event) {
  dirty.value = true
  const value = (event.target as HTMLInputElement).value
  query.value = value
  open.value = true
  // 手动输入也同步回 modelValue：自定义名称可保存、空白校验才能准确判断
  emit('update:modelValue', value)
}

function selectOption(option: { name: string }) {
  if (props.fillOnSelect) query.value = option.name
  dirty.value = false
  emit('update:modelValue', option.name)
  emit('select', option as { name: string; [key: string]: unknown })
  open.value = false
}

function onBlur() {
  window.setTimeout(() => {
    open.value = false
    // 手动输入但未选中时回滚为当前真实值，避免输入框与数据脱节
    if (dirty.value) {
      query.value = props.modelValue ?? ''
      dirty.value = false
    }
  }, 150)
}

/** 候选详情（如 Lv / HP），帮助区分同名不同型 */
function optionMeta(opt: { name: string }): string {
  const o = opt as { level?: unknown; hp?: unknown }
  const parts: string[] = []
  if (o.level != null && o.level !== '') parts.push(`Lv${o.level}`)
  if (o.hp != null && o.hp !== '' && Number(o.hp) > 0) {
    parts.push(`HP ${Number(o.hp).toLocaleString()}`)
  }
  return parts.join(' · ')
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
        @focus="onFocus"
        @blur="onBlur"
      />
      <div v-if="open" class="adfs-list">
        <div v-if="loading && !props.options.length" class="adfs-state">加载中…</div>
        <div v-else-if="!visible.length" class="adfs-state">无匹配选项</div>
        <template v-else>
          <button
            v-for="opt in visible"
            :key="opt.name"
            type="button"
            class="adfs-item"
            @mousedown.prevent
            @click="selectOption(opt)"
          >
            <span class="adfs-item-name">{{ opt.name }}</span>
            <span v-if="optionMeta(opt)" class="adfs-item-meta">{{ optionMeta(opt) }}</span>
          </button>
          <div v-if="totalCount > visible.length" class="adfs-more">
            共 {{ totalCount }} 项，输入关键字过滤
          </div>
        </template>
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

.adfs-state {
  padding: 0.5rem 0.55rem;
  color: var(--color-text);
  opacity: 0.6;
  font-size: 0.8rem;
  text-align: center;
}

.adfs-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
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

.adfs-item-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.adfs-item-meta {
  flex-shrink: 0;
  font-family: var(--zzz-font-mono, monospace);
  font-size: 0.72rem;
  color: var(--color-text);
  opacity: 0.6;
}

.adfs-more {
  padding: 0.4rem 0.55rem;
  color: var(--color-text);
  opacity: 0.55;
  font-size: 0.75rem;
  text-align: center;
}
</style>
