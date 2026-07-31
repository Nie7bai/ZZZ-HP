import type { BuffStatModifiers } from '@/types/calculator'
import type {
  AffixCounts,
  AffixDriveDiscMainStats,
  PanelCalcMode,
  PanelStats,
} from '@/types/calculatorPanel'
import type { CharacterAttrKey } from '@/types/calculator'

/** 转模增益角色局外面板（按 agentId 存部分属性） */
export type DamageCalcConvertSlotPanels = Record<
  string,
  Partial<Record<CharacterAttrKey, number>>
>

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
  baseDamageSource: 'atk' | 'pierce' | 'def'
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
    scope?: import('@/types/calculator').BuffScope
    applyTarget?: import('@/types/calculator').BuffApplyTarget
    skillCategory?: import('@/types/calculator').BuffSkillTargetId
    skillSubcategoryId?: string | null
    appliesToAnomaly?: boolean
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
  /** 异常产生角色局外面板（按 agentId） */
  anomalySlotPanels?: Record<string, PanelStats>
  /** 转模增益角色局外面板（按 agentId） */
  convertSlotPanels?: DamageCalcConvertSlotPanels
}
