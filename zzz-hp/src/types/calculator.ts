export type AdminCalculatorPanel =
  | 'agent'
  | 'wengine'
  | 'bangboo'
  | 'drive-disc'
  | 'skill-subcategory'

export type SupportStatNeed =
  | 'hp'
  | 'atk'
  | 'critRate'
  | 'critDmg'
  | 'dmgBonus'
  | 'penRate'
  | 'pen'
  | 'resPen'

export type BuffScope = 'general' | 'skill'
export type BuffApplyTarget = 'self' | 'team'
/** 增益作用情况：全局 / 仅失衡期 / 仅非失衡期 */
export type BuffApplySituation = 'global' | 'stagger' | 'non_stagger'
export type BuffEffectKind = 'fixed' | 'stacked' | 'convert'
export type DamageCalcKind = 'direct' | 'anomaly'
export type StaggerPhase = 'normal' | 'stagger'

export type SkillCategoryId =
  | 'basic'
  | 'dodge'
  | 'assist'
  | 'special'
  | 'chain'
  | 'ultimate'

export const SKILL_CATEGORY_OPTIONS: { id: SkillCategoryId; label: string }[] = [
  { id: 'basic', label: '普通攻击' },
  { id: 'dodge', label: '闪避' },
  { id: 'assist', label: '支援技' },
  { id: 'special', label: '特殊技' },
  { id: 'chain', label: '连携技' },
  { id: 'ultimate', label: '终结技' },
]

/** 转模来源：局外/局内角色属性 */
export type CharacterAttrKey =
  | 'externalHp'
  | 'inCombatHp'
  | 'externalAtk'
  | 'inCombatAtk'
  | 'mastery'
  | 'anomalyControl'
  | 'energyRegen'
  | 'penRate'
  | 'impact'
  | 'def'

export const CHARACTER_ATTR_OPTIONS: { id: CharacterAttrKey; label: string }[] = [
  { id: 'externalHp', label: '局外生命' },
  { id: 'inCombatHp', label: '局内生命' },
  { id: 'externalAtk', label: '局外攻击' },
  { id: 'inCombatAtk', label: '局内攻击' },
  { id: 'mastery', label: '异常精通' },
  { id: 'anomalyControl', label: '异常掌控' },
  { id: 'energyRegen', label: '能量恢复' },
  { id: 'penRate', label: '穿透率' },
  { id: 'impact', label: '冲击力' },
  { id: 'def', label: '防御力' },
]

export interface BuffStatModifiers {
  /** 固定生命 */
  hp: number
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
  /** 贯穿增伤% */
  pierceDmgBonus: number
  /** 易伤%（独立易伤区，常驻） */
  vulnerable: number
  /** 全局失衡易伤%（失衡/非失衡均生效） */
  globalStaggerVulnerable: number
  /** 失衡易伤%（全局存在，仅失衡期生效） */
  staggerVulnerable: number
  /** 失衡易伤（仅失衡）%（仅失衡期存在并生效） */
  staggerVulnerableOnly: number
  special: number
  anomalyCritRate: number
  anomalyCritDmg: number
  anomalyDmgBonus: number
  /** 异放增伤% */
  anomalyReleaseDmgBonus: number
  /** 异放暴击% */
  anomalyReleaseCritRate: number
  /** 异放爆伤% */
  anomalyReleaseCritDmg: number
  /** 异放倍率加算% */
  anomalyReleaseMult: number
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
  /** 招式伤害加成%（进增伤区） */
  skillDmgBonus: number
  /** 招式倍率加算%（进直伤倍率区） */
  skillMultiplierBonus: number
}

export type BuffStatKey = keyof BuffStatModifiers

export interface BuffEffectConvert {
  from: CharacterAttrKey
  ratioPercent: number
  cap?: number | null
  /** 转模手输基础值的默认值（增益编辑里配置） */
  defaultBase?: number | null
}

export interface BuffEffect {
  id: string
  /** @deprecated 已改用效果块名称展示，仅兼容旧数据 */
  origin?: string
  scope: BuffScope
  applyTarget: BuffApplyTarget
  /** 作用情况：全局 / 失衡期 / 非失衡期，默认全局 */
  applySituation?: BuffApplySituation
  /** 招式：小类空 = 整大类生效 */
  skillCategory?: SkillCategoryId
  skillSubcategoryId?: string | null
  /** 属性限定（属性增伤/异常增伤/抗性穿透等） */
  elementFilter?: 'all' | string[]
  kind: BuffEffectKind
  stat: BuffStatKey
  value?: number
  stackable?: boolean
  maxStacks?: number
  valuePerStack?: number
  defaultStacks?: number
  convert?: BuffEffectConvert
  /**
   * 异常结算是否也吃这条效果。
   * 默认：通用增益参与异常；招式伤害/倍率加成不参与。
   * 勾选后：即使是招式类增益，异常结算也会计入。
   */
  appliesToAnomaly?: boolean
  enabledDefault?: boolean
  /** @deprecated 已改用效果块备注，仅兼容旧数据 */
  note?: string
}

/** 效果块：一组可命名的效果条目（一块可含多条效果） */
export interface BuffEffectBlock {
  id: string
  name: string
  note?: string
  effects: BuffEffect[]
  enabledDefault?: boolean
}

export interface SkillSubcategory {
  id: string
  /** 所属角色；空表示通用 */
  agentId: string
  categoryId: SkillCategoryId
  name: string
}

export interface SkillCalcContext {
  damageKind: DamageCalcKind
  categoryId: SkillCategoryId
  subcategoryId: string | null
  element?: string
  staggerPhase?: StaggerPhase
}

export interface AgentMindscapeRankBuffs {
  effectBlocks: BuffEffectBlock[]
  /** 由 effectBlocks 扁平派生 */
  effects: BuffEffect[]
  /** 由 effects 派生，兼容旧展示/公式 */
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
  effects: BuffEffect[]
  refinementEffects: BuffEffect[][]
  /** 由 effects 派生 */
  fixedMods: BuffStatModifiers
  refinementMods: BuffStatModifiers[]
}

export interface DriveDiscBuffDoc {
  id: string
  name: string
  avatar_image: string | null
  twoPieceNote: string
  fourPieceNote: string
  twoPieceEffects: BuffEffect[]
  /** 由 twoPieceEffects 派生 */
  twoPieceMods: BuffStatModifiers
  fourPieceBuffs: AgentMindscapeRankBuffs
}

export interface CalculatorBuffData {
  agents: AgentBuffDoc[]
  wengines: WengineBuffDoc[]
  bangboos: BangbooBuffDoc[]
  driveDiscs: DriveDiscBuffDoc[]
  skillSubcategories?: SkillSubcategory[]
}
