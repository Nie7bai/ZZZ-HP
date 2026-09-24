/**
 * 面板导出图片的纯逻辑：截图目标解析、文件名、画布上限与像素比。
 *
 * 这里不碰 DOM，便于 scripts/test-panel-image-export.mjs 用 vite-node 直接回归；
 * 有副作用的编排（展开、截图、下载、剪贴板）在 composables/usePanelImageExport.ts。
 * 背景、取舍与风险见 dev-docs/panel-image-export.md。
 */

/** 当前面板的宿主容器（ModeLayout 里的 <main>）。 */
export const PANEL_HOST_SELECTOR = 'main.mode-content'

/**
 * 传送门承载模态层（position:absolute;inset:0;z-index:100）。
 * 截图必须排除它，否则打开的模态会被一并拍进图里。
 */
export const PANEL_PORTAL_ID = 'mode-content-portal'

/** 截图期间临时加在面板根节点上的类，样式见 assets/panelImageExport.css。 */
export const CAPTURE_CLASS = 'zzz-capture-expand'

/**
 * 浏览器画布上限。各浏览器不等（Chrome 单边 65535、总面积约 2.68 亿像素，Safari / iOS 明显更低），
 * 这里取保守值：超限时压低像素比，而不是产出一张空白图。
 */
export const MAX_CAPTURE_CANVAS_EDGE = 16384
export const MAX_CAPTURE_CANVAS_AREA = 64 * 1024 * 1024
export const MIN_CAPTURE_PIXEL_RATIO = 0.5

export interface CapturePixelRatioDecision {
  pixelRatio: number
  /** 是否因画布上限被压到低于期望值 */
  downscaled: boolean
  /**
   * 即使压到 MIN_CAPTURE_PIXEL_RATIO 仍超出画布上限。
   * 此时成图可能被截断或为空，调用方应提示而不是宣称成功。
   */
  exceedsLimits: boolean
}

/** 只依赖 children 与 id，便于用普通对象做回归测试。 */
export interface CaptureHostLike<T extends { id: string }> {
  children: ArrayLike<T>
}

/**
 * 截图时**不复制**的尺寸类属性。
 *
 * html-to-image 会把每个元素的 computed height 当作内联 px 写进克隆体。克隆体渲染在
 * SVG `<foreignObject>` 里、**没有样式表**，因此无法重新布局：只要出现任何微小回流，
 * 行内末尾元素就会折到下一行，而被冻结的行高仍是单行值 —— 折下来的那一行就溢出并
 * 压住下一行。这正是「血量 +17.2% 与增量重叠」「元素图标折行压行」的成因。
 *
 * 只排除**高度**：克隆体按内容自然撑开，行高随折行正确增长，不再重叠。
 * `min-height` / `max-height` / 宽度类属性一律保留 —— 保留宽度是必需的，
 * 否则宽度依赖样式表的元素（危局「绝境房间」的 `.enemy-card--hard`）会塌成最小内容宽。
 *
 * ⚠️ 排除高度有个副作用：克隆体总高可能**高于**页面量出的高度，成图底部会被裁
 * （实测临界推演少截最后一行）。因此测量前必须让页面按同一规则布局 —— 见
 * `collectInlineHeightRestores()`。
 */
export const CAPTURE_SIZE_EXCLUDED_PROPERTIES: readonly string[] = ['height', 'block-size']

/**
 * 收集「把元素高度放开」的还原函数，使**页面布局与克隆体一致**，量出的高度才不会偏小。
 *
 * 克隆体只保留元素**内联**的 height（`cloneNode` 会带走 style 属性），其余 height 都
 * 变成 auto。所以这里同样只处理**没有内联 height** 的元素，两边规则严格对齐；
 * 图表 `<svg>` 的高度写在内联 style 上，因此两边都不受影响。
 */
export function collectInlineHeightRestores(root: HTMLElement): Array<() => void> {
  const restores: Array<() => void> = []

  for (const element of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (element.style.height) continue // 内联高度在克隆体里会保留，不要动
    const computed = window.getComputedStyle(element).height
    if (!computed || computed === 'auto') continue
    const previous = element.style.height
    element.style.height = 'auto'
    restores.push(() => {
      element.style.height = previous
    })
  }

  return restores
}

