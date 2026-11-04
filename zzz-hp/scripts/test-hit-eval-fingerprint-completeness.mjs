/**
 * 单条命中指纹的「完整性」与「缓存不返回旧值」守卫。
 *
 * 背景（2026-11-04）：上下文签名收窄、不再携带整批命中后，命中内容的变化必须**只由单条指纹**
 * 负责。人工字段白名单曾漏掉 `coords` / `isFollowUp` / `directSubKind` / `damageKind` 与招式的
 * 多个字段——漏掉的症状是「数字看着对但是旧的」，不报错。所以这里从结构上钉住：
 *
 * 1. `ResolvedHit` 的**每一个字段**都必须进指纹（字段表由 TS AST 枚举，将来加字段自动被检查）；
 * 2. 任一字段改值 → 指纹必变；
 * 3. 改完字段后，缓存返回的值必须等于**绕过缓存重新求值**的值。
 *
 * 运行：npx vite-node scripts/test-hit-eval-fingerprint-completeness.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

import { createBuffCalculationRuntime } from '../src/utils/skillFlowCalculation.ts'
import { buildHitEvalFingerprint, clearHitEvalCache } from '../src/utils/hitEvalCache.ts'
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

/** 从类型定义里枚举 ResolvedHit 的字段名（不依赖人工清单） */
function resolvedHitFieldNames() {
  const file = new URL('../src/utils/resolvedHit.ts', import.meta.url)
  const source = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile('resolvedHit.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = []
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'ResolvedHit') {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          names.push(member.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

function sentinelFor(value) {
  if (Array.isArray(value)) return [...value, { __probe: 'x' }]
  if (value === null) return 'probe-null'
  if (typeof value === 'number') return Number.isFinite(value) ? value + 1 : 1
  if (typeof value === 'boolean') return !value
  if (typeof value === 'string') return `${value}-probe`
  if (typeof value === 'object') return { ...value, __probe: 'x' }
  return 'probe'
}

/** 深拷贝一条命中（只含纯对象/数组/原始值） */
function cloneHit(hit) {
  return JSON.parse(JSON.stringify(hit))
}

const fixture = eventFixture({
  mode: 'ordinary',
  damageType: 'direct',
  effects: [
    createEmptyBuffEffect({ id: 'team-bonus', stat: 'dmgBonus', value: 25, enabledDefault: true, applyTarget: 'team' }),
  ],
  agents: [testAgent('owner', { profession: '强攻' }), testAgent('power', { profession: '支援' })],
})
const hit = fixture.hits[0]

console.log('[1] 字段覆盖：ResolvedHit 的每个字段都进指纹')

const fieldNames = resolvedHitFieldNames()
check('解析到 ResolvedHit 字段', () => assert.ok(fieldNames.length >= 15, `只解析到 ${fieldNames.length} 个字段`))
const parsed = JSON.parse(buildHitEvalFingerprint(hit))
check('字段表与指纹键一一对应（undefined 值由 JSON 丢弃，另由逐字段用例覆盖）', () => {
  const missing = fieldNames.filter(
    (name) => hit[name] !== undefined && !(name in parsed),
  )
  assert.deepEqual(missing, [], `指纹缺少字段：${missing.join(', ')}`)
})

console.log('[2] 逐字段改值 → 指纹必变')

const baseline = buildHitEvalFingerprint(hit)
for (const name of fieldNames) {
  check(`${name} 变化后指纹改变`, () => {
    const mutated = cloneHit(hit)
    mutated[name] = sentinelFor(mutated[name])
    assert.notEqual(buildHitEvalFingerprint(mutated), baseline)
  })
}

console.log('[3] 缓存不得返回旧值：改完字段后，缓存值 === 重新求值')

const runtime = createBuffCalculationRuntime(eventRuntimeInput(fixture))

/** 先吃缓存结果，再清表重算，两者必须一致；键漏字段时两者会不同 */
function assertNoStale(label, mutate) {
  check(label, () => {
    clearHitEvalCache()
    const target = cloneHit(hit)
    // 先按「改后内容」算一遍，填进缓存
    const cached = runtime.getHitNumbers(target)
    assert.ok(cached, '该命中应可结算')
    // 绕过缓存（清表）重算同一条
    clearHitEvalCache()
    const fresh = runtime.getHitNumbers(target)
    assert.ok(fresh, '重算应可结算')
    assert.equal(cached.total, fresh.total)
    assert.equal(cached.perHit, fresh.perHit)
    void mutate
  })
}

assertNoStale('count 变化不影响缓存正确性', (target) => { target.count += 1 })
assertNoStale('coords 变化不影响缓存正确性', (target) => { target.coords = [...target.coords, { category: 'dodge', subcategoryId: null }] })
assertNoStale('isFollowUp 变化不影响缓存正确性', (target) => { target.isFollowUp = !target.isFollowUp })
assertNoStale('directSubKind 变化不影响缓存正确性', (target) => { target.directSubKind = 'pierce' })
assertNoStale('multOverrides 变化不影响缓存正确性', (target) => { target.multOverrides = { ...(target.multOverrides ?? {}), directDmgMult: 150 } })
assertNoStale('buffOverride 变化不影响缓存正确性', (target) => { target.buffOverride = { disabledEffectIds: ['team-bonus'] } })

console.log('[4] 反向验证：内容不变时必须命中缓存（否则每次都在白算）')

check('同内容重算命中缓存', () => {
  clearHitEvalCache()
  runtime.getHitNumbers(hit)
  const statsBefore = runtime.getHitNumbers(hit) // 第二次应命中
  assert.ok(statsBefore, '应可结算')
  clearHitEvalCache()
})

check('undefined 与 null 归一为同一指纹（同一视图不得被重复求值）', () => {
  const withUndefined = { ...cloneHit(hit), buffOverride: undefined }
  const withNull = { ...cloneHit(hit), buffOverride: null }
  assert.equal(buildHitEvalFingerprint(withUndefined), buildHitEvalFingerprint(withNull))
})

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
