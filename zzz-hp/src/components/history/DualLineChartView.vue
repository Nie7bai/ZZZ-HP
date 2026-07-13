<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRefs, watch } from 'vue'
import ChartPointBossTooltip from '@/components/history/ChartPointBossTooltip.vue'
import ChartPointRoomBuffTooltip from '@/components/history/ChartPointRoomBuffTooltip.vue'
import {
  fetchCrisisAssaultPhases,
  getChartPointPhaseKey,
  type ChartBossPreview,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { formatExpansion, formatHp } from '@/utils/gameData'

type ChartViewMode = 'detail' | 'overview'

const props = withDefaults(
  defineProps<{
    points: HpChartPoint[]
    hpChartTitle?: string
    expansionChartTitle?: string
    hpAriaLabel?: string
    expansionAriaLabel?: string
    showWhenEmpty?: boolean
    enablePointClick?: boolean
    pointClickHint?: string
    enableBossPreview?: boolean
    enableRoomBuffPreview?: boolean
    bossPreviewMode?: 'crisis' | 'embedded'
    showRemoveModeToggle?: boolean
  }>(),
  {
    hpChartTitle: '总血量折线图',
    expansionChartTitle: '血量相对膨胀折线图',
    hpAriaLabel: '血量折线图',
    expansionAriaLabel: '血量相对膨胀折线图',
    showWhenEmpty: false,
    enablePointClick: true,
    enableBossPreview: true,
    enableRoomBuffPreview: false,
    bossPreviewMode: 'crisis',
    showRemoveModeToggle: false,
  },
)

const removeMode = defineModel<'direct' | 'menu'>('removeMode', { default: 'menu' })

const emit = defineEmits<{
  pointClick: [point: HpChartPoint, index: number, event?: MouseEvent]
}>()

const { points } = toRefs(props)

interface ExpansionPoint extends HpChartPoint {
  expansion: number
}

interface PlottedPoint {
  label: string
  dateRange: string
  dateStart: string
  dateEnd: string
  value: number
  x: number
  y: number
  index: number
}

const containerRef = ref<HTMLElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const hoverIndex = ref<number | null>(null)
const chartHeight = ref(260)
const viewportWidth = ref(960)
const viewMode = ref<ChartViewMode>('detail')
const hideDatesInOverview = ref(true)
const hideBossTooltip = ref(false)
const isDragging = ref(false)
const dragMoved = ref(false)
const dragStartX = ref(0)
const dragScrollLeft = ref(0)
const phaseSearchQuery = ref('')
const phaseSearchHint = ref('')
const bossPreviewByKey = ref<Map<string, ChartBossPreview[]>>(new Map())
const tooltipPosition = ref({ left: '0px', top: '0px', transform: 'translate(-50%, -100%)' })
const showBossTooltip = ref(false)
const showRoomBuffTooltip = ref(false)

const pointSpacing = 168
const minChartWidth = 960
const pointInset = 30
const sectionGap = 10
const OVERVIEW_HOVER_LABEL_LIFT = 16

const isDetailMode = computed(() => viewMode.value === 'detail')
const isOverviewMode = computed(() => viewMode.value === 'overview')
const showDates = computed(() => isDetailMode.value || !hideDatesInOverview.value)
const isChartEmpty = computed(() => points.value.length === 0)
const shouldRenderChart = computed(() => !isChartEmpty.value || props.showWhenEmpty)

const EMPTY_HP_RANGE = { min: 0, max: 1_000_000 }
const EMPTY_EXPANSION_RANGE = { min: 0.5, max: 1.5 }

const chartPadding = computed(() => {
  if (isOverviewMode.value) {
    const bottom = showDates.value
      ? 44 + 12 + OVERVIEW_HOVER_LABEL_LIFT + 22
      : 22 + OVERVIEW_HOVER_LABEL_LIFT + 20
    return { top: 28, right: 28, bottom, left: 88 }
  }
  return { top: 28, right: 28, bottom: 96, left: 88 }
})

const chartWidth = computed(() => {
  const count = points.value.length
  const pad = chartPadding.value

  if (isOverviewMode.value) {
    return Math.max(minChartWidth, viewportWidth.value)
  }

  if (count <= 1) return minChartWidth
  return Math.max(
    minChartWidth,
    pad.left + pad.right + pointInset * 2 + (count - 1) * pointSpacing,
  )
})

const plotWidth = computed(() => chartWidth.value - chartPadding.value.left - chartPadding.value.right)
const plotHeight = computed(() => chartHeight.value - chartPadding.value.top - chartPadding.value.bottom)

const expansionPoints = computed<ExpansionPoint[]>(() =>
  points.value.map((item, index) => ({
    ...item,
    expansion: index === 0 ? 1 : item.totalHp / points.value[index - 1]!.totalHp,
  })),
)

function getPointX(index: number) {
  const count = points.value.length
  const pad = chartPadding.value
  const width = plotWidth.value

  if (count <= 1) return pad.left + width / 2

  if (isOverviewMode.value) {
    const innerWidth = width - pointInset * 2
    return pad.left + pointInset + (innerWidth * index) / (count - 1)
  }

  return pad.left + pointInset + index * pointSpacing
}

function splitDateRange(dateRange: string) {
  const parts = dateRange.split(' - ')
  if (parts.length !== 2) {
    return { start: dateRange, end: '' }
  }
  return { start: parts[0]!, end: parts[1]! }
}

function buildValueRange(values: number[]) {
  if (!values.length) return { min: 0, max: 0 }

  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const span = dataMax - dataMin || Math.abs(dataMax) * 0.1 || 1
  const paddingValue = span * 0.12

  return {
    min: dataMin - paddingValue,
    max: dataMax + paddingValue,
  }
}

function buildYTicks(min: number, max: number) {
  const range = max - min
  if (!range) return []

  const rawStep = range / 4
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = Math.ceil(rawStep / magnitude) * magnitude

  const ticks: number[] = []
  const start = Math.ceil(min / step) * step
  for (let value = start; value <= max; value += step) {
    ticks.push(value)
  }
  if (!ticks.length || ticks[0]! > min) {
    ticks.unshift(Math.floor(min / step) * step)
  }
  if (ticks[ticks.length - 1]! < max) {
    ticks.push(ticks[ticks.length - 1]! + step)
  }

  return ticks.filter((value, index, arr) => index === 0 || value !== arr[index - 1])
}

function buildExpansionYTicks(min: number, max: number) {
  const ticks = buildYTicks(min, max)
  if (min <= 1 && max >= 1 && !ticks.some((tick) => Math.abs(tick - 1) < 1e-6)) {
    ticks.push(1)
    ticks.sort((a, b) => a - b)
  }
  return ticks
}

function isExpansionBaselineTick(tick: number) {
  return Math.abs(tick - 1) < 1e-6
}

function valueToY(value: number, min: number, max: number) {
  const range = max - min
  const pad = chartPadding.value
  if (!range) return pad.top + plotHeight.value / 2
  return pad.top + plotHeight.value - ((value - min) / range) * plotHeight.value
}

const hpRange = computed(() =>
  isChartEmpty.value
    ? EMPTY_HP_RANGE
    : buildValueRange(points.value.map((item) => item.totalHp)),
)
const expansionRange = computed(() =>
  isChartEmpty.value
    ? EMPTY_EXPANSION_RANGE
    : buildValueRange(expansionPoints.value.map((item) => item.expansion)),
)

function plotPoints<T extends { label: string; dateRange: string }>(
  items: T[],
  getValue: (item: T) => number,
  range: { min: number; max: number },
): PlottedPoint[] {
  if (!items.length) return []

  return items.map((item, index) => {
    const { start, end } = splitDateRange(item.dateRange)
    return {
      label: item.label,
      dateRange: item.dateRange,
      dateStart: start,
      dateEnd: end,
      value: getValue(item),
      x: getPointX(index),
      y: valueToY(getValue(item), range.min, range.max),
      index,
    }
  })
}

const hpChartPoints = computed(() =>
  plotPoints(points.value, (item) => item.totalHp, hpRange.value),
)

const expansionChartPoints = computed(() =>
  plotPoints(expansionPoints.value, (item) => item.expansion, expansionRange.value),
)

const hpYTicks = computed(() => buildYTicks(hpRange.value.min, hpRange.value.max))
const expansionYTicks = computed(() =>
  buildExpansionYTicks(expansionRange.value.min, expansionRange.value.max),
)

const expansionBaselineVisible = computed(() => {
  const { min, max } = expansionRange.value
  return min <= 1 && max >= 1
})

const expansionBaselineY = computed(() =>
  valueToY(1, expansionRange.value.min, expansionRange.value.max),
)

const columnZones = computed(() => {
  const pts = hpChartPoints.value
  const count = pts.length
  const pad = chartPadding.value
  if (!count) return []

  return pts.map((point, index) => {
    let x1: number
    let x2: number

    if (count === 1) {
      x1 = pad.left
      x2 = pad.left + plotWidth.value
    } else if (index === 0) {
      x1 = pad.left
      x2 = (point.x + pts[index + 1]!.x) / 2
    } else if (index === count - 1) {
      x1 = (pts[index - 1]!.x + point.x) / 2
      x2 = pad.left + plotWidth.value
    } else {
      x1 = (pts[index - 1]!.x + point.x) / 2
      x2 = (point.x + pts[index + 1]!.x) / 2
    }

    return { index, x1, x2, width: x2 - x1 }
  })
})

const hoveredHpPoint = computed(() =>
  hoverIndex.value === null ? null : hpChartPoints.value[hoverIndex.value] ?? null,
)

const hoveredChartPoint = computed(() =>
  hoverIndex.value === null ? null : points.value[hoverIndex.value] ?? null,
)

const isBossPreviewEnabled = computed(
  () => props.enableBossPreview && !hideBossTooltip.value,
)

const isRoomBuffPreviewEnabled = computed(
  () => props.enableRoomBuffPreview && !hideBossTooltip.value,
)

const isHoverPreviewEnabled = computed(
  () => isBossPreviewEnabled.value || isRoomBuffPreviewEnabled.value,
)

const hoveredBossPreviews = computed(() => {
  const point = hoveredChartPoint.value
  if (!point || !isBossPreviewEnabled.value) return []
  if (point.bosses?.length) return point.bosses
  if (props.bossPreviewMode === 'embedded') return []
  return bossPreviewByKey.value.get(getChartPointPhaseKey(point)) ?? []
})

const hoveredRoomBuff = computed(() => {
  const point = hoveredChartPoint.value
  if (!point || !isRoomBuffPreviewEnabled.value) return null
  return point.roomBuff ?? null
})

const bossTooltipStyle = computed(() => ({
  left: tooltipPosition.value.left,
  top: tooltipPosition.value.top,
  transform: tooltipPosition.value.transform,
}))

const hoveredExpansionPoint = computed(() =>
  hoverIndex.value === null ? null : expansionChartPoints.value[hoverIndex.value] ?? null,
)

function buildLinePath(chartPoints: PlottedPoint[]) {
  if (!chartPoints.length) return ''
  return chartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
}

const hpLinePath = computed(() => buildLinePath(hpChartPoints.value))
const expansionLinePath = computed(() => buildLinePath(expansionChartPoints.value))

function shouldShowPointValue(index: number) {
  if (isDetailMode.value) return true
  return hoverIndex.value === index
}

function setHover(index: number) {
  if (isDragging.value) return
  hoverIndex.value = index
  nextTick(updateBossTooltipPosition)
}

function resolveHoverIndex(clientX: number, clientY: number): number | null {
  if (!scrollRef.value) return null

  const svgList = scrollRef.value.querySelectorAll('svg.hp-chart')
  if (!svgList.length) return null

  for (const svg of svgList) {
    const rect = svg.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    if (clientY < rect.top || clientY > rect.bottom) continue
    if (clientX < rect.left || clientX > rect.right) continue

    const scaleX = chartWidth.value / rect.width
    const svgX = (clientX - rect.left) * scaleX

    for (const zone of columnZones.value) {
      if (svgX >= zone.x1 && svgX <= zone.x2) return zone.index
    }
  }

  return null
}

function onChartsAreaPointerMove(event: PointerEvent) {
  const index = resolveHoverIndex(event.clientX, event.clientY)
  if (index === null) return

  if (hoverIndex.value !== index) hoverIndex.value = index
  updateBossTooltipPosition()
}

function onScrollAreaPointerMove(event: PointerEvent) {
  onPointerMove(event)
  if (!isDragging.value) onChartsAreaPointerMove(event)
}

function isColumnHitTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('.column-hit')
}

