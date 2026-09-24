/**
 * 面板导出图片 · 纯逻辑回归测试。
 *
 * 覆盖 src/utils/panelImageExport.ts：
 * 截图目标解析、画布上限与像素比决策、文件名生成。
 *
 * 边界：真正依赖浏览器 canvas 与 html-to-image 的成像部分**无法在 node 侧覆盖**，
 * 只能靠 dev-docs/panel-image-export.md §5 的人工矩阵（三模式 × 全面板）。
 * 这里只守住容易写错、又完全可判定的那部分逻辑。
 *
 * 运行：npx vite-node scripts/test-panel-image-export.mjs
 */
import {
  buildCaptureStyleProperties,
  buildPanelImageFilename,
  CAPTURE_SIZE_EXCLUDED_PROPERTIES,
  formatCaptureStamp,
  isSingleLineFlexRow,
  MAX_CAPTURE_CANVAS_AREA,
  MAX_CAPTURE_CANVAS_EDGE,
  MIN_CAPTURE_PIXEL_RATIO,
  PANEL_PORTAL_ID,
  resolveCaptureHeight,
  resolveCapturePixelRatio,
  resolveCaptureTarget,
} from '../src/utils/panelImageExport.ts'

let failed = 0
let passed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const portal = { id: PANEL_PORTAL_ID }
// 真实面板的根节点没有 id（HTMLElement.id === ''）
const panel = { id: '', tag: 'panel' }
const otherPanel = { id: '', tag: 'other' }

console.log('\n[截图目标解析：必须排除传送门]')
{
  check('host 为 null → null', resolveCaptureTarget(null) === null)
  check('host 为 undefined → null', resolveCaptureTarget(undefined) === null)
  check('无子元素 → null', resolveCaptureTarget({ children: [] }) === null)
  check('只有传送门 → null（不猜测性回退）', resolveCaptureTarget({ children: [portal] }) === null)
  check(
    '传送门在首位 → 取后面那个面板',
    resolveCaptureTarget({ children: [portal, panel] }) === panel,
  )
  check(
    '传送门缺失 → 取第一个子元素',
    resolveCaptureTarget({ children: [panel] }) === panel,
  )
  check(
    '多个面板时取传送门之后的第一个',
    resolveCaptureTarget({ children: [portal, otherPanel, panel] }) === otherPanel,
  )
  check(
    '自定义 portalId 生效',
    resolveCaptureTarget({ children: [{ id: 'custom-portal' }, panel] }, 'custom-portal') === panel,
  )

  // 真实 DOM 给的是 HTMLCollection（array-like），不是数组
  const arrayLike = { length: 2, 0: portal, 1: panel }
  check('array-like children（HTMLCollection 形态）可解析', resolveCaptureTarget({ children: arrayLike }) === panel)
}

console.log('\n[像素比：正常尺寸不降级]')
{
  const small = resolveCapturePixelRatio(1200, 800, 2)
  check('1200×800 @2 → 2', small.pixelRatio === 2, `${small.pixelRatio}`)
  check('1200×800 @2 未降级', small.downscaled === false)
  check('1200×800 @2 未超限', small.exceedsLimits === false)

  const tallButFits = resolveCapturePixelRatio(1200, 8000, 2)
  check('1200×8000 @2 仍为 2（16000 ≤ 16384）', tallButFits.pixelRatio === 2, `${tallButFits.pixelRatio}`)
  check('1200×8000 @2 未降级', tallButFits.downscaled === false)
}

console.log('\n[像素比：超限时降级]')
{
  const veryTall = resolveCapturePixelRatio(1200, 20000, 2)
  check('1200×20000 @2 被降级', veryTall.downscaled === true, `${veryTall.pixelRatio.toFixed(4)}`)
  check('降级后未超限', veryTall.exceedsLimits === false)
  check(
    '降级后高度落在上限内',
    20000 * veryTall.pixelRatio <= MAX_CAPTURE_CANVAS_EDGE + 1e-6,
    `${(20000 * veryTall.pixelRatio).toFixed(2)} ≤ ${MAX_CAPTURE_CANVAS_EDGE}`,
  )

  // 边界：4000×4000 @2 = 6400 万像素，仍在 64 MiB（6710.9 万）上限内，不该降级
  const justFits = resolveCapturePixelRatio(4000, 4000, 2)
  check(
    '4000×4000 @2（6400 万像素）恰好在上限内，不降级',
    justFits.downscaled === false && justFits.pixelRatio === 2,
    `ratio=${justFits.pixelRatio}`,
  )

  // 4000×5000 @2 = 8000 万像素，超过上限，必须降级
  const hugeArea = resolveCapturePixelRatio(4000, 5000, 2)
  check(
    '4000×5000 @2（8000 万像素）被降级',
    hugeArea.downscaled === true,
    `${hugeArea.pixelRatio.toFixed(4)}`,
  )
  check(
    '降级后面积不大于上限',
    4000 * 5000 * hugeArea.pixelRatio ** 2 <= MAX_CAPTURE_CANVAS_AREA + 1e-6,
    `${((4000 * 5000 * hugeArea.pixelRatio ** 2) / 1e6).toFixed(2)}M ≤ ${(MAX_CAPTURE_CANVAS_AREA / 1e6).toFixed(2)}M`,
  )
}

