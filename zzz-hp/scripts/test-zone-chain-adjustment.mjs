/**
 * 阶段调整影响结算（Phase 4f-2）。
 *
 * 禁用某个 multiplier 阶段 → 结算按 1/该阶段因子 缩放；
 * `params.adjustment = r` → 结算再乘 r。
 *
 * 运行：npx vite-node scripts/test-zone-chain-adjustment.mjs
 */
import assert from 'node:assert/strict'

import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { computeDamageResult } from '../src/utils/damageCalc.ts'

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

function closeTo(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≠ ${expected}（容差 ${tolerance}）`)
}

const panel = createDefaultExternalPanel()
panel.atk = 3000
panel.dmgBonus = 50
panel.critRate = 50
panel.critDmg = 100
panel.mastery = 300
panel.attributeAnomalyMult = 500
panel.directDmgMult = 100
panel.anomalyDuration = 9.8
panel.disorderBaseMult = 450
panel.disorderCompMult = 7.5

const baseInput = {
  finalPanel: panel,
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: {
    defense: 794,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1.5,
    specialMultiplier: 1,
    level: 60,
  },
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

console.log('[1] 禁用 multiplier 阶段')

check('禁用 crit → 直伤按 1/暴击区 缩放', () => {
  const disabled = computeDamageResult({ ...baseInput, chainDisabledStageIds: ['crit'] })
  closeTo(disabled.directDamageExpected, baseline.directDamageExpected / baseline.critMultiplier, 3, 'direct')
  closeTo(disabled.attributeAnomalyExpected, baseline.attributeAnomalyExpected / baseline.critMultiplier, 3, 'anomaly')
})

check('禁用多个阶段 → 依次相除', () => {
  const disabled = computeDamageResult({ ...baseInput, chainDisabledStageIds: ['crit', 'dmg'] })
  const expected = baseline.directDamageExpected / baseline.critMultiplier / baseline.dmgMultiplier
  closeTo(disabled.directDamageExpected, expected, 3, 'direct')
})

console.log('[2] 阶段 adjustment')

check('crit 阶段 adjustment=0.9 → 最终 ×0.9', () => {
  const adjusted = computeDamageResult({ ...baseInput, chainStageAdjustments: { crit: 0.9 } })
  closeTo(adjusted.directDamageExpected, baseline.directDamageExpected * 0.9, 3, 'direct')
  closeTo(adjusted.attributeAnomalyExpected, baseline.attributeAnomalyExpected * 0.9, 3, 'anomaly')
})

check('禁用 + adjustment 组合', () => {
  const both = computeDamageResult({
    ...baseInput,
    chainDisabledStageIds: ['dmg'],
    chainStageAdjustments: { crit: 0.8 },
  })
  const expected = baseline.directDamageExpected / baseline.dmgMultiplier * 0.8
  closeTo(both.directDamageExpected, expected, 3, 'direct')
})

check('无禁用/无 adjustment 时与基线完全一致', () => {
  const plain = computeDamageResult({ ...baseInput, chainDisabledStageIds: [], chainStageAdjustments: {} })
  assert.equal(plain.directDamageExpected, baseline.directDamageExpected)
  assert.equal(plain.attributeAnomalyExpected, baseline.attributeAnomalyExpected)
})

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
