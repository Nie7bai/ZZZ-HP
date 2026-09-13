import { computed, onBeforeUnmount, ref } from 'vue'

/**
 * 表格列宽拖拽（**独立像素宽，Excel 式**）
 *
 * ## 语义（2026-09-12 用户口径）
 *
 * 拖某一列只改那一列，**别的列一动不动**：表格总宽 = 各列宽之和，
 * 超出容器就横向滚动（由容器的 `overflow: auto` 承担），不足则右侧留白 —— 与 Excel 一致。
 *
 * 改造前是「按比例分摊」：拖宽一列会按各列占比从其余列扣减、保持总和 100%。
 * 用户明确不要这个行为（「跟 excel 的列宽一样」）。
 *
 * ## 为什么会有「未拖过」这个状态
 *
 * 步骤 10 选比例是因为表格被锁定 `width: 100%`：列宽给固定像素时，浏览器会把富余空间
 * 摊给各列，拖 100px 只动 40px。要拿回「拖多少就是多少」，就得让表格总宽 = 各列之和。
 * 但又不想让首屏变成「表格只有 900px、右侧一坨留白」，于是分两段：
 *
 * - **还没拖过**（`widths` 为空）：按 `defaultRatio` 铺满容器，与改造前视觉一致；
 * - **第一次真的拖动**：把当时铺满的各列宽按「表格实测宽 × 占比」固化成像素，之后全为像素宽。
 *
 * ## 用它的组件必须给的两个东西
 *
 * 1. 传容器元素（`host`）：用来量基准宽（未拖过时按它铺满、双击复位按它算默认宽）；
 * 2. 像素态下把表格 `width` 设成各列之和（`totalWidthPx`）—— 仍写 `width: 100%` 的话，
 *    浏览器会把差值摊回各列，Excel 语义就又丢了。
 *
 * ## 开销
 *
 * - 静止时：每个手柄一个 `mousedown` 监听，无 mousemove、无定时器、无重排；
 * - 拖拽中：只改 `<col>` 宽度（一次样式写入），mousemove 为原生事件直连；
 * - 松手后：立即移除全部监听，**只有真的改过宽度**才写一次 localStorage。
 */

export interface ResizableColumnSpec {
  /** 列标识，同时用作持久化字段名 */
  key: string
  /**
   * 默认占比（百分比；各行之和为 100）。
   *
   * 只在两种时候用得上：**还没拖过时铺满容器**、**双击复位算该列默认宽**。
   * 一旦拖过，持久化的是像素宽，这个占比不参与计算。
   */
  defaultRatio: number
  /**
   * 最小宽度（px）—— **只管拖拽**：把列往左拖时不许比它更窄。
   *
   * 刻意不参与另外两处，否则会与「所见即所得」打架：
   * - 读盘（用户自己拖出来的宽度照原样恢复，不能刷新一次就变宽）；
   * - 固化 / 双击复位（基准是「铺满容器时该列占多少」，窄容器下本就可能小于它）。
   */
  minWidthPx?: number
}

const DEFAULT_MIN_WIDTH_PX = 56
/** 读盘的合法性下限：只拦 0/负数/荒谬值，不是「最小列宽」 */
const MIN_STORED_WIDTH_PX = 24
/** 量不到容器宽时的兜底基准（正常路径用不到，只为不让除零/NaN 漏进样式） */
const FALLBACK_BASIS_PX = 800

