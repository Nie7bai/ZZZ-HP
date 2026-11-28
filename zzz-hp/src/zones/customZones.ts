import type { ResolvedZoneScheme } from './scheme'

/**
 * 自定义乘区求值（Phase 3b）。
 *
 * percentSum 将百分比加到 1，scaledPercentSum 先用第二组百分比放大第一组。
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
  scaledPercentInputs?: ScaledPercentZoneInputs
}

export interface ScaledPercentZoneInputs {
  basePercent: number
  scalingPercent: number
  unboundedFactor: number
}

function readNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function isCustomPercentModule(module: string | undefined): boolean {
  return module === 'percentSum' || module === 'scaledPercentSum'
}

function sumPercents(keys: unknown, mods: Record<string, number>): number {
  if (!Array.isArray(keys)) return 0
  let sum = 0
  for (const key of keys) {
    if (typeof key !== 'string' || !key.length) continue
    sum += readNumber(mods[key]) ?? 0
  }
  return sum
}

/** 是否需要按来源归属取模（`team` / `owner`，`all` 用聚合表）。 */
export function zoneSchemeNeedsProviderTracking(
  resolved: ResolvedZoneScheme | null | undefined,
  zoneProviders: Record<string, string> | null | undefined,
): boolean {
  if (!resolved) return false
  for (const [key, entry] of Object.entries(resolved.entries)) {
    if (!isCustomPercentModule(entry.module)) continue
    const statKeys = entry.params?.statKeys
    if (!Array.isArray(statKeys) || !statKeys.length) continue
    if ((zoneProviders?.[key] ?? 'team') !== 'all') return true
  }
  return false
}

/** 从方案解析结果里取出百分比自定义乘区并求值。 */
export function evaluateCustomZoneFactors(
  resolved: ResolvedZoneScheme | null | undefined,
  customMods: Record<string, number> | null | undefined,
  options: CustomZoneProviderOptions = {},
): CustomZoneFactor[] {
  if (!resolved) return []
  const aggregate = customMods ?? {}
  const factors: CustomZoneFactor[] = []

  for (const [key, entry] of Object.entries(resolved.entries)) {
    if (!isCustomPercentModule(entry.module)) continue
    const params = entry.params ?? {}
    if (!Array.isArray(params.statKeys) || !params.statKeys.some((key) => typeof key === 'string' && key.length)) continue

    const providerMode = (options.zoneProviders?.[key] ?? 'team') as ZoneProviderMode
    const mods = options.customModsByProvider?.[providerMode] ?? aggregate
    const basePercent = sumPercents(params.statKeys, mods)
    const scaled = entry.module === 'scaledPercentSum'
    const scalingPercent = scaled ? sumPercents(params.scalingStatKeys, mods) : 0
    const unboundedFactor = 1 + (basePercent / 100) * (1 + scalingPercent / 100)

    let factor = unboundedFactor
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
      ...(scaled ? { scaledPercentInputs: { basePercent, scalingPercent, unboundedFactor } } : {}),
    })
  }

  return factors.sort((a, b) => a.order - b.order)
}

/** 编译成链路阶段的自定义乘区（只读展示/求值用的阶段形状） */
export interface CustomZoneStageDefinition {
  id: string
  kind: 'multiplier'
  label: string
  group: 'scheme'
  order: number
  module: string
  params: Record<string, unknown>
}

/**
 * `providers: 'all'` 的百分比自定义乘区 → 链路阶段。
 *
 * 这类乘区不看来源归属，直接用聚合的 `custom` 修饰表求值，所以可以像普通阶段一样
 * 插进链路、与阶段一起连乘；按 owner/team 取模的乘区仍需走 `evaluateCustomZoneFactors`。
 */
export function customZoneStageEntries(
  resolved: ResolvedZoneScheme | null | undefined,
  zoneProviders?: Record<string, string> | null,
): CustomZoneStageDefinition[] {
  if (!resolved) return []
  const stages: CustomZoneStageDefinition[] = []
  for (const [key, entry] of Object.entries(resolved.entries)) {
    if (!isCustomPercentModule(entry.module)) continue
    if ((zoneProviders?.[key] ?? 'team') !== 'all') continue
    const params = entry.params ?? {}
    const statKeys = params.statKeys
    if (!Array.isArray(statKeys) || !statKeys.some((item) => typeof item === 'string' && item.length)) {
      continue
    }
    stages.push({
      id: key,
      kind: 'multiplier',
      label: entry.label ?? key,
      group: 'scheme',
      order: readNumber(params.order) ?? 999,
      module: entry.module ?? '',
      params,
    })
  }
  return stages.sort((a, b) => a.order - b.order)
}
