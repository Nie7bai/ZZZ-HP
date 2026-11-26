/**
 * nanoka 增益抽取 v3 自测（`src/services/nanoka/nanokaBuffExtractor.js` +
 * `src/services/nanokaBuffService.js` + 路由接线）。
 *
 * 运行：`node --test scripts/nanoka-buff-extractor.test.mjs`
 *
 * **本文件不连库、不写库**：抽取/映射/合并全是纯函数；写库计划只喂假对象；
 * `applyBuffItems` / `extractBuffItems` 只测「参数不对时在碰库之前就抛中文错误」。
 *
 * 夹具：开发目录缓存的 nanoka 真实响应（不联网、不进仓库）：
 *   `D:/WB_agent_out/ZZZ-HP/artifacts/nanoka-probe/cache/char-<tag>-<id>.json`
 *   `D:/WB_agent_out/ZZZ-HP/artifacts/nanoka-probe/cache/weapon-<tag>-<id>.json`
 * 缓存不存在时，依赖夹具的用例跳过（可用 `NANOKA_CACHE` 指定目录）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_OPTIONS,
  CONVERT_FROM_OPTIONS,
  CONVERT_PANEL_SOURCE_OPTIONS,
  CONVERT_SLOT_HINTS,
  CONDITION_OPTIONS,
  CONVERT_SLOT_IDS,
  CONVERT_SLOT_LABELS,
  GAME_LITERAL_REWRITES,
  MULTI_SLOT_IDS,
  NONE,
  SLOT_IDS,
  SLOT_OPTIONS,
  UNABLE,
  STAT_OPTIONS,
  buildRulesTable,
  checkKeywordMappable,
  enforceSlotWhitelist,
  cleanNanokaText,
  detectSkillLimits,
  extractAgentBuffItems,
  extractKeywordEffects,
  extractNumbers,
  extractWengineBuffItems,
  formatKeywordLine,
  formatKeywordSlots,
  formatSourceBlock,
  isConvertClause,
  isEmptySlot,
  mapKeywordsToEffect,
  readConvertParts,
  readDurationInfo,
  readStackInfo,
  refineStatKeyword,
  resolveStatField,
  simplifyText,
  slotView,
  splitUnits,
  unableSlotsOf,
} from '../src/services/nanoka/nanokaBuffExtractor.js'
import {
  MERGE_FIELD_LIST,
  appendSourceText,
  applyAnchorPlanToRows,
  applyBuffItems,
  countTargetEffects,
  extractBuffItems,
  listEmptyBuffTargets,
  matchSkillDescTargets,
  planAnchorCreations,
  planBuffApply,
  resolveRowConflicts,
  resolveSlotTarget,
  sanitizeEffect,
  smartMergeParse,
  summarizeItems,
} from '../src/services/nanokaBuffService.js'
import { normalizeBuffScopes, normalizeEffectList } from '../src/services/calculatorBuffService.js'
import { buildAffixEffectTemplate } from '../src/utils/affixEffectTemplate.js'
import nanokaBuffRoutes from '../src/routes/nanokaBuffRoutes.js'
import { requireAdmin } from '../src/middleware/requireAdmin.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CACHE =
  process.env.NANOKA_CACHE ?? path.resolve(here, '../../../../ZZZ-HP/artifacts/nanoka-probe/cache')
const cacheNames = fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []
const SKIP = cacheNames.length ? false : `未找到 nanoka 缓存夹具：${CACHE}`

/** 夹具文件名带 build tag（`char-3.3.12_19566749-1041.json`），tag 会变 → 按前缀 + id 找 */
function readFixture(prefix, id) {
  const name = cacheNames.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(`-${id}.json`))
  assert.ok(name, `缺少夹具 ${prefix}-*-${id}.json（${CACHE}）`)
  return JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8'))
}

/** 造一条关键字（9 槽位**不许缺格**） */
function keyword(overrides = {}) {
  const slots = {
    stat: '增伤',
    elements: [NONE],
    action: '提升',
    value: 10,
    unit: '%',
    target: NONE,
    conditions: [NONE],
    stacks: NONE,
    duration: NONE,
    object: NONE,
    ...overrides.slots,
  }
  return {
    id: overrides.id ?? 'k1',
    key: overrides.key ?? overrides.id ?? 'k1',
    origin: overrides.origin ?? 'nanoka:test:manual',
    slots,
    convert: overrides.convert ?? null,
    stackMax: overrides.stackMax ?? null,
    durationSeconds: overrides.durationSeconds ?? null,
    anchors: overrides.anchors ?? null,
    rawText: overrides.rawText ?? '',
  }
}

function firstEffect(text, options = {}) {
  const { effects, waste } = extractKeywordEffects({ text, origin: 'test', ...options })
  return { effect: effects[0], effects, waste }
}

// ================================================================== 1. 文本工具

test('文本工具：去标签 / 抽数值 / 切句 / 层数 / 时长', () => {
  assert.equal(cleanNanokaText('<color=#2BAD00>70%</color>\\n提升'), '70%\n提升')
  assert.equal(cleanNanokaText('{CAL:1041}造成伤害'), '造成伤害')
  assert.equal(cleanNanokaText('点按 <IconMap:Icon_Normal> 发动'), '点按 发动')

  assert.deepEqual(extractNumbers('提升70%，持续15秒'), [
    { value: 70, unit: '%', percent: true },
    { value: 15, unit: '点', percent: false },
  ])

  const units = splitUnits('第一句，子句。第二句；')
  assert.equal(units.length, 2)
  assert.deepEqual(units[0].clauses, ['第一句', '子句'])

  assert.deepEqual(readStackInfo('造成伤害提升3%，最多叠加12层'), {
    maxStacks: 12,
    perStack: false,
    mentioned: true,
  })
  assert.deepEqual(readStackInfo('每层提升2.5%，最多12层'), {
    maxStacks: 12,
    perStack: true,
    mentioned: true,
  })
  assert.deepEqual(readStackInfo('获得8层充能'), { maxStacks: null, perStack: false, mentioned: false })

  assert.deepEqual(readDurationInfo('持续20秒，重复触发刷新持续时间'), {
    seconds: 20,
    mentioned: true,
  })
  // 「该效果的持续时间提升2秒」：`持续时间` 是**属性**，不是时长槽位
  assert.equal(readDurationInfo('该效果的持续时间提升2秒').mentioned, false)
  assert.equal(readDurationInfo('持续时间提升2秒').seconds, null)
})

test('只展开有词表或通用属性兜底的空术语标签，保留已有的标签内文字', () => {
  assert.equal(cleanNanokaText('<Term:20></Term>提升25%', { 20: '锐暴伤害' }), '锐暴伤害提升25%')
  assert.equal(cleanNanokaText('<Term:3000015></Term>提升25%'), '锐暴伤害提升25%')
  assert.equal(cleanNanokaText('<Term:20>暴击率</Term>', { 20: '锐暴伤害' }), '暴击率')
  assert.equal(cleanNanokaText('<Term:20></Term>提升25%'), '提升25%')
})

// ================================================================== 2. 9 槽位模型

test('每条关键字都能渲染出完整槽位，属性沿用工具语义', () => {
  const { effect } = firstEffect('造成的伤害提升10%')
  assert.deepEqual(Object.keys(effect.slots), SLOT_IDS)
  for (const id of SLOT_IDS) assert.ok(id in effect.slots, `缺少槽位 ${id}`)
  assert.match(
    formatKeywordSlots(effect.slots),
    /^属性=增伤 元素=无 动作=提升 数值=10 单位=% 目标=无 条件=无 队友职业（满足任一）=无 作用域=无 层数=无 默认启用=无 时长=无 对象=无$/,
  )
})

test('元素不拆条，一条关键字带多个元素', () => {
  assert.deepEqual(MULTI_SLOT_IDS, ['conditions', 'elements', 'teammateProfessions'])
  const { effects } = extractKeywordEffects({
    text: '造成的火属性伤害和冰属性伤害提升10%',
    origin: 'test',
  })
  assert.equal(effects.length, 1, '多元素不拆条')
  assert.equal(effects[0].slots.stat, '增伤', '多元素时属性退成通用语义')
  assert.deepEqual(effects[0].slots.elements, ['火', '冰'])
  const mapped = mapKeywordsToEffect({
    slots: effects[0].slots,
    id: 'e1',
    origin: 'test',
  })
  assert.equal(mapped.effect.stat, 'dmgBonus')
  assert.deepEqual(mapped.effect.elementFilter, ['火', '冰'])

  // 单元素也**统一走元素槽**（用户 2026-10-16：输出统一，不再用「属性=火属性伤害」）
  const single = firstEffect('造成的火属性伤害提升10%')
  assert.equal(single.effect.slots.stat, '增伤')
  assert.deepEqual(single.effect.slots.elements, ['火'])
  const singleMapped = mapKeywordsToEffect({ slots: single.effect.slots })
  assert.equal(singleMapped.effect.stat, 'dmgBonus')
  assert.deepEqual(singleMapped.effect.elementFilter, ['火'])

  // 「全属性伤害」= 不限元素 → 元素槽留空、elementFilter 保持 all
  const all = firstEffect('造成的全属性伤害提升10%')
  assert.equal(all.effect.slots.stat, '增伤')
  assert.deepEqual(all.effect.slots.elements, [NONE])
  assert.equal(mapKeywordsToEffect({ slots: all.effect.slots }).effect.elementFilter, 'all')

  // 旧字样仍能被识别（手动 / 老数据）：属性=火属性伤害 照样映射成元素过滤
  const legacy = mapKeywordsToEffect(keyword({ slots: { stat: '火属性伤害' } }))
  assert.equal(legacy.effect.stat, 'dmgBonus')
  assert.deepEqual(legacy.effect.elementFilter, ['火'])
})

test('`无` 与 `无法提取` 严格区分：没出现写「无」，出现但归不了类写「无法提取」', () => {
  // 动作 + 属性都认不出 → 可映射性预检在阶段1 就把它整条丢进废原文（不是「无法提取」）
  const wasteCase = firstEffect('队伍中任意角色对敌人造成属性异常伤害时')
  assert.equal(wasteCase.effects.length, 0)

  // 有动作、有属性（能映射），但数值读不出（「大量」）→ 数值标「无法提取」，该条**仍然进阶段二**等用户补
  const unableCase = firstEffect('造成的伤害提升大量')
  assert.equal(unableCase.effects.length, 1)
  assert.deepEqual(unableSlotsOf(unableCase.effect), ['value'])
  assert.equal(unableCase.effect.slots.action, '提升')
  const mapped = mapKeywordsToEffect(keyword({ slots: { value: UNABLE } }))
  assert.equal(mapped.ok, false)
  assert.equal(mapped.blocked, true)
  assert.match(mapped.reason, /无法提取/)

  // 没有数值 / 没有单位时写「无」，不是「无法提取」
  const noUnit = firstEffect('造成的伤害提升')
  assert.equal(noUnit.effect.slots.unit, NONE)
  assert.equal(noUnit.effect.slots.value, UNABLE)

  // 提到时限但读不出 → 时长「无法提取」
  const durationUnable = firstEffect('造成的伤害提升10%，持续一段时间')
  assert.equal(durationUnable.effect.slots.duration, UNABLE)
})

test('1 段原文 → N 条关键字（除「条件」外，任何槽位出现复数 = 2 条效果）', () => {
  const { effects } = extractKeywordEffects({
    text: '自身攻击力提升1000点，给全队造成的伤害提升30%。',
    origin: 'test',
  })
  assert.equal(effects.length, 2)
  assert.equal(effects[0].slots.stat, '攻击力（固定）')
  assert.equal(effects[0].slots.value, 1000)
  assert.equal(effects[0].slots.unit, '点')
  assert.equal(effects[0].slots.target, '自身')
  assert.equal(effects[1].slots.stat, '增伤')
  assert.equal(effects[1].slots.value, 30)
  assert.equal(effects[1].slots.unit, '%')
  assert.equal(effects[1].slots.target, '全队')
})

test('条件可并存，落不到字段的标为无法提取', () => {
  const { effect } = firstEffect('若能量不足40点，攻击失衡敌人时，造成的伤害提升10%')
  assert.ok(Array.isArray(effect.slots.conditions))
  // 「攻击失衡敌人时」是工具能表达的（applySituation）；「能量不足40点」是触发器 → 无法提取
  assert.ok(effect.slots.conditions.some((item) => /失衡/.test(item)))
  assert.ok(effect.slots.conditions.includes(UNABLE), '落不到字段的条件必须写「无法提取」')
  assert.ok(
    !effect.slots.conditions.some((item) => /能量不足/.test(item)),
    '不许把原句片段塞进条件槽（那是伪造「可转换」）',
  )
  assert.deepEqual(MULTI_SLOT_IDS, ['conditions', 'elements', 'teammateProfessions'])
})

test('条件下拉的生效项能落到正式字段，旧的手动状态值兼容为关闭默认启用', () => {
  const base = { stat: '增伤', action: '提升', value: 25, unit: '%' }
  for (const condition of CONDITION_OPTIONS.filter((value) => value !== NONE && value !== UNABLE)) {
    const { effect } = mapKeywordsToEffect({ slots: { ...base, conditions: [condition] } })
    assert.ok(effect.applyProfession || effect.applySituation !== 'global', condition)
  }
  assert.ok(!CONDITION_OPTIONS.includes('状态需手动启用'))
  assert.ok(!SLOT_OPTIONS.target.includes('指定阵营'))
  assert.equal(mapKeywordsToEffect({
    slots: { ...base, conditions: ['状态需手动启用'] },
  }).effect.enabledDefault, false)
  assert.equal(mapKeywordsToEffect({
    slots: { ...base, enabledDefault: '开启' },
  }).effect.enabledDefault, true)
  assert.ok(mapKeywordsToEffect({ slots: { ...base, scope: '招式' } }).unableSlots.includes('scope'))
})

test('队友职业解析为或关系，混合阵营和并列必选条件交给人工', () => {
  const valid = simplifyText({
    text: '队友中包含击破职业或防护职业时，攻击失衡敌人时，造成的伤害提升25%',
  }).effects[0]
  assert.deepEqual(valid.slots.teammateProfessions, ['击破', '防护'])
  assert.deepEqual(valid.layerC.teammateProfessions, ['击破', '防护'])
  assert.equal(valid.layerC.applySituation, 'stagger')
  assert.equal(valid.layerC.teamProfession, null)

  for (const requirement of [
    '队伍中存在其他异常角色或同阵营角色时',
    '队伍中存在[击破]角色和[防护]角色时',
    '队伍中存在与自身属性或阵营相同的角色时',
  ]) {
    const [effect] = simplifyText({ text: requirement + '，造成的伤害提升25%' }).effects
    assert.deepEqual(effect.slots.conditions, [UNABLE], requirement)
    assert.equal(effect.layerC.teammateProfessions, undefined, requirement)
  }
})

// ================================================================== 3. 槽位语义（v3 新口径）

test('动作表固定 4 个（回复已去掉）；回复类 / 非动作动词 → 废原文', () => {
  assert.deepEqual(ACTION_OPTIONS, ['提升', '降低', '无视', '转化'])
  const gained = firstEffect('获得10%暴击率')
  assert.equal(gained.effects.length, 0)
  assert.match(gained.waste[0].reason, /动词不在动作表/)
  const stateCase = firstEffect('进入[生竭]状态')
  assert.equal(stateCase.effects.length, 0)

  // 「立即回复 N 点能量」：没有工具字段（动作 / 属性都归不了）→ 阶段1 结束时整条进废原文，不进阶段2
  const energy = firstEffect('立即回复80点能量')
  assert.equal(energy.effects.length, 0)
  assert.ok(energy.waste.length >= 1)
  assert.match(energy.waste[0].reason, /不在动作表|没有对应字段|没命中属性词典/)
  // 有属性、但动作不在表（回能）→ 可映射性预检拦下
  const energyPrecheck = checkKeywordMappable({ slots: { stat: '能量', action: '回复', unit: '点' } })
  assert.equal(energyPrecheck.ok, false)
  assert.match(energyPrecheck.reason, /不在动作表/)
  // 「生命回复」同理
  const heal = firstEffect('回复自身10%生命值上限的生命值')
  assert.equal(heal.effects.length, 0)
  assert.ok(heal.waste.length >= 1)
})

