/**
 * 附加伤害（紊乱/极性紊乱）回归。
 *
 * 口径：每项 = round(提供者面板[来源属性] × 比例% / 100)，逐项求和；
 * 加在 `异常基础 × 紊乱倍率区` 之后、子类增伤与暴击之前，
 * 并补乘「异常基础 / 基础攻击」（除基础攻击外的全部基础乘区）。
 *
 * 运行：npx vite-node scripts/test-additional-damage.mjs
 */
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'

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

function makeInput(overrides = {}) {
  const panel = createDefaultExternalPanel()
  panel.atk = 2200
  panel.mastery = 300
  panel.dmgBonus = 40
  const producer = { ...panel, atk: 2600, mastery: 300 }
  const trigger = { ...panel, atk: 2400, mastery: 400 }
  return {
    chainId: 'disorder',
    eventDamageType: 'disorder',
    anomalySubKind: 'disorder',
    finalPanel: panel,
    triggerFinalPanel: producer,
    anomalyTriggerPanel: trigger,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
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

const base = computeDamageResult(makeInput())
check('无附加项：附加合计 = 0', base.additionalDamageFlat === 0, `${base.additionalDamageFlat}`)

const withTerm = computeDamageResult(
  makeInput({
    combatAdditionalDamage: [{ stat: 'mastery', ratioPercent: 3200 }],
  }),
)
check(
  '逐项 round：触发者精通 400 × 3200% = 12800',
  withTerm.additionalDamageFlat === 12800,
  `${withTerm.additionalDamageFlat}`,
)

const factor = base.anomalyBaseExpected / base.baseDamage
const expectedDelta =
  12800 * factor * base.disorderDmgBonusZone * base.disorderCritZone
const actualDelta = withTerm.disorderExpected - base.disorderExpected
check(
  '附加项补乘全部基础乘区 + 子类增伤 + 紊乱暴击',
  near(actualDelta, expectedDelta, 3),
  `实际 ${actualDelta} / 预期 ${expectedDelta}`,
)

const twoTerms = computeDamageResult(
  makeInput({
    combatAdditionalDamage: [
      { stat: 'mastery', ratioPercent: 3200 },
      { stat: 'atk', ratioPercent: 50 },
    ],
  }),
)
check(
  '多项逐项 round 后求和：12800 + round(2400×0.5)=14000',
  twoTerms.additionalDamageFlat === 14000,
  `${twoTerms.additionalDamageFlat}`,
)

const polarOnly = computeDamageResult(
  makeInput({
    combatAdditionalDamage: [{ stat: 'mastery', ratioPercent: 3200, onlyPolarDisorder: true }],
  }),
)
check(
  '仅极性紊乱：该招式不是极性紊乱时不计入',
  polarOnly.additionalDamageFlat === 0,
  `${polarOnly.additionalDamageFlat}`,
)

const noShift = computeDamageResult(makeInput())
check(
  '没有附加项时紊乱期望与基线一致',
  noShift.disorderExpected === base.disorderExpected,
)

console.log(`\n=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
