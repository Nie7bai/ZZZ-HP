/**
 * 探针：环境 Buff（危局 / Boss 场地 / 防卫房间）变化后，词条评估是否更新。
 *
 * `buildOptimalEvalContext` 把 `environmentBuffs` 透传进 `panelContext`（会参与伤害），
 * 而 affixEvalCache 的键 = 「上下文签名 + 词条数」。若签名不含环境 Buff，
 * 同一 effect id、同一勾选状态下改了数值/效果，就会命中旧缓存 → 柱图/详情停在旧数字。
 *
 * 注意：环境 Buff **默认不勾选**（`buildDefaultBuffSelection` 对场地分组写 false），
 * 所以本探针显式给出 `buffSelection.enabledIds`，否则 buff 不参与结算、测不出任何差异。
 *
 * 用法：npx vite-node scripts/probe-env-buff-signature.mjs
 */
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import {
  createDefaultAffixDriveDiscMainStats,
  createEmptyAffixCounts,
} from '../src/types/calculatorPanel.ts'
import {
  buildOptimalEvalContext,
  evaluateAffixCounts,
  clearAffixEvalCache,
} from '../src/utils/optimalAffixAlloc.ts'

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 一条最小可用的环境 Buff：全队增伤，effect id 固定为 e1（模拟同一 Buff 的内容更新） */
function envBuff(dmgBonus) {
  return {
    kind: 'crisis',
    id: 'crisis-1',
    sourceKey: 'crisis-buff-crisis-1',
    name: '测试危局 Buff',
    effectBlocks: [
      {
        id: 'b1',
        name: '测试效果',
        effects: [
          {
            id: 'e1',
            scope: 'general',
            applyTarget: 'team',
            kind: 'fixed',
            stat: 'dmgBonus',
            value: dmgBonus,
            enabledDefault: true,
          },
        ],
      },
    ],
  }
}

import { effectInstanceId } from '../src/utils/buffEffect.ts'

const selection = {
  enabledIds: { [effectInstanceId('crisis-buff-crisis-1', 'b1', 'e1')]: true },
  stacksByEffectId: {},
  convertInputs: {},
  manualTouchedIds: {},
}

const agents = [
  {
    id: 'tester',
    name: '测试角色',
    element: '电',
    profession: '强攻',
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
]
const teamSlots = [
  {
    agentId: 'tester',
    rank: 0,
    wengineId: 'none',
    wengineRefine: 1,
    twoPieceDriveDiscId: 'none',
    fourPieceDriveDiscId: 'none',
  },
]

function makeCtx(environmentBuffs) {
  return buildOptimalEvalContext({
    isMb: false,
    isFengYu: false,
    teamSlots,
    agents,
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
    baseDamageSource: 'atk',
    skillContext: { element: '电', staggerPhase: 'stagger', damageKind: 'direct' },
    buffSelection: selection,
    environmentBuffs,
  })
}

const counts = { ...createEmptyAffixCounts(), atkPercent: 10 }

console.log('')
console.log('[同一 effect id、勾选不变，仅数值 30 → 60]')
const ctx30 = makeCtx([envBuff(30)])
const ctx60 = makeCtx([envBuff(60)])

clearAffixEvalCache()
const r30 = evaluateAffixCounts(ctx30, counts)
const r60 = evaluateAffixCounts(ctx60, counts)
const r30again = evaluateAffixCounts(ctx30, counts)

check('勾选后环境 Buff 确实参与结算（+30 应高于无 Buff）', r30.grandTotal > 0, `+30 → ${r30.grandTotal.toFixed(0)}`)
check(
  '数值变化必须让总伤变化（30 → 60）',
  r60.grandTotal > r30.grandTotal,
  `${r30.grandTotal.toFixed(0)} vs ${r60.grandTotal.toFixed(0)}`,
)
check(
  '切回 +30 必须回到原值（缓存不串）',
  r30again.grandTotal === r30.grandTotal,
  `${r30again.grandTotal.toFixed(0)} vs ${r30.grandTotal.toFixed(0)}`,
)

console.log('')
console.log('[对照：不勾选时环境 Buff 不参与结算]')
const ctxNoSel = buildOptimalEvalContext({
  isMb: false,
  isFengYu: false,
  teamSlots,
  agents,
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
  baseDamageSource: 'atk',
  skillContext: { element: '电', staggerPhase: 'stagger', damageKind: 'direct' },
  buffSelection: null,
  environmentBuffs: [envBuff(30)],
})
clearAffixEvalCache()
const rNoSel = evaluateAffixCounts(ctxNoSel, counts)
check('未勾选 → 与勾选结果不同', rNoSel.grandTotal !== r30.grandTotal, `${rNoSel.grandTotal.toFixed(0)} vs ${r30.grandTotal.toFixed(0)}`)

console.log('')
console.log(failed === 0 ? '结果：全部通过' : `结果：${failed} 项失败`)
process.exitCode = failed === 0 ? 0 : 1
