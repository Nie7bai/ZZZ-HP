/**
 * 管理侧「属性」下拉的乘区目录（2026-10-20）。
 *
 * 用户口径：
 * - 下拉只列**乘区级名称**，不再列 5 个异常子类字段；
 * - 类1 死限制（类型锁定、灰显）：贯穿增伤→命破、锐化伤害提升→锋御、异化系数→异常 5 项；
 * - 类2 部分限制：异常类增伤 / 暴击率 / 爆伤 → 只能选异常 5 项，直伤 3 项禁用；
 * - 类3 其余 55 项：全 8 项可选；
 * - **不改任何属性名**；「锐爆伤害加成」保留原名，作为类3 独立属性。
 *
 * 类2 是 1 行 ↔ N 条（每个第二级类型一个 stat）；类1/类3 是 1 行 ↔ 1 条。
 * 条件只写 `conditions.damageTypes`，从不改写字段。
 */
import { reactive } from 'vue'
import type { BuffDamageType, BuffStatKey, CustomBuffStatKey } from '@/types/calculator'
import {
  ANOMALY_DAMAGE_TYPES,
  BUFF_DAMAGE_TYPE_IDS,
  anomalyTypeOfStat as anomalyTypeOfStatBase,
  isAnomalyDamageType,
} from '@/utils/buffDamageTypes'
import { BUFF_STAT_FIELDS } from '@/utils/calculatorUi'
import { isCustomBuffStatKey } from '@/utils/buffEffect'

export type BuffStatZoneTier = 1 | 2 | 3

export interface BuffStatZone {
  id: string
  label: string
  tier: BuffStatZoneTier
  /** 类1/类3：单一字段（类3 追加的自定义乘区为 `custom:<key>`） */
  stat?: BuffStatKey | CustomBuffStatKey
  /** 类2：第二级类型 → 字段（5 个） */
  statsByType?: Partial<Record<BuffDamageType, BuffStatKey>>
  /** 类1：锁定的伤害类型（灰显不可改） */
  lockedTypes?: BuffDamageType[]
  /** 类2：允许的伤害类型；类1/3 缺省 = 全部 8 项 */
  allowedTypes?: BuffDamageType[]
}

const CLASS1_ZONES: BuffStatZone[] = [
  {
    id: 'zone:pierceDmgBonus',
    label: '贯穿增伤',
    tier: 1,
    stat: 'pierceDmgBonus',
    lockedTypes: ['pierce'],
  },
  {
    id: 'zone:sharpenDmgBonus',
    label: '锐化伤害提升',
    tier: 1,
    stat: 'sharpenDmgBonus',
    lockedTypes: ['sharpen'],
  },
  {
    id: 'zone:mutationCoeff',
    label: '异化系数',
    tier: 1,
    stat: 'mutationCoeff',
    lockedTypes: [...ANOMALY_DAMAGE_TYPES],
  },
]

const CLASS2_ZONES: BuffStatZone[] = [
  {
    id: 'zone:anomalyDmg',
    label: '异常类增伤',
    tier: 2,
    allowedTypes: [...ANOMALY_DAMAGE_TYPES],
    statsByType: {
      attributeAnomaly: 'attributeAnomalyDmgBonus',
      turbulence: 'turbulenceDmgBonus',
      disorder: 'disorderDmgBonus',
      radiance: 'radianceDmgBonus',
      anomalyRelease: 'anomalyReleaseDmgBonus',
    },
  },
  {
    id: 'zone:attributeAnomalyCritRate',
    label: '异常类暴击率',
    tier: 2,
    allowedTypes: [...ANOMALY_DAMAGE_TYPES],
    statsByType: {
      attributeAnomaly: 'attributeAnomalyCritRate',
      turbulence: 'turbulenceCritRate',
      disorder: 'disorderCritRate',
      radiance: 'radianceCritRate',
      anomalyRelease: 'anomalyReleaseCritRate',
    },
  },
  {
    id: 'zone:attributeAnomalyCritDmg',
    label: '异常类爆伤',
    tier: 2,
    allowedTypes: [...ANOMALY_DAMAGE_TYPES],
    statsByType: {
      attributeAnomaly: 'attributeAnomalyCritDmg',
      turbulence: 'turbulenceCritDmg',
      disorder: 'disorderCritDmg',
      radiance: 'radianceCritDmg',
      anomalyRelease: 'anomalyReleaseCritDmg',
    },
  },
]

