import { computed, onBeforeUnmount, ref } from 'vue'

/**
 * 表格列宽拖拽（按比例）
 *
 * 为什么用比例而不是像素：
 * 表格是 `width: 100%`（占满容器，不破坏现有布局）。若列宽用像素，浏览器会把
 * 富余空间按比例分摊给各列，拖拽值与实际宽度对不上（拖 100px 只动 40px）。
 * 用比例则「拖多少就是多少」：位移 px 换算成容器宽的百分比，且始终占满。
 *
 * 开销：
 * - 静止时：只有每个手柄一个 `mousedown` 监听，无 mousemove、无定时器、无重排。
 * - 拖拽中：只改 `<col>` 的宽度（一次样式写入），mousemove 为原生事件直连。
 * - 松手后：立即移除全部监听，并写一次 localStorage。
 */

export interface ResizableColumnSpec {
  /** 列标识，同时用作持久化字段名 */
  key: string
  /** 默认占比（百分比；同表各项之和建议为 100） */
  defaultRatio: number
  /** 最小宽度（px，拖拽时换算成占比下限，避免拖到看不见字） */
  minWidthPx?: number
}

const DEFAULT_MIN_WIDTH_PX = 56
const MIN_RATIO_FLOOR = 4

export function useResizableColumns(storageKey: string, specs: ResizableColumnSpec[]) {
  const defaultRatios = (): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const spec of specs) out[spec.key] = spec.defaultRatio
    return out
  }

  const readStoredRatios = (): Record<string, number> => {
    const fallback = defaultRatios()
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return fallback
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const spec of specs) {
        const value = parsed[spec.key]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        fallback[spec.key] = Math.max(MIN_RATIO_FLOOR, value)
      }
      return fallback
    } catch {
      // 存档损坏或隐私模式：回落默认比例，不影响使用
      return fallback
    }
  }

  const ratios = ref<Record<string, number>>(readStoredRatios())
  /** 正在拖拽的列（用于高亮竖线） */
  const resizingKey = ref<string | null>(null)
  let detachListeners: (() => void) | null = null

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(ratios.value))
    } catch {
      // 配额满 / 隐私模式：静默忽略
    }
  }

  /**
   * 横向滚动容器（由组件用 `ref` 传进来）。
   * 用它而不是 `<table>` 本身测宽：容器宽度才是列宽比例的基准。
   */
  const containerWidth = ref(0)

  const ratioOf = (key: string) => ratios.value[key] ?? 0

  const totalPercent = computed(() =>
    specs.reduce((sum, spec) => sum + (ratios.value[spec.key] ?? spec.defaultRatio), 0),
  )

  const startResize = (key: string, event: MouseEvent, host?: HTMLElement | null) => {
    const spec = specs.find((item) => item.key === key)
    if (!spec) return
    event.preventDefault()
    event.stopPropagation()
    detachListeners?.()

    // 基准宽度取横向滚动容器（= 列宽按比例分配时实际用的总宽）
    const baseWidth = host?.clientWidth || containerWidth.value || 0
    const basis = baseWidth > 0 ? baseWidth : 800
    const minWidth = spec.minWidthPx ?? DEFAULT_MIN_WIDTH_PX
    const minRatio = Math.max(MIN_RATIO_FLOOR, (minWidth / basis) * 100)

    const startX = event.clientX
    const startRatio = ratios.value[key] ?? spec.defaultRatio
    // 快照：每帧都基于「按下时的状态」重算，避免误差累积
    const startRatios = { ...ratios.value }
    const otherSpecs = specs.filter((item) => item.key !== key)
    const otherTotal = otherSpecs.reduce(
      (sum, item) => sum + (startRatios[item.key] ?? item.defaultRatio),
      0,
    )
    resizingKey.value = key

    const onMove = (move: MouseEvent) => {
      const deltaRatio = ((move.clientX - startX) / basis) * 100
      const nextTarget = Math.max(minRatio, startRatio + deltaRatio)
      const appliedDelta = nextTarget - startRatio
      if (!appliedDelta) {
        ratios.value = { ...startRatios }
        return
      }
      /**
       * 增量从**其余列按当前比例分摊扣减**，保持总和恒定。
       * 若只增大目标列，各列之和会超过 100%，浏览器会整体归一化，
       * 导致「拖了多少」与「实际宽了多少」对不上。
       */
      const next: Record<string, number> = { ...startRatios, [key]: nextTarget }
      for (const item of otherSpecs) {
        const current = startRatios[item.key] ?? item.defaultRatio
        const share = otherTotal > 0 ? current / otherTotal : 1 / Math.max(1, otherSpecs.length)
        next[item.key] = Math.max(MIN_RATIO_FLOOR, current - appliedDelta * share)
      }
      ratios.value = next
    }
    const onUp = () => {
      detachListeners?.()
      persist()
    }
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      // Esc 放弃本次拖拽，回到按下时的宽度
      if (keyEvent.key !== 'Escape') return
      ratios.value = { ...startRatios }
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
   * 双击手柄：该列恢复默认占比。
   *
   * 增量同样由其余列分摊（与拖拽一致），否则总和会偏离 100%，
   * 被浏览器归一化后该列到不了默认宽度（实测：其他列改过时只能回到 191px 而非 208px）。
   */
  const resetColumn = (key: string) => {
    const spec = specs.find((item) => item.key === key)
    if (!spec) return
    const current = ratios.value[key] ?? spec.defaultRatio
    const delta = spec.defaultRatio - current
    if (!delta) return
    const others = specs.filter((item) => item.key !== key)
    const otherTotal = others.reduce((sum, item) => sum + (ratios.value[item.key] ?? 0), 0)
    const next: Record<string, number> = { ...ratios.value, [key]: spec.defaultRatio }
    for (const item of others) {
      const cur = ratios.value[item.key] ?? item.defaultRatio
      const share = otherTotal > 0 ? cur / otherTotal : 1 / Math.max(1, others.length)
      next[item.key] = Math.max(MIN_RATIO_FLOOR, cur - delta * share)
    }
    ratios.value = next
    persist()
  }

  /** 全部恢复默认 */
  const resetAll = () => {
    ratios.value = defaultRatios()
    persist()
  }

  onBeforeUnmount(() => detachListeners?.())

  return {
    ratios,
    resizingKey,
    totalPercent,
    ratioOf,
    containerWidth,
    startResize,
    resetColumn,
    resetAll,
  }
}
