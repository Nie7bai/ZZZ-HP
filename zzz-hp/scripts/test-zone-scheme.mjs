/**
 * 乘区方案（Phase 3a）单元测试。
 *
 * 覆盖：
 * 1. 内置方案（叶瞬光帷幕易伤）的条件匹配与边界；
 * 2. 影画上限 0–3 影 210% / 4–6 影 300%；
 * 3. 作用域优先级（agent 覆盖 global、skill 覆盖 agent）与按 key 合并；
 * 4. 解析只读 `hit` 与 `panelContext`，不依赖任何全局状态；
 * 5. 条件白名单运算的语义。
 *
 * 运行：npx vite-node scripts/test-zone-scheme.mjs
 */
import assert from 'node:assert/strict'

import {
  BUILT_IN_ZONE_SCHEMES,
  CURTAIN_ZONE_KEY,
  clampZoneMindscapeRank,
  evaluateZoneCondition,
  resolveCurtainCap,
  resolveZoneScheme,
} from '../src/zones/scheme.ts'

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

const panelContext = {
  teamSlots: [
    { agentId: 'yeshunguang', rank: 0 },
    { agentId: 'power', rank: 2 },
  ],
  agents: [
    { id: 'yeshunguang', profession: '强攻', element: '物理' },
    { id: 'power', profession: '支援', element: '风' },
  ],
}

function contextWithRank(rank) {
  return {
    ...panelContext,
    teamSlots: panelContext.teamSlots.map((slot) =>
      slot.agentId === 'yeshunguang' ? { ...slot, rank } : slot,
    ),
  }
}

function makeHit(overrides = {}) {
  const skill = {
    id: 'sk-yeshunguang-basic',
    name: '普通攻击：明心境·斩流光 极',
    agentId: 'yeshunguang',
    skillTypes: ['basic'],
    ownerGroupId: null,
    ...(overrides.skill ?? {}),
  }
  return {
    skill,
    ownerAgentId: 'yeshunguang',
    anomalyPowerAgentId: null,
    triggerAgentId: null,
    damageKind: 'direct',
    anomalySubKind: 'attributeAnomaly',
    directSubKind: 'normal',
    isFollowUp: false,
    elementOverride: null,
    ...overrides,
    skill,
  }
}

function capOf(hit, context = panelContext, schemes) {
  return resolveCurtainCap(
    resolveZoneScheme({ hit, panelContext: context, schemes }),
  )
}

const CURTAIN_SKILL = '普通攻击：明心境·斩流光 极'
const ULT_SKILL_A = '终结技：逐云惊霆'
const ULT_SKILL_B = '终结技：斩妄开天'
const ENTRY_SKILL = '登场技：照影'
const NORMAL_SKILL = '普通攻击：快剑·一段'

console.log('[1] 内置方案：叶瞬光帷幕招式条件')

check('内置方案有 1 条 agent 作用域方案，条目为 stagger/curtain', () => {
  assert.equal(BUILT_IN_ZONE_SCHEMES.length, 1)
  const scheme = BUILT_IN_ZONE_SCHEMES[0]
  assert.equal(scheme.scope, 'agent')
  assert.equal(scheme.targetId, 'yeshunguang')
  assert.equal(scheme.priority, 10)
  assert.equal(scheme.entries.length, 1)
  const entry = scheme.entries[0]
  assert.equal(entry.key, CURTAIN_ZONE_KEY)
  assert.equal(entry.module, 'stagger')
  assert.equal(entry.params.mode, 'curtain')
  assert.deepEqual(entry.params.cap, { default: 2.1, rank4: 3, rankThreshold: 4 })
})

check('明心境 / 两个终结技 / 登场技命中帷幕易伤', () => {
  for (const name of [CURTAIN_SKILL, ULT_SKILL_A, ULT_SKILL_B, ENTRY_SKILL]) {
    assert.equal(capOf(makeHit({ skill: { name } })), 2.1, `${name} 应命中帷幕`)
  }
})

check('快剑等普通招式不命中（返回 null）', () => {
  assert.equal(capOf(makeHit({ skill: { name: NORMAL_SKILL } })), null)
})

check('其他角色的同名招式不命中（作用域限定叶瞬光）', () => {
  assert.equal(capOf(makeHit({ skill: { name: CURTAIN_SKILL, agentId: 'power' } })), null)
})

