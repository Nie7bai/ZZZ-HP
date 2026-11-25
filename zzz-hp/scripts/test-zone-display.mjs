/**
 * 乘区展示层统一来源（Phase 2）：名称取 `DamageCalcResult.zones`，顺序取乘区注册表 `order`。
 *
 * 断言：
 * - 普通命中 `zones.staggerMultiplier.label` = 「失衡易伤区」；
 * - 叶瞬光帷幕命中 = 「帷幕易伤区（上限 210%）」/「（上限 300%）」（按影画）；
 * - `zoneLabel` 与 `zones` 值、注册表默认值、调用方 fallback 的优先级一致；
 * - `sortZonesByCatalog` 严格按 `order` 升序且不增删；
 * - 计算过程乘区行、来源弹层、公式标签都复用同一份名称。
 *
 * 运行：npx vite-node scripts/test-zone-display.mjs
 */
import assert from 'node:assert/strict'

import { createBuffCalculationRuntime } from '../src/utils/skillFlowCalculation.ts'
import { clearHitEvalCache } from '../src/utils/hitEvalCache.ts'
import { buildEventValueTips, buildEventZoneDisplay } from '../src/utils/eventDamageSourceTips.ts'
import { buildSkillCalcZoneRows, staggerZoneLabel } from '../src/utils/skillCalcZones.ts'
import { ZONE_DEFINITIONS } from '../src/zones/catalog.ts'
import { sortZonesByCatalog, zoneLabel } from '../src/zones/display.ts'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { testAgent, makePanel } from './_effectPipelineHarness.mjs'

const CURTAIN_SKILL = '普通攻击：明心境·斩流光 极'
const NORMAL_SKILL = '普通攻击：快剑·一段'

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
  effects: [],
  agents: [testAgent('yeshunguang', { element: '物理', profession: '强攻' }), testAgent('power', { element: '风' })],
  panels: {
    yeshunguang: makePanel({ atk: 1500 }),
    power: makePanel({ atk: 2200 }),
  },
})
fixture.skill.baseMult = 12345
for (const hit of fixture.hits) {
  hit.skill.baseMult = 12345
  hit.effectiveBaseMult = 12345
}

function hitOf({ phase = 'normal', name = CURTAIN_SKILL } = {}) {
  const base = JSON.parse(JSON.stringify(fixture.hits[0]))
  return { ...base, id: `${base.id}-${phase}-${name}`, staggerPhase: phase, skill: { ...base.skill, name, agentId: 'yeshunguang' } }
}

function detailOf({ rank = 0, staggerMultiplier = 2.5, ...hitOptions } = {}) {
  const teamSlots = fixture.teamSlots.map((slot) => (slot.agentId === 'yeshunguang' ? { ...slot, rank } : slot))
  const runtime = createBuffCalculationRuntime(
    eventRuntimeInput(fixture, {
      contextInput: { teamSlots, enemyInput: { ...fixture.context.enemyInput, staggerMultiplier } },
    }),
  )
  const detail = runtime.getHitDetail(hitOf(hitOptions))
  assert.ok(detail, '命中应能求值')
  return detail
}

clearHitEvalCache()

console.log('[1] 普通命中：标签来自结果乘区，保持「失衡易伤区」')

check('普通招式 zones / 展示层标签均为失衡易伤区', () => {
  const detail = detailOf({ rank: 4, name: NORMAL_SKILL, staggerMultiplier: 1.5 })
  const result = detail.evaluation.result
  assert.equal(result.staggerZoneKind, undefined)
  assert.equal(result.zones?.staggerMultiplier?.label, '失衡易伤区')
  assert.equal(result.zones.staggerMultiplier.value, result.staggerMultiplier)
  assert.equal(zoneLabel(result, 'staggerMultiplier'), result.zones.staggerMultiplier.label)
  assert.equal(staggerZoneLabel(result), result.zones.staggerMultiplier.label)
  const rows = buildSkillCalcZoneRows(result, detail.evaluation.hit.skill.damageType)
  const row = rows.find((item) => item.label === result.zones.staggerMultiplier.label)
  assert.ok(row, `缺少失衡易伤区行：${rows.map((item) => item.label).join(' | ')}`)
  assert.equal(row.value, String(result.staggerMultiplier))
})

console.log('[2] 帷幕命中：标签带上限，随影画 210% / 300%')

