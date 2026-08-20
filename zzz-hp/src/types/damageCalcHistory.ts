import type {
  BuffStatModifiers,
  DamageCalcKind,
  DamageEvent,
  DamageEventCritMode,
  SkillSource,
  StaggerPhase,
} from '@/types/calculator'
import type {
  AffixCounts,
  AffixDriveDiscMainStats,
  PanelCalcMode,
  PanelStats,
} from '@/types/calculatorPanel'
import type { CharacterAttrKey } from '@/types/calculator'
import type { DamageEnemyInput, EnemyResistanceType } from '@/utils/enemyResistance'
import type { MultiSlotBuffSelection } from '@/utils/panelBuffCalc'

/** 兼容旧存档的敌方环境快照 */
export type DamageCalcEnemyInputSnapshot = DamageEnemyInput & {
  resistanceType?: EnemyResistanceType
}

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
  /** 该槽位词条计算的 4/5/6 号盘主属性；跟 2/4 件套一起存，避免只活在编辑器里被换人冲掉 */
  affixDriveDiscMainStats?: AffixDriveDiscMainStats
  /** 该槽位副词条数 */
  affixCounts?: AffixCounts
  /** 该槽位导入方式：面板导入 / 词条计算。缺省按面板导入；旧方案若当时全页是词条计算，加载时会补成词条 */
  entryMode?: import('@/types/calculatorPanel').SlotPanelEntryMode
}

export interface DamageCalcPanelSnapshot {
  baseDamageSource: 'atk' | 'pierce' | 'def'
  externalPanel: PanelStats
  affixCounts: AffixCounts
  affixDriveDiscMainStats: AffixDriveDiscMainStats
  /** 每人一份词条数；缺省时只用上面那份当前角色词条 */
  affixStateByAgent?: Record<
    string,
    { affixCounts: AffixCounts; affixDriveDiscMainStats: AffixDriveDiscMainStats }
  >
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
    applySlot?: number | 'team'
    skillCategory?: import('@/types/calculator').BuffSkillTargetId
    skillSubcategoryId?: string | null
    appliesToAnomaly?: boolean
    applyProfession?: string | null
    teamProfession?: string | null
    teamProfessionValues?: Array<number | null> | null
    /** @deprecated */
    teamProfessionMinCount?: number | null
  }>
  enemyInput: DamageCalcEnemyInputSnapshot
}

/**
 * 命名方案 / 导出包允许持有的面板快照。
 * `baseDamageSource` 属于计算器内部公式开关，不跟方案走；旧包即便带了也会被忽略。
 */
export type DamageCalcSchemePanelSnapshot = Omit<DamageCalcPanelSnapshot, 'baseDamageSource'> & {
  /** @deprecated 兼容旧包读取；运行时忽略，不再导出 */
  baseDamageSource?: DamageCalcPanelSnapshot['baseDamageSource']
}

// ===================== 准备阶段 / 流程（新架构，跟方案走） =====================

/**
 * 准备阶段里对某条招式的**增量**修改。
 * 语义为加算并入对应乘区；与 Buff 同区相加。留空 = 用招式库原值。
 */
export interface PreparedSkillExtraMods {
  /** 覆盖基础倍率% */
  baseMult?: number | null
  /** 覆盖决算倍率% */
  settlementMult?: number | null
  /** 增伤加算% */
  dmgBonus?: number | null
  /** 暴击率加算% */
  critRate?: number | null
  /** 暴击伤害加算% */
  critDmg?: number | null
}

/**
 * 准备阶段的一条记录（用户仍称之为「招式」，此名仅存盘用）。
 * 只绑定招式库的 `skillId`，不复制招式定义。
 */
export interface PreparedSkill {
  /** 本方案内实例 id；流程引用它，而非直接引用招式库 */
  id: string
  skillId: string
  skillSource: SkillSource
  /** 异常强度提供者（agentId）。留空则不能计算 */
  anomalyPowerAgentId?: string | null
  /** 异常类触发者（agentId）。留空则不能计算 */
  triggerAgentId?: string | null
  extraMods?: PreparedSkillExtraMods | null
}

/** 流程里的一条编排 */
export interface FlowEntry {
  id: string
  /** 该流程所属角色；为将来三条流程合并显示预留 */
  ownerAgentId: string
  /** 指向准备阶段的某条 */
  preparedId: string
  count: number
  staggerPhase: StaggerPhase
  critMode: DamageEventCritMode
}

