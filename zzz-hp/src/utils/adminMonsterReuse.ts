/**
 * 管理端怪物复用：等级仅在当前未设置时填入候选值；
 * 已有等级且与候选不同则保留（同名不同级常见于各期/各层）。
 */
export function applyReusedMonsterLevel(
  current: number | string | null | undefined,
  picked: number | string | null | undefined,
): number {
  const pickedNum = Number(picked)
  const currentNum = Number(current)
  if (!pickedNum || pickedNum <= 0 || !Number.isFinite(pickedNum)) {
    return currentNum > 0 && Number.isFinite(currentNum) ? currentNum : 0
  }
  if (!currentNum || currentNum <= 0 || !Number.isFinite(currentNum)) return pickedNum
  if (currentNum === pickedNum) return currentNum
  return currentNum
}
