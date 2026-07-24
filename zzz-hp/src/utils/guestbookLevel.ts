export const MAX_GUESTBOOK_LEVEL = 16

export const LEVEL_EXP_REQUIRED: Record<number, number> = {
  1: 30,
  2: 110,
  3: 290,
  4: 592,
  5: 1168,
  6: 2190,
  7: 2190,
  8: 2190,
  9: 2920,
  10: 3650,
  11: 3650,
  12: 3942,
  13: 4818,
  14: 5840,
  15: 8030,
}

export interface GuestbookExpProgress {
  level: number
  exp: number
  expRequired: number | null
  isMaxLevel: boolean
}

export function mapExpProgress(levelRaw?: number, expRaw?: number): GuestbookExpProgress {
  const level = Math.min(Math.max(Number(levelRaw) || 1, 1), MAX_GUESTBOOK_LEVEL)
  const exp = Math.max(Number(expRaw) || 0, 0)
  if (level >= MAX_GUESTBOOK_LEVEL) {
    return { level, exp, expRequired: null, isMaxLevel: true }
  }
  return {
    level,
    exp,
    expRequired: LEVEL_EXP_REQUIRED[level] ?? null,
    isMaxLevel: false,
  }
}

export function expBarPercent(progress: GuestbookExpProgress) {
  if (progress.isMaxLevel || !progress.expRequired) return 100
  if (progress.expRequired <= 0) return 0
  return Math.min(100, Math.round((progress.exp / progress.expRequired) * 100))
}

export function expBarLabel(progress: GuestbookExpProgress) {
  if (progress.isMaxLevel) return `${progress.exp}`
  return `${progress.exp}/${progress.expRequired ?? 0}`
}

export interface GuestbookExpDailyTask {
  key: string
  label: string
  exp: number
  dailyLimit: number
  used: number
}

export const EXP_DAILY_TASK_DEFS = [
  { key: 'checkin', label: '打卡', exp: 5, dailyLimit: 1 },
  { key: 'post', label: '发主帖', exp: 6, dailyLimit: 2 },
  { key: 'comment', label: '发评论', exp: 3, dailyLimit: 3 },
  { key: 'like', label: '点赞', exp: 1, dailyLimit: 10 },
  { key: 'receive_like', label: '被点赞', exp: 2, dailyLimit: 10 },
  { key: 'receive_comment', label: '被回复', exp: 4, dailyLimit: 10 },
  { key: 'receive_favorite', label: '被收藏', exp: 2, dailyLimit: 10 },
] as const

export function levelGrowthRows() {
  return Array.from({ length: MAX_GUESTBOOK_LEVEL - 1 }, (_, i) => {
    const level = i + 1
    return { level, required: LEVEL_EXP_REQUIRED[level] ?? 0 }
  })
}
