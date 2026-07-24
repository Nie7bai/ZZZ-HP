<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRefs, watch } from 'vue'
import { storeToRefs } from 'pinia'
import ChartPointRoomBuffTooltip from '@/components/history/ChartPointRoomBuffTooltip.vue'
import ChartPointSeriesTooltip, {
  type ChartSeriesTooltipRow,
} from '@/components/history/ChartPointSeriesTooltip.vue'
import {
  getChartPointPhaseKey,
  type CrisisHpChartMode,
  type HpChartPoint,
} from '@/api/crisisAssault'
import { getScoreMarkers, scaleHpByRatio, type CrisisScoreMarker } from '@/data/crisisScoreHpTable'
import { useChartViewSyncStore, type ChartViewMode } from '@/stores/chartViewSync'
import { formatExpansion, formatHp, formatHpDelta } from '@/utils/gameData'

/** ratio：相对倍率；delta：数值差（本期 − 上期） */
type ExpansionMode = 'ratio' | 'delta'

const COEFF_LINE_COLOR = '#9b6bff'
const COEFF_CHART_TITLE = '血量系数'
const COEFF_EXPANSION_CHART_TITLE = '血量系数增长'

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
    /** 上图数值格式：血量或整数百分比 */
    valueFormat?: 'hp' | 'percent'
    /** 下图：倍率或数值增长 */
    expansionMode?: ExpansionMode
    /** 显示「953防御换算」勾选（按 T 切换） */
    enableHpConverted953Toggle?: boolean
    /** 显示正常/困难切换（样式同详细/总览，位于其左侧） */
    showHpModeToggle?: boolean
    /** 联动组：同组折线图同步详细/总览期数聚焦与横向滚动 */
    syncGroup?: string
    /** 危局：在总血量图叠加分数线，并在下方单独绘制分数线膨胀图 */
    enableScoreHpOverlays?: boolean
    /** 危局：有血量系数时额外绘制系数折线与系数膨胀图 */
    enableHpCoeffCharts?: boolean
    /** 去掉外框边线 */
    borderless?: boolean
  }>(),
  {
    hpChartTitle: '血量折线图',
    expansionChartTitle: '血量相对膨胀折线图',
    hpAriaLabel: '血量折线图',
    expansionAriaLabel: '血量相对膨胀折线图',
    showWhenEmpty: false,
    enablePointClick: true,
    enableBossPreview: true,
    enableRoomBuffPreview: false,
    bossPreviewMode: 'crisis',
    showRemoveModeToggle: false,
    valueFormat: 'hp',
    expansionMode: 'ratio',
    enableHpConverted953Toggle: false,
    showHpModeToggle: false,
    syncGroup: undefined,
    enableScoreHpOverlays: false,
    enableHpCoeffCharts: false,
    borderless: false,
  },
)

const removeMode = defineModel<'direct' | 'menu'>('removeMode', { default: 'menu' })
const hpMode = defineModel<CrisisHpChartMode>('hpMode', { default: 'normal' })

const emit = defineEmits<{
  pointClick: [point: HpChartPoint, index: number, event?: MouseEvent]
}>()

const { points } = toRefs(props)

const chartSync = useChartViewSyncStore()
const { viewMode, hideDatesInOverview, linkedFocus } = storeToRefs(chartSync)
const instanceId = `dlc-${Math.random().toString(36).slice(2, 10)}`
let applyingRemoteFocus = false
let scrollSyncRaf = 0
let lastBroadcastPhaseKey: string | null | undefined = undefined

function formatPrimaryValue(value: number) {
  if (props.valueFormat === 'percent') return `${Math.round(value)}%`
  return formatHp(value)
}

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
const hoverChartId = ref<string | null>(null)
const chartHeight = ref(260)
const viewportWidth = ref(960)
const hideBossTooltip = ref(false)
const useConverted953 = ref(false)
/** 各折线图显示开关；缺省视为显示 */
const visibleSections = ref<Record<string, boolean>>({})
const isDragging = ref(false)
const dragMoved = ref(false)
const dragStartX = ref(0)
const dragScrollLeft = ref(0)
const phaseSearchQuery = ref('')
const phaseSearchHint = ref('')
const tooltipPosition = ref({ left: '0px', top: '0px', transform: 'translate(-50%, -100%)' })
const showSeriesTooltip = ref(false)
const showRoomBuffTooltip = ref(false)

const pointSpacingBase = 168
const minChartWidthBase = 960
const pointSpacingMobile = 118
const minChartWidthMobile = 560
const isNarrowViewport = ref(false)
const pointSpacing = computed(() =>
  isNarrowViewport.value ? pointSpacingMobile : pointSpacingBase,
)
const minChartWidth = computed(() =>
  isNarrowViewport.value ? minChartWidthMobile : minChartWidthBase,
)
const pointInset = 30
const sectionGap = 10
const OVERVIEW_HOVER_LABEL_LIFT = 16

function syncNarrowViewport() {
  isNarrowViewport.value = window.matchMedia('(max-width: 768px)').matches
}

const isDetailMode = computed(() => viewMode.value === 'detail')
const isOverviewMode = computed(() => viewMode.value === 'overview')
const showDates = computed(() => isDetailMode.value || !hideDatesInOverview.value)
const isChartEmpty = computed(() => points.value.length === 0)
const shouldRenderChart = computed(() => !isChartEmpty.value || props.showWhenEmpty)

const chartSourcePoints = computed<HpChartPoint[]>(() => {
  if (!props.enableHpConverted953Toggle || !useConverted953.value) return points.value
  return points.value.map((point) => ({
    ...point,
    totalHp: point.totalHpConverted953 ?? point.totalHp,
  }))
})

const displayHpChartTitle = computed(() => {
  if (!props.enableHpConverted953Toggle || !useConverted953.value) return props.hpChartTitle
  if (props.hpChartTitle.includes('953')) return props.hpChartTitle
  if (props.hpChartTitle.includes('总血量')) {
    return props.hpChartTitle.replace('总血量', '953防御换算总血量')
  }
  return props.hpChartTitle.replace('血量', '953防御换算血量')
})

const displayExpansionChartTitle = computed(() => {
  if (!props.enableHpConverted953Toggle || !useConverted953.value) {
    return props.expansionChartTitle
  }
  if (props.expansionChartTitle.includes('953')) return props.expansionChartTitle
  return props.expansionChartTitle.replace('血量相对膨胀', '953防御换算血量相对膨胀')
})

const displayHpAriaLabel = computed(() => {
  if (!props.enableHpConverted953Toggle || !useConverted953.value) return props.hpAriaLabel
  if (props.hpAriaLabel.includes('953')) return props.hpAriaLabel
  if (props.hpAriaLabel.includes('总血量')) {
    return props.hpAriaLabel.replace('总血量', '953换算总血量')
  }
  return props.hpAriaLabel.replace('血量', '953换算血量')
})

const displayExpansionAriaLabel = computed(() => {
  if (!props.enableHpConverted953Toggle || !useConverted953.value) {
    return props.expansionAriaLabel
  }
  if (props.expansionAriaLabel.includes('953')) return props.expansionAriaLabel
  return props.expansionAriaLabel.replace('血量相对膨胀', '953换算血量相对膨胀')
})

const EMPTY_HP_RANGE = { min: 0, max: 1_000_000 }
const EMPTY_EXPANSION_RANGE_RATIO = { min: 0.5, max: 1.5 }
const EMPTY_EXPANSION_RANGE_DELTA = { min: -1, max: 1 }

const isExpansionDelta = computed(() => props.expansionMode === 'delta')
const expansionBaselineValue = computed(() => (isExpansionDelta.value ? 0 : 1))

const chartPadding = computed(() => {
  const left = isNarrowViewport.value ? 52 : 88
  const right = isNarrowViewport.value ? 16 : 28
  if (isOverviewMode.value) {
    const bottom = showDates.value
      ? 52 + 12 + OVERVIEW_HOVER_LABEL_LIFT + 16
      : 30 + OVERVIEW_HOVER_LABEL_LIFT + 14
    return { top: 20, right, bottom, left }
  }
  // 详细模式：为期数 + 两行日期预留下方空间，避免贴底被裁切
  return { top: 20, right, bottom: isNarrowViewport.value ? 96 : 108, left }
})

