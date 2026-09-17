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
import { AFFIX_VALUE_PER_COUNT, computeExternalPanelFromTeamSlot } from '../src/utils/affixPanelCalc.ts'
import {
  activeAffixLibrarySet,
  activateAffixLibrarySet,
  affixValuePerCountFromEntries,
  coerceAffixLibraryState,
  coerceAffixLibraryStore,
  createAffixLibrarySet,
  createDefaultAffixLibrary,
  createDefaultAffixLibraryState,
  createDefaultAffixLibraryStore,
  createDriveDiscMainStatAffixEntries,
  createOptionalAffixLibraryEntries,
  createPresetAffixLibraryEntries,
  deleteAffixLibrarySet,
  entryRollsToEvalInput,
  applyPanelDeltas,
  exportAffixLibrarySet,
  importAffixLibrarySet,
  panelFieldOfTarget,
  renameAffixLibrarySet,
  resolveAffixLibraryAll,
  resolveAffixLibrary,
  setAffixLibraryEntryEnabled,
  statKeyOfTarget,
} from '../src/utils/affixLibrary.ts'
import { affixRelativeWeights, computeAffixBenefitSeriesForTable, computeAffixBenefitTable } from '../src/utils/affixBenefitAnalysis.ts'
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
  const field = String(entry.target).slice('panel:'.length)
  const expected = AFFIX_VALUE_PER_COUNT[field]
  check(
    `${entry.label} 每档 = AFFIX_VALUE_PER_COUNT`,
    entry.perRoll === expected,
    `${entry.perRoll} vs ${expected}`,
  )
}

const evalInputFromRolls = entryRollsToEvalInput(library, {
  'substat:atkPercent': 3,
  'substat:critRate': 2,
})
check(
  '3 档攻击% + 2 档暴击 → 局外增量',
  evalInputFromRolls.deltas.atkPercent === 9 && evalInputFromRolls.deltas.critRate === 4.8,
  JSON.stringify(evalInputFromRolls.deltas),
)
check('分析侧不再写入十格计数桶', Object.keys(evalInputFromRolls.counts).length === 0)
check(
  '默认条目下每档值表 = 常量表',
  Object.entries(evalInputFromRolls.valuePerCount).every(
    ([key, value]) => value === AFFIX_VALUE_PER_COUNT[key],
  ),
)

const optional = createOptionalAffixLibraryEntries()
const deltaFromRolls = entryRollsToEvalInput(
  createDriveDiscMainStatAffixEntries(),
  { 'main:slot5:dmgBonus': 1 },
).deltas
check('1 档增伤 30 → 面板增量 30', deltaFromRolls.dmgBonus === 30, JSON.stringify(deltaFromRolls))
check(
  'panel: 条目不影响每档值表',
  affixValuePerCountFromEntries(optional).critRate === AFFIX_VALUE_PER_COUNT.critRate,
)
check(
  'panelFieldOfTarget / statKeyOfTarget 命名空间解析正确',
  panelFieldOfTarget('panel:reduceDefense') === 'reduceDefense' &&
    panelFieldOfTarget('panel:mastery') === 'mastery' &&
    statKeyOfTarget('panel:critDmg') === 'critDmg',
)
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

// 显示层口径：分母换成「当前显示的行」（步骤 38，收益表筛选后用）
const subset = table.rows.slice(2, 6)
const subsetWeights = affixRelativeWeights(subset)
const subsetMax = Math.max(...subset.map((r) => r.percentDelta))
check('按子集归一：子集里最高的那条 = 1（哪怕它不是全表最高）',
  nearly(subsetWeights[0], 1, 1e-9) && subsetMax < maxPercent,
  `子集最高 ${subsetMax.toFixed(4)} vs 全表最高 ${maxPercent.toFixed(4)}`)
check('按子集归一：其余按子集最大收益率折算',
  subset.every((row, i) => nearly(subsetWeights[i], row.percentDelta / subsetMax, 1e-9)),
  subsetWeights.map((w) => w.toFixed(4)).join(', '))
