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
  activeAffixLibrarySet,
  activateAffixLibrarySet,
  affixValuePerCountFromEntries,
  coerceAffixLibraryState,
  coerceAffixLibraryStore,
  createAffixLibrarySet,
  createDefaultAffixLibrary,
  createDefaultAffixLibraryState,
  createDefaultAffixLibraryStore,
  createOptionalAffixLibraryEntries,
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
  const statKey = statKeyOfTarget(entry.target)
  const expected = statKey ? AFFIX_VALUE_PER_COUNT[statKey] : undefined
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
  '3 档攻击% + 2 档暴击 → 计数',
  evalInputFromRolls.counts.atkPercent === 3 && evalInputFromRolls.counts.critRate === 2,
  JSON.stringify(evalInputFromRolls.counts),
)
check(
  '默认条目下每档值表 = 常量表',
  Object.entries(evalInputFromRolls.valuePerCount).every(
    ([key, value]) => value === AFFIX_VALUE_PER_COUNT[key],
  ),
)

const optional = createOptionalAffixLibraryEntries()
const deltaFromRolls = entryRollsToEvalInput(optional, { 'panel:dmgBonus': 1 }).deltas
check('1 档增伤 30 → 面板增量 30', deltaFromRolls.dmgBonus === 30, JSON.stringify(deltaFromRolls))
check(
  'panel: 条目不影响每档值表',
  affixValuePerCountFromEntries(optional).critRate === AFFIX_VALUE_PER_COUNT.critRate,
)
check(
  'panelFieldOfTarget / statKeyOfTarget 命名空间解析正确',
  panelFieldOfTarget('panel:dmgBonus') === 'dmgBonus' && statKeyOfTarget('stat:critDmg') === 'critDmg',
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

// ---------- 6. 词条库整改验收（每档可覆盖 / 单位 / 类型合并 / 迁移 / 柱图不变） ----------
console.log('\n[6] 词条库整改验收')
{
  const { updateAffixLibraryEntry, isAffixLibraryEntryEnabled } = await import(
    '../src/utils/affixLibrary.ts'
  )
  const state0 = createDefaultAffixLibraryState()
  const critEntry = resolveAffixLibrary(state0).find((e) => e.id === 'substat:critRate')
  check('默认暴击率条目每档 = 2.4', critEntry?.perRoll === 2.4, `实际 ${critEntry?.perRoll}`)

  const countsWithCrit = { ...createEmptyAffixCounts(), critRate: 10 }

  // —— 验收 1：把「每档」从 2.4 改成 4.8，伤害必须真的变 ——
  const state48 = updateAffixLibraryEntry(state0, 'substat:critRate', { perRoll: 4.8 })
  const entries48 = resolveAffixLibrary(state48)
  const vpc48 = affixValuePerCountFromEntries(entries48)
  check('改每档后每档值表 = 4.8', vpc48.critRate === 4.8, `实际 ${vpc48.critRate}`)

  const dmg24 = evaluateAffixCounts(ctx, countsWithCrit, undefined, affixValuePerCountFromEntries(resolveAffixLibrary(state0))).grandTotal
  const dmg48 = evaluateAffixCounts(ctx, countsWithCrit, undefined, vpc48).grandTotal
  check('每档 2.4 → 4.8 伤害真的变（这正是原缺陷）', dmg48 > dmg24,
    `${dmg24} → ${dmg48}`)

  // —— 验收 2：改回 2.4，结果回到原值（缓存不串味） ——
  const dmgBack = evaluateAffixCounts(ctx, countsWithCrit, undefined, affixValuePerCountFromEntries(resolveAffixLibrary(state0))).grandTotal
  check('改回 2.4 后回到原值（缓存键含每档值，不串味）', nearly(dmgBack, dmg24),
    `${dmg24} vs ${dmgBack}`)

  // —— 验收 3：等价条目对拍成为恒等（stat:mastery vs panel:mastery，每档都是 9） ——
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
  check('stat:mastery(9) 与 panel:mastery(9) 结果恒等', nearly(statMasteryEval, panelMasteryEval),
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
  check('旧 affixKey 条目 → stat: 目标',
    migrated.customEntries[0]?.target === 'stat:atkPercent',
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

console.log(`\n结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
