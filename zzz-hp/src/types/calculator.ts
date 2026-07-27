export type AdminCalculatorPanel =
  | 'agent'
  | 'wengine'
  | 'bangboo'
  | 'drive-disc'
  | 'skill-subcategory'
  | 'damage-event'

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
/** 异常伤害子类：异常 / 紊乱 / 乱流 / 异放 */
export type AnomalyDamageSubKind = 'anomaly' | 'disorder' | 'turbulence' | 'anomalyRelease'
export type StaggerPhase = 'normal' | 'stagger'
/** 转模读取局外/局内面板，或自行设置基础值 */
export type ConvertPanelSource = 'external' | 'final' | 'manual'

export type SkillCategoryId =
  | 'basic'
  | 'dodge'
  | 'assist'
  | 'special'
  | 'chain'
  | 'ultimate'

/** 增益招式目标：真实大类，或伪大类「追加攻击」 */
export type BuffSkillTargetId = SkillCategoryId | 'follow_up'

export const SKILL_CATEGORY_OPTIONS: { id: SkillCategoryId; label: string }[] = [
  { id: 'basic', label: '普通攻击' },
  { id: 'dodge', label: '闪避' },
  { id: 'assist', label: '支援技' },
  { id: 'special', label: '特殊技' },
  { id: 'chain', label: '连携技' },
  { id: 'ultimate', label: '终结技' },
]

/** 增益编辑器用（含追加攻击伪大类） */
export const BUFF_SKILL_TARGET_OPTIONS: { id: BuffSkillTargetId; label: string }[] = [
  ...SKILL_CATEGORY_OPTIONS,
  { id: 'follow_up', label: '追加攻击' },
]

/** 转模来源属性（配合 panelSource；自行设置时仅作展示标签） */
export type CharacterAttrKey =
  | 'hp'
  | 'atk'
  | 'mastery'
  | 'anomalyControl'
  | 'energyRegen'
  | 'penRate'
  | 'impact'
  | 'def'
  | 'level'

export const CHARACTER_ATTR_OPTIONS: { id: CharacterAttrKey; label: string }[] = [
  { id: 'hp', label: '生命' },
  { id: 'atk', label: '攻击' },
  { id: 'mastery', label: '异常精通' },
  { id: 'anomalyControl', label: '异常掌控' },
  { id: 'energyRegen', label: '能量恢复' },
  { id: 'penRate', label: '穿透率' },
  { id: 'impact', label: '冲击力' },
  { id: 'def', label: '防御力' },
  { id: 'level', label: '等级' },
]

export const CONVERT_PANEL_SOURCE_OPTIONS: { id: ConvertPanelSource; label: string }[] = [
  { id: 'external', label: '根据局外面板' },
  { id: 'final', label: '根据局内面板' },
  { id: 'manual', label: '自行设置' },
]

export const ANOMALY_DAMAGE_SUBKIND_OPTIONS: {
  id: AnomalyDamageSubKind
  label: string
}[] = [
  { id: 'anomaly', label: '异常伤害' },
  { id: 'disorder', label: '紊乱伤害' },
  { id: 'turbulence', label: '乱流伤害' },
  { id: 'anomalyRelease', label: '异放伤害' },
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
  /** 异常掌控（不进伤害乘区） */
  anomalyControl: number
  /** 异常掌控%：按角色初始异常掌控换算（不进伤害乘区） */
  anomalyControlPercent: number
  /** 能量回复效率%：按角色初始能量回复效率换算（不进伤害乘区） */
  energyRegen: number
  /** 能量回复效率（数值）：直接累加（不进伤害乘区） */
  energyRegenFlat: number
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
  /** 直伤倍率乘算修正（默认 1，多来源连乘） */
  directDmgMultFactor: number
  /** 异常倍率乘算修正（默认 1） */
  anomalyMultFactor: number
  /** 异放倍率乘算修正（默认 1） */
  anomalyReleaseMultFactor: number
  /** 紊乱基础倍率乘算修正（默认 1；作用于紊乱倍率区） */
  disorderBaseMultFactor: number
  /** 乱流基础倍率乘算修正（默认 1；作用于乱流倍率区） */
  turbulenceBaseMultFactor: number
}

export type BuffStatKey = keyof BuffStatModifiers

export interface BuffEffectConvert {
  from: CharacterAttrKey
  /** external/final 读面板；manual 自行设置基础值（不看面板） */
  panelSource?: ConvertPanelSource
  ratioPercent: number
  cap?: number | null
  /** 自行设置时的默认基础值；局外/局内模式下仅作兼容旧数据预填 */
  defaultBase?: number | null
}

