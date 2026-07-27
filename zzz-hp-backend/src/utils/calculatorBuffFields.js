/**
 * 计算器增益字段的唯一来源，供服务层与 scripts/ 下的迁移、导入、审计脚本共用。
 * 与前端 `zzz-hp/src/types/calculator.ts` 的 BuffStatModifiers / AgentBasePanel /
 * WengineAdvancedStats 保持一一对应；新增字段务必同时补到两边。
 */

export const BUFF_STAT_KEYS = [
  'hp',
  'inCombatHpPercent',
  'inCombatAtkPercent',
  'externalHpPercent',
  'externalAtkPercent',
  'atk',
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
  'vulnerable',
  'globalStaggerVulnerable',
  'staggerVulnerable',
  'staggerVulnerableOnly',
  'special',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyDmgBonus',
  'anomalyReleaseDmgBonus',
  'anomalyReleaseCritRate',
  'anomalyReleaseCritDmg',
  'anomalyReleaseMult',
  'directDmgMult',
  'anomalyMult',
  'disorderBaseMult',
  'anomalyDuration',
  'disorderCompMult',
  'turbulenceBaseMult',
  'turbulenceCompMult',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
  'skillDmgBonus',
  'skillMultiplierBonus',
  'directDmgMultFactor',
  'anomalyMultFactor',
  'anomalyReleaseMultFactor',
  'disorderBaseMultFactor',
  'turbulenceBaseMultFactor',
]

export const AGENT_BASE_PANEL_KEYS = [
  'hp',
  'atk',
  'def',
  'critRate',
  'critDmg',
  'mastery',
  'anomalyControl',
  'energyRegen',
  'penRate',
  'dmgBonus',
  'pen',
  'anomalyCritRate',
  'anomalyCritDmg',
  'anomalyDmgBonus',
  'directDmgMult',
  'anomalyMult',
  'disorderBaseMult',
  'anomalyDuration',
  'disorderCompMult',
  'turbulenceBaseMult',
  'turbulenceCompMult',
  'disorderDmgBonus',
  'turbulenceDmgBonus',
]

export const WENGINE_ADVANCED_STAT_KEYS = [
  'critRate',
  'critDmg',
  'anomalyControlPercent',
  'energyRegen',
  'mastery',
  'externalAtkPercent',
  'externalHpPercent',
  'penRate',
]

export function readNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export function createEmptyBuffStatModifiers() {
  return Object.fromEntries(
    BUFF_STAT_KEYS.map((key) => [
      key,
      ['directDmgMultFactor', 'anomalyMultFactor', 'anomalyReleaseMultFactor', 'disorderBaseMultFactor', 'turbulenceBaseMultFactor'].includes(key)
        ? 1
        : 0,
    ]),
  )
}

export function createEmptyAgentBasePanel() {
  const panel = Object.fromEntries(AGENT_BASE_PANEL_KEYS.map((key) => [key, 0]))
  panel.directDmgMult = 100
  return panel
}

export function createEmptyWengineAdvancedStats() {
  return Object.fromEntries(WENGINE_ADVANCED_STAT_KEYS.map((key) => [key, 0]))
}

export function normalizeBuffStatModifiers(value) {
  const result = createEmptyBuffStatModifiers()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of BUFF_STAT_KEYS) {
    result[key] = readNumber(value[key])
  }
  if (readNumber(value.externalAtkPercent) && !result.inCombatAtkPercent) {
    result.inCombatAtkPercent = readNumber(value.externalAtkPercent)
  }
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
  mods.inCombatHpPercent = 0
  mods.inCombatAtkPercent = 0
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
