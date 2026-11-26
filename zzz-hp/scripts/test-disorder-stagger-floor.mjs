/**
 * 紊乱失衡易伤下限（卡芙卡独特增益）回归。
 *
 * 口径：失衡易伤区 = max(原值, 下限/100)，只对紊乱 / 极性紊乱生效；
 * 非失衡期原值 = 1 + 全局失衡易伤，失衡期原值 = 敌人失衡易伤 + 全局 + 失衡期项。
 *
 * 运行：npx vite-node scripts/test-disorder-stagger-floor.mjs
 */
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { extractCombatMods } from '../src/utils/panelBuffCalc.ts'
import { createBuffCalculationRuntime } from '../src/utils/skillFlowCalculation.ts'
import { buildEventValueTips } from '../src/utils/eventDamageSourceTips.ts'
import { buildPipelineStageRows } from '../src/zones/display.ts'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { makePanel, testAgent } from './_effectPipelineHarness.mjs'
import {
  BUFF_STAT_FIELDS,
  createEmptyBuffStatModifiers,
} from '../src/utils/calculatorUi.ts'

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function near(actual, expected, tolerance = 2) {
  return Math.abs(actual - expected) <= tolerance
}

function makeInput(overrides = {}) {
  const panel = createDefaultExternalPanel()
  panel.atk = 2200
  panel.mastery = 300
  panel.dmgBonus = 40
  return {
    chainId: 'disorder',
    eventDamageType: 'disorder',
    anomalySubKind: 'disorder',
    finalPanel: panel,
    triggerFinalPanel: { ...panel, atk: 2600 },
    anomalyTriggerPanel: { ...panel, mastery: 400 },
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: {
      defense: 953,
      resistanceType: 'normal',
      vulnerableMultiplier: 1,
      staggerMultiplier: 1.5,
      specialMultiplier: 1,
      level: 60,
    },
    combatVulnerable: 0,
    combatDirectVulnerable: 0,
    combatAnomalyVulnerable: 0,
    combatDmgReduction: 0,
    combatDirectDmgReduction: 0,
    combatAnomalyDmgReduction: 0,
    combatGlobalStaggerVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatStaggerVulnerableOnly: 0,
    combatSpecial: 0,
    combatPierceDmgBonus: 0,
    combatSharpenDmgBonus: 0,
    combatDmgPenalty: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    ...overrides,
  }
}

/** 非失衡期：失衡易伤区 = 100%，无下限 */
const normalBaseline = computeDamageResult(makeInput({ staggerPhase: 'normal' }))
check(
  '无下限：非失衡期失衡易伤区 = 1',
  normalBaseline.staggerMultiplier === 1,
  `${normalBaseline.staggerMultiplier}`,
)

/** 非失衡期 + 140% 下限：卡芙卡第一句（额外 40% 特殊失衡易伤） */
const normalFloored = computeDamageResult(
  makeInput({ staggerPhase: 'normal', combatDisorderStaggerFloor: 140 }),
)
check(
  '非失衡期 + 140% 下限 → 失衡易伤区 1.4',
  normalFloored.staggerMultiplier === 1.4,
  `${normalFloored.staggerMultiplier}`,
)
check(
  '非失衡期 + 140% 下限 → 紊乱期望 = 基线 × 1.4',
  near(normalFloored.disorderExpected, normalBaseline.disorderExpected * 1.4, 3),
  `${normalFloored.disorderExpected} / ${normalBaseline.disorderExpected * 1.4}`,
)

/** 失衡期：敌人 1.5 时不压低（卡芙卡第二句「不高于 140% 才视为 140%」） */
const staggerHigh = computeDamageResult(
  makeInput({ staggerPhase: 'stagger', combatDisorderStaggerFloor: 140 }),
)
check(
  '失衡期 敌人 1.5 + 下限 1.4 → 失衡易伤区 1.5（不压低）',
  staggerHigh.staggerMultiplier === 1.5,
  `${staggerHigh.staggerMultiplier}`,
)

