import type { AgentBuffDoc, DriveDiscBuffDoc, WengineBuffDoc } from '@/types/calculator'
import type { PanelStats } from '@/types/calculatorPanel'
import type { PanelScreenshotRecognition } from '@/types/panelScreenshot'
import { recognizeDriveDiscMainStatsFromOcrApiOutput } from '@/utils/driveDiscMainStatRecognize'

/** 腾讯云 OCR TextDetection（含位置） */
export interface TencentOcrDetection {
  DetectedText: string
  Confidence?: number
  ItemPolygon?: { X: number; Y: number; Width: number; Height: number }
  Polygon?: { X: number; Y: number }[]
}

interface OcrToken {
  text: string
  conf: number
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

type Catalogs = {
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
}

function toToken(d: TencentOcrDetection): OcrToken | null {
  const text = (d.DetectedText ?? '').trim()
  if (!text) return null
  const p = d.ItemPolygon
  if (p && Number.isFinite(p.X) && Number.isFinite(p.Y)) {
    return {
      text,
      conf: d.Confidence ?? 0,
      x: p.X,
      y: p.Y,
      w: p.Width,
      h: p.Height,
      cx: p.X + p.Width / 2,
      cy: p.Y + p.Height / 2,
    }
  }
  const poly = d.Polygon
  if (poly?.length) {
    const xs = poly.map((pt) => pt.X)
    const ys = poly.map((pt) => pt.Y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const w = Math.max(...xs) - x
    const h = Math.max(...ys) - y
    return { text, conf: d.Confidence ?? 0, x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
  }
  return null
}

/** 兼容腾讯 demo 导出 / API 响应多种包一层结构 */
export function extractTencentDetections(raw: unknown): TencentOcrDetection[] {
  if (!raw || typeof raw !== 'object') return []
  const root = raw as Record<string, unknown>

  const fromArray = (arr: unknown): TencentOcrDetection[] =>
    Array.isArray(arr) ? (arr as TencentOcrDetection[]) : []

  if (Array.isArray(root.TextDetections)) return fromArray(root.TextDetections)

  const response = root.Response
  if (Array.isArray(response)) {
    for (const item of response) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>
        if (Array.isArray(rec.TextDetections)) return fromArray(rec.TextDetections)
      }
    }
  }
  if (response && typeof response === 'object') {
    const rec = response as Record<string, unknown>
    if (Array.isArray(rec.TextDetections)) return fromArray(rec.TextDetections)
  }
  return []
}

function normalizeName(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[·•|｜,，.。:：;；"'“”‘’\[\]【】%％★☆✦✧]/g, '')
    .replace(/[a-zA-Z0-9]/g, '')
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

function findBestName(text: string, items: { id: string; name: string }[]): { id: string; name: string } | null {
  const normalized = normalizeName(text)
  if (!normalized) return null
  let best: { item: { id: string; name: string }; score: number } | null = null
  for (const item of items) {
    const name = normalizeName(item.name)
    if (!name) continue
    if (normalized.includes(name) || name.includes(normalized)) {
      const score = 10 + name.length
      if (!best || score > best.score) best = { item, score }
      continue
    }
    if (name.length < 2) continue
    const score = similarity(normalized, name)
    const anchored =
      name.length >= 4 &&
      normalized.length >= 2 &&
      normalized[0] === name[0] &&
      normalized[normalized.length - 1] === name[name.length - 1]
    const threshold = anchored ? 0.5 : 0.72
    const effective = anchored ? score + 0.15 : score
    if (score >= threshold && (!best || effective > best.score)) best = { item, score: effective }
  }
  return best?.item ?? null
}

/** 从 OCR 文本抽出数字；粘连如「7673 10334」按空格拆开成多个候选 */
function extractNumbersFromText(text: string): number[] {
  const parts = text
    .trim()
    .split(/[\s\u00a0]+/)
    .filter(Boolean)
  const out: number[] = []
  for (const part of parts) {
    const cleaned = part.replace(/[,，]/g, '').replace(/%$/, '').replace(/^[+＋]/, '')
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) continue
    const n = Number(cleaned)
    if (Number.isFinite(n)) out.push(Math.abs(n))
  }
  return out
}

function parseNumberToken(text: string): number | null {
  const nums = extractNumbersFromText(text)
  if (!nums.length) return null
  // 粘连多段时默认取最大（生命总值通常更大）
  return Math.max(...nums)
}

function sameRow(a: OcrToken, b: OcrToken, tol = 28): boolean {
  return Math.abs(a.cy - b.cy) <= Math.max(tol, (a.h + b.h) * 0.55)
}

/** 属性面板区：排除驱动盘副属性里重复的「攻击力/穿透率」标签 */
function isPanelStatRegion(token: OcrToken, pageH: number): boolean {
  return token.y < pageH * 0.38
}

function findLabel(
  tokens: OcrToken[],
  labels: string[],
  pageH: number,
  opts?: { preferLeft?: boolean },
): OcrToken | null {
  const hits = tokens.filter((t) => {
    if (!isPanelStatRegion(t, pageH)) return false
    return labels.some((lab) => t.text === lab || t.text.includes(lab))
  })
  if (!hits.length) return null
  hits.sort((a, b) => a.y - b.y || a.x - b.x)
  if (opts?.preferLeft) {
    hits.sort((a, b) => a.x - b.x || a.y - b.y)
  }
  // 取最上的标签（面板顶行生命/攻击）
  return hits[0] ?? null
}

function rightSideNumbers(
  label: OcrToken,
  tokens: OcrToken[],
  opts?: { maxDx?: number; xMax?: number },
): { token: OcrToken; value: number }[] {
  const maxDx = opts?.maxDx ?? 420
  const xMax = opts?.xMax ?? Number.POSITIVE_INFINITY
  const out: { token: OcrToken; value: number }[] = []
  for (const t of tokens) {
    if (t === label) continue
    if (!sameRow(label, t)) continue
    if (t.x < label.x + label.w * 0.2) continue
    if (t.x - label.x > maxDx) continue
    if (t.x >= xMax) continue
    // 跳过纯中文标签
    if (/[\u4e00-\u9fff]{2,}/.test(t.text) && extractNumbersFromText(t.text).length === 0) continue
    const nums = extractNumbersFromText(t.text)
    for (const v of nums) {
      out.push({ token: t, value: v })
    }
  }
  out.sort((a, b) => a.token.x - b.token.x || b.value - a.value)
  return out
}

function pickTotalStat(
  label: OcrToken | null,
  tokens: OcrToken[],
  opts?: { xMax?: number },
): number | undefined {
  if (!label) return undefined
  const nums = rightSideNumbers(label, tokens, { maxDx: 380, xMax: opts?.xMax })
  if (!nums.length) return undefined
  const values = nums.map((n) => n.value).filter((v) => v >= 10 && v < 100000)
  if (!values.length) return undefined
  const ranked = [...new Set(values)].sort((a, b) => b - a)
  const [v0, v1, v2] = ranked
  // 基础+绿色增量=总值；用和校正 3↔5/8 误读
  if (v0 != null && v1 != null && v2 != null) {
    const sum = v1 + v2
    if (Math.abs(sum - v0) <= 2) return v0
    if (sum >= 500 && sum < 100000 && sum >= v0 * 0.55) return sum
  }
  // 粘连「7673 10334」：按空格拆开后取较大者为总值
  if (v0 != null && v1 != null && v0 >= 500) return v0
  // 优先选较大字号的「总值」候选（ItemPolygon.Height 更大）
  const bigFont = [...nums]
    .filter((n) => n.value >= 500)
    .sort((a, b) => b.token.h - a.token.h || b.value - a.value)
  if (bigFont[0]) return bigFont[0].value
  return ranked.find((v) => v >= 500) ?? ranked[0]
}

function pickPercentStat(
  label: OcrToken | null,
  tokens: OcrToken[],
  opts?: { xMax?: number },
): number | undefined {
  if (!label) return undefined
  const nums = rightSideNumbers(label, tokens, { maxDx: 360, xMax: opts?.xMax })
  for (const n of nums) {
    // 优先带小数的百分数（0.0 / 24.0）
    if (n.token.text.includes('%') || n.token.text.includes('.')) {
      if (n.value >= 0 && n.value <= 400) return n.value
    }
  }
  for (const n of nums) {
    if (n.value >= 0 && n.value <= 400) return n.value
  }
  return undefined
}

function pickIntStat(
  label: OcrToken | null,
  tokens: OcrToken[],
  opts?: { xMax?: number },
): number | undefined {
  if (!label) return undefined
  const nums = rightSideNumbers(label, tokens, { maxDx: 360, xMax: opts?.xMax })
  for (const n of nums) {
    if (n.token.text.includes('.') || n.token.text.includes('%')) continue
    if (n.value >= 0 && n.value <= 9999) return Math.round(n.value)
  }
  return undefined
}

function pickDmgBonus(tokens: OcrToken[], pageH: number): number | undefined {
  const label = tokens.find(
    (t) =>
      isPanelStatRegion(t, pageH) &&
      (/伤害加成/.test(t.text) || /属性伤害加成/.test(t.text)),
  )
  return pickPercentStat(label ?? null, tokens)
}

function detectMindscapeRank(tokens: OcrToken[], pageW: number, pageH: number): number {
  // 头像右上角角标：左侧栏偏右、属性面板上方区域
  const candidates = tokens.filter((t) => {
    if (!/^[0-6]$/.test(t.text)) return false
    if (t.x < pageW * 0.12 || t.x > pageW * 0.42) return false
    if (t.y < pageH * 0.08 || t.y > pageH * 0.22) return false
    return true
  })
  if (!candidates.length) {
    // 放宽一圈
    const loose = tokens.filter((t) => {
      if (!/^[1-6]$/.test(t.text)) return false
      if (t.x > pageW * 0.45) return false
      if (t.y > pageH * 0.28) return false
      return true
    })
    if (!loose.length) return 0
    loose.sort((a, b) => a.y - b.y || b.x - a.x)
    return Number(loose[0]!.text)
  }
  candidates.sort((a, b) => a.y - b.y || b.x - a.x)
  return Number(candidates[0]!.text)
}

function detectRefine(tokens: OcrToken[], pageH: number): number {
  // ★★ / ★★★★★ 在音擎图标下
  const starTok = tokens.find((t) => /[★☆✦✧]/.test(t.text) && t.y > pageH * 0.35 && t.y < pageH * 0.5)
  if (starTok) {
    const n = (starTok.text.match(/[★☆✦✧]/g) ?? []).length
    if (n >= 1 && n <= 5) return n
  }
  // 兜底：文本「精1」等
  for (const t of tokens) {
    const m = t.text.match(/精\s*([1-5])/)
    if (m) return Number(m[1])
  }
  return 1
}

function countDriveDiscs(
  tokens: OcrToken[],
  driveDiscs: DriveDiscBuffDoc[],
): { twoPiece: DriveDiscBuffDoc | null; fourPiece: DriveDiscBuffDoc | null } {
  const counts = new Map<string, { disc: DriveDiscBuffDoc; count: number }>()
  for (const disc of driveDiscs) {
    if (!disc.name || disc.id === 'none') continue
    let count = 0
    for (const t of tokens) {
      // 形如 自由蓝调[1] / 法厄同之歌[2]
      if (t.text.includes(disc.name)) {
        const slot = t.text.match(/\[(\d)\]/)
        count += slot ? 1 : 1
      }
    }
    if (count > 0) counts.set(disc.id, { disc, count: Math.min(6, count) })
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count)
  if (!ranked.length) return { twoPiece: null, fourPiece: null }
  if (ranked.length === 1) {
    const only = ranked[0]!
    if (only.count >= 4) return { twoPiece: null, fourPiece: only.disc }
    if (only.count >= 2) return { twoPiece: only.disc, fourPiece: null }
    return { twoPiece: null, fourPiece: null }
  }
  return { fourPiece: ranked[0]!.disc, twoPiece: ranked[1]!.disc }
}

function findAgentToken(tokens: OcrToken[], agents: AgentBuffDoc[]): OcrToken | null {
  // 角色名通常在左侧、LV 上方
  const left = tokens.filter((t) => t.x < 320 && /[\u4e00-\u9fff]{2,}/.test(t.text))
  left.sort((a, b) => a.y - b.y)
  for (const t of left) {
    if (/LV\.?\s*\d+/i.test(t.text)) continue
    if (/UID|绝|区|零|AGENT|驱动|米游/.test(t.text)) continue
    if (findBestName(t.text, agents)) return t
  }
  return null
}

function findWengineToken(tokens: OcrToken[], wengines: WengineBuffDoc[]): OcrToken | null {
  for (const t of tokens) {
    if (t.text.length < 2 || t.text.length > 12) continue
    if (/[\u4e00-\u9fff]{2,}/.test(t.text) && findBestName(t.text, wengines)) {
      // 音擎名大约在面板中部左侧（壳中之灵 y≈926）
      if (t.y > 700 && t.y < 1100 && t.x < 500) return t
    }
  }
  // 全局兜底
  for (const t of tokens) {
    if (findBestName(t.text, wengines)) return t
  }
  return null
}

/**
 * 根据腾讯云 OCR（带坐标）JSON 解析面板结果。
 * 比本地 tesseract 更稳：用「标签同行右侧数字」归属，避免平面文本串行。
 */
export function recognizeFromTencentOcrJson(
  raw: unknown,
  catalogs: Catalogs,
): PanelScreenshotRecognition {
  const warnings: string[] = []
  const detections = extractTencentDetections(raw)
  const tokens = detections.map(toToken).filter((t): t is OcrToken => t != null)

  if (!tokens.length) {
    return {
      agentId: null,
      agentName: null,
      rank: 0,
      wengineId: null,
      wengineName: null,
      wengineRefine: 1,
      twoPieceDriveDiscId: null,
      twoPieceDriveDiscName: null,
      fourPieceDriveDiscId: null,
      fourPieceDriveDiscName: null,
      externalPanel: {},
      warnings: ['OCR JSON 中未找到 TextDetections'],
    }
  }

  const pageW = Math.max(...tokens.map((t) => t.x + t.w), 1)
  const pageH = Math.max(...tokens.map((t) => t.y + t.h), 1)

  const hpLabel = findLabel(tokens, ['生命值'], pageH)
  const atkLabelClean =
    tokens.find(
      (t) =>
        isPanelStatRegion(t, pageH) &&
        t.text === '攻击力' &&
        Math.abs(t.y - (hpLabel?.y ?? t.y)) < 40,
    ) ?? findLabel(tokens, ['攻击力'], pageH)

  // 左右两列分界：攻击力标签左边，避免生命行吃到攻击数字
  const colSplitX = atkLabelClean?.x ?? pageW * 0.62

  const penRateLabel = findLabel(tokens, ['穿透率'], pageH)
  const penLabel = findLabel(tokens, ['穿透值'], pageH)
  const critRateLabel = findLabel(tokens, ['暴击率'], pageH)
  const critDmgLabel = findLabel(tokens, ['暴击伤害'], pageH)
  const masteryLabel = findLabel(tokens, ['异常精通'], pageH)

  const externalPanel: Partial<PanelStats> = {}
  const hp = pickTotalStat(hpLabel, tokens, { xMax: colSplitX })
  const atk = pickTotalStat(atkLabelClean, tokens)
  const penRate = pickPercentStat(penRateLabel, tokens, { xMax: colSplitX })
  const pen = pickIntStat(penLabel, tokens, { xMax: colSplitX })
  const dmgBonus = pickDmgBonus(tokens, pageH)
  const critRate = pickPercentStat(critRateLabel, tokens, { xMax: colSplitX })
  const critDmg = pickPercentStat(critDmgLabel, tokens)
  const mastery = pickIntStat(masteryLabel, tokens)

  if (hp != null) externalPanel.hp = hp
  if (atk != null) externalPanel.atk = atk
  if (penRate != null) externalPanel.penRate = penRate
  if (pen != null) externalPanel.pen = pen
  if (dmgBonus != null) externalPanel.dmgBonus = dmgBonus
  if (critRate != null) externalPanel.critRate = critRate
  if (critDmg != null) externalPanel.critDmg = critDmg
  if (mastery != null) externalPanel.mastery = mastery

  const agentTok = findAgentToken(tokens, catalogs.agents)
  const agent = agentTok ? findBestName(agentTok.text, catalogs.agents) : null
  const wengineTok = findWengineToken(tokens, catalogs.wengines)
  const wengine = wengineTok ? findBestName(wengineTok.text, catalogs.wengines) : null
  const rank = detectMindscapeRank(tokens, pageW, pageH)
  const wengineRefine = detectRefine(tokens, pageH)
  const discs = countDriveDiscs(tokens, catalogs.driveDiscs)

  if (!agent) warnings.push('未能从 OCR JSON 匹配角色名')
  if (!wengine) warnings.push('未能从 OCR JSON 匹配音擎名')
  if (!discs.twoPiece && !discs.fourPiece) warnings.push('未能从 OCR JSON 统计驱动盘套装')
  if (rank === 0) warnings.push('影画角标未在 OCR JSON 中定位到数字，已按 0 影')
  if (externalPanel.penRate == null || externalPanel.pen == null || externalPanel.dmgBonus == null) {
    const missing: string[] = []
    if (externalPanel.penRate == null) missing.push('穿透率')
    if (externalPanel.pen == null) missing.push('穿透值')
    if (externalPanel.dmgBonus == null) missing.push('增伤')
    warnings.push(`属性未识别：${missing.join('、')}`)
  }

  return {
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? agentTok?.text ?? null,
    rank,
    wengineId: wengine?.id ?? null,
    wengineName: wengine?.name ?? wengineTok?.text ?? null,
    wengineRefine,
    twoPieceDriveDiscId: discs.twoPiece?.id ?? null,
    twoPieceDriveDiscName: discs.twoPiece?.name ?? null,
    fourPieceDriveDiscId: discs.fourPiece?.id ?? null,
    fourPieceDriveDiscName: discs.fourPiece?.name ?? null,
    externalPanel,
    warnings,
  }
}

function splitOcrLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function lineNumbers(line: string): number[] {
  return extractNumbersFromText(line)
}

function findLineIndex(lines: string[], exactOrIncludes: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (exactOrIncludes.some((k) => l === k || l.includes(k))) return i
  }
  return -1
}

/**
 * 标签附近取生命/攻击总值。
 * 纯文本接口：总值与 +增量 通常在标签之后；向后扫到下一个属性标签为止。
 * 粘连「7673 10334」取较大；有基础+增量时用两者之和校验。
 */
function pickTotalNearLabel(
  lines: string[],
  labelKeys: string[],
  stopLabels: string[] = [],
): number | undefined {
  const idx = findLineIndex(lines, labelKeys)
  if (idx < 0) return undefined
  let end = Math.min(lines.length - 1, idx + 5)
  for (let i = idx + 1; i <= end; i++) {
    const line = lines[i]!
    if (stopLabels.some((k) => line === k || (line.includes(k) && lineNumbers(line).length === 0))) {
      end = i - 1
      break
    }
  }
  const window: number[] = []
  for (let i = idx; i <= end; i++) {
    for (const n of lineNumbers(lines[i]!)) {
      if (n >= 10 && n < 100000) window.push(n)
    }
  }
  if (!window.length) return undefined
  const ranked = [...new Set(window)].sort((a, b) => b - a)
  const [v0, v1, v2] = ranked
  if (v0 != null && v1 != null && v2 != null) {
    const sum = v1 + v2
    if (Math.abs(sum - v0) <= 2) return v0
  }
  // 粘连或仅总值+增量：取较大者（总值）
  return ranked.find((v) => v >= 500) ?? ranked[0]
}

function pickAfterLabel(
  lines: string[],
  labelKeys: string[],
  kind: 'percent' | 'int',
  lookahead = 3,
): number | undefined {
  const idx = findLineIndex(lines, labelKeys)
  if (idx < 0) return undefined
  for (let i = idx; i <= Math.min(lines.length - 1, idx + lookahead); i++) {
    const line = lines[i]!
    if (i > idx && /[\u4e00-\u9fff]{2,}/.test(line) && !/\d/.test(line)) continue
    const nums = lineNumbers(line)
    if (!nums.length) continue
    if (kind === 'percent') {
      const v = nums[0]!
      if (v >= 0 && v <= 400) return v
    } else {
      for (const v of nums) {
        if (!line.includes('.') && !line.includes('%') && v >= 0 && v <= 9999) return Math.round(v)
      }
    }
  }
  return undefined
}

function pickDmgBonusFromLines(lines: string[]): number | undefined {
  const idx = lines.findIndex((l) => /伤害加成/.test(l))
  if (idx < 0) return undefined
  for (let i = idx; i <= Math.min(lines.length - 1, idx + 2); i++) {
    const nums = lineNumbers(lines[i]!)
    if (!nums.length) continue
    const v = nums[0]!
    if (v >= 0 && v <= 400) return v
  }
  return undefined
}

function detectRankFromLines(lines: string[]): number {
  const agentInfo = lines.findIndex((l) => /AGENT\s*INFO/i.test(l))
  const lvIdx = lines.findIndex((l) => /^LV\.?\s*\d+/i.test(l))
  const end = lvIdx > 0 ? lvIdx : Math.min(lines.length, 40)
  const start = agentInfo >= 0 ? agentInfo : 0
  for (let i = start; i < end; i++) {
    if (/^[1-6]$/.test(lines[i]!)) return Number(lines[i])
  }
  return 0
}

function detectRefineFromLines(lines: string[]): number {
  for (const l of lines) {
    const stars = (l.match(/[★☆✦✧]/g) ?? []).length
    if (stars >= 1 && stars <= 5) return stars
    const m = l.match(/精\s*([1-5])/)
    if (m) return Number(m[1])
  }
  return 1
}

function countDiscsFromLines(
  lines: string[],
  driveDiscs: DriveDiscBuffDoc[],
): { twoPiece: DriveDiscBuffDoc | null; fourPiece: DriveDiscBuffDoc | null } {
  const counts = new Map<string, { disc: DriveDiscBuffDoc; count: number }>()
  for (const disc of driveDiscs) {
    if (!disc.name || disc.id === 'none') continue
    let count = 0
    for (const line of lines) {
      if (line.includes(disc.name)) count += 1
    }
    if (count > 0) counts.set(disc.id, { disc, count: Math.min(6, count) })
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count)
  if (!ranked.length) return { twoPiece: null, fourPiece: null }
  if (ranked.length === 1) {
    const only = ranked[0]!
    if (only.count >= 4) return { twoPiece: null, fourPiece: only.disc }
    if (only.count >= 2) return { twoPiece: only.disc, fourPiece: null }
    return { twoPiece: null, fourPiece: null }
  }
  return { fourPiece: ranked[0]!.disc, twoPiece: ranked[1]!.disc }
}

/**
 * 解析接口返回的「纯文本 / 按行」OCR（无坐标）。
 * 适配：标签与数值分行、基数在标签前、总值在标签后。
 */
export function recognizeFromPlainOcrText(
  text: string,
  catalogs: Catalogs,
): PanelScreenshotRecognition {
  const warnings: string[] = []
  const lines = splitOcrLines(text)
  if (!lines.length) {
    return {
      agentId: null,
      agentName: null,
      rank: 0,
      wengineId: null,
      wengineName: null,
      wengineRefine: 1,
      twoPieceDriveDiscId: null,
      twoPieceDriveDiscName: null,
      fourPieceDriveDiscId: null,
      fourPieceDriveDiscName: null,
      externalPanel: {},
      warnings: ['OCR 文本为空'],
    }
  }

  const discStart = lines.findIndex(
    (l) => /驱动盘有效|自由蓝调\[|法厄同|沧浪行歌\[|折枝剑歌\[/.test(l) || /\[\d\]/.test(l),
  )
  const panelLines =
    discStart > 8 ? lines.slice(0, discStart) : lines.slice(0, Math.min(lines.length, 55))

  const externalPanel: Partial<PanelStats> = {}
  const hp = pickTotalNearLabel(panelLines, ['生命值'], ['攻击力'])
  const atk = pickTotalNearLabel(panelLines, ['攻击力'], ['防御力', '冲击力', '暴击率', 'FRAINK'])
  const penRate = pickAfterLabel(panelLines, ['穿透率'], 'percent')
  const pen = pickAfterLabel(panelLines, ['穿透值'], 'int')
  const dmgBonus = pickDmgBonusFromLines(panelLines)
  const critRate = pickAfterLabel(panelLines, ['暴击率'], 'percent')
  const critDmg = pickAfterLabel(panelLines, ['暴击伤害'], 'percent')
  const mastery = pickAfterLabel(panelLines, ['异常精通'], 'int')

  if (hp != null) externalPanel.hp = hp
  if (atk != null) externalPanel.atk = atk
  if (penRate != null) externalPanel.penRate = penRate
  if (pen != null) externalPanel.pen = pen
  if (dmgBonus != null) externalPanel.dmgBonus = dmgBonus
  if (critRate != null) externalPanel.critRate = critRate
  if (critDmg != null) externalPanel.critDmg = critDmg
  if (mastery != null) externalPanel.mastery = mastery

  let agent: { id: string; name: string } | null = null
  let agentRaw: string | null = null
  for (const line of panelLines) {
    if (line.length < 2 || line.length > 12) continue
    if (/UID|AGENT|LV\.|驱动|米游|绝|区/.test(line)) continue
    const hit = findBestName(line, catalogs.agents)
    if (hit) {
      agent = hit
      agentRaw = line
      break
    }
  }

  let wengine: { id: string; name: string } | null = null
  let wengineRaw: string | null = null
  const wengineScanEnd = discStart > 0 ? discStart : lines.length
  for (let i = 0; i < wengineScanEnd; i++) {
    const line = lines[i]!
    if (line.length < 2 || line.length > 12) continue
    if (/驱动盘|攻击力百分比|UID|AGENT|LV\./.test(line)) continue
    const hit = findBestName(line, catalogs.wengines)
    if (hit) {
      wengine = hit
      wengineRaw = line
    }
  }

  const rank = detectRankFromLines(panelLines)
  const wengineRefine = detectRefineFromLines(lines)
  const discs = countDiscsFromLines(lines, catalogs.driveDiscs)

  if (!agent) warnings.push('未能从 OCR 文本匹配角色名')
  if (!wengine) warnings.push('未能从 OCR 文本匹配音擎名')
  if (!discs.twoPiece && !discs.fourPiece) warnings.push('未能从 OCR 文本统计驱动盘套装')
  if (rank === 0) warnings.push('影画数字未在 OCR 文本中定位到，已按 0 影')
  if (externalPanel.penRate == null || externalPanel.pen == null || externalPanel.dmgBonus == null) {
    const missing: string[] = []
    if (externalPanel.penRate == null) missing.push('穿透率')
    if (externalPanel.pen == null) missing.push('穿透值')
    if (externalPanel.dmgBonus == null) missing.push('增伤')
    warnings.push(`属性未识别：${missing.join('、')}`)
  }

  return {
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? agentRaw,
    rank,
    wengineId: wengine?.id ?? null,
    wengineName: wengine?.name ?? wengineRaw,
    wengineRefine,
    twoPieceDriveDiscId: discs.twoPiece?.id ?? null,
    twoPieceDriveDiscName: discs.twoPiece?.name ?? null,
    fourPieceDriveDiscId: discs.fourPiece?.id ?? null,
    fourPieceDriveDiscName: discs.fourPiece?.name ?? null,
    externalPanel,
    warnings,
  }
}

/** 统一入口：带坐标 JSON 或纯文本行结果均可 */
export function recognizeFromOcrApiOutput(
  raw: unknown,
  catalogs: Catalogs,
): PanelScreenshotRecognition {
  let result: PanelScreenshotRecognition
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) {
      result = recognizeFromPlainOcrText('', catalogs)
    } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (extractTencentDetections(parsed).length) {
          result = recognizeFromTencentOcrJson(parsed, catalogs)
        } else {
          result = recognizeFromPlainOcrText(trimmed, catalogs)
        }
      } catch {
        result = recognizeFromPlainOcrText(trimmed, catalogs)
      }
    } else {
      result = recognizeFromPlainOcrText(trimmed, catalogs)
    }
  } else {
    result = recognizeFromTencentOcrJson(raw, catalogs)
  }

  const mains = recognizeDriveDiscMainStatsFromOcrApiOutput(raw)
  if (Object.keys(mains).length) {
    result.driveDiscMainStats = mains
  } else {
    result.warnings.push('未识别到 4/5/6 号盘主属性，词条反推将使用当前下拉选择')
  }
  return result
}

