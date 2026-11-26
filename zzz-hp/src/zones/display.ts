import { formatCalcDecimal } from '@/utils/calcNumberFormat'
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

/** 阶段展示行（用户端只读「完整计算链路」） */
export interface PipelineStageDisplayRow {
  id: string
  kind: 'source' | 'multiplier' | 'combine' | 'final'
  label: string
  /** 已格式化的值：伤害类取整，乘数保留小数 */
  valueText: string
  /** 追加说明（如紊乱失衡易伤下限）：有值时在值后面单独显示 */
  note?: string
}

const DAMAGE_VALUE_STAGES = new Set(['base', 'selfAtk', 'final'])

function formatStageValue(value: number, isDamage: boolean): string {
  if (!Number.isFinite(value)) return '—'
  if (isDamage) return Math.round(value).toLocaleString('en-US')
  return formatCalcDecimal(value)
}

/**
 * 把 `result.pipeline.stages` 转成用户端展示行（只读）。
 * 不重新排序、不增删；顺序完全由链路阶段定义决定。
 */
export function buildPipelineStageRows(
  result: Pick<import('@/utils/damageCalc').DamageCalcResult, 'pipeline'> | null | undefined,
): PipelineStageDisplayRow[] {
  const stages = result?.pipeline?.stages ?? []
  const staggerFloor = result?.pipeline?.staggerFloor
  const staggerBase = result?.pipeline?.staggerBase
  return stages.map((stage) => {
    const isDamage = DAMAGE_VALUE_STAGES.has(stage.id)
    // 紊乱失衡易伤下限：链路里直接把「原值 → 抬后」和取 max 的依据写出来
    if (stage.id === 'stagger' && staggerFloor != null && Number.isFinite(staggerFloor)) {
      const base = Number.isFinite(staggerBase) ? Number(staggerBase) : stage.value
      return {
        id: stage.id,
        kind: stage.kind,
        label: stage.label,
        valueText: `${formatStageValue(base, isDamage)} → ${formatStageValue(stage.value, isDamage)}`,
        note: `紊乱失衡易伤下限 ${formatStageValue(staggerFloor, false)}（取 max）`,
      }
    }
    return {
      id: stage.id,
      kind: stage.kind,
      label: stage.label,
      valueText: formatStageValue(stage.value, isDamage),
    }
  })
}
