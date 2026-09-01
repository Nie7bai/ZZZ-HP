export type AdminCalculatorPanel =
  | 'agent'
  | 'wengine'
  | 'bangboo'
  | 'drive-disc'
  | 'skill-subcategory'
  | 'skill-library'
  | 'import-export'

export type SupportStatNeed =
  | 'hp'
  | 'atk'
  | 'critRate'
  | 'critDmg'
  | 'dmgBonus'
  | 'penRate'
  | 'pen'
  | 'resPen'

export type BuffScope =
  | 'general'
  | 'skill'
  | 'anomaly'
  | 'disorder'
  | 'turbulence'
  | 'anomalyRelease'
  | 'radiance'
  | 'mutation'

export const BUFF_SCOPE_OPTIONS: { id: BuffScope; label: string }[] = [
  { id: 'general', label: '通用' },
  { id: 'skill', label: '招式' },
  { id: 'anomaly', label: '异常' },
  { id: 'disorder', label: '紊乱' },
  { id: 'turbulence', label: '乱流' },
  { id: 'anomalyRelease', label: '异放' },
  { id: 'radiance', label: '耀变' },
  { id: 'mutation', label: '异化系数' },
]
export type BuffApplyTarget = 'self' | 'team'
/** 增益作用情况：全局 / 仅失衡期 / 仅非失衡期 */
export type BuffApplySituation = 'global' | 'stagger' | 'non_stagger'
export type BuffEffectKind = 'fixed' | 'stacked' | 'convert'
export type DamageCalcKind = 'direct' | 'anomaly'
/** 异常伤害子类：异常 / 紊乱 / 乱流 / 异放 / 耀变 */
export type AnomalyDamageSubKind =
  | 'anomaly'
  | 'disorder'
  | 'turbulence'
  | 'anomalyRelease'
  | 'radiance'
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

/**
 * 招式类型（多选）。取代旧「招式大类」，并把旧的 3 条公共招式小类提升为类型。
 * 清单、蕴含关系与「类型 → 旧坐标」映射见 `utils/skillTypes.ts`。
 */
export type SkillTypeId =
  | 'basic'
  | 'dodge'
  | 'dash'
  | 'dodgeCounter'
  | 'assist'
  | 'special'
  | 'specialBasic'
  | 'specialEnhanced'
  | 'chain'
  | 'ultimate'
  | 'followUp'

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
  | 'critRate'
  | 'critDmg'
  | 'mastery'
  | 'anomalyControl'
  | 'energyRegen'
  | 'penRate'
  | 'impact'
  | 'def'
  | 'pierce'
  | 'level'

export const CHARACTER_ATTR_OPTIONS: { id: CharacterAttrKey; label: string }[] = [
  { id: 'hp', label: '生命' },
  { id: 'atk', label: '攻击' },
  { id: 'critRate', label: '暴击' },
  { id: 'critDmg', label: '爆伤' },
  { id: 'mastery', label: '异常精通' },
  { id: 'anomalyControl', label: '异常掌控' },
  { id: 'energyRegen', label: '能量恢复' },
  { id: 'penRate', label: '穿透率' },
  { id: 'impact', label: '冲击力' },
  { id: 'def', label: '防御力' },
  { id: 'pierce', label: '贯穿力' },
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
  { id: 'radiance', label: '耀变伤害' },
]

export type BaseDamageSource = 'atk' | 'pierce' | 'def'

