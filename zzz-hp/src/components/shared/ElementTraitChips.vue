<script setup lang="ts">
import { computed } from 'vue'
import {
  TRAIT_ELEMENTS,
  joinTraitElements,
  splitTraitElements,
  toggleTraitElement,
} from '@/utils/elementIcons'

const model = defineModel<string>({ default: '' })

withDefaults(
  defineProps<{
    label?: string
    variant?: 'weak' | 'resist'
    disabled?: boolean
    /** stack：标签在上；inline：标签与芯片横排（临界编辑用） */
    layout?: 'stack' | 'inline'
  }>(),
  {
    label: '',
    variant: 'weak',
    disabled: false,
    layout: 'stack',
  },
)

const selected = computed(() => splitTraitElements(model.value))

function onToggle(el: string) {
  model.value = joinTraitElements(toggleTraitElement(selected.value, el))
}
</script>

<template>
  <div
    class="trait-chips"
    :class="{
      'is-disabled': disabled,
      'trait-chips--inline': layout === 'inline',
    }"
  >
    <span v-if="label" class="trait-chips-label">{{ label }}</span>
    <div class="trait-chips-list">
      <button
        v-for="el in TRAIT_ELEMENTS"
        :key="el"
        type="button"
        class="trait-chip"
        :class="{
          'trait-chip--on': selected.includes(el),
          'trait-chip--resist': variant === 'resist',
        }"
        :disabled="disabled"
        @click="onToggle(el)"
      >
        {{ el }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.trait-chips {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.trait-chips--inline {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.45rem;
}

.trait-chips-label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-heading, inherit);
  opacity: 0.85;
}

.trait-chips-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
}

.trait-chip {
  padding: 0.16rem 0.42rem;
  border: 1px solid var(--color-border, #3a4250);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text, #c8cdd5);
  font: inherit;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  opacity: 0.65;
}

.trait-chip:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.trait-chip--on {
  background: color-mix(in srgb, #34d399 24%, transparent);
  border-color: #34d399;
  color: #047857;
  opacity: 1;
}

.trait-chip--resist.trait-chip--on {
  background: color-mix(in srgb, #f87171 24%, transparent);
  border-color: #f87171;
  color: #b91c1c;
}

.trait-chips.is-disabled {
  opacity: 0.7;
  pointer-events: none;
}

[data-theme='light'] .trait-chip--on {
  color: #047857;
}

[data-theme='light'] .trait-chip--resist.trait-chip--on {
  color: #b91c1c;
}
</style>
