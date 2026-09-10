/**
 * 防御区回归测试：有效防御必须 ≥ 0，防御区必须 ≤ 1。
 *
 * 背景：原实现 `Math.max(0, defenseAfterModifiers) - pen` 只对乘算部分取 max，
 * 减去固定穿透后可能为负，导致防御区 > 1 且随穿透值无限增长
 * （实测敌防 953、穿透 1350 时防御区 = 2.0，伤害翻倍）。
 *
 * 游戏公式（多来源一致）：受击方有效防御 = max(0, 敌防 × ... − 穿透值)，
 * 即整体钳制到 0，防御区上限为 1。
 *
 * 运行：npx vite-node scripts/test-defense-zone-clamp.mjs
 */
import { computeDefenseZone } from '../src/utils/damageCalc.ts'

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