test('可映射性预检：动作 + 属性 去阶段2 词表反查（阶段1 结束时决定去留）', () => {
  assert.equal(checkKeywordMappable({ slots: { stat: '能量自动回复', action: '提升', unit: '%' } }).ok, true)
  assert.equal(checkKeywordMappable({ slots: { stat: '能量', action: '提升', unit: '点' } }).ok, false)
  assert.equal(checkKeywordMappable({ slots: { stat: '技能等级', action: '提升', unit: NONE } }).ok, false)
  assert.equal(checkKeywordMappable({ slots: { stat: '冲击力', action: '提升', unit: '%' } }).ok, false)
  assert.equal(checkKeywordMappable({ slots: { stat: '增伤', action: '回复', unit: '%' } }).ok, false)
  assert.equal(checkKeywordMappable({ slots: { stat: '减防', action: '无视', unit: '%' } }).field, 'reduceDefense')
  assert.equal(resolveStatField({ stat: '抗性穿透', action: '无视' }), 'resPen')
  assert.equal(resolveStatField({ stat: '减防', action: '降低' }), 'reduceDefense')
})

test('独立乘区百分比从关键字进入入库计划并保留原有伤害类型条件', () => {
  const cases = [
    {
      text: '自身的「烬痕比例」提升20%',
      label: '烬痕比例',
      stat: 'custom:emberMarkRatio',
      value: 20,
      applyTarget: 'self',
    },
    {
      text: '全队的耀变最终伤害比例提高17.5%',
      label: '最终伤害比例',
      stat: 'custom:finalDamageRatio',
      value: 17.5,
      applyTarget: 'team',
      damageTypes: ['radiance'],
    },
    {
      text: '一布之力比例降低6%',
      label: '一布之力比例',
      stat: 'custom:bangbooMightRatio',
      value: -6,
      applyTarget: 'self',
    },
  ]
  const rules = buildRulesTable().groups.find((group) => group.id === 'stat').items
  for (const { text, label, stat, value, applyTarget, damageTypes } of cases) {
    const { effects } = simplifyText({ text, origin: 'test' })
    assert.equal(effects.length, 1, text)
    const [keyword] = effects
    assert.equal(keyword.slots.stat, label, text)
    assert.ok(SLOT_OPTIONS.stat.includes(label))
    assert.ok(rules.some((rule) => rule.slot === label && rule.field === stat))
    assert.equal(keyword.layerC?.statLabel, label)

    const plan = planBuffApply({
      kind: 'agent',
      local: {},
      rows: [{
        key: keyword.id,
        source: 'passive.core',
        slot: 'core',
        containerIndex: 0,
        rawText: text,
        effect: keyword.layerC,
      }],
    })
    assert.equal(plan.updated, 1, text)
    const [saved] = plan.groups[0].blocks[0].effects
    assert.equal(saved.stat, stat)
    assert.equal(saved.value, value)
    assert.equal(saved.applyTarget, applyTarget)
    assert.deepEqual(saved.conditions?.damageTypes, damageTypes)
  }
})

test('独立乘区按百分比翻译，普通增伤继续映射到原字段', () => {
  assert.equal(firstEffect('说明中提到烬痕比例，造成的伤害提升20%').effect.slots.stat, '增伤')
  assert.equal(simplifyText({ text: '造成的伤害提升20%' }).effects[0].layerC.stat, 'dmgBonus')
  assert.equal(simplifyText({ text: '烬痕比例提升20点' }).effects.length, 0)
  assert.equal(resolveStatField({ stat: '最终伤害比例', action: '无视', unit: '%' }), '')
  assert.throws(() => sanitizeEffect({ stat: 'custom:非法键', value: 20 }), /不是合法增益字段/)
})

test('挽昼领袖之证抽取、重解析和写入计划保留锋御锐爆加成与时长', () => {
  const extraText = [
    '队伍中存在[击破]角色、[防护]角色或其他[锋御]角色时触发：',
    '进入战斗时，或挽昼发动任意[强化特殊技]、[普通攻击：执旌·聚锋]、[连携技]、[冲刺攻击：巡征·影域穿袭]时，' +
      '全队[锋御]代理人进入<Term:1000064></Term>状态，[众愿一心]状态下，<Term:3000015></Term>提升25%，持续45秒；' +
      '重复进入[众愿一心]状态时刷新持续时间。',
  ].join('\n')
  const agent = { id: 'sunbringer', name: '挽昼', profession: '锋御' }
  const detail = {
    name: agent.name,
    passive: { level: { 1: { level: 1, name: ['', '额外能力：领袖之证'], desc: ['', extraText] } } },
  }
  const { items: [extra] } = extractAgentBuffItems({
    detail,
    nanokaId: 1601,
    termNames: { 1000064: '[众愿一心]', 3000015: '锐暴伤害' },
    agent,
    anchors: [],
  })
  assert.equal(extra.source, 'passive.extra')
  assert.match(extra.rawText, /进入\[众愿一心\]状态/)
  assert.match(extra.rawText, /锐暴伤害提升25%/)
  assert.equal(extra.effects.length, 1)
  const [keyword] = extra.effects
  assert.equal(keyword.slots.stat, '锐爆伤害加成')
  assert.ok(SLOT_OPTIONS.stat.includes(keyword.slots.stat))
  assert.deepEqual(keyword.slots.conditions, ['仅锋御代理人', UNABLE])
  assert.equal(keyword.slots.enabledDefault, NONE)
  assert.deepEqual(keyword.slots.teammateProfessions, ['击破', '锋御', '防护'])
  assert.deepEqual(extra.sentences[0].stateReferences.map(({ kind, names }) => ({ kind, names })), [
    { kind: 'grant', names: ['众愿一心'] },
    { kind: 'reference', names: ['众愿一心'] },
  ])
  assert.equal(keyword.slots.duration, '45 秒')
  assert.deepEqual(keyword.anchors.skillTargets, [])
  assert.equal(keyword.mapping.ok, true)

  const [fromCleanedText] = simplifyText({ text: extra.rawText }).effects
  const [withoutStateName] = simplifyText({ text: extraText.replaceAll('[众愿一心]', '') }).effects
  assert.deepEqual(fromCleanedText.slots, keyword.slots)
  assert.deepEqual(withoutStateName.slots, keyword.slots)

  const { rows: [parsed] } = smartMergeParse({ keywords: [{ ...keyword, key: keyword.id }] })
  const plan = planBuffApply({
    kind: 'agent',
    local: agent,
    rows: [{
      key: keyword.id,
      source: extra.source,
      containerIndex: extra.containerIndex,
      rawText: extra.rawText,
      keywordSlots: keyword.slots,
      effect: parsed.effect,
    }],
  })
  assert.equal(plan.updated, 1)
  const [planned] = plan.groups[0].blocks[0].effects
  assert.equal(planned.stat, 'sharpenCritDmgBonus')
  assert.equal(planned.value, 25)
  assert.equal(planned.applyTarget, 'team')
  assert.equal(planned.applyProfession, '锋御')
  assert.deepEqual(planned.teammateProfessions, ['击破', '锋御', '防护'])
  assert.deepEqual(normalizeEffectList([planned])[0].teammateProfessions, planned.teammateProfessions)
  assert.deepEqual(planned.conditions.damageTypes, ['sharpen'])
  assert.ok(!planned.skillTargets?.length)
  assert.equal(planned.enabledDefault, true)
  assert.equal(normalizeEffectList([planned])[0].enabledDefault, true)
  assert.match(planned.note, /45 秒/)

  const manuallyDisabled = mapKeywordsToEffect({
    ...keyword,
    slots: { ...keyword.slots, enabledDefault: '关闭' },
  }).effect
  assert.equal(manuallyDisabled.enabledDefault, false)
  assert.deepEqual(manuallyDisabled.teammateProfessions, planned.teammateProfessions)
})

test('锐爆伤害是通用属性，效果子句真正限定的招式仍然保留', () => {
  const { effects: [keyword] } = simplifyText({
    text: '强化特殊技的锐爆伤害提升25%',
    anchors: [],
  })
  assert.equal(keyword.layerC.stat, 'sharpenCritDmgBonus')
  assert.equal(keyword.layerC.applyProfession, null)
  assert.equal(keyword.layerC.enabledDefault, true)
  assert.deepEqual(keyword.layerC.conditions.damageTypes, ['sharpen'])
  assert.deepEqual(keyword.layerC.skillTargets, [{ category: 'special', subcategoryId: null }])
})

test('获得状态的触发招式和失衡条件留在原文，效果里的限定单独解析', () => {
  const triggered = simplifyText({
    text: '当发动强化特殊技时获得[示例状态]，锐爆伤害提升25%',
    anchors: [],
  })
  const [keyword] = triggered.effects
  assert.deepEqual(keyword.anchors.skillTargets, [])
  assert.deepEqual(keyword.slots.conditions, [UNABLE])
  assert.equal(keyword.slots.enabledDefault, NONE)
  assert.equal(keyword.layerC.enabledDefault, true)
  assert.equal(keyword.layerC.value, 25)
  assert.deepEqual(triggered.sentences[0].stateReferences[0], {
    kind: 'grant', names: ['示例状态'], text: '当发动强化特殊技时获得[示例状态]',
    clauseIndex: 0, trigger: '当发动强化特殊技时',
  })

  const prefix = '发动连携技命中失衡敌人时，获得[终结技之光]状态，[终结技之光]状态下，'
  const [conditionOnly] = simplifyText({
    text: prefix + '强化特殊技的锐爆伤害提升25%',
    anchors: [],
  }).effects
  assert.deepEqual(conditionOnly.anchors.skillTargets, [{ category: 'special', subcategoryId: null }])
  assert.equal(conditionOnly.layerC.applySituation, 'global')

  const [explicit] = simplifyText({
    text: prefix + '对失衡敌人造成的锐爆伤害提升25%',
    anchors: [],
  }).effects
  assert.deepEqual(explicit.anchors.skillTargets, [])
  assert.equal(explicit.layerC.applySituation, 'stagger')
  assert.ok(explicit.slots.conditions.includes(UNABLE))
})

test('状态按原文关联唯一前项，歧义和名称不一致的引用由人工处理', () => {
  const grant = '全队[锋御]代理人进入[赤光]状态，全队[支援]代理人进入[蓝光]状态'
  const result = simplifyText({
    text: `${grant}。处于[赤光]状态时，普通攻击造成的伤害提升10%。自身暴击率提升5%`,
    anchors: [],
  })
  const [linked, independent] = result.effects
  assert.equal(linked.layerC.applyProfession, '锋御')
  assert.deepEqual(linked.anchors.skillTargets, [{ category: 'basic', subcategoryId: null }])
  assert.deepEqual(result.sentences[1].stateReferences[0].grant, { sentenceIndex: 0, clauseIndex: 0 })
  assert.deepEqual(independent.slots.conditions, [NONE])
  assert.equal(independent.layerC.enabledDefault, true)

  for (const [reference, resolution] of [['该状态下', 'ambiguous'], ['[白光]状态下', 'unresolved']]) {
    const { effects: [pending], sentences: [sentence] } = simplifyText({
      text: `${grant}，${reference}，锐爆伤害提升25%`,
      anchors: [],
    })
    assert.equal(sentence.stateReferences.at(-1).resolution, resolution)
    assert.equal(sentence.stateReferences.at(-1).grant, null)
    assert.equal(pending.slots.target, UNABLE)
    assert.ok(pending.slots.conditions.includes(UNABLE))
    assert.equal(pending.layerC.applyProfession, null)
    assert.equal(pending.layerC.enabledDefault, true)
  }
})

test('普通触发条件只在效果明确指向该招式时生成受益锚点', () => {
  for (const text of [
    '发动强化特殊技时，全队的攻击力提升25%',
    '发动强化特殊技时全队的攻击力提升25%',
  ]) {
    const [effect] = simplifyText({ text, anchors: [] }).effects
    assert.deepEqual(effect.anchors.skillTargets, [])
    assert.deepEqual(effect.slots.conditions, [UNABLE])
    assert.equal(effect.layerC.applyTarget, 'team')
  }
  const [current] = simplifyText({
    text: '发动强化特殊技时，该招式的锐爆伤害提升25%',
    anchors: [],
  }).effects
  assert.deepEqual(current.anchors.skillTargets, [{ category: 'special', subcategoryId: null }])

  const explicitSkillCases = [
    ['[普通攻击]、[强化特殊技]将无视目标20%冰属性伤害抗性', ['special', 'basic']],
    ['发动[连携技]后，下次发动[终结技]时，招式造成的伤害提升50%', ['ultimate']],
    ['[普通攻击]或[冲刺攻击]命中敌人时，使当前招式造成的伤害提升45%', ['basic', 'dodge']],
    ['[强化特殊技]或[闪避反击]命中时造成的伤害提升35%', ['special', 'dodge']],
  ]
  for (const [text, expected] of explicitSkillCases) {
    const [effect] = simplifyText({ text, anchors: [] }).effects
    assert.deepEqual(effect.anchors.skillTargets.map(({ category }) => category), expected, text)
  }
})

test('明写状态的未括起名称也能按原文关联', () => {
  const { effects: [effect], sentences: [sentence] } = simplifyText({
    text: '进入战斗时获得赤焰状态，赤焰状态下普通攻击的伤害提升25%',
    anchors: [],
  })
  const [grant, reference] = sentence.stateReferences
  assert.deepEqual(grant.names, ['赤焰'])
  assert.equal(grant.trigger, '进入战斗时')
  assert.equal(reference.resolution, 'linked')
  assert.deepEqual(effect.anchors.skillTargets, [{ category: 'basic', subcategoryId: null }])
})