check('全为负 / 全为 0 → 权重一律 0（不出现越负越满格）',
  affixRelativeWeights([{ percentDelta: -3 }, { percentDelta: -1 }]).every((w) => w === 0) &&
    affixRelativeWeights([{ percentDelta: 0 }, { percentDelta: 0 }]).every((w) => w === 0))
check('空行集不报错', affixRelativeWeights([]).length === 0)

// ---------- 4. panelField 条目确实改变伤害 ----------
console.log('\n[4] 自定义条目（panelField）')
/** 条目贡献的折算基础（异常掌控 94 / 能量恢复 120，取自角色快照） */
const DELTA_BASES = { anomalyControl: 94, energyRegen: 120 }
const withDmgBonus = applyPanelDeltas(createDefaultExternalPanel(), { dmgBonus: 30 }, DELTA_BASES)
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

// ---------- 4.1 折算口径由字段决定（不由条目决定） ----------
console.log('\n[4.1] 条目贡献的折算口径')
{
  // 平铺字段：直接加面板值
  const flat = applyPanelDeltas(createDefaultExternalPanel(), { dmgBonus: 30, penRate: 24, impact: 18 }, DELTA_BASES)
  check('平铺字段直接加：增伤 +30 / 穿透率 +24 / 冲击力 +18',
    flat.dmgBonus === 40 && flat.penRate === 24 && flat.impact === 18,
    `增伤=${flat.dmgBonus} 穿透率=${flat.penRate} 冲击力=${flat.impact}`)

  // 按基础值乘算的字段：与主属性同一套口径（面板取角色基础值，模拟真实角色）
  const panelAtBase = { ...createDefaultExternalPanel(), anomalyControl: 94, energyRegen: 120 }
  const percent = applyPanelDeltas(panelAtBase, { anomalyControl: 30, energyRegen: 60 }, DELTA_BASES)
  check('异常掌控 30% 落到 基础×1.3（94 → 122.2，与主属性同口径）',
    nearly(percent.anomalyControl, 122.2, 1e-9),
    `实际 ${percent.anomalyControl}`)
  check('能量恢复 60% 落在 基础×1.6（120 → 192，与主属性同口径）',
    nearly(percent.energyRegen, 192, 1e-9),
    `实际 ${percent.energyRegen}`)

  // 与主属性那条路的结果必须一致（这正是「不许开捷径」的验收）
  const viaMainStat = computeExternalPanelFromTeamSlot({
    slot: { agentId: 'qingyi', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    agents: [{ id: 'qingyi', basePanel: { ...createEmptyAgentBasePanel(), anomalyControl: 94, energyRegen: 120 } }],
    wengines: [],
    driveDiscs: [],
    overrideAffix: {
      affixCounts: createEmptyAffixCounts(),
      affixDriveDiscMainStats: { slot4MainStat: '', slot5MainStat: '', slot6MainStat: 'anomalyControl' },
    },
  })
  const viaEntry = applyPanelDeltas(
    applyPanelDeltas(
      computeExternalPanelFromTeamSlot({
        slot: { agentId: 'qingyi', wengineId: 'none', twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
        agents: [{ id: 'qingyi', basePanel: { ...createEmptyAgentBasePanel(), anomalyControl: 94, energyRegen: 120 } }],
        wengines: [],
        driveDiscs: [],
        overrideAffix: { affixCounts: createEmptyAffixCounts(), affixDriveDiscMainStats: createDefaultAffixDriveDiscMainStats() },
      }),
      {},
      DELTA_BASES,
    ),
    { anomalyControl: 30 },
    DELTA_BASES,
  )
  check('从主属性选「异常掌控 30%」= 从词条库选（两条路同一个数）',
    nearly(viaMainStat.anomalyControl, viaEntry.anomalyControl, 1e-9),
    `主属性 ${viaMainStat.anomalyControl} vs 词条 ${viaEntry.anomalyControl}`)
}

// ---------- 5. 词条库启用状态 ----------
console.log('\n[5] 词条库启用/禁用')
const state = createDefaultAffixLibraryState()
const resolved = resolveAffixLibrary(state)
const presetEnabled = createPresetAffixLibraryEntries().filter((e) => e.enabledByDefault)
check(
  `默认参与 = 预设里默认启用的条数（${presetEnabled.length}）`,
  resolved.length === presetEnabled.length,
  `实际 ${resolved.length}`,
)
const disabled = setAffixLibraryEntryEnabled(state, 'substat:critRate', false)
check('禁用暴击率后少 1 条', resolveAffixLibrary(disabled).length === resolved.length - 1,
  `实际 ${resolveAffixLibrary(disabled).length}`)

// ---------- 6. 词条库整改验收（每档可覆盖 / 单位 / 类型合并 / 迁移 / 柱图不变） ----------
console.log('\n[6] 词条库整改验收')
{
  const { updateAffixLibraryEntry, isAffixLibraryEntryEnabled } = await import(
    '../src/utils/affixLibrary.ts'
  )
  const state0 = createDefaultAffixLibraryState()
  const critEntry = resolveAffixLibrary(state0).find((e) => e.id === 'substat:critRate')
  check('默认暴击率条目每档 = 2.4', critEntry?.perRoll === 2.4, `实际 ${critEntry?.perRoll}`)

  // —— 验收 1：把「每档」从 2.4 改成 4.8，伤害必须真的变 ——
  const state48 = updateAffixLibraryEntry(state0, 'substat:critRate', { perRoll: 4.8 })
  const entries48 = resolveAffixLibrary(state48)
  const eval24 = entryRollsToEvalInput(resolveAffixLibrary(state0), { 'substat:critRate': 10 })
  const eval48 = entryRollsToEvalInput(entries48, { 'substat:critRate': 10 })
  check(
    '改每档 2.4 → 4.8 后增量 24 → 48',
    nearly(eval24.deltas.critRate ?? 0, 24) && nearly(eval48.deltas.critRate ?? 0, 48),
    `${eval24.deltas.critRate} → ${eval48.deltas.critRate}`,
  )
  check(
    '每档值表保持常量表（同字段多条不再互相顶掉）',
    affixValuePerCountFromEntries(entries48).critRate === AFFIX_VALUE_PER_COUNT.critRate,
    `实际 ${affixValuePerCountFromEntries(entries48).critRate}`,
  )

  const dmg24 = evaluateAffixCounts(
    ctx,
    createEmptyAffixCounts(),
    eval24.deltas,
    eval24.valuePerCount,
  ).grandTotal
  const dmg48 = evaluateAffixCounts(
    ctx,
    createEmptyAffixCounts(),
    eval48.deltas,
    eval48.valuePerCount,
  ).grandTotal
  check('每档 2.4 → 4.8 伤害真的变（这正是原缺陷）', dmg48 > dmg24,
    `${dmg24} → ${dmg48}`)

  // —— 验收 2：改回 2.4，结果回到原值（缓存不串味） ——
  const dmgBack = evaluateAffixCounts(
    ctx,
    createEmptyAffixCounts(),
    eval24.deltas,
    eval24.valuePerCount,
  ).grandTotal
  check('改回 2.4 后回到原值（缓存不串味）', nearly(dmgBack, dmg24),
    `${dmg24} vs ${dmgBack}`)

  // —— 验收 3：导入十格 1 档精通 vs 局外增量 9 恒等（每档都是 9） ——
  const statMasteryEval = evaluateAffixCounts(
    ctx,
    { ...createEmptyAffixCounts(), mastery: 1 },
    undefined,
    affixValuePerCountFromEntries(createDefaultAffixLibrary()),
  ).grandTotal
  const panelMasteryEval = evaluateAffixCounts(
    ctx,
    createEmptyAffixCounts(),
    { mastery: 9 },
  ).grandTotal
  check('十格 1 档精通 与 局外增量 9 结果恒等', nearly(statMasteryEval, panelMasteryEval),
    `${statMasteryEval} vs ${panelMasteryEval}`)

  // —— 验收 4：旧 localStorage 迁移（kind/affixKey → target，不丢条目、数值不变） ——
  const legacyState = {
    customEntries: [
      {
        id: 'custom:1',
        label: '旧版副词条',
        kind: 'substat',
        affixKey: 'atkPercent',
        perRoll: 4,
        cap: 0,
        group: '',
        rollCost: 1,
        enabledByDefault: true,
        builtin: false,
      },
      {
        id: 'custom:2',
        label: '旧版面板字段',
        kind: 'panelField',
        panelField: 'dmgBonus',
        perRoll: 25,
        cap: 1,
        group: 'mainStat',
        rollCost: 1,
        enabledByDefault: true,
        builtin: false,
      },
    ],
    enabledOverride: { 'custom:1': false },
    overrides: { 'substat:critRate': { perRoll: 5 } },
  }
  const originalLocalStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem: () => JSON.stringify(legacyState),
    setItem: () => {},
    removeItem: () => {},
  }
  const { loadAffixLibraryState } = await import('../src/utils/affixLibrary.ts')
  const migrated = loadAffixLibraryState()
  globalThis.localStorage = originalLocalStorage

  check('迁移后条目数不变', migrated.customEntries.length === 2,
    `实际 ${migrated.customEntries.length}`)
  check('旧 affixKey 条目 → panel: 目标',
    migrated.customEntries[0]?.target === 'panel:atkPercent',
    `实际 ${migrated.customEntries[0]?.target}`)
  check('旧 panelField 条目 → panel: 目标',
    migrated.customEntries[1]?.target === 'panel:dmgBonus',
    `实际 ${migrated.customEntries[1]?.target}`)
  check('迁移不改数值（每档原样保留）',
    migrated.customEntries[0]?.perRoll === 4 && migrated.customEntries[1]?.perRoll === 25,
    `${migrated.customEntries[0]?.perRoll} / ${migrated.customEntries[1]?.perRoll}`)
  check('启用状态按 id 保留（id 未改）', migrated.enabledOverride['custom:1'] === false)
  check('默认条目的覆盖值按 id 保留',
    migrated.overrides['substat:critRate']?.perRoll === 5,
    JSON.stringify(migrated.overrides))

  // —— 验收 5：柱图路径行为不变（applyAffixCountsToFixedParts 默认参数） ——
  const { applyAffixCountsToFixedParts, buildAffixExternalFixedParts } = await import(
    '../src/utils/affixPanelCalc.ts'
  )
  const fixedParts = buildAffixExternalFixedParts({
    agentBase,
    wengineBaseAtk: 594,
    wengineAdvanced,
    affixCounts: createEmptyAffixCounts(),
    driveDiscSelection: { twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    driveDiscMainStats,
    driveDiscs: [],
  })
  const crit6 = { ...createEmptyAffixCounts(), critRate: 6 }
  const defaultCall = applyAffixCountsToFixedParts(fixedParts, crit6)
  const explicitDefault = applyAffixCountsToFixedParts(fixedParts, crit6, AFFIX_VALUE_PER_COUNT)
  check('不传每档值表 = 传默认表（柱图等既有调用点零影响）',
    defaultCall.critRate === explicitDefault.critRate,
    `${defaultCall.critRate} vs ${explicitDefault.critRate}`)
  check('默认表下 6 档暴击 = 基础(5+音擎24) + 6 × 2.4 = 43.4',
    nearly(defaultCall.critRate, 29 + 6 * 2.4, 1e-9),
    `实际 ${defaultCall.critRate}`)
  const customTable = { ...AFFIX_VALUE_PER_COUNT, critRate: 4.8 }
  const customCall = applyAffixCountsToFixedParts(fixedParts, crit6, customTable)
  check('传自定义表时按 4.8 算（基础 29 + 6 × 4.8 = 57.8）',
    nearly(customCall.critRate, 29 + 6 * 4.8, 1e-9),
    `实际 ${customCall.critRate}`)
}

// ---------- 6. 多套词条库（存档结构、切换、增删改） ----------
console.log('\n[6] 多套词条库')
{
  const s0 = createDefaultAffixLibraryStore()
  check('首次创建给一套库', s0.sets.length === 1, `实际 ${s0.sets.length}`)
  check('名字是「默认」', s0.sets[0].name === '默认', s0.sets[0].name)
  check('激活指向它', s0.activeId === s0.sets[0].id)
  check('激活取回一致', activeAffixLibrarySet(s0).id === s0.activeId)

  // 旧存档（顶层直接就是一套库的内容）要能读成「默认」这套
  const legacyState = {
    customEntries: [],
    enabledOverride: { 'substat:critRate': false },
    overrides: { 'substat:critRate': { perRoll: 5 } },
    removedEntryIds: ['panel:dmgBonus'],
  }
  const migrated = coerceAffixLibraryStore(legacyState)
  check('旧存档包成一套', migrated?.sets.length === 1, `实际 ${migrated?.sets.length}`)
  check('旧存档名字补「默认」', migrated?.sets[0].name === '默认', migrated?.sets[0].name)
  check('旧存档 enabledOverride 保住',
    JSON.stringify(migrated?.sets[0].state.enabledOverride) === JSON.stringify({ 'substat:critRate': false }),
    JSON.stringify(migrated?.sets[0].state.enabledOverride))
  check('旧存档 overrides 保住',
    migrated?.sets[0].state.overrides['substat:critRate']?.perRoll === 5,
    JSON.stringify(migrated?.sets[0].state.overrides))
  check('旧存档 removedEntryIds 保住',
    migrated?.sets[0].state.removedEntryIds[0] === 'panel:dmgBonus',
    JSON.stringify(migrated?.sets[0].state.removedEntryIds))

  let s = createDefaultAffixLibraryStore()
  const firstId = s.sets[0].id
  s = createAffixLibrarySet(s, '配装A')
  check('新建后两套', s.sets.length === 2, `实际 ${s.sets.length}`)
  check('新建后自动切过去', activeAffixLibrarySet(s).name === '配装A', activeAffixLibrarySet(s).name)
  s = activateAffixLibrarySet(s, firstId)
  check('能切回默认', activeAffixLibrarySet(s).name === '默认', activeAffixLibrarySet(s).name)
  s = renameAffixLibrarySet(s, firstId, '我的默认')
  check('重命名生效', s.sets[0].name === '我的默认', s.sets[0].name)
  const secondId = s.sets[1].id
  s = deleteAffixLibrarySet(s, secondId)
  check('删除后剩一套', s.sets.length === 1, `实际 ${s.sets.length}`)
  check('不允许删掉最后一套', deleteAffixLibrarySet(s, firstId).sets.length === 1)
}

// ---------- 7. 导出 / 导入 ----------
console.log('\n[7] 词条库导出 / 导入')
{
  let store = createDefaultAffixLibraryStore()
  store = createAffixLibrarySet(store, '导出源', {
    ...createDefaultAffixLibraryState(),
    enabledOverride: { 'substat:critRate': true },
  })
  const json = exportAffixLibrarySet(store)
  const parsed = JSON.parse(json)
  check('导出带类型标记', parsed.type === 'zzz-hp-affix-library', parsed.type)
  check('导出带库名', parsed.name === '导出源', parsed.name)
  check('导出带内容', parsed.state.enabledOverride['substat:critRate'] === true)

  const base = createDefaultAffixLibraryStore()
  const asNew = importAffixLibrarySet(base, json, 'new')
  check('导入为新库：无错误', asNew.error === null, String(asNew.error))
  check('导入为新库：变成两套', asNew.store.sets.length === 2, `实际 ${asNew.store.sets.length}`)
  check('导入为新库：切过去', activeAffixLibrarySet(asNew.store).name === '导出源')

  const asReplace = importAffixLibrarySet(base, json, 'replace')
  check('覆盖当前：无错误', asReplace.error === null, String(asReplace.error))
  check('覆盖当前：仍一套', asReplace.store.sets.length === 1, `实际 ${asReplace.store.sets.length}`)
  check('覆盖当前：名字跟文件', asReplace.store.sets[0].name === '导出源', asReplace.store.sets[0].name)
  check('覆盖当前：内容进来', asReplace.store.sets[0].state.enabledOverride['substat:critRate'] === true)

  check('坏 JSON 报错', importAffixLibrarySet(base, '{', 'new').error === 'JSON 解析失败，请检查文件格式',
    String(importAffixLibrarySet(base, '{', 'new').error))
  check('数组报错', importAffixLibrarySet(base, '[]', 'new').error === '文件内容不是词条库对象',
    String(importAffixLibrarySet(base, '[]', 'new').error))
  check('空对象报错', importAffixLibrarySet(base, '{}', 'new').error === '文件里没有词条库内容',
    String(importAffixLibrarySet(base, '{}', 'new').error))
  check('导入失败时存档原样', importAffixLibrarySet(base, '{}', 'new').store.sets.length === 1)

  const bare = { customEntries: [], enabledOverride: { 'substat:critRate': false } }
  check('裸状态（无外层包装）也认', importAffixLibrarySet(base, JSON.stringify(bare), 'new').error === null,
    String(importAffixLibrarySet(base, JSON.stringify(bare), 'new').error))
  check('裸状态内容能解析出条目',
    resolveAffixLibraryAll(coerceAffixLibraryState(bare)).length > 0)
}

// ---------- 收益表筛选状态的持久化（步骤 40） ----------
console.log('\n[?] 收益表筛选状态')
{
  const {
    AFFIX_BENEFIT_FILTERS_STORAGE_KEY,
    coerceAffixBenefitFilters,
    createDefaultAffixBenefitFilters,
    loadAffixBenefitFilters,
    saveAffixBenefitFilters,
  } = await import('../src/utils/affixBenefitFilters.ts')

  const defaults = createDefaultAffixBenefitFilters()
  check('默认：隐藏无收益 开', defaults.hideNoBenefit === true)
  check('默认：不关闭任何分组', defaults.hiddenGroups.length === 0)
  check('存档里没有「同名折叠」字段（它是常开显示规则，不是偏好）',
    !('collapseDuplicates' in defaults), Object.keys(defaults).join(', '))

  check('坏档（字符串 / 数组 / null）一律回落默认',
    JSON.stringify(coerceAffixBenefitFilters('x')) === JSON.stringify(defaults) &&
      JSON.stringify(coerceAffixBenefitFilters([])) === JSON.stringify(defaults) &&
      JSON.stringify(coerceAffixBenefitFilters(null)) === JSON.stringify(defaults),
    JSON.stringify(coerceAffixBenefitFilters('x')))

  check('字段类型不对只回落那一个字段',
    coerceAffixBenefitFilters({ hideNoBenefit: 'yes' }).hideNoBenefit === true)
  check('老存档里的 collapseDuplicates 被忽略，其余字段照常生效',
    (() => {
      const legacy = coerceAffixBenefitFilters({
        hideNoBenefit: false,
        collapseDuplicates: false,
        hiddenGroups: ['4号位'],
      })
      return (
        !('collapseDuplicates' in legacy) &&
        legacy.hideNoBenefit === false &&
        JSON.stringify(legacy.hiddenGroups) === JSON.stringify(['4号位'])
      )
    })(),
    JSON.stringify(coerceAffixBenefitFilters({ hideNoBenefit: false, collapseDuplicates: false })))
  check('hiddenGroups 过滤掉非字符串项',
    JSON.stringify(coerceAffixBenefitFilters({ hiddenGroups: ['4号位', 42, null] }).hiddenGroups) ===
      JSON.stringify(['4号位']))

  // localStorage 桩：读 / 写 / 坏 JSON 三条路都走一遍
  const originalLocalStorage = globalThis.localStorage
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
  }

  check('没有存档 → 默认', loadAffixBenefitFilters().hideNoBenefit === true)

  saveAffixBenefitFilters({ hideNoBenefit: false, hiddenGroups: ['4号位'] })
  const readBack = loadAffixBenefitFilters()
  check('写进去能读回来',
    readBack.hideNoBenefit === false &&
      JSON.stringify(readBack.hiddenGroups) === JSON.stringify(['4号位']),
    JSON.stringify(readBack))
  check('落盘的 JSON 只含两个字段（不留废弃字段）',
    store.get(AFFIX_BENEFIT_FILTERS_STORAGE_KEY) ===
      JSON.stringify({ hideNoBenefit: false, hiddenGroups: ['4号位'] }),
    store.get(AFFIX_BENEFIT_FILTERS_STORAGE_KEY))
  check('键名稳定（改键名会让所有人回默认）',
    store.has(AFFIX_BENEFIT_FILTERS_STORAGE_KEY))

  store.set(AFFIX_BENEFIT_FILTERS_STORAGE_KEY, '{ 坏 JSON')
  check('坏 JSON → 默认，不抛错', loadAffixBenefitFilters().hideNoBenefit === true)

  globalThis.localStorage = originalLocalStorage

  // —— 残名剪枝（步骤 41）——
  const { collectAffixBenefitKnownGroups, pruneAffixBenefitFilters } = await import(
    '../src/utils/affixBenefitFilters.ts'
  )

  const filters = { hideNoBenefit: false, hiddenGroups: ['4号位', '已改名的组'] }
  const pruned = pruneAffixBenefitFilters(filters, ['4号位', '5号位'])
  check('残名被剪掉，现存分组保留',
    JSON.stringify(pruned.hiddenGroups) === JSON.stringify(['4号位']),
    JSON.stringify(pruned.hiddenGroups))
  check('剪枝不改原对象', JSON.stringify(filters.hiddenGroups) === JSON.stringify(['4号位', '已改名的组']))
  check('没有可剪时返回同一个对象（调用方据此免写盘）',
    pruneAffixBenefitFilters(filters, ['4号位', '已改名的组']) === filters)
  check('全都不存在 → 剪成空数组', pruneAffixBenefitFilters(filters, []).hiddenGroups.length === 0)

  // 现存分组名：整份存档所有库的并集（跨库共用筛选，只看当前库会误删）
  const libraryStore = {
    version: 2,
    activeId: 'set:1',
    sets: [
      {
        id: 'set:1',
        name: 'A',
        createdAt: 0,
        updatedAt: 0,
        state: { ...createDefaultAffixLibraryState(), groups: [{ name: '4号位', cap: 1 }] },
      },
      {
        id: 'set:2',
        name: 'B',
        createdAt: 0,
        updatedAt: 0,
        state: {
          ...createDefaultAffixLibraryState(),
          groups: [{ name: '幽灵组', cap: 1 }],
          customEntries: [
            { id: 'custom:1', label: '未分组条目', target: 'panel:critRate', perRoll: 5, cap: 0, group: '', rollCost: 1, enabledByDefault: true },
          ],
        },
      },
    ],
  }
  const known = collectAffixBenefitKnownGroups(libraryStore)
  check('并集含另一套库独有的分组（切库不会误删）', known.has('幽灵组'), [...known].join(', '))
  check('并集含未分组的空串（条目未分组时保留该筛选）', known.has(''), JSON.stringify([...known]))
  check('并集不含哪都没有的名字', !known.has('已改名的组'))
  check('用并集剪枝：另一套库独有的名字活下来',
    JSON.stringify(pruneAffixBenefitFilters({ hideNoBenefit: true, hiddenGroups: ['幽灵组', '已改名的组'] }, known).hiddenGroups) ===
      JSON.stringify(['幽灵组']))
}

// ---------- 8. 收益曲线只做组内对比 ----------
console.log('\n[8] 收益曲线：组内对比（2026-09-17 用户口径）')
{
  // 跨组词条库：副词条（默认 10 条）+ 4/5/6 号位主属性候选 —— 与官方预设库的分组一致
  const mixedLibrary = [...createDefaultAffixLibrary(), ...createDriveDiscMainStatAffixEntries()]
  const mixedTable = computeAffixBenefitTable({
    ctx,
    baseCounts,
    entries: mixedLibrary,
    rollsPerStep: 1,
    includeSeries: false,
  })
  const groupOfEntryId = new Map(mixedLibrary.map((entry) => [entry.id, entry.group]))
  const groupsInTable = [...new Set(mixedTable.rows.map((row) => groupOfEntryId.get(row.entryId)))]
  check('跨组库：收益表里出现多个分组', groupsInTable.length >= 2, groupsInTable.join(' / '))

  // 只把某一组的行交给曲线补算 —— 页面上的「可选组」就是这么做的
  const pickedGroup = groupsInTable[0]
  const rowsOfGroup = mixedTable.rows.filter((row) => groupOfEntryId.get(row.entryId) === pickedGroup)
  const outsideIds = new Set(
    mixedTable.rows
      .filter((row) => groupOfEntryId.get(row.entryId) !== pickedGroup)
      .map((row) => row.entryId),
  )
  const groupSeries = computeAffixBenefitSeriesForTable(
    { ctx, baseCounts, entries: mixedLibrary, rollsPerStep: 1, maxCurveRolls: 2, maxCurveSeries: 3 },
    { baselineDamage: mixedTable.baselineDamage, rows: rowsOfGroup },
  )
  check(
    `曲线只含所选组（${pickedGroup}）的条目`,
    groupSeries.length > 0 && groupSeries.every((series) => !outsideIds.has(series.entryId)),
    `线数 ${groupSeries.length}：${groupSeries.map((s) => s.entryId).join(', ')}`,
  )
  check('曲线最多画本组前 N 条', groupSeries.length <= 3, `实际 ${groupSeries.length}`)
  check(
    '每条曲线 = 0 档基线 + N 档（长度对得上）',
    groupSeries.every((series) => series.cumulativePercent.length === 3 && series.marginalPercent.length === 3),
    `实际 ${groupSeries[0]?.cumulativePercent.length}`,
  )
  check(
    '第 0 档一律是基线 0%',
    groupSeries.every((series) => series.cumulativePercent[0] === 0 && series.marginalPercent[0] === 0),
  )

  // 只画正收益条目（2026-09-17 第二轮口径）：把整张表的行（含 0 / 负收益）都交进去，画出来的必须一条都不含
  const nonPositiveIds = new Set(
    mixedTable.rows.filter((row) => row.percentDelta <= 0).map((row) => row.entryId),
  )
  const positiveRows = mixedTable.rows.filter((row) => row.percentDelta > 0)
  check('这套库里确实有 0 / 负收益条目（否则下面两条测不到东西）', nonPositiveIds.size > 0, `共 ${nonPositiveIds.size} 条`)
  const allRowsSeries = computeAffixBenefitSeriesForTable(
    { ctx, baseCounts, entries: mixedLibrary, rollsPerStep: 1, maxCurveRolls: 2, maxCurveSeries: 40 },
    { baselineDamage: mixedTable.baselineDamage, rows: mixedTable.rows },
  )
  check(
    '0 收益与负收益条目一条都不进曲线',
    allRowsSeries.every((series) => !nonPositiveIds.has(series.entryId)),
    `线数 ${allRowsSeries.length}：${allRowsSeries.map((s) => s.entryId).join(', ')}`,
  )
  check(
    '曲线条数 = 正收益条数（上限内不再被 0 / 负收益占名额）',
    allRowsSeries.length === Math.min(40, positiveRows.length),
    `实际 ${allRowsSeries.length}，正收益 ${positiveRows.length}`,
  )
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