console.log('\n[像素比：压到下限仍超限时必须如实标记]')
{
  const absurd = resolveCapturePixelRatio(1200, 200000, 2)
  check('1200×200000 被降级', absurd.downscaled === true)
  check('压到下限仍超限 → exceedsLimits=true', absurd.exceedsLimits === true, `ratio=${absurd.pixelRatio}`)
  check('不低于下限', absurd.pixelRatio >= MIN_CAPTURE_PIXEL_RATIO, `${absurd.pixelRatio}`)

  const tooWide = resolveCapturePixelRatio(40000, 600, 2)
  check('40000 宽的极端情况也标记超限', tooWide.exceedsLimits === true, `ratio=${tooWide.pixelRatio}`)
}

console.log('\n[像素比：非法输入的兜底]')
{
  const zero = resolveCapturePixelRatio(0, 0, 2)
  check('尺寸为 0 → 原样返回期望值、不误报降级', zero.pixelRatio === 2 && !zero.downscaled && !zero.exceedsLimits)

  const nanSize = resolveCapturePixelRatio(Number.NaN, 800, 2)
  check('尺寸为 NaN → 原样返回期望值', nanSize.pixelRatio === 2 && !nanSize.downscaled)

  check('期望值为 NaN → 1', resolveCapturePixelRatio(1200, 800, Number.NaN).pixelRatio === 1)
  check('期望值为 0 → 1', resolveCapturePixelRatio(1200, 800, 0).pixelRatio === 1)
  check('期望值为负数 → 1', resolveCapturePixelRatio(1200, 800, -3).pixelRatio === 1)
}

console.log('\n[像素比：不超限时必定满足两条硬约束]')
{
  const sizes = [
    [800, 600],
    [1200, 3000],
    [1200, 8000],
    [1600, 12000],
    [2400, 16000],
    [3000, 30000],
  ]
  for (const [w, h] of sizes) {
    const d = resolveCapturePixelRatio(w, h, 2)
    if (d.exceedsLimits) {
      check(`${w}×${h} 标记超限（下限 ${MIN_CAPTURE_PIXEL_RATIO}）`, true)
      continue
    }
    const cw = w * d.pixelRatio
    const ch = h * d.pixelRatio
    check(
      `${w}×${h} @${d.pixelRatio.toFixed(3)} → ${Math.round(cw)}×${Math.round(ch)} 在边与面积上限内`,
      cw <= MAX_CAPTURE_CANVAS_EDGE + 1e-6 &&
        ch <= MAX_CAPTURE_CANVAS_EDGE + 1e-6 &&
        cw * ch <= MAX_CAPTURE_CANVAS_AREA + 1e-6,
    )
  }
}

console.log('\n[文件名与时间戳]')
{
  const date = new Date(2026, 0, 5, 9, 7, 3)
  check('时间戳补零为 yyyyMMdd-HHmmss', formatCaptureStamp(date) === '20260105-090703', formatCaptureStamp(date))

  const late = new Date(2026, 11, 31, 23, 59, 59)
  check('年末边界正确', formatCaptureStamp(late) === '20261231-235959', formatCaptureStamp(late))

  const name = buildPanelImageFilename('crisis-assault', 'hp-chart', date)
  check(
    '文件名格式 zzz-hp-<模式>-<面板>-<时间戳>.png',
    name === 'zzz-hp-crisis-assault-hp-chart-20260105-090703.png',
    name,
  )
  check('以 .png 结尾', name.endsWith('.png'))
  check(
    '空值回落到 mode/panel',
    buildPanelImageFilename('  ', '', date) === 'zzz-hp-mode-panel-20260105-090703.png',
    buildPanelImageFilename('  ', '', date),
  )
}

