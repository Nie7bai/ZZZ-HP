<script setup lang="ts">
import { computed } from 'vue'
import {
  AFFIX_TARGET_TIMING_OPTIONS,
  affixTargetTiming,
  groupsForAffixTargetTiming,
  pickAffixTargetForTiming,
  type AffixTargetTiming,
} from '@/utils/affixTargetBranches'

const CUSTOM_VALUE = '__custom__'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    allowCustom?: boolean
    layout?: 'row' | 'stack'
  }>(),
  { disabled: false, allowCustom: false, layout: 'row' },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  custom: []
}>()

const timing = computed(() => affixTargetTiming(props.modelValue))

const groupOptions = computed(() => groupsForAffixTargetTiming(timing.value))

function onPickTiming(event: Event) {
  const next = (event.target as HTMLSelectElement).value as AffixTargetTiming
  emit('update:modelValue', pickAffixTargetForTiming(props.modelValue, next))
}

function onPickLeaf(event: Event) {
  const select = event.target as HTMLSelectElement
  if (select.value === CUSTOM_VALUE) {
    select.value = props.modelValue
    emit('custom')
    return
  }
  emit('update:modelValue', select.value)
}
</script>

<template>
  <div class="affix-target-branch" :class="`affix-target-branch--${layout}`">
    <select
      class="branch-select branch-select--timing"
      :value="timing"
      :disabled="disabled"
      title="加入时机：局外写入局外面板，局内不进局外快照"
      @change="onPickTiming"
    >
      <option v-for="item in AFFIX_TARGET_TIMING_OPTIONS" :key="item.id" :value="item.id">
        {{ item.label }}
      </option>
    </select>
    <select
      class="branch-select branch-select--leaf"
      :value="modelValue"
      :title="modelValue"
      :disabled="disabled || !groupOptions.length"
      @change="onPickLeaf"
    >
      <option v-if="!groupOptions.length" value="" disabled>先选时机</option>
      <optgroup v-for="group in groupOptions" :key="group.id" :label="group.label">
        <option v-for="opt in group.options" :key="opt.id" :value="opt.id">
          {{ opt.label }}
        </option>
      </optgroup>
      <option v-if="allowCustom" :value="CUSTOM_VALUE">自定义字段名…</option>
    </select>
  </div>
</template>

<style scoped>
.affix-target-branch {
  display: flex;
  gap: 0.35rem;
  min-width: 0;
}

.affix-target-branch--stack {
  flex-direction: column;
}

.branch-select {
  min-width: 0;
  border: 1px solid var(--color-border, #3a4049);
  border-radius: 7px;
  background: var(--color-background-soft, #10131a);
  color: inherit;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.2rem 0.4rem;
  width: 100%;
}

.branch-select--timing {
  flex: 0 0 auto;
  width: 5.2rem;
}

.affix-target-branch--stack .branch-select--timing {
  width: 100%;
}

.branch-select--leaf {
  flex: 1 1 auto;
}
</style>
