/**
 * 失衡易伤取值口径（2026-11-09 所有者口径）：以怪物库（boss_info）为准，期数快照仅兜底。
 *
 * 背景：提丰在怪物库改为 2.0 后，危局期数行仍存 1.5 快照；「统一以怪物库为准」后，
 * 危局接口与计算器从期数记录应用都应取 2.0。
 *
 * 运行：npx vite-node scripts/test-boss-stagger-source.mjs
 */
import assert from 'node:assert/strict'

import {
  mapBossRecordToDamageEnemyInput,
  resolveBossStaggerMultiplier,
} from '../src/utils/enemyInputFromBoss.ts'

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

const record = { id: 1, version: '3.3', phase: '2', boss_name: '自律强袭单位·「提丰·破坏者型」', defense: 953, stagger_multiplier: 1.5 }
const info = { boss_name: record.boss_name, defense: 953, stagger_multiplier: 2 }

console.log('[1] resolveBossStaggerMultiplier：主值优先，次值兜底，最后回落默认')

check('主值有效 → 取主值（怪物库 2.0 覆盖期数快照 1.5）', () => {
  assert.equal(resolveBossStaggerMultiplier(2, 1.5), 2)
})

check('主值缺失 → 取次值', () => {
  assert.equal(resolveBossStaggerMultiplier(null, 1.5), 1.5)
})

check('都缺失 → 回落 1.5（或调用方给的当前值）', () => {
  assert.equal(resolveBossStaggerMultiplier(undefined, null), 1.5)
  assert.equal(resolveBossStaggerMultiplier(null, null, 1.8), 1.8)
})

console.log('[2] 期数记录应用：怪物库优先')

check('期数行 1.5 + 怪物库 2.0 → 应用为 2.0', () => {
  const enemy = mapBossRecordToDamageEnemyInput(record, info)
  assert.equal(enemy.staggerMultiplier, 2)
  assert.equal(enemy.bossSource, 'boss_record')
})

check('怪物库无记录 → 用期数行 1.5', () => {
  const enemy = mapBossRecordToDamageEnemyInput(record, null)
  assert.equal(enemy.staggerMultiplier, 1.5)
})

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