const chartWidth = computed(() => {
  const count = chartSourcePoints.value.length
  const pad = chartPadding.value

  if (isOverviewMode.value) {
    return Math.max(minChartWidth.value, viewportWidth.value)
  }

  if (count <= 1) return minChartWidth.value
  return Math.max(
    minChartWidth.value,
    pad.left + pad.right + pointInset * 2 + (count - 1) * pointSpacing.value,
  )
})

const plotWidth = computed(() => chartWidth.value - chartPadding.value.left - chartPadding.value.right)
const plotHeight = computed(() => chartHeight.value - chartPadding.value.top - chartPadding.value.bottom)

const expansionPoints = computed<ExpansionPoint[]>(() =>
  chartSourcePoints.value.map((item, index) => {
    if (index === 0) {
      return { ...item, expansion: isExpansionDelta.value ? 0 : 1 }
    }
    const previous = chartSourcePoints.value[index - 1]!.totalHp
    const expansion = isExpansionDelta.value
      ? item.totalHp - previous
      : previous
        ? item.totalHp / previous
        : 1
    return { ...item, expansion }
  }),
)

const scoreMarkers = computed<CrisisScoreMarker[]>(() => {
  if (!props.enableScoreHpOverlays || props.valueFormat !== 'hp') return []
  return getScoreMarkers(hpMode.value === 'hard' ? 'hard' : 'normal')
})

function isSectionVisible(id: string) {
  const explicit = visibleSections.value[id]
  if (explicit !== undefined) return explicit !== false
  // 默认不显示正常模式的 1.5万 / FS-HP 相对膨胀
  if (id.startsWith('score-exp-')) {
    const markerId = id.slice('score-exp-'.length)
    const marker = scoreMarkers.value.find((item) => item.id === markerId)
    if (marker && (marker.shortLabel === '均1.5w' || marker.shortLabel === '均2w')) {
      return false
    }
  }
  return true
}

function setSectionVisible(id: string, visible: boolean) {
  // 至少保留一张图，避免整页空白
  if (!visible) {
    const remaining = chartSectionCount.value - (isSectionVisible(id) ? 1 : 0)
    if (remaining < 1) return
  }
  visibleSections.value = { ...visibleSections.value, [id]: visible }
  nextTick(updateLayoutMetrics)
}

function onVisibilityCheckboxChange(id: string, event: Event) {
  const checked = (event.target as HTMLInputElement | null)?.checked ?? false
  setSectionVisible(id, checked)
}

function getCoeffValue(point: HpChartPoint): number | null {
  if (point.hpCoeffPercent == null) return null
  const n = Number(point.hpCoeffPercent)
  return Number.isFinite(n) ? n : null
}

const showHpCoeffCharts = computed(() => {
  if (!props.enableHpCoeffCharts || isChartEmpty.value) return false
  return chartSourcePoints.value.some((point) => getCoeffValue(point) != null)
})

const chartSectionCount = computed(() => {
  let count = 0
  if (isSectionVisible('hp')) count += 1
  if (isSectionVisible('exp')) count += 1
  for (const marker of scoreMarkers.value) {
    if (isSectionVisible(`score-exp-${marker.id}`)) count += 1
  }
  if (showHpCoeffCharts.value && isSectionVisible('coeff')) count += 1
  if (showHpCoeffCharts.value && isSectionVisible('coeff-exp')) count += 1
  return count
})

const chartVisibilityOptions = computed(() => {
  const options: Array<{ id: string; label: string }> = [
    { id: 'hp', label: displayHpChartTitle.value },
    { id: 'exp', label: displayExpansionChartTitle.value },
  ]
  for (const marker of scoreMarkers.value) {
    options.push({
      id: `score-exp-${marker.id}`,
      label: `${marker.shortLabel}相对膨胀`,
    })
  }
  if (showHpCoeffCharts.value) {
    options.push({ id: 'coeff', label: COEFF_CHART_TITLE })
    options.push({ id: 'coeff-exp', label: COEFF_EXPANSION_CHART_TITLE })
  }
  return options
})

function buildExpansionSeries(values: number[]) {
  return values.map((value, index) => {
    if (index === 0) return isExpansionDelta.value ? 0 : 1
    const previous = values[index - 1] ?? 0
    if (isExpansionDelta.value) return value - previous
    return previous ? value / previous : 1
  })
}

function formatExpansionValue(value: number) {
  if (!isExpansionDelta.value) return formatExpansion(value)
  if (props.valueFormat === 'percent') {
    const rounded = Math.round(value)
    return rounded >= 0 ? `+${rounded}%` : `${rounded}%`
  }
  return formatHpDelta(value)
}

function formatExpansionTick(value: number) {
  if (!isExpansionDelta.value) return formatExpansion(value)
  if (props.valueFormat === 'percent') return `${Math.round(value)}%`
  if (value < 0) return `-${formatHp(Math.abs(value))}`
  return formatHp(value)
}

function getPointX(index: number) {
  const count = points.value.length
  const pad = chartPadding.value
  const width = plotWidth.value

  if (count <= 1) return pad.left + width / 2

  if (isOverviewMode.value) {
    const innerWidth = width - pointInset * 2
    return pad.left + pointInset + (innerWidth * index) / (count - 1)
  }

  return pad.left + pointInset + index * pointSpacing.value
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
  const baseline = expansionBaselineValue.value
  if (
    min <= baseline &&
    max >= baseline &&
    !ticks.some((tick) => Math.abs(tick - baseline) < 1e-6)
  ) {
    ticks.push(baseline)
    ticks.sort((a, b) => a - b)
  }
  return ticks
}

function isExpansionBaselineTick(tick: number) {
  return Math.abs(tick - expansionBaselineValue.value) < 1e-6
}

function valueToY(value: number, min: number, max: number) {
  const range = max - min
  const pad = chartPadding.value
  if (!range) return pad.top + plotHeight.value / 2
  return pad.top + plotHeight.value - ((value - min) / range) * plotHeight.value
}

const hpRange = computed(() => {
  if (isChartEmpty.value) return EMPTY_HP_RANGE
  const totals = chartSourcePoints.value.map((item) => item.totalHp)
  const overlays = scoreMarkers.value.flatMap((marker) =>
    chartSourcePoints.value.map((item) => scaleHpByRatio(item.totalHp, marker.hpRatio)),
  )
  return buildValueRange([...totals, ...overlays])
})
const expansionRange = computed(() =>
  isChartEmpty.value
    ? isExpansionDelta.value
      ? EMPTY_EXPANSION_RANGE_DELTA
      : EMPTY_EXPANSION_RANGE_RATIO
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
  plotPoints(chartSourcePoints.value, (item) => item.totalHp, hpRange.value),
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
  const baseline = expansionBaselineValue.value
  return min <= baseline && max >= baseline
})

const expansionBaselineY = computed(() =>
  valueToY(expansionBaselineValue.value, expansionRange.value.min, expansionRange.value.max),
)

