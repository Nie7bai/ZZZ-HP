/** 流程数字、完整来源与展示公式的同源回归；不依赖服务或外部方案。 */
import assert from 'node:assert/strict'
import { buildOptimalEvalContext, withAffixLibraryExtraGains } from '../src/utils/optimalAffixAlloc.ts'
import { evaluateSkillFlowHit, resolveSkillFlowCalculationDetail } from '../src/utils/skillFlowCalculation.ts'
import { resolveFlow, resolveFlowEntryCount, resolveFlowMemberCount, summarizeFlowHit } from '../src/utils/resolvedHit.ts'
import { findMemberOverride, sortSkillGroupMembers } from '../src/utils/skillGroup.ts'
import { buildAlignedDirectFormulaGroup } from '../src/utils/directDamageDisplay.ts'
import { buildAlignedAnomalyFormulaGroups } from '../src/utils/anomalyFormulaDisplay.ts'
import { pickEventDamage } from '../src/utils/damageEvent.ts'
import { buildEventZoneDisplay } from '../src/utils/eventDamageSourceTips.ts'
import { skillCalcZoneGroup } from '../src/utils/skillCalcZones.ts'
import { createDefaultAffixDriveDiscMainStats } from '../src/types/calculatorPanel.ts'
import { invalidateBuffCatalogCache } from '../src/utils/panelBuffCalc.ts'
import { makePanel, dummyBangboo, testAgent, testSlot, extraCard } from './_effectPipelineHarness.mjs'

let passed = 0
function check(name, action) {
  action()
  passed += 1
  console.log(`PASS ${name}`)
}

const agents = [testAgent('a'), testAgent('b', { element: '风', profession: '锋御' }), testAgent('remiel', { name: '蕾米埃尔', element: '流明' })]
const teamSlots = agents.map((agent) => testSlot(agent.id))
const panel = makePanel({
  atk: 2317, def: 1300, critRate: 37, critDmg: 123, dmgBonus: 40, mastery: 280,
  attributeAnomalyCritRate: 35, attributeAnomalyCritDmg: 80,
  disorderCritRate: 35, disorderCritDmg: 80,
  turbulenceCritRate: 35, turbulenceCritDmg: 80,
  anomalyReleaseCritRate: 35, anomalyReleaseCritDmg: 80,
  radianceCritRate: 35, radianceCritDmg: 80,
  disorderBaseMult: 450, disorderCompMult: 7.5, anomalyDuration: 10,
  sharpenCritDmgBonus: 60, sharpenDmgBonus: 22,
})
const activeSlotPanels = { a: panel, b: makePanel({ ...panel, atk: 3781, def: 1700 }), remiel: makePanel({ ...panel, atk: 3163 }) }
const types = ['direct', 'sharpen', 'attributeAnomaly', 'disorder', 'turbulence', 'anomalyRelease', 'radiance']
const skills = Object.fromEntries(types.map((damageType) => [damageType, {
  id: damageType, name: '同名招式', agentId: '', source: 'custom', damageType,
  skillTypes: damageType === 'direct' || damageType === 'sharpen' ? ['basic'] : [],
  baseMult: damageType === 'radiance' ? 360 : 250,
  settlementMult: damageType === 'direct' ? 35 : 0,
}]))
const prepared = types.map((type) => ({
  id: `prep-${type}`, skillId: type, skillSource: 'custom',
  anomalyPowerAgentId: 'a', triggerAgentId: type === 'radiance' ? 'remiel' : 'b',
}))
const flow = types.map((type) => ({
  id: `flow-${type}`, ownerAgentId: 'a', preparedId: `prep-${type}`,
  count: 3, staggerPhase: 'stagger', critMode: 'expected',
}))
const group = {
  id: 'group', name: '重复招式技能组', agentId: 'a', source: 'custom',
  members: [
    { skillId: 'direct', order: 0, count: 2, includeInFlow: true },
    { skillId: 'direct', order: 1, count: 4, includeInFlow: true },
  ],
}
const slots = [{
  prepared: [...prepared.filter((item) => item.skillId !== 'radiance'), { id: 'prep-group', skillGroupId: group.id, skillSource: 'custom' }],
  flow: [...flow.filter((item) => item.preparedId !== 'prep-radiance'), { id: 'flow-group', ownerAgentId: 'a', preparedId: 'prep-group', count: 2, staggerPhase: 'normal', critMode: 'noCrit' }],
}, { prepared: [], flow: [] }, {
  prepared: prepared.filter((item) => item.skillId === 'radiance'),
  flow: flow.filter((item) => item.preparedId === 'prep-radiance').map((item) => ({ ...item, ownerAgentId: 'remiel' })),
}]
const hits = resolveFlow({
  slots, teamSlots, findSkill: (id) => skills[id], findSkillGroup: () => group,
  resolveAgentProfession: (id) => agents.find((agent) => agent.id === id)?.profession,
}).hits
const gain = extraCard(
  'allocated-dmg',
  { stat: 'dmgBonus', value: 19, applyTarget: 'team' },
  { name: '分配产生的局内增伤', applySlot: 'team' },
)
function context(overrides = {}) {
  invalidateBuffCatalogCache()
  return buildOptimalEvalContext({
    isMb: false, teamSlots, agents, wengines: [], bangboo: dummyBangboo(), bangbooRefine: 1,
    driveDiscs: [], mainSlotIndex: 0, driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
    enemyInput: { level: 60, defense: 953, resistanceType: 'normal', vulnerableMultiplier: 1, staggerMultiplier: 2, specialMultiplier: 1 },
    baseDamageSource: 'atk', activeSlotPanels, hits, extraGains: [], ...overrides,
  })
}
const numericFormat = (value) => String(value)