console.log('\n[截图样式属性：只剔 height，其余尺寸类必须保留]')
{
  // 回归背景三条（都来自实测事故）：
  // 1) 冻结 computed height → 折行时行高不长，折下来的内容压住下一行；
  // 2) 连 width 一起剔 → 危局「绝境房间」的 .enemy-card--hard 塌成窄条；
  // 3) min-height / max-height 也剔 → 克隆体总高高于页面，成图底部被裁（临界推演少截最后一行）。
  const excludedProps = ['height', 'block-size']
  const mustKeepProps = [
    'width',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'flex-basis',
    'inline-size',
    'color',
    'font-size',
  ]
  const input = [...excludedProps, ...mustKeepProps]
  const kept = buildCaptureStyleProperties(input)

  check(
    '只剔除 height / block-size',
    excludedProps.every((name) => !kept.includes(name)),
    excludedProps.filter((name) => kept.includes(name)).join(',') || 'none',
  )
  check(
    '其余尺寸类全部保留（含 min-height / max-height）',
    mustKeepProps.every((name) => kept.includes(name)),
    mustKeepProps.filter((name) => !kept.includes(name)).join(',') || 'all kept',
  )
  check('font-size 必须保留（否则字号全错）', kept.includes('font-size'))
  check(
    'array-like 输入（CSSStyleDeclaration 形态）可用',
    buildCaptureStyleProperties({ length: 2, 0: 'color', 1: 'height' }).join(',') === 'color',
  )
  check(
    '返回的是新数组，不改动入参',
    input.length === 11 && kept.length === 9,
    `input=${input.length} kept=${kept.length}`,
  )
  check(
    '排除清单恰好是这 2 个',
    CAPTURE_SIZE_EXCLUDED_PROPERTIES.length === 2 &&
      CAPTURE_SIZE_EXCLUDED_PROPERTIES.every((name) => excludedProps.includes(name)),
    CAPTURE_SIZE_EXCLUDED_PROPERTIES.join(','),
  )
}

console.log('\n[单行 flex 行判定：截图前据此锁 nowrap]')
{
  // 回归背景：克隆体在 foreignObject 里无法重新布局，行内末尾元素会被多折一行；
  // 把页面上本来就是单行的行锁成 nowrap 后，实测与页面实况逐像素一致。
  check('2 个等高子元素、容器等高 → 单行', isSingleLineFlexRow(20, [20, 20]) === true)
  check('容器高出一行 → 已换行', isSingleLineFlexRow(42, [20, 20]) === false)
  check('容差内仍算单行（允许 4px 抗锯齿差）', isSingleLineFlexRow(24, [20, 20]) === true)
  check('刚超容差即算换行', isSingleLineFlexRow(25, [20, 20]) === false)
  check('子元素高度不一时以最高者为准', isSingleLineFlexRow(30, [30, 20]) === true)
  check('子元素不足 2 个 → 视为单行（无需处理）', isSingleLineFlexRow(30, [30]) === true)
  check('空数组 → 视为单行', isSingleLineFlexRow(0, []) === true)
  check('非有限值 → 保守视为单行', isSingleLineFlexRow(Number.NaN, [20, 20]) === true)
  check('容差可配置', isSingleLineFlexRow(30, [20, 20], 12) === true)
}

console.log('\n[截图高度：必须有界追加余量]')
{
  // 回归背景：即使展开了内部滚动容器、并让页面按同一规则布局，克隆体仍可能比页面略高。
  // 实测临界推演 LAST STAGE 尾部恰好少一行怪物卡（约 80px）。余量保证不裁切。
  check(
    '3707 的余量足以覆盖实测 177px 差值',
    resolveCaptureHeight(3707) - 3707 >= 177,
    `+${resolveCaptureHeight(3707) - 3707}`,
  )
  check('小高度走下限 40px', resolveCaptureHeight(300) === 340, `+${resolveCaptureHeight(300) - 300}`)
  check('大高度按 6% 走', resolveCaptureHeight(10000) === 10600, `+${resolveCaptureHeight(10000) - 10000}`)
  check('结果向上取整，不出现小数', Number.isInteger(resolveCaptureHeight(1234.56)))
  check('非正数/NaN → 0（交由上层报错）', resolveCaptureHeight(0) === 0 && resolveCaptureHeight(Number.NaN) === 0)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
