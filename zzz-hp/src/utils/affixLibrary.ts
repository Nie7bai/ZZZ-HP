import { ref } from 'vue'
import type { AffixCounts, PanelStats } from '@/types/calculatorPanel'
import type {
  BuffApplySituation,
  BuffScope,
  BuffSkillTargetId,
  BuffStatKey,
} from '@/types/calculator'
import {
  BUFF_SCOPE_OPTIONS,
  BUFF_SKILL_TARGET_OPTIONS,
} from '@/types/calculator'
import { AFFIX_VALUE_PER_COUNT } from '@/utils/affixPanelCalc'
import { BUFF_STAT_FIELDS, buffStatFieldLabel } from '@/utils/calculatorUi'
import type { ExtraBuffGain } from '@/utils/extraBuffCalc'
import type { AffixEffectTemplate } from '@/utils/affixEffectTemplate'

/**
 * 词条库（Affix Library）
 *
 * 把「参与收益分析与最优分配的词条」从写死的候选表改成一张可增删改的候选池。
 *
 * ## 条目目标（`target`）：两个落点，**语义相同**
 *
 * 一个条目只回答一件事：**给哪个属性加多少**。至于这个量是「按基础值乘算」还是
 * 「平铺加到面板值上」，**由目标字段的语义决定，条目自己不判断**
 * （用户 2026-09-12 裁定：「不应该有属性词条直接绕过链路的……就算有判断，
 * 也不是这个功能里判断的，你凭什么在词条功能说这个词条一定不转模，绕过去」）。
 *
 * - `panel:<字段>`：分析侧落到局外增量表（T12），按字段语义叠在导入激活面板上；
 *   **不再写入导入十格 `AffixCounts`**。原 `stat:` 已并入此前缀。
 * - `gain:<增益字段>`：不进局外，合成 extraGains。
 *
 * 两条都落在**同一份局外面板**上，转模链路读的就是这份面板 —— 所以谁也不能
 * 「不参与转模」，是否参与由**效果数据**决定，不由条目声明。
 * 折算规则也完全共用：`anomalyControl` / `energyRegen` 按基础值乘算（与主属性、Buff 同口径），
 * 其余字段平铺。因此界面上**不再有**「词条数 / 面板增量（直接叠加局外面板）」这种类型区分。
 *
 * 历史沿革：早期按 `kind: 'substat' | 'panelField'` 分成两种条目类型，两条路对
 * 「每档值从哪来」给了不同答案 —— 副词条读写死的常量表、面板字段读条目字段。
 * 结果是「界面把每档改成 4%，伤害却按常量 2.4% 算」。现在合并为单一 `target`，
 * **每档值一律以条目自己的 `perRoll` 为准**。
 *
 * 更早的错（2026-09-12 修）：`panel:` 曾**直接写进面板字段**，于是同一件事
 * （6 号位「异常掌控 30%」）从主属性下拉选和从词条库选得到**两个数**（122.2 / 124）。
 * 现在两条路共用同一套折算 —— 见 `applyPanelDeltas`。
 *
 * ## 预算模型（独立功能，不复用「词条计算」页的双预算规则）
 *
 * - `rollCost`：占用「总词条数」预算，每条词条 1 档 = 1 个词条。
 * - `cap`：单条最大档数，0 表示不限。
 * - `group` + 组额度：**进组的条目共享一个额度**，组内各条档数之和 ≤ 组额度
 *   （额度由库级 `groups` 表按组名维护，见下）。空组名 = 自由条目。
 *
 * ## 分组额度（`groups`，2026-09-12 用户口径）
 *
 * 组不是一个布尔标记，而是一个**共享额度**：
 *
 * ```
 * 单词条 A（组 E，自己 cap 3）
 * 单词条 B（组 E，自己 cap 4）
 * 组 E 额度 5        →  A 档数 + B 档数 ≤ 5，各自也不超自己的 cap
 * ```
 *
 * 求解器因此只做一次取最小：`min(自己 cap − 自己已用, 组额度 − 组内已用, 总预算剩余)`。
 * 组额度缺省（未登记的组名）= 1 档 —— 对 cap 各 1 的条目等价于「二选一」的直觉。
 *
 * ## id 命名
 *
 * 默认条目的 id 沿用历史前缀（`substat:atkPercent` / `panel:reduceDefense`），**故意不改**：
 * 用户已存的 `enabledOverride` 与 `overrides` 都是按 id 索引的，改 id 会让这些记录全部失配。
 * 因此 id 前缀与 `target` 前缀不要求一致（`substat:x` 对应 `target: 'panel:x'`）。
 */

/** 条目落点：`panel:` = 局外增量；`gain:` = 增益字段 */
export type AffixExternalField = AffixPanelDeltaField | keyof AffixCounts
export type AffixPanelTarget = `panel:${AffixExternalField}`
export type AffixGainTarget = `gain:${AffixGainField}`
export type AffixLibraryEntryTarget = AffixPanelTarget | AffixGainTarget

/** 可叠加到局外面板的百分比/加值字段 */
export type AffixPanelDeltaField =
  | 'dmgBonus'
  | 'penRate'
  | 'reduceDefense'
  | 'ignoreDefense'
  | 'resPen'
  | 'mastery'
  | 'anomalyControl'
  | 'energyRegen'
  | 'impact'
  | 'anomalyDmgBonus'
  | 'anomalyCritRate'
  | 'anomalyCritDmg'
  | 'anomalyReleaseDmgBonus'
  | 'anomalyReleaseCritRate'
  | 'anomalyReleaseCritDmg'
  | 'disorderDmgBonus'
  | 'turbulenceDmgBonus'
  | 'radianceDmgBonus'
  | 'radianceResPen'
  | 'specialMult'

/** 条目档数换算出来的局外面板增量（与 `AffixPanelDeltaMap` 同构） */
export type AffixPanelDeltaDraft = Partial<Record<AffixPanelDeltaField, number>>

/**
 * 增益字段 = 增益体系（`BuffStatModifiers`）的键。
 *
 * 词条目标为 `gain:<字段>` 时，这条贡献**不在局外面板上**，而是合成一条给主 C 的增益，
 * 在**转模之后**随面板计算施加（与「额外增益」同一条路）。
 * 详见 `affix-optimizer-impl-log.md` 步骤 58 与 `affix-calc-manual.md` §5.1。
 */
export type AffixGainField = BuffStatKey

/** 增益字段的显示名（与增益编辑器同一套文案，见 `BUFF_STAT_FIELDS`） */
export const AFFIX_GAIN_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  BUFF_STAT_FIELDS.map((field) => [field.key, buffStatFieldLabel(field)]),
)

/** 增益字段的候选清单（按增益编辑器的词表，顺序一致） */
export const AFFIX_GAIN_FIELDS: readonly AffixGainField[] = BUFF_STAT_FIELDS.map(
  (field) => field.key,
)

const AFFIX_GAIN_FIELD_SET: ReadonlySet<string> = new Set<string>(AFFIX_GAIN_FIELDS)

/** `gain:` 目标里按「百分比」理解的字段（其余为固定值）——单位取自增益词表 */
const PERCENT_GAIN_FIELDS: ReadonlySet<string> = new Set<string>(
  BUFF_STAT_FIELDS.filter((field) => field.unit !== 'flat').map((field) => field.key),
)

export const AFFIX_PANEL_DELTA_FIELD_LABELS: Record<AffixPanelDeltaField, string> = {
  dmgBonus: '增伤%',
  penRate: '穿透率%',
  reduceDefense: '减防%',
  ignoreDefense: '无视防御%',
  resPen: '抗性穿透%',
  mastery: '异常精通',
  anomalyControl: '异常掌控',
  energyRegen: '能量恢复效率',
  impact: '冲击力',
  anomalyDmgBonus: '异常增伤%',
  anomalyCritRate: '异常暴击率%',
  anomalyCritDmg: '异常暴击伤害%',
  anomalyReleaseDmgBonus: '异放增伤%',
  anomalyReleaseCritRate: '异放暴击率%',
  anomalyReleaseCritDmg: '异放暴击伤害%',
  disorderDmgBonus: '紊乱增伤%',
  turbulenceDmgBonus: '乱流增伤%',
  radianceDmgBonus: '耀变增伤%',
  radianceResPen: '耀变抗性穿透%',
  specialMult: '特殊倍率%',
}

/**
 * 词条目标选单不列出这些局外字段：游戏里几乎只作为局内出现。
 * 计算仍认 `panel:`；已有条目和自定义手写不受影响。
 */
export const AFFIX_PANEL_FIELDS_HIDDEN_FROM_PICKER = [
  'resPen',
  'anomalyDmgBonus',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyReleaseDmgBonus',
  'anomalyReleaseCritRate',
  'anomalyReleaseCritDmg',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
  'radianceDmgBonus',
  'radianceResPen',
  'specialMult',
  'reduceDefense',
  'ignoreDefense',
] as const satisfies readonly AffixPanelDeltaField[]

export function isAffixPanelTargetHiddenFromPicker(target: string): boolean {
  if (!target.startsWith('panel:')) return false
  return (AFFIX_PANEL_FIELDS_HIDDEN_FROM_PICKER as readonly string[]).includes(
    target.slice('panel:'.length),
  )
}

/**
 * 防御区字段（**单一事实来源**）：穿透率 / 固定穿透 / 减防 / 无视防御。
 *
 * 用途：专路按它挑种子、把这一族从「剩余分配」里排除；将来扩减防链路也按它。
 * **按 target 的字段判，不按条目 id** —— 加回减防 / 无视防御、或自建同字段条目都自动生效。
 *
 * 注意：**不含防御力数值类**（`defFlat` / `defPercent` 等），那是另一回事。
 */
export const AFFIX_DEFENSE_ZONE_FIELDS = [
  'penRate',
  'pen',
  'reduceDefense',
  'ignoreDefense',
] as const

/** 条目落点是否属于防御区一族（`panel:` 与 `gain:` 两侧同判） */
export function isDefenseZoneAffixTarget(target: string): boolean {
  const index = target.indexOf(':')
  const field = index === -1 ? target : target.slice(index + 1)
  return (AFFIX_DEFENSE_ZONE_FIELDS as readonly string[]).includes(field)
}

/** 只要穿透率（专路种子） */
export function isPenRateAffixTarget(target: string): boolean {
  const index = target.indexOf(':')
  const field = index === -1 ? target : target.slice(index + 1)
  return field === 'penRate'
}

/** 只要固定穿透（专路要猛堆的那个字段） */
export function isFlatPenAffixTarget(target: string): boolean {
  const index = target.indexOf(':')
  const field = index === -1 ? target : target.slice(index + 1)
  return field === 'pen'
}

export const AFFIX_SUBSTAT_KEY_LABELS: Record<keyof AffixCounts, string> = {
  hpFlat: '固定生命值',
  hpPercent: '局外生命值%',
  atkFlat: '固定攻击力',
  atkPercent: '局外攻击力%',
  defFlat: '固定防御力',
  defPercent: '局外防御力%',
  pen: '固定穿透',
  critRate: '暴击率%',
  critDmg: '暴击伤害%',
  mastery: '异常精通',
}

const AFFIX_STAT_KEYS = Object.keys(AFFIX_SUBSTAT_KEY_LABELS) as (keyof AffixCounts)[]
const AFFIX_PANEL_DELTA_FIELDS = Object.keys(
  AFFIX_PANEL_DELTA_FIELD_LABELS,
) as AffixPanelDeltaField[]

/** `panel:` 里原十格字段按「百分比」理解的（其余为固定值） */
const PERCENT_STAT_KEYS: ReadonlySet<keyof AffixCounts> = new Set<keyof AffixCounts>([
  'hpPercent',
  'atkPercent',
  'defPercent',
  'critRate',
  'critDmg',
])

/** `panel:` 目标里按「百分比」理解的字段（`mastery` 是固定值） */
const PERCENT_PANEL_FIELDS: ReadonlySet<AffixPanelDeltaField> = new Set<AffixPanelDeltaField>(
  AFFIX_PANEL_DELTA_FIELDS.filter((field) => field !== 'mastery'),
)

export function panelTarget(field: AffixExternalField): AffixPanelTarget {
  return `panel:${field}`
}

export function gainTarget(field: AffixGainField): AffixGainTarget {
  return `gain:${field}`
}

export function isPanelTarget(target: string): target is AffixPanelTarget {
  return target.startsWith('panel:')
}

