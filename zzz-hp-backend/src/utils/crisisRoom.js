export const CRISIS_HARD_ROOM_CODE = '4'

export function isCrisisHardRoom(room) {
  const text = String(room ?? '').trim()
  if (!text) return false
  if (text === '困难' || text.toLowerCase() === 'hard') return true
  return text.replace(/\D/g, '') === CRISIS_HARD_ROOM_CODE
}

export function normalizeCrisisRoomCode(room) {
  const text = String(room ?? '').trim()
  if (!text) return ''
  if (isCrisisHardRoom(text)) return CRISIS_HARD_ROOM_CODE
  return text.replace(/\D/g, '')
}

export function formatCrisisRoomLabel(room) {
  if (isCrisisHardRoom(room)) return '困难'
  const text = String(room ?? '').trim()
  return text || '—'
}

export function isVersionAtLeast(version, minimum) {
  const parse = (value) =>
    String(value)
      .trim()
      .split('.')
      .map((part) => Number(String(part).replace(/\D/g, '')) || 0)

  const left = parse(version)
  const right = parse(minimum)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return true
}

export function supportsCrisisHardRoom(version) {
  return isVersionAtLeast(version, '3.1')
}

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})/

/** 统一为 YYYY-MM-DD；无法解析则返回 null */
export function formatCalendarDate(startDate) {
  if (!startDate) return null
  if (startDate instanceof Date) {
    const year = startDate.getFullYear()
    const month = String(startDate.getMonth() + 1).padStart(2, '0')
    const day = String(startDate.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
  const text = String(startDate).trim()
  const match = text.match(DATE_RE)
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

export function todayCalendarDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** 日历日加减（按本地年月日，避免时区漂移） */
export function addCalendarDays(dateValue, days) {
  const formatted = formatCalendarDate(dateValue)
  if (!formatted) return null
  const [y, m, d] = formatted.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + Number(days || 0))
  return formatCalendarDate(dt)
}

/** startDate 为空视为可显示；有日期则须 <= 今天 */
export function isStartDateOnOrBeforeToday(startDate) {
  const formatted = formatCalendarDate(startDate)
  if (!formatted) return true
  return formatted <= todayCalendarDate()
}

/**
 * 期数是否进入公开列表：开始日为空视为可显示；有开始日则须 <= 今天（仅当天及之后公开）。
 */
export function isSeasonPubliclyVisible(startDate) {
  return isStartDateOnOrBeforeToday(startDate)
}

/** 是否尚未到官方开始日（用于「未公开」角标；与是否进列表一致） */
export function isSeasonUnreleased(startDate) {
  if (!startDate) return false
  return !isStartDateOnOrBeforeToday(startDate)
}