for (const source of ['config', 'allocation', 'sweep']) {
  const ctx = source === 'config' ? context() : withAffixLibraryExtraGains(context(), [gain])
  const external = source === 'config' ? null : makePanel({ ...panel, atk: source === 'allocation' ? 3001 : 3503 })
  for (const hit of hits) {
    check(`${source} ${hit.id}：数字与完整来源一致`, () => {
      const numeric = evaluateSkillFlowHit(ctx, external, hit)
      const full = resolveSkillFlowCalculationDetail(ctx, external, hit)
      assert.ok(numeric && full)
      assert.deepEqual(full.evaluation.result, numeric.result)
      assert.equal(full.evaluation.perHit, numeric.perHit)
      assert.equal(full.evaluation.total, numeric.perHit * hit.count)
      assert.equal(full.evaluation.eventId, hit.id)
      assert.deepEqual(full.enemyInput, ctx.enemyInput)
    })
  }
}

const ctx = context()
for (const hit of hits.filter((hit) => !hit.id.startsWith('flow-group#'))) {
  const detail = resolveSkillFlowCalculationDetail(ctx, null, hit)?.evaluation
  assert.ok(detail)
  for (const mode of ['expected', 'noCrit', 'fullCrit']) {
    check(`${hit.skill.damageType} ${mode}：公式乘区与最终伤害采用同一口径`, () => {
      const direct = hit.damageKind === 'direct'
      const formula = direct
        ? buildAlignedDirectFormulaGroup(detail.result, numericFormat, numericFormat, undefined, mode)
        : buildAlignedAnomalyFormulaGroups(detail.result, hit.anomalySubKind, '紊乱', numericFormat, numericFormat, undefined, mode).at(-1)
      assert.equal(Number(formula.result), pickEventDamage(detail.result, hit.skill.damageType, mode))
      const segments = formula.sumMultZones?.length
        ? formula.sumMultZones.map((zone) => [...formula.terms, zone])
        : [formula.terms]
      const reconstructed = segments.reduce((sum, terms) => sum + terms.reduce((product, term) => product * Number(term.value), 1), 0)
      assert.ok(Math.abs(reconstructed - Number(formula.result)) <= 1, `公式复算 ${reconstructed}，引擎结果 ${formula.result}`)
      if (hit.skill.damageType === 'radiance') {
        assert.equal(Number(formula.terms.find((term) => term.tipsKey === 'radianceMultZone').value), detail.result.radianceMultZone)
      }
    })
  }
}

