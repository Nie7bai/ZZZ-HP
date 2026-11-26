/**
 * 运行时乘区方案：公共接口适配 + 合并解析（Phase 4e）。
 *
 * 运行：npx vite-node scripts/test-zone-scheme-source.mjs
 */
import assert from 'node:assert/strict'

import { adaptZoneSchemes, adaptZoneScheme } from '../src/zones/schemeAdapter.ts'
import { resolveCurtainCap, resolveZoneScheme } from '../src/zones/scheme.ts'
import {
  getMergedZoneSchemes,
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

function makeHit(overrides = {}) {
  return {
    skill: {
      id: 'sk-yeshunguang-nk-1431009-main',
      name: '普通攻击：明心境·斩流光 极',
      agentId: 'yeshunguang',
      skillTypes: ['basic'],
      ownerGroupId: null,
    },
    ownerAgentId: 'yeshunguang',
    anomalyPowerAgentId: null,
    triggerAgentId: null,
    damageKind: 'direct',
    ...overrides,
  }
}

const panelContext = (rank = 0) => ({
  teamSlots: [{ agentId: 'yeshunguang', rank }],
  agents: [{ id: 'yeshunguang', profession: '强攻', element: '物理' }],
})

console.log('[1] 后端格式适配')

check('scope skill_group → skillGroup', () => {
  const scheme = adaptZoneScheme({
    scope: 'skill_group',
    targetId: 'sg-1',
    name: '组方案',
    priority: 10,
    version: 1,
    rules: [{ key: 'stagger', action: 'replace', module: 'stagger', params: { mode: 'curtain' } }],
  })
  assert.equal(scheme.scope, 'skillGroup')
})

check('条件：单键、比较、and/or/not', () => {
  const scheme = adaptZoneScheme({
    scope: 'agent',
    targetId: 'yeshunguang',
    name: '条件',
    priority: 10,
    version: 1,
    rules: [{
      key: 'stagger',
      action: 'replace',
      module: 'stagger',
      when: {
        and: [
          { agentId: 'yeshunguang' },
          { mindscapeRank: { op: '>=', value: 4 } },
          { not: { damageKind: 'direct' } },
        ],
      },
    }],
  })
  const when = scheme.entries[0].when
  assert.deepEqual(when.and[0], { var: 'agentId', op: 'eq', value: 'yeshunguang' })
  assert.deepEqual(when.and[1], { var: 'mindscapeRank', op: 'gte', value: 4 })
  assert.deepEqual(when.and[2], { not: { var: 'damageKind', op: 'eq', value: 'direct' } })
})

check('规则动作：inherit 无覆盖跳过、disable 保留、replace 带参数', () => {
  const scheme = adaptZoneScheme({
    scope: 'agent',
    targetId: 'yeshunguang',
    name: '动作',
    priority: 10,
    version: 1,
    rules: [
      { key: 'dmgMultiplier', action: 'inherit' },
      { key: 'stagger', action: 'disable' },
      { key: 'custom:elite', action: 'replace', module: 'percentSum', params: { statKeys: ['eliteDmgBonus'] } },
    ],
  })
  assert.deepEqual(scheme.entries.map((entry) => [entry.key, entry.action]), [
    ['stagger', 'disable'],
    ['custom:elite', 'replace'],
  ])
})

console.log('[2] 运行时方案合并')

check('DB 方案覆盖内置帷幕上限：2.2 / 4 影 3.2', () => {
  setRuntimeZoneSchemes(adaptZoneSchemes({
    version: 1,
    definitions: [],
    schemes: [{
      scope: 'agent',
      targetId: 'yeshunguang',
      name: '测试覆盖',
      priority: 10,
      version: 1,
      rules: [{
        key: 'stagger',
        action: 'replace',
        module: 'stagger',
        params: { mode: 'curtain', cap: { default: 2.2, rank4: 3.2, rankThreshold: 4 } },
        when: { skillName: { op: 'in', value: ['普通攻击：明心境·斩流光 极'] } },
      }],
    }],
  }))

  const rank0 = resolveZoneScheme({ hit: makeHit(), panelContext: panelContext(0), schemes: getMergedZoneSchemes() })
  assert.equal(resolveCurtainCap(rank0), 2.2)
  const rank4 = resolveZoneScheme({ hit: makeHit(), panelContext: panelContext(4), schemes: getMergedZoneSchemes() })
  assert.equal(resolveCurtainCap(rank4), 3.2)

  const notMatched = resolveZoneScheme({
    hit: makeHit({ skill: { ...makeHit().skill, name: '普通攻击：快剑·一段' } }),
    panelContext: panelContext(0),
    schemes: getMergedZoneSchemes(),
  })
  assert.equal(resolveCurtainCap(notMatched), null)
})

check('disable 条目移除内置乘区', () => {
  setRuntimeZoneSchemes(adaptZoneSchemes({
    version: 1,
    definitions: [],
    schemes: [{
      scope: 'agent',
      targetId: 'yeshunguang',
      name: '禁用帷幕',
      priority: 10,
      version: 1,
      rules: [{ key: 'stagger', action: 'disable' }],
    }],
  }))
  const resolved = resolveZoneScheme({ hit: makeHit(), panelContext: panelContext(0), schemes: getMergedZoneSchemes() })
  assert.equal(resolveCurtainCap(resolved), null)
})

setRuntimeZoneSchemes([])
console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