function clearHover() {
  hoverIndex.value = null
  showBossTooltip.value = false
  showRoomBuffTooltip.value = false
}

async function loadBossPreviewCache() {
  if (!props.enableBossPreview || hideBossTooltip.value) return
  if (props.bossPreviewMode === 'embedded') return

  try {
    const phases = await fetchCrisisAssaultPhases()
    const map = new Map<string, ChartBossPreview[]>()
    for (const phase of phases) {
      const phaseNum = phase.phase.match(/\d+/)?.[0] ?? '1'
      map.set(
        `${phase.version}-${Number(phaseNum)}`,
        phase.enemies.map((enemy, index) => ({
          room: enemy.label.match(/\d+/)?.[0] ?? String(index + 1),
          bossName: enemy.bossName ?? enemy.subStats ?? '—',
          hp: enemy.hp,
          imageUrl: enemy.imageUrl,
        })),
      )
    }
    bossPreviewByKey.value = map
  } catch {
    bossPreviewByKey.value = new Map()
  }
}

function updateBossTooltipPosition() {
  showBossTooltip.value = false
  showRoomBuffTooltip.value = false

  if (hoverIndex.value === null || isDragging.value) return

  const plotted = hpChartPoints.value[hoverIndex.value]
  if (!plotted || !scrollRef.value) return

  const svg = scrollRef.value.querySelector('svg.hp-chart') as SVGSVGElement | null
  if (!svg) return

  const rect = svg.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  const hasRoomBuff = isRoomBuffPreviewEnabled.value && hoveredRoomBuff.value
  const hasBossPreview = isBossPreviewEnabled.value && hoveredBossPreviews.value.length

  if (!hasRoomBuff && !hasBossPreview) return

  const scaleX = rect.width / chartWidth.value
  const scaleY = rect.height / chartHeight.value
  const anchorX = rect.left + plotted.x * scaleX
  const anchorY = rect.top + plotted.y * scaleY

  const tooltipWidth = hasRoomBuff ? 220 : 188
  const tooltipHeight = hasRoomBuff ? 170 : 150
  const margin = 8
  const clampedX = Math.min(
    window.innerWidth - tooltipWidth / 2 - margin,
    Math.max(tooltipWidth / 2 + margin, anchorX),
  )

  let top = anchorY + 18
  let transform = 'translate(-50%, 0)'

  if (top + tooltipHeight > window.innerHeight - margin) {
    top = anchorY - 14
    transform = 'translate(-50%, -100%)'
  }

  tooltipPosition.value = {
    left: `${clampedX}px`,
    top: `${top}px`,
    transform,
  }

  if (hasRoomBuff) {
    showRoomBuffTooltip.value = true
    return
  }

  showBossTooltip.value = true
}

