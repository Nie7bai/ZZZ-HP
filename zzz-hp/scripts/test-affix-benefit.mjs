/**
 * 词条收益分析（阶段 1）验证：
 * 1) 词条库条目 → 面板增量，与 AFFIX_VALUE_PER_COUNT 口径一致；
 * 2) 新收益表在「共同候选」上的每档增量，与现有 computeDiffAnalysis 同口径一致；
 * 3) 面板增量（panelField 类条目）确实改变伤害。
 * 运行：npx vite-node scripts/test-affix-benefit.mjs
 */
import {
  createEmptyAffixCounts,
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
} from '../src/types/calculatorPanel.ts'
import {
  createEmptyAgentBasePanel,
  createEmptyWengineAdvancedStats,
} from '../src/utils/calculatorUi.ts'
import { AFFIX_VALUE_PER_COUNT } from '../src/utils/affixPanelCalc.ts'
import {
  createDefaultAffixLibrary,
  createOptionalAffixLibraryEntries,
  entryRollsToAffixCounts,
  entryRollsToPanelDeltas,
  applyPanelDeltas,
  resolveAffixLibrary,
  setAffixLibraryEntryEnabled,
  createDefaultAffixLibraryState,
} from '../src/utils/affixLibrary.ts'
import { computeAffixBenefitTable } from '../src/utils/affixBenefitAnalysis.ts'
import {
  buildOptimalEvalContext,
  computeDiffAnalysis,
  evaluateAffixCounts,
} from '../src/utils/optimalAffixAlloc.ts'

let failed = 0
let passed = 0

function nearly(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps
}

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------- 1. 词条库 → 面板增量 ----------
console.log('\n[1] 词条库数值口径')
const library = createDefaultAffixLibrary()
check('默认词条库 10 条', library.length === 10, `实际 ${library.length}`)
for (const entry of library) {
  const expected = AFFIX_VALUE_PER_COUNT[entry.affixKey]
  check(
    `${entry.label} 每档 = AFFIX_VALUE_PER_COUNT`,
    entry.perRoll === expected,
    `${entry.perRoll} vs ${expected}`,
  )
}

const countsFromRolls = entryRollsToAffixCounts(library, {
  'substat:atkPercent': 3,
  'substat:critRate': 2,
})
check(
  '3 档攻击% + 2 档暴击 → 计数',
  countsFromRolls.atkPercent === 3 && countsFromRolls.critRate === 2,
  JSON.stringify(countsFromRolls),
)

const optional = createOptionalAffixLibraryEntries()
const deltaFromRolls = entryRollsToPanelDeltas(optional, { 'panel:dmgBonus': 1 })
check('1 档增伤 30 → 面板增量 30', deltaFromRolls.dmgBonus === 30, JSON.stringify(deltaFromRolls))
// ---------- 2. 与 computeDiffAnalysis 同口径对比 ----------
console.log('\n[2] 新收益表 vs 现有差异表（共同候选 +1 档）')
const agentBase = {
  ...createEmptyAgentBasePanel(),
  hp: 8000,
  atk: 900,
  def: 600,
  critRate: 5,
  critDmg: 50,
  dmgBonus: 0,
  anomalyControl: 100,
  energyRegen: 120,
  mastery: 0,
  directDmgMult: 100,
  anomalyMult: 0,
}
const wengineAdvanced = {
  ...createEmptyWengineAdvancedStats(),
  critRate: 24,
  critDmg: 48,
}
const driveDiscMainStats = createDefaultAffixDriveDiscMainStats()
const enemyInput = {
  level: 60,
  defense: 952.8,
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 1.5,
  specialMultiplier: 1,
}

