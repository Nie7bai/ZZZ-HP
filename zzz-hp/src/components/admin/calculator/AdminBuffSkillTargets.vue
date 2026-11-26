<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCalculatorBuffStore } from '@/stores/calculatorBuffs'
import { BUFF_SKILL_TARGET_OPTIONS, type BuffSkillTarget, type BuffSkillTargetId, type SkillSubcategory } from '@/types/calculator'
import { formatSkillTargetBracket } from '@/utils/buffEffect'

const props = defineProps<{
  targets: BuffSkillTarget[]
  targetLabels?: (string | undefined)[]
  agentId?: string
  allowCreate?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  add: [target: BuffSkillTarget]
  remove: [index: number]
  create: []
}>()

const { agents, skillSubcategories } = storeToRefs(useCalculatorBuffStore())
const menuOpen = ref(false)
const category = ref<BuffSkillTargetId>(props.targets[0]?.category ?? 'basic')
const subcategoryId = ref<string | null>(null)
const availableSubcategories = computed(() => skillSubcategories.value.filter((item) => {
  if (props.agentId && item.agentId && item.agentId !== props.agentId) return false
  return item.categoryId === category.value || (category.value === 'follow_up' && item.countsAsFollowUp)
}))

function subcategoryLabel(subcategory: SkillSubcategory) {
  if (props.agentId || !subcategory.agentId) return subcategory.name
  const agent = agents.value.find((item) => item.id === subcategory.agentId)
  return agent ? `${subcategory.name}（${agent.name}）` : subcategory.name
}

function targetLabel(target: BuffSkillTarget, index: number) {
  const label = props.targetLabels?.[index]
  if (label) return label
  const subcategory = skillSubcategories.value.find((item) => item.id === target.subcategoryId)
  return subcategory
    ? subcategoryLabel(subcategory)
    : formatSkillTargetBracket(target).slice(1, -1)
}

function changeCategory(event: Event) {
  category.value = (event.target as HTMLSelectElement).value as BuffSkillTargetId
  subcategoryId.value = null
}

function addTarget() {
  emit('add', { category: category.value, subcategoryId: subcategoryId.value })
  menuOpen.value = false
}

function createSubcategory() {
  emit('create')
  menuOpen.value = false
}

watch(menuOpen, (open, _, onCleanup) => {
  if (!open) return
  const close = () => { menuOpen.value = false }
  document.addEventListener('click', close)
  onCleanup(() => document.removeEventListener('click', close))
})
</script>

<template>
  <span class="skill-targets">
    <span
      v-for="(target, index) in targets"
      :key="`${target.category}-${target.subcategoryId ?? 'all'}-${index}`"
      class="skill-chip"
    >
      {{ targetLabel(target, index) }}
      <button
        type="button"
        class="chip-remove"
        :aria-label="`移除${targetLabel(target, index)}`"
        :disabled="disabled"
        @click="emit('remove', index)"
      >×</button>
    </span>
    <span class="skill-add">
      <button
        type="button"
        class="ghost-btn"
        :aria-expanded="menuOpen"
        :disabled="disabled"
        @click.stop="menuOpen = !menuOpen"
      >＋ 添加</button>
      <span v-if="menuOpen && !disabled" class="skill-menu" @click.stop>
        <label class="menu-field">
          <span>招式类型</span>
          <select :value="category" @change="changeCategory">
            <option v-for="option in BUFF_SKILL_TARGET_OPTIONS" :key="option.id" :value="option.id">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label v-if="category !== 'destruction'" class="menu-field">
          <span>招式小类</span>
          <select v-model="subcategoryId">
            <option :value="null">{{ category === 'follow_up' ? '全部追加' : '整大类' }}</option>
            <option v-for="item in availableSubcategories" :key="item.id" :value="item.id">
              {{ subcategoryLabel(item) }}
            </option>
          </select>
        </label>
        <span class="menu-actions">
          <button type="button" class="ghost-btn" @click="addTarget">＋ 添加动作</button>
          <button
            v-if="allowCreate && category !== 'destruction'"
            type="button"
            class="ghost-btn"
            @click="createSubcategory"
          >＋ 新建小类</button>
        </span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.skill-targets,
.skill-chip,
.skill-add {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
}

.skill-targets {
  flex-wrap: wrap;
}

.skill-chip {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0 0.25rem;
  font-size: var(--buff-editor-text-size, 0.8rem);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.chip-remove {
  border: 0;
  padding: 0;
  color: var(--color-text);
  background: transparent;
  cursor: pointer;
  line-height: 1;
}

.skill-add {
  position: relative;
}

.skill-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 4px);
  left: 0;
  width: min(15rem, calc(100vw - 2rem));
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-background);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
}

.menu-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: var(--buff-editor-text-size, 0.8rem);
}

.menu-field select,
.ghost-btn {
  color: var(--color-heading);
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  min-height: var(--buff-editor-control-height, 1.65rem);
  padding: 0.25rem 0.45rem;
  font-family: inherit;
  font-size: var(--buff-editor-text-size, 0.8rem);
}

.ghost-btn {
  cursor: pointer;
  white-space: nowrap;
}

.menu-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
</style>
