/**
 * 最优词条分配求解器验证：
 * 1) 小规模场景与「全排列穷举」对比，求解器结果必须等于或接近穷举最优；
 * 2) 预算约束（总词条数 / atkPen / 主词条上限 / 互斥组）不得被突破；
 * 3) 分配结果真实可评估，且总伤与求解器报告一致；
 * 4) 计算量预算与候选宽度（auto 推导 / manual 指定）；
 * 5) 同步与异步结果必须一致，异步可中止；
 * 6) 零收益条目出局、交叉项补测、无半成品。
 * 运行：npx vite-node scripts/test-affix-optimizer.mjs
 */
import {
  createEmptyAffixCounts,
  createDefaultAffixDriveDiscMainStats,
} from '../src/types/calculatorPanel.ts'
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import {
  createDefaultAffixLibrary,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
  setAffixLibraryEntryEnabled,
  createDefaultAffixLibraryState,
} from '../src/utils/affixLibrary.ts'
import {
  solveOptimalAffixAllocation,
  solveOptimalAffixAllocationAsync,
  buildAllocationRows,
  resolveAffixOptimizerBudget,
} from '../src/utils/affixOptimizer.ts'
import {
  buildOptimalEvalContext,
  clearAffixEvalCache,
  evaluateAffixCounts,
} from '../src/utils/optimalAffixAlloc.ts'

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
function makeHits(n) {
  const hits = []
  for (let i = 0; i < n; i += 1) {
    hits.push({
      id: `h${i}`,
      skill: {
        id: `s${i}`,
        name: `招式${i + 1}`,
        damageType: 'direct',
        element: '电',
        category: 'basic',
        subcategoryId: null,
        mult: 300 + i * 10,
      },
      ownerAgentId: 'a',
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

// ---------- 1. 小规模穷举对照 ----------
console.log('\n[1] 与全排列穷举对比（预算 6 档）')
{
  // 选 4 条代表性词条：攻击%（大词条）、固定攻击（小词条）、暴击率、爆伤
  const subset = library.filter((e) =>
    ['substat:atkPercent', 'substat:atkFlat', 'substat:critRate', 'substat:critDmg'].includes(e.id),
  )
  const BUDGET = 6
  const budget = resolveAffixOptimizerBudget(ctx, BUDGET)

  // 暴力穷举：所有满足预算的组合
  const bruteForce = () => {
    let bestTotal = -Infinity
    let bestRolls = null
    const rolls = {}
    const rec = (index, usedRolls) => {
      if (index === subset.length) {
        const counts = { ...createEmptyAffixCounts() }
        for (const e of subset) {
          const n = rolls[e.id] ?? 0
          if (n > 0) counts[e.affixKey] += n
        }
        const total = evaluateAffixCounts(ctx, counts).grandTotal
        if (total > bestTotal) {
          bestTotal = total
          bestRolls = { ...rolls }
        }
        return
      }
      const entry = subset[index]
      const cap = entry.cap > 0 ? entry.cap : BUDGET
      const rollCap = budget.rollCapOf(entry)
      const limit = Math.min(cap, Number.isFinite(rollCap) ? rollCap : cap, BUDGET)
      for (let n = 0; n <= limit; n += 1) {
        const nextRolls = usedRolls + n * entry.rollCost
        if (nextRolls > budget.maxTotalRolls) break
        rolls[entry.id] = n
        rec(index + 1, nextRolls)
      }
      rolls[entry.id] = 0
    }
    rec(0, 0)
    return { bestTotal, bestRolls }
  }

  const brute = bruteForce()
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

  let capOk = true
  for (const [id, rolls] of Object.entries(solved.rollsByEntryId)) {
    const entry = byId.get(id)
    if (!entry) continue
    const cap = budget.rollCapOf(entry)
    if (Number.isFinite(cap) && rolls > cap) {
      capOk = false
      console.log(`      超限：${entry.label} ${rolls} > ${cap}`)
    }
  }
  check('主词条档数上限未突破', capOk)
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
  const reEval = evaluateAffixCounts(ctx, solved.counts, solved.panelDeltas)
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
  console.log(`    引擎调用 ${solved.engineCalls} 次，截断=${solved.truncated}`)
}

// ---------- 4. 互斥组 ----------
console.log('\n[4] 互斥组')
{
  const grouped = library.map((e) =>
    e.id === 'substat:atkPercent' ? { ...e, group: 'main' } : e,
  ).map((e) =>
    e.id === 'substat:hpPercent' ? { ...e, group: 'main' } : e,
  )
  const solved = solveOptimalAffixAllocation({ ctx, entries: grouped, maxTotalRolls: 30 })
  const chosen = grouped.filter((e) => (solved.rollsByEntryId[e.id] ?? 0) > 0 && e.group === 'main')
  check('互斥组至多选 1 条', chosen.length <= 1,
    chosen.map((e) => `${e.label}×${solved.rollsByEntryId[e.id]}`).join(', ') || '未选')
}

// ---------- 5. 引擎调用上限 ----------
console.log('\n[5] 安全网')
{
  const solved = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: 46, maxEngineCalls: 50,
  })
  check('达到调用上限时标记 truncated', solved.truncated === true,
    `engineCalls=${solved.engineCalls}`)
  check('截断后仍返回合法结果',
    solved.totalDamage >= solved.baselineDamage - 1e-9 && solved.usedRolls >= 0)
}

// ---------- 6. 词条库状态 ----------
console.log('\n[6] 词条库解析')
{
  const state = createDefaultAffixLibraryState()
  // 默认参与 = 10 条副词条；14 条扩展（主词条/Buff 来源）默认不参与
  const active = resolveAffixLibrary(state)
  check('默认参与 10 条副词条', active.length === 10, String(active.length))
  const all = resolveAffixLibraryAll(state)
  check('全量 24 条（含默认关闭的扩展）', all.length === 24, String(all.length))
  check('扩展条目默认不参与',
    all.filter((e) => !e.enabledByDefault).length === 14,
    String(all.filter((e) => !e.enabledByDefault).length))
  const enabledOne = setAffixLibraryEntryEnabled(state, 'panel:dmgBonus', true)
  check('显式启用增伤后 11 条', resolveAffixLibrary(enabledOne).length === 11,
    String(resolveAffixLibrary(enabledOne).length))
  const disabledOne = setAffixLibraryEntryEnabled(state, 'substat:critRate', false)
  check('禁用暴击率后 9 条', resolveAffixLibrary(disabledOne).length === 9,
    String(resolveAffixLibrary(disabledOne).length))
}

// ---------- 7. 算法质量：多起点 + 2-swap 是否优于单起点 + 1-swap ----------
console.log('\n[7] 算法质量对比')
{
  const BUDGET = 30
  // 用小预算强制发生剪枝，多起点才会与单起点产生差别
  const full = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: BUDGET, maxStarts: 3, maxWorkUnits: 300,
  })
  const single = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: BUDGET, maxStarts: 1, maxWorkUnits: 300,
  })
  console.log(`    多起点 ${full.totalDamage}（${full.engineCalls} 次评估）`)
  console.log(`    单起点 ${single.totalDamage}（${single.engineCalls} 次评估）`)
  check('多起点结果不劣于单起点',
    full.totalDamage >= single.totalDamage - 1e-9,
    `${full.totalDamage} vs ${single.totalDamage}`)
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

