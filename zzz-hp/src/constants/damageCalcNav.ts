export const DAMAGE_CALC_SECTIONS = [
  { id: 'damage-calc-history', label: '方案库' },
  { id: 'damage-team', label: '队伍编组' },
  { id: 'damage-bangboo', label: '邦布' },
  { id: 'damage-combat-buff', label: '局内 Buff' },
  { id: 'damage-enemy', label: '敌方与环境' },
  { id: 'damage-panel', label: '词条配比分析' },
  { id: 'skill-flow', label: '招式流程' },
  { id: 'damage-result', label: '事件详情' },
] as const

/**
 * 「面板导入 / 词条导入」两个模式切换按钮**已永久删除**（2026-09-12，所有者口径）：
 * 它们不是导入功能（真正的导入在页面顶部「导入」按钮），只是会改掉算进伤害面板的
 * 第二状态干扰架构（曾因「局内攻击在 3883 / 6136 之间跳」冻结，后直接删除）。
 * 面板读取统一走 `resolveActivePanel`（唯一入口），与模式无关。
 * 「词条配比分析」2026-09-13 起**常驻**：侧栏该项只作锚点滚动（#damage-panel）。
 *
 * 「事件详情」（2026-09-13 用户口径）锚定统一伤害结果区（`#damage-result`），
 * 排在「招式流程」下面。该区常驻、无需展开，故 `scrollToSection` 不给它特判分支；
 * 区块标题同步改名为「事件详情 · 产生者伤害占比」，与入口对齐。
 */

export type DamageCalcSectionId = (typeof DAMAGE_CALC_SECTIONS)[number]['id']

export type DamageCalcNavItem = (typeof DAMAGE_CALC_SECTIONS)[number]
