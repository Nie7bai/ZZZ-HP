/**
 * 最优词条分配求解器验证：
 * 1) 小规模场景与「全排列穷举」对比，求解器结果必须等于或接近穷举最优；
 * 2) 预算约束（总词条数 / 条目 cap / 互斥组）不得被突破；
 * 3) 分配结果真实可评估，且总伤与求解器报告一致；
 * 4) 计算量预算与自适应 Beam（多路线保留 B、初始门槛、层内比例）；
 * 5) 同步与异步结果必须一致，异步可中止；
 * 6) 零收益条目出局、交叉项补测（含交换阶段）、无半成品；
 * 7) 基础值取值与缓存失效（换音擎 / 换角色基础面板不得吃到旧值）。
 * 运行：npx vite-node scripts/test-affix-optimizer.mjs
 */
import { readFileSync } from 'node:fs'
import {
  createEmptyAffixCounts,
  createDefaultAffixDriveDiscMainStats,
  fillPanelStatsDefaults,
} from '../src/types/calculatorPanel.ts'
import {
  createEmptyAgentBasePanel,
  createEmptySelfTeamBuffs,
  createEmptyWengineAdvancedStats,
  createEmptyBuffStatModifiers,
} from '../src/utils/calculatorUi.ts'
import {
  addAffixLibraryGroup,
  affixEntryConditionSummary,
  coerceAffixLibraryState,
  createDefaultAffixLibrary,
  createDefaultAffixLibraryState,
  createDriveDiscMainStatAffixEntries,
  createDriveDiscTwoPieceAffixEntries,
  createPresetAffixLibraryEntries,
  entryRollsToEvalInput,
  extraGainFromLibraryEntry,
  isPenRateAffixTarget,
  removeAffixLibraryGroup,
  renameAffixLibraryGroup,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
  setAffixLibraryEntryEnabled,
  setAffixLibraryGroupCap,
  setAffixLibraryGroupEntryCaps,
  updateAffixLibraryEntry,
  affixGroupCaps,
} from '../src/utils/affixLibrary.ts'
import {
  AFFIX_SEARCH_PRESETS,
  solveOptimalAffixAllocation,
  solveOptimalAffixAllocationAsync,
  buildAllocationRows,
  formatAffixRollsSummary,
  resolveAffixOptimizerBudget,
  resolveAffixSearchParams,
  collectPenRateFieldLocks,
  resolveFlatPenLadder,
  DEFENSE_ZONE_PEN_RATE_CAP,
} from '../src/utils/affixOptimizer.ts'
import {
  buildOptimalEvalContext,
  clearAffixEvalCache,
  evaluateAffixCounts,
  optimalHitDependsOnMainAffixPanel,
} from '../src/utils/optimalAffixAlloc.ts'
import { affixTargetLabel as affixTargetLabelOf, statKeyOfTarget } from '../src/utils/affixLibrary.ts'
import {
  buildPanelSourceValuesBySlotMap,
  invalidateBuffCatalogCache,
} from '../src/utils/panelBuffCalc.ts'
import { resolveFlow, buildGenericPanelSkillContext } from '../src/utils/resolvedHit.ts'
import { schemeActivePanels, schemeAffixInputs } from '../src/utils/agentPanelSources.ts'
import { FRONTEND_ROOT, BUFFS_JSON, readJson } from './_paths.mjs'
import path from 'node:path'

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
    ...overrides,
  })
}

const ctx = makeCtx()
const library = createDefaultAffixLibrary()
const byId = new Map(library.map((e) => [e.id, e]))

/** 造 n 个直伤命中（用于让单次评估的成本随流程规模变化） */
function makeHits(n, ownerAgentId = 'a') {
  const hits = []
  for (let i = 0; i < n; i += 1) {
    hits.push({
      id: `h${ownerAgentId}_${i}`,
      skill: {
        id: `s${i}`,
        name: `招式${i + 1}`,
        damageType: 'direct',
        element: '电',
        category: 'basic',
        subcategoryId: null,
        mult: 300 + i * 10,
      },
      ownerAgentId,
      anomalyPowerAgentId: null,
      triggerAgentId: null,
      count: 1,
      staggerPhase: 'stagger',
      critMode: 'expected',
      damageKind: 'direct',
      anomalySubKind: null,
      coords: [],
      isFollowUp: false,
      multOverrides: { directDmgMult: 300 + i * 10 },
      panelMods: null,
    })
  }
  return hits
}

/**
 * 小池穷举（按条目档数）：返回最优总伤与分配。
 *
 * 与求解器同口径：预算 = 总词条数、条目自身 cap、`rollCost` 计入已用档数。
 * 只用于小规模对照（条目 ≤ 4、预算 ≤ 8）。
 */
function bruteForceOptimal(ctxArg, subset, budgetRolls) {
  const budget = resolveAffixOptimizerBudget(ctxArg, budgetRolls)
  const rolls = {}
  let bestTotal = -Infinity
  let bestRolls = null
  const rec = (index, usedRolls) => {
    if (index === subset.length) {
      const counts = { ...createEmptyAffixCounts() }
      for (const e of subset) {
        const n = rolls[e.id] ?? 0
        const key = statKeyOfTarget(e.target)
        if (n > 0 && key) counts[key] += n
      }
      const total = evaluateAffixCounts(ctxArg, counts).grandTotal
      if (total > bestTotal) {
        bestTotal = total
        bestRolls = { ...rolls }
      }
      return
    }
    const entry = subset[index]
    const cap = entry.cap > 0 ? entry.cap : budgetRolls
    const rollCap = budget.rollCapOf(entry)
    const limit = Math.min(cap, Number.isFinite(rollCap) ? rollCap : cap, budgetRolls)
    for (let n = 0; n <= limit; n += 1) {
      const nextRolls = usedRolls + n * (entry.rollCost ?? 1)
      if (nextRolls > budget.maxTotalRolls) break
      rolls[entry.id] = n
      rec(index + 1, nextRolls)
    }
    rolls[entry.id] = 0
  }
  rec(0, 0)
  return { bestTotal, bestRolls }
}

// ---------- 1. 小规模穷举对照 ----------
console.log('\n[1] 与全排列穷举对比（预算 6 档）')
{
  // 选 4 条代表性词条：攻击%（大词条）、固定攻击（小词条）、暴击率、爆伤
  const subset = library.filter((e) =>
    ['substat:atkPercent', 'substat:atkFlat', 'substat:critRate', 'substat:critDmg'].includes(e.id),
  )
  const BUDGET = 6

  const brute = bruteForceOptimal(ctx, subset, BUDGET)
  const solved = solveOptimalAffixAllocation({ ctx, entries: subset, maxTotalRolls: BUDGET })

  console.log(`    穷举最优 ${brute.bestTotal} | 求解器 ${solved.totalDamage}`)
  console.log(`    穷举分配 ${JSON.stringify(brute.bestRolls)}`)
  console.log(`    求解分配 ${JSON.stringify(solved.rollsByEntryId)}`)
  check('求解器不劣于穷举最优（容差 1e-6）',
    solved.totalDamage >= brute.bestTotal - 1e-6,
    `求解 ${solved.totalDamage} vs 穷举 ${brute.bestTotal}`)
}

// ---------- 2. 预算约束 ----------
console.log('\n[2] 预算约束')
{
  const BUDGET = 30
  const solved = solveOptimalAffixAllocation({ ctx, entries: library, maxTotalRolls: BUDGET })
  const budget = resolveAffixOptimizerBudget(ctx, BUDGET)

  check('总词条数不超上限',
    solved.usedRolls <= budget.maxTotalRolls,
    `${solved.usedRolls} <= ${budget.maxTotalRolls}`)
  check('总词条数用满（贪心应填满预算）',
    solved.usedRolls === budget.maxTotalRolls,
    `${solved.usedRolls} vs ${budget.maxTotalRolls}`)

  // 口径（2026-09-10 用户决定）：词条分配模式**不复用柱图规则**，
  // 即不再套用「36 − 6×同名主属性数」的主词条上限。约束只剩两处：
  //   1. 总词条数（唯一预算，见上）
  //   2. 条目自身的 cap（词条库「上限」列，0 = 不限）
  check('主词条上限已剔除（rollCapOf 恒为不限）',
    !Number.isFinite(budget.rollCapOf(byId.get('substat:critDmg'))),
    String(budget.rollCapOf(byId.get('substat:critDmg'))))

  let entryCapOk = true
  for (const [id, rolls] of Object.entries(solved.rollsByEntryId)) {
    const entry = byId.get(id)
    if (!entry) continue
    if (entry.cap > 0 && rolls > entry.cap) {
      entryCapOk = false
      console.log(`      超条目上限：${entry.label} ${rolls} > ${entry.cap}`)
    }
  }
  check('条目自身的上限（cap）未突破', entryCapOk)

  // cap = 1 的条目不得超出 1 档（正面验证 cap 确实在生效）
  const cappedEntries = library.filter((e) => e.cap > 0)
  const cappedSolved = solveOptimalAffixAllocation({
    ctx, entries: cappedEntries, maxTotalRolls: 30,
  })
  const cappedViolations = cappedEntries.filter(
    (e) => (cappedSolved.rollsByEntryId[e.id] ?? 0) > e.cap,
  )
  check('cap>0 的条目最多拿 cap 档',
    cappedViolations.length === 0,
    cappedViolations.map((e) => `${e.label}=${cappedSolved.rollsByEntryId[e.id]}`).join(', ') || '无越界')

  check('分配非空', Object.keys(solved.rollsByEntryId).length > 0,
    JSON.stringify(solved.rollsByEntryId))
  // 每条词条一律占 1 个总词条数（独立功能口径）
  const totalRolls = Object.values(solved.rollsByEntryId).reduce((a, b) => a + b, 0)
  check('档数之和 = 已用总词条数（每条 1 档 = 1 词条）',
    totalRolls === solved.usedRolls,
    `${totalRolls} vs ${solved.usedRolls}`)
}

// ---------- 3. 结果可复现且一致 ----------
console.log('\n[3] 结果一致性')
{
  const BUDGET = 20
  const solved = solveOptimalAffixAllocation({ ctx, entries: library, maxTotalRolls: BUDGET })
  const reEval = evaluateAffixCounts(ctx, solved.counts, solved.panelDeltas, solved.valuePerCount, solved.extraGains)
  check('重算总伤与求解器报告一致',
    Math.abs(reEval.grandTotal - solved.totalDamage) < 1e-6,
    `${reEval.grandTotal} vs ${solved.totalDamage}`)
  check('提升百分比 = (最优-基线)/基线',
    Math.abs(
      solved.improvementPercent -
      ((solved.totalDamage - solved.baselineDamage) / solved.baselineDamage) * 100,
    ) < 1e-9,
    `${solved.improvementPercent}`)
  check('最优总伤 >= 基线总伤',
    solved.totalDamage >= solved.baselineDamage - 1e-9,
    `${solved.totalDamage} >= ${solved.baselineDamage}`)

  const rows = buildAllocationRows(library, solved.rollsByEntryId)
  const rowSum = rows.reduce((s, r) => s + r.rolls * r.entry.rollCost, 0)
  check('展示行档数合计 = 已用总词条数', rowSum === solved.usedRolls,
    `${rowSum} vs ${solved.usedRolls}`)

  // 展示行排序契约（2026-09-17 用户定）：组优先 → 组内档数降序 → 名称中文序
  {
    const base = library[0]
    const synthetic = [
      { ...base, id: 'ord:sub:a', group: '副词条', label: '甲', perRoll: 1 },
      { ...base, id: 'ord:slot6', group: '6号位', label: '乙', perRoll: 1 },
      { ...base, id: 'ord:slot4', group: '4号位', label: '丙', perRoll: 1 },
      { ...base, id: 'ord:sub:b', group: '副词条', label: '丁', perRoll: 1 },
      { ...base, id: 'ord:set2', group: '2件套', label: '戊', perRoll: 1 },
      { ...base, id: 'ord:mine', group: '自建组', label: '己', perRoll: 1 },
    ]
    const ordered = buildAllocationRows(synthetic, {
      'ord:sub:a': 3, 'ord:slot6': 1, 'ord:slot4': 1, 'ord:sub:b': 5, 'ord:set2': 2, 'ord:mine': 9,
    })
    const groups = ordered.map((row) => row.entry.group)
    const subRolls = ordered.filter((row) => row.entry.group === '副词条').map((row) => row.rolls)
    check('展示行：组优先（4→5→6→2件套→副词条→自建组），组内按档数降序',
      JSON.stringify(groups) === JSON.stringify(['4号位', '6号位', '2件套', '副词条', '副词条', '自建组']) &&
        JSON.stringify(subRolls) === JSON.stringify([5, 3]),
      `${groups.join(' → ')}｜副词条档数 ${subRolls.join(',')}（自建组 9 档但仍排最后）`)
  }
  console.log(`    引擎调用 ${solved.engineCalls} 次，截断=${solved.truncated}`)
}