export function isGainTarget(target: string): target is AffixGainTarget {
  return target.startsWith('gain:')
}

/** `panel:` 里按十格字段叠的那一批（不含精通，精通走面板字段） */
export function statKeyOfTarget(target: AffixLibraryEntryTarget): keyof AffixCounts | null {
  if (!isPanelTarget(target)) return null
  const key = target.slice('panel:'.length) as keyof AffixCounts
  if (key === 'mastery') return null
  return AFFIX_STAT_KEYS.includes(key) ? key : null
}

/** `panel:` → 局外面板字段；不是该命名空间或字段非法时返回 null */
export function panelFieldOfTarget(
  target: AffixLibraryEntryTarget,
): AffixPanelDeltaField | null {
  if (!isPanelTarget(target)) return null
  const field = target.slice('panel:'.length) as AffixPanelDeltaField
  return AFFIX_PANEL_DELTA_FIELDS.includes(field) ? field : null
}

/** `gain:` → 增益字段；不是该命名空间或字段非法时返回 null */
export function gainFieldOfTarget(target: AffixLibraryEntryTarget): AffixGainField | null {
  if (!isGainTarget(target)) return null
  const field = target.slice('gain:'.length)
  return AFFIX_GAIN_FIELD_SET.has(field) ? (field as AffixGainField) : null
}

/**
 * 目标字段（展示 / 适配器用）：局外面板字段、十格形态、或增益字段。
 * 评估增量表 `AffixDeltaMap` 只装局外，不含增益。
 */
export type AffixDeltaField = AffixExternalField | AffixGainField

/** 分析侧局外增量：字段 → 累计值。`gain:` 走 extraGains，不进这张表。 */
export type AffixDeltaMap = Partial<Record<AffixExternalField, number>>

/** 这个键属于「局外面板增量」一族的判定（增益字段必须排除，它们不在 `PanelStats` 上） */
export function isPanelDeltaField(key: string): key is AffixPanelDeltaField {
  return (AFFIX_PANEL_DELTA_FIELDS as readonly string[]).includes(key)
}

/**
 * 目标 → 该写的字段名（局外增量或增益字段）。
 *
 * 收益表逐档重算、求解器把档数折成评估输入都用它 —— 新增目标族时只改这一处，
 * 免得「加了新族但只有一半路径认它」。
 */
export function deltaFieldOfTarget(target: AffixLibraryEntryTarget): AffixDeltaField | null {
  return panelFieldOfTarget(target) ?? statKeyOfTarget(target) ?? gainFieldOfTarget(target)
}

/** 词条库 `gain:` 合成 extraGain 时的 id 前缀（求解复算 / 缓存指纹都认这个） */
export const AFFIX_GAIN_SOURCE_ID_PREFIX = 'affix-gain:'

const AFFIX_APPLY_SITUATIONS: ReadonlySet<string> = new Set(['global', 'stagger', 'non_stagger'])
const AFFIX_BUFF_SCOPES: ReadonlySet<string> = new Set([
  'general',
  'skill',
  'anomaly',
  'disorder',
  'turbulence',
  'anomalyRelease',
  'radiance',
  'mutation',
])

/**
 * 把一条 `gain:` 条目折成给主 C 的 extraGain。
 *
 * `applySlot` 在评估入口按 `mainSlotIndex` 覆盖；这里只填默认 0。
 * `panel:` 返回 null。
 */
export function extraGainFromLibraryEntry(
  entry: AffixLibraryEntry,
  rolls: number,
): ExtraBuffGain | null {
  if (!isGainTarget(entry.target) || rolls <= 0) return null
  const field = gainFieldOfTarget(entry.target)
  if (!field) return null
  const scoped = Boolean(entry.skillCategory) || entry.scope === 'skill'
  return {
    id: `${AFFIX_GAIN_SOURCE_ID_PREFIX}${entry.id}`,
    name: entry.label,
    stat: field,
    value: rolls * entry.perRoll,
    applySituation: entry.applySituation ?? 'global',
    scope: entry.scope ?? (scoped ? 'skill' : 'general'),
    applyTarget: 'self',
    applySlot: 0,
    skillCategory: entry.skillCategory,
    skillSubcategoryId: entry.skillSubcategoryId ?? null,
    appliesToAnomaly: entry.appliesToAnomaly,
  }
}

const SITUATION_SUMMARY: Record<string, string> = {
  stagger: '失衡期',
  non_stagger: '非失衡期',
}

/** 词条库列表用：有条件才返回文案，通用 `gain:` 返回空串。 */
export function affixEntryConditionSummary(entry: AffixLibraryEntry): string {
  if (!isGainTarget(entry.target)) return ''
  const parts: string[] = []
  const situation = entry.applySituation
  if (situation && situation !== 'global') {
    parts.push(SITUATION_SUMMARY[situation] ?? situation)
  }
  if (entry.scope === 'skill' && entry.skillCategory) {
    const skill = BUFF_SKILL_TARGET_OPTIONS.find((item) => item.id === entry.skillCategory)
    parts.push(skill?.label ?? entry.skillCategory)
  } else if (entry.scope && entry.scope !== 'general') {
    const scope = BUFF_SCOPE_OPTIONS.find((item) => item.id === entry.scope)
    parts.push(scope?.label ?? entry.scope)
  }
  if (entry.appliesToAnomaly) parts.push('异常也生效')
  return parts.join(' · ')
}

/** 校验一个字符串是不是合法的条目目标 */
export function isAffixLibraryEntryTarget(value: unknown): value is AffixLibraryEntryTarget {
  if (typeof value !== 'string') return false
  if (isPanelTarget(value)) {
    const field = value.slice('panel:'.length)
    return (
      AFFIX_PANEL_DELTA_FIELDS.includes(field as AffixPanelDeltaField) ||
      AFFIX_STAT_KEYS.includes(field as keyof AffixCounts)
    )
  }
  if (isGainTarget(value)) return AFFIX_GAIN_FIELD_SET.has(value.slice(5))
  return false
}

/**
 * 目标（`target`）的显示名。
 *
 * `label` 是**自由文本**（用户可随便写，也可能写错），`target` 才是「实际加了什么属性」。
 * 列表要能看出真实效果就得显示它 —— 与新增表单下拉里的项**同源同字**，
 * 否则「列表显示的名字」和「下拉里的名字」会各说各话。
 *
 * 认不出的目标原样回显（不返回空串）：让异常数据露出来，别静默变空白。
 */
export function affixTargetLabel(target: AffixLibraryEntryTarget): string {
  const statKey = statKeyOfTarget(target)
  if (statKey) return AFFIX_SUBSTAT_KEY_LABELS[statKey]
  const field = panelFieldOfTarget(target)
  if (field) return AFFIX_PANEL_DELTA_FIELD_LABELS[field]
  const gainField = gainFieldOfTarget(target)
  if (gainField) return AFFIX_GAIN_FIELD_LABELS[gainField] ?? gainField
  return String(target)
}

export interface AffixLibraryEntry {
  /** 稳定 id（默认条目沿用历史前缀，见文件头说明） */
  id: string
  /** 显示名 */
  label: string
  /** 落点：`panel:` 局外增量 / `gain:` 增益 */
  target: AffixLibraryEntryTarget
  /** 每档增量（与目标字段同单位：百分比字段为百分点，固定值字段为绝对值） */
  perRoll: number
  /** 配平最大档数；0 表示不设上限 */
  cap: number
  /** 所属分组名（引用库级 `groups` 表）；'' 表示自由条目。见文件头「分组额度」 */
  group: string
  /** 每档占用「总词条数」预算（独立功能口径：每条词条 1 档 = 1 个词条） */
  rollCost: number
  /** 是否默认参与分析 */
  enabledByDefault: boolean
  /**
   * 可选招式/失衡条件（只对 `gain:` 生效；缺省 = 全局通用）。
   * 旧存档没有这些键，`migrateCustomEntry` 读成 undefined，不升存储版本。
   */
  applySituation?: BuffApplySituation
  scope?: BuffScope
  skillCategory?: BuffSkillTargetId
  skillSubcategoryId?: string | null
  appliesToAnomaly?: boolean
  /**
   * 版本化效果模板（官方预设 `effect_json`）。缺省时由 `target` + 条件字段现编。
   * 旧存档没有这个键，不升 localStorage 版本。
   */
  effectTemplate?: AffixEffectTemplate
}

/** 每档值的单位：百分比字段显示 `3%`，固定值字段显示 `9` */
export type AffixPerRollUnit = 'percent' | 'flat'

export function affixPerRollUnit(target: AffixLibraryEntryTarget): AffixPerRollUnit {
  const statKey = statKeyOfTarget(target)
  if (statKey) return PERCENT_STAT_KEYS.has(statKey) ? 'percent' : 'flat'
  const field = panelFieldOfTarget(target)
  if (field) return PERCENT_PANEL_FIELDS.has(field) ? 'percent' : 'flat'
  const gainField = gainFieldOfTarget(target)
  if (gainField) return PERCENT_GAIN_FIELDS.has(gainField) ? 'percent' : 'flat'
  return 'flat'
}

/** 去掉小数末尾多余的 0：2.4 → `2.4`，4.80 → `4.8`，9 → `9` */
function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return String(Math.round(value * 1000) / 1000)
}

/** 每档值的展示文案（带单位） */
export function formatAffixPerRoll(target: AffixLibraryEntryTarget, perRoll: number): string {
  return affixPerRollUnit(target) === 'percent' ? `${trimNumber(perRoll)}%` : trimNumber(perRoll)
}

function substatEntry(affixKey: keyof AffixCounts): AffixLibraryEntry {
  return {
    id: `substat:${affixKey}`,
    target: panelTarget(affixKey),
    label: AFFIX_SUBSTAT_KEY_LABELS[affixKey],
    perRoll: AFFIX_VALUE_PER_COUNT[affixKey],
    cap: 0,
    group: AFFIX_PRESET_DEFAULT_GROUP,
    // 独立功能口径：不分大小词条，每档一律占 1 个总词条数
    rollCost: 1,
    enabledByDefault: true,
  }
}

/** 默认词条库：10 条驱动盘副词条 */
export function createDefaultAffixLibrary(): AffixLibraryEntry[] {
  return AFFIX_STAT_KEYS.map(substatEntry)
}

/**
 * 可选扩展条目：代表 Buff 来源 / 不分槽位的伤害字段，默认不启用。
 *
 * 与副词条的区别只剩「落点」与默认值：
 * - `cap: 1` —— 来源最多取一次（副词条可叠，见 createDefaultAffixLibrary）；
 * - `group` 默认「副词条」—— 不分槽位的自由条目归在这里（额度不限）。
 *
 * 增伤 / 穿透率**不在这里**：它们是 5 号位主属性。
 * 异常/异放/紊乱/乱流/耀变/抗穿/特殊倍率/减防/无视防御等局外字段也不在这里：
 * 选单已隐藏（几乎只当局内；减防走 `gain:reduceDefense`）。
 */
export function createOptionalAffixLibraryEntries(): AffixLibraryEntry[] {
  return []
}

/**
 * 4/5/6 号位主属性候选条目（**默认启用**），按用户给的选项表逐一对应。
 *
 * 数值来源 = `affixDriveDiscConfig.ts` 的 `DRIVE_DISC_SLOT_{4,5,6}_OPTIONS`
 * （同一份口径，改那边要同步这里）。
 *
 * 为什么同一字段会有多条：4/5/6 各有一条「局外攻击力 30%」，分属不同组、各自额度 1，
 * 求解器按组各选至多一条。折算时各按自己的每档算（见 `entryRollsToEvalInput`），
 * 与副词条的「局外攻击力% 3%/档」互不干扰 —— 这正是本次修的那个 bug。
 *
 * **默认启用**（用户 2026-09-12 口径：把用户当前的库固化为官方预设库，见
 * `dev-docs/affix-optimizer-impl-log.md` 步骤 28）：主属性由求解器按组各选一条，
 * 与页面上的 4/5/6 主属性下拉是两处独立入口 —— 同一条两处都选会各算一次，属既有行为。
 * 老存档里显式关过的仍保持关闭（`enabledByDefault` 只在没有 `enabledOverride` 记录时生效）。
 *
 * **6 号位「冲击力 18%」的口径**（用户 2026-09-12 定：没填的一律按 0）：
 * 与同组的「异常掌控 30%」「能量恢复 60%」一样**按点数加**（这两条也是这么记的）。
 * 注意它不是「基础冲击力 ×18%」—— 角色基础冲击力没有入库，无法那样算；
 * 精确到百分比需要那份数据，届时本条与 `collectAffixDriveDiscMainStatContribution` 一起改。
 */
