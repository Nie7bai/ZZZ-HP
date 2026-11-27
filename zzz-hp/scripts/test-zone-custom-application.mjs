/**
 * 自定义乘区接入伤害计算（Phase 3c）。
 *
 * 验证：不同伤害公式共用独立乘区的连乘因子，详情单列各区。
 * 未启用时结果与改造前完全一致。
 *
 * 运行：npx vite-node scripts/test-zone-custom-application.mjs
 */
import assert from 'node:assert/strict'

import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { buildSkillCalcZoneRows } from '../src/utils/skillCalcZones.ts'
import { buildAlignedDirectFormulaGroup } from '../src/utils/directDamageDisplay.ts'
import { buildAlignedAnomalyFormulaGroups } from '../src/utils/anomalyFormulaDisplay.ts'
import { buildPipelineStageRows } from '../src/zones/display.ts'

let passed = 0
let failed = 0
function check(name, run) {
  try {
    run()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`)
  }
}

const panel = createDefaultExternalPanel()
panel.atk = 3000
panel.def = 1400
panel.dmgBonus = 50
panel.critRate = 50
panel.critDmg = 100
panel.mastery = 300
panel.attributeAnomalyMult = 500
panel.directDmgMult = 100
panel.settlementDmgMult = 100
panel.anomalyReleaseMult = 100
panel.turbulenceBaseMult = 450
panel.turbulenceCompMult = 7.5
panel.radianceMult = 100
panel.anomalyDuration = 9.8
panel.disorderBaseMult = 450
panel.disorderCompMult = 7.5

const enemy = {
  defense: 794,
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 1.5,
  specialMultiplier: 1,
  level: 60,
}

const baseInput = {
  finalPanel: panel,
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: enemy,
  combatVulnerable: 30,
  combatDirectVulnerable: 20,
  combatAnomalyVulnerable: 40,
  combatDmgReduction: 10,
  combatDirectDmgReduction: 5,
  combatAnomalyDmgReduction: 0,
  combatGlobalStaggerVulnerable: 25,
  combatStaggerVulnerable: 10,
  combatStaggerVulnerableOnly: 5,
  combatSpecial: 0,
  combatPierceDmgBonus: 0,
  staggerPhase: 'stagger',
  ownerAgentLevel: 60,
  anomalySubKind: 'attributeAnomaly',
}

const baseline = computeDamageResult(baseInput)
const factor = { key: 'customElite', label: '对精英增伤区', value: 1.2, order: 150 }
const withZone = computeDamageResult({ ...baseInput, customZoneFactors: [factor] })

console.log('[1] 未启用自定义乘区时结果不变')

check('默认 zones 不含 custom 组；通用乘区与基线一致', () => {
  assert.equal(
    Object.values(baseline.zones ?? {}).some((zone) => zone.group === 'custom'),
    false,
  )
  assert.equal(withZone.generalMultiplier, baseline.generalMultiplier)
})

console.log('[2] 启用后成为独立的乘数')

check('直伤 / 异常期望伤害按 1.2 放大（按各自取整规则）', () => {
  closeTo(withZone.directDamageExpected, baseline.directDamageExpected * 1.2, 2)
  closeTo(withZone.attributeAnomalyExpected, baseline.attributeAnomalyExpected * 1.2, 2)
})

check('zones 增加 custom 条目，标签与数值正确', () => {
  const zone = withZone.zones?.customElite
  assert.ok(zone, '缺少 customElite')
  assert.equal(zone.group, 'custom')
  assert.equal(zone.label, '对精英增伤区')
  assert.equal(zone.value, 1.2)
  assert.equal(zone.order, 150)
})

check('多个自定义乘区按顺序连乘', () => {
  const two = computeDamageResult({
    ...baseInput,
    customZoneFactors: [factor, { key: 'customSecond', label: '第二乘区', value: 0.9, order: 160 }],
  })
  assert.equal(two.generalMultiplier, baseline.generalMultiplier)
  closeTo(two.directDamageExpected, baseline.directDamageExpected * 1.2 * 0.9, 2)
  const reversed = computeDamageResult({ ...baseInput, customZoneFactors: [{ key: 'customSecond', label: '第二乘区', value: 0.9, order: 160 }, factor] })
  assert.equal(two.directDamageExpected, reversed.directDamageExpected)
})

const numericChecks = [
  ['普通直伤', 'directDamageExpected', { eventDamageType: 'direct' }],
  ['决算', 'settlementDamageExpected', { eventDamageType: 'direct' }],
  ['命破', 'directDamageExpected', { eventDamageType: 'direct', piercePower: 3000, baseDamageSource: 'pierce', isMbMainAgent: true }],
  ['锋御', 'directDamageExpected', { eventDamageType: 'sharpen', baseDamageSource: 'def', useSharpenFormula: true }],
  ...['attributeAnomaly', 'anomalyRelease', 'disorder', 'turbulence', 'radiance'].map((kind) =>
    [kind, kind + 'Expected', { eventDamageType: kind, anomalySubKind: kind }],
  ),
  ['本人耀变', 'radianceExpected', {
    eventDamageType: 'radiance', anomalySubKind: 'radiance',
    remielSelfRadianceCalc: {
      agentLevel: 60, inCombatAtk: 3000, inCombatMastery: 300, mutationZone: 1.3,
      penRate: 0, pen: 0, resPen: 0, radianceResPen: 0, radianceDmgBonus: 0,
      attributeAnomalyDmgBonus: 0, resistanceElement: null, isMb: false,
    },
  }],
]

for (const [label, field, overrides] of numericChecks) {
  check(label + '：每个独立区各乘一次，独立显示', () => {
    const input = { ...baseInput, ...overrides }
    const without = computeDamageResult(input)
    const zoneFactors = [factor, { key: 'customSecond', label: '第二乘区', value: 1.3, order: 160 }]
    const withFactors = computeDamageResult({ ...input, customZoneFactors: zoneFactors })
    assert.ok(without[field] > 0)
    const variants = overrides.anomalySubKind ? [field, field + 'NoCrit', field + 'FullCrit'] : [field]
    for (const key of variants) closeTo(withFactors[key], without[key] * 1.2 * 1.3, 2)
    assert.equal(withFactors.generalMultiplier, without.generalMultiplier)
    assert.equal(withFactors.anomalyBaseExpected, without.anomalyBaseExpected)

    const rows = buildSkillCalcZoneRows(withFactors, overrides.eventDamageType)
    const formula = overrides.anomalySubKind
      ? buildAlignedAnomalyFormulaGroups(withFactors, overrides.anomalySubKind, '紊乱', String, String).at(-1)
      : buildAlignedDirectFormulaGroup(withFactors, String, String)
    for (const zone of zoneFactors) {
      assert.equal(rows.filter((row) => row.zoneKey === zone.key).length, 1)
      assert.equal(formula.terms.find((term) => term.tipsKey === zone.key)?.value, String(zone.value))
      assert.equal(buildPipelineStageRows(withFactors).filter((row) => row.id === zone.key).length, 1)
    }
  })
}

function closeTo(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}（容差 ${tolerance}）`)
}

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
