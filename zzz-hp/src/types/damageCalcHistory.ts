import type { BuffStatModifiers } from '@/types/calculator'
import type {
  AffixCounts,
  AffixDriveDiscMainStats,
  PanelCalcMode,
  PanelStats,
} from '@/types/calculatorPanel'

export interface DamageCalcTeamSlotSnapshot {
  agentId: string
  rank: number
  wengineId: string
  wengineRefine: number
  isMainC: boolean
  twoPieceDriveDiscId: string
  fourPieceDriveDiscId: string
}

export interface DamageCalcEnemyInputSnapshot {
  defense: number
  resistanceType: 'weak' | 'normal' | 'res20' | 'res40'
  vulnerableMultiplier: number
  staggerMultiplier: number
  specialMultiplier: number
  level: number
}

export interface DamageCalcPanelSnapshot {
  baseDamageSource: 'atk' | 'pierce'
  externalPanel: PanelStats
  affixCounts: AffixCounts
  affixDriveDiscMainStats: AffixDriveDiscMainStats
  extraMods: BuffStatModifiers
  /** 额外 Buff 增益条目（优先于扁平 extraMods） */
  extraGains?: Array<{
    id: string
    name: string
    stat: keyof BuffStatModifiers
    value: number
    applySituation?: import('@/types/calculator').BuffApplySituation
  }>
  enemyInput: DamageCalcEnemyInputSnapshot
}

export interface DamageCalcHistoryEntry {
  id: string
  name: string
  savedAt: number
  teamSlots: DamageCalcTeamSlotSnapshot[]
  activeSlot: number
  selectedBangbooId: string
  bangbooRefine: number
  panelCalcMode: PanelCalcMode
  panelState: DamageCalcPanelSnapshot
}
