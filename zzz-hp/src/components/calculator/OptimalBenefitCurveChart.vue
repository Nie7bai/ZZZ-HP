<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { BenefitCurveSeries } from '@/utils/optimalAffixAlloc'

const props = withDefaults(
  defineProps<{
    series: BenefitCurveSeries[]
    mode: 'cumulative' | 'marginal'
    maxAdded?: number
    height?: number
    /** 框选模式（2026-09-18）：true 时关掉悬停十字线，改为拖拽选区缩放 */
    selectMode?: boolean
  }>(),
  { maxAdded: 10, height: 240, selectMode: false },
)

const padding = { top: 16, right: 16, bottom: 32, left: 48 }

/**
 * 图例开关（2026-09-18 用户要求「点击下面的点，可以让线条消失」）：
 * 点图例项切换该系列的显示；只影响渲染，不影响数据。
 */
const hiddenKeys = ref<Set<string>>(new Set())
function toggleSeries(key: string) {
  const next = new Set(hiddenKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  hiddenKeys.value = next
}
const isHidden = (key: string) => hiddenKeys.value.has(key)

/**
 * 框选缩放（2026-09-18 用户要求「我要看 17-30 这一段，这样一拉」）。
 *
 * 交互由**模式开关**区分（用户方案，比"移动 >4px 才算拖动"的阈值猜法确定）：
 * - `selectMode = false`（默认）：悬停十字线 + 提示，保持原行为；
 * - `selectMode = true`：悬停十字线关闭；在绘图区**按住拖出选区** → 松手把 X 轴缩到那一段；**双击复位**。
 */
const viewFrom = ref(1)
const viewTo = ref(0) // 0 = 还没初始化，跟 maxAdded 走
const viewRange = computed(() => {
  const to = viewTo.value || props.maxAdded
  const from = Math.max(1, Math.min(viewFrom.value, to))
  return { from, to }
})
const dragging = ref(false)
const dragStartX = ref(0)
const dragCurrentX = ref(0)
const hasSelection = computed(() => dragging.value && Math.abs(dragCurrentX.value - dragStartX.value) > 4)

/** 选区半透明矩形的样式（相对 `.opt-line-chart__inner`，所以要加回 padding.left） */
const selectRectStyle = computed(() => {
  const left = Math.min(dragStartX.value, dragCurrentX.value) + padding.left
  const w = Math.abs(dragCurrentX.value - dragStartX.value)
  return {
    left: `${left}px`,
    width: `${w}px`,
    top: `${padding.top}px`,
    height: `${plotH.value}px`,
  }
})

/** 事件坐标 → 绘图区内的像素 x（以绘图区左边缘为 0） */
function plotXOf(event: PointerEvent): number {
  const rect = containerEl.value?.getBoundingClientRect()
  if (!rect) return 0
  return Math.max(0, Math.min(plotW.value, event.clientX - rect.left - padding.left))
}
/** 绘图区像素 x → 档位（1..maxAdded） */
function rollAtX(x: number): number {
  const { from, to } = viewRange.value
  const span = to - from + 1
  const n = from + Math.round((x / Math.max(1, plotW.value)) * span - 0.5)
  return Math.max(1, Math.min(props.maxAdded, n))
}
function onSelectPointerDown(event: PointerEvent) {
  if (!props.selectMode) return
  dragging.value = true
  dragStartX.value = plotXOf(event)
  dragCurrentX.value = dragStartX.value
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}
function onSelectPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  dragCurrentX.value = plotXOf(event)
}
function onSelectPointerUp() {
  if (!dragging.value) return
  const wasSelection = hasSelection.value
  const x1 = dragStartX.value
  const x2 = dragCurrentX.value
  dragging.value = false
  if (!wasSelection) return
  const a = rollAtX(Math.min(x1, x2))
  const b = rollAtX(Math.max(x1, x2))
  if (b - a >= 1) {
    viewFrom.value = a
    viewTo.value = b
  }
}
function resetView() {
  viewFrom.value = 1
  viewTo.value = 0
}

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
  const { from, to } = viewRange.value
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
})

