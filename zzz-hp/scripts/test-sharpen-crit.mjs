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
import { computeDirectBaseChain } from '../src/utils/directDamageDisplay.ts'

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

/** 按相对误差断言：用于「用已四舍五入的输出值反算」这类必然有累积误差的场景 */
function checkRelative(name, actual, expected, relEps = 1e-3) {
  const denom = Math.abs(expected) || 1
  const rel = Math.abs(actual - expected) / denom
  if (rel <= relEps) {
    passed += 1
    console.log(
      `  PASS  ${name}: ${actual} ≈ ${expected}（相对误差 ${(rel * 100).toFixed(5)}%）`,
    )
  } else {
    failed += 1
    console.log(
      `  FAIL  ${name}: actual=${actual} expected=${expected} 相对误差 ${(rel * 100).toFixed(5)}% > ${(relEps * 100).toFixed(3)}%`,
    )
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
// B = 锐爆伤害加成%/100，无内置基础值（原 1.2 底座已移除）
// 无加成时 B=0，锐爆区恒为 1（相当于不暴击）
check('0% 暴击 无加成', computeSharpenCritExpectedZone(0, 0), 1)
check('50% 暴击 无加成', computeSharpenCritExpectedZone(50, 0), 1)
check('100% 暴击 无加成', computeSharpenCritExpectedZone(100, 0), 1)
check('200% 暴击 无加成', computeSharpenCritExpectedZone(200, 0), 1)

// B=1.5（克拉蕾基础锐爆伤害 150）
const B150 = 150 / 100
check('50% 暴击 B=1.5', computeSharpenCritExpectedZone(50, 150), 1 + 0.5 * B150)
check('100% 暴击 B=1.5', computeSharpenCritExpectedZone(100, 150), 1 + B150)
check(
  '135% 暴击 B=1.5',
  computeSharpenCritExpectedZone(135, 150),
  (1 + B150) * (1 + B150 * 0.35),
)
check(
  '200% 暴击 B=1.5',
  computeSharpenCritExpectedZone(200, 150),
  (1 + B150) * (1 + B150 * 1),
)
check('250% 夹到 200%', computeSharpenCritExpectedZone(250, 150), (1 + B150) * (1 + B150))

// B=1.8（150 基础 + 30 加成）
const B180 = 180 / 100
check(
  '135% +30% 锐爆加成',
  computeSharpenCritExpectedZone(135, 180),
  (1 + B180) * (1 + B180 * 0.35),
)
check('必暴击 r=0.5', computeSharpenCritFullCritZone(50, 150), 1 + B150)
check(
  '必暴击 r=1.35',
  computeSharpenCritFullCritZone(135, 150),
  (1 + B150) * (1 + B150 * 0.35),
)
check('必暴击 r=0.5 无加成', computeSharpenCritFullCritZone(50, 0), 1)

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
  // B = 150/100 = 1.5（克拉蕾基础锐爆伤害；无内置 1.2 底座）
  combatSharpenCritDmgBonus: 150,
  combatDmgPenalty: 0,
}

const sharpen = computeDamageResult(baseInput)
check('锐化基础来源 def', sharpen.baseDamageSource === 'def' ? 1 : 0, 1)
check('锐化基础伤害=防御', sharpen.baseDamage, 1500)
check('锐化不用决算', sharpen.settlementDamageExpected, 0)
check('锐化 pierce 区=1', sharpen.pierceDmgMultiplier, 1)
check(
  '锐爆区 135% B=1.5',
  sharpen.sharpenCritZone,
  (1 + 1.5) * (1 + 1.5 * 0.35),
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

section('3. 锐化伤害提升区（独立乘区 sharpenDmgBonus）')
check('锐化路径默认值=1', sharpen.sharpenDmgMultiplier, 1)
check('非锐化路径强制=1', normalDirect.sharpenDmgMultiplier, 1)

const sharpenBonus30 = computeDamageResult({
  ...baseInput,
  combatSharpenDmgBonus: 30,
})
check('锐化伤害提升 30% → 乘区 1.3', sharpenBonus30.sharpenDmgMultiplier, 1.3, 1e-6)
check(
  '锐化伤害提升只放大锐化伤害 1.3 倍',
  sharpenBonus30.directDamageExpected / sharpen.directDamageExpected,
  1.3,
  1e-3,
)
check('锐化伤害提升不影响锐爆区', sharpenBonus30.sharpenCritZone, sharpen.sharpenCritZone, 1e-9)
check('锐化伤害提升不影响增伤区', sharpenBonus30.dmgMultiplier, sharpen.dmgMultiplier, 1e-9)
check('锐化伤害提升不进决算', sharpenBonus30.settlementDamageExpected, 0)
check('锐化伤害提升不动贯穿增伤区', sharpenBonus30.pierceDmgMultiplier, 1, 1e-9)

// 非锐化路径即使传了 sharpenDmgBonus 也必须无效
const bonusIgnored = computeDamageResult({
  ...baseInput,
  useSharpenFormula: false,
  baseDamageSource: 'atk',
  combatSharpenDmgBonus: 30,
})
check('非锐化路径忽略锐化伤害提升', bonusIgnored.sharpenDmgMultiplier, 1, 1e-9)
check(
  '非锐化路径伤害不受锐化伤害提升影响',
  bonusIgnored.directDamageExpected,
  normalDirect.directDamageExpected,
  1e-6,
)

// 命破优先：即使传了 useSharpenFormula 也不走锐化
const mbSharpen = computeDamageResult({
  ...baseInput,
  isMbMainAgent: true,
  combatSharpenDmgBonus: 30,
})
check('命破不走锐化路径', mbSharpen.useSharpenFormula ? 0 : 1, 1)
check('命破锐化伤害提升区=1', mbSharpen.sharpenDmgMultiplier, 1, 1e-9)

section('4. 展示层乘区链与引擎一致')
// 展示层 computeDirectBaseChain 应与引擎「基础链」一致：
// 基础链 = 通用 × 易伤 × 锐爆区 × 特殊 × 锐化伤害提升区
// 引擎: directDamageExpected = 基础链 × 直伤倍率区
const chain = computeDirectBaseChain(sharpenBonus30)
const chainExpected =
  sharpenBonus30.generalMultiplier *
  Math.max(0, sharpenBonus30.directVulnerableMultiplier) *
  sharpenBonus30.critMultiplier *
  Math.max(0, sharpenBonus30.specialMultiplier) *
  Math.max(0, sharpenBonus30.sharpenDmgMultiplier)
check('展示基础链=通用×易伤×锐爆×特殊×锐化提升', chain, chainExpected, 1e-6)
// critMultiplier 在锐化路径下报告的正是锐爆区
check('锐化路径 critMultiplier 即锐爆区', sharpenBonus30.critMultiplier, sharpenBonus30.sharpenCritZone, 1e-6)
// 展示的基础链 × 直伤倍率区 == 引擎直伤期望（四舍五入前）
check(
  '基础链×直伤倍率区=直伤期望',
  chain * sharpenBonus30.directDmgMultZone,
  sharpenBonus30.directDamageExpected,
  1,
)

// 非锐化路径基础链仍是 通用×易伤×暴击×特殊（贯穿增伤区为 1）
const normalChain = computeDirectBaseChain(normalDirect)
const normalChainExpected =
  normalDirect.generalMultiplier *
  Math.max(0, normalDirect.directVulnerableMultiplier) *
  normalDirect.critMultiplier *
  Math.max(0, normalDirect.specialMultiplier) *
  Math.max(0, normalDirect.pierceDmgMultiplier)
check('非锐化基础链不受影响', normalChain, normalChainExpected, 1e-6)

section('5. 弱伤(dmgPenalty) 展示口径现状（记录，非断言）')
const baseInput2 = { ...baseInput, useSharpenFormula: false, baseDamageSource: 'atk' }
// 弱伤 = 减益，规则是「从增伤区里扣」，因此不需要独立乘区展示。
// 但引擎的「通用乘区」刻意用【未扣弱伤】的增伤区算（异常链共用且异常不扣弱伤），
// 直伤链再单独补扣。故弱伤非 0 时，界面「增伤区」与「通用乘区」口径不一致。
// 当前全库 dmgPenalty 无非 0 条目，无实际影响；此处仅固化现状，便于日后对照。
const noPenalty = computeDamageResult(baseInput2)
const withPenalty20 = computeDamageResult({ ...baseInput2, combatDmgPenalty: 20 })
const recomputeGeneral = (r) =>
  r.baseDamage *
  r.dmgMultiplier *
  r.defenseMultiplier *
  r.resistanceMultiplier *
  Math.max(0, r.staggerMultiplier)

check('弱伤为 0：增伤区=1.5', noPenalty.dmgMultiplier, 1.5, 1e-9)
check('弱伤 20：增伤区扣至 1.3', withPenalty20.dmgMultiplier, 1.3, 1e-9)
// 注：输出各乘区均经四舍五入（防御区 4 位、通用乘区 2 位），用显示值反算必然有累积误差，
// 故此处按【相对误差】断言（实测约 0.004%），不能按绝对差值。
checkRelative(
  '弱伤为 0：界面增伤区可复算通用乘区',
  recomputeGeneral(noPenalty),
  noPenalty.generalMultiplier,
  1e-3,
)
const gap = Math.abs(recomputeGeneral(withPenalty20) - withPenalty20.generalMultiplier)
console.log(
  `  现状  弱伤 20：手算通用乘区 ${recomputeGeneral(withPenalty20).toFixed(2)} vs 显示 ${withPenalty20.generalMultiplier}（差 ${gap.toFixed(2)}）`,
)
console.log(
  `  现状  弱伤 20：展示基础链×倍率区 ${(computeDirectBaseChain(withPenalty20) * withPenalty20.directDmgMultZone).toFixed(2)} vs 实际 ${withPenalty20.directDamageExpected}`,
)
check('弱伤不改变异常基础（异常不扣弱伤）', withPenalty20.anomalyBaseExpected, noPenalty.anomalyBaseExpected, 1e-6)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