export function createDriveDiscMainStatAffixEntries(): AffixLibraryEntry[] {
  const specs: { slot: 4 | 5 | 6; key: string; field?: AffixPanelDeltaField; statKey?: keyof AffixCounts; label: string; perRoll: number }[] = [
    // ---- 4 号位 ----
    { slot: 4, key: 'critDmg', statKey: 'critDmg', label: '爆伤 48%', perRoll: 48 },
    { slot: 4, key: 'critRate', statKey: 'critRate', label: '暴击 24%', perRoll: 24 },
    { slot: 4, key: 'externalAtkPercent', statKey: 'atkPercent', label: '局外攻击力 30%', perRoll: 30 },
    { slot: 4, key: 'externalHpPercent', statKey: 'hpPercent', label: '局外生命值 30%', perRoll: 30 },
    { slot: 4, key: 'mastery', statKey: 'mastery', label: '精通 92', perRoll: 92 },
    { slot: 4, key: 'externalDefPercent', statKey: 'defPercent', label: '局外防御力 48%', perRoll: 48 },
    // ---- 5 号位（增伤 / 穿透率两条来自用户实际用法，2026-09-12 固化为预设）----
    { slot: 5, key: 'externalAtkPercent', statKey: 'atkPercent', label: '局外攻击力 30%', perRoll: 30 },
    { slot: 5, key: 'externalHpPercent', statKey: 'hpPercent', label: '局外生命值 30%', perRoll: 30 },
    { slot: 5, key: 'externalDefPercent', statKey: 'defPercent', label: '局外防御力 48%', perRoll: 48 },
    { slot: 5, key: 'dmgBonus', field: 'dmgBonus', label: '增伤30%', perRoll: 30 },
    { slot: 5, key: 'penRate', field: 'penRate', label: '穿透率24%', perRoll: 24 },
    // ---- 6 号位 ----
    { slot: 6, key: 'externalAtkPercent', statKey: 'atkPercent', label: '局外攻击力 30%', perRoll: 30 },
    { slot: 6, key: 'externalHpPercent', statKey: 'hpPercent', label: '局外生命值 30%', perRoll: 30 },
    { slot: 6, key: 'externalDefPercent', statKey: 'defPercent', label: '局外防御力 48%', perRoll: 48 },
    { slot: 6, key: 'anomalyControl', field: 'anomalyControl', label: '异常掌控 30%', perRoll: 30 },
    { slot: 6, key: 'impact', field: 'impact', label: '冲击力 18%', perRoll: 18 },
    { slot: 6, key: 'energyRegen', field: 'energyRegen', label: '能量恢复 60%', perRoll: 60 },
  ]
  return specs.map((spec) => ({
    id: `main:slot${spec.slot}:${spec.key}`,
    target: panelTarget(spec.statKey ?? spec.field!),
    label: spec.label,
    perRoll: spec.perRoll,
    cap: 1,
    group: `${spec.slot}号位`,
    rollCost: 1,
    enabledByDefault: true,
  }))
}

/**
 * 驱动盘「2 件套」候选条目（**默认不启用**）。
 *
 * ## 名称＝效果，不写套装名（用户 2026-09-12 裁定）
 *
 * 同一效果对应多套驱动盘：增伤 10% 有 **10 套**、精通 30 有 3 套、另有 3 组各 2 套。
 * 计算上它们**完全等价**（套装名只是标签，四件套不参与词条计算），
 * 全建出来只会让收益表出现整片逐位相同的重复行（实测：34 行里 26 行重复）。
 * 故按**效果去重**，名称沿用 4/5/6 号位那套格式（`爆伤 48%` / `局外攻击力 30%` 那种）。
 *
 * ## 数值来源与口径
 *
 * 来源 = `zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json`（30 个驱动盘的
 * 2 件套效果）。落点一律 `panel:`（百分比类与增伤同类局外；折算口径由字段决定）。
 *
 * ## 为什么只有 11 条（跳过了 5 套）
 *
 * - 原始朋克 / 山大王 / 灵魂摇滚：数据源里 2 件套效果**为空**（结构化与说明都空）；
 * - 如影相随 / 拂晓生花：效果是「[追加攻击][冲刺攻击] / [普通攻击] 伤害 +15%」——
 *   **限定招式**，词条模型没有这个概念，按通用增伤填会**算高**；
 * - 震星迪斯科：结构化数值为空，但说明写着「冲击力 6%」，按说明填（用户 2026-09-12 定）。
 *
 * ## 为什么默认不启用
 *
 * 用户导入的面板里**本就含当前佩戴的 2 件套**，条目再叠一次就是**双算**
 * （`mainBaseExternalPanel` 存在时，条目贡献叠加在面板之上）。要参与请自行勾选。
 */
export function createDriveDiscTwoPieceAffixEntries(): AffixLibraryEntry[] {
  const specs: {
    key: string
    field?: AffixPanelDeltaField
    statKey?: keyof AffixCounts
    label: string
    perRoll: number
  }[] = [
    { key: 'dmgBonus', field: 'dmgBonus', label: '增伤 10%', perRoll: 10 },
    { key: 'mastery', statKey: 'mastery', label: '精通 30', perRoll: 30 },
    { key: 'energyRegen', field: 'energyRegen', label: '能量恢复 20%', perRoll: 20 },
    { key: 'externalAtkPercent', statKey: 'atkPercent', label: '局外攻击力 10%', perRoll: 10 },
    { key: 'externalHpPercent', statKey: 'hpPercent', label: '局外生命值 10%', perRoll: 10 },
    { key: 'externalDefPercent', statKey: 'defPercent', label: '局外防御力 16%', perRoll: 16 },
    { key: 'critRate', statKey: 'critRate', label: '暴击 8%', perRoll: 8 },
    { key: 'critDmg', statKey: 'critDmg', label: '爆伤 16%', perRoll: 16 },
    { key: 'penRate', field: 'penRate', label: '穿透率 8%', perRoll: 8 },
    { key: 'anomalyControlPercent', field: 'anomalyControl', label: '异常掌控 8%', perRoll: 8 },
    // 震星迪斯科：数据里只有说明「冲击力 6%」，无数值；按同口径（冲击力按点数）填
    { key: 'impact', field: 'impact', label: '冲击力 6%', perRoll: 6 },
  ]
  return specs.map((spec) => ({
    // id 含数值：将来某套的 2 件套数值若不同，新增 id 即可（id 一旦发布不可改名）
    id: `set:${spec.key}:${spec.perRoll}`,
    target: panelTarget(spec.statKey ?? spec.field!),
    label: spec.label,
    perRoll: spec.perRoll,
    cap: 1,
    group: '2件套',
    rollCost: 1,
    enabledByDefault: false,
  }))
}

/** 预设条目全量（不含用户自建）：副词条 + 扩展条目 + 4/5/6 号位主属性 + 2 件套 */
export function createPresetAffixLibraryEntries(): AffixLibraryEntry[] {
  return [
    ...createDefaultAffixLibrary(),
    ...createOptionalAffixLibraryEntries(),
    ...createDriveDiscMainStatAffixEntries(),
    ...createDriveDiscTwoPieceAffixEntries(),
  ]
}

/** 词条分组：组名 + 组额度（组内各条档数之和的上限，见文件头「分组额度」） */
export interface AffixLibraryGroup {
  name: string
  /** 组额度；`AFFIX_GROUP_UNLIMITED`（0）表示不构成约束 */
  cap: number
  /**
   * 该组**基础占用**不计入总词条数（2026-09-18 用户口径的「组规则」）。
   *
   * 语义：组内条目的「每档 1 个词条」不算进总词条数 —— 买了不占数，没买也不亏。
   * **冲突额外仍照扣**（付费条目的 x）：x 是"与副词条重复"的代价，不是基础占用。
   * 游戏专用方案给 2 件套 / 4 / 5 / 6 号位都打开它（见 `createGameAffixGroups`）。
   *
   * 实现：调用方把这些组的组名传进 `AffixOptimizerInput.freeRollGroups`，求解器按**预算口径**处理
   * （基础档成本 0、冲突额外记 `rollCost − 1`）—— 层推进不变，搜索结构不变。
   * 要求这些组**有界**（组额度或组内条目 cap 有限）：无界会让层推进没有上界，求解器会忽略该组的豁免。
   */
  excludedFromTotalRolls?: boolean
}

/**
 * 组额度 `0` = **不限**（组不构成约束，纯粹是一个归类页）。
 *
 * 与单词条的 `cap: 0 = 不设上限` 同一个语义。需要它是因为页面按组划分：
 * 「副词条」这种页只是把可叠加的条目归在一起，不能因此让它们共享额度。
 */
export const AFFIX_GROUP_UNLIMITED = 0

/** 新建分组时的默认额度（用户主动建组，通常就是要「二选一」） */
export const DEFAULT_AFFIX_GROUP_CAP = 1

/**
 * 预设分组：与词条库弹窗的页签一一对应（4/5/6 号位、2 件套、副词条）。
 *
 * 4/5/6 号位在主属性上各自只能选一个 → 额度 1；
 * 副词条可叠加、彼此不互斥 → 额度不限（只是归类）。
 */
export const AFFIX_PRESET_GROUPS: AffixLibraryGroup[] = [
  { name: '4号位', cap: 1 },
  { name: '5号位', cap: 1 },
  { name: '6号位', cap: 1 },
  { name: '2件套', cap: 1 },
  { name: '副词条', cap: AFFIX_GROUP_UNLIMITED },
]

/** 预设条目默认落在哪一组 */
export const AFFIX_PRESET_DEFAULT_GROUP = '副词条'

// ===================== 官方预设来源（服务端 / 代码兜底） =====================

/**
 * 服务端来的官方预设快照。
 *
 * 口径（用户 2026-09-12 拍板）：**官方预设的唯一来源是数据库**，管理员维护、用户只读；
 * 用户自己的词条库仍在 localStorage，不进方案、管理员侧看不到。
 * 见 `dev-docs/affix-optimizer-impl-log.md` 步骤 33。
 *
 * 这里保存的是「已经拉到手的那一份」：
 * - **拿到了**（`entries` 非空）→ 用它，代码里的构造器不参与；
 * - **没拿到**（还没拉 / 拉失败）→ 回落构造器。用户口径是「离线了就别用了」，
 *   但**代码兜底留到入库验证通过为止**（用户原话「丢掉等会再说」）——
 *   删掉兜底只需把下面两个 `…Base()` 改成只读服务端快照。
 */
/** 方案清单里的一项（服务端 `affix_preset_scheme` 的形状，管理页与用户侧新建库共用） */
export interface AffixPresetSchemeInfo {
  name: string
  /** 默认方案：用户侧不带参数读到的就是它 */
  isDefault: boolean
  sortOrder: number
  entryCount: number
}

const serverAffixPreset = ref<{
  entries: AffixLibraryEntry[]
  groups: AffixLibraryGroup[]
  schemes: AffixPresetSchemeInfo[]
} | null>(null)

/** 服务端条目里被跳过的条数（target 不是本版本认识的字段）—— 供界面/测试读出 */
export const skippedServerPresetEntries = ref(0)

function readPresetConditionString(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  return typeof value === 'string' && allowed.has(value) ? value : undefined
}

/**
 * 官方预设可能把条件写在条目顶栏，或只写在 `effectJson.spec.conditions`。
 * 两边都认，顶栏优先（管理端刚改过的草稿）。
 */