const CLASS1_STATS = new Set(CLASS1_ZONES.map((zone) => zone.stat))
const CLASS2_STATS = new Set(
  CLASS2_ZONES.flatMap((zone) => Object.values(zone.statsByType ?? {})),
)

/** 类3：其余字段，保留现有 label（异常掌控的固定/百分比两个乘区在管理端加后缀区分） */
const CLASS3_ZONES: BuffStatZone[] = BUFF_STAT_FIELDS.filter(
  (field) => !CLASS1_STATS.has(field.key) && !CLASS2_STATS.has(field.key),
).map((field) => ({
  id: `zone:${field.key}`,
  label:
    field.key === 'anomalyControl'
      ? '异常掌控（数值）'
      : field.key === 'anomalyControlPercent'
        ? '异常掌控%'
        : field.label,
  tier: 3,
  stat: field.key,
}))

/**
 * 管理侧「属性」下拉的乘区目录（可被运行时乘区定义追加）。
 *
 * 内置 61 项在模块加载时构建；`registerCustomBuffStatZones` 把 DB `calculator_zone_definitions.stats`
 * 登记的增益键追加为类3 乘区（`stat = custom:<key>`），幂等按 id 去重。
 * 用 `reactive` 是为了让已挂载的管理端下拉在注册后立即出现新选项。
 */
export const BUFF_STAT_ZONES: BuffStatZone[] = reactive<BuffStatZone[]>([
  ...CLASS1_ZONES,
  ...CLASS2_ZONES,
  ...CLASS3_ZONES,
])

const ZONE_BY_ID = new Map<string, BuffStatZone>()

/** stat → { zone, type }（类2 的 5 个子类字段都能反查） */
const ZONE_BY_STAT = new Map<string, { zone: BuffStatZone; type?: BuffDamageType }>()

function indexZone(zone: BuffStatZone): void {
  ZONE_BY_ID.set(zone.id, zone)
  if (zone.stat) ZONE_BY_STAT.set(zone.stat, { zone })
  for (const [type, stat] of Object.entries(zone.statsByType ?? {})) {
    if (stat) ZONE_BY_STAT.set(stat, { zone, type: type as BuffDamageType })
  }
}

for (const zone of BUFF_STAT_ZONES) indexZone(zone)

export interface CustomBuffStatZoneInput {
  /** 增益键（可带 `custom:` 前缀；登记时统一补前缀） */
  key: string
  /** 展示名；缺省回落到键名 */
  label?: string | null
}

function customZoneIdOf(key: string): string {
  return `zone:custom:${key}`
}

/**
 * 注册乘区定义里登记的增益键，追加到「属性」下拉（类3，幂等）。
 *
 * label 用乘区定义 stats 的 label；非法 slug（未通过 `custom:<key>` 格式）直接跳过，
 * 已有同 id 的项不重复追加，也不覆盖内置项。
 */
export function registerCustomBuffStatZones(
  zones: readonly CustomBuffStatZoneInput[] | null | undefined,
): void {
  for (const input of zones ?? []) {
    const raw = typeof input?.key === 'string' ? input.key.trim() : ''
    if (!raw) continue
    const key = raw.startsWith('custom:') ? raw.slice('custom:'.length) : raw
    const stat = `custom:${key}`
    if (!isCustomBuffStatKey(stat)) continue
    const id = customZoneIdOf(key)
    if (ZONE_BY_ID.has(id)) continue
    const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : key
    BUFF_STAT_ZONES.push({ id, label, tier: 3, stat })
    // 索引数组里的（响应式）代理对象，保证 `buffStatZoneOf` 与下拉项同一引用
    indexZone(BUFF_STAT_ZONES[BUFF_STAT_ZONES.length - 1]!)
  }
}

export function findBuffStatZoneById(id: string | null | undefined): BuffStatZone | null {
  if (!id) return null
  return ZONE_BY_ID.get(id) ?? null
}

export function buffStatZoneOf(stat: string | null | undefined): BuffStatZone | null {
  if (!stat) return null
  return ZONE_BY_STAT.get(stat)?.zone ?? null
}

/** 「属性」展示名：内置字段 → 字段 label；自定义键 → 注册表 zone label；再回落键名 */
export function buffStatLabelOf(stat: string | null | undefined): string {
  if (!stat) return ''
  const field = BUFF_STAT_FIELDS.find((item) => item.key === stat)
  if (field) return field.label
  const zone = buffStatZoneOf(stat)
  if (zone) return zone.label
  return stat.startsWith('custom:') ? stat.slice('custom:'.length) : String(stat)
}

