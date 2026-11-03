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
import type { AgentElement } from '@/utils/calculatorUi'

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
  /**
   * @deprecated 旧格式的扁平额外 Buff 属性（扁平增益模型时代）。**当前没有任何读取点**：
   * 归一化只在 `PanelCalcSection.loadSnapshot` 对 `extraGains` 做，这里的数据会被**静默忽略**
   * （既不转成条目、也不计入"已跳过 N 条"提示）。用户 2026-10-26 明确：这类旧数据丢了可接受，
   * 不做兼容迁移。字段本身的删除按代办 T23 处理。
   */
  extraMods?: BuffStatModifiers
  /** 额外 Buff 卡片（类型定义唯一来源：`@/types/extraBuff`） */
  extraGains?: import('@/types/extraBuff').ExtraBuffGain[]
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
  /** 本方案内的显示名称覆盖；留空用招式/技能组原名（允许同名招式重复加入准备） */
  alias?: string | null
  /** 异常强度提供者（agentId）。普通招式用；技能组优先看 memberAgents */
  anomalyPowerAgentId?: string | null
  /** 异常类触发者（agentId）。普通招式用；技能组优先看 memberAgents */
  triggerAgentId?: string | null
  /** 技能组：按段配置双代理人；缺省段在结算时回落 defaultAnomalyAgents */
  memberAgents?: PreparedGroupMemberAgents[] | null
  extraMods?: PreparedSkillExtraMods | null
}

/** 一条流程行的 buff 例外（只存"与全局不同"的禁用项；缺省/空 = 全部继承全局） */
export interface FlowBuffOverride {
  /** 按效果块禁用 */
  disabledBlockIds?: string[] | null
  /** 按单条效果禁用（下钻） */
  disabledEffectIds?: string[] | null
  /**
   * 按效果覆盖叠层数（缺省/无该键 = 继承全局层数；2026-10-08 对齐局内增益）
   */
  stacksByEffectId?: Record<string, number> | null
  /**
   * 按效果覆盖转模手填输入（缺省/无该键 = 继承全局输入；仅 manual 转模有意义）
   */
  convertInputsByEffectId?: Record<string, number> | null
}

/**
 * 流程组行上的成员覆盖（仅该方案实例；缺省 = 继承整组 FlowEntry + 组定义）。
 */
export interface FlowGroupMemberOverride {
  elementOverride?: AgentElement | null
  /** 稳定键：`${order}:${skillId}` */
  memberKey: string
  skillId: string
  /** 若填：替代成员定义 count，再 × FlowEntry.count */
  count?: number | null
  staggerPhase?: StaggerPhase | null
  critMode?: DamageEventCritMode | null
  /** 该成员的 buff 例外（缺省 = 继承整行 FlowEntry.buffOverrides） */
  buffOverrides?: FlowBuffOverride | null
  /** 本行这一段的强度提供者 / 触发者（缺省 = 继承准备条目成员配置） */
  anomalyPowerAgentId?: string | null
  triggerAgentId?: string | null
}

/** 流程里的一条编排（普通招式或整组各占一行） */
export interface FlowEntry {
  elementOverride?: AgentElement | null
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
  /**
   * 本行的 buff 例外（仅该方案实例；缺省/空 = 全部继承全局勾选）。
   * 只允许"禁用"（减法语义）：与全局一致的一律不写，老数据读到即继承。
   * 技能组行：整组用本字段；逐成员用 memberOverrides[].buffOverrides。
   */
  buffOverrides?: FlowBuffOverride | null
  /**
   * **行级**异常强度提供者 / 触发者（缺省 = 继承准备条目上那一份）。
   *
   * 准备条目与流程行因此解耦：同一条准备招式被两行引用时，两行可以各配各的
   * （用户口径 2026-10-06）。技能组行逐成员仍走 `memberOverrides[]`。
   */
  anomalyPowerAgentId?: string | null
  triggerAgentId?: string | null
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
  /**
   * 面板快照 —— 「敌方与环境」与「额外 Buff」**只在这里**，没有顶层字段。
   * **可缺省**：取不到子组件快照时落盘不写这个键；写 `null` 会在恢复端被静默跳过，
   * 导致这两块被默认值覆盖（见 dev-docs/damage-calc-state-storage.md）。
   */
  panelState?: DamageCalcPanelSnapshot | null
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
  /**
   * 危局 / 防卫 / 临界的环境筛选（跟方案走；缺省 = 加载时不切换环境）。
   * 字段与 `DamageCalcWorkingDraft` 同名同义，恢复路径共用 `applyWorkingState`。
   */
  envBuffMode?: 'none' | 'crisis' | 'defense' | 'deduction'
  envBuffVersion?: string
  envBuffPhaseId?: string
  envBuffFrontierId?: string
  envBuffNodeId?: string
  /** 环境 Buff 勾选快照：期数或效果 id 失效时按名称 + 数值重建 */
  envBuffChecks?: import('@/utils/schemeEnvironmentBuff').SchemeEnvironmentBuffChecks
  /** 方案库目录分组（路径，根目录为空串） */
  folder: string
  /** 同目录内排序权重（小在前） */
  order: number
  /** 来源：缺省 = 用户自己保存；preset = 从共用方案复制来的只读副本 */
  origin?: 'preset' | 'user'
  /** 来源共用方案 id（仅展示 / 溯源；不参与计算） */
  sharedPresetId?: string
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
  /** 自建组全文 ∪ 方案引用到的组文档（含预设组抄本） */
  skillGroups?: import('@/types/calculator').SkillGroup[]
  /** 导出时方案引用了但本机找不到的招式/组 */
  warnings?: string[]
}

export type SchemePackImportMode = 'replace' | 'merge'

/** 导入结果 */
export interface DamageCalcHistoryImportResult {
  added: number
  skipped: number
  errors: string[]
  customSkillCount: number
  customGroupCount: number
  renamed: number
  remappedSkills: number
  remappedGroups: number
  missingSkillCount: number
  missingGroupCount: number
  mode: SchemePackImportMode
  /** 旧导出包没有自建招式字段，覆盖后流程可能变成「招式已删除」 */
  legacyPack: boolean
  loadedId: string
}
