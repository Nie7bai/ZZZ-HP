/**
 * 回归：扫掠柱图的「上限规则」与「复用分支」必须一致。
 *
 * 缺陷（2026-09-11 发现）：`canReuseDirectSweepStructure` 原先只看结构
 * （局外大% + 爆伤 = 剩余档数），不看主词条上限（36 − 6×同类主属性数）。
 * 主属性变化收紧上限后再点「开始计算」，就会走复用分支、保留完整扫掠本会跳过的柱：
 * 实测 局外大防御上限 30 → 24 时，完整扫掠 25 根，复用保留 31 根（多出 25~30 档的非法柱）。
 *
 * 本测试同时锁住两条规则：
 *   [1] 完整扫掠产出的每一根柱都必须在上限内（与 X 轴规则一致）
 *   [2] 上限收紧后不得复用旧结构（复用即意味着柱图会出现超限柱）
 *
 * 运行：npx vite-node scripts/test-affix-sweep-caps.mjs
 */
import {
  createDefaultAffixDriveDiscMainStats,
} from '../src/types/calculatorPanel.ts'
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import {
  buildOptimalEvalContext,
  canReuseDirectSweepStructure,
  getAffixRollCaps,
  resolveAffixOutPercentCap,
  sweepDirectDamage,
  clearAffixEvalCache,
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

function makeCtx(driveDiscMainStats) {
  return buildOptimalEvalContext({
    isMb: false,
    isFengYu: true,
    teamSlots: [
      {
        agentId: 'fengyu',
        rank: 0,
        wengineId: 'none',
        wengineRefine: 1,
        twoPieceDriveDiscId: 'none',
        fourPieceDriveDiscId: 'none',
      },
    ],
    agents: [
      {
        id: 'fengyu',
        name: '锋御测试',
        element: '电',
        profession: '锋御',
        mindscapeBuffs: [],
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
    driveDiscMainStats,
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
}

const state = { flatStat: 0, hpFlat: 0, atkPercent: 0, pen: 0, mastery: 0, critRate: 0, totalRolls: 30 }

// 宽松：6 号位是局外大防御 → 上限 36 − 6 = 30
const looseStats = {
  ...createDefaultAffixDriveDiscMainStats(),
  slot4MainStat: 'critRate',
  slot5MainStat: 'penRate',
  slot6MainStat: 'externalDefPercent',
}
// 收紧：5、6 号位都是局外大防御 → 上限 36 − 12 = 24
const tightStats = {
  ...looseStats,
  slot5MainStat: 'externalDefPercent',
}

console.log('\n[1] 完整扫掠：每一根柱都必须在上限内')
const looseCtx = makeCtx(looseStats)
clearAffixEvalCache()
const loosePoints = sweepDirectDamage(looseCtx, state)
const looseCaps = getAffixRollCaps(looseStats)
const looseOutCap = resolveAffixOutPercentCap(looseCaps, false, true)
const looseViolations = loosePoints.filter(
  (p) => p.outPercent > looseOutCap || p.critDmg > looseCaps.critDmg,
)
check(
  '宽松上限（局外大防御 ≤ 30）下无超限柱',
  looseViolations.length === 0,
  `${loosePoints.length} 根，上限 ${looseOutCap}`,
)
check(
  '最右柱正好顶到上限',
  loosePoints.some((p) => p.outPercent === looseOutCap),
  `最大 outPercent = ${Math.max(...loosePoints.map((p) => p.outPercent))}`,
)

console.log('\n[2] 收紧上限后不得复用旧结构')
const tightCaps = getAffixRollCaps(tightStats)
const tightOutCap = resolveAffixOutPercentCap(tightCaps, false, true)
check(
  '上限确实被收紧（30 → 24）',
  looseOutCap === 30 && tightOutCap === 24,
  `${looseOutCap} → ${tightOutCap}`,
)
check(
  '复用判定必须为 false（否则柱图会留下超限柱）',
  canReuseDirectSweepStructure(loosePoints, state, false, true, tightStats) === false,
  `旧结构 ${loosePoints.length} 根`,
)
// 反证：旧判定只看结构，这一组数据在旧判定下必然放行 → 缺陷真实存在
check(
  '（反证）旧判定「仅看结构」会放行这 31 根',
  loosePoints.every((p) => p.outPercent + p.critDmg === 30),
  '结构一致但含 6 根超限柱',
)
check(
  '主属性未变时仍可复用（不能矫枉过正）',
  canReuseDirectSweepStructure(loosePoints, state, false, true, looseStats) === true,
  `${loosePoints.length} 根`,
)

console.log('\n[3] 完整扫掠（收紧后）仍然合法且更少')
const tightCtx = makeCtx(tightStats)
clearAffixEvalCache()
const tightPoints = sweepDirectDamage(tightCtx, state)
const tightViolations = tightPoints.filter(
  (p) => p.outPercent > tightOutCap || p.critDmg > tightCaps.critDmg,
)
check(
  '收紧后无超限柱',
  tightViolations.length === 0,
  `${tightPoints.length} 根，上限 ${tightOutCap}`,
)
check(
  '收紧后柱数少于复用旧结构的柱数（证明复用确实会多出非法柱）',
  tightPoints.length < loosePoints.length,
  `${tightPoints.length} < ${loosePoints.length}`,
)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
