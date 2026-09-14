/**
 * 阶段 3：新管线与旧 computeFinalPanel / evaluateAffixCounts 双跑。
 * 运行：npx vite-node scripts/test-panel-pipeline-dual-run.mjs
 */
import {
  affixEntry,
  convertEffect,
  dummyBangboo,
  fixedEffect,
  makePanel,
  makePanelCtx,
  mindscapeWithEffects,
  testAgent,
  testSlot,
} from './_effectPipelineHarness.mjs'
import { computeFinalPanel } from '../src/utils/panelBuffCalc.ts'
import {
  allocateAffixEffects,
  applyAllocatedAffixEffects,
  diffSnapshots,
  remapImportedPanelViaEffects,
  runPanelPipeline,
  snapshotPanel,
} from '../src/utils/panelPipeline.ts'
import { evaluateAffixCounts, buildOptimalEvalContext } from '../src/utils/optimalAffixAlloc.ts'
import {
  createEmptyAffixCounts,
  createDefaultAffixDriveDiscMainStats,
  createEmptyExternalPanel,
} from '../src/types/calculatorPanel.ts'
import { remapImportedExternalPanelForMainCombo } from '../src/utils/affixPanelCalc.ts'
import { computeDamageResult } from '../src/utils/damageCalc.ts'

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

console.log('\n[1] runPanelPipeline 与 computeFinalPanel 逐字段')
{
  const add = fixedEffect('atk%', 'inCombatAtkPercent', 10)
  const cv = convertEffect('cv', 'atk', {
    from: 'mastery',
    panelSource: 'final',
    ratioPercent: 50,
    initialBase: 0,
  })
  const ctx = makePanelCtx({
    agents: [testAgent('a', { mindscapeBuffs: mindscapeWithEffects([add, cv]) })],
  })
  const panel = makePanel({ atk: 2000, mastery: 80 })
  const legacy = computeFinalPanel(panel, ctx)
  const pipe = runPanelPipeline(panel, ctx)
  const diffs = diffSnapshots(snapshotPanel(legacy.finalPanel), snapshotPanel(pipe.finalBreakdown.finalPanel))
  check('final 面板一致', diffs.length === 0, diffs.join('; ') || 'ok')
  check(
    'totalMods 一致',
    JSON.stringify(legacy.totalMods) === JSON.stringify(pipe.finalBreakdown.totalMods),
  )
  check(
    'combatMods 一致',
    JSON.stringify(legacy.combatMods) === JSON.stringify(pipe.finalBreakdown.combatMods),
  )
  const enemy = {
    level: 60,
    defense: 952.8,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1.5,
    specialMultiplier: 1,
  }
  const dmgOf = (b) =>
    computeDamageResult({
      finalPanel: b.finalPanel,
      piercePower: 0,
      baseDamageSource: 'atk',
      isMbMainAgent: false,
      enemyInput: enemy,
      combatVulnerable: b.combatMods.vulnerable,
      combatDirectVulnerable: b.combatMods.directVulnerable,
      combatAnomalyVulnerable: b.combatMods.anomalyVulnerable,
      combatDmgReduction: b.combatMods.dmgReduction,
      combatDirectDmgReduction: b.combatMods.directDmgReduction,
      combatAnomalyDmgReduction: b.combatMods.anomalyDmgReduction,
      combatGlobalStaggerVulnerable: b.combatMods.globalStaggerVulnerable,
      combatStaggerVulnerable: b.combatMods.staggerVulnerable,
      combatStaggerVulnerableOnly: b.combatMods.staggerVulnerableOnly,
      combatSpecial: b.combatMods.special,
      combatPierceDmgBonus: b.combatMods.pierceDmgBonus,
      combatSharpenDmgBonus: b.combatMods.sharpenDmgBonus,
      combatSharpenCritDmgBonus: b.combatMods.sharpenCritDmgBonus,
      combatDmgPenalty: b.combatMods.dmgPenalty,
      staggerPhase: 'stagger',
      ownerAgentLevel: 60,
    })
  const dmgLegacy = dmgOf(legacy)
  const dmgPipe = dmgOf(pipe.finalBreakdown)
  check(
    '直伤期望一致',
    dmgLegacy.directDamageExpected === dmgPipe.directDamageExpected,
    `${dmgLegacy.directDamageExpected} vs ${dmgPipe.directDamageExpected}`,
  )
  check('preConvert 攻击已含局内攻击%', pipe.preConvertPanel.atk > 2000)
  check('plan 含 convert', pipe.plan.byStage.convert.length >= 1)
}

