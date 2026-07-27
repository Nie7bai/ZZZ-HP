<script setup lang="ts">
import { computed, ref } from 'vue'
import EquipPickerModal from '@/components/calculator/EquipPickerModal.vue'
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

const bangbooPickerOpen = ref(false)

const selectableBangboos = computed(() => props.bangboos.filter((item) => item.id !== 'none'))

const selectedBangboo = computed(() =>
  selectableBangboos.value.find((item) => item.id === props.selectedId),
)
</script>

<template>
  <section id="damage-bangboo" class="section-card damage-anchor">
    <header class="section-header">
      <div>
        <h2>邦布</h2>
        <p class="section-desc">选择本次出分使用的邦布与精炼等级；可不佩戴</p>
      </div>
    </header>

    <EquipPickerModal
      v-model:open="bangbooPickerOpen"
      title="选择邦布"
      description="可不佩戴"
      search-placeholder="搜索邦布…"
      :items="(selectableBangboos as unknown as Array<Record<string, unknown>>)"
      allow-none
      none-label="不佩戴"
      :selected-id="selectedId"
      :selected-label="selectedBangboo?.name"
      :selected-avatar="selectedBangboo?.avatar_image"
      @select="emit('select', $event)"
    />

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

.refine-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.75rem;
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

@media (max-width: 768px) {
  .section-card {
    padding: 0.75rem;
  }

  .section-header h2 {
    font-size: 0.98rem;
  }

  .section-desc {
    font-size: 0.72rem;
    line-height: 1.4;
  }
}
</style>