function onPointClick(index: number, event?: MouseEvent) {
  if (dragMoved.value || !props.enablePointClick) return
  const point = points.value[index]
  if (point) emit('pointClick', point, index, event)
}

function getOverviewLabelLift(index: number) {
  return isOverviewMode.value && hoverIndex.value === index ? OVERVIEW_HOVER_LABEL_LIFT : 0
}

function getVersionLabelY(index: number) {
  return chartPadding.value.top + plotHeight.value + (showDates.value ? 26 : 22) + getOverviewLabelLift(index)
}

function getDateLabelY(index: number) {
  return chartPadding.value.top + plotHeight.value + 44 + getOverviewLabelLift(index)
}

function isActiveOverviewLabel(index: number) {
  return isOverviewMode.value && hoverIndex.value === index
}

function shouldRenderLabelLayer(index: number, layer: 'base' | 'active') {
  const active = isActiveOverviewLabel(index)
  return layer === 'active' ? active : !active
}

function setViewMode(mode: ChartViewMode) {
  viewMode.value = mode
  if (mode === 'overview') hideDatesInOverview.value = true
  if (scrollRef.value) scrollRef.value.scrollLeft = 0
  hoverIndex.value = null
}

function isTypingContext() {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  const tag = active.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return active.isContentEditable
}

