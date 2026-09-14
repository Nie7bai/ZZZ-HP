/**
 * 阶段 1：锁死旧效果行为（转模时序、招式/失衡、双代理人乘区、蕾米特例、C1、叶琉千夹具）。
 * 运行：npx vite-node scripts/test-legacy-effect-contracts.mjs
 */
import fs from 'node:fs'
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
import { collectRemielSelfRestrictedContributions } from '../src/utils/remielSelfRadiancePanel.ts'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { pickActorId, zoneSourceRole } from '../src/utils/damageZoneSourcePolicy.ts'
import { evaluateAffixCounts, buildOptimalEvalContext } from '../src/utils/optimalAffixAlloc.ts'
import { createEmptyAffixCounts, createDefaultAffixDriveDiscMainStats } from '../src/types/calculatorPanel.ts'
import { resolveSchemePath } from './_paths.mjs'
import { SKILL_CATEGORY_OPTIONS } from '../src/types/calculator.ts'

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

console.log('\n[1] 招式标签词表')
const cats = SKILL_CATEGORY_OPTIONS.map((x) => x.id)
check(
  '六大类齐全',
  cats.join(',') === 'basic,dodge,assist,special,chain,ultimate',
  cats.join(','),
)

console.log('\n[2] 招式限定 / 失衡限定 / 槽位')
{
  const basicOnly = fixedEffect('sk-basic', 'dmgBonus', 15, {
    scope: 'skill',
    skillTargets: [{ category: 'basic', subcategoryId: null }],
  })
  const agent = testAgent('a', { mindscapeBuffs: mindscapeWithEffects([basicOnly]) })
  const base = makePanel({ dmgBonus: 10 })
  const ctxBasic = makePanelCtx({
    agents: [agent],
    skillContext: {
      damageKind: 'direct',
      categoryId: 'basic',
      subcategoryId: null,
      coords: [{ category: 'basic', subcategoryId: null }],
      element: '电',
      staggerPhase: 'stagger',
    },
  })
  const ctxUlt = {
    ...ctxBasic,
    skillContext: {
      ...ctxBasic.skillContext,
      categoryId: 'ultimate',
      coords: [{ category: 'ultimate', subcategoryId: null }],
    },
  }
  const hitBasic = computeFinalPanel(base, ctxBasic)
  const hitUlt = computeFinalPanel(base, ctxUlt)
  check('普攻吃到 +15 增伤', Math.abs(hitBasic.finalPanel.dmgBonus - 25) < 1e-6, `${hitBasic.finalPanel.dmgBonus}`)
  check('终结技不吃普攻限定', Math.abs(hitUlt.finalPanel.dmgBonus - 10) < 1e-6, `${hitUlt.finalPanel.dmgBonus}`)

  const staggerOnly = fixedEffect('stg', 'critRate', 20, { applySituation: 'stagger' })
  const agent2 = testAgent('a', { mindscapeBuffs: mindscapeWithEffects([staggerOnly]) })
  const ctxSt = makePanelCtx({
    agents: [agent2],
    skillContext: { ...ctxBasic.skillContext, staggerPhase: 'stagger' },
  })
  const ctxN = makePanelCtx({
    agents: [agent2],
    skillContext: { ...ctxBasic.skillContext, staggerPhase: 'normal' },
  })
  const p = makePanel({ critRate: 5 })
  check('失衡期 +20 暴击', Math.abs(computeFinalPanel(p, ctxSt).finalPanel.critRate - 25) < 1e-6)
  check('非失衡不加', Math.abs(computeFinalPanel(p, ctxN).finalPanel.critRate - 5) < 1e-6)

  const teamAtk = fixedEffect('team-atk', 'atk', 100, { applyTarget: 'team' })
  const agents = [
    testAgent('a'),
    testAgent('b', { mindscapeBuffs: mindscapeWithEffects([teamAtk]), name: 'b' }),
  ]
  const ctxSlot = makePanelCtx({
    teamSlots: [testSlot('a'), testSlot('b')],
    agents,
    mainSlotIndex: 0,
  })
  const withTeam = computeFinalPanel(makePanel({ atk: 2000 }), ctxSlot)
  check('槽位0吃到队友的 team 攻击', Math.abs(withTeam.finalPanel.atk - 2100) < 1e-6, `${withTeam.finalPanel.atk}`)
}

