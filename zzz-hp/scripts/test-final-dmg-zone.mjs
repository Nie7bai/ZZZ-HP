/**
 * 最终伤害区（finalDmgMultiplier）回归。
 *
 * 口径：全局最后一道独立乘区 = 1 + 最终伤害% / 100；
 * 直伤 / 命破 / 锋御 / 属性异常 / 异放 / 紊乱 / 乱流 / 耀变都乘，缺省 0 时乘区为 1（结果不变）。
 *
 * 运行：npx vite-node scripts/test-final-dmg-zone.mjs
 */
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import {
  BUFF_STAT_FIELDS,
  createEmptyBuffStatModifiers,
} from '../src/utils/calculatorUi.ts'
import { extractCombatMods } from '../src/utils/panelBuffCalc.ts'
import { BUFF_STAT_ZONES, allowedDamageTypesOf } from '../src/utils/buffStatZones.ts'
import { buildSkillCalcZoneRows } from '../src/utils/skillCalcZones.ts'
import { buildPipelineStageRows } from '../src/zones/display.ts'

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function near(actual, expected, tolerance = 2) {
  return Math.abs(actual - expected) <= tolerance
}

function basePanel() {
  const panel = createDefaultExternalPanel()
  panel.atk = 3000
  panel.def = 1500
  panel.dmgBonus = 50
  panel.critRate = 50
  panel.critDmg = 100
  panel.mastery = 300
  panel.directDmgMult = 100
  panel.disorderBaseMult = 700
  panel.disorderCompMult = 125
  panel.anomalyDuration = 13
  panel.attributeAnomalyMult = 500
  panel.radianceMult = 100
  panel.turbulenceBaseMult = 100
  panel.anomalyReleaseMult = 100
  return panel
}

function makeInput(overrides = {}) {
  const panel = basePanel()
  return {
    finalPanel: panel,
    triggerFinalPanel: panel,
    anomalyTriggerPanel: panel,
    piercePower: 1200,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    useSharpenFormula: false,
    enemyInput: {
      defense: 953,
      resistanceType: 'normal',
      vulnerableMultiplier: 1,
      staggerMultiplier: 1.5,
      specialMultiplier: 1,
      level: 60,
    },
    combatVulnerable: 0,
    combatDirectVulnerable: 0,
    combatAnomalyVulnerable: 0,
    combatDmgReduction: 0,
    combatDirectDmgReduction: 0,
    combatAnomalyDmgReduction: 0,
    combatGlobalStaggerVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatStaggerVulnerableOnly: 0,
    combatSpecial: 0,
    combatPierceDmgBonus: 0,
    combatSharpenDmgBonus: 0,
    combatDmgPenalty: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    ...overrides,
  }
}

/** 链路 / 事件 → 该事件最终期望字段 */
const CASES = [
  ['纯直伤', { chainId: 'direct' }, 'directDamageExpected', 'direct'],
  [
    '锋御锐化',
    { chainId: 'sharpen', baseDamageSource: 'def', useSharpenFormula: true },
    'directDamageExpected',
    'sharpen',
  ],
  [
    '命破',
    { chainId: 'pierce', baseDamageSource: 'pierce', isMbMainAgent: true },
    'directDamageExpected',
    'direct',
  ],
  [
    '属性异常',
    { anomalySubKind: 'attributeAnomaly', eventDamageType: 'attributeAnomaly' },
    'attributeAnomalyExpected',
    'attributeAnomaly',
  ],
  [
    '紊乱',
    { anomalySubKind: 'disorder', eventDamageType: 'disorder' },
    'disorderExpected',
    'disorder',
  ],
  [
    '乱流',
    { anomalySubKind: 'turbulence', eventDamageType: 'turbulence' },
    'turbulenceExpected',
    'turbulence',
  ],
  [
    '异放',
    { anomalySubKind: 'anomalyRelease', eventDamageType: 'anomalyRelease' },
    'anomalyReleaseExpected',
    'anomalyRelease',
  ],
  [
    '耀变',
    { anomalySubKind: 'radiance', eventDamageType: 'radiance' },
    'radianceExpected',
    'radiance',
  ],
]

for (const [label, overrides, field, damageType] of CASES) {
  const baseline = computeDamageResult(makeInput(overrides))
  const withFinal = computeDamageResult(makeInput({ ...overrides, combatFinalDmgBonus: 50 }))
  check(
    `${label}：最终伤害区 = 1 + 50% = 1.5`,
    withFinal.finalDmgMultiplier === 1.5,
    `实际 ${withFinal.finalDmgMultiplier}`,
  )
  check(
    `${label}：期望伤害按 1.5 缩放`,
    baseline[field] > 0 && near(withFinal[field], baseline[field] * 1.5),
    `${baseline[field]} → ${withFinal[field]}`,
  )
  check(
    `${label}：未填最终伤害时乘区 = 1`,
    baseline.finalDmgMultiplier === 1,
    `实际 ${baseline.finalDmgMultiplier}`,
  )
  const stage = withFinal.pipeline?.stages.find((item) => item.id === 'finalDmg')
  check(
    `${label}：链路阶段含最终伤害区且值为 1.5`,
    stage?.label === '最终伤害区' && stage.value === 1.5,
    JSON.stringify(stage ?? null),
  )
  const rows = buildSkillCalcZoneRows(withFinal, damageType)
  check(
    `${label}：计算过程出现「最终伤害区」行`,
    rows.some((row) => row.label === '最终伤害区'),
    rows.map((row) => row.label).join(' / '),
  )
}

/** 无增益时不占位：既不出现阶段行，也不出现计算过程行 */
const plainDisorder = computeDamageResult(makeInput({ anomalySubKind: 'disorder', eventDamageType: 'disorder' }))
check(
  '无增益：计算过程不出现「最终伤害区」行',
  !buildSkillCalcZoneRows(plainDisorder, 'disorder').some((row) => row.label === '最终伤害区'),
)
check(
  '无增益：链路阶段值为 1（仍列出，但乘区为 1）',
  (plainDisorder.pipeline?.stages ?? []).find((stage) => stage.id === 'finalDmg')?.value === 1,
)
check(
  '无增益：链路展示行数值为 1',
  buildPipelineStageRows(plainDisorder).find((row) => row.id === 'finalDmg')?.valueText === '1',
)

/** 数据通路：字段 / 空修饰 / 战斗修饰 */
const fields = BUFF_STAT_FIELDS.filter((field) => field.key === 'finalDmgBonus')
check(
  '增益字段：最终伤害已登记且为百分数',
  fields.length === 1 && fields[0].unit === 'percent' && fields[0].label === '最终伤害',
  JSON.stringify(fields[0] ?? null),
)
check('增益字段：空修饰默认 0', createEmptyBuffStatModifiers().finalDmgBonus === 0)
const mods = createEmptyBuffStatModifiers()
mods.finalDmgBonus = 25
check('战斗修饰：最终伤害透传', extractCombatMods(mods).finalDmgBonus === 25)

/** 管理端目录：不锁类型，8 个伤害类型都能选 */
const zone = BUFF_STAT_ZONES.find((item) => item.id === 'zone:finalDmgBonus')
check(
  '管理端乘区目录：最终伤害（全类型可选）',
  zone?.label === '最终伤害' &&
    !zone.lockedTypes &&
    allowedDamageTypesOf(zone).length === 8,
  JSON.stringify(zone ?? null),
)

console.log(`\n=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
