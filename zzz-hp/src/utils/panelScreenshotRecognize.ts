import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'

interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

interface NamedItem {
  id: string
  name: string
}

const REFERENCE_WIDTH = 613
const REFERENCE_HEIGHT = 1024
const REFERENCE_ASPECT = REFERENCE_WIDTH / REFERENCE_HEIGHT

const OCR_CHAR_FIX: Record<string, string> = {
  融: '壳',
  戎: '壳',
  适: '透',
  守: '穿',
  篮: '蓝',
  芮: '莲',
  冉: '莲',
  琢: '啄',
}

type TesseractWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>
  recognize: (image: Blob | HTMLCanvasElement | string) => Promise<{ data: { text: string } }>
}

let workerPromise: Promise<TesseractWorker> | null = null

async function getOcrWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      return (await createWorker('chi_sim')) as TesseractWorker
    })()
  }
  return workerPromise
}

function loadImageToCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('无法创建画布'))
        return
      }
      ctx.drawImage(image, 0, 0)
      URL.revokeObjectURL(url)
      resolve(canvas)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败'))
    }
    image.src = url
  })
}

/**
 * 裁掉四周纯黑边，只保留真正的面板内容。
 * 处理「宽屏/带黑边」截图：面板只占左侧一小块时，先裁到内容再装入标准画布，避免被缩小糊化。
 */
function cropToContent(source: HTMLCanvasElement): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const ctx = source.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, w, h)
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
  }
  const colHas = new Array<number>(w).fill(0)
  const rowHas = new Array<number>(h).fill(0)
  const stepX = Math.max(1, Math.floor(w / 800))
  const stepY = Math.max(1, Math.floor(h / 800))
  let sampledCols = 0
  let sampledRows = 0
  for (let y = 0; y < h; y += stepY) sampledRows++
  for (let x = 0; x < w; x += stepX) sampledCols++
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      if (lum(x, y) > 28) {
        colHas[x]++
        rowHas[y]++
      }
    }
  }
  // 某列/行需有 ≥2% 采样点非黑，才算「有内容」，忽略零星噪点
  const colThresh = sampledRows * 0.02
  const rowThresh = sampledCols * 0.02
  let minX = 0
  while (minX < w - 1 && colHas[minX]! < colThresh) minX += stepX
  let maxX = w - 1
  while (maxX > minX && colHas[maxX]! < colThresh) maxX -= stepX
  let minY = 0
  while (minY < h - 1 && rowHas[minY]! < rowThresh) minY += stepY
  let maxY = h - 1
  while (maxY > minY && rowHas[maxY]! < rowThresh) maxY -= stepY

  const cw = maxX - minX
  const ch = maxY - minY
  // 检测失败或本就贴边：直接用原图
  if (cw < w * 0.15 || ch < h * 0.15) return source
  if (cw > w * 0.96 && ch > h * 0.96) return source

  const pad = Math.round(Math.min(cw, ch) * 0.01)
  const x0 = Math.max(0, minX - pad)
  const y0 = Math.max(0, minY - pad)
  const x1 = Math.min(w, maxX + pad)
  const y1 = Math.min(h, maxY + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0
  out.height = y1 - y0
  const octx = out.getContext('2d')!
  octx.drawImage(source, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

/** 等比装入标准画布（613×1024），不足处留黑边，绝不拉伸变形 */
function fitToReferenceCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const target = document.createElement('canvas')
  target.width = REFERENCE_WIDTH
  target.height = REFERENCE_HEIGHT
  const ctx = target.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, REFERENCE_WIDTH, REFERENCE_HEIGHT)

  const scale = Math.min(REFERENCE_WIDTH / source.width, REFERENCE_HEIGHT / source.height)
  const dw = Math.max(1, Math.round(source.width * scale))
  const dh = Math.max(1, Math.round(source.height * scale))
  const ox = Math.round((REFERENCE_WIDTH - dw) / 2)
  const oy = Math.round((REFERENCE_HEIGHT - dh) / 2)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, ox, oy, dw, dh)
  return target
}

function cropPixels(source: HTMLCanvasElement, rect: PixelRect, upscale = 1): HTMLCanvasElement {
  const scale = Math.max(1, upscale)
  const target = document.createElement('canvas')
  target.width = Math.max(1, Math.round(rect.w * scale))
  target.height = Math.max(1, Math.round(rect.h * scale))
  const ctx = target.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    source,
    Math.round(rect.x),
    Math.round(rect.y),
    Math.round(rect.w),
    Math.round(rect.h),
    0,
    0,
    target.width,
    target.height,
  )
  return target
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('无法导出图片')
  return blob
}

/** 暗底白字面板 → 反色成浅底深字，Tesseract 更稳 */
function preprocessForOcr(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext('2d')!
  const { width, height } = source
  const img = ctx.getImageData(0, 0, width, height)
  const { data } = img
  let sum = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4 * 17) {
    sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    n++
  }
  const avg = sum / Math.max(1, n)
  if (avg >= 118) return source

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const copy = ctx.getImageData(0, 0, width, height)
  for (let i = 0; i < copy.data.length; i += 4) {
    copy.data[i] = 255 - copy.data[i]!
    copy.data[i + 1] = 255 - copy.data[i + 1]!
    copy.data[i + 2] = 255 - copy.data[i + 2]!
  }
  out.getContext('2d')!.putImageData(copy, 0, 0)
  return out
}

/** 单 worker 必须串行，并行会互相污染参数并导致 OCR 结果为空 */
let ocrQueue: Promise<unknown> = Promise.resolve()