function hoistPresetConditionFields(item: Record<string, unknown>): Partial<AffixLibraryEntry> {
  const templateRaw = item.effectTemplate ?? item.effectJson
  const spec =
    templateRaw && typeof templateRaw === 'object' && !Array.isArray(templateRaw)
      ? (templateRaw as { spec?: { conditions?: Record<string, unknown> } }).spec
      : undefined
  const specCond = spec?.conditions && typeof spec.conditions === 'object' ? spec.conditions : {}
  const skillFromSpec = Array.isArray(specCond.skillTargets) ? specCond.skillTargets[0] : undefined
  const applySituation =
    readPresetConditionString(item.applySituation, AFFIX_APPLY_SITUATIONS) ??
    readPresetConditionString(specCond.applySituation, AFFIX_APPLY_SITUATIONS)
  const scope =
    readPresetConditionString(item.scope, AFFIX_BUFF_SCOPES) ??
    readPresetConditionString(specCond.scope, AFFIX_BUFF_SCOPES)
  const skillCategory =
    (typeof item.skillCategory === 'string' && item.skillCategory
      ? (item.skillCategory as BuffSkillTargetId)
      : undefined) ??
    (skillFromSpec && typeof skillFromSpec === 'object' && typeof (skillFromSpec as { category?: unknown }).category === 'string'
      ? ((skillFromSpec as { category: string }).category as BuffSkillTargetId)
      : undefined)
  const skillSubcategoryId =
    item.skillSubcategoryId === null
      ? null
      : typeof item.skillSubcategoryId === 'string'
        ? item.skillSubcategoryId
        : skillFromSpec && typeof skillFromSpec === 'object'
          ? ((skillFromSpec as { subcategoryId?: string | null }).subcategoryId ?? undefined)
          : undefined
  const appliesToAnomaly =
    typeof item.appliesToAnomaly === 'boolean'
      ? item.appliesToAnomaly
      : typeof specCond.appliesToAnomaly === 'boolean'
        ? specCond.appliesToAnomaly
        : undefined
  const effectTemplate =
    templateRaw && typeof templateRaw === 'object' && !Array.isArray(templateRaw)
      ? (templateRaw as AffixEffectTemplate)
      : undefined
  return {
    ...(applySituation ? { applySituation: applySituation as BuffApplySituation } : {}),
    ...(scope ? { scope: scope as BuffScope } : {}),
    ...(skillCategory ? { skillCategory } : {}),
    ...(skillSubcategoryId !== undefined ? { skillSubcategoryId } : {}),
    ...(appliesToAnomaly !== undefined ? { appliesToAnomaly } : {}),
    ...(effectTemplate ? { effectTemplate } : {}),
  }
}

/**
 * 校验并解析一份预设条目（纯函数：不碰全局快照）。
 *
 * 抽出来是为了让**非默认方案**也能走同一套校验 —— `setServerAffixPreset` 写全局快照
 * （「默认」那份，计算页常驻用），而新建库时选别的方案只是临时拉一份，
 * 不该把全局那份顶掉（顶掉之后计算页会瞬间变成另一套词条）。
 *
 * 认不出的 target 直接跳过并计数：脏数据不能进计算，也不能静默变 0。
 */
export function parseAffixPresetEntries(rawEntries: unknown[]): {
  entries: AffixLibraryEntry[]
  skipped: number
} {
  let skipped = 0
  const entries: AffixLibraryEntry[] = []
  for (const raw of rawEntries) {
    const item = raw as Partial<AffixLibraryEntry>
    if (
      typeof item?.id !== 'string' ||
      typeof item?.label !== 'string' ||
      !isAffixLibraryEntryTarget(item?.target)
    ) {
      skipped += 1
      continue
    }
    entries.push({
      id: item.id,
      label: item.label,
      target: item.target,
      perRoll: Number(item.perRoll) || 0,
      cap: Number(item.cap) || 0,
      group: typeof item.group === 'string' ? item.group : '',
      rollCost: Number.isFinite(Number(item.rollCost)) ? Number(item.rollCost) : 1,
      enabledByDefault: Boolean(item.enabledByDefault),
      ...hoistPresetConditionFields(item as Record<string, unknown>),
    })
  }
  return { entries, skipped }
}

/** 校验并解析一份预设分组（纯函数，理由同上） */
export function parseAffixPresetGroups(rawGroups: unknown[]): AffixLibraryGroup[] {
  const groups: AffixLibraryGroup[] = []
  for (const raw of rawGroups) {
    const item = raw as Partial<AffixLibraryGroup>
    if (typeof item?.name !== 'string' || !item.name) continue
    const group: AffixLibraryGroup = { name: item.name, cap: Number(item.cap) || 0 }
    // 组规则「不消耗总词条数」：预设快照里也可能带（服务端只认显式 true）
    if (item.excludedFromTotalRolls === true) group.excludedFromTotalRolls = true
    groups.push(group)
  }
  return groups
}

/**
 * 存入服务端拉到的官方预设。
 *
 * **逐条校验 target**（见 `parseAffixPresetEntries`）：认不出的字段直接跳过并计数。
 * 返回跳过的条数，调用方可据此提示。
 */
export function setServerAffixPreset(snapshot: {
  entries?: unknown[]
  groups?: unknown[]
  schemes?: unknown[]
} | null): number {
  if (!snapshot) {
    serverAffixPreset.value = null
    skippedServerPresetEntries.value = 0
    return 0
  }
  const rawEntries = Array.isArray(snapshot.entries) ? snapshot.entries : []
  const rawGroups = Array.isArray(snapshot.groups) ? snapshot.groups : []
  const { entries, skipped } = parseAffixPresetEntries(rawEntries)
  const groups = parseAffixPresetGroups(rawGroups)
  skippedServerPresetEntries.value = skipped
  // 条目为空（服务端库是空的/字段全不认识）时保持 null，让调用方回落构造器
  serverAffixPreset.value = entries.length
    ? { entries, groups, schemes: parseAffixPresetSchemes(snapshot.schemes) }
    : null
  return skipped
}

/** 校验并解析方案清单（缺省 = 只有默认方案一项，保持老行为不缺东西） */
export function parseAffixPresetSchemes(raw?: unknown): AffixPresetSchemeInfo[] {
  if (!Array.isArray(raw)) return []
  const out: AffixPresetSchemeInfo[] = []
  for (const item of raw) {
    const scheme = item as Partial<AffixPresetSchemeInfo>
    if (typeof scheme?.name !== 'string' || !scheme.name) continue
    out.push({
      name: scheme.name,
      isDefault: Boolean(scheme.isDefault),
      sortOrder: Number(scheme.sortOrder) || 0,
      entryCount: Number(scheme.entryCount) || 0,
    })
  }
  return out
}

export function clearServerAffixPreset(): void {
  setServerAffixPreset(null)
}

/** 当前是否在用服务端那份（界面可据此提示「官方预设来自服务器」） */
export function isUsingServerAffixPreset(): boolean {
  return serverAffixPreset.value != null
}

/**
 * 预设条目（不含用户自建）：优先服务端，其次代码构造器。
 *
 * 注意**每次读都可能不同** —— 它读的是响应式快照，服务端数据到达后，
 * 依赖它的 computed 会自动重算（这是「异步拉取不阻塞首屏」的关键）。
 */
export function presetAffixEntriesBase(): AffixLibraryEntry[] {
  const fromServer = serverAffixPreset.value?.entries
  return fromServer && fromServer.length ? fromServer.map((entry) => ({ ...entry })) : createPresetAffixLibraryEntries()
}

/** 预设分组：优先服务端，其次代码常量 */
export function presetAffixGroupsBase(): AffixLibraryGroup[] {
  const fromServer = serverAffixPreset.value?.groups
  return fromServer && fromServer.length
    ? fromServer.map((group) => ({ ...group }))
    : AFFIX_PRESET_GROUPS.map((group) => ({ ...group }))
}

/**
 * 服务端现有哪些方案（新建库时让用户选「从哪来」用）。
 *
 * 没拿到快照时返回空数组 —— 界面据此只显示「空配置」并说明原因，
 * 不假装有方案可选（用户口径：拿不到就不建，别把代码兜底冻成「官方」）。
 */
export function presetAffixSchemesBase(): AffixPresetSchemeInfo[] {
  return (serverAffixPreset.value?.schemes ?? []).map((scheme) => ({ ...scheme }))
}

/** 默认方案的展示名（服务端 `is_default` 那套；也是不带参数读到的方案） */
export function defaultAffixPresetSchemeName(): string {
  const list = presetAffixSchemesBase()
  return list.find((scheme) => scheme.isDefault)?.name ?? OFFICIAL_AFFIX_PRESET_NAME
}

/**
 * 用**指定的一份**预设内容建一套独立库（新建时「复制某个方案」走这里）。
 *
 * 与 `createDefaultAffixLibraryState('copy')` 的区别：那份固定复制**默认方案**且要求
 * 全局快照已在手；这份拿的是调用方刚拉到的内容，可以是任何一个方案。
 * 冻结语义完全一致：条目整份搬进本库，此后官方怎么改都与它无关。
 */
export function createAffixLibraryStateFromPreset(
  entries: AffixLibraryEntry[],
  groups: AffixLibraryGroup[],
): AffixLibraryState {
  return {
    origin: 'copy',
    customEntries: entries.map((entry) => ({ ...entry })),
    enabledOverride: {},
    overrides: {},
    removedEntryIds: [],
    groups: groups.map((group) => ({ ...group })),
    removedGroupNames: [],
  }
}

export interface AffixLibraryState {
  /**
   * 这套库的**条目从哪来** —— 决定它是否独立于官方预设（见文件头「官方预设来源」）。
   *
   * - `'copy'`（**独立**）：新建时把当时的官方预设**整份复制进本库**（烘进 `customEntries`）。
   *   此后条目归本库所有，官方改预设与它无关，也不会被"恢复默认"以外的操作影响；
   * - `'empty'`（**空配置**）：一条预设都不加载，条目与分组全自己建；
   * - `'follow'`（**跟随**）：条目仍由官方预设「按需生成」，本库存的是覆盖/删除记录。
   *   这是步骤 34 的语义，**只留给历史库**（新建不再提供）。
   *
   * ⚠️ 缺省必须是 `'follow'`：老存档里没有这个字段，当成 `'empty'` 会让用户库瞬间变空。
   */
  origin: AffixLibrarySetOrigin
  /** 用户自建条目；`'copy'` 的库在这里也存着从官方预设复制来的那一份 */
  customEntries: AffixLibraryEntry[]
  /**
   * 条目 id → 显式启用/禁用。
   * 缺省时用条目自身的 `enabledByDefault`：副词条与 4/5/6 号位主属性默认参与
   * （2026-09-12 起，见 `dev-docs/affix-optimizer-impl-log.md` 步骤 28），
   * 其余扩展条目（Buff 来源 / 不分槽位的伤害字段）默认不参与。
   */
  enabledOverride: Record<string, boolean>
  /** 默认条目的覆盖值（用户改了名称/每档/上限/分组/目标/局内条件时记录） */
  overrides: Record<
    string,
    Partial<
      Pick<
        AffixLibraryEntry,
        | 'label'
        | 'perRoll'
        | 'cap'
        | 'group'
        | 'target'
        | 'applySituation'
        | 'scope'
        | 'skillCategory'
        | 'skillSubcategoryId'
        | 'appliesToAnomaly'
      >
    >
  >
  /**
   * 被用户删掉的默认条目 id。
   *
   * 默认条目是「按需生成」的（`createDefaultAffixLibrary()` 每次现算），
   * 想删就得记住「删过谁」。用户口径是「预设兜底、用户随便改」，
   * 所以不设「不可删」标记：删了记在这里，「恢复默认」会清空。
   */
  removedEntryIds: string[]
  /**
   * 词条分组（组名 + 组额度），按列表顺序展示。
   *
   * 条目只记组名、额度集中在这里维护：同一个组名在两处填，填岔一个字符就变成两个组，
   * 而且**静默不生效** —— 这是最难查的那类问题。
   */
  groups: AffixLibraryGroup[]
  /**
   * 被用户删掉的**预设分组**名。
   *
   * 与 `removedEntryIds` 同一个思路：预设分组是「按需生成」的（每次读盘都补齐），
   * 光从 `groups` 里删掉，下次读盘又会被补回来 —— 想真删就得记住「删过谁」。
   */
  removedGroupNames: string[]
}

/**
 * 一套库的初始状态。
 *
 * 起点语义见 `AffixLibrarySetOrigin`：`'copy'` 复制**当前的**官方预设进来（新建完毕即冻结），
 * `'empty'` 什么都没有，`'follow'` 只是老存档迁移途中的过渡态（见 `freezePendingAffixLibrarySets`）。
 *
 * ⚠️ `'copy'` 要求官方那份**已经在手**，否则抛错：拿代码兜底冒充官方复制一份，
 * 库里存的就与官方对不上，而且之后再也不会纠正（用户 2026-09-13 指出的正是这类偏差）。
 * 调用方（新建弹窗）先 `ensureAffixPresetLoaded()` 取到再调。
 */
