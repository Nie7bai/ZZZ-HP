import type {
  AffixDriveDiscMainStats,
  DriveDiscSlot4StatId,
  DriveDiscSlot5StatId,
  DriveDiscSlot6StatId,
} from '@/types/calculatorPanel'
import {
  DRIVE_DISC_SLOT_4_OPTIONS,
  DRIVE_DISC_SLOT_5_OPTIONS,
  DRIVE_DISC_SLOT_6_OPTIONS,
} from '@/utils/affixDriveDiscConfig'
import {
  extractTencentDetections,
  type TencentOcrDetection,
} from '@/utils/panelTencentOcrRecognize'

/** 与 PANEL_LAYOUT.discNames 一致；略加高以覆盖 6 号盘底部主属性数值 */
const DISC_REGION = { x: 0.02, y: 0.46, w: 0.96, h: 0.32 } as const
const DISC_Y_MIN = 0.44

interface OcrPoint {
  text: string
  cx: number
  cy: number
  x: number
  y: number
  w: number
  h: number
}

function normalize(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[·•|｜,，.。:：;；"'“”‘’\[\]【】]/g, '')
    .replace(/％/g, '%')
}

function toPoint(d: TencentOcrDetection): OcrPoint | null {
  const text = (d.DetectedText ?? '').trim()
  if (!text) return null
  const p = d.ItemPolygon
  if (p && Number.isFinite(p.X) && Number.isFinite(p.Y)) {
    return {
      text,
      x: p.X,
      y: p.Y,
      w: p.Width,
      h: p.Height,
      cx: p.X + p.Width / 2,
      cy: p.Y + p.Height / 2,
    }
  }
  const poly = d.Polygon
  if (!poly?.length) return null
  const xs = poly.map((pt) => pt.X)
  const ys = poly.map((pt) => pt.Y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const w = Math.max(...xs) - x
  const h = Math.max(...ys) - y
  return { text, x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}

function pageSize(points: OcrPoint[], detections: TencentOcrDetection[]) {
  let pageW = 1
  let pageH = 1
  for (const p of points) {
    pageW = Math.max(pageW, p.x + p.w, p.cx)
    pageH = Math.max(pageH, p.y + p.h, p.cy)
  }
  // 部分腾讯结果会带整图宽高，优先用以防相对坐标被稀疏散点拉伸
  for (const d of detections) {
    const poly = d.ItemPolygon
    if (poly && Number.isFinite(poly.X) && Number.isFinite(poly.Width)) {
      pageW = Math.max(pageW, poly.X + poly.Width)
      pageH = Math.max(pageH, (poly.Y ?? 0) + (poly.Height ?? 0))
    }
  }
  return { pageW, pageH }
}

function discSlotFromPoint(p: OcrPoint, pageW: number, pageH: number): 1 | 2 | 3 | 4 | 5 | 6 | null {
  if (p.cy / pageH < DISC_Y_MIN) return null
  const frame = {
    x: DISC_REGION.x * pageW,
    y: DISC_REGION.y * pageH,
    w: DISC_REGION.w * pageW,
    h: DISC_REGION.h * pageH,
  }
  const padX = frame.w * 0.01
  const padY = frame.h * 0.03
  const cellW = (frame.w - padX * 2) / 3
  const cellH = (frame.h - padY * 2) / 2
  const localX = p.cx - frame.x - padX
  const localY = p.cy - frame.y - padY
  // 6 号盘在右下角，略放宽右/下边界，避免主属性文字被裁掉
  if (localX < -cellW * 0.25 || localY < -cellH * 0.25) return null
  if (localX > cellW * 3.15 || localY > cellH * 2.2) return null
  const col = Math.min(2, Math.max(0, Math.floor(localX / cellW)))
  const row = Math.min(1, Math.max(0, Math.floor(localY / cellH)))
  // 右下角贴近格线时优先判为 6 号，减少落到 5 号
  if (row === 1 && localX / cellW >= 1.85) return 6
  return (row * 3 + col + 1) as 1 | 2 | 3 | 4 | 5 | 6
}

type SlotOption = { id: string; label: string; value: number; keywords: string[] }

function buildOptions(
  options: { id: string; label: string; value: number }[],
): SlotOption[] {
  return options.map((o) => {
    const keywords: string[] = []
    const name = o.label.replace(/\s*\d+(\.\d+)?%?\s*$/, '').trim()
    keywords.push(name)
    if (o.id === 'critDmg') keywords.push('暴击伤害', '爆伤', '暴伤')
    if (o.id === 'critRate') keywords.push('暴击率', '暴击')
    if (o.id === 'externalAtkPercent') keywords.push('攻击力百分比', '攻击百分比', '局外攻击', '攻击力')
    if (o.id === 'externalHpPercent') keywords.push('生命值百分比', '生命百分比', '局外生命', '生命值')
    if (o.id === 'externalDefPercent') keywords.push('防御力百分比', '防御百分比', '局外防御', '防御力')
    if (o.id === 'mastery') keywords.push('异常精通', '精通')
    if (o.id === 'penRate') keywords.push('穿透率')
    if (o.id === 'dmgBonus') keywords.push('属性伤害加成', '伤害加成', '增伤')
    if (o.id === 'anomalyControl') keywords.push('异常掌控', '掌控')
    if (o.id === 'impact') keywords.push('冲击力')
    if (o.id === 'energyRegen') {
      keywords.push('能量自动回复', '能量回复', '能量恢复', '自动回复', '能量回')
    }
    return { ...o, keywords: [...new Set(keywords)].sort((a, b) => b.length - a.length) }
  })
}

const SLOT4 = buildOptions(DRIVE_DISC_SLOT_4_OPTIONS)
const SLOT5 = buildOptions(DRIVE_DISC_SLOT_5_OPTIONS)
const SLOT6 = buildOptions(DRIVE_DISC_SLOT_6_OPTIONS)

/** 6 号盘独有主属性，数值特征强，优先于通用生命/攻击/防御% */
const SLOT6_EXCLUSIVE_IDS = new Set(['anomalyControl', 'impact', 'energyRegen'])

function numsNear(text: string, value: number): boolean {
  const nums = [...text.matchAll(/(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]))
  return nums.some((n) => Math.abs(n - value) <= Math.max(1.5, value * 0.08))
}

function scoreOption(cellText: string, option: SlotOption, slot: 4 | 5 | 6): number {
  const t = normalize(cellText)
  let score = 0
  for (const key of option.keywords) {
    const k = normalize(key)
    if (k && t.includes(k)) {
      score = Math.max(score, k.length * 3)
      // 6 号独有词加权，降低被局外面板「冲击力/异常掌控」或邻格污染误伤
      if (slot === 6 && SLOT6_EXCLUSIVE_IDS.has(option.id) && k.length >= 3) {
        score += 12
      }
    }
  }
  const nums = [...cellText.matchAll(/(\d+(?:\.\d+)?)\s*%?/g)].map((m) => Number(m[1]))
  for (const n of nums) {
    if (Math.abs(n - option.value) <= Math.max(1.5, option.value * 0.08)) {
      score += 20
      if (slot === 6 && SLOT6_EXCLUSIVE_IDS.has(option.id)) {
        // 冲击 18% / 能量 60% 区分度高
        if (option.id === 'impact' && Math.abs(n - 18) <= 1.5) score += 18
        if (option.id === 'energyRegen' && Math.abs(n - 60) <= 3) score += 18
        if (option.id === 'anomalyControl' && Math.abs(n - 30) <= 1.5) score += 8
      }
    }
  }
  return score
}

function pickBestOption(
  cellText: string,
  options: SlotOption[],
  slot: 4 | 5 | 6,
): SlotOption | null {
  let best: { option: SlotOption; score: number } | null = null
  const t = normalize(cellText)

  for (const option of options) {
    let score = scoreOption(cellText, option, slot)
    if (score <= 0) continue

    // 避免「攻击力」无百分比时误匹配 30% 主属性：要求有百分相关或数值贴合
    if (
      (option.id === 'externalAtkPercent' ||
        option.id === 'externalHpPercent' ||
        option.id === 'externalDefPercent') &&
      !/%|百分/.test(t) &&
      !numsNear(cellText, option.value)
    ) {
      continue
    }

    // 「暴击」勿吞掉「暴击伤害」：若同时含伤害关键词，跳过 critRate
    if (option.id === 'critRate' && /伤害|爆伤|暴伤/.test(t)) continue

    // 6 号：有「精通」无「掌控」时不选异常掌控（避免面板「异常精通」误入）
    if (option.id === 'anomalyControl' && /精通/.test(t) && !/掌控/.test(t)) continue
    // 6 号：独有主属性出现时，压低通用攻/生/防% 的分，减少串格
    if (
      slot === 6 &&
      (option.id === 'externalAtkPercent' ||
        option.id === 'externalHpPercent' ||
        option.id === 'externalDefPercent') &&
      (/异常掌控|掌控|冲击力|能量自动|能量回|自动回复/.test(t) ||
        numsNear(cellText, 18) ||
        numsNear(cellText, 60))
    ) {
      score -= 25
    }

    if (!best || score > best.score) best = { option, score }
  }

  const minScore = slot === 6 ? 8 : 6
  return best && best.score >= minScore ? best.option : null
}

function matchCellMain(
  cellText: string,
  slot: 4 | 5 | 6,
): Partial<AffixDriveDiscMainStats> {
  if (slot === 4) {
    const hit = pickBestOption(cellText, SLOT4, 4)
    return hit ? { slot4MainStat: hit.id as DriveDiscSlot4StatId } : {}
  }
  if (slot === 5) {
    const hit = pickBestOption(cellText, SLOT5, 5)
    return hit ? { slot5MainStat: hit.id as DriveDiscSlot5StatId } : {}
  }
  const hit = pickBestOption(cellText, SLOT6, 6)
  return hit ? { slot6MainStat: hit.id as DriveDiscSlot6StatId } : {}
}

/** 从腾讯 OCR 坐标结果识别 4/5/6 号盘主属性 */
export function recognizeDriveDiscMainStatsFromOcr(
  raw: unknown,
): Partial<AffixDriveDiscMainStats> {
  const detections = extractTencentDetections(raw)
  if (!detections.length) return recognizeDriveDiscMainStatsFromPlainText(String(raw ?? ''))

  const points = detections.map(toPoint).filter((p): p is OcrPoint => Boolean(p))
  const { pageW, pageH } = pageSize(points, detections)
  const bySlot = new Map<4 | 5 | 6, string[]>()

  for (const p of points) {
    const slot = discSlotFromPoint(p, pageW, pageH)
    if (slot !== 4 && slot !== 5 && slot !== 6) continue
    const list = bySlot.get(slot) ?? []
    list.push(p.text)
    bySlot.set(slot, list)
  }

  const result: Partial<AffixDriveDiscMainStats> = {}
  for (const slot of [4, 5, 6] as const) {
    const texts = bySlot.get(slot)
    if (!texts?.length) continue
    Object.assign(result, matchCellMain(texts.join(' '), slot))
  }

  // 6 号若未命中：在下半行右侧文本里再扫一遍独有主属性
  if (!result.slot6MainStat) {
    const rightBottom = points
      .filter((p) => {
        const nx = p.cx / pageW
        const ny = p.cy / pageH
        return ny >= 0.55 && nx >= 0.62
      })
      .map((p) => p.text)
      .join(' ')
    if (rightBottom) Object.assign(result, matchCellMain(rightBottom, 6))
  }

  return result
}

/** 纯文本兜底：按 [4]/[5]/[6] 或「4号」分段识别 */
export function recognizeDriveDiscMainStatsFromPlainText(
  text: string,
): Partial<AffixDriveDiscMainStats> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (!lines.length) return {}

  const chunks: { slot: 4 | 5 | 6; text: string }[] = []
  let current: 4 | 5 | 6 | null = null
  let buf: string[] = []

  const flush = () => {
    if (current && buf.length) chunks.push({ slot: current, text: buf.join(' ') })
    buf = []
  }

  for (const line of lines) {
    const m = line.match(/\[([456])\]/) || line.match(/([456])\s*号/)
    if (m) {
      flush()
      current = Number(m[1]) as 4 | 5 | 6
    }
    if (current) buf.push(line)
  }
  flush()

  const result: Partial<AffixDriveDiscMainStats> = {}
  for (const chunk of chunks) {
    Object.assign(result, matchCellMain(chunk.text, chunk.slot))
  }

  // 无槽位标记时：整段驱动盘文本里按选项分值匹配不互相覆盖的唯一高分项（弱兜底）
  if (!Object.keys(result).length) {
    const discStart = lines.findIndex((l) => /驱动盘|\[\d\]/.test(l))
    const discText = (discStart >= 0 ? lines.slice(discStart) : lines).join(' ')
    const s4 = pickBestOption(discText, SLOT4, 4)
    const s5 = pickBestOption(discText, SLOT5, 5)
    const s6 = pickBestOption(discText, SLOT6, 6)
    // 仅当数值特征足够强才采纳，避免误填
    if (s4 && numsNear(discText, s4.value)) result.slot4MainStat = s4.id as DriveDiscSlot4StatId
    if (s5 && numsNear(discText, s5.value) && s5.id !== s4?.id) {
      result.slot5MainStat = s5.id as DriveDiscSlot5StatId
    }
    if (s6 && (numsNear(discText, s6.value) || SLOT6_EXCLUSIVE_IDS.has(s6.id))) {
      result.slot6MainStat = s6.id as DriveDiscSlot6StatId
    }
  }

  return result
}

export function recognizeDriveDiscMainStatsFromOcrApiOutput(
  raw: unknown,
): Partial<AffixDriveDiscMainStats> {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return {}
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (extractTencentDetections(parsed).length) {
          return recognizeDriveDiscMainStatsFromOcr(parsed)
        }
      } catch {
        /* fallthrough */
      }
    }
    return recognizeDriveDiscMainStatsFromPlainText(trimmed)
  }
  return recognizeDriveDiscMainStatsFromOcr(raw)
}
