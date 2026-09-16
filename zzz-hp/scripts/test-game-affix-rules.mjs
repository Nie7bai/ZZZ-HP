/**
 * 游戏专用分配规则：写死口袋 / 付费占用 / 组额度，并实跑 4 口袋 Beam 求解。
 * 运行：npx vite-node scripts/test-game-affix-rules.mjs
 */
import {
  GAME_POCKET_COMBOS,
  buildGameAffixBranch,
  createGameAffixLibraryEntries,
  defaultGameAffixEnabledIds,
  gameAffixGroupCaps,
  gamePaidMainId,
  isGamePaidMainId,
  solveGameAffixAllocationAsync,
} from '../src/utils/gameAffixRules.ts'
import { solveOptimalAffixAllocationAsync, collectPenRateStructureLocks } from '../src/utils/affixOptimizer.ts'
import { buildOptimalEvalContext, clearAffixEvalCache } from '../src/utils/optimalAffixAlloc.ts'
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import { createDefaultAffixDriveDiscMainStats } from '../src/types/calculatorPanel.ts'

let failed = 0
let passed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const entries = createGameAffixLibraryEntries()
const enabledIds = defaultGameAffixEnabledIds(entries)
const twoPieceIds = entries.filter((entry) => entry.group === '2件套').map((entry) => entry.id)

console.log('\n[游戏专用方案]')
check('4 个口袋组合（4 号位恒付费，只枚举 5/6）', GAME_POCKET_COMBOS.length === 4)
check(
  '默认勾选 = 方案全部条目（含 2 件套）',
  enabledIds.length === entries.length &&
    twoPieceIds.length > 0 &&
    twoPieceIds.every((id) => enabledIds.includes(id)) &&
    enabledIds.includes('set:penRate:8'),
  `enabled=${enabledIds.length} entries=${entries.length} 2pc=${twoPieceIds.length}`,
)
check(
  '副词条条目上限均为 30',
  entries.filter((entry) => entry.group === '副词条').every((entry) => entry.cap === 30) &&
    entries.some((entry) => entry.group === '副词条'),
)

{
  const paid = buildGameAffixBranch({
    entries,
    enabledIds,
    combo: { slot5: 'free', slot6: 'free' },
    extraCost: 1,
  })
  const slot5Paid = paid.entries.some((entry) => entry.id === gamePaidMainId(5, 'externalAtkPercent'))
  const slot5Dmg = paid.entries.some((entry) => entry.id === 'main:slot5:dmgBonus')
  const slot4Atk = paid.entries.find((entry) => entry.id === gamePaidMainId(4, 'externalAtkPercent'))
  check('5 号位付费口袋不含付费主属性（本路 5 不付费）', slot5Paid === false)
  check('5 号位不付费口袋含增伤', slot5Dmg === true)
  check('默认勾选下口袋含 2 件套穿透率', paid.entries.some((entry) => entry.id === 'set:penRate:8'))
  check('4 号位付费攻击 rollCost = 2', slot4Atk?.rollCost === 2)
  check(
    '4 号位攻击会税副词条攻击%',
    paid.entryCapTaxes.some(
      (tax) =>
        tax.whenEntryId === gamePaidMainId(4, 'externalAtkPercent') &&
        tax.targetEntryId === 'substat:atkPercent' &&
        tax.amount === 5,
    ),
  )

  // 4 号位全付费（2026-09-16）：爆伤 / 暴击 / 精通也进付费分支，并各带一条 cap 税
  const slot4AllKeys = [
    'critDmg',
    'critRate',
    'externalAtkPercent',
    'externalHpPercent',
    'mastery',
    'externalDefPercent',
  ]
  check(
    '4 号位 6 条全部进付费分支（rollCost = 2）',
    slot4AllKeys.every(
      (key) => paid.entries.find((entry) => entry.id === gamePaidMainId(4, key))?.rollCost === 2,
    ),
    slot4AllKeys
      .map((key) => `${key}:${paid.entries.find((entry) => entry.id === gamePaidMainId(4, key))?.rollCost ?? '缺'}`)
      .join(' '),
  )
  const slot4TaxPairs = [
    ['critDmg', 'substat:critDmg'],
    ['critRate', 'substat:critRate'],
    ['mastery', 'substat:mastery'],
  ]
  check(
    '4 号位爆伤 / 暴击 / 精通各税对应副词条 cap 5',
    slot4TaxPairs.every(([key, target]) =>
      paid.entryCapTaxes.some(
        (tax) =>
          tax.whenEntryId === gamePaidMainId(4, key) &&
          tax.targetEntryId === target &&
          tax.amount === 5,
      ),
    ),
    JSON.stringify(paid.entryCapTaxes.filter((tax) => tax.whenEntryId.startsWith('main:slot4:'))),
  )
}

{
  const caps = gameAffixGroupCaps(30)
  check('4 号位额度锁 1', caps['4号位'] === 1)
  check('2 件套额度锁 1', caps['2件套'] === 1)
  check('副词条额度 = 总分配 − 4', caps['副词条'] === 26)
}