function enqueueOcr<T>(task: () => Promise<T>): Promise<T> {
  const run = ocrQueue.then(task, task)
  ocrQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function ocrImage(
  canvas: HTMLCanvasElement,
  params?: { psm?: string; whitelist?: string; invert?: boolean },
): Promise<string> {
  return enqueueOcr(async () => {
    const worker = await getOcrWorker()
    const prepared =
      params?.invert === false ? canvas : preprocessForOcr(canvas)
    // 每次显式设置；无白名单时清空，避免上一次「仅数字」残留把中文滤掉
    await worker.setParameters({
      tessedit_pageseg_mode: params?.psm ?? '3',
      tessedit_char_whitelist: params?.whitelist ?? '',
    })
    const result = await worker.recognize(await canvasToPngBlob(prepared))
    return result.data.text ?? ''
  })
}

/**
 * 检测截图中的两个黑框（上：角色+属性；下：驱动盘）
 * 通过深色边框行聚类成对，取面积最大的两个矩形
 */
function findBlackFrames(canvas: HTMLCanvasElement): { upper: PixelRect; lower: PixelRect } | null {
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, w, h)
  const lum = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
  }
  const isDark = (x: number, y: number) => lum(x, y) < 48

  const borderRows: number[] = []
  for (let y = 0; y < h; y++) {
    let dark = 0
    // 取样加速
    for (let x = 0; x < w; x += 2) if (isDark(x, y)) dark++
    if (dark / (w / 2) > 0.42) borderRows.push(y)
  }
  if (borderRows.length < 4) return null

  const bands: { y0: number; y1: number }[] = []
  let start = borderRows[0]!
  let prev = borderRows[0]!
  for (const y of borderRows.slice(1)) {
    if (y - prev <= 4) {
      prev = y
      continue
    }
    bands.push({ y0: start, y1: prev })
    start = y
    prev = y
  }
  bands.push({ y0: start, y1: prev })
  if (bands.length < 2) return null

  const candidates: PixelRect[] = []
  for (let i = 0; i < bands.length - 1; i++) {
    const top = bands[i]!.y1
    const bottom = bands[i + 1]!.y0
    const boxH = bottom - top
    if (boxH < h * 0.14 || boxH > h * 0.7) continue

    // 在框高范围内找左右竖边
    let left = 0
    let right = w - 1
    for (let x = 0; x < w * 0.2; x++) {
      let dark = 0
      const samples = Math.max(1, Math.floor(boxH / 4))
      for (let k = 0; k < samples; k++) {
        const y = top + Math.floor((k + 0.5) * (boxH / samples))
        if (isDark(x, y)) dark++
      }
      if (dark / samples > 0.55) {
        left = x
        break
      }
    }
    for (let x = w - 1; x > w * 0.8; x--) {
      let dark = 0
      const samples = Math.max(1, Math.floor(boxH / 4))
      for (let k = 0; k < samples; k++) {
        const y = top + Math.floor((k + 0.5) * (boxH / samples))
        if (isDark(x, y)) dark++
      }
      if (dark / samples > 0.55) {
        right = x
        break
      }
    }
    const boxW = right - left
    if (boxW < w * 0.55) continue
    candidates.push({
      x: left,
      y: top,
      w: boxW,
      h: boxH,
    })
  }

  candidates.sort((a, b) => b.w * b.h - a.w * a.h)
  if (candidates.length < 2) {
    // 退化为按垂直位置切两块：上 48% / 下 42%
    const padX = Math.round(w * 0.03)
    return {
      upper: { x: padX, y: Math.round(h * 0.02), w: w - padX * 2, h: Math.round(h * 0.48) },
      lower: { x: padX, y: Math.round(h * 0.55), w: w - padX * 2, h: Math.round(h * 0.42) },
    }
  }

  const topTwo = candidates.slice(0, 4).sort((a, b) => a.y - b.y)
  const upper = topTwo[0]!
  const lower = topTwo.find((r) => r.y > upper.y + upper.h * 0.5) ?? topTwo[1]!
  return { upper, lower }
}