check('公共招式（agentId 为空）不命中空 targetId 方案', () => {
  const hit = makeHit({ skill: { name: CURTAIN_SKILL, agentId: '' } })
  assert.equal(capOf(hit), null)
  const resolved = resolveZoneScheme({ hit, panelContext })
  assert.deepEqual(Object.keys(resolved.entries), [])
})

console.log('[2] 影画上限：0–3 影 210%，4–6 影 300%')

check('0 / 3 影 = 2.1，4 / 6 影 = 3', () => {
  const hit = makeHit({ skill: { name: CURTAIN_SKILL } })
  assert.equal(capOf(hit, contextWithRank(0)), 2.1)
  assert.equal(capOf(hit, contextWithRank(3)), 2.1)
  assert.equal(capOf(hit, contextWithRank(4)), 3)
  assert.equal(capOf(hit, contextWithRank(6)), 3)
})

check('影画 clamp 到 0–6，且四舍五入与旧实现一致', () => {
  const hit = makeHit({ skill: { name: CURTAIN_SKILL } })
  assert.equal(capOf(hit, contextWithRank(9)), 3)
  assert.equal(capOf(hit, contextWithRank(-2)), 2.1)
  assert.equal(capOf(hit, contextWithRank(3.6)), 3)
  assert.equal(capOf(hit, contextWithRank(3.4)), 2.1)
  assert.equal(clampZoneMindscapeRank(Number.NaN), 0)
  assert.equal(clampZoneMindscapeRank(undefined), 0)
})

check('不在队伍里（无槽位）按 0 影处理', () => {
  const hit = makeHit({ skill: { name: CURTAIN_SKILL, agentId: 'nobody' } })
  const resolved = resolveZoneScheme({ hit, panelContext })
  assert.equal(resolved.context.mindscapeRank, 0)
  assert.equal(resolveCurtainCap(resolved), null, '非叶瞬光仍不启用帷幕')
})

console.log('[3] 作用域优先级与按 key 合并')

const GLOBAL_SCHEME = {
  scope: 'global',
  targetId: '',
  priority: 10,
  entries: [
    { key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'curtain', cap: { default: 1.1, rank4: 1.2 } } },
    { key: 'dmgMultiplier', module: 'panel.percent', params: { field: 'dmgBonus' } },
  ],
}
const AGENT_SCHEME = {
  scope: 'agent',
  targetId: 'yeshunguang',
  priority: 10,
  entries: [
    { key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'curtain', cap: { default: 2.1, rank4: 3 } } },
  ],
}
const SKILL_SCHEME = {
  scope: 'skill',
  targetId: 'sk-yeshunguang-basic',
  priority: 10,
  entries: [
    { key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'curtain', cap: { default: 5, rank4: 6 } } },
  ],
}

check('agent 覆盖 global，skill 覆盖 agent', () => {
  const hit = makeHit({ skill: { name: NORMAL_SKILL } })
  const onlyGlobal = resolveZoneScheme({ hit, panelContext, schemes: [GLOBAL_SCHEME] })
  assert.equal(resolveCurtainCap(onlyGlobal), 1.1)

  const withAgent = resolveZoneScheme({ hit, panelContext, schemes: [GLOBAL_SCHEME, AGENT_SCHEME] })
  assert.equal(resolveCurtainCap(withAgent), 2.1)
  assert.equal(withAgent.entries[CURTAIN_ZONE_KEY].sourceScope, 'agent')

  const withSkill = resolveZoneScheme({
    hit,
    panelContext,
    schemes: [SKILL_SCHEME, GLOBAL_SCHEME, AGENT_SCHEME],
  })
  assert.equal(resolveCurtainCap(withSkill), 5)
  assert.equal(withSkill.entries[CURTAIN_ZONE_KEY].sourceScope, 'skill')
  // 不同 key 的条目共存
  assert.equal(withSkill.entries.dmgMultiplier.sourceScope, 'global')
})

