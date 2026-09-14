/**
 * 阶段 5：词条库评估输入走适配器分桶（counts / panelDeltas / extraGains）。
 * 运行：npx vite-node scripts/test-affix-eval-adapter.mjs
 */
import { createEmptyAffixCounts, createDefaultAffixDriveDiscMainStats, createEmptyExternalPanel } from '../src/types/calculatorPanel.ts'
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import {
  createDefaultAffixLibrary,
  entryRollsToEvalInput,
  extraGainFromLibraryEntry,
} from '../src/utils/affixLibrary.ts'
import { entryRollsToEffectEvalInput } from '../src/utils/affixEffectEval.ts'
import { computeAffixBenefitTable } from '../src/utils/affixBenefitAnalysis.ts'
import {
  buildOptimalEvalContext,
  clearAffixEvalCache,
  evaluateAffixCounts,
  evaluateOptimalEventDetail,
  withAffixLibraryExtraGains,
} from '../src/utils/optimalAffixAlloc.ts'
import { affixEntry } from './_effectPipelineHarness.mjs'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function skillCtx(categoryId) {
  return {
    damageKind: 'direct',
    categoryId,
    subcategoryId: null,
    coords: [{ category: categoryId, subcategoryId: null }],
    element: '电',
    staggerPhase: 'stagger',
    isFollowUp: false,
  }
}

