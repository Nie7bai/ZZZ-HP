import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import {
  recognizeFromTencentOcrJson,
  type TencentOcrDetection,
} from '@/utils/panelTencentOcrRecognize'
import { recognizeDriveDiscMainStatsFromOcr } from '@/utils/driveDiscMainStatRecognize'

interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

const REFERENCE_WIDTH = 613
const REFERENCE_HEIGHT = 1024
const REFERENCE_ASPECT = REFERENCE_WIDTH / REFERENCE_HEIGHT

/**
 * 米游社绝区零战绩面板相对坐标（由两份腾讯高精度 OCR JSON 标定，坐标相对整图内容）。
 * 不依赖黑框检测；裁黑边后直接按此版面抠区 OCR。
 */
const PANEL_LAYOUT = {
  mindscape: { x: 0.22, y: 0.09, w: 0.1, h: 0.055 },
  agentName: { x: 0.02, y: 0.285, w: 0.3, h: 0.045 },
  /** 右侧整块属性面板（含双列） */
  statsBlock: { x: 0.34, y: 0.09, w: 0.64, h: 0.23 },
  hpRow: { x: 0.35, y: 0.095, w: 0.28, h: 0.055 },
  atkRow: { x: 0.64, y: 0.095, w: 0.34, h: 0.055 },
  penRateRow: { x: 0.35, y: 0.225, w: 0.28, h: 0.045 },
  penRow: { x: 0.35, y: 0.26, w: 0.28, h: 0.045 },
  dmgRow: { x: 0.64, y: 0.26, w: 0.34, h: 0.045 },
  wengineName: { x: 0.1, y: 0.39, w: 0.3, h: 0.04 },
  wengineStars: { x: 0.02, y: 0.425, w: 0.24, h: 0.04 },
  discNames: { x: 0.02, y: 0.47, w: 0.96, h: 0.27 },
} as const

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
  recognize: (image: Blob | HTMLCanvasElement | string) => Promise<{
    data: {
      text: string
      words?: {
        text: string
        confidence: number
        bbox: { x0: number; y0: number; x1: number; y1: number }
      }[]
    }
  }>
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
  const colHas = Array<number>(w).fill(0)
  const rowHas = Array<number>(h).fill(0)
  const stepX = Math.max(1, Math.floor(w / 800))
  const stepY = Math.max(1, Math.floor(h / 800))
  let sampledCols = 0
  let sampledRows = 0
  for (let y = 0; y < h; y += stepY) sampledRows++
  for (let x = 0; x < w; x += stepX) sampledCols++
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      if (lum(x, y) > 28) {
        colHas[x] = (colHas[x] ?? 0) + 1
        rowHas[y] = (rowHas[y] ?? 0) + 1
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

/** 把相对版面坐标落到真实像素矩形 */
function layoutRect(
  canvas: HTMLCanvasElement,
  frac: { x: number; y: number; w: number; h: number },
): PixelRect {
  return {
    x: canvas.width * frac.x,
    y: canvas.height * frac.y,
    w: canvas.width * frac.w,
    h: canvas.height * frac.h,
  }
}

/** 放大过小的内容图，提升本地 OCR 字框质量 */
function ensureReadableSize(source: HTMLCanvasElement, minWidth = 1100): HTMLCanvasElement {
  if (source.width >= minWidth) return source
  const scale = minWidth / source.width
  const out = document.createElement('canvas')
  out.width = Math.round(source.width * scale)
  out.height = Math.round(source.height * scale)
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, out.width, out.height)
  return out
}

/**
 * 对指定区域 OCR，并把字框映射回整图像素，供空间解析使用（与腾讯 OCR JSON 同结构）。
 */
