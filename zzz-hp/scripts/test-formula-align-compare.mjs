/**
 * 对照：用手算期望值核对 fix/calc-formula-align 的易伤/减伤、失衡、floor/trunc、直伤/异常链。
 * 运行：npx vite-node scripts/test-formula-align-compare.mjs
 */
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import {
  computeDamageResult,
  computeLevelZone,
  computeVulnerableZone,
} from '../src/utils/damageCalc.ts'
import { effectiveAnomalyDuration } from '../src/utils/calculatorUi.ts'

let failed = 0
let passed = 0

function nearly(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps
}

function check(name, actual, expected, eps = 1e-9) {
  const ok = nearly(actual, expected, eps)
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}: ${actual} == ${expected}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}: actual=${actual} expected=${expected}`)
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`)
}

section('1. 等级区 trunc(..., 4)')
check('lv60', computeLevelZone(60), Math.trunc((1 + 59 / 59) * 10000) / 10000)
check('lv59', computeLevelZone(59), Math.trunc((1 + 58 / 59) * 10000) / 10000)
// 旧实现全精度 vs 新 trunc：lv59 有极小差
const oldLv59 = 1 + 58 / 59
const newLv59 = computeLevelZone(59)
console.log(`  INFO  lv59 旧全精度=${oldLv59} 新trunc=${newLv59} Δ=${oldLv59 - newLv59}`)

section('2. 紊乱有效时间：先 ÷0.5（火/以太）再 floor')
check('冰 9.8s', effectiveAnomalyDuration(9.8, '冰'), 9)
check('火 9.8s', effectiveAnomalyDuration(9.8, '火'), Math.floor(9.8 / 0.5))
check('以太 10s', effectiveAnomalyDuration(10, '以太'), 20)
check('物理 10.2s', effectiveAnomalyDuration(10.2, '物理'), 10)
// 对照：若先 floor 再 ÷0.5（错误顺序）火 9.8 → 18；正确是 19
console.log(
  `  INFO  火9.8 正确floor(9.8/0.5)=${Math.floor(9.8 / 0.5)}；错误floor(9.8)/0.5再floor=${Math.floor(Math.floor(9.8) / 0.5)}`,
)

section('3. 易伤区：通用 + 路径 − 减伤')
check(
  '仅通用易伤30%',
  computeVulnerableZone({
    enemyVulnerableBase: 1,
    generalVulnerablePercent: 30,
    pathVulnerablePercent: 0,
    generalReductionPercent: 0,
    pathReductionPercent: 0,
  }),
  1.3,
)
check(
  '直伤：通用30 + 直伤20 − 减伤10 − 直伤减伤5',
  computeVulnerableZone({
    enemyVulnerableBase: 1,
    generalVulnerablePercent: 30,
    pathVulnerablePercent: 20,
    generalReductionPercent: 10,
    pathReductionPercent: 5,
  }),
  1.35,
)
check(
  '非直伤：通用30 + 非直伤40 − 减伤10',
  computeVulnerableZone({
    enemyVulnerableBase: 1,
    generalVulnerablePercent: 30,
    pathVulnerablePercent: 40,
    generalReductionPercent: 10,
    pathReductionPercent: 0,
  }),
  1.6,
)

section('4. 完整结算：直伤 vs 异常 分路径易伤')

const panel = createDefaultExternalPanel()
panel.atk = 3000
panel.dmgBonus = 50 // 增伤区 1.5
panel.critRate = 50
panel.critDmg = 100 // 期望暴击区 1 + 0.5*1 = 1.5
panel.penRate = 0
panel.pen = 0
panel.resPen = 0
panel.mastery = 300 // 精通区 3
panel.anomalyMult = 500 // 异常倍率 5
panel.anomalyDmgBonus = 0
panel.directDmgMult = 100
panel.anomalyDuration = 9.8
panel.disorderBaseMult = 450
panel.disorderCompMult = 7.5

const enemy = {
  defense: 794, // 防御区 = 794/(794+794) = 0.5
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 1.5,
  specialMultiplier: 1,
  level: 60,
}

const combat = {
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
}

// 手算乘区
const dmgZone = 1.5
const defZone = 794 / (794 + 794)
const resZone = 1
const directVuln = 1 + 0.3 + 0.2 - 0.1 - 0.05 // 1.35
const anomalyVuln = 1 + 0.3 + 0.4 - 0.1 // 1.6
const staggerOn = 1.5 + 0.25 + 0.1 + 0.05 // 1.9
const staggerOff = 1 + 0.25 // 1.25
const critZone = 1.5
const special = 1
const levelZone = computeLevelZone(60) // 2
const masteryZone = 3
const anomalyMult = 5

const generalOn =
  3000 * dmgZone * defZone * resZone * staggerOn
const generalOff =
  3000 * dmgZone * defZone * resZone * staggerOff

const expectedDirectOn =
  generalOn * directVuln * critZone * special * 1 * 1
const expectedAnomalyOn =
  generalOn * anomalyVuln * masteryZone * levelZone * special * 1 * anomalyMult

const resultStagger = computeDamageResult({
  finalPanel: panel,
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: enemy,
  ...combat,
  combatStaggerVulnerable: combat.combatStaggerVulnerable,
  staggerPhase: 'stagger',
  ownerAgentLevel: 60,
  anomalySubKind: 'anomaly',
})

const resultNormal = computeDamageResult({
  finalPanel: panel,
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: enemy,
  ...combat,
  combatStaggerVulnerable: combat.combatStaggerVulnerable,
  staggerPhase: 'normal',
  ownerAgentLevel: 60,
  anomalySubKind: 'anomaly',
})