export function createDefaultAffixLibraryState(
  origin: AffixLibrarySetOrigin = 'follow',
): AffixLibraryState {
  if (origin === 'copy' && !isUsingServerAffixPreset()) {
    throw new Error('官方预设还没取到，无法复制一份')
  }
  return {
    origin,
    // 独立库的那一份快照就存在这里：之后改 / 删 / 改名都走自建条目那条路
    customEntries: origin === 'copy' ? presetAffixEntriesBase().map((entry) => ({ ...entry })) : [],
    enabledOverride: {},
    overrides: {},
    removedEntryIds: [],
    groups: origin === 'empty' ? [] : presetAffixGroupsBase().map((group) => ({ ...group })),
    removedGroupNames: [],
  }
}

/**
 * 这套库的条目从哪来。
 *
 * - `'copy'`：**独立**（冻结）。新建时把当时的官方预设整份复制进本库，此后官方怎么改都与它无关；
 * - `'empty'`：空配置，一条预设都不加载；
 * - `'follow'`：**过渡态**，不是给用户选的起点 —— 只出现在老存档迁移（改造前的库本来就是
 *   「预设 + 覆盖」结构），官方那份一到就冻成 `'copy'`。
 *
 * 为什么不留「跟随」给用户：**官方改不动用户手里的库，跟随必然是假的**
 * （用户 2026-09-13 原话「你不独立，怎么跟官方维护，做不到的」）。
 */
export type AffixLibrarySetOrigin = 'follow' | 'copy' | 'empty'

/**
 * 官方预设的展示名。
 *
 * 目前只有一套（用户 2026-09-12 口径「先做一套」），名字先写在这里；
 * 将来支持多套预设时，名字应随预设一起由服务器给（现在服务器只存条目与分组）。
 */
export const OFFICIAL_AFFIX_PRESET_NAME = '默认'

/**
 * 新建库的起点状态（**新建完毕即冻结**）。
 *
 * - `'copy'`：把**当前那份**官方预设整份复制进新库（此后独立，官方更新不再影响它）。
 *   要求官方那份已在手 —— 没取到会抛错，调用方先 `ensureAffixPresetLoaded()`；
 * - `'empty'`：空配置，不加载任何预设。
 */
export function createAffixLibraryStateForOrigin(
  origin: AffixLibrarySetOrigin,
): AffixLibraryState {
  return createDefaultAffixLibraryState(origin)
}

/**
 * 把一套**过渡态**（`'follow'`）的库冻成**独立**（`'copy'`）：官方预设那份整份搬进本库。
 *
 * 烘进来的内容是「官方预设 − 用户删过的 ± 用户改过的 + 用户自建的」，
 * 也就是用户此刻看到的全部条目；转换前后界面与计算**完全相同**，
 * 区别只是此后官方怎么改都不会再动它。
 *
 * 非 `'follow'` 的库原样返回（`'copy'` 本来就独立，`'empty'` 没有预设可复制）。
 */
export function convertAffixLibraryStateToCopy(state: AffixLibraryState): AffixLibraryState {
  if (state.origin !== 'follow') return state
  return {
    origin: 'copy',
    customEntries: resolveAffixLibraryAll(state).map((entry) => ({ ...entry })),
    // 勾选状态本来就存在这里，照搬（它按条目 id 记，与条目从哪来无关）
    enabledOverride: { ...state.enabledOverride },
    overrides: {},
    removedEntryIds: [],
    groups: state.groups.map((group) => ({ ...group })),
    removedGroupNames: [],
  }
}

const AFFIX_LIBRARY_STORAGE_KEY = 'zzz-hp-affix-library'

/**
 * 旧存档迁移：早期条目用 `kind: 'substat' | 'panelField'` + `affixKey` / `panelField`
 * 表达落点，现在统一成 `target`。只做结构转换，**不改数值**（`perRoll` 原样搬过去）。
 */
function migrateCustomEntry(raw: unknown): AffixLibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id : ''
  if (!id) return null

  let target: AffixLibraryEntryTarget | null = null
  if (typeof item.target === 'string' && item.target.startsWith('stat:')) {
    const candidate = `panel:${item.target.slice('stat:'.length)}`
    target = isAffixLibraryEntryTarget(candidate) ? candidate : null
  } else if (isAffixLibraryEntryTarget(item.target)) {
    target = item.target
  } else if (item.kind === 'substat' && typeof item.affixKey === 'string') {
    const candidate = `panel:${item.affixKey}`
    target = isAffixLibraryEntryTarget(candidate) ? candidate : null
  } else if (item.kind === 'panelField' && typeof item.panelField === 'string') {
    const candidate = `panel:${item.panelField}`
    target = isAffixLibraryEntryTarget(candidate) ? candidate : null
  }
  if (!target) return null

  const label = typeof item.label === 'string' ? item.label : ''
  const perRoll = Number(item.perRoll)
  if (!label.trim() || !Number.isFinite(perRoll)) return null

  const applySituation =
    typeof item.applySituation === 'string' && AFFIX_APPLY_SITUATIONS.has(item.applySituation)
      ? (item.applySituation as BuffApplySituation)
      : undefined
  const scope =
    typeof item.scope === 'string' && AFFIX_BUFF_SCOPES.has(item.scope)
      ? (item.scope as BuffScope)
      : undefined
  const skillCategory =
    typeof item.skillCategory === 'string' && item.skillCategory
      ? (item.skillCategory as BuffSkillTargetId)
      : undefined
  const skillSubcategoryId =
    item.skillSubcategoryId === null
      ? null
      : typeof item.skillSubcategoryId === 'string'
        ? item.skillSubcategoryId
        : undefined
  const appliesToAnomaly =
    typeof item.appliesToAnomaly === 'boolean' ? item.appliesToAnomaly : undefined

  return {
    id,
    label,
    target,
    perRoll,
    cap: Number.isFinite(Number(item.cap)) ? Number(item.cap) : 0,
    group: typeof item.group === 'string' ? item.group : '',
    rollCost: Number.isFinite(Number(item.rollCost)) ? Number(item.rollCost) : 1,
    enabledByDefault: item.enabledByDefault !== false,
    ...(applySituation ? { applySituation } : {}),
    ...(scope ? { scope } : {}),
    ...(skillCategory ? { skillCategory } : {}),
    ...(skillSubcategoryId !== undefined ? { skillSubcategoryId } : {}),
    ...(appliesToAnomaly !== undefined ? { appliesToAnomaly } : {}),
  }
}

/**
 * 起点迁移：`origin` 认得出来就用它；认不出（步骤 35 之前的老存档）按当时的 `includePreset` 推断 ——
 * 显式 `false` = 空配置，其余（含缺省）= 跟随。
 *
 * **缺省必须是 `'follow'`**：老存档没有这些字段，当成 `'empty'` 会让用户库瞬间变空。
 */
function coerceAffixLibrarySetOrigin(
  origin: unknown,
  includePreset: unknown,
): AffixLibrarySetOrigin {
  if (origin === 'follow' || origin === 'copy' || origin === 'empty') return origin
  return includePreset === false ? 'empty' : 'follow'
}

/**
 * 把任意来源的对象收成一份合法词条库状态。
 *
 * 载入存档与导入文件共用这一处：字段缺失、类型不对一律回落默认值，
 * 自建条目逐条走 `migrateCustomEntry`（同时承担旧 `kind` 结构的迁移）。
 */
export function coerceAffixLibraryState(raw: unknown): AffixLibraryState {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<AffixLibraryState> & {
    /** 步骤 34 的旧字段（布尔开关）；步骤 35 起由 `origin` 取代，这里只用于迁移 */
    includePreset?: unknown
  }
  const removedGroupNames = Array.isArray(parsed.removedGroupNames)
    ? parsed.removedGroupNames.filter((name): name is string => typeof name === 'string')
    : []
  const origin = coerceAffixLibrarySetOrigin(parsed.origin, parsed.includePreset)
  const state: AffixLibraryState = {
    origin,
    customEntries: Array.isArray(parsed.customEntries)
      ? parsed.customEntries
          .map(migrateCustomEntry)
          .filter((entry): entry is AffixLibraryEntry => entry !== null)
      : [],
    enabledOverride:
      parsed.enabledOverride && typeof parsed.enabledOverride === 'object'
        ? parsed.enabledOverride
        : {},
    overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
    removedEntryIds: Array.isArray(parsed.removedEntryIds)
      ? parsed.removedEntryIds.filter((id): id is string => typeof id === 'string')
      : [],
    groups: mergePresetGroups(
      coerceAffixLibraryGroups(parsed.groups),
      removedGroupNames,
      origin === 'follow',
    ),
    removedGroupNames,
  }
  return withReferencedGroupsBackfilled(state)
}

/** 组表的宽松解析：名字非空、额度取非负整数（非法一律回落到「不限」） */
function coerceAffixLibraryGroups(raw: unknown): AffixLibraryGroup[] {
  if (!Array.isArray(raw)) return []
  const out: AffixLibraryGroup[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const source = item as AffixLibraryGroup
    const name = typeof source.name === 'string' ? source.name.trim() : ''
    if (!name || seen.has(name)) continue
    const group: AffixLibraryGroup = { name, cap: coerceGroupCap(source.cap) }
    // 组规则「不消耗总词条数」：只认显式 true（老存档没有这个键 → 不豁免，行为不变）
    if (source.excludedFromTotalRolls === true) group.excludedFromTotalRolls = true
    out.push(group)
    seen.add(name)
  }
  return out
}

/** 额度归一：非负整数；`0` = 不限；非法值回落「不限」 */
export function coerceGroupCap(value: unknown): number {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return AFFIX_GROUP_UNLIMITED
  return Math.floor(raw)
}

/**
 * 把预设分组补回来（存档里没有的、且用户没删过的）。
 *
 * 为什么要补：预设分组是「按需生成」的（服务端快照 / `AFFIX_PRESET_GROUPS`）。用户在这次改造**之前**
 * 存的档里根本没有分组表 —— 只从存档读就会一个预设组都没有，界面上只剩用户自己建的组。
 *
 * 用户删过的预设组记在 `removedGroupNames` 里，不会复活；
 * **只有「跟随」的库才补预设组**：空配置的库点开不该有 5 个空页签，
 * 独立库（`'copy'`）的分组在新建时就复制进存档了。
 */
function mergePresetGroups(
  saved: AffixLibraryGroup[],
  removedNames: string[],
  followPreset: boolean,
): AffixLibraryGroup[] {
  const removed = new Set(removedNames)
  const savedByName = new Map(saved.map((group) => [group.name, group]))
  const out: AffixLibraryGroup[] = []
  // 预设组按预设顺序排前面（存过的保留用户改过的额度）
  for (const preset of followPreset ? presetAffixGroupsBase() : []) {
    if (removed.has(preset.name)) continue
    out.push(savedByName.get(preset.name) ?? { ...preset })
    savedByName.delete(preset.name)
  }
  // 用户自建（含改名后的组）按存档顺序排在后面
  for (const group of saved) {
    if (removed.has(group.name) || out.some((item) => item.name === group.name)) continue
    out.push(group)
  }
  return out
}

/**
 * 给「被条目引用、但组表里没有」的组名补一条记录。
 *
 * 为什么需要：老存档与手改过的导入文件里只有条目上的组名。若不补，
 * 那个引用就没有页签可去 —— 条目会**在界面上消失**（比报错更难发现）。
 *
 * 补出来的额度是 **1**：这些组名来自改造前的「互斥组」字段，那时的语义就是
 * 「同组至多一条」—— 按 1 补才与用户当初的意图一致。
 */
function withReferencedGroupsBackfilled(state: AffixLibraryState): AffixLibraryState {
  const known = new Set(state.groups.map((group) => group.name))
  const missing: AffixLibraryGroup[] = []
  for (const entry of [...presetEntriesWithOverrides(state), ...state.customEntries]) {
    const name = entry.group.trim()
    if (!name || known.has(name)) continue
    known.add(name)
    missing.push({ name, cap: DEFAULT_AFFIX_GROUP_CAP })
  }
  return missing.length ? { ...state, groups: [...state.groups, ...missing] } : state
}

// ===================== 多套词条库 =====================

/**
 * 一套词条库：名字 + 内容 + 时间戳。
 *
 * 为什么要多套：词条库此前只有一份，换一套配装就得把上一条条的改动手工还原。
 * 现在按「库」分开存，随时切换。库不随方案导出（用户已定），只在本机 localStorage。
 */
export interface AffixLibrarySet {
  id: string
  name: string
  state: AffixLibraryState
  createdAt: number
  updatedAt: number
}