test('烬痕条目保留各自范围，二影积攒量提升合为一条全队增益', () => {
  const agent = { id: 'test-ember', name: '测试者', profession: '锋御' }
  const names = ['普通攻击：先声', '终结技：「微光，共鸣」', '特殊技：追响']
  const categories = ['basic', 'ultimate', 'special']
  const anchors = names.map((name, index) => ({ id: `anchor-${index}`, name, categoryId: categories[index], agentId: agent.id }))
  const skills = names.map((name, index) => ({ name, agentId: agent.id, damageType: 'direct', buffAnchorId: anchors[index].id }))
  skills.push({ name: '毁伤段', agentId: agent.id, damageType: 'direct', skillTypes: ['destruction'], buffAnchorId: null })
  const core = '测试者发动[普通攻击：先声]、[终结技：「微光，共鸣」]命中敌人造成伤害时，均可使目标积攒<Term:1000061></Term>，[烬痕]量等同于招式造成的实际伤害的60%；全队代理人造成的[毁伤]也可使目标积攒等同于该次实际伤害40%的[烬痕]。'
  const secondMindscape = '测试者发动其他招式命中敌人造成锐化伤害时，也可使目标积攒<Term:1000061></Term>，积攒量等同于该次实际伤害的30%；全队触发<Term:3000039></Term>和测试者使敌人积攒[烬痕]时，最终结算的[烬痕]量提升35%。'
  const fourthMindscape = '[烬痕]积攒量提升效果额外提升65%，每180秒内最多触发一次；测试者造成的伤害提升10%。'
  const detail = {
    name: agent.name,
    passive: { level: { 1: { level: 1, desc: [core] } } },
    talent: [{}, { desc: secondMindscape }, {}, { desc: fourthMindscape }],
  }
  const { items } = extractAgentBuffItems({ detail, nanokaId: 'test', agent, anchors, skills })
  const coreItem = items.find((item) => item.slot === 'core')
  const secondItem = items.find((item) => item.slot === 'talent-2')
  const fourthItem = items.find((item) => item.slot === 'talent-4')
  const [named, destruction] = coreItem.effects
  const [other, settlement] = secondItem.effects
  assert.deepEqual(named.anchors.skillTargets, [
    { category: 'basic', subcategoryId: 'anchor-0' },
    { category: 'ultimate', subcategoryId: 'anchor-1' },
  ])
  assert.deepEqual(destruction.anchors.skillTargets, [{ category: 'destruction', subcategoryId: null }])
  assert.deepEqual(other.anchors.skillTargets, [{ category: 'special', subcategoryId: 'anchor-2' }])
  assert.deepEqual(other.layerC.conditions.damageTypes, ['sharpen'])
  const destructionTargets = [{ category: 'destruction', subcategoryId: null }]
  assert.equal(settlement.layerC.stat, 'custom:emberMarkAccumulationBonus')
  assert.equal(settlement.layerC.value, 35)
  assert.equal(settlement.layerC.applyTarget, 'team')
  assert.equal(settlement.layerC.enabledDefault, true)
  assert.equal(settlement.layerC.skillTargetsOnlyForTeammates, true)
  assert.deepEqual(settlement.layerC.skillTargets, destructionTargets)
  assert.equal(settlement.layerC.conditions, undefined)
  assert.ok(secondItem.rawText.includes('35%'))
  assert.deepEqual(fourthItem.effects.filter((effect) => effect.layerC).map((effect) => effect.layerC.value), [10])

  const resimplified = simplifyText({
    text: secondItem.rawText, agentId: agent.id, selfNames: [agent.name], anchors,
    emberMarkContext: { corePassiveText: coreItem.rawText, profession: agent.profession, skills },
  })
  assert.deepEqual(resimplified.effects[0].layerC.skillTargets, other.layerC.skillTargets)
  const { effects: [alternate] } = simplifyText({
    text: '全队触发[毁伤]和测试者使敌人积攒[烬痕]时，[烬痕]积攒量额外提升35%。',
    agentId: agent.id, selfNames: [agent.name], anchors,
  })
  assert.equal(alternate.layerC.stat, settlement.layerC.stat)
  assert.equal(alternate.layerC.skillTargetsOnlyForTeammates, true)
  assert.deepEqual(alternate.layerC.skillTargets, destructionTargets)

  const { rows: [translated] } = smartMergeParse({ keywords: [settlement], agentId: agent.id })
  assert.equal(translated.effect.skillTargetsOnlyForTeammates, true)

  const rows = [[coreItem, named], [coreItem, destruction], [secondItem, other], [secondItem, settlement]].map(([item, keyword]) => ({
    key: keyword.id,
    source: item.source,
    containerIndex: item.containerIndex,
    rawText: item.rawText,
    keywordSlots: keyword.slots,
    effect: keyword.layerC,
    anchors: keyword.anchors,
  }))
  const plan = planBuffApply({ kind: 'agent', local: agent, rows })
  assert.equal(plan.updated, 4)
  const effects = plan.groups.flatMap((group) => group.blocks.flatMap((block) => block.effects))
  assert.deepEqual(effects.map(({ stat, value, applyTarget }) => [stat, value, applyTarget]), [
    ['custom:emberMarkRatio', 60, 'self'],
    ['custom:emberMarkRatio', 40, 'team'],
    ['custom:emberMarkRatio', 30, 'self'],
    ['custom:emberMarkAccumulationBonus', 35, 'team'],
  ])
  assert.deepEqual(effects[2].conditions.damageTypes, ['sharpen'])
  assert.deepEqual(effects[3].skillTargets, destructionTargets)
  assert.equal(effects[3].skillTargetsOnlyForTeammates, true)
  assert.equal(normalizeEffectList([effects[3]])[0].skillTargetsOnlyForTeammates, true)
  assert.equal(plan.groups[1].effects[1].skillTargetsOnlyForTeammates, true)
  assert.ok(plan.groups[1].sourceTexts.some((text) => /35%/.test(text)))

  const sharedAnchorSkills = skills.map((skill) => skill.name === '毁伤段' ? { ...skill, buffAnchorId: 'anchor-2' } : skill)
  const sharedAnchor = extractAgentBuffItems({ detail, nanokaId: 'test', agent, anchors, skills: sharedAnchorSkills })
  const blocked = sharedAnchor.items.find((item) => item.slot === 'talent-2').effects[0]
  assert.equal(blocked.layerC, null)
  assert.match(blocked.mapping.reason, /共用锚点/)
})

test('预检**不丢** `无法提取`：动作 / 属性读不出的条目留在阶段2（标 blocked 待补）', () => {
  // 动作读不出（有属性、有数值）→ 留阶段2 等用户补动作（**不是**废原文）
  const actionPending = checkKeywordMappable({ slots: { stat: '暴击率', action: UNABLE, unit: '%' } })
  assert.equal(actionPending.ok, true)
  assert.equal(actionPending.pending, true)
  const actionRow = firstEffect('暴击率40%')
  assert.equal(actionRow.effects.length, 1, '动作=无法提取 不该被丢进废原文')
  assert.equal(actionRow.waste.length, 0)
  assert.equal(actionRow.effect.slots.action, UNABLE)
  const actionMapped = mapKeywordsToEffect(keyword({ slots: actionRow.effect.slots }))
  assert.equal(actionMapped.blocked, true, '阶段2 标 blocked / 待补')
  assert.match(actionMapped.reason, /无法提取/)

  // 属性读不出（有动作、有数值）→ 同样留阶段2
  const statPending = checkKeywordMappable({ slots: { stat: UNABLE, action: '提升', unit: '%' } })
  assert.equal(statPending.ok, true)
  assert.equal(statPending.pending, true)
  const statRow = firstEffect('提升40%')
  assert.equal(statRow.effects.length, 1, '属性=无法提取 不该被丢进废原文')
  assert.equal(statRow.effect.slots.stat, UNABLE)
  assert.equal(mapKeywordsToEffect(keyword({ slots: statRow.effect.slots })).blocked, true)

  // 对照：动作**认得**但属性查不到字段 → 才是废原文
  const unmappable = checkKeywordMappable({ slots: { stat: '技能等级', action: '提升', unit: NONE } })
  assert.equal(unmappable.ok, false)
  assert.match(unmappable.reason, /没有对应字段/)
})

test('能量是属性：能量自动回复 +X% 是正常增益；瞬时回能是废原文', () => {
  const rate = firstEffect('能量自动回复效率提升10%')
  assert.equal(rate.effect.slots.stat, '能量自动回复')
  assert.equal(rate.effect.slots.action, '提升')
  const rateMapped = mapKeywordsToEffect(keyword({ slots: rate.effect.slots }))
  assert.equal(rateMapped.effect.stat, 'energyRegen')
  assert.equal(rateMapped.effect.value, 10)

  const plain = firstEffect('能量回复效率提升5%')
  assert.equal(plain.effect.slots.stat, '能量自动回复')
  const plainMapped = mapKeywordsToEffect(keyword({ slots: plain.effect.slots }))
  assert.equal(plainMapped.effect.stat, 'energyRegen')
})

test('时长抓下来但不转化（只进 note）', () => {
  const { effect } = firstEffect('造成的伤害提升10%，持续15秒')
  assert.equal(effect.slots.duration, '15 秒')
  assert.equal(effect.durationSeconds, 15)
  const mapped = mapKeywordsToEffect(keyword({ slots: effect.slots, durationSeconds: 15 }))
  assert.equal(mapped.effect.kind, 'fixed')
  assert.ok(!('duration' in mapped.effect), '层C 里不该出现时长字段')
  assert.match(mapped.steps.join(' '), /时长=15 秒 → 增益备注/)
  assert.match(mapped.effect.note, /15 秒/)
})

test('我方减伤不存在 → 废原文；「（敌人）受到的伤害提升」= **增伤**（不是易伤）', () => {
  const selfReduce = firstEffect('受到的伤害降低18%')
  assert.equal(selfReduce.effects.length, 0)
  assert.match(selfReduce.waste[0].reason, /我方减伤不存在/)

  // 游戏描述坑（用户 2026-10-16 纠正）：无条件「受到的伤害提升」是**增伤** → dmgBonus
  const raised = firstEffect('使敌人受到的伤害提升25%')
  assert.equal(raised.effects.length, 1)
  assert.equal(raised.effect.slots.stat, '增伤')
  const raisedMapped = mapKeywordsToEffect(keyword({ slots: raised.effect.slots }))
  assert.equal(raisedMapped.effect.stat, 'dmgBonus')
  assert.equal(raisedMapped.effect.value, 25)
  assert.notEqual(raisedMapped.effect.stat, 'vulnerable', '抽取器不主动产出 vulnerable')

  // 降低 → 负向（同一加算区里的减项）
  const lowered = firstEffect('使敌人受到的伤害降低20%')
  assert.equal(lowered.effect.slots.stat, '增伤')
  assert.equal(lowered.effect.slots.action, '降低')
  const loweredMapped = mapKeywordsToEffect(keyword({ slots: lowered.effect.slots }))
  assert.equal(loweredMapped.effect.stat, 'dmgBonus')
  assert.equal(loweredMapped.effect.value, -20)

  // `vulnerable` 只留给**手动**（下拉里还在）
  assert.equal(resolveStatField({ stat: '易伤', action: '提升' }), 'vulnerable')
})

test('易伤家族保留的落法：失衡 → staggerVulnerable；失衡/非失衡均 → globalStaggerVulnerable', () => {
  // 限定过的直伤 / 异常易伤仍是各自字段
  assert.equal(resolveStatField({ stat: '直伤易伤', action: '提升' }), 'directVulnerable')
  assert.equal(resolveStatField({ stat: '异常易伤', action: '降低' }), 'anomalyVulnerable')

  // 显式「失衡易伤」/「失衡易伤（全局）」
  assert.equal(resolveStatField({ stat: '失衡易伤', action: '提升' }), 'staggerVulnerable')
  assert.equal(resolveStatField({ stat: '失衡易伤（全局）', action: '提升' }), 'globalStaggerVulnerable')

  // 失衡在作用域里 + 「受到的伤害提升」→ 失衡易伤
  const imbalance = firstEffect('攻击处于失衡状态下的敌人时，受到的伤害提升30%')
  assert.equal(imbalance.effect.slots.stat, '失衡易伤')
  const imbalanceMapped = mapKeywordsToEffect({
    slots: imbalance.effect.slots,
    rawText: '攻击处于失衡状态下的敌人时，受到的伤害提升30%',
  })
  assert.equal(imbalanceMapped.effect.stat, 'staggerVulnerable')
  assert.equal(imbalanceMapped.effect.value, 30)

  // 「失衡期与非失衡期均生效」→ globalStaggerVulnerable（扳机式）
  const globalCase = firstEffect('失衡期与非失衡期均生效：受到的伤害提升35%')
  assert.equal(globalCase.effect.slots.stat, '失衡易伤（全局）')
  const globalMapped = mapKeywordsToEffect({
    slots: globalCase.effect.slots,
    rawText: '失衡期与非失衡期均生效：受到的伤害提升35%',
  })
  assert.equal(globalMapped.effect.stat, 'globalStaggerVulnerable')
})

test('游戏字面 → 工具语义：改写清单逐条对得上（结构性原则）', () => {
  const cases = [
    ['使敌人受到的伤害提升25%', '增伤'],
    ['使敌人受到的伤害降低20%', '增伤'],
    ['攻击处于失衡状态下的敌人时，受到的伤害提升30%', '失衡易伤'],
    ['无视目标20%防御力', '减防'],
    ['目标防御力降低40%', '减防'],
    ['无视敌人15%抗性', '抗性穿透'],
  ]
  for (const [text, expected] of cases) {
    const { effect } = firstEffect(text)
    assert.equal(effect.slots.stat, expected, `${text} → 属性应为 ${expected}`)
  }
  // 清单本身要覆盖用户点名的措辞
  const literals = GAME_LITERAL_REWRITES.map((item) => item.literal).join('；')
  assert.match(literals, /受到的伤害提升/)
  assert.match(literals, /失衡状态下/)
  assert.match(literals, /无视目标 X% 防御力/)
  assert.match(literals, /无视目标 X% 抗性/)
  // 攻击力按局内 / 局外 / 固定拆开
  assert.equal(refineStatKeyword('攻击力', { unit: '点' }), '攻击力（固定）')
  assert.equal(refineStatKeyword('攻击力', { unit: '%' }), '攻击力（局外）')
  assert.equal(refineStatKeyword('攻击力', { unit: '%', text: '局内' }), '攻击力（局内）')
})

test('「改既有机制的上限」没有字段 → 废原文', () => {
  const capped = firstEffect('[以太帷幕·决裁]提供的帷幕易伤加成上限提升至200%')
  assert.equal(capped.effects.length, 0)
  assert.match(capped.waste[0].reason, /改既有机制的上限/)
})

test('废原文带丢弃原因、**按句归档**，同一句内可去重', () => {
  const { effects, waste } = extractKeywordEffects({
    text: '招式发动期间拥有无敌效果，招式发动期间拥有无敌效果。抗打断等级提升。',
    origin: 'test',
  })
  assert.equal(effects.length, 0)
  // 同一句里重复的机制子句只记一次；不同句各记一次
  assert.equal(waste.length, 2)
  assert.ok(waste.every((item) => typeof item.sentenceIndex === 'number'), '废原文要带句序号')
  assert.ok(waste.every((item) => item.reason), '废原文必须带原因')
})

// ================================================================== 4. 转模（动作=转化）

test('转化（转模）走专用槽位；落库 kind=convert 且 value≡0', () => {
  assert.equal(isConvertClause('每1点攻击力转化为1.5点暴击率（上限60%）'), true)
  const parts = readConvertParts('每1点攻击力转化为1.5点暴击率（上限60%）')
  assert.equal(parts.convertFrom, 'atk')
  assert.equal(parts.convertRatio, 1.5)
  assert.equal(parts.convertCap, 60)

  const { effect } = firstEffect('每1点攻击力转化为1.5点暴击率（上限60%）')
  assert.equal(effect.slots.action, '转化')
  assert.equal(effect.slots.stat, '暴击率')
  assert.equal(effect.slots.value, NONE, '转模条的「数值 / 单位」不适用 → 写「无」')
  assert.equal(effect.convert.convertFrom, 'atk')

  const mapped = mapKeywordsToEffect({
    slots: effect.slots,
    convert: effect.convert,
    id: 'c1',
    origin: 'test',
  })
  assert.equal(mapped.ok, true)
  assert.equal(mapped.effect.kind, 'convert')
  assert.equal(mapped.effect.value, 0, '转模的 value 恒为 0（运行时折算）')
  assert.equal(mapped.effect.stat, 'critRate')
  assert.deepEqual(
    { ...mapped.effect.convert },
    { from: 'atk', panelSource: 'external', ratioPercent: 1.5, cap: 60, defaultBase: null, initialBase: 0 },
  )
  // 转模专用槽位都有下拉取值 / 文案（界面用）
  for (const id of CONVERT_SLOT_IDS) {
    assert.ok(id in SLOT_OPTIONS, `缺少转模槽位选项 ${id}`)
    assert.ok(CONVERT_SLOT_LABELS[id], `缺少转模槽位文案 ${id}`)
    assert.ok(CONVERT_SLOT_HINTS[id], `缺少转模槽位提示 ${id}`)
  }
  // 文案定稿（用户 2026-10-16）
  assert.equal(CONVERT_SLOT_LABELS.convertFrom, '读取属性')
  assert.equal(CONVERT_SLOT_LABELS.convertPanelSource, '取哪一层')
  assert.equal(CONVERT_SLOT_LABELS.convertRatio, '折算比例')
  assert.equal(CONVERT_SLOT_LABELS.convertCap, '上限')
  assert.match(CONVERT_SLOT_HINTS.convertFrom, /折算比例/)
  assert.ok(CONVERT_FROM_OPTIONS.includes('anomalyControl'))
  assert.deepEqual(CONVERT_PANEL_SOURCE_OPTIONS, ['external', 'final', 'manual'])
  // 读取属性下拉顺序：常用属性在前 → 角色等级 / 技能等级（特殊技）→ 其余技能类别垫底
  const levelIndex = CONVERT_FROM_OPTIONS.indexOf('level')
  const specialIndex = CONVERT_FROM_OPTIONS.indexOf('skillLevelSpecial')
  assert.ok(levelIndex > CONVERT_FROM_OPTIONS.indexOf('anomalyControl'))
  assert.ok(specialIndex > levelIndex)
  for (const tail of ['skillLevelBasic', 'skillLevelDodge', 'skillLevelAssist', 'skillLevelChainUltimate']) {
    assert.ok(CONVERT_FROM_OPTIONS.indexOf(tail) > specialIndex, `${tail} 应垫底`)
  }
})

