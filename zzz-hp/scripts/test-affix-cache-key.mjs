/**
 * 缓存键缺陷回归：affixCountsCacheKey 必须覆盖 AffixCounts 全部字段。
 *
 * 背景：原实现漏了 defFlat / defPercent。锋御走防御副词条
 * （buildDirectAffixCounts 会写这两个字段），漏掉会让不同「局外大防御」
 * 档数命中同一条缓存，返回上一档的伤害。
 *
 * 运行：npx vite-node scripts/test-affix-cache-key.mjs
 */
import { readFileSync } from 'node:fs'

import {
  createEmptyAffixCounts,
  createDefaultAffixDriveDiscMainStats,
  fillPanelStatsDefaults,
} from '../src/types/calculatorPanel.ts'
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import { buildOptimalEvalContext, evaluateAffixCounts } from '../src/utils/optimalAffixAlloc.ts'

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

const ctx = buildOptimalEvalContext({
  isMb: false,
  // 锋御：直伤基础伤害取防御力，defFlat/defPercent 直接影响伤害
  isFengYu: true,
  teamSlots: [
    { agentId: 'fengyu', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
  ],
  agents: [
    {
      id: 'fengyu',
      name: '锋御测试',
      element: '电',
      profession: '锋御',
      basePanel: {
        ...createEmptyAgentBasePanel(),
        hp: 9000,
        atk: 800,
        def: 700,
        critRate: 5,
        critDmg: 50,
        anomalyControl: 100,
        energyRegen: 120,
        directDmgMult: 100,
      },
    },
  ],
  wengines: [],
  bangboo: {
    id: 'none',
    name: '未选择',
    avatar_image: null,
    effects: [],
    refinementEffects: [],
    fixedMods: {},
    refinementMods: [],
  },
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
  baseDamageSource: 'def',
  skillContext: { element: '电', staggerPhase: 'stagger', damageKind: 'direct' },
  hits: undefined,
})

console.log('\n[锋御防御副词条缓存键]')

// 同一上下文内连续评估不同防御档数：若缓存键漏字段，第二次会返回第一次的结果
const countsA = { ...createEmptyAffixCounts(), defPercent: 0 }
const countsB = { ...createEmptyAffixCounts(), defPercent: 10 }

const evalA = evaluateAffixCounts(ctx, countsA)
const evalB = evaluateAffixCounts(ctx, countsB)
const evalA2 = evaluateAffixCounts(ctx, countsA)

check('防御% 0 → 10 伤害应变化',
  evalB.grandTotal !== evalA.grandTotal,
  `${evalA.grandTotal} vs ${evalB.grandTotal}`)
check('回读防御% 0 应与首次一致（缓存不得串档）',
  evalA2.grandTotal === evalA.grandTotal,
  `${evalA2.grandTotal} vs ${evalA.grandTotal}`)
check('防御% 0 与 10 的面板防御力不同',
  evalA.finalPanel.def !== evalB.finalPanel.def,
  `${evalA.finalPanel.def} vs ${evalB.finalPanel.def}`)

// 固定防御同理
const countsC = { ...createEmptyAffixCounts(), defFlat: 6 }
const evalC = evaluateAffixCounts(ctx, countsC)
check('固定防御 0 → 6 伤害应变化',
  evalC.grandTotal !== evalA.grandTotal,
  `${evalA.grandTotal} vs ${evalC.grandTotal}`)

console.log('\n[同词条跨上下文不得串值：基准面板 / 按槽位推导]')

/**
 * 缺陷背景（2026-09-11，真实方案复现）：
 * 主属性组合试算用 `mainBaseExternalPanel: null` 评估（换主属性必须重新推导面板），
 * 而上下文签名原先不含基准面板 —— 两者签名一致就共用一条缓存，谁先算谁的值被另一边读走。
 * 表现：柱图总伤 74,222,437，详情总伤 56,758,629（读到了「无基准」那条）。
 */
const basePanel = fillPanelStatsDefaults({ hp: 12000, def: 2200, critRate: 60, critDmg: 120 })
const ctxWithBase = { ...ctx, mainBaseExternalPanel: basePanel }
const ctxDerived = { ...ctx, mainBaseExternalPanel: null }
const sharedCounts = { ...createEmptyAffixCounts(), defPercent: 9, critDmg: 21 }

const evalWithBase1 = evaluateAffixCounts(ctxWithBase, sharedCounts)
const evalDerived = evaluateAffixCounts(ctxDerived, sharedCounts)
const evalWithBase2 = evaluateAffixCounts(ctxWithBase, sharedCounts)

check('两种基准的伤害本就不同（基准面板确实生效）',
  evalWithBase1.grandTotal !== evalDerived.grandTotal,
  `有基准 ${evalWithBase1.grandTotal} vs 推导 ${evalDerived.grandTotal}`)
check('推导口径评估后，有基准再评估仍是自己的值（不得读走推导值）',
  evalWithBase2.grandTotal === evalWithBase1.grandTotal,
  `${evalWithBase2.grandTotal} vs ${evalWithBase1.grandTotal}`)
check('有基准再评估的面板也不得被推导面板顶掉',
  evalWithBase2.external.def === evalWithBase1.external.def,
  `${evalWithBase2.external.def} vs ${evalWithBase1.external.def}`)

/**
 * 评估缓存键**不得**把上下文签名原文（几 MB）拼进去。
 *
 * 缺陷与实测（2026-09-11，用户报「词条计算变慢」）：`affixEvalCacheKey` 曾直接拼
 * `affixEvalCacheCtxSig`，而签名含全量角色/音擎/驱动盘文档 —— 真实方案下键长
 * **4,217,995 字符**；一次 30 词条求解 241 次评估里，「拼键 + Map 查找 + Map 写入」
 * 花掉 13.2 s（真算仅 0.84 s），求解 888 ms → 14 s。
 *
 * 守卫分两层：静态（键函数不得引用签名变量）+ 实测（文档很大时每次评估也不得变慢）。
 */
console.log('\n[缓存键不得拼几个 MB 的上下文签名（2026-09-11 性能回归）]')

const source = readFileSync(new URL('../src/utils/optimalAffixAlloc.ts', import.meta.url), 'utf8')
const keyFnBody =
  source.match(/function affixEvalCacheKey\([\s\S]*?\n\}/)?.[0] ?? '(未找到 affixEvalCacheKey)'
check(
  '静态：affixEvalCacheKey 不引用签名原文（affixEvalCacheCtxSig）',
  !/affixEvalCacheCtxSig/.test(keyFnBody) && /affixEvalCacheCtxKey/.test(keyFnBody),
  keyFnBody.split('\n').slice(-1)[0].trim().slice(0, 80),
)

// 造一份「文档很大」的上下文：签名越长，越能暴露「每次评估都拼巨型键」的开销
const fillerAgents = Array.from({ length: 1500 }, (_, i) => ({
  id: `filler-${i}`,
  name: `填充角色 ${i}`,
  element: '电',
  profession: '强攻',
  basePanel: { ...createEmptyAgentBasePanel(), hp: 9000 + i, atk: 800 + i },
  extraPadding: 'x'.repeat(200),
}))
const fengyuDoc = {
  id: 'fengyu',
  name: '锋御测试',
  element: '电',
  profession: '锋御',
  basePanel: {
    ...createEmptyAgentBasePanel(),
    hp: 9000,
    atk: 800,
    def: 700,
    critRate: 5,
    critDmg: 50,
    anomalyControl: 100,
    energyRegen: 120,
    directDmgMult: 100,
  },
}
const noBangboo = {
  id: 'none',
  name: '未选择',
  avatar_image: null,
  effects: [],
  refinementEffects: [],
  fixedMods: {},
  refinementMods: [],
}
const enemyStub = {
  level: 60,
  defense: 952.8,
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 1.5,
  specialMultiplier: 1,
}
const ctxBig = buildOptimalEvalContext({
  isMb: false,
  isFengYu: true,
  teamSlots: [
    { agentId: 'fengyu', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
  ],
  agents: [fengyuDoc, ...fillerAgents],
  wengines: [],
  bangboo: noBangboo,
  bangbooRefine: 1,
  driveDiscs: [],
  mainSlotIndex: 0,
  driveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
  enemyInput: enemyStub,
  baseDamageSource: 'def',
  skillContext: { element: '电', staggerPhase: 'stagger', damageKind: 'direct' },
  hits: undefined,
})

/**
 * 判据用「大文档 / 小文档」的**相对**开销，而不是绝对毫秒：
 * 文档大 1500 倍时，若每次评估都要把签名拼进键，开销会跟着一起涨；
 * 换成短 id 后两边都是常数，比值接近 1。绝对阈值会随机器波动，比值不会。
 */
function perCallMsOf(ctxToMeasure) {
  const counts = { ...createEmptyAffixCounts(), defPercent: 7 }
  evaluateAffixCounts(ctxToMeasure, counts) // 预热：首次要算签名，不计入
  const calls = 300
  const t = performance.now()
  for (let i = 0; i < calls; i += 1) evaluateAffixCounts(ctxToMeasure, counts)
  return (performance.now() - t) / calls
}

const perCallSmall = perCallMsOf(ctx)
const perCallBig = perCallMsOf(ctxBig)
const ratio = perCallBig / Math.max(perCallSmall, 1e-6)

check(
  `实测：文档放大后每次评估开销不随之放大（小 ${perCallSmall.toFixed(3)}ms / 大 ${perCallBig.toFixed(3)}ms，比值 ${ratio.toFixed(2)}）`,
  ratio < 5,
  ratio >= 5 ? '疑似又把上下文签名（几 MB）拼进了缓存键' : '',
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
