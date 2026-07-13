<script setup lang="ts">
import { computed } from 'vue'
import type { BuffStatModifiers } from '@/types/calculator'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'

const props = defineProps<{
  mods: BuffStatModifiers
}>()

const visibleFields = computed(() =>
  BUFF_STAT_FIELDS.filter((field) => props.mods[field.key] !== 0),
)
</script>

<template>
  <p v-if="!visibleFields.length" class="empty-mods">暂无增益数据</p>
  <ul v-else class="mods-list">
    <li v-for="field in visibleFields" :key="field.key">
      <span>{{ buffStatFieldLabel(field) }}</span>
      <strong>{{ mods[field.key] }}</strong>
    </li>
  </ul>
</template>

<style scoped>
.mods-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem 0.75rem;
}

.mods-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: #b7c0cd;
}

.mods-list strong {
  color: #e8ebf0;
  font-weight: 600;
}

.empty-mods {
  margin: 0;
  font-size: 0.8rem;
  color: #7a828f;
}
</style>
