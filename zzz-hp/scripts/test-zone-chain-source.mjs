/**
 * 运行时计算链路：格式适配 + 合并解析 + 禁用/排序/条件（Phase 4f）。
 *
 * 运行：npx vite-node scripts/test-zone-chain-source.mjs
 */
import assert from 'node:assert/strict'

import { adaptDamageChain, adaptDamageChains } from '../src/zones/chainAdapter.ts'
import {
  BUILT_IN_DAMAGE_CHAINS,
  buildStageTrace,
  getDamageChain,
  resolveDamageChain,
} from '../src/zones/pipeline.ts'
import {
  getDamageChainLabel,
  getMergedDamageChains,
  resolveCurrentDamageChain,
  setRuntimeDamageChains,
} from '../src/zones/chainSource.ts'
import { clearHitEvalCache } from '../src/utils/hitEvalCache.ts'
import { buildGoldenCases } from './_zoneGoldenCases.mjs'

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

function stageIds(chain) {
  return chain.stages.map((stage) => stage.id)
}

const agentContext = {
  agentId: 'remiel',
  profession: '异常',
  skillGroupId: 'sg-remiel',
  skillId: 'sk-remiel-radiance',
}

console.log('[1] 后端格式适配')

check('链路字段归一：chainKey / appliesTo / scope skill_group → skillGroup / priority', () => {
  const chain = adaptDamageChain({
    id: 7,
    chainKey: 'direct',
    label: '直伤覆盖',
    appliesTo: { damageKinds: ['direct', 'sharpen'] },
    scope: 'skill_group',
    targetId: 'sg-1',
    priority: 30,
    version: 4,
    enabled: false,
    stages: [],
  })
  assert.ok(chain)
  assert.equal(chain.id, 'direct')
  assert.equal(chain.label, '直伤覆盖')
  assert.deepEqual(chain.appliesTo.damageKinds, ['direct', 'sharpen'])
  assert.equal(chain.scope, 'skillGroup')
  assert.equal(chain.targetId, 'sg-1')
  assert.equal(chain.priority, 30)
  assert.equal(chain.version, 4)
  assert.equal(chain.enabled, false)
})

check('scope=global 清空 targetId；缺 chainKey 返回 null', () => {
  const chain = adaptDamageChain({ chainKey: 'anomaly', scope: 'global', targetId: 'x', stages: [] })
  assert.equal(chain?.targetId, '')
  assert.equal(adaptDamageChain({ label: '无键', stages: [] }), null)
  assert.deepEqual(adaptDamageChains(null), [])
})

check('阶段字段：module/order/inputs/params/when/enabled/action；缺 id 丢弃、非法 kind 回落 multiplier', () => {
  const chain = adaptDamageChain({
    chainKey: 'direct',
    stages: [
      { id: 'dmg', kind: 'unknown', module: 'percentSum', label: '增伤', order: 25, params: { cap: 2 }, enabled: false },
      { id: 'crit', kind: 'multiplier', action: 'inherit', when: { agentId: 'remiel' } },
      { id: 'final', kind: 'final', inputs: ['dmg', 'crit'] },
      { kind: 'source' },
    ],
  })
  assert.ok(chain)
  assert.deepEqual(chain.stages.map((stage) => stage.id), ['dmg', 'crit', 'final'])
  const [dmg, crit, final] = chain.stages
  assert.equal(dmg.kind, 'multiplier')
  assert.equal(dmg.module, 'percentSum')
  assert.equal(dmg.order, 25)
  assert.deepEqual(dmg.params, { cap: 2 })
  assert.equal(dmg.enabled, false)
  assert.equal(crit.action, 'inherit')
  assert.deepEqual(crit.when, { var: 'agentId', op: 'eq', value: 'remiel' })
  assert.deepEqual(final.inputs, ['dmg', 'crit'])
})

check('条件写法：and / 比较 / not 复用乘区方案适配', () => {
  const chain = adaptDamageChain({
    chainKey: 'anomaly',
    stages: [{
      id: 'crit',
      when: {
        and: [
          { damageKind: 'radiance' },
          { mindscapeRank: { op: '>=', value: 4 } },
          { not: { skillName: '普通攻击' } },
        ],
      },
    }],
  })
  const when = chain?.stages[0].when
  assert.deepEqual(when.and[0], { var: 'damageKind', op: 'eq', value: 'radiance' })
  assert.deepEqual(when.and[1], { var: 'mindscapeRank', op: 'gte', value: 4 })
  assert.deepEqual(when.and[2], { not: { var: 'skillName', op: 'eq', value: '普通攻击' } })
})