/** 词条库存档：全部库 + 当前激活的那套 */
export interface AffixLibraryStore {
  version: number
  activeId: string
  sets: AffixLibrarySet[]
}

export const AFFIX_LIBRARY_STORE_VERSION = 2
export const DEFAULT_AFFIX_LIBRARY_SET_NAME = '默认'
/** 库名长度上限：只是防手滑贴进一整段文字，不追求严格 */
export const AFFIX_LIBRARY_SET_NAME_MAX = 24

function normalizeAffixLibrarySetName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  return name ? name.slice(0, AFFIX_LIBRARY_SET_NAME_MAX) : fallback
}

function nextAffixLibrarySetId(sets: AffixLibrarySet[]): string {
  let max = 0
  for (const set of sets) {
    const match = /^set:(\d+)$/.exec(set.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `set:${max + 1}`
}

function coerceAffixLibrarySet(raw: unknown, index: number): AffixLibrarySet | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const now = Date.now()
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `set:${index + 1}`
  return {
    id,
    name: normalizeAffixLibrarySetName(item.name, `词条库 ${index + 1}`),
    state: coerceAffixLibraryState(item.state),
    createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : now,
    updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : now,
  }
}

export function createDefaultAffixLibraryStore(): AffixLibraryStore {
  const now = Date.now()
  const set: AffixLibrarySet = {
    id: 'set:1',
    name: DEFAULT_AFFIX_LIBRARY_SET_NAME,
    state: createDefaultAffixLibraryState(),
    createdAt: now,
    updatedAt: now,
  }
  return { version: AFFIX_LIBRARY_STORE_VERSION, activeId: set.id, sets: [set] }
}

/**
 * 收成一份合法存档。旧结构（还没有多套概念时，存档**直接就是一套库内容**）
 * 自动包成「默认」一套；识别不了返回 null，由调用方决定回落什么。
 */
export function coerceAffixLibraryStore(raw: unknown): AffixLibraryStore | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>

  if (Array.isArray(obj.sets)) {
    const seen = new Set<string>()
    const sets: AffixLibrarySet[] = []
    for (const [index, item] of obj.sets.entries()) {
      const set = coerceAffixLibrarySet(item, index)
      if (!set) continue
      // id 必须唯一：重复的补一个新 id，避免「切换后指向别套」
      if (seen.has(set.id)) set.id = nextAffixLibrarySetId(sets)
      seen.add(set.id)
      sets.push(set)
    }
    if (!sets.length) return null
    const activeId =
      typeof obj.activeId === 'string' && sets.some((set) => set.id === obj.activeId)
        ? obj.activeId
        : sets[0]!.id
    return { version: AFFIX_LIBRARY_STORE_VERSION, activeId, sets }
  }

  // 旧结构：顶层就是 `customEntries` / `enabledOverride` 这一套
  if ('customEntries' in obj || 'enabledOverride' in obj || 'removedEntryIds' in obj) {
    const store = createDefaultAffixLibraryStore()
    store.sets[0]!.state = coerceAffixLibraryState(obj)
    return store
  }
  return null
}

/**
 * 把存档里还挂着的过渡态（`'follow'`）库冻成独立。
 *
 * 谁调：官方预设**真正到达**之后（`affixPresetLoader` 拿到服务端快照那一刻）。
 * 为什么在那里：冻的是「官方那份」，服务端没到就冻等于把代码兜底当官方（见
 * `createDefaultAffixLibraryState` 的告警）。服务端没到就**什么都不做**，下次再说。
 *
 * 返回写回后的存档；没有可冻的（或官方那份没到）返回 `null`，调用方可据此跳过通知。
 */
export function freezePendingAffixLibrarySets(): AffixLibraryStore | null {
  if (!isUsingServerAffixPreset()) return null
  const store = loadAffixLibraryStore()
  if (!store.sets.some((set) => set.state.origin === 'follow')) return null
  const next: AffixLibraryStore = {
    ...store,
    sets: store.sets.map((set) =>
      set.state.origin === 'follow'
        ? { ...set, state: convertAffixLibraryStateToCopy(set.state), updatedAt: Date.now() }
        : set,
    ),
  }
  writeAffixLibraryStore(next)
  return next
}

