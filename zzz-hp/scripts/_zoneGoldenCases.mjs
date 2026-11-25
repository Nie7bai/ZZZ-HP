/**
 * 乘区黄金对照用例（Phase 0）。
 *
 * 目的：在乘区模块化改造前后，用固定夹具覆盖主要伤害类型 / 阶段 / 影画，
 * 对 `DamageCalcResult` 做全字段 JSON 对照，确保结果逐字段一致。
 *
 * 运行：npx vite-node scripts/test-zone-golden.mjs            # 对照 fixtures/zone-golden.json
 *      npx vite-node scripts/test-zone-golden.mjs --write    # 重新生成基线（仅等价改造前使用）
 */
import { createBuffCalculationRuntime } from '../src/utils/skillFlowCalculation.ts'
import { clearHitEvalCache } from '../src/utils/hitEvalCache.ts'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { testAgent, makePanel } from './_effectPipelineHarness.mjs'

export const DAMAGE_KINDS = ['direct', 'sharpen', 'attributeAnomaly', 'disorder', 'anomalyRelease', 'turbulence', 'radiance']

const AGENTS_BY_KIND = {
  direct: [['owner', { element: '电' }], ['power', { element: '风' }]],
  sharpen: [['owner', { element: '电' }], ['power', { element: '风' }]],
  attributeAnomaly: [['owner', { element: '电' }], ['power', { element: '风' }]],
  disorder: [['owner', { element: '电' }], ['power', { element: '风' }]],
  anomalyRelease: [['owner', { element: '电' }], ['power', { element: '风' }]],
  turbulence: [['owner', { element: '电' }], ['power', { element: '风' }]],
  radiance: [['remiel', { element: '流明' }], ['power', { element: '电' }]],
}

const TRIGGER_BY_KIND = {
  turbulence: 'power',
  radiance: 'remiel',
}

function makeFixture(damageType, { rank = 0, enemyStagger = 1.5 } = {}) {
  const agents = AGENTS_BY_KIND[damageType] ?? AGENTS_BY_KIND.direct
  const trigger = TRIGGER_BY_KIND[damageType] ?? agents[0][0]
  const owner = agents[0][0]
  const effects = [
    createEmptyBuffEffect({
      id: 'team-bonus',
      stat: damageType === 'direct' || damageType === 'sharpen' ? 'dmgBonus' : 'anomalyReleaseMult',
      value: 25,
      enabledDefault: true,
      applyTarget: 'team',
    }),
    createEmptyBuffEffect({ id: 'global-stagger', stat: 'globalStaggerVulnerable', value: 10, enabledDefault: true, applyTarget: 'team' }),
  ]
  const fixture = eventFixture({
    mode: 'ordinary',
    damageType,
    effects,
    agents: agents.map(([id, overrides]) => testAgent(id, overrides)),
    prepared: [{ id: 'prepared', skillId: 'event-skill', skillSource: 'custom', anomalyPowerAgentId: 'power', triggerAgentId: trigger }],
    flow: [
      { id: 'flow-1', ownerAgentId: owner, preparedId: 'prepared', count: 1, staggerPhase: 'normal', critMode: 'expected' },
      { id: 'flow-2', ownerAgentId: owner, preparedId: 'prepared', count: 3, staggerPhase: 'stagger', critMode: 'fullCrit' },
    ],
    panels: {
      owner: makePanel({ atk: 1500, anomalyReleaseMult: 60 }),
      power: makePanel({ atk: 2200 }),
      remiel: makePanel({ atk: 1800, anomalyReleaseMult: 70 }),
    },
  })
  fixture.skill.baseMult = 12345
  for (const hit of fixture.hits) {
    hit.skill.baseMult = 12345
    hit.effectiveBaseMult = 12345
    hit.staggerPhase = hit.id === 'flow-2' ? 'stagger' : 'normal'
  }
  const teamSlots = fixture.teamSlots.map((slot) => (slot.agentId === owner ? { ...slot, rank } : slot))
  const runtime = createBuffCalculationRuntime(eventRuntimeInput(fixture, {
    contextInput: { teamSlots, enemyInput: { ...fixture.context.enemyInput, staggerMultiplier: enemyStagger } },
  }))
  return { fixture, runtime }
}

function makeCurtainFixture({ rank = 0, enemyStagger = 2.5 } = {}) {
  const fixture = eventFixture({
    mode: 'ordinary',
    damageType: 'direct',
    effects: [createEmptyBuffEffect({ id: 'global-stagger', stat: 'globalStaggerVulnerable', value: 50, enabledDefault: true, applyTarget: 'team' })],
    agents: [testAgent('yeshunguang', { element: '物理', profession: '强攻' }), testAgent('power', { element: '风' })],
    prepared: [{ id: 'prepared', skillId: 'event-skill', skillSource: 'custom', anomalyPowerAgentId: 'power', triggerAgentId: 'yeshunguang' }],
    flow: [
      { id: 'flow-1', ownerAgentId: 'yeshunguang', preparedId: 'prepared', count: 1, staggerPhase: 'normal', critMode: 'expected' },
      { id: 'flow-2', ownerAgentId: 'yeshunguang', preparedId: 'prepared', count: 2, staggerPhase: 'stagger', critMode: 'expected' },
    ],
    panels: { yeshunguang: makePanel({ atk: 1500 }), power: makePanel({ atk: 2200 }) },
  })
  fixture.skill.baseMult = 12345
  for (const hit of fixture.hits) {
    hit.skill.baseMult = 12345
    hit.effectiveBaseMult = 12345
    hit.skill.name = '普通攻击：明心境·斩流光 极'
    hit.skill.agentId = 'yeshunguang'
  }
  const teamSlots = fixture.teamSlots.map((slot) => (slot.agentId === 'yeshunguang' ? { ...slot, rank } : slot))
  const runtime = createBuffCalculationRuntime(eventRuntimeInput(fixture, {
    contextInput: { teamSlots, enemyInput: { ...fixture.context.enemyInput, staggerMultiplier: enemyStagger } },
  }))
  return { fixture, runtime }
}

export function buildGoldenCases() {
  clearHitEvalCache()
  const cases = []
  for (const damageType of DAMAGE_KINDS) {
    for (const rank of [0, 4]) {
      const { fixture, runtime } = makeFixture(damageType, { rank })
      for (const hit of fixture.hits) {
        cases.push({
          name: `${damageType}-r${rank}-${hit.staggerPhase}`,
          hit,
          runtime,
        })
      }
    }
  }
  for (const rank of [0, 4]) {
    const { fixture, runtime } = makeCurtainFixture({ rank })
    for (const hit of fixture.hits) {
      cases.push({ name: `curtain-r${rank}-${hit.staggerPhase}`, hit, runtime })
    }
  }
  return cases
}

export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]))
  }
  return value
}

export function dumpCase({ runtime, hit }) {
  const numbers = runtime.getHitNumbers(hit)
  const detail = runtime.getHitDetail(hit)
  if (!numbers || !detail) throw new Error(`命中无法求值：${hit.id}`)
  return {
    perHit: numbers.perHit,
    total: numbers.total,
    result: stableJson(detail.evaluation.result),
  }
}
