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
 * 「面板导入 / 词条导入」两个模式切换按钮**已永久删除**（2026-09-12，所有者口径）：
 * 它们不是导入功能（真正的导入在页面顶部「导入」按钮），只是会改掉算进伤害面板的
 * 第二状态干扰架构（曾因「局内攻击在 3883 / 6136 之间跳」冻结，后直接删除）。
 * 面板读取统一走 `resolveActivePanel`（唯一入口），与模式无关。
 * 模式只剩「最优词条分配」一个入口（进入 / 返回）。
 */
export const DAMAGE_CALC_MODE_ITEMS = [
  { id: 'damage-calc-optimal', label: '最优词条分配', calcMode: 'optimal' as const, frozen: false },
] as const

export type DamageCalcSectionId =
  | (typeof DAMAGE_CALC_SECTIONS)[number]['id']
  | (typeof DAMAGE_CALC_MODE_ITEMS)[number]['id']

export type DamageCalcNavItem =
  | (typeof DAMAGE_CALC_SECTIONS)[number]
  | (typeof DAMAGE_CALC_MODE_ITEMS)[number]
