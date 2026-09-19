/**
 * 游戏专用分配规则：写死口袋 / 付费占用 / 组额度，并实跑 4 口袋 Beam 求解。
 * 运行：npx vite-node scripts/test-game-affix-rules.mjs
 */
import {
  GAME_AFFIX_STORAGE_KEY,
  GAME_AFFIX_SUBSTAT_ENTRY_CAP_DEFAULT,
  GAME_POCKET_COMBOS,
  buildGameAffixBranch,
  clampGameSubstatEntryCap,
  createGameAffixLibraryEntries,
  defaultGameAffixEnabledIds,
  gameAffixGroupCaps,
  gamePaidMainId,
  isGamePaidMainId,
  loadGameAffixRulesSettings,
  saveGameAffixRulesSettings,
  solveGameAffixAllocationAsync,
} from '../src/utils/gameAffixRules.ts'
import { solveOptimalAffixAllocation, solveOptimalAffixAllocationAsync, collectPenRateFieldLocks } from '../src/utils/affixOptimizer.ts'
import { readFileSync } from 'node:fs'
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
  '副词条条目上限默认为 30',
  entries.filter((entry) => entry.group === '副词条').every((entry) => entry.cap === 30) &&
    entries.some((entry) => entry.group === '副词条'),
)

// 上限可填（2026-09-17）：对副词条组内**每个条目分别**生效；0 = 无上限；非副词条条目不受影响
{
  const capOf = (list) => list.filter((e) => e.group === '副词条').map((e) => e.cap)
  const othersOf = (list) => list.filter((e) => e.group !== '副词条').map((e) => e.cap)
  const custom = createGameAffixLibraryEntries(7)
  check('传 N → 副词条每条都是 N（分别生效）',
    capOf(custom).length > 0 && capOf(custom).every((cap) => cap === 7),
    `caps=${[...new Set(capOf(custom))].join(',')}`)
  check('传 0 → 副词条每条都是 0（0 = 无上限）',
    capOf(createGameAffixLibraryEntries(0)).every((cap) => cap === 0),
    `caps=${[...new Set(capOf(createGameAffixLibraryEntries(0)))].join(',')}`)
  check('非副词条条目的 cap 不受这个参数影响',
    JSON.stringify(othersOf(custom)) === JSON.stringify(othersOf(entries)),
    `非副词条 cap 一致=${JSON.stringify(othersOf(custom)) === JSON.stringify(othersOf(entries))}`)
  check('clamp：负数/NaN 回落默认 30，超过 64 截到 64，小数取整',
    clampGameSubstatEntryCap(-1) === 30 &&
      clampGameSubstatEntryCap(Number.NaN) === 30 &&
      clampGameSubstatEntryCap(999) === 64 &&
      clampGameSubstatEntryCap(12.6) === 13 &&
      clampGameSubstatEntryCap(0) === 0,
    `${clampGameSubstatEntryCap(-1)}/${clampGameSubstatEntryCap(Number.NaN)}/${clampGameSubstatEntryCap(999)}/${clampGameSubstatEntryCap(12.6)}/${clampGameSubstatEntryCap(0)}`)
}

// 存档读写（用一次性 localStorage 替身；node 里没有真 localStorage）
{
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  const defaults = loadGameAffixRulesSettings(entries)
  check('没有存档时：副词条上限 = 默认 30（且与常量一致）',
    defaults.substatEntryCap === 30 && GAME_AFFIX_SUBSTAT_ENTRY_CAP_DEFAULT === 30,
    `cap=${defaults.substatEntryCap}`)
  saveGameAffixRulesSettings({ ...defaults, substatEntryCap: 12 })
  check('存档回读：12 生效', loadGameAffixRulesSettings(entries).substatEntryCap === 12,
    `cap=${loadGameAffixRulesSettings(entries).substatEntryCap}`)
  saveGameAffixRulesSettings({ ...defaults, substatEntryCap: 0 })
  check('存档回读：0（无上限）能存能读',
    loadGameAffixRulesSettings(entries).substatEntryCap === 0,
    `cap=${loadGameAffixRulesSettings(entries).substatEntryCap}`)
  // 老存档：没有 substatEntryCap 这个键 → 必须读回 30（旧行为不变）
  store.set(GAME_AFFIX_STORAGE_KEY, JSON.stringify({ extraCost: 2, enabledIds: enabledIds }))
  const legacy = loadGameAffixRulesSettings(entries)
  check('老存档（无该键）读回 30，不变成「无上限」',
    legacy.substatEntryCap === 30 && legacy.extraCost === 2,
    `cap=${legacy.substatEntryCap} extraCost=${legacy.extraCost}`)
  // 坏值：负数 → 回落 30（不是 0）
  store.set(GAME_AFFIX_STORAGE_KEY, JSON.stringify({ extraCost: 1, substatEntryCap: -5, enabledIds: enabledIds }))
  check('存档里是坏值（负数）→ 回落 30，不变成「无上限」',
    loadGameAffixRulesSettings(entries).substatEntryCap === 30,
    `cap=${loadGameAffixRulesSettings(entries).substatEntryCap}`)
  delete globalThis.localStorage
}

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
  // 2026-09-18 用户口径：不再凭空预扣那 4 档（勾掉 / 不买 主属性与 2 件套 时，省下的档要留给副词条）
  check('副词条额度 = 总分配数（不预扣 4）', caps['副词条'] === 30)
  check('总分配数变了，副词条额度跟着变', gameAffixGroupCaps(40)['副词条'] === 40)
  // 勾掉 2 件套 / 5 号位（不进 enabledIds）时，副词条额度不受影响 —— 额度只跟总分配数走
  const entries = createGameAffixLibraryEntries()
  const withoutSet = buildGameAffixBranch({
    entries,
    enabledIds: defaultGameAffixEnabledIds(entries).filter(
      (id) => !id.startsWith('set:') && !id.startsWith('main:slot5:'),
    ),
    combo: GAME_POCKET_COMBOS[0],
    extraCost: 1,
  })
  check(
    '勾掉 2 件套与 5 号位后：这些条目确实不在候选里',
    withoutSet.entries.every((entry) => entry.group !== '2件套' && !entry.id.startsWith('main:slot5:')),
  )
  check(
    '勾掉它们不影响副词条额度（额度只看总分配数）',
    gameAffixGroupCaps(30)['副词条'] === 30 && withoutSet.entries.some((entry) => entry.group === '副词条'),
  )
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
  const paidLocks = collectPenRateFieldLocks(paid5.entries, {}, caps, 30, paid5.entryCapTaxes)
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
  const freeLocks = collectPenRateFieldLocks(free5.entries, {}, caps, 30, free5.entryCapTaxes)
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