function makeCtx(overrides = {}) {
  return buildOptimalEvalContext({
    isMb: false,
    isFengYu: false,
    teamSlots: [
      { agentId: 'a', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    ],
    agents: [
      {
        id: 'a',
        name: '测试',
        element: '电',
        profession: '强攻',
        basePanel: {
          ...createEmptyAgentBasePanel(),
          hp: 9000,
          atk: 900,
          def: 700,
          critRate: 5,
          critDmg: 50,
          anomalyControl: 100,
          energyRegen: 120,
          directDmgMult: 100,
          anomalyMult: 125,
        },
      },
    ],
    wengines: [],
    bangboo: null,
    bangbooRefine: 1,
    mainSlotIndex: 0,
    driveDiscs: [],
    driveDiscSelection: { twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
    enemyInput: {
      level: 70,
      defense: 952.8,
      resistanceType: 'normal',
      vulnerableMultiplier: 1,
      staggerMultiplier: 1.5,
      specialMultiplier: 1,
    },
    baseDamageSource: 'atk',
    skillContext: skillCtx('basic'),
    hits: undefined,
    ...overrides,
  })
}

const zeros = createEmptyAffixCounts()

function sameEvalInput(a, b) {
  return (
    JSON.stringify(a.counts) === JSON.stringify(b.counts) &&
    JSON.stringify(a.deltas) === JSON.stringify(b.deltas) &&
    JSON.stringify(a.extraGains) === JSON.stringify(b.extraGains)
  )
}

console.log('\n[1] 默认库：适配器分桶与 entryRollsToEvalInput 同构')
{
  const lib = createDefaultAffixLibrary()
  const rolls = { 'substat:atkPercent': 6, 'substat:critRate': 4 }
  const viaLib = entryRollsToEvalInput(lib, rolls)
  const viaAdapter = entryRollsToEffectEvalInput(lib, rolls)
  check('counts / deltas / extraGains 一致', sameEvalInput(viaLib, viaAdapter))
  check('默认库 extraGains 为空', viaLib.extraGains.length === 0)
  check('默认库不写十格计数桶', Object.keys(viaLib.counts).length === 0)
  check('atkPercent / critRate 进局外增量', (viaLib.deltas.atkPercent ?? 0) > 0 && (viaLib.deltas.critRate ?? 0) > 0)
}

console.log('\n[2] C1：panel:penRate 只加局外一次')
{
  const ctx = makeCtx()
  const panelPen = affixEntry('p', 'panel:penRate', 24)
  const input = entryRollsToEvalInput([panelPen], { p: 1 })
  check('panel: 不进 extraGains', input.extraGains.length === 0)
  check('panel: 写进 deltas.penRate', input.deltas.penRate === 24)
  check('适配器同构', sameEvalInput(input, entryRollsToEffectEvalInput([panelPen], { p: 1 })))

  clearAffixEvalCache()
  const base = evaluateAffixCounts(ctx, zeros)
  const viaFlat = evaluateAffixCounts(ctx, zeros, { penRate: 24 })
  const viaLib = evaluateAffixCounts(ctx, zeros, input.deltas, input.valuePerCount, input.extraGains)
  check(
    '扁平 { penRate:24 } 局内只 +24',
    Math.abs(viaFlat.finalPanel.penRate - base.finalPanel.penRate - 24) < 1e-6,
    `${base.finalPanel.penRate} → ${viaFlat.finalPanel.penRate}`,
  )
  check(
    '库路径 panel:penRate 与扁平袋同数',
    Math.abs(viaLib.finalPanel.penRate - viaFlat.finalPanel.penRate) < 1e-6,
    `${viaLib.finalPanel.penRate} vs ${viaFlat.finalPanel.penRate}`,
  )
}

console.log('\n[3] T1 新能力：panel:penRate + gain:penRate = 48（标明，不进默认库）')
{
  const ctx = makeCtx()
  const panelPen = affixEntry('p', 'panel:penRate', 24)
  const gainPen = affixEntry('g', 'gain:penRate', 24)
  const input = entryRollsToEvalInput([panelPen, gainPen], { p: 1, g: 1 })
  check('两条分进 deltas 与 extraGains', input.deltas.penRate === 24 && input.extraGains.length === 1)
  check(
    '适配器同构',
    sameEvalInput(input, entryRollsToEffectEvalInput([panelPen, gainPen], { p: 1, g: 1 })),
  )
  clearAffixEvalCache()
  const base = evaluateAffixCounts(ctx, zeros)
  const both = evaluateAffixCounts(ctx, zeros, input.deltas, input.valuePerCount, input.extraGains)
  check(
    '两实例并存局内 +48',
    Math.abs(both.finalPanel.penRate - base.finalPanel.penRate - 48) < 1e-6,
    `${base.finalPanel.penRate} → ${both.finalPanel.penRate}`,
  )
}

console.log('\n[4] gain:inCombatAtkPercent 走 extraGains，与页级 extraGains 同伤')
{
  const ctx = makeCtx()
  const entry = affixEntry('g', 'gain:inCombatAtkPercent', 4)
  const input = entryRollsToEvalInput([entry], { g: 1 })
  check('gain: 不写进 deltas', input.deltas.inCombatAtkPercent == null)
  check('gain: 合成一条 extraGain', input.extraGains.length === 1 && input.extraGains[0].value === 4)

  const viaLib = evaluateAffixCounts(ctx, zeros, input.deltas, input.valuePerCount, input.extraGains)
  const viaPage = evaluateAffixCounts(
    makeCtx({ extraGains: input.extraGains }),
    zeros,
  )
  check(
    '库 extraGains 与页级 extraGains 总伤一致',
    Math.abs(viaLib.grandTotal - viaPage.grandTotal) < 1e-6,
    `${viaLib.grandTotal} vs ${viaPage.grandTotal}`,
  )

  const table = computeAffixBenefitTable({
    ctx,
    baseCounts: zeros,
    entries: [entry],
    includeSeries: false,
  })
  check('收益表 gain: 仍有正收益', table.rows[0].percentDelta > 0, `+${table.rows[0].percentDelta.toFixed(3)}%`)
}

console.log('\n[5] 普攻 +15% 增伤：只改普攻，终结技不变')
{
  const entry = {
    ...affixEntry('basic-dmg', 'gain:dmgBonus', 15),
    scope: 'skill',
    skillCategory: 'basic',
  }
  const input = entryRollsToEvalInput([entry], { 'basic-dmg': 1 })
  const gain = extraGainFromLibraryEntry(entry, 1)
  check('条件写进 extraGain', gain?.scope === 'skill' && gain.skillCategory === 'basic')
  check('适配器带招式条件', sameEvalInput(input, entryRollsToEffectEvalInput([entry], { 'basic-dmg': 1 })))

  const ctxBasic = makeCtx({ skillContext: skillCtx('basic') })
  const ctxUlt = makeCtx({ skillContext: skillCtx('ultimate') })
  clearAffixEvalCache()
  const basicBase = evaluateAffixCounts(ctxBasic, zeros)
  const basicPlus = evaluateAffixCounts(
    ctxBasic,
    zeros,
    input.deltas,
    input.valuePerCount,
    input.extraGains,
  )
  const ultBase = evaluateAffixCounts(ctxUlt, zeros)
  const ultPlus = evaluateAffixCounts(ctxUlt, zeros, input.deltas, input.valuePerCount, input.extraGains)
  check(
    '普攻吃到 +15 增伤',
    Math.abs(basicPlus.finalPanel.dmgBonus - basicBase.finalPanel.dmgBonus - 15) < 1e-6,
    `${basicBase.finalPanel.dmgBonus} → ${basicPlus.finalPanel.dmgBonus}`,
  )
  check(
    '终结技不吃普攻限定',
    Math.abs(ultPlus.finalPanel.dmgBonus - ultBase.finalPanel.dmgBonus) < 1e-6,
    `${ultBase.finalPanel.dmgBonus} → ${ultPlus.finalPanel.dmgBonus}`,
  )
  check('普攻总伤上升', basicPlus.grandTotal > basicBase.grandTotal)
  check('终结技总伤不变', Math.abs(ultPlus.grandTotal - ultBase.grandTotal) < 1e-6)

  const tableBasic = computeAffixBenefitTable({
    ctx: ctxBasic,
    baseCounts: zeros,
    entries: [entry],
    includeSeries: false,
  })
  const tableUlt = computeAffixBenefitTable({
    ctx: ctxUlt,
    baseCounts: zeros,
    entries: [entry],
    includeSeries: false,
  })
  check('收益表（普攻上下文）有正收益', tableBasic.rows[0].percentDelta > 0)
  check(
    '收益表（终结技上下文）收益为 0',
    Math.abs(tableUlt.rows[0].percentDelta) < 1e-9,
    `${tableUlt.rows[0].percentDelta}`,
  )
}

console.log('\n[6] extraGains 进每评估键，不串缓存')
{
  const ctx = makeCtx()
  const entry = affixEntry('g', 'gain:inCombatAtkPercent', 4)
  const input = entryRollsToEvalInput([entry], { g: 1 })
  clearAffixEvalCache()
  const withGain = evaluateAffixCounts(ctx, zeros, undefined, undefined, input.extraGains)
  const without = evaluateAffixCounts(ctx, zeros)
  const withGainAgain = evaluateAffixCounts(ctx, zeros, undefined, undefined, input.extraGains)
  check('有/无 extraGains 总伤不同', withGain.grandTotal !== without.grandTotal)
  check(
    '再评估有 extraGains 仍命中自己的缓存而不是空增益',
    Math.abs(withGainAgain.grandTotal - withGain.grandTotal) < 1e-6,
  )
}

console.log('\n[7] 流程明细必须并入 gain: 局内防御，不能只叠局外面板')
{
  const hit = {
    id: 'h0',
    skill: {
      id: 's0',
      name: '锐化',
      damageType: 'direct',
      element: '电',
      category: 'basic',
      subcategoryId: null,
      mult: 300,
    },
    ownerAgentId: 'a',
    anomalyPowerAgentId: null,
    triggerAgentId: null,
    count: 1,
    staggerPhase: 'stagger',
    critMode: 'expected',
    damageKind: 'direct',
    anomalySubKind: null,
    coords: [{ category: 'basic', subcategoryId: null }],
    isFollowUp: false,
    multOverrides: { directDmgMult: 300 },
    panelMods: null,
  }
  const panel = { ...createEmptyExternalPanel(), def: 2000, atk: 1000, hp: 9000, critRate: 50, critDmg: 80 }
  const ctx = makeCtx({
    isFengYu: true,
    baseDamageSource: 'def',
    hits: [hit],
    activeSlotPanels: { a: panel },
    agents: [
      {
        id: 'a',
        name: '测试',
        element: '电',
        profession: '锋御',
        basePanel: {
          ...createEmptyAgentBasePanel(),
          hp: 9000,
          atk: 900,
          def: 700,
          critRate: 5,
          critDmg: 50,
          anomalyControl: 100,
          energyRegen: 120,
          directDmgMult: 100,
          anomalyMult: 125,
        },
      },
    ],
  })
  const entry = affixEntry('in-def', 'gain:inCombatDefPercent', 30)
  const input = entryRollsToEvalInput([entry], { 'in-def': 1 })
  clearAffixEvalCache()
  const evaled = evaluateAffixCounts(ctx, zeros, input.deltas, input.valuePerCount, input.extraGains)
  const flowBare = evaluateOptimalEventDetail(ctx, evaled.external, hit)
  const flowMerged = evaluateOptimalEventDetail(
    withAffixLibraryExtraGains(ctx, input.extraGains),
    evaled.external,
    hit,
  )
  const flowMergedNumbers = evaluateOptimalEventDetail(
    withAffixLibraryExtraGains(ctx, input.extraGains),
    evaled.external,
    hit,
    { includeDetails: false },
  )
  check('收益评估局内防御高于局外', evaled.finalPanel.def > evaled.external.def, `${evaled.external.def} → ${evaled.finalPanel.def}`)
  check(
    '未并 extraGains 的流程明细吃不到局内防御',
    flowBare != null && Math.abs(flowBare.finalPanel.def - evaled.external.def) < 1e-6,
    `${flowBare?.finalPanel.def} vs 局外 ${evaled.external.def}`,
  )
  check(
    '并入后流程明细与评估同局内防御',
    flowMerged != null && Math.abs(flowMerged.finalPanel.def - evaled.finalPanel.def) < 1e-6,
    `${flowMerged?.finalPanel.def} vs ${evaled.finalPanel.def}`,
  )
  check(
    '并入后流程总伤与评估一致',
    flowMerged != null && Math.abs(flowMerged.total - evaled.grandTotal) < 1e-6,
    `${flowMerged?.total} vs ${evaled.grandTotal}`,
  )
  check(
    '明细口径与数字口径总伤一致（详情面板 vs 流程 hit map）',
    flowMerged != null &&
      flowMergedNumbers != null &&
      Math.abs(flowMerged.total - flowMergedNumbers.total) < 1e-6,
    `${flowMerged?.total} vs ${flowMergedNumbers?.total}`,
  )
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
