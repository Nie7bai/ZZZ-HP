<script setup lang="ts">
import { numericStatFieldLabel } from '@/utils/calculatorUi'

defineProps<{
  fields: readonly {
    key: string
    label: string
    unit: 'flat' | 'percent'
  }[]
  hint?: string
}>()

const model = defineModel<Record<string, number>>({ required: true })
</script>

<template>
  <div class="numeric-stat-grid-wrap">
    <p v-if="hint" class="numeric-stat-hint">{{ hint }}</p>
    <div class="numeric-stat-grid">
      <label v-for="field in fields" :key="field.key" class="field">
        <span class="field-label">{{ numericStatFieldLabel(field.label, field.unit) }}</span>
        <input v-model.number="model[field.key]" type="number" step="any" class="field-input" />
      </label>
    </div>
  </div>
</template>

<style scoped>
.numeric-stat-grid-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.numeric-stat-hint {
  margin: 0;
  font-size: 0.76rem;
  color: var(--color-text);
  opacity: 0.72;
  line-height: 1.45;
}

.numeric-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

@media (min-width: 900px) {
  .numeric-stat-grid {
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
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  padding: 0.44rem 0.54rem;
}
</style>
