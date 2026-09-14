/**
 * 阶段 6：角色影画走 EffectSpec 往返，与旧 resolvePackMods 逐字段双跑。
 * 运行：npx vite-node scripts/test-agent-buff-effect-adapt.mjs
 */
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import {
  adaptBuffEffect,
  effectInstanceToBuffEffect,
  instantiateBuffEffect,
} from '../src/utils/effectAdapters.ts'
import {
  collectAllBuffEffects,
  computeFinalPanel,
  resolvePackModsDirect,
  resolvePackModsViaEffectSpec,
} from '../src/utils/panelBuffCalc.ts'
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

function sameMods(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (Math.abs((a[key] ?? 0) - (b[key] ?? 0)) > 1e-9) return `${key}: ${a[key]} vs ${b[key]}`
  }
  return null
}

function dual(name, effects, ctx, isMain = true, slotIndex = 0) {
  const direct = resolvePackModsDirect(effects, isMain, ctx, slotIndex)
  const via = resolvePackModsViaEffectSpec(effects, isMain, ctx, slotIndex)
  const diff = sameMods(direct, via)
  check(name, diff == null, diff || `dmgBonus=${via.dmgBonus}`)
  return { direct, via }
}

const agents = [
  testAgent('a', { profession: '强攻', name: '甲' }),
  testAgent('b', { profession: '支援', name: '乙' }),
]
const teamSlots = [testSlot('a'), testSlot('b')]

function ctxWith(skillExtra = {}, ctxExtra = {}) {
  return makePanelCtx({
    teamSlots,
    agents,
    bangboo: dummyBangboo(),
    skillContext: {
      damageKind: 'direct',
      categoryId: 'basic',
      subcategoryId: null,
      coords: [{ category: 'basic', subcategoryId: null }],
      element: '电',
      staggerPhase: 'stagger',
      isFollowUp: false,
      ...skillExtra,
    },
    ...ctxExtra,
  })
}

console.log('\n[1] 往返不读 legacyBuffEffect')
{
  const fx = fixedEffect('keep', 'dmgBonus', 12, {
    scope: 'skill',
    skillTargets: [{ category: 'basic', subcategoryId: null }],
  })
  const inst = instantiateBuffEffect(fx, { sourceKey: 'agent-0-0' })
  fx.value = 999
  const back = effectInstanceToBuffEffect(inst)
  check('往返仍是 12', back.value === 12, `${back.value}`)
  check('id 保留', back.id === 'keep')
  check('scope 招式', back.scope === 'skill')
  check('招式大类普通攻击', back.skillTargets?.[0]?.category === 'basic')
  const spec = adaptBuffEffect(fixedEffect('s', 'dmgBonus', 1, { scope: 'skill', skillTargets: [{ category: 'basic', subcategoryId: null }] }))
  check('adapt 抄上 scope', spec.conditions.scope === 'skill')
}

console.log('\n[2] 通用 / 招式 / 失衡 / 默认关')
{
  const basicCtx = ctxWith()
  const global = dual('全局 +15 增伤', [fixedEffect('g', 'dmgBonus', 15)], basicCtx)
  check('全局增伤为 15', (global.via.dmgBonus ?? 0) === 15)

  const scoped = [fixedEffect('sc', 'dmgBonus', 15, {
    scope: 'skill',
    skillTargets: [{ category: 'basic', subcategoryId: null }],
  })]
  dual('普攻限定只吃普攻', scoped, basicCtx)
  const ult = dual(
    '普攻限定不吃终结技',
    scoped,
    ctxWith({ categoryId: 'ultimate', coords: [{ category: 'ultimate', subcategoryId: null }] }),
  )
  check('终结技增伤为 0', (ult.via.dmgBonus ?? 0) === 0)

  const staggerFx = [createEmptyBuffEffect({
    id: 'st',
    stat: 'critRate',
    value: 20,
    applySituation: 'stagger',
    enabledDefault: true,
  })]
  const staggerOn = dual('失衡限定·失衡期', staggerFx, ctxWith({ staggerPhase: 'stagger' }))
  check('失衡期暴击为 20', (staggerOn.via.critRate ?? 0) === 20)
  const staggerOff = dual(
    '失衡限定·非失衡',
    staggerFx,
    ctxWith({ staggerPhase: 'normal' }),
  )
  check('非失衡暴击为 0', (staggerOff.via.critRate ?? 0) === 0)

  const off = dual(
    'enabledDefault false 未勾选不加',
    [createEmptyBuffEffect({ id: 'off', stat: 'dmgBonus', value: 30, enabledDefault: false })],
    basicCtx,
  )
  check('默认关增伤为 0', (off.via.dmgBonus ?? 0) === 0)
}

