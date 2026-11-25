/**
 * 计算器增益字段的唯一来源，供服务层与 scripts/ 下的迁移、导入、审计脚本共用。
 * 与前端 `zzz-hp/src/types/calculator.ts` 的 BuffStatModifiers / AgentBasePanel /
 * WengineAdvancedStats 保持一一对应；新增字段务必同时补到两边。
 */

export const BUFF_STAT_KEYS = [
  'hp',
  'inCombatHpPercent',
  'inCombatAtkPercent',
  'inCombatDefPercent',
  'externalHpPercent',
  'externalAtkPercent',
  'externalDefPercent',
  'atk',
  'def',
  'dmgBonus',
  'critRate',
  'critDmg',
  'penRate',
  'reduceDefense',
  'resPen',
  'mastery',
  'anomalyControl',
  'anomalyControlPercent',
  'energyRegen',
  'energyRegenFlat',
  'pierce',
  'pierceDmgBonus',
  'sharpenDmgBonus',
  'sharpenCritDmgBonus',
  'dmgPenalty',
  'vulnerable',
  'directVulnerable',
  'anomalyVulnerable',
  'dmgReduction',
  'directDmgReduction',
  'anomalyDmgReduction',
  'globalStaggerVulnerable',
  'staggerVulnerable',
  'staggerVulnerableOnly',
  'special',
  'attributeAnomalyCritRate',
  'attributeAnomalyCritDmg',
  'attributeAnomalyDmgBonus',
  'anomalyReleaseDmgBonus',
  'anomalyReleaseCritRate',
  'anomalyReleaseCritDmg',
  // 子类专用暴击（用户 2026-10-16：暴击按子类拆开，各子类只吃自己的字段）
  'turbulenceCritRate',
  'turbulenceCritDmg',
  'radianceCritRate',
  'radianceCritDmg',
  'disorderCritRate',
  'disorderCritDmg',
  'anomalyReleaseMult',
  'directDmgMult',
  'settlementDmgMult',
  'attributeAnomalyMult',
  'disorderBaseMult',
  'anomalyDuration',
  'disorderCompMult',
  'turbulenceBaseMult',
  'turbulenceCompMult',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
  'radianceMult',
  'radianceDmgBonus',
  'radianceResPen',
  'specialMult',
  'mutationCoeff',
  'skillDmgBonus',
  'skillMultiplierBonus',
  'directDmgMultFactor',
  'attributeAnomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
  'radianceMultFactor',
  'specialMultFactor',
  'mutationCoeffFactor',
]

export const AGENT_BASE_PANEL_KEYS = [
  'hp',
  'atk',
  'def',
  'critRate',
  'critDmg',
  'sharpenCritDmgBonus',
  'mastery',
  'anomalyControl',
  'energyRegen',
  'penRate',
  'dmgBonus',
  'pen',
  'attributeAnomalyCritRate',
  'attributeAnomalyCritDmg',
  'attributeAnomalyDmgBonus',
  'turbulenceCritRate',
  'turbulenceCritDmg',
  'radianceCritRate',
  'radianceCritDmg',
  'disorderCritRate',
  'disorderCritDmg',
  'directDmgMult',
  'attributeAnomalyMult',
  'disorderBaseMult',
  'anomalyDuration',
  'disorderCompMult',
  'turbulenceBaseMult',
  'turbulenceCompMult',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
  'radianceMult',
  'radianceDmgBonus',
  'radianceResPen',
  'specialMult',
  'mutationCoeff',
]

export const WENGINE_ADVANCED_STAT_KEYS = [
  'critRate',
  'critDmg',
  'anomalyControlPercent',
  'energyRegen',
  'mastery',
  'externalAtkPercent',
  'externalHpPercent',
  'externalDefPercent',
  'penRate',
]

export const BUFF_MULT_FACTOR_KEYS = [
  'directDmgMultFactor',
  'attributeAnomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
  'radianceMultFactor',
  'specialMultFactor',
  'mutationCoeffFactor',
]

/**
 * 自定义乘区增益键（乘区定义 `stats` 登记）：`custom:` + 字母开头、字母/数字/下划线/点/连字符，slug ≤64。
 * 与前端 `zzz-hp/src/utils/buffEffect.ts` 的 `isCustomBuffStatKey` 同源。
 */
