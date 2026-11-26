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
import { readFileSync } from 'node:fs'

import { createBuffCalculationRuntime, resolveSkillFlowCalculationDetail } from '../src/utils/skillFlowCalculation.ts'
import { buildEventZoneDisplay } from '../src/utils/eventDamageSourceTips.ts'
import { clearHitEvalCache } from '../src/utils/hitEvalCache.ts'
import { clearAffixEvalCache, evaluateAffixCounts, evaluateAffixCountsForSweep } from '../src/utils/optimalAffixAlloc.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { createEmptyBuffEffect, normalizeBuffEffects } from '../src/utils/buffEffect.ts'
import { BUFF_STAT_ZONES, buffStatZoneOf } from '../src/utils/buffStatZones.ts'
import { resolveFlow } from '../src/utils/resolvedHit.ts'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { testAgent, testSlot, makePanel, mindscapeWithEffects } from './_effectPipelineHarness.mjs'
import { buildPipelineStageRows } from '../src/zones/display.ts'
import { mapKeywordsToEffect, STAT_OPTIONS } from '../../zzz-hp-backend/src/services/nanoka/nanokaBuffExtractor.js'
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

console.log('[5] 版本库正式配置：三个区可选，各区独立连乘，Buff 条目单独限制范围')

const zoneSnapshotUrl = new URL('../../zzz-hp-backend/scripts/data/zzz-hp-calculator-buffs.json', import.meta.url)
const {
  zoneDefinitions: definitions, zoneSchemes: schemes, agents, skills, skillSubcategories,
} = JSON.parse(readFileSync(zoneSnapshotUrl, 'utf8'))
const officialZones = [
  ['custom:emberMark', '烬痕', 'custom:emberMarkRatio', '烬痕比例', '烬痕区'],
  ['custom:finalDamage', '最终伤害', 'custom:finalDamageRatio', '最终伤害比例', '最终伤害区'],
  ['custom:bangbooMight', '一布之力', 'custom:bangbooMightRatio', '一布之力比例', '一布之力区'],
]

const effects = [
  { id: 'ember-base', stat: 'custom:emberMarkRatio', value: 20 },
  { id: 'ember-anomaly', stat: 'custom:emberMarkRatio', value: 10, conditions: { damageTypes: ['attributeAnomaly'] } },
  { id: 'final-damage', stat: 'custom:finalDamageRatio', value: 20 },
  { id: 'bangboo-might', stat: 'custom:bangbooMightRatio', value: 10 },
].map((effect) => createEmptyBuffEffect({ ...effect, enabledDefault: true, applyTarget: 'team' }))

const paths = [
  ['direct', 1.2],
  ['attributeAnomaly', 1.3],
  ['radiance', 1.2],
].map(([damageType, emberFactor]) => {
  const power = testAgent('power', { profession: '异常', element: damageType === 'radiance' ? '流明' : '风' })
  const fixture = eventFixture({ mode: 'extra-team', damageType, effects, agents: [testAgent('owner'), power] })
  const hit = { ...fixture.hits[0], skill: { ...fixture.skill, baseMult: 1000 }, effectiveBaseMult: 1000 }
  if (damageType === 'attributeAnomaly') hit.multOverrides = { attributeAnomalyMult: 500 }
  if (damageType === 'radiance') {
    hit.ownerAgentId = 'power'
    hit.triggerAgentId = 'power'
    hit.anomalyPowerAgentId = 'power'
    hit.multOverrides = { radianceMult: 100 }
  }
  const baseline = runtimeFor(fixture).getHitNumbers(hit)
  assert.ok(baseline?.perHit > 0, damageType)
  return { damageType, emberFactor, fixture, hit, baseline }
})

setRuntimeZoneDefinitions(definitions.filter((definition) => definition.enabled))
setRuntimeZoneSchemes(adaptZoneSchemes({ version: 1, definitions, schemes: schemes.filter((scheme) => scheme.enabled) }))
clearHitEvalCache()

check('三组名称分别属于定义、Buff 下拉和乘区结果', () => {
  const evaluated = runtimeFor(paths[0].fixture).getHitNumbers(paths[0].hit)
  for (const [key, name, stat, statLabel, detailLabel] of officialZones) {
    assert.equal(definitions.find((definition) => definition.zoneKey === key)?.label, name)
    assert.equal(BUFF_STAT_ZONES.find((zone) => zone.stat === stat)?.label, statLabel)
    assert.equal(evaluated?.result.zones?.[key]?.label, detailLabel)
  }
})

