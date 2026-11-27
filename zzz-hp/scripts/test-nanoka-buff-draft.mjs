import assert from 'node:assert/strict'
import { reactive } from 'vue'
import { normalizeBuffEffect } from '../src/utils/buffEffect.ts'
import { buildEffectRows, splitRow, toggleRowDamageType } from '../src/utils/buffEffectRows.ts'
import { createNanokaBuffDraft, nanokaDraftApplyRows, refreshNanokaBuffDraft, rememberNanokaDraftEdits, replaceNanokaKeywordSkillTargets } from '../src/utils/nanokaBuffDraft.ts'

const keyword = (patch = {}) => ({
  key: 'core#0', itemSlot: 'core', itemSlotLabel: '核心被动', source: 'passive.core', containerIndex: 0,
  title: '核心被动：测试', rawText: '原文说明', origin: '原始来源', slots: {}, convert: null,
  anchors: { ok: true, pendingCreates: [] }, skillDesc: null,
  gain: normalizeBuffEffect({ id: 'source', stat: 'dmgBonus', kind: 'fixed', value: 20, applyTarget: 'self', scope: ['attributeAnomaly', 'disorder'], groupId: 'group' }),
  recorded: true, included: true, blocked: false, dirty: {}, ...patch,
})

const rows = reactive([keyword()])
const slots = reactive(createNanokaBuffDraft('agent', rows))
assert.deepEqual(slots['0'][0].effects[0].conditions, { damageTypes: ['attributeAnomaly', 'disorder'] })
assert.equal(slots['0'][0].effects[0].groupId, 'group')
slots['0'][0].name = '人工块名'
slots['0'][0].note = '人工备注'
slots['0'][0].effects[0].value = 45
rememberNanokaDraftEdits(slots, rows)
assert.equal(rows[0].gain.value, 45)
assert.equal(rows[0].dirty.value, true)
rows[0].gain.value = 100
refreshNanokaBuffDraft('agent', slots, rows)
assert.equal(slots['0'][0].effects[0].value, 45, '再次解析必须保护人工值')
assert.equal(slots['0'][0].name, '人工块名')
const payload = nanokaDraftApplyRows('agent', slots, rows)
assert.equal(payload[0].effect.origin, '原始来源', '内部关键字关联不能泄漏进库')
assert.equal(payload[0].block.note, '人工备注')
assert.equal(payload[0].effect.value, 45)

const beforeSplit = slots['0'][0]
beforeSplit.effects = splitRow(beforeSplit.effects, buildEffectRows(beforeSplit.effects)[0], () => 'split')
assert.equal(beforeSplit.effects.length, 2)
assert.equal(nanokaDraftApplyRows('agent', slots, rows).length, 2, '拆分后不能只提交原先一条关键字')
rememberNanokaDraftEdits(slots, rows)
refreshNanokaBuffDraft('agent', slots, rows)
assert.deepEqual(beforeSplit.effects.map((item) => item.conditions.damageTypes), [['attributeAnomaly'], ['disorder']], '重解析保持手动拆分类型')
beforeSplit.effects = []
rememberNanokaDraftEdits(slots, rows)
refreshNanokaBuffDraft('agent', slots, rows)
assert.equal(beforeSplit.effects.length, 0, '删除的效果不能在重解析时复活')

const emptyRows = [keyword({ gain: null })]
assert.deepEqual(createNanokaBuffDraft('agent', emptyRows), {}, '映射失败不能制造默认增伤零值')
const weapons = createNanokaBuffDraft('wengine', [keyword({ itemSlot: 'fixed', source: 'fixed', containerIndex: null }), keyword({ key: 'ref#0', itemSlot: 'refinement-2', source: 'refinement', containerIndex: 1 })])
assert.equal(weapons.fixed.length, 1)
assert.equal(weapons['1'].length, 1)
const manual = nanokaDraftApplyRows('agent', { '6': [{ id: 'manual-block', name: '6影', effects: [normalizeBuffEffect({ id: 'manual', stat: 'critRate', kind: 'fixed', value: 10, applyTarget: 'self' })] }] }, [])
assert.equal(manual[0].containerIndex, 6)
assert.equal(manual[0].rawText, '')
assert.equal(manual[0].anchors, null)

// 正式编辑器联动后生成新 id，仍能跟踪原关键字并提交全部子类效果。
const zoneRows = [keyword({ gain: normalizeBuffEffect({ id: 'z', stat: 'attributeAnomalyDmgBonus', kind: 'fixed', value: 20, applyTarget: 'self' }) })]
const zones = createNanokaBuffDraft('agent', zoneRows)
const zoneBlock = zones['0'][0]
zoneBlock.effects = toggleRowDamageType(zoneBlock.effects, buildEffectRows(zoneBlock.effects)[0], 'disorder', true)
assert.equal(nanokaDraftApplyRows('agent', zones, zoneRows).length, zoneBlock.effects.length)

const basic = { category: 'basic', subcategoryId: null }
const special = { category: 'special', subcategoryId: null }
const named = { category: 'special', subcategoryId: 'named' }
const subcategories = [{ id: 'named', categoryId: 'special', name: '具体强化特殊技' }]
const unresolved = keyword({
  recorded: false,
  gain: null,
  anchors: {
    ok: false, skillTargets: [basic, special], reason: '未找到锚点',
    pendingCreates: [
      { name: '普通攻击', categoryId: 'basic', agentId: 'test' },
      { name: '强化特殊技', categoryId: 'special', agentId: 'test' },
    ],
  },
  slots: { scope: '锐化' },
})
replaceNanokaKeywordSkillTargets(unresolved, [basic, special], subcategories, basic)
assert.equal(unresolved.recorded, true)
assert.equal(unresolved.anchors.reason, '')
assert.deepEqual(unresolved.anchors.pendingCreates.map((item) => item.categoryId), ['special'])
replaceNanokaKeywordSkillTargets(unresolved, [basic, named], subcategories, named)
assert.deepEqual(unresolved.anchors.skillTargets, [basic, named])
assert.deepEqual(unresolved.anchors.labels, ['普通攻击', '具体强化特殊技'])
assert.deepEqual(unresolved.anchors.pendingCreates, [], '被替换的自动计划不能覆盖手选目标')
assert.equal(unresolved.slots.scope, '锐化')
replaceNanokaKeywordSkillTargets(unresolved, [], subcategories)
assert.deepEqual(unresolved.anchors.skillTargets, [])
assert.equal(unresolved.anchors.skillCategory, '')
assert.equal(unresolved.anchors.skillSubcategoryId, null)
assert.equal(unresolved.slots.scope, '锐化')

console.log('nanoka 采集编辑草稿回归通过')
