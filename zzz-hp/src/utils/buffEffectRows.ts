/**
 * 管理侧「效果行」聚合 / 重建（纯函数，可单测）。
 *
 * 数据层仍是 1 个子类 = 1 条效果：
 * - 同组（同 groupId）的 N 条 → 1 行；
 * - 无 groupId 的老数据，按「同块 + 同族 + 值/目标/条件全同」做**显示聚合**，
 *   标「未分组」，点 [确认合并] 才写 groupId；
 * - 类2（异常类增伤/暴击率/爆伤）1 行 ↔ N 条（每个第二级类型一个 stat）；
 * - 类1/类3 1 行 ↔ 1 条（类型只进 conditions.damageTypes，不改字段）；
 * - 类3 跨类多选不自动拆组；要分开由用户点 [拆开]。
 */
import type {
  BuffDamageType,
  BuffEffect,
  BuffEffectBlock,
  BuffStatKey,
} from '@/types/calculator'
import {
  BUFF_DAMAGE_TYPE_IDS,
  damageTypesOf,
  normalizeDamageTypes,
  normalizeGroupId,
  sameDamageTypes,
} from '@/utils/buffDamageTypes'
import {
  allowedDamageTypesOf,
  anomalyTypeOfStat,
  buffStatZoneOf,
  isZoneTypeLocked,
  statRowsForZone,
  zoneFamilyKey,
  zoneTypesOfStats,
  type BuffStatZone,
} from '@/utils/buffStatZones'

export interface EffectRowIssue {
  key: string
  label: string
}

export interface EffectRow {
  key: string
  effects: BuffEffect[]
  groupId?: string
  /** 无 groupId、按启发式聚在一起的显示行 */
  heuristic: boolean
  /** 当前行对应的乘区；组内跨族时为 null */
  zone: BuffStatZone | null
  damageTypes: BuffDamageType[]
  issues: EffectRowIssue[]
}

const ISSUE_LABELS: Record<string, string> = {
  applyTarget: '目标',
  applySituation: '作用情况',
  applyProfession: '受益职业',
  teammateProfessions: '队友职业',
  teamProfession: '队内职业',
  teamProfessionValues: '人数档',
  teamProfessionMinCount: '人数门槛',
  elementFilter: '属性限定',
  skillTargets: '招式目标',
  kind: '数值类型',
  value: '数值',
  valuePerStack: '每层数值',
  maxStacks: '最大层数',
  defaultStacks: '默认层数',
  stackable: '叠层',
  convert: '转模',
  enabledDefault: '默认启用',
  damageTypes: '伤害类型',
}

let rowIdSeed = 0

/** 生成新效果 id（测试可注入 makeId） */
export function makeEffectId(prefix = 'eff'): string {
  rowIdSeed += 1
  return `${prefix}-${Date.now().toString(36)}-${rowIdSeed.toString(36)}`
}

/** 生成新 groupId */
export function makeGroupId(): string {
  rowIdSeed += 1
  return `grp-${Date.now().toString(36)}-${rowIdSeed.toString(36)}`
}