console.log('\n[3] 叠层 / 转模 / 职业 / 全队')
{
  const stacked = [createEmptyBuffEffect({
    id: 'stk',
    kind: 'stacked',
    stackable: true,
    stat: 'dmgBonus',
    value: 0,
    valuePerStack: 5,
    maxStacks: 3,
    defaultStacks: 2,
    enabledDefault: true,
  })]
  const stackedDual = dual('默认 2 层 ×5', stacked, ctxWith())
  check('叠层增伤为 10', (stackedDual.via.dmgBonus ?? 0) === 10)

  const stackedSel = dual(
    '勾选 3 层',
    stacked,
    ctxWith({}, { buffSelection: { enabledIds: { stk: true }, stacksByEffectId: { stk: 3 } } }),
  )
  check('三层增伤为 15', (stackedSel.via.dmgBonus ?? 0) === 15)

  const cv = [convertEffect('cv', 'atk', {
    from: 'mastery',
    panelSource: 'external',
    ratioPercent: 50,
    initialBase: 0,
  })]
  const convertCtx = ctxWith({}, {
    panelSourceValues: { external: { mastery: 80 }, final: { mastery: 80 } },
    attrValues: { mastery: 80 },
  })
  const convertDual = dual('精通转模攻击', cv, convertCtx)
  check('转模攻击为 40', (convertDual.via.atk ?? 0) === 40, `${convertDual.via.atk}`)

  const job = [createEmptyBuffEffect({
    id: 'job',
    stat: 'atk',
    value: 50,
    applyProfession: '强攻',
    enabledDefault: true,
  })]
  dual('职业匹配强攻', job, ctxWith(), true, 0)
  const jobMiss = dual('职业不匹配支援槽主结算', job, makePanelCtx({
    teamSlots,
    agents,
    bangboo: dummyBangboo(),
    mainSlotIndex: 1,
  }), true, 1)
  check('支援主槽固定攻击为 0', (jobMiss.via.atk ?? 0) === 0)

  const teamFx = [createEmptyBuffEffect({
    id: 'tm',
    stat: 'dmgBonus',
    value: 8,
    applyTarget: 'team',
    enabledDefault: true,
  })]
  const teamDual = dual('全队增伤主槽也吃', teamFx, ctxWith(), true, 0)
  check('全队增伤为 8', (teamDual.via.dmgBonus ?? 0) === 8)
}

console.log('\n[4] 生产 computeFinalPanel 吃影画往返')
{
  const add = fixedEffect('atk%', 'inCombatAtkPercent', 10)
  const ctx = makePanelCtx({
    agents: [testAgent('a', { mindscapeBuffs: mindscapeWithEffects([add]) })],
  })
  const breakdown = computeFinalPanel(makePanel({ atk: 2000 }), ctx)
  check(
    '局内攻击%进最终攻击',
    breakdown.finalPanel.atk > 2000,
    `${breakdown.finalPanel.atk}`,
  )
  check(
    'totalMods 含 10 点局内攻击%',
    (breakdown.totalMods.inCombatAtkPercent ?? 0) === 10,
    `${breakdown.totalMods.inCombatAtkPercent}`,
  )
  const collected = collectAllBuffEffects(ctx)
  check(
    'collectAllBuffEffects 仍含影画',
    collected.some((item) => item.effect.stat === 'inCombatAtkPercent'),
  )
}

console.log('\n[5] collectAllBuffEffects 遵守 restrictToSlotIndex / excludeBangboo')
{
  const addA = fixedEffect('a-atk', 'inCombatAtkPercent', 10)
  const addB = fixedEffect('b-atk', 'inCombatAtkPercent', 20)
  const ctx = makePanelCtx({
    teamSlots: [testSlot('a'), testSlot('b')],
    agents: [
      testAgent('a', { mindscapeBuffs: mindscapeWithEffects([addA]) }),
      testAgent('b', { mindscapeBuffs: mindscapeWithEffects([addB]) }),
    ],
    restrictToSlotIndex: 0,
    excludeBangboo: true,
  })
  const collected = collectAllBuffEffects(ctx)
  check(
    'restrict 后没有队友槽位',
    collected.every((item) => !String(item.sourceKey).startsWith('agent-1-')),
  )
  check(
    'restrict 后仍有本槽影画',
    collected.some((item) => String(item.sourceKey).startsWith('agent-0-')),
  )
  check(
    'restrict 后没有邦布',
    collected.every((item) => !String(item.sourceKey).startsWith('bangboo')),
  )
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