function isChartPanelVisible() {
  const el = containerRef.value
  if (!el?.isConnected) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function onChartKeydown(event: KeyboardEvent) {
  if (!isChartPanelVisible() || isTypingContext()) return
  if (event.ctrlKey || event.metaKey || event.altKey) return

  const key = event.key.toLowerCase()
  if (key === 'h' && (props.enableBossPreview || props.enableRoomBuffPreview)) {
    hideBossTooltip.value = !hideBossTooltip.value
    event.preventDefault()
    return
  }

  if (key === 'd' && isOverviewMode.value) {
    hideDatesInOverview.value = !hideDatesInOverview.value
    event.preventDefault()
  }
}

function updateLayoutMetrics() {
  if (scrollRef.value) {
    viewportWidth.value = Math.max(minChartWidth, scrollRef.value.clientWidth)
  }
  if (!containerRef.value) return

  const toolbarHeight = 44
  const hintHeight = isDetailMode.value ? 28 : 0
  const available = containerRef.value.clientHeight - toolbarHeight - hintHeight
  const sectionHeight = (available - sectionGap) / 2
  const minSectionHeight = isOverviewMode.value ? 188 : 160
  const overviewBonus = isOverviewMode.value ? 16 : 0
  chartHeight.value = Math.max(minSectionHeight, sectionHeight + overviewBonus)
}

let resizeObserver: ResizeObserver | null = null

let scrollElement: HTMLElement | null = null

onMounted(() => {
  updateLayoutMetrics()
  loadBossPreviewCache()
  if (!containerRef.value) return
  resizeObserver = new ResizeObserver(() => {
    updateLayoutMetrics()
    updateBossTooltipPosition()
  })
  resizeObserver.observe(containerRef.value)
  if (scrollRef.value) {
    resizeObserver.observe(scrollRef.value)
    scrollElement = scrollRef.value
    scrollElement.addEventListener('scroll', updateBossTooltipPosition, { passive: true })
  }
  window.addEventListener('resize', updateBossTooltipPosition)
  window.addEventListener('keydown', onChartKeydown)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateBossTooltipPosition)
  window.removeEventListener('keydown', onChartKeydown)
  scrollElement?.removeEventListener('scroll', updateBossTooltipPosition)
})

function onPointerDown(event: PointerEvent) {
  if (!isDetailMode.value || !scrollRef.value || event.button !== 0) return
  if (isColumnHitTarget(event.target)) return
  isDragging.value = true
  dragMoved.value = false
  dragStartX.value = event.clientX
  dragScrollLeft.value = scrollRef.value.scrollLeft
  scrollRef.value.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!isDetailMode.value || !isDragging.value || !scrollRef.value) return
  const deltaX = event.clientX - dragStartX.value
  if (Math.abs(deltaX) > 4) dragMoved.value = true
  scrollRef.value.scrollLeft = dragScrollLeft.value - deltaX
}

function onPointerUp(event: PointerEvent) {
  if (!scrollRef.value) return
  isDragging.value = false
  if (scrollRef.value.hasPointerCapture(event.pointerId)) {
    scrollRef.value.releasePointerCapture(event.pointerId)
  }
  window.setTimeout(() => {
    dragMoved.value = false
    updateBossTooltipPosition()
  }, 0)
}

function onWheel(event: WheelEvent) {
  if (!isDetailMode.value || !scrollRef.value) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return
  event.preventDefault()
  scrollRef.value.scrollLeft += delta
}

function findFirstPhaseIndexByVersion(version: string) {
  const normalized = version.trim()
  if (!normalized) return -1
  return points.value.findIndex((point) => point.label.startsWith(`${normalized}第`))
}

function getPhaseScrollLeft(index: number) {
  const pointX = getPointX(index)
  const viewport = scrollRef.value?.clientWidth ?? viewportWidth.value
  return Math.max(0, pointX - viewport / 2)
}

function scrollToPhaseIndex(index: number) {
  if (!scrollRef.value || index < 0) return
  scrollRef.value.scrollTo({
    left: getPhaseScrollLeft(index),
    behavior: 'smooth',
  })
  hoverIndex.value = index
}

function onPhaseSearch() {
  const version = phaseSearchQuery.value.trim()
  if (!version) return

  const index = findFirstPhaseIndexByVersion(version)
  if (index < 0) {
    phaseSearchHint.value = '未找到该版本'
    return
  }

  phaseSearchHint.value = ''

  if (isOverviewMode.value) {
    hoverIndex.value = index
    return
  }

  scrollToPhaseIndex(index)
}

watch(points, () => {
  hoverIndex.value = null
  showBossTooltip.value = false
})

watch(hoverIndex, () => {
  nextTick(updateBossTooltipPosition)
})

watch([chartWidth, chartHeight], () => {
  nextTick(updateBossTooltipPosition)
})