check('同作用域按 priority 覆盖，同优先级按传入顺序后者覆盖', () => {
  const hit = makeHit({ skill: { name: NORMAL_SKILL } })
  const lowPriority = {
    scope: 'agent',
    targetId: 'yeshunguang',
    priority: 5,
    entries: [{ key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'curtain', cap: { default: 1, rank4: 1 } } }],
  }
  const highPriority = {
    scope: 'agent',
    targetId: 'yeshunguang',
    priority: 20,
    entries: [{ key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'curtain', cap: { default: 2, rank4: 2 } } }],
  }
  assert.equal(resolveCurtainCap(resolveZoneScheme({ hit, panelContext, schemes: [highPriority, lowPriority] })), 2)

  const first = {
    scope: 'agent',
    targetId: 'yeshunguang',
    priority: 10,
    entries: [{ key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'curtain', cap: { default: 1.5, rank4: 1.5 } } }],
  }
  assert.equal(resolveCurtainCap(resolveZoneScheme({ hit, panelContext, schemes: [first, AGENT_SCHEME] })), 2.1)
  assert.equal(resolveCurtainCap(resolveZoneScheme({ hit, panelContext, schemes: [AGENT_SCHEME, first] })), 1.5)
})

check('条件不成立的覆盖条目被跳过，前一条方案保持生效', () => {
  const hit = makeHit({ skill: { name: NORMAL_SKILL } })
  const conditionalAgent = {
    scope: 'agent',
    targetId: 'yeshunguang',
    priority: 10,
    entries: [
      {
        key: CURTAIN_ZONE_KEY,
        module: 'stagger',
        params: { mode: 'curtain', cap: { default: 9, rank4: 9 } },
        when: { var: 'skillName', value: '不存在的招式' },
      },
    ],
  }
  assert.equal(resolveCurtainCap(resolveZoneScheme({ hit, panelContext, schemes: [GLOBAL_SCHEME, conditionalAgent] })), 1.1)
})

check('未知 scope 忽略；未命中任何方案返回空条目', () => {
  const hit = makeHit({ skill: { name: NORMAL_SKILL } })
  const unknownScope = {
    scope: 'boss',
    targetId: '',
    priority: 1,
    entries: [{ key: 'boss', module: 'panel.percent', params: { field: 'dmgBonus' } }],
  }
  const resolved = resolveZoneScheme({ hit, panelContext, schemes: [unknownScope] })
  assert.deepEqual(Object.keys(resolved.entries), [])
  assert.equal(resolveCurtainCap(resolved), null)
  // 未传 schemes 时走内置方案
  assert.equal(resolveCurtainCap(resolveZoneScheme({ hit, panelContext })), null)
})

check('非 curtain 模式或无 cap 规则返回 null', () => {
  const hit = makeHit({ skill: { name: NORMAL_SKILL } })
  const notCurtain = {
    scope: 'global',
    targetId: '',
    priority: 10,
    entries: [{ key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'normal' } }],
  }
  assert.equal(resolveCurtainCap(resolveZoneScheme({ hit, panelContext, schemes: [notCurtain] })), null)

  const noCap = {
    scope: 'global',
    targetId: '',
    priority: 10,
    entries: [{ key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'curtain' } }],
  }
  assert.equal(resolveCurtainCap(resolveZoneScheme({ hit, panelContext, schemes: [noCap] })), null)
})

check('resolveCurtainCap 接受空参数', () => {
  assert.equal(resolveCurtainCap(null), null)
  assert.equal(resolveCurtainCap(undefined), null)
})

console.log('[4] 解析只读 hit / panelContext（无全局状态）')

check('作用域取 hit.skill.agentId：ownerAgentId 不参与判定', () => {
  const fromOwnerOther = makeHit({
    skill: { name: CURTAIN_SKILL, agentId: 'yeshunguang' },
    ownerAgentId: 'power',
  })
  assert.equal(capOf(fromOwnerOther), 2.1)

  const fromSkillOther = makeHit({
    skill: { name: CURTAIN_SKILL, agentId: 'power' },
    ownerAgentId: 'yeshunguang',
  })
  assert.equal(capOf(fromSkillOther), null)
})

check('两次解析互不影响，内置方案不被修改', () => {
  const before = JSON.stringify(BUILT_IN_ZONE_SCHEMES)
  const curtain = resolveZoneScheme({
    hit: makeHit({ skill: { name: CURTAIN_SKILL } }),
    panelContext,
  })
  const plain = resolveZoneScheme({
    hit: makeHit({ skill: { name: NORMAL_SKILL } }),
    panelContext,
  })
  assert.equal(curtain.context.skillName, CURTAIN_SKILL)
  assert.equal(plain.context.skillName, NORMAL_SKILL)
  assert.deepEqual(Object.keys(curtain.entries), [CURTAIN_ZONE_KEY])
  assert.deepEqual(Object.keys(plain.entries), [])
  assert.equal(JSON.stringify(BUILT_IN_ZONE_SCHEMES), before)
})