/** 失衡期：敌人 1.25 时抬到 1.4 */
const staggerLow = computeDamageResult(
  makeInput({
    staggerPhase: 'stagger',
    combatDisorderStaggerFloor: 140,
    enemyInput: { ...makeInput().enemyInput, staggerMultiplier: 1.25 },
  }),
)
check(
  '失衡期 敌人 1.25 + 下限 1.4 → 失衡易伤区 1.4',
  staggerLow.staggerMultiplier === 1.4,
  `${staggerLow.staggerMultiplier}`,
)

/** 与其他失衡类加成并存：先加算再取最大 */
const withGlobal = computeDamageResult(
  makeInput({
    staggerPhase: 'normal',
    combatGlobalStaggerVulnerable: 60,
    combatDisorderStaggerFloor: 140,
  }),
)
check(
  '全局失衡易伤 60% + 下限 140% → max(1.6, 1.4) = 1.6',
  withGlobal.staggerMultiplier === 1.6,
  `${withGlobal.staggerMultiplier}`,
)

/** 只对紊乱生效：直伤事件带同一个下限也不抬 */
const directEvent = computeDamageResult(
  makeInput({
    eventDamageType: 'direct',
    anomalySubKind: 'attributeAnomaly',
    staggerPhase: 'normal',
    combatDisorderStaggerFloor: 140,
  }),
)
check(
  '直伤事件不受紊乱下限影响',
  directEvent.staggerMultiplier === 1 &&
    directEvent.directDamageExpected === computeDamageResult(makeInput({
      eventDamageType: 'direct',
      anomalySubKind: 'attributeAnomaly',
      staggerPhase: 'normal',
    })).directDamageExpected,
  `${directEvent.staggerMultiplier}`,
)

/** 透传：combatMods → DamageCalcInput */
const mods = createEmptyBuffStatModifiers()
mods.disorderStaggerFloor = 140
check(
  'combatMods 透传 disorderStaggerFloor',
  extractCombatMods(mods).disorderStaggerFloor === 140,
  `${extractCombatMods(mods).disorderStaggerFloor}`,
)

/** 管理端属性目录：新增字段可配 */
const field = BUFF_STAT_FIELDS.find((entry) => entry.key === 'disorderStaggerFloor')
check(
  '增益字段存在：紊乱失衡易伤下限（百分比）',
  Boolean(field) && field.unit === 'percent' && field.label === '紊乱失衡易伤下限',
  field ? `${field.label}/${field.unit}` : 'missing',
)

// 渲染层：流程详情里失衡易伤区显示抬过下限的值，悬停给出「下限 → 取最大」两行
const fixture = eventFixture({
  mode: 'ordinary',
  damageType: 'disorder',
  // 增益挂在 1 号位（队友），伤害由 0 号位打出：顺带覆盖「来源里要写提供者」
  sourceSlot: 1,
  effects: [
    createEmptyBuffEffect({
      id: 'kafka-floor',
      kind: 'fixed',
      stat: 'disorderStaggerFloor',
      value: 140,
      applyTarget: 'team',
      enabledDefault: true,
      conditions: { damageTypes: ['disorder'] },
    }),
  ],
  agents: [testAgent('owner', { element: '电' }), testAgent('power', { element: '风' })],
  prepared: [{ id: 'prepared', skillId: 'event-skill', skillSource: 'custom', anomalyPowerAgentId: 'power', triggerAgentId: 'owner' }],
  flow: [
    { id: 'flow-1', ownerAgentId: 'owner', preparedId: 'prepared', count: 1, staggerPhase: 'normal', critMode: 'expected' },
  ],
  panels: { owner: makePanel({ atk: 2200, mastery: 400 }), power: makePanel({ atk: 2600, mastery: 300 }) },
})
const runtime = createBuffCalculationRuntime(eventRuntimeInput(fixture, { contextInput: { teamSlots: fixture.teamSlots } }))
const detail = runtime.getHitDetail(fixture.hits[0])
check(
  '流程详情：非失衡期紊乱的失衡易伤区取到 1.4',
  detail.evaluation.result.staggerMultiplier === 1.4,
  `${detail.evaluation.result.staggerMultiplier}`,
)
const staggerTipItems = (buildEventValueTips(detail).staggerMultiplier ?? []).flatMap((group) => group.items)
check(
  '流程详情悬停：失衡易伤区过程出现「下限 1.4」与「max(...) = 失衡易伤区 1.4」',
  staggerTipItems.some((item) => item.startsWith('下限 1.4')) &&
    staggerTipItems.some((item) => item.includes('max(') && item.includes('失衡易伤区')),
  staggerTipItems.join(' | '),
)