/** 「属性」单位：内置字段取其 unit；自定义键回落 `percent`（界面显示 `%`） */
export function buffStatUnitOf(
  stat: string | null | undefined,
): 'percent' | 'flat' | 'factor' {
  const field = BUFF_STAT_FIELDS.find((item) => item.key === stat)
  return field?.unit ?? 'percent'
}

/** 类2：stat 对应的第二级类型；类1/类3 返回 null */
export function anomalyTypeOfStat(
  stat: BuffStatKey | CustomBuffStatKey | null | undefined,
): BuffDamageType | null {
  return anomalyTypeOfStatBase(stat)
}

export function isAnomalySubtypeStat(
  stat: BuffStatKey | CustomBuffStatKey | null | undefined,
): boolean {
  return Boolean(stat && anomalyTypeOfStat(stat))
}

/** 类2 的 5 个 stat（按类型顺序）；类1/3 返回空数组 */
export function anomalyStatsOfZone(zone: BuffStatZone): BuffStatKey[] {
  if (!zone.statsByType) return []
  return ANOMALY_DAMAGE_TYPES.map((type) => zone.statsByType?.[type]).filter(
    (stat): stat is BuffStatKey => Boolean(stat),
  )
}

/** 该类允许选择的第二级类型 */
export function allowedDamageTypesOf(zone: BuffStatZone): BuffDamageType[] {
  if (zone.lockedTypes) return [...zone.lockedTypes]
  if (zone.allowedTypes) return [...zone.allowedTypes]
  return [...BUFF_DAMAGE_TYPE_IDS]
}

/** 类1 锁死；类2/3 可勾 */
export function isZoneTypeLocked(zone: BuffStatZone): boolean {
  return Boolean(zone.lockedTypes?.length)
}

/** 某类型在类2 里对应的字段；类1/3 返回 zone.stat */
export function statForZoneType(
  zone: BuffStatZone,
  type: BuffDamageType | null | undefined,
): BuffStatKey | CustomBuffStatKey | undefined {
  if (zone.statsByType) {
    if (!type) return undefined
    return zone.statsByType[type]
  }
  return zone.stat
}

export interface ZoneStatRow {
  type?: BuffDamageType
  stat: BuffStatKey | CustomBuffStatKey
}

/**
 * 一行 → 数据层 N 条。
 *
 * - 类2：按勾选类型各一条；空选择 = 全部 5 条。
 * - 类1/类3：永远一条（类型只进 conditions，不改字段）。
 */
export function statRowsForZone(
  zone: BuffStatZone,
  selectedTypes: readonly BuffDamageType[] | null | undefined,
): ZoneStatRow[] {
  if (!zone.statsByType) {
    return zone.stat ? [{ stat: zone.stat }] : []
  }
  const allowed = allowedDamageTypesOf(zone)
  const picked = (selectedTypes ?? []).filter((type) => allowed.includes(type))
  const types = picked.length ? picked : allowed
  const out: ZoneStatRow[] = []
  for (const type of types) {
    const stat = zone.statsByType?.[type]
    if (stat) out.push({ type, stat })
  }
  return out
}

/** 类2 按 stat 集合反推类型集（保持界面顺序） */
export function zoneTypesOfStats(
  zone: BuffStatZone,
  stats: readonly (BuffStatKey | CustomBuffStatKey)[],
): BuffDamageType[] {
  if (!zone.statsByType) return []
  const statSet = new Set(stats)
  return ANOMALY_DAMAGE_TYPES.filter((type) => {
    const stat = zone.statsByType?.[type]
    return stat ? statSet.has(stat) : false
  })
}

/** 类2 是否覆盖全部 5 项 */
export function zoneHasAllAnomalyTypes(
  zone: BuffStatZone,
  stats: readonly (BuffStatKey | CustomBuffStatKey)[],
): boolean {
  if (!zone.statsByType) return false
  const selected = zoneTypesOfStats(zone, stats)
  return selected.length === ANOMALY_DAMAGE_TYPES.length
}

/** 类2 的“族”标识（用于老数据启发式聚合 / 合并校验） */
export function zoneFamilyKey(zone: BuffStatZone): string {
  return zone.statsByType ? `family:${zone.id}` : `stat:${zone.stat ?? zone.id}`
}

/** 判断一个类型是否允许在该 zone 选（类1 锁定 / 类2 只许异常） */
export function zoneAllowsType(zone: BuffStatZone, type: BuffDamageType): boolean {
  return allowedDamageTypesOf(zone).includes(type)
}

/** 兼容旧调用：异常类 5 项判断 */
export { isAnomalyDamageType }
