export const DAMAGE_CALC_SECTIONS = [
  { id: 'damage-calc-history', label: '方案库' },
  { id: 'damage-team', label: '队伍编组' },
  { id: 'damage-bangboo', label: '邦布' },
  { id: 'damage-combat-buff', label: '局内 Buff' },
  { id: 'damage-enemy', label: '敌方与环境' },
  { id: 'damage-calc-mode', label: '计算方式' },
  { id: 'skill-flow', label: '招式流程' },
] as const

/**
 * 侧栏「计算方式」下的子项。
 *
 * 2026-09-11 曾临时冻结「面板导入 / 词条导入」两项（冻结原因：它们原先会改掉算进伤害的
 * 那份面板，即「用按钮挑面板」这套第二状态干扰架构）。
 * 2026-09-12 已恢复：面板读取统一走 `resolveActivePanel`（唯一入口），模式不再影响取面板；
 * 词条功能的自动回写（换人刷转模、flush 词条输入）已全部删除，按钮恢复切换模式。
 */
export const DAMAGE_CALC_MODE_ITEMS = [
  { id: 'damage-calc-panel', label: '面板导入', calcMode: 'panel' as const, frozen: false },
  { id: 'damage-calc-affix', label: '词条导入', calcMode: 'affix' as const, frozen: false },
  { id: 'damage-calc-optimal', label: '最优词条分配', calcMode: 'optimal' as const, frozen: false },
] as const

export type DamageCalcSectionId =
  | (typeof DAMAGE_CALC_SECTIONS)[number]['id']
  | (typeof DAMAGE_CALC_MODE_ITEMS)[number]['id']

export type DamageCalcNavItem =
  | (typeof DAMAGE_CALC_SECTIONS)[number]
  | (typeof DAMAGE_CALC_MODE_ITEMS)[number]