check('采集能映射的属性都有正式编辑入口，自定义属性同名且唯一', () => {
  const mappings = STAT_OPTIONS.flatMap((label) => ['%', '点'].flatMap((unit) => {
    const { effect } = mapKeywordsToEffect({ slots: { stat: label, action: '提升', value: 35, unit } })
    return effect ? [[label, effect.stat]] : []
  }))
  assert.ok(mappings.some(([label]) => label === '烬痕积攒量提升'))
  for (const [label, stat] of mappings) {
    assert.ok(buffStatZoneOf(stat), `${label} → ${stat}`)
    if (!stat.startsWith('custom:')) continue
    const options = BUFF_STAT_ZONES.filter((item) => item.stat === stat)
    assert.equal(options.length, 1, stat)
    assert.equal(options[0].label, label)
  }
})

for (const { damageType, emberFactor, fixture, hit, baseline } of paths) {
  check(damageType + '：Buff 范围独立生效，三个区各有一个格子', () => {
    const current = runtimeFor(fixture).getHitNumbers(hit)
    const detail = resolveSkillFlowCalculationDetail(fixture.context, null, hit)
    assert.ok(current && detail)
    if (damageType === 'radiance') assert.equal(current.result.remielSelfRadianceActive, true)
    const rows = buildEventZoneDisplay(detail)
    const factors = [emberFactor, 1.2, 1.1]
    for (const [index, [key, , , , detailLabel]] of officialZones.entries()) {
      assert.equal(current.result.zones?.[key]?.value, factors[index])
      assert.equal(rows.filter((row) => row.zoneKey === key && row.label === detailLabel).length, 1)
    }
    closeTo(current.perHit, baseline.perHit * emberFactor * 1.2 * 1.1, damageType)
    closeTo(detail.evaluation.perHit, current.perHit, damageType)
  })
}

check('无流程的面板结果与词条计算同样采用普通独立乘区', () => {
  const fixture = eventFixture({
    mode: 'extra-team', damageType: 'direct', effects,
    panels: { owner: makePanel({ atk: 1500, directDmgMult: 100 }), power: makePanel() },
  })
  const context = { ...fixture.context, hits: [] }
  const counts = createEmptyAffixCounts()
  const configuration = adaptZoneSchemes({ version: 1, definitions, schemes })
  setRuntimeZoneSchemes([])
  clearAffixEvalCache()
  const baseline = evaluateAffixCounts(context, counts)
  assert.ok(baseline.result.directDamageExpected > 0)
  setRuntimeZoneSchemes(configuration)
  clearAffixEvalCache()
  const current = evaluateAffixCounts(context, counts)
  closeTo(current.result.directDamageExpected, baseline.result.directDamageExpected * 1.2 * 1.2 * 1.1, "面板直伤")
  assert.equal(evaluateAffixCountsForSweep(context, counts).grandTotal, current.result.directDamageExpected)
})