watch(viewMode, () => {
  updateLayoutMetrics()
})

watch(hideDatesInOverview, () => {
  updateLayoutMetrics()
})

watch(hideBossTooltip, (hidden) => {
  if (hidden) {
    showBossTooltip.value = false
    showRoomBuffTooltip.value = false
    return
  }
  loadBossPreviewCache()
  nextTick(updateBossTooltipPosition)
})

watch(phaseSearchQuery, () => {
  if (phaseSearchHint.value) phaseSearchHint.value = ''
})
</script>

<template>
  <div v-if="shouldRenderChart" ref="containerRef" class="charts-panel">
    <div class="chart-toolbar">
      <div class="toolbar-main">
        <div class="mode-toggle" role="group" aria-label="折线图显示模式">
          <button
            type="button"
            class="mode-btn"
            :class="{ active: isDetailMode }"
            @click="setViewMode('detail')"
          >
            详细
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ active: isOverviewMode }"
            @click="setViewMode('overview')"
          >
            总览
          </button>
        </div>
        <form v-if="!isChartEmpty" class="phase-search" @submit.prevent="onPhaseSearch">
          <input
            v-model="phaseSearchQuery"
            type="text"
            class="phase-search-input"
            placeholder="版本 1.4"
            aria-label="按版本定位期数"
            spellcheck="false"
          />
          <button type="submit" class="phase-search-btn">定位</button>
        </form>
        <span v-if="phaseSearchHint" class="phase-search-hint">{{ phaseSearchHint }}</span>
      </div>
      <div class="toolbar-toggles">
        <label v-if="isOverviewMode" class="date-toggle">
          <input v-model="hideDatesInOverview" type="checkbox" />
          <span>隐藏日期 (D)</span>
        </label>
        <div
          v-if="showRemoveModeToggle"
          class="mode-toggle"
          role="group"
          aria-label="移除方式"
        >
          <button
            type="button"
            class="mode-btn mode-btn--compact"
            :class="{ active: removeMode === 'direct' }"
            @click="removeMode = 'direct'"
          >
            点击
          </button>
          <button
            type="button"
            class="mode-btn mode-btn--compact"
            :class="{ active: removeMode === 'menu' }"
            @click="removeMode = 'menu'"
          >
            弹窗
          </button>
        </div>
        <label v-if="enableBossPreview || enableRoomBuffPreview" class="date-toggle">
          <input v-model="hideBossTooltip" type="checkbox" />
          <span>隐藏小窗 (H)</span>
        </label>
      </div>
    </div>

    <div
      ref="scrollRef"
      class="charts-scroll"
      :class="{
        'is-dragging': isDragging,
        'charts-scroll--overview': isOverviewMode,
      }"
      @pointerdown="onPointerDown"
      @pointermove="onScrollAreaPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="clearHover"
      @wheel="onWheel"
    >
      <div class="charts-stack" :class="{ 'charts-stack--overview': isOverviewMode }">
        <section class="chart-section">
          <div class="y-axis-title y-axis-title-hp" aria-hidden="true">{{ hpChartTitle }}</div>
          <div class="chart-wrap">
            <svg
              class="hp-chart"
              :class="{ 'hp-chart--overview': isOverviewMode }"
              :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
              :style="{
                height: `${chartHeight}px`,
                width: isOverviewMode ? '100%' : undefined,
                minWidth: isDetailMode ? `${chartWidth}px` : undefined,
              }"
              role="img"
              :aria-label="hpAriaLabel"
            >
              <line
                :x1="chartPadding.left"
                :y1="chartPadding.top + plotHeight"
                :x2="chartPadding.left + plotWidth"
                :y2="chartPadding.top + plotHeight"
                class="axis-line"
              />
              <line
                :x1="chartPadding.left"
                :y1="chartPadding.top"
                :x2="chartPadding.left"
                :y2="chartPadding.top + plotHeight"
                class="axis-line"
              />

              <g v-for="tick in hpYTicks" :key="`hp-${tick}`">
                <line
                  :x1="chartPadding.left"
                  :y1="valueToY(tick, hpRange.min, hpRange.max)"
                  :x2="chartPadding.left + plotWidth"
                  :y2="valueToY(tick, hpRange.min, hpRange.max)"
                  class="grid-line"
                />
                <text
                  :x="chartPadding.left - 10"
                  :y="valueToY(tick, hpRange.min, hpRange.max) + 4"
                  class="axis-label axis-label-y"
                  text-anchor="end"
                >
                  {{ formatHp(tick) }}
                </text>
              </g>

              <rect
                v-for="zone in columnZones"
                :key="`hp-zone-${zone.index}`"
                :x="zone.x1"
                y="0"
                :width="zone.width"
                :height="chartHeight"
                class="column-hit"
                :class="{ 'column-hit--clickable': enablePointClick }"
                @pointerenter="setHover(zone.index)"
                @pointerdown.stop
                @click="onPointClick(zone.index, $event)"
              />

              <line
                v-if="hoveredHpPoint"
                :x1="hoveredHpPoint.x"
                :y1="chartPadding.top"
                :x2="hoveredHpPoint.x"
                :y2="chartPadding.top + plotHeight"
                class="hover-guide hover-guide-hp"
              />

              <path v-if="hpLinePath" :d="hpLinePath" class="line-path line-path-hp" />

              <g v-for="point in hpChartPoints" :key="point.label" class="point-group">
                <circle
                  :cx="point.x"
                  :cy="point.y"
                  :r="hoverIndex === point.index ? 9 : isOverviewMode ? 4 : 5"
                  class="line-point line-point-hp"
                  :class="{ active: hoverIndex === point.index }"
                />
                <text
                  v-if="shouldShowPointValue(point.index)"
                  :x="point.x"
                  :y="point.y - 16"
                  class="point-value"
                  :class="{ 'point-value-hp-active': hoverIndex === point.index }"
                  text-anchor="middle"
                >
                  {{ formatHp(point.value) }}
                </text>
              </g>

              <g
                v-for="point in hpChartPoints"
                v-show="shouldRenderLabelLayer(point.index, 'base')"
                :key="`${point.label}-label`"
              >
                <text
                  :x="point.x"
                  :y="getVersionLabelY(point.index)"
                  class="axis-label axis-label-x"
                  :class="{
                    'axis-active-hp': hoverIndex === point.index,
                    'axis-label-x--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  {{ point.label }}
                </text>
                <text
                  v-if="showDates"
                  :x="point.x"
                  :y="getDateLabelY(point.index)"
                  class="axis-label axis-date"
                  :class="{
                    'axis-active-hp': hoverIndex === point.index,
                    'axis-date--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  <tspan :x="point.x" dy="0">{{ point.dateStart }}</tspan>
                  <tspan v-if="point.dateEnd" :x="point.x" dy="12">{{ point.dateEnd }}</tspan>
                </text>
              </g>

              <g
                v-for="point in hpChartPoints"
                v-show="shouldRenderLabelLayer(point.index, 'active')"
                :key="`${point.label}-label-active`"
                class="axis-label-layer-active"
              >
                <text
                  :x="point.x"
                  :y="getVersionLabelY(point.index)"
                  class="axis-label axis-label-x axis-label-x--raised"
                  :class="{
                    'axis-active-hp': hoverIndex === point.index,
                    'axis-label-x--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  {{ point.label }}
                </text>
                <text
                  v-if="showDates"
                  :x="point.x"
                  :y="getDateLabelY(point.index)"
                  class="axis-label axis-date axis-date--raised"
                  :class="{
                    'axis-active-hp': hoverIndex === point.index,
                    'axis-date--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  <tspan :x="point.x" dy="0">{{ point.dateStart }}</tspan>
                  <tspan v-if="point.dateEnd" :x="point.x" dy="12">{{ point.dateEnd }}</tspan>
                </text>
              </g>
            </svg>
          </div>
        </section>

        <section class="chart-section">
          <div class="y-axis-title y-axis-title-expansion" aria-hidden="true">
            {{ expansionChartTitle }}
          </div>
          <div class="chart-wrap">
            <svg
              class="hp-chart"
              :class="{ 'hp-chart--overview': isOverviewMode }"
              :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
              :style="{
                height: `${chartHeight}px`,
                width: isOverviewMode ? '100%' : undefined,
                minWidth: isDetailMode ? `${chartWidth}px` : undefined,
              }"
              role="img"
              :aria-label="expansionAriaLabel"
            >
              <line
                :x1="chartPadding.left"
                :y1="chartPadding.top + plotHeight"
                :x2="chartPadding.left + plotWidth"
                :y2="chartPadding.top + plotHeight"
                class="axis-line"
              />
              <line
                :x1="chartPadding.left"
                :y1="chartPadding.top"
                :x2="chartPadding.left"
                :y2="chartPadding.top + plotHeight"
                class="axis-line"
              />

              <g v-for="tick in expansionYTicks" :key="`exp-${tick}`">
                <line
                  :x1="chartPadding.left"
                  :y1="valueToY(tick, expansionRange.min, expansionRange.max)"
                  :x2="chartPadding.left + plotWidth"
                  :y2="valueToY(tick, expansionRange.min, expansionRange.max)"
                  :class="isExpansionBaselineTick(tick) ? 'grid-line grid-line-baseline' : 'grid-line'"
                />
                <text
                  :x="chartPadding.left - 10"
                  :y="valueToY(tick, expansionRange.min, expansionRange.max) + 4"
                  class="axis-label axis-label-y"
                  :class="{ 'axis-label-y-baseline': isExpansionBaselineTick(tick) }"
                  text-anchor="end"
                >
                  {{ formatExpansion(tick) }}
                </text>
              </g>

              <g v-if="expansionBaselineVisible">
                <line
                  :x1="chartPadding.left"
                  :y1="expansionBaselineY"
                  :x2="chartPadding.left + plotWidth"
                  :y2="expansionBaselineY"
                  class="baseline-line"
                />
                <text
                  :x="chartPadding.left + plotWidth + 6"
                  :y="expansionBaselineY + 4"
                  class="baseline-label"
                >
                  基准 1
                </text>
              </g>

              <rect
                v-for="zone in columnZones"
                :key="`exp-zone-${zone.index}`"
                :x="zone.x1"
                y="0"
                :width="zone.width"
                :height="chartHeight"
                class="column-hit"
                :class="{ 'column-hit--clickable': enablePointClick }"
                @pointerenter="setHover(zone.index)"
                @pointerdown.stop
                @click="onPointClick(zone.index, $event)"
              />

              <line
                v-if="hoveredExpansionPoint"
                :x1="hoveredExpansionPoint.x"
                :y1="chartPadding.top"
                :x2="hoveredExpansionPoint.x"
                :y2="chartPadding.top + plotHeight"
                class="hover-guide hover-guide-expansion"
              />

              <path
                v-if="expansionLinePath"
                :d="expansionLinePath"
                class="line-path line-path-expansion"
              />

              <g v-for="point in expansionChartPoints" :key="point.label" class="point-group">
                <circle
                  :cx="point.x"
                  :cy="point.y"
                  :r="hoverIndex === point.index ? 9 : isOverviewMode ? 4 : 5"
                  class="line-point line-point-expansion"
                  :class="{ active: hoverIndex === point.index }"
                />
                <text
                  v-if="shouldShowPointValue(point.index)"
                  :x="point.x"
                  :y="point.y - 16"
                  class="point-value"
                  :class="{ 'point-value-expansion-active': hoverIndex === point.index }"
                  text-anchor="middle"
                >
                  {{ formatExpansion(point.value) }}
                </text>
              </g>

              <g
                v-for="point in expansionChartPoints"
                v-show="shouldRenderLabelLayer(point.index, 'base')"
                :key="`${point.label}-exp-label`"
              >
                <text
                  :x="point.x"
                  :y="getVersionLabelY(point.index)"
                  class="axis-label axis-label-x"
                  :class="{
                    'axis-active-expansion': hoverIndex === point.index,
                    'axis-label-x--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  {{ point.label }}
                </text>
                <text
                  v-if="showDates"
                  :x="point.x"
                  :y="getDateLabelY(point.index)"
                  class="axis-label axis-date"
                  :class="{
                    'axis-active-expansion': hoverIndex === point.index,
                    'axis-date--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  <tspan :x="point.x" dy="0">{{ point.dateStart }}</tspan>
                  <tspan v-if="point.dateEnd" :x="point.x" dy="12">{{ point.dateEnd }}</tspan>
                </text>
              </g>

              <g
                v-for="point in expansionChartPoints"
                v-show="shouldRenderLabelLayer(point.index, 'active')"
                :key="`${point.label}-exp-label-active`"
                class="axis-label-layer-active"
              >
                <text
                  :x="point.x"
                  :y="getVersionLabelY(point.index)"
                  class="axis-label axis-label-x axis-label-x--raised"
                  :class="{
                    'axis-active-expansion': hoverIndex === point.index,
                    'axis-label-x--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  {{ point.label }}
                </text>
                <text
                  v-if="showDates"
                  :x="point.x"
                  :y="getDateLabelY(point.index)"
                  class="axis-label axis-date axis-date--raised"
                  :class="{
                    'axis-active-expansion': hoverIndex === point.index,
                    'axis-date--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  <tspan :x="point.x" dy="0">{{ point.dateStart }}</tspan>
                  <tspan v-if="point.dateEnd" :x="point.x" dy="12">{{ point.dateEnd }}</tspan>
                </text>
              </g>
            </svg>
          </div>
        </section>
      </div>
    </div>

    <p v-if="isDetailMode" class="scroll-hint">
      详细模式：按住图表拖拽，或使用滚轮横向浏览；<template v-if="isHoverPreviewEnabled"
        >悬停数据点预览详情，</template
      ><template v-if="pointClickHint">{{ pointClickHint }}</template
      ><template v-else-if="enablePointClick">点击打开往期详细</template
      ><template v-if="isHoverPreviewEnabled">；按 H 隐藏小窗</template
      ><template v-else-if="showRemoveModeToggle">；点击数据点可移除期数</template>
    </p>
    <p v-else-if="enablePointClick && !isChartEmpty" class="scroll-hint">
      {{ isHoverPreviewEnabled ? '悬停数据点预览详情，' : '' }}{{ pointClickHint ?? '点击打开往期详细' }}<template
        v-if="isHoverPreviewEnabled"
        >；按 H 隐藏小窗</template
      ><template v-if="isOverviewMode">；按 D 隐藏日期</template>
    </p>
    <p v-else-if="isHoverPreviewEnabled && !isChartEmpty" class="scroll-hint">
      悬停数据点预览详情；按 H 隐藏小窗<template v-if="isOverviewMode">，按 D 隐藏日期</template>
    </p>

    <ChartPointRoomBuffTooltip
      :visible="showRoomBuffTooltip && isRoomBuffPreviewEnabled"
      :phase-label="hoveredChartPoint?.label ?? ''"
      :room-buff="hoveredRoomBuff"
      :position-style="bossTooltipStyle"
    />

    <ChartPointBossTooltip
      :visible="showBossTooltip && isBossPreviewEnabled"
      :phase-label="hoveredChartPoint?.label ?? ''"
      :bosses="hoveredBossPreviews"
      :position-style="bossTooltipStyle"
    />
  </div>
