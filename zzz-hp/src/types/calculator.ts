import type { AffixPresetEntryDoc, AffixPresetGroupDoc } from '@/api/affixPreset'

/**
 * 词条库快照里的一套方案。
 *
 * 形状对齐 `zzz-hp-backend/scripts/export-affix-preset.mjs` 的输出、以及主数据
 * `zzz-hp-calculator-buffs.json` 的 `affixPresets.schemes` —— 同一份文件既能被
 * 管理页导入，也能直接喂给 `scripts/import-affix-preset.mjs`。
 */
export interface CalculatorBuffAffixPresetScheme {
  name: string
  isDefault?: boolean
  sortOrder?: number
  entries: AffixPresetEntryDoc[]
  groups: AffixPresetGroupDoc[]
}

/**
 * 词条库快照（导入 / 导出面板的第 10 类）。
 *
 * 与其余 9 类的区别：那些是「扁平数组 + 按 id 增量 upsert」，这份是
 * 「方案 → 分组 + 条目」的层级结构，**导入时整份替换同名方案**。
 */
export interface CalculatorBuffAffixPresets {
  kind?: string
  exportedAt?: string
  defaultScheme?: string
  schemes: CalculatorBuffAffixPresetScheme[]
}

export type AdminCalculatorPanel =
  | 'agent'
  | 'wengine'
  | 'bangboo'
  | 'drive-disc'
  | 'skill-subcategory'
  | 'skill-library'
  | 'affix-preset'
  | 'shared-schemes'
  | 'zones'
  | 'import-export'
  | 'nanoka'
  | 'nanoka-buffs'

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
  | 'attributeAnomaly'
  | 'disorder'
  | 'turbulence'
  | 'anomalyRelease'
  | 'radiance'
  | 'mutation'

export const BUFF_SCOPE_OPTIONS: { id: BuffScope; label: string }[] = [
  { id: 'general', label: '通用' },
  { id: 'skill', label: '招式' },
  { id: 'attributeAnomaly', label: '属性异常' },
  { id: 'disorder', label: '紊乱' },
  { id: 'turbulence', label: '乱流' },
  { id: 'anomalyRelease', label: '异放' },
  { id: 'radiance', label: '耀变' },
  { id: 'mutation', label: '异化系数' },
]

/**
 * 第二级伤害类型（2026-10-20 条件体系）。
 *
 * 两级只影响展示：直伤类 3 项 / 异常类 5 项；数据层只存第二级 id。
 * 空数组 = 全部。
 *
 * 2026-10-30 口径统一：属性异常子类 id 由 `anomaly` 改为 `attributeAnomaly`；
 * 「异常类」分组 id 改为 `anomalyClass`。类级语义（`DamageCalcKind`、
 * 事件模式 `modeType`）仍是 `anomaly`，不随之改名。
 */
export type BuffDamageType =
  | 'normal'
  | 'pierce'
  | 'sharpen'
  | 'attributeAnomaly'
  | 'turbulence'
  | 'disorder'
  | 'radiance'
  | 'anomalyRelease'

export interface BuffDamageTypeOption {
  id: BuffDamageType
  label: string
}

export interface BuffDamageTypeGroup {
  id: 'direct' | 'anomalyClass'
  label: string
  types: BuffDamageTypeOption[]
}

/** 界面顺序：直伤 3 + 异常 5（异常内按 属性异常 / 乱流 / 紊乱 / 耀变 / 异放） */
export const BUFF_DAMAGE_TYPE_GROUPS: BuffDamageTypeGroup[] = [
  {
    id: 'direct',
    label: '直伤类',
    types: [
      { id: 'normal', label: '普通直伤' },
      { id: 'pierce', label: '命破' },
      { id: 'sharpen', label: '锋御' },
    ],
  },
  {
    id: 'anomalyClass',
    label: '异常类',
    types: [
      { id: 'attributeAnomaly', label: '属性异常' },
      { id: 'turbulence', label: '乱流' },
      { id: 'disorder', label: '紊乱' },
      { id: 'radiance', label: '耀变' },
      { id: 'anomalyRelease', label: '异放' },
    ],
  },
]

export const BUFF_DAMAGE_TYPE_OPTIONS: BuffDamageTypeOption[] =
  BUFF_DAMAGE_TYPE_GROUPS.flatMap((group) => group.types)

/** BuffEffect 条件集合：本次先收编旧 scope 的伤害类型维度。 */
export interface BuffEffectConditions {
  /** 伤害类型条件；缺省 / 空 = 全部 */
  damageTypes?: BuffDamageType[]
}

export type BuffApplyTarget = 'self' | 'team'
/** 增益作用情况：全局 / 仅失衡期 / 仅非失衡期 */
export type BuffApplySituation = 'global' | 'stagger' | 'non_stagger'
export type BuffEffectKind = 'fixed' | 'stacked' | 'convert'
export type DamageCalcKind = 'direct' | 'anomaly'
/** 异常伤害子类：属性异常 / 紊乱 / 乱流 / 异放 / 耀变 */
export type AnomalyDamageSubKind =
  | 'attributeAnomaly'
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