console.log('\n[3] 转模 external / final / manual 与防环')
{
  const addMastery = fixedEffect('add-mas', 'mastery', 50)
  const convFinal = convertEffect('cv-final', 'atk', {
    from: 'mastery',
    panelSource: 'final',
    ratioPercent: 100,
    initialBase: 0,
  })
  const convExt = convertEffect('cv-ext', 'atk', {
    from: 'mastery',
    panelSource: 'external',
    ratioPercent: 100,
    initialBase: 0,
  })
  const convManual = convertEffect('cv-man', 'atk', {
    from: 'mastery',
    panelSource: 'manual',
    ratioPercent: 100,
    defaultBase: 40,
    initialBase: 0,
  })

  const panel = makePanel({ atk: 2000, mastery: 100 })
  const mk = (effects) =>
    makePanelCtx({
      agents: [testAgent('a', { mindscapeBuffs: mindscapeWithEffects(effects) })],
    })

  const onlyExt = computeFinalPanel(panel, mk([convExt]))
  check('external 转模读局外精通 100', Math.abs(onlyExt.finalPanel.atk - 2100) < 1e-6, `${onlyExt.finalPanel.atk}`)

  const withFinal = computeFinalPanel(panel, mk([addMastery, convFinal]))
  check(
    'final 转模读局内精通 150',
    Math.abs(withFinal.finalPanel.atk - 2150) < 1e-6,
    `${withFinal.finalPanel.atk}`,
  )

  const onlyFinalNoAdd = computeFinalPanel(panel, mk([convFinal]))
  check(
    'final 无局内加成就等于局外 100',
    Math.abs(onlyFinalNoAdd.finalPanel.atk - 2100) < 1e-6,
    `${onlyFinalNoAdd.finalPanel.atk}`,
  )

  const manual = computeFinalPanel(panel, mk([convManual]))
  check('manual 用 defaultBase 40', Math.abs(manual.finalPanel.atk - 2040) < 1e-6, `${manual.finalPanel.atk}`)

  const selfAtkConvert = convertEffect('cv-atk-atk', 'atk', {
    from: 'atk',
    panelSource: 'final',
    ratioPercent: 10,
    initialBase: 0,
  })
  const loop = computeFinalPanel(panel, mk([selfAtkConvert]))
  const expectedNoLoop = 2000 + 2000 * 0.1
  check(
    '同轮转模不吃自己产出的攻击',
    Math.abs(loop.finalPanel.atk - expectedNoLoop) < 1e-6,
    `${loop.finalPanel.atk} 期望 ${expectedNoLoop}`,
  )
}

console.log('\n[4] 蕾米本人耀变来源集合（合成：自身转模 + 排除队友/邦布）')
{
  const selfConvert = convertEffect('rem-atk', 'atk', {
    from: 'mastery',
    panelSource: 'external',
    ratioPercent: 50,
    initialBase: 0,
  })
  const teamAtk = fixedEffect('mate-atk', 'atk', 400, { applyTarget: 'team' })
  const remiel = testAgent('remiel', {
    name: '蕾米',
    profession: '异常',
    element: '以太',
    mindscapeBuffs: mindscapeWithEffects([selfConvert]),
  })
  const mate = testAgent('mate', { mindscapeBuffs: mindscapeWithEffects([teamAtk]) })
  const bangboo = {
    ...dummyBangboo(),
    id: 'bb',
    name: '邦布',
    effects: [fixedEffect('bb-atk', 'atk', 80, { applyTarget: 'team' })],
  }
  const panel = makePanel({ atk: 2000, mastery: 200 })
  const ctx = makePanelCtx({
    teamSlots: [testSlot('remiel'), testSlot('mate')],
    agents: [remiel, mate],
    bangboo,
    mainSlotIndex: 0,
  })
  const full = computeFinalPanel(panel, ctx)
  const restricted = computeFinalPanel(panel, {
    ...ctx,
    restrictToSlotIndex: 0,
    excludeBangboo: true,
  })
  check('完整局内含队友+邦布攻击', full.finalPanel.atk > restricted.finalPanel.atk + 400)
  check(
    'restrictToSlot 不含队友/邦布固定攻击',
    Math.abs(restricted.finalPanel.atk - (2000 + 100)) < 1e-6,
    `${restricted.finalPanel.atk}`,
  )
  const contrib = collectRemielSelfRestrictedContributions(panel, ctx, 0)
  check(
    '本人耀变攻击只收自身转模',
    Math.abs(contrib.inCombatAtk - (2000 + 100)) < 1e-6,
    `${contrib.inCombatAtk}`,
  )
  check('本人耀变攻击条目不含队友/邦布', contrib.atkItems.every((s) => !s.includes('邦布') && !s.includes('mate')))
}

