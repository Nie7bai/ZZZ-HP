import type { DamageCalcResult } from '@/utils/damageCalc'
import { ZONE_DEFINITIONS } from './catalog'
import type { ZoneResult } from './types'

/** 帷幕易伤启用时，失衡易伤区改用带上限的展示名 */
function staggerZoneLabel(result: Pick<DamageCalcResult, 'staggerZoneKind' | 'staggerZoneCap'>): string {
  if (result.staggerZoneKind !== 'curtain') return '失衡易伤区'
  const cap = result.staggerZoneCap
  return cap != null ? `帷幕易伤区（上限 ${Math.round(cap * 100)}%）` : '帷幕易伤区'
}

/**
 * 把现有 `DamageCalcResult` 的数值映射成乘区结果（Phase 1a）。
 *
 * 只读取已有字段，不参与计算；缺失/非有限值的字段跳过。
 * Phase 1b 起改为由乘区原语求值后填充，本函数的输出结构保持不变。
 */
export function buildZoneResults(result: DamageCalcResult): Record<string, ZoneResult> {
  const zones: Record<string, ZoneResult> = {}
  for (const definition of ZONE_DEFINITIONS) {
    const value = definition.field ? result[definition.field] : undefined
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    zones[definition.key] = {
      key: definition.key,
      label: definition.key === 'staggerMultiplier' ? staggerZoneLabel(result) : definition.label,
      order: definition.order,
      group: definition.group,
      value,
    }
  }
  return zones
}