const maxY = computed(() => {
  let max = 0
  const { from, to } = viewRange.value
  for (const s of props.series) {
    const arr = props.mode === 'cumulative' ? s.cumulativePercent : s.marginalPercent
    for (let i = from; i <= to; i += 1) {
      const v = arr[i] ?? 0
      if (v > max) max = v
    }
  }
  return max > 0 ? max * 1.08 : 1
})

function xPos(n: number) {
  const { from, to } = viewRange.value
  return padding.left + ((n - from + 0.5) / (to - from + 1)) * plotW.value
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
    .map((s) => {
      const cumulative = s.cumulativePercent[n] ?? 0
      const marginal = s.marginalPercent[n] ?? 0
      const capped = Boolean(s.cappedAt?.[n])
      const primary =
        props.mode === 'cumulative' ? cumulative : marginal
      return {
        key: s.key,
        label: s.label,
        color: s.color,
        value: primary,
        marginal,
        capped,
      }
    })
    .sort((a, b) => b.value - a.value)
})

function formatTipPrimary(row: { value: number; marginal: number; capped: boolean }) {
  const sign = row.value >= 0 ? '+' : ''
  const main = `${sign}${row.value.toFixed(3)}%`
  if (props.mode !== 'cumulative') {
    return row.capped ? `${main}（已达上限）` : main
  }
  if (row.capped) return `${main}（已达上限）`
  const mSign = row.marginal >= 0 ? '+' : ''
  return `${main}（${mSign}${row.marginal.toFixed(3)}%）`
}
</script>

<template>
  <div ref="containerEl" class="opt-line-chart">
    <div
      class="opt-line-chart__inner"
      :class="{ 'opt-line-chart__inner--select': selectMode }"
      :style="{ width: `${width}px`, position: 'relative' }"
      @pointerdown="onSelectPointerDown"
      @pointermove="onSelectPointerMove"
      @pointerup="onSelectPointerUp"
      @pointercancel="onSelectPointerUp"
      @dblclick="resetView"
    >
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
        v-show="!isHidden(s.key)"
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
          v-show="!isHidden(s.key)"
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
    <div v-if="hasSelection" class="select-rect" :style="selectRectStyle" />
    <div v-if="hoverN != null && !selectMode" class="line-tip" :style="tipStyle">
      <p class="line-tip__label">新增 {{ hoverN }} 词条</p>
      <p v-for="row in hoverTipRows" :key="row.key" class="line-tip__row">
        <i :style="{ background: row.color }" />
        {{ row.label }}：<strong>{{ formatTipPrimary(row) }}</strong>
      </p>
    </div>
    </div>
    <div class="legend">
      <button
        v-for="s in series"
        :key="s.key"
        type="button"
        class="legend-item"
        :class="{ 'legend-item--off': isHidden(s.key) }"
        :title="isHidden(s.key) ? `点击显示「${s.label}」` : `点击隐藏「${s.label}」`"
        @click="toggleSeries(s.key)"
      >
        <i :style="{ background: s.color }" />
        {{ s.label }}
      </button>
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
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

/* 图例关掉的系列：灰化 + 色点变空心（点一下再显示回来） */
.legend-item--off {
  opacity: 0.45;
}

.legend-item--off i {
  box-shadow: inset 0 0 0 1px currentColor;
  background: transparent !important;
}

.legend-item i {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}
/* 框选模式（2026-09-18）：光标改十字；拖拽时的选区矩形 */
.opt-line-chart__inner--select {
  cursor: crosshair;
}

.select-rect {
  position: absolute;
  pointer-events: none;
  background: rgba(110, 182, 255, 0.16);
  border-left: 1px solid rgba(110, 182, 255, 0.7);
  border-right: 1px solid rgba(110, 182, 255, 0.7);
}

</style>
