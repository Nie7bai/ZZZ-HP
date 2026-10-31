/**
 * 防御区回归测试：穿透率上限 95%、有效防御必须 ≥ 0、防御区必须 ≤ 1。
 *
 * 背景：原实现 `Math.max(0, defenseAfterModifiers) - pen` 只对乘算部分取 max，
 * 减去固定穿透后可能为负，导致防御区 > 1 且随穿透值无限增长
 * （实测敌防 953、穿透 1350 时防御区 = 2.0，伤害翻倍）。
 *
 * 游戏公式（多来源一致）：受击方有效防御 = max(0, 敌防 × ... − 穿透值)，
 * 即整体钳制到 0，防御区上限为 1；穿透率本身硬上限 95%。
 *
 * 覆盖两层：`computeDefenseZone`（展示/提示与主链共用）与主链 `computeDamageResult`。
 *
 * 运行：npx vite-node scripts/test-defense-zone-clamp.mjs
 */
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { computeDamageResult, computeDefenseZone } from '../src/utils/damageCalc.ts'

let failed = 0
let passed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const ENEMY_DEF = 953

function zone(pen, penRate = 0, ignoreDefense = 0, reduceDefense = 0) {
  return computeDefenseZone({
    defensePanel: { penRate, pen, ignoreDefense, reduceDefense },
    isMb: false,
    enemyDefense: ENEMY_DEF,
  })
}

/** 主链 `computeDamageResult`：只改防御区输入，其余面板/乘区取中性值 */
function makePanel({ pen = 0, penRate = 0, ignoreDefense = 0, reduceDefense = 0 } = {}) {
  const panel = createDefaultExternalPanel()
  panel.atk = 3000
  panel.pen = pen
  panel.penRate = penRate
  panel.ignoreDefense = ignoreDefense
  panel.reduceDefense = reduceDefense
  return panel
}

function defaultEnemyInput() {
  return {
    defense: ENEMY_DEF,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
    level: 60,
  }
}

/** 主链必需/可选战斗乘区统一给 0，避免依赖缺省回退 */
const NEUTRAL_COMBAT = {
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
  combatSharpenCritDmgBonus: 0,
  combatDmgPenalty: 0,
}

function mainChainDefense(
  pen,
  penRate = 0,
  { isMbMainAgent = false, baseDamageSource = 'atk', piercePower = 0 } = {},
) {
  return computeDamageResult({
    finalPanel: makePanel({ pen, penRate }),
    piercePower,
    baseDamageSource,
    isMbMainAgent,
    enemyInput: defaultEnemyInput(),
    ...NEUTRAL_COMBAT,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
  })
}

console.log('\n[有效防御不得为负]')
for (const pen of [0, 100, 500, 900, 953, 954, 1000, 1350, 5000]) {
  const z = zone(pen)
  check(
    `穿透 ${pen} → 有效防御 ${z.effectiveDefense.toFixed(2)} ≥ 0`,
    z.effectiveDefense >= 0,
    `防御区 ${z.defenseMultiplier.toFixed(4)}`,
  )
}

console.log('\n[防御区不得大于 1]')
for (const pen of [0, 500, 953, 1000, 5000]) {
  const z = zone(pen)
  check(
    `穿透 ${pen} → 防御区 ${z.defenseMultiplier.toFixed(4)} ≤ 1`,
    z.defenseMultiplier <= 1 + 1e-12,
    `${z.defenseMultiplier}`,
  )
}

console.log('\n[穿透超过敌防后收益饱和]')
{
  const atDef = zone(ENEMY_DEF)
  const beyond = zone(ENEMY_DEF * 3)
  check(
    '穿透 953 与穿透 2859 防御区相同（均已饱和）',
    Math.abs(atDef.defenseMultiplier - beyond.defenseMultiplier) < 1e-12,
    `${atDef.defenseMultiplier.toFixed(6)} vs ${beyond.defenseMultiplier.toFixed(6)}`,
  )
  check('饱和时防御区 = 1', Math.abs(atDef.defenseMultiplier - 1) < 1e-12,
    `${atDef.defenseMultiplier}`)
}

console.log('\n[饱和前行为不变]')
{
  const noPen = zone(0)
  const halfPen = zone(ENEMY_DEF / 2)
  check('无穿透时防御区 = 794/(794+953)',
    Math.abs(noPen.defenseMultiplier - 794 / (794 + ENEMY_DEF)) < 1e-12,
    `${noPen.defenseMultiplier.toFixed(6)}`)
  check('穿透一半时防御区上升但 < 1',
    halfPen.defenseMultiplier > noPen.defenseMultiplier && halfPen.defenseMultiplier < 1,
    `${halfPen.defenseMultiplier.toFixed(6)}`)
}

