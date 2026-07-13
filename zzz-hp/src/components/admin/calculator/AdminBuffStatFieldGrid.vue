<script setup lang="ts">
import type { BuffStatKey, BuffStatModifiers } from '@/types/calculator'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'
import { computed } from 'vue'

const props = defineProps<{
  fields?: readonly (typeof BUFF_STAT_FIELDS)[number][]
  hint?: string
}>()

const model = defineModel<BuffStatModifiers>({ required: true })

const displayFields = computed(() => props.fields ?? BUFF_STAT_FIELDS)
</script>

<template>
  <div class="buff-stat-grid-wrap">
    <p v-if="hint !== ''" class="buff-stat-hint">
      {{ hint ?? '局外面板仅含录入数据；易伤/失衡易伤/特殊乘区内为加算，各乘区之间连乘。' }}
    </p>
    <div class="buff-stat-grid">
      <label v-for="field in displayFields" :key="field.key" class="field" :title="field.hint">
        <span class="field-label">{{ buffStatFieldLabel(field) }}</span>
        <input v-model.number="model[field.key as BuffStatKey]" type="number" step="any" class="field-input" />
      </label>
    </div>
  </div>
</template>

<style scoped>
.buff-stat-grid-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.buff-stat-hint {
  margin: 0;
  font-size: 0.76rem;
  color: var(--color-text);
  opacity: 0.72;
  line-height: 1.45;
}

.buff-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

@media (min-width: 900px) {
  .buff-stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-label {
  font-size: 0.76rem;
  color: var(--color-text);
  opacity: 0.78;
}

.field-input {
  border: 1px solid #2d323a;
  border-radius: 8px;
  background: #0f1217;
  color: #ebedf0;
  padding: 0.4rem 0.5rem;
}
</style>