check('挽昼二影两条增益按自身与仅队友分别结算，换位后仍按来源槽位匹配', () => {
  const emberZone = 'custom:emberMark'
  const stat = 'custom:emberMarkAccumulationBonus'
  const sunbringer = agents.find(({ id }) => id === 'sunbringer')
  const teammate = testAgent('power')
  const secondTeammate = testAgent('second-ally')
  const named = skills.find(({ id }) => id === 'sk-sunbringer-nk-1601007-main')
  const other = skills.find(({ id }) => id === 'sk-sunbringer-nk-1601014-main')
  const destruction = skills.find(({ id }) => id === 'sk-sunbringer-nk-1601114-毁伤')
  assert.ok(sunbringer && named && other && destruction)
  const teammateDestruction = { ...destruction, id: 'teammate-destruction', agentId: teammate.id }
  const teammateOrdinary = { ...teammateDestruction, id: 'teammate-ordinary', skillTypes: ['basic'] }
  const secondTeammateDestruction = { ...destruction, id: 'second-teammate-destruction', agentId: secondTeammate.id }
  const withoutRatio = { ...other, id: 'without-ratio', buffAnchorId: null }
  const eventSkills = [named, other, destruction, teammateDestruction, teammateOrdinary, withoutRatio, secondTeammateDestruction]
  const skillById = new Map(eventSkills.map((skill) => [skill.id, skill]))
  assert.equal(BUFF_STAT_ZONES.find((item) => item.stat === stat)?.label, '烬痕积攒量提升')
  const entries = sunbringer.mindscapeBuffs[2].effects.filter((effect) => effect.stat === stat)
  const shape = ({ id, applyTarget, skillTargets, value }) => [id, applyTarget, skillTargets ?? [], value]
  assert.deepEqual(entries.map(({ applyTarget }) => applyTarget), ['self', 'teammates'])
  assert.equal(entries[0].skillTargets, undefined)
  assert.deepEqual(entries[1].skillTargets, [{ category: 'destruction', subcategoryId: null }])
  const old = { ...entries[1], id: entries[0].id, applyTarget: 'team', skillTargetsOnlyForTeammates: true }
  assert.deepEqual(normalizeBuffEffects([old]).map(shape), [
    shape(entries[0]),
    shape({ ...entries[1], id: `${old.id}:teammates` }),
  ])
  assert.deepEqual(normalizeBuffEffects([old], false).map(shape), [shape(old)])

  const configuration = adaptZoneSchemes({ version: 1, definitions, schemes })
  function run(rank, extraEffects = [], moveProvider = false) {
    const testAgents = moveProvider ? [teammate, sunbringer, secondTeammate] : [sunbringer, teammate, secondTeammate]
    const fixture = eventFixture({ mode: 'extra-team', damageType: 'direct', effects: extraEffects,
      agents: testAgents, panels: Object.fromEntries(testAgents.map(({ id }) => [id, makePanel()])) })
    const teamSlots = testAgents.map(({ id }) => testSlot(id, id === sunbringer.id ? rank : 0))
    const { hits } = resolveFlow({
      teamSlots,
      slots: teamSlots.map(({ agentId }) => {
        const ownedSkills = eventSkills.filter((skill) => skill.agentId === agentId)
        return {
          prepared: ownedSkills.map((skill) => ({ id: skill.id, skillId: skill.id, skillSource: skill.source })),
          flow: ownedSkills.map((skill) => ({ id: skill.id, ownerAgentId: agentId,
            preparedId: skill.id, count: 1, staggerPhase: 'stagger' })),
        }
      }),
      findSkill: (id) => skillById.get(id) ?? null,
      resolveAgentProfession: (id) => testAgents.find((agent) => agent.id === id)?.profession,
      skillSubcategories,
    })
    assert.equal(hits.length, eventSkills.length)
    const runtime = createBuffCalculationRuntime(eventRuntimeInput(fixture, { contextInput: { teamSlots, hits } }))
    const hitsById = new Map(hits.map((hit) => [hit.id, hit]))
    return eventSkills.map((skill) => {
      const hit = hitsById.get(skill.id)
      assert.equal(hit?.ownerAgentId, skill.agentId)
      const detail = runtime.getHitDetail(hit)
      assert.ok(detail?.evaluation.perHit > 0, hit.id)
      return detail
    })
  }

  const factors = (details) => details.map(({ evaluation }) => evaluation.result.zones[emberZone].value)
  assert.deepEqual(factors(run(1)), [1.6, 1, 1.4, 1.4, 1, 1, 1.4])
  const secondRank = run(2)
  assert.deepEqual(factors(secondRank), [1.81, 1.405, 1.54, 1.54, 1, 1, 1.54])
  assert.deepEqual(factors(run(2, [], true)), factors(secondRank))
  const [namedDetail, , , , , noRatioDetail] = secondRank
  const formula = '1 + 60% × (1 + 35%) = 1.81'
  const rows = buildPipelineStageRows(namedDetail.evaluation.result).filter(({ id }) => id === emberZone)
  assert.deepEqual(rows.map(({ label, valueText }) => [label, valueText]), [['烬痕区', formula]])
  assert.deepEqual(buildEventZoneDisplay(namedDetail).find((item) => item.zoneKey === emberZone)?.groups,
    [{ label: '计算公式', items: [formula] }])
  assert.equal(noRatioDetail.evaluation.result.zones[emberZone].scaledPercentInputs.scalingPercent, 35)

  const [stacked] = run(2, [
    createEmptyBuffEffect({ id: 'extra-ratio', stat: 'custom:emberMarkRatio', value: 10, applyTarget: 'team' }),
    createEmptyBuffEffect({ id: 'extra-accumulation', stat, value: 5, applyTarget: 'team' }),
  ])
  assert.deepEqual(stacked.evaluation.result.zones[emberZone].scaledPercentInputs, {
    basePercent: 70, scalingPercent: 40, unboundedFactor: 1.98,
  })

  setRuntimeZoneSchemes([])
  clearHitEvalCache()
  const [baseline] = run(2)
  setRuntimeZoneSchemes(configuration)
  clearHitEvalCache()
  closeTo(namedDetail.evaluation.perHit, baseline.evaluation.perHit * 1.81, named.name)
})

setRuntimeZoneSchemes([])
setRuntimeZoneDefinitions([])
clearHitEvalCache()

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