console.log('\n[百分比穿透与减防仍正常]')
{
  const z = zone(0, 24, 0, 0)
  check('穿透率 24% 生效', z.defenseMultiplier > 794 / (794 + ENEMY_DEF),
    `${z.defenseMultiplier.toFixed(6)}`)
  const z2 = zone(0, 0, 30, 0)
  check('无视防御 30% 生效', z2.defenseMultiplier > 794 / (794 + ENEMY_DEF),
    `${z2.defenseMultiplier.toFixed(6)}`)
}

console.log('\n[穿透率上限 95%]')
for (const penRate of [95, 100, 120]) {
  const z = zone(0, penRate)
  check(
    `穿透率 ${penRate}% → 防御区穿透率 ${z.penRateRatio.toFixed(4)} = 0.95`,
    Math.abs(z.penRateRatio - 0.95) < 1e-12,
    `${z.penRateRatio}`,
  )
}

console.log('\n[主链：穿透率上限生效]')
for (const penRate of [95, 100, 120]) {
  const result = mainChainDefense(0, penRate)
  check(
    `主链穿透率 ${penRate}% → penRateRatio = 0.95`,
    Math.abs(result.penRateRatio - 0.95) < 1e-12,
    `${result.penRateRatio}`,
  )
}

console.log('\n[主链：固定穿透超过防御时有效防御钳到 0]')
{
  const result = mainChainDefense(ENEMY_DEF * 2)
  check(
    `主链穿透 ${ENEMY_DEF * 2} → 有效防御 ${result.effectiveDefense} = 0`,
    result.effectiveDefense === 0,
    `${result.effectiveDefense}`,
  )
  check(
    `主链穿透 ${ENEMY_DEF * 2} → 防御区 ${result.defenseMultiplier} = 1 且 ≤ 1`,
    Math.abs(result.defenseMultiplier - 1) < 1e-12 &&
      result.defenseMultiplier <= 1 + 1e-12,
    `${result.defenseMultiplier}`,
  )
}

console.log('\n[主链：双代理异常防御面板路由]')
{
  // composeDefensePanel：穿透率/穿透值取强度提供者，无视防御/减防取异常触发者
  const ownerPanel = makePanel()
  const powerProviderPanel = makePanel({ penRate: 20, pen: 12 })
  const anomalyTriggerPanel = makePanel({ reduceDefense: 40 })
  const result = computeDamageResult({
    finalPanel: ownerPanel,
    triggerFinalPanel: powerProviderPanel,
    anomalyTriggerPanel,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: defaultEnemyInput(),
    ...NEUTRAL_COMBAT,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    anomalySubKind: 'attributeAnomaly',
  })
  check(
    '双代理异常：穿透率取强度提供者 20%',
    result.penRateRatio === 0.2,
    `${result.penRateRatio}`,
  )
  check(
    '双代理异常：减防取异常触发者 40%',
    result.reduceDefenseRatio === 0.4,
    `${result.reduceDefenseRatio}`,
  )
  // 953 × (1 − 0.4) × (1 − 0.2) − 12 = 445.44
  check(
    '双代理异常：有效防御 = 953×0.6×0.8−12 = 445.44',
    Math.abs(result.effectiveDefense - 445.44) < 1e-12,
    `${result.effectiveDefense}`,
  )
}

console.log('\n[主链：命破防御区固定 1，有效防御仍按公式计算]')
{
  const result = mainChainDefense(100, 0, {
    isMbMainAgent: true,
    baseDamageSource: 'pierce',
    piercePower: 3000,
  })
  check(
    '主链命破防御区 = 1',
    result.defenseMultiplier === 1,
    `${result.defenseMultiplier}`,
  )
  check(
    '主链命破有效防御 = 953−100 = 853（不置 0）',
    result.effectiveDefense === 853,
    `${result.effectiveDefense}`,
  )
}

console.log('\n[命破仍固定为 1]')
{
  const z = computeDefenseZone({
    defensePanel: { penRate: 0, pen: 0, ignoreDefense: 0, reduceDefense: 0 },
    isMb: true,
    enemyDefense: ENEMY_DEF,
  })
  check('命破防御区 = 1', z.defenseMultiplier === 1, `${z.defenseMultiplier}`)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
