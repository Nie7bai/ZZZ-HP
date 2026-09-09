/**
 * 缓存键缺陷回归：affixCountsCacheKey 必须覆盖 AffixCounts 全部字段。
 *
 * 背景：原实现漏了 defFlat / defPercent。锋御走防御副词条
 * （buildDirectAffixCounts 会写这两个字段），漏掉会让不同「局外大防御」
 * 档数命中同一条缓存，返回上一档的伤害。
 *
 * 运行：npx vite-node scripts/test-affix-cache-key.mjs
 */
import {
  createEmptyAffixCounts,
  createDefaultAffixDriveDiscMainStats,
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

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
