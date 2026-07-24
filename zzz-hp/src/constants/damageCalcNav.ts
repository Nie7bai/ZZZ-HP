export const DAMAGE_CALC_SECTIONS = [
  { id: 'damage-calc-history', label: '历史数据' },
  { id: 'damage-panel-upload', label: '图片录入' },
  { id: 'damage-team', label: '队伍编组' },
  { id: 'damage-wengine', label: '音擎选择' },
  { id: 'damage-drive-disc', label: '驱动盘' },
  { id: 'damage-bangboo', label: '邦布' },
] as const

/** 侧栏「计算方式」下的子项（面板 / 词条 / 最优分配） */
export const DAMAGE_CALC_MODE_ITEMS = [
  { id: 'damage-calc-panel', label: '面板计算', calcMode: 'panel' as const },
  { id: 'damage-calc-affix', label: '词条计算', calcMode: 'affix' as const },
  { id: 'damage-calc-optimal', label: '最优词条分配', calcMode: 'optimal' as const },
] as const

export type DamageCalcSectionId =
  | (typeof DAMAGE_CALC_SECTIONS)[number]['id']
  | (typeof DAMAGE_CALC_MODE_ITEMS)[number]['id']
  | 'damage-calc-mode'
  | 'damage-kind-context'

export type DamageCalcNavItem =
  | (typeof DAMAGE_CALC_SECTIONS)[number]
  | (typeof DAMAGE_CALC_MODE_ITEMS)[number]
