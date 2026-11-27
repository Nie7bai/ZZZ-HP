/**
 * BuffEffect 条件归一化（前后端同源规则的前端副本见 `zzz-hp/src/utils/buffDamageTypes.ts`）。
 *
 * 2026-10-20 用户口径：
 * - `scope` 废弃（只针对 BuffEffect；词条库 / 额外增益的 scope 不动）；
 * - 伤害类型改成两级，数据层只存第二级 id，空 = 全部；
 * - `groupId` 只用于管理侧聚合，引擎完全忽略；
 * - 属性 → 字段固定映射，conditions 只写条件、从不改写字段。
 */

/** 第二级伤害类型（按界面顺序：直伤 3 + 异常 5） */
export const BUFF_DAMAGE_TYPES = [
  'normal',
  'pierce',
  'sharpen',
  'attributeAnomaly',
  'turbulence',
  'disorder',
  'radiance',
  'anomalyRelease',
]

const DAMAGE_TYPE_SET = new Set(BUFF_DAMAGE_TYPES)

/** 异常类 5 项（异化系数 / 旧 mutation scope 用） */
export const ANOMALY_DAMAGE_TYPES = [
  'attributeAnomaly',
  'turbulence',
  'disorder',
  'radiance',
  'anomalyRelease',
]

/**
 * 15 个「子类字段」stat：类型已由字段表达，conditions.damageTypes 冗余。
 * 归一化时清空，避免同组出现假 ⚠。
 */
export const ANOMALY_SUBTYPE_STATS = new Set([
  'attributeAnomalyDmgBonus',
  'turbulenceDmgBonus',
  'disorderDmgBonus',
  'radianceDmgBonus',
  'anomalyReleaseDmgBonus',
  'attributeAnomalyCritRate',
  'turbulenceCritRate',
  'disorderCritRate',
  'radianceCritRate',
  'anomalyReleaseCritRate',
  'attributeAnomalyCritDmg',
  'turbulenceCritDmg',
  'disorderCritDmg',
  'radianceCritDmg',
  'anomalyReleaseCritDmg',
])

/** 旧 scope → 第二级类型（skill / general 不产类型） */
const LEGACY_SCOPE_TO_TYPES = {
  attributeAnomaly: ['attributeAnomaly'],
  turbulence: ['turbulence'],
  disorder: ['disorder'],
  radiance: ['radiance'],
  anomalyRelease: ['anomalyRelease'],
  mutation: ANOMALY_DAMAGE_TYPES,
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value == null || value === '') return []
  return [value]
}

/**
 * 伤害类型数组归一化：去非法、去重、按固定顺序输出。
 * 空数组 / 缺省 / 全非法 → []（= 全部）。
 */
export function normalizeDamageTypes(value) {
  const picked = new Set()
  for (const item of toArray(value)) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!DAMAGE_TYPE_SET.has(text)) continue
    picked.add(text)
  }
  if (!picked.size) return []
  return BUFF_DAMAGE_TYPES.filter((id) => picked.has(id))
}

/**
 * 旧 scope → 新 damageTypes。
 * - 含 general → 全部（空数组）
 * - skill 忽略（招式条件由 skillTargets 表达）
 * - mutation → 5 个异常类全选
 */
export function legacyScopeToDamageTypes(scope) {
  const scopes = toArray(scope)
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
  if (!scopes.length) return []
  if (scopes.includes('general')) return []
  const types = []
  for (const scopeId of scopes) {
    const mapped = LEGACY_SCOPE_TO_TYPES[scopeId]
    if (mapped) types.push(...mapped)
  }
  return normalizeDamageTypes(types)
}

/**
 * 条件归一化。
 *
 * 读新字段优先：`conditions.damageTypes` 有值就用它；
 * 否则回退旧 `scope`。两者都没有 / 都为空 → 返回 undefined（= 全部）。
 */
export function normalizeEffectConditions(value, legacyScope) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const damageTypes = normalizeDamageTypes(value.damageTypes)
    if (damageTypes.length) return { damageTypes }
    return undefined
  }
  const damageTypes = legacyScopeToDamageTypes(legacyScope)
  return damageTypes.length ? { damageTypes } : undefined
}

/**
 * 按 stat 再清一次冗余条件：15 个子类字段不用 damageTypes。
 * （属性 → 字段固定映射；这里只做「字段已表达类型」的去冗余。）
 */
export function normalizeEffectConditionsForStat(value, legacyScope, stat) {
  if (ANOMALY_SUBTYPE_STATS.has(stat)) return undefined
  return normalizeEffectConditions(value, legacyScope)
}

/** groupId：非空字符串才保留，去掉首尾空白 */
export function normalizeGroupId(value) {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

export function normalizeTeammateProfessions(value) {
  if (!Array.isArray(value)) return undefined
  const selected = [...new Set(value.flatMap((item) =>
    typeof item === 'string' && item.trim() ? [item.trim()] : [],
  ))].sort()
  return selected.length ? selected : undefined
}

export function normalizeEffectApplyTarget(value) {
  return value === 'team' || value === 'teammates' ? value : 'self'
}

/**
 * 是否是「通用效果」：可脱离招式与队伍上下文安全地派生旧扁平数值。
 * 用于派生 selfMods / teamMods（兼容旧扁平结构），与旧 `scope=['general']` 等价。
 */
export function effectHasGenericConditions(effect) {
  if (effect?.teammateProfessions?.length) return false
  const types = normalizeDamageTypes(effect?.conditions?.damageTypes)
  if (types.length) return false
  if (Array.isArray(effect?.skillTargets) && effect.skillTargets.length) return false
  if (effect?.skillCategory) return false
  return true
}
