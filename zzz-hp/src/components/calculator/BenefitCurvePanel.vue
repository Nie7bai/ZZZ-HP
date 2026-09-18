<script setup lang="ts">
import OptimalBenefitCurveChart from '@/components/calculator/OptimalBenefitCurveChart.vue'
import type { BenefitCurveSeries } from '@/utils/optimalAffixAlloc'

/**
 * 收益曲线工具栏 + 折线图。
 *
 * 扫掠柱图与词条分配共用同一份实现，只注入 series 与档数上限；
 * 模式切换（累计/边际）由本组件内部维护，避免各调用方重复实现。
 *
 * 分组 chip 只在调用方给了 `groups` 时出现：词条分配模式**只做组内对比**
 * （同一张图里的条目抢的是同一份资源，跨组混画没有可比性），扫掠模式没有分组概念。
 */
withDefaults(
  defineProps<{
    series: BenefitCurveSeries[]
    /** 右侧说明文案 */
    hint?: string
    /** 可选分组（顺序由调用方定；空数组 = 不显示分组 chip） */
    groups?: string[]
  }>(),
  { hint: '', groups: () => [] },
)

const mode = defineModel<'cumulative' | 'marginal'>('mode', { default: 'cumulative' })
/** 曲线最多画多少档（2026-09-18：10 / 20 / 50 可选，默认 20） */
const maxAdded = defineModel<number>('maxAdded', { default: 20 })
/** 框选模式开关（2026-09-18）：十字线 ↔ 框选，只影响图内交互 */
const selectMode = defineModel<boolean>('selectMode', { default: false })
/** 当前分组（调用方给了 `groups` 时才有意义） */
const group = defineModel<string>('group', { default: '' })
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
    <span class="group-label">档数</span>
    <button
      v-for="n in [10, 20, 50]"
      :key="`rolls-${n}`"
      type="button"
      class="chip"
      :class="{ active: maxAdded === n }"
      :title="`曲线最多画到第 ${n} 档`"
      @click="maxAdded = n"
    >
      {{ n }}
    </button>
    <button
      type="button"
      class="chip"
      :class="{ active: selectMode }"
      :title="
        selectMode
          ? '框选模式：在图上按住拖出区间缩放，双击复位（点一下回到十字线）'
          : '十字线模式：悬停看数值（点一下切到框选）'
      "
      @click="selectMode = !selectMode"
    >
      {{ selectMode ? '框选' : '十字线' }}
    </button>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
  <div v-if="groups.length" class="curve-groups">
    <span class="group-label">分组</span>
    <button
      v-for="name in groups"
      :key="name"
      type="button"
      class="chip"
      :class="{ active: group === name }"
      :title="`只看「${name}」组内的条目`"
      @click="group = name"
    >
      {{ name }}
    </button>
  </div>
  <OptimalBenefitCurveChart
    :series="series"
    :mode="mode"
    :max-added="maxAdded"
    :select-mode="selectMode"
  />
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

/* 分组 chip 行：与收益表的筛选条同款，视觉上压在模式行下面一行 */
.curve-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
  margin-top: 0.4rem;
}

.group-label {
  font-size: 0.8rem;
  color: #9aa3b0;
}
</style>
