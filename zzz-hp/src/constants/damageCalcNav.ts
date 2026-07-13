export const DAMAGE_CALC_SECTIONS = [
  { id: 'damage-calc-history', label: '历史数据' },
  { id: 'damage-team', label: '队伍编组' },
  { id: 'damage-wengine', label: '音擎选择' },
  { id: 'damage-drive-disc', label: '驱动盘' },
  { id: 'damage-bangboo', label: '邦布' },
  { id: 'damage-calc-mode', label: '面板与伤害' },
] as const

export type DamageCalcSectionId = (typeof DAMAGE_CALC_SECTIONS)[number]['id']
