import type { AffixCounts, PanelStats } from '@/types/calculatorPanel'
import { AFFIX_VALUE_PER_COUNT } from '@/utils/affixPanelCalc'

/**
 * 词条库（Affix Library）
 *
 * 把「参与收益分析与最优分配的词条」从写死的直伤/异常两套候选
 * （optimalAffixAlloc.ts 的 directCandidateKeys / anomalyCandidateKeys）
 * 改成一张可增删改的候选池。
 *
 * 条目类型：
 * - `substat`：驱动盘副词条，映射到 AffixCounts 的一个字段。
 * - `panelField`：直接叠加到局外面板某个字段（增伤、穿透率、减防、
 *   主词条数值等）。
 *
 * 预算模型（独立功能，不复用「词条计算」页的双预算规则）：
 * - `rollCost`：占用「总词条数」预算，每条词条 1 档 = 1 个词条。
 * - `group`：互斥组，同组至多选 1 个条目（主词条、套装等）。
 * - `cap`：单条最大档数，0 表示不限。
 */

export type AffixLibraryEntryKind = 'substat' | 'panelField'

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

export interface AffixLibraryEntry {
  /** 稳定 id */
  id: string
  /** 显示名 */
  label: string
  kind: AffixLibraryEntryKind
  /** kind === 'substat' 时必填 */
  affixKey?: keyof AffixCounts
  /** kind === 'panelField' 时必填 */
  panelField?: AffixPanelDeltaField
  /** 每档增量（百分点或绝对值，与所属字段同单位） */
  perRoll: number
  /** 配平最大档数；0 表示不设上限 */
  cap: number
  /** 互斥组标签；同组至多选 1 个条目。'' 表示自由条目 */
  group: string
  /** 每档占用「总词条数」预算（独立功能口径：每条词条 1 档 = 1 个词条） */
  rollCost: number
  /** 是否默认参与分析 */
  enabledByDefault: boolean
  /** 内置条目不可删除，只能禁用 */
  builtin: boolean
}

function substatEntry(affixKey: keyof AffixCounts): AffixLibraryEntry {
  return {
    id: `substat:${affixKey}`,
    kind: 'substat',
    affixKey,
    label: AFFIX_SUBSTAT_KEY_LABELS[affixKey],
    perRoll: AFFIX_VALUE_PER_COUNT[affixKey],
    cap: 0,
    group: '',
    // 独立功能口径：不分大小词条，每档一律占 1 个总词条数
    rollCost: 1,
    enabledByDefault: true,
    builtin: true,
  }
}

/** 默认词条库：10 条驱动盘副词条 */
export function createDefaultAffixLibrary(): AffixLibraryEntry[] {
  return (Object.keys(AFFIX_SUBSTAT_KEY_LABELS) as (keyof AffixCounts)[]).map(substatEntry)
}

/**
 * 可选扩展条目：代表 4/5/6 主词条或 Buff 来源，默认不启用。
 *
 * 与副词条的区别：
 * - `cap: 1` —— 主词条/来源最多取一次（副词条可叠，见 createDefaultAffixLibrary）；
 * - `group: 'mainStat'` —— 同为主词条候选，实际配装时互斥，默认同组。
 * 用户可在词条库里改上限与互斥组。
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
    kind: 'panelField' as const,
    panelField: spec.field,
    label: AFFIX_PANEL_DELTA_FIELD_LABELS[spec.field],
    perRoll: spec.perRoll,
    cap: 1,
    group: '',
    rollCost: 1,
    enabledByDefault: false,
    builtin: true,
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
  /** 内置条目的覆盖值（用户改了名称/每档/上限/互斥组时记录） */
  overrides: Record<string, Partial<Pick<AffixLibraryEntry, 'label' | 'perRoll' | 'cap' | 'group'>>>
}

export function createDefaultAffixLibraryState(): AffixLibraryState {
  return { customEntries: [], enabledOverride: {}, overrides: {} }
}

const AFFIX_LIBRARY_STORAGE_KEY = 'zzz-hp-affix-library'

