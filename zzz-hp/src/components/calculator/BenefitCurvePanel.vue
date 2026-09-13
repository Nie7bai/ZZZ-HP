<script setup lang="ts">
import OptimalBenefitCurveChart from '@/components/calculator/OptimalBenefitCurveChart.vue'
import type { BenefitCurveSeries } from '@/utils/optimalAffixAlloc'

/**
 * 收益曲线工具栏 + 折线图。
 *
 * 扫掠柱图与词条分配共用同一份实现，只注入 series 与档数上限；
 * 模式切换（累计/边际）由本组件内部维护，避免各调用方重复实现。
 */
withDefaults(
  defineProps<{
    series: BenefitCurveSeries[]
    /** 曲线最多画多少档 */
    maxAdded: number
    /** 右侧说明文案 */
    hint?: string
  }>(),
  { hint: '' },
)

const mode = defineModel<'cumulative' | 'marginal'>('mode', { default: 'cumulative' })
</script>

<template>
  <div class="curve-toolbar">
    <button
      type="button"
      class="chip"
      :class="{ active: mode === 'cumulative' }"
      @click="mode = 'cumulative'"
    >
      累计提升
    </button>
    <button
      type="button"
      class="chip"
      :class="{ active: mode === 'marginal' }"
      @click="mode = 'marginal'"
    >
      边际收益
    </button>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
  <OptimalBenefitCurveChart :series="series" :mode="mode" :max-added="maxAdded" />
</template>

<style scoped>
.curve-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}

/* 曲线模式切换用统一 chip：见 `assets/calculatorChip.css`（改造前这里自带一套青柠色选中） */

.hint {
  margin: 0;
  font-size: 0.8rem;
  color: #9aa3b0;
}
</style>
