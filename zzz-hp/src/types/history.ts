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
  /** 换算到 953 防御的等效血量文案 */
  hpConverted953?: string
  hpConverted953Value?: number
  altHp: string
  elements: string[]
  defense?: number
  weakness?: string
  resistance?: string
  footer?: string
  /** 怪物危局基础血量 */
  crisisBaseHp?: number | null
  /** 危局血量系数整数百分比 */
  hpCoeffPercent?: number | null
  /** 危局血量系数展示，如 150% */
  hpCoeffLabel?: string | null
  /** 是否为困难房间（3.1+） */
  isHardRoom?: boolean
}

export interface PhaseData {
  id: string
  version: string
  phase: string
  dateRange: string
  tid: string
  rawHp: string
  totalHp?: number
  /** 换算到 953 防御的总血量文案 */
  rawHpConverted953?: string
  totalHpConverted953?: number
  /** 困难模式总血量（不计入普通总血量） */
  rawHardHp?: string
  hardTotalHp?: number
  rawHardHpConverted953?: string
  hardTotalHpConverted953?: number
  /** 开始日期晚于今天，仅管理员可见 */
  isHidden?: boolean
  buffs: BuffInfo[]
  enemies: EnemySlot[]
}

export const modeTitles: Record<ModeKey, string> = {
  'crisis-assault': '危局强袭战',
  defense: '式舆防卫战',
  deduction: '临界推演',
}
