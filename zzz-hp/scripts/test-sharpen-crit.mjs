/**
 * 锐化 / 锐爆期望区与弱伤、防御词条对照。
 * 运行：npx vite-node scripts/test-sharpen-crit.mjs
 */
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import {
  computeDamageResult,
  computeSharpenCritExpectedZone,
  computeSharpenCritFullCritZone,
} from '../src/utils/damageCalc.ts'
import { AFFIX_DRIVE_DISC_SLOT_3_DEF } from '../src/utils/affixDriveDiscConfig.ts'
import { AFFIX_VALUE_PER_COUNT } from '../src/utils/affixPanelCalc.ts'

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

section('0. 驱动盘 / 词条常数')
check('3号位固有防御', AFFIX_DRIVE_DISC_SLOT_3_DEF, 184)
check('防御力副词条', AFFIX_VALUE_PER_COUNT.defFlat, 15)
check('局外防御%副词条', AFFIX_VALUE_PER_COUNT.defPercent, 4.8)

section('1. 锐爆期望区')
check('0% 暴击', computeSharpenCritExpectedZone(0, 0), 1)
check('50% 暴击 B=1.2', computeSharpenCritExpectedZone(50, 0), 1 + 0.5 * 1.2)
check('100% 暴击 B=1.2', computeSharpenCritExpectedZone(100, 0), 1 + 1.2)
check(
  '135% 暴击 B=1.2',
  computeSharpenCritExpectedZone(135, 0),
  (1 + 1.2) * (1 + 1.2 * 0.35),
)
check(
  '200% 暴击 B=1.2',
  computeSharpenCritExpectedZone(200, 0),
  (1 + 1.2) * (1 + 1.2 * 1),
)
check('250% 夹到 200%', computeSharpenCritExpectedZone(250, 0), (1 + 1.2) * (1 + 1.2))
check(
  '135% +30% 锐爆加成',
  computeSharpenCritExpectedZone(135, 30),
  (1 + 1.5) * (1 + 1.5 * 0.35),
)
check('必暴击 r=0.5', computeSharpenCritFullCritZone(50, 0), 1 + 1.2)
check(
  '必暴击 r=1.35',
  computeSharpenCritFullCritZone(135, 0),
  (1 + 1.2) * (1 + 1.2 * 0.35),
)

section('2. 锐化结算链')
const panel = createDefaultExternalPanel()
panel.atk = 2000
panel.def = 1500
panel.critRate = 135
panel.critDmg = 200
panel.dmgBonus = 50
panel.directDmgMult = 200
panel.settlementDmgMult = 50

const enemy = {
  defense: 953,
  level: 70,
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 1.5,
  specialMultiplier: 1,
}

const baseInput = {
  finalPanel: panel,
  piercePower: 1000,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: enemy,
  combatVulnerable: 0,
  combatStaggerVulnerable: 0,
  combatSpecial: 0,
  staggerPhase: 'normal',
  useSharpenFormula: true,
  combatSharpenCritDmgBonus: 0,
  combatDmgPenalty: 0,
}

const sharpen = computeDamageResult(baseInput)
check('锐化基础来源 def', sharpen.baseDamageSource === 'def' ? 1 : 0, 1)
check('锐化基础伤害=防御', sharpen.baseDamage, 1500)
check('锐化不用决算', sharpen.settlementDamageExpected, 0)
check('锐化 pierce 区=1', sharpen.pierceDmgMultiplier, 1)
check(
  '锐爆区 135%',
  sharpen.sharpenCritZone,
  (1 + 1.2) * (1 + 1.2 * 0.35),
  1e-6,
)

const withPenalty = computeDamageResult({
  ...baseInput,
  combatDmgPenalty: 20,
})
// 增伤区：无弱伤 1.5；有弱伤 1.3 → 伤害比 = 1.3/1.5
check(
  '弱伤降低直伤链比例',
  withPenalty.directDamageExpected / sharpen.directDamageExpected,
  1.3 / 1.5,
  1e-3,
)

const normalDirect = computeDamageResult({
  ...baseInput,
  useSharpenFormula: false,
  baseDamageSource: 'atk',
})
check('非锐化仍用攻击', normalDirect.baseDamageSource === 'atk' ? 1 : 0, 1)
check('非锐化含决算', normalDirect.settlementDamageExpected > 0 ? 1 : 0, 1)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