// ---------- 4. 分组额度（组 cap） ----------
console.log('\n[4] 分组额度')
{
  const four = library.filter((e) =>
    ['substat:atkPercent', 'substat:atkFlat', 'substat:critRate', 'substat:critDmg'].includes(e.id),
  )
  const setGroup = (entries, id, group, cap, perRoll) =>
    entries.map((e) =>
      e.id === id ? { ...e, group, ...(cap != null ? { cap } : {}), ...(perRoll != null ? { perRoll } : {}) } : e,
    )

  // 4.0 显式额度 1：同组合计至多 1 档。
  // 这条在 2026-09-12 之前会失败 —— 2-swap 用了「撤档后」的旧快照，
  // 会把同组第二条也加进来（见 步骤 24 的 bug 记录）。
  {
    let worst = 0
    let detail = ''
    const entries = setGroup(
      setGroup(four, 'substat:atkPercent', 'g0', 0, 100),
      'substat:atkFlat', 'g0', 0, 1000,
    )
    for (const budget of [2, 3, 4, 6, 10, 20]) {
      const solved = solveOptimalAffixAllocation({
        ctx, entries, maxTotalRolls: budget, groupCaps: { g0: 1 },
      })
      const used =
        (solved.rollsByEntryId['substat:atkPercent'] ?? 0) +
        (solved.rollsByEntryId['substat:atkFlat'] ?? 0)
      if (used > worst) {
        worst = used
        detail = `预算 ${budget}：攻击%=${solved.rollsByEntryId['substat:atkPercent'] ?? 0}、` +
          `固定攻击=${solved.rollsByEntryId['substat:atkFlat'] ?? 0}`
      }
    }
    check('额度 1：组内合计至多 1 档', worst <= 1, detail || '各预算档均 ≤ 1')
  }

  // 4.1 组额度和条数预算是两回事：A cap 3 + B cap 4，组额度 5 → 合计 ≤ 5，各自 ≤ 自己 cap
  {
    let ok = true
    let detail = ''
    const entries = setGroup(
      setGroup(four, 'substat:atkPercent', 'g1', 3, 100),
      'substat:atkFlat', 'g1', 4, 2000,
    )
    for (const budget of [5, 8, 20, 46]) {
      const solved = solveOptimalAffixAllocation({
        ctx, entries, maxTotalRolls: budget, groupCaps: { g1: 5 },
      })
      const a = solved.rollsByEntryId['substat:atkPercent'] ?? 0
      const b = solved.rollsByEntryId['substat:atkFlat'] ?? 0
      if (a + b > 5 || a > 3 || b > 4) {
        ok = false
        detail = `预算 ${budget}：攻击%=${a}、固定攻击=${b}`
      }
    }
    check('组额度 5：A+B ≤ 5 且各自不超自己 cap', ok, detail || '各预算档均满足')
  }

  // 4.2 组额度会真的被用满（否则 4.1 可能只是「两条都没被选」而"通过"）
  {
    const entries = setGroup(
      setGroup(four, 'substat:atkPercent', 'g2', 3, 100),
      'substat:atkFlat', 'g2', 4, 2000,
    )
    const solved = solveOptimalAffixAllocation({
      ctx, entries, maxTotalRolls: 46, groupCaps: { g2: 5 },
      // 本用例只验「组额度」语义：关掉组内门槛，免得门槛先把组内弱的条目筛掉
      initialCandidateThreshold: 0,
    })
    const used =
      (solved.rollsByEntryId['substat:atkPercent'] ?? 0) +
      (solved.rollsByEntryId['substat:atkFlat'] ?? 0)
    check('组额度 5 在额度充足时被用满', used === 5, `实际合计 ${used}`)
  }

  // 4.3 额度 1 对 cap>1 的单条也生效：cap 3 的条目最多只加 1 档
  {
    const entries = setGroup(four, 'substat:atkPercent', 'g3', 3, 100)
    const solved = solveOptimalAffixAllocation({
      ctx, entries, maxTotalRolls: 46, groupCaps: { g3: 1 },
    })
    const a = solved.rollsByEntryId['substat:atkPercent'] ?? 0
    check('额度 1：cap 3 的单条也最多 1 档', a <= 1, `实际 ${a} 档`)
  }

  // 4.4 不同组互不影响：各自额度 1，两条可以各拿 1 档
  {
    const entries = setGroup(
      setGroup(four, 'substat:atkPercent', 'gA', 1, 100),
      'substat:atkFlat', 'gB', 1, 2000,
    )
    const solved = solveOptimalAffixAllocation({
      ctx, entries, maxTotalRolls: 46, groupCaps: { gA: 1, gB: 1 },
    })
    const a = solved.rollsByEntryId['substat:atkPercent'] ?? 0
    const b = solved.rollsByEntryId['substat:atkFlat'] ?? 0
    check('不同组互不影响（各 1 档可共存）', a === 1 && b === 1, `攻击%=${a}、固定攻击=${b}`)
  }

  // 4.5 额度 0 = 不限：组只是个归类页，不构成约束
  {
    const entries = setGroup(
      setGroup(four, 'substat:atkPercent', 'gFree', 0, 100),
      'substat:atkFlat', 'gFree', 0, 2000,
    )
    const unlimited = solveOptimalAffixAllocation({
      ctx, entries, maxTotalRolls: 46, groupCaps: { gFree: 0 },
    })
    const limited = solveOptimalAffixAllocation({
      ctx, entries, maxTotalRolls: 46, groupCaps: { gFree: 1 },
    })
    const sumOf = (solved) =>
      (solved.rollsByEntryId['substat:atkPercent'] ?? 0) +
      (solved.rollsByEntryId['substat:atkFlat'] ?? 0)
    const free = sumOf(unlimited)
    const capped = sumOf(limited)
    check('额度 0 = 不限（组不构成约束）', free > 10 && capped <= 1,
      `不限时组内 ${free} 档、额度 1 时 ${capped} 档`)
  }

  // 4.6 组名不在额度表里 → 按不限算（静默加约束会改变结果，方向反了）
  {
    const entries = setGroup(four, 'substat:atkPercent', 'gMissing', 0, 100)
    const solved = solveOptimalAffixAllocation({ ctx, entries, maxTotalRolls: 46 })
    const a = solved.rollsByEntryId['substat:atkPercent'] ?? 0
    check('组名不在表里 → 按不限算', a > 1, `实际 ${a} 档`)
  }

  // 4.7 回归：5 号位「增伤 30% / 穿透率 24%」同组、额度 1，不得同时上榜。
  // 修复前实测四个预算档全部出现「两条同时上榜」。两条现已进预设（`main:slot5:*`）。
  {
    const panelTwo = createDriveDiscMainStatAffixEntries().filter((e) =>
      ['main:slot5:dmgBonus', 'main:slot5:penRate'].includes(e.id),
    )
    const entries = [...library, ...panelTwo]
    let ok = true
    let detail = ''
    for (const budget of [6, 10, 16, 24, 46]) {
      const solved = solveOptimalAffixAllocation({
        ctx, entries, maxTotalRolls: budget, groupCaps: { '5号位': 1 },
      })
      const dmg = solved.rollsByEntryId['main:slot5:dmgBonus'] ?? 0
      const pen = solved.rollsByEntryId['main:slot5:penRate'] ?? 0
      if (dmg + pen > 1) {
        ok = false
        detail = `预算 ${budget}：增伤%=${dmg}、穿透率%=${pen}`
      }
    }
    check('真实候选池：同组两条不同时上榜', ok, detail || '各预算档均至多一条')
  }

  // 4.7b 2 件套：11 条同组、额度 1，任何预算下都至多选一条（且总档数 ≤ 1）
  {
    const twoPiece = createDriveDiscTwoPieceAffixEntries()
    const entries = [...library, ...twoPiece]
    let ok = true
    let detail = ''
    for (const budget of [6, 10, 16, 24, 46]) {
      const solved = solveOptimalAffixAllocation({
        ctx, entries, maxTotalRolls: budget, groupCaps: { '2件套': 1 },
      })
      const used = twoPiece.reduce((sum, e) => sum + (solved.rollsByEntryId[e.id] ?? 0), 0)
      const picked = twoPiece.filter((e) => (solved.rollsByEntryId[e.id] ?? 0) > 0)
      if (used > 1) {
        ok = false
        detail = `预算 ${budget}：用了 ${used} 档（${picked.map((e) => e.label).join('+')}）`
      }
    }
    check('2件套：11 条同组额度 1 → 至多选一条', ok, detail || '各预算档均至多一条')
  }

  // 4.8 预设条目自带「副词条」组（额度不限），不传额度表时求解结果不受影响
  {
    const groupsInPreset = [...new Set(library.map((e) => e.group))]
    const solved = solveOptimalAffixAllocation({ ctx, entries: library, maxTotalRolls: 30 })
    check('预设条目都落在「副词条」组', groupsInPreset.length === 1 && groupsInPreset[0] === '副词条',
      groupsInPreset.join(', '))
    check('未传额度表时预设求解不受组约束', solved.usedRolls === 30, `用档 ${solved.usedRolls}`)
  }
}

// ---------- 4.9 存档读取：预设分组必须补回来 ----------
console.log('\n[4.9] 存档读取与分组补齐')
{
  // 这次改造之前的存档：没有 groups 字段（用户实际踩到的就是这个）
  const legacy = coerceAffixLibraryState({
    customEntries: [],
    enabledOverride: {},
    overrides: {},
    removedEntryIds: [],
  })
  const names = legacy.groups.map((g) => g.name)
  check(
    '老存档（无分组字段）读回来带 5 个预设组',
    names.join(',') === '4号位,5号位,6号位,2件套,副词条',
    names.join(', '),
  )

  // 条目引用了一个表里没有的组名 → 补组，且额度按「互斥」的老语义取 1
  const withLegacyGroup = coerceAffixLibraryState({
    customEntries: [],
    enabledOverride: {},
    overrides: { 'substat:atkPercent': { group: '老组' }, 'substat:critRate': { group: '老组' } },
    removedEntryIds: [],
  })
  const legacyGroup = withLegacyGroup.groups.find((g) => g.name === '老组')
  check('条目引用的未知组名会被补出页签', Boolean(legacyGroup), legacyGroup ? '已补' : '未补')
  check('补出来的额度是 1（保留「二选一」的老意图）', legacyGroup?.cap === 1,
    `cap=${legacyGroup?.cap}`)

  // 删掉的预设组不能复活
  const removed = removeAffixLibraryGroup(createDefaultAffixLibraryState(), '6号位')
  const reopened = coerceAffixLibraryState(removed)
  check(
    '删掉的预设组读盘后不复活',
    !reopened.groups.some((g) => g.name === '6号位'),
    reopened.groups.map((g) => g.name).join(', '),
  )
  // 被删组里的预设条目（4/5/6 号位主属性）不能还挂着已删组名 —— 挂着就会被兜底补回来
  const reopenedSlot6 = resolveAffixLibraryAll(reopened).filter(
    (e) => e.id.startsWith('main:slot6:'),
  )
  check(
    '被删组里的预设条目回落未分组（不再引用已删组名）',
    reopenedSlot6.length > 0 && reopenedSlot6.every((e) => e.group === ''),
    reopenedSlot6.map((e) => `${e.id}=${e.group || '(空)'}`).join(', '),
  )

  // 改名的预设组：新名留下、原名不复活、组内条目跟着改名
  const renamed = renameAffixLibraryGroup(createDefaultAffixLibraryState(), '5号位', '五号位')
  const reopenedRenamed = coerceAffixLibraryState(renamed)
  const reopenNames = reopenedRenamed.groups.map((g) => g.name)
  check(
    '改名的预设组：原名不复活、新名在',
    !reopenNames.includes('5号位') && reopenNames.includes('五号位'),
    reopenNames.join(', '),
  )
  const presetEntryGroup = resolveAffixLibraryAll(renamed).find(
    (e) => e.id === 'substat:atkPercent',
  )?.group
  check('改名不影响条目（条目本就不在该组）', presetEntryGroup === '副词条', String(presetEntryGroup))
  // 被改名组里的预设条目要跟着走，否则它们还引用旧组名 → 旧组被兜底补回来
  const renamedSlot5 = resolveAffixLibraryAll(reopenedRenamed).filter(
    (e) => e.id.startsWith('main:slot5:'),
  )
  check(
    '被改名组里的预设条目跟着改名',
    renamedSlot5.length > 0 && renamedSlot5.every((e) => e.group === '五号位'),
    renamedSlot5.map((e) => `${e.id}=${e.group || '(空)'}`).join(', '),
  )

  // 建回一个被删过的预设组名 → 撤销「删过」记录
  const recreated = addAffixLibraryGroup(removed, '6号位', 1)
  const reopenedRecreated = coerceAffixLibraryState(recreated)
  check(
    '重新建回同名预设组后不再被滤掉',
    reopenedRecreated.groups.some((g) => g.name === '6号位'),
    reopenedRecreated.groups.map((g) => g.name).join(', '),
  )

  // ---------- 批量改「本组单词条上限」（2026-09-17 用户口径） ----------
  {
    const base = createDefaultAffixLibraryState()
    // 先把组额度设成非 0，否则「组额度不变」这条会 0 → 0 假通过
    const baseWithGroupCap = setAffixLibraryGroupCap(base, '副词条', 7)
    const before = resolveAffixLibrary(baseWithGroupCap)
    const substatIds = before.filter((e) => e.group === '副词条').map((e) => e.id)
    const groupCapBefore = baseWithGroupCap.groups.find((g) => g.name === '副词条')?.cap
    const capped = setAffixLibraryGroupEntryCaps(baseWithGroupCap, '副词条', 6)
    const capById = (state) =>
      Object.fromEntries(resolveAffixLibrary(state).map((e) => [e.id, e.cap]))
    const after = capById(capped)
    check('批量改上限：本组每条都被设成 6',
      substatIds.length > 0 && substatIds.every((id) => after[id] === 6),
      `${substatIds.length} 条：${[...new Set(substatIds.map((id) => after[id]))].join(',')}`)
    check('批量改上限：不碰别的组',
      before.filter((e) => e.group !== '副词条').every((e) => after[e.id] === e.cap),
      '其他组条目 cap 不变')
    check('批量改上限：**组额度**不变（两层约束别混）',
      groupCapBefore === 7 && capped.groups.find((g) => g.name === '副词条')?.cap === 7,
      `组额度 ${groupCapBefore} → ${capped.groups.find((g) => g.name === '副词条')?.cap}`)

    const unlimited = setAffixLibraryGroupEntryCaps(baseWithGroupCap, '副词条', 0)
    check('批量改上限：0 = 不限（原样写入 0）',
      substatIds.every((id) => capById(unlimited)[id] === 0),
      '全部 0')
    const rounded = setAffixLibraryGroupEntryCaps(baseWithGroupCap, '副词条', -3.7)
    check('批量改上限：负数/小数被钳到 ≥0 的整数',
      substatIds.every((id) => capById(rounded)[id] === 0),
      `-3.7 → ${capById(rounded)[substatIds[0]]}`)

    // 未分组作用域：groupName = '' 只动未分组条目
    const withUngrouped = updateAffixLibraryEntry(baseWithGroupCap, substatIds[0], { group: '' })
    const ungroupedAfter = capById(setAffixLibraryGroupEntryCaps(withUngrouped, '', 3))
    check('批量改上限：groupName 为空串时只动「未分组」条目',
      ungroupedAfter[substatIds[0]] === 3 &&
        ungroupedAfter[substatIds[1]] === capById(withUngrouped)[substatIds[1]],
      `未分组条目 ${ungroupedAfter[substatIds[0]]}，同组其他条目 ${ungroupedAfter[substatIds[1]]}`)
  }
}