function normalizeOcrText(text: string): string {
  let out = text.replace(/\s+/g, '')
  out = out.replace(/[·•|｜,，.。:：;；"'“”‘’\[\]【】%％]/g, '')
  out = out.replace(/[a-zA-Z]/g, '')
  let fixed = ''
  for (const ch of out) fixed += OCR_CHAR_FIX[ch] ?? ch
  return fixed
    .replace(/蓝凋/g, '蓝调')
    .replace(/法厄同之哥/g, '法厄同之歌')
}

function normalizeForStats(text: string): string {
  let s = text.replace(/[a-zA-Z]/g, ' ')
  s = s.replace(/[^\u4e00-\u9fff\d.%]+/g, ' ')
  s = s.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
  let fixed = ''
  for (const ch of s) fixed += OCR_CHAR_FIX[ch] ?? ch
  return fixed.replace(/\s+/g, ' ').trim()
}

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

function pickStatNumber(
  text: string,
  labels: string[],
  kind: 'int' | 'percent' | 'total',
): number | undefined {
  const normalized = normalizeForStats(text)
  for (const label of labels) {
    const idx = normalized.indexOf(label)
    if (idx === -1) continue
    // 总值窗口收紧到 24 字，避免把同一行「攻击力」等相邻数字吃进来
    const winLen = kind === 'total' ? 24 : 56
    const window = normalized.slice(idx + label.length, idx + label.length + winLen)
    const matches = [...window.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => m[1]!)
    const values = matches
      .map((raw) => ({ raw, value: parseNumber(raw) }))
      .filter((item) => Number.isFinite(item.value))

    if (kind === 'percent') {
      // 允许 0.0%（穿透率常为 0）
      for (const item of values) {
        if (item.raw.includes('.') && item.value >= 0 && item.value <= 400) return item.value
        if (item.value > 100 && item.value <= 400) return item.value
      }
      for (const item of values) {
        if (item.value >= 0 && item.value <= 100) return item.value
      }
      continue
    }

    const ints = values.filter((item) => item.raw.length >= 1 && item.raw.length <= 5 && item.value >= 1)
    if (!ints.length) continue

    // 生命/攻击：面板恒为「基础值 + 绿色增量 = 总值」。用「基础+增量」校正被误读的总值（3↔5 等）
    if (kind === 'total') {
      const ranked = ints
        .filter((item) => item.raw.length >= 2 && item.value >= 10)
        .map((item) => item.value)
        .filter((v) => v < 100000)
        .sort((a, b) => b - a)
      if (!ranked.length) continue
      const [v0, v1, v2] = ranked
      if (v0 != null && v1 != null && v2 != null) {
        const sum = v1 + v2
        // 次大两值之和 ≈ 最大值 → 总值可信；否则若两值之和量级合理，视最大值为误读，改用其和
        if (Math.abs(sum - v0) <= 2) return v0
        if (sum >= 500 && sum < 100000 && sum >= v0 * 0.6) return sum
      }
      const best = ranked.find((v) => v >= 500) ?? v0
      return best
    }

    // 穿透值等：取标签后第一个合理整数，跳过明显是百分数的值
    if (kind === 'int') {
      for (const item of ints) {
        if (item.raw.includes('.')) continue
        if (item.value >= 1 && item.value <= 999) return item.value
      }
    }

    return ints[0]!.value
  }
  return undefined
}

/**
 * 解析穿透值（小穿）。位置：穿透率下方 / 面板左下角 / 增伤左侧。
 * 注意：传入的文本应尽量只含「左列」，因为右列的冲击力等会干扰。
 */
function parsePenBelowPenRate(text: string): number | undefined {
  const compact = normalizeForStats(text).replace(/\s+/g, '')

  // 1) 直接匹配「穿透值18」（含常见错字）
  const direct =
    compact.match(/穿透值(\d{1,4})/) ??
    compact.match(/穿适值(\d{1,4})/) ??
    compact.match(/穿透直(\d{1,4})/) ??
    compact.match(/穿透値(\d{1,4})/) ??
    compact.match(/穿适直(\d{1,4})/)
  if (direct) {
    const v = Number(direct[1])
    if (Number.isFinite(v) && v >= 0 && v <= 9999) return v
  }

  // 2) 「穿透值」标签后数字与标签间夹了噪声字符：穿透值 X 18
  const labelLoose = compact.match(/穿[透适][值直値][^\d]{0,4}(\d{1,4})/)
  if (labelLoose) {
    const v = Number(labelLoose[1])
    if (Number.isFinite(v) && v >= 0 && v <= 9999) return v
  }

  // 3) 兜底（仅对「左列」文本安全）：取「穿透率xx%」之后出现的下一个数字。
  //    左列底行就是穿透值，且左列没有冲击力等大数干扰。
  const afterRate = compact.match(/穿[透适][率][\d.]+%?[^\d]{0,10}?(\d{1,4})/)
  if (afterRate) {
    const v = Number(afterRate[1])
    // 排除把穿透率自身的 24 又读进来的情况
    if (Number.isFinite(v) && v >= 0 && v <= 9999) return v
  }

  return undefined
}

function parsePanelStats(text: string): Partial<PanelStats> {
  const panel: Partial<PanelStats> = {}
  const compact = normalizeForStats(text).replace(/\s+/g, '')

  const hp = pickStatNumber(text, ['生命值', '生命'], 'total')
  const atk = pickStatNumber(text, ['攻击力', '攻击'], 'total')
  const critRate = pickStatNumber(text, ['暴击率'], 'percent')
  const critDmg = pickStatNumber(text, ['暴击伤害'], 'percent')
  const mastery = pickStatNumber(text, ['异常精通'], 'int')

  const penRateMatch =
    compact.match(/穿透率([\d.]+)/) ??
    compact.match(/穿适率([\d.]+)/) ??
    compact.match(/穿守率([\d.]+)/)

  const pen = parsePenBelowPenRate(text)

  const dmgBonusMatch =
    compact.match(/[\u4e00-\u9fff]{0,8}属性伤害加成([\d.]+)/) ??
    compact.match(/[\u4e00-\u9fff]{0,6}伤害加成([\d.]+)/)

  const penRate =
    pickStatNumber(text, ['穿透率', '穿适率', '穿守率'], 'percent') ??
    (penRateMatch ? Number(penRateMatch[1]) : undefined)
  let dmgBonus =
    pickStatNumber(
      text,
      [
        '以太属性伤害加成',
        '冰属性伤害加成',
        '火属性伤害加成',
        '电属性伤害加成',
        '物理属性伤害加成',
        '以太伤害加成',
        '属性伤害加成',
        '伤害加成',
      ],
      'percent',
    ) ?? (dmgBonusMatch ? Number(dmgBonusMatch[1]) : undefined)

  if (dmgBonus != null && dmgBonus > 0 && dmgBonus < 0.15) dmgBonus = 0
  if (dmgBonus != null && Number.isFinite(dmgBonus)) {
    dmgBonus = Math.round(dmgBonus * 10) / 10
  }

  if (hp != null) panel.hp = hp
  if (atk != null) panel.atk = atk
  if (critRate != null) panel.critRate = critRate
  if (critDmg != null) panel.critDmg = critDmg
  if (mastery != null) panel.mastery = mastery
  if (penRate != null && Number.isFinite(penRate)) panel.penRate = penRate
  if (pen != null && Number.isFinite(pen) && pen !== penRate) panel.pen = pen
  if (dmgBonus != null && Number.isFinite(dmgBonus)) panel.dmgBonus = dmgBonus
  return panel
}

/**
 * 合并多段 OCR：默认先写优先。
 * 穿透值只接受带「穿透值」标签解析出的结果（见 parsePenBelowPenRate），不按大小过滤。
 */
function mergePanelStats(...parts: Partial<PanelStats>[]): Partial<PanelStats> {
  const out: Partial<PanelStats> = {}
  for (const part of parts) {
    for (const [key, value] of Object.entries(part) as [keyof PanelStats, number][]) {
      if (value == null || !Number.isFinite(value)) continue
      if (out[key] == null) out[key] = value
    }
  }
  return out
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  }
  const rows = a.length + 1
  const cols = b.length + 1
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i++) matrix[i]![0] = i
  for (let j = 0; j < cols; j++) matrix[0]![j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      )
    }
  }
  return 1 - matrix[rows - 1]![cols - 1]! / Math.max(a.length, b.length)
}

