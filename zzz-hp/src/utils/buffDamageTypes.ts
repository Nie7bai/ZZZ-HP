/**
 * 伤害类型条件（BuffEffect.conditions）—— 前端唯一口径。
 *
 * 2026-10-20 用户拍板：
 * - 两级：直伤类（普通直伤 / 命破 / 锋御）+ 异常类（属性异常 / 乱流 / 紊乱 / 耀变 / 异放）；
 * - 数据层只存第二级 id；空数组 = 全部；允许跨类多选；
 * - `scope` 只针对 BuffEffect 废弃：读时迁移为 damageTypes，写时不写 scope；
 * - 显示只显示第二级，不带「直伤类 / 异常类」前缀。
 *
 * 与后端 `zzz-hp-backend/src/utils/buffEffectConditions.js` 保持同源规则。
 */
import {
  BUFF_DAMAGE_TYPE_OPTIONS,
  type BuffDamageType,
  type BuffEffect,
  type BuffEffectConditions,
  type BuffScope,
} from '@/types/calculator'

/** 合法伤害类型（按界面顺序） */
export const BUFF_DAMAGE_TYPE_IDS: BuffDamageType[] = BUFF_DAMAGE_TYPE_OPTIONS.map(
  (item) => item.id,
)

const DAMAGE_TYPE_SET = new Set<string>(BUFF_DAMAGE_TYPE_IDS)

/** 异常类 5 项（旧 mutation scope / 异化系数用） */
export const ANOMALY_DAMAGE_TYPES: BuffDamageType[] = [
  'attributeAnomaly',
  'turbulence',
  'disorder',
  'radiance',
  'anomalyRelease',
]

export const DIRECT_DAMAGE_TYPES: BuffDamageType[] = ['normal', 'pierce', 'sharpen']

/** 15 个异常子类 stat → 第二级类型（类2 的字段本身表达类型） */
export const ANOMALY_SUBTYPE_STAT_TO_TYPE: Partial<Record<string, BuffDamageType>> = {
  attributeAnomalyDmgBonus: 'attributeAnomaly',
  turbulenceDmgBonus: 'turbulence',
  disorderDmgBonus: 'disorder',
  radianceDmgBonus: 'radiance',
  anomalyReleaseDmgBonus: 'anomalyRelease',
  attributeAnomalyCritRate: 'attributeAnomaly',
  turbulenceCritRate: 'turbulence',
  disorderCritRate: 'disorder',
  radianceCritRate: 'radiance',
  anomalyReleaseCritRate: 'anomalyRelease',
  attributeAnomalyCritDmg: 'attributeAnomaly',
  turbulenceCritDmg: 'turbulence',
  disorderCritDmg: 'disorder',
  radianceCritDmg: 'radiance',
  anomalyReleaseCritDmg: 'anomalyRelease',
}

export function anomalyTypeOfStat(stat: string | null | undefined): BuffDamageType | null {
  if (!stat) return null
  return ANOMALY_SUBTYPE_STAT_TO_TYPE[stat] ?? null
}

export function isAnomalySubtypeStat(stat: string | null | undefined): boolean {
  return Boolean(stat && ANOMALY_SUBTYPE_STAT_TO_TYPE[stat])
}

/** 旧 scope → 第二级类型（skill / general 不产类型） */
const LEGACY_SCOPE_TO_TYPES: Partial<Record<BuffScope, BuffDamageType[]>> = {
  attributeAnomaly: ['attributeAnomaly'],
  turbulence: ['turbulence'],
  disorder: ['disorder'],
  radiance: ['radiance'],
  anomalyRelease: ['anomalyRelease'],
  mutation: ANOMALY_DAMAGE_TYPES,
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value == null || value === '') return []
  return [value]
}

/** 去非法 / 去重 / 按固定顺序输出；空 = 全部 */
export function normalizeDamageTypes(value: unknown): BuffDamageType[] {
  const picked = new Set<BuffDamageType>()
  for (const item of toArray(value)) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!DAMAGE_TYPE_SET.has(text)) continue
    picked.add(text as BuffDamageType)
  }
  if (!picked.size) return []
  return BUFF_DAMAGE_TYPE_IDS.filter((id) => picked.has(id))
}

/**
 * 旧 scope → damageTypes：
 * - 含 general → 全部（空）
 * - skill 忽略（招式条件由 skillTargets 表达）
 * - mutation → 5 个异常类全选
 */
