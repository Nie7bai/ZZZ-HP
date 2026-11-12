/**
 * 阶段模块求值（Phase 4f-3）。
 *
 * 验证运行时新增阶段：
 * - `multiplier + percentSum` 真正放大结算，并进入 pipeline 轨迹；
 * - `source + constant` 进入轨迹但不影响伤害；
 * - `combine + add` 读前序阶段值；
 * - 未知模块跳过。
 *
 * 运行：npx vite-node scripts/test-zone-stage-eval.mjs
 */
import assert from 'node:assert/strict'

import { createDefaultExternalPanel } from '../src/types/calculatorPanel.ts'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { getDamageChain } from '../src/zones/pipeline.ts'
import { previewDamageChain } from '../src/zones/preview.ts'

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

function closeTo(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= Math.max(2, expected * 1e-6), `${label}: ${actual} ≠ ${expected}`)
}

const panel = createDefaultExternalPanel()
panel.atk = 3000
panel.dmgBonus = 50
panel.critRate = 50
panel.critDmg = 100
panel.mastery = 300
panel.directDmgMult = 100

const baseInput = {
  finalPanel: panel,
  piercePower: 0,
  baseDamageSource: 'atk',
  isMbMainAgent: false,
  enemyInput: {
    defense: 794,
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
  staggerPhase: 'stagger',
  ownerAgentLevel: 60,
  anomalySubKind: 'attributeAnomaly',
}

const directChain = getDamageChain('direct')
assert.ok(directChain)

const baseline = computeDamageResult(baseInput)

function stagesWith(...extra) {
  return [...directChain.stages, ...extra]
}

console.log('[1] 新增 multiplier 阶段：percentSum 真正生效')

check('+30% → 总伤 ×1.3，轨迹含新阶段', () => {
  const result = computeDamageResult({
    ...baseInput,
    chainId: 'direct',
    chainStages: stagesWith({
      id: 'eliteBonus',
      kind: 'multiplier',
      module: 'percentSum',
      label: '对精英增伤区',
      group: 'direct',
      order: 85,
      params: { statKeys: ['eliteDmgBonus'], cap: 2 },
    }),
    combatCustom: { eliteDmgBonus: 30 },
  })
  closeTo(result.directDamageExpected, baseline.directDamageExpected * 1.3, '总伤')
  const stage = result.pipeline?.stages.find((item) => item.id === 'eliteBonus')
  assert.ok(stage, '缺少 eliteBonus 阶段')
  assert.equal(stage.value, 1.3)
  assert.equal(stage.label, '对精英增伤区')
})

check('无 custom 修饰 → 因子 1，不改变伤害', () => {
  const result = computeDamageResult({
    ...baseInput,
    chainId: 'direct',
    chainStages: stagesWith({
      id: 'eliteBonus',
      kind: 'multiplier',
      module: 'percentSum',
      label: '对精英增伤区',
      group: 'direct',
      order: 85,
      params: { statKeys: ['eliteDmgBonus'] },
    }),
  })
  assert.equal(result.directDamageExpected, baseline.directDamageExpected)
  assert.equal(result.pipeline?.stages.find((item) => item.id === 'eliteBonus')?.value, 1)
})

console.log('[2] source / combine')

check('source constant 进入轨迹但不影响伤害', () => {
  const result = computeDamageResult({
    ...baseInput,
    chainId: 'direct',
    chainStages: stagesWith({
      id: 'flatNote',
      kind: 'source',
      module: 'constant',
      label: '固定说明值',
      group: 'direct',
      order: 86,
      params: { value: 42 },
    }),
  })
  assert.equal(result.directDamageExpected, baseline.directDamageExpected)
  assert.equal(result.pipeline?.stages.find((item) => item.id === 'flatNote')?.value, 42)
})

check('combine add 读取前序阶段值', () => {
  const result = computeDamageResult({
    ...baseInput,
    chainId: 'direct',
    chainStages: stagesWith({
      id: 'sumCheck',
      kind: 'combine',
      module: 'add',
      label: '合并检查',
      group: 'direct',
      order: 87,
      inputs: ['base', 'dmg'],
    }),
  })
  const base = result.pipeline?.stages.find((item) => item.id === 'base')?.value ?? 0
  const dmg = result.pipeline?.stages.find((item) => item.id === 'dmg')?.value ?? 0
  assert.equal(result.pipeline?.stages.find((item) => item.id === 'sumCheck')?.value, base + dmg)
})

check('未知模块跳过，不影响结算', () => {
  const result = computeDamageResult({
    ...baseInput,
    chainId: 'direct',
    chainStages: stagesWith({
      id: 'unknown',
      kind: 'multiplier',
      module: 'doesNotExist',
      label: '未知',
      group: 'direct',
      order: 88,
    }),
  })
  assert.equal(result.directDamageExpected, baseline.directDamageExpected)
  assert.equal(result.pipeline?.stages.find((item) => item.id === 'unknown'), undefined)
})

check('preview：逐阶段值 + 与内置最终伤害对比', () => {
  const builtin = previewDamageChain('direct', directChain.stages)
  assert.ok(builtin.stages.length > 0)
  assert.ok(Number.isFinite(builtin.final))
  const custom = previewDamageChain('direct', [
    ...directChain.stages,
    {
      id: 'eliteBonusPreview',
      kind: 'multiplier',
      module: 'percentSum',
      label: '对精英增伤区',
      group: 'direct',
      order: 85,
      params: { statKeys: ['eliteDmgBonus'] },
    },
  ], { eliteDmgBonus: 30 })
  closeTo(custom.final, builtin.final * 1.3, '预览最终伤害')
  assert.equal(custom.stages.find((stage) => stage.id === 'eliteBonusPreview')?.value, 1.3)
})

check('preview：示例命中决定最终伤害取哪个子类', () => {
  const attributeChain = getDamageChain('attributeAnomaly')
  const disorderChain = getDamageChain('disorder')
  assert.ok(attributeChain)
  assert.ok(disorderChain)
  const attribute = previewDamageChain('attributeAnomaly', attributeChain.stages, {}, 'attributeAnomaly')
  const disorder = previewDamageChain('disorder', disorderChain.stages, {}, 'disorder')
  assert.equal(attribute.sampleId, 'attributeAnomaly')
  assert.equal(disorder.sampleId, 'disorder')
  assert.equal(attribute.sampleLabel, '属性异常')
  assert.equal(disorder.sampleLabel, '紊乱')
  // 未指定示例命中时回落到第一个（普通直伤）
  const fallback = previewDamageChain('direct', getDamageChain('direct').stages)
  assert.equal(fallback.sampleId, 'direct')
})

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