check('组内同名招式保留独立事件、成员次数乘整组次数', () => {
  const members = hits.filter((hit) => hit.id.startsWith('flow-group#'))
  assert.equal(members.length, 2)
  assert.notEqual(members[0].id, members[1].id)
  assert.deepEqual(members.map((hit) => hit.count), [4, 8])
  const first = resolveSkillFlowCalculationDetail(context(), null, members[0]).evaluation
  const second = resolveSkillFlowCalculationDetail(context(), null, members[1]).evaluation
  assert.equal(second.total, first.total * 2)
})
check('轻量合计：单次 × 次数 与结算 total 一致（含技能组各段）', () => {
  const evalCtx = context()
  for (const hit of hits) {
    const numeric = evaluateSkillFlowHit(evalCtx, null, hit)
    assert.ok(numeric)
    assert.deepEqual(summarizeFlowHit(numeric.result, hit.skill, hit.count), {
      count: numeric.hit.count,
      perHit: numeric.perHit,
      total: numeric.total,
    })
  }
})
check('合计次数来源：普通行按整行，技能组段按 成员覆盖 > 成员定义 × 整行', () => {
  const members = sortSkillGroupMembers(group.members)
  for (const entry of slots.flatMap((slot) => slot.flow)) {
    if (entry.id === 'flow-group') {
      members.forEach((member, memberIndex) => {
        const hit = hits.find((item) => item.id === `${entry.id}#${memberIndex}:${member.skillId}`)
        assert.ok(hit)
        assert.equal(
          resolveFlowMemberCount(entry, member, findMemberOverride(entry.memberOverrides, member)),
          hit.count,
        )
      })
      continue
    }
    const hit = hits.find((item) => item.id === entry.id)
    assert.ok(hit)
    assert.equal(resolveFlowEntryCount(entry), hit.count)
  }

  const overrideEntry = {
    id: 'flow-override', ownerAgentId: 'a', preparedId: 'prep-group',
    count: 5, staggerPhase: 'normal', critMode: 'expected',
    memberOverrides: [{ memberKey: '1:direct', skillId: 'direct', count: 3 }],
  }
  const overrideHits = resolveFlow({
    slots: [
      { prepared: [{ id: 'prep-group', skillGroupId: group.id, skillSource: 'custom' }], flow: [overrideEntry] },
      { prepared: [], flow: [] },
      { prepared: [], flow: [] },
    ],
    teamSlots,
    findSkill: (id) => skills[id],
    findSkillGroup: () => group,
    resolveAgentProfession: (id) => agents.find((agent) => agent.id === id)?.profession,
  }).hits
  assert.deepEqual(overrideHits.map((hit) => hit.count), [10, 15])
  members.forEach((member, memberIndex) => {
    assert.equal(
      resolveFlowMemberCount(overrideEntry, member, findMemberOverride(overrideEntry.memberOverrides, member)),
      overrideHits[memberIndex].count,
    )
  })
})
check('合计缺数据时不显示：无结算结果 / 次数 0 / 非法单次伤害', () => {
  const numeric = evaluateSkillFlowHit(context(), null, hits[0])
  assert.ok(numeric)
  assert.equal(summarizeFlowHit(null, numeric.hit.skill, 1), null)
  assert.equal(summarizeFlowHit(numeric.result, null, 1), null)
  assert.equal(summarizeFlowHit(numeric.result, numeric.hit.skill, 0), null)
  assert.equal(summarizeFlowHit(numeric.result, numeric.hit.skill, -1), null)
  assert.equal(summarizeFlowHit({}, numeric.hit.skill, 1), null)
})
check('主槽之外的锋御招式使用本人的面板及直伤路径', () => {
  const hit = { ...hits[0], id: 'other-owner', ownerAgentId: 'b' }
  const detail = resolveSkillFlowCalculationDetail(context(), null, hit).evaluation
  assert.equal(detail.external.def, activeSlotPanels.b.def)
  assert.equal(detail.result.useSharpenFormula, true)
})
check('分配的局内增益出现在公式数值和来源中', () => {
  const baseline = resolveSkillFlowCalculationDetail(context(), panel, hits[0]).evaluation
  const modified = resolveSkillFlowCalculationDetail(withAffixLibraryExtraGains(context(), [gain]), panel, hits[0]).evaluation
  assert.ok(modified.perHit > baseline.perHit)
  assert.ok(JSON.stringify(modified.breakdown.sources).includes(gain.id))
})
check('行级禁用额外增益时，数字与完整来源同步排除', () => {
  const row = { ...hits[0], buffOverride: { disabledBlockIds: ['extra-allocated-dmg'] } }
  const contextWithGain = withAffixLibraryExtraGains(context(), [gain])
  const disabled = resolveSkillFlowCalculationDetail(contextWithGain, panel, row).evaluation
  const baseline = evaluateSkillFlowHit(context(), panel, hits[0])
  assert.equal(disabled.perHit, baseline.perHit)
  assert.deepEqual(disabled.result, evaluateSkillFlowHit(contextWithGain, panel, row).result)
})
check('缺招式持有者面板：数字与详情都不出伤', () => {
  const ctx = context({ activeSlotPanels: { a: panel } })
  const hit = { ...hits[0], ownerAgentId: 'b' }
  assert.equal(evaluateSkillFlowHit(ctx, null, hit), null)
  assert.equal(resolveSkillFlowCalculationDetail(ctx, null, hit), null)
})
check('缺强度提供者面板或代理人：数字与详情都跳过', () => {
  const ctx = context({ activeSlotPanels: { a: panel } })
  for (const power of ['b', null]) {
    const hit = { ...hits[2], anomalyPowerAgentId: power }
    assert.equal(evaluateSkillFlowHit(ctx, null, hit), null)
    assert.equal(resolveSkillFlowCalculationDetail(ctx, null, hit), null)
  }
})
check('敌方变化后，详情不复用旧数字', () => {
  const ctx = context()
  const before = resolveSkillFlowCalculationDetail(ctx, null, hits[0]).evaluation
  ctx.enemyInput = { ...ctx.enemyInput, defense: 2400 }
  const after = resolveSkillFlowCalculationDetail(ctx, null, hits[0]).evaluation
  assert.ok(after.perHit < before.perHit)
  assert.deepEqual(after.result, evaluateSkillFlowHit(ctx, null, hits[0]).result)
})
for (const mode of ['ordinary', 'extra-slot', 'extra-team']) {
  const { r3Fixture, r5Fixture } = await import('./_eventElementHarness.mjs')
  const f = r3Fixture(mode)
  check(`R3 ${mode} real flow detail cross-element`, () => {
    const result = resolveSkillFlowCalculationDetail(f.context, null, f.hits[0]).evaluation
    assert.equal(result.defenseTriggerFinalPanel.anomalyReleaseMult, 51.2)
    assert.equal(result.eventElement, '电')
    assert.deepEqual(result.result, evaluateSkillFlowHit(f.context, null, f.hits[0]).result)
  })
  const r5 = r5Fixture(mode)
  check(`R5 ${mode} real release detail`, () => assert.equal(resolveSkillFlowCalculationDetail(r5.context, null, r5.hits[0]).evaluation.defenseTriggerFinalPanel.anomalyReleaseMult, 150))
}