console.log('[5] 条件白名单运算')

const condHit = makeHit({
  skill: { name: CURTAIN_SKILL, id: 'sk-1', skillTypes: ['basic', 'ultimate'], ownerGroupId: 'g-1' },
  ownerAgentId: 'yeshunguang',
  anomalyPowerAgentId: 'power',
  triggerAgentId: 'yeshunguang',
  isFollowUp: true,
})
const condCtx = {
  ...panelContext,
  agents: [...panelContext.agents],
}

function evaluate(condition) {
  return evaluateZoneCondition(condition, condHit, condCtx)
}

check('eq / neq / in / contains', () => {
  assert.equal(evaluate({ var: 'agentId', value: 'yeshunguang' }), true)
  assert.equal(evaluate({ var: 'agentId', op: 'eq', value: 'power' }), false)
  assert.equal(evaluate({ var: 'agentId', op: 'neq', value: 'power' }), true)
  assert.equal(evaluate({ var: 'skillName', op: 'contains', value: '明心境' }), true)
  assert.equal(evaluate({ var: 'skillName', op: 'contains', value: '快剑' }), false)
  assert.equal(evaluate({ var: 'skillTypes', op: 'contains', value: 'ultimate' }), true)
  assert.equal(evaluate({ var: 'skillTypes', op: 'contains', value: 'dodge' }), false)
  assert.equal(evaluate({ var: 'anomalyPowerAgentId', op: 'in', value: ['power', 'other'] }), true)
  assert.equal(evaluate({ var: 'triggerAgentId', op: 'in', value: ['other'] }), false)
  assert.equal(evaluate({ var: 'skillId', value: 'sk-1' }), true)
  assert.equal(evaluate({ var: 'profession', value: '强攻' }), true)
  assert.equal(evaluate({ var: 'element', value: '物理' }), true)
  assert.equal(evaluate({ var: 'isFollowUp', value: true }), true)
})

check('gte / lte 只做数值比较', () => {
  assert.equal(evaluate({ var: 'mindscapeRank', op: 'gte', value: 0 }), true)
  assert.equal(evaluate({ var: 'mindscapeRank', op: 'lte', value: -1 }), false)
  const ranked = contextWithRank(4)
  assert.equal(evaluateZoneCondition({ var: 'mindscapeRank', op: 'gte', value: 4 }, condHit, ranked), true)
  assert.equal(evaluateZoneCondition({ var: 'agentId', op: 'gte', value: 1 }, condHit, condCtx), false)
})

check('and / or / not 与缺省条件', () => {
  assert.equal(evaluate({ and: [{ var: 'agentId', value: 'yeshunguang' }, { var: 'isFollowUp', value: true }] }), true)
  assert.equal(evaluate({ and: [{ var: 'agentId', value: 'power' }, { var: 'isFollowUp', value: true }] }), false)
  assert.equal(evaluate({ or: [{ var: 'agentId', value: 'power' }, { var: 'isFollowUp', value: true }] }), true)
  assert.equal(evaluate({ not: { var: 'agentId', value: 'power' } }), true)
  assert.equal(evaluate(undefined), true)
  assert.equal(evaluate(null), true)
})

check('未知变量判为不成立', () => {
  assert.equal(evaluate({ var: 'monsterCategory', value: 'elite' }), false)
  assert.equal(evaluate({ var: 'skillName', op: 'startsWith', value: '普通' }), false)
})

check('skillGroup 作用域按 hit.skill.ownerGroupId 命中', () => {
  const groupScheme = {
    scope: 'skillGroup',
    targetId: 'g-1',
    priority: 10,
    entries: [{ key: CURTAIN_ZONE_KEY, module: 'stagger', params: { mode: 'curtain', cap: { default: 4, rank4: 4 } } }],
  }
  const hit = makeHit({ skill: { name: NORMAL_SKILL, ownerGroupId: 'g-1' } })
  assert.equal(capOf(hit, panelContext, [groupScheme]), 4)
  const other = makeHit({ skill: { name: NORMAL_SKILL, ownerGroupId: 'g-2' } })
  assert.equal(capOf(other, panelContext, [groupScheme]), null)
})

console.log(`
${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
