/**
 * 计算器实体 ID 规则（角色 / 音擎 / 驱动盘 / 邦布通用）。
 *
 * ID 会被直接当成头像文件名与 URL 路径（`/drive_disc/{id}.webp`），所以只收
 * 半角字母数字与 `._&'-`，且必须以字母或数字开头；中文、空格、`+`、`#` 都会被后端
 * 拒绝（`无效的实体 ID`）。
 *
 * 与后端 `zzz-hp-backend/src/utils/calculatorPublicAsset.js` 的
 * `CALCULATOR_ENTITY_ID_SAFE_RE` 逐字对齐，改动请同步（`test-entity-id-rule` 会把关）。
 */
export const CALCULATOR_ENTITY_ID_SAFE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._&'-]*$/

export const CALCULATOR_ENTITY_ID_RULE_TEXT =
  'ID 只能包含字母 / 数字 / - _ & \' .，且以字母或数字开头（中文、空格、+、# 都不行）'

export function isValidCalculatorEntityId(id: string | null | undefined): boolean {
  const value = typeof id === 'string' ? id.trim() : ''
  return Boolean(value) && CALCULATOR_ENTITY_ID_SAFE_RE.test(value)
}

/** 保存前的友好报错；合法时返回空串 */
export function calculatorEntityIdError(id: string | null | undefined): string {
  const value = typeof id === 'string' ? id.trim() : ''
  if (!value) return '请先填写 ID'
  if (isValidCalculatorEntityId(value)) return ''
  return `ID「${value}」不能用作头像文件名：${CALCULATOR_ENTITY_ID_RULE_TEXT}`
}