test('「每点 X 使得 Y 提升 Z」也算转模（读取属性 / 目标属性分得开）', () => {
  const parts = readConvertParts('若初始异常掌控大于155点，每点超过的异常掌控会使得该效果的暴击率额外提升0.7%')
  assert.equal(parts.convertFrom, 'anomalyControl')
  assert.match(parts.targetText, /暴击率/)
  const { effect } = firstEffect('每点超过的异常掌控会使得该效果的暴击率额外提升0.7%')
  assert.equal(effect.slots.action, '转化')
  assert.equal(effect.slots.stat, '暴击率')
})

test('转模**基础值**：「每点超过 X」/「大于 X 的部分」 → defaultBase = X（否则会多折算 X）', () => {
  // 用户 2026-10-16 报的坑：基础值不落 → 阶段2 把全部来源值都折算进去
  const parts = readConvertParts(
    '若菲欧妮的初始异常掌控大于155点，每点超过的异常掌控会使得该效果的暴击率额外提升0.7%',
  )
  assert.equal(parts.convertBase, 155)
  assert.equal(parts.convertRatio, 0.7)

  const { effect } = firstEffect(
    '若初始异常掌控大于155点，每点超过的异常掌控会使得该效果的暴击率额外提升0.7%',
  )
  assert.equal(effect.convert.convertBase, 155)
  const mapped = mapKeywordsToEffect({
    slots: effect.slots,
    convert: effect.convert,
    id: 'c-base',
    origin: 'test',
  })
  assert.equal(mapped.effect.kind, 'convert')
  assert.equal(mapped.effect.convert.defaultBase, 155)
  assert.equal(mapped.effect.convert.ratioPercent, 0.7)

  // 同类措辞：「超出 X 的部分」/「大于 X 的部分」
  assert.equal(readConvertParts('超出100点攻击力的部分转化为暴击率，比例1%').convertBase, 100)
  assert.equal(readConvertParts('大于200点的部分转化为增伤').convertBase, 200)
  // 没有基准值时基础值仍留空（不瞎填）
  assert.equal(readConvertParts('每1点攻击力转化为1.5点暴击率').convertBase, null)
})

test('异常语境：「属性异常伤害」句里的暴击率 / 暴击伤害 / 增伤落**异常区**', () => {
  const { effects } = extractKeywordEffects({
    text: '[灼蚀]状态下的敌人受到属性异常伤害时有概率触发暴击，基础暴击率为30%，暴击伤害为25%。',
    origin: 'test',
  })
  const stats = effects.map((effect) => effect.slots.stat)
  assert.ok(stats.includes('属性异常暴击率'), `异常语境的暴击率应落属性异常区，实际：${stats.join('/')}`)
  assert.ok(stats.includes('属性异常暴击伤害'))
  assert.equal(
    mapKeywordsToEffect(keyword({ slots: { stat: '属性异常暴击率', action: '提升', value: 30, unit: '%' } }))
      .effect.stat,
    'attributeAnomalyCritRate',
  )
  assert.equal(
    mapKeywordsToEffect(keyword({ slots: { stat: '属性异常暴击伤害', action: '提升', value: 25, unit: '%' } }))
      .effect.stat,
    'attributeAnomalyCritDmg',
  )

  // 对照：没有异常语境 → 普通暴击区
  const plain = firstEffect('暴击率提升30%')
  assert.equal(plain.effect.slots.stat, '暴击率')
  // 「该增益效果」指代但**本句没有异常词** → 不误判成异常区
  const referenceOnly = simplifyText({
    text: '造成的火属性伤害提升10%，攻击处于失衡状态下的敌人时，该增益效果额外提升22.5%',
    origin: 'test',
  })
  assert.equal(referenceOnly.effects[1].slots.stat, '增伤')
  assert.equal(referenceOnly.effects[1].layerC.stat, 'dmgBonus')
})

test('指代来源提示：靠前文语义（「该效果」/省略主语）成立的关键字要标出来', () => {
  const sameSentence = firstEffect(
    '造成的火属性伤害提升10%，攻击处于失衡状态下的敌人时，该增益效果额外提升22.5%',
  )
  assert.equal(sameSentence.effects[0].inherited, null, 'literal 关键字不该有指代提示')
  assert.match(sameSentence.effects[1].inherited.label, /^依赖前文 · /)

  // 跨句指代 → 「依赖上一句」
  const crossSentence = extractKeywordEffects({
    text: '造成的伤害提升10%。该效果额外提升5%。',
    origin: 'test',
  })
  assert.match(crossSentence.effects[1].inherited.label, /^依赖上一句 · /)
  assert.equal(crossSentence.effects[1].inherited.from, '上一句')
})

test('按句配对：一句一个 `sentences` 条目；抽不出关键字的句子只进废原文', () => {
  const detail = {
    name: '测试角色',
    passive: {
      level: {
        1: {
          level: 1,
          name: ['核心被动：甲', '额外能力：乙'],
          desc: ['造成的伤害提升10%。招式发动期间拥有无敌效果。', '招式发动期间拥有无敌效果。'],
        },
      },
    },
    talent: [],
    skill: {},
  }
  const result = extractAgentBuffItems({ detail, nanokaId: 'test', anchors: [] })
  const core = result.items.find((item) => item.slot === 'core')
  assert.ok(Array.isArray(core.sentences), 'item 必须带 sentences（按句配对视图）')
  assert.equal(core.sentences.length, 2)
  assert.equal(core.sentences[0].sourceKey, 'core')
  assert.equal(core.sentences[0].sourceLabel, '核心被动')
  assert.equal(core.sentences[0].sentenceIndex, 0)
  assert.match(core.sentences[0].rawSentence, /造成的伤害提升10%/)
  assert.equal(core.sentences[0].hasKeywords, true)
  assert.equal(core.sentences[0].keywords.length, 1)
  // 机制句：不进主视图（hasKeywords=false），但**照旧入库**（rawText 完整）
  assert.equal(core.sentences[1].hasKeywords, false)
  assert.equal(core.sentences[1].keywords.length, 0)
  assert.ok(core.sentences[1].waste.length > 0)
  assert.ok(core.sentences[1].waste.every((entry) => entry.sentenceIndex === 1))
  assert.match(core.rawText, /无敌效果/, '入库口径不变：机制句仍在 rawText 里')

  // 整块都抽不出关键字 → verdict=waste，所有句子 hasKeywords 都是 false（左侧不显示该块）
  const extra = result.items.find((item) => item.slot === 'extra')
  assert.equal(extra.verdict, 'waste')
  assert.ok(extra.sentences.every((sentence) => sentence.hasKeywords === false))
})

// ================================================================== 5. 招式限定 = 条件

const ANCHORS = [
  { id: 'a-basic', agentId: '1041', categoryId: 'basic', name: '普通攻击' },
  { id: 'a-dash', agentId: '1041', categoryId: 'dodge', name: '冲刺攻击' },
  { id: 'a-enh', agentId: '1041', categoryId: 'special', name: '强化特殊技' },
]

test('阶段一手选整类和小类可与伤害类型独立写入，清除招式后保留伤害类型', () => {
  assert.ok(!SLOT_OPTIONS.scope.includes('招式'))
  const skillTargets = [
    { category: 'destruction', subcategoryId: null },
    { category: 'special', subcategoryId: 'a-enh' },
  ]
  const slots = { stat: '增伤', action: '提升', value: 10, unit: '%', scope: '锐化' }
  const anchors = { ok: true, labels: ['毁伤', '强化特殊技'], skillTargets }
  const { rows: [parsed] } = smartMergeParse({ keywords: [{ key: 'manual-skill-targets', slots, anchors }] })
  const saved = planBuffApply({
    kind: 'agent', local: {},
    rows: [{ key: parsed.key, source: 'passive.core', containerIndex: 0, effect: parsed.effect }],
  }).groups[0].blocks[0].effects[0]
  assert.deepEqual(saved.skillTargets, skillTargets)
  assert.deepEqual(saved.conditions.damageTypes, ['sharpen'])

  const unrelatedDamageType = mapKeywordsToEffect({
    slots: { ...slots, stat: '防御力', scope: '乱流' }, anchors,
  }).effect
  assert.deepEqual(unrelatedDamageType.skillTargets, skillTargets)
  assert.deepEqual(normalizeEffectList([unrelatedDamageType])[0].conditions.damageTypes, ['turbulence'])

  const cleared = mapKeywordsToEffect({ slots, anchors: { ok: true, labels: [], skillTargets: [] } }).effect
  assert.equal(cleared.skillTargets, undefined)
  assert.deepEqual(cleared.conditions.damageTypes, ['sharpen'])

  const legacy = mapKeywordsToEffect({ slots: { ...slots, scope: '招式' }, anchors }).effect
  assert.deepEqual(legacy.skillTargets, skillTargets)
  assert.deepEqual(legacy.scope, ['skill'])
})

test('自动识别可同时保留招式和伤害类型，招式标题里的词不产生伤害类型', () => {
  const context = { anchors: ANCHORS, agentId: '1041' }
  const { effects: [both] } = simplifyText({ ...context, text: '[普通攻击]造成的异放伤害提升10%' })
  assert.equal(both.layerC.stat, 'anomalyReleaseDmgBonus')
  assert.deepEqual(both.layerC.skillTargets, [{ category: 'basic', subcategoryId: 'a-basic' }])
  const { effects: [named] } = simplifyText({ ...context, text: '[普通攻击：乱流前奏]的暴击率提升3%' })
  assert.equal(named.slots.scope, NONE)
  assert.deepEqual(named.layerC.skillTargets, [{ category: 'basic', subcategoryId: 'a-basic' }])
})

test('招式限定：锚点关联上 → 条件 + skillTargets；关联不上 → 这条不录', () => {
  assert.deepEqual(
    detectSkillLimits('[普通攻击]、[冲刺攻击]造成的伤害提升3%').map((item) => item.name),
    ['普通攻击', '冲刺攻击'],
  )
  // 泛称「招式」不算限定
  assert.deepEqual(detectSkillLimits('招式造成的伤害提升10%'), [])

  const text = '[普通攻击]、[冲刺攻击]造成的伤害提升3%'
  const { effect } = firstEffect(text, { anchors: ANCHORS, agentId: '1041' })
  assert.equal(effect.recorded, true)
  assert.equal(effect.slots.scope, NONE)
  assert.ok(
    !effect.slots.conditions.some((item) => /限定招式/.test(item)),
    '限定招式不再写进条件槽',
  )
  const mapped = mapKeywordsToEffect({
    slots: effect.slots,
    anchors: effect.anchors,
    id: 'a1',
    origin: 'test',
  })
  assert.equal(mapped.ok, true)
  assert.deepEqual(mapped.effect.scope, ['skill']) /* scope 数组口径 */
  assert.deepEqual(mapped.effect.skillTargets, [
    { category: 'basic', subcategoryId: 'a-basic' },
    { category: 'dodge', subcategoryId: 'a-dash' },
  ])
  assert.match(mapped.steps.join(' '), /skillTargets/)

  // 技能库里没有这个小类 → 只回落「整大类」，也算关联上
  const categoryOnly = firstEffect('强化特殊技造成的伤害提升3%', { anchors: [], agentId: '1041' })
  assert.equal(categoryOnly.effect.recorded, true)
  assert.deepEqual(categoryOnly.effect.anchors.skillTargets, [
    { category: 'special', subcategoryId: null },
  ])

  // 技能库没加载（anchors=null）→ 不猜 → 这条不录（不新建挂载点、不动 schema）
  const noAnchors = extractKeywordEffects({ text, origin: 'test', anchors: null, agentId: '1041' })
  assert.equal(noAnchors.effects[0].recorded, false)
  assert.match(noAnchors.effects[0].dropReason, /锚点关联不上/)
  const blocked = mapKeywordsToEffect({
    slots: noAnchors.effects[0].slots,
    anchors: noAnchors.effects[0].anchors,
  })
  assert.equal(blocked.ok, false)
  assert.match(blocked.reason, /不录/)
})

test('招式文本的效果进角色增益块（槽位 0），并带技能「描述」落点', () => {
  const result = extractAgentBuffItems({
    detail: {
      name: '测试角色',
      passive: { level: { 1: { level: 1, name: [], desc: [] } } },
      talent: [],
      skill: {
        special: {
          description: [{ name: '强化特殊技：测试', desc: '强化特殊技造成的伤害提升12%。' }],
        },
      },
    },
    nanokaId: 'test',
    anchors: ANCHORS,
  })
  const item = result.items.find((entry) => entry.source === 'skill.special.0')
  assert.ok(item, '招式文本应当产出原文项')
  assert.equal(item.containerIndex, 0, '招式文本 → 角色增益块槽位 0')
  assert.deepEqual(item.landing.container, 'mindscapeBuffs')
  assert.equal(item.landing.index, 0)
  assert.deepEqual(item.skillDesc, {
    agentId: 'test',
    skillName: '强化特殊技：测试',
    category: 'special',
  })
  const effect = item.effects.find((entry) => entry.recorded)
  assert.ok(effect)
  assert.equal(effect.slots.scope, NONE)
  assert.deepEqual(effect.layerC.skillTargets.map(({ category }) => category), ['special'])
  assert.ok(effect.slots.conditions.every((entry) => !/限定招式/.test(entry)))
})

test('招式锚点：库里没有同名小类 → **按该技能名建立锚点**（建不出才不录）', () => {
  // 库里只有「普通攻击」，词表里的「冲刺攻击」没有同名小类 → 计划建锚点
  const anchorsOnlyBasic = [{ id: 'a-basic', agentId: '1041', categoryId: 'basic', name: '普通攻击' }]
  const { effects, waste } = extractKeywordEffects({
    text: '[普通攻击]、[冲刺攻击]造成的伤害提升3%',
    origin: 'test',
    anchors: anchorsOnlyBasic,
    agentId: '1041',
  })
  assert.equal(waste.length, 0)
  const effect = effects[0]
  assert.equal(effect.recorded, true, '建得出锚点 → 这条要录')
  assert.deepEqual(effect.anchors.pendingCreates, [
    { name: '冲刺攻击', categoryId: 'dodge', agentId: '1041' },
  ])

  const plan = planAnchorCreations({
    rows: [{ anchors: effect.anchors }],
    subcategories: anchorsOnlyBasic,
  })
  assert.equal(plan.creations.length, 1)
  assert.equal(plan.creations[0].exists, false)
  assert.equal(plan.creations[0].categoryId, 'dodge')
  assert.equal(plan.unresolved.length, 0)

  // 建好后回填：整大类目标 → 具体小类 id
  const patched = applyAnchorPlanToRows({
    rows: [{ anchors: effect.anchors, effect: { skillTargets: effect.anchors.skillTargets } }],
    creations: [{ ...plan.creations[0], id: 'new-dash-id' }],
  })
  assert.deepEqual(patched[0].effect.skillTargets, [
    { category: 'basic', subcategoryId: 'a-basic' },
    { category: 'dodge', subcategoryId: 'new-dash-id' },
  ])

  // 库里已有同名小类 → 不重复建
  const existsPlan = planAnchorCreations({
    rows: [{ anchors: effect.anchors }],
    subcategories: [...anchorsOnlyBasic, { id: 'a-dash', agentId: '1041', categoryId: 'dodge', name: '冲刺攻击' }],
  })
  assert.equal(existsPlan.creations[0].exists, true)
  assert.equal(existsPlan.creations[0].id, 'a-dash')

  // 招式名 / 大类读不出 → 锚点建不出来 → 记进 unresolved（这条不录）
  const broken = planAnchorCreations({
    rows: [{ anchors: { pendingCreates: [{ name: '', categoryId: '' }] } }],
    subcategories: [],
  })
  assert.equal(broken.unresolved.length, 1)
  assert.match(broken.unresolved[0].reason, /不录/)
})