async function ocrRegionAsDetections(
  canvas: HTMLCanvasElement,
  rect: PixelRect,
  upscale: number,
  params?: { psm?: string; whitelist?: string },
): Promise<TencentOcrDetection[]> {
  return enqueueOcr(async () => {
    const crop = cropPixels(canvas, rect, upscale)
    const worker = await getOcrWorker()
    const prepared = preprocessForOcr(crop)
    await worker.setParameters({
      tessedit_pageseg_mode: params?.psm ?? '6',
      tessedit_char_whitelist: params?.whitelist ?? '',
    })
    const result = await worker.recognize(await canvasToPngBlob(prepared))
    const words = result.data.words ?? []
    const scale = Math.max(1, upscale)
    const detections: TencentOcrDetection[] = []

    if (words.length) {
      for (const word of words) {
        const text = (word.text ?? '').trim()
        if (!text) continue
        const x0 = rect.x + word.bbox.x0 / scale
        const y0 = rect.y + word.bbox.y0 / scale
        const x1 = rect.x + word.bbox.x1 / scale
        const y1 = rect.y + word.bbox.y1 / scale
        detections.push({
          DetectedText: text,
          Confidence: Math.round(word.confidence || 0),
          ItemPolygon: {
            X: Math.round(x0),
            Y: Math.round(y0),
            Width: Math.max(1, Math.round(x1 - x0)),
            Height: Math.max(1, Math.round(y1 - y0)),
          },
        })
      }
      return detections
    }

    // 无字框时退化为整区一行文本（仍带区域包围盒）
    const text = (result.data.text ?? '').trim()
    if (text) {
      detections.push({
        DetectedText: text.replace(/\s+/g, ' '),
        Confidence: 80,
        ItemPolygon: {
          X: Math.round(rect.x),
          Y: Math.round(rect.y),
          Width: Math.round(rect.w),
          Height: Math.round(rect.h),
        },
      })
    }
    return detections
  })
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
  const content = cropToContent(original)
  // 按米游社战绩版面相对坐标识别，不再依赖黑框；必要时放大保证字框清晰
  const canvas = ensureReadableSize(content, 1100)
  const aspect = content.width / content.height
  if (Math.abs(aspect - REFERENCE_ASPECT) > 0.12) {
    warnings.push(
      `截图宽高比 ${aspect.toFixed(2)} 与常见战绩图 ${REFERENCE_ASPECT.toFixed(2)} 偏差较大；已裁黑边后按固定版面识别`,
    )
  }

  onProgress?.('按版面分区 OCR（属性 / 角色 / 音擎 / 驱动盘）…')
  const regions: { key: keyof typeof PANEL_LAYOUT; upscale: number; psm: string; whitelist?: string }[] =
    [
      { key: 'statsBlock', upscale: 2.4, psm: '6' },
      { key: 'hpRow', upscale: 3.5, psm: '6' },
      { key: 'atkRow', upscale: 3.5, psm: '6' },
      { key: 'penRateRow', upscale: 3.2, psm: '6' },
      { key: 'penRow', upscale: 3.2, psm: '6' },
      { key: 'dmgRow', upscale: 3.2, psm: '6' },
      { key: 'agentName', upscale: 3.5, psm: '7' },
      { key: 'wengineName', upscale: 3.5, psm: '7' },
      { key: 'discNames', upscale: 2.2, psm: '6' },
      { key: 'mindscape', upscale: 6, psm: '10', whitelist: '0123456789' },
    ]

  const detections: TencentOcrDetection[] = []
  for (const region of regions) {
    const rect = layoutRect(canvas, PANEL_LAYOUT[region.key])
    const part = await ocrRegionAsDetections(canvas, rect, region.upscale, {
      psm: region.psm,
      whitelist: region.whitelist,
    })
    detections.push(...part)
  }

  onProgress?.('按坐标归属解析…')
  const spatial = recognizeFromTencentOcrJson(
    { TextDetections: detections },
    catalogs,
  )

  // 精炼：星标用色块计数（OCR 对 ★ 不稳）
  const wengineRefine = detectRefinementStars(
    cropPixels(canvas, layoutRect(canvas, PANEL_LAYOUT.wengineStars), 3),
  )

  // 影画：空间解析为 0 时，再跑角标专用识别（虚拟角色区对齐版面标定）
  let rank = spatial.rank
  if (rank === 0) {
    onProgress?.('补识别影画角标…')
    const mindRect = layoutRect(canvas, PANEL_LAYOUT.mindscape)
    const virtualCharArea: PixelRect = {
      x: canvas.width * 0.02,
      y: canvas.height * 0.02,
      w: canvas.width * 0.32,
      h: canvas.height * 0.4,
    }
    rank = await recognizeMindscapeRank(canvas, virtualCharArea)
    if (rank === 0) {
      const badgeText = await ocrImage(cropPixels(canvas, mindRect, 8), {
        psm: '10',
        whitelist: '0123456789',
        invert: false,
      })
      const m = badgeText.replace(/\s+/g, '').match(/[1-6]/)
      if (m) rank = Number(m[0])
    }
  }

  // 专区纯文本兜底：空间解析缺字段时用旧解析补
  onProgress?.('补缺字段…')
  const hpText = await ocrImage(cropPixels(canvas, layoutRect(canvas, PANEL_LAYOUT.hpRow), 3.5), {
    psm: '6',
  })
  const atkText = await ocrImage(cropPixels(canvas, layoutRect(canvas, PANEL_LAYOUT.atkRow), 3.5), {
    psm: '6',
  })
  const penText = await ocrImage(
    cropPixels(
      canvas,
      {
        x: canvas.width * PANEL_LAYOUT.penRateRow.x,
        y: canvas.height * PANEL_LAYOUT.penRateRow.y,
        w: canvas.width * PANEL_LAYOUT.penRateRow.w,
        h: canvas.height * (PANEL_LAYOUT.penRow.y + PANEL_LAYOUT.penRow.h - PANEL_LAYOUT.penRateRow.y),
      },
      3.2,
    ),
    { psm: '6' },
  )
  const dmgText = await ocrImage(cropPixels(canvas, layoutRect(canvas, PANEL_LAYOUT.dmgRow), 3.2), {
    psm: '6',
  })
  const statsFallback = mergePanelStats(
    parsePanelStats(hpText),
    parsePanelStats(atkText),
    parsePanelStats(penText),
    parsePanelStats(dmgText),
  )
  const externalPanel = { ...statsFallback, ...spatial.externalPanel }
  // 粘连「7673 10334」：空格拆开取较大值
  if (externalPanel.hp == null || (hpText.includes(' ') && /\d+\s+\d+/.test(hpText))) {
    const glued = [...hpText.matchAll(/(\d{3,5})\s+(\d{3,5})/g)]
    for (const m of glued) {
      const a = Number(m[1])
      const b = Number(m[2])
      if (Number.isFinite(a) && Number.isFinite(b)) {
        externalPanel.hp = Math.max(a, b)
        break
      }
    }
  }

  const result: PanelScreenshotRecognition = {
    agentId: spatial.agentId,
    agentName: spatial.agentName,
    rank,
    wengineId: spatial.wengineId,
    wengineName: spatial.wengineName,
    wengineRefine: wengineRefine || spatial.wengineRefine || 1,
    twoPieceDriveDiscId: spatial.twoPieceDriveDiscId,
    twoPieceDriveDiscName: spatial.twoPieceDriveDiscName,
    fourPieceDriveDiscId: spatial.fourPieceDriveDiscId,
    fourPieceDriveDiscName: spatial.fourPieceDriveDiscName,
    externalPanel,
    warnings: [],
  }

  if (!result.agentId) warnings.push('未能识别角色名')
  if (!result.wengineId) warnings.push('未能识别音擎名')
  if (!result.twoPieceDriveDiscId && !result.fourPieceDriveDiscId) {
    warnings.push('未能识别驱动盘套装')
  }
  if (result.externalPanel.hp == null && result.externalPanel.atk == null) {
    warnings.push('未能识别生命/攻击')
  }
  if (
    result.externalPanel.penRate == null ||
    result.externalPanel.pen == null ||
    result.externalPanel.dmgBonus == null
  ) {
    const missing: string[] = []
    if (result.externalPanel.penRate == null) missing.push('穿透率')
    if (result.externalPanel.pen == null) missing.push('穿透值')
    if (result.externalPanel.dmgBonus == null) missing.push('增伤')
    warnings.push(`属性未识别：${missing.join('、')}`)
  }
  if (result.rank === 0) {
    warnings.push('影画角标未读到数字，已按 0 影处理')
  }
  // 保留空间解析自身警告中与缺字段相关的提示
  for (const w of spatial.warnings) {
    if (!warnings.includes(w) && /未能|未识别|影画/.test(w)) warnings.push(w)
  }

  const mains = recognizeDriveDiscMainStatsFromOcr({ TextDetections: detections })
  if (Object.keys(mains).length) {
    result.driveDiscMainStats = mains
  } else {
    warnings.push(
      '未识别到 4/5/6 号盘主属性；「词条导入」页那份将沿用该页当前选择的主属性（未设置过则为默认值）',
    )
  }
  result.warnings = warnings

  onProgress?.('识别完成')
  return result
}