function cloneEffect(effect: BuffEffect): BuffEffect {
  return {
    ...effect,
    teammateProfessions: effect.teammateProfessions?.slice(),
    skillTargets: effect.skillTargets?.map((item) => ({ ...item })),
    elementFilter: Array.isArray(effect.elementFilter)
      ? [...effect.elementFilter]
      : effect.elementFilter,
    convert: effect.convert ? { ...effect.convert } : undefined,
    conditions: effect.conditions?.damageTypes
      ? { damageTypes: [...effect.conditions.damageTypes] }
      : undefined,
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${key}:${stable((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function valueSignature(effect: BuffEffect): string {
  return stable({
    kind: effect.kind,
    value: effect.value ?? 0,
    valuePerStack: effect.valuePerStack ?? 0,
    maxStacks: effect.maxStacks ?? 1,
    defaultStacks: effect.defaultStacks ?? 1,
    stackable: Boolean(effect.stackable),
    convert: effect.convert ?? null,
  })
}

function targetSignature(effect: BuffEffect): string {
  return stable({
    applyTarget: effect.applyTarget ?? 'self',
    applySituation: effect.applySituation ?? 'global',
    applyProfession: effect.applyProfession ?? null,
    teammateProfessions: effect.teammateProfessions ?? [],
    teamProfession: effect.teamProfession ?? null,
    teamProfessionValues: effect.teamProfessionValues ?? null,
    teamProfessionMinCount: effect.teamProfessionMinCount ?? null,
    elementFilter: effect.elementFilter ?? 'all',
    skillTargets: effect.skillTargets ?? [],
    skillCategory: effect.skillCategory ?? null,
    skillSubcategoryId: effect.skillSubcategoryId ?? null,
    enabledDefault: effect.enabledDefault !== false,
  })
}

/**
 * 同族比较签名：
 * - 类2 忽略 stat / scope（类型由字段表达）；
 * - 其它情况把 conditions 也纳入。
 */
function familyConditionSignature(effect: BuffEffect, zone: BuffStatZone): string {
  const isFamily = Boolean(zone.statsByType)
  return stable({
    value: valueSignature(effect),
    target: targetSignature(effect),
    damageTypes: isFamily ? null : normalizeDamageTypes(damageTypesOf(effect)),
  })
}

/** 一行内部的字段差异（组内不一致 ⚠） */
export function rowIssues(row: EffectRow): EffectRowIssue[] {
  if (row.effects.length < 2 || !row.zone) return []
  const base = row.effects[0]!
  const isFamily = Boolean(row.zone.statsByType)
  const keys = new Set<string>()
  for (const effect of row.effects.slice(1)) {
    if ((effect.applyTarget ?? 'self') !== (base.applyTarget ?? 'self')) keys.add('applyTarget')
    if ((effect.applySituation ?? 'global') !== (base.applySituation ?? 'global')) {
      keys.add('applySituation')
    }
    if ((effect.applyProfession ?? null) !== (base.applyProfession ?? null)) {
      keys.add('applyProfession')
    }
    if (stable(effect.teammateProfessions ?? []) !== stable(base.teammateProfessions ?? [])) {
      keys.add('teammateProfessions')
    }
    if ((effect.teamProfession ?? null) !== (base.teamProfession ?? null)) {
      keys.add('teamProfession')
    }
    if (stable(effect.teamProfessionValues ?? null) !== stable(base.teamProfessionValues ?? null)) {
      keys.add('teamProfessionValues')
    }
    if ((effect.teamProfessionMinCount ?? null) !== (base.teamProfessionMinCount ?? null)) {
      keys.add('teamProfessionMinCount')
    }
    if (stable(effect.elementFilter ?? 'all') !== stable(base.elementFilter ?? 'all')) {
      keys.add('elementFilter')
    }
    if (stable(effect.skillTargets ?? []) !== stable(base.skillTargets ?? [])) {
      keys.add('skillTargets')
    }
    if ((effect.kind ?? 'fixed') !== (base.kind ?? 'fixed')) keys.add('kind')
    if ((effect.value ?? 0) !== (base.value ?? 0)) keys.add('value')
    if ((effect.valuePerStack ?? 0) !== (base.valuePerStack ?? 0)) keys.add('valuePerStack')
    if ((effect.maxStacks ?? 1) !== (base.maxStacks ?? 1)) keys.add('maxStacks')
    if ((effect.defaultStacks ?? 1) !== (base.defaultStacks ?? 1)) keys.add('defaultStacks')
    if (Boolean(effect.stackable) !== Boolean(base.stackable)) keys.add('stackable')
    if (stable(effect.convert ?? null) !== stable(base.convert ?? null)) keys.add('convert')
    if ((effect.enabledDefault !== false) !== (base.enabledDefault !== false)) {
      keys.add('enabledDefault')
    }
    if (
      !isFamily &&
      !sameDamageTypes(damageTypesOf(effect), damageTypesOf(base))
    ) {
      keys.add('damageTypes')
    }
  }
  return [...keys].map((key) => ({ key, label: ISSUE_LABELS[key] ?? key }))
}

function rowDamageTypes(row: EffectRow): BuffDamageType[] {
  if (!row.zone) {
    const set = new Set<BuffDamageType>()
    for (const effect of row.effects) {
      for (const type of damageTypesOf(effect)) set.add(type)
    }
    return BUFF_DAMAGE_TYPE_IDS.filter((id) => set.has(id))
  }
  if (row.zone.lockedTypes) return [...row.zone.lockedTypes]
  if (row.zone.statsByType) {
    return zoneTypesOfStats(
      row.zone,
      row.effects.map((effect) => effect.stat),
    )
  }
  const set = new Set<BuffDamageType>()
  for (const effect of row.effects) {
    for (const type of damageTypesOf(effect)) set.add(type)
  }
  return BUFF_DAMAGE_TYPE_IDS.filter((id) => set.has(id))
}

export interface BuildRowsOptions {
  /**
   * 本次编辑里被 [拆开] 的效果 id：不要再用启发式把它们聚回去。
   * 只影响显示，不写数据。
   */
  suppressHeuristicIds?: ReadonlySet<string>
}

/**
 * 把 block.effects 聚合成管理侧行。
 *
 * 顺序：按第一条第首次出现；
 * 显式 groupId 优先；无 groupId 的类2 行按启发式聚合并标 heuristic。
 */
export function buildEffectRows(
  effects: readonly BuffEffect[],
  options: BuildRowsOptions = {},
): EffectRow[] {
  const list = effects.filter(Boolean)
  const suppress = options.suppressHeuristicIds ?? new Set<string>()
  const rows: EffectRow[] = []
  const consumed = new Set<string>()

  // 1) 显式 groupId
  const explicit = new Map<string, BuffEffect[]>()
  for (const effect of list) {
    const groupId = normalizeGroupId(effect.groupId)
    if (!groupId) continue
    const bucket = explicit.get(groupId) ?? []
    bucket.push(effect)
    explicit.set(groupId, bucket)
  }

  // 2) 无 groupId 的启发式桶（只对类2 族）
  const heuristicBuckets = new Map<string, BuffEffect[]>()
  const effectById = new Map(list.map((effect) => [effect.id, effect]))
  for (const effect of list) {
    if (normalizeGroupId(effect.groupId)) continue
    if (suppress.has(effect.id)) continue
    const zone = buffStatZoneOf(effect.stat)
    if (!zone?.statsByType) continue
    const key = `${zoneFamilyKey(zone)}|${familyConditionSignature(effect, zone)}`
    const bucket = heuristicBuckets.get(key) ?? []
    bucket.push(effect)
    heuristicBuckets.set(key, bucket)
  }

  for (const effect of list) {
    if (consumed.has(effect.id)) continue
    const groupId = normalizeGroupId(effect.groupId)
    if (groupId) {
      const bucket = explicit.get(groupId) ?? []
      for (const member of bucket) consumed.add(member.id)
      const zone = bucket.length
        ? buffStatZoneOf(bucket[0]!.stat)
        : null
      const row: EffectRow = {
        key: `g:${groupId}`,
        effects: bucket,
        groupId,
        heuristic: false,
        zone,
        damageTypes: [],
        issues: [],
      }
      row.damageTypes = rowDamageTypes(row)
      row.issues = rowIssues(row)
      rows.push(row)
      continue
    }

    const zone = buffStatZoneOf(effect.stat)
    if (zone?.statsByType) {
      const key = `${zoneFamilyKey(zone)}|${familyConditionSignature(effect, zone)}`
      const bucket = heuristicBuckets.get(key) ?? []
      if (bucket.length > 1) {
        for (const member of bucket) consumed.add(member.id)
        const row: EffectRow = {
          key: `h:${effect.id}`,
          effects: bucket,
          heuristic: true,
          zone,
          damageTypes: [],
          issues: [],
        }
        row.damageTypes = rowDamageTypes(row)
        row.issues = rowIssues(row)
        rows.push(row)
        continue
      }
    }

    consumed.add(effect.id)
    const row: EffectRow = {
      key: `e:${effect.id}`,
      effects: [effectById.get(effect.id)!],
      heuristic: false,
      zone,
      damageTypes: [],
      issues: [],
    }
    row.damageTypes = rowDamageTypes(row)
    row.issues = rowIssues(row)
    rows.push(row)
  }

  return rows
}

export function rowRepresentative(row: EffectRow): BuffEffect {
  return row.effects[0]!
}

/** 用新行替换旧行，保持旧行第一条的位置；其余位置不变 */
export function replaceRowEffects(
  effects: readonly BuffEffect[],
  row: EffectRow,
  next: readonly BuffEffect[],
): BuffEffect[] {
  const oldIds = new Set(row.effects.map((effect) => effect.id))
  const index = effects.findIndex((effect) => oldIds.has(effect.id))
  const rest = effects.filter((effect) => !oldIds.has(effect.id))
  const insertAt = index < 0 ? rest.length : index
  const result = [...rest]
  result.splice(insertAt, 0, ...next)
  return result
}

export interface ChangeZoneOptions {
  makeId?: () => string
  makeGroup?: () => string
}

/**
 * 改属性（乘区）→ 重建该行。
 *
 * - 类2：按 selectedTypes 生成 N 条同组；空选择 = 全部 5 条。
 * - 类1：1 条，清 conditions。
 * - 类3：1 条，conditions = selectedTypes（空 = 不写）。
 */
export function changeRowZone(
  effects: readonly BuffEffect[],
  row: EffectRow,
  zone: BuffStatZone,
  selectedTypes: readonly BuffDamageType[],
  options: ChangeZoneOptions = {},
): BuffEffect[] {
  const makeId = options.makeId ?? makeEffectId
  const makeGroup = options.makeGroup ?? makeGroupId
  const base = cloneEffect(rowRepresentative(row))
  const groupId = normalizeGroupId(row.groupId) ?? makeGroup()

  if (zone.statsByType) {
    const rows = statRowsForZone(zone, selectedTypes)
    /**
     * 身份按 `stat` 保留（Spec §7.2 第 13 项）：同一行里已有该属性的效果就沿用它的 id，
     * 只有真正新增的属性才取新 id —— 否则「删掉属性异常」会让乱流继承别人的 id。
     */
    const idByStat = new Map<string, string>()
    for (const effect of row.effects) {
      if (!idByStat.has(effect.stat)) idByStat.set(effect.stat, effect.id)
    }
    const next = rows.map((item) => {
      const keptId = idByStat.get(item.stat)
      const source = keptId
        ? (row.effects.find((effect) => effect.id === keptId) ?? base)
        : base
      const effect = cloneEffect(source)
      effect.stat = item.stat
      effect.groupId = groupId
      delete effect.conditions
      effect.id = keptId ?? makeId()
      return effect
    })
    if (!next.length) return replaceRowEffects(effects, row, [base])
    return replaceRowEffects(effects, row, next)
  }

  const effect = cloneEffect(base)
  effect.stat = zone.stat ?? base.stat
  delete effect.groupId
  if (zone.tier === 1) {
    delete effect.conditions
  } else {
    const picked = normalizeDamageTypes(selectedTypes)
    if (picked.length) effect.conditions = { damageTypes: picked }
    else delete effect.conditions
  }
  return replaceRowEffects(effects, row, [effect])
}

/** 勾 / 取消伤害类型；类1 不处理 */
export function toggleRowDamageType(
  effects: readonly BuffEffect[],
  row: EffectRow,
  type: BuffDamageType,
  checked: boolean,
  options: ChangeZoneOptions = {},
): BuffEffect[] {
  if (!row.zone || isZoneTypeLocked(row.zone)) return [...effects]
  const allowed = allowedDamageTypesOf(row.zone)
  if (!allowed.includes(type)) return [...effects]
  const current = row.damageTypes
  const next = checked
    ? BUFF_DAMAGE_TYPE_IDS.filter((id) => current.includes(id) || id === type)
    : current.filter((id) => id !== type)
  return changeRowZone(effects, row, row.zone, next, options)
}

/**
 * [拆开]：
 * - 多成员组：清 groupId，每条独立成行；
 * - 单条多类型行：按类型拆成 N 条（每条一个 damageType），不写 groupId。
 */
export function splitRow(
  effects: readonly BuffEffect[],
  row: EffectRow,
  makeId: () => string = makeEffectId,
): BuffEffect[] {
  if (row.effects.length > 1) {
    return replaceRowEffects(
      effects,
      row,
      row.effects.map((effect) => {
        const next = cloneEffect(effect)
        delete next.groupId
        return next
      }),
    )
  }
  const only = row.effects[0]
  if (!only) return [...effects]
  const types = row.zone?.statsByType ? [] : damageTypesOf(only)
  if (types.length <= 1) {
    const next = cloneEffect(only)
    delete next.groupId
    return replaceRowEffects(effects, row, [next])
  }
  const next = types.map((type, index) => {
    const effect = cloneEffect(only)
    delete effect.groupId
    effect.conditions = { damageTypes: [type] }
    if (index > 0) effect.id = makeId()
    return effect
  })
  return replaceRowEffects(effects, row, next)
}

export interface MergeResult {
  ok: boolean
  error?: string
  groupId?: string
  effects?: BuffEffect[]
}

/**
 * [合并]：把选中的、同块同族同值的独立行写同一个 groupId。
 * 只接受：未分组、单条、同一 zone、值/目标/条件全同。
 */
export function mergeRows(
  effects: readonly BuffEffect[],
  rows: readonly EffectRow[],
  makeGroup: () => string = makeGroupId,
): MergeResult {
  if (rows.length < 2) return { ok: false, error: '至少选择 2 行' }
  const zones = new Set(rows.map((row) => row.zone))
  if (zones.size !== 1 || !rows[0]?.zone) {
    return { ok: false, error: '只能合并同一属性（同族）的行' }
  }
  const zone = rows[0]!.zone
  const groupId = makeGroup()
  const nextEffects: BuffEffect[] = []
  for (const row of rows) {
    if (row.groupId) return { ok: false, error: '已分组的行不能再合并' }
    if (row.effects.length !== 1) return { ok: false, error: '只能合并单条效果行' }
    const effect = row.effects[0]!
    if (familyConditionSignature(effect, zone) !== familyConditionSignature(rows[0]!.effects[0]!, zone)) {
      return { ok: false, error: '值 / 目标 / 条件不一致，不能合并' }
    }
    if (!row.zone?.statsByType && !sameDamageTypes(damageTypesOf(effect), damageTypesOf(rows[0]!.effects[0]!))) {
      return { ok: false, error: '伤害类型不一致，不能合并' }
    }
    nextEffects.push({ ...cloneEffect(effect), groupId })
  }

  const ids = new Set(nextEffects.map((effect) => effect.id))
  const index = effects.findIndex((effect) => ids.has(effect.id))
  const rest = effects.filter((effect) => !ids.has(effect.id))
  const insertAt = index < 0 ? rest.length : index
  const result = [...rest]
  result.splice(insertAt, 0, ...nextEffects)
  return { ok: true, groupId, effects: result }
}

/** [一键对齐]：以第一行为准，把可编辑字段复制给组内其它条 */
export function alignRow(row: EffectRow): BuffEffect[] {
  if (row.effects.length < 2) return row.effects.map(cloneEffect)
  const base = row.effects[0]!
  return row.effects.map((effect, index) => {
    if (index === 0) return cloneEffect(effect)
    const next = cloneEffect(effect)
    next.applyTarget = base.applyTarget
    next.applySituation = base.applySituation
    next.applyProfession = base.applyProfession
    next.teammateProfessions = base.teammateProfessions?.slice()
    next.teamProfession = base.teamProfession
    next.teamProfessionValues = base.teamProfessionValues
      ? [...base.teamProfessionValues]
      : null
    next.teamProfessionMinCount = base.teamProfessionMinCount
    next.elementFilter = Array.isArray(base.elementFilter)
      ? [...base.elementFilter]
      : base.elementFilter
    next.skillTargets = base.skillTargets?.map((item) => ({ ...item }))
    next.kind = base.kind
    next.value = base.value
    next.valuePerStack = base.valuePerStack
    next.maxStacks = base.maxStacks
    next.defaultStacks = base.defaultStacks
    next.stackable = base.stackable
    next.convert = base.convert ? { ...base.convert } : undefined
    next.enabledDefault = base.enabledDefault
    if (!row.zone?.statsByType) {
      if (base.conditions?.damageTypes) {
        next.conditions = { damageTypes: [...base.conditions.damageTypes] }
      } else {
        delete next.conditions
      }
    }
    return next
  })
}

export interface GroupValidation {
  ok: boolean
  errors: string[]
}

/**
 * 保存前整组校验（原子写入前闸门）：
 * - 同一 groupId 只能出现在一个块；
 * - 组内同族；
 * - 组内值/目标/条件一致。
 */
export function validateEffectGroups(blocks: readonly BuffEffectBlock[]): GroupValidation {
  const errors: string[] = []
  const seen = new Map<string, { blockIndex: number; effects: BuffEffect[] }>()
  blocks.forEach((block, blockIndex) => {
    for (const effect of block.effects ?? []) {
      const groupId = normalizeGroupId(effect.groupId)
      if (!groupId) continue
      const hit = seen.get(groupId)
      if (!hit) {
        seen.set(groupId, { blockIndex, effects: [effect] })
        continue
      }
      if (hit.blockIndex !== blockIndex) {
        errors.push(`groupId ${groupId} 跨效果块出现，不能保存`)
        continue
      }
      hit.effects.push(effect)
    }
  })

  for (const [groupId, { effects }] of seen) {
    const zones = new Set(effects.map((effect) => buffStatZoneOf(effect.stat)?.id ?? ''))
    if (zones.size > 1) {
      errors.push(`组 ${groupId} 的成员不在同一乘区，不能保存`)
      continue
    }
    const row: EffectRow = {
      key: `g:${groupId}`,
      effects,
      groupId,
      heuristic: false,
      zone: buffStatZoneOf(effects[0]!.stat),
      damageTypes: [],
      issues: [],
    }
    const issues = rowIssues(row)
    if (issues.length) {
      errors.push(`组 ${groupId} 的「${issues.map((item) => item.label).join(' / ')}」不一致，请先对齐`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** 老数据启发式：某行是否可以点 [确认合并]（未分组、≥2 条） */
export function canConfirmMerge(row: EffectRow): boolean {
  return !row.groupId && row.heuristic && row.effects.length > 1
}

/** 给启发式行 / 合并写 groupId（只改 groupId，不动其它字段） */
export function confirmMergeRow(
  effects: readonly BuffEffect[],
  row: EffectRow,
  makeGroup: () => string = makeGroupId,
): BuffEffect[] {
  if (!canConfirmMerge(row)) return [...effects]
  const groupId = makeGroup()
  return replaceRowEffects(
    effects,
    row,
    row.effects.map((effect) => ({ ...effect, groupId })),
  )
}

/** 取组内某条 stat 对应的类型（用于展示成员 chip） */
export function typeOfRowEffect(effect: BuffEffect): BuffDamageType | null {
  return anomalyTypeOfStat(effect.stat)
}

/** 类2 行当前是否覆盖全部 5 项 */
export function rowHasAllTypes(row: EffectRow): boolean {
  return Boolean(
    row.zone?.statsByType &&
      row.damageTypes.length === allowedDamageTypesOf(row.zone).length,
  )
}

/** 兼容导出：某 stat 的乘区 */
export function zoneOfStatKey(stat: BuffStatKey): BuffStatZone | null {
  return buffStatZoneOf(stat)
}
