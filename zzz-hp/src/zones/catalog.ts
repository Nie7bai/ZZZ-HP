import type { ZoneDefinition } from './types'

/**
 * 内置乘区清单（Phase 1a：与现有硬编码结果字段一一对应，仅登记名称与顺序）。
 *
 * 顺序只用于展示与后续处理；数值计算仍由 damageCalc 现有链路产生。
 * Phase 1b 起，逐条改由 `src/zones/builtins.ts` 的原语求值，本清单保持稳定。
 */
export const ZONE_DEFINITIONS: readonly ZoneDefinition[] = Object.freeze([
  { key: 'baseDamage', label: '基础伤害', order: 10, group: 'core', field: 'baseDamage', damageValue: true },
  { key: 'dmgMultiplier', label: '增伤区', order: 20, group: 'core', field: 'dmgMultiplier' },
  { key: 'defenseMultiplier', label: '防御区', order: 30, group: 'core', field: 'defenseMultiplier' },
  { key: 'resistanceMultiplier', label: '抗性区', order: 40, group: 'core', field: 'resistanceMultiplier' },
  { key: 'vulnerableMultiplier', label: '易伤区', order: 50, group: 'core', field: 'vulnerableMultiplier' },
  { key: 'staggerMultiplier', label: '失衡易伤区', order: 60, group: 'core', field: 'staggerMultiplier' },
  { key: 'generalMultiplier', label: '通用乘区', order: 70, group: 'core', field: 'generalMultiplier' },

  { key: 'critMultiplier', label: '暴击区', order: 80, group: 'direct', field: 'critMultiplier' },
  { key: 'sharpenCritZone', label: '锐爆区', order: 82, group: 'direct', field: 'sharpenCritZone' },
  { key: 'directDmgMultZone', label: '直伤倍率区', order: 90, group: 'direct', field: 'directDmgMultZone' },
  { key: 'settlementDmgMultZone', label: '决算倍率区', order: 92, group: 'direct', field: 'settlementDmgMultZone' },
  { key: 'pierceDmgMultiplier', label: '贯穿增伤区', order: 94, group: 'direct', field: 'pierceDmgMultiplier' },
  { key: 'sharpenDmgMultiplier', label: '锐化伤害提升区', order: 96, group: 'direct', field: 'sharpenDmgMultiplier' },

  { key: 'masteryZone', label: '精通区', order: 100, group: 'anomaly', field: 'masteryZone' },
  { key: 'levelZone', label: '等级区', order: 102, group: 'anomaly', field: 'levelZone' },
  { key: 'specialMultiplier', label: '特殊乘区', order: 104, group: 'core', field: 'specialMultiplier' },
  { key: 'specialMultZone', label: '特殊倍率乘区', order: 106, group: 'core', field: 'specialMultZone' },

  { key: 'attributeAnomalyDmgBonusZone', label: '属性异常增伤区', order: 120, group: 'anomaly', field: 'attributeAnomalyDmgBonusZone' },
  { key: 'attributeAnomalyMultZone', label: '属性异常倍率区', order: 122, group: 'anomaly', field: 'attributeAnomalyMultZone' },
  { key: 'attributeAnomalyCritZone', label: '属性异常暴击区', order: 124, group: 'anomaly', field: 'attributeAnomalyCritZone' },
  { key: 'anomalyReleaseDmgBonusZone', label: '异放增伤区', order: 130, group: 'anomaly', field: 'anomalyReleaseDmgBonusZone' },
  { key: 'anomalyReleaseMultZone', label: '异放倍率区', order: 132, group: 'anomaly', field: 'anomalyReleaseMultZone' },
  { key: 'anomalyReleaseCritZone', label: '异放暴击区', order: 134, group: 'anomaly', field: 'anomalyReleaseCritZone' },
  { key: 'disorderDmgBonusZone', label: '紊乱增伤区', order: 140, group: 'anomaly', field: 'disorderDmgBonusZone' },
  { key: 'disorderZone', label: '紊乱倍率区', order: 142, group: 'anomaly', field: 'disorderZone' },
  { key: 'disorderCritZone', label: '紊乱暴击区', order: 144, group: 'anomaly', field: 'disorderCritZone' },
  { key: 'turbulenceDmgBonusZone', label: '乱流增伤区', order: 150, group: 'anomaly', field: 'turbulenceDmgBonusZone' },
  { key: 'turbulenceZone', label: '乱流倍率区', order: 152, group: 'anomaly', field: 'turbulenceZone' },
  { key: 'turbulenceCritZone', label: '乱流暴击区', order: 154, group: 'anomaly', field: 'turbulenceCritZone' },
  { key: 'radianceDmgBonusZone', label: '耀变增伤区', order: 160, group: 'anomaly', field: 'radianceDmgBonusZone' },
  { key: 'radianceMultZone', label: '耀变倍率区', order: 162, group: 'anomaly', field: 'radianceMultZone' },
  { key: 'radianceCritZone', label: '耀变暴击区', order: 164, group: 'anomaly', field: 'radianceCritZone' },
  { key: 'mutationZone', label: '异化系数区', order: 170, group: 'anomaly', field: 'mutationZone' },

  { key: 'remielSelfInCombatAtk', label: '局内攻击力', order: 200, group: 'radianceSelf', field: 'remielSelfInCombatAtk', damageValue: true },
  { key: 'remielSelfInCombatMasteryZone', label: '局内精通区', order: 202, group: 'radianceSelf', field: 'remielSelfInCombatMasteryZone' },
  { key: 'remielSelfSpecialLevelZone', label: '特殊等级区', order: 204, group: 'radianceSelf', field: 'remielSelfSpecialLevelZone' },
  { key: 'remielSelfMutationZone', label: '异化系数区（本人耀变）', order: 206, group: 'radianceSelf', field: 'remielSelfMutationZone' },
  { key: 'remielSelfStandardLevelZone', label: '等级区（本人耀变）', order: 208, group: 'radianceSelf', field: 'remielSelfStandardLevelZone' },
  { key: 'remielSelfDefenseMultiplier', label: '防御区（本人耀变）', order: 210, group: 'radianceSelf', field: 'remielSelfDefenseMultiplier' },
  { key: 'remielSelfResistanceMultiplier', label: '抗性区（本人耀变）', order: 212, group: 'radianceSelf', field: 'remielSelfResistanceMultiplier' },
])

export const ZONE_DEFINITION_BY_KEY = new Map(ZONE_DEFINITIONS.map((zone) => [zone.key, zone]))