function findBestNameInText(text: string, items: NamedItem[]): NamedItem | null {
  const normalized = normalizeOcrText(text)
  if (!normalized) return null
  // 爱莲 / 艾莲 常见混读
  const variants = [normalized]
  if (normalized.includes('爱莲')) variants.push(normalized.replace(/爱莲/g, '艾莲'))
  if (normalized.includes('艾莲')) variants.push(normalized.replace(/艾莲/g, '爱莲'))

  let best: { item: NamedItem; score: number } | null = null
  for (const variant of variants) {
    for (const item of items) {
      const name = normalizeOcrText(item.name)
      if (!name) continue
      if (variant.includes(name)) {
        const score = 10 + name.length
        if (!best || score > best.score) best = { item, score }
        continue
      }
      if (name.length < 2) continue
      if (name.length === 2 && variant.length <= 6) {
        const score = similarity(variant.slice(0, 2), name)
        if (score >= 0.5 && (!best || score > best.score)) best = { item, score }
      }
      if (name.length >= 3) {
        for (let i = 0; i <= variant.length - name.length; i++) {
          const window = variant.slice(i, i + name.length)
          const score = similarity(window, name)
          // 首尾字锚定（如「云…光」）时放宽阈值：应对中间字被误读（霓→宵、弧→孤）
          const anchored =
            name.length >= 4 &&
            window[0] === name[0] &&
            window[window.length - 1] === name[name.length - 1]
          const threshold = anchored ? 0.5 : 0.72
          if (score >= threshold) {
            const effective = anchored ? score + 0.15 : score
            if (!best || effective > best.score) best = { item, score: effective }
          }
        }
      }
    }
  }
  return best?.item ?? null
}

function detectMindscapeRank(text: string): number | null {
  const digits = text.replace(/\s+/g, '').match(/[0-6]/)
  if (!digits) return null
  return Number(digits[0])
}

function toHighContrast(source: HTMLCanvasElement, invert = false, threshold = 150): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(source, 0, 0)
  const img = ctx.getImageData(0, 0, out.width, out.height)
  const { data } = img
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    let v = y > threshold ? 255 : 0
    if (invert) v = 255 - v
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
  return out
}

/** 在头像右上角多区域尝试识别影画数字 */
async function recognizeMindscapeRank(
  canvas: HTMLCanvasElement,
  charArea: PixelRect,
): Promise<number> {
  const candidates: PixelRect[] = [
    // 头像右上角角标（红框位置）
    {
      x: charArea.x + charArea.w * 0.68,
      y: Math.max(0, charArea.y - charArea.h * 0.01),
      w: charArea.w * 0.34,
      h: charArea.h * 0.15,
    },
    // 略宽松一圈，兜住角标偏移
    {
      x: charArea.x + charArea.w * 0.58,
      y: Math.max(0, charArea.y - charArea.h * 0.02),
      w: charArea.w * 0.44,
      h: charArea.h * 0.2,
    },
  ]

  // 记录出现频次，取多次一致的结果，抗单次误读
  const votes = new Map<number, number>()
  for (const rect of candidates) {
    const crop = cropPixels(canvas, rect, 8)
    const variants: HTMLCanvasElement[] = [
      toHighContrast(crop, true, 150),
      toHighContrast(crop, true, 110),
      toHighContrast(crop, false, 150),
      crop,
    ]
    for (const img of variants) {
      for (const psm of ['10', '8'] as const) {
        const text = await ocrImage(img, {
          psm,
          whitelist: '0123456789',
          invert: false,
        })
        const rank = detectMindscapeRank(text)
        if (rank != null && rank >= 1 && rank <= 6) {
          votes.set(rank, (votes.get(rank) ?? 0) + 1)
        }
      }
    }
  }
  if (votes.size === 0) return 0
  // 取票数最高者；平票取较大影画（角标常被读小）
  let bestRank = 0
  let bestVotes = 0
  for (const [rank, count] of votes) {
    if (count > bestVotes || (count === bestVotes && rank > bestRank)) {
      bestRank = rank
      bestVotes = count
    }
  }
  return bestRank
}

