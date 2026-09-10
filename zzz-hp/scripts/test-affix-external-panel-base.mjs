/**
 * 「面板单一来源」契约测试：外部角色配置面板作为词条评估的基准。
 *
 * 用户口径（2026-09-10）：
 *  - 面板只有一份来源：「角色配置」（导入录入写入的 anomalySlotPanels）；
 *  - 词条分配 = 在这份面板上**叠加 N 条**；不反推、不扣减面板里已有的词条；
 *  - 取不到外部面板时回退到按槽位配置推导（改造前的行为，逐位等价）。
 *
 * 运行：npx vite-node scripts/test-affix-external-panel-base.mjs
 */
import {
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
  createEmptyAffixCounts,
  fillPanelStatsDefaults,
} from '../src/types/calculatorPanel.ts'
import {
  createEmptyAgentBasePanel,
  createEmptyWengineAdvancedStats,
} from '../src/utils/calculatorUi.ts'
import { AFFIX_VALUE_PER_COUNT, computeExternalPanelFromTeamSlot } from '../src/utils/affixPanelCalc.ts'
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

const AGENT_BASE = {
  ...createEmptyAgentBasePanel(),
  hp: 9000,
  atk: 900,
  def: 700,
  critRate: 5,
  critDmg: 50,
  anomalyControl: 100,
  energyRegen: 120,
  directDmgMult: 100,
  anomalyMult: 125,
}

