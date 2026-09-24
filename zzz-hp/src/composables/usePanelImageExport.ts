import { nextTick, onScopeDispose, ref } from 'vue'
import { toBlob } from 'html-to-image'
import {
  buildCaptureStyleProperties,
  buildPanelImageFilename,
  CAPTURE_CLASS,
  collectInlineHeightRestores,
  isSingleLineFlexRow,
  PANEL_HOST_SELECTOR,
  PANEL_PORTAL_ID,
  resolveCaptureHeight,
  resolveCapturePixelRatio,
  resolveCaptureTarget,
} from '@/utils/panelImageExport'

/**
 * 把三大模式的当前面板导出成 PNG：下载 + 复制到剪贴板。
 *
 * 为什么不能直接截 `.mode-content`、面板的两种滚动形态怎么展开、
 * 以及为何要显式给底色，见 dev-docs/panel-image-export.md §3.3 / §3.4 / §3.5。
 */

export interface PanelImageExportStatus {
  text: string
  tone: 'ok' | 'warn' | 'error'
}

export interface UsePanelImageExportOptions {
  /** 当前模式（危局强袭 / 防卫战 / 临界推演），用于文件名 */
  mode: () => string
  /** 当前面板 id，用于文件名 */
  panelId: () => string
}

const STATUS_OK_MS = 2400
const STATUS_ERROR_MS = 6000
const FALLBACK_BACKGROUND = '#101014'

