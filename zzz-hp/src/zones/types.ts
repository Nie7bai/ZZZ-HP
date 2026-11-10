import type { DamageCalcResult } from '@/utils/damageCalc'

/** 乘区分组：用于展示分区与后续作用域过滤 */
export type ZoneGroup = 'core' | 'direct' | 'anomaly' | 'radianceSelf' | 'special' | 'custom'

/**
 * 乘区定义（Phase 1a：只登记元数据与结果字段，不改计算）。
 *
 * `field` 指向 `DamageCalcResult` 上已有的数值字段；Phase 1b 起逐步改为由原语求值。
 */
export interface ZoneDefinition {
  /** 稳定键，例如 dmgMultiplier */
  key: string
  /** 展示名（帷幕易伤等动态名称在结果构建时覆盖） */
  label: string
  /** 展示/处理顺序，升序 */
  order: number
  group: ZoneGroup
  /** 对应现有结果字段；缺省表示后续由原语计算 */
  field?: keyof DamageCalcResult
  /** 是否为伤害数值（展示时用整数千分位），否则按乘区小数 */
  damageValue?: boolean
}

/** 单条乘区结果，挂到 `DamageCalcResult.zones` */
export interface ZoneResult {
  key: string
  label: string
  order: number
  group: ZoneGroup
  /** 该乘区的数值（伤害类为数值，其余一般为倍率） */
  value: number
}