function makeCtx(overrides = {}) {
  return buildOptimalEvalContext({
    isMb: false,
    isFengYu: false,
    teamSlots: [
      { agentId: 'a', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    ],
    agents: [{ id: 'a', name: '测试', element: '电', profession: '强攻', basePanel: AGENT_BASE }],
    wengines: [],
    bangboo: {
      id: 'none',
      name: 'x',
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
    ...overrides,
  })
}

const counts0 = createEmptyAffixCounts()
const countsAtk10 = { ...createEmptyAffixCounts(), atkPercent: 10 }
const countsCrit10 = { ...createEmptyAffixCounts(), critRate: 10 }

/** 外部面板（角色配置）：一份「已经录好的局外面板」，含它自己的副词条 */
function makeExternalPanel(overrides = {}) {
  return fillPanelStatsDefaults({
    ...createDefaultExternalPanel(),
    hp: 12000,
    atk: 3000,
    def: 800,
    critRate: 60,
    critDmg: 120,
    ...overrides,
  })
}

console.log('\n[1] 无外部面板：回退到推导路径（与改造前逐位等价）')
{
  const ctxNoPanel = makeCtx()
  clearAffixEvalCache()
  const evalNoPanel = evaluateAffixCounts(ctxNoPanel, countsAtk10)

  // 显式传一个「占位面板」也应被当成没有面板（导入未录入时的占位值）
  const ctxPlaceholder = makeCtx({
    anomalySlotPanels: {
      a: fillPanelStatsDefaults({ ...createDefaultExternalPanel() }),
    },
  })
  clearAffixEvalCache()
  const evalPlaceholder = evaluateAffixCounts(ctxPlaceholder, countsAtk10)

  check(
    '占位面板不当作基准，结果与无面板一致',
    evalPlaceholder.grandTotal === evalNoPanel.grandTotal,
    `${evalPlaceholder.grandTotal} vs ${evalNoPanel.grandTotal}`,
  )
  // 回退路径必须等于「按槽位配置推导」——即改造前的唯一路径
  const derived = computeExternalPanelFromTeamSlot({
    slot: {
      agentId: 'a',
      wengineId: 'none',
      twoPieceDriveDiscId: 'none',
      fourPieceDriveDiscId: 'none',
    },
    agents: [{ id: 'a', basePanel: AGENT_BASE }],
    wengines: [],
    driveDiscs: [],
    overrideAffix: {
      affixCounts: countsAtk10,
      affixDriveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
    },
  })
  check(
    '回退路径 = 按槽位配置推导（改造前行为）',
    JSON.stringify(evalNoPanel.external) === JSON.stringify(derived),
    `atk=${evalNoPanel.external.atk} vs 推导 ${derived.atk}`,
  )
}

console.log('\n[2] 有外部面板：面板以「角色配置」为准')
{
  const panel = makeExternalPanel()
  const ctxWithPanel = makeCtx({ anomalySlotPanels: { a: panel } })
  clearAffixEvalCache()
  const evalWithPanel = evaluateAffixCounts(ctxWithPanel, counts0)

  const ctxNoPanel = makeCtx()
  clearAffixEvalCache()
  const evalNoPanel = evaluateAffixCounts(ctxNoPanel, counts0)

  check(
    '外部面板进来后伤害随之变化（面板真的被采用了）',
    evalWithPanel.grandTotal !== evalNoPanel.grandTotal,
    `${evalWithPanel.grandTotal} vs ${evalNoPanel.grandTotal}`,
  )
  check(
    '零词条时局外面板 = 外部面板原值',
    evalWithPanel.external.atk === panel.atk &&
      evalWithPanel.external.critRate === panel.critRate &&
      evalWithPanel.external.critDmg === panel.critDmg,
    `atk=${evalWithPanel.external.atk} critRate=${evalWithPanel.external.critRate} critDmg=${evalWithPanel.external.critDmg}`,
  )
}

console.log('\n[3] 词条在面板上叠加（不反推、不扣减）')
{
  const panel = makeExternalPanel({ critRate: 60, atk: 3000 })
  const ctx = makeCtx({ anomalySlotPanels: { a: panel } })
  clearAffixEvalCache()
  const base = evaluateAffixCounts(ctx, counts0)

  clearAffixEvalCache()
  const crit10 = evaluateAffixCounts(ctx, countsCrit10)
  const expectedCrit = 60 + 10 * AFFIX_VALUE_PER_COUNT.critRate
  check(
    '暴击词条直接叠加在面板暴击上（面板 60% + 10 条 ×2.4 = 84%）',
    Math.abs(crit10.external.critRate - expectedCrit) < 1e-6,
    `${crit10.external.critRate} vs ${expectedCrit}`,
  )
  check(
    '面板里已有的暴击不被扣减',
    crit10.external.critRate > panel.critRate,
    `${crit10.external.critRate} > ${panel.critRate}`,
  )
  check('加词条后伤害上升', crit10.grandTotal > base.grandTotal, `${crit10.grandTotal} > ${base.grandTotal}`)

  clearAffixEvalCache()
  const atk10 = evaluateAffixCounts(ctx, countsAtk10)
  const expectedAtk = 3000 + (AGENT_BASE.atk * AFFIX_VALUE_PER_COUNT.atkPercent) / 100 * 10
  check(
    '百分比词条按基础值折算（面板攻击 + 角色基础攻 900 × 3% × 10）',
    Math.abs(atk10.external.atk - expectedAtk) < 1e-6,
    `${atk10.external.atk} vs ${expectedAtk}`,
  )
  check('加攻击词条后伤害上升', atk10.grandTotal > base.grandTotal, `${atk10.grandTotal} > ${base.grandTotal}`)
}

console.log('\n[4] 面板变化必须让缓存失效（不得停在旧值）')
{
  const ctxA = makeCtx({ anomalySlotPanels: { a: makeExternalPanel({ critDmg: 100 }) } })
  clearAffixEvalCache()
  const evalA = evaluateAffixCounts(ctxA, counts0)

  const ctxB = makeCtx({ anomalySlotPanels: { a: makeExternalPanel({ critDmg: 200 }) } })
  const evalB = evaluateAffixCounts(ctxB, counts0)

  check(
    '换一份外部面板（爆伤 100→200）结果必须变',
    evalB.grandTotal > evalA.grandTotal,
    `${evalA.grandTotal} → ${evalB.grandTotal}`,
  )
}

console.log('\n[5] 词条增量函数自身的边界')
{
  const panel = makeExternalPanel()
  const ctx = makeCtx({ anomalySlotPanels: { a: panel } })
  clearAffixEvalCache()
  const many = evaluateAffixCounts(ctx, {
    ...createEmptyAffixCounts(),
    atkPercent: 10,
    critRate: 10,
    critDmg: 10,
    mastery: 10,
    pen: 10,
  })
  check(
    '多类词条同时叠加，互不覆盖',
    many.external.atk > panel.atk &&
      many.external.critRate > panel.critRate &&
      many.external.critDmg > panel.critDmg &&
      many.external.mastery > panel.mastery &&
      many.external.pen > panel.pen,
    `atk=${many.external.atk} cr=${many.external.critRate} cd=${many.external.critDmg} m=${many.external.mastery} pen=${many.external.pen}`,
  )
  check(
    '未涉及的面板字段原样保留',
    many.external.hp === panel.hp && many.external.def === panel.def,
    `hp=${many.external.hp} def=${many.external.def}`,
  )
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
