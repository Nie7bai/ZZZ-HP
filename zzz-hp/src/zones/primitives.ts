import type { PanelStats } from '@/types/calculatorPanel'

/**
 * 乘区求值原语（Phase 1c）。
 *
 * 纯函数、无副作用；`damageCalc` 继续 re-export 这些函数以保持既有调用点不变。
 * 数值口径与迁移前逐位一致（黄金对照 `test:zone-golden` 把关）。
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 防御区穿透率硬上限（百分点） */
export const PEN_RATE_CAP_PERCENT = 95

export function computeDefenseZone(options: {
  defensePanel: Pick<PanelStats, 'penRate' | 'pen' | 'ignoreDefense' | 'reduceDefense'>
  isMb: boolean
  enemyDefense: number
}) {
  const defense = options.defensePanel
  const penRateRatio = clamp(defense.penRate / 100, 0, PEN_RATE_CAP_PERCENT / 100)
  const ignoreDefenseRatio = clamp(defense.ignoreDefense / 100, 0, 1)
  const reduceDefenseRatio = clamp(defense.reduceDefense / 100, 0, 1)
  const defenseFactor = Math.max(0, 1 - ignoreDefenseRatio - reduceDefenseRatio)
  const defenseAfterModifiers = options.enemyDefense * defenseFactor * (1 - penRateRatio)
  const effectiveDefense = Math.max(0, defenseAfterModifiers - defense.pen)
  const defenseMultiplier = options.isMb ? 1 : 794 / (794 + effectiveDefense)
  return {
    penRateRatio,
    ignoreDefenseRatio,
    reduceDefenseRatio,
    defenseFactor,
    effectiveDefense,
    defenseMultiplier,
  }
}

export function computeLevelZone(level: number) {
  const safeLevel = clamp(Math.round(level), 1, 60)
  const raw = 1 + (safeLevel - 1) / 59
  return Math.trunc(raw * 10000) / 10000
}

/** 易伤区 = max(0, 敌人基础 + 通用易伤 + 路径易伤 − 通用减伤 − 路径减伤) */
export function computeVulnerableZone(options: {
  enemyVulnerableBase: number
  generalVulnerablePercent: number
  pathVulnerablePercent: number
  generalReductionPercent: number
  pathReductionPercent: number
}) {
  return Math.max(
    0,
    options.enemyVulnerableBase +
      options.generalVulnerablePercent / 100 +
      options.pathVulnerablePercent / 100 -
      options.generalReductionPercent / 100 -
      options.pathReductionPercent / 100,
  )
}

/** 锐爆期望区（r ≤ 1: 1 + r×B；r > 1: (1+B) × [1 + B×(r−1)]） */
export function computeSharpenCritExpectedZone(
  critRatePercent: number,
  sharpenCritDmgBonusPercent: number,
): number {
  const B = sharpenCritDmgBonusPercent / 100
  const r = clamp(critRatePercent / 100, 0, 2)
  if (r <= 1) return 1 + r * B
  return (1 + B) * (1 + B * (r - 1))
}

/** 锐爆必暴击区：首段强制暴击；溢出段仍按 (r−1) 期望 */
export function computeSharpenCritFullCritZone(
  critRatePercent: number,
  sharpenCritDmgBonusPercent: number,
): number {
  const B = sharpenCritDmgBonusPercent / 100
  const r = clamp(critRatePercent / 100, 0, 2)
  if (r <= 1) return 1 + B
  return (1 + B) * (1 + B * (r - 1))
}

/** 暴击三件套（期望 / 暴击率 / 暴击伤害比） */
export function computeCritZones(panel: Pick<PanelStats, 'critRate' | 'critDmg'>) {
  const critRateRatio = clamp(panel.critRate / 100, 0, 1)
  const critDmgRatio = clamp(panel.critDmg / 100, 0, 20)
  return {
    critRateRatio,
    critDmgRatio,
    critMultiplier: 1 + critRateRatio * critDmgRatio,
  }
}

/** 精通区：面板精通 ÷ 100 */
export function computeMasteryZone(panel: Pick<PanelStats, 'mastery'>): number {
  return panel.mastery / 100
}

/** 特殊乘区：敌人特殊倍率 + 战斗修饰% */
export function computeSpecialMultiplier(
  enemySpecialMultiplier: number,
  combatSpecialPercent: number,
): number {
  return enemySpecialMultiplier + combatSpecialPercent / 100
}
