/** 倍率修正区默认 100%（×1） */
export const DEFAULT_MULT_FACTOR_PERCENT = 100

/** 面板倍率修正：旧数据 1 / 1.2 等乘数格式迁移为百分点 */
export function normalizePanelMultFactorPercent(value: number | undefined | null): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_MULT_FACTOR_PERCENT
  if (num <= 10) return num * 100
  return num
}

/** 增益倍率修正：旧数据按「已减 1」增量（0.2 = +20%）迁移为百分点 */
export function normalizeBuffMultFactorDelta(value: number | undefined | null): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num === 0) return 0
  if (Math.abs(num) <= 5 && !Number.isInteger(num)) return num * 100
  return num
}

/** 面板倍率修正 + 增益倍率修正（均为百分点） */
export function combineMultFactorPercent(
  base: number | undefined | null,
  delta: number | undefined | null,
): number {
  const safeBase = normalizePanelMultFactorPercent(base)
  const safeDelta = normalizeBuffMultFactorDelta(delta)
  return safeBase + safeDelta
}

/** 倍率修正区乘数 = 百分点 / 100 */
export function multFactorPercentToRatio(value: number | undefined | null): number {
  return Math.max(0, normalizePanelMultFactorPercent(value) / 100)
}