export function loadAffixLibraryState(): AffixLibraryState {
  try {
    const raw = localStorage.getItem(AFFIX_LIBRARY_STORAGE_KEY)
    if (!raw) return createDefaultAffixLibraryState()
    const parsed = JSON.parse(raw) as Partial<AffixLibraryState>
    return {
      customEntries: Array.isArray(parsed.customEntries) ? parsed.customEntries : [],
      enabledOverride:
        parsed.enabledOverride && typeof parsed.enabledOverride === 'object'
          ? parsed.enabledOverride
          : {},
      overrides:
        parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
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

/** 全部内置条目（默认 + 可选扩展），已应用用户覆盖值 */
function builtinEntriesWithOverrides(state: AffixLibraryState): AffixLibraryEntry[] {
  return [...createDefaultAffixLibrary(), ...createOptionalAffixLibraryEntries()].map((entry) => {
    const override = state.overrides[entry.id]
    return override ? { ...entry, ...override } : entry
  })
}

/** 词条库全量（含未参与的条目），供编辑器展示 */
export function resolveAffixLibraryAll(state: AffixLibraryState): AffixLibraryEntry[] {
  const all = [...builtinEntriesWithOverrides(state), ...state.customEntries]
  const seen = new Set<string>()
  return all.filter((entry) => {
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
  entry: Omit<AffixLibraryEntry, 'id' | 'builtin'>,
): AffixLibraryState {
  let maxIndex = 0
  for (const item of state.customEntries) {
    const match = /^custom:(\d+)$/.exec(item.id)
    if (match) maxIndex = Math.max(maxIndex, Number(match[1]))
  }
  const id = `custom:${maxIndex + 1}`
  return {
    ...state,
    customEntries: [...state.customEntries, { ...entry, id, builtin: false }],
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

export function removeAffixLibraryEntry(
  state: AffixLibraryState,
  entryId: string,
): AffixLibraryState {
  const { [entryId]: _removed, ...restOverride } = state.enabledOverride
  return {
    ...state,
    customEntries: state.customEntries.filter((item) => item.id !== entryId),
    enabledOverride: restOverride,
  }
}

export function restoreAffixLibraryDefaults(): AffixLibraryState {
  return createDefaultAffixLibraryState()
}

/** 条目 → 档数表对应的副词条计数增量 */
export function entryRollsToAffixCounts(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): Partial<AffixCounts> {
  const counts: Partial<AffixCounts> = {}
  for (const entry of entries) {
    if (entry.kind !== 'substat' || !entry.affixKey) continue
    const rolls = rollsByEntryId[entry.id] ?? 0
    if (rolls === 0) continue
    counts[entry.affixKey] = (counts[entry.affixKey] ?? 0) + rolls
  }
  return counts
}

/** 条目 → 档数表对应的局外面板增量 */
export function entryRollsToPanelDeltas(
  entries: AffixLibraryEntry[],
  rollsByEntryId: Record<string, number>,
): Partial<Record<AffixPanelDeltaField, number>> {
  const deltas: Partial<Record<AffixPanelDeltaField, number>> = {}
  for (const entry of entries) {
    if (entry.kind !== 'panelField' || !entry.panelField) continue
    const rolls = rollsByEntryId[entry.id] ?? 0
    if (rolls === 0) continue
    deltas[entry.panelField] = (deltas[entry.panelField] ?? 0) + rolls * entry.perRoll
  }
  return deltas
}

/** 把面板增量叠加到局外面板副本上（不改原对象） */
export function applyPanelDeltas(
  panel: PanelStats,
  deltas: Partial<Record<AffixPanelDeltaField, number>>,
): PanelStats {
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

/** 校验单条自定义条目是否合法，返回错误文案（null = 合法） */
export function validateAffixLibraryEntry(
  entry: Pick<AffixLibraryEntry, 'label' | 'kind' | 'affixKey' | 'panelField' | 'perRoll'>,
): string | null {
  if (!entry.label.trim()) return '请填写词条名称'
  if (entry.kind === 'substat' && !entry.affixKey) return '请选择副词条字段'
  if (entry.kind === 'panelField' && !entry.panelField) return '请选择面板字段'
  if (!Number.isFinite(entry.perRoll) || entry.perRoll <= 0) return '每档数值须为正数'
  return null
}