// ================================================================== 6. 入库文本 / 显示规则

test('入库文本：原文 + `[关键字]` 行（多条带序号），v3 不再有"选不选进"的开关', () => {
  const single = formatSourceBlock({
    rawText: '造成的伤害提升10%',
    effects: [
      {
        slots: {
          stat: '增伤',
          action: '提升',
          value: 10,
          unit: '%',
          target: NONE,
          conditions: [NONE],
          stacks: NONE,
          duration: NONE,
          object: NONE,
        },
      },
    ],
  })
  assert.equal(single.split('\n')[0], '原文：造成的伤害提升10%')
  assert.match(single, /\n\[关键字\] 属性=增伤/)

  const many = formatSourceBlock({ rawText: '甲；乙', effects: [{ slots: {} }, { slots: {} }] })
  assert.match(many, /\[关键字 1\]/)
  assert.match(many, /\[关键字 2\]/)
  assert.equal(formatKeywordLine({}, 0, 1).startsWith('[关键字] '), true)
})

test('显示规则：只显示有值的槽位；`无` 默认隐藏；`无法提取` 单列出来（⚠X + 补）', () => {
  const view = slotView({
    stat: '增伤',
    action: '提升',
    value: 10,
    unit: '%',
    target: NONE,
    conditions: [NONE],
    stacks: NONE,
    duration: UNABLE,
    object: NONE,
  })
  assert.deepEqual(view.visible.map((item) => item.id), ['stat', 'action', 'value', 'unit'])
  assert.deepEqual(view.hidden.map((item) => item.id), [
    'elements',
    'target',
    'conditions',
    'teammateProfessions',
    'scope',
    'stacks',
    'enabledDefault',
    'object',
  ])
  assert.deepEqual(view.unable.map((item) => item.id), ['duration'])
  assert.equal(isEmptySlot(NONE), true)
  assert.equal(isEmptySlot(UNABLE), false, '「无法提取」不是"无值"，不能当空槽藏起来')
  assert.equal(isEmptySlot(0), false)

  const expanded = slotView({ stat: '增伤' })
  assert.equal(expanded.visible.length + expanded.hidden.length + expanded.unable.length, SLOT_IDS.length)
})

// ================================================================== 7. 真实夹具（1041 / 1641 / 14164）

function itemsOf(result) {
  return new Map(result.items.map((item) => [item.slot, item]))
}

function recordableEffects(item) {
  return (item?.effects ?? []).filter((effect) => effect.recorded && effect.layerC)
}

/** 抽出来的关键字（`recorded` 即可，`layerC` 可能因为「无法提取」被阻断而暂时是 null） */
function keywordEffects(item) {
  return (item?.effects ?? []).filter((effect) => effect.recorded)
}

test('1041「11号」：关键字 → 增益（招式限定 / 叠层 / 无视抗性 / 废原文）', { skip: SKIP }, () => {
  const detail = readFixture('char', '1041')
  const result = extractAgentBuffItems({ detail, nanokaId: '1041', anchors: [] })
  const items = itemsOf(result)

  // 核心被动：限定 [普通攻击] / [冲刺攻击] 由招式锚点承接。
  // 「触发[火力镇压]时」落不到工具字段 → 条件=无法提取（**软槽位：不阻断**，按「无」处理 → 可写）
  const core = keywordEffects(items.get('core'))[0]
  assert.equal(core.slots.stat, '招式增伤')
  assert.equal(core.slots.value, 70)
  assert.equal(core.slots.scope, NONE)
  assert.deepEqual(core.slots.conditions, [UNABLE])
  assert.equal(core.blocked, false, '条件标了无法提取 → 按「无」处理，不阻断')
  assert.equal(core.layerC.stat, 'skillDmgBonus')
  assert.equal(core.layerC.value, 70)
  assert.equal(core.layerC.applySituation, 'global', '条件按无处理 → 常驻生效')
  assert.ok(!/触发|火力镇压/.test(core.layerC.note), '不许把条件原文写进 note 冒充条件')
  assert.deepEqual(core.layerC.scope, ['skill'])
  assert.deepEqual(core.layerC.skillTargets, [
    { category: 'basic', subcategoryId: null },
    { category: 'dodge', subcategoryId: null },
  ])
  // 人补上条件后重解析：条件生效（失衡 → applySituation=stagger）
  const coreFixed = mapKeywordsToEffect({
    slots: { ...core.slots, conditions: ['攻击处于失衡状态下的敌人时'] },
    anchors: core.anchors,
    id: core.id,
    origin: core.origin,
  })
  assert.equal(coreFixed.ok, true)
  assert.equal(coreFixed.effect.applySituation, 'stagger', '补上的条件要生效')
  assert.deepEqual(coreFixed.effect.scope, ['skill'])
  assert.deepEqual(coreFixed.effect.skillTargets, [
    { category: 'basic', subcategoryId: null },
    { category: 'dodge', subcategoryId: null },
  ])

  // 影画 1：能量回复（动作不在表 + 词表无字段）→ 整条废原文
  assert.equal(items.get('talent-1').verdict, 'waste')
  assert.equal(recordableEffects(items.get('talent-1')).length, 0)
  assert.ok(items.get('talent-1').waste.length > 0)
  for (const entry of items.get('talent-1').waste) assert.ok(entry.reason, '废原文必须带原因')

  // 影画 2：叠层 → kind=stacked / 12 层，时长 15 秒只进 note（条件=无法提取 → 按无处理，可写）
  const talent2 = keywordEffects(items.get('talent-2'))[0]
  assert.equal(talent2.slots.duration, '15 秒')
  assert.deepEqual(talent2.slots.conditions, [UNABLE])
  assert.equal(talent2.blocked, false, '软槽位（条件）不阻断')
  assert.equal(talent2.layerC.kind, 'stacked')
  assert.equal(talent2.layerC.maxStacks, 12)
  assert.equal(talent2.layerC.valuePerStack, 3)
  assert.match(talent2.layerC.note, /15 秒/)

  // 影画 3 / 5：「技能等级+2」在阶段2 词表里没有对应字段 → 阶段1 结束时整条废原文
  for (const slot of ['talent-3', 'talent-5']) {
    assert.equal(items.get(slot).verdict, 'waste', `${slot} 应当是废原文`)
    assert.ok(items.get(slot).waste.some((item) => /没有对应字段/.test(item.reason)))
  }

  // 影画 6：无视目标 25% 抗性 → resPen；动作=无视 = 施放者自己的穿透 → **目标自身**（用户 2026-10-17 修正）
  const talent6 = keywordEffects(items.get('talent-6'))[0]
  assert.equal(talent6.slots.stat, '抗性穿透')
  assert.equal(talent6.slots.action, '无视')
  assert.equal(talent6.slots.target, '自身')
  assert.equal(talent6.sources.target, 'literal')
  assert.equal(talent6.blocked, false, '软槽位（条件）不阻断')
  assert.equal(talent6.layerC.stat, 'resPen')
  assert.equal(talent6.layerC.value, 25)
  assert.equal(talent6.layerC.applyTarget, 'self')

  // 影画 4：抗打断 / 无敌 / 我方减伤 → 整条废原文（不入库）
  assert.equal(items.get('talent-4').verdict, 'waste')
  assert.equal(recordableEffects(items.get('talent-4')).length, 0)
  assert.ok(items.get('talent-4').waste.some((item) => /我方减伤不存在/.test(item.reason)))

  const counts = summarizeItems(result.items)
  assert.ok(counts.buffItems >= 4)
  assert.ok(counts.recordable >= 5)
  assert.ok(counts.wasteClauses > 0)
})

test('1641「菲欧妮」：转模条（异常掌控 → 暴击率）与无视防御', { skip: SKIP }, () => {
  const detail = readFixture('char', '1641')
  const result = extractAgentBuffItems({ detail, nanokaId: '1641', anchors: [] })
  const items = itemsOf(result)
  const coreEffects = keywordEffects(items.get('core'))

  const mastery = coreEffects.find((effect) => effect.layerC.stat === 'mastery')
  assert.equal(mastery.layerC.value, 85)
  assert.equal(mastery.slots.unit, '点')

  const convert = coreEffects.find((effect) => effect.layerC.kind === 'convert')
  assert.ok(convert, '「每点异常掌控使得暴击率提升」应当出转模条')
  assert.equal(convert.slots.action, '转化')
  // 异常语境（用户 2026-10-16 纠正）：这句说的是「属性异常伤害」，暴击落**异常暴击区**
  assert.equal(convert.slots.stat, '属性异常暴击率')
  assert.equal(convert.layerC.stat, 'attributeAnomalyCritRate')
  assert.equal(convert.layerC.value, 0)
  assert.equal(convert.layerC.convert.from, 'anomalyControl')
  assert.equal(convert.layerC.convert.ratioPercent, 0.7)
  assert.equal(convert.layerC.convert.defaultBase, 155, '「每点超过 155」的 155 要落基础值')

  // 同句的「基础暴击率为30%」「暴击伤害为25%」也落异常区
  assert.ok(coreEffects.some((effect) => effect.layerC.stat === 'attributeAnomalyCritRate' && effect.layerC.value === 30))
  assert.ok(coreEffects.some((effect) => effect.layerC.stat === 'attributeAnomalyCritDmg' && effect.layerC.value === 25))

  const talent6 = keywordEffects(items.get('talent-6'))
  const resPen = talent6.find((effect) => effect.layerC.stat === 'resPen')
  const reduceDefense = talent6.find((effect) => effect.layerC.stat === 'reduceDefense')
  assert.equal(resPen.layerC.value, 15)
  assert.equal(reduceDefense.slots.stat, '减防')
  assert.equal(reduceDefense.slots.action, '无视')
  assert.equal(reduceDefense.layerC.value, 40)
})

test('14164「涅槃初翎」：精炼 1–5 各自成档（精通 90→126 / 增伤 40→56）', { skip: SKIP }, () => {
  const detail = readFixture('weapon', '14164')
  const result = extractWengineBuffItems({ detail, nanokaId: '14164', anchors: [] })
  const items = itemsOf(result)
  const expected = [
    [1, 90, 40],
    [2, 99, 44],
    [3, 108, 48],
    [4, 117, 52],
    [5, 126, 56],
  ]
  for (const [level, masteryValue, dmgValue] of expected) {
    const item = items.get(`refinement-${level}`)
    assert.equal(item.landing.container, 'refinementBuffs')
    assert.equal(item.containerIndex, level - 1, `精炼 ${level} → refinementBuffs[${level - 1}]`)
    const effects = (item.effects ?? []).filter((effect) => effect.recorded)
    const mastery = effects.find((effect) => effect.slots.stat === '异常精通')
    const dmg = effects.find((effect) => effect.slots.stat === '增伤')
    assert.equal(mastery.layerC.stat, 'mastery')
    assert.equal(mastery.layerC.value, masteryValue)
    // 触发条件（「…产生暴击时」）落不到工具字段 → 无法提取、阻断；人补完条件后重解析
    assert.deepEqual(dmg.slots.conditions, [UNABLE])
    const dmgFixed = mapKeywordsToEffect({
      slots: { ...dmg.slots, conditions: [NONE] },
      id: dmg.id,
      origin: dmg.origin,
    })
    assert.equal(dmgFixed.effect.stat, 'dmgBonus')
    assert.equal(dmgFixed.effect.value, dmgValue)
    assert.deepEqual(dmgFixed.effect.elementFilter, ['火'])
    assert.equal(item.skillDesc ?? null, null, '音擎文本没有「技能描述」落点')
  }
})

test('条件**只取本句**：禁止跨句汇聚（烬火追魂第 4 句的 bug）', () => {
  // 抬头句「…时发动：」只作用于它引领的那句（splitUnits 已把抬头句并入下一句）
  const text = [
    '当菲欧妮处于[生竭]状态时，下一次普通换入、快速支援、招架支援换入前场时发动：',
    '周身环绕火焰，对周围敌人造成火属性伤害，视为[终结技]伤害。',
    '终结一击命中处于冰属性异常状态的敌人时，触发1次[异放]效果。',
    '该次[异放]效果触发暴击时，其暴击伤害额外提升40%。',
  ].join('\n')
  const { effects } = extractKeywordEffects({ text, origin: 'test', selfNames: ['菲欧妮'] })
  // 子类专用字段口径（用户 2026-10-16）：本句限定「该次[异放]」→ 落**异放暴击伤害**（专用字段），
  // 不再落共用的「暴击伤害 + scope」
  const critDmg = effects.find((effect) => effect.slots.stat === '异放暴击伤害')
  assert.ok(critDmg, '第 4 句应当产出异放暴击伤害条')
  const joined = critDmg.slots.conditions.join(' | ')
  for (const banned of ['下一次普通换入', '快速支援', '招架支援', '生竭']) {
    assert.ok(!joined.includes(banned), `条件里不许出现别的句子里的「${banned}」：${joined}`)
  }
  // 「该次[异放]效果触发暴击时」对暴击伤害是**同义反复** → 条件=无（不是无法提取）
  assert.deepEqual(critDmg.slots.conditions, [NONE])
  assert.ok(!critDmg.slots.conditions.includes(UNABLE))
  // 也不许凭空生成「限定招式」
  assert.deepEqual(critDmg.skillLimits, [])
  // 作用域来自**本句**的「[异放]效果」——但子类专用字段口径下，子类已经落到**字段**上
  // （`异放暴击伤害` → anomalyReleaseCritDmg），作用域槽位因此清成「无」（显示=落库）
  assert.equal(critDmg.slots.scope, '无')
  assert.equal(critDmg.slots.stat, '异放暴击伤害')
})

test('条件白名单硬校验：原句片段一律改写成「无法提取」，绝不冒充可转换', () => {
  const { effects } = extractKeywordEffects({
    text: '队伍中任意角色对敌人造成的属性异常伤害产生暴击时，装备者造成的火属性伤害提升40%',
    origin: 'test',
  })
  const row = effects.find((effect) => effect.slots.stat === '增伤')
  assert.ok(row)
  assert.deepEqual(row.slots.conditions, [UNABLE])

  // 结构性硬校验（直接调）：词表外的长文本 / 含句读的值 → 一律 `无法提取` 并记原因
  const direct = enforceSlotWhitelist({
    stat: '队伍中任意角色对敌人造成的属性异常伤害产生暴击时',
    action: '提升',
    value: 40,
    unit: '%',
    target: '无',
    conditions: ['无'],
    scope: '随便编的作用域',
    stacks: '无',
    duration: '无',
    object: '无',
    elements: ['无'],
  })
  assert.equal(direct.slots.stat, UNABLE)
  assert.equal(direct.slots.scope, UNABLE)
  assert.ok(direct.violations.some((item) => item.slot === 'stat' && item.reason === 'unmappable-condition'))
  assert.ok(direct.violations.some((item) => item.slot === 'scope'))
  // 条件下拉只给阶段2能落地的选项（用户 2026-10-17）：每个选项过白名单都不该被打回「无法提取」，
  // 否则界面上就是个"选了就失效"的按钮。
  for (const option of CONDITION_OPTIONS) {
    if (option === NONE || option === UNABLE) continue
    const out = enforceSlotWhitelist({ conditions: [option] })
    assert.deepEqual(out.slots.conditions, [option], `条件下拉选项「${option}」过不了白名单，不该出现在下拉里`)
    assert.equal(out.violations.length, 0, `条件下拉选项「${option}」被判成无法提取`)
  }
  // 全量断言：任何槽位都不许等于原句片段（长文本 / 含句读）
  for (const effect of effects) {
    for (const id of SLOT_IDS) {
      const value = effect.slots[id]
      const list = Array.isArray(value) ? value : [value]
      for (const item of list) {
        const text = String(item ?? '')
        if (text === NONE || text === UNABLE) continue
        assert.ok(text.length <= 24, `槽位 ${id} 的值过长（疑似原句）：${text}`)
        assert.ok(!/[。；：，、！？]/.test(text), `槽位 ${id} 的值含句读（疑似原句）：${text}`)
      }
    }
  }
})

