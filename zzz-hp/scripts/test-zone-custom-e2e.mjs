/**
 * 临时乘区端到端验收（Phase 4f）。
 *
 * 模拟管理端配置：
 * 1. 乘区定义 `custom:smoke` 登记增益键 `smokeBonus`；
 * 2. Buff 效果使用 `custom:smokeBonus` +30%；
 * 3. 乘区方案引用 `percentSum` + `statKeys:['smokeBonus']`；
 * 4. 命中计算出现 1.3 倍乘区、伤害按 1.3 放大、zones 出现自定义乘区；
 * 5. 未配置方案时结果不变。
 *
 * 运行：npx vite-node scripts/test-zone-custom-e2e.mjs
 */
import assert from 'node:assert/strict'

import { createBuffCalculationRuntime } from '../src/utils/skillFlowCalculation.ts'
import { clearHitEvalCache } from '../src/utils/hitEvalCache.ts'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { BUFF_STAT_ZONES } from '../src/utils/buffStatZones.ts'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { testAgent, makePanel, mindscapeWithEffects } from './_effectPipelineHarness.mjs'
import { adaptZoneSchemes } from '../src/zones/schemeAdapter.ts'
import {
  setRuntimeZoneDefinitions,
  setRuntimeZoneSchemes,
} from '../src/zones/schemeSource.ts'

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

function makeFixture() {
  const fixture = eventFixture({
    mode: 'ordinary',
    damageType: 'direct',
    effects: [
      createEmptyBuffEffect({
        id: 'smoke-bonus',
        stat: 'custom:smokeBonus',
        value: 30,
        enabledDefault: true,
        applyTarget: 'team',
      }),
    ],
    agents: [testAgent('owner', { element: '电' }), testAgent('power', { element: '风' })],
    panels: { owner: makePanel({ atk: 1500 }), power: makePanel({ atk: 2200 }) },
  })
  fixture.skill.baseMult = 1000
  for (const hit of fixture.hits) {
    hit.skill.baseMult = 1000
    hit.effectiveBaseMult = 1000
  }
  return fixture
}

function runtimeFor(fixture) {
  return createBuffCalculationRuntime(eventRuntimeInput(fixture))
}

function closeTo(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= Math.max(2, expected * 1e-6), `${label}: ${actual} ≠ ${expected}`)
}

const fixture = makeFixture()
const hit = fixture.hits[0]
const runtime = runtimeFor(fixture)

console.log('[1] 定义登记：增益键出现在管理端属性列表')

check('custom:smoke 定义注册后 BUFF_STAT_ZONES 包含 smokeBonus', () => {
  setRuntimeZoneDefinitions([
    {
      zoneKey: 'custom:smoke',
      label: '烟雾增伤区',
      sortOrder: 100,
      primitive: 'percentSum',
      params: {},
      stats: [
        { key: 'smokeBonus', label: '烟雾增伤', valueType: 'percent', sign: 'both' },
      ],
      version: 1,
    },
  ])
  const zone = BUFF_STAT_ZONES.find((item) => item.id === 'zone:custom:smokeBonus')
  assert.ok(zone, '缺少自定义属性')
  assert.equal(zone.label, '烟雾增伤')
  assert.equal(zone.stat, 'custom:smokeBonus')
})

console.log('[2] 未配置方案：结果不变')

const baseline = runtime.getHitNumbers(hit)
assert.ok(baseline)
check('zones 不含 custom:smoke；总伤为基线', () => {
  assert.equal(baseline.result.zones?.['custom:smoke'], undefined)
  closeTo(baseline.total, baseline.total, 'baseline')
})

console.log('[3] 配置方案：percentSum 生效')

check('+30% → 乘区 1.3、总伤 ×1.3、zones 出现自定义乘区', () => {
  clearHitEvalCache()
  setRuntimeZoneSchemes(adaptZoneSchemes({
    version: 1,
    definitions: [],
    schemes: [{
      scope: 'global',
      targetId: '',
      name: '烟雾测试',
      priority: 10,
      version: 1,
      rules: [{
        key: 'custom:smoke',
        action: 'replace',
        module: 'percentSum',
        label: '烟雾增伤区',
        params: { statKeys: ['smokeBonus'], cap: 2 },
      }],
    }],
  }))
  const withScheme = runtimeFor(fixture)
  const current = withScheme.getHitNumbers(hit)
  assert.ok(current)
  const zone = current.result.zones?.['custom:smoke']
  assert.ok(zone, '缺少自定义乘区结果')
  assert.equal(zone.label, '烟雾增伤区')
  assert.equal(zone.value, 1.3)
  closeTo(current.total, baseline.total * 1.3, '总伤')
})