console.log('[2] 合并解析')

check('无运行时覆盖：返回内置阶段原样', () => {
  const resolved = resolveDamageChain('direct', { damageKind: 'direct' }, BUILT_IN_DAMAGE_CHAINS)
  assert.deepEqual(stageIds(resolved), stageIds(getDamageChain('direct')))
  assert.deepEqual(resolved.sources, [])
  assert.equal(resolved.label, '直伤链路')
})

check('global 覆盖：字段替换 + 按 order 重排', () => {
  const override = adaptDamageChain({
    chainKey: 'direct',
    scope: 'global',
    priority: 5,
    stages: [
      { id: 'dmg', label: '增伤（配置）', module: 'percentSum', order: 25 },
      { id: 'final', order: 5 },
    ],
  })
  const resolved = resolveDamageChain('direct', { damageKind: 'direct' }, [getDamageChain('direct'), override])
  assert.equal(resolved.stages[0].id, 'final')
  const dmg = resolved.stages.find((stage) => stage.id === 'dmg')
  assert.equal(dmg.label, '增伤（配置）')
  assert.equal(dmg.order, 25)
  assert.deepEqual(resolved.sources, [{ scope: 'global', targetId: '', priority: 5 }])
})

check('disable / enabled=false 移除阶段；inherit 保留内置', () => {
  const override = adaptDamageChain({
    chainKey: 'direct',
    stages: [
      { id: 'vulnerable', enabled: false },
      { id: 'stagger', action: 'disable' },
      { id: 'crit', action: 'inherit', label: '不该生效' },
      { id: 'pierce', module: 'pierceBonus', label: '贯穿（配置）' },
    ],
  })
  const resolved = resolveDamageChain('direct', {}, [getDamageChain('direct'), override])
  const ids = stageIds(resolved)
  assert.ok(!ids.includes('vulnerable'))
  assert.ok(!ids.includes('stagger'))
  const crit = resolved.stages.find((stage) => stage.id === 'crit')
  assert.equal(crit.label, '暴击区')
  assert.equal(crit.enabled, undefined)
  assert.equal(resolved.stages.find((stage) => stage.id === 'pierce').label, '贯穿（配置）')
})

check('新增阶段：不在内置里的 id 按 order 插入', () => {
  const override = adaptDamageChain({
    chainKey: 'direct',
    stages: [{ id: 'eliteBonus', kind: 'multiplier', label: '对精英增伤区', order: 55, module: 'percentSum' }],
  })
  const resolved = resolveDamageChain('direct', {}, [getDamageChain('direct'), override])
  const ids = stageIds(resolved)
  assert.equal(ids.indexOf('eliteBonus'), ids.indexOf('vulnerable') + 1)
  assert.equal(ids.indexOf('crit'), ids.indexOf('eliteBonus') + 1)
  assert.equal(resolved.stages.find((stage) => stage.id === 'eliteBonus').group, 'direct')
})

check('作用域：角色覆盖只对匹配角色生效，global 始终生效', () => {
  const glob = adaptDamageChain({
    chainKey: 'direct',
    label: '全局改名',
    scope: 'global',
    priority: 1,
    stages: [{ id: 'dmg', label: '全局增伤' }],
  })
  const agent = adaptDamageChain({
    chainKey: 'direct',
    label: '蕾米直伤',
    scope: 'agent',
    targetId: 'remiel',
    priority: 10,
    stages: [{ id: 'dmg', label: '蕾米增伤' }],
  })
  const chains = [getDamageChain('direct'), glob, agent]
  const matched = resolveDamageChain('direct', { agentId: 'remiel' }, chains)
  assert.equal(matched.label, '蕾米直伤')
  assert.equal(matched.stages.find((stage) => stage.id === 'dmg').label, '蕾米增伤')
  assert.deepEqual(matched.sources, [
    { scope: 'global', targetId: '', priority: 1 },
    { scope: 'agent', targetId: 'remiel', priority: 10 },
  ])
  const other = resolveDamageChain('direct', { agentId: 'yixuan' }, chains)
  assert.equal(other.label, '全局改名')
  assert.equal(other.stages.find((stage) => stage.id === 'dmg').label, '全局增伤')
})

