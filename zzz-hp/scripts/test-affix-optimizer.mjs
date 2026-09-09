/**
 * 最优词条分配求解器验证：
 * 1) 小规模场景与「全排列穷举」对比，求解器结果必须等于或接近穷举最优；
 * 2) 预算约束（总词条数 / atkPen / 主词条上限 / 互斥组）不得被突破；
 * 3) 分配结果真实可评估，且总伤与求解器报告一致。
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
  buildAllocationRows,
  resolveAffixOptimizerBudget,
} from '../src/utils/affixOptimizer.ts'
import {
  buildOptimalEvalContext,
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
  const full = solveOptimalAffixAllocation({ ctx, entries: library, maxTotalRolls: BUDGET })
  // 退化为单起点 + 仅 1-swap（用 maxStarts=1 近似，2-swap 无法单独关闭，
  // 故这里只对比起点数对结果的影响）
  const single = solveOptimalAffixAllocation({
    ctx, entries: library, maxTotalRolls: BUDGET, maxStarts: 1,
  })
  console.log(`    多起点 ${full.totalDamage}（${full.engineCalls} 次调用）`)
  console.log(`    单起点 ${single.totalDamage}（${single.engineCalls} 次调用）`)
  check('多起点结果不劣于单起点',
    full.totalDamage >= single.totalDamage - 1e-9,
    `${full.totalDamage} vs ${single.totalDamage}`)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