test('同义反复条件：暴伤族 + 「触发暴击时」→ 条件=无；非暴伤族 + 「暴击时」→ 无法提取', () => {
  const tautology = firstEffect('该次[异放]效果触发暴击时，其暴击伤害额外提升40%')
  // 子类专用字段（用户 2026-10-16）：本句限定异放 → 落 `异放暴击伤害`（专用字段）
  assert.equal(tautology.effect.slots.stat, '异放暴击伤害')
  assert.deepEqual(tautology.effect.slots.conditions, [NONE])
  assert.ok(tautology.effect.tautologyDropped.length > 0, '界面据此标「同义反复已忽略」')

  const notTautology = firstEffect('暴击时，造成的伤害提升40%')
  assert.equal(notTautology.effect.slots.stat, '增伤')
  assert.deepEqual(notTautology.effect.slots.conditions, [UNABLE])
  assert.equal(notTautology.effect.tautologyDropped.length, 0)
})

test('作用域槽位：实例「[异放]效果无视敌人40%防御力」→ 作用域=异放 → scope=anomalyRelease', () => {
  const { effect } = firstEffect('菲欧妮触发的[异放]效果无视敌人40%防御力')
  assert.equal(effect.slots.stat, '减防')
  assert.equal(effect.slots.action, '无视')
  assert.equal(effect.slots.value, 40)
  assert.equal(effect.slots.scope, '异放')
  // 「无视…防御力」= 施放者自己的穿透 → 自身（用户 2026-10-17 修正；旧口径是全队）
  assert.equal(effect.slots.target, '自身')
  const mapped = mapKeywordsToEffect({ slots: effect.slots, id: 'x', origin: 'test' })
  assert.equal(mapped.ok, true)
  assert.equal(mapped.effect.stat, 'reduceDefense')
  assert.equal(mapped.effect.value, 40)
  assert.deepEqual(mapped.effect.scope, ['anomalyRelease'])
  assert.equal(mapped.effect.applyTarget, 'self')

  // 对照：普通（无作用域）减防 → 通用
  const plain = firstEffect('无视敌人40%防御力')
  assert.equal(plain.effect.slots.scope, '无')
  assert.deepEqual(mapKeywordsToEffect({ slots: plain.effect.slots, id: 'y', origin: 'test' }).effect.scope, ['general'])

  // 其他子类各自对应
  for (const [slotValue, id] of [
    ['紊乱', 'disorder'],
    ['乱流', 'turbulence'],
    ['耀变', 'radiance'],
    ['异化系数', 'mutation'],
  ]) {
    const mappedSub = mapKeywordsToEffect(
      keyword({ slots: { stat: '增伤', action: '提升', value: 10, unit: '%', scope: slotValue } }),
    )
    // **子类专用字段优先**（用户 2026-10-16）：「增伤」族遇到子类作用域 → 落该子类的**专用字段**，
    // 而不是「共用字段 + scope」。没有专用字段的场合（招式 / 异化系数）才用 scope 表达。
    const dedicatedDamage = {
      异放: 'anomalyReleaseDmgBonus',
      乱流: 'turbulenceDmgBonus',
      耀变: 'radianceDmgBonus',
      紊乱: 'disorderDmgBonus',
      属性异常: 'attributeAnomalyDmgBonus',
    }[slotValue]
    if (dedicatedDamage) {
      assert.equal(
        mappedSub.effect.stat,
        dedicatedDamage,
        `作用域=${slotValue} → 落专用字段 ${dedicatedDamage}（不再用 scope 兜）`,
      )
      assert.deepEqual(mappedSub.effect.scope, ['general'], '落专用字段时 scope 用默认（数组口径）')
    } else {
      assert.deepEqual(mappedSub.effect.scope, [id], `作用域=${slotValue} → scope=[${id}]（数组口径）`)
    }
  }
})

test('敌人削弱族按动作分目标：无视 → 自身（穿透是施放者的属性）；降低 → 全队（对敌削弱）', () => {
  // 动作 = 无视：「无视…抗性 / 防御」写在谁的句子里就只作用在谁身上（用户 2026-10-17 修正）
  const pierced = firstEffect('无视25%火属性伤害抗性')
  assert.equal(pierced.effect.slots.stat, '抗性穿透')
  assert.equal(pierced.effect.slots.action, '无视')
  assert.equal(pierced.effect.slots.target, '自身')
  assert.equal(pierced.effect.sources.target, 'literal')
  assert.equal(
    mapKeywordsToEffect({ slots: pierced.effect.slots, id: 't1', origin: 'test' }).effect.applyTarget,
    'self',
  )

  // 点名角色 + 无视 → 仍是自身（用户判例：「菲欧妮无视目标15%全属性伤害抗性」）
  const namedPierce = firstEffect('菲欧妮无视目标15%全属性伤害抗性', { selfNames: ['菲欧妮'] })
  assert.equal(namedPierce.effect.slots.stat, '抗性穿透')
  assert.equal(namedPierce.effect.slots.target, '自身')
  assert.equal(namedPierce.effect.sources.target, 'literal')

  // 动作 = 降低：挂在敌人身上的削弱，队友同样受益 → 全队（原文没写明给谁时标「默认」）
  const reduced = firstEffect('使目标抗性降低15%')
  assert.equal(reduced.effect.slots.target, '全队')
  assert.equal(reduced.effect.sources.target, 'literal', '原文写了「目标」→ literal')
  assert.equal(
    mapKeywordsToEffect({ slots: reduced.effect.slots, id: 't2', origin: 'test' }).effect.applyTarget,
    'team',
  )

  // 动作=降低 且原文没写「敌人 / 目标 / 对方」→ 走 default-team（界面标淡色「默认」）
  const reducedPlain = firstEffect('抗性降低15%')
  assert.equal(reducedPlain.effect.slots.stat, '抗性穿透')
  assert.equal(reducedPlain.effect.slots.target, '全队')
  assert.equal(reducedPlain.effect.sources.target, 'default-team', '界面据此标淡色「默认」')

  // 明确写「装备者 / 自身」→ 自身（不是默认兜底）
  const self = firstEffect('装备者的防御力降低10%')
  assert.equal(self.effect.slots.stat, '减防')
  assert.equal(self.effect.slots.target, '自身')
  assert.equal(self.effect.sources.target, 'literal')

  // 非削弱族不受影响
  const buff = firstEffect('造成的伤害提升10%')
  assert.equal(buff.effect.slots.target, '无')
})

test('目标判定以主语为准：点名角色 → 自身；无主语 + 敌人状态 → 全队（增伤与暴击族都适用）', () => {
  const names = ['菲欧妮']
  /** 原始关键字效果（`firstEffect` 不带 layerC）→ 手动跑一次映射 */
  const mapped = (effect) => mapKeywordsToEffect({ slots: effect.slots, sources: effect.sources })

  // ① 点名角色 + 敌人状态 → 自身（规则① 最高优先）
  const named = firstEffect('菲欧妮对[蚀]状态下的敌人造成的伤害提升30%'.replace('[蚀]', '[灼蚀]'), {
    selfNames: names,
  })
  assert.equal(named.effect.slots.stat, '增伤')
  assert.equal(named.effect.slots.target, '自身')
  assert.equal(named.effect.sources.target, 'literal')
  assert.equal(mapped(named.effect).effect.applyTarget, 'self')

  // ② 无主语（泛指）+ 敌人状态 → 全队（**增伤也适用**）
  const generic = firstEffect('对[灼蚀]状态下的敌人造成的伤害提升30%', { selfNames: names })
  assert.equal(generic.effect.slots.target, '全队')
  assert.equal(generic.effect.sources.target, 'default-team-enemy-status')
  assert.equal(mapped(generic.effect).effect.applyTarget, 'team')
  assert.match(mapped(generic.effect).effect.note, /目标默认：条件为敌人状态、未限定施放者/)

  // ③ 1641 核心被动那句（子句里没有角色名）暴击族 → 全队 + note 短语
  const sentence =
    '[灼蚀]状态下的敌人受到属性异常伤害时有概率触发暴击，基础暴击率为30%，暴击伤害为25%'
  const effects = keywordEffects(simplifyText({ text: sentence, origin: 'test', selfNames: names }))
  const critRate = effects.find((effect) => effect.slots.stat === '属性异常暴击率')
  const critDmg = effects.find((effect) => effect.slots.stat === '属性异常暴击伤害')
  assert.ok(critRate && critDmg, '两句都要抽出来')
  for (const effect of [critRate, critDmg]) {
    assert.equal(effect.slots.target, '全队', '无主语 + 敌人状态 → 全队')
    assert.equal(effect.sources.target, 'default-team-enemy-status')
    assert.equal(effect.layerC.applyTarget, 'team')
    assert.match(effect.layerC.note, /目标默认：条件为敌人状态、未限定施放者/)
  }
  assert.equal(critRate.layerC.stat, 'attributeAnomalyCritRate')
  assert.equal(critRate.layerC.value, 30)
  assert.equal(critDmg.layerC.stat, 'attributeAnomalyCritDmg')
  assert.equal(critDmg.layerC.value, 25)

  // ④ 点名「11号」→ 自身
  const named11 = firstEffect('11号造成的火属性伤害提升10%', { selfNames: ['11号'] })
  assert.equal(named11.effect.slots.target, '自身')
  assert.equal(named11.effect.sources.target, 'literal')
  assert.equal(mapped(named11.effect).effect.applyTarget, 'self')

  // ⑤ 减防 / 抗穿：动作=无视 → 自身（施放者的穿透）；动作=降低 → 全队
  const pierced = firstEffect('招式造成伤害时，无视敌人40%防御力', { selfNames: names })
  assert.equal(pierced.effect.slots.stat, '减防')
  assert.equal(pierced.effect.slots.target, '自身')
  assert.equal(pierced.effect.sources.target, 'literal')

  const debuff = firstEffect('招式造成伤害时，使敌人防御力降低40%', { selfNames: names })
  assert.equal(debuff.effect.slots.stat, '减防')
  assert.equal(debuff.effect.slots.target, '全队')
  assert.equal(debuff.effect.sources.target, 'literal', '原文写了「敌人」→ literal')

  // ⑥ 无主语、也不带敌人状态 → 沿用既有默认（不动）
  const plain = firstEffect('造成的伤害提升20%', { selfNames: names })
  assert.equal(plain.effect.slots.target, '无')
  assert.equal(mapped(plain.effect).effect.applyTarget, 'self')

  // 规则表里要有「以主语为准」的几条（单一事实来源）
  const targetGroup = buildRulesTable().groups.find((group) => group.id === 'target')
  const games = targetGroup.items.map((item) => item.game).join(' | ')
  assert.match(games, /点名角色/)
  assert.match(games, /敌人状态/)
  assert.match(games, /不带/)
})

test('目标判定：指回前句的句子沿用被指向那条的目标（不因「…状态下的敌人」翻全队）', () => {
  const names = ['11号']
  const text =
    '「11号」造成的火属性伤害提升10%，攻击处于失衡状态下的敌人时，该增益效果额外提升22.5%。'
  const effects = keywordEffects(simplifyText({ text, origin: 'test', selfNames: names }))
  assert.equal(effects.length, 2)
  assert.equal(effects[0].slots.target, '自身')
  assert.equal(effects[1].slots.target, '自身', '指回前句 → 沿用前一条（自身）')
  assert.equal(effects[1].sources.target, 'refer-back')
  assert.equal(effects[1].layerC.applyTarget, 'self')
  assert.equal(effects[1].layerC.applySituation, 'stagger', '条件「失衡」用既有字段表达')
  assert.ok(!/目标默认：条件为敌人状态/.test(effects[1].layerC.note), '不该套用敌人状态默认短语')

  // 句中有指回词、但**前一条没有自身增益可回落** → 仍按规则②（无主语 + 敌人状态 → 全队）
  const noReferent = firstEffect('攻击处于失衡状态下的敌人时，该增益效果额外提升22.5%', {
    selfNames: names,
  })
  assert.equal(noReferent.effect.slots.target, '全队')
  assert.equal(noReferent.effect.sources.target, 'default-team-enemy-status')

  // 1641 核心被动那句（无指回词）→ 仍 team
  const core = keywordEffects(
    simplifyText({
      text: '[灼蚀]状态下的敌人受到属性异常伤害时有概率触发暴击，基础暴击率为30%，暴击伤害为25%',
      origin: 'test',
      selfNames: ['菲欧妮'],
    }),
  )
  assert.ok(core.every((effect) => effect.slots.target === '全队'))

  // 规则表里有「指回前句」这一条
  const targetGroup = buildRulesTable().groups.find((group) => group.id === 'target')
  assert.ok(targetGroup.items.some((item) => /该增益效果|指回前句/.test(`${item.game}${item.note}`)))
})

test('解析规则对照表：从词表自动导出（分组 + 条目）', () => {
  const table = buildRulesTable()
  assert.ok(table.groups.length >= 10, `分组数 ${table.groups.length}`)
  const total = table.groups.reduce((acc, group) => acc + group.items.length, 0)
  assert.ok(total >= 100, `条目数 ${total}`)
  for (const group of table.groups) {
    assert.ok(group.id && group.title, '每组都要有 id / title')
    assert.ok(group.items.length > 0, `${group.id} 不该是空组`)
    for (const item of group.items) {
      assert.equal(typeof item.game, 'string')
      assert.equal(typeof item.slot, 'string')
    }
  }
  const ids = table.groups.map((group) => group.id)
  for (const required of ['stat', 'action', 'literal', 'anomaly', 'convert', 'scope', 'target', 'condition', 'waste']) {
    assert.ok(ids.includes(required), `缺少分组 ${required}`)
  }
})