console.log('\n[5] 双代理人乘区（三人不同面板）')
{
  const roles = { owner: 'owner', powerProvider: 'power', anomalyTrigger: 'trigger' }
  check('直伤增伤取 owner', zoneSourceRole('dmgBonus', 'direct') === 'owner')
  check('异常增伤取 powerProvider', zoneSourceRole('dmgBonus', 'anomaly') === 'powerProvider')
  check('异常抗穿取 anomalyTrigger', zoneSourceRole('resPen', 'anomaly') === 'anomalyTrigger')
  check('异常减防取 anomalyTrigger', zoneSourceRole('reduceDefense', 'anomaly') === 'anomalyTrigger')
  check('异常精通取 powerProvider', zoneSourceRole('mastery', 'anomaly') === 'powerProvider')
  check('元素取 powerProvider', pickActorId(roles, 'element', 'radiance') === 'power')

  const owner = makePanel({ atk: 1000, dmgBonus: 0, penRate: 0, resPen: 0, reduceDefense: 0, mastery: 0 })
  const power = makePanel({ atk: 3000, dmgBonus: 50, penRate: 20, resPen: 0, reduceDefense: 0, mastery: 80 })
  const trigger = makePanel({
    atk: 1000,
    dmgBonus: 0,
    penRate: 0,
    resPen: 30,
    reduceDefense: 40,
    mastery: 0,
    anomalyDmgBonus: 25,
    anomalyCritRate: 10,
    anomalyCritDmg: 20,
  })
  const enemy = {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
  }
  const combat = {
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
  }
  const anomalyKinds = ['anomaly', 'disorder', 'turbulence', 'anomalyRelease', 'radiance']
  for (const kind of anomalyKinds) {
    const r = computeDamageResult({
      finalPanel: owner,
      piercePower: 0,
      baseDamageSource: 'atk',
      isMbMainAgent: false,
      enemyInput: enemy,
      ...combat,
      staggerPhase: 'stagger',
      ownerAgentLevel: 60,
      anomalySubKind: kind,
      triggerFinalPanel: power,
      triggerAgentElement: '电',
      triggerAgentLevel: 60,
      anomalyTriggerPanel: trigger,
      anomalyTriggerElement: '火',
    })
    check(`${kind} 攻击区用强度提供者`, r.baseDamage === 3000, `${r.baseDamage}`)
    check(`${kind} 通用增伤区用强度提供者 50%`, r.dmgMultiplier === 1.5, `${r.dmgMultiplier}`)
  }
}

console.log('\n[6] C1 重叠键只加一次（旧评估入口）')
{
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
  const zeros = createEmptyAffixCounts()
  const base = evaluateAffixCounts(ctx, zeros)
  const plus = evaluateAffixCounts(ctx, zeros, { penRate: 24 })
  check(
    '+24 穿透只进局内一次',
    Math.abs(plus.finalPanel.penRate - base.finalPanel.penRate - 24) < 1e-6,
    `${base.finalPanel.penRate} → ${plus.finalPanel.penRate}`,
  )
  const plusDmg = evaluateAffixCounts(ctx, zeros, { dmgBonus: 30 })
  check(
    '+30 增伤只进局内一次',
    Math.abs(plusDmg.finalPanel.dmgBonus - base.finalPanel.dmgBonus - 30) < 1e-6,
    `${base.finalPanel.dmgBonus} → ${plusDmg.finalPanel.dmgBonus}`,
  )
}

console.log('\n[7] 叶琉千夹具钉死方案名')
{
  const pack = JSON.parse(fs.readFileSync(resolveSchemePath(undefined, 'zzz-hp-schemes-2026-09-14叶琉千.json'), 'utf8'))
  const named = Object.values(pack.schemes).find((s) => String(s.name).includes('21叶琉千——叶释渊'))
  check('包内有「21叶琉千——叶释渊」', Boolean(named), named?.name ?? 'missing')
  const first = Object.values(pack.schemes)[0]
  check(
    '夹具按方案名取，不按 JSON 对象顺序',
    Boolean(named) && String(named.name).includes('21叶琉千——叶释渊'),
    `named=${named?.name ?? 'missing'}; Object.values()[0]=${first?.name}`,
  )
  if (first?.name === named?.name) {
    console.log(
      '  NOTE  本机这份 JSON 的第一个方案恰好就是 21 叶琉千；bench-solve 仍取 Object.values()[0]，测试不得把这个巧合当契约',
    )
  }
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
