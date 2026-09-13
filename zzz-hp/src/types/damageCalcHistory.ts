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

/** 局外面板的两种来源：面板导入 / 词条导入 */
export type AgentPanelSourceKind = 'imported' | 'affixDerived'

/** 来源的来历与时间：仅界面显示与排查用，**计算链路不得读取** */
export interface AgentPanelProvenance {
  /** 该角色「面板导入」那份的写入时间 */
  importedAt?: number
  /** 该角色「词条导入」那份的写入时间 */
  affixDerivedAt?: number
  source?: 'screenshot' | 'manual' | 'affix'
}

/**
 * 每个角色的两份局外面板 —— **平级**，字段名刻意不叫「主 / 备」。
 *
 * - 两份各带来历、互不覆盖：一次导入只写当前这一路，另一份原样保留；
 * - `active` 是每角色一份的显式状态，落进方案库与工作草稿；
 * - 词条数与 4/5/6 主属性挂在**各自的来源记录**里，只服务「词条导入」这一路；
 * - 下游只读 `active` 那份（`resolveActivePanel`），不接收也不查询来源。
 */
export interface AgentPanelSources {
  /** 「面板导入」那份：游戏里看到的数字（截图识别或手打） */
  importedPanel?: PanelStats
  /** 「词条导入」那份：按条数算出来的数字 */
  affixDerivedPanel?: PanelStats
  /** 生成 affixDerivedPanel 的输入，只服务「词条导入」这一路的再次编辑 */
  affixCounts?: AffixCounts
  affixDriveDiscMainStats?: AffixDriveDiscMainStats
  /** 当前生效的那份 */
  active: AgentPanelSourceKind
  /** 来历与时间，仅展示与排查用；计算链路不得读取 */
  provenance?: AgentPanelProvenance
}

export interface DamageCalcTeamSlotSnapshot {
  agentId: string
  rank: number
  wengineId: string
  wengineRefine: number
  twoPieceDriveDiscId: string
  fourPieceDriveDiscId: string
  /** @deprecated 已迁入 `slotPanels[agentId].affixDriveDiscMainStats`（v4 迁移时清除） */
  affixDriveDiscMainStats?: AffixDriveDiscMainStats
  /** @deprecated 已迁入 `slotPanels[agentId].affixCounts`（v4 迁移时清除） */
  affixCounts?: AffixCounts
}

export interface DamageCalcPanelSnapshot {
  baseDamageSource: 'atk' | 'pierce' | 'def'
  externalPanel: PanelStats
  /**
   * 每人一份五大类技能等级（面板导入配置；缺省全 12）。
   * 仅影响 nanoka 导入直伤招式的有效倍率。
   */
  skillTalentLevelsByAgent?: Record<
    string,
    import('@/utils/skillTalentLevels').SkillTalentLevels
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
 * 准备阶段技能组内某一段的双代理人（与普通准备招式同语义）。
 * memberKey = `${order}:${skillId}`，与流程细调对齐。
 */
export interface PreparedGroupMemberAgents {
  memberKey: string
  skillId: string
  anomalyPowerAgentId?: string | null
  triggerAgentId?: string | null
}

/**
 * 准备阶段的一条记录（用户仍称之为「招式」，此名仅存盘用）。
 * 普通招式绑 `skillId`；技能组绑 `skillGroupId`（二者互斥）。
 */
export interface PreparedSkill {
  /** 本方案内实例 id；流程引用它，而非直接引用招式库 */
  id: string
  /** 普通招式 id；与 skillGroupId 互斥 */
  skillId?: string | null
  /** 技能组 id；与 skillId 互斥 */
  skillGroupId?: string | null
  skillSource: SkillSource
  /** 异常强度提供者（agentId）。普通招式用；技能组优先看 memberAgents */
  anomalyPowerAgentId?: string | null
  /** 异常类触发者（agentId）。普通招式用；技能组优先看 memberAgents */
  triggerAgentId?: string | null
  /** 技能组：按段配置双代理人；缺省段在结算时回落 defaultAnomalyAgents */
  memberAgents?: PreparedGroupMemberAgents[] | null
  extraMods?: PreparedSkillExtraMods | null
}

/**
 * 流程组行上的成员覆盖（仅该方案实例；缺省 = 继承整组 FlowEntry + 组定义）。
 */
export interface FlowGroupMemberOverride {
  /** 稳定键：`${order}:${skillId}` */
  memberKey: string
  skillId: string
  /** 若填：替代成员定义 count，再 × FlowEntry.count */
  count?: number | null
  staggerPhase?: StaggerPhase | null
  critMode?: DamageEventCritMode | null
}

/** 流程里的一条编排（普通招式或整组各占一行） */
export interface FlowEntry {
  id: string
  /** 该流程所属角色；为将来三条流程合并显示预留 */
  ownerAgentId: string
  /** 指向准备阶段的某条 */
  preparedId: string
  /** 普通招式 = 次数；技能组 = 整组乘数（× 成员 count） */
  count: number
  /** 整组默认失衡；成员可 override */
  staggerPhase: StaggerPhase
  /** 整组默认暴击；成员可 override */
  critMode: DamageEventCritMode
  /** 仅准备为技能组时有意义 */
  memberOverrides?: FlowGroupMemberOverride[] | null
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
  /** @deprecated v4 起改用 `slotPanels`（迁移时读取，写完即清） */
  anomalySlotPanels?: Record<string, PanelStats>
  /** 每个角色的两份局外面板（面板导入 / 词条导入）与当前激活那份 */
  slotPanels?: Record<string, AgentPanelSources>
  convertSlotPanels?: DamageCalcConvertSlotPanels
  slots?: SchemeSlot[]
  staggerPhase?: StaggerPhase
  multiSlotBuffSelection?: MultiSlotBuffSelection
  /** 危局/防卫/临界场地 Buff 筛选（跟草稿走，避免返回页面后重置并反写怪物） */
  envBuffMode?: 'none' | 'crisis' | 'defense' | 'deduction'
  envBuffVersion?: string
  envBuffPhaseId?: string
  envBuffFrontierId?: string
  envBuffNodeId?: string
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
  /** @deprecated v4 起改用 `slotPanels`（迁移时读取，写完即清） */
  anomalySlotPanels?: Record<string, PanelStats>
  /** 每个角色的两份局外面板（面板导入 / 词条导入）与当前激活那份 */
  slotPanels?: Record<string, AgentPanelSources>
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
export const SCHEME_STORE_VERSION = 4

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