check('4 影：帷幕易伤区（上限 300%）', () => {
  const detail = detailOf({ rank: 4, staggerMultiplier: 3.5 })
  const result = detail.evaluation.result
  assert.equal(result.staggerZoneKind, 'curtain')
  assert.equal(result.staggerZoneCap, 3)
  assert.equal(result.zones?.staggerMultiplier?.label, '帷幕易伤区（上限 300%）')
  assert.equal(zoneLabel(result, 'staggerMultiplier'), result.zones.staggerMultiplier.label)
  assert.equal(staggerZoneLabel(result), result.zones.staggerMultiplier.label)
})

check('0 影：帷幕易伤区（上限 210%）', () => {
  const detail = detailOf({ rank: 0, staggerMultiplier: 2.5 })
  const result = detail.evaluation.result
  assert.equal(result.staggerZoneCap, 2.1)
  assert.equal(result.zones?.staggerMultiplier?.label, '帷幕易伤区（上限 210%）')
})

console.log('[3] zoneLabel：zones 优先，其次 fallback，最后注册表默认值')

check('zones → fallback → 注册表默认值的优先级', () => {
  const detail = detailOf({ rank: 4, staggerMultiplier: 3 })
  const result = detail.evaluation.result
  assert.equal(zoneLabel(result, 'staggerMultiplier', '兜底名'), result.zones.staggerMultiplier.label)
  // 没有 zones 的旧对象：退回 fallback
  assert.equal(zoneLabel({}, 'staggerMultiplier', '普通失衡'), '普通失衡')
  // 既没有 zones 也没有 fallback：退回注册表默认名
  assert.equal(zoneLabel(undefined, 'staggerMultiplier'), '失衡易伤区')
  assert.equal(zoneLabel({ zones: {} }, 'staggerMultiplier'), '失衡易伤区')
  // 注册表里没有的键：最后退回键名，不抛错
  assert.equal(zoneLabel({}, 'notARegisteredZone'), 'notARegisteredZone')
  assert.equal(zoneLabel(null, 'notARegisteredZone', '兜底'), '兜底')
})

console.log('[4] sortZonesByCatalog：按注册表 order 升序，不增删')

check('结果乘区排序升序且元素不变', () => {
  const detail = detailOf({ rank: 4, staggerMultiplier: 3 })
  const zones = detail.evaluation.result.zones
  assert.ok(zones, '结果应含 zones')
  const values = Object.values(zones)
  const sorted = sortZonesByCatalog(values)
  assert.equal(sorted.length, values.length)
  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok(sorted[index - 1].order <= sorted[index].order, `顺序异常：${sorted[index - 1].key}=${sorted[index - 1].order} / ${sorted[index].key}=${sorted[index].order}`)
  }
  assert.deepEqual(new Set(sorted.map((zone) => zone.key)), new Set(values.map((zone) => zone.key)))
  // 传入数组不被就地修改
  const original = values.slice()
  sortZonesByCatalog(original)
  assert.deepEqual(original, values)
})

check('注册表 order 唯一且按升序登记', () => {
  const orders = ZONE_DEFINITIONS.map((zone) => zone.order)
  assert.equal(new Set(orders).size, orders.length, '乘区 order 应唯一')
  assert.deepEqual(
    sortZonesByCatalog(ZONE_DEFINITIONS).map((zone) => zone.key),
    ZONE_DEFINITIONS.map((zone) => zone.key),
    '注册表本身应按 order 升序登记（展示默认顺序不会被重排）',
  )
})

console.log('[5] 来源弹层 / 过程文案复用同一标签')

check('帷幕命中：计算过程行与来源弹层都用结果里的乘区名', () => {
  const detail = detailOf({ rank: 4, staggerMultiplier: 3.5 })
  const label = detail.evaluation.result.zones.staggerMultiplier.label
  const rows = buildEventZoneDisplay(detail)
  const row = rows.find((item) => item.label === label)
  assert.ok(row, `缺少乘区行：${rows.map((item) => item.label).join(' | ')}`)
  assert.equal(row.value, '3')
  assert.ok(row.groups.length > 0, '来源分组不应为空')
  const items = buildEventValueTips(detail).staggerMultiplier.flatMap((group) => group.items)
  assert.ok(items.some((item) => item.includes(label)), `来源合计行应含乘区名：${items.join(' | ')}`)
})

check('普通命中：计算过程行仍可映射到 staggerMultiplier 来源', () => {
  const detail = detailOf({ rank: 4, name: NORMAL_SKILL, staggerMultiplier: 1.5 })
  const label = detail.evaluation.result.zones.staggerMultiplier.label
  const row = buildEventZoneDisplay(detail).find((item) => item.label === label)
  assert.ok(row, '普通命中应包含失衡易伤区行')
  assert.ok(row.groups.length > 0, '普通命中的来源分组不应为空')
})

console.log(`
${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
