/**
 * 阶段 4：乘区路由接到 damageCalc；蕾米本人耀变接到 PanelViewPolicy。
 * 运行：npx vite-node scripts/test-damage-zone-routing.mjs
 */
import fs from 'node:fs'
import {
  convertEffect,
  dummyBangboo,
  fixedEffect,
  makePanel,
  makePanelCtx,
  mindscapeWithEffects,
  testAgent,
  testSlot,
} from './_effectPipelineHarness.mjs'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import {
  composeDefensePanel,
  pickResPenPanel,
  pickZonePanel,
  zoneSourceRole,
} from '../src/utils/damageZoneSourcePolicy.ts'
import {
  REMIEL_SELF_RADIANCE_VIEW_POLICY,
  resolvePanelViewPolicy,
  resolvePanelViewPolicyForRadiance,
} from '../src/utils/panelViewPolicy.ts'
import { collectRemielSelfRestrictedContributions } from '../src/utils/remielSelfRadiancePanel.ts'
import { resolveSchemePath } from './_paths.mjs'

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

const owner = makePanel({
  atk: 1000,
  dmgBonus: 0,
  penRate: 5,
  pen: 0,
  resPen: 1,
  reduceDefense: 0,
  ignoreDefense: 0,
  mastery: 0,
})
const power = makePanel({
  atk: 3000,
  dmgBonus: 50,
  penRate: 20,
  pen: 12,
  resPen: 20,
  reduceDefense: 0,
  ignoreDefense: 0,
  mastery: 80,
})
const trigger = makePanel({
  atk: 1000,
  dmgBonus: 0,
  penRate: 0,
  pen: 0,
  resPen: 30,
  reduceDefense: 40,
  ignoreDefense: 10,
  mastery: 0,
  anomalyDmgBonus: 25,
  anomalyCritRate: 10,
  anomalyCritDmg: 20,
})
const panels = { owner, powerProvider: power, anomalyTrigger: trigger }
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

console.log('\n[1] 政策表选取')
check('异常攻击取 powerProvider', zoneSourceRole('baseAtk', 'anomaly') === 'powerProvider')
check('异常增伤取 powerProvider', zoneSourceRole('dmgBonus', 'radiance') === 'powerProvider')
check('异常抗穿取 anomalyTrigger', zoneSourceRole('resPen', 'disorder') === 'anomalyTrigger')
check('直伤减防表上是 owner', zoneSourceRole('reduceDefense', 'direct') === 'owner')
check(
  'pickZonePanel 异常攻击读到 3000',
  pickZonePanel(panels, 'baseAtk', 'anomaly').atk === 3000,
)

console.log('\n[2] 防御混拼与抗穿回落（跟旧引擎，不是理想表）')
{
  const directDef = composeDefensePanel(panels, 'direct')
  check('直伤穿透仍取 owner', directDef.penRate === 5)
  check(
    '直伤减防仍取已传入的触发者面板（不是表上的 owner）',
    directDef.reduceDefense === 40 && directDef.ignoreDefense === 10,
  )
  const anomalyDef = composeDefensePanel(panels, 'anomaly')
  check('异常穿透取强度提供者', anomalyDef.penRate === 20 && anomalyDef.pen === 12)
  check('异常减防取触发者', anomalyDef.reduceDefense === 40)

  check(
    '三面板齐全时抗穿取触发者',
    pickResPenPanel(panels, 'anomaly', true).resPen === 30,
  )
  check(
    '未传触发者时抗穿回落强度提供者（不是 owner）',
    pickResPenPanel(panels, 'anomaly', false).resPen === 20,
  )
}

console.log('\n[3] computeDamageResult 三人面板数字与阶段 1 锁一致')
{
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

console.log('\n[4] 未传 anomalyTriggerPanel 时抗穿回落强度提供者')
{
  const withTrigger = computeDamageResult({
    finalPanel: owner,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    ...combat,
    staggerPhase: 'stagger',
    ownerAgentLevel: 60,
    anomalySubKind: 'anomaly',
    triggerFinalPanel: power,
    triggerAgentElement: '电',
    triggerAgentLevel: 60,
    anomalyTriggerPanel: trigger,
  })
  const noTrigger = computeDamageResult({
    finalPanel: owner,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    ...combat,
    staggerPhase: 'stagger',
    ownerAgentLevel: 60,
    anomalySubKind: 'anomaly',
    triggerFinalPanel: power,
    triggerAgentElement: '电',
    triggerAgentLevel: 60,
  })
  check(
    '有触发者时抗穿区比无触发者高 0.1（30% vs 20%）',
    Math.abs(withTrigger.resistanceMultiplier - noTrigger.resistanceMultiplier - 0.1) < 1e-3,
    `有 ${withTrigger.resistanceMultiplier} 无 ${noTrigger.resistanceMultiplier}`,
  )
  check(
    '无触发者抗穿不是 owner 的 1%',
    Math.abs(noTrigger.resistanceMultiplier - (1 - noTrigger.enemyResistance + 0.01)) > 0.05,
    `${noTrigger.resistanceMultiplier} enemyRes=${noTrigger.enemyResistance}`,
  )
}

console.log('\n[5] PanelViewPolicy 蕾米收集器与旧函数同构')
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
  const legacy = collectRemielSelfRestrictedContributions(panel, ctx, 0)
  const viaPolicy = REMIEL_SELF_RADIANCE_VIEW_POLICY.collectRestrictedContributions(panel, ctx, 0)
  check('政策 id', resolvePanelViewPolicy('remiel-self-radiance').id === 'remiel-self-radiance')
  check(
    '强度提供者=蕾米才启用本人耀变政策',
    resolvePanelViewPolicyForRadiance('remiel', 'remiel').id === 'remiel-self-radiance',
  )
  check(
    '强度提供者不是蕾米走 default',
    resolvePanelViewPolicyForRadiance('aria', 'remiel').id === 'default',
  )
  check('受限攻击与旧函数一致', viaPolicy.inCombatAtk === legacy.inCombatAtk, `${viaPolicy.inCombatAtk}`)
  check('受限精通与旧函数一致', viaPolicy.inCombatMastery === legacy.inCombatMastery)
  check('本人耀变攻击只收自身转模', Math.abs(viaPolicy.inCombatAtk - 2100) < 1e-6, `${viaPolicy.inCombatAtk}`)
}

console.log('\n[6] 蕾米真方案按名字钉（不算总伤：T9 自建招式可能缺）')
{
  const pack = JSON.parse(
    fs.readFileSync(resolveSchemePath(undefined, 'zzz-hp-schemes-2026-09-14蕾米.json'), 'utf8'),
  )
  const named = Object.values(pack.schemes).find((s) => String(s.name) === '全21薇专爱维丹')
  check('包内有「全21薇专爱维丹」', Boolean(named), named?.name ?? 'missing')
  const ids = (named?.teamSlots ?? []).map((slot) => slot.agentId)
  check('队内含 remiel', ids.includes('remiel'), ids.join(','))
  check('蕾米在 0 槽', ids[0] === 'remiel', ids[0])
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
