/**
 * 计算链路（Damage Chain）：纯校验层用例（Phase 4f）。
 *
 * 这里只测不触库的校验函数（`normalizeDamageChain` / `normalizeChainStages` /
 * `validateChain*`），因此不需要数据库，也不会写任何行。
 * 口径来源：本阶段后端契约（表 `calculator_damage_chains` 与
 * `dev-docs/zone-modularization-plan.md` 第十二节 12.2 阶段化模型）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_DAMAGE_CHAIN_KEYS,
  DAMAGE_CHAIN_SCOPES,
  DAMAGE_CHAIN_STAGE_KINDS,
  isCustomChainKey,
  isValidChainKey,
  normalizeChainAppliesTo,
  normalizeChainStages,
  normalizeDamageChain,
  validateChainKey,
  validateChainScope,
  validateChainStageKind,
} from '../src/services/calculatorChainService.js'

function stage(overrides = {}) {
  return {
    id: 'base',
    kind: 'source',
    module: 'panel.atk',
    label: '基础伤害',
    group: 'direct',
    order: 10,
    ...overrides,
  }
}

function chain(overrides = {}) {
  return {
    chainKey: 'custom:remielRadiance',
    label: '蕾米本人耀变链路',
    appliesTo: { damageKinds: ['direct'], subKinds: ['radiance'] },
    scope: 'agent',
    targetId: 'remiel',
    stages: [
      stage(),
      stage({
        id: 'dmg',
        kind: 'multiplier',
        module: 'percentSum',
        label: '增伤区',
        order: 20,
        inputs: ['base'],
        params: { cap: 3 },
        when: { agentId: 'remiel' },
      }),
      stage({ id: 'final', kind: 'final', module: 'product', label: '最终结算', order: 30, inputs: ['base', 'dmg'] }),
    ],
    ...overrides,
  }
}

test('chain_key 格式：内置键或 custom:<slug>，其余拒绝', () => {
  for (const key of ['direct', 'anomaly', 'radiance-self', 'anomaly:attributeAnomaly', 'custom:remielRadiance', 'custom:smoke-1']) {
    assert.equal(isValidChainKey(key), true, `${key} 应当合法`)
    assert.equal(validateChainKey(key), key)
  }
  for (const key of ['custom:', 'custom', ':bad', 'custom:带中文', 'direct chain', 'a'.repeat(65), '', null, 42]) {
    assert.equal(isValidChainKey(key), false, `${String(key)} 应当非法`)
    assert.throws(() => validateChainKey(key), /chain_key/)
  }
  assert.equal(isCustomChainKey('custom:remielRadiance'), true)
  assert.equal(isCustomChainKey('direct'), false)
  assert.equal(isCustomChainKey('anomaly:attributeAnomaly'), false)
  assert.deepEqual(
    [...BUILTIN_DAMAGE_CHAIN_KEYS],
    ['direct', 'sharpen', 'pierce', 'anomaly', 'attributeAnomaly', 'anomalyRelease', 'disorder', 'turbulence', 'radiance-self'],
  )
})

test('scope 枚举：五个作用域合法，大小写/未知值被拒', () => {
  assert.deepEqual([...DAMAGE_CHAIN_SCOPES], ['global', 'profession', 'agent', 'skill_group', 'skill'])
  for (const scope of DAMAGE_CHAIN_SCOPES) {
    assert.equal(validateChainScope(scope), scope)
  }
  assert.throws(() => validateChainScope('skillGroup'), /scope 非法/)
  assert.throws(() => validateChainScope('AGENT'), /scope 非法/)
  assert.throws(() => validateChainScope(''), /scope 不能为空/)
  assert.throws(() => validateChainScope(null), /scope 必须是字符串/)
})

test('kind 枚举：四类阶段，其余拒绝', () => {
  assert.deepEqual([...DAMAGE_CHAIN_STAGE_KINDS], ['source', 'multiplier', 'combine', 'final'])
  for (const kind of DAMAGE_CHAIN_STAGE_KINDS) {
    assert.equal(validateChainStageKind(kind), kind)
  }
  assert.throws(() => validateChainStageKind('modifier'), /kind 非法/)
  assert.throws(() => validateChainStageKind(''), /不能为空/)
})

test('stages：非空数组、id 必填唯一、未知字段/非法 kind 拒绝', () => {
  assert.throws(() => normalizeChainStages(null), /stages 必须是数组/)
  assert.throws(() => normalizeChainStages({ id: 'base' }), /stages 必须是数组/)
  assert.throws(() => normalizeChainStages([]), /stages 不能为空数组/)
  assert.throws(
    () => normalizeChainStages([{ kind: 'source', module: 'x' }]),
    /stages\[0\]\.id 必须是字符串/,
  )
  assert.throws(
    () => normalizeChainStages([stage({ id: '' })]),
    /stages\[0\]\.id 不能为空/,
  )
  assert.throws(
    () => normalizeChainStages([stage({ id: '1bad' })]),
    /stages\[0\]\.id 格式非法/,
  )
  assert.throws(
    () => normalizeChainStages([stage({ kind: 'modifier' })]),
    /kind 非法/,
  )
  assert.throws(
    () => normalizeChainStages([stage({ module: '' })]),
    /stages\[0\]\.module 不能为空/,
  )
  assert.throws(
    () => normalizeChainStages([stage(), stage()]),
    /阶段 id base 重复/,
  )
  assert.throws(
    () =>
      normalizeChainStages([
        stage({ id: 'a', kind: 'source' }),
        stage({ id: 'b', kind: 'final' }),
        stage({ id: 'c', kind: 'final' }),
      ]),
    /kind=final 的阶段最多一个/,
  )
  assert.throws(() => normalizeChainStages([stage({ display: { label: 'x' } })]), /未知字段 display/)
  assert.throws(() => normalizeChainStages([stage({ label: 1 })]), /label 必须是字符串/)
  assert.throws(() => normalizeChainStages([stage({ group: {} })]), /group 必须是字符串/)
  assert.throws(() => normalizeChainStages([stage({ order: 'first' })]), /order 必须是有限数字/)
  assert.throws(() => normalizeChainStages([stage({ inputs: 'base' })]), /inputs 必须是数组/)
  assert.throws(() => normalizeChainStages([stage({ params: [] })]), /params 必须是对象/)
  assert.throws(() => normalizeChainStages([stage({ enabled: 'maybe' })]), /enabled 必须是布尔值/)
})

test('stages：缺省值归一化，order 缺省按序递增', () => {
  const stages = normalizeChainStages([
    { id: 'base', kind: 'source', module: 'panel.atk' },
    { id: 'final', kind: 'final', module: 'product' },
  ])
  assert.deepEqual(stages, [
    {
      id: 'base',
      kind: 'source',
      module: 'panel.atk',
      label: '',
      group: '',
      order: 0,
      inputs: [],
      params: {},
      when: {},
      enabled: true,
    },
    {
      id: 'final',
      kind: 'final',
      module: 'product',
      label: '',
      group: '',
      order: 10,
      inputs: [],
      params: {},
      when: {},
      enabled: true,
    },
  ])
})

test('applies_to：damageKinds 必填且非空，subKinds 可选，未知字段拒绝', () => {
  assert.deepEqual(normalizeChainAppliesTo({ damageKinds: ['direct'] }), { damageKinds: ['direct'] })
  assert.deepEqual(
    normalizeChainAppliesTo({ damageKinds: ['attributeAnomaly'], subKinds: ['disorder'] }),
    { damageKinds: ['attributeAnomaly'], subKinds: ['disorder'] },
  )
  // 旧式数组等价于只给 damageKinds
  assert.deepEqual(normalizeChainAppliesTo(['direct', 'direct']), { damageKinds: ['direct'] })

  assert.throws(() => normalizeChainAppliesTo(null), /damageKinds 必须是非空数组/)
  assert.throws(() => normalizeChainAppliesTo({}), /damageKinds 必须是非空数组/)
  assert.throws(() => normalizeChainAppliesTo({ damageKinds: [] }), /damageKinds 必须是非空数组/)
  assert.throws(() => normalizeChainAppliesTo({ damageKinds: 'direct' }), /damageKinds 必须是数组/)
  assert.throws(() => normalizeChainAppliesTo({ damageKinds: [1] }), /每一项必须是非空字符串/)
  assert.throws(
    () => normalizeChainAppliesTo({ damageKinds: ['direct'], skin: 'x' }),
    /applies_to 含未知字段 skin/,
  )
})

test('when：复用乘区条件白名单，空对象视为无条件', () => {
  assert.deepEqual(
    normalizeChainStages([stage({ when: {} })])[0].when,
    {},
  )
  assert.deepEqual(
    normalizeChainStages([stage({ when: { agentId: 'remiel' } })])[0].when,
    { agentId: 'remiel' },
  )
  assert.deepEqual(
    normalizeChainStages([
      stage({ when: { and: [{ agentId: 'remiel' }, { mindscapeRank: { op: '>=', value: 4 } }] } }),
    ])[0].when,
    { and: [{ agentId: 'remiel' }, { mindscapeRank: { op: '>=', value: 4 } }] },
  )
  assert.throws(
    () => normalizeChainStages([stage({ when: { buffId: 'x' } })]),
    /未允许的条件变量 buffId/,
  )
  assert.throws(
    () => normalizeChainStages([stage({ when: { agentId: { op: 'like', value: 'x' } } })]),
    /\.op 非法/,
  )
  assert.throws(
    () => normalizeChainStages([stage({ when: { agentId: 'remiel', skillId: 'x' } })]),
    /必须只有一个键/,
  )
  assert.throws(
    () => normalizeChainStages([stage({ when: 'agentId=remiel' })]),
    /when 必须是对象/,
  )
})

test('链路：合法样例通过并补默认值', () => {
  const doc = normalizeDamageChain(chain())
  assert.equal(doc.chainKey, 'custom:remielRadiance')
  assert.equal(doc.scope, 'agent')
  assert.equal(doc.targetId, 'remiel')
  assert.equal(doc.priority, 0)
  assert.equal(doc.enabled, true)
  assert.equal(doc.version, null, 'version 缺省交给服务端递增')
  assert.equal(doc.id, null)
  assert.equal(doc.updatedBy, null)
  assert.deepEqual(doc.appliesTo, { damageKinds: ['direct'], subKinds: ['radiance'] })
  assert.equal(doc.stages.length, 3)
  assert.equal(doc.stages[1].when.agentId, 'remiel')
  assert.deepEqual(doc.stages[2].inputs, ['base', 'dmg'])

  const globalChain = normalizeDamageChain(
    chain({ chainKey: 'direct', scope: 'global', targetId: undefined, appliesTo: { damageKinds: ['direct'] } }),
  )
  assert.equal(globalChain.targetId, '')
  assert.equal(globalChain.label, '蕾米本人耀变链路')

  // PUT /damage-chains/:id 会把路径参数（字符串）合并进 body
  assert.equal(normalizeDamageChain(chain({ id: '7' })).id, 7)
  assert.equal(normalizeDamageChain(chain({ updatedBy: 'ops' })).updatedBy, 'ops')
  assert.equal(normalizeDamageChain(chain({ enabled: 0 })).enabled, false)
  assert.equal(normalizeDamageChain(chain({ priority: '5' })).priority, 5)
})

test('链路：target_id 与 scope 绑定、范围与类型校验', () => {
  assert.throws(
    () => normalizeDamageChain(chain({ scope: 'global' })),
    /scope=global 时 target_id 必须为空/,
  )
  assert.throws(
    () => normalizeDamageChain(chain({ targetId: '' })),
    /scope=agent 时必须提供 target_id/,
  )
  assert.throws(() => normalizeDamageChain(chain({ chainKey: 'custom:' })), /chain_key 格式非法/)
  assert.throws(() => normalizeDamageChain(chain({ chainKey: 'direct chain' })), /chain_key 格式非法/)
  assert.throws(() => normalizeDamageChain(chain({ scope: 'skillGroup' })), /scope 非法/)
  assert.throws(() => normalizeDamageChain(chain({ stages: [] })), /stages 不能为空数组/)
  assert.throws(() => normalizeDamageChain(chain({ appliesTo: { damageKinds: [] } })), /damageKinds/)
  assert.throws(() => normalizeDamageChain(chain({ priority: -1 })), /priority 不能小于 0/)
  assert.throws(() => normalizeDamageChain(chain({ priority: 1001 })), /priority 不能大于 1000/)
  assert.throws(() => normalizeDamageChain(chain({ version: 0 })), /version 不能小于 1/)
  assert.throws(() => normalizeDamageChain(chain({ id: 'abc' })), /id 必须是整数/)
  assert.throws(() => normalizeDamageChain(chain({ label: 42 })), /label 必须是字符串/)
  assert.throws(() => normalizeDamageChain(chain({ enabled: 'on' })), /enabled 必须是布尔值/)
  assert.throws(() => normalizeDamageChain(chain({ targetId: 'a'.repeat(65) })), /target_id 长度不能超过 64/)
  assert.throws(() => normalizeDamageChain(null), /计算链路必须是对象/)
  assert.throws(() => normalizeDamageChain([]), /计算链路必须是对象/)
})
