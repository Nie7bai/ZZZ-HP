<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface BarSeries {
  key: string
  label: string
  color: string
  values: number[]
}

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: BarSeries[]
    selectedIndex: number | null
    height?: number
    /** 传入则由外部控制悬停（用于多图联动） */
    hoverIndex?: number | null
  }>(),
  { height: 220, hoverIndex: undefined },
)

const emit = defineEmits<{
  select: [index: number]
  hover: [index: number | null]
}>()

const padding = { top: 30, right: 12, bottom: 48, left: 56 }

/** 固定柱宽与间距 */
const BAR_W = 16
const SERIES_GAP = 2
const GROUP_GAP = 8

const maxValue = computed(() => {
  let max = 0
  for (const s of props.series) {
    for (const v of s.values) {
      if (Number.isFinite(v) && v > max) max = v
    }
  }
  return max > 0 ? max : 1
})

const minValue = computed(() => {
  let min = Number.POSITIVE_INFINITY
  for (const s of props.series) {
    for (const v of s.values) {
      if (Number.isFinite(v) && v < min) min = v
    }
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0
})

// Y 轴从数据最小值附近起算，放大各分配之间的差异
const axisLo = computed(() => {
  const max = maxValue.value
  const min = minValue.value
  const span = max - min
  if (span <= 0 || span / max > 0.6) return 0
  return Math.max(0, min - span * 0.25)
})

const axisHi = computed(() => {
  const max = maxValue.value
  const span = max - axisLo.value
  return max + span * 0.05
})

const containerEl = ref<HTMLElement | null>(null)
const containerWidth = ref(640)
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (!containerEl.value) return
  containerWidth.value = containerEl.value.clientWidth || 640
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

const seriesN = computed(() => Math.max(props.series.length, 1))

/** 每组占用的横向宽度（固定） */
const groupPitch = computed(
  () => seriesN.value * BAR_W + (seriesN.value - 1) * SERIES_GAP + GROUP_GAP,
)

const contentWidth = computed(
  () => padding.left + padding.right + props.labels.length * groupPitch.value,
)

const width = computed(() => Math.max(320, containerWidth.value, contentWidth.value))

const plotH = computed(() => props.height - padding.top - padding.bottom)

function xGroup(i: number) {
  return padding.left + i * groupPitch.value + groupPitch.value / 2
}

function barX(groupIndex: number, seriesIndex: number) {
  const total = seriesN.value * BAR_W + (seriesN.value - 1) * SERIES_GAP
  return xGroup(groupIndex) - total / 2 + seriesIndex * (BAR_W + SERIES_GAP)
}

function normValue(value: number) {
  const lo = axisLo.value
  const hi = axisHi.value
  const range = hi - lo > 0 ? hi - lo : 1
  return Math.max(0, Math.min(1, (value - lo) / range))
}

function barY(value: number) {
  return padding.top + plotH.value * (1 - normValue(value))
}

function barHeight(value: number) {
  return plotH.value * normValue(value)
}

function formatAxis(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(Math.round(v))
}

function formatValue(v: number) {
  return Math.round(v).toLocaleString('en-US')
}

const yTicks = computed(() => {
  const lo = axisLo.value
  const hi = axisHi.value
  return [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    value: lo + (hi - lo) * t,
    y: padding.top + plotH.value * (1 - t),
  }))
})

// X 轴标签过密时抽样显示，避免重叠
const labelStep = computed(() => {
  if (groupPitch.value >= 34) return 1
  return Math.ceil(34 / groupPitch.value)
})

function showLabel(i: number) {
  return i % labelStep.value === 0 || i === props.labels.length - 1
}

const localHover = ref<number | null>(null)

/** 外部传入的悬停索引优先（多图联动），否则用本地悬停 */
const activeHover = computed(() =>
  props.hoverIndex !== undefined ? props.hoverIndex : localHover.value,
)

function onHover(index: number | null) {
  localHover.value = index
  emit('hover', index)
}

/** 各系列的最大值，用于计算与最高伤害的差距百分比 */
const seriesMax = computed(() =>
  props.series.map((s) => {
    let max = 0
    for (const v of s.values) {
      if (Number.isFinite(v) && v > max) max = v
    }
    return max
  }),
)

function diffFromMaxText(seriesIndex: number, value: number) {
  const max = seriesMax.value[seriesIndex] ?? 0
  if (max <= 0) return ''
  const diff = ((value - max) / max) * 100
  if (Math.abs(diff) < 0.0005) return '（最高）'
  return `（${diff.toFixed(2)}%）`
}