export const CUSTOM_BUFF_STAT_KEY_PATTERN = /^custom:[A-Za-z][A-Za-z0-9_.-]{0,63}$/

/** 是否为乘区定义登记的 `custom:<key>` 自定义增益键（内置键恒为 false） */
export function isCustomBuffStatKey(stat) {
  return typeof stat === 'string' && CUSTOM_BUFF_STAT_KEY_PATTERN.test(stat)
}

/** `custom:<key>` → `<key>`；非 custom / 格式非法返回 null */
export function customBuffStatFieldOf(stat) {
  return isCustomBuffStatKey(stat) ? stat.slice('custom:'.length) : null
}

/** 归一化 `custom` 修饰表：只保留合法键与有限数字 */
export function normalizeCustomBuffStatModifiers(value) {
  const custom = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return custom
  for (const [key, raw] of Object.entries(value)) {
    if (!isCustomBuffStatKey(`custom:${key}`)) continue
    const amount = Number(raw)
    if (!Number.isFinite(amount)) continue
    custom[key] = amount
  }
  return custom
}

export function readNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

/** 增益倍率修正百分点增量；历史脏数据 1（误当 ×1）归零 */
export function normalizeBuffMultFactorDelta(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num === 0) return 0
  if (num === 1) return 0
  return num
}

export function createEmptyBuffStatModifiers() {
  // Buff 增量：*Factor 空值默认 0（不是面板倍率 1）
  return Object.fromEntries(BUFF_STAT_KEYS.map((key) => [key, 0]))
}

export function createEmptyAgentBasePanel() {
  const panel = Object.fromEntries(AGENT_BASE_PANEL_KEYS.map((key) => [key, 0]))
  panel.directDmgMult = 100
  panel.specialMult = 100
  return panel
}

export function createEmptyWengineAdvancedStats() {
  return Object.fromEntries(WENGINE_ADVANCED_STAT_KEYS.map((key) => [key, 0]))
}

export function normalizeBuffStatModifiers(value) {
  const result = createEmptyBuffStatModifiers()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of BUFF_STAT_KEYS) {
    const raw = readNumber(value[key])
    result[key] = BUFF_MULT_FACTOR_KEYS.includes(key)
      ? normalizeBuffMultFactorDelta(raw)
      : raw
  }
  if (readNumber(value.externalAtkPercent) && !result.inCombatAtkPercent) {
    result.inCombatAtkPercent = readNumber(value.externalAtkPercent)
  }
  if (readNumber(value.externalDefPercent) && !result.inCombatDefPercent) {
    result.inCombatDefPercent = readNumber(value.externalDefPercent)
  }
  // 自定义乘区修饰表：合法键保留，非法键剔除（空表不落 `custom` 键，保持旧序列化形状）
  const custom = normalizeCustomBuffStatModifiers(value.custom)
  if (Object.keys(custom).length) result.custom = custom
  return result
}

/** 驱动盘 2 件套只提供局外属性，局内百分比统一归零 */
export function normalizeTwoPieceMods(value) {
  const mods = normalizeBuffStatModifiers(value)
  if (!mods.externalHpPercent && mods.inCombatHpPercent) {
    mods.externalHpPercent = mods.inCombatHpPercent
  }
  if (!mods.externalAtkPercent && mods.inCombatAtkPercent) {
    mods.externalAtkPercent = mods.inCombatAtkPercent
  }
  if (!mods.externalDefPercent && mods.inCombatDefPercent) {
    mods.externalDefPercent = mods.inCombatDefPercent
  }
  mods.inCombatHpPercent = 0
  mods.inCombatAtkPercent = 0
  mods.inCombatDefPercent = 0
  return mods
}

export function normalizeAgentBasePanel(value) {
  const result = createEmptyAgentBasePanel()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of AGENT_BASE_PANEL_KEYS) {
    result[key] = readNumber(value[key])
  }
  // 旧数据缺省直伤倍率时按 100%（×1）处理
  if (value.directDmgMult == null) {
    result.directDmgMult = 100
  }
  if (value.specialMult == null) {
    result.specialMult = 100
  }
  return result
}

export function normalizeWengineAdvancedStats(value) {
  const result = createEmptyWengineAdvancedStats()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of WENGINE_ADVANCED_STAT_KEYS) {
    result[key] = readNumber(value[key])
  }
  return result
}
