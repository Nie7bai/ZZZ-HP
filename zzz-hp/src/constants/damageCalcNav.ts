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
 * 【临时冻结 · 2026-09-11】`frozen: true` 的两项（面板导入 / 词条导入）已停用：
 * 它们原先会改掉**算进伤害的那份面板**（同一份激活面板下，只因停在其中一个，
 * 局内攻击在 3883 / 6136 之间跳），即「用按钮挑面板」这套第二状态干扰架构。
 * 每份面板本身照常在「代理人 → 导入」里录入与保存，与这两个按钮无关。
 * 恢复：删掉这两项的 `frozen: true`（页面内同名按钮同步恢复，见 DamageCalcPage.vue）。
 */
export const DAMAGE_CALC_MODE_ITEMS = [
  { id: 'damage-calc-panel', label: '面板导入', calcMode: 'panel' as const, frozen: true },
  { id: 'damage-calc-affix', label: '词条导入', calcMode: 'affix' as const, frozen: true },
  { id: 'damage-calc-optimal', label: '最优词条分配', calcMode: 'optimal' as const, frozen: false },
] as const

export type DamageCalcSectionId =
  | (typeof DAMAGE_CALC_SECTIONS)[number]['id']
  | (typeof DAMAGE_CALC_MODE_ITEMS)[number]['id']

export type DamageCalcNavItem =
  | (typeof DAMAGE_CALC_SECTIONS)[number]
  | (typeof DAMAGE_CALC_MODE_ITEMS)[number]
