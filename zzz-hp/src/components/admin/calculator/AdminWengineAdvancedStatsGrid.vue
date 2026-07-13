<script setup lang="ts">
import AdminRememberedNumberField from '@/components/admin/calculator/AdminRememberedNumberField.vue'
import { wengineAdvancedStatFieldKey } from '@/utils/wengineStatSuggestions'

defineProps<{
  fields: readonly {
    key: string
    label: string
    unit: 'flat' | 'percent'
  }[]
  hint?: string
  refreshToken?: number
}>()

const model = defineModel<Record<string, number>>({ required: true })
</script>

<template>
  <div class="numeric-stat-grid-wrap">
    <p v-if="hint" class="numeric-stat-hint">{{ hint }}</p>
    <div class="numeric-stat-grid">
      <AdminRememberedNumberField
        v-for="field in fields"
        :key="field.key"
        v-model="model[field.key]!"
        :field-key="wengineAdvancedStatFieldKey(field.key)"
        :label="field.label"
        :unit="field.unit"
        :refresh-token="refreshToken"
      />
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
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