test('`无法提取` 分软硬：条件 / 作用域 / 目标等按「无」处理，属性 / 动作 / 数值仍阻断', () => {
  // ① 条件=无法提取 → 映射成功、无 condition（常驻生效），不写进 note
  const softCondition = mapKeywordsToEffect({
    slots: { stat: '增伤', action: '提升', value: 10, unit: '%', conditions: [UNABLE] },
    id: 's1',
    origin: 'test',
  })
  assert.equal(softCondition.ok, true)
  assert.equal(softCondition.blocked, false)
  assert.equal(softCondition.effect.applySituation, 'global')
  assert.equal(softCondition.effect.stat, 'dmgBonus')
  assert.equal(softCondition.effect.value, 10)
  assert.ok(!/无法提取/.test(softCondition.effect.note), 'note 不许出现「无法提取」冒充条件')

  // ② 属性=无法提取 → 阻断
  const hardStat = mapKeywordsToEffect({
    slots: { stat: UNABLE, action: '提升', value: 10, unit: '%', conditions: [NONE] },
    id: 's2',
    origin: 'test',
  })
  assert.equal(hardStat.blocked, true)
  assert.equal(hardStat.effect, null)
  assert.match(hardStat.reason, /属性/)
  // 动作 / 数值 同样阻断
  assert.equal(
    mapKeywordsToEffect({ slots: { stat: '增伤', action: UNABLE, value: 10, unit: '%' } }).blocked,
    true,
  )
  assert.equal(
    mapKeywordsToEffect({ slots: { stat: '增伤', action: '提升', value: UNABLE, unit: '%' } }).blocked,
    true,
  )

  // ③ 用户补上条件 → 条件生效（失衡 → applySituation=stagger）
  const fixedCondition = mapKeywordsToEffect({
    slots: {
      stat: '增伤',
      action: '提升',
      value: 10,
      unit: '%',
      conditions: ['攻击处于失衡状态下的敌人时'],
    },
    id: 's3',
    origin: 'test',
  })
  assert.equal(fixedCondition.effect.applySituation, 'stagger')

  // 软槽位其他成员：作用域 / 目标 / 元素 / 层数 / 时长 / 对象 都不阻断
  for (const slot of ['scope', 'target', 'stacks', 'duration', 'object']) {
    const mapped = mapKeywordsToEffect({
      slots: { stat: '增伤', action: '提升', value: 10, unit: '%', [slot]: UNABLE },
      id: `s-${slot}`,
      origin: 'test',
    })
    assert.equal(mapped.blocked, false, `${slot}=无法提取 不该阻断`)
    assert.equal(mapped.effect.stat, 'dmgBonus')
  }
  const softScope = mapKeywordsToEffect({
    slots: { stat: '增伤', action: '提升', value: 10, unit: '%', scope: UNABLE },
  })
  assert.deepEqual(softScope.effect.scope, ['general'], '作用域=无法提取 → 通用')
})

// ================================================================== 8. 写入计划（假对象，不碰库）

function fakeAgentLocal() {
  return {
    id: 'test-agent',
    name: '测试角色',
    profession: '强攻',
    element: '火',
    supportNeeds: [],
    note: '',
    avatar_image: null,
    basePanel: {},
    mindscapeNotes: ['', '', '', '', '', '', ''],
    mindscapeBuffs: [
      {
        effectBlocks: [
          { id: 'blk-weird', name: '奇怪的块名（手写展示文字）', note: '', effects: [], enabledDefault: true },
        ],
        effects: [],
      },
      ...Array.from({ length: 6 }, () => ({ effectBlocks: [], effects: [] })),
    ],
  }
}

function fakeWengineLocal() {
  return {
    id: 'test-wengine',
    name: '测试音擎',
    profession: '强攻',
    rarity: 'S',
    avatar_image: null,
    note: '',
    baseAtk: 0,
    baseDef: 0,
    advancedStats: {},
    fixedBuffs: { effectBlocks: [], effects: [] },
    refinementBuffs: Array.from({ length: 5 }, () => ({ effectBlocks: [], effects: [] })),
  }
}

function applyRow(overrides = {}) {
  const slots = {
    stat: '增伤',
    elements: [NONE],
    action: '提升',
    value: 30,
    unit: '%',
    target: NONE,
    conditions: [NONE],
    stacks: NONE,
    duration: NONE,
    object: NONE,
    ...overrides.slots,
  }
  return {
    key: overrides.key ?? 'k1',
    slot: overrides.slot ?? 'core',
    slotLabel: overrides.slotLabel ?? '核心被动',
    source: overrides.source ?? 'passive.core',
    containerIndex: overrides.containerIndex ?? 0,
    rawText: overrides.rawText ?? '造成的伤害提升30%',
    keywordSlots: slots,
    convert: null,
    effect: {
      stat: 'dmgBonus',
      kind: 'fixed',
      value: 30,
      applyTarget: 'self',
      applySituation: 'global',
      elementFilter: 'all',
      scope: 'general',
      maxStacks: 1,
      defaultStacks: 1,
      enabledDefault: true,
      note: '造成的伤害提升30%',
      ...overrides.effect,
    },
    skillDesc: overrides.skillDesc,
  }
}

test('planBuffApply：按**槽位下标**复用已有块（不看块名），没有块才新建', () => {
  const local = fakeAgentLocal()
  const plan = planBuffApply({
    kind: 'agent',
    local,
    rows: [
      applyRow(),
      applyRow({
        key: 'k2',
        slot: 'passive.extra',
        source: 'passive.extra',
        containerIndex: 0,
        effect: { stat: 'critRate', value: 15 },
        rawText: '暴击率提升15%',
      }),
      applyRow({
        key: 'k3',
        slot: 'talent-3',
        slotLabel: '影画 3',
        source: 'talent.3',
        containerIndex: 3,
        effect: { stat: 'atk', value: 100 },
        rawText: '攻击力提升100点',
      }),
    ],
  })

  const slot0 = plan.groups.find((group) => group.containerIndex === 0)
  assert.equal(slot0.blockName, '奇怪的块名（手写展示文字）', '复用该槽位已有的块，不管块名叫什么')
  assert.equal(slot0.blockIsNew, false)
  assert.equal(slot0.added, 2, '槽位 0 的两条都追加进同一块')
  assert.deepEqual(slot0.blocks[0].effects.map((effect) => effect.stat), ['dmgBonus', 'critRate'])

  const slot3 = plan.groups.find((group) => group.containerIndex === 3)
  assert.equal(slot3.blockIsNew, true)
  assert.equal(slot3.blockName, '3 影')
  assert.deepEqual(slot3.blocks[0].effects.map((effect) => effect.stat), ['atk'])

  assert.equal(plan.updated, 3)
  assert.equal(plan.skipped, 0)
  // 每条增益都标出「写入：<块位> · 新增/替换」
  for (const group of plan.groups) {
    for (const effect of group.effects) {
      assert.match(effect.writeLabel, /^写入：mindscapeBuffs\[\d\]/)
      assert.match(effect.writeLabel, /新增/)
    }
  }
  // 原文 + `[关键字]` 行进块 note（追加不覆盖）
  assert.match(slot0.blocks[0].note, /原文：造成的伤害提升30%/)
  assert.match(slot0.blocks[0].note, /\[关键字\]/)
})

test('planBuffApply：原文本地已有则不重复追加；重复效果按判重签名跳过', () => {
  const local = fakeAgentLocal()
  const row = applyRow()
  const block = formatSourceBlock({
    rawText: row.rawText,
    effects: [{ slots: row.keywordSlots, convert: row.convert }],
  })
  local.mindscapeBuffs[0].effectBlocks[0].note = block
  local.mindscapeBuffs[0].effectBlocks[0].effects = [
    {
      id: 'old',
      stat: 'dmgBonus',
      kind: 'fixed',
      applyTarget: 'self',
      applySituation: 'global',
      maxStacks: 1,
      value: 30,
      defaultStacks: 1,
      elementFilter: 'all',
    },
  ]
  const plan = planBuffApply({ kind: 'agent', local, rows: [row] })
  assert.equal(plan.updated, 0)
  assert.equal(plan.skipped, 1)
  assert.equal(plan.groups[0].blocks[0].effects.length, 1)
  assert.match(plan.groups[0].effects[0].writeLabel, /已存在（重复，跳过）/)
  assert.equal(plan.groups[0].note.duplicate, true)
  assert.equal(
    plan.groups[0].blocks[0].note.split('原文：造成的伤害提升30%').length - 1,
    1,
    '同一段原文不重复追加',
  )
})

test('planBuffApply：音擎写 refinementBuffs[j-1] / fixedBuffs；原文追加不覆盖', () => {
  const wengine = fakeWengineLocal()
  const plan = planBuffApply({
    kind: 'wengine',
    local: wengine,
    rows: [
      applyRow({
        key: 'r3',
        slot: 'refinement-3',
        slotLabel: '精炼 3',
        source: 'weapons.talents.3',
        containerIndex: 2,
        effect: { stat: 'mastery', value: 108 },
        rawText: '装备者的异常精通提升108点',
      }),
      applyRow({
        key: 'fx',
        slot: 'fixed',
        slotLabel: '基础效果',
        source: 'fixed',
        containerIndex: null,
        effect: { stat: 'atk', value: 20 },
        rawText: '攻击力提升20点',
      }),
    ],
  })
  const refinement = plan.groups.find((group) => group.container === 'refinementBuffs')
  assert.equal(refinement.containerIndex, 2)
  assert.equal(refinement.label, 'refinementBuffs[2]（精炼 3）')
  assert.equal(refinement.blockIsNew, true)
  assert.equal(refinement.blockName, '精炼 3')
  const fixed = plan.groups.find((group) => group.container === 'fixedBuffs')
  assert.equal(fixed.ok, true)
  assert.equal(fixed.added, 1)

  const first = appendSourceText('', '原文：甲')
  assert.equal(first.appended, true)
  const again = appendSourceText(first.note, '原文：甲')
  assert.equal(again.appended, false)
  assert.equal(again.duplicate, true)
})

test('planBuffApply：招式文本的「描述」只写既有招式行；没有这条招式 → 不改描述（不新建挂载点）', () => {
  const local = fakeAgentLocal()
  const skills = [{ id: 'sk-1', agentId: 'test-agent', name: '强化特殊技：测试', note: '' }]
  const plan = planBuffApply({
    kind: 'agent',
    local,
    skills,
    rows: [
      applyRow({
        key: 's1',
        slot: 'skill-special-0',
        slotLabel: '招式文本（特殊技）',
        source: 'skill.special.0',
        containerIndex: 0,
        effect: { stat: 'skillDmgBonus', value: 12 },
        slots: { stat: '招式增伤', action: '提升', value: 12, unit: '%', conditions: ['限定招式：强化特殊技'] },
        rawText: '强化特殊技造成的伤害提升12%',
        skillDesc: { agentId: 'test-agent', skillName: '强化特殊技：测试', category: 'special' },
      }),
      applyRow({
        key: 's2',
        slot: 'skill-basic-0',
        slotLabel: '招式文本（普通攻击）',
        source: 'skill.basic.0',
        containerIndex: 0,
        effect: { stat: 'dmgBonus', value: 5 },
        rawText: '普通攻击造成的伤害提升5%',
        skillDesc: { agentId: 'test-agent', skillName: '不存在的招式', category: 'basic' },
      }),
    ],
  })
  const appended = plan.skills.find((item) => item.skillId === 'sk-1')
  assert.equal(appended.appended, true)
  assert.match(appended.note, /原文：强化特殊技造成的伤害提升12%/)
  assert.match(appended.note, /\[关键字\] 属性=招式增伤/)
  const missing = plan.skills.find((item) => item.skillName === '不存在的招式')
  assert.equal(missing.appended, false)
  assert.match(missing.reason, /不新建挂载点/)

  // 招式行匹配口径：先精确名，再「名字·分段」
  assert.equal(
    matchSkillDescTargets([{ id: 'a', agentId: 'x', name: '普通攻击：火力镇压' }], {
      agentId: 'x',
      skillName: '普通攻击：火力镇压',
    }).length,
    1,
  )
  assert.equal(
    matchSkillDescTargets([{ id: 'a', agentId: 'x', name: '普通攻击：火力镇压·一段' }], {
      agentId: 'x',
      skillName: '普通攻击：火力镇压',
    }).length,
    1,
  )
  assert.equal(
    matchSkillDescTargets([{ id: 'a', agentId: 'y', name: '普通攻击：火力镇压' }], {
      agentId: 'x',
      skillName: '普通攻击：火力镇压',
    }).length,
    0,
  )
})

test('resolveSlotTarget：只按下标，越界就拒绝（不看块名）', () => {
  assert.equal(resolveSlotTarget({ kind: 'agent', source: 'talent.2', containerIndex: 2 }).index, 2)
  assert.equal(resolveSlotTarget({ kind: 'agent', source: 'talent.9', containerIndex: 9 }).ok, false)
  assert.equal(
    resolveSlotTarget({ kind: 'wengine', source: 'weapons.talents.5', containerIndex: 4 }).index,
    4,
  )
  assert.equal(
    resolveSlotTarget({ kind: 'wengine', source: 'weapons.talents.6', containerIndex: 5 }).ok,
    false,
  )
  assert.equal(
    resolveSlotTarget({ kind: 'wengine', source: 'fixed', containerIndex: null }).container,
    'fixedBuffs',
  )
})

// ================================================================== 9. 阶段二智能覆盖

function mergeRow(overrides = {}) {
  return {
    key: overrides.key ?? 'k1',
    effect: {
      stat: 'dmgBonus',
      kind: 'fixed',
      value: 10,
      applyTarget: 'self',
      note: '我的备注',
      ...overrides.effect,
    },
    dirty: overrides.dirty ?? {},
  }
}

test('smartMergeParse：只回填未手改字段；手填值 ≠ 新解析值 → 冲突（绝不静默覆盖）', () => {
  const rows = [
    mergeRow({ key: 'k1', effect: { stat: 'dmgBonus', value: 99 }, dirty: { value: true } }),
    mergeRow({ key: 'k2', effect: { stat: 'dmgBonus', value: 1 } }),
    mergeRow({ key: 'k4' }),
  ]
  const keywords = [
    keyword({ id: 'k1', slots: { value: 30 } }),
    keyword({ id: 'k2', slots: { value: 30 } }),
    keyword({ id: 'k3', slots: { stat: '暴击率', value: 15 } }),
  ]
  const result = smartMergeParse({ rows, keywords })

  const k1 = result.rows.find((row) => row.key === 'k1')
  assert.equal(k1.effect.value, 99, '手改过的字段解析不覆盖')
  assert.equal(k1.effect.stat, 'dmgBonus')
  assert.deepEqual(
    k1.conflicts.map((conflict) => [conflict.field, conflict.mine, conflict.theirs]),
    [['value', 99, 30]],
  )

  const k2 = result.rows.find((row) => row.key === 'k2')
  assert.equal(k2.effect.value, 30, '没手改过的字段被解析回填')
  assert.deepEqual(k2.conflicts, [])

  const k3 = result.rows.find((row) => row.key === 'k3')
  assert.equal(k3.added, true, '关键字新增效果 → 追加新行')
  assert.equal(k3.effect.stat, 'critRate')

  const k4 = result.rows.find((row) => row.key === 'k4')
  assert.equal(k4.stale, true, '关键字里已无此条 → 旧增益行保留并标注')
  assert.equal(k4.staleLabel, '关键字里已无此条')

  assert.equal(result.added, 1)
  assert.equal(result.stale, 1)
  assert.equal(result.conflicts.length, 1)
  // 关键字 ↔ 增益一对一：行数 = 旧行 + 新增行
  assert.equal(result.rows.length, 4)

  // 冲突裁决：保留我的 / 用新解析
  const keepMine = resolveRowConflicts({ row: k1, choices: { value: 'mine' } })
  assert.equal(keepMine.effect.value, 99)
  assert.equal(keepMine.conflicts.length, 1)
  const useTheirs = resolveRowConflicts({ row: k1, choices: { value: 'theirs' } })
  assert.equal(useTheirs.effect.value, 30)
  assert.equal(useTheirs.conflicts.length, 0)
})

test('smartMergeParse：关键字标了「无法提取」→ 保留旧行并给阻断原因（不覆盖）', () => {
  const rows = [mergeRow({ key: 'k1', effect: { value: 10 } })]
  const keywords = [keyword({ id: 'k1', slots: { value: UNABLE } })]
  const result = smartMergeParse({ rows, keywords })
  assert.equal(result.blocked, 1)
  assert.equal(result.rows[0].blocked, true)
  assert.match(result.rows[0].blockReason, /无法提取/)
  assert.equal(result.rows[0].effect.value, 10, '阻断时旧值原样保留')
})