/**
 * 方案里的一个槽位，**按下标对齐 `teamSlots`**。
 * 不另存 agentId，避免换人后两处不同步。
 */
export interface SchemeSlot {
  prepared: PreparedSkill[]
  flow: FlowEntry[]
}

/** 计算页当前工作草稿（刷新后恢复；不是方案库里的命名方案） */
export interface DamageCalcWorkingDraft {
  savedAt: number
  loadedSchemeId: string
  teamSlots: DamageCalcTeamSlotSnapshot[]
  activeSlot: number
  selectedBangbooId: string
  bangbooRefine: number
  panelCalcMode: PanelCalcMode
  panelState: DamageCalcPanelSnapshot | null
  anomalySlotPanels?: Record<string, PanelStats>
  convertSlotPanels?: DamageCalcConvertSlotPanels
  slots?: SchemeSlot[]
  staggerPhase?: StaggerPhase
  multiSlotBuffSelection?: MultiSlotBuffSelection
  /** 危局/防卫场地 Buff 筛选（跟草稿走，避免返回页面后重置并反写怪物） */
  envBuffMode?: 'none' | 'crisis' | 'defense'
  envBuffVersion?: string
  envBuffPhaseId?: string
  envBuffFrontierId?: string
}

export interface DamageCalcHistoryEntry {
  /** 路径式 ID，等于 `${folder}/${name}`（根目录下为 `/name`） */
  id: string
  name: string
  savedAt: number
  teamSlots: DamageCalcTeamSlotSnapshot[]
  activeSlot: number
  selectedBangbooId: string
  bangbooRefine: number
  panelCalcMode: PanelCalcMode
  panelState: DamageCalcSchemePanelSnapshot
  /** 异常产生角色局外面板（按 agentId） */
  anomalySlotPanels?: Record<string, PanelStats>
  /** 转模增益角色局外面板（按 agentId） */
  convertSlotPanels?: DamageCalcConvertSlotPanels
  /** 准备阶段 + 流程，按下标对齐 teamSlots */
  slots?: SchemeSlot[]
  /** @deprecated 3.1.6.4 未上线遗留；v3 迁移时清除 */
  directEvents?: DamageEvent[]
  /** @deprecated 3.1.6.4 未上线遗留；v3 迁移时清除 */
  anomalyEvents?: DamageEvent[]
  /** 直伤事件展示名（跟方案；不绑定全局自动写回） */
  directEventModeName?: string | null
  /** 异常事件展示名（跟方案） */
  anomalyEventModeName?: string | null
  /** 伤害类型（direct / anomaly） */
  damageKind?: DamageCalcKind
  /** 失衡阶段（stagger / normal） */
  staggerPhase?: StaggerPhase
  /** Buff 勾选状态（按槽位 + 全队） */
  multiSlotBuffSelection?: MultiSlotBuffSelection
  /** 方案库目录分组（路径，根目录为空串） */
  folder: string
  /** 同目录内排序权重（小在前） */
  order: number
}

/** 目录节点元数据 */
export interface SchemeFolderMeta {
  createdAt: number
  order: number
}

/** 方案库存储结构（对齐 zzz-dev 路径树） */
export const SCHEME_STORE_VERSION = 3

export interface SchemeStore {
  version: number
  dirs: Record<string, SchemeFolderMeta>
  schemes: Record<string, DamageCalcHistoryEntry>
}

/** 导出包结构 */
export interface DamageCalcHistoryExport {
  type: 'zzz-hp-schemes'
  version: number
  exportedAt: number
  dirs: Record<string, SchemeFolderMeta>
  schemes: Record<string, DamageCalcHistoryEntry>
  currentId?: string | null
  /** 浏览器自建招式库全文。与方案里的 skillId 成套，导入时整包覆盖。 */
  customSkills?: import('@/types/calculator').Skill[]
}

/** 导入结果 */
export interface DamageCalcHistoryImportResult {
  added: number
  skipped: number
  errors: string[]
  customSkillCount: number
  /** 旧导出包没有自建招式字段，覆盖后流程可能变成「招式已删除」 */
  legacyPack: boolean
  loadedId: string
}
