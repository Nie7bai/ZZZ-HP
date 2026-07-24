<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { BenefitCurveSeries } from '@/utils/optimalAffixAlloc'

const props = withDefaults(
  defineProps<{
    series: BenefitCurveSeries[]
    mode: 'cumulative' | 'marginal'
    maxAdded?: number
    height?: number
  }>(),
  { maxAdded: 10, height: 240 },
)

const padding = { top: 16, right: 16, bottom: 32, left: 48 }

const containerEl = ref<HTMLElement | null>(null)
const containerWidth = ref(560)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (!containerEl.value) return
  containerWidth.value = containerEl.value.clientWidth || 560
  resizeObserver = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width
    if (w) containerWidth.value = w
  })
  resizeObserver.observe(containerEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

const width = computed(() => Math.max(320, containerWidth.value))

const plotW = computed(() => width.value - padding.left - padding.right)
const plotH = computed(() => props.height - padding.top - padding.bottom)

const pointsX = computed(() => {
  const n = props.maxAdded
  return Array.from({ length: n }, (_, i) => i + 1)
})

const maxY = computed(() => {
  let max = 0
  for (const s of props.series) {
    const arr = props.mode === 'cumulative' ? s.cumulativePercent : s.marginalPercent
    for (let i = 1; i <= props.maxAdded; i += 1) {
      const v = arr[i] ?? 0
      if (v > max) max = v
    }
  }
  return max > 0 ? max * 1.08 : 1
})

function xPos(n: number) {
  return padding.left + ((n - 0.5) / props.maxAdded) * plotW.value
}

function yPos(v: number) {
  return padding.top + plotH.value * (1 - Math.max(0, v) / maxY.value)
}

function linePath(s: BenefitCurveSeries) {
  const arr = props.mode === 'cumulative' ? s.cumulativePercent : s.marginalPercent
  return pointsX.value
    .map((n, i) => {
      const x = xPos(n)
      const y = yPos(arr[n] ?? 0)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
}

const yTicks = computed(() =>
  [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    value: maxY.value * t,
    y: padding.top + plotH.value * (1 - t),
  })),
)

const hoverN = ref<number | null>(null)

function seriesValueAt(s: BenefitCurveSeries, n: number) {
  const arr = props.mode === 'cumulative' ? s.cumulativePercent : s.marginalPercent
  return arr[n] ?? 0
}

const hitWidth = computed(() => plotW.value / Math.max(props.maxAdded, 1))

const tipStyle = computed(() => {
  if (hoverN.value == null) return {}
  const n = hoverN.value
  let topY = padding.top + plotH.value
  for (const s of props.series) {
    const y = yPos(seriesValueAt(s, n))
    if (y < topY) topY = y
  }
  const x = Math.max(100, Math.min(width.value - 100, xPos(n)))
  const estTipH = 32 + props.series.length * 18
  if (topY - estTipH - 8 < 0) {
    return { left: `${x}px`, top: `${topY + 12}px`, transform: 'translate(-50%, 0)' }
  }
  return { left: `${x}px`, top: `${topY - 8}px`, transform: 'translate(-50%, -100%)' }
})

const hoverTipRows = computed(() => {
  if (hoverN.value == null) return []
  const n = hoverN.value
  return [...props.series]
    .map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      value: seriesValueAt(s, n),
    }))
    .sort((a, b) => b.value - a.value)
})
</script>

<template>
  <div ref="containerEl" class="opt-line-chart">
    <div class="opt-line-chart__inner" :style="{ width: `${width}px`, position: 'relative' }">
    <svg
      class="opt-line-chart__svg"
      :width="width"
      :height="height"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      aria-label="收益曲线"
    >
      <line
        v-for="tick in yTicks"
        :key="tick.value"
        :x1="padding.left"
        :x2="width - padding.right"
        :y1="tick.y"
        :y2="tick.y"
        class="grid"
      />
      <text
        v-for="tick in yTicks"
        :key="`y-${tick.value}`"
        :x="padding.left - 6"
        :y="tick.y + 3"
        class="axis-label"
        text-anchor="end"
      >
        {{ tick.value.toFixed(1) }}%
      </text>

      <text
        v-for="n in pointsX"
        :key="`x-${n}`"
        :x="xPos(n)"
        :y="height - 10"
        class="axis-label"
        text-anchor="middle"
      >
        {{ n }}
      </text>

      <path
        v-for="s in series"
        :key="s.key"
        :d="linePath(s)"
        fill="none"
        :stroke="s.color"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <template v-for="s in series" :key="`d-${s.key}`">
        <circle
          v-for="n in pointsX"
          :key="`${s.key}-${n}`"
          :cx="xPos(n)"
          :cy="yPos((mode === 'cumulative' ? s.cumulativePercent : s.marginalPercent)[n] ?? 0)"
          :r="hoverN === n ? 4 : 2.5"
          :fill="s.color"
        />
      </template>

      <line
        v-if="hoverN != null"
        :x1="xPos(hoverN)"
        :x2="xPos(hoverN)"
        :y1="padding.top"
        :y2="padding.top + plotH"
        class="guide"
      />
      <rect
        v-for="n in pointsX"
        :key="`hit-${n}`"
        class="hit"
        :x="xPos(n) - hitWidth / 2"
        :y="padding.top"
        :width="hitWidth"
        :height="plotH"
        @mouseenter="hoverN = n"
        @mouseleave="hoverN = null"
      />
    </svg>
    <div v-if="hoverN != null" class="line-tip" :style="tipStyle">
      <p class="line-tip__label">新增 {{ hoverN }} 词条</p>
      <p v-for="row in hoverTipRows" :key="row.key" class="line-tip__row">
        <i :style="{ background: row.color }" />
        {{ row.label }}：<strong>{{ row.value >= 0 ? '+' : '' }}{{ row.value.toFixed(3) }}%</strong>
      </p>
    </div>
    </div>
    <div class="legend">
      <span v-for="s in series" :key="s.key" class="legend-item">
        <i :style="{ background: s.color }" />
        {{ s.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.opt-line-chart {
  width: 100%;
}

.opt-line-chart__svg {
  display: block;
}

.grid {
  stroke: rgba(255, 255, 255, 0.06);
  stroke-width: 1;
}

.axis-label {
  fill: #8b93a1;
  font-size: 10px;
}

.guide {
  stroke: rgba(191, 255, 9, 0.35);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}

.hit {
  fill: transparent;
  cursor: crosshair;
}

.line-tip {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  padding: 0.4rem 0.55rem;
  border: 1px solid #3a4048;
  border-radius: 8px;
  background: rgba(15, 18, 23, 0.96);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
  font-size: 0.72rem;
  color: #c5cad3;
}

.line-tip__label {
  margin: 0 0 0.2rem;
  font-weight: 700;
  color: #e8eaed;
}

.line-tip__row {
  margin: 0.1rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.line-tip__row strong {
  color: #bfff09;
}

.line-tip__row i {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.45rem;
  font-size: 0.75rem;
  color: #9aa3b0;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.legend-item i {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}
</style>
