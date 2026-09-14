/**
 * 阶段 6：音擎 / 驱动盘 / 邦布 / 场地走 EffectSpec 往返，与旧 resolvePackMods 逐字段双跑。
 * 运行：npx vite-node scripts/test-pack-buff-effect-adapt.mjs
 */
import { effectInstanceId, packFromEffects } from '../src/utils/buffEffect.ts'
import {
  createEmptyBuffStatModifiers,
  createEmptyWengineAdvancedStats,
  createEmptyWengineRefinementBuffs,
} from '../src/utils/calculatorUi.ts'
import {
  collectAllBuffEffects,
  computeFinalPanel,
  resolvePackModsDirect,
  resolvePackModsViaEffectSpec,
} from '../src/utils/panelBuffCalc.ts'
import {
  fixedEffect,
  makePanel,
  makePanelCtx,
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

function testWengine(fx) {
  return {
    id: 'w1',
    name: '测音擎',
    profession: '强攻',
    rarity: 'S',
    avatar_image: null,
    note: '',
    baseAtk: 500,
    baseDef: 0,
    advancedStats: createEmptyWengineAdvancedStats(),
    fixedBuffs: packFromEffects([fx]),
    refinementBuffs: createEmptyWengineRefinementBuffs(),
  }
}

function testDrive(fx) {
  return {
    id: 'dd1',
    name: '测驱动盘',
    avatar_image: null,
    twoPieceNote: '',
    fourPieceNote: '',
    twoPieceEffects: [],
    twoPieceMods: createEmptyBuffStatModifiers(),
    fourPieceBuffs: packFromEffects([fx]),
  }
}

function testBangboo(fx) {
  return {
    id: 'bb1',
    name: '测邦布',
    avatar_image: null,
    effectBlocks: [{ id: 'blk', name: '测', effects: [fx] }],
    effects: [fx],
    refinementEffectBlocks: [],
    refinementEffects: [],
    fixedMods: createEmptyBuffStatModifiers(),
    refinementMods: [],
  }
}

function testEnv(fx) {
  return {
    kind: 'crisis',
    id: 'crisis-1',
    sourceKey: 'crisis-buff-crisis-1',
    name: '测危局',
    effectBlocks: [{ id: 'b1', name: '测', effects: [fx] }],
  }
}

console.log('\n[1] Direct vs Via 逐字段（四类共用同一往返）')
{
  const ctx = makePanelCtx()
  const fx = [fixedEffect('g', 'dmgBonus', 15)]
  dual('全局 +15 增伤', fx, ctx)
  const scoped = [
    fixedEffect('sc', 'dmgBonus', 15, {
      scope: 'skill',
      skillTargets: [{ category: 'basic', subcategoryId: null }],
    }),
  ]
  dual('普攻限定只吃普攻', scoped, ctx)
  const ult = dual(
    '普攻限定不吃终结技',
    scoped,
    makePanelCtx({
      skillContext: {
        damageKind: 'direct',
        categoryId: 'ultimate',
        subcategoryId: null,
        coords: [{ category: 'ultimate', subcategoryId: null }],
        element: '电',
        staggerPhase: 'stagger',
        isFollowUp: false,
      },
    }),
  )
  check('终结技增伤为 0', (ult.via.dmgBonus ?? 0) === 0)
}

console.log('\n[2] 生产 computeFinalPanel 吃音擎往返')
{
  const add = fixedEffect('w-atk%', 'inCombatAtkPercent', 10)
  const ctx = makePanelCtx({
    agents: [testAgent('a')],
    teamSlots: [{ ...testSlot('a'), wengineId: 'w1' }],
    wengines: [testWengine(add)],
  })
  const breakdown = computeFinalPanel(makePanel({ atk: 2000 }), ctx)
  check('局内攻击%进最终攻击', breakdown.finalPanel.atk > 2000, `${breakdown.finalPanel.atk}`)
  check(
    'totalMods 含 10 点局内攻击%',
    (breakdown.totalMods.inCombatAtkPercent ?? 0) === 10,
    `${breakdown.totalMods.inCombatAtkPercent}`,
  )
  check(
    'collectAllBuffEffects 仍含音擎',
    collectAllBuffEffects(ctx).some((item) => item.effect.stat === 'inCombatAtkPercent'),
  )
}

console.log('\n[3] 生产 computeFinalPanel 吃驱动盘 4 件套往返')
{
  const add = fixedEffect('dd-dmg', 'dmgBonus', 12)
  const ctx = makePanelCtx({
    agents: [testAgent('a')],
    teamSlots: [{ ...testSlot('a'), fourPieceDriveDiscId: 'dd1' }],
    driveDiscs: [testDrive(add)],
  })
  const breakdown = computeFinalPanel(makePanel(), ctx)
  check(
    'totalMods 含 12 点增伤',
    (breakdown.totalMods.dmgBonus ?? 0) === 12,
    `${breakdown.totalMods.dmgBonus}`,
  )
  check(
    'collectAllBuffEffects 仍含驱动盘',
    collectAllBuffEffects(ctx).some((item) => item.effect.stat === 'dmgBonus'),
  )
}

console.log('\n[4] 生产 computeFinalPanel 吃邦布往返')
{
  const add = fixedEffect('bb-ms', 'mastery', 30)
  const ctx = makePanelCtx({
    agents: [testAgent('a')],
    bangboo: testBangboo(add),
    bangbooRefine: 1,
  })
  const breakdown = computeFinalPanel(makePanel({ mastery: 100 }), ctx)
  check(
    'totalMods 含 30 点精通',
    (breakdown.totalMods.mastery ?? 0) === 30,
    `${breakdown.totalMods.mastery}`,
  )
  check('局内精通抬高', breakdown.finalPanel.mastery >= 130, `${breakdown.finalPanel.mastery}`)
}

console.log('\n[5] 生产 computeFinalPanel 吃场地往返')
{
  const add = fixedEffect('e1', 'dmgBonus', 8, { applyTarget: 'team' })
  const env = testEnv(add)
  const instId = effectInstanceId(env.sourceKey, 'b1', 'e1')
  const ctx = makePanelCtx({
    agents: [testAgent('a')],
    environmentBuffs: [env],
    buffSelection: {
      enabledIds: { [instId]: true },
      stacksByEffectId: {},
      convertInputs: {},
      manualTouchedIds: {},
    },
  })
  const breakdown = computeFinalPanel(makePanel(), ctx)
  check(
    'totalMods 含 8 点增伤',
    (breakdown.totalMods.dmgBonus ?? 0) === 8,
    `${breakdown.totalMods.dmgBonus}`,
  )
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