const ctx = buildOptimalEvalContext({
  isMb: false,
  isFengYu: false,
  teamSlots: [
    { agentId: 'test-agent', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
  ],
  agents: [
    {
      id: 'test-agent',
      name: '测试角色',
      element: 'physical',
      profession: '强攻',
      basePanel: agentBase,
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
  enemyInput,
  baseDamageSource: 'atk',
  skillContext: { element: 'physical', staggerPhase: 'stagger', damageKind: 'direct' },
  // 无 hits：走面板口径，与 computeDiffAnalysis 的 evaluateAffixForDiffMetric 同路
  hits: undefined,
})

const baseCounts = { ...createEmptyAffixCounts(), atkPercent: 4, critRate: 3, critDmg: 5 }

const legacy = computeDiffAnalysis(ctx, baseCounts, 'direct', 'anomaly', null)
const legacyByLabel = new Map(legacy.addOne.map((row) => [row.label, row]))

const table = computeAffixBenefitTable({
  ctx,
  baseCounts,
  entries: library,
  rollsPerStep: 1,
})

check('收益表基线总伤 = 现有评估总伤',
  nearly(table.baselineDamage, evaluateAffixCounts(ctx, baseCounts).grandTotal),
  `${table.baselineDamage}`)

// 共同候选：现有差异表用「固定攻击力/局外大攻击/固定穿透/暴击率/暴击伤害/异常精通」
const sharedMap = [
  ['固定攻击力', '攻击力'],
  ['局外攻击力%', '局外大攻击'],
  ['固定穿透', '穿透值'],
  ['暴击率%', '暴击'],
  ['暴击伤害%', '爆伤'],
  ['异常精通', '精通'],
]
let compared = 0
for (const [newLabel, legacyLabel] of sharedMap) {
  const row = table.rows.find((item) => item.label === newLabel)
  const legacyRow = legacyByLabel.get(legacyLabel)
  if (!row || !legacyRow) {
    check(`${newLabel} ↔ ${legacyLabel} 可对比`, false, '任一侧缺失')
    continue
  }
  if (legacyRow.capped) {
    console.log(`  SKIP  ${newLabel} ↔ ${legacyLabel}：现有表标记为已达上限`)
    continue
  }
  compared += 1
  check(
    `${newLabel} ↔ ${legacyLabel} 伤害增量一致`,
    nearly(row.damageDelta, legacyRow.damageDelta, 1e-4),
    `new=${row.damageDelta.toFixed(4)} legacy=${legacyRow.damageDelta.toFixed(4)}`,
  )
}
check('至少对比到 4 个共同候选', compared >= 4, `实际 ${compared}`)

// ---------- 3. 权重列 ----------
console.log('\n[3] 相对权重')
const maxPercent = Math.max(...table.rows.map((r) => r.percentDelta))
const maxRow = table.rows.find((r) => nearly(r.percentDelta, maxPercent))
check('最高收益行权重 = 1', Boolean(maxRow) && nearly(maxRow.weight, 1, 1e-9),
  `weight=${maxRow?.weight}`)
check('权重按收益率降序排列',
  table.rows.every((row, i) => i === 0 || table.rows[i - 1].percentDelta >= row.percentDelta),
  table.rows.map((r) => r.percentDelta.toFixed(3)).join(', '))

// ---------- 4. panelField 条目确实改变伤害 ----------
console.log('\n[4] 自定义条目（panelField）')
const withDmgBonus = applyPanelDeltas(createDefaultExternalPanel(), { dmgBonus: 30 })
const baseEvalPanel = evaluateAffixCounts({ ...ctx, hits: undefined }, baseCounts)
const bumpedCtx = { ...ctx }
const bumpedEval = evaluateAffixCounts(
  bumpedCtx,
  baseCounts,
  { dmgBonus: 30 },
)
check('增伤 +30% 提升总伤',
  bumpedEval.grandTotal > baseEvalPanel.grandTotal,
  `${baseEvalPanel.grandTotal} → ${bumpedEval.grandTotal}`)
check('applyPanelDeltas 不修改原面板',
  createDefaultExternalPanel().dmgBonus === 10 && withDmgBonus.dmgBonus === 40,
  `dmgBonus=${withDmgBonus.dmgBonus}`)

// ---------- 5. 词条库启用状态 ----------
console.log('\n[5] 词条库启用/禁用')
const state = createDefaultAffixLibraryState()
const resolved = resolveAffixLibrary(state)
check('默认参与 10 条副词条', resolved.length === 10, `实际 ${resolved.length}`)
const disabled = setAffixLibraryEntryEnabled(state, 'substat:critRate', false)
check('禁用暴击率后条目数 = 9', resolveAffixLibrary(disabled).length === 9,
  `实际 ${resolveAffixLibrary(disabled).length}`)

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