const { r5Fixture: zoneGroupFixture } = await import('./_eventElementHarness.mjs')
const zoneGroupRows = buildEventZoneDisplay(
  resolveSkillFlowCalculationDetail(zoneGroupFixture('ordinary').context, null, zoneGroupFixture('ordinary').hits[0]),
)

check('乘区归属：易伤与异常/异放/耀变倍率归触发者，紊乱/乱流倍率归提供者', () => {
  // 所有者 2026-11-01 口径；分组只读这张表，改归属先改这里
  for (const label of ['易伤区', '属性异常倍率区', '异放倍率区', '耀变倍率区']) {
    assert.equal(skillCalcZoneGroup(label), 'trigger', label)
  }
  for (const label of ['紊乱倍率区', '乱流倍率区', '紊乱基础倍率', '乱流基础倍率', '紊乱补偿倍率', '乱流补偿倍率']) {
    assert.equal(skillCalcZoneGroup(label), 'producer', label)
  }
})
check('异常类计算过程按归属拆成提供者 / 触发者 / 共用 / 结果', () => {
  const groups = new Map(zoneGroupRows.map((row) => [row.label, skillCalcZoneGroup(row.label)]))
  assert.equal(groups.get('面板攻击力'), 'producer')
  assert.equal(groups.get('异放倍率区'), 'trigger')
  assert.equal(groups.get('易伤区'), 'trigger')
  assert.equal(groups.get('防御区'), 'mixed')
  assert.equal(groups.get('期望伤害'), 'result')
})
check('易伤区在直伤与异常类格子都只显示「易伤区」', () => {
  const directHit = hits.find((hit) => hit.skill.damageType === 'direct')
  assert.ok(directHit, '需要一个直伤样本')
  const directRows = buildEventZoneDisplay(resolveSkillFlowCalculationDetail(context(), null, directHit))
  const directLabels = directRows.map((row) => row.label)
  assert.ok(directLabels.includes('易伤区'), directLabels.join('/'))
  assert.ok(!directLabels.includes('直伤易伤区'), directLabels.join('/'))
  const anomalyLabels = zoneGroupRows.map((row) => row.label)
  assert.ok(anomalyLabels.includes('易伤区'), anomalyLabels.join('/'))
  assert.ok(!anomalyLabels.includes('非直伤易伤区'), anomalyLabels.join('/'))
})

console.log(`\n${passed} passed, 0 failed`)
