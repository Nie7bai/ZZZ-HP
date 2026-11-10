/**
 * 乘区定义 / 方案：纯校验层用例（Phase 4a）。
 *
 * 这里只测不触库的校验函数（`normalizeZone*` / `validateZone*`），
 * 因此不需要数据库，也不会写任何行。口径来源：
 * `dev-docs/zone-modularization-plan.md` 第四节（数据模型）、第九节 C（条件白名单）、
 * 第十节（新乘区/增益键规格）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ZONE_CONDITION_OPERATORS,
  ZONE_CONDITION_VARIABLES,
  ZONE_PRIMITIVES,
  ZONE_SCOPES,
  isCustomZoneKey,
  isValidZoneKey,
  normalizeZoneCondition,
  normalizeZoneDefinition,
  normalizeZoneParams,
  normalizeZoneRules,
  normalizeZoneScheme,
  normalizeZoneStats,
  validateZonePrimitive,
  validateZoneKey,
  validateZoneScope,
} from '../src/services/calculatorZoneService.js'

function definition(overrides = {}) {
  return {
    zoneKey: 'custom:eliteBonus',
    label: '对精英增伤区',
    primitive: 'percentSum',
    params: { cap: null, floor: null, allowNegative: true },
    ...overrides,
  }
}

function scheme(overrides = {}) {
  return {
    scope: 'agent',
    targetId: 'yeshunguang',
    name: '叶瞬光乘区',
    rules: [{ key: 'stagger', action: 'replace', params: { mode: 'curtain' } }],
    ...overrides,
  }
}

test('scope 枚举：五个作用域合法，大小写/未知值被拒', () => {
  assert.deepEqual([...ZONE_SCOPES], ['global', 'profession', 'agent', 'skill_group', 'skill'])
  for (const scope of ZONE_SCOPES) {
    assert.equal(validateZoneScope(scope), scope)
  }
  assert.throws(() => validateZoneScope('skillGroup'), /scope 非法/)
  assert.throws(() => validateZoneScope('AGENT'), /scope 非法/)
  assert.throws(() => validateZoneScope(''), /scope 不能为空/)
  assert.throws(() => validateZoneScope(null), /scope 必须是字符串/)
})

test('zone_key 格式：内置键或 custom:<slug>，其余拒绝', () => {
  for (const key of ['dmgMultiplier', 'stagger', 'panel.percent', 'custom:eliteBonus', 'custom:smoke-1']) {
    assert.equal(isValidZoneKey(key), true, `${key} 应当合法`)
    assert.equal(validateZoneKey(key), key)
  }
  for (const key of [
    'custom:',
    'custom',
    ':bad',
    'custom:带中文',
    'dmg multiplier',
    'a'.repeat(65),
    '',
    null,
    42,
  ]) {
    assert.equal(isValidZoneKey(key), false, `${String(key)} 应当非法`)
    assert.throws(() => validateZoneKey(key), /zone_key/)
  }
  // 只有 custom: 前缀算自定义键；内置键不受注册表存在性约束
  assert.equal(isCustomZoneKey('custom:eliteBonus'), true)
  assert.equal(isCustomZoneKey('dmgMultiplier'), false)
})

test('primitive 白名单：占位四项，其余拒绝', () => {
  assert.deepEqual([...ZONE_PRIMITIVES], ['percentSum', 'panel.percent', 'stagger', 'vulnerable'])
  for (const primitive of ZONE_PRIMITIVES) {
    assert.equal(validateZonePrimitive(primitive), primitive)
  }
  assert.throws(() => validateZonePrimitive('sumPercent'), /primitive 不在白名单/)
  assert.throws(() => validateZonePrimitive(''), /primitive 不能为空/)
})

test('params：必须是对象；cap 必须 > 0；已知字段类型被校验', () => {
  assert.deepEqual(normalizeZoneParams(null), {})
  assert.deepEqual(normalizeZoneParams({ mode: 'curtain', cap: { rank4: 3, default: 2.1 } }), {
    mode: 'curtain',
    cap: { rank4: 3, default: 2.1 },
  })
  // 不修改调用方对象
  const input = { allowNegative: 1, buffKeys: ['a', 'a', 'b'] }
  assert.deepEqual(normalizeZoneParams(input), { allowNegative: true, buffKeys: ['a', 'b'] })
  assert.equal(input.allowNegative, 1)

  assert.throws(() => normalizeZoneParams([]), /params 必须是对象/)
  assert.throws(() => normalizeZoneParams('cap=1'), /params 必须是对象/)
  assert.throws(() => normalizeZoneParams({ cap: 0 }), /params.cap 必须大于 0/)
  assert.throws(() => normalizeZoneParams({ cap: { rank4: 0 } }), /params.cap.rank4 必须大于 0/)
  assert.throws(() => normalizeZoneParams({ cap: { rank4: '3' } }), /params.cap.rank4 必须是有限数字/)
  assert.throws(() => normalizeZoneParams({ cap: Number.NaN }), /params.cap 含非法数字/)
  assert.throws(() => normalizeZoneParams({ allowNegative: 'yes' }), /params.allowNegative 必须是布尔值/)
  assert.throws(() => normalizeZoneParams({ buffKeys: 'a' }), /params.buffKeys 必须是数组/)
  assert.throws(() => normalizeZoneParams({ mode: 3 }), /params.mode 必须是字符串/)
  assert.throws(() => normalizeZoneParams({ fn: () => 1 }), /含不支持的值类型/)
})

test('applies_to：兼容旧式数组，providers 默认 team，未知字段拒绝', () => {
  const legacy = normalizeZoneDefinition(definition({ appliesTo: ['direct', 'attributeAnomaly'] }))
  assert.deepEqual(legacy.appliesTo, {
    damageKinds: ['direct', 'attributeAnomaly'],
    agents: [],
    skills: [],
  })
  assert.equal(legacy.providers, 'team')

  const full = normalizeZoneDefinition(
    definition({
      appliesTo: {
        damageKinds: ['direct'],
        agents: ['yeshunguang', 'remiel'],
        skills: ['sk-yeshunguang-nk-1431009-main'],
        providers: 'owner',
      },
    }),
  )
  assert.equal(full.providers, 'owner')
  assert.deepEqual(full.appliesTo.agents, ['yeshunguang', 'remiel'])
  assert.equal(full.appliesTo.providers, undefined, 'providers 不再混在 applies_to 里')

  // 顶层 providers 优先于 applies_to.providers
  const topLevel = normalizeZoneDefinition(
    definition({ appliesTo: { providers: 'owner' }, providers: 'all' }),
  )
  assert.equal(topLevel.providers, 'all')

  assert.throws(
    () => normalizeZoneDefinition(definition({ appliesTo: { serverFilters: ['x'] } })),
    /applies_to 含未知字段 serverFilters/,
  )
  assert.throws(
    () => normalizeZoneDefinition(definition({ providers: 'solo' })),
    /providers 非法/,
  )
  assert.throws(
    () => normalizeZoneDefinition(definition({ appliesTo: { agents: 'remiel' } })),
    /applies_to.agents 必须是数组/,
  )
})

test('条件：白名单变量与运算，组合写法与错误写法', () => {
  // 方案文档示例
  assert.deepEqual(
    normalizeZoneCondition({ and: [{ agentId: 'remiel' }, { anomalyPowerAgentId: 'remiel' }] }),
    { and: [{ agentId: 'remiel' }, { anomalyPowerAgentId: 'remiel' }] },
  )
  assert.deepEqual(normalizeZoneCondition({ mindscapeRank: { op: '>=', value: 4 } }), {
    mindscapeRank: { op: '>=', value: 4 },
  })
  assert.deepEqual(normalizeZoneCondition({ skillTypes: { op: 'in', value: ['basic', 'dodge'] } }), {
    skillTypes: { op: 'in', value: ['basic', 'dodge'] },
  })
  assert.deepEqual(normalizeZoneCondition({ not: { isFollowUp: true } }), {
    not: { isFollowUp: true },
  })

  // 白名单本身
  assert.ok(ZONE_CONDITION_VARIABLES.includes('agentId'))
  assert.ok(ZONE_CONDITION_VARIABLES.includes('staggerPhase'))
  assert.deepEqual([...ZONE_CONDITION_OPERATORS], ['==', '!=', 'in', '>=', '<=', 'and', 'or', 'not'])

  assert.throws(() => normalizeZoneCondition({ buffId: 'x' }), /未允许的条件变量 buffId/)
  assert.throws(() => normalizeZoneCondition({ agentId: { op: 'like', value: 'x' } }), /\.op 非法/)
  assert.throws(() => normalizeZoneCondition({ skillTypes: { op: 'in', value: 'basic' } }), /op=in 时必须是非空数组/)
  assert.throws(() => normalizeZoneCondition({ mindscapeRank: { op: '>=', value: '4' } }), /必须是数字/)
  assert.throws(() => normalizeZoneCondition({ agentId: 'remiel', skillId: 'x' }), /必须只有一个键/)
  assert.throws(() => normalizeZoneCondition({ and: [] }), /必须是非空条件数组/)
  assert.throws(() => normalizeZoneCondition({ not: 'x' }), /必须是对象/)
  assert.throws(() => normalizeZoneCondition({ agentId: { op: '==', value: ['a'] } }), /不能是数组/)
  assert.throws(() => normalizeZoneCondition({ agentId: '' }), /不能为空字符串/)
  // 嵌套过深：7 层 and
  let deep = { agentId: 'remiel' }
  for (let i = 0; i < 7; i += 1) deep = { and: [deep] }
  assert.throws(() => normalizeZoneCondition(deep), /嵌套层级过深/)
})

test('rules：必须是数组、key 合法、不重复，覆盖只允许 replace', () => {
  assert.deepEqual(normalizeZoneRules([]), [])
  assert.deepEqual(
    normalizeZoneRules([
      { key: 'stagger', action: 'replace', module: 'stagger', params: { mode: 'curtain' }, order: 60 },
      { key: 'custom:eliteBonus', when: { damageKind: 'direct' } },
    ]),
    [
      {
        key: 'stagger',
        action: 'replace',
        module: 'stagger',
        params: { mode: 'curtain' },
        order: 60,
      },
      {
        key: 'custom:eliteBonus',
        action: 'inherit',
        when: { damageKind: 'direct' },
      },
    ],
  )

  assert.throws(() => normalizeZoneRules(null), /rules 必须是数组/)
  assert.throws(() => normalizeZoneRules({ key: 'stagger' }), /rules 必须是数组/)
  assert.throws(() => normalizeZoneRules([{ action: 'inherit' }]), /rules\[0\]\.key/)
  assert.throws(
    () => normalizeZoneRules([{ key: 'stagger', module: 'stagger', params: { mode: 'curtain' } }]),
    /action=inherit 时不能带 module\/params\/display/,
  )
  assert.throws(
    () => normalizeZoneRules([{ key: 'stagger', action: 'disable', params: {} }]),
    /action=disable 时不能带/,
  )
  assert.throws(
    () => normalizeZoneRules([{ key: 'stagger', action: 'replace', module: 'notAPrimitive' }]),
    /primitive 不在白名单/,
  )
  assert.throws(
    () =>
      normalizeZoneRules([
        { key: 'stagger', action: 'replace', module: 'stagger', primitive: 'vulnerable' },
      ]),
    /module 与 primitive 不一致/,
  )
  assert.throws(
    () => normalizeZoneRules([{ key: 'stagger' }, { key: 'stagger' }]),
    /rules 中乘区 stagger 重复/,
  )
  assert.throws(() => normalizeZoneRules([{ key: 'stagger', wat: 1 }]), /未知字段 wat/)
  assert.throws(() => normalizeZoneRules([{ key: 'stagger', action: 'disable', enabled: 'nope' }]), /enabled 必须是布尔值/)
})

test('乘区定义：默认值、stats 规格与版本语义', () => {
  const doc = normalizeZoneDefinition(definition())
  assert.equal(doc.zoneKey, 'custom:eliteBonus')
  assert.equal(doc.sortOrder, 100)
  assert.equal(doc.enabled, true)
  assert.equal(doc.version, null, 'version 缺省交给服务端递增')
  assert.equal(doc.stats, null)
  assert.equal(doc.display, null)
  assert.equal(doc.primitive, 'percentSum')

  const withStats = normalizeZoneDefinition(
    definition({
      sortOrder: 130,
      enabled: 0,
      version: 3,
      stats: [
        { key: 'eliteDmgBonus', label: '对精英增伤', valueType: 'percent', sign: 'both' },
        {
          key: 'eliteDmgBonusFactor',
          label: '对精英增伤倍率',
          valueType: 'multiplier',
          supportsFactor: 1,
        },
      ],
      display: { panel: 'both', showCap: true },
    }),
  )
  assert.equal(withStats.sortOrder, 130)
  assert.equal(withStats.enabled, false)
  assert.equal(withStats.version, 3)
  assert.equal(withStats.stats[1].sign, 'both', 'sign 缺省 both')
  assert.equal(withStats.stats[1].supportsFactor, true)
  assert.deepEqual(withStats.display, { panel: 'both', showCap: true })

  assert.throws(() => normalizeZoneDefinition({ label: 'x', primitive: 'percentSum' }), /zone_key/)
  assert.throws(() => normalizeZoneDefinition(definition({ label: '' })), /label 不能为空/)
  assert.throws(() => normalizeZoneDefinition(definition({ primitive: 'bogus' })), /primitive 不在白名单/)
  assert.throws(() => normalizeZoneDefinition(definition({ params: [] })), /params 必须是对象/)
  assert.throws(() => normalizeZoneDefinition(definition({ sortOrder: -1 })), /sort_order 不能小于 0/)
  assert.throws(() => normalizeZoneDefinition(definition({ version: 0 })), /version 不能小于 1/)
  assert.throws(() => normalizeZoneDefinition(definition({ enabled: 'maybe' })), /enabled 必须是布尔值/)
  assert.throws(() => normalizeZoneDefinition(definition({ display: { panel: 'everywhere' } })), /display.panel 非法/)
  assert.throws(
    () => normalizeZoneDefinition(definition({ stats: [{ key: 'x', label: 'x', valueType: 'ratio' }] })),
    /valueType 非法/,
  )
  assert.throws(
    () =>
      normalizeZoneDefinition(
        definition({
          stats: [
            { key: 'x', label: 'x', valueType: 'percent' },
            { key: 'x', label: 'x2', valueType: 'percent' },
          ],
        }),
      ),
    /stats 中增益键 x 重复/,
  )
  assert.equal(normalizeZoneStats([]).length, 0)
})

test('乘区方案：scope 与 target_id 绑定、priority/version 范围、rules 校验', () => {
  const doc = normalizeZoneScheme(scheme())
  assert.equal(doc.scope, 'agent')
  assert.equal(doc.targetId, 'yeshunguang')
  assert.equal(doc.priority, 10)
  assert.equal(doc.enabled, true)
  assert.equal(doc.version, null)
  assert.equal(doc.id, null)
  assert.equal(doc.updatedBy, null)
  assert.deepEqual(doc.rules, [
    { key: 'stagger', action: 'replace', params: { mode: 'curtain' } },
  ])

  assert.equal(normalizeZoneScheme({ scope: 'global', name: '全局', rules: [] }).targetId, '')
  assert.throws(
    () => normalizeZoneScheme({ scope: 'global', targetId: 'yeshunguang', name: '全局', rules: [] }),
    /scope=global 时 target_id 必须为空/,
  )
  assert.throws(
    () => normalizeZoneScheme({ scope: 'agent', name: '缺角色', rules: [] }),
    /scope=agent 时必须提供 target_id/,
  )
  assert.throws(() => normalizeZoneScheme(scheme({ name: '' })), /name 不能为空/)
  assert.throws(() => normalizeZoneScheme(scheme({ priority: -1 })), /priority 不能小于 0/)
  assert.throws(() => normalizeZoneScheme(scheme({ priority: 1001 })), /priority 不能大于 1000/)
  assert.throws(() => normalizeZoneScheme(scheme({ version: 0 })), /version 不能小于 1/)
  assert.throws(() => normalizeZoneScheme(scheme({ rules: undefined })), /rules 必须是数组/)
  assert.throws(() => normalizeZoneScheme(scheme({ enabled: 'on' })), /enabled 必须是布尔值/)
  assert.throws(() => normalizeZoneScheme(scheme({ id: 'abc' })), /id 必须是整数/)

  // PUT /zone-schemes/:id 会把路径参数（字符串）合并进 body
  assert.equal(normalizeZoneScheme(scheme({ id: '12' })).id, 12)
  // updated_by 可选
  assert.equal(normalizeZoneScheme(scheme({ updatedBy: 'ops' })).updatedBy, 'ops')
})