/** 转模来源：五大类技能等级（普通攻击/闪避/支援/特殊/连携终结） */
export type SkillConvertFromKey =
  | 'skillLevelBasic'
  | 'skillLevelDodge'
  | 'skillLevelAssist'
  | 'skillLevelSpecial'
  | 'skillLevelChainUltimate'

/** 转模来源（面板属性 | 技能等级） */
export type ConvertFromKey = CharacterAttrKey | SkillConvertFromKey

export const SKILL_LEVEL_CONVERT_OPTIONS: { id: SkillConvertFromKey; label: string }[] = [
  { id: 'skillLevelBasic', label: '普通攻击等级' },
  { id: 'skillLevelDodge', label: '闪避等级' },
  { id: 'skillLevelAssist', label: '支援攻击等级' },
  { id: 'skillLevelSpecial', label: '特殊技等级' },
  { id: 'skillLevelChainUltimate', label: '连携/终结等级' },
]

/** 转模来源下拉全集（面板属性 + 技能等级） */
export const CONVERT_FROM_OPTIONS: { id: ConvertFromKey; label: string }[] = [
  ...CHARACTER_ATTR_OPTIONS,
  ...SKILL_LEVEL_CONVERT_OPTIONS,
]

export const CONVERT_PANEL_SOURCE_OPTIONS: { id: ConvertPanelSource; label: string }[] = [
  { id: 'external', label: '根据局外面板' },
  { id: 'final', label: '根据局内面板' },
  { id: 'manual', label: '自行设置' },
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
  /** 锐化伤害提升%（独立乘区，仅锐化路径；锋御专属，对标命破贯穿增伤） */
  sharpenDmgBonus: number
  /**
   * 锐爆伤害加成%（仅锐化）：锐爆伤害 B = 本值/100（无内置基础值），
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
  /** 属性异常暴击% */
  attributeAnomalyCritRate: number
  /** 属性异常爆伤% */
  attributeAnomalyCritDmg: number
  /** 属性异常增伤% */
  attributeAnomalyDmgBonus: number
  /** 异放增伤% */
  anomalyReleaseDmgBonus: number
  /** 异放暴击% */
  anomalyReleaseCritRate: number
  /** 异放爆伤% */
  anomalyReleaseCritDmg: number
  /** 异放倍率加算% */
  anomalyReleaseMult: number
  /**
   * 子类专用暴击（用户 2026-10-16：暴击按子类拆开，各子类只吃自己的字段；
   * 属性异常用 `attributeAnomalyCrit*`、异放用 `anomalyReleaseCrit*`）。
   */
  turbulenceCritRate: number
  turbulenceCritDmg: number
  radianceCritRate: number
  radianceCritDmg: number
  disorderCritRate: number
  disorderCritDmg: number
  directDmgMult: number
  /** 决算倍率%（直伤大类下的独立伤害分量，公式同直伤倍率区） */
  settlementDmgMult: number
  attributeAnomalyMult: number
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
  /** 属性异常倍率乘算修正（默认 1） */
  attributeAnomalyMultFactor: number
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
  /**
   * 自定义乘区增益（Phase 3b）：键由乘区定义登记，例如 `eliteDmgBonus`。
   * 与强类型字段分离，避免污染 `BuffStatKey`；聚合后随 `combatMods` 传入计算。
   */
  custom?: Record<string, number>
}

/** 内置（强类型）增益键；`custom` 走乘区定义，不属于此联合 */
export type BuffStatKey = Exclude<keyof BuffStatModifiers, 'custom'>

