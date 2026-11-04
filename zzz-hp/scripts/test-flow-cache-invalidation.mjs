/**
 * 缓存失效收窄的行为守卫（2026-11-04）。
 *
 * 上下文签名不再携带整批命中后，必须同时成立两件事：
 * - **该重算的必须重算**：改勾选 / 改面板 / 改敌人 / 改阶段 / 改某一行的任何字段；
 * - **不该重算的不能再重算**：加一行只算新行、调换行序不算、加准备预览不算。
 *
 * 判定方式是记忆表的真实命中计数（`hitEvalCacheDebugStats`），不是 mock 或常量。
 *
 * 运行：npx vite-node scripts/test-flow-cache-invalidation.mjs
 */
import assert from 'node:assert/strict'

import { createBuffCalculationRuntime } from '../src/utils/skillFlowCalculation.ts'
import { clearHitEvalCache, hitEvalCacheDebugStats } from '../src/utils/hitEvalCache.ts'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { testAgent } from './_effectPipelineHarness.mjs'

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

const fixture = eventFixture({
  mode: 'ordinary',
  damageType: 'direct',
  effects: [
    createEmptyBuffEffect({ id: 'team-bonus', stat: 'dmgBonus', value: 25, enabledDefault: true, applyTarget: 'team' }),
  ],
  agents: [testAgent('owner', { profession: '强攻' }), testAgent('power', { profession: '支援' })],
})
const hits = fixture.hits

function runtimeFor(changes = {}) {
  return createBuffCalculationRuntime(eventRuntimeInput(fixture, changes))
}

/** 跑一批命中，返回 { hits, misses } 增量 */
function evaluate(runtime, list) {
  const before = hitEvalCacheDebugStats()
  for (const hit of list) runtime.getHitNumbers(hit)
  const after = hitEvalCacheDebugStats()
  return { hits: after.hits - before.hits, misses: after.misses - before.misses }
}

console.log('[1] 该重算的必须重算')

check('冷启动：每条命中各算一次', () => {
  clearHitEvalCache()
  const result = evaluate(runtimeFor(), hits)
  assert.equal(result.misses, hits.length)
})

check('改增益勾选 → 全部重算', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const changed = runtimeFor({
    contextInput: { buffSelection: { enabledIds: { 'team-bonus': false }, stacksByEffectId: {}, convertInputs: {} } },
  })
  const result = evaluate(changed, hits)
  assert.equal(result.misses, hits.length, '勾选变了必须全部重算')
})

check('改敌方参数 → 全部重算', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const changed = runtimeFor({
    contextInput: { enemyInput: { ...fixture.context.enemyInput, defense: 1200 } },
  })
  const result = evaluate(changed, hits)
  assert.equal(result.misses, hits.length, '敌人变了必须全部重算')
})

check('改失衡阶段 → 全部重算', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const changed = runtimeFor({ staggerPhase: 'normal' })
  const result = evaluate(changed, hits)
  assert.equal(result.misses, hits.length, '阶段变了必须全部重算')
})

check('只改某一条命中的次数 → 只重算那一条', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const target = hits[0]
  const originalCount = target.count
  target.count += 1
  try {
    const result = evaluate(runtimeFor(), hits)
    assert.equal(result.misses, 1, `只应重算 1 条，实际 ${result.misses}`)
    assert.equal(result.hits, hits.length - 1)
  } finally {
    target.count = originalCount
  }
})

console.log('[2] 不该重算的不能再重算')

check('同配置再算一次 → 全部命中缓存', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const result = evaluate(runtimeFor(), hits)
  assert.equal(result.misses, 0)
  assert.equal(result.hits, hits.length)
})

check('流程新增一行 → 原有点全命中，只算新增那条', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const extra = { ...JSON.parse(JSON.stringify(hits[0])), id: `${hits[0].id}-extra` }
  const withExtra = [...hits, extra]
  const runtime = runtimeFor({ contextInput: { hits: withExtra } })
  const existing = evaluate(runtime, hits)
  assert.equal(existing.misses, 0, `原有命中不该重算，实际重算 ${existing.misses} 条`)
  const added = evaluate(runtime, [extra])
  assert.equal(added.misses, 1, '新增那条必须算一次')
})

check('流程行顺序颠倒 → 全部命中缓存', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const reversed = [...hits].reverse()
  const result = evaluate(runtimeFor({ contextInput: { hits: reversed } }), hits)
  assert.equal(result.misses, 0, `调序不该重算，实际重算 ${result.misses} 条`)
})

check('只加一条准备预览 → 流程命中全部命中缓存', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const previewLike = { ...JSON.parse(JSON.stringify(hits[0])), id: `${hits[0].id}-preview` }
  const result = evaluate(runtimeFor({ contextInput: { hits: [...hits, previewLike] } }), hits)
  assert.equal(result.misses, 0, `加预览不该重算流程，实际重算 ${result.misses} 条`)
})

console.log('[3] 内容相同、引用不同 → 仍命中缓存（签名按内容而不是按引用）')

check('队伍槽位换同内容新对象 → 全部命中', () => {
  clearHitEvalCache()
  evaluate(runtimeFor(), hits)
  const cloned = fixture.teamSlots.map((slot) => ({ ...slot }))
  const result = evaluate(runtimeFor({ contextInput: { teamSlots: cloned } }), hits)
  assert.equal(result.misses, 0, `同内容新对象不该重算，实际重算 ${result.misses} 条`)
})

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