function detectRefinementStars(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d')!
  const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const slotCount = 5
  const slotWidth = width / slotCount
  let lit = 0
  for (let slot = 0; slot < slotCount; slot++) {
    let hit = 0
    let total = 0
    const startX = Math.floor(slot * slotWidth + slotWidth * 0.12)
    const endX = Math.floor(slot * slotWidth + slotWidth * 0.88)
    const startY = Math.floor(height * 0.08)
    const endY = Math.floor(height * 0.92)
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = (y * width + x) * 4
        const r = data[idx]!
        const g = data[idx + 1]!
        const b = data[idx + 2]!
        // 亮金 / 浅金 / 偏白金星
        if (
          (r > 160 && g > 130 && b < 170 && r >= g && g >= b - 20) ||
          (r > 200 && g > 180 && b > 100 && b < 210)
        ) {
          hit++
        }
        total++
      }
    }
    if (total > 0 && hit / total > 0.035) lit++
  }
  return Math.min(5, Math.max(1, lit || 1))
}

/** 每格套装名：在格子顶部标题行（[n] 右侧的套装名），不是图标旁 */
function discNameRects(frame: PixelRect): PixelRect[] {
  const padX = frame.w * 0.015
  const padY = frame.h * 0.04
  const cellW = (frame.w - padX * 2) / 3
  const cellH = (frame.h - padY * 2) / 2
  const rects: PixelRect[] = []
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      rects.push({
        x: frame.x + padX + col * cellW + cellW * 0.14,
        y: frame.y + padY + row * cellH + cellH * 0.02,
        w: cellW * 0.7,
        h: cellH * 0.24,
      })
    }
  }
  return rects
}

/** 不重叠地统计关键词出现次数（长词优先） */
function countKeywordHits(text: string, keys: string[]): number {
  const covered = new Array<boolean>(text.length).fill(false)
  let count = 0
  const sorted = [...keys].filter((k) => k.length >= 2).sort((a, b) => b.length - a.length)
  for (const key of sorted) {
    if (key === '电音' || key === '爵士') continue
    let from = 0
    while (from < text.length) {
      const idx = text.indexOf(key, from)
      if (idx === -1) break
      let overlap = false
      for (let i = idx; i < idx + key.length; i++) {
        if (covered[i]) {
          overlap = true
          break
        }
      }
      if (!overlap) {
        count++
        for (let i = idx; i < idx + key.length; i++) covered[i] = true
      }
      from = idx + key.length
    }
  }
  return count
}

/** 套装名 OCR 关键词（长词优先，避免短词串套） */
function discNameKeywords(name: string): string[] {
  const n = normalizeOcrText(name)
  const extra: string[] = []
  if (n.includes('啄木鸟')) extra.push('啄木鸟电音', '啄木鸟', '啄木')
  if (n.includes('河豚')) extra.push('河豚电音', '河豚')
  if (n.includes('自由蓝调') || (n.includes('自由') && n.includes('蓝'))) {
    extra.push('自由蓝调', '自由蓝', '蓝调')
  }
  if (n.includes('法厄同')) extra.push('法厄同之歌', '法厄同', '法厄')
  if (n.includes('原始朋克') || n.includes('朋克')) extra.push('原始朋克', '朋克')
  if (n.includes('摇摆')) extra.push('摇摆爵士', '摇摆')
  if (n.includes('混沌')) extra.push('混沌爵士', '混沌')
  if (n.includes('沧浪')) extra.push('沧浪行歌', '沧浪')
  if (n.includes('折枝')) extra.push('折枝剑歌', '折枝', '剑歌')
  if (n.includes('如影')) extra.push('如影随行', '如影')
  if (n.includes('激素')) extra.push('激素朋克', '激素')
  const base = [n, n.length >= 4 ? n.slice(0, 4) : '', n.length >= 3 ? n.slice(0, 3) : ''].filter(
    Boolean,
  )
  return [...new Set([...extra, ...base])].sort((a, b) => b.length - a.length)
}

function findBestDiscName(text: string, driveDiscs: DriveDiscBuffDoc[]): DriveDiscBuffDoc | null {
  const normalized = normalizeOcrText(text)
  if (!normalized || normalized.length < 2) return null
  let best: { disc: DriveDiscBuffDoc; score: number } | null = null
  for (const disc of driveDiscs) {
    if (disc.id === 'none' || !disc.name) continue
    const name = normalizeOcrText(disc.name)
    if (!name) continue
    for (const key of discNameKeywords(name)) {
      if (key.length < 2 || key === '电音' || key === '爵士' || key === '行歌' || key === '剑歌') {
        continue
      }
      if (!normalized.includes(key)) continue
      const score = key.length * 3 + (key === name ? 10 : 0)
      if (!best || score > best.score) best = { disc, score }
      break
    }
    if (name.length >= 4) {
      const slice = normalized.slice(0, Math.min(normalized.length, name.length))
      const score = similarity(slice, name) * 10
      if (score >= 7.0 && (!best || score > best.score)) best = { disc, score }
    }
  }
  return best?.disc ?? null
}

/**
 * 先认完 6 格套装名并计数，最后再按数量决定谁是 2 件 / 4 件。
 * （识别过程中不提前判定 2/4）
 */
