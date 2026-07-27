/** 计算器统一显示/折算精度（小数点后位数） */
export const CALC_NUMBER_PRECISION = 4

export function roundCalc(value: number, precision = CALC_NUMBER_PRECISION): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

/**
 * 明确展示到指定小数位（默认 4 位）。
 * 大整数仍按整数展示；绝对值 ≥ 1000 的非整数保留至多 2 位以免过长。
 */
export function formatCalcDecimal(value: number, precision = CALC_NUMBER_PRECISION): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value) && Math.abs(value) < 1000) {
    return value.toLocaleString('en-US')
  }
  if (Math.abs(value) >= 1000) {
    return roundCalc(value, Math.min(precision, 2)).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.min(precision, 2),
    })
  }
  return roundCalc(value, precision).toFixed(precision)
}

/** 带符号的小数展示，转模/增益数值用 */
export function formatCalcSigned(value: number, precision = CALC_NUMBER_PRECISION): string {
  const rounded = roundCalc(value, precision)
  const body = formatCalcDecimal(Math.abs(rounded), precision)
  if (rounded > 0) return `+ ${body}`
  if (rounded < 0) return `-${body}`
  return formatCalcDecimal(0, precision)
}
