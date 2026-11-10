import { ZONE_DEFINITION_BY_KEY } from './catalog'
import type { ZoneResult } from './types'

/**
 * 带乘区结果的展示对象（即 `DamageCalcResult` 里可选附加的 `zones`）。
 * 只读取，不参与计算。
 */
export interface ZoneLabelSource {
  zones?: Record<string, ZoneResult> | undefined
}

/**
 * 乘区展示名：
 * 1. 优先取 `result.zones[key].label` —— 帷幕易伤等动态名称已在结果构建时覆盖；
 * 2. 其次取调用方给的 fallback（兼容没有 `zones` 的旧对象 / 局部结构）；
 * 3. 最后退回乘区注册表的默认名，避免展示层再硬编码一份名称。
 */
export function zoneLabel(
  result: ZoneLabelSource | null | undefined,
  key: string,
  fallback?: string,
): string {
  const label = result?.zones?.[key]?.label
  if (label) return label
  if (fallback) return fallback
  return ZONE_DEFINITION_BY_KEY.get(key)?.label ?? key
}

/**
 * 乘区展示顺序：按注册表 `order` 升序。
 * 只排序、不增删；记录形状先 `Object.values(result.zones)` 再传入。
 */
export function sortZonesByCatalog<T extends { order: number }>(zones: readonly T[]): T[] {
  return [...zones].sort((a, b) => a.order - b.order)
}