/**
 * 截图高度的余量下限（px）与比例。
 *
 * 为什么要留余量：克隆体不复制 `height`，个别元素会比页面略高。即使已经
 * 「展开内部滚动容器 + 让页面按同一规则布局」（见 `collectInlineHeightRestores`），
 * 仍可能残留几十像素的差 —— 实测临界推演 `LAST STAGE`（千面终局）尾部**恰好少一行
 * 怪物卡（约 80px）**。与其继续追平每一处布局，不如留一个有界余量保证不裁切；
 * 代价是底部最多多出一条与页面同色的空白。
 *
 * 取 6% 且不低于 40px。实测临界推演 `LAST STAGE`：量出 3707、真实内容 3884，
 * 克隆体高 **177px（4.8%）**；6% 余量（约 222px）可覆盖并留有余量，代价是底部约
 * 45px（1.2%）的空白。
 */
export const CAPTURE_HEIGHT_HEADROOM_MIN = 40
export const CAPTURE_HEIGHT_HEADROOM_RATIO = 0.06

/** 在量出的高度上追加有界余量，避免克隆体略高时底部被裁。 */
export function resolveCaptureHeight(measuredHeight: number): number {
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return 0
  const headroom = Math.max(CAPTURE_HEIGHT_HEADROOM_MIN, measuredHeight * CAPTURE_HEIGHT_HEADROOM_RATIO)
  return Math.ceil(measuredHeight + headroom)
}

/** 从 computed style 的属性全集里剔除高度类属性，供 toBlob 的 includeStyleProperties 使用。 */
export function buildCaptureStyleProperties(allProperties: ArrayLike<string>): string[] {
  const excluded = new Set(CAPTURE_SIZE_EXCLUDED_PROPERTIES)
  return Array.from(allProperties).filter((name) => !excluded.has(name))
}

/**
 * 判断一个可换行 flex 行在**当前页面布局**下是否只有一行。
 *
 * 依据：容器高度不大于最高的子元素高度。换行会让容器多出一行的高度，
 * 因此 `containerHeight > tallestChild + tolerance` 即视为已换行。
 *
 * 截图前用它决定是否把该行锁成 `nowrap`，见 composables/usePanelImageExport.ts。
 */
export function isSingleLineFlexRow(
  containerHeight: number,
  childHeights: readonly number[],
  tolerance = 4,
): boolean {
  if (childHeights.length < 2) return true
  const tallest = Math.max(...childHeights)
  if (!Number.isFinite(containerHeight) || !Number.isFinite(tallest)) return true
  return containerHeight <= tallest + tolerance
}

/**
 * 取当前面板根节点：宿主容器的第一个非传送门子元素。
 * 面板由 KeepAlive + v-else-if 只挂载一个，且传送门恒为首个子元素。
 * 取不到返回 null —— 调用方据此报错，不做猜测性回退。
 */
export function resolveCaptureTarget<T extends { id: string }>(
  host: CaptureHostLike<T> | null | undefined,
  portalId: string = PANEL_PORTAL_ID,
): T | null {
  if (!host) return null
  const children = Array.from(host.children)
  return children.find((child) => child.id !== portalId) ?? null
}

/** 按边长与总面积上限，把期望像素比压到浏览器画布能承受的值。 */
export function resolveCapturePixelRatio(
  width: number,
  height: number,
  desiredPixelRatio: number,
): CapturePixelRatioDecision {
  const desired =
    Number.isFinite(desiredPixelRatio) && desiredPixelRatio > 0 ? desiredPixelRatio : 1

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { pixelRatio: desired, downscaled: false, exceedsLimits: false }
  }

  const edgeLimit = Math.min(MAX_CAPTURE_CANVAS_EDGE / width, MAX_CAPTURE_CANVAS_EDGE / height)
  const areaLimit = Math.sqrt(MAX_CAPTURE_CANVAS_AREA / (width * height))
  const allowed = Math.min(edgeLimit, areaLimit)
  const pixelRatio = Math.max(MIN_CAPTURE_PIXEL_RATIO, Math.min(desired, allowed))

  return {
    pixelRatio,
    downscaled: pixelRatio < desired,
    exceedsLimits: allowed < MIN_CAPTURE_PIXEL_RATIO,
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 本地时间戳 yyyyMMdd-HHmmss，与项目其它导出文件的日期风格一致。 */
export function formatCaptureStamp(date: Date): string {
  const datePart = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
  const timePart = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  return `${datePart}-${timePart}`
}

/** zzz-hp-<模式>-<面板>-<时间戳>.png */
export function buildPanelImageFilename(mode: string, panelId: string, date: Date): string {
  const safeMode = mode.trim() || 'mode'
  const safePanel = panelId.trim() || 'panel'
  return `zzz-hp-${safeMode}-${safePanel}-${formatCaptureStamp(date)}.png`
}