check('失衡期·直伤易伤区', resultStagger.directVulnerableMultiplier, directVuln)
check('失衡期·非直伤易伤区', resultStagger.anomalyVulnerableMultiplier, anomalyVuln)
check('失衡期·失衡易伤区', resultStagger.staggerMultiplier, staggerOn)
check('非失衡·失衡易伤区', resultNormal.staggerMultiplier, staggerOff)
check('失衡期·通用乘区(不含易伤)', resultStagger.generalMultiplier, Math.round(generalOn * 100) / 100, 0.02)
check(
  '失衡期·直伤期望',
  resultStagger.directDamageExpected,
  Math.round(expectedDirectOn),
  1,
)

// 异常期望：无 trigger 时用 mainParts；anomalyExpected 含 anomalyCritZone=1
check(
  '失衡期·异常期望(无暴击区)',
  resultStagger.anomalyExpected,
  Math.round(expectedAnomalyOn),
  2,
)

const expectedAnomalyOff =
  generalOff * anomalyVuln * masteryZone * levelZone * special * anomalyMult
check(
  '非失衡·异常期望',
  resultNormal.anomalyExpected,
  Math.round(expectedAnomalyOff),
  2,
)

section('5. 旧行为对照（非失衡全局失衡易伤）')
// 旧：非失衡固定 1；新：1+global
const oldGeneralOff = 3000 * dmgZone * defZone * resZone * 1
const oldAnomalyOff =
  oldGeneralOff * anomalyVuln * masteryZone * levelZone * special * anomalyMult
console.log(
  `  INFO  非失衡异常：旧(区=1)≈${Math.round(oldAnomalyOff)} 新(区=1.25)≈${resultNormal.anomalyExpected} 比= ${(resultNormal.anomalyExpected / oldAnomalyOff).toFixed(4)}`,
)
check(
  '非失衡相对旧值倍率应为 1.25',
  resultNormal.anomalyExpected / oldAnomalyOff,
  1.25,
  1e-4,
)

section('6. 紊乱时间 floor 进倍率区')
panel.anomalyDuration = 9.8
const disorderResult = computeDamageResult({
  finalPanel: panel,
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: enemy,
  ...combat,
  combatStaggerVulnerable: combat.combatStaggerVulnerable,
  staggerPhase: 'stagger',
  ownerAgentLevel: 60,
  anomalySubKind: 'disorder',
  triggerFinalPanel: panel,
  triggerAgentElement: '冰',
  triggerAgentLevel: 60,
})
// 冰：floor(9.8)=9；倍率区 = 4.5 + 9*0.075 = 4.5 + 0.675 = 5.175
check('冰紊乱有效时间', disorderResult.effectiveAnomalyDuration, 9)
check('冰紊乱倍率区', disorderResult.disorderZone, 4.5 + 9 * 0.075, 1e-6)

const fireDisorder = computeDamageResult({
  finalPanel: { ...panel, anomalyDuration: 9.8 },
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: enemy,
  ...combat,
  combatStaggerVulnerable: combat.combatStaggerVulnerable,
  staggerPhase: 'stagger',
  ownerAgentLevel: 60,
  anomalySubKind: 'disorder',
  triggerFinalPanel: { ...panel, anomalyDuration: 9.8 },
  triggerAgentElement: '火',
  triggerAgentLevel: 60,
})
// 火：floor(9.8/0.5)=19；补偿默认火 50% → 但 panel.disorderCompMult 仍是 7.5（手填面板）
// 这里测的是 effectiveDuration，不是属性默认补偿
check('火紊乱有效时间', fireDisorder.effectiveAnomalyDuration, 19)

section('7. 路径隔离：直伤易伤不影响异常')
const onlyDirect = computeDamageResult({
  finalPanel: panel,
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: enemy,
  combatVulnerable: 0,
  combatDirectVulnerable: 50,
  combatAnomalyVulnerable: 0,
  combatDmgReduction: 0,
  combatDirectDmgReduction: 0,
  combatAnomalyDmgReduction: 0,
  combatGlobalStaggerVulnerable: 0,
  combatStaggerVulnerable: 0,
  combatStaggerVulnerableOnly: 0,
  combatSpecial: 0,
  staggerPhase: 'stagger',
  ownerAgentLevel: 60,
})
check('仅直伤易伤50%·直伤区', onlyDirect.directVulnerableMultiplier, 1.5)
check('仅直伤易伤50%·异常区仍为1', onlyDirect.anomalyVulnerableMultiplier, 1)

const onlyAnomaly = computeDamageResult({
  finalPanel: panel,
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: enemy,
  combatVulnerable: 0,
  combatDirectVulnerable: 0,
  combatAnomalyVulnerable: 50,
  combatDmgReduction: 0,
  combatDirectDmgReduction: 0,
  combatAnomalyDmgReduction: 0,
  combatGlobalStaggerVulnerable: 0,
  combatStaggerVulnerable: 0,
  combatStaggerVulnerableOnly: 0,
  combatSpecial: 0,
  staggerPhase: 'stagger',
  ownerAgentLevel: 60,
})
check('仅非直伤易伤50%·异常区', onlyAnomaly.anomalyVulnerableMultiplier, 1.5)
check('仅非直伤易伤50%·直伤区仍为1', onlyAnomaly.directVulnerableMultiplier, 1)

console.log(`\n结果: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