check('付费 id 识别', isGamePaidMainId('main:slot5:externalAtkPercent'))
check('4 号位爆伤是付费', isGamePaidMainId('main:slot4:critDmg'))
check('4 号位暴击是付费', isGamePaidMainId('main:slot4:critRate'))
check('4 号位精通是付费', isGamePaidMainId('main:slot4:mastery'))
check('4 号位防御是付费', isGamePaidMainId('main:slot4:externalDefPercent'))
check(
  '4 号位条目没有非付费项（6/6 全付费）',
  [
    'critDmg',
    'critRate',
    'externalAtkPercent',
    'externalHpPercent',
    'mastery',
    'externalDefPercent',
  ].every((key) => isGamePaidMainId(gamePaidMainId(4, key))),
)
check('5 号位增伤不是付费', isGamePaidMainId('main:slot5:dmgBonus') === false)
check('5 号位穿透率不是付费', isGamePaidMainId('main:slot5:penRate') === false)
check('6 号位异常掌控不是付费', isGamePaidMainId('main:slot6:anomalyControl') === false)
check('6 号位冲击力不是付费', isGamePaidMainId('main:slot6:impact') === false)
check('6 号位能量恢复不是付费', isGamePaidMainId('main:slot6:energyRegen') === false)

/** 造一个最小可评估上下文（不配命中，引擎按 skillContext 走单段直伤） */
const ctx = buildOptimalEvalContext({
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
        hp: 9000, atk: 900, def: 700, critRate: 5, critDmg: 50,
        anomalyControl: 100, energyRegen: 120, directDmgMult: 100, anomalyMult: 125,
      },
    },
  ],
  wengines: [],
  bangboo: {
    id: 'none', name: 'x', avatar_image: null, effects: [],
    refinementEffects: [], fixedMods: {}, refinementMods: [],
  },
  bangbooRefine: 1,
  driveDiscs: [],
  mainSlotIndex: 0,
  driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
  enemyInput: {
    level: 60, defense: 952.8, resistanceType: 'normal',
    vulnerableMultiplier: 1, staggerMultiplier: 1.5, specialMultiplier: 1,
  },
  baseDamageSource: 'atk',
  skillContext: { element: '电', staggerPhase: 'stagger', damageKind: 'direct' },
  hits: undefined,
})

const POCKET_BUDGET = 12000
/** 付费号位额外占档（与 UI 的「额外占档」设置同一口径），两条路径必须传同一个值 */
const EXTRA_COST = 1
const groupRollsOf = (rolls, group) =>
  entries.filter((entry) => entry.group === group)
    .reduce((sum, entry) => sum + (rolls[entry.id] ?? 0), 0)

console.log('\n[游戏专用方案] 4 口袋都跑 Beam，再按总伤取最高')
{
  const seenBranches = new Set()
  const seenLabels = new Map()
  clearAffixEvalCache()
  const game = await solveGameAffixAllocationAsync(
    {
      ctx,
      entries,
      enabledIds,
      extraCost: EXTRA_COST,
      maxTotalRolls: 30,
      searchPreset: 'fast',
      maxWorkUnits: POCKET_BUDGET,
    },
    {
      onProgress: (progress) => {
        if (!progress.gameBranch) return
        seenBranches.add(progress.gameBranch.index)
        seenLabels.set(progress.gameBranch.index, progress.gameBranch.label)
      },
    },
  )

  check('4 个口袋都真的跑到了（进度覆盖 1..4）',
    seenBranches.size === GAME_POCKET_COMBOS.length,
    `跑到 ${[...seenBranches].sort((a, b) => a - b).join(',')}`)
  check('每个口袋都有组合标签',
    [...seenLabels.values()].every((label) => typeof label === 'string' && label.length > 0),
    [...seenLabels.values()].join(' / '))
  check('各袋合计被汇总（含口袋数与评估次数）',
    game.gameTotals.pockets === GAME_POCKET_COMBOS.length &&
      game.gameTotals.engineCalls > 0 &&
      game.gameTotals.workUsed > 0,
    JSON.stringify(game.gameTotals))
  check('每袋预算公平（合计不超 4 × 单袋预算）',
    game.gameTotals.workUsed <= POCKET_BUDGET * GAME_POCKET_COMBOS.length,
    `${Math.round(game.gameTotals.workUsed)} <= ${POCKET_BUDGET * GAME_POCKET_COMBOS.length}`)
  check('胜出口袋序号合法且带回标签',
    game.gameWinner.index >= 1 &&
      game.gameWinner.index <= GAME_POCKET_COMBOS.length &&
      typeof game.gameWinner.label === 'string' &&
      game.gameWinner.label.length > 0,
    JSON.stringify(game.gameWinner))
  check('胜出口袋的「组合 x/总数」里总数是 4',
    game.gameWinner.total === GAME_POCKET_COMBOS.length,
    String(game.gameWinner.total))
  check('胜出标签与胜出口袋序号对应',
    game.gameWinner.label === seenLabels.get(game.gameWinner.index),
    `${game.gameWinner.label} vs ${seenLabels.get(game.gameWinner.index)}`)
  // 「最终结果 = 胜出口袋的结果」：用同一口袋参数单独重跑一次，总伤必须复现
  {
    const winnerCombo = GAME_POCKET_COMBOS[game.gameWinner.index - 1]
    const winnerBranch = buildGameAffixBranch({ entries, enabledIds, combo: winnerCombo, extraCost: EXTRA_COST })
    clearAffixEvalCache()
    const winnerAlone = await solveOptimalAffixAllocationAsync({
      ctx,
      entries: winnerBranch.entries,
      maxTotalRolls: 30,
      groupCaps: gameAffixGroupCaps(30),
      entryCapTaxes: winnerBranch.entryCapTaxes,
      searchPreset: 'fast',
      maxWorkUnits: POCKET_BUDGET,
    })
    check('最终结果就是胜出口袋单独跑出来的结果（总伤一致）',
      Math.abs(winnerAlone.totalDamage - game.totalDamage) < 1e-6,
      `${winnerAlone.totalDamage} vs ${game.totalDamage}`)
  }
  check('胜出结果不劣于基线',
    game.totalDamage >= game.baselineDamage - 1e-9,
    `${game.totalDamage} >= ${game.baselineDamage}`)
  check('胜出分配的 4 号位额度没破（≤1 档）',
    groupRollsOf(game.rollsByEntryId, '4号位') <= 1,
    `4号位 ${groupRollsOf(game.rollsByEntryId, '4号位')} 档`)
  check('胜出分配的 2 件套额度没破（≤1 档）',
    groupRollsOf(game.rollsByEntryId, '2件套') <= 1,
    `2件套 ${groupRollsOf(game.rollsByEntryId, '2件套')} 档`)
  check('胜出分配没有超出总词条数',
    game.usedRolls <= game.maxTotalRolls,
    `${game.usedRolls} <= ${game.maxTotalRolls}`)
}