/** 招式作用目标（可多选） */
export interface BuffSkillTarget {
  category: BuffSkillTargetId
  /** 空 = 整大类（或全部追加） */
  subcategoryId?: string | null
}

export interface BuffEffect {
  id: string
  /** @deprecated 已改用效果块名称展示，仅兼容旧数据 */
  origin?: string
  scope: BuffScope
  applyTarget: BuffApplyTarget
  /** 作用情况：全局 / 失衡期 / 非失衡期，默认全局 */
  applySituation?: BuffApplySituation
  /**
   * 招式作用目标列表（可多选，按顺序展示）。
   * 匹配时任一目标命中即生效。
   */
  skillTargets?: BuffSkillTarget[]
  /**
   * @deprecated 兼容旧数据；优先用 skillTargets。
   * 招式：小类空 = 整大类生效；follow_up = 追加攻击伪大类
   */
  skillCategory?: BuffSkillTargetId
  /** @deprecated 兼容旧数据；优先用 skillTargets */
  skillSubcategoryId?: string | null
  /** 属性限定（属性增伤/异常增伤/抗性穿透等）；可多选 */
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
  /** 所属角色；空表示通用（全部角色） */
  agentId: string
  categoryId: SkillCategoryId
  name: string
  /** 该小类视为追加攻击 */
  countsAsFollowUp?: boolean
  /** 直伤倍率%（默认 100 = ×1） */
  directDmgMult: number
  /** 异放倍率%（0 = 未设置，回落面板） */
  anomalyReleaseMult: number
  /** 紊乱倍率%（0 = 未设置，回落面板；有贡献时称极性紊乱） */
  disorderMult: number
  /** 直伤倍率乘算修正（默认 1） */
  directDmgMultFactor: number
  /** 异放倍率乘算修正（默认 1） */
  anomalyReleaseMultFactor: number
  /** 紊乱倍率乘算修正（默认 1） */
  disorderMultFactor: number
}

/** 整大类（或指定小类）视为追加攻击的规则 */
export interface FollowUpSkillRule {
  id: string
  /** 空 = 全部角色 */
  agentId: string
  categoryId: SkillCategoryId
  /** null = 整大类 */
  subcategoryId: string | null
}

/** 伤害事件暴击模式 */
export type DamageEventCritMode = 'expected' | 'noCrit' | 'fullCrit'

/** 单条伤害事件种类 */
export type DamageEventKind =
  | 'direct'
  | 'anomaly'
  | 'disorder'
  | 'anomalyRelease'
  | 'turbulence'

export interface DamageEvent {
  id: string
  kind: DamageEventKind
  categoryId: SkillCategoryId
  skillSubcategoryId: string | null
  count: number
  staggerPhase: StaggerPhase
  critMode: DamageEventCritMode
  /** 异常事件需要触发角色时的 agentId（仅 disorder/turbulence/anomalyRelease） */
  triggerAgentId?: string | null
  /** 倍率覆写：不为 null 时覆盖招式小类/面板默认值 */
  multOverrides?: DamageEventMultOverrides | null
}

/** 事件级倍率覆写（null / undefined = 使用默认） */
export interface DamageEventMultOverrides {
  directDmgMult?: number | null
  anomalyMult?: number | null
  anomalyReleaseMult?: number | null
  disorderBaseMult?: number | null
  disorderCompMult?: number | null
  turbulenceBaseMult?: number | null
  turbulenceCompMult?: number | null
}

export type DamageEventModeType = 'direct' | 'anomaly'

/** 按角色配置的伤害事件模式（管理端预设 / 计算端可选） */
export interface DamageEventMode {
  id: string
  agentId: string
  name: string
  modeType: DamageEventModeType
  events: DamageEvent[]
}

export interface SkillCalcContext {
  damageKind: DamageCalcKind
  categoryId: SkillCategoryId
  subcategoryId: string | null
  element?: string
  staggerPhase?: StaggerPhase
  /** 当前招式是否视为追加攻击 */
  isFollowUp?: boolean
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
  /** 异常掌控（不进伤害乘区） */
  anomalyControl: number
  /** 能量回复效率（不进伤害乘区） */
  energyRegen: number
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
  /** 按角色初始异常掌控乘算 */
  anomalyControlPercent: number
  /** 按角色初始能量回复效率乘算 */
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
  /** 效果块（优先；展示名与备注以此为准） */
  effectBlocks?: BuffEffectBlock[]
  effects: BuffEffect[]
  /** 精炼效果块（精1～精5） */
  refinementEffectBlocks?: BuffEffectBlock[][]
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
  /** 2 件套效果块（优先；展示名与备注以此为准） */
  twoPieceEffectBlocks?: BuffEffectBlock[]
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
  followUpSkillRules?: FollowUpSkillRule[]
}
