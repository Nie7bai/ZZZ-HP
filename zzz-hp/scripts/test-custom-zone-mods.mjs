/**
 * 自定义乘区修饰表与 `percentSum` 求值（Phase 3b）。
 *
 * 运行：npx vite-node scripts/test-custom-zone-mods.mjs
 */
import assert from 'node:assert/strict'

import {
  createEmptyBuffStatModifiers,
  mergeBuffStatModifiers,
} from '../src/utils/calculatorUi.ts'
import { evaluateCustomZoneFactors } from '../src/zones/customZones.ts'

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

function closeTo(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`)
}

function resolvedWith(entries) {
  return {
    entries,
    context: {
      agentId: 'yeshunguang',
      profession: '强攻',
      element: '物理',
      mindscapeRank: 0,
      skillId: 'sk-test',
      skillName: '测试招式',
      skillGroupId: null,
    },
  }
}

console.log('[1] 通用修饰表')

check('空表包含 custom: {}', () => {
  const mods = createEmptyBuffStatModifiers()
  assert.deepEqual(mods.custom, {})
})

check('合并按 key 加算，非法值忽略', () => {
  const left = createEmptyBuffStatModifiers()
  left.custom = { elite: 30 }
  const right = createEmptyBuffStatModifiers()
  right.custom = { elite: -10, other: 5, bad: Number.NaN }
  const merged = mergeBuffStatModifiers(left, right)
  assert.equal(merged.custom.elite, 20)
  assert.equal(merged.custom.other, 5)
  assert.equal('bad' in merged.custom, false)
  assert.deepEqual(left.custom, { elite: 30 })
})

console.log('[2] percentSum 自定义乘区')

check('基础 100% + 加成之和：+30% → 1.3', () => {
  const resolved = resolvedWith({
    customElite: { key: 'customElite', module: 'percentSum', label: '对精英增伤区', params: { statKeys: ['elite'] } },
  })
  const [factor] = evaluateCustomZoneFactors(resolved, { elite: 30 })
  assert.equal(factor.key, 'customElite')
  assert.equal(factor.label, '对精英增伤区')
  closeTo(factor.value, 1.3, 'factor')
})

check('多键加总：+30% 与 -10% → 1.2', () => {
  const resolved = resolvedWith({
    customElite: { key: 'customElite', module: 'percentSum', params: { statKeys: ['a', 'b'] } },
  })
  const [factor] = evaluateCustomZoneFactors(resolved, { a: 30, b: -10 })
  closeTo(factor.value, 1.2, 'factor')
})

check('上限 / 下限 / 禁止负值', () => {
  const capped = resolvedWith({ z: { key: 'z', module: 'percentSum', params: { statKeys: ['x'], cap: 1.5 } } })
  closeTo(evaluateCustomZoneFactors(capped, { x: 80 })[0].value, 1.5, 'cap')

  const floored = resolvedWith({ z: { key: 'z', module: 'percentSum', params: { statKeys: ['x'], floor: 0.6 } } })
  closeTo(evaluateCustomZoneFactors(floored, { x: -80 })[0].value, 0.6, 'floor')

  const noNegative = resolvedWith({ z: { key: 'z', module: 'percentSum', params: { statKeys: ['x'], allowNegative: false } } })
  closeTo(evaluateCustomZoneFactors(noNegative, { x: -200 })[0].value, 0, 'allowNegative:false')
})

check('非 percentSum 条目忽略；按 order 排序', () => {
  const resolved = resolvedWith({
    stagger: { key: 'stagger', module: 'stagger', params: { mode: 'curtain' } },
    later: { key: 'later', module: 'percentSum', label: '后', params: { statKeys: ['a'], order: 20 } },
    earlier: { key: 'earlier', module: 'percentSum', label: '前', params: { statKeys: ['a'], order: 10 } },
  })
  const factors = evaluateCustomZoneFactors(resolved, { a: 10 })
  assert.deepEqual(factors.map((factor) => factor.key), ['earlier', 'later'])
})
console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