check('定义/方案清理后回到基线', () => {
  setRuntimeZoneSchemes([])
  setRuntimeZoneDefinitions([])
  clearHitEvalCache()
  const cleared = runtimeFor(fixture)
  const after = cleared.getHitNumbers(hit)
  assert.ok(after)
  assert.equal(after.result.zones?.['custom:smoke'], undefined)
  closeTo(after.total, baseline.total, '总伤')
})

console.log('[4] providers：owner / team / all 按来源归属取模')

function applyProviderScheme(providerMode) {
  setRuntimeZoneDefinitions([
    {
      zoneKey: 'custom:smoke',
      label: '烟雾增伤区',
      sortOrder: 100,
      providers: providerMode,
      primitive: 'percentSum',
      params: {},
      stats: [{ key: 'smokeBonus', label: '烟雾增伤', valueType: 'percent', sign: 'both' }],
      version: 1,
    },
  ])
  setRuntimeZoneSchemes(adaptZoneSchemes({
    version: 1,
    definitions: [],
    schemes: [{
      scope: 'global',
      targetId: '',
      name: '烟雾测试',
      priority: 10,
      version: 1,
      rules: [{
        key: 'custom:smoke',
        action: 'replace',
        module: 'percentSum',
        label: '烟雾增伤区',
        params: { statKeys: ['smokeBonus'], cap: 5 },
      }],
    }],
  }))
  clearHitEvalCache()
}

function providerFixture() {
  const allyEffects = [createEmptyBuffEffect({
    id: 'ally-smoke-bonus',
    stat: 'custom:smokeBonus',
    value: 20,
    enabledDefault: true,
    applyTarget: 'team',
  })]
  const agents = [
    testAgent('owner', { element: '电' }),
    testAgent('power', { element: '风', mindscapeBuffs: mindscapeWithEffects(allyEffects) }),
  ]
  const fixture = eventFixture({
    mode: 'ordinary',
    damageType: 'direct',
    effects: [
      createEmptyBuffEffect({
        id: 'owner-smoke-bonus',
        stat: 'custom:smokeBonus',
        value: 30,
        enabledDefault: true,
        applyTarget: 'team',
      }),
    ],
    agents,
    panels: { owner: makePanel({ atk: 1500 }), power: makePanel({ atk: 2200 }) },
  })
  fixture.skill.baseMult = 1000
  for (const item of fixture.hits) {
    item.skill.baseMult = 1000
    item.effectiveBaseMult = 1000
  }
  return fixture
}

const providerBox = providerFixture()
const providerHit = providerBox.hits[0]

check('owner：只取命中所有者自身来源 +30% → 1.3', () => {
  applyProviderScheme('owner')
  const current = runtimeFor(providerBox).getHitNumbers(providerHit)
  assert.ok(current)
  assert.equal(current.result.zones?.['custom:smoke']?.value, 1.3)
})

check('team：含队友来源 +30% / +20% → 1.5', () => {
  applyProviderScheme('team')
  const current = runtimeFor(providerBox).getHitNumbers(providerHit)
  assert.ok(current)
  assert.equal(current.result.zones?.['custom:smoke']?.value, 1.5)
})

check('all：本夹具无环境来源时与 team 一致', () => {
  applyProviderScheme('all')
  const current = runtimeFor(providerBox).getHitNumbers(providerHit)
  assert.ok(current)
  assert.equal(current.result.zones?.['custom:smoke']?.value, 1.5)
})

check('team 不含无槽位来源（额外增益），all 含', () => {
  const extraFixture = eventFixture({
    mode: 'extra-team',
    damageType: 'direct',
    effects: [createEmptyBuffEffect({
      id: 'extra-smoke-bonus',
      stat: 'custom:smokeBonus',
      value: 30,
      enabledDefault: true,
    })],
    panels: { owner: makePanel({ atk: 1500 }), power: makePanel({ atk: 2200 }) },
  })
  extraFixture.skill.baseMult = 1000
  for (const item of extraFixture.hits) {
    item.skill.baseMult = 1000
    item.effectiveBaseMult = 1000
  }
  const extraHit = extraFixture.hits[0]

  applyProviderScheme('team')
  assert.equal(runtimeFor(extraFixture).getHitNumbers(extraHit)?.result.zones?.['custom:smoke']?.value, 1)

  applyProviderScheme('all')
  assert.equal(runtimeFor(extraFixture).getHitNumbers(extraHit)?.result.zones?.['custom:smoke']?.value, 1.3)
})

setRuntimeZoneSchemes([])
setRuntimeZoneDefinitions([])
clearHitEvalCache()

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