export interface BuffEffectConvert {
  from: ConvertFromKey
  /** external/final 读面板；manual 自行设置基础值（不看面板） */
  panelSource?: ConvertPanelSource
  ratioPercent: number
  /** 转换结果的绝对值上限；负向转换保留负号，null/缺省表示不限幅 */
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
  /**
   * @deprecated 2026-10-20 起 BuffEffect 不再写 `scope`；
   * 读时迁移为 `conditions.damageTypes`（词条库 / 额外增益的 scope 是另一套，仍保留）。
   * 仅兼容旧数据 / 旧导入器，管理端不再展示、不再写。
   */
  scope?: BuffScope[]
  /**
   * 条件集合（本次先收编旧 scope 的伤害类型维度）。
   * - 空/缺省 = 全部伤害类型
   * - 有值 = 只在这些第二级类型上生效
   */
  conditions?: BuffEffectConditions
  /**
   * 同源行分组键：管理侧把「同块同族同值的 N 条子类行」聚合成 1 行用。
   * **引擎完全忽略**；空 = 独立行 / 老数据。
   */
  groupId?: string
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
  /** 属性限定（属性增伤/属性异常增伤/抗性穿透等）；可多选 */
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
   * 用户侧「额外增益」的效果（2026-09-24 阶段 3 起并入统一收集）。
   * 它没有勾选状态 —— **加入即已勾选**：`isEffectEnabled` 见到这个标志直接返回 true。
   */
  extraGain?: boolean
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
  | 'attributeAnomaly'
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
  /** 属性异常倍率%（原「异常倍率」） */
  attributeAnomalyMult?: number | null
  /** 属性异常倍率修正% */
  attributeAnomalyMultFactor?: number | null
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
  /**
   * 非空 = 技能组私有招式：不进招式库顶层列表，只在所属组编辑里出现。
   */
  ownerGroupId?: string | null
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
  /**
   * 倍率来源。仅 nanoka 导入写 `'nanoka'`；管理端手建不设。
   * 为 nanoka 时结算可按面板五大类技能等级重算 baseMult。
   */
  multSource?: 'nanoka' | null
  /** nanoka L1 伤害倍率万分比整数（如 3120 → L1=31.20%） */
  damagePercentage?: number
  /** nanoka 每级增长（万分比整数） */
  damagePercentageGrowth?: number
  /**
   * 耀变等特殊伤害跟随的五大类技能等级键（蕾米耀变用：倍率随普通攻击/支援攻击/终结等级变化）。
   * 不给 skillTypes 填对应类型：那会经 buildSkillMatchCoords 生成「普通攻击」等 buff 匹配坐标，
   * 让耀变错误吃到招式限定增益。缺省时仍按 skillTypes 推断。
   */
  radianceTalentKey?:
    | 'basic'
    | 'dodge'
    | 'assist'
    | 'special'
    | 'chainUltimate'
    | null
  /** 备注：计算页招式库/准备行展示 */
  note?: string
}

/** 技能组成员（引用招式库 skillId） */
export interface SkillGroupMember {
  skillId: string
  order: number
  /** 组定义默认段次数；流程展开时再 × FlowEntry.count */
  count: number
  /** 保留字段：现已一律计入流程（兼容旧数据） */
  includeInFlow: boolean
}

/**
 * 技能组：招式库内的编排包。准备/流程里仍是一条，结算时按 members 内部展开。
 */
export interface SkillGroup {
  id: string
  agentId: string
  name: string
  note?: string
  /** 预设（管理端）或自建（浏览器）；缺省按 preset */
  source?: SkillSource
  members: SkillGroupMember[]
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
  /**
   * 直伤第二级：普通直伤 / 命破 / 锋御。
   * 由招式持有者职业 + 招式 damageType 推导；缺省按 normal 兼容旧调用方。
   */
  directSubKind?: 'normal' | 'pierce' | 'sharpen'
  /**
   * 通用面板上下文（只汇总无伤害类型 / 无招式的通用 Buff）。
   * 带 conditions.damageTypes 的效果在这种上下文下一律不生效。
   */
  generic?: boolean
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
  /** 初始锐爆伤害加成%（锋御）；锐爆 B = 本值/100，与初始爆伤独立 */
  sharpenCritDmgBonus: number
  mastery: number
  /** 异常掌控（不进伤害乘区） */
  anomalyControl: number
  /** 能量回复效率（不进伤害乘区） */
  energyRegen: number
  penRate: number
  dmgBonus: number
  pen: number
  attributeAnomalyCritRate: number
  attributeAnomalyCritDmg: number
  attributeAnomalyDmgBonus: number
  /** 直伤倍率%，默认 100（即 ×1） */
  directDmgMult: number
  /** 属性异常倍率%，按属性默认（如冰 500） */
  attributeAnomalyMult: number
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
  /**
   * 库里该行的 `updated_at`（ISO/UTC 秒级，读取接口下发）。
   * 保存时作为乐观锁基准发给后端（字段名 `baseUpdatedAt`）：库里的行已经变了 → 409，拒绝整份覆盖。
   */
  updatedAt?: string
}

export interface WengineBuffDoc {
  id: string
  name: string
  profession: string
  rarity: 'S' | 'A' | 'B'
  avatar_image: string | null
  note: string
  baseAtk: number
  /** 基础防御力。锋御音擎的基础属性为防御力（非攻击力），参与局内防御力基数 */
  baseDef?: number
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
  skillGroups?: SkillGroup[]
  /** 官方预设词条库（第 10 类；导入时整份替换同名方案，不是按 id 增量） */
  affixPresets?: CalculatorBuffAffixPresets
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
  skillGroups: CalculatorBuffImportTypeSummary
  /**
   * 词条库这一行的 created / updated 计数单位是**方案**，不是条目
   * （整份替换语义下没有「这条条目是新增还是更新」的区分），界面上要标注。
   */
  affixPresets: CalculatorBuffImportTypeSummary
}