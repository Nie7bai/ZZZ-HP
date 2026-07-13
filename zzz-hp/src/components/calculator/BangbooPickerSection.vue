<script setup lang="ts">
import { computed, ref } from 'vue'
import CalculatorAvatar from '@/components/calculator/CalculatorAvatar.vue'
import type { BangbooBuffDoc } from '@/types/calculator'

const props = defineProps<{
  bangboos: BangbooBuffDoc[]
  selectedId: string
  refine: number
}>()

const emit = defineEmits<{
  select: [id: string]
  'update:refine': [value: number]
}>()

const search = ref('')

const selectableBangboos = computed(() => props.bangboos.filter((item) => item.id !== 'none'))

const filteredBangboos = computed(() => {
  const keyword = search.value.trim()
  if (!keyword) return selectableBangboos.value
  return selectableBangboos.value.filter((item) => item.name.includes(keyword))
})
</script>

<template>
  <section id="damage-bangboo" class="section-card damage-anchor">
    <header class="section-header">
      <div>
        <h2>邦布</h2>
        <p class="section-desc">选择本次出分使用的邦布与精炼等级</p>
      </div>
      <input v-model="search" class="search-input" type="text" placeholder="搜索邦布..." />
    </header>

    <div v-if="selectedId !== 'none'" class="refine-row">
      <span>精炼</span>
      <input
        class="refine-slider"
        type="range"
        min="1"
        max="5"
        step="1"
        :value="refine"
        @input="emit('update:refine', Number(($event.target as HTMLInputElement).value))"
      />
      <span class="refine-badge">精{{ refine }}</span>
    </div>

    <div class="bangboo-grid">
      <button
        v-for="bangboo in filteredBangboos"
        :key="bangboo.id"
        type="button"
        class="bangboo-cell"
        :class="{ active: selectedId === bangboo.id }"
        @click="emit('select', bangboo.id)"
      >
        <CalculatorAvatar
          class="bangboo-avatar"
          :avatar-image="bangboo.avatar_image"
          :name="bangboo.name"
        />
        <span class="bangboo-name">{{ bangboo.name }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.section-card {
  border: 1px solid #2a2d33;
  border-radius: 14px;
  background: linear-gradient(180deg, #171a1f 0%, #12151a 100%);
  padding: 1rem;
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.section-header h2 {
  margin: 0;
  font-size: 1.05rem;
  color: #f0f2f6;
}

.section-desc {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}

.search-input {
  width: min(320px, 100%);
  border: 1px solid #313640;
  border-radius: 10px;
  background: #0f1217;
  color: #edf0f5;
  padding: 0.55rem 0.75rem;
  font-size: 0.88rem;
}

.refine-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 0.75rem;
  color: #d5dae4;
  font-size: 0.82rem;
}

.refine-slider {
  width: 140px;
  accent-color: #c9a55c;
}

.refine-badge {
  min-width: 2.4rem;
  text-align: center;
  border: 1px solid #343a44;
  border-radius: 999px;
  padding: 0.15rem 0.45rem;
  font-size: 0.76rem;
}

.bangboo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 0.5rem;
}

.bangboo-cell {
  border: 1px solid #2d323a;
  border-radius: 10px;
  background: #10141a;
  color: #e4e8ef;
  padding: 0.45rem 0.35rem 0.4rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
}

.bangboo-cell.active {
  border-color: #c9a55c;
  box-shadow: inset 0 0 0 1px rgba(201, 165, 92, 0.35);
}

.bangboo-avatar :deep(.calculator-avatar) {
  width: 56px;
  height: 56px;
  border-radius: 10px;
}

.bangboo-avatar :deep(.calculator-avatar img),
.bangboo-avatar :deep(.fallback) {
  border-radius: 10px;
}

.bangboo-name {
  width: 100%;
  font-size: 0.72rem;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 980px) {
  .section-header {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    width: 100%;
  }
}
</style>