export interface BuffStatModifiers {
  /** 固定生命 */
  hp: number
  inCombatHpPercent: number
  inCombatAtkPercent: number
  inCombatDefPercent: number
  externalHpPercent: number
  externalAtkPercent: number
  externalDefPercent: number
  atk: number
  /** 固定防御力 */
  def: number
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
  /**
   * 锐爆伤害加成%（仅锐化）：锐爆伤害 B = 1.2 + 本值/100，
   * 替换常规暴伤区。
   */
  sharpenCritDmgBonus: number
  /**
   * 弱伤%：直伤 / 命破 / 锐化增伤区 = 1 + (增伤% − 弱伤%)/100；
   * 仅 Buff，不进异常链。
   */
  dmgPenalty: number
  /** 易伤%（全伤害类型，与直伤/非直伤易伤加算进同一易伤区） */
  vulnerable: number
  /** 直伤易伤%（仅直伤） */
  directVulnerable: number
  /** 非直伤易伤%（异常/紊乱/乱流/异放/耀变） */
  anomalyVulnerable: number
  /** 减伤%（全伤害类型，从易伤区加算扣减） */
  dmgReduction: number
  /** 直伤减伤%（仅直伤） */
  directDmgReduction: number
  /** 非直伤减伤%（异常类） */
  anomalyDmgReduction: number
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
  /** 决算倍率%（直伤大类下的独立伤害分量，公式同直伤倍率区） */
  settlementDmgMult: number
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
  /** 耀变倍率加算% */
  radianceMult: number
  /** 耀变增伤% */
  radianceDmgBonus: number
  /** 耀变抗性穿透%（并入产生角色抗性区，仅耀变） */
  radianceResPen: number
  /** 特殊倍率加算% */
  specialMult: number
  /** 异化系数加算% */
  mutationCoeff: number
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
  /** 耀变倍率乘算修正（默认 1） */
  radianceMultFactor: number
  /** 特殊倍率乘算修正（默认 1） */
  specialMultFactor: number
  /** 异化系数乘算修正（默认 1） */
  mutationCoeffFactor: number
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
  /** 转模初始值：仅超出该值的部分参与折算，默认 0（旧数据缺省同 0） */
  initialBase?: number | null
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
  /** 受益职业限制；空/缺省 = 不限 */
  applyProfession?: string | null
  /**
   * 队内职业人数条件：空/缺省 = 不限。
   * 仅决定该人数下效果是否生效，不改变固定/叠层/转模的数值算法。
   */
  teamProfession?: string | null
  /**
   * 启用的人数档：下标 0=恰好1人、1=恰好2人、2=恰好3人；非 null 表示该档启用。
   * 结算与自动勾选均按「恰好 N 人」；未勾任何档则不生效。
   */
  teamProfessionValues?: Array<number | null> | null
  /**
   * @deprecated 旧「≥N 门槛」；仅兼容读取，新数据请用 teamProfessionValues 勾选人数
   */
  teamProfessionMinCount?: number | null
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
  /** 决算倍率%（默认 0；直伤大类下的独立伤害分量） */
  settlementDmgMult: number
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
  | 'sharpen'
  | 'anomaly'
  | 'disorder'
  | 'anomalyRelease'
  | 'turbulence'
  | 'radiance'

export interface DamageEvent {
  id: string
  kind: DamageEventKind
  categoryId: SkillCategoryId
  skillSubcategoryId: string | null
  count: number
  staggerPhase: StaggerPhase
  critMode: DamageEventCritMode
  /**
   * 伤害事件归属角色（产生该伤害的是谁）。
   * 缺省 / null 视为主 C；管理端「计算时选择」可用 __at_calc__。
   */
  ownerAgentId?: string | null
  /**
   * 当前属性异常的产生角色 agentId。
   * 特殊值 `__at_calc__` 表示管理端配置为「计算时选择」。
   */
  triggerAgentId?: string | null
  /** 是否绑定招式（异常事件可关闭；直伤默认 true） */
  skillBound?: boolean
  /** 倍率覆写：不为 null 时覆盖招式小类/面板默认值 */
  multOverrides?: DamageEventMultOverrides | null
}

/** 事件级倍率 / 倍率修正覆写（null / undefined = 使用默认） */
export interface DamageEventMultOverrides {
  directDmgMult?: number | null
  settlementDmgMult?: number | null
  directDmgMultFactor?: number | null
  anomalyMult?: number | null
  anomalyMultFactor?: number | null
  anomalyReleaseMult?: number | null
  anomalyReleaseMultFactor?: number | null
  disorderBaseMult?: number | null
  disorderBaseMultFactor?: number | null
  disorderCompMult?: number | null
  /** 招式填写紊乱最终倍率区%（含持续时间×补偿；与 disorderBaseMult 互斥） */
  disorderZoneMult?: number | null
  turbulenceBaseMult?: number | null
  turbulenceBaseMultFactor?: number | null
  turbulenceCompMult?: number | null
  /** 招式填写乱流最终倍率区%（含持续时间×补偿；与 turbulenceBaseMult 互斥） */
  turbulenceZoneMult?: number | null
  radianceMult?: number | null
  radianceMultFactor?: number | null
  specialMult?: number | null
  specialMultFactor?: number | null
}

// ===================== 招式库（新架构） =====================

/** 招式的伤害类型，决定走哪套公式。一条招式有且仅有一个 */
export type SkillDamageType = DamageEventKind

export type SkillSource = 'preset' | 'custom'

/**
 * 招式：伤害定义。存在全局招式库里（预设在后端，自定义在浏览器）。
 *
 * 与准备阶段/流程的关系：准备阶段按 `id` 绑定本条，不复制定义；
 * 管理员改预设且用户未覆写时，方案自动跟着新预设。
 */
export interface Skill {
  id: string
  name: string
  /** 空 = 公共招式（全部角色可见）；有值 = 该角色专属 */
  agentId: string
  /**
   * 公共招式绑定的元素。空 = 不按元素过滤；有值时只对同属性角色展示。
   * 公共属性异常用这个字段按当前角色 `element` 拆条。
   */
  element?: string
  source: SkillSource
  damageType: SkillDamageType
  /** 招式类型，多选。异常类留空 → 仅靠类型的招式限定 Buff 不命中 */
  skillTypes: SkillTypeId[]
  /**
   * 增益锚点：旧「招式小类」id，至多一个，可不选。
   * 让「专门加强某一招」的 Buff 认出这条招式；异常类也可选，用于吃招式限定增益。
   */
  buffAnchorId?: string | null
  /** 基础倍率%（0 = 未设置，回落面板值，与旧招式小类语义一致） */
  baseMult: number
  /** 基础倍率乘算修正%（默认 100 = ×1） */
  baseMultFactor?: number
  /** 决算倍率%，仅直伤可选 */
  settlementMult?: number
}

/** 管理端：计算时再选产生角色 */
export const TRIGGER_AGENT_AT_CALC = '__at_calc__' as const

export type DamageEventModeType = 'direct' | 'anomaly'

/** 按角色配置的伤害事件模式（管理端预设 / 计算端可选） */
export interface DamageEventMode {
  id: string
  agentId: string
  /** 队伍参与角色签名（主 C + 事件产生者/异常触发者），用于自定义模式缓存 */
  teamKey?: string
  name: string
  modeType: DamageEventModeType
  events: DamageEvent[]
}

/**
 * 招式在 Buff 限定体系里的一个坐标。
 * 新架构一条招式可有多个招式类型 + 一个增益锚点，故需要多坐标。
 */
export interface SkillMatchCoord {
  category: SkillCategoryId
  subcategoryId: string | null
}

export interface SkillCalcContext {
  damageKind: DamageCalcKind
  categoryId: SkillCategoryId
  subcategoryId: string | null
  /**
   * 多坐标匹配，Buff 命中任意一个坐标即生效。
   * - 不提供：回落 categoryId + subcategoryId 单坐标（旧行为）
   * - 提供空数组：该招式无任何招式类型（异常类），招式限定 Buff 一律不命中
   */
  coords?: SkillMatchCoord[]
  element?: string
  staggerPhase?: StaggerPhase
  /** 当前招式是否视为追加攻击 */
  isFollowUp?: boolean
  /** 异常伤害子类（异常/紊乱/乱流/异放）；直伤时可省略 */
  anomalySubKind?: AnomalyDamageSubKind
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
  /** 耀变倍率% */
  radianceMult: number
  /** 耀变增伤% */
  radianceDmgBonus: number
  /** 耀变抗性穿透% */
  radianceResPen: number
  /** 特殊倍率% */
  specialMult: number
  /** 异化系数% */
  mutationCoeff: number
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
  externalDefPercent: number
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
  damageEventModes?: DamageEventMode[]
  skills?: Skill[]
  exportedAt?: string
}

export interface CalculatorBuffImportTypeSummary {
  created: number
  updated: number
  skipped: number
  errors: { id: string; message: string }[]
}

export interface CalculatorBuffImportSummary {
  agents: CalculatorBuffImportTypeSummary
  wengines: CalculatorBuffImportTypeSummary
  bangboos: CalculatorBuffImportTypeSummary
  driveDiscs: CalculatorBuffImportTypeSummary
  skillSubcategories: CalculatorBuffImportTypeSummary
  followUpSkillRules: CalculatorBuffImportTypeSummary
  damageEventModes: CalculatorBuffImportTypeSummary
  skills: CalculatorBuffImportTypeSummary
}