/** 面板自身多为透明背景、点阵纹理挂在父级，因此从宿主取实色底，取不到才用兜底值。 */
function readPanelBackgroundColor(): string {
  const host = document.querySelector<HTMLElement>(PANEL_HOST_SELECTOR)
  if (!host) return FALLBACK_BACKGROUND
  const color = window.getComputedStyle(host).backgroundColor
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
    return FALLBACK_BACKGROUND
  }
  return color
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function usePanelImageExport(options: UsePanelImageExportOptions) {
  const busy = ref(false)
  const status = ref<PanelImageExportStatus | null>(null)
  let statusTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 展开面板内**所有内部可滚动**的容器，返回还原函数。
   *
   * 面板里可能藏着自带滚动区的容器（图表的 `.charts-scroll`、内容较长的内层列表等）。
   * 它们在页面上是「裁剪 + 滚动」，克隆体里却会被完整渲染 —— 两边高度对不上，成图就被截断
   * （实测临界推演内容量翻倍时，末尾整节 `结局2 · 3-4` 缺失）。
   *
   * 不靠类名穷举，直接按 `scrollHeight > clientHeight` 判定实际溢出；把 overflow 放开后
   * 计算样式随之变化，克隆体复制到的是放开后的值，两边保持一致。
   */
  function expandScrollableDescendants(root: HTMLElement): () => void {
    const restores: Array<() => void> = []

    for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      if (element.scrollHeight <= element.clientHeight + 1) continue
      const previous = {
        overflow: element.style.overflow,
        height: element.style.height,
        maxHeight: element.style.maxHeight,
      }
      element.style.overflow = 'visible'
      element.style.height = 'auto'
      element.style.maxHeight = 'none'
      restores.push(() => {
        element.style.overflow = previous.overflow
        element.style.height = previous.height
        element.style.maxHeight = previous.maxHeight
      })
    }

    return () => {
      for (const restore of restores) restore()
    }
  }

  /**
   * 截图前把「页面上本来就是单行」的可换行 flex 行锁成 nowrap，返回还原函数。
   *
   * 为什么需要：克隆体在 foreignObject 里没有样式表、无法重新布局，行内末尾元素
   * （危局血量行的 `+17.2%`）会被多折出一行，与页面实况不符。把实况就是单行的行锁死，
   * 克隆体就不可能多折；**页面上本来就换行的行一律不动**，与页面行为保持一致。
   */
  function preserveSingleLineFlexRows(root: HTMLElement): () => void {
    const restores: Array<() => void> = []

    for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      const style = window.getComputedStyle(element)
      if (!style.display.includes('flex') || style.flexWrap !== 'wrap') continue

      const children = Array.from(element.children).filter(
        (child) => child.getBoundingClientRect().height > 0,
      )
      if (children.length < 2) continue

      const childHeights = children.map((child) => child.getBoundingClientRect().height)
      if (!isSingleLineFlexRow(element.getBoundingClientRect().height, childHeights)) continue

      const previous = element.style.flexWrap
      element.style.flexWrap = 'nowrap'
      restores.push(() => {
        element.style.flexWrap = previous
      })
    }

    return () => {
      for (const restore of restores) restore()
    }
  }

  function clearStatusTimer() {
    if (statusTimer !== null) {
      clearTimeout(statusTimer)
      statusTimer = null
    }
  }

  function setStatus(text: string, tone: PanelImageExportStatus['tone']) {
    clearStatusTimer()
    status.value = { text, tone }
    statusTimer = setTimeout(
      () => {
        status.value = null
        statusTimer = null
      },
      tone === 'ok' ? STATUS_OK_MS : STATUS_ERROR_MS,
    )
  }

  onScopeDispose(clearStatusTimer)

  async function renderCurrentPanel(): Promise<{
    blob: Blob
    downscaled: boolean
    exceedsLimits: boolean
  }> {
    const host = document.querySelector<HTMLElement>(PANEL_HOST_SELECTOR)
    const target = resolveCaptureTarget(host, PANEL_PORTAL_ID)
    if (!(target instanceof HTMLElement)) {
      throw new Error('找不到当前面板节点')
    }

    // 展开、放开高度、单行锁定都会改动布局：必须用 finally 无条件还原
    target.classList.add(CAPTURE_CLASS)
    let heightRestores: Array<() => void> = []
    let restoreScrollables: () => void = () => {}
    let restoreFlexWrap: () => void = () => {}
    try {
      await nextTick()
      // 先展开所有内部滚动容器，否则它们的内容在页面被裁、在克隆体却完整
      restoreScrollables = expandScrollableDescendants(target)
      await nextTick()
      // 再让页面高度规则与克隆体一致（克隆体不复制 height）
      heightRestores = collectInlineHeightRestores(target)
      await nextTick()
      // 布局稳定后再判断哪些行在页面上是单行，并锁成 nowrap
      restoreFlexWrap = preserveSingleLineFlexRows(target)
      const width = Math.max(target.scrollWidth, target.offsetWidth)
      // 高度追加有界余量：克隆体可能比页面略高，否则底部会被裁（见 resolveCaptureHeight）
      const height = resolveCaptureHeight(Math.max(target.scrollHeight, target.offsetHeight))
      const decision = resolveCapturePixelRatio(width, height, window.devicePixelRatio || 1)
      const blob = await toBlob(target, {
        backgroundColor: readPanelBackgroundColor(),
        width,
        height,
        pixelRatio: decision.pixelRatio,
        cacheBust: true,
        // 高度类属性不复制，交给克隆体按内容自然撑开：
        // 否则折行会与冻结的单行行高冲突，折下来的内容会压住下一行
        includeStyleProperties: buildCaptureStyleProperties(
          window.getComputedStyle(document.documentElement),
        ),
      })
      if (!blob) throw new Error('生成图片为空')
      return { blob, downscaled: decision.downscaled, exceedsLimits: decision.exceedsLimits }
    } finally {
      restoreFlexWrap()
      for (const restore of heightRestores) restore()
      restoreScrollables()
      target.classList.remove(CAPTURE_CLASS)
      await nextTick()
    }
  }

  async function runAction(action: 'download' | 'copy') {
    if (busy.value) return
    busy.value = true
    status.value = null
    try {
      const { blob, downscaled, exceedsLimits } = await renderCurrentPanel()
      // 压到下限仍超限时不宣称成功：成图可能被截断或为空
      const tone: PanelImageExportStatus['tone'] = exceedsLimits ? 'warn' : 'ok'
      const suffix = exceedsLimits
        ? '（内容过长，已超浏览器画布上限，成图可能被截断）'
        : downscaled
          ? '（已按画布上限压缩）'
          : ''

      if (action === 'download') {
        triggerDownload(blob, buildPanelImageFilename(options.mode(), options.panelId(), new Date()))
        setStatus(`已下载${suffix}`, tone)
        return
      }

      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器不支持复制图片')
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setStatus(`已复制到剪贴板${suffix}`, tone)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setStatus(`失败：${reason}`, 'error')
      window.alert(`生成面板图片失败：${reason}`)
    } finally {
      busy.value = false
    }
  }

  return {
    busy,
    status,
    downloadPanelImage: () => runAction('download'),
    copyPanelImage: () => runAction('copy'),
  }
}
