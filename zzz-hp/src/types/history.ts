export type ModeKey = 'crisis-assault' | 'defense' | 'deduction'

export interface BuffInfo {
  name: string
  icon: string
  lines: string[]
  imageUrl?: string
}

export interface EnemySlot {
  label: string
  subStats: string
  bossName?: string
  imageUrl?: string
  hp: string
  hpValue?: number
  altHp: string
  elements: string[]
  defense?: number
  weakness?: string
  resistance?: string
  footer?: string
}

export interface PhaseData {
  id: string
  version: string
  phase: string
  dateRange: string
  tid: string
  rawHp: string
  totalHp?: number
  buffs: [BuffInfo, BuffInfo, BuffInfo]
  enemies: [EnemySlot, EnemySlot, EnemySlot]
}

export const modeTitles: Record<ModeKey, string> = {
  'crisis-assault': '危局强袭战',
  defense: '式舆防卫战',
  deduction: '临界推演',
}