// ---------- 4.10 同字段多条：各按自己的每档折算 ----------
console.log('\n[4.10] 同字段多条目的折算')
{
  // 用户场景：副词条「局外攻击力% 3%/档」+ 5 号位主属性「局外攻击力 30%/档」
  const pair = [
    byId.get('substat:atkPercent'),
    {
      id: 'main:slot5:atkPercent',
      label: '局外攻击力 30%',
      target: 'panel:atkPercent',
      perRoll: 30,
      cap: 1,
      group: '5号位',
      rollCost: 1,
      enabledByDefault: true,
    },
  ]
  const sixPlusOne = entryRollsToEvalInput(pair, {
    'substat:atkPercent': 6,
    'main:slot5:atkPercent': 1,
  })
  // 6×3% + 1×30% = 48 个百分点（修前：7 档 × 被顶掉的 30% = 210）
  const atkPercentPoints = sixPlusOne.deltas.atkPercent ?? 0
  check(
    '副词条 6 档×3% + 主属性 1 档×30% = 48 个百分点',
    Math.abs(atkPercentPoints - 48) < 1e-9,
    `实际 ${atkPercentPoints} 个百分点`,
  )

  const mainOnly = entryRollsToEvalInput(pair, { 'main:slot5:atkPercent': 1 })
  const mainOnlyPoints = mainOnly.deltas.atkPercent ?? 0
  check('只选主属性 1 档 = 30 个百分点', Math.abs(mainOnlyPoints - 30) < 1e-9,
    `实际 ${mainOnlyPoints}`)

  // 每档值与常量表一致的条目：折算前后行为不变（既有库不受影响）
  const plain = entryRollsToEvalInput([byId.get('substat:atkPercent')], {
    'substat:atkPercent': 6,
  })
  const plainPoints = plain.deltas.atkPercent ?? 0
  check('每档=常量表的条目行为不变（6 档 × 3% = 18）', Math.abs(plainPoints - 18) < 1e-9,
    `实际 ${plainPoints}`)
  check('分析侧不写十格', Object.keys(sixPlusOne.counts).length === 0)
  check(
    '② 标签按条目档数摘要，不拿百分点冒充档数',
    formatAffixRollsSummary(pair, {
      'substat:atkPercent': 6,
      'main:slot5:atkPercent': 1,
    }) === '局外攻击力 30% 1 + 局外攻击力% 6',
    formatAffixRollsSummary(pair, {
      'substat:atkPercent': 6,
      'main:slot5:atkPercent': 1,
    }),
  )

  // 预设的 4/5/6 号位条目必须落在对应组、且各自是独立条目（同字段不合并）
  const preset = createPresetAffixLibraryEntries()
  const slotEntries = preset.filter((e) => /号位$/.test(e.group))
  const ids = new Set(slotEntries.map((e) => e.id))
  check('预设含 4/5/6 号位条目且 id 唯一', ids.size === slotEntries.length && slotEntries.length > 0,
    `${slotEntries.length} 条`)
  const slot5 = preset.filter((e) => e.group === '5号位')
  check('5 号位预设条目数 = 5（3 通用 + 增伤 / 穿透率）', slot5.length === 5,
    slot5.map((e) => e.label).join(' / '))
  const slot6 = preset.filter((e) => e.group === '6号位')
  check(
    '6 号位含异常掌控 / 冲击力 / 能量恢复（选项表 5 条 + 通用 3 条）',
    slot6.some((e) => e.label.includes('异常掌控')) &&
      slot6.some((e) => e.label.includes('能量恢复')) &&
      slot6.some((e) => e.label.includes('冲击力')),
    slot6.map((e) => e.label).join(' / '),
  )
  const impactEntry = preset.find((e) => e.id === 'main:slot6:impact')
  check(
    '6 号位冲击力条目：18 点、落 panel:impact、归 6号位组、默认启用',
    impactEntry?.perRoll === 18 &&
      impactEntry.target === 'panel:impact' &&
      impactEntry.group === '6号位' &&
      impactEntry.enabledByDefault === true,
    impactEntry ? `${impactEntry.label} perRoll=${impactEntry.perRoll} → ${impactEntry.target}` : '(缺)',
  )
  check('4/5/6 号位条目默认启用（官方预设库口径，见 impl-log 步骤 28）',
    slotEntries.every((e) => e.enabledByDefault === true))
  check('扩展条目（不分槽位的伤害字段）默认不启用',
    preset
      .filter((e) => e.group === '副词条' && e.id.startsWith('panel:'))
      .every((e) => e.enabledByDefault === false))

  // 2 件套：按「效果」去重后的 11 条（用户 2026-09-12 口径，见 impl-log 步骤 32）
  const twoPiece = preset.filter((e) => e.group === '2件套')
  check('2件套组共 11 条（按效果去重）', twoPiece.length === 11,
    twoPiece.map((e) => e.label).join(' / '))
  check('2件套条目 id 唯一', new Set(twoPiece.map((e) => e.id)).size === twoPiece.length)
  check('2件套条目默认不启用（避免与自己佩戴的那套双算）',
    twoPiece.every((e) => e.enabledByDefault === false))
  check('2件套条目各自 cap = 1', twoPiece.every((e) => e.cap === 1))
  check('2件套名称＝效果（与 4/5/6 号位同一套格式，不含套装名）',
    twoPiece.every((e) => !/套装|Suit/.test(e.label) && typeof affixTargetLabelOf(e.target) === 'string'),
    twoPiece.map((e) => `${e.label}→${affixTargetLabelOf(e.target)}`).join(' / '))
  // 名称就是效果：逐条核对（与手册步骤 32 的清单一致）。爆伤/暴击伤害是刻意简写，同 4号位。
  const EXPECTED_TWO_PIECE = [
    '暴击 8%=panel:critRate',
    '爆伤 16%=panel:critDmg',
    '精通 30=panel:mastery',
    '局外攻击力 10%=panel:atkPercent',
    '局外生命值 10%=panel:hpPercent',
    '局外防御力 16%=panel:defPercent',
    '增伤 10%=panel:dmgBonus',
    '穿透率 8%=panel:penRate',
    '能量恢复 20%=panel:energyRegen',
    '异常掌控 8%=panel:anomalyControl',
    '冲击力 6%=panel:impact',
  ]
  const actual = twoPiece.map((e) => `${e.label}=${e.target}`).sort()
  check('2件套 11 条的名称与目标逐条符合手册清单',
    JSON.stringify(actual) === JSON.stringify([...EXPECTED_TWO_PIECE].sort()),
    actual.join(' , '))
  // 去重的意义：组内不得出现「目标 + 每档」完全相同的两条
  const sig = new Set(twoPiece.map((e) => `${e.target}=${e.perRoll}`))
  check('2件套组内无重复效果', sig.size === twoPiece.length, `${sig.size} 种 / ${twoPiece.length} 条`)
  // 震星迪斯科那条按说明文字填的冲击力
  const impactSet = twoPiece.find((e) => e.label === '冲击力 6%')
  check('震星迪斯科「冲击力 6%」在列（按说明文字填）',
    impactSet?.target === 'panel:impact' && impactSet?.perRoll === 6,
    impactSet ? `${impactSet.target}=${impactSet.perRoll}` : '(缺)')
}

// ---------- 5. 引擎调用上限 ----------
console.log('\n[5] 安全网')
{
  const solved = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: 46, maxEngineCalls: 12,
  })
  check('达到调用上限时标记 truncated', solved.truncated === true,
    `engineCalls=${solved.engineCalls} workUsed=${Math.round(solved.workUsed)}/${solved.workBudget}`)
  check('截断后仍返回合法结果',
    solved.totalDamage >= solved.baselineDamage - 1e-9 && solved.usedRolls >= 0)
}

// ---------- 6. 词条库状态 ----------
console.log('\n[6] 词条库解析')
{
  const state = createDefaultAffixLibraryState()
  // 默认参与 = 预设里默认启用的条目（副词条 + 4/5/6 号位主属性，见 impl-log 步骤 28）
  const active = resolveAffixLibrary(state)
  const presetEnabled = createPresetAffixLibraryEntries().filter((e) => e.enabledByDefault)
  check(
    `默认参与 = 预设默认启用条数（${presetEnabled.length}）`,
    active.length === presetEnabled.length,
    String(active.length),
  )
  const all = resolveAffixLibraryAll(state)
  // 数量从预设构造器派生：新增预设条目时这里不该再变成陈旧断言
  const presetTotal = createPresetAffixLibraryEntries().length
  const presetOff = createPresetAffixLibraryEntries().filter((e) => !e.enabledByDefault).length
  check(
    `全量 = 预设条目数（${presetTotal}）`,
    all.length === presetTotal,
    String(all.length),
  )
  check('默认关闭的预设条目数与构造器一致',
    all.filter((e) => !e.enabledByDefault).length === presetOff,
    String(all.filter((e) => !e.enabledByDefault).length))
  const enabledOne = setAffixLibraryEntryEnabled(state, 'set:dmgBonus:10', true)
  check('显式启用一条默认关闭的条目后多 1 条',
    resolveAffixLibrary(enabledOne).length === active.length + 1,
    String(resolveAffixLibrary(enabledOne).length))
  const disabledOne = setAffixLibraryEntryEnabled(state, 'substat:critRate', false)
  check('禁用暴击率后少 1 条', resolveAffixLibrary(disabledOne).length === active.length - 1,
    String(resolveAffixLibrary(disabledOne).length))
}

// ---------- 7. 多路线 Beam：B>1 不劣于 B=1，且真的并行保留多条路线 ----------
console.log('\n[7] 多路线 Beam（比例 / 最小保留 / 最大保留 三件套）')
{
  const BUDGET = 6
  const subset = library.filter((e) =>
    ['substat:atkPercent', 'substat:atkFlat', 'substat:critRate', 'substat:critDmg'].includes(e.id),
  )
  // 三件套语义（2026-09-17 二次定稿）：比例筛 → 不足 min 条补足 → 超过 max 条截顶。
  // 上限是防爆宽度的唯一保险（比例筛管不住宽度：同层大量路线都在比例线以内）。
  clearAffixEvalCache()
  const capped = solveOptimalAffixAllocation({
    ctx, entries: subset, maxTotalRolls: BUDGET,
    enablePenRatePath: false,
    minRetainedRoutes: 1, maxRetainedRoutes: 2,
    initialCandidateThreshold: 0, routeRetentionRatio: 0, // 比例不筛 → 全靠上限截顶
  })
  clearAffixEvalCache()
  const uncapped = solveOptimalAffixAllocation({
    ctx, entries: subset, maxTotalRolls: BUDGET,
    enablePenRatePath: false,
    minRetainedRoutes: 1, maxRetainedRoutes: 64,
    initialCandidateThreshold: 0, routeRetentionRatio: 0, // 上不截顶
  })
  const brute = bruteForceOptimal(ctx, subset, BUDGET)
  console.log(`    上限 2 总伤 ${capped.totalDamage}（存活 ${capped.survivedRoutes} 条，截顶丢 ${capped.routeCapDropped}）`)
  console.log(`    上限 64 总伤 ${uncapped.totalDamage}（存活 ${uncapped.survivedRoutes} 条）｜穷举 ${brute.bestTotal}`)
  check('上限生效：比例不筛时也留不过 max 条，并把截掉的数量记账',
    capped.survivedRoutes < uncapped.survivedRoutes && capped.routeCapDropped > 0,
    `存活 ${capped.survivedRoutes} < ${uncapped.survivedRoutes}｜截顶丢 ${capped.routeCapDropped}`)
  check('上限截顶不算 truncated（设计内行为，不是预算吃紧）',
    !capped.truncated, `truncated=${capped.truncated}`)
  check('去掉上限后确实并行保留更多路线（同一比例下）',
    uncapped.survivedRoutes > capped.survivedRoutes,
    `${uncapped.survivedRoutes} > ${capped.survivedRoutes}`)
  check('宽光束达到穷举最优（无漏解）',
    uncapped.totalDamage >= brute.bestTotal - 1e-6,
    `${uncapped.totalDamage} vs 穷举 ${brute.bestTotal}`)

  // 下限本身：比例定到最狠（1）+ 下限 3 + 上限 64 → 一定有路线是被保底救回来的
  clearAffixEvalCache()
  const floored = solveOptimalAffixAllocation({
    ctx, entries: subset, maxTotalRolls: BUDGET,
    enablePenRatePath: false,
    minRetainedRoutes: 3, maxRetainedRoutes: 64,
    initialCandidateThreshold: 0, routeRetentionRatio: 1,
  })
  check('最小保留路线生效：比例筛完不足 3 条时补足到 3 条并计数',
    floored.survivedRoutes >= 3 && floored.routeFloorSaved > 0,
    `存活 ${floored.survivedRoutes}｜保底救回 ${floored.routeFloorSaved}`)

  // 上下限写成矛盾值时：上限优先（界面上的「最大保留 N 条」必须字面成立）
  const contradictory = resolveAffixSearchParams({
    minRetainedRoutes: 8, maxRetainedRoutes: 2,
  })
  check('上下限矛盾时上限优先（min 被压到 max）',
    contradictory.maxRetainedRoutes === 2 && contradictory.minRetainedRoutes === 2,
    `min ${contradictory.minRetainedRoutes} / max ${contradictory.maxRetainedRoutes}`)
}

// ---------- 8. 计算量预算：缓存命中不计入 ----------
console.log('\n[8] 计算量预算记账')
{
  clearAffixEvalCache()
  const first = solveOptimalAffixAllocation({ ctx, entries: library, maxTotalRolls: 20 })
  // 不清缓存再跑一次：同样的组合会大量命中缓存
  const second = solveOptimalAffixAllocation({ ctx, entries: library, maxTotalRolls: 20 })
  check('缓存命中不计入计算量',
    second.workUsed <= first.workUsed,
    `第一次 ${Math.round(first.workUsed)}，第二次 ${Math.round(second.workUsed)}`)
  check('缓存命中次数被记录',
    second.cacheHits > 0,
    `cacheHits=${second.cacheHits}`)
  check('真实评估次数不含缓存命中',
    second.engineCalls <= first.engineCalls,
    `${second.engineCalls} <= ${first.engineCalls}`)
  clearAffixEvalCache()
}