check('priority：同作用域大的后应用；enabled=false 的运行时链路整条跳过', () => {
  const low = adaptDamageChain({
    chainKey: 'anomaly',
    scope: 'profession',
    targetId: '异常',
    priority: 1,
    stages: [{ id: 'dmg', label: 'P1' }],
  })
  const high = adaptDamageChain({
    chainKey: 'anomaly',
    scope: 'profession',
    targetId: '异常',
    priority: 20,
    stages: [{ id: 'dmg', label: 'P20' }],
  })
  const disabled = adaptDamageChain({
    chainKey: 'anomaly',
    scope: 'skill',
    targetId: 'sk-1',
    priority: 99,
    enabled: false,
    stages: [{ id: 'dmg', label: '不该生效' }],
  })
  const chains = [getDamageChain('anomaly'), low, high, disabled]
  const resolved = resolveDamageChain('anomaly', { profession: '异常', skillId: 'sk-1' }, chains)
  assert.equal(resolved.stages.find((stage) => stage.id === 'dmg').label, 'P20')
  assert.equal(resolved.sources.length, 2)
})

check('appliesTo.damageKinds 不匹配时跳过覆盖', () => {
  const override = adaptDamageChain({
    chainKey: 'direct',
    scope: 'global',
    appliesTo: { damageKinds: ['sharpen'] },
    stages: [{ id: 'dmg', label: '仅锐化' }],
  })
  const chains = [getDamageChain('direct'), override]
  assert.equal(
    resolveDamageChain('direct', { damageKind: 'direct' }, chains).stages.find((s) => s.id === 'dmg').label,
    '增伤区',
  )
  assert.equal(
    resolveDamageChain('direct', { damageKind: 'sharpen' }, chains).stages.find((s) => s.id === 'dmg').label,
    '仅锐化',
  )
})

check('条件不成立的阶段被剔除', () => {
  const override = adaptDamageChain({
    chainKey: 'direct',
    stages: [
      { id: 'pierce', label: '贯穿（仅锐化）', when: { damageKind: 'sharpen' } },
      { id: 'crit', enabled: true },
    ],
  })
  const chains = [getDamageChain('direct'), override]
  const resolved = resolveDamageChain('direct', {
    damageKind: 'direct',
    matchesCondition: (when) => !when || when.value !== 'sharpen',
  }, chains)
  assert.ok(!stageIds(resolved).includes('pierce'))
  assert.ok(stageIds(resolved).includes('crit'))
})

console.log('[3] 运行时链路源')

check('getMergedDamageChains：内置在前、运行时候在后', () => {
  const runtime = adaptDamageChains({
    version: 1,
    chains: [{
      chainKey: 'direct',
      scope: 'agent',
      targetId: 'remiel',
      priority: 10,
      stages: [{ id: 'dmg', label: '蕾米增伤' }],
    }],
  })
  setRuntimeDamageChains(runtime)
  const merged = getMergedDamageChains()
  assert.equal(merged.length, BUILT_IN_DAMAGE_CHAINS.length + 1)
  assert.equal(merged[0].id, BUILT_IN_DAMAGE_CHAINS[0].id)
  assert.equal(merged.at(-1).id, 'direct')
})

check('resolveCurrentDamageChain：按伤害类型选链路并应用运行时覆盖', () => {
  const direct = resolveCurrentDamageChain({ damageKind: 'direct', context: agentContext })
  assert.equal(direct.chainId, 'direct')
  assert.equal(direct.stages.find((stage) => stage.id === 'dmg').label, '蕾米增伤')

  const other = resolveCurrentDamageChain({ damageKind: 'direct', context: { agentId: 'yixuan' } })
  assert.equal(other.stages.find((stage) => stage.id === 'dmg').label, '增伤区')

  assert.equal(resolveCurrentDamageChain({ damageKind: 'attributeAnomaly' }).chainId, 'anomaly')
  assert.equal(
    resolveCurrentDamageChain({ damageKind: 'radiance', isSelfRadiance: true }).chainId,
    'radiance-self',
  )
})

