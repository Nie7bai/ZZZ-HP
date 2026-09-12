/**
 * 最优词条分配求解器验证：
 * 1) 小规模场景与「全排列穷举」对比，求解器结果必须等于或接近穷举最优；
 * 2) 预算约束（总词条数 / 条目 cap / 互斥组）不得被突破；
 * 3) 分配结果真实可评估，且总伤与求解器报告一致；
 * 4) 计算量预算与候选宽度（auto 推导 / manual 指定）；
 * 5) 同步与异步结果必须一致，异步可中止；
 * 6) 零收益条目出局、交叉项补测、无半成品；
 * 7) 基础值取值与缓存失效（换音擎 / 换角色基础面板不得吃到旧值）。
 * 运行：npx vite-node scripts/test-affix-optimizer.mjs
 */
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
  coerceAffixLibraryState,
  createDefaultAffixLibrary,
  createDefaultAffixLibraryState,
  createOptionalAffixLibraryEntries,
  createPresetAffixLibraryEntries,
  entryRollsToEvalInput,
  removeAffixLibraryGroup,
  renameAffixLibraryGroup,
  resolveAffixLibrary,
  resolveAffixLibraryAll,
  setAffixLibraryEntryEnabled,
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
  optimalHitDependsOnMainAffixPanel,
} from '../src/utils/optimalAffixAlloc.ts'
import { statKeyOfTarget } from '../src/utils/affixLibrary.ts'
import {
  buildPanelSourceValuesBySlotMap,
  invalidateBuffCatalogCache,
} from '../src/utils/panelBuffCalc.ts'

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
          const key = statKeyOfTarget(e.target)
          if (n > 0 && key) counts[key] += n
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

  // 4.7 回归：用户实际配置（默认 10 副词条 + 增伤%/穿透率% 同组、上限各 1）。
  // 修复前实测四个预算档全部出现「两条同时上榜」。
  {
    const panelTwo = createOptionalAffixLibraryEntries()
      .filter((e) => ['panel:dmgBonus', 'panel:penRate'].includes(e.id))
      .map((e) => ({ ...e, enabledByDefault: true, group: '5号位', cap: 1 }))
    const entries = [...library, ...panelTwo]
    let ok = true
    let detail = ''
    for (const budget of [6, 10, 16, 24, 46]) {
      const solved = solveOptimalAffixAllocation({
        ctx, entries, maxTotalRolls: budget, groupCaps: { '5号位': 1 },
      })
      const dmg = solved.rollsByEntryId['panel:dmgBonus'] ?? 0
      const pen = solved.rollsByEntryId['panel:penRate'] ?? 0
      if (dmg + pen > 1) {
        ok = false
        detail = `预算 ${budget}：增伤%=${dmg}、穿透率%=${pen}`
      }
    }
    check('真实候选池：同组两条不同时上榜', ok, detail || '各预算档均至多一条')
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
    overrides: { 'panel:dmgBonus': { group: '老组' }, 'panel:penRate': { group: '老组' } },
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
      target: 'stat:atkPercent',
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
  const atkPercentPoints =
    (sixPlusOne.counts.atkPercent ?? 0) * sixPlusOne.valuePerCount.atkPercent
  check(
    '副词条 6 档×3% + 主属性 1 档×30% = 48 个百分点',
    Math.abs(atkPercentPoints - 48) < 1e-9,
    `实际 ${atkPercentPoints} 个百分点`,
  )

  const mainOnly = entryRollsToEvalInput(pair, { 'main:slot5:atkPercent': 1 })
  const mainOnlyPoints = (mainOnly.counts.atkPercent ?? 0) * mainOnly.valuePerCount.atkPercent
  check('只选主属性 1 档 = 30 个百分点', Math.abs(mainOnlyPoints - 30) < 1e-9,
    `实际 ${mainOnlyPoints}`)

  // 每档值与常量表一致的条目：折算前后行为不变（既有库不受影响）
  const plain = entryRollsToEvalInput([byId.get('substat:atkPercent')], {
    'substat:atkPercent': 6,
  })
  const plainPoints = (plain.counts.atkPercent ?? 0) * plain.valuePerCount.atkPercent
  check('每档=常量表的条目行为不变（6 档 × 3% = 18）', Math.abs(plainPoints - 18) < 1e-9,
    `实际 ${plainPoints}`)

  // 预设的 4/5/6 号位条目必须落在对应组、且各自是独立条目（同字段不合并）
  const preset = createPresetAffixLibraryEntries()
  const slotEntries = preset.filter((e) => /号位$/.test(e.group))
  const ids = new Set(slotEntries.map((e) => e.id))
  check('预设含 4/5/6 号位条目且 id 唯一', ids.size === slotEntries.length && slotEntries.length > 0,
    `${slotEntries.length} 条`)
  const slot5 = preset.filter((e) => e.group === '5号位')
  check('5 号位预设条目数 = 5（对应限定组合的选项表）', slot5.length === 5,
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
    '6 号位冲击力条目：18 点、落 panel:impact、归 6号位组、默认不启用',
    impactEntry?.perRoll === 18 &&
      impactEntry.target === 'panel:impact' &&
      impactEntry.group === '6号位' &&
      impactEntry.enabledByDefault === false,
    impactEntry ? `${impactEntry.label} perRoll=${impactEntry.perRoll} → ${impactEntry.target}` : '(缺)',
  )
  check('4/5/6 号位条目默认不启用（避免与已导入的面板重复计算）',
    slotEntries.every((e) => e.enabledByDefault === false))
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
  // 默认参与 = 10 条副词条；扩展（主词条/Buff 来源）+ 4/5/6 号位主属性默认不参与
  const active = resolveAffixLibrary(state)
  check('默认参与 10 条副词条', active.length === 10, String(active.length))
  const all = resolveAffixLibraryAll(state)
  // 数量从预设构造器派生：新增预设条目时这里不该再变成陈旧断言
  const presetTotal = createPresetAffixLibraryEntries().length
  const presetOff = createPresetAffixLibraryEntries().filter((e) => !e.enabledByDefault).length
  check(
    `全量 = 预设条目数（${presetTotal}，含默认关闭的扩展与 4/5/6 号位）`,
    all.length === presetTotal,
    String(all.length),
  )
  check('非副词条预设条目默认不参与',
    all.filter((e) => !e.enabledByDefault).length === presetOff,
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

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)