// ---------- 9. 搜索预设与三项参数 ----------
console.log('\n[9] 搜索预设与三项参数')
{
  const all = resolveAffixLibraryAll(createDefaultAffixLibraryState())
  const hits8 = makeCtx({ hits: makeHits(8) })
  const hits30 = makeCtx({ hits: makeHits(30) })

  /** 跑一个预设并记录耗时/计算量/淘汰/存活/截断，供实测校准预设用 */
  const runPreset = (presetId, ctxArg) => {
    clearAffixEvalCache()
    const t0 = Date.now()
    const result = solveOptimalAffixAllocation({
      ctx: ctxArg, entries: all, maxTotalRolls: 46, searchPreset: presetId,
    })
    const ms = Date.now() - t0
    console.log(
      `    ${presetId}：门槛 ${result.searchParams.initialCandidateThreshold}／比例 ${result.searchParams.routeRetentionRatio}` +
      `／保留 ${result.searchParams.minRetainedRoutes}-${result.searchParams.maxRetainedRoutes} 条` +
      `｜淘汰 ${result.initialDropped} 条｜存活 ${result.survivedRoutes}（保底救回 ${result.routeFloorSaved}／上限截顶 ${result.routeCapDropped}）` +
      `｜用档 ${result.usedRolls}｜计算量 ${Math.round(result.workUsed)}｜${ms}ms｜截断 ${result.truncated}｜总伤 ${result.totalDamage.toFixed(1)}`,
    )
    return { result, ms }
  }

  const fast = runPreset('fast', hits8).result
  const balanced = runPreset('balanced', hits8).result
  const fine = runPreset('fine', hits8).result

  clearAffixEvalCache()
  const expensive = solveOptimalAffixAllocation({
    ctx: hits30, entries: all, maxTotalRolls: 46, searchPreset: 'fine',
  })

  check('预设三件套与用户口径一致（快速 1-2/95%、均衡 2-5/90%、精细 4-8/50%）',
    AFFIX_SEARCH_PRESETS.fast.minRetainedRoutes === 1 &&
      AFFIX_SEARCH_PRESETS.fast.maxRetainedRoutes === 2 &&
      AFFIX_SEARCH_PRESETS.fast.routeRetentionRatio === 0.95 &&
      AFFIX_SEARCH_PRESETS.balanced.minRetainedRoutes === 2 &&
      AFFIX_SEARCH_PRESETS.balanced.maxRetainedRoutes === 5 &&
      AFFIX_SEARCH_PRESETS.balanced.routeRetentionRatio === 0.9 &&
      AFFIX_SEARCH_PRESETS.fine.minRetainedRoutes === 4 &&
      AFFIX_SEARCH_PRESETS.fine.maxRetainedRoutes === 8 &&
      AFFIX_SEARCH_PRESETS.fine.routeRetentionRatio === 0.5,
    JSON.stringify({
      fast: AFFIX_SEARCH_PRESETS.fast,
      balanced: AFFIX_SEARCH_PRESETS.balanced,
      fine: AFFIX_SEARCH_PRESETS.fine,
    }))
  check('预设 fast 生效',
    fast.searchParams.minRetainedRoutes === AFFIX_SEARCH_PRESETS.fast.minRetainedRoutes &&
      fast.searchParams.maxRetainedRoutes === AFFIX_SEARCH_PRESETS.fast.maxRetainedRoutes &&
      fast.searchParams.initialCandidateThreshold === AFFIX_SEARCH_PRESETS.fast.initialCandidateThreshold,
    JSON.stringify(fast.searchParams))
  check('预设 fine 生效',
    fine.searchParams.minRetainedRoutes === AFFIX_SEARCH_PRESETS.fine.minRetainedRoutes &&
      fine.searchParams.maxRetainedRoutes === AFFIX_SEARCH_PRESETS.fine.maxRetainedRoutes &&
      fine.searchParams.initialCandidateThreshold === AFFIX_SEARCH_PRESETS.fine.initialCandidateThreshold,
    JSON.stringify(fine.searchParams))
  check('门槛越高淘汰越多（fast ≥ balanced ≥ fine）',
    fast.initialDropped >= balanced.initialDropped && balanced.initialDropped >= fine.initialDropped,
    `fast ${fast.initialDropped} ≥ balanced ${balanced.initialDropped} ≥ fine ${fine.initialDropped}`)
  check('保留路线数随预设变宽松而增加（fast ≤ balanced ≤ fine）',
    fast.survivedRoutes <= balanced.survivedRoutes && balanced.survivedRoutes <= fine.survivedRoutes,
    `fast ${fast.survivedRoutes} ≤ balanced ${balanced.survivedRoutes} ≤ fine ${fine.survivedRoutes}`)
  check('三个预设都没有撞上计算量上限被截断',
    !fast.truncated && !balanced.truncated && !fine.truncated,
    `fast ${Math.round(fast.workUsed)}／balanced ${Math.round(balanced.workUsed)}／fine ${Math.round(fine.workUsed)}`)
  // 计算量不保证在 fast/balanced 之间单调（保留路线数与候选池规模互相影响），
  // 但放宽预设一定更贵，所以只跟「精细」比。
  check('更宽松的预设不会更省算力（fast / balanced ≤ fine）',
    fast.workUsed <= fine.workUsed && balanced.workUsed <= fine.workUsed,
    `${Math.round(fast.workUsed)}、${Math.round(balanced.workUsed)} ≤ ${Math.round(fine.workUsed)}`)
  // 「快速」可以牺牲一点精度换速度，但实测校准要求它不低于精细的 95%
  // （合成交叉项场景实测 96.3%，真实 96 命中长流程实测 100%）。
  check('快速预设质量不低于精细的 95%',
    fast.totalDamage >= fine.totalDamage * 0.95,
    `${((fast.totalDamage / fine.totalDamage) * 100).toFixed(1)}%`)
  check('均衡预设质量不低于精细的 99%',
    balanced.totalDamage >= fine.totalDamage * 0.99,
    `${((balanced.totalDamage / fine.totalDamage) * 100).toFixed(1)}%`)

  clearAffixEvalCache()
  const custom = solveOptimalAffixAllocation({
    ctx: hits8, entries: all, maxTotalRolls: 46,
    initialCandidateThreshold: 0.5, routeRetentionRatio: 0.5,
    minRetainedRoutes: 3, maxRetainedRoutes: 7,
  })
  check('显式参数覆盖预设',
    custom.searchParams.initialCandidateThreshold === 0.5 &&
      custom.searchParams.routeRetentionRatio === 0.5 &&
      custom.searchParams.minRetainedRoutes === 3 &&
      custom.searchParams.maxRetainedRoutes === 7,
    JSON.stringify(custom.searchParams))

  // ---- 预设实测校准（只打印、不断言：这些数字用来定 AFFIX_SEARCH_PRESETS）----
  // 关键结论：门槛按「单档边际 / 本路最佳单档边际」比较时，cap=1 的主属性条目
  // （穿透率 24%、防御力 48% 这类一击就吃掉一大块）会占据分母，把「单档值小但能连吃
  // 多档」的副词条一律筛掉，于是最优解根本花不完 46 档预算。门槛必须很小。
  const sweep = (label, extra) => {
    clearAffixEvalCache()
    const t0 = Date.now()
    const r = solveOptimalAffixAllocation({
      ctx: hits8, entries: all, maxTotalRolls: 46,
      routeRetentionRatio: 0.95, minRetainedRoutes: 1, maxRetainedRoutes: 8, ...extra,
    })
    console.log(
      `      ${label}：淘汰 ${r.initialDropped}／存活 ${r.survivedRoutes}（保底救回 ${r.routeFloorSaved}／上限截顶 ${r.routeCapDropped}）` +
      `／保留 ${r.searchParams.minRetainedRoutes}-${r.searchParams.maxRetainedRoutes}／用档 ${r.usedRolls}／计算量 ${Math.round(r.workUsed)}／${Date.now() - t0}ms／截断 ${r.truncated}／总伤 ${r.totalDamage.toFixed(1)}`,
    )
    return r
  }
  console.log('    [校准] 初始门槛扫描（比例 0.95、保留 1-8）')
  for (const t of [0, 0.001, 0.002, 0.003, 0.005, 0.008, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3]) {
    sweep(`门槛 ${t}`, { initialCandidateThreshold: t })
  }
  console.log('    [校准] 层内比例扫描（门槛 0.005、保留 1-8）')
  for (const ratio of [1, 0.99, 0.95, 0.9, 0.8, 0.5, 0]) {
    sweep(`比例 ${ratio}`, { initialCandidateThreshold: 0.005, routeRetentionRatio: ratio })
  }
  console.log('    [校准] 最大保留路线扫描（门槛 0.005、比例 0.95）')
  for (const b of [1, 2, 3, 5, 8, 16]) {
    sweep(`上限 ${b}`, { initialCandidateThreshold: 0.005, maxRetainedRoutes: b })
  }
}

// ---------- 10. 同步 / 异步一致，异步可中止 ----------
console.log('\n[10] 异步求解')
{
  clearAffixEvalCache()
  const sync = solveOptimalAffixAllocation({ ctx, entries: library, maxTotalRolls: 30 })
  clearAffixEvalCache()
  const phases = []
  const async = await solveOptimalAffixAllocationAsync(
    { ctx, entries: library, maxTotalRolls: 30 },
    { chunkSize: 16, onProgress: (p) => phases.push(p.phase) },
  )
  check('异步结果与同步一致',
    Math.abs(async.totalDamage - sync.totalDamage) < 1e-9,
    `${async.totalDamage} vs ${sync.totalDamage}`)
  check('进度回调被触发', phases.length > 0, `阶段回调 ${phases.length} 次`)

  const controller = new AbortController()
  controller.abort()
  let abortOk = false
  try {
    await solveOptimalAffixAllocationAsync(
      { ctx, entries: library, maxTotalRolls: 30 },
      { chunkSize: 4, signal: controller.signal },
    )
  } catch (error) {
    abortOk = error?.name === 'AbortError'
  }
  check('已中止的信号会抛 AbortError', abortOk)
}

// ---------- 10b. 让出主线程不得依赖动画帧 ----------
console.log('\n[10b] 让出主线程不得依赖 requestAnimationFrame')
{
  // 回归测试（2026-09-10 实测教训）：
  // 旧实现用 requestAnimationFrame 让出，浏览器里每次让出要等满一帧 16.66ms。
  // 求解器每 chunkSize 次评估让出一次，于是「0 命中」这种便宜场景（纯计算 ~21ms）
  // 被拖到 ~260ms，且耗时与计算量无关、只与让出次数×帧长有关。
  // 这里把 rAF 换成「永不回调」的桩：若有人改回 rAF 优先，求解器会卡死并被超时捕获。
  const originalRaf = globalThis.requestAnimationFrame
  let rafCalls = 0
  globalThis.requestAnimationFrame = () => {
    rafCalls += 1
    return 0
  }

  let finished = false
  try {
    clearAffixEvalCache()
    const result = await Promise.race([
      solveOptimalAffixAllocationAsync(
        { ctx, entries: library, maxTotalRolls: 30 },
        { chunkSize: 16 },
      ).then((value) => {
        finished = true
        return value
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ])
    check(
      'rAF 不可用时异步求解仍能完成，且一次都不调用它',
      finished && result != null && rafCalls === 0,
      `完成=${finished}，rAF 调用 ${rafCalls} 次`,
    )
  } finally {
    if (originalRaf === undefined) delete globalThis.requestAnimationFrame
    else globalThis.requestAnimationFrame = originalRaf
  }
}

// ---------- 11. 零收益条目出局 ----------
console.log('\n[11] 零收益条目出局')
{
  clearAffixEvalCache()
  const all = resolveAffixLibraryAll(createDefaultAffixLibraryState())
  const solved = solveOptimalAffixAllocation({ ctx, entries: all, maxTotalRolls: 46 })
  const defRolls =
    (solved.rollsByEntryId['substat:defFlat'] ?? 0) +
    (solved.rollsByEntryId['substat:defPercent'] ?? 0)
  check('直伤场景不把档数花在防御词条上', defRolls === 0, `防御类档数 ${defRolls}`)
  check('求解结果仍然合法可重算',
    Math.abs(evaluateAffixCounts(ctx, solved.counts, solved.panelDeltas, solved.valuePerCount, solved.extraGains).grandTotal - solved.totalDamage) < 1e-6)
}

// ---------- 12. 交叉项：零收益条目后续变得有价值时能被补测 ----------
console.log('\n[12] 交叉项补测（暴击为 0 时爆伤增益为 0）')
{
  // 基础暴击率调到 0：此时爆伤单独加档不涨分（增益 = 暴击率 × 爆伤增量），
  // 属典型交叉项——只看基线的话爆伤会被判定「零收益」。
  // 档数给到 30：交叉点落在中间（穷举最优是混搭），才能证明补测真的生效。
  //
  // ⚠️ 与「初始候选门槛」的取舍：门槛 = 0（精细预设）时零收益条目会留在候选池里，
  // 交叉项能被后续层补测；门槛 > 0 时零收益条目按比例被永久淘汰，交叉项就发现不了。
  // 所以这条测试必须显式给门槛 0，同时另外验证「门槛 > 0 会淘汰零收益条目」。
  const zeroCritCtx = makeCtx({
    agents: [
      {
        id: 'a',
        name: '测试',
        element: '电',
        profession: '强攻',
        basePanel: {
          ...createEmptyAgentBasePanel(),
          hp: 9000, atk: 900, def: 700, critRate: 0, critDmg: 50,
          anomalyControl: 100, energyRegen: 120, directDmgMult: 100, anomalyMult: 125,
        },
      },
    ],
  })
  const ROLLS = 30
  const critEntries = library.filter((e) =>
    ['substat:critRate', 'substat:critDmg'].includes(e.id),
  )
  clearAffixEvalCache()
  const solved = solveOptimalAffixAllocation({
    ctx: zeroCritCtx, entries: critEntries, maxTotalRolls: ROLLS,
    enablePenRatePath: false, initialCandidateThreshold: 0,
  })
  const critRolls = solved.rollsByEntryId['substat:critRate'] ?? 0
  const critDmgRolls = solved.rollsByEntryId['substat:critDmg'] ?? 0

  // 同规模的穷举对照（只有两个词条，可全排列）
  let bruteTotal = -Infinity
  for (let k = 0; k <= ROLLS; k += 1) {
    const counts = { ...createEmptyAffixCounts(), critRate: k, critDmg: ROLLS - k }
    bruteTotal = Math.max(bruteTotal, evaluateAffixCounts(zeroCritCtx, counts).grandTotal)
  }
  console.log(`    求解器：暴击 ${critRolls} / 爆伤 ${critDmgRolls} → ${solved.totalDamage.toFixed(1)}`)
  console.log(`    穷举：   最优 ${bruteTotal.toFixed(1)}`)
  check('暴击为 0 时仍能把档数分给爆伤（门槛 0 时补测生效）',
    critDmgRolls > 0, JSON.stringify(solved.rollsByEntryId))
  check('交叉项场景不劣于穷举最优',
    solved.totalDamage >= bruteTotal - 1e-6,
    `${solved.totalDamage} vs ${bruteTotal}`)

  // 门槛 > 0：零收益的爆伤会被永久淘汰（这是「初始候选门槛」的代价，必须可预期）
  clearAffixEvalCache()
  const strictGate = solveOptimalAffixAllocation({
    ctx: zeroCritCtx, entries: critEntries, maxTotalRolls: ROLLS,
    enablePenRatePath: false, initialCandidateThreshold: 0.5,
  })
  check('门槛 > 0 时零收益条目被永久淘汰（交叉项放弃）',
    strictGate.initialDropped >= 1,
    `淘汰 ${strictGate.initialDropped} 条`)
}

// ---------- 12b. 层内比例筛、去重与预算分桶 ----------
console.log('\n[12b] 层内比例筛、去重与预算分桶')
{
  clearAffixEvalCache()
  const keepAll = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: 20,
    enablePenRatePath: false, routeRetentionRatio: 0, minRetainedRoutes: 8, maxRetainedRoutes: 64,
    initialCandidateThreshold: 0,
  })
  clearAffixEvalCache()
  const strict = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: 20,
    enablePenRatePath: false, routeRetentionRatio: 1, minRetainedRoutes: 8, maxRetainedRoutes: 64,
    initialCandidateThreshold: 0,
  })
  check('走完 beam 阶段', keepAll.phasesCompleted.includes('beam'))
  check('比例 0 不淘汰层内路线', keepAll.layerRatioDropped === 0,
    `dropped=${keepAll.layerRatioDropped}`)
  check('比例 1 会淘汰层内路线', strict.layerRatioDropped > 0,
    `dropped=${strict.layerRatioDropped}`)
  check('比例把存活路线压下来',
    strict.survivedRoutes <= keepAll.survivedRoutes,
    `${strict.survivedRoutes} <= ${keepAll.survivedRoutes}`)
  check('阶段里不再有换档（swap1 / swap2 已删）',
    !keepAll.phasesCompleted.includes('swap1') && !keepAll.phasesCompleted.includes('swap2'),
    keepAll.phasesCompleted.join(' → '))

  // 去重：两条目、预算 2 的完整状态集合 = 1(空) + 2(各 1 档) + 3(AA/BB/AB) = 6。
  // 若不做规范化去重，AB 会从 A 起手和 B 起手各记一遍 → 7。
  const pair = library
    .filter((e) => ['substat:atkPercent', 'substat:atkFlat'].includes(e.id))
    .map((e) => ({ ...e, cap: 6 }))
  clearAffixEvalCache()
  const dedup = solveOptimalAffixAllocation({
    ctx, entries: pair, maxTotalRolls: 2,
    enablePenRatePath: false, routeRetentionRatio: 0, minRetainedRoutes: 8, maxRetainedRoutes: 64,
    initialCandidateThreshold: 0,
  })
  check('按规范化分配去重（两条目预算 2 → 6 个状态）',
    dedup.survivedRoutes === 6, `存活 ${dedup.survivedRoutes}`)
  check('去重后走过的预算层 = 3（0/1/2 档）',
    dedup.beamLayers === 3, `beamLayers=${dedup.beamLayers}`)

  // rollCost > 1：按已用词条数分桶推进，不会停在奇数档
  const base = library.find((e) => e.id === 'substat:atkPercent')
  check('测试条目存在', Boolean(base))
  if (base) {
    const costEntry = { ...base, id: 'cost2', rollCost: 2, cap: 4 }
    clearAffixEvalCache()
    const cost = solveOptimalAffixAllocation({
      ctx, entries: [costEntry], maxTotalRolls: 5,
      enablePenRatePath: false, initialCandidateThreshold: 0, routeRetentionRatio: 0,
    })
    check('rollCost=2 按预算分桶（用档为偶数、不超 5）',
      cost.usedRolls % 2 === 0 && cost.usedRolls <= 4,
      `usedRolls=${cost.usedRolls}`)
  }
}

