import type { AffixCounts, PanelStats } from '@/types/calculatorPanel'
import { AFFIX_VALUE_PER_COUNT } from '@/utils/affixPanelCalc'

/**
 * 词条库（Affix Library）
 *
 * 把「参与收益分析与最优分配的词条」从写死的候选表改成一张可增删改的候选池。
 *
 * ## 条目目标（`target`）：单一命名空间，前缀区分
 *
 * - `stat:<AffixCounts 字段>`：落到词条计数桶，**经基础值换算**成面板值。
 *   语义是「基础攻击/生命/防御的百分比」或「直接加在面板上的固定值」，
 *   每档数值由 `AFFIX_VALUE_PER_COUNT`（默认）与该条目的 `perRoll`（覆盖）决定。
 * - `panel:<局外面板字段>`：直接叠加到**局外面板**（增伤、穿透率、减防、主词条数值等）。
 *
 * 历史沿革：早期按 `kind: 'substat' | 'panelField'` 分成两种条目类型，两条路对
 * 「每档值从哪来」给了不同答案 —— 副词条读写死的常量表、面板字段读条目字段。
 * 结果是「界面把每档改成 4%，伤害却按常量 2.4% 算」。现在合并为单一 `target`，
 * **每档值一律以条目自己的 `perRoll` 为准**，两条路的差别只剩「落点」不同。
 *
 * 为什么不把 `stat:` 也改走面板增量（更「彻底」的统一）：`stat:atkPercent` 的语义是
 * 「**基础攻击**的百分比」（`atk = atkBase × (1 + atkPercent/100) + …`），而面板增量是
 * 「叠加到**最终面板值**」。两者量纲不同，强行统一要么丢掉「按基础值乘算」的语义
 * （改变伤害数值），要么让增量也带「作用基准」信息 —— 那只是把分类挪了个地方。
 *
 * ## 预算模型（独立功能，不复用「词条计算」页的双预算规则）
 *
 * - `rollCost`：占用「总词条数」预算，每条词条 1 档 = 1 个词条。
 * - `group`：互斥组，同组至多选 1 个条目（主词条、套装等）。
 * - `cap`：单条最大档数，0 表示不限。
 *
 * ## id 命名
 *
 * 默认条目的 id 沿用历史前缀（`substat:atkPercent` / `panel:dmgBonus`），**故意不改**：
 * 用户已存的 `enabledOverride` 与 `overrides` 都是按 id 索引的，改 id 会让这些记录全部失配。
 * 因此 id 前缀与 `target` 前缀不要求一致（`substat:x` 对应 `target: 'stat:x'`）。
 */

/** 条目落点：`stat:` = 词条计数桶；`panel:` = 局外面板增量 */
export type AffixStatTarget = `stat:${keyof AffixCounts}`
export type AffixPanelTarget = `panel:${AffixPanelDeltaField}`
export type AffixLibraryEntryTarget = AffixStatTarget | AffixPanelTarget

/** 可叠加到局外面板的百分比/加值字段 */
export type AffixPanelDeltaField =
  | 'dmgBonus'
  | 'penRate'
  | 'reduceDefense'
  | 'ignoreDefense'
  | 'resPen'
  | 'mastery'
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