function isSeriesMax(seriesIndex: number, value: number) {
  const max = seriesMax.value[seriesIndex] ?? 0
  return max > 0 && Math.abs(value - max) <= Math.max(0.0001, max * 1e-9)
}

const tipStyle = computed(() => {
  if (activeHover.value == null) return {}
  const i = activeHover.value
  let topY = padding.top + plotH.value
  for (const s of props.series) {
    const y = barY(s.values[i] ?? 0)
    if (y < topY) topY = y
  }
  const x = Math.max(90, Math.min(width.value - 90, xGroup(i)))
  const estTipH = 32 + props.series.length * 18
  // 上方空间不够时放到柱体顶部下方，避免被容器裁剪
  if (topY - estTipH - 8 < 0) {
    return {
      left: `${x}px`,
      top: `${topY + 10}px`,
      transform: 'translate(-50%, 0)',
    }
  }
  return {
    left: `${x}px`,
    top: `${topY - 8}px`,
    transform: 'translate(-50%, -100%)',
  }
})
</script>

<template>
  <div ref="containerEl" class="opt-bar-chart">
    <div class="opt-bar-chart__inner" :style="{ width: `${width}px` }">
      <svg
        class="opt-bar-chart__svg"
        :width="width"
        :height="height"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        aria-label="期望伤害柱状图"
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
          {{ formatAxis(tick.value) }}
        </text>

        <template v-for="(label, i) in labels" :key="`g-${i}`">
          <g
            class="bar-group"
            :class="{ selected: selectedIndex === i, hovered: activeHover === i }"
            @click="emit('select', i)"
            @mouseenter="onHover(i)"
            @mouseleave="onHover(null)"
          >
            <rect
              class="hit"
              :x="xGroup(i) - groupPitch / 2"
              :y="padding.top"
              :width="groupPitch"
              :height="plotH"
            />
            <rect
              v-for="(s, si) in series"
              :key="s.key"
              class="bar"
              :x="barX(i, si)"
              :y="barY(s.values[i] ?? 0)"
              :width="BAR_W"
              :height="barHeight(s.values[i] ?? 0)"
              :fill="s.color"
              rx="2"
            />
            <text
              v-for="(s, si) in series"
              v-show="isSeriesMax(si, s.values[i] ?? 0)"
              :key="`max-${s.key}`"
              :x="barX(i, si) + BAR_W / 2"
              :y="Math.max(12, barY(s.values[i] ?? 0) - 7)"
              class="max-marker"
              text-anchor="middle"
            >
              最高
            </text>
            <text
              v-if="showLabel(i)"
              :x="xGroup(i)"
              :y="height - 10"
              class="x-label"
              text-anchor="middle"
            >
              {{ label }}
            </text>
          </g>
        </template>
      </svg>
      <div v-if="activeHover != null" class="bar-tip" :style="tipStyle">
        <p class="bar-tip__label">{{ labels[activeHover] }}</p>
        <p v-for="(s, si) in series" :key="s.key" class="bar-tip__row">
          <i :style="{ background: s.color }" />
          {{ s.label }}：<strong>{{ formatValue(s.values[activeHover] ?? 0) }}</strong>
          <span class="bar-tip__diff">{{ diffFromMaxText(si, s.values[activeHover] ?? 0) }}</span>
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
.opt-bar-chart {
  width: 100%;
  overflow-x: auto;
}

.opt-bar-chart__inner {
  position: relative;
}

.opt-bar-chart__svg {
  display: block;
}

.grid {
  stroke: rgba(255, 255, 255, 0.06);
  stroke-width: 1;
}

.axis-label,
.x-label {
  fill: #8b93a1;
  font-size: 10px;
}

.x-label {
  font-size: 9px;
}

.max-marker {
  fill: #bfff09;
  font-size: 9px;
  font-weight: 800;
  paint-order: stroke;
  stroke: #10141a;
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}

.hit {
  fill: transparent;
  cursor: pointer;
}

.bar {
  cursor: pointer;
  transition: transform 0.12s ease, filter 0.12s ease;
  transform-box: fill-box;
  transform-origin: center bottom;
}

.bar-group:hover .bar,
.bar-group.hovered .bar {
  transform: scaleX(1.25) scaleY(1.03);
  filter: brightness(1.18);
}

.bar-group.selected .bar {
  stroke: #bfff09;
  stroke-width: 1.5;
}

.bar-tip {
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

.bar-tip__label {
  margin: 0 0 0.2rem;
  font-weight: 700;
  color: #e8eaed;
}

.bar-tip__row {
  margin: 0.1rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.bar-tip__row strong {
  color: #bfff09;
}

.bar-tip__diff {
  color: #9aa3b0;
}

.bar-tip__row i {
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
