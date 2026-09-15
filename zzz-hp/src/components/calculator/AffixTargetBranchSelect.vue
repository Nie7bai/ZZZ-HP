<script setup lang="ts">
import { computed } from 'vue'
import {
  AFFIX_TARGET_TIMING_OPTIONS,
  affixTargetTiming,
  findAffixTargetBranchGroup,
  groupsForAffixTargetTiming,
  pickAffixTargetForGroup,
  pickAffixTargetForTiming,
  type AffixTargetTiming,
} from '@/utils/affixTargetBranches'

const CUSTOM_VALUE = '__custom__'

const props = withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    allowCustom?: boolean
  }>(),
  { disabled: false, allowCustom: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  custom: []
}>()

const timing = computed(() => affixTargetTiming(props.modelValue))

const groupOptions = computed(() => groupsForAffixTargetTiming(timing.value))

const selectedGroupId = computed(
  () => findAffixTargetBranchGroup(props.modelValue)?.id ?? groupOptions.value[0]?.id ?? '',
)

const leafOptions = computed(
  () => groupOptions.value.find((item) => item.id === selectedGroupId.value)?.options ?? [],
)

function onPickTiming(event: Event) {
  const next = (event.target as HTMLSelectElement).value as AffixTargetTiming
  emit('update:modelValue', pickAffixTargetForTiming(props.modelValue, next))
}

function onPickGroup(event: Event) {
  const groupId = (event.target as HTMLSelectElement).value
  emit('update:modelValue', pickAffixTargetForGroup(props.modelValue, groupId, timing.value))
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
  <div class="affix-target-branch">
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
      class="branch-select branch-select--group"
      :value="selectedGroupId"
      :disabled="disabled || !groupOptions.length"
      title="2 级分组"
      @change="onPickGroup"
    >
      <option v-if="!groupOptions.length" value="" disabled>先选时机</option>
      <option v-for="group in groupOptions" :key="group.id" :value="group.id">
        {{ group.label }}
      </option>
    </select>
    <select
      class="branch-select branch-select--leaf"
      :value="modelValue"
      :title="modelValue"
      :disabled="disabled || !leafOptions.length"
      @change="onPickLeaf"
    >
      <option v-if="!leafOptions.length" value="" disabled>先选分组</option>
      <option v-for="opt in leafOptions" :key="opt.id" :value="opt.id">
        {{ opt.label }}
      </option>
      <option v-if="allowCustom" :value="CUSTOM_VALUE">自定义字段名…</option>
    </select>
  </div>
</template>

<style scoped>
.affix-target-branch {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  width: 100%;
}

.branch-select {
  min-width: 0;
  border: 1px solid var(--color-border, #3a4049);
  border-radius: 7px;
  background: var(--color-background-soft, #10131a);
  color: inherit;
  font: inherit;
  font-size: 0.8rem;
  padding: 0.2rem 0.35rem;
}

.branch-select--timing {
  flex: 0 0 4.4rem;
  width: 4.4rem;
}

.branch-select--group {
  flex: 0 0 7.2rem;
  width: 7.2rem;
}

.branch-select--leaf {
  flex: 1 1 auto;
}
</style>