const expansionBaselineLabel = computed(() =>
  isExpansionDelta.value ? '基准 0' : '基准 1',
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

const isRoomBuffPreviewEnabled = computed(
  () => props.enableRoomBuffPreview && !hideBossTooltip.value,
)

const isSeriesTooltipEnabled = computed(
  () => !hideBossTooltip.value && !isChartEmpty.value && hpChartPoints.value.length > 0,
)

const canToggleHoverPreview = computed(
  () => (!isChartEmpty.value && hpChartPoints.value.length > 0) || props.enableRoomBuffPreview,
)

const isHoverPreviewEnabled = computed(
  () => isSeriesTooltipEnabled.value || isRoomBuffPreviewEnabled.value,
)

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

const seriesTooltipTitle = computed(() => {
  const id = hoverChartId.value ?? 'hp'
  if (id === 'hp') return displayHpChartTitle.value
  if (id === 'exp') return displayExpansionChartTitle.value
  if (id === 'coeff') return COEFF_CHART_TITLE
  if (id === 'coeff-exp') return COEFF_EXPANSION_CHART_TITLE
  if (id.startsWith('score-exp-')) {
    const markerId = id.slice('score-exp-'.length)
    const series = scoreOverlaySeries.value.find((item) => item.marker.id === markerId)
    return series ? `${series.marker.shortLabel}相对膨胀` : displayExpansionChartTitle.value
  }
  return displayHpChartTitle.value
})

const seriesTooltipRows = computed((): ChartSeriesTooltipRow[] => {
  const index = hoverIndex.value
  if (index === null) return []
  const id = hoverChartId.value ?? 'hp'

  const sortByValueDesc = (rows: ChartSeriesTooltipRow[]) =>
    [...rows].sort((a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0))

  if (id === 'hp') {
    const hpPoint = hpChartPoints.value[index]
    if (!hpPoint) return []
    const rows: ChartSeriesTooltipRow[] = [
      {
        label: '总血量',
        value: formatPrimaryValue(hpPoint.value),
        color: '#e85d4c',
        numericValue: hpPoint.value,
      },
    ]
    for (const series of scoreOverlaySeries.value) {
      const point = series.chartPoints[index]
      if (!point) continue
      rows.push({
        label: series.marker.label,
        value: formatPrimaryValue(point.value),
        color: series.marker.color,
        numericValue: point.value,
      })
    }
    return sortByValueDesc(rows)
  }

  if (id === 'exp') {
    const point = expansionChartPoints.value[index]
    if (!point) return []
    return [
      {
        label: '膨胀',
        value: formatExpansionValue(point.value),
        color: '#e85d4c',
        numericValue: point.value,
      },
    ]
  }

  if (id.startsWith('score-exp-')) {
    const markerId = id.slice('score-exp-'.length)
    const series = scoreOverlaySeries.value.find((item) => item.marker.id === markerId)
    const point = series?.expansionChartPoints[index]
    if (!series || !point) return []
    return [
      {
        label: `${series.marker.shortLabel}膨胀`,
        value: formatExpansionValue(point.value),
        color: series.marker.color,
        numericValue: point.value,
      },
    ]
  }

  if (id === 'coeff') {
    const point = coeffChartPoints.value[index]
    if (!point?.valid) return []
    return [
      {
        label: COEFF_CHART_TITLE,
        value: formatCoeffPercent(point.value),
        color: COEFF_LINE_COLOR,
        numericValue: point.value,
      },
    ]
  }

  if (id === 'coeff-exp') {
    const point = coeffExpansionChartPoints.value[index]
    if (!point?.valid) return []
    return [
      {
        label: COEFF_EXPANSION_CHART_TITLE,
        value: formatCoeffDelta(point.value),
        color: COEFF_LINE_COLOR,
        numericValue: point.value,
      },
    ]
  }

  return []
})

function getAnchorPointForChart(chartId: string, index: number): PlottedPoint | null {
  if (chartId === 'hp') return hpChartPoints.value[index] ?? null
  if (chartId === 'exp') return expansionChartPoints.value[index] ?? null
  if (chartId === 'coeff') {
    const point = coeffChartPoints.value[index]
    return point?.valid ? point : hpChartPoints.value[index] ?? null
  }
  if (chartId === 'coeff-exp') {
    const point = coeffExpansionChartPoints.value[index]
    return point?.valid ? point : hpChartPoints.value[index] ?? null
  }
  if (chartId.startsWith('score-exp-')) {
    const markerId = chartId.slice('score-exp-'.length)
    const series = scoreOverlaySeries.value.find((item) => item.marker.id === markerId)
    return series?.expansionChartPoints[index] ?? null
  }
  return hpChartPoints.value[index] ?? null
}

function buildLinePath(chartPoints: PlottedPoint[]) {
  if (!chartPoints.length) return ''
  return chartPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
}

/** 仅连接连续有效点，无效点处断开 */
function buildGappedLinePath(chartPoints: Array<PlottedPoint & { valid: boolean }>) {
  const parts: string[] = []
  let drawing = false
  for (const point of chartPoints) {
    if (!point.valid) {
      drawing = false
      continue
    }
    parts.push(`${drawing ? 'L' : 'M'} ${point.x} ${point.y}`)
    drawing = true
  }
  return parts.join(' ')
}

const hpLinePath = computed(() => buildLinePath(hpChartPoints.value))
const expansionLinePath = computed(() => buildLinePath(expansionChartPoints.value))

interface ScoreOverlaySeries {
  marker: CrisisScoreMarker
  chartPoints: PlottedPoint[]
  linePath: string
  expansionChartPoints: PlottedPoint[]
  expansionRange: { min: number; max: number }
  expansionLinePath: string
  expansionYTicks: number[]
  expansionBaselineVisible: boolean
  expansionBaselineY: number
}

const scoreOverlaySeries = computed<ScoreOverlaySeries[]>(() => {
  const markers = scoreMarkers.value
  const source = chartSourcePoints.value
  if (!markers.length || !source.length) return []

  return markers.map((marker) => {
    const values = source.map((item) => scaleHpByRatio(item.totalHp, marker.hpRatio))
    const chartPoints = plotPoints(
      source.map((item, index) => ({ ...item, totalHp: values[index]! })),
      (item) => item.totalHp,
      hpRange.value,
    )
    const expansionValues = buildExpansionSeries(values)
    const expansionRangeLocal = buildValueRange(expansionValues)
    const expansionItems = source.map((item, index) => ({
      ...item,
      expansion: expansionValues[index] ?? 0,
    }))
    const expansionPts = plotPoints(
      expansionItems,
      (item) => item.expansion,
      expansionRangeLocal,
    )
    return {
      marker,
      chartPoints,
      linePath: buildLinePath(chartPoints),
      expansionChartPoints: expansionPts,
      expansionRange: expansionRangeLocal,
      expansionLinePath: buildLinePath(expansionPts),
      expansionYTicks: buildExpansionYTicks(expansionRangeLocal.min, expansionRangeLocal.max),
      expansionBaselineVisible:
        expansionRangeLocal.min <= expansionBaselineValue.value &&
        expansionRangeLocal.max >= expansionBaselineValue.value,
      expansionBaselineY: valueToY(
        expansionBaselineValue.value,
        expansionRangeLocal.min,
        expansionRangeLocal.max,
      ),
    }
  })
})

interface CoeffPlottedPoint extends PlottedPoint {
  valid: boolean
}

const coeffValues = computed<(number | null)[]>(() =>
  chartSourcePoints.value.map((point) => getCoeffValue(point)),
)

const coeffRange = computed(() => {
  const vals = coeffValues.value.filter((v): v is number => v != null)
  if (!vals.length) return { min: 0, max: 100 }
  return buildValueRange(vals)
})

const coeffChartPoints = computed<CoeffPlottedPoint[]>(() => {
  const source = chartSourcePoints.value
  if (!source.length) return []
  const range = coeffRange.value
  return source.map((item, index) => {
    const value = coeffValues.value[index] ?? null
    const { start, end } = splitDateRange(item.dateRange)
    const valid = value != null
    return {
      label: item.label,
      dateRange: item.dateRange,
      dateStart: start,
      dateEnd: end,
      value: value ?? 0,
      x: getPointX(index),
      y: valid ? valueToY(value!, range.min, range.max) : 0,
      index,
      valid,
    }
  })
})

const coeffYTicks = computed(() => buildYTicks(coeffRange.value.min, coeffRange.value.max))
const coeffLinePath = computed(() => buildGappedLinePath(coeffChartPoints.value))

const coeffExpansionValues = computed<(number | null)[]>(() =>
  coeffValues.value.map((value, index) => {
    if (value == null) return null
    if (index === 0) return 0
    const previous = coeffValues.value[index - 1]
    if (previous == null) return null
    return value - previous
  }),
)

const coeffExpansionRange = computed(() => {
  const vals = coeffExpansionValues.value.filter((v): v is number => v != null)
  if (!vals.length) return EMPTY_EXPANSION_RANGE_DELTA
  return buildValueRange(vals)
})

const coeffExpansionChartPoints = computed<CoeffPlottedPoint[]>(() => {
  const source = chartSourcePoints.value
  if (!source.length) return []
  const range = coeffExpansionRange.value
  return source.map((item, index) => {
    const value = coeffExpansionValues.value[index] ?? null
    const { start, end } = splitDateRange(item.dateRange)
    const valid = value != null
    return {
      label: item.label,
      dateRange: item.dateRange,
      dateStart: start,
      dateEnd: end,
      value: value ?? 0,
      x: getPointX(index),
      y: valid ? valueToY(value!, range.min, range.max) : 0,
      index,
      valid,
    }
  })
})

const coeffExpansionYTicks = computed(() => {
  const ticks = buildYTicks(coeffExpansionRange.value.min, coeffExpansionRange.value.max)
  const { min, max } = coeffExpansionRange.value
  if (min <= 0 && max >= 0 && !ticks.some((tick) => Math.abs(tick) < 1e-6)) {
    ticks.push(0)
    ticks.sort((a, b) => a - b)
  }
  return ticks
})

const coeffExpansionBaselineVisible = computed(() => {
  const { min, max } = coeffExpansionRange.value
  return min <= 0 && max >= 0
})

const coeffExpansionBaselineY = computed(() =>
  valueToY(0, coeffExpansionRange.value.min, coeffExpansionRange.value.max),
)

const coeffExpansionLinePath = computed(() => buildGappedLinePath(coeffExpansionChartPoints.value))

const hoveredCoeffPoint = computed(() =>
  hoverIndex.value === null ? null : coeffChartPoints.value[hoverIndex.value] ?? null,
)

const hoveredCoeffExpansionPoint = computed(() =>
  hoverIndex.value === null ? null : coeffExpansionChartPoints.value[hoverIndex.value] ?? null,
)

function formatCoeffPercent(value: number) {
  return `${Math.round(value)}%`
}

function formatCoeffDelta(value: number) {
  const rounded = Math.round(value)
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`
}

function shouldShowPointValue(index: number) {
  if (isDetailMode.value) return true
  return hoverIndex.value === index
}

function setHoverChart(chartId: string) {
  hoverChartId.value = chartId
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

function clearHover() {
  hoverIndex.value = null
  showSeriesTooltip.value = false
  showRoomBuffTooltip.value = false
}

function updateBossTooltipPosition() {
  showSeriesTooltip.value = false
  showRoomBuffTooltip.value = false

  if (hoverIndex.value === null || isDragging.value || hideBossTooltip.value) return

  const chartId = hoverChartId.value ?? 'hp'
  const plotted = getAnchorPointForChart(chartId, hoverIndex.value)
  if (!plotted || !scrollRef.value) return

  const svg =
    (scrollRef.value.querySelector(
      `svg.hp-chart[data-chart-id="${chartId}"]`,
    ) as SVGSVGElement | null) ??
    (scrollRef.value.querySelector('svg.hp-chart') as SVGSVGElement | null)
  if (!svg) return

  const rect = svg.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  const hasRoomBuff = isRoomBuffPreviewEnabled.value && hoveredRoomBuff.value
  const hasSeriesTooltip =
    !hasRoomBuff && isSeriesTooltipEnabled.value && seriesTooltipRows.value.length > 0

  if (!hasRoomBuff && !hasSeriesTooltip) return

  const scaleX = rect.width / chartWidth.value
  const scaleY = rect.height / chartHeight.value
  const anchorX = rect.left + plotted.x * scaleX
  const anchorY = rect.top + plotted.y * scaleY

  const tooltipWidth = hasRoomBuff ? 220 : 220
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

  showSeriesTooltip.value = true
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
  return chartPadding.value.top + plotHeight.value + (showDates.value ? 24 : 20) + getOverviewLabelLift(index)
}

function getDateLabelY(index: number) {
  return chartPadding.value.top + plotHeight.value + 42 + getOverviewLabelLift(index)
}

/** 总览模式下按宽度抽样显示期数，避免挤成一团 */
function shouldShowAxisLabel(index: number) {
  if (isDetailMode.value) return true
  if (hoverIndex.value === index) return true
  const count = points.value.length
  if (count <= 12) return true
  const usable = Math.max(1, plotWidth.value - pointInset * 2)
  const maxLabels = Math.max(6, Math.floor(usable / 64))
  const step = Math.max(1, Math.ceil(count / maxLabels))
  return index % step === 0 || index === count - 1
}

function isActiveOverviewLabel(index: number) {
  return isOverviewMode.value && hoverIndex.value === index
}

function shouldRenderLabelLayer(index: number, layer: 'base' | 'active') {
  if (!shouldShowAxisLabel(index) && layer === 'base') return false
  const active = isActiveOverviewLabel(index)
  return layer === 'active' ? active : !active
}

function setViewMode(mode: ChartViewMode) {
  chartSync.setViewMode(mode)
  if (scrollRef.value) scrollRef.value.scrollLeft = 0
  hoverIndex.value = null
}

function findIndexByPhaseKey(phaseKey: string | null | undefined) {
  if (!phaseKey) return -1
  return points.value.findIndex((point) => getChartPointPhaseKey(point) === phaseKey)
}

function getCenteredPhaseIndex() {
  if (!scrollRef.value || !points.value.length) return -1
  const centerX = scrollRef.value.scrollLeft + scrollRef.value.clientWidth / 2
  let bestIndex = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.value.length; index++) {
    const dist = Math.abs(getPointX(index) - centerX)
    if (dist < bestDist) {
      bestDist = dist
      bestIndex = index
    }
  }
  return bestIndex
}

function broadcastLinkedPhase(phaseKey: string | null) {
  if (!props.syncGroup || applyingRemoteFocus) return
  if (lastBroadcastPhaseKey === phaseKey) return
  lastBroadcastPhaseKey = phaseKey
  chartSync.broadcastLinkedFocus(props.syncGroup, instanceId, phaseKey)
}

function applyRemotePhaseKey(phaseKey: string | null, { smooth = false } = {}) {
  if (!props.syncGroup) return
  applyingRemoteFocus = true
  lastBroadcastPhaseKey = phaseKey
  const index = findIndexByPhaseKey(phaseKey)
  if (index < 0) {
    hoverIndex.value = null
    window.setTimeout(() => {
      applyingRemoteFocus = false
    }, 0)
    return
  }

  hoverIndex.value = index
  if (isDetailMode.value && scrollRef.value) {
    scrollRef.value.scrollTo({
      left: getPhaseScrollLeft(index),
      behavior: smooth ? 'smooth' : 'auto',
    })
  }
  window.setTimeout(() => {
    applyingRemoteFocus = false
    updateBossTooltipPosition()
  }, 0)
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
  if (key === 'h' && canToggleHoverPreview.value) {
    hideBossTooltip.value = !hideBossTooltip.value
    event.preventDefault()
    return
  }

  if (key === 't' && props.enableHpConverted953Toggle) {
    useConverted953.value = !useConverted953.value
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
    viewportWidth.value = Math.max(320, scrollRef.value.clientWidth)
  }
  if (!containerRef.value) return

  const toolbarEl = containerRef.value.querySelector('.chart-toolbar') as HTMLElement | null
  const visibilityEl = containerRef.value.querySelector('.chart-visibility') as HTMLElement | null
  const hintEl = containerRef.value.querySelector('.scroll-hint') as HTMLElement | null
  const legendEl = containerRef.value.querySelector('.score-legend') as HTMLElement | null
  const toolbarHeight = toolbarEl?.offsetHeight ?? 44
  const visibilityHeight = visibilityEl?.offsetHeight ?? 0
  const hintHeight = hintEl?.offsetHeight ?? (isDetailMode.value ? 28 : 0)
  const legendHeight = legendEl?.offsetHeight ?? 0
  // charts-stack 上下 padding（约 0.5rem * 2）
  const stackPad = 16
  // 横向滚动条预留，避免压住下方期数标签
  const scrollbarReserve = isDetailMode.value ? 14 : 0
  const available =
    containerRef.value.clientHeight -
    toolbarHeight -
    visibilityHeight -
    hintHeight -
    legendHeight -
    stackPad -
    scrollbarReserve
  const sections = Math.max(1, chartSectionCount.value)
  const gaps = sectionGap * Math.max(0, sections - 1)
  const sectionHeight = (available - gaps) / sections
  const labelRoom = chartPadding.value.bottom + chartPadding.value.top
  const minPlot = isOverviewMode.value ? 180 : 200
  const minSectionHeight = labelRoom + minPlot
  // 约两张图占满一屏；多图时纵向滚动
  const targetMinChart = Math.max(
    isOverviewMode.value ? 400 : 440,
    Math.floor(available * 0.46),
  )
  chartHeight.value = Math.max(targetMinChart, minSectionHeight, sectionHeight)
}

let resizeObserver: ResizeObserver | null = null
let scrollElement: HTMLElement | null = null
let narrowMq: MediaQueryList | null = null

onMounted(() => {
  syncNarrowViewport()
  narrowMq = window.matchMedia('(max-width: 768px)')
  narrowMq.addEventListener('change', syncNarrowViewport)
  updateLayoutMetrics()
  if (!containerRef.value) return
  resizeObserver = new ResizeObserver(() => {
    updateLayoutMetrics()
    updateBossTooltipPosition()
  })
  resizeObserver.observe(containerRef.value)
  if (scrollRef.value) {
    resizeObserver.observe(scrollRef.value)
    scrollElement = scrollRef.value
    scrollElement.addEventListener('scroll', onLinkedScroll, { passive: true })
  }
  window.addEventListener('resize', updateBossTooltipPosition)
  window.addEventListener('keydown', onChartKeydown)
})

onUnmounted(() => {
  narrowMq?.removeEventListener('change', syncNarrowViewport)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateBossTooltipPosition)
  window.removeEventListener('keydown', onChartKeydown)
  scrollElement?.removeEventListener('scroll', onLinkedScroll)
  if (scrollSyncRaf) cancelAnimationFrame(scrollSyncRaf)
})

function onPointerDown(event: PointerEvent) {
  if (!isDetailMode.value || !scrollRef.value || event.button !== 0) return
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
  const wasDragging = isDragging.value
  isDragging.value = false
  if (scrollRef.value.hasPointerCapture(event.pointerId)) {
    scrollRef.value.releasePointerCapture(event.pointerId)
  }
  if (wasDragging && props.syncGroup && !applyingRemoteFocus) {
    const index = hoverIndex.value ?? getCenteredPhaseIndex()
    const point = index >= 0 ? points.value[index] : null
    broadcastLinkedPhase(point ? getChartPointPhaseKey(point) : null)
  }
  window.setTimeout(() => {
    dragMoved.value = false
    updateBossTooltipPosition()
  }, 0)
}

function onWheel(event: WheelEvent) {
  if (!isDetailMode.value || !scrollRef.value) return
  // 仅在明确横向意图时接管滚轮，避免挡住整页纵向滚动
  const horizontalIntent =
    event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
  if (!horizontalIntent) return
  const delta = event.shiftKey ? event.deltaY || event.deltaX : event.deltaX
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

function scrollToPhaseIndex(index: number, { smooth = true, broadcast = true } = {}) {
  if (!scrollRef.value || index < 0) return
  scrollRef.value.scrollTo({
    left: getPhaseScrollLeft(index),
    behavior: smooth ? 'smooth' : 'auto',
  })
  hoverIndex.value = index
  if (broadcast) {
    const point = points.value[index]
    broadcastLinkedPhase(point ? getChartPointPhaseKey(point) : null)
  }
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
    const point = points.value[index]
    broadcastLinkedPhase(point ? getChartPointPhaseKey(point) : null)
    return
  }

  scrollToPhaseIndex(index)
}

function onLinkedScroll() {
  updateBossTooltipPosition()
  if (!props.syncGroup || applyingRemoteFocus || !isDetailMode.value) return
  if (scrollSyncRaf) cancelAnimationFrame(scrollSyncRaf)
  scrollSyncRaf = requestAnimationFrame(() => {
    scrollSyncRaf = 0
    const index = getCenteredPhaseIndex()
    if (index < 0) return
    if (hoverIndex.value !== index) hoverIndex.value = index
    const point = points.value[index]
    broadcastLinkedPhase(point ? getChartPointPhaseKey(point) : null)
  })
}

watch(points, () => {
  hoverIndex.value = null
  showSeriesTooltip.value = false
})

watch(hoverIndex, (index) => {
  nextTick(updateBossTooltipPosition)
  if (applyingRemoteFocus || !props.syncGroup) return
  if (index == null) {
    broadcastLinkedPhase(null)
    return
  }
  const point = points.value[index]
  if (point) broadcastLinkedPhase(getChartPointPhaseKey(point))
})

watch(hoverChartId, () => {
  nextTick(updateBossTooltipPosition)
})

watch([chartWidth, chartHeight], () => {
  nextTick(updateBossTooltipPosition)
})

watch(viewMode, () => {
  if (scrollRef.value) scrollRef.value.scrollLeft = 0
  hoverIndex.value = null
  updateLayoutMetrics()
})

watch(hideDatesInOverview, () => {
  updateLayoutMetrics()
})

watch(visibleSections, () => {
  nextTick(updateLayoutMetrics)
}, { deep: true })

watch(scoreMarkers, () => {
  nextTick(updateLayoutMetrics)
})

watch(showHpCoeffCharts, () => {
  nextTick(updateLayoutMetrics)
})

watch(linkedFocus, (focus) => {
  if (!props.syncGroup || !focus) return
  if (focus.groupId !== props.syncGroup) return
  if (focus.sourceId === instanceId) return
  applyRemotePhaseKey(focus.phaseKey)
})

watch(hideBossTooltip, (hidden) => {
  if (hidden) {
    showSeriesTooltip.value = false
    showRoomBuffTooltip.value = false
    return
  }
  nextTick(updateBossTooltipPosition)
})

watch(phaseSearchQuery, () => {
  if (phaseSearchHint.value) phaseSearchHint.value = ''
})
</script>

<template>
  <div
    v-if="shouldRenderChart"
    ref="containerRef"
    class="charts-panel"
    :class="{ 'charts-panel--borderless': borderless }"
  >
    <div class="chart-toolbar">
      <div class="toolbar-main">
        <div
          v-if="showHpModeToggle"
          class="mode-toggle"
          role="group"
          aria-label="正常或困难模式"
        >
          <button
            type="button"
            class="mode-btn"
            :class="{ active: hpMode === 'normal' }"
            @click="hpMode = 'normal'"
          >
            正常
          </button>
          <button
            type="button"
            class="mode-btn"
            :class="{ active: hpMode === 'hard' }"
            @click="hpMode = 'hard'"
          >
            困难
          </button>
        </div>
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
          <span>隐藏日期 <span class="shortcut-hint">(D)</span></span>
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
        <label v-if="enableHpConverted953Toggle" class="date-toggle">
          <input v-model="useConverted953" type="checkbox" />
          <span>953防御换算 <span class="shortcut-hint">(T)</span></span>
        </label>
        <label v-if="canToggleHoverPreview" class="date-toggle">
          <input v-model="hideBossTooltip" type="checkbox" />
          <span>隐藏小窗 <span class="shortcut-hint">(H)</span></span>
        </label>
      </div>
    </div>

    <div
      v-if="chartVisibilityOptions.length > 1"
      class="chart-visibility"
      role="group"
      aria-label="显示折线图"
    >
      <span class="chart-visibility__label">显示</span>
      <label
        v-for="opt in chartVisibilityOptions"
        :key="opt.id"
        class="date-toggle chart-visibility__item"
      >
        <input
          type="checkbox"
          :checked="isSectionVisible(opt.id)"
          @change="onVisibilityCheckboxChange(opt.id, $event)"
        />
        <span>{{ opt.label }}</span>
      </label>
    </div>

    <div v-if="scoreOverlaySeries.length" class="score-legend" aria-label="分数血量图例">
      <span class="score-legend-item">
        <i class="score-legend-swatch score-legend-swatch--total" />
        总血量
      </span>
      <span
        v-for="series in scoreOverlaySeries"
        :key="`legend-${series.marker.id}`"
        class="score-legend-item"
      >
        <i class="score-legend-swatch" :style="{ background: series.marker.color }" />
        {{ series.marker.label }}
      </span>
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
        <section
          v-if="isSectionVisible('hp')"
          class="chart-section"
          @pointerenter="setHoverChart('hp')"
        >
          <div class="y-axis-title y-axis-title-hp" aria-hidden="true">{{ displayHpChartTitle }}</div>
          <div class="chart-wrap">
            <svg
              class="hp-chart"
              data-chart-id="hp"
              :class="{ 'hp-chart--overview': isOverviewMode }"
              :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
              :style="{
                height: `${chartHeight}px`,
                width: isOverviewMode ? '100%' : undefined,
                minWidth: isDetailMode ? `${chartWidth}px` : undefined,
              }"
              role="img"
              :aria-label="displayHpAriaLabel"
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
                  {{ formatPrimaryValue(tick) }}
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

              <template v-for="series in scoreOverlaySeries" :key="`hp-overlay-${series.marker.id}`">
                <path
                  v-if="series.linePath"
                  :d="series.linePath"
                  class="line-path line-path-score"
                  :style="{ stroke: series.marker.color }"
                />
                <g
                  v-for="point in series.chartPoints"
                  :key="`${series.marker.id}-${point.label}`"
                  class="point-group"
                >
                  <circle
                    :cx="point.x"
                    :cy="point.y"
                    :r="hoverIndex === point.index ? 7 : isOverviewMode ? 3 : 4"
                    class="line-point line-point-score"
                    :class="{ active: hoverIndex === point.index }"
                    :style="{ fill: series.marker.color, stroke: series.marker.color }"
                  />
                  <text
                    v-if="hoverIndex === point.index"
                    :x="point.x"
                    :y="point.y + 18"
                    class="point-value point-value-score"
                    text-anchor="middle"
                    :style="{ fill: series.marker.color }"
                  >
                    {{ series.marker.shortLabel }} {{ formatPrimaryValue(point.value) }}
                  </text>
                </g>
              </template>

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
                  {{ formatPrimaryValue(point.value) }}
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

        <section
          v-if="isSectionVisible('exp')"
          class="chart-section"
          @pointerenter="setHoverChart('exp')"
        >
          <div class="y-axis-title y-axis-title-expansion" aria-hidden="true">
            {{ displayExpansionChartTitle }}
          </div>
          <div class="chart-wrap">
            <svg
              class="hp-chart"
              data-chart-id="exp"
              :class="{ 'hp-chart--overview': isOverviewMode }"
              :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
              :style="{
                height: `${chartHeight}px`,
                width: isOverviewMode ? '100%' : undefined,
                minWidth: isDetailMode ? `${chartWidth}px` : undefined,
              }"
              role="img"
              :aria-label="displayExpansionAriaLabel"
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
                  :style="isExpansionBaselineTick(tick) ? { stroke: '#e85d4c' } : undefined"
                />
                <text
                  :x="chartPadding.left - 10"
                  :y="valueToY(tick, expansionRange.min, expansionRange.max) + 4"
                  class="axis-label axis-label-y"
                  :class="{ 'axis-label-y-baseline': isExpansionBaselineTick(tick) }"
                  :style="isExpansionBaselineTick(tick) ? { fill: '#e85d4c' } : undefined"
                  text-anchor="end"
                >
                  {{ formatExpansionTick(tick) }}
                </text>
              </g>

              <g v-if="expansionBaselineVisible">
                <line
                  :x1="chartPadding.left"
                  :y1="expansionBaselineY"
                  :x2="chartPadding.left + plotWidth"
                  :y2="expansionBaselineY"
                  class="baseline-line"
                  style="stroke: #e85d4c"
                />
                <text
                  :x="chartPadding.left + plotWidth + 6"
                  :y="expansionBaselineY + 4"
                  class="baseline-label"
                  style="fill: #e85d4c"
                >
                  {{ expansionBaselineLabel }}
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
                  {{ formatExpansionValue(point.value) }}
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

        <template v-for="series in scoreOverlaySeries" :key="`exp-${series.marker.id}`">
        <section
          v-if="isSectionVisible(`score-exp-${series.marker.id}`)"
          class="chart-section"
          @pointerenter="setHoverChart(`score-exp-${series.marker.id}`)"
        >
          <div
            class="y-axis-title y-axis-title-expansion y-axis-title-score"
            :style="{ color: series.marker.color }"
            aria-hidden="true"
          >
            {{ series.marker.shortLabel }}相对膨胀
          </div>
          <div class="chart-wrap">
            <svg
              class="hp-chart"
              :data-chart-id="`score-exp-${series.marker.id}`"
              :class="{ 'hp-chart--overview': isOverviewMode }"
              :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
              :style="{
                height: `${chartHeight}px`,
                width: isOverviewMode ? '100%' : undefined,
                minWidth: isDetailMode ? `${chartWidth}px` : undefined,
              }"
              role="img"
              :aria-label="`${series.marker.label}相对膨胀折线图`"
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

              <g v-for="tick in series.expansionYTicks" :key="`${series.marker.id}-tick-${tick}`">
                <line
                  :x1="chartPadding.left"
                  :y1="valueToY(tick, series.expansionRange.min, series.expansionRange.max)"
                  :x2="chartPadding.left + plotWidth"
                  :y2="valueToY(tick, series.expansionRange.min, series.expansionRange.max)"
                  :class="isExpansionBaselineTick(tick) ? 'grid-line grid-line-baseline' : 'grid-line'"
                  :style="isExpansionBaselineTick(tick) ? { stroke: series.marker.color } : undefined"
                />
                <text
                  :x="chartPadding.left - 10"
                  :y="valueToY(tick, series.expansionRange.min, series.expansionRange.max) + 4"
                  class="axis-label axis-label-y"
                  :class="{ 'axis-label-y-baseline': isExpansionBaselineTick(tick) }"
                  :style="isExpansionBaselineTick(tick) ? { fill: series.marker.color } : undefined"
                  text-anchor="end"
                >
                  {{ formatExpansionTick(tick) }}
                </text>
              </g>

              <g v-if="series.expansionBaselineVisible">
                <line
                  :x1="chartPadding.left"
                  :y1="series.expansionBaselineY"
                  :x2="chartPadding.left + plotWidth"
                  :y2="series.expansionBaselineY"
                  class="baseline-line"
                  :style="{ stroke: series.marker.color }"
                />
              </g>

              <rect
                v-for="zone in columnZones"
                :key="`${series.marker.id}-zone-${zone.index}`"
                :x="zone.x1"
                y="0"
                :width="zone.width"
                :height="chartHeight"
                class="column-hit"
                :class="{ 'column-hit--clickable': enablePointClick }"
                @pointerenter="setHover(zone.index)"
                @click="onPointClick(zone.index, $event)"
              />

              <line
                v-if="hoverIndex !== null && series.expansionChartPoints[hoverIndex]"
                :x1="series.expansionChartPoints[hoverIndex]!.x"
                :y1="chartPadding.top"
                :x2="series.expansionChartPoints[hoverIndex]!.x"
                :y2="chartPadding.top + plotHeight"
                class="hover-guide hover-guide-expansion"
                :style="{ stroke: series.marker.color }"
              />

              <path
                v-if="series.expansionLinePath"
                :d="series.expansionLinePath"
                class="line-path line-path-score"
                :style="{ stroke: series.marker.color }"
              />

              <g
                v-for="point in series.expansionChartPoints"
                :key="`${series.marker.id}-exp-${point.label}`"
                class="point-group"
              >
                <circle
                  :cx="point.x"
                  :cy="point.y"
                  :r="hoverIndex === point.index ? 9 : isOverviewMode ? 4 : 5"
                  class="line-point line-point-score"
                  :class="{ active: hoverIndex === point.index }"
                  :style="{ fill: series.marker.color, stroke: series.marker.color }"
                />
                <text
                  v-if="shouldShowPointValue(point.index)"
                  :x="point.x"
                  :y="point.y - 16"
                  class="point-value"
                  text-anchor="middle"
                  :style="{ fill: series.marker.color }"
                >
                  {{ formatExpansionValue(point.value) }}
                </text>
              </g>

              <g
                v-for="point in series.expansionChartPoints"
                v-show="shouldRenderLabelLayer(point.index, 'base')"
                :key="`${series.marker.id}-${point.label}-label`"
              >
                <text
                  :x="point.x"
                  :y="getVersionLabelY(point.index)"
                  class="axis-label axis-label-x"
                  :class="{ 'axis-label-x--compact': isOverviewMode }"
                  text-anchor="middle"
                >
                  {{ point.label }}
                </text>
                <text
                  v-if="showDates"
                  :x="point.x"
                  :y="getDateLabelY(point.index)"
                  class="axis-label axis-date"
                  :class="{ 'axis-date--compact': isOverviewMode }"
                  text-anchor="middle"
                >
                  <tspan :x="point.x" dy="0">{{ point.dateStart }}</tspan>
                  <tspan v-if="point.dateEnd" :x="point.x" dy="12">{{ point.dateEnd }}</tspan>
                </text>
              </g>
            </svg>
          </div>
        </section>
        </template>

        <section
          v-if="showHpCoeffCharts && isSectionVisible('coeff')"
          class="chart-section"
          @pointerenter="setHoverChart('coeff')"
        >
          <div class="y-axis-title y-axis-title-coeff" aria-hidden="true">{{ COEFF_CHART_TITLE }}</div>
          <div class="chart-wrap">
            <svg
              class="hp-chart"
              data-chart-id="coeff"
              :class="{ 'hp-chart--overview': isOverviewMode }"
              :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
              :style="{
                height: `${chartHeight}px`,
                width: isOverviewMode ? '100%' : undefined,
                minWidth: isDetailMode ? `${chartWidth}px` : undefined,
              }"
              role="img"
              :aria-label="COEFF_CHART_TITLE"
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

              <g v-for="tick in coeffYTicks" :key="`coeff-${tick}`">
                <line
                  :x1="chartPadding.left"
                  :y1="valueToY(tick, coeffRange.min, coeffRange.max)"
                  :x2="chartPadding.left + plotWidth"
                  :y2="valueToY(tick, coeffRange.min, coeffRange.max)"
                  class="grid-line"
                />
                <text
                  :x="chartPadding.left - 10"
                  :y="valueToY(tick, coeffRange.min, coeffRange.max) + 4"
                  class="axis-label axis-label-y"
                  text-anchor="end"
                >
                  {{ formatCoeffPercent(tick) }}
                </text>
              </g>

              <rect
                v-for="zone in columnZones"
                :key="`coeff-zone-${zone.index}`"
                :x="zone.x1"
                y="0"
                :width="zone.width"
                :height="chartHeight"
                class="column-hit"
                :class="{ 'column-hit--clickable': enablePointClick }"
                @pointerenter="setHover(zone.index)"
                @click="onPointClick(zone.index, $event)"
              />

              <line
                v-if="hoveredCoeffPoint?.valid"
                :x1="hoveredCoeffPoint.x"
                :y1="chartPadding.top"
                :x2="hoveredCoeffPoint.x"
                :y2="chartPadding.top + plotHeight"
                class="hover-guide hover-guide-coeff"
              />

              <path v-if="coeffLinePath" :d="coeffLinePath" class="line-path line-path-coeff" />

              <g
                v-for="point in coeffChartPoints"
                v-show="point.valid"
                :key="`coeff-${point.label}`"
                class="point-group"
              >
                <circle
                  :cx="point.x"
                  :cy="point.y"
                  :r="hoverIndex === point.index ? 9 : isOverviewMode ? 4 : 5"
                  class="line-point line-point-coeff"
                  :class="{ active: hoverIndex === point.index }"
                />
                <text
                  v-if="shouldShowPointValue(point.index)"
                  :x="point.x"
                  :y="point.y - 16"
                  class="point-value"
                  :class="{ 'point-value-coeff-active': hoverIndex === point.index }"
                  text-anchor="middle"
                >
                  {{ formatCoeffPercent(point.value) }}
                </text>
              </g>

              <g
                v-for="point in coeffChartPoints"
                v-show="shouldRenderLabelLayer(point.index, 'base')"
                :key="`coeff-${point.label}-label`"
              >
                <text
                  :x="point.x"
                  :y="getVersionLabelY(point.index)"
                  class="axis-label axis-label-x"
                  :class="{
                    'axis-active-coeff': hoverIndex === point.index,
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
                    'axis-active-coeff': hoverIndex === point.index,
                    'axis-date--compact': isOverviewMode,
                  }"
                  text-anchor="middle"
                >
                  <tspan :x="point.x" dy="0">{{ point.dateStart }}</tspan>
                  <tspan v-if="point.dateEnd" :x="point.x" dy="12">{{ point.dateEnd }}</tspan>
                </text>
              </g>

              <g
                v-for="point in coeffChartPoints"
                v-show="shouldRenderLabelLayer(point.index, 'active')"
                :key="`coeff-${point.label}-label-active`"
                class="axis-label-layer-active"
              >
                <text
                  :x="point.x"
                  :y="getVersionLabelY(point.index)"
                  class="axis-label axis-label-x axis-label-x--raised"
                  :class="{
                    'axis-active-coeff': hoverIndex === point.index,
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
                    'axis-active-coeff': hoverIndex === point.index,
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

        <section
          v-if="showHpCoeffCharts && isSectionVisible('coeff-exp')"
          class="chart-section"
          @pointerenter="setHoverChart('coeff-exp')"
        >
            <div class="y-axis-title y-axis-title-coeff" aria-hidden="true">
              {{ COEFF_EXPANSION_CHART_TITLE }}
            </div>
            <div class="chart-wrap">
              <svg
                class="hp-chart"
                data-chart-id="coeff-exp"
                :class="{ 'hp-chart--overview': isOverviewMode }"
                :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
                :style="{
                  height: `${chartHeight}px`,
                  width: isOverviewMode ? '100%' : undefined,
                  minWidth: isDetailMode ? `${chartWidth}px` : undefined,
                }"
                role="img"
                :aria-label="COEFF_EXPANSION_CHART_TITLE"
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

                <g v-for="tick in coeffExpansionYTicks" :key="`coeff-exp-${tick}`">
                  <line
                    :x1="chartPadding.left"
                    :y1="valueToY(tick, coeffExpansionRange.min, coeffExpansionRange.max)"
                    :x2="chartPadding.left + plotWidth"
                    :y2="valueToY(tick, coeffExpansionRange.min, coeffExpansionRange.max)"
                    :class="Math.abs(tick) < 1e-6 ? 'grid-line grid-line-baseline-coeff' : 'grid-line'"
                  />
                  <text
                    :x="chartPadding.left - 10"
                    :y="valueToY(tick, coeffExpansionRange.min, coeffExpansionRange.max) + 4"
                    class="axis-label axis-label-y"
                    :class="{ 'axis-label-y-coeff': Math.abs(tick) < 1e-6 }"
                    text-anchor="end"
                  >
                    {{ formatCoeffDelta(tick) }}
                  </text>
                </g>

                <g v-if="coeffExpansionBaselineVisible">
                  <line
                    :x1="chartPadding.left"
                    :y1="coeffExpansionBaselineY"
                    :x2="chartPadding.left + plotWidth"
                    :y2="coeffExpansionBaselineY"
                    class="baseline-line baseline-line-coeff"
                  />
                </g>

                <rect
                  v-for="zone in columnZones"
                  :key="`coeff-exp-zone-${zone.index}`"
                  :x="zone.x1"
                  y="0"
                  :width="zone.width"
                  :height="chartHeight"
                  class="column-hit"
                  :class="{ 'column-hit--clickable': enablePointClick }"
                  @pointerenter="setHover(zone.index)"
                  @click="onPointClick(zone.index, $event)"
                />

                <line
                  v-if="hoveredCoeffExpansionPoint?.valid"
                  :x1="hoveredCoeffExpansionPoint.x"
                  :y1="chartPadding.top"
                  :x2="hoveredCoeffExpansionPoint.x"
                  :y2="chartPadding.top + plotHeight"
                  class="hover-guide hover-guide-coeff"
                />

                <path
                  v-if="coeffExpansionLinePath"
                  :d="coeffExpansionLinePath"
                  class="line-path line-path-coeff"
                />

                <g
                  v-for="point in coeffExpansionChartPoints"
                  v-show="point.valid"
                  :key="`coeff-exp-${point.label}`"
                  class="point-group"
                >
                  <circle
                    :cx="point.x"
                    :cy="point.y"
                    :r="hoverIndex === point.index ? 9 : isOverviewMode ? 4 : 5"
                    class="line-point line-point-coeff"
                    :class="{ active: hoverIndex === point.index }"
                  />
                  <text
                    v-if="shouldShowPointValue(point.index)"
                    :x="point.x"
                    :y="point.y - 16"
                    class="point-value"
                    :class="{ 'point-value-coeff-active': hoverIndex === point.index }"
                    text-anchor="middle"
                  >
                    {{ formatCoeffDelta(point.value) }}
                  </text>
                </g>

                <g
                  v-for="point in coeffExpansionChartPoints"
                  v-show="shouldRenderLabelLayer(point.index, 'base')"
                  :key="`coeff-exp-${point.label}-label`"
                >
                  <text
                    :x="point.x"
                    :y="getVersionLabelY(point.index)"
                    class="axis-label axis-label-x"
                    :class="{
                      'axis-active-coeff': hoverIndex === point.index,
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
                      'axis-active-coeff': hoverIndex === point.index,
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
      <span class="hint-desktop">
        详细模式：左右拖拽或横向滚动可查看全部期数；底部期数标签完整可见。
        <template v-if="isHoverPreviewEnabled">悬停数据点预览详情，</template>
        <template v-if="pointClickHint">{{ pointClickHint }}</template>
        <template v-else-if="enablePointClick">点击打开往期详细</template>
        <template v-if="isHoverPreviewEnabled">；按 H 隐藏小窗</template>
        <template v-else-if="showRemoveModeToggle">；点击数据点可移除期数</template>
      </span>
      <span class="hint-mobile">
        左右滑动查看期数；点选数据点打开详情
        <template v-if="isHoverPreviewEnabled">（可勾选隐藏小窗）</template>
      </span>
    </p>
    <p v-else-if="enablePointClick && !isChartEmpty" class="scroll-hint">
      <span class="hint-desktop">
        {{ isHoverPreviewEnabled ? '悬停数据点预览详情，' : '' }}{{ pointClickHint ?? '点击打开往期详细'
        }}<template v-if="isHoverPreviewEnabled">；按 H 隐藏小窗</template
        ><template v-if="isOverviewMode">；按 D 隐藏日期</template>
      </span>
      <span class="hint-mobile">点选数据点打开详情<template v-if="isOverviewMode">；可隐藏日期</template></span>
    </p>
    <p v-else-if="isHoverPreviewEnabled && !isChartEmpty" class="scroll-hint">
      <span class="hint-desktop"
        >悬停数据点预览详情；按 H 隐藏小窗<template v-if="isOverviewMode">，按 D 隐藏日期</template></span
      >
      <span class="hint-mobile">点选数据点预览详情<template v-if="isOverviewMode">；可隐藏日期</template></span>
    </p>

    <ChartPointRoomBuffTooltip
      :visible="showRoomBuffTooltip && isRoomBuffPreviewEnabled"
      :phase-label="hoveredChartPoint?.label ?? ''"
      :room-buff="hoveredRoomBuff"
      :position-style="bossTooltipStyle"
    />

    <ChartPointSeriesTooltip
      :visible="showSeriesTooltip && isSeriesTooltipEnabled"
      :phase-label="hoveredChartPoint?.label ?? ''"
      :chart-title="seriesTooltipTitle"
      :rows="seriesTooltipRows"
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

.charts-panel--borderless {
  border: none;
  border-radius: 0;
  background: transparent;
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
  overflow-y: auto;
  cursor: grab;
  touch-action: pan-x pan-y;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-border-hover) 70%, transparent) transparent;
}

.charts-scroll--overview {
  overflow-x: hidden;
  overflow-y: auto;
  cursor: default;
  touch-action: auto;
}

.charts-scroll::-webkit-scrollbar {
  height: 10px;
  width: 10px;
}

.charts-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-border-hover) 65%, transparent);
  border-radius: 999px;
}

.charts-scroll::-webkit-scrollbar-track {
  background: transparent;
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
  min-height: 100%;
  padding: 0.35rem 0.35rem 0.55rem;
  box-sizing: border-box;
}

.charts-stack--overview {
  width: 100%;
}

.chart-section {
  flex: 0 0 auto;
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
  color: #111111;
}

html[data-theme='dark'] .y-axis-title-hp {
  color: #ffffff;
}

.y-axis-title-expansion {
  color: #e85d4c;
}

.y-axis-title-coeff {
  color: #9b6bff;
}

.chart-visibility {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.85rem;
  padding: 0.35rem 0.75rem 0.55rem;
  border-bottom: 1px solid var(--color-border);
}

.chart-visibility__label {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--color-text);
  opacity: 0.72;
}

.chart-visibility__item {
  font-size: 0.78rem;
}

.score-legend {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 1rem;
  padding: 0.35rem 0.75rem 0.55rem;
  border-bottom: 1px solid var(--color-border);
}

.score-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--color-text);
}

.score-legend-swatch {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 999px;
  background: currentColor;
}

.score-legend-swatch--total {
  background: #e85d4c;
}

.line-path-score {
  fill: none;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.92;
}

.line-point-score {
  stroke-width: 1.5;
  fill-opacity: 0.95;
}

.chart-wrap {
  flex: 1;
  min-width: 0;
  overflow: visible;
}

.hp-chart {
  display: block;
  overflow: visible;
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
  stroke: #e85d4c;
  stroke-width: 1.5;
  stroke-dasharray: none;
  opacity: 0.45;
}

.grid-line-baseline-coeff {
  stroke: #9b6bff;
  stroke-width: 1.5;
  stroke-dasharray: none;
  opacity: 0.45;
}

.baseline-line {
  stroke: #e85d4c;
  stroke-width: 2;
  stroke-dasharray: 8 5;
  opacity: 0.9;
  pointer-events: none;
}

.baseline-line-coeff {
  stroke: #9b6bff;
}

.baseline-label {
  fill: #e85d4c;
  font-size: 10px;
  font-weight: 700;
  pointer-events: none;
}

.axis-label-y-baseline {
  fill: #e85d4c;
  font-weight: 700;
  opacity: 1;
}

.axis-label-y-coeff {
  fill: #9b6bff;
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
  stroke: #e85d4c;
}

.hover-guide-coeff {
  stroke: #9b6bff;
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
  stroke: #e85d4c;
}

.line-path-coeff {
  stroke: #9b6bff;
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
  fill: #e85d4c;
}

.line-point-coeff {
  fill: #9b6bff;
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

.line-point-coeff.active {
  filter: drop-shadow(0 0 6px rgba(155, 107, 255, 0.55));
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
  fill: #e85d4c;
  font-size: 14px;
  font-weight: 700;
  opacity: 1;
}

.point-value-coeff-active {
  fill: #9b6bff;
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
  fill: #e85d4c;
  font-size: 13px;
}

.axis-active-coeff {
  fill: #9b6bff;
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
.axis-date.axis-active-expansion,
.axis-date.axis-active-coeff {
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

.hint-mobile {
  display: none;
}

@media (max-width: 768px) {
  .chart-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.45rem;
    padding: 0.5rem 0.55rem;
  }

  .toolbar-main {
    gap: 0.45rem;
  }

  .toolbar-toggles {
    flex-wrap: wrap;
    gap: 0.55rem;
    justify-content: flex-start;
  }

  .phase-search {
    width: 100%;
  }

  .phase-search-input {
    flex: 1;
    min-width: 0;
    width: auto;
  }

  .mode-btn {
    min-width: 3.6rem;
    padding: 0.35rem 0.65rem;
  }

  .shortcut-hint {
    display: none;
  }

  .y-axis-title {
    width: 1.35rem;
    font-size: 0.72rem;
    letter-spacing: 0.02em;
  }

  .scroll-hint {
    padding: 0.3rem 0.55rem 0.45rem;
    font-size: 0.68rem;
    line-height: 1.35;
  }

  .hint-desktop {
    display: none;
  }

  .hint-mobile {
    display: inline;
  }

  .date-toggle {
    white-space: normal;
  }
}
</style>