test('smartMergeParse：转模条回填 kind=convert（value 归零）', () => {
  const rows = [mergeRow({ key: 'c1', effect: { stat: 'critRate', value: 5 } })]
  const keywords = [
    keyword({
      id: 'c1',
      slots: { stat: '暴击率', action: '转化', value: NONE, unit: NONE },
      convert: {
        convertFrom: 'anomalyControl',
        convertPanelSource: 'external',
        convertRatio: 0.7,
        convertBase: null,
        convertCap: null,
      },
    }),
  ]
  const result = smartMergeParse({ rows, keywords })
  const row = result.rows.find((item) => item.key === 'c1')
  assert.equal(row.effect.kind, 'convert')
  assert.equal(row.effect.value, 0)
  assert.equal(row.effect.convert.from, 'anomalyControl')
  assert.equal(row.effect.convert.ratioPercent, 0.7)
  assert.ok(MERGE_FIELD_LIST.some((field) => field.id === 'convert'))
})

// ================================================================== 10. 效果整理 / 参数校验 / 接线

test('sanitizeEffect：只留 schema 字段；转模 value 恒 0；非法值抛中文错误', () => {
  const effect = sanitizeEffect({
    stat: 'dmgBonus',
    kind: 'fixed',
    value: 30,
    applyTarget: 'team',
    statLabel: '增伤',
    writeLabel: '写入：xxx',
    displayOnly: true,
  })
  assert.equal(effect.applyTarget, 'team')
  assert.ok(!('statLabel' in effect))
  assert.ok(!('writeLabel' in effect))
  assert.ok(!('displayOnly' in effect))

  const convert = sanitizeEffect({
    stat: 'critRate',
    kind: 'convert',
    value: 99,
    convert: { from: 'anomalyControl', panelSource: 'external', ratioPercent: 0.7 },
  })
  assert.equal(convert.value, 0)
  assert.equal(convert.convert.from, 'anomalyControl')

  assert.throws(() => sanitizeEffect({ stat: 'not-a-stat' }), /不是合法增益字段/)
  assert.throws(
    () => sanitizeEffect({ stat: 'critRate', kind: 'convert', convert: { from: 'nope' } }),
    /读取属性|来源属性/,
  )
})

test('extractBuffItems / applyBuffItems：参数不对时在碰库之前就抛中文错误', async () => {
  await assert.rejects(() => extractBuffItems({ kind: 'nope', detail: {} }), /未知的增益来源类型/)
  await assert.rejects(() => extractBuffItems({ kind: 'agent', detail: null }), /缺少 nanoka 详情 JSON/)
  await assert.rejects(() => applyBuffItems({ kind: 'agent', id: '', rows: [] }), /缺少本地角色 id/)
  await assert.rejects(() => applyBuffItems({ kind: 'wengine', id: '  ' }), /缺少本地音擎 id/)
})

test('增益接口接线：/extract /simplify /parse /apply 的首个中间件都是 requireAdmin', () => {
  const routes = [
    ['post', '/extract'],
    ['post', '/simplify'],
    ['post', '/parse'],
    ['post', '/apply'],
    ['get', '/rules'],
    ['get', '/empty-targets'],
  ]
  for (const [method, path] of routes) {
    const layer = nanokaBuffRoutes.stack.find(
      (entry) => entry.route && entry.route.path === path && Boolean(entry.route.methods[method]),
    )
    assert.ok(layer, `缺少路由 ${method.toUpperCase()} ${path}`)
    const handlers = layer.route.stack.map((item) => item.handle)
    assert.equal(handlers[0], requireAdmin, `${method.toUpperCase()} ${path} 首个中间件应为 requireAdmin`)
    assert.ok(handlers.length >= 2, `${method.toUpperCase()} ${path} 缺少控制器`)
  }
})

test('「找空活干」：列出 0 增益的角色 / 音擎（只数增益条，不看 note / 原文）', () => {
  const block = (effects, note = '') => ({ id: 'blk', name: '块', note, effects })
  const effect = { stat: 'dmgBonus', kind: 'fixed', value: 10 }
  const agent = (id, name, blocks) => ({
    id,
    name,
    element: '以太',
    profession: '异常',
    mindscapeBuffs: blocks,
  })
  const wengine = (id, name, fixed, refinements) => ({
    id,
    name,
    rarity: 'S',
    fixedBuffs: fixed,
    refinementBuffs: refinements,
  })
  const buffs = {
    agents: [
      agent('2', '乙角色', [{ effectBlocks: [block([effect])] }]),
      agent('1', '甲角色', [{ effectBlocks: [] }, { effectBlocks: [] }]),
      agent('3', '丙角色', [
        { effectBlocks: [] },
        // 只有 note / 没有 effects → 仍算 0 增益
        { effectBlocks: [{ id: 'b', name: '只写了原文', note: '原文：…', effects: [] }] },
      ]),
    ],
    wengines: [
      wengine('w2', '乙音擎', { effectBlocks: [block([effect, effect])] }, [
        { effectBlocks: [block([effect])] },
      ]),
      wengine('w1', '甲音擎', { effectBlocks: [] }, [{ effectBlocks: [] }, { effectBlocks: [] }]),
    ],
  }

  assert.equal(countTargetEffects('agent', buffs.agents[0]), 1)
  assert.equal(countTargetEffects('agent', buffs.agents[2]), 0, 'note 不算增益条')
  assert.equal(countTargetEffects('wengine', buffs.wengines[0]), 3, 'fixedBuffs + refinementBuffs 都要数')

  const agents = listEmptyBuffTargets({ kind: 'agent', buffs })
  assert.deepEqual(
    agents.empty.map((row) => row.name),
    ['丙角色', '甲角色'],
    '按名字排序',
  )
  assert.ok(agents.empty.every((row) => row.effectCount === 0))
  assert.equal(agents.total, 3)
  assert.equal(agents.few.length, 1, '增益条 ≤ 2 的另列参考')
  assert.equal(agents.few[0].effectCount, 1)

  const wengines = listEmptyBuffTargets({ kind: 'wengine', buffs })
  assert.deepEqual(
    wengines.empty.map((row) => row.id),
    ['w1'],
  )
  assert.equal(wengines.kindLabel, '音擎')
  assert.equal(wengines.kind, 'wengine')

  // 默认阈值 = 2：3 条的既不在 empty 也不在 few
  assert.ok(!wengines.few.some((row) => row.id === 'w2'))
})

test('化简的公开入口与 buildItem 同源（只重跑阶段1）', () => {
  const simplified = simplifyText({ text: '造成的伤害提升10%', origin: 'test' })
  assert.equal(simplified.effects.length, 1)
  assert.equal(simplified.effects[0].layerC.stat, 'dmgBonus')
  assert.deepEqual(simplified.waste, [])
})
test('合集扇出（抽取层）：属性伤害→4 条 / 属性暴击→2 条 / 属性暴击伤害→2 条；单一目标词不被吃掉', () => {
  // ① 属性伤害 → 恰好 4 条（异常 / 异放 / 乱流 / 耀变；不含紊乱），值相同，带合集元数据
  const damage = keywordEffects(simplifyText({ text: '造成的属性伤害提升20%', origin: 'test' }))
  assert.equal(damage.length, 4, '属性伤害 = 合集 4 条')
  // 有专用字段就落专用字段：阶段一「属性」槽位显示的就是**最终落库**那个词，作用域清成 `无`
  const damageStats = damage.map((effect) => effect.slots.stat).sort()
  assert.deepEqual(damageStats, ['乱流增伤', '异放增伤', '耀变增伤', '属性异常增伤'].sort())
  assert.ok(
    damage.every((effect) => effect.slots.scope === '无'),
    '落专用字段 → 作用域槽位保持「无」（阶段一显示 = 最终落库）',
  )
  for (const effect of damage) {
    assert.equal(effect.slots.value, 20)
    assert.equal(effect.collection?.title, '属性伤害', '每条都带合集元数据（界面徽章用）')
    assert.match(effect.collection?.note ?? '', /不含紊乱/, '合集口径要写明不含紊乱')
  }
  // 用户 2026-10-16 口径：**有专用字段就落专用字段**，「属性伤害」= 4 个专用字段各一条，scope 用默认
  assert.deepEqual(
    damage.map((effect) => effect.layerC?.stat).sort(),
    ['attributeAnomalyDmgBonus', 'anomalyReleaseDmgBonus', 'radianceDmgBonus', 'turbulenceDmgBonus'].sort(),
    '属性伤害合集 → 4 个专用增伤字段各一条',
  )
  assert.ok(
    damage.every((effect) => JSON.stringify(effect.layerC?.scope) === JSON.stringify(['general'])),
    '落专用字段时 scope 用默认（[general]）',
  )

  // ② 属性暴击率 → 2 条（异常 / 异放）
  const critRate = keywordEffects(simplifyText({ text: '属性暴击率提升10%', origin: 'test' }))
  // 暴击也一律落**专用字段**（4 个子类：异常/异放/乱流/耀变，不含紊乱）
  assert.equal(critRate.length, 4)
  assert.deepEqual(
    critRate.map((effect) => effect.slots.stat).sort(),
    ['乱流暴击率', '异放暴击率', '耀变暴击率', '属性异常暴击率'].sort(),
  )
  assert.ok(critRate.every((effect) => effect.slots.scope === '无' && effect.slots.value === 10))
  assert.deepEqual(
    critRate.map((effect) => effect.layerC?.stat).sort(),
    ['attributeAnomalyCritRate', 'anomalyReleaseCritRate', 'radianceCritRate', 'turbulenceCritRate'].sort(),
  )
  assert.ok(critRate.every((effect) => JSON.stringify(effect.layerC?.scope) === JSON.stringify(['general'])))
  assert.ok(critRate.every((effect) => effect.collection?.title === '属性暴击'))

  // ③ 属性暴击伤害 → 2 条
  const critDmg = keywordEffects(simplifyText({ text: '属性暴击伤害提升15%', origin: 'test' }))
  assert.equal(critDmg.length, 4)
  assert.deepEqual(
    critDmg.map((effect) => effect.slots.stat).sort(),
    ['乱流暴击伤害', '异放暴击伤害', '耀变暴击伤害', '属性异常暴击伤害'].sort(),
  )
  assert.ok(critDmg.every((effect) => effect.slots.scope === '无' && effect.slots.value === 15))
  assert.deepEqual(
    critDmg.map((effect) => effect.layerC?.stat).sort(),
    ['attributeAnomalyCritDmg', 'anomalyReleaseCritDmg', 'radianceCritDmg', 'turbulenceCritDmg'].sort(),
  )
  assert.ok(critDmg.every((effect) => effect.collection?.title === '属性暴击伤害'))

  // ④ 单一目标词**不被合集吃掉**：「异放伤害」仍 1 条
  const release = keywordEffects(simplifyText({ text: '异放伤害提升30%', origin: 'test' }))
  assert.equal(release.length, 1, '单一目标词保持 1 条')
  // 有专用字段 → 阶段一显示 异放增伤、作用域清成「无」\n  assert.equal(release[0].slots.stat, '异放增伤')\n  assert.equal(release[0].slots.scope, '无')
  assert.equal(release[0].collection, undefined, '不是合集 → 没有合集元数据')

  // ⑤ 「火属性伤害」「全属性伤害」也不是合集
  assert.equal(keywordEffects(simplifyText({ text: '火属性伤害提升10%', origin: 'test' })).length, 1)
  assert.equal(keywordEffects(simplifyText({ text: '全属性伤害提升10%', origin: 'test' })).length, 1)

  // ⑥ 合集信息**写入前剔除、不入库**（sanitizeEffect 只留 schema 字段）
  const sanitized = sanitizeEffect({ ...damage[0].layerC, collection: damage[0].collection }, 0)
  assert.equal('collection' in sanitized, false, '合集信息不入库')

  // ⑦ 规则表里有「合集扇出」组，且与「工具层」属性清单分开表述
  const table = buildRulesTable()
  const group = table.groups.find((item) => item.id === 'collection-fanout')
  assert.ok(group, '规则表要有合集扇出组')
  assert.match(group.title, /抽取层/)
  assert.ok(group.items.some((item) => /紊乱/.test(item.note ?? '')), '要写明不含紊乱')
  const statGroup = table.groups.find((item) => item.id === 'stat')
  assert.match(statGroup.title, /工具层/, '属性/字段清单那组要标「工具层」')
})
test('属性下拉（STAT_OPTIONS）与词表一致：子类增伤关键词既可查表、也可在「属性」下拉里选到', () => {
  const expected = {
    异放增伤: 'anomalyReleaseDmgBonus',
    乱流增伤: 'turbulenceDmgBonus',
    耀变增伤: 'radianceDmgBonus',
    紊乱增伤: 'disorderDmgBonus',
  }
  for (const [keyword, field] of Object.entries(expected)) {
    assert.ok(STAT_OPTIONS.includes(keyword), `「${keyword}」必须出现在属性下拉（STAT_OPTIONS）里`)
    const mapped = mapKeywordsToEffect({
      slots: { stat: keyword, action: '提升', value: 10, unit: '%', scope: '无' },
      id: `t-${keyword}`,
      origin: 'test',
    })
    assert.equal(mapped.ok, true, `「${keyword}」必须能查表（词表里要有对应字段）`)
    assert.equal(mapped.effect.stat, field)
    assert.deepEqual(mapped.effect.scope, ['general'], '专用字段 → scope 用默认')
  }
  // 词表可查 → 下拉可选：所有子类专用关键词都在下拉里（防"抽出来的词在下拉里不存在"）
  for (const keyword of Object.keys(expected)) {
    assert.ok(STAT_OPTIONS.includes(keyword), `${keyword} 下拉缺失`)
  }
})
test('旧 scope 兼容（词条库仍用）：数组口径归一 / 写库前迁移为 conditions', () => {
  // ① 单值兼容
  assert.deepEqual(normalizeBuffScopes('attributeAnomaly'), ['attributeAnomaly'])
  assert.deepEqual(normalizeBuffScopes(['anomalyRelease']), ['anomalyRelease'])
  // ② general 归一（含 general 时其余丢弃）+ 缺省/空/全非法
  assert.deepEqual(normalizeBuffScopes(['attributeAnomaly', 'general']), ['general'])
  assert.deepEqual(normalizeBuffScopes(['general', 'skill']), ['general'])
  assert.deepEqual(normalizeBuffScopes([]), ['general'])
  assert.deepEqual(normalizeBuffScopes(undefined), ['general'])
  assert.deepEqual(normalizeBuffScopes(['bogus']), ['general'])
  // ③ 去重 + 剔非法 + 按枚举顺序保序
  assert.deepEqual(normalizeBuffScopes(['radiance', 'attributeAnomaly', 'attributeAnomaly', 'bogus']), ['attributeAnomaly', 'radiance'])
  assert.deepEqual(
    normalizeBuffScopes(['mutation', 'skill', 'turbulence']),
    ['skill', 'turbulence', 'mutation'],
  )
  // ④ skill 与其它并存（招式锚点仍需 skillTargets）
  assert.deepEqual(normalizeBuffScopes(['skill', 'attributeAnomaly']), ['skill', 'attributeAnomaly'])
  // ⑤ 写库前归一（nanoka 写入路径 `sanitizeEffect` 落 conditions；不再写 scope）
  const sanitized = sanitizeEffect(
    { id: 'a', stat: 'dmgBonus', kind: 'fixed', value: 10, applyTarget: 'self', scope: 'attributeAnomaly' },
    0,
  )
  assert.equal('scope' in sanitized, false, '写库不再输出 scope')
  assert.deepEqual(sanitized.conditions, { damageTypes: ['attributeAnomaly'] })
  assert.equal(sanitized.groupId, undefined)
  // ⑥ 官方预设模板的条件字段也走数组口径
  const template = buildAffixEffectTemplate({
    target: 'gain:dmgBonus',
    perRoll: 3,
    scope: 'attributeAnomaly',
  })
  assert.deepEqual(template?.spec?.conditions?.scope, ['attributeAnomaly'])
})