export const AFFIX_PANEL_DELTA_FIELD_LABELS: Record<AffixPanelDeltaField, string> = {
  dmgBonus: '增伤%',
  penRate: '穿透率%',
  reduceDefense: '减防%',
  ignoreDefense: '无视防御%',
  resPen: '抗性穿透%',
  mastery: '异常精通',
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

/** `stat:` 目标里按「百分比」理解的字段（其余为固定值） */
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

export function statTarget(key: keyof AffixCounts): AffixStatTarget {
  return `stat:${key}`
}

export function panelTarget(field: AffixPanelDeltaField): AffixPanelTarget {
  return `panel:${field}`
}

export function isStatTarget(target: string): target is AffixStatTarget {
  return target.startsWith('stat:')
}

export function isPanelTarget(target: string): target is AffixPanelTarget {
  return target.startsWith('panel:')
}

/** `stat:` → 词条计数字段；不是该命名空间或字段非法时返回 null */
export function statKeyOfTarget(target: AffixLibraryEntryTarget): keyof AffixCounts | null {
  if (!isStatTarget(target)) return null
  const key = target.slice('stat:'.length) as keyof AffixCounts
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

/** 校验一个字符串是不是合法的条目目标 */
export function isAffixLibraryEntryTarget(value: unknown): value is AffixLibraryEntryTarget {
  if (typeof value !== 'string') return false
  if (isStatTarget(value)) return AFFIX_STAT_KEYS.includes(value.slice(5) as keyof AffixCounts)
  if (isPanelTarget(value)) {
    return AFFIX_PANEL_DELTA_FIELDS.includes(value.slice(6) as AffixPanelDeltaField)
  }
  return false
}

export interface AffixLibraryEntry {
  /** 稳定 id（默认条目沿用历史前缀，见文件头说明） */
  id: string
  /** 显示名 */
  label: string
  /** 落点：`stat:` 计数桶 / `panel:` 局外面板增量 */
  target: AffixLibraryEntryTarget
  /** 每档增量（与目标字段同单位：百分比字段为百分点，固定值字段为绝对值） */
  perRoll: number
  /** 配平最大档数；0 表示不设上限 */
  cap: number
  /** 互斥组标签；同组至多选 1 个条目。'' 表示自由条目 */
  group: string
  /** 每档占用「总词条数」预算（独立功能口径：每条词条 1 档 = 1 个词条） */
  rollCost: number
  /** 是否默认参与分析 */
  enabledByDefault: boolean
}

/** 每档值的单位：百分比字段显示 `3%`，固定值字段显示 `9` */
export type AffixPerRollUnit = 'percent' | 'flat'

export function affixPerRollUnit(target: AffixLibraryEntryTarget): AffixPerRollUnit {
  const statKey = statKeyOfTarget(target)
  if (statKey) return PERCENT_STAT_KEYS.has(statKey) ? 'percent' : 'flat'
  const field = panelFieldOfTarget(target)
  if (field) return PERCENT_PANEL_FIELDS.has(field) ? 'percent' : 'flat'
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
    target: statTarget(affixKey),
    label: AFFIX_SUBSTAT_KEY_LABELS[affixKey],
    perRoll: AFFIX_VALUE_PER_COUNT[affixKey],
    cap: 0,
    group: '',
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
 * 可选扩展条目：代表 4/5/6 主词条或 Buff 来源，默认不启用。
 *
 * 与副词条的区别只剩「落点」与默认值：
 * - `cap: 1` —— 主词条/来源最多取一次（副词条可叠，见 createDefaultAffixLibrary）；
 * - `group` 默认空 —— 需要互斥时由用户在词条库里填同组名。
 */
export function createOptionalAffixLibraryEntries(): AffixLibraryEntry[] {
  const specs: { field: AffixPanelDeltaField; perRoll: number }[] = [
    { field: 'dmgBonus', perRoll: 30 },
    { field: 'penRate', perRoll: 24 },
    { field: 'reduceDefense', perRoll: 30 },
    { field: 'ignoreDefense', perRoll: 30 },
    { field: 'resPen', perRoll: 24 },
    { field: 'anomalyDmgBonus', perRoll: 30 },
    { field: 'anomalyCritRate', perRoll: 24 },
    { field: 'anomalyCritDmg', perRoll: 48 },
    { field: 'anomalyReleaseDmgBonus', perRoll: 30 },
    { field: 'disorderDmgBonus', perRoll: 30 },
    { field: 'turbulenceDmgBonus', perRoll: 30 },
    { field: 'radianceDmgBonus', perRoll: 30 },
    { field: 'radianceResPen', perRoll: 24 },
    { field: 'specialMult', perRoll: 30 },
  ]
  return specs.map((spec) => ({
    id: `panel:${spec.field}`,
    target: panelTarget(spec.field),
    label: AFFIX_PANEL_DELTA_FIELD_LABELS[spec.field],
    perRoll: spec.perRoll,
    cap: 1,
    group: '',
    rollCost: 1,
    enabledByDefault: false,
  }))
}

export interface AffixLibraryState {
  /** 用户自建条目 */
  customEntries: AffixLibraryEntry[]
  /**
   * 条目 id → 显式启用/禁用。
   * 缺省时用条目自身的 `enabledByDefault`：内置副词条默认参与，
   * 扩展条目（主词条/Buff 来源）默认不参与。
   */
  enabledOverride: Record<string, boolean>
  /** 默认条目的覆盖值（用户改了名称/每档/上限/互斥组时记录） */
  overrides: Record<string, Partial<Pick<AffixLibraryEntry, 'label' | 'perRoll' | 'cap' | 'group'>>>
  /**
   * 被用户删掉的默认条目 id。
   *
   * 默认条目是「按需生成」的（`createDefaultAffixLibrary()` 每次现算），
   * 想删就得记住「删过谁」。用户口径是「预设兜底、用户随便改」，
   * 所以不设「不可删」标记：删了记在这里，「恢复默认」会清空。
   */
  removedEntryIds: string[]
}

export function createDefaultAffixLibraryState(): AffixLibraryState {
  return { customEntries: [], enabledOverride: {}, overrides: {}, removedEntryIds: [] }
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
  if (isAffixLibraryEntryTarget(item.target)) {
    target = item.target
  } else if (item.kind === 'substat' && typeof item.affixKey === 'string') {
    const candidate = `stat:${item.affixKey}`
    target = isAffixLibraryEntryTarget(candidate) ? candidate : null
  } else if (item.kind === 'panelField' && typeof item.panelField === 'string') {
    const candidate = `panel:${item.panelField}`
    target = isAffixLibraryEntryTarget(candidate) ? candidate : null
  }
  if (!target) return null

  const label = typeof item.label === 'string' ? item.label : ''
  const perRoll = Number(item.perRoll)
  if (!label.trim() || !Number.isFinite(perRoll)) return null

  return {
    id,
    label,
    target,
    perRoll,
    cap: Number.isFinite(Number(item.cap)) ? Number(item.cap) : 0,
    group: typeof item.group === 'string' ? item.group : '',
    rollCost: Number.isFinite(Number(item.rollCost)) ? Number(item.rollCost) : 1,
    enabledByDefault: item.enabledByDefault !== false,
  }
}

export function loadAffixLibraryState(): AffixLibraryState {
  try {
    const raw = localStorage.getItem(AFFIX_LIBRARY_STORAGE_KEY)
    if (!raw) return createDefaultAffixLibraryState()
    const parsed = JSON.parse(raw) as Partial<AffixLibraryState>
    const customEntries = Array.isArray(parsed.customEntries)
      ? parsed.customEntries
          .map(migrateCustomEntry)
          .filter((entry): entry is AffixLibraryEntry => entry !== null)
      : []
    return {
      customEntries,
      enabledOverride:
        parsed.enabledOverride && typeof parsed.enabledOverride === 'object'
          ? parsed.enabledOverride
          : {},
      overrides:
        parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
      removedEntryIds: Array.isArray(parsed.removedEntryIds)
        ? parsed.removedEntryIds.filter((id): id is string => typeof id === 'string')
        : [],
    }
  } catch {
    // 存档损坏或隐私模式：回落默认库，不影响计算
    return createDefaultAffixLibraryState()
  }
}

export function saveAffixLibraryState(state: AffixLibraryState): void {
  try {
    localStorage.setItem(AFFIX_LIBRARY_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 配额满/隐私模式：静默忽略
  }
}

/** 全部默认条目（副词条 + 可选扩展），已应用用户覆盖值 */
function presetEntriesWithOverrides(state: AffixLibraryState): AffixLibraryEntry[] {
  return [...createDefaultAffixLibrary(), ...createOptionalAffixLibraryEntries()].map((entry) => {
    const override = state.overrides[entry.id]
    return override ? { ...entry, ...override } : entry
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
  patch: Partial<Pick<AffixLibraryEntry, 'label' | 'perRoll' | 'cap' | 'group'>>,
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

/** 恢复默认：连带清掉「删过谁」，被删的默认条目一并回来 */
export function restoreAffixLibraryDefaults(): AffixLibraryState {
  return createDefaultAffixLibraryState()
}

export interface AffixEntryEvalInput {
  /** 各 `stat:` 目标的档数合计 */
  counts: Partial<AffixCounts>
  /** 各 `panel:` 目标的增量合计 */
  deltas: AffixPanelDeltaDraft
  /**
   * 各词条计数字段的「每档值」。
   *
   * 这是本次合并的核心：**每档值以条目为准**，而不是全局常量表。
   * 未被子条目覆盖的字段回落 `AFFIX_VALUE_PER_COUNT`（保证柱图等既有调用点行为不变）。
   */
  valuePerCount: Record<keyof AffixCounts, number>
}

/**
 * 档数表 → 求解器可直接使用的 `(counts, deltas, valuePerCount)`。
 *
 * `valuePerCount` 由**全部条目**算出（与档数无关）：某个 `stat:` 字段的每档值
 * 由指向它的条目决定，即便这次该条目档数为 0 —— 因为 `counts` 里可能还有
 * 来自基线（页面已填词条数）的档数，它们同样按该字段的每档值换算。
 *
 * 同字段多条目的边界：档数会合并进同一个桶，而每档值只能有一个，
 * 因此**列表中靠后的条目生效**（`resolveAffixLibraryAll()` 的顺序：
 * 默认条目在前、自建条目在后）。这是合并模型的固有取舍，已在词条库界面提示。
 */
export function entryRollsToEvalInput(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): AffixEntryEvalInput {
  const counts: Partial<AffixCounts> = {}
  const deltas: AffixPanelDeltaDraft = {}
  const valuePerCount: Record<keyof AffixCounts, number> = { ...AFFIX_VALUE_PER_COUNT }

  for (const entry of entries) {
    const statKey = statKeyOfTarget(entry.target)
    if (statKey) {
      if (Number.isFinite(entry.perRoll) && entry.perRoll > 0) {
        valuePerCount[statKey] = entry.perRoll
      }
      const rolls = rollsByEntryId[entry.id] ?? 0
      if (rolls > 0) counts[statKey] = (counts[statKey] ?? 0) + rolls
      continue
    }
    const field = panelFieldOfTarget(entry.target)
    if (!field) continue
    const rolls = rollsByEntryId[entry.id] ?? 0
    if (rolls <= 0) continue
    deltas[field] = (deltas[field] ?? 0) + rolls * entry.perRoll
  }

  return { counts, deltas, valuePerCount }
}

/** 只要每档值表（调用方自己管档数时用，例如收益曲线的逐档累加） */
export function affixValuePerCountFromEntries(
  entries: AffixLibraryEntry[],
): Record<keyof AffixCounts, number> {
  const valuePerCount: Record<keyof AffixCounts, number> = { ...AFFIX_VALUE_PER_COUNT }
  for (const entry of entries) {
    const statKey = statKeyOfTarget(entry.target)
    if (!statKey) continue
    if (Number.isFinite(entry.perRoll) && entry.perRoll > 0) {
      valuePerCount[statKey] = entry.perRoll
    }
  }
  return valuePerCount
}

/** 把面板增量叠加到局外面板副本上（不改原对象） */
export function applyPanelDeltas(panel: PanelStats, deltas: AffixPanelDeltaDraft): PanelStats {
  const keys = Object.keys(deltas) as AffixPanelDeltaField[]
  if (!keys.length) return panel
  const next = { ...panel }
  for (const key of keys) {
    const delta = deltas[key]
    if (!delta) continue
    next[key] = (next[key] ?? 0) + delta
  }
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
