/**
 * 管理端「计算链路」展示：全局乘区方案的自定义乘区拼进链路阶段。
 *
 * 背景（用户 2026-11-28）：纯直伤链路里能看到「最终伤害区」（内置阶段），
 * 但「一布之力区」是乘区方案里的自定义乘区，链路面板原本完全不显示。
 * 这里锁住展示拼接：按乘区方案条目的 `params.order` 排序、同 id 不重复、链路阶段不被改写。
 *
 * 运行：npx vite-node scripts/test-chain-display-scheme-stages.mjs
 */
import assert from 'node:assert/strict'

import {
  mergeSchemeStagesIntoChain,
  schemeEntriesToStages,
} from '../src/zones/chainDisplay.ts'

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

const chainStages = [
  { id: 'base', kind: 'source', label: '基础伤害', group: 'direct', order: 10, module: 'baseDamage' },
  { id: 'finalDmg', kind: 'multiplier', label: '最终伤害区', group: 'direct', order: 115, module: 'finalDmgBonus' },
  { id: 'final', kind: 'final', label: '期望伤害', group: 'direct', order: 120, module: 'product' },
]

console.log('[1] 方案条目 → 阶段格')

check('params.order 优先于条目顺序；label 缺省回落 key', () => {
  const stages = schemeEntriesToStages([
    { key: 'custom:finalDamage', label: '最终伤害区', module: 'percentSum', params: { order: 201 } },
    { key: 'custom:bangbooMight', module: 'percentSum', params: { order: 202 } },
  ])
  assert.equal(stages[0].order, 201)
  assert.equal(stages[1].order, 202)
  assert.equal(stages[1].label, 'custom:bangbooMight')
  assert.equal(stages[0].group, 'scheme')
})

check('停用条目（enabled=false）不进展示；action=disable 保留给方案行自己标注', () => {
  const stages = schemeEntriesToStages([
    { key: 'a', params: { order: 200 }, enabled: false },
    { key: 'b', params: { order: 201 }, action: 'disable' },
  ])
  assert.equal(stages.length, 1)
  assert.equal(stages[0].id, 'b')
  assert.equal(stages[0].action, 'disable')
})

console.log('[2] 拼进链路')

check('一布之力插在期望伤害之前，期望伤害固定最后（序号 999）', () => {
  const scheme = schemeEntriesToStages([
    { key: 'custom:bangbooMight', label: '一布之力区', module: 'percentSum', params: { order: 202 } },
  ])
  const merged = mergeSchemeStagesIntoChain(chainStages, scheme)
  assert.deepEqual(merged.map((stage) => stage.id), ['base', 'finalDmg', 'custom:bangbooMight', 'final'])
  assert.equal(merged[2].label, '一布之力区')
  assert.equal(merged[3].order, 999)
  // 不改写原数组
  assert.equal(chainStages.length, 3)
  assert.equal(chainStages[2].order, 120)
})

check('同 id 不重复（链路已有同名阶段时不额外追加）', () => {
  const scheme = schemeEntriesToStages([
    { key: 'finalDmg', label: '最终伤害区', module: 'percentSum', params: { order: 115 } },
  ])
  const merged = mergeSchemeStagesIntoChain(chainStages, scheme)
  assert.deepEqual(merged.map((stage) => stage.id), ['base', 'finalDmg', 'final'])
})

check('同标签也不重复：历史留存的 custom:finalDamage「最终伤害区」不重复成两格', () => {
  const scheme = schemeEntriesToStages([
    { key: 'custom:finalDamage', label: '最终伤害区', module: 'percentSum', params: { order: 201 } },
    { key: 'custom:bangbooMight', label: '一布之力区', module: 'percentSum', params: { order: 202 } },
  ])
  const merged = mergeSchemeStagesIntoChain(chainStages, scheme)
  assert.deepEqual(merged.map((stage) => stage.id), ['base', 'finalDmg', 'custom:bangbooMight', 'final'])
})

check('没有方案条目时原样返回链路阶段', () => {
  assert.equal(mergeSchemeStagesIntoChain(chainStages, []), chainStages)
})

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
