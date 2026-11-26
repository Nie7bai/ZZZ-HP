/**
 * 浸染增伤区（imbueDmgMultiplier）回归。
 *
 * 口径：直伤体系独立乘区 = 1 + 浸染增伤% / 100；普通直伤 / 命破 / 锋御都乘，
 * 异常类（属性异常 / 异放 / 紊乱 / 乱流 / 耀变）不乘。
 *
 * 运行：npx vite-node scripts/test-imbue-dmg-zone.mjs
 */
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import {
  createEmptyBuffStatModifiers,
  BUFF_STAT_FIELDS,
} from '../src/utils/calculatorUi.ts'
import { extractCombatMods } from '../src/utils/panelBuffCalc.ts'
import { BUFF_STAT_ZONES } from '../src/utils/buffStatZones.ts'

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

function near(actual, expected, tolerance = 1) {
  return Math.abs(actual - expected) <= tolerance
}

function basePanel() {
  const panel = createDefaultExternalPanel()
  panel.atk = 3000
  panel.dmgBonus = 50
  panel.critRate = 50
  panel.critDmg = 100
  panel.mastery = 300
  panel.directDmgMult = 100
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

const directBase = computeDamageResult(makeInput({ chainId: 'direct' }))
const directImbue = computeDamageResult(makeInput({ chainId: 'direct', combatImbueDmgBonus: 50 }))
check(
  '普通直伤：浸染增伤区 = 1 + 50% = 1.5',
  directImbue.imbueDmgMultiplier === 1.5,
  `实际 ${directImbue.imbueDmgMultiplier}`,
)
check(
  '普通直伤：期望伤害按 1.5 缩放',
  near(directImbue.directDamageExpected, directBase.directDamageExpected * 1.5),
  `${directBase.directDamageExpected} → ${directImbue.directDamageExpected}`,
)
check(
  '普通直伤：未填浸染时乘区 = 1',
  directBase.imbueDmgMultiplier === 1,
  `实际 ${directBase.imbueDmgMultiplier}`,
)

const sharpenBase = computeDamageResult(
  makeInput({ chainId: 'sharpen', baseDamageSource: 'def', useSharpenFormula: true }),
)
const sharpenImbue = computeDamageResult(
  makeInput({
    chainId: 'sharpen',
    baseDamageSource: 'def',
    useSharpenFormula: true,
    combatImbueDmgBonus: 50,
  }),
)
check(
  '锋御锐化：期望伤害按 1.5 缩放',
  near(sharpenImbue.directDamageExpected, sharpenBase.directDamageExpected * 1.5),
  `${sharpenBase.directDamageExpected} → ${sharpenImbue.directDamageExpected}`,
)

const pierceBase = computeDamageResult(
  makeInput({ chainId: 'pierce', baseDamageSource: 'pierce', isMbMainAgent: true }),
)
const pierceImbue = computeDamageResult(
  makeInput({
    chainId: 'pierce',
    baseDamageSource: 'pierce',
    isMbMainAgent: true,
    combatImbueDmgBonus: 50,
  }),
)
check(
  '命破：期望伤害按 1.5 缩放',
  near(pierceImbue.directDamageExpected, pierceBase.directDamageExpected * 1.5),
  `${pierceBase.directDamageExpected} → ${pierceImbue.directDamageExpected}`,
)

const anomalyInput = { anomalySubKind: 'attributeAnomaly', eventDamageType: 'attributeAnomaly' }
const anomalyBase = computeDamageResult(makeInput(anomalyInput))
const anomalyImbue = computeDamageResult(
  makeInput({ ...anomalyInput, combatImbueDmgBonus: 50 }),
)
check(
  '属性异常：浸染增伤不影响异常期望',
  anomalyImbue.attributeAnomalyExpected === anomalyBase.attributeAnomalyExpected,
  `${anomalyBase.attributeAnomalyExpected} → ${anomalyImbue.attributeAnomalyExpected}`,
)
check(
  '属性异常：链路里没有浸染增伤阶段',
  !(anomalyImbue.pipeline?.stages ?? []).some((stage) => stage.id === 'imbue'),
)

for (const [label, result] of [
  ['纯直伤链路', computeDamageResult(makeInput({ chainId: 'direct', combatImbueDmgBonus: 50 }))],
  [
    '锋御链路',
    computeDamageResult(
      makeInput({
        chainId: 'sharpen',
        baseDamageSource: 'def',
        useSharpenFormula: true,
        combatImbueDmgBonus: 50,
      }),
    ),
  ],
  [
    '命破链路',
    computeDamageResult(
      makeInput({
        chainId: 'pierce',
        baseDamageSource: 'pierce',
        isMbMainAgent: true,
        combatImbueDmgBonus: 50,
      }),
    ),
  ],
]) {
  const stage = result.pipeline?.stages.find((item) => item.id === 'imbue')
  check(
    `${label}：阶段轨迹含浸染增伤区且值为 1.5`,
    stage?.label === '浸染增伤区' && stage.value === 1.5,
    JSON.stringify(stage ?? null),
  )
}

const fields = BUFF_STAT_FIELDS.filter((field) => field.key === 'imbueDmgBonus')
check('增益字段：浸染增伤已登记且为百分数', fields.length === 1 && fields[0].unit === 'percent')
check('增益字段：空修饰默认 0', createEmptyBuffStatModifiers().imbueDmgBonus === 0)
const mods = createEmptyBuffStatModifiers()
mods.imbueDmgBonus = 35
check('战斗修饰：浸染增伤透传', extractCombatMods(mods).imbueDmgBonus === 35)

const zone = BUFF_STAT_ZONES.find((item) => item.id === 'zone:imbueDmgBonus')
check(
  '管理端乘区目录：浸染增伤锁定直伤三项',
  zone?.label === '浸染增伤' &&
    JSON.stringify(zone.lockedTypes) === JSON.stringify(['normal', 'pierce', 'sharpen']),
  JSON.stringify(zone ?? null),
)

console.log(`\n=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
