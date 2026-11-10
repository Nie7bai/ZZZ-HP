/**
 * 计算链路阶段模型（Phase 4c）。
 *
 * 运行：npx vite-node scripts/test-zone-pipeline.mjs
 */
import assert from 'node:assert/strict'

import {
  BUILT_IN_DAMAGE_CHAINS,
  buildStageTrace,
  getDamageChain,
  resolveDamageChainId,
} from '../src/zones/pipeline.ts'
import { buildPipelineStageRows } from '../src/zones/display.ts'

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

console.log('[1] 内置链路')

check('三条链路：direct / anomaly / radiance-self', () => {
  assert.deepEqual(
    BUILT_IN_DAMAGE_CHAINS.map((chain) => chain.id),
    ['direct', 'anomaly', 'radiance-self'],
  )
})

check('每条链路阶段 id 唯一、order 升序、有且仅有一个 final', () => {
  for (const chain of BUILT_IN_DAMAGE_CHAINS) {
    const ids = chain.stages.map((stage) => stage.id)
    assert.equal(new Set(ids).size, ids.length, `${chain.id} 阶段 id 重复`)
    const orders = chain.stages.map((stage) => stage.order)
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b), `${chain.id} order 未升序`)
    assert.equal(chain.stages.filter((stage) => stage.kind === 'final').length, 1, `${chain.id} final 数量`)
    for (const stage of chain.stages) assert.ok(stage.label, `${chain.id}/${stage.id} 缺 label`)
  }
})

console.log('[2] 链路选择')

check('直伤/锐化 → direct；异常 → anomaly；蕾米本人耀变 → radiance-self', () => {
  assert.equal(resolveDamageChainId({ damageKind: 'direct' }), 'direct')
  assert.equal(resolveDamageChainId({ damageKind: 'sharpen' }), 'direct')
  assert.equal(resolveDamageChainId({ damageKind: 'attributeAnomaly' }), 'anomaly')
  assert.equal(resolveDamageChainId({ damageKind: 'turbulence' }), 'anomaly')
  assert.equal(resolveDamageChainId({ damageKind: 'radiance' }), 'anomaly')
  assert.equal(resolveDamageChainId({ damageKind: 'radiance', isSelfRadiance: true }), 'radiance-self')
})

console.log('[3] 阶段轨迹')

check('有值的阶段按定义顺序输出，缺省阶段跳过', () => {
  const trace = buildStageTrace('direct', {
    base: 3000,
    dmg: 1.5,
    defense: 0.5,
    resistance: 1,
    vulnerable: 1.35,
    crit: 1.5,
    special: 1,
    final: 4556,
  })
  assert.equal(trace.chainId, 'direct')
  assert.deepEqual(
    trace.stages.map((stage) => stage.id),
    ['base', 'dmg', 'defense', 'resistance', 'vulnerable', 'crit', 'special', 'final'],
  )
  assert.equal(trace.stages[0].kind, 'source')
  assert.equal(trace.stages.at(-1).kind, 'final')
})

check('非法/缺失数值跳过；未知链路返回空轨迹', () => {
  const trace = buildStageTrace('direct', { base: 3000, dmg: Number.NaN, defense: null, final: 3000 })
  assert.deepEqual(trace.stages.map((stage) => stage.id), ['base', 'final'])
  assert.deepEqual(buildStageTrace('unknown', { base: 1 }), { chainId: 'unknown', stages: [] })
})

check('蕾米本人耀变链路阶段完整', () => {
  const chain = getDamageChain('radiance-self')
  assert.ok(chain)
  assert.deepEqual(
    chain.stages.map((stage) => stage.id),
    ['selfAtk', 'selfMastery', 'specialLevel', 'mutation', 'defense', 'resistance', 'vulnerable', 'stagger', 'radianceBonus', 'radianceMult', 'crit', 'special', 'final'],
  )
})

check('展示行：顺序不变、伤害类取整、乘数保留小数', () => {
  const rows = buildPipelineStageRows({
    pipeline: {
      chainId: 'direct',
      stages: [
        { id: 'base', kind: 'source', label: '基础伤害', group: 'direct', order: 10, value: 3000.4 },
        { id: 'dmg', kind: 'multiplier', label: '增伤区', group: 'direct', order: 20, value: 1.5 },
        { id: 'final', kind: 'final', label: '期望伤害', group: 'direct', order: 120, value: 4556.2 },
      ],
    },
  })
  assert.deepEqual(rows.map((row) => row.label), ['基础伤害', '增伤区', '期望伤害'])
  assert.equal(rows[0].valueText, '3,000')
  assert.equal(rows[1].valueText, '1.5')
  assert.equal(rows[2].valueText, '4,556')
  assert.equal(rows[2].kind, 'final')
})

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