export function useResizableColumns(storageKey: string, specs: ResizableColumnSpec[]) {
  const minWidthOf = (spec: ResizableColumnSpec) => spec.minWidthPx ?? DEFAULT_MIN_WIDTH_PX

  /** 读持久化的像素宽；缺列或值非法就当没拖过（整体回落占比铺满） */
  const readStoredWidths = (): Record<string, number> => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const out: Record<string, number> = {}
      for (const spec of specs) {
        const value = parsed[spec.key]
        if (typeof value !== 'number' || !Number.isFinite(value)) return {}
        out[spec.key] = Math.max(MIN_STORED_WIDTH_PX, Math.round(value))
      }
      return out
    } catch {
      // 存档损坏或隐私模式：回落「未拖过」，不影响使用
      return {}
    }
  }

  /** 各列像素宽；**空对象 = 还没拖过**（此时按 defaultRatio 铺满容器） */
  const widths = ref<Record<string, number>>(readStoredWidths())
  /** 正在拖拽的列（用于高亮竖线） */
  const resizingKey = ref<string | null>(null)
  let detachListeners: (() => void) | null = null

  /** 是否已进入「像素宽」状态（每一列都有像素值） */
  const hasPixelWidths = computed(
    () => specs.length > 0 && specs.every((spec) => widths.value[spec.key] != null),
  )

  /** 像素态下表格应有的总宽 */
  const totalWidthPx = computed(() =>
    specs.reduce((sum, spec) => sum + (widths.value[spec.key] ?? 0), 0),
  )

  /**
   * `<col>` 的宽度值：有像素用像素，没有则用默认占比。
   *
   * 占比只可能出现在「还没拖过」这一段 —— 那时表格仍是 `width: 100%`，
   * 各列占比之和为 100%，铺满容器，与改造前的观感一致。
   */
  const widthOf = (key: string): string => {
    const px = widths.value[key]
    if (px != null) return `${px}px`
    const spec = specs.find((item) => item.key === key)
    return `${spec?.defaultRatio ?? 0}%`
  }

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths.value))
    } catch {
      // 配额满 / 隐私模式：静默忽略
    }
  }

  /** 量基准宽：优先表格实测宽（占比正是按它解析的），退回容器宽 */
  const measureBasis = (host?: HTMLElement | null): number => {
    const table = host?.querySelector('table')
    const width = table?.getBoundingClientRect().width ?? host?.clientWidth ?? 0
    return width > 0 ? Math.round(width) : FALLBACK_BASIS_PX
  }

  /**
   * 量**容器**宽（= 表格铺满时该有的宽）。
   *
   * 与 `measureBasis` 的区别：像素态下表格总宽是各列之和（可能比容器窄/宽），
   * 那时再拿表格宽当基准就错了 —— 「默认宽」的定义是「铺满容器时该列占多少」。
   */
  const measureContainerBasis = (host?: HTMLElement | null): number => {
    const width = host?.clientWidth ?? 0
    return width > 0 ? Math.round(width) : measureBasis(host)
  }

  /** 按占比把基准宽摊成像素（用于「第一次拖动」的固化与「双击复位」） */
  const ratiosToPixels = (basis: number): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const spec of specs) {
      // 故意**不**夹最小宽：固化要的就是「屏幕上此刻的宽度」，夹了会让其它列凭空变宽
      // （窄容器下实测：容器 383px、占比 22% 只有 84px，一夹到 120px 其余列全跟着跳）
      out[spec.key] = Math.round((basis * spec.defaultRatio) / 100)
    }
    return out
  }

  const startResize = (key: string, event: MouseEvent, host?: HTMLElement | null) => {
    const spec = specs.find((item) => item.key === key)
    if (!spec) return
    event.preventDefault()
    event.stopPropagation()
    detachListeners?.()

    const basis = measureBasis(host)
    /** 「未拖过」时各列的像素宽：拖动一旦发生就用它固化 */
    const frozenWidths = hasPixelWidths.value ? { ...widths.value } : ratiosToPixels(basis)
    const startWidths = widths.value
    const startWidth = frozenWidths[key] ?? minWidthOf(spec)
    /**
     * 本列的拖拽下限。
     *
     * 取 `min(minWidthPx, 按下时的宽)`：容器很窄时（列已被挤到比下限还窄），
     * 直接用 minWidthPx 会让「往左拖」反而把列**拉宽** —— 下限是「不许更窄」，不是「必须这么宽」。
     */
    const floor = Math.min(minWidthOf(spec), startWidth)
    const startX = event.clientX
    let applied = false
    let changed = false
    resizingKey.value = key

    const onMove = (move: MouseEvent) => {
      const delta = move.clientX - startX
      // 位移为 0 不动：避免「只点一下手柄」就把占比布局固化成像素
      if (!delta && !applied) return
      if (!applied) {
        applied = true
        // 固化：这一帧起所有列都是像素宽，未拖的列保持当前视觉宽度不变
        widths.value = frozenWidths
      }
      const next = Math.max(floor, Math.round(startWidth + delta))
      if (widths.value[key] === next) return
      widths.value = { ...widths.value, [key]: next }
      changed = true
    }

    const onUp = () => {
      const didChange = changed
      detachListeners?.()
      if (didChange) persist()
    }

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      // Esc 放弃本次拖拽，回到按下时的宽度
      if (keyEvent.key !== 'Escape') return
      widths.value = startWidths
      detachListeners?.()
    }

    detachListeners = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      resizingKey.value = null
      detachListeners = null
    }

    // 拖拽期间光标保持 col-resize、禁止选中文字（否则会刷选整页）
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    // mousemove / mouseup 挂 window：拖出表格甚至拖出窗口也不会丢事件
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKeyDown)
  }

  /**
   * 双击手柄：该列恢复默认宽（**容器宽** × 默认占比）。
   *
   * **只改这一列** —— 与 Excel 里「把列宽设回默认」同理，其余列保持用户调过的宽度。
   * 还没拖过时本就等于默认，直接不做事。
   */
  const resetColumn = (key: string, host?: HTMLElement | null) => {
    const spec = specs.find((item) => item.key === key)
    if (!spec) return
    if (!hasPixelWidths.value) return
    const target = ratiosToPixels(measureContainerBasis(host))[key]
    if (target == null || widths.value[key] === target) return
    widths.value = { ...widths.value, [key]: target }
    persist()
  }

  /** 全部恢复默认（回到「去拖过」状态：按占比铺满容器） */
  const resetAll = () => {
    widths.value = {}
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // 同 persist：存不了就只在本次会话生效
    }
  }

  onBeforeUnmount(() => detachListeners?.())

  return {
    widths,
    resizingKey,
    hasPixelWidths,
    totalWidthPx,
    widthOf,
    startResize,
    resetColumn,
    resetAll,
  }
}