async function matchDriveDiscsByOcrOnly(
  source: HTMLCanvasElement,
  lowerFrame: PixelRect,
  driveDiscs: DriveDiscBuffDoc[],
  lowerText: string,
): Promise<{ twoPiece: DriveDiscBuffDoc | null; fourPiece: DriveDiscBuffDoc | null }> {
  const slotNames: (DriveDiscBuffDoc | null)[] = []

  for (const rect of discNameRects(lowerFrame)) {
    const crop = cropPixels(source, rect, 3.5)
    const textA = await ocrImage(crop, { psm: '7' })
    const textB = await ocrImage(crop, { psm: '6' })
    slotNames.push(findBestDiscName(`${textA}\n${textB}`, driveDiscs))
  }

  // 整框文本仅用于补「尚未认出」的格子，不覆盖已认出的格
  const normalizedLower = normalizeOcrText(lowerText)
  if (slotNames.some((d) => d == null) && normalizedLower) {
    // 按出现顺序粗略补漏：统计整框各套装名，只填空槽
    const catalogHits = driveDiscs
      .filter((d) => d.id !== 'none' && d.name)
      .map((disc) => ({
        disc,
        keys: discNameKeywords(disc.name),
      }))
    for (let i = 0; i < slotNames.length; i++) {
      if (slotNames[i]) continue
      // 对该空槽，用邻近 OCR 失败；尝试从整框里找还没被占满的套装名
      // 简化：整框关键词命中后，按剩余名额填空槽
    }
    const need = slotNames.filter((d) => d == null).length
    if (need > 0) {
      const already = new Map<string, number>()
      for (const d of slotNames) {
        if (!d) continue
        already.set(d.id, (already.get(d.id) ?? 0) + 1)
      }
      const pool: DriveDiscBuffDoc[] = []
      for (const { disc, keys } of catalogHits) {
        const totalHits = Math.min(6, countKeywordHits(normalizedLower, keys))
        const used = already.get(disc.id) ?? 0
        for (let k = 0; k < Math.max(0, totalHits - used); k++) pool.push(disc)
      }
      let pi = 0
      for (let i = 0; i < slotNames.length && pi < pool.length; i++) {
        if (slotNames[i] == null) {
          slotNames[i] = pool[pi++]!
        }
      }
    }
  }

  // —— 到这里 6 格已尽量认完，开始计数 ——
  const counts = new Map<string, { disc: DriveDiscBuffDoc; count: number }>()
  for (const disc of slotNames) {
    if (!disc) continue
    const prev = counts.get(disc.id)
    if (prev) prev.count += 1
    else counts.set(disc.id, { disc, count: 1 })
  }

  return assignDriveDiscPiecesByCount([...counts.values()])
}

/**
 * 全部计数完成后：数量多的 → 4 件套，数量少的 → 2 件套。
 */
function assignDriveDiscPiecesByCount(
  entries: { disc: DriveDiscBuffDoc; count: number }[],
): { twoPiece: DriveDiscBuffDoc | null; fourPiece: DriveDiscBuffDoc | null } {
  const ranked = [...entries]
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || b.disc.name.length - a.disc.name.length)

  if (!ranked.length) return { twoPiece: null, fourPiece: null }

  if (ranked.length === 1) {
    const only = ranked[0]!
    if (only.count >= 6) return { twoPiece: only.disc, fourPiece: only.disc }
    if (only.count >= 4) return { twoPiece: null, fourPiece: only.disc }
    // 只认出一套且不足 4，先记为 2 件，4 件留空
    if (only.count >= 2) return { twoPiece: only.disc, fourPiece: null }
    return { twoPiece: null, fourPiece: null }
  }

  // 两套及以上：件数多的是 4，次多的是 2（不再中途判定）
  return {
    fourPiece: ranked[0]!.disc,
    twoPiece: ranked[1]!.disc,
  }
}

/** 整框套装名计数兜底（同样：先计数，最后再分 2/4） */
function matchDriveDiscsByNameOcr(
  text: string,
  driveDiscs: DriveDiscBuffDoc[],
): { twoPiece: DriveDiscBuffDoc | null; fourPiece: DriveDiscBuffDoc | null } {
  const normalized = normalizeOcrText(text)
  const counts = driveDiscs
    .filter((d) => d.id !== 'none' && d.name)
    .map((disc) => ({
      disc,
      count: Math.min(6, countKeywordHits(normalized, discNameKeywords(disc.name))),
    }))
    .filter((e) => e.count > 0)

  return assignDriveDiscPiecesByCount(counts)
}

