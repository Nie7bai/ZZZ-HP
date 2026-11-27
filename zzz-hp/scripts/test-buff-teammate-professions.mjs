import assert from 'node:assert/strict'
import { createEmptyBuffEffect, normalizeBuffEffect, packFromEffects } from '../src/utils/buffEffect.ts'
import { collectAllBuffEffects, collectPanelBuffMods } from '../src/utils/panelBuffCalc.ts'
import { extraCard, makePanelCtx, mindscapeWithEffects, testAgent, testSlot } from './_effectPipelineHarness.mjs'

const effect = normalizeBuffEffect({
  ...createEmptyBuffEffect({
    id: 'source-profession-gate',
    applyTarget: 'team',
    stat: 'dmgBonus',
    value: 25,
    applyProfession: '锋御',
  }),
  teammateProfessions: ['防护', '击破', '锋御', '击破'],
})
assert.deepEqual(effect.teammateProfessions, ['击破', '锋御', '防护'])
assert.equal(packFromEffects([effect]).teamMods.dmgBonus, 0, '带队伍条件的增益不预先折成无条件数值')

function sourceContext(teammates, mainSlotIndex = 0, sourceProfession = '锋御', gain = effect) {
  const source = testAgent('source', {
    profession: sourceProfession,
    mindscapeBuffs: mindscapeWithEffects([gain]),
  })
  const agents = [source, ...teammates.map((profession, index) => testAgent('teammate-' + index, { profession }))]
  return makePanelCtx({ agents, teamSlots: agents.map((agent) => testSlot(agent.id)), mainSlotIndex })
}

function damageBonus(ctx) {
  return collectPanelBuffMods(ctx).dmgBonus
}

assert.equal(damageBonus(sourceContext(['支援', '强攻'])), 0, '提供者本身的锋御不计入')
for (const profession of ['击破', '防护', '锋御']) {
  assert.equal(damageBonus(sourceContext([profession, '支援'])), 25, profession + '任一匹配即可')
}
assert.equal(damageBonus(sourceContext(['防护', '锋御'])), 25, '命中多个职业只加一次')
assert.equal(damageBonus(sourceContext(['防护', '锋御'], 1)), 0, '同时检查受益职业')
assert.equal(damageBonus(sourceContext(['锋御'], 1, '强攻')), 25, '从提供者视角核对队友，包括受益者')

const manualContext = sourceContext(['防护'], 0, '锋御', { ...effect, enabledDefault: false })
assert.equal(damageBonus(manualContext), 0)
const collected = collectAllBuffEffects(manualContext).find((item) => item.effect.teammateProfessions?.length)
assert.ok(collected)
const enabledIds = { [collected.effect.id]: true }
assert.equal(damageBonus({ ...manualContext, buffSelection: { enabledIds } }), 25)
assert.equal(damageBonus({
  ...manualContext,
  teamSlots: [testSlot('source')],
  buffSelection: { enabledIds },
}), 0, '手动开启仍需满足队友职业')

const sharpenEffect = {
  ...effect,
  stat: 'sharpenCritDmgBonus',
  conditions: { damageTypes: ['sharpen'] },
  enabledDefault: false,
}
const sharpenContext = sourceContext(['防护'], 0, '锋御', sharpenEffect)
sharpenContext.skillContext.directSubKind = 'sharpen'
const [sharpenRow] = collectAllBuffEffects(sharpenContext).filter((item) => item.effect.stat === sharpenEffect.stat)
assert.ok(sharpenRow)
const enabledSharpenContext = {
  ...sharpenContext,
  buffSelection: { enabledIds: { [sharpenRow.effect.id]: true } },
}
assert.equal(collectPanelBuffMods(sharpenContext).sharpenCritDmgBonus, 0)
assert.equal(collectPanelBuffMods(enabledSharpenContext).sharpenCritDmgBonus, 25)
assert.equal(collectPanelBuffMods({
  ...enabledSharpenContext,
  skillContext: { ...sharpenContext.skillContext, directSubKind: 'normal' },
}).sharpenCritDmgBonus, 0, '队友条件和伤害类型条件同时生效')

const extra = extraCard('extra-profession-gate', {
  stat: 'dmgBonus',
  value: 15,
  teammateProfessions: ['锋御'],
}, { applySlot: 'team', sourceSlot: 0 })
const extraAgents = [testAgent('a', { profession: '锋御' }), testAgent('b', { profession: '支援' })]
const extraContext = makePanelCtx({
  agents: extraAgents,
  teamSlots: extraAgents.map((agent) => testSlot(agent.id)),
  mainSlotIndex: 1,
  extraGains: [extra],
})
assert.equal(damageBonus(extraContext), 0, '额外增益排除自身配置的来源槽')
assert.equal(damageBonus({
  ...extraContext,
  extraGains: [{ ...extra, sourceSlot: 1 }],
}), 15, '额外增益沿用同一个队伍条件')

console.log('队友职业条件的保存与结算回归通过')
