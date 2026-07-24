/** 危局困难房间编码（ID 末位 / room 字段） */
export const CRISIS_HARD_ROOM_CODE = '4'

export function isCrisisHardRoom(room: string | number | null | undefined): boolean {
  const text = String(room ?? '').trim()
  if (!text) return false
  if (text === '困难' || text.toLowerCase() === 'hard') return true
  return text.replace(/\D/g, '') === CRISIS_HARD_ROOM_CODE
}

/** 管理端/入库用房间码：困难 → 4 */
export function normalizeCrisisRoomCode(room: string | number | null | undefined): string {
  const text = String(room ?? '').trim()
  if (!text) return ''
  if (isCrisisHardRoom(text)) return CRISIS_HARD_ROOM_CODE
  return text.replace(/\D/g, '')
}

export function formatCrisisRoomLabel(room: string | number | null | undefined): string {
  if (isCrisisHardRoom(room)) return '困难'
  const text = String(room ?? '').trim()
  return text || '—'
}

/** 版本号比较，如 3.1 >= 3.1 */
export function isVersionAtLeast(version: string | number, minimum: string): boolean {
  const parse = (value: string | number) =>
    String(value)
      .trim()
      .split('.')
      .map((part) => Number(part.replace(/\D/g, '')) || 0)

  const left = parse(version)
  const right = parse(minimum)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return true
}

export function supportsCrisisHardRoom(version: string | number): boolean {
  return isVersionAtLeast(version, '3.1')
}