export function legacyScopeToDamageTypes(scope: unknown): BuffDamageType[] {
  const scopes = toArray(scope)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
  if (!scopes.length) return []
  if (scopes.includes('general')) return []
  const types: BuffDamageType[] = []
  for (const scopeId of scopes) {
    const mapped = LEGACY_SCOPE_TO_TYPES[scopeId as BuffScope]
    if (mapped) types.push(...mapped)
  }
  return normalizeDamageTypes(types)
}

/** 新字段优先；否则回退旧 scope；空 → undefined（= 全部） */
export function normalizeEffectConditions(
  value: unknown,
  legacyScope?: unknown,
): BuffEffectConditions | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const damageTypes = normalizeDamageTypes(
      (value as BuffEffectConditions).damageTypes,
    )
    if (damageTypes.length) return { damageTypes }
    return undefined
  }
  const damageTypes = legacyScopeToDamageTypes(legacyScope)
  return damageTypes.length ? { damageTypes } : undefined
}

/** 取一条效果当前生效的伤害类型（conditions 优先，旧 scope 回退） */
export function damageTypesOf(
  effect: Pick<BuffEffect, 'conditions' | 'scope'> | null | undefined,
): BuffDamageType[] {
  const fromConditions = normalizeDamageTypes(effect?.conditions?.damageTypes)
  if (fromConditions.length) return fromConditions
  return legacyScopeToDamageTypes(effect?.scope)
}

/**
 * 按 stat 再清一次冗余条件：15 个子类字段不用 damageTypes。
 * （属性 → 字段固定映射；这里只做「字段已表达类型」的去冗余。）
 */
export function normalizeEffectConditionsForStat(
  value: unknown,
  legacyScope: unknown,
  stat: string | null | undefined,
): BuffEffectConditions | undefined {
  if (isAnomalySubtypeStat(stat)) return undefined
  return normalizeEffectConditions(value, legacyScope)
}

/** 是否有伤害类型条件（= 不是「全部」） */
export function hasDamageTypeCondition(effect: Pick<BuffEffect, 'conditions' | 'scope'>): boolean {
  return damageTypesOf(effect).length > 0
}

/** 空数组 = 全部；显示只列第二级，按 ` / ` 拼接 */
export function damageTypesLabel(value: unknown): string {
  const types = normalizeDamageTypes(value)
  if (!types.length) return '全部'
  return types
    .map((id) => BUFF_DAMAGE_TYPE_OPTIONS.find((item) => item.id === id)?.label ?? id)
    .join(' / ')
}

export function damageTypeLabel(type: BuffDamageType): string {
  return BUFF_DAMAGE_TYPE_OPTIONS.find((item) => item.id === type)?.label ?? type
}

/** 勾选 / 取消（纯数组；不处理「全部」以外的互斥） */
export function toggleDamageType(
  current: unknown,
  type: BuffDamageType,
  checked: boolean,
): BuffDamageType[] {
  const next = new Set(normalizeDamageTypes(current))
  if (checked) next.add(type)
  else next.delete(type)
  return BUFF_DAMAGE_TYPE_IDS.filter((id) => next.has(id))
}

export function sameDamageTypes(left: unknown, right: unknown): boolean {
  const a = normalizeDamageTypes(left)
  const b = normalizeDamageTypes(right)
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export function isAnomalyDamageType(type: BuffDamageType): boolean {
  return (ANOMALY_DAMAGE_TYPES as string[]).includes(type)
}

export function isDirectDamageType(type: BuffDamageType): boolean {
  return (DIRECT_DAMAGE_TYPES as string[]).includes(type)
}

/** groupId：非空字符串才保留 */
export function normalizeGroupId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

export function normalizeTeammateProfessions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const selected = [...new Set(value.flatMap((item) =>
    typeof item === 'string' && item.trim() ? [item.trim()] : [],
  ))].sort()
  return selected.length ? selected : undefined
}

/**
 * 是否是「通用效果」：可脱离招式与队伍上下文安全地派生旧扁平数值。
 * 用于派生 selfMods / teamMods（兼容旧扁平结构），与旧 `scope=['general']` 等价。
 */
export function effectHasGenericConditions(
  effect: Pick<BuffEffect, 'conditions' | 'scope' | 'skillTargets' | 'skillCategory' | 'teammateProfessions'>,
): boolean {
  if (effect.teammateProfessions?.length) return false
  if (damageTypesOf(effect).length) return false
  if (Array.isArray(effect.skillTargets) && effect.skillTargets.length) return false
  if (effect.skillCategory) return false
  return true
}