console.log('\n[游戏专用方案] 「所有副词条条目上限」真的约束到求解')
{
  const LIMIT = 2
  const RUN_ROLLS = 20
  const capped = createGameAffixLibraryEntries(LIMIT)
  const cappedIds = defaultGameAffixEnabledIds(capped)
  const keep = (entry) => cappedIds.includes(entry.id)
  const branchOf = (list) =>
    buildGameAffixBranch({ entries: list, enabledIds: cappedIds, combo: { slot5: 'free', slot6: 'free' }, extraCost: EXTRA_COST })
  const branch = branchOf(capped)
  const substatIds = branch.entries.filter((entry) => keep(entry) && entry.group === '副词条').map((entry) => entry.id)
  check('测试前提：副词条条目确实在池子里（否则下面的断言是假通过）',
    substatIds.length > 0, `${substatIds.length} 条`)

  const solveWith = (list) => {
    const b = branchOf(list)
    clearAffixEvalCache()
    return solveOptimalAffixAllocation({
      ctx,
      entries: b.entries.filter(keep),
      maxTotalRolls: RUN_ROLLS,
      groupCaps: gameAffixGroupCaps(RUN_ROLLS),
      entryCapTaxes: b.entryCapTaxes,
      searchPreset: 'fast',
      maxWorkUnits: 12000,
    })
  }
  const rollsOfSubstats = (rolls) => Math.max(0, ...substatIds.map((id) => rolls[id] ?? 0))

  const solved = solveWith(capped)
  const worst = rollsOfSubstats(solved.rollsByEntryId)
  const solvedUncapped = solveWith(createGameAffixLibraryEntries(0))
  const worstUncapped = rollsOfSubstats(solvedUncapped.rollsByEntryId)

  check(`上限 ${LIMIT} 时：结果里没有副词条条目超过 ${LIMIT} 档`,
    worst <= LIMIT,
    `最大副词条档数=${worst}`)
  check('上限放开到 0（不限）时确实会叠得更高 —— 证明上限真的在起作用',
    worstUncapped > LIMIT,
    `不限=${worstUncapped} > 上限${LIMIT}=${worst}`)
  check('上限只压副词条：两次运行的组额度都合法（4/5/6 与 2 件套各 ≤ 1）',
    ['4号位', '5号位', '6号位', '2件套'].every((group) =>
      [solved, solvedUncapped].every((r) =>
        branch.entries.filter((e) => e.group === group).reduce((sum, e) => sum + (r.rollsByEntryId[e.id] ?? 0), 0) <= 1)),
    `上限2：${['4号位', '5号位', '6号位', '2件套'].map((g) => g + '=' + branch.entries.filter((e) => e.group === g).reduce((s, e) => s + (solved.rollsByEntryId[e.id] ?? 0), 0)).join(' ')}`)
}

console.log('\n[游戏专用方案] 界面接线守卫（源码级）')
{
  // 真机事故复现过的坑：界面改了参数但没往求解器传（见 dev-docs/词条分配规则.md「容易误解的点」）。
  // 「所有副词条条目上限」是一条会改变求解输入的参数，必须在三处都接上：
  //   ① 弹窗有那个输入格 → ② 事件透出 → ③ 页面把设置交给求解 + 用它建条目
  const modalSource = readFileSync(
    new URL('../src/components/calculator/GameAffixRulesModal.vue', import.meta.url),
    'utf8',
  )
  const sectionSource = readFileSync(
    new URL('../src/components/calculator/OptimalAffixAllocSection.vue', import.meta.url),
    'utf8',
  )
  check('弹窗里有「所有副词条条目上限（默认 30）」输入格',
    modalSource.includes('所有副词条条目上限（默认 30）') &&
      modalSource.includes("emit('update:substatEntryCap'"),
    '弹窗文案 + 事件都齐')
  check('页面传 :substat-entry-cap 并处理 @update:substat-entry-cap',
    sectionSource.includes(':substat-entry-cap="gameAffixSettings.substatEntryCap"') &&
      sectionSource.includes('@update:substat-entry-cap="setGameSubstatEntryCap"'),
    'props 与事件都接上')
  check('求解条目跟着设置走（computed，而不是模块级常量）',
    /const gameAffixLibraryEntries = computed\(\(\) =>\s*\n?\s*createGameAffixLibraryEntries\(gameAffixSettings\.value\.substatEntryCap\)/.test(sectionSource),
    'createGameAffixLibraryEntries(gameAffixSettings.value.substatEntryCap)')
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
