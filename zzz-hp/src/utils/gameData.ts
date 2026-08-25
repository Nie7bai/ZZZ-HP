const elementMap: Record<string, string> = {
  冰: '❄️',
  火: '🔥',
  电: '⚡',
  以太: '🌀',
  物理: '⚔️',
  风: '💨',
}

export function formatHp(value: number): string {
  return value.toLocaleString('en-US')
}

export function formatHpDelta(delta: number): string {
  const formatted = formatHp(Math.abs(delta))
  return delta >= 0 ? `+${formatted}` : `-${formatted}`
}

export function formatHpExpansionPercent(current: number, previous: number): string | null {
  if (!previous) return null
  const percent = ((current - previous) / previous) * 100
  if (Math.abs(percent) < 1e-6) return null
  const fixed = percent.toFixed(1)
  return percent > 0 ? `+${fixed}%` : `${fixed}%`
}

export function parseHpString(value: string): number | null {
  if (!value || value === '—') return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseWeaknessElements(weakness: string | null): string[] {
  if (!weakness) return []
  return weakness
    .split(/\s+/)
    .map((item) => elementMap[item] ?? item)
    .filter(Boolean)
}

export function splitBuffLines(text: string | null): string[] {
  if (!text) return []
  return text
    .replace(/\\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function resolveAssetUrl(path?: string | null): string | undefined {
  if (!path) return undefined
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  // 分段编码：中文 / 「」/ 罗马数字等文件名才能稳定走静态资源
  return path
    .split('/')
    .map((segment) => {
      if (!segment) return segment
      try {
        // 已编码则保持，避免二次 encode
        if (segment !== decodeURIComponent(segment)) return segment
      } catch {
        /* 非法 % 序列：按原文编码 */
      }
      return encodeURIComponent(segment)
    })
    .join('/')
}

export function hasBossDisplayImage(image?: string | null): boolean {
  return Boolean(String(image ?? '').trim())
}

function formatDotDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${year}.${Number(month)}.${Number(day)}`
}

export function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start || !end) return '日期待更新'
  return `${formatDotDate(start)} - ${formatDotDate(end)}`
}

export function formatExpansion(value: number): string {
  return value.toFixed(4)
}