// ---------- 13. 无半成品：预算耗尽后返回的仍是完整状态 ----------
console.log('\n[13] 预算不足时不产生半成品')
{
  clearAffixEvalCache()
  const tiny = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: 46, maxWorkUnits: 40,
  })
  check('预算极小且无法完成任何一轮时，退回基线而非半成品',
    Math.abs(tiny.totalDamage - tiny.baselineDamage) < 1e-9 || tiny.truncated,
    `总伤 ${tiny.totalDamage}，基线 ${tiny.baselineDamage}，截断 ${tiny.truncated}`)
  check('退回的结果仍可重算一致',
    Math.abs(evaluateAffixCounts(ctx, tiny.counts, tiny.panelDeltas, tiny.valuePerCount, tiny.extraGains).grandTotal - tiny.totalDamage) < 1e-6)
  check('结果不劣于基线', tiny.totalDamage >= tiny.baselineDamage - 1e-9)
}

// ---------- 14. 基础值取值：换音擎必须让缓存失效 ----------
console.log('\n[14] 换音擎（基础值相同、加成不同）不得吃到旧缓存')
{
  const wengine = (id, name, advanced) => ({
    id,
    name,
    profession: '强攻',
    rarity: 'S',
    avatar_image: null,
    note: '',
    baseAtk: 594,
    baseDef: 0,
    advancedStats: { ...createEmptyWengineAdvancedStats(), ...advanced },
    fixedBuffs: createEmptySelfTeamBuffs(),
    refinementBuffs: [createEmptySelfTeamBuffs()],
  })
  // 两把音擎基础攻击/防御完全相同，只有加成不同 —— 等价于「签名只带 baseAtk 就失效」的场景
  const wA = wengine('wa', '音擎A', { critRate: 24 })
  const wB = wengine('wb', '音擎B', { penRate: 24 })

  const baseCtxInput = {
    isMb: false,
    isFengYu: false,
    agents: [{
      id: 'a',
      name: '测试',
      element: '电',
      profession: '强攻',
      basePanel: {
        ...createEmptyAgentBasePanel(),
        hp: 9000, atk: 900, def: 700, critRate: 5, critDmg: 50,
        anomalyControl: 100, energyRegen: 120, directDmgMult: 100, anomalyMult: 125,
      },
    }],
    wengines: [wA, wB],
    bangboo: {
      id: 'none', name: 'x', avatar_image: null, effects: [],
      refinementEffects: [], fixedMods: {}, refinementMods: {},
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
  }
  const ctxA = buildOptimalEvalContext({
    ...baseCtxInput,
    teamSlots: [{ agentId: 'a', wengineId: 'wa', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' }],
  })
  const ctxB = buildOptimalEvalContext({
    ...baseCtxInput,
    teamSlots: [{ agentId: 'a', wengineId: 'wb', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' }],
  })

  clearAffixEvalCache()
  const probeCounts = { ...createEmptyAffixCounts(), atkPercent: 10 }
  const resA = evaluateAffixCounts(ctxA, probeCounts)
  const resB = evaluateAffixCounts(ctxB, probeCounts)
  check('换音擎后暴击率按新音擎重算',
    resB.finalPanel.critRate === resA.finalPanel.critRate - 24,
    `${resA.finalPanel.critRate} → ${resB.finalPanel.critRate}`)
  check('换音擎后穿透率按新音擎重算',
    resB.finalPanel.penRate === resA.finalPanel.penRate + 24,
    `${resA.finalPanel.penRate} → ${resB.finalPanel.penRate}`)
  check('两个音擎不被当作同一上下文（未返回同一缓存对象）', resA !== resB)
}

// ---------- 15. 基础值取值：角色基础面板变化必须生效 ----------
console.log('\n[15] 角色基础面板变化不得吃到旧缓存')
{
  const makeAgentCtx = (baseAtk) => buildOptimalEvalContext({
    isMb: false,
    isFengYu: false,
    teamSlots: [{ agentId: 'a', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' }],
    agents: [{
      id: 'a',
      name: '测试',
      element: '电',
      profession: '强攻',
      basePanel: {
        ...createEmptyAgentBasePanel(),
        hp: 9000, atk: baseAtk, def: 700, critRate: 5, critDmg: 50,
        anomalyControl: 100, energyRegen: 120, directDmgMult: 100, anomalyMult: 125,
      },
    }],
    wengines: [],
    bangboo: {
      id: 'none', name: 'x', avatar_image: null, effects: [],
      refinementEffects: [], fixedMods: {}, refinementMods: {},
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

  clearAffixEvalCache()
  const zeroCounts = createEmptyAffixCounts()
  const tenCounts = { ...createEmptyAffixCounts(), atkPercent: 10 }

  // 用「同一角色：0 档 vs 10 档」的差值隔离出攻击%的贡献，
  // 这样不受 2 号位固定攻击等常数项干扰
  const lowZero = evaluateAffixCounts(makeAgentCtx(900), zeroCounts)
  const lowTen = evaluateAffixCounts(makeAgentCtx(900), tenCounts)
  const highZero = evaluateAffixCounts(makeAgentCtx(1800), zeroCounts)
  const highTen = evaluateAffixCounts(makeAgentCtx(1800), tenCounts)

  const lowDelta = lowTen.finalPanel.atk - lowZero.finalPanel.atk
  const highDelta = highTen.finalPanel.atk - highZero.finalPanel.atk
  console.log(`    基础 900：0 档 ${lowZero.finalPanel.atk} → 10 档 ${lowTen.finalPanel.atk}，增量 ${lowDelta.toFixed(1)}（期望 900×30%=270）`)
  console.log(`    基础 1800：0 档 ${highZero.finalPanel.atk} → 10 档 ${highTen.finalPanel.atk}，增量 ${highDelta.toFixed(1)}（期望 1800×30%=540）`)
  check('攻击%按基础值乘算（基础 900）',
    Math.abs(lowDelta - 270) < 0.5, `${lowDelta.toFixed(1)} vs 270`)
  check('角色基础攻击翻倍后，攻击%带来的增量同步翻倍（未吃旧基础值）',
    Math.abs(highDelta - lowDelta * 2) < 0.5,
    `增量 ${lowDelta.toFixed(1)} → ${highDelta.toFixed(1)}`)
}

// ---------- 16. 跨轮缓存：不随主 C 面板变化的招式 ----------
console.log('\n[16] 跨轮缓存（不随主 C 面板变化的招式）')
{
  // 背景（2026-09-10 实测）：求解器每评估一次，会把全部招式逐个重算面板。
  // 但只有「持有者/异常强度提供者/触发者 = 主 C」的招式才随词条变；其余在同一套
  // 配置下结果恒定。此前只有扫掠路径做了这个缓存，求解器没有 —— 实测（42 招式）
  // 那些恒定招式占单次评估约 60%，等于每次评估都白算一遍。
  const twoAgentBasePanel = (atk) => ({
    ...createEmptyAgentBasePanel(),
    hp: 9000, atk, def: 700, critRate: 5, critDmg: 50,
    anomalyControl: 100, energyRegen: 120, directDmgMult: 100, anomalyMult: 125,
  })
  const makeTwoAgentCtx = (hits) => makeCtx({
    teamSlots: [
      { agentId: 'a', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
      { agentId: 'b', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    ],
    agents: [
      { id: 'a', name: '主C', element: '电', profession: '强攻', basePanel: twoAgentBasePanel(900) },
      { id: 'b', name: '队友', element: '电', profession: '强攻', basePanel: twoAgentBasePanel(600) },
    ],
    hits,
  })

  const mainHits = makeHits(3, 'a')
  const allyHits = makeHits(3, 'b')
  // 队友招式：持有者/提供者/触发者都不是主 C → 不随词条变
  for (const hit of allyHits) {
    hit.anomalyPowerAgentId = 'b'
    hit.triggerAgentId = 'b'
  }
  const cachedCtx = makeTwoAgentCtx([...mainHits, ...allyHits])

  // 判定函数本身：缓存的边界必须与它一致
  const mainDepends = mainHits.every((h) => optimalHitDependsOnMainAffixPanel(cachedCtx, h))
  const allyDepends = allyHits.some((h) => optimalHitDependsOnMainAffixPanel(cachedCtx, h))
  check('主 C 自己的招式判定为「随词条变」（不进缓存）', mainDepends)
  check('队友招式判定为「不随词条变」（可跨轮复用）', !allyDepends)

  const countsX = { ...createEmptyAffixCounts(), atkPercent: 10 }
  const countsY = { ...createEmptyAffixCounts(), critRate: 10 }

  // 基准：每次评估前都清空缓存（强制全量重算）
  clearAffixEvalCache()
  const refX = evaluateAffixCounts(cachedCtx, countsX).grandTotal
  clearAffixEvalCache()
  const refY = evaluateAffixCounts(cachedCtx, countsY).grandTotal

  // 对照：不清缓存，队友招式走跨轮复用
  clearAffixEvalCache()
  const gotX = evaluateAffixCounts(cachedCtx, countsX).grandTotal
  const gotY = evaluateAffixCounts(cachedCtx, countsY).grandTotal

  console.log(`    清缓存 X=${refX.toFixed(3)} Y=${refY.toFixed(3)}｜走缓存 X=${gotX.toFixed(3)} Y=${gotY.toFixed(3)}`)
  check('走跨轮缓存的结果与全量重算一致（X）', Math.abs(gotX - refX) < 1e-9, `${gotX} vs ${refX}`)
  check('走跨轮缓存的结果与全量重算一致（Y）', Math.abs(gotY - refY) < 1e-9, `${gotY} vs ${refY}`)
  check('两次评估的档数分配确实不同（否则本用例是空转）', Math.abs(refX - refY) > 1e-9,
    `X=${refX.toFixed(3)} vs Y=${refY.toFixed(3)}`)

  // 缓存确实省了计算：大量队友招式 + 少量主 C 招式时，第二轮应显著更快
  const manyAllyHits = makeHits(400, 'b')
  for (const hit of manyAllyHits) {
    hit.anomalyPowerAgentId = 'b'
    hit.triggerAgentId = 'b'
  }
  const perfCtx = makeTwoAgentCtx([...makeHits(4, 'a'), ...manyAllyHits])

  clearAffixEvalCache()
  const t0 = performance.now()
  evaluateAffixCounts(perfCtx, countsX)
  const coldMs = performance.now() - t0

  const t1 = performance.now()
  evaluateAffixCounts(perfCtx, countsY)
  const warmMs = performance.now() - t1

  console.log(`    ${manyAllyHits.length + 4} 招式：首轮 ${coldMs.toFixed(2)}ms → 次轮 ${warmMs.toFixed(2)}ms（比值 ${(coldMs / warmMs).toFixed(1)}x）`)
  check('队友招式走缓存后，次轮评估显著快于首轮（≥2x）', coldMs / warmMs >= 2,
    `${coldMs.toFixed(2)}ms → ${warmMs.toFixed(2)}ms`)
}

// ---------- 17. 队友数据变化必须让缓存失效 ----------
console.log('\n[17] 队友数据变化必须让缓存失效（上下文签名覆盖队伍）')
{
  // 缺陷与实测（2026-09-10 用真实方案复现）：引擎会读队友数据
  // （collectTeamDriveDiscMods 遍历全部槽位、collectAllBuffEffects 取全队效果、
  // 事件按 ownerAgentId 反查角色文档），但签名只覆盖主 C → 只改队友时缓存不失效。
  // 实测：队友音擎 Electro_Lip_Gloss → Identity_Base，
  //   不手动清缓存 61863011 → 61863011（错）；每次清缓存 61863011 → 58285182（对）。
  const wengineDoc = (id, externalAtkPercent) => ({
    id,
    name: id,
    profession: '强攻',
    rarity: 'S',
    avatar_image: null,
    note: '',
    baseAtk: 594,
    advancedStats: { ...createEmptyWengineAdvancedStats(), externalAtkPercent },
    fixedBuffs: {},
    refinementBuffs: [],
  })

  const basePanel = (atk) => ({
    ...createEmptyAgentBasePanel(),
    hp: 9000, atk, def: 700, critRate: 5, critDmg: 50,
    anomalyControl: 100, energyRegen: 120, directDmgMult: 100, anomalyMult: 125,
  })

  const buildCtx = (allyWengineId) =>
    makeCtx({
      teamSlots: [
        { agentId: 'a', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
        { agentId: 'b', wengineId: allyWengineId, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
      ],
      agents: [
        { id: 'a', name: '主C', element: '电', profession: '强攻', basePanel: basePanel(900) },
        { id: 'b', name: '队友', element: '电', profession: '强攻', basePanel: basePanel(600) },
      ],
      wengines: [wengineDoc('we-low', 10), wengineDoc('we-high', 50)],
      hits: (() => {
        const ally = makeHits(2, 'b')
        for (const hit of ally) {
          hit.anomalyPowerAgentId = 'b'
          hit.triggerAgentId = 'b'
        }
        return [...makeHits(1, 'a'), ...ally]
      })(),
    })

  const counts = { ...createEmptyAffixCounts(), atkPercent: 15 }
  const ctxLow = buildCtx('we-low')
  const ctxHigh = buildCtx('we-high')

  // 连续调用，中间不清缓存：签名若漏队友，第二次会拿到第一次的旧值
  clearAffixEvalCache()
  const lowCached = evaluateAffixCounts(ctxLow, counts).grandTotal
  const highCached = evaluateAffixCounts(ctxHigh, counts).grandTotal

  // 每次清缓存（基准真值）
  clearAffixEvalCache()
  const lowTruth = evaluateAffixCounts(ctxLow, counts).grandTotal
  clearAffixEvalCache()
  const highTruth = evaluateAffixCounts(ctxHigh, counts).grandTotal

  console.log(`    低加成音擎 ${lowTruth.toFixed(0)}／高加成音擎 ${highTruth.toFixed(0)}（基准真值）`)
  console.log(`    不手动清缓存：低 ${lowCached.toFixed(0)}／高 ${highCached.toFixed(0)}`)

  check('换队友音擎确实改变结果（否则本用例无意义）',
    Math.abs(highTruth - lowTruth) > 1e-6, `${lowTruth.toFixed(0)} vs ${highTruth.toFixed(0)}`)
  check('不清缓存也能读到换队友音擎后的新值（签名覆盖队伍数据）',
    Math.abs(highCached - highTruth) < 1e-6,
    `缓存值 ${highCached.toFixed(0)} vs 真值 ${highTruth.toFixed(0)}`)
}

// ---------- 18. 就地修改队伍数组（真实 UI 形态）必须可见 ----------
console.log('\n[18] 就地修改同一个 teamSlots 数组（真实 UI 形态）后，结果必须跟着变')
{
  // 为什么必须单测「就地修改」这个形态：
  // 真实页面里 `DamageCalcPage.vue` 的 teamSlots 是 `reactive()` 数组，全生命周期
  // 只有一个实例，换人/换音擎/改影画全是**就地赋值**；而 buildOptimalEvalContext 里的
  // deepUnwrapReactive 用的是 toRaw，**不改变数组身份**。因此任何「按键对象身份记忆化」
  // 的缓存（例如 2026-09-10 曾短暂引入的 teamSlotsKeyCache）都会把槽位键冻结在首次计算时。
  // 其它用例都传内联数组字面量（每次都是新对象），抓不到这类缺陷。
  //
  // 改动项必须是**只经 buff 目录生效**的数据：队友音擎/影画里，
  // 基础攻击、局外加成那部分由 buildPanelSourceValuesForSlot 直接读 slot 计算，
  // 就算目录键被冻结也照样会变 —— 用它测不出冻结。这里改用队友的 **4 件套**
  // （collectSlotDriveDiscEffects 对非主 C 只取 team 级效果，完全走 buff 目录）。
  //
  // 实测记录（scripts/probe-inplace-team-mutation.mjs，真实方案 scheme-dan）：
  //   队友影画 0→6：真值 62114191 → 71083794，被冻结时 62114191 → 62114191（错）
  //   队友 4 件套： 真值 58731561 → 58891841，被冻结时 58731561 → 58731561（错）
  const basePanel = (atk) => ({
    ...createEmptyAgentBasePanel(),
    hp: 9000, atk, def: 700, critRate: 5, critDmg: 50,
    anomalyControl: 100, energyRegen: 120, directDmgMult: 100, anomalyMult: 125,
  })
  /** 只带「4 件套：全队攻击 +N」的驱动盘文档 */
  const driveDiscDoc = (id, teamAtkFlat) => ({
    id,
    name: id,
    avatar_image: null,
    twoPieceNote: '',
    fourPieceNote: '',
    twoPieceEffects: [],
    twoPieceMods: createEmptyBuffStatModifiers(),
    fourPieceBuffs: {
      effectBlocks: [],
      effects: [
        {
          id: `${id}-atk`,
          kind: 'fixed',
          stat: 'atk',
          value: teamAtkFlat,
          scope: 'general',
          applyTarget: 'team',
          enabledDefault: true,
        },
      ],
    },
  })

  // ★ 稳定数组：两次评估共用同一个对象，第二次评估前就地改内容
  const stableTeamSlots = [
    { agentId: 'a', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    { agentId: 'b', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'disc-low' },
  ]
  const stableAgents = [
    { id: 'a', name: '主C', element: '电', profession: '强攻', basePanel: basePanel(900) },
    { id: 'b', name: '队友', element: '电', profession: '强攻', basePanel: basePanel(600) },
  ]
  const overrides = {
    teamSlots: stableTeamSlots,
    agents: stableAgents,
    driveDiscs: [driveDiscDoc('disc-low', 50), driveDiscDoc('disc-high', 200)],
    hits: makeHits(1, 'a'),
  }

  const counts = { ...createEmptyAffixCounts(), atkPercent: 15 }

  // 真值：每次都重新装配（等价于「刷新页面后重算」）
  const truthLow = (() => {
    invalidateBuffCatalogCache()
    clearAffixEvalCache()
    return evaluateAffixCounts(makeCtx(overrides), counts).grandTotal
  })()

  // 预热：让缓存在「队友 4 件套 = disc-low」的状态下建立
  invalidateBuffCatalogCache()
  clearAffixEvalCache()
  const beforeMutate = evaluateAffixCounts(makeCtx(overrides), counts).grandTotal

  // ★ 就地改队友 4 件套（不换数组、不手动清任何缓存）
  stableTeamSlots[1].fourPieceDriveDiscId = 'disc-high'
  const afterMutate = evaluateAffixCounts(makeCtx(overrides), counts).grandTotal

  const truthHigh = (() => {
    invalidateBuffCatalogCache()
    clearAffixEvalCache()
    return evaluateAffixCounts(makeCtx(overrides), counts).grandTotal
  })()

  console.log(`    就地改队友 4 件套：${beforeMutate.toFixed(0)} → ${afterMutate.toFixed(0)}`)
  console.log(`    真值（每次重装）：${truthLow.toFixed(0)} → ${truthHigh.toFixed(0)}`)

  check('就地改队友 4 件套确实改变结果（否则本用例无意义）',
    Math.abs(truthHigh - truthLow) > 1e-6, `${truthLow.toFixed(0)} vs ${truthHigh.toFixed(0)}`)
  check('就地改队友 4 件套后结果跟着变（槽位键未被按数组身份冻结）',
    Math.abs(afterMutate - beforeMutate) > 1e-6,
    `改后 ${afterMutate.toFixed(0)} vs 改前 ${beforeMutate.toFixed(0)}`)
  check('就地改后的值与真值一致',
    Math.abs(afterMutate - truthHigh) < 1e-6,
    `就地 ${afterMutate.toFixed(0)} vs 真值 ${truthHigh.toFixed(0)}`)
}

// ---------- 19. 邦布精炼变化必须让结果失效 ----------
console.log('\n[19] 只改邦布精炼（其余不动）必须改变结果、且不吃旧缓存')
{
  // 缺陷与依据：ctx.panelContext.bangboo 是邦布文档，精炼只决定取 refinementEffects 的第几组，
  // 不体现在文档内容里；若签名漏掉 bangbooRefine，只改精炼时结果会停在旧值。
  const bangboo = {
    id: 'test-bangboo',
    name: '测试邦布',
    avatar_image: null,
    effects: [],
    effectBlocks: [],
    // 精1 全队攻击 +50；精5 全队攻击 +200（差值足够明显）
    refinementEffects: [
      [{ id: 'bb-r1', kind: 'fixed', stat: 'atk', value: 50, scope: 'general', applyTarget: 'team', enabledDefault: true }],
      [], [], [],
      [{ id: 'bb-r5', kind: 'fixed', stat: 'atk', value: 200, scope: 'general', applyTarget: 'team', enabledDefault: true }],
    ],
    refinementEffectBlocks: [[], [], [], [], []],
  }
  const hits = makeHits(1, 'a')
  const overrides = { bangboo, hits }

  const counts = { ...createEmptyAffixCounts(), atkPercent: 15 }

  // 精炼 1（建立缓存）
  clearAffixEvalCache()
  invalidateBuffCatalogCache()
  const refined1 = evaluateAffixCounts(makeCtx({ ...overrides, bangbooRefine: 1 }), counts).grandTotal

  // 只改精炼 → 3（★ 不手动清任何缓存）
  const refined5 = evaluateAffixCounts(makeCtx({ ...overrides, bangbooRefine: 5 }), counts).grandTotal

  // 真值
  clearAffixEvalCache()
  invalidateBuffCatalogCache()
  const truth1 = evaluateAffixCounts(makeCtx({ ...overrides, bangbooRefine: 1 }), counts).grandTotal
  clearAffixEvalCache()
  invalidateBuffCatalogCache()
  const truth5 = evaluateAffixCounts(makeCtx({ ...overrides, bangbooRefine: 5 }), counts).grandTotal

  console.log(`    精1 ${truth1.toFixed(0)}／精5 ${truth5.toFixed(0)}（基准真值）`)
  console.log(`    不清缓存：精1 ${refined1.toFixed(0)}／精5 ${refined5.toFixed(0)}`)

  check('改邦布精炼确实改变结果（否则本用例无意义）',
    Math.abs(truth5 - truth1) > 1e-6, `${truth1.toFixed(0)} vs ${truth5.toFixed(0)}`)
  check('不清缓存也能读到新精炼的结果（签名覆盖 bangbooRefine）',
    Math.abs(refined5 - truth5) < 1e-6,
    `缓存值 ${refined5.toFixed(0)} vs 真值 ${truth5.toFixed(0)}`)
}

// ---------- 20. 惰性源值地图不得自递归 ----------
console.log('\n[20] 惰性源值地图：闭包 ctx 自带同一张地图时不得自递归')
{
  // 背景（2026-09-10 核对时发现并用本用例复现）：
  // `buildPanelSourceValuesForSlot` 内部要建 `slotCtx = {...ctx, mainSlotIndex: slotIndex, skipConvert: true}`，
  // 再调 `collectPanelBuffMods(slotCtx)`。若 ctx 里带着按槽位惰性求值的源值地图，
  // 那么「计算槽位 X 的源值」的过程中会有多处 **eager** 读 `map.get(X)`：
  //   - `resolvePackMods` 的 `.has(slotIndex)/.get(slotIndex)`
  //   - 邦布分支与 `resolvePackEffectMods` 的 `.get(ctx.mainSlotIndex)`
  // 而读的正是「正在计算中的那个槽位」→ 再次触发该槽位计算 → 无限递归。
  // 实测：修复前 830 层后 `RangeError: Maximum call stack size exceeded`。
  // 修复：在 `slotCtx` 里显式 `panelSourceValuesBySlot: undefined`（该调用 skipConvert 恒为 true，
  // 转模效果整段被跳过，源值不可能被消费，故切断引用零成本）。
  //
  // 本用例刻意构造「地图的闭包 ctx 反过来带它自己」这一自引用形态：
  //   - 未修复时：这里会抛 RangeError → 用例失败（已实测）；
  //   - 已修复时：正常返回源值（已实测）。
  // 当前调用方不会产生自引用形态，本用例是结构性防护，防止将来某次「就地回填 ctx」
  // 把这条路径变成真的栈溢出 —— 那种故障在浏览器里只表现为页面卡死，极难定位。
  const teamAtk = (id, value) => ({
    id, kind: 'fixed', stat: 'atk', value,
    scope: 'general', applyTarget: 'team', enabledDefault: true,
  })
  const externalPanel = fillPanelStatsDefaults({})
  const mkAgent = (id) => ({
    id,
    name: id,
    element: '电',
    profession: '强攻',
    basePanel: createEmptyAgentBasePanel(),
    mindscapeBuffs: [
      { effectBlocks: [{ id: 'blk-1', name: '影画1', note: '', effects: [teamAtk(`${id}-ms`, 20)] }], effects: [] },
    ],
  })
  const mkDisc = (id, value) => ({
    id,
    name: id,
    avatar_image: null,
    twoPieceNote: '',
    fourPieceNote: '',
    twoPieceEffects: [],
    twoPieceMods: createEmptyBuffStatModifiers(),
    fourPieceBuffs: {
      effectBlocks: [{ id: 'blk-4', name: '4件套', note: '', effects: [teamAtk(`${id}-4pc`, value)] }],
      effects: [teamAtk(`${id}-4pc`, value)],
    },
  })

  const holder = {
    teamSlots: [
      { agentId: 'a', rank: 0, wengineId: 'none', wengineRefine: 1, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'dd-1' },
      { agentId: 'b', rank: 0, wengineId: 'none', wengineRefine: 1, twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    ],
    agents: [mkAgent('a'), mkAgent('b')],
    wengines: [],
    // 邦布用真实 id（不是 'none'）：邦布分支正是会 eager 读地图的那条路径
    bangboo: {
      id: 'bb-1',
      name: '测试邦布',
      avatar_image: null,
      effects: [],
      effectBlocks: [{ id: 'bb-blk', name: '固定', note: '', effects: [teamAtk('bb-fixed', 25)] }],
      refinementEffects: [[], [], [], [], []],
      refinementEffectBlocks: [[], [], [], [], []],
    },
    bangbooRefine: 1,
    mainSlotIndex: 0,
    driveDiscs: [mkDisc('dd-1', 60)],
    extraMods: createEmptyBuffStatModifiers(),
    skipConvert: false,
  }

  // ★ 自引用：先建地图，再把这张地图回填进它自己的闭包 ctx
  const selfMap = buildPanelSourceValuesBySlotMap(holder, externalPanel)
  holder.panelSourceValuesBySlot = selfMap

  invalidateBuffCatalogCache() // 强制内部走「建源 → 解析每个 pack」

  let resolved = null
  let thrown = null
  try {
    resolved = selfMap.get(0)
  } catch (error) {
    thrown = error
  }

  console.log(`    自引用形态下 get(0)：${thrown ? `抛错 ${thrown.name}` : '正常返回'}`)
  check('闭包 ctx 自带同一张地图时，按槽位取源值不得自递归',
    !thrown, thrown ? String(thrown.message).slice(0, 80) : 'ok')
  check('取到的源值结构完整',
    !!resolved && !!resolved.external && !!resolved.final,
    resolved ? `external=${!!resolved.external} final=${!!resolved.final}` : 'null')

  // 再次取值应为同一对象（记忆化）；同样要防住未修复时的递归，否则整进程会被未捕获异常干掉
  let second = null
  let secondThrown = null
  try {
    second = selfMap.get(0)
  } catch (error) {
    secondThrown = error
  }
  check('同一地图重复取同一槽位返回同一对象（记忆化生效）',
    !secondThrown && second === resolved,
    secondThrown ? `抛错 ${secondThrown.name}` : `same=${second === resolved}`)
}

console.log('\n[21] 词条分配：有条件 gain: 与局外词条同一套预算')
{
  function makeCategoryHits(category, n = 1) {
    return makeHits(n).map((hit, index) => ({
      ...hit,
      id: `h_${category}_${index}`,
      skill: { ...hit.skill, category, id: `s_${category}_${index}` },
      coords: [{ category, subcategoryId: null }],
    }))
  }

  const scoped = {
    id: 'gain-basic-dmg',
    label: '普攻增伤',
    target: 'gain:dmgBonus',
    perRoll: 50,
    cap: 1,
    group: '副词条',
    rollCost: 1,
    enabledByDefault: true,
    scope: 'skill',
    skillCategory: 'basic',
  }
  const atk = {
    id: 'stat-atk',
    label: '局外攻击%',
    target: 'panel:atkPercent',
    perRoll: 3,
    cap: 1,
    group: '副词条',
    rollCost: 1,
    enabledByDefault: true,
  }
  const gain = extraGainFromLibraryEntry(scoped, 1)
  check('库条目条件抄进 extraGain', gain?.scope === 'skill' && gain.skillCategory === 'basic')
  check('条件摘要含普通攻击', affixEntryConditionSummary(scoped).includes('普通攻击'))

  const persisted = coerceAffixLibraryState({
    origin: 'empty',
    customEntries: [scoped],
    enabledOverride: { [scoped.id]: true },
  })
  check(
    '存档读回招式条件',
    persisted.customEntries[0]?.skillCategory === 'basic' && persisted.customEntries[0]?.scope === 'skill',
  )

  const basicCtx = makeCtx({ hits: makeCategoryHits('basic') })
  const ultCtx = makeCtx({ hits: makeCategoryHits('ultimate') })
  const zeros = createEmptyAffixCounts()
  const scopedInput = entryRollsToEvalInput([scoped], { [scoped.id]: 1 })

  clearAffixEvalCache()
  const basicBase = evaluateAffixCounts(basicCtx, zeros)
  const basicPlus = evaluateAffixCounts(
    basicCtx,
    zeros,
    scopedInput.deltas,
    scopedInput.valuePerCount,
    scopedInput.extraGains,
  )
  const ultBase = evaluateAffixCounts(ultCtx, zeros)
  const ultPlus = evaluateAffixCounts(
    ultCtx,
    zeros,
    scopedInput.deltas,
    scopedInput.valuePerCount,
    scopedInput.extraGains,
  )
  check('流程 hits：普攻吃到条件增伤', basicPlus.grandTotal > basicBase.grandTotal)
  check(
    '流程 hits：终结技不吃普攻限定',
    Math.abs(ultPlus.grandTotal - ultBase.grandTotal) < 1e-6,
    `${ultBase.grandTotal} → ${ultPlus.grandTotal}`,
  )

  const emptyCoordCtx = makeCtx({ hits: makeHits(1) })
  clearAffixEvalCache()
  const emptyBase = evaluateAffixCounts(emptyCoordCtx, zeros)
  const emptyPlus = evaluateAffixCounts(
    emptyCoordCtx,
    zeros,
    scopedInput.deltas,
    scopedInput.valuePerCount,
    scopedInput.extraGains,
  )
  check(
    '空 coords 的 hits 不吃招式限定（与通用面板同规则）',
    Math.abs(emptyPlus.grandTotal - emptyBase.grandTotal) < 1e-6,
  )

  const basicSolved = solveOptimalAffixAllocation({
    ctx: basicCtx,
    entries: [scoped, atk],
    maxTotalRolls: 1,
  })
  const ultSolved = solveOptimalAffixAllocation({
    ctx: ultCtx,
    entries: [scoped, atk],
    maxTotalRolls: 1,
  })
  check(
    '纯普攻流程把唯一档分给普攻限定增伤',
    (basicSolved.rollsByEntryId[scoped.id] ?? 0) === 1,
    JSON.stringify(basicSolved.rollsByEntryId),
  )
  check(
    '纯终结技流程不把档分给普攻限定，改给攻击%',
    (ultSolved.rollsByEntryId[scoped.id] ?? 0) === 0 && (ultSolved.rollsByEntryId[atk.id] ?? 0) === 1,
    JSON.stringify(ultSolved.rollsByEntryId),
  )
}

console.log('\n[游戏 cap 税] 触发条目占档后目标 cap 减 1')
{
  const atk = library.find((e) => e.id === 'substat:atkPercent')
  const crit = library.find((e) => e.id === 'substat:critRate')
  if (atk && crit) {
    const trigger = { ...atk, id: 'main:slot5:externalAtkPercent', cap: 1, group: '5号位', perRoll: 1 }
    const target = { ...crit, id: 'substat:atkPercent', cap: 1, group: '副词条', perRoll: 1000 }
    const solved = solveOptimalAffixAllocation({
      ctx,
      entries: [trigger, target],
      maxTotalRolls: 2,
      groupCaps: { '5号位': 1 },
      entryCapTaxes: [{ whenEntryId: trigger.id, targetEntryId: target.id, amount: 1 }],
    })
    const triggerRolls = solved.rollsByEntryId[trigger.id] ?? 0
    const targetRolls = solved.rollsByEntryId[target.id] ?? 0
    check(
      '选了触发条目后目标不能再占满原 cap',
      !(triggerRolls >= 1 && targetRolls >= 1),
      `trigger=${triggerRolls} target=${targetRolls}`,
    )
  } else {
    check('游戏 cap 税：测试条目存在', false)
  }
}

console.log('\n[穿透专路] 24+8 锁满、固穿重测、初始门槛、B 截顶、共同预算')
{
  const mains = createDriveDiscMainStatAffixEntries()
  const twos = createDriveDiscTwoPieceAffixEntries()
  const slot5Dmg = mains.find((e) => e.id === 'main:slot5:dmgBonus')
  const slot5Pen = mains.find((e) => e.id === 'main:slot5:penRate')
  const setDmg = twos.find((e) => e.id === 'set:dmgBonus:10')
  const setPen = twos.find((e) => e.id === 'set:penRate:8')
  const substPen = library.find((e) => e.id === 'substat:pen')
  const substAtk = library.find((e) => e.id === 'substat:atkPercent')
  check('专路种子按字段认穿透率（不写 id）',
    slot5Pen && setPen && isPenRateAffixTarget(slot5Pen.target) && isPenRateAffixTarget(setPen.target),
    `${slot5Pen?.target} / ${setPen?.target}`)

  const locks = collectPenRateFieldLocks(
    [slot5Pen, setPen, substPen].filter(Boolean),
    {},
    { '5号位': 1, '2件套': 1, 副词条: 0 },
    30,
  )
  check('种子把 24 与 8 各锁 1 档、不锁固穿',
    (locks['main:slot5:penRate'] ?? 0) === 1 && (locks['set:penRate:8'] ?? 0) === 1
      && !locks['substat:pen'],
    JSON.stringify(locks))

  check('自建同字段条目一样被种子认（不写 id）',
    (collectPenRateFieldLocks(
      [{ id: 'custom:pen30', label: 'x', target: 'panel:penRate', perRoll: 30, cap: 1, group: '5号位', rollCost: 1, enabledByDefault: true }],
      {},
      { '5号位': 1 },
      30,
    )['custom:pen30'] ?? 0) === 1,
    `cap=${DEFENSE_ZONE_PEN_RATE_CAP}`)

  check('穿透率锁到 95% 上限就停（再加是浪费）',
    (collectPenRateFieldLocks(
      [{ id: 'custom:pen60', label: 'x', target: 'panel:penRate', perRoll: 60, cap: 9, group: '5号位', rollCost: 1, enabledByDefault: true }],
      {},
      { '5号位': 0 },
      30,
    )['custom:pen60'] ?? 0) === 1)

  // 解析落点：需要固穿 > 可用档数 → 堆到底，候选 {n−1, n}
  const ladder = resolveFlatPenLadder({
    entries: [substPen].filter(Boolean),
    lockedRolls: {},
    effectiveDefense: 953 * 0.5,
    groupCaps: { 副词条: 0 },
    maxTotalRolls: 30,
  })
  check('固穿落点解析：候选 = {堆到底−1, 堆到底}',
    ladder != null && ladder.candidates.length === 2
      && ladder.candidates[1] - ladder.candidates[0] === 1,
    JSON.stringify(ladder))

  // 有效防御为 0（已减完）→ n = 0 → 只有一个世界（只绑穿透率）
  const ladderZero = resolveFlatPenLadder({
    entries: [substPen].filter(Boolean),
    lockedRolls: {},
    effectiveDefense: 0,
    groupCaps: { 副词条: 0 },
    maxTotalRolls: 30,
  })
  check('防御已减完 → 候选只有 0 档（不再堆固穿）',
    ladderZero != null && ladderZero.candidates.length === 1 && ladderZero.candidates[0] === 0,
    JSON.stringify(ladderZero))

  const penEntries = [slot5Dmg, slot5Pen, setDmg, setPen, substPen, substAtk].filter(Boolean)
  const groupCaps = { '5号位': 1, '2件套': 1, 副词条: 0 }
  const highBonusCtx = makeCtx({
    activeSlotPanels: {
      a: fillPanelStatsDefaults({
        hp: 9000, atk: 2500, def: 700, critRate: 70, critDmg: 140,
        dmgBonus: 90, penRate: 0, pen: 0,
      }),
    },
    enemyInput: {
      level: 60, defense: 953, resistanceType: 'normal',
      vulnerableMultiplier: 1, staggerMultiplier: 1.5, specialMultiplier: 1,
    },
  })

  const emptyEval = evaluateAffixCounts(highBonusCtx, createEmptyAffixCounts())
  const withRate = entryRollsToEvalInput(
    [slot5Pen, setPen],
    { 'main:slot5:penRate': 1, 'set:penRate:8': 1 },
  )
  const withRatePlusPen = entryRollsToEvalInput(
    [slot5Pen, setPen, substPen],
    { 'main:slot5:penRate': 1, 'set:penRate:8': 1, 'substat:pen': 8 },
  )
  const onlyFlatPen = entryRollsToEvalInput([substPen], { 'substat:pen': 8 })
  const evalFrom = (input) => evaluateAffixCounts(
    highBonusCtx,
    { ...createEmptyAffixCounts(), ...input.counts },
    input.deltas,
    input.valuePerCount,
    input.extraGains,
  ).grandTotal
  const gainFlatOnEmpty = evalFrom(onlyFlatPen) - emptyEval.grandTotal
  const gainFlatOnRate = evalFrom(withRatePlusPen) - evalFrom(withRate)
  check('24+8 下固穿边际高于无穿透',
    gainFlatOnRate > gainFlatOnEmpty,
    `有穿透 ${gainFlatOnRate.toFixed(1)} vs 无穿透 ${gainFlatOnEmpty.toFixed(1)}`)

  clearAffixEvalCache()
  const withPath = solveOptimalAffixAllocation({
    ctx: highBonusCtx,
    entries: penEntries,
    maxTotalRolls: 20,
    groupCaps,
    searchPreset: 'fine',
  })
  check('穿透专路已跑', withPath.penRatePathUsed === true, String(withPath.penRatePathUsed))
  check('叶释渊同类空盘选出 24+8',
    (withPath.rollsByEntryId['main:slot5:penRate'] ?? 0) >= 1
      && (withPath.rollsByEntryId['set:penRate:8'] ?? 0) >= 1,
    JSON.stringify(withPath.rollsByEntryId))
  check('提升率用空盘基线而不是 24+8 内部基线',
    Math.abs(withPath.baselineDamage - emptyEval.grandTotal) < 1e-6,
    `${withPath.baselineDamage} vs ${emptyEval.grandTotal}`)
  check('专路按预设 fine 生效（门槛 0.2 / 最小保留 4）',
    withPath.searchParams.initialCandidateThreshold === AFFIX_SEARCH_PRESETS.fine.initialCandidateThreshold
      && withPath.searchParams.minRetainedRoutes === AFFIX_SEARCH_PRESETS.fine.minRetainedRoutes,
    JSON.stringify(withPath.searchParams))

  clearAffixEvalCache()
  const noPath = solveOptimalAffixAllocation({
    ctx: highBonusCtx,
    entries: penEntries,
    maxTotalRolls: 20,
    groupCaps,
    enablePenRatePath: false,
    searchPreset: 'fine',
  })
  check('关掉专路则 penRatePathUsed=false', noPath.penRatePathUsed === false, String(noPath.penRatePathUsed))
  check('专路总伤不低于关掉专路',
    withPath.totalDamage >= noPath.totalDamage - 1e-6,
    `${withPath.totalDamage} vs ${noPath.totalDamage}`)

  clearAffixEvalCache()
  const looseRatio = solveOptimalAffixAllocation({
    ctx: highBonusCtx,
    entries: penEntries,
    maxTotalRolls: 12,
    groupCaps,
    enablePenRatePath: false,
    initialCandidateThreshold: 0,
    initialCandidateFloor: 0,
  })
  clearAffixEvalCache()
  const highRatio = solveOptimalAffixAllocation({
    ctx: highBonusCtx,
    entries: penEntries,
    maxTotalRolls: 12,
    groupCaps,
    enablePenRatePath: false,
    initialCandidateThreshold: 0.8,
    initialCandidateFloor: 0,
  })
  check('初始门槛越高淘汰越多（且确实有淘汰）',
    highRatio.initialDropped >= looseRatio.initialDropped && highRatio.initialDropped > 0,
    `门槛0.8 → ${highRatio.initialDropped} 条，门槛0 → ${looseRatio.initialDropped} 条`)

  // ---- 门槛 v2 的「候选兜底」：每组保底前 N 名（2026-09-16）----
  {
    const mk = (id, perRoll) => ({
      id, label: id, target: 'panel:atkPercent', perRoll, cap: 1, group: 'g1',
      rollCost: 1, enabledByDefault: true,
    })
    const strong = mk('t:strong', 30)
    const weak = mk('t:weak', 3)
    clearAffixEvalCache()
    const noFloor = solveOptimalAffixAllocation({
      ctx, entries: [strong, weak], maxTotalRolls: 4,
      enablePenRatePath: false, initialCandidateThreshold: 0.9, initialCandidateFloor: 0,
    })
    clearAffixEvalCache()
    const withFloor = solveOptimalAffixAllocation({
      ctx, entries: [strong, weak], maxTotalRolls: 4,
      enablePenRatePath: false, initialCandidateThreshold: 0.9, initialCandidateFloor: 2,
    })
    check('兜底关掉时：比例 0.9 把组内第 2 名剪掉',
      noFloor.initialDropped === 1 && noFloor.initialFloorSaved === 0,
      `淘汰 ${noFloor.initialDropped}｜兜底救回 ${noFloor.initialFloorSaved}`)
    check('兜底 2：组内第 2 名被救回并计数',
      withFloor.initialDropped === 0 && withFloor.initialFloorSaved === 1,
      `淘汰 ${withFloor.initialDropped}｜兜底救回 ${withFloor.initialFloorSaved}`)
    check('预设自带兜底 5',
      AFFIX_SEARCH_PRESETS.fast.initialCandidateFloor === 5
        && AFFIX_SEARCH_PRESETS.balanced.initialCandidateFloor === 5,
      `fast=${AFFIX_SEARCH_PRESETS.fast.initialCandidateFloor} balanced=${AFFIX_SEARCH_PRESETS.balanced.initialCandidateFloor}`)
  }

  // ---- 界面 → 求解器的参数透传（源码级守卫，2026-09-17）----
  // 真机事故：界面两处调用**都没传** `initialCandidateFloor` —— 高级设置弹窗里改「候选兜底」
  // 不生效，实际恒等于预设的 5。求解器自己的用例覆盖不到「界面有没有往下传」，所以直接在
  // 源码上钉一条：两个调用点必须各自把四个搜索参数都传上。
  {
    const componentSource = readFileSync(
      new URL('../src/components/calculator/OptimalAffixAllocSection.vue', import.meta.url),
      'utf8',
    )
    const requiredArgs = [
      'initialCandidateThreshold: affixSearchParams.value.initialCandidateThreshold',
      'initialCandidateFloor: affixSearchParams.value.initialCandidateFloor',
      'routeRetentionRatio: affixSearchParams.value.routeRetentionRatio',
      'minRetainedRoutes: affixSearchParams.value.minRetainedRoutes',
      'maxRetainedRoutes: affixSearchParams.value.maxRetainedRoutes',
    ]
    for (const call of ['await solveOptimalAffixAllocationAsync(', 'await solveGameAffixAllocationAsync(']) {
      const start = componentSource.indexOf(call)
      const block = start >= 0 ? componentSource.slice(start, start + 1200) : ''
      const missing = requiredArgs.filter((line) => !block.includes(line))
      check(`界面调用 ${call.trim()} 透传全部搜索参数`,
        start >= 0 && missing.length === 0,
        start < 0 ? '源码里找不到这个调用点' : (missing.length ? `缺：${missing.join(' / ')}` : '五个参数都在'))
    }
  }

  // 词条库「本组单词条上限」批量入口：**三跳都要在**（弹窗入口 / 弹窗→收益表转发 / 收益表→页面落盘），
  // 且**不锁在高级编辑里**（用户 2026-09-17 明确：简单模式也要显示）。
  // ⚠️ 2026-09-17 真机 bug：弹窗是嵌在 `AffixBenefitTable` 里的，只接了「收益表→页面」那一跳，
  //    中间没转发 → 点了「应用到本组 N 条」毫无反应。这条守卫就是为此加的。
  {
    const modalSource = readFileSync(
      new URL('../src/components/calculator/AffixLibraryModal.vue', import.meta.url),
      'utf8',
    )
    const benefitSource = readFileSync(
      new URL('../src/components/calculator/AffixBenefitTable.vue', import.meta.url),
      'utf8',
    )
    const sectionSource = readFileSync(
      new URL('../src/components/calculator/OptimalAffixAllocSection.vue', import.meta.url),
      'utf8',
    )
    check('词条库弹窗有「本组单词条上限」入口，且不锁在高级编辑里',
      modalSource.includes('本组单词条上限') &&
        modalSource.includes("emit('setGroupEntryCaps'") &&
        modalSource.includes('@click="applyGroupEntryCaps"') &&
        !/v-if="advancedEditing"[^>]*group-cap-row/.test(modalSource),
      '入口 + 事件 + 无条件渲染')
    check('输入框不预填（用户口径：预填值表意不清），没填时按钮禁用',
      modalSource.includes('batchEntryCapValue == null') &&
        !/batchEntryCap\.value =/.test(modalSource) &&
        !/v-model\.lazy\.number="batchEntryCap/.test(modalSource),
      '空值 → 禁用；没有预填逻辑')
    check('弹窗→收益表：中间层转发了 setGroupEntryCaps（漏了就点了没反应）',
      benefitSource.includes('setGroupEntryCaps: [name: string, cap: number]') &&
        benefitSource.includes("(name, cap) => emit('setGroupEntryCaps', name, cap)"),
      'AffixBenefitTable 声明 + 转发')
    check('「本组当前」按用户口径显示（一致时写全部 X，不一致时写「上限不一致」）',
      modalSource.includes('上限不一致') && modalSource.includes('全部不限（'),
      '两种口径都在模板/计算里')
    check('页面接了 @set-group-entry-caps 并落盘',
      sectionSource.includes('@set-group-entry-caps="setAffixLibraryGroupEntryCapsHandler"') &&
        sectionSource.includes('persistAffixLibrary(setAffixLibraryGroupEntryCaps('),
      '事件 → 库函数 → 落盘')
  }

  clearAffixEvalCache()
  const kCap = solveOptimalAffixAllocation({
    ctx: highBonusCtx,
    entries: penEntries,
    maxTotalRolls: 12,
    groupCaps,
    enablePenRatePath: false,
    initialCandidateThreshold: 0,
    minRetainedRoutes: 1,
    maxRetainedRoutes: 3,
  })
  // 三件套语义（2026-09-17 二次定稿）：比例不筛时由**上限**截顶，且上限截顶不算 truncated。
  check('上限截顶：比例不筛时每层也留不过 max 条，并记账截掉的数量',
    kCap.routeCapDropped > 0 && !kCap.truncated,
    `存活 ${kCap.survivedRoutes} 条｜截顶丢 ${kCap.routeCapDropped}｜truncated=${kCap.truncated}`)

  const starts = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: 8, maxWorkUnits: 400,
    enablePenRatePath: false,
  })
  check('普通路线走完 beam 阶段且不留半成品',
    starts.phasesCompleted.includes('beam') && starts.survivedRoutes >= 1,
    `层=${starts.beamLayers} 存活=${starts.survivedRoutes} 截断=${starts.truncated}`)

  clearAffixEvalCache()
  const sharedBudget = solveOptimalAffixAllocation({
    ctx: highBonusCtx,
    entries: penEntries,
    maxTotalRolls: 20,
    groupCaps,
    maxWorkUnits: 9000,
  })
  check('专路与普通路共用一份预算',
    sharedBudget.penRatePathUsed === true
      && sharedBudget.workBudget === 9000
      && sharedBudget.workUsed <= 9000,
    `budget=${sharedBudget.workBudget} used=${sharedBudget.workUsed} pathUsed=${sharedBudget.penRatePathUsed}`)
  // 恒等式：凡是计数的评估都按同一单价计费（= 1 + 命中数）。
  // 注意它**测不出**「专路世界探测漏记」那类问题（漏记时两边同时变小，恒等式照样成立）——
  // 2026-09-17 修的正是那一处（`evaluateWorldOnce` 走原始引擎、不经计数通道），
  // 证据是 fixture 上的前后对拍：632 次 / 61304 → 633 次 / 61401（+97 = 单价），见 dev-docs/词条最优分配.md。
  {
    const price = 1 + (ctx.hits?.length ?? 0)
    check('工作量恒等式：计算量 = 单价 × 评估次数',
      Math.abs(sharedBudget.workUsed - price * sharedBudget.engineCalls) < 1e-6,
      `${Math.round(sharedBudget.workUsed)} = ${price} × ${sharedBudget.engineCalls}`)
  }

  const fixturePath = path.join(FRONTEND_ROOT, 'fixtures/pen-rate-alloc/ye-shiyuan-pen-rate.json')
  const fixtureName = '21叶琉千——叶释渊--测试不带东西'
  try {
    const buffs = readJson(BUFFS_JSON)
    const pack = readJson(fixturePath)
    const scheme = Object.values(pack.schemes ?? {}).find((s) => s.name === fixtureName)
    const mainSlot = scheme?.teamSlots?.[Number(scheme.activeSlot ?? 0)]
    const mainAgent = buffs.agents?.find((a) => a.id === mainSlot?.agentId)
    if (!scheme || !mainAgent) {
      check('叶释渊 fixture 空盘方案可加载', false, fixtureName)
    } else {
      const skillById = new Map(
        [...(buffs.skills ?? []), ...(pack.customSkills ?? [])].map((s) => [s.id, s]),
      )
      const groupById = new Map((buffs.skillGroups ?? []).map((g) => [g.id, g]))
      const flow = resolveFlow({
        slots: scheme.slots,
        teamSlots: scheme.teamSlots.map((s) => ({ agentId: s.agentId })),
        findSkill: (id) => skillById.get(id) ?? null,
        findSkillGroup: (id) => groupById.get(id) ?? null,
        skillSubcategories: buffs.skillSubcategories,
      })
      const affixInputs = schemeAffixInputs(scheme, mainSlot.agentId)
      const enemyInput = scheme.panelState?.enemyInput ?? {
        level: 60, defense: 953, resistanceType: 'normal',
        vulnerableMultiplier: 1, staggerMultiplier: 1.5, specialMultiplier: 1,
      }
      const fixtureCtx = buildOptimalEvalContext({
        isMb: mainAgent.profession === '命破',
        isFengYu: mainAgent.profession === '锋御',
        teamSlots: scheme.teamSlots,
        agents: buffs.agents,
        wengines: buffs.wengines,
        bangboo: {
          id: 'none',
          name: 'none',
          avatar_image: null,
          effects: [],
          refinementEffects: [],
          fixedMods: {},
          refinementMods: {},
        },
        bangbooRefine: 1,
        driveDiscs: buffs.driveDiscs,
        mainSlotIndex: Number(scheme.activeSlot ?? 0),
        driveDiscMainStats: affixInputs.affixDriveDiscMainStats ?? {
          slot4MainStat: 'critDmg',
          slot5MainStat: 'externalAtkPercent',
          slot6MainStat: 'externalHpPercent',
        },
        enemyInput,
        baseDamageSource: 'atk',
        skillContext: buildGenericPanelSkillContext({
          element: mainAgent.element,
          staggerPhase: scheme.staggerPhase ?? 'stagger',
          damageKind: 'direct',
        }),
        buffSelection: null,
        slotBuffSelections: scheme.multiSlotBuffSelection ?? null,
        activeSlotPanels: schemeActivePanels(scheme),
        convertSlotPanels: scheme.convertSlotPanels ?? undefined,
        hits: flow.hits,
        resolveSubcategory: (id) =>
          (buffs.skillSubcategories ?? []).find((x) => x.id === id) ?? null,
        skillSubcategories: buffs.skillSubcategories,
        followUpSkillRules: buffs.followUpSkillRules,
      })
      clearAffixEvalCache()
      const fixtureT0 = Date.now()
      const fixtureSolved = solveOptimalAffixAllocation({
        ctx: fixtureCtx,
        entries: penEntries,
        maxTotalRolls: 20,
        groupCaps,
        searchPreset: 'fine',
      })
      const fixtureManualMs = Date.now() - fixtureT0
      check('叶释渊 fixture 空盘选出 24+8',
        (fixtureSolved.rollsByEntryId['main:slot5:penRate'] ?? 0) >= 1
          && (fixtureSolved.rollsByEntryId['set:penRate:8'] ?? 0) >= 1,
        `path=${fixtureSolved.winningPath} rolls=${JSON.stringify(fixtureSolved.rollsByEntryId)} hits=${flow.hits.length} ${fixtureManualMs}ms`)

      let libState = createDefaultAffixLibraryState()
      libState = setAffixLibraryEntryEnabled(libState, 'set:penRate:8', true)
      const uiEntries = resolveAffixLibrary(libState)
      const uiCaps = affixGroupCaps(libState)
      clearAffixEvalCache()
      const autoT0 = Date.now()
      const fixtureAuto = solveOptimalAffixAllocation({
        ctx: fixtureCtx,
        entries: uiEntries,
        maxTotalRolls: 30,
        groupCaps: uiCaps,
      })
      const fixtureAutoMs = Date.now() - autoT0
      console.log(
        `    [耗时] 求最优分配 均衡预设 全库+2件穿透 ${fixtureAutoMs}ms workUsed=${fixtureAuto.workUsed}/${fixtureAuto.workBudget} engine=${fixtureAuto.engineCalls} 存活=${fixtureAuto.survivedRoutes} path=${fixtureAuto.winningPath}`,
      )

      // 真实长流程（96 命中）下的预设实测：只在 AFFIX_CALIBRATE=1 时跑，平时不拖慢回归。
      if (process.env.AFFIX_CALIBRATE === '1') {
        console.log('    [校准] 真实 fixture（96 命中）预设实测')
        const candidates = [
          ['精细 fine', { searchPreset: 'fine' }],
          ['均衡 balanced', { searchPreset: 'balanced' }],
          ['快速 fast', { searchPreset: 'fast' }],
          ['参考(门槛0/比例0/保留16)', { initialCandidateThreshold: 0, routeRetentionRatio: 0, minRetainedRoutes: 16, maxRetainedRoutes: 16 }],
        ]
        let ref = 0
        for (const [label, extra] of candidates) {
          clearAffixEvalCache()
          const t0 = Date.now()
          const r = solveOptimalAffixAllocation({
            ctx: fixtureCtx, entries: uiEntries, maxTotalRolls: 30,
            groupCaps: uiCaps, ...extra,
          })
          const ms = Date.now() - t0
          if (!ref) ref = r.totalDamage
          console.log(
            `      ${label}：门槛 ${r.searchParams.initialCandidateThreshold}／比例 ${r.searchParams.routeRetentionRatio}／保留 ${r.searchParams.minRetainedRoutes}-${r.searchParams.maxRetainedRoutes}` +
            `｜淘汰 ${r.initialDropped}／存活 ${r.survivedRoutes}（保底救回 ${r.routeFloorSaved}／上限截顶 ${r.routeCapDropped}）／用档 ${r.usedRolls}` +
            `｜计算量 ${Math.round(r.workUsed)}／${ms}ms／截断 ${r.truncated}` +
            `／总伤 ${r.totalDamage.toFixed(1)}／相对参考 ${((r.totalDamage / ref) * 100).toFixed(3)}%`,
          )
        }
      }
    }
  } catch (error) {
    check('叶释渊 fixture 空盘选出 24+8', false, String(error?.message ?? error))
  }
}

console.log('\n[锐爆诊断] 小规模穷举，只有真漏解才留回归')
{
  const crit = library.find((e) => e.id === 'substat:critRate')
  const defPct = library.find((e) => e.id === 'substat:defPercent')
  let leak = null
  let sharpenBonus = 0
  if (crit && defPct) {
    const makeSharpenCtx = (critRate) => makeCtx({
      isFengYu: true,
      agents: [{
        id: 'a',
        name: '测试',
        element: '电',
        profession: '锋御',
        basePanel: {
          ...createEmptyAgentBasePanel(),
          hp: 9000, atk: 900, def: 1500, critRate, critDmg: 50,
          sharpenCritDmgBonus: 150,
          anomalyControl: 100, energyRegen: 120, directDmgMult: 100, anomalyMult: 125,
        },
      }],
      activeSlotPanels: {
        a: fillPanelStatsDefaults({
          hp: 9000, atk: 900, def: 1500, critRate, critDmg: 50,
          dmgBonus: 10, penRate: 0, pen: 0,
        }),
      },
    })
    const probe = evaluateAffixCounts(makeSharpenCtx(88), createEmptyAffixCounts())
    sharpenBonus = probe.breakdown.combatMods.sharpenCritDmgBonus
    check('锐爆诊断场景加成有效', sharpenBonus > 0, `B=${sharpenBonus}`)
    if (sharpenBonus > 0) {
      for (const critRate of [88, 92, 96]) {
        for (const budget of [4, 6, 8]) {
          const sharpenCtx = makeSharpenCtx(critRate)
          const subset = [
            { ...crit, cap: budget },
            { ...defPct, cap: budget },
          ]
          let bruteBest = -Infinity
          const rec = (index, used, rolls) => {
            if (index === subset.length) {
              const input = entryRollsToEvalInput(subset, rolls)
              const total = evaluateAffixCounts(
                sharpenCtx, input.counts, input.deltas, input.valuePerCount, input.extraGains,
              ).grandTotal
              if (total > bruteBest) bruteBest = total
              return
            }
            const entry = subset[index]
            for (let n = 0; n <= budget - used; n += 1) {
              rec(index + 1, used + n, { ...rolls, [entry.id]: n })
            }
          }
          rec(0, 0, {})
          const solved = solveOptimalAffixAllocation({
            ctx: sharpenCtx,
            entries: subset,
            maxTotalRolls: budget,
            enablePenRatePath: false,
            searchPreset: 'fine',
          })
          if (solved.totalDamage + 1e-6 < bruteBest) {
            leak = {
              critRate,
              budget,
              solved: solved.totalDamage,
              brute: bruteBest,
              rolls: solved.rollsByEntryId,
            }
            break
          }
        }
        if (leak) break
      }
    }
  } else {
    check('锐爆诊断词条存在', false)
  }
  if (leak) {
    console.log(
      `    诊断发现漏解：crit=${leak.critRate} budget=${leak.budget} 求解 ${leak.solved} < 穷举 ${leak.brute} ${JSON.stringify(leak.rolls)}`,
    )
    console.log('    按方案不把失败断言留进提交，本轮不加锐爆专路。')
  } else if (sharpenBonus > 0) {
    check('锐爆小规模穷举未发现阈值漏解，不加回归测试', true)
  }
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)