</template>

<style scoped>
.charts-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-background-soft);
  overflow: hidden;
  position: relative;
  isolation: isolate;
}

.chart-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.toolbar-main {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
  flex-wrap: wrap;
}

.phase-search {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.phase-search-input {
  width: 6.5rem;
  padding: 0.32rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.82rem;
  outline: none;
  transition: border-color 0.2s;
}

.phase-search-input:focus {
  border-color: #e8a838;
}

.phase-search-btn {
  padding: 0.32rem 0.65rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-heading);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.phase-search-btn:hover {
  border-color: #e8a838;
  background: var(--color-background-mute);
}

.phase-search-hint {
  font-size: 0.76rem;
  color: #e85d4c;
  white-space: nowrap;
}

.mode-toggle {
  display: inline-flex;
  padding: 0.15rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
}

.mode-btn {
  min-width: 4.5rem;
  padding: 0.35rem 0.85rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.mode-btn:hover {
  background: var(--color-background-mute);
}

.mode-btn.active {
  background: var(--color-background-soft);
  color: var(--color-heading);
  box-shadow: inset 0 0 0 1px var(--color-border);
}

.mode-btn--compact {
  min-width: 3.1rem;
  padding-inline: 0.65rem;
}

.toolbar-toggles {
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  flex-shrink: 0;
}

.date-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  color: var(--color-text);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.date-toggle input {
  accent-color: #e85d4c;
}

.charts-scroll {
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  cursor: grab;
  touch-action: pan-x;
  scrollbar-width: none;
}

.charts-scroll--overview {
  overflow-x: hidden;
  cursor: default;
  touch-action: auto;
}

.charts-scroll::-webkit-scrollbar {
  display: none;
}

.charts-scroll.is-dragging {
  cursor: grabbing;
  user-select: none;
}

.charts-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: max-content;
  min-width: 100%;
  height: 100%;
  min-height: 100%;
  padding: 0.5rem 0.35rem;
  box-sizing: border-box;
}

.charts-stack--overview {
  width: 100%;
}

.chart-section {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
}

.y-axis-title {
  flex-shrink: 0;
  width: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.35;
  border-right: 1px solid var(--color-border);
  padding: 0.35rem 0.15rem;
  box-sizing: border-box;
}

.y-axis-title-hp {
  color: #e85d4c;
}

.y-axis-title-expansion {
  color: #5b9bd5;
}

.chart-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.hp-chart {
  display: block;
  height: 100%;
}

.hp-chart--overview {
  width: 100%;
}

.scroll-hint {
  flex-shrink: 0;
  margin: 0;
  padding: 0.35rem 0.75rem 0.55rem;
  font-size: 0.72rem;
  text-align: center;
  color: var(--color-text);
  opacity: 0.55;
}

.axis-line {
  stroke: var(--color-border-hover);
  stroke-width: 1.5;
}

.grid-line {
  stroke: var(--color-border);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.grid-line-baseline {
  stroke: #5b9bd5;
  stroke-width: 1.5;
  stroke-dasharray: none;
  opacity: 0.45;
}

.baseline-line {
  stroke: #5b9bd5;
  stroke-width: 2;
  stroke-dasharray: 8 5;
  opacity: 0.9;
  pointer-events: none;
}

.baseline-label {
  fill: #5b9bd5;
  font-size: 10px;
  font-weight: 700;
  pointer-events: none;
}

.axis-label-y-baseline {
  fill: #5b9bd5;
  font-weight: 700;
  opacity: 1;
}

.column-hit {
  fill: transparent;
  cursor: inherit;
}

.column-hit--clickable {
  cursor: pointer;
}

.hover-guide {
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
  opacity: 0.85;
  pointer-events: none;
}

.hover-guide-hp {
  stroke: #e85d4c;
}

.hover-guide-expansion {
  stroke: #5b9bd5;
}

.line-path {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}

.line-path-hp {
  stroke: #e85d4c;
}

.line-path-expansion {
  stroke: #5b9bd5;
}

.point-group {
  pointer-events: none;
}

.line-point {
  stroke: var(--color-background);
  stroke-width: 2;
}

.line-point-hp {
  fill: #e85d4c;
}

.line-point-expansion {
  fill: #5b9bd5;
}

.line-point.active {
  stroke: #fff3e8;
  stroke-width: 3;
}

.line-point-hp.active {
  filter: drop-shadow(0 0 6px rgba(232, 93, 76, 0.55));
}

.line-point-expansion.active {
  filter: drop-shadow(0 0 6px rgba(91, 155, 213, 0.55));
}

.point-value {
  fill: var(--color-heading);
  font-size: 11px;
  font-weight: 600;
  opacity: 0.85;
  pointer-events: none;
}

.point-value-hp-active {
  fill: #e85d4c;
  font-size: 14px;
  font-weight: 700;
  opacity: 1;
}

.point-value-expansion-active {
  fill: #5b9bd5;
  font-size: 14px;
  font-weight: 700;
  opacity: 1;
}

.axis-label {
  fill: var(--color-heading);
  font-size: 12px;
  pointer-events: none;
}

.axis-label-y {
  font-size: 11px;
  opacity: 0.8;
}

.axis-label-x {
  font-size: 12px;
  font-weight: 600;
}

.axis-label-x--compact {
  font-size: 9px;
  font-weight: 600;
}

.axis-active-hp {
  fill: #e85d4c;
  font-size: 13px;
}

.axis-active-expansion {
  fill: #5b9bd5;
  font-size: 13px;
}

.axis-date {
  font-size: 10px;
  opacity: 0.65;
}

.axis-date--compact {
  font-size: 8px;
}

.axis-date.axis-active-hp,
.axis-date.axis-active-expansion {
  opacity: 1;
  font-size: 11px;
  font-weight: 600;
}

.axis-label-layer-active {
  pointer-events: none;
}

.axis-label-x--raised,
.axis-date--raised {
  paint-order: stroke fill;
  stroke: var(--color-background-soft);
  stroke-width: 4px;
  stroke-linejoin: round;
}
</style>