console.log('\n[2] 词条 plan 不再扁平双算 penRate')
{
  const entries = [
    affixEntry('panel-pen', 'panel:penRate', 24),
    affixEntry('gain-pen', 'gain:penRate', 24),
  ]
  const allocated = allocateAffixEffects(entries, { 'panel-pen': 1, 'gain-pen': 1 })
  const applied = applyAllocatedAffixEffects(makePanel({ penRate: 0 }), allocated, {
    anomalyControl: 94,
    energyRegen: 1.2,
  }, 0)
  check('局外只加 panel: 的 24', Math.abs(applied.external.penRate - 24) < 1e-6, `${applied.external.penRate}`)
  check('gain:penRate 走 extraGains', applied.extraGains.some((g) => g.stat === 'penRate' && g.value === 24))
  check(
    '两实例不同 stage',
    applied.plan.byStage.external.length === 1 && applied.plan.byStage.combatPreConvert.length === 1,
  )

  const evalBase = {
    isMb: false,
    isFengYu: false,
    teamSlots: [testSlot('a')],
    agents: [testAgent('a')],
    wengines: [],
    bangboo: dummyBangboo(),
    bangbooRefine: 1,
    driveDiscs: [],
    mainSlotIndex: 0,
    driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
    enemyInput: {
      level: 60,
      defense: 952.8,
      resistanceType: 'normal',
      vulnerableMultiplier: 1,
      staggerMultiplier: 1.5,
      specialMultiplier: 1,
    },
    baseDamageSource: 'atk',
    skillContext: { element: '电', staggerPhase: 'stagger', damageKind: 'direct' },
  }
  const ctxNew = buildOptimalEvalContext({
    ...evalBase,
    extraGains: applied.extraGains,
    activeSlotPanels: { a: applied.external },
  })
  const evalNew = evaluateAffixCounts(ctxNew, createEmptyAffixCounts())
  check(
    '新能力探针：panel: + gain: 两实例可到 48（阶段 5 才进现网库）',
    Math.abs(evalNew.finalPanel.penRate - 48) < 1e-6,
    `${evalNew.finalPanel.penRate}`,
  )

  const ctxOld = buildOptimalEvalContext(evalBase)
  const oldOverlap = evaluateAffixCounts(ctxOld, createEmptyAffixCounts(), { penRate: 24 })
  check(
    '旧扁平袋 +24 仍只当局外（C1 闸门）',
    Math.abs(oldOverlap.finalPanel.penRate - 24) < 1e-6,
    `旧 ${oldOverlap.finalPanel.penRate}`,
  )
  check(
    '新旧不是同一条路：48 ≠ 24',
    Math.abs(oldOverlap.finalPanel.penRate - evalNew.finalPanel.penRate) > 1,
    `旧 ${oldOverlap.finalPanel.penRate} 新 ${evalNew.finalPanel.penRate}`,
  )
}

console.log('\n[3] 仅 panel:penRate 新旧评估一致')
{
  const entries = [affixEntry('panel-pen', 'panel:penRate', 24)]
  const allocated = allocateAffixEffects(entries, { 'panel-pen': 1 })
  const base = makePanel({ penRate: 0 })
  const applied = applyAllocatedAffixEffects(base, allocated, { anomalyControl: 0, energyRegen: 0 }, 0)
  const ctx = buildOptimalEvalContext({
    isMb: false,
    isFengYu: false,
    teamSlots: [testSlot('a')],
    agents: [testAgent('a')],
    wengines: [],
    bangboo: dummyBangboo(),
    bangbooRefine: 1,
    driveDiscs: [],
    mainSlotIndex: 0,
    driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
    enemyInput: {
      level: 60,
      defense: 952.8,
      resistanceType: 'normal',
      vulnerableMultiplier: 1,
      staggerMultiplier: 1.5,
      specialMultiplier: 1,
    },
    baseDamageSource: 'atk',
    skillContext: { element: '电', staggerPhase: 'stagger', damageKind: 'direct' },
  })
  const legacy = evaluateAffixCounts(ctx, createEmptyAffixCounts(), { penRate: 24 })
  const next = evaluateAffixCounts(
    { ...ctx, extraGains: applied.extraGains },
    createEmptyAffixCounts(),
    undefined,
  )
  check('仅 panel 时新路径局外 24', Math.abs(applied.external.penRate - 24) < 1e-6)
  check(
    '仅 panel 时旧评估局内 +24',
    Math.abs(legacy.finalPanel.penRate - 24) < 1e-6,
    `${legacy.finalPanel.penRate}`,
  )
  check(
    '仅 panel 时新路径没有多余 extraGains',
    applied.extraGains.length === 0,
    `${applied.extraGains.length}`,
  )
  void next
}

console.log('\n[4] 导入面板换主属性钩子对齐 remap')
{
  const panel = { ...createEmptyExternalPanel(), atk: 3000, critDmg: 100, dmgBonus: 30 }
  const mains = {
    slot4MainStat: 'critDmg',
    slot5MainStat: 'dmgBonus',
    slot6MainStat: '',
  }
  const input = {
    panel,
    fromMains: mains,
    toMains: { ...mains, slot4MainStat: 'critRate' },
    fromTwoPieceId: 'none',
    toTwoPieceId: 'none',
    fourPieceDriveDiscId: 'none',
    driveDiscs: [],
    agentHp: 10000,
    atkBase: 2000,
    agentDef: 800,
    anomalyControlBase: 100,
    energyRegenBase: 1.2,
  }
  const a = remapImportedExternalPanelForMainCombo(input)
  const b = remapImportedPanelViaEffects(input)
  const diffs = diffSnapshots(snapshotPanel(a), snapshotPanel(b))
  check('ViaEffects 与字段加减对照逐字段一致', diffs.length === 0, diffs.join('; ') || 'ok')
  check('换成暴击后爆伤下降', b.critDmg < panel.critDmg)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
