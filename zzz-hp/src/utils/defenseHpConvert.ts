/** 代理人 60 级防御区常数 */
export const DEFENSE_LEVEL_CONSTANT = 794

/** 危局常用对照防御 */
export const REFERENCE_DEFENSE_953 = 953

/**
 * 将给定防御下的血量换算为 953 防御时的等效血量。
 * 按同等有效血量：HP × (794 + DEF) / (794 + 953)
 */
export function convertHpToDefense953(
  hp: number,
  defense: number,
  levelConstant = DEFENSE_LEVEL_CONSTANT,
  referenceDefense = REFERENCE_DEFENSE_953,
): number {
  const hpValue = Number(hp)
  const defValue = Number(defense)
  if (!Number.isFinite(hpValue) || hpValue < 0) return 0
  if (!Number.isFinite(defValue) || defValue < 0) return hpValue
  return (hpValue * (levelConstant + defValue)) / (levelConstant + referenceDefense)
}

export function roundConvertedHp(value: number): number {
  return Math.round(value)
}
