export type AdminCalculatorPanel = 'agent' | 'wengine' | 'bangboo' | 'drive-disc'

export type SupportStatNeed =
  | 'hp'
  | 'atk'
  | 'critRate'
  | 'critDmg'
  | 'dmgBonus'
  | 'penRate'
  | 'pen'
  | 'resPen'

export interface BuffStatModifiers {
  inCombatHpPercent: number
  inCombatAtkPercent: number
  externalHpPercent: number
  externalAtkPercent: number
  atk: number
  dmgBonus: number
  critRate: number
  critDmg: number
  penRate: number
  reduceDefense: number
  resPen: number
  mastery: number
  pierce: number
  vulnerable: number
  staggerVulnerable: number
  special: number
  anomalyCritRate: number
  anomalyCritDmg: number
  anomalyDmgBonus: number
  directDmgMult: number
  anomalyMult: number
  /** 紊乱基础倍率% */
  disorderBaseMult: number
  /** 异常持续时间（秒） */
  anomalyDuration: number
  /** 紊乱补偿倍率% */
  disorderCompMult: number
  /** 乱流基础倍率% */
  turbulenceBaseMult: number
  /** 乱流补偿倍率% */
  turbulenceCompMult: number
  /** 紊乱增伤% */
  disorderDmgBonus: number
  /** 乱流增伤% */
  turbulenceDmgBonus: number
}

export type BuffStatKey = keyof BuffStatModifiers

export interface AgentMindscapeRankBuffs {
  selfMods: BuffStatModifiers
  teamMods: BuffStatModifiers
}

export interface AgentBasePanel {
  hp: number
  atk: number
  def: number
  critRate: number
  critDmg: number
  mastery: number
  penRate: number
  dmgBonus: number
  pen: number
  anomalyCritRate: number
  anomalyCritDmg: number
  anomalyDmgBonus: number
  /** 直伤倍率%，默认 100（即 ×1） */
  directDmgMult: number
  /** 异常倍率%，按属性默认（如冰 500） */
  anomalyMult: number
  /** 紊乱基础倍率% */
  disorderBaseMult: number
  /** 异常持续时间（秒） */
  anomalyDuration: number
  /** 紊乱补偿倍率% */
  disorderCompMult: number
  /** 乱流基础倍率% */
  turbulenceBaseMult: number
  /** 乱流补偿倍率% */
  turbulenceCompMult: number
  /** 紊乱增伤% */
  disorderDmgBonus: number
  /** 乱流增伤% */
  turbulenceDmgBonus: number
}

export interface WengineAdvancedStats {
  critRate: number
  critDmg: number
  energyRegen: number
  mastery: number
  externalAtkPercent: number
  externalHpPercent: number
  penRate: number
}

export interface AgentBuffDoc {
  id: string
  name: string
  profession: string
  element: string
  supportNeeds: SupportStatNeed[]
  avatar_image: string | null
  note: string
  basePanel: AgentBasePanel
  mindscapeNotes: string[]
  mindscapeBuffs: AgentMindscapeRankBuffs[]
}

export interface WengineBuffDoc {
  id: string
  name: string
  profession: string
  rarity: 'S' | 'A' | 'B'
  avatar_image: string | null
  note: string
  baseAtk: number
  advancedStats: WengineAdvancedStats
  fixedBuffs: AgentMindscapeRankBuffs
  refinementBuffs: AgentMindscapeRankBuffs[]
}

export interface BangbooBuffDoc {
  id: string
  name: string
  avatar_image: string | null
  fixedMods: BuffStatModifiers
  refinementMods: BuffStatModifiers[]
}

export interface DriveDiscBuffDoc {
  id: string
  name: string
  avatar_image: string | null
  twoPieceNote: string
  fourPieceNote: string
  twoPieceMods: BuffStatModifiers
  fourPieceBuffs: AgentMindscapeRankBuffs
}

export interface CalculatorBuffData {
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboos: BangbooBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
}