check('getDamageChainLabel：运行时标签优先，未知链路回落 null', () => {
  assert.equal(getDamageChainLabel('direct'), '直伤链路')
  assert.equal(getDamageChainLabel('unknown-chain'), null)
  setRuntimeDamageChains(adaptDamageChains({
    version: 1,
    chains: [{ chainKey: 'direct', label: '直伤（运行时）', stages: [] }],
  }))
  assert.equal(getDamageChainLabel('direct'), '直伤（运行时）')
})

check('buildStageTrace：使用传入阶段（缺值/禁用自然跳过）', () => {
  const resolved = resolveDamageChain('direct', {}, [
    getDamageChain('direct'),
    adaptDamageChain({
      chainKey: 'direct',
      stages: [
        { id: 'vulnerable', enabled: false },
        { id: 'eliteBonus', label: '对精英增伤区', order: 55 },
      ],
    }),
  ])
  const trace = buildStageTrace('direct', {
    base: 1000,
    dmg: 1.2,
    eliteBonus: 1.3,
    vulnerable: 1.4,
    final: 1560,
  }, resolved.stages)
  assert.deepEqual(trace.stages.map((stage) => stage.id), [
    'base', 'dmg', 'eliteBonus', 'final',
  ])
  assert.equal(trace.stages.find((stage) => stage.id === 'eliteBonus').value, 1.3)
})

check('resolveDamageChain 默认合并已注册的运行时链路（无需显式传 chains）', () => {
  setRuntimeDamageChains(adaptDamageChains({
    version: 1,
    chains: [{
      chainKey: 'direct',
      label: '默认合并',
      scope: 'global',
      stages: [{ id: 'dmg', label: '运行时增伤' }],
    }],
  }))
  const resolved = resolveDamageChain('direct', { damageKind: 'direct' })
  assert.equal(resolved.label, '默认合并')
  assert.equal(resolved.stages.find((stage) => stage.id === 'dmg').label, '运行时增伤')
})

console.log('[4] 端到端：运行时链路改变用户端计算过程（数值不变）')

check('角色级覆盖：阶段改名 / 禁用生效，期望伤害不变', () => {
  setRuntimeDamageChains([])
  clearHitEvalCache()
  const target = buildGoldenCases().find((testCase) => testCase.name === 'direct-r0-normal')
  assert.ok(target, '缺少 direct 黄金用例')
  const before = target.runtime.getHitDetail(target.hit)
  assert.ok(before)
  const beforeStages = before.evaluation.result.pipeline.stages
  assert.equal(beforeStages.find((stage) => stage.id === 'dmg').label, '增伤区')
  assert.ok(beforeStages.some((stage) => stage.id === 'vulnerable'))
  const beforePerHit = target.runtime.getHitNumbers(target.hit).perHit

  setRuntimeDamageChains(adaptDamageChains({
    version: 1,
    chains: [{
      chainKey: 'direct',
      label: '直伤（运行时）',
      scope: 'agent',
      targetId: target.hit.skill.agentId,
      priority: 10,
      stages: [
        { id: 'dmg', label: '增伤（运行时）' },
        { id: 'vulnerable', enabled: false },
        { id: 'eliteBonus', label: '对精英增伤区', order: 55 },
      ],
    }],
  }))
  clearHitEvalCache()
  const after = target.runtime.getHitDetail(target.hit)
  assert.ok(after)
  assert.equal(after.evaluation.result.pipeline.chainId, 'direct')
  const afterStages = after.evaluation.result.pipeline.stages
  assert.equal(afterStages.find((stage) => stage.id === 'dmg').label, '增伤（运行时）')
  assert.ok(!afterStages.some((stage) => stage.id === 'vulnerable'))
  // 新增阶段没有值映射 → 轨迹里自然跳过
  assert.ok(!afterStages.some((stage) => stage.id === 'eliteBonus'))
  assert.equal(getDamageChainLabel('direct'), '直伤（运行时）')
  assert.equal(target.runtime.getHitNumbers(target.hit).perHit, beforePerHit)
})

setRuntimeDamageChains([])
console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