function writeAffixLibraryStore(store: AffixLibraryStore): void {
  try {
    localStorage.setItem(AFFIX_LIBRARY_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 配额满/隐私模式：静默忽略
  }
}

/**
 * 用户侧名为「默认」的独立副本：拿掉官方已从选单/预设删掉的局外 `panel:` 条目。
 * 其它库名不改（冻结副本）。返回原对象表示没有要写盘的变化。
 */
export function stripRetiredHiddenPanelAffixFromDefaultCopy(
  store: AffixLibraryStore,
): AffixLibraryStore {
  const hiddenIds = new Set(
    (AFFIX_PANEL_FIELDS_HIDDEN_FROM_PICKER as readonly string[]).map((field) => `panel:${field}`),
  )
  let changed = false
  const sets = store.sets.map((set) => {
    if (set.name !== DEFAULT_AFFIX_LIBRARY_SET_NAME || set.state.origin !== 'copy') return set
    const nextState = stripRetiredHiddenPanelAffixCopyState(set.state, hiddenIds)
    if (nextState === set.state) return set
    changed = true
    return { ...set, state: nextState, updatedAt: Date.now() }
  })
  return changed ? { ...store, sets } : store
}

function stripRetiredHiddenPanelAffixCopyState(
  state: AffixLibraryState,
  hiddenIds: ReadonlySet<string>,
): AffixLibraryState {
  const nextEntries = state.customEntries.filter(
    (entry) => !hiddenIds.has(entry.target) && !hiddenIds.has(entry.id),
  )
  const dropHiddenKeys = <T extends Record<string, unknown>>(record: T): T => {
    let dirty = false
    const next = { ...record }
    for (const key of Object.keys(next)) {
      if (!hiddenIds.has(key)) continue
      delete next[key]
      dirty = true
    }
    return dirty ? next : record
  }
  const nextEnabled = dropHiddenKeys(state.enabledOverride)
  const nextOverrides = dropHiddenKeys(state.overrides)
  const nextRemoved = state.removedEntryIds.filter((id) => !hiddenIds.has(id))
  if (
    nextEntries.length === state.customEntries.length &&
    nextEnabled === state.enabledOverride &&
    nextOverrides === state.overrides &&
    nextRemoved.length === state.removedEntryIds.length
  ) {
    return state
  }
  return {
    ...state,
    customEntries: nextEntries,
    enabledOverride: nextEnabled,
    overrides: nextOverrides,
    removedEntryIds: nextRemoved,
  }
}

export function loadAffixLibraryStore(): AffixLibraryStore {
  try {
    const raw = localStorage.getItem(AFFIX_LIBRARY_STORAGE_KEY)
    if (!raw) return createDefaultAffixLibraryStore()
    const parsed = coerceAffixLibraryStore(JSON.parse(raw)) ?? createDefaultAffixLibraryStore()
    const synced = stripRetiredHiddenPanelAffixFromDefaultCopy(parsed)
    if (synced !== parsed) writeAffixLibraryStore(synced)
    return synced
  } catch {
    // 存档损坏或隐私模式：回落默认库，不影响计算
    return createDefaultAffixLibraryStore()
  }
}

export function saveAffixLibraryStore(store: AffixLibraryStore): void {
  writeAffixLibraryStore(store)
}

/** 当前激活的那套（activeId 失配时取第一套，保证永远有一套可用） */
export function activeAffixLibrarySet(store: AffixLibraryStore): AffixLibrarySet {
  return store.sets.find((set) => set.id === store.activeId) ?? store.sets[0]!
}

/** 切换激活的库；id 不存在或本来就是它，原样返回 */
export function activateAffixLibrarySet(store: AffixLibraryStore, id: string): AffixLibraryStore {
  if (store.activeId === id) return store
  if (!store.sets.some((set) => set.id === id)) return store
  const next: AffixLibraryStore = { ...store, activeId: id }
  writeAffixLibraryStore(next)
  return next
}

/** 新建一套并切过去；`state` 缺省为空库（默认条目仍按需生成） */
export function createAffixLibrarySet(
  store: AffixLibraryStore,
  name: string,
  state?: AffixLibraryState,
): AffixLibraryStore {
  const now = Date.now()
  const set: AffixLibrarySet = {
    id: nextAffixLibrarySetId(store.sets),
    name: normalizeAffixLibrarySetName(name, '新建词条库'),
    state: state ? coerceAffixLibraryState(state) : createDefaultAffixLibraryState(),
    createdAt: now,
    updatedAt: now,
  }
  const next: AffixLibraryStore = { ...store, activeId: set.id, sets: [...store.sets, set] }
  writeAffixLibraryStore(next)
  return next
}

export function renameAffixLibrarySet(
  store: AffixLibraryStore,
  id: string,
  name: string,
): AffixLibraryStore {
  const set = store.sets.find((item) => item.id === id)
  if (!set) return store
  const nextName = normalizeAffixLibrarySetName(name, set.name)
  if (nextName === set.name) return store
  const next: AffixLibraryStore = {
    ...store,
    sets: store.sets.map((item) =>
      item.id === id ? { ...item, name: nextName, updatedAt: Date.now() } : item,
    ),
  }
  writeAffixLibraryStore(next)
  return next
}

/** 删除一套；最后一套不给删（删完就没库可用了），删的若是激活项则切到剩下的第一套 */
export function deleteAffixLibrarySet(store: AffixLibraryStore, id: string): AffixLibraryStore {
  if (store.sets.length <= 1) return store
  if (!store.sets.some((set) => set.id === id)) return store
  const sets = store.sets.filter((set) => set.id !== id)
  const activeId = store.activeId === id ? sets[0]!.id : store.activeId
  const next: AffixLibraryStore = { ...store, activeId, sets }
  writeAffixLibraryStore(next)
  return next
}

/**
 * 写盘前的归一：**过渡态（`'follow'`）在官方那份到手后就地冻成独立**。
 *
 * 为什么在写盘这一层兜一道：页面手里的状态可能是「官方那份到达之前」读进来的（还挂着
 * `'follow'`），照原样写回去会把刚冻好的库又变回跟随 —— 静默撤销冻结。
 * 冻的时机正好：此刻官方那份已经在手，冻出来的内容与用户眼前的一致。
 */
export function normalizeAffixLibraryStateForSave(state: AffixLibraryState): AffixLibraryState {
  return state.origin === 'follow' && isUsingServerAffixPreset()
    ? convertAffixLibraryStateToCopy(state)
    : state
}

/**
 * 把一份状态写回激活的那套（内容编辑都走这里）。
 *
 * 写盘前先过 `normalizeAffixLibraryStateForSave`（把过渡态冻掉），理由见那里。
 */
export function saveAffixLibraryState(state: AffixLibraryState): void {
  const normalized = normalizeAffixLibraryStateForSave(state)
  const store = loadAffixLibraryStore()
  writeAffixLibraryStore({
    ...store,
    sets: store.sets.map((set) =>
      set.id === store.activeId ? { ...set, state: normalized, updatedAt: Date.now() } : set,
    ),
  })
}

/** 当前激活那套的内容（既有调用方沿用这个入口，不必知道多套的存在） */
export function loadAffixLibraryState(): AffixLibraryState {
  return activeAffixLibrarySet(loadAffixLibraryStore()).state
}

/** 全部预设条目（副词条 + 扩展 + 4/5/6 号位主属性 + 2 件套），已应用用户覆盖值 */
function presetEntriesWithOverrides(state: AffixLibraryState): AffixLibraryEntry[] {
  // 只有「跟随」的库才从官方预设拿条目：独立库的条目是新建时复制来的（存在 `customEntries`），
  // 空配置的库一条都没有 —— 都见 `AffixLibraryState.origin`
  if (state.origin !== 'follow') return []
  const removed = new Set(state.removedGroupNames)
  return presetAffixEntriesBase().map((entry) => {
    const override = state.overrides[entry.id]
    const merged = override ? { ...entry, ...override } : entry
    // 用户删过这个组 → 组内预设条目回落「未分组」。
    // 必须在这里清：预设条目每次读盘都重建，若还挂着已删组名，
    // `withReferencedGroupsBackfilled` 会把那个组又补回来（删除等于没删）。
    if (merged.group && removed.has(merged.group)) return { ...merged, group: '' }
    return merged
  })
}

/** 词条库全量（含未参与的条目，但不含被删掉的），供编辑器展示 */
export function resolveAffixLibraryAll(state: AffixLibraryState): AffixLibraryEntry[] {
  const removed = new Set(state.removedEntryIds)
  const all = [...presetEntriesWithOverrides(state), ...state.customEntries]
  const seen = new Set<string>()
  return all.filter((entry) => {
    if (removed.has(entry.id)) return false
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })
}

export function isAffixLibraryEntryEnabled(
  state: AffixLibraryState,
  entry: Pick<AffixLibraryEntry, 'id' | 'enabledByDefault'>,
): boolean {
  const override = state.enabledOverride[entry.id]
  return override ?? entry.enabledByDefault
}

/** 参与计算的词条库（过滤掉未启用的条目） */
export function resolveAffixLibrary(state: AffixLibraryState): AffixLibraryEntry[] {
  return resolveAffixLibraryAll(state).filter((entry) =>
    isAffixLibraryEntryEnabled(state, entry),
  )
}

/** 设置条目启用状态 */
export function setAffixLibraryEntryEnabled(
  state: AffixLibraryState,
  entryId: string,
  enabled: boolean,
): AffixLibraryState {
  return {
    ...state,
    enabledOverride: { ...state.enabledOverride, [entryId]: enabled },
  }
}

export function addCustomAffixLibraryEntry(
  state: AffixLibraryState,
  entry: Omit<AffixLibraryEntry, 'id'>,
): AffixLibraryState {
  let maxIndex = 0
  for (const item of state.customEntries) {
    const match = /^custom:(\d+)$/.exec(item.id)
    if (match) maxIndex = Math.max(maxIndex, Number(match[1]))
  }
  const id = `custom:${maxIndex + 1}`
  return {
    ...state,
    customEntries: [...state.customEntries, { ...entry, id }],
  }
}

export function updateAffixLibraryEntry(
  state: AffixLibraryState,
  entryId: string,
  patch: Partial<
    Pick<
      AffixLibraryEntry,
      | 'label'
      | 'perRoll'
      | 'cap'
      | 'group'
      | 'target'
      | 'applySituation'
      | 'scope'
      | 'skillCategory'
      | 'skillSubcategoryId'
      | 'appliesToAnomaly'
    >
  >,
): AffixLibraryState {
  const isCustom = state.customEntries.some((item) => item.id === entryId)
  if (isCustom) {
    return {
      ...state,
      customEntries: state.customEntries.map((item) =>
        item.id === entryId ? { ...item, ...patch } : item,
      ),
    }
  }
  return {
    ...state,
    overrides: {
      ...state.overrides,
      [entryId]: { ...(state.overrides[entryId] ?? {}), ...patch },
    },
  }
}

/**
 * 删除条目。
 *
 * - 自建条目：直接从 `customEntries` 移除。
 * - 默认条目：记进 `removedEntryIds`（它们是按需生成的，删不掉「原件」），
 *   同时清掉它的启用/覆盖记录，避免恢复时带着旧改值。
 */
export function removeAffixLibraryEntry(
  state: AffixLibraryState,
  entryId: string,
): AffixLibraryState {
  const { [entryId]: _removedEnabled, ...restEnabled } = state.enabledOverride
  const { [entryId]: _removedOverride, ...restOverrides } = state.overrides
  const isCustom = state.customEntries.some((item) => item.id === entryId)
  if (isCustom) {
    return {
      ...state,
      customEntries: state.customEntries.filter((item) => item.id !== entryId),
      enabledOverride: restEnabled,
    }
  }
  return {
    ...state,
    enabledOverride: restEnabled,
    overrides: restOverrides,
    removedEntryIds: state.removedEntryIds.includes(entryId)
      ? state.removedEntryIds
      : [...state.removedEntryIds, entryId],
  }
}

/**
 * 恢复默认：连带清掉「删过谁」，被删的条目一并回来。
 *
 * **起点必须显式传**（不给缺省值）：空配置的库回到「什么都没有」，独立库回到
 * 「按**当前**官方预设重新复制一份」（因此同样要求官方那份已在手，见
 * `createDefaultAffixLibraryState`）。过渡态（`'follow'`）不作为恢复目标 —— 见
 * `AffixLibrarySetOrigin`。
 */
export function restoreAffixLibraryDefaults(origin: AffixLibrarySetOrigin): AffixLibraryState {
  return createAffixLibraryStateForOrigin(origin)
}

// ===================== 词条分组（组名 + 组额度） =====================

/** 取某组的额度；未登记的组名按「不限」算（静默加约束比不加更危险） */
export function affixGroupCap(state: AffixLibraryState, name: string): number {
  const group = state.groups.find((item) => item.name === name)
  return group ? group.cap : AFFIX_GROUP_UNLIMITED
}

/** 组额度表（组名 → 额度），交给求解器用 */
export function affixGroupCaps(state: AffixLibraryState): Record<string, number> {
  const caps: Record<string, number> = {}
  for (const group of state.groups) caps[group.name] = group.cap
  return caps
}

/**
 * 这些组**实际**用掉的基础档 = 组内各条档数之和（每档的基础占用恒为 1，与 `rollCost` 无关）。
 *
 * 用途：结果面板的「词条数拆账」——告诉用户「主属性 / 2 件套 选了 N 档，但不占词条数」。
 * 求解侧的"不占数"由 `AffixOptimizerInput.freeRollGroups` 按预算口径直接处理（不需要"放宽再减回"）。
 */
export function affixExcludedGroupBaseRollsUsed(
  groups: AffixLibraryGroup[],
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): number {
  const excluded = new Set(groups.filter((group) => group.excludedFromTotalRolls).map((group) => group.name))
  if (!excluded.size) return 0
  let used = 0
  for (const entry of entries) {
    if (!excluded.has(entry.group)) continue
    used += Math.max(0, Math.round(rollsByEntryId[entry.id] ?? 0))
  }
  return used
}

/** 该组名是否已被占用（新建 / 改名时查重） */
export function hasAffixLibraryGroup(state: AffixLibraryState, name: string): boolean {
  return state.groups.some((item) => item.name === name)
}

/** 该组名是不是预设组 */
function isPresetGroupName(name: string): boolean {
  return presetAffixGroupsBase().some((group) => group.name === name)
}

/** 新建一组；名字空 / 重名则原样返回（调用方负责提示） */
export function addAffixLibraryGroup(
  state: AffixLibraryState,
  name: string,
  cap: number = DEFAULT_AFFIX_GROUP_CAP,
): AffixLibraryState {
  const trimmed = name.trim()
  if (!trimmed || hasAffixLibraryGroup(state, trimmed)) return state
  return {
    ...state,
    groups: [...state.groups, { name: trimmed, cap: coerceGroupCap(cap) }],
    // 建回一个被删过的预设组名 → 撤销「删过」的记录，否则下次读盘又会被滤掉
    removedGroupNames: state.removedGroupNames.filter((item) => item !== trimmed),
  }
}

/** 改组额度（`0` = 不限） */
export function setAffixLibraryGroupCap(
  state: AffixLibraryState,
  name: string,
  cap: number,
): AffixLibraryState {
  const safeCap = coerceGroupCap(cap)
  return {
    ...state,
    groups: state.groups.map((group) =>
      group.name === name ? { ...group, cap: safeCap } : group,
    ),
  }
}

/**
 * 开关某组的「不消耗总词条数」规则（组管理里的那个 chip）。
 *
 * 语义见 `AffixLibraryGroup.excludedFromTotalRolls`：组内条目的基础占用不算进总词条数，
 * 冲突额外 x 照算。**普通「求最优分配」与游戏专用都吃这条规则**（求解器按 `freeRollGroups` 处理）。
 * 关掉时把字段整个删掉（不留 `false`），存档干净、也不会被 `coerce` 当垃圾字段。
 */
export function setAffixLibraryGroupExcluded(
  state: AffixLibraryState,
  name: string,
  excluded: boolean,
): AffixLibraryState {
  return {
    ...state,
    groups: state.groups.map((group) => {
      if (group.name !== name) return group
      if (!excluded) {
        const { excludedFromTotalRolls: _drop, ...rest } = group
        return rest
      }
      return { ...group, excludedFromTotalRolls: true }
    }),
  }
}

/**
 * 把「某个组」里所有条目的**单词条上限**统一设成同一个值（0 = 不限）。
 *
 * 与 `setAffixLibraryGroupCap` 的区别（两层约束，别混）：
 * - 本函数改**每条各自的 `cap`**：这一条最多能投几档；
 * - `setAffixLibraryGroupCap` 改**组额度**：组内各条档数之和的上限。
 *
 * `groupName === ''` 表示「未分组」那批条目（与弹窗页签口径一致）。
 * 自建条目改本体、预设条目记进 `overrides` —— 与 `updateAffixLibraryEntry` 同一套写法，
 * 所以整批改完只产生**一个**新 state，页面一次落盘、一次重算。
 */
export function setAffixLibraryGroupEntryCaps(
  state: AffixLibraryState,
  groupName: string,
  cap: number,
): AffixLibraryState {
  const nextCap = Number.isFinite(cap) ? Math.max(0, Math.round(cap)) : 0
  const members = resolveAffixLibrary(state).filter((entry) => (entry.group ?? '') === groupName)
  let next = state
  for (const entry of members) next = updateAffixLibraryEntry(next, entry.id, { cap: nextCap })
  return next
}

/**
 * 把**预设条目**的组名从 `from` 改写成 `to`（写成条目级 override）。
 *
 * 为什么必需：预设条目每次读盘都按内置 `group` 重建。只改 `groups` 表与已有
 * override 的话，那些「没被用户改过、但组名挂在被删/被改名组上」的预设条目
 * 依然引用旧组名，读盘时会被兜底补回来 —— 删组等于没删、改名变成多出一个组。
 */
function retargetPresetEntryGroups(
  state: AffixLibraryState,
  from: string,
  to: string,
): AffixLibraryState['overrides'] {
  const next = { ...state.overrides }
  for (const entry of presetAffixEntriesBase()) {
    const effective = state.overrides[entry.id]?.group ?? entry.group
    if (effective !== from) continue
    next[entry.id] = { ...state.overrides[entry.id], group: to }
  }
  return next
}

/**
 * 改组名，并**同步所有引用它的条目**（自建条目 + 默认条目的覆盖值）。
 *
 * 不同步的话，条目会指向一个不存在的组名 —— 读回来时会被兜底补成一个新组，
 * 于是「改个名」变成「多出一个组」，两条互相不约束。
 */
export function renameAffixLibraryGroup(
  state: AffixLibraryState,
  from: string,
  to: string,
): AffixLibraryState {
  const trimmed = to.trim()
  if (!trimmed || trimmed === from) return state
  if (hasAffixLibraryGroup(state, trimmed)) return state
  const patchGroup = <T extends { group: string }>(item: T): T =>
    item.group === from ? { ...item, group: trimmed } : item
  const patchedOverrides = Object.fromEntries(
    Object.entries(state.overrides).map(([id, patch]) => [
      id,
      patch.group === from ? { ...patch, group: trimmed } : patch,
    ]),
  )
  return {
    ...state,
    groups: state.groups.map((group) =>
      group.name === from ? { ...group, name: trimmed } : group,
    ),
    customEntries: state.customEntries.map(patchGroup),
    overrides: retargetPresetEntryGroups({ ...state, overrides: patchedOverrides }, from, trimmed),
    // 改掉一个预设组的名字 → 记下原名，否则下次读盘它又会被补回来
    removedGroupNames: mergeRemovedGroupName(state.removedGroupNames, from, trimmed),
  }
}

/** 记「删过 / 改名走了」的预设组名；新名字若曾是预设组名则撤销那条记录 */
function mergeRemovedGroupName(
  removedNames: string[],
  from: string,
  to: string,
): string[] {
  let next = removedNames.filter((item) => item !== to)
  if (isPresetGroupName(from) && !next.includes(from)) next = [...next, from]
  return next
}

/**
 * 删除一组：**只删组，条目留下**（用户 2026-09-12 口径）。
 *
 * 组内条目的组名一起清空，它们变回自由条目 —— 不替用户删条目，也不把它们塞进别的组。
 */
export function removeAffixLibraryGroup(
  state: AffixLibraryState,
  name: string,
): AffixLibraryState {
  const clearGroup = <T extends { group: string }>(item: T): T =>
    item.group === name ? { ...item, group: '' } : item
  const removedGroupNames =
    isPresetGroupName(name) && !state.removedGroupNames.includes(name)
      ? [...state.removedGroupNames, name]
      : state.removedGroupNames
  const patchedOverrides = Object.fromEntries(
    Object.entries(state.overrides).map(([id, patch]) => [
      id,
      patch.group === name ? { ...patch, group: '' } : patch,
    ]),
  )
  return {
    ...state,
    groups: state.groups.filter((group) => group.name !== name),
    customEntries: state.customEntries.map(clearGroup),
    // 预设条目也要一并落成「未分组」的覆盖值，否则它们还引用着被删的组名
    overrides: retargetPresetEntryGroups({ ...state, overrides: patchedOverrides }, name, ''),
    removedGroupNames,
  }
}

export interface AffixEntryEvalInput {
  /**
   * 导入十格计数桶。分析侧不再往这里写：局外 `panel:` 都进 `deltas`。
   * 柱图扫掠等仍可单独传入 `AffixCounts`。
   */
  counts: Partial<AffixCounts>
  /** 分析侧局外增量（`panel:`；不含 `gain:`） */
  deltas: AffixDeltaMap
  /**
   * 各 `gain:` 目标合成的 extraGains（不进局外增量表）。
   */
  extraGains: ExtraBuffGain[]
  /**
   * 十格「每档值」表。分析侧恒为常量表（每档已折进 `deltas`）；
   * 柱图等仍按十格 × 本表折算。
   */
  valuePerCount: Record<keyof AffixCounts, number>
}

/**
 * 档数表 → 求解器可直接使用的 `(counts, deltas, valuePerCount)`。
 *
 * ## 同字段多条：**各按自己的每档算**（2026-09-12 修）
 *
 * 早期实现把档数合并进同一个桶、每档值按字段存一份，于是「同字段多条」时
 * **后一条的每档值会顶掉前一条**：
 *
 * ```
 * 副词条 攻击% 6 档 × 3%  +  5号位 攻击% 1 档 × 30%
 *   旧：7 档 × 30% = 210 个百分点   ← 错 4 倍（实测）
 *   新：6×3% + 1×30% = 48 个百分点  ✓
 * ```
 *
 * 修法：条目自己的 `perRoll` 在这里就折成局外增量（`档数 × 每档`），
 * `valuePerCount` 因此恒为常量表。4/5/6 号位主属性（30%/档）与副词条（3%/档）
 * 指向同一字段也不会互相污染。
 */
export function entryRollsToEvalInput(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): AffixEntryEvalInput {
  const counts: Partial<AffixCounts> = {}
  const deltas: AffixDeltaMap = {}
  const extraGains: ExtraBuffGain[] = []
  /** 折算基准，恒为常量表：条目自己的每档值已在下面折进 deltas */
  const valuePerCount: Record<keyof AffixCounts, number> = { ...AFFIX_VALUE_PER_COUNT }

  for (const entry of entries) {
    const rolls = rollsByEntryId[entry.id] ?? 0
    const statKey = statKeyOfTarget(entry.target)
    if (statKey) {
      if (rolls > 0) {
        deltas[statKey] = (deltas[statKey] ?? 0) + rolls * entry.perRoll
      }
      continue
    }
    const panelField = panelFieldOfTarget(entry.target)
    if (panelField) {
      if (rolls <= 0) continue
      deltas[panelField] = (deltas[panelField] ?? 0) + rolls * entry.perRoll
      continue
    }
    const gain = extraGainFromLibraryEntry(entry, rolls)
    if (gain) extraGains.push(gain)
  }

  return { counts, deltas, extraGains, valuePerCount }
}

/**
 * 把「N 档 × 自己的每档值」折成**相对常量表的等效档数**。
 *
 * 引擎按 `档数 × 常量表` 折算百分点，因此等效档数 = `N × perRoll / 常量表值`。
 * 每档值与常量表相同时等价于原来的 `N`（既有默认库行为完全不变）。
 */
export function affixRollsToEquivalentRolls(
  entry: AffixLibraryEntry,
  statKey: keyof AffixCounts,
  rolls: number,
): number {
  const base = AFFIX_VALUE_PER_COUNT[statKey]
  if (!Number.isFinite(base) || base <= 0) return rolls
  if (!Number.isFinite(entry.perRoll) || entry.perRoll <= 0) return rolls
  return rolls * (entry.perRoll / base)
}

/**
 * 每档值表。
 *
 * **恒为常量表**（2026-09-12 起）：条目各自的每档值已由 `entryRollsToEvalInput`
 * 折进局外增量，这里再按字段覆盖一次就会让同字段多条互相顶掉。
 * 保留该函数是为了不动调用方签名 —— 「用户改每档要生效」现在由局外增量承担
 * （改每档 → deltas 变 → 缓存键里的 panelDeltas 变 → 结果随之变）。
 */
export function affixValuePerCountFromEntries(
  entries: AffixLibraryEntry[],
): Record<keyof AffixCounts, number> {
  void entries
  return { ...AFFIX_VALUE_PER_COUNT }
}

/**
 * 条目贡献里**按基础值乘算**的字段清单（其余字段都是平铺加值）。
 *
 * 口径与最终面板合成一致：见 `affixPanelCalc.ts` 里 `anomalyControl` / `energyRegen` 的
 * `基础 × (1 + Σ%)` 写法。冲击力**不在**此列 —— 仓库没有「基础冲击力」数据，
 * 它按点加（同文件 `impact: mainStats.impact`）。
 *
 * 新增字段时只改这里：`AffixPanelDeltaBases` 会跟着要求调用方补基础值，漏传由类型检查拦住。
 */
export const AFFIX_PANEL_PERCENT_OF_BASE_FIELDS = ['anomalyControl', 'energyRegen'] as const

export type AffixPanelPercentOfBaseField = (typeof AFFIX_PANEL_PERCENT_OF_BASE_FIELDS)[number]

/** 按基础值乘算的字段各自需要的**基础值**（角色基础面板口径） */
export type AffixPanelDeltaBases = Record<AffixPanelPercentOfBaseField, number> & {
  /** 分析侧 `panel:hpPercent` 折算用；省略当 0 */
  hp?: number
  /** 分析侧 `panel:atkPercent` 折算用；省略当 0 */
  atk?: number
  /** 分析侧 `panel:defPercent` 折算用；省略当 0 */
  def?: number
}

function isPercentOfBaseField(
  key: AffixPanelDeltaField,
): key is AffixPanelPercentOfBaseField {
  return (AFFIX_PANEL_PERCENT_OF_BASE_FIELDS as readonly string[]).includes(key)
}

/**
 * 把条目贡献叠加到局外面板副本上（不改原对象）。
 *
 * **折算口径由字段决定，不由条目决定**（用户 2026-09-12 裁定：词条只表达
 * 「给哪个属性加多少」，怎么折算、是否进入转模都是下游的事）：
 * - 乘算字段（`AFFIX_PANEL_PERCENT_OF_BASE_FIELDS`）：落 `基础 × 值 / 100`，与主属性同口径；
 * - 分析侧原十格字段（`panel:atkPercent` 等）：叠在已有局外上，百分比按角色+音擎基础；
 * - 其余面板字段：平铺加到面板值上。
 */
export function applyPanelDeltas(
  panel: PanelStats,
  deltas: AffixDeltaMap,
  bases: AffixPanelDeltaBases,
): PanelStats {
  const panelKeys = (Object.keys(deltas) as string[]).filter(isPanelDeltaField)
  const hasStatOverlay = AFFIX_STAT_KEYS.some((key) => {
    if (key === 'mastery') return false
    return Boolean(deltas[key])
  })
  if (!panelKeys.length && !hasStatOverlay) return panel
  const next = { ...panel }
  for (const key of panelKeys) {
    const delta = deltas[key]
    if (!delta) continue
    if (isPercentOfBaseField(key)) {
      next[key] = (next[key] ?? 0) + (bases[key] * delta) / 100
      continue
    }
    next[key] = (next[key] ?? 0) + delta
  }
  const hpPercent = Number(deltas.hpPercent) || 0
  const atkPercent = Number(deltas.atkPercent) || 0
  const defPercent = Number(deltas.defPercent) || 0
  const hpFlat = Number(deltas.hpFlat) || 0
  const atkFlat = Number(deltas.atkFlat) || 0
  const defFlat = Number(deltas.defFlat) || 0
  const critRate = Number(deltas.critRate) || 0
  const critDmg = Number(deltas.critDmg) || 0
  const pen = Number(deltas.pen) || 0
  if (hpPercent || hpFlat) {
    next.hp = next.hp + ((bases.hp ?? 0) * hpPercent) / 100 + hpFlat
  }
  if (atkPercent || atkFlat) {
    next.atk = next.atk + ((bases.atk ?? 0) * atkPercent) / 100 + atkFlat
  }
  if (defPercent || defFlat) {
    next.def = next.def + ((bases.def ?? 0) * defPercent) / 100 + defFlat
  }
  if (critRate) next.critRate = next.critRate + critRate
  if (critDmg) next.critDmg = next.critDmg + critDmg
  if (pen) next.pen = next.pen + pen
  return next
}

/** 校验单条自建条目是否合法，返回错误文案（null = 合法） */
export function validateAffixLibraryEntry(
  entry: Pick<AffixLibraryEntry, 'label' | 'target' | 'perRoll'>,
): string | null {
  if (!entry.label.trim()) return '请填写词条名称'
  if (!isAffixLibraryEntryTarget(entry.target)) return '请选择词条目标'
  if (!Number.isFinite(entry.perRoll) || entry.perRoll <= 0) return '每档数值须为正数'
  return null
}

// ===================== 导出 / 导入 =====================

export const AFFIX_LIBRARY_EXPORT_TYPE = 'zzz-hp-affix-library'
export const AFFIX_LIBRARY_EXPORT_VERSION = 1

export interface AffixLibraryExport {
  type: string
  version: number
  exportedAt: number
  name: string
  state: AffixLibraryState
}

/** 导出一套（缺省当前激活那套）为文件内容 */
export function exportAffixLibrarySet(store: AffixLibraryStore, setId?: string): string {
  const target =
    (setId ? store.sets.find((set) => set.id === setId) : null) ?? activeAffixLibrarySet(store)
  const payload: AffixLibraryExport = {
    type: AFFIX_LIBRARY_EXPORT_TYPE,
    version: AFFIX_LIBRARY_EXPORT_VERSION,
    exportedAt: Date.now(),
    name: target.name,
    state: target.state,
  }
  return JSON.stringify(payload, null, 2)
}

export interface AffixLibraryImportResult {
  /** 导入后的存档；失败时原样返回入参，调用方直接赋回即可 */
  store: AffixLibraryStore
  /** 实际生效的库名 */
  name: string
  error: string | null
}

/**
 * 导入一套词条库。
 *
 * - `'replace'`：覆盖激活的那套（名字取文件里的；文件没写名字就沿用原名字）
 * - `'new'`：作为新的一套加进来并切过去
 *
 * 也接受「没有外层包装、顶层直接是 `customEntries`」的文件。
 */
export function importAffixLibrarySet(
  store: AffixLibraryStore,
  json: string,
  mode: 'replace' | 'new',
): AffixLibraryImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { store, name: '', error: 'JSON 解析失败，请检查文件格式' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { store, name: '', error: '文件内容不是词条库对象' }
  }

  const obj = parsed as Record<string, unknown>
  let rawState: unknown = null
  let rawName = ''
  if (obj.state && typeof obj.state === 'object' && !Array.isArray(obj.state)) {
    rawState = obj.state
    rawName = typeof obj.name === 'string' ? obj.name : ''
  } else if (Array.isArray(obj.customEntries)) {
    rawState = obj
  }
  if (!rawState) {
    return { store, name: '', error: '文件里没有词条库内容' }
  }

  const state = coerceAffixLibraryState(rawState)
  if (mode === 'replace') {
    const target = activeAffixLibrarySet(store)
    const name = normalizeAffixLibrarySetName(rawName, target.name)
    const next: AffixLibraryStore = {
      ...store,
      sets: store.sets.map((set) =>
        set.id === target.id ? { ...set, name, state, updatedAt: Date.now() } : set,
      ),
    }
    writeAffixLibraryStore(next)
    return { store: next, name, error: null }
  }

  const current = activeAffixLibrarySet(store)
  const next = createAffixLibrarySet(store, rawName || `${current.name} 副本`, state)
  return { store: next, name: activeAffixLibrarySet(next).name, error: null }
}