// 全队语义：增益挂在队友身上（不是伤害持有者）也要作用到该次紊乱
function teamFloorZone({ sourceSlot, applyTarget, staggerPhase = 'normal' }) {
  const effect = createEmptyBuffEffect({
    id: 'team-floor', kind: 'fixed', stat: 'disorderStaggerFloor', value: 140,
    applyTarget, enabledDefault: true, conditions: { damageTypes: ['disorder'] },
  })
  const fixture = eventFixture({
    mode: 'ordinary', damageType: 'disorder', effects: [effect], sourceSlot,
    agents: [testAgent('owner', { element: '电' }), testAgent('power', { element: '风' })],
    prepared: [{ id: 'prepared', skillId: 'event-skill', skillSource: 'custom', anomalyPowerAgentId: 'power', triggerAgentId: 'owner' }],
    flow: [{ id: 'flow-1', ownerAgentId: 'owner', preparedId: 'prepared', count: 1, staggerPhase, critMode: 'expected' }],
    panels: { owner: makePanel({ atk: 2200, mastery: 400 }), power: makePanel({ atk: 2600, mastery: 300 }) },
  })
  const rt = createBuffCalculationRuntime(eventRuntimeInput(fixture, { contextInput: { teamSlots: fixture.teamSlots } }))
  return rt.getHitDetail(fixture.hits[0]).evaluation.result.staggerMultiplier
}
check(
  '全队：增益挂在队友（1 号位）身上，0 号位的紊乱仍抬到 1.4',
  teamFloorZone({ sourceSlot: 1, applyTarget: 'team' }) === 1.4,
  `${teamFloorZone({ sourceSlot: 1, applyTarget: 'team' })}`,
)
check(
  '目标选「自身」时不外溢：队友的紊乱保持 1',
  teamFloorZone({ sourceSlot: 1, applyTarget: 'self' }) === 1,
  `${teamFloorZone({ sourceSlot: 1, applyTarget: 'self' })}`,
)

// 非失衡期悬停不能把敌方失衡易伤当成已生效项（与合计并排看起来自相矛盾）
const staggerTipGroups = buildEventValueTips(detail).staggerMultiplier ?? []
const enemyGroupItems = staggerTipGroups
  .filter((group) => group.label === '敌方与环境')
  .flatMap((group) => group.items)
check(
  '非失衡期悬停：敌方失衡易伤标注为仅失衡期生效，而不是直接写成已生效的基础',
  enemyGroupItems.some((item) => item.includes('非失衡期区间基础 100%')) &&
    enemyGroupItems.some((item) => item.includes('仅失衡期生效')),
  enemyGroupItems.join(' | '),
)

// 计算链路：失衡易伤区那一行要标出「原值 → 抬后」和取 max 的下限
const chainRows = buildPipelineStageRows(detail.evaluation.result)
const staggerRow = chainRows.find((row) => row.id === 'stagger')
check(
  '计算链路：失衡易伤区显示 1 → 1.4',
  staggerRow?.valueText === '1 → 1.4',
  staggerRow?.valueText,
)
check(
  '计算链路：失衡易伤区标注紊乱失衡易伤下限 1.4 与提供者',
  Boolean(staggerRow?.note?.includes('紊乱失衡易伤下限 1.4')) &&
    Boolean(staggerRow?.note?.includes('队友 · power')),
  staggerRow?.note,
)
const floorTipItems = staggerTipGroups
  .flatMap((group) => group.items)
  .filter((item) => item.startsWith('下限 1.4'))
check(
  '悬停「下限」行写出提供者（队友 · power）',
  floorTipItems.some((item) => item.includes('队友 · power')),
  floorTipItems.join(' | '),
)
check(
  '计算链路：无下限的事件不标注（与既有展示一致）',
  buildPipelineStageRows(normalBaseline.pipeline ? { pipeline: normalBaseline.pipeline } : null)
    .find((row) => row.id === 'stagger')?.note === undefined,
)

console.log(`
=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