console.log('\n[游戏专用方案] 5 号付费袋不锁 24% 穿透')
{
  const caps = gameAffixGroupCaps(30)
  const paid5 = buildGameAffixBranch({
    entries,
    enabledIds,
    combo: { slot5: 'paid', slot6: 'free' },
    extraCost: EXTRA_COST,
  })
  check('5 号付费口袋不含穿透率主属性', !paid5.entries.some((entry) => entry.id === 'main:slot5:penRate'))
  // 付费袋里 2 件套 8% 穿透率仍然在，所以专路还是会跑 —— 但它只能锁 8%，锁不到 24%
  const paidLocks = collectPenRateStructureLocks(paid5.entries, {}, caps, 30, paid5.entryCapTaxes)
  check('5 号付费袋只锁 2 件套 8%，锁不到 5 号 24%',
    (paidLocks['main:slot5:penRate'] ?? 0) === 0 && (paidLocks['set:penRate:8'] ?? 0) === 1,
    JSON.stringify(paidLocks))

  clearAffixEvalCache()
  const paid5Solved = await solveOptimalAffixAllocationAsync({
    ctx,
    entries: paid5.entries,
    maxTotalRolls: 30,
    groupCaps: caps,
    entryCapTaxes: paid5.entryCapTaxes,
    searchPreset: 'fast',
    maxWorkUnits: POCKET_BUDGET,
  })
  check('5 号付费袋的分配里不会出现穿透率主属性',
    (paid5Solved.rollsByEntryId['main:slot5:penRate'] ?? 0) === 0,
    JSON.stringify(paid5Solved.rollsByEntryId))
  check('5 号付费袋的 2 件套额度没破',
    groupRollsOf(paid5Solved.rollsByEntryId, '2件套') <= 1,
    `2件套 ${groupRollsOf(paid5Solved.rollsByEntryId, '2件套')} 档`)

  const free5 = buildGameAffixBranch({
    entries,
    enabledIds,
    combo: { slot5: 'free', slot6: 'free' },
    extraCost: EXTRA_COST,
  })
  check('5 号不付费口袋含穿透率主属性',
    free5.entries.some((entry) => entry.id === 'main:slot5:penRate'))
  const freeLocks = collectPenRateStructureLocks(free5.entries, {}, caps, 30, free5.entryCapTaxes)
  check('5 号不付费袋把 24% 与 8% 都锁满',
    (freeLocks['main:slot5:penRate'] ?? 0) === 1 && (freeLocks['set:penRate:8'] ?? 0) === 1,
    JSON.stringify(freeLocks))

  clearAffixEvalCache()
  const free5Solved = await solveOptimalAffixAllocationAsync({
    ctx,
    entries: free5.entries,
    maxTotalRolls: 30,
    groupCaps: caps,
    entryCapTaxes: free5.entryCapTaxes,
    searchPreset: 'fast',
    maxWorkUnits: POCKET_BUDGET,
  })
  check('5 号不付费袋会跑穿透专路（24+8 是正协同，单档排序看不见）',
    free5Solved.penRatePathUsed === true,
    `path=${free5Solved.penRatePathUsed} winning=${free5Solved.winningPath}`)
  check('5 号不付费袋的 4 号位额度没破',
    groupRollsOf(free5Solved.rollsByEntryId, '4号位') <= 1,
    `4号位 ${groupRollsOf(free5Solved.rollsByEntryId, '4号位')} 档`)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