// ---------- 9. 候选宽度：auto 按流程规模自适应，manual 由用户指定 ----------
console.log('\n[9] 候选宽度模式')
{
  const all = resolveAffixLibraryAll(createDefaultAffixLibraryState())
  const hits8 = makeCtx({ hits: makeHits(8) })
  const hits30 = makeCtx({ hits: makeHits(30) })
  clearAffixEvalCache()
  const autoCheap = solveOptimalAffixAllocation({
    ctx: hits8, entries: all, maxTotalRolls: 46,
  })
  clearAffixEvalCache()
  const autoExpensive = solveOptimalAffixAllocation({
    ctx: hits30, entries: all, maxTotalRolls: 46,
  })
  console.log(
    `    8 命中：最紧宽度 ${autoCheap.candidateWidth} / 最宽 ${autoCheap.candidateWidthMax}，` +
    `计算量 ${Math.round(autoCheap.workUsed)}`,
  )
  console.log(
    `    30 命中：最紧宽度 ${autoExpensive.candidateWidth} / 最宽 ${autoExpensive.candidateWidthMax}，` +
    `计算量 ${Math.round(autoExpensive.workUsed)}`,
  )
  check('auto 宽度不超过词条条数',
    autoCheap.candidateWidthMax <= all.length && autoExpensive.candidateWidthMax <= all.length,
    `${autoCheap.candidateWidthMax} / ${autoExpensive.candidateWidthMax} <= ${all.length}`)
  check('便宜流程的最紧宽度不小于昂贵流程（便宜的多搜）',
    autoCheap.candidateWidth >= autoExpensive.candidateWidth,
    `${autoCheap.candidateWidth} >= ${autoExpensive.candidateWidth}`)

  const manual = solveOptimalAffixAllocation({
    ctx: hits8, entries: library, maxTotalRolls: 46,
    candidateWidthMode: 'manual', manualCandidateWidth: 3,
  })
  check('manual 模式宽度等于用户指定值',
    manual.candidateWidth === 3 && manual.candidateWidthMax === 3,
    `${manual.candidateWidth} / ${manual.candidateWidthMax}`)
  check('manual 模式不设预算上限、不截断',
    manual.workBudget === null && manual.truncated === false,
    `workBudget=${manual.workBudget} truncated=${manual.truncated}`)
  const clamped = solveOptimalAffixAllocation({
    ctx: hits8, entries: library, maxTotalRolls: 46,
    candidateWidthMode: 'manual', manualCandidateWidth: 999,
  })
  check('manual 宽度被钳到词条条数',
    clamped.candidateWidth === library.length,
    `${clamped.candidateWidth} vs ${library.length}`)
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
    Math.abs(evaluateAffixCounts(ctx, solved.counts, solved.panelDeltas).grandTotal - solved.totalDamage) < 1e-6)
}

// ---------- 12. 交叉项：零收益条目后续变得有价值时能被补测 ----------
console.log('\n[12] 交叉项补测（暴击为 0 时爆伤增益为 0）')
{
  // 基础暴击率调到 0：此时爆伤单独加档不涨分（增益 = 暴击率 × 爆伤增量），
  // 属典型交叉项——只看基线的话爆伤会被判定「零收益」永久出局。
  // 档数给到 30：交叉点落在中间（穷举最优是混搭），才能证明补测真的生效。
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
  check('暴击为 0 时仍能把档数分给爆伤（补测生效）',
    critDmgRolls > 0, JSON.stringify(solved.rollsByEntryId))
  check('交叉项场景不劣于穷举最优',
    solved.totalDamage >= bruteTotal - 1e-6,
    `${solved.totalDamage} vs ${bruteTotal}`)
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
    Math.abs(evaluateAffixCounts(ctx, tiny.counts, tiny.panelDeltas).grandTotal - tiny.totalDamage) < 1e-6)
  check('结果不劣于基线', tiny.totalDamage >= tiny.baselineDamage - 1e-9)
}


console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
