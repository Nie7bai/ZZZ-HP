import type { ResolvedZoneScheme } from './scheme'

/**
 * 自定义乘区求值（Phase 3b）。
 *
 * `percentSum` 口径：`1 + Σ(custom[statKey]) / 100`，可选上限 / 下限 / 是否允许负值。
 * 只读方案条目与 `custom` 修饰表（providers 生效时按 owner/team/all 选表，缺表回退聚合），
 * 不读全局状态、不写库。
 */
export type ZoneProviderMode = 'owner' | 'team' | 'all'

export interface CustomZoneProviderOptions {
  /** zoneKey → providers（来自乘区定义；缺省 team） */
  zoneProviders?: Record<string, string>
  /** 按来源范围拆分的 custom 修饰表；缺省用 aggregate */
  customModsByProvider?: Partial<Record<ZoneProviderMode, Record<string, number>>>
}

export interface CustomZoneFactor {
  key: string
  label: string
  /** 乘区因子（倍率） */
  value: number
  order: number
}

function readNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/** 是否存在需要按来源归属取模的 `percentSum` 乘区（`team` / `owner`；`all` 用聚合表即可） */
export function zoneSchemeNeedsProviderTracking(
  resolved: ResolvedZoneScheme | null | undefined,
  zoneProviders: Record<string, string> | null | undefined,
): boolean {
  if (!resolved) return false
  for (const [key, entry] of Object.entries(resolved.entries)) {
    if (entry.module !== 'percentSum') continue
    const statKeys = entry.params?.statKeys
    if (!Array.isArray(statKeys) || !statKeys.length) continue
    if ((zoneProviders?.[key] ?? 'team') !== 'all') return true
  }
  return false
}

/** 从方案解析结果里取出所有 `percentSum` 自定义乘区并求值 */
export function evaluateCustomZoneFactors(
  resolved: ResolvedZoneScheme | null | undefined,
  customMods: Record<string, number> | null | undefined,
  options: CustomZoneProviderOptions = {},
): CustomZoneFactor[] {
  if (!resolved) return []
  const aggregate = customMods ?? {}
  const factors: CustomZoneFactor[] = []

  for (const [key, entry] of Object.entries(resolved.entries)) {
    if (entry.module !== 'percentSum') continue
    const params = entry.params ?? {}
    const statKeys = Array.isArray(params.statKeys)
      ? params.statKeys.filter((statKey): statKey is string => typeof statKey === 'string' && statKey.length > 0)
      : []
    if (!statKeys.length) continue

    const providerMode = (options.zoneProviders?.[key] ?? 'team') as ZoneProviderMode
    const mods = options.customModsByProvider?.[providerMode] ?? aggregate
    let percent = 0
    for (const statKey of statKeys) {
      const value = readNumber(mods[statKey])
      if (value != null) percent += value
    }

    let factor = 1 + percent / 100
    const cap = readNumber(params.cap)
    if (cap != null && cap > 0) factor = Math.min(factor, cap)
    const floor = readNumber(params.floor)
    if (floor != null) factor = Math.max(factor, floor)
    if (params.allowNegative === false) factor = Math.max(0, factor)

    factors.push({
      key,
      label: entry.label ?? key,
      value: factor,
      order: readNumber(params.order) ?? 999,
    })
  }

  return factors.sort((a, b) => a.order - b.order)
}