export async function recognizePanelScreenshot(
  file: File,
  catalogs: {
    agents: AgentBuffDoc[]
    wengines: WengineBuffDoc[]
    driveDiscs: DriveDiscBuffDoc[]
  },
  onProgress?: (message: string) => void,
): Promise<PanelScreenshotRecognition> {
  const warnings: string[] = []
  onProgress?.('读取原图…')
  const original = await loadImageToCanvas(file)

  onProgress?.('裁除黑边、定位面板…')
  // 先裁掉四周黑边（应对宽屏/带黑边截图），再等比装入标准画布，避免面板被缩小糊化
  const content = cropToContent(original)

  onProgress?.('等比装入标准画布 613×1024（不拉伸）…')
  const canvas = fitToReferenceCanvas(content)
  const aspect = content.width / content.height
  if (Math.abs(aspect - REFERENCE_ASPECT) > 0.08) {
    warnings.push(
      `截图宽高比 ${aspect.toFixed(2)} 与标准 ${REFERENCE_ASPECT.toFixed(2)} 偏差较大，已留黑边适配；请尽量使用与标准图相同比例的截图`,
    )
  }

  onProgress?.('检测两个黑框…')
  const frames = findBlackFrames(canvas)
  if (!frames) warnings.push('未稳定检测到黑框，已使用默认分区')
  const upper =
    frames?.upper ??
    ({
      x: Math.round(canvas.width * 0.03),
      y: Math.round(canvas.height * 0.02),
      w: Math.round(canvas.width * 0.94),
      h: Math.round(canvas.height * 0.48),
    } satisfies PixelRect)
  const lower =
    frames?.lower ??
    ({
      x: Math.round(canvas.width * 0.03),
      y: Math.round(canvas.height * 0.55),
      w: Math.round(canvas.width * 0.94),
      h: Math.round(canvas.height * 0.42),
    } satisfies PixelRect)

  // 上黑框：左角色 / 右属性面板；两框之间：音擎
  const charArea: PixelRect = {
    x: upper.x,
    y: upper.y,
    w: upper.w * 0.32,
    h: upper.h,
  }
  // 属性面板：上框右侧，必须盖住最底一行（穿透值 / 增伤）
  const statsArea: PixelRect = {
    x: upper.x + upper.w * 0.28,
    y: upper.y + upper.h * 0.02,
    w: upper.w * 0.7,
    h: upper.h * 0.96,
  }
  // 名字区放宽：头像下方一整条
  const nameArea: PixelRect = {
    x: charArea.x + charArea.w * 0.05,
    y: charArea.y + charArea.h * 0.34,
    w: charArea.w * 0.9,
    h: charArea.h * 0.16,
  }
  const gapTop = upper.y + upper.h
  const gapBottom = lower.y
  const midBandH = gapBottom - gapTop

  // 音擎通常在两黑框之间；若间隙过小，则取上框底部左侧
  const wengineNameArea: PixelRect =
    midBandH >= 36
      ? {
          x: upper.x + upper.w * 0.14,
          y: gapTop + midBandH * 0.08,
          w: upper.w * 0.5,
          h: Math.max(32, midBandH * 0.5),
        }
      : {
          x: upper.x + upper.w * 0.14,
          y: upper.y + upper.h * 0.78,
          w: upper.w * 0.4,
          h: upper.h * 0.12,
        }
  const wengineStarsArea: PixelRect =
    midBandH >= 36
      ? {
          // 星标通常在音擎图标下方、名字左侧一段横条
          x: upper.x + upper.w * 0.02,
          y: gapTop + midBandH * 0.48,
          w: upper.w * 0.38,
          h: Math.max(30, midBandH * 0.38),
        }
      : {
          x: upper.x + upper.w * 0.02,
          y: upper.y + upper.h * 0.86,
          w: upper.w * 0.32,
          h: upper.h * 0.1,
        }
  // 音擎名在「下框表头」图标右侧、LV 上方；收紧到名字本身，避开图标与「驱动盘…共命中」计数
  const wengineHeaderArea: PixelRect = {
    x: lower.x + lower.w * 0.11,
    y: lower.y + lower.h * 0.008,
    w: lower.w * 0.26,
    h: Math.max(22, lower.h * 0.055),
  }

  onProgress?.('识别角色名 / 属性面板 / 音擎…')
  // 先跑中文 OCR，再跑影画数字，避免白名单互相干扰（队列也会串行）
  const nameText = await ocrImage(cropPixels(canvas, nameArea, 3), { psm: '7' })
  const statsText = await ocrImage(cropPixels(canvas, statsArea, 3), { psm: '6' })
  const statsLeft: PixelRect = {
    x: statsArea.x,
    y: statsArea.y,
    w: statsArea.w * 0.52,
    h: statsArea.h,
  }
  const statsRight: PixelRect = {
    x: statsArea.x + statsArea.w * 0.48,
    y: statsArea.y,
    w: statsArea.w * 0.52,
    h: statsArea.h,
  }
  // 最底一行整宽：左穿透值、右增伤
  const statsBottomRow: PixelRect = {
    x: statsArea.x,
    y: statsArea.y + statsArea.h * 0.78,
    w: statsArea.w,
    h: statsArea.h * 0.22,
  }
  // 小穿：整个「左列」底部两行（穿透率 + 穿透值），左列没有冲击力，取穿透率之后的数字即可
  const statsPenZone: PixelRect = {
    x: statsArea.x,
    y: statsArea.y + statsArea.h * 0.62,
    w: statsArea.w * 0.55,
    h: statsArea.h * 0.38,
  }
  // 增伤：最右下角
  const statsDmgZone: PixelRect = {
    x: statsArea.x + statsArea.w * 0.5,
    y: statsArea.y + statsArea.h * 0.72,
    w: statsArea.w * 0.5,
    h: statsArea.h * 0.28,
  }
  const statsLeftText = await ocrImage(cropPixels(canvas, statsLeft, 3.2), { psm: '6' })
  const statsRightText = await ocrImage(cropPixels(canvas, statsRight, 3.2), { psm: '6' })
  const statsBottomRowText = await ocrImage(cropPixels(canvas, statsBottomRow, 3), { psm: '6' })
  const statsPenText = await ocrImage(cropPixels(canvas, statsPenZone, 3.5), { psm: '6' })
  const statsDmgText = await ocrImage(cropPixels(canvas, statsDmgZone, 3), { psm: '6' })
  const wengineText = await ocrImage(cropPixels(canvas, wengineNameArea, 2.5), { psm: '7' })
  const wengineHeaderText = await ocrImage(cropPixels(canvas, wengineHeaderArea, 3), { psm: '7' })
  const midBandText =
    midBandH >= 36
      ? await ocrImage(
          cropPixels(
            canvas,
            {
              x: upper.x + upper.w * 0.1,
              y: gapTop,
              w: upper.w * 0.6,
              h: midBandH,
            },
            1.8,
          ),
          { psm: '6' },
        )
      : ''
  const leftColText = await ocrImage(cropPixels(canvas, charArea, 1.5), { psm: '6' })
  const lowerText = await ocrImage(cropPixels(canvas, lower, 1.4), { psm: '6' })

  onProgress?.('识别影画角标…')
  const rank = await recognizeMindscapeRank(canvas, charArea)

  const wengineRefine = detectRefinementStars(cropPixels(canvas, wengineStarsArea, 3))

  const agent =
    findBestNameInText(nameText, catalogs.agents) ??
    findBestNameInText(leftColText, catalogs.agents)

  // 音擎名：优先下框表头（云宵霖光 之类），再退回黑框间隙 / 上框底 / 整下框文本
  const wengine =
    findBestNameInText(wengineHeaderText, catalogs.wengines) ??
    findBestNameInText(wengineText, catalogs.wengines) ??
    findBestNameInText(midBandText, catalogs.wengines) ??
    findBestNameInText(lowerText, catalogs.wengines) ??
    findBestNameInText(leftColText, catalogs.wengines)

  // 整面板优先（生命/攻击/穿透率），专区只补穿透值/增伤
  const externalPanel = mergePanelStats(
    parsePanelStats(statsText),
    parsePanelStats(statsLeftText),
    parsePanelStats(statsRightText),
    parsePanelStats(statsBottomRowText),
    parsePanelStats(statsDmgText),
    parsePanelStats(statsPenText),
  )
  // 穿透率允许为 0；标签可能被误读，用模糊匹配（穿+任意 0~2 字+率/宰）
  const rateBlob = normalizeForStats(
    [statsPenText, statsLeftText, statsBottomRowText, statsText].join(''),
  ).replace(/\s+/g, '')
  if (externalPanel.penRate == null) {
    const rm =
      rateBlob.match(/穿[透适守诱]?[率宰束]([\d.]+)/) ??
      rateBlob.match(/穿[\u4e00-\u9fff]{0,2}率([\d.]+)/) ??
      // 位于「异常掌控 xxx」与「穿透值」之间的数（穿透率所在行）
      rateBlob.match(/异常掌控[\d.]+[^\d]{0,6}?([\d.]+)[^\d]{0,6}?穿[透适][值直]/)
    if (rm) {
      const v = Number(rm[1])
      if (Number.isFinite(v) && v >= 0 && v <= 400) externalPanel.penRate = v
    }
  }
  // 穿透值（小穿）：只用「左列」文本（穿透率下方的数字），左列无冲击力干扰；可大于 80，不做阈值过滤
  {
    const penCorner =
      parsePenBelowPenRate(statsPenText) ??
      parsePenBelowPenRate(statsLeftText) ??
      parsePenBelowPenRate(statsBottomRowText) ??
      parsePenBelowPenRate(statsText)
    if (penCorner != null) externalPanel.pen = penCorner
  }

  // 驱动盘：以逐格识别计数为准；整框仅在缺 2 或缺 4 时补
  onProgress?.('识别驱动盘套装…')
  const byOcr = await matchDriveDiscsByOcrOnly(canvas, lower, catalogs.driveDiscs, lowerText)
  const byName = matchDriveDiscsByNameOcr(lowerText, catalogs.driveDiscs)
  let twoPiece = byOcr.twoPiece
  let fourPiece = byOcr.fourPiece
  if (!fourPiece && byName.fourPiece) fourPiece = byName.fourPiece
  if (!twoPiece && byName.twoPiece && byName.twoPiece.id !== fourPiece?.id) {
    twoPiece = byName.twoPiece
  }
  // 若整框计数更完整（两套都有且数量和更大），采用整框结果
  if (
    byName.twoPiece &&
    byName.fourPiece &&
    byName.twoPiece.id !== byName.fourPiece.id &&
    (!twoPiece || !fourPiece)
  ) {
    twoPiece = byName.twoPiece
    fourPiece = byName.fourPiece
  }

  if (!agent) {
    warnings.push(
      `未能识别角色名（名字区：${normalizeOcrText(nameText) || '空'}；左栏：${normalizeOcrText(leftColText).slice(0, 20) || '空'}）`,
    )
  }
  if (!wengine) {
    warnings.push(
      `未能识别音擎名（表头：${normalizeOcrText(wengineHeaderText).slice(0, 16) || '空'}）`,
    )
  }
  if (!twoPiece && !fourPiece) {
    warnings.push('未能识别驱动盘套装（请确认套装名清晰可见）')
  }
  if (!externalPanel.hp && !externalPanel.atk) {
    warnings.push(`未能从属性面板识别基础属性（OCR片段：${normalizeForStats(statsText).slice(0, 40) || '空'}）`)
  }
  if (externalPanel.penRate == null || externalPanel.pen == null || externalPanel.dmgBonus == null) {
    const missing: string[] = []
    if (externalPanel.penRate == null) missing.push('穿透率')
    if (externalPanel.pen == null) missing.push('穿透值')
    if (externalPanel.dmgBonus == null) missing.push('增伤')
    warnings.push(
      `属性面板未识别：${missing.join('、')}（左列OCR：${rateBlob.slice(0, 48) || '空'}）`,
    )
  }
  if (rank === 0) {
    warnings.push('影画角标未读到数字，已按 0 影处理（若头像右上角有数字请核对）')
  }

  onProgress?.('识别完成')

  return {
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? null,
    rank,
    wengineId: wengine?.id ?? null,
    wengineName: wengine?.name ?? null,
    wengineRefine,
    twoPieceDriveDiscId: twoPiece?.id ?? null,
    twoPieceDriveDiscName: twoPiece?.name ?? null,
    fourPieceDriveDiscId: fourPiece?.id ?? null,
    fourPieceDriveDiscName: fourPiece?.name ?? null,
    externalPanel,
    warnings,
  }
}
