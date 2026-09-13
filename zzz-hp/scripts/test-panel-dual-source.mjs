/**
 * 双面板来源（面板导入 / 词条导入）契约测试。
 *
 * 依据 `PANEL-DUAL-SOURCE.md`：每个角色存两份平级面板，同一时间只有一份激活；
 * 下游只读激活那份、不问来历；老结构按 `panelCalcMode` 归位；反推逻辑已删除。
 *
 * 运行：npx vite-node scripts/test-panel-dual-source.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  createDefaultAffixDriveDiscMainStats,
  createDefaultExternalPanel,
  createEmptyAffixCounts,
  createEmptyAffixDriveDiscMainStats,
  fillPanelStatsDefaults,
} from '../src/types/calculatorPanel.ts'
import { collectAffixDriveDiscMainStatContribution } from '../src/utils/affixDriveDiscConfig.ts'
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import {
  createAgentPanelSources,
  hasPanelSource,
  migrateLegacyPanelIntoSource,
  migrateLegacyPanelsToSources,
  panelOfSource,
  panelSourceKindsWithData,
  resolveActivePanel,
  resolveActivePanelSourceKind,
  schemeActivePanels,
  schemeAffixInputs,
  setActivePanelSource,
  writeAffixInputsIntoSource,
  writePanelSource,
} from '../src/utils/agentPanelSources.ts'
import {
  buildOptimalEvalContext,
  clearAffixEvalCache,
  evaluateAffixCounts,
  evaluateAffixCountsForSweep,
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

/** 「面板导入」那份：游戏里看到的数（带小数） */
const panelFromGame = fillPanelStatsDefaults({
  ...createDefaultExternalPanel(),
  hp: 12345.67,
  atk: 2967.41,
  def: 600.5,
  critRate: 63.2,
  critDmg: 118.4,
})
/** 「词条导入」那份：按条数算出来的数，与上面刻意不同（允许天差地别） */
const panelFromAffix = fillPanelStatsDefaults({
  ...createDefaultExternalPanel(),
  hp: 11111.11,
  atk: 2500.25,
  def: 812.75,
  critRate: 30,
  critDmg: 50,
})

const countsAtk10 = { ...createEmptyAffixCounts(), atkPercent: 10 }

function grandTotalWith(slotPanels, counts = countsAtk10) {
  clearAffixEvalCache()
  const ctx = makeCtx({ activeSlotPanels: schemeActivePanels({ slotPanels }) })
  return evaluateAffixCounts(ctx, counts).grandTotal
}

console.log('\n[1] 两份面板平级：各自独立、互不覆盖（§4.1）')
{
  let sources = createAgentPanelSources()
  check('新记录默认激活动「面板导入」', sources.active === 'imported')
  check('新记录两份都没有数据', panelSourceKindsWithData(sources).length === 0)

  sources = writePanelSource(sources, 'imported', panelFromGame, { importedAt: 1000 })
  sources = writePanelSource(sources, 'affixDerived', panelFromAffix, { importedAt: 2000 })
  check(
    '写「词条导入」不动「面板导入」',
    panelOfSource(sources, 'imported').atk === panelFromGame.atk,
    `${panelOfSource(sources, 'imported').atk} vs ${panelFromGame.atk}`,
  )
  check(
    '导入后激活的是刚写的那份',
    sources.active === 'affixDerived' && resolveActivePanel(sources).atk === panelFromAffix.atk,
  )
  check('两份都有数据', panelSourceKindsWithData(sources).length === 2)

  // 反向再写一次：affix 那份也不该被动
  const again = writePanelSource(sources, 'imported', panelFromGame, { importedAt: 3000 })
  check(
    '再写「面板导入」不动「词条导入」',
    panelOfSource(again, 'affixDerived').atk === panelFromAffix.atk,
  )
  check(
    '导入时间各自独立记录',
    again.provenance.importedAt === 3000 && again.provenance.affixDerivedAt === 2000,
    `${again.provenance.importedAt} / ${again.provenance.affixDerivedAt}`,
  )
}

console.log('\n[2] 手动切换激活：只改 active，两份数值都不动（§4.3）')
{
  let sources = writePanelSource(undefined, 'imported', panelFromGame, { importedAt: 1 })
  sources = writePanelSource(sources, 'affixDerived', panelFromAffix, { importedAt: 2 })
  const switched = setActivePanelSource(sources, 'imported')
  check('切回「面板导入」后读到的就是它', resolveActivePanel(switched).atk === panelFromGame.atk)
  check(
    '切换不改两份面板本身',
    JSON.stringify(switched.importedPanel) === JSON.stringify(sources.importedPanel) &&
      JSON.stringify(switched.affixDerivedPanel) === JSON.stringify(sources.affixDerivedPanel),
  )

  // 切到没有数据的那份：active 保留用户选择，但取值回落到有数据的那份
  const onlyImported = writePanelSource(undefined, 'imported', panelFromGame)
  const switchedToEmpty = setActivePanelSource(onlyImported, 'affixDerived')
  check(
    '切到没数据的那份时取值回落，不返回空面板',
    resolveActivePanel(switchedToEmpty).atk === panelFromGame.atk,
  )
  check('回落时 hasPanelSource 仍如实反映（该份确实没数据）', !hasPanelSource(switchedToEmpty, 'affixDerived'))
}

console.log('\n[2.1] 「当前生效来源」标注：必须跟实际取值一致（§4.2 槽位卡片胶囊）')
{
  let sources = writePanelSource(undefined, 'imported', panelFromGame, { importedAt: 1 })
  sources = writePanelSource(sources, 'affixDerived', panelFromAffix, { importedAt: 2 })

  check(
    '用户选哪份就标哪份（两份都有数据时）',
    resolveActivePanelSourceKind(sources) === 'affixDerived' &&
      resolveActivePanelSourceKind(setActivePanelSource(sources, 'imported')) === 'imported',
  )

  // 选中那份没数据 → 标「实际回落」的那份，不能照用户的选择标
  const onlyImported = writePanelSource(undefined, 'imported', panelFromGame)
  const switchedToEmpty = setActivePanelSource(onlyImported, 'affixDerived')
  check(
    '选中那份没数据时标出真正生效的那份',
    resolveActivePanelSourceKind(switchedToEmpty) === 'imported',
  )
  check(
    '标注口径与 resolveActivePanel 的回落方向一致',
    resolveActivePanel(switchedToEmpty).atk === panelFromGame.atk,
  )
  check('两份都没数据时不标来源（返回空）', resolveActivePanelSourceKind(createAgentPanelSources()) === undefined)
  check('没有来源记录时返回空', resolveActivePanelSourceKind(undefined) === undefined)
}

console.log('\n[3] 验收 1：面板导入后，计算读到的就是填进去那份（含小数）')
{
  const sources = writePanelSource(undefined, 'imported', panelFromGame, { importedAt: 1 })
  const resolved = schemeActivePanels({ slotPanels: { a: sources } }).a
  check('解析出的面板与填入值逐位一致', resolved.atk === panelFromGame.atk && resolved.hp === panelFromGame.hp)

  // 同时存在「按条数现推」的结果，两者必须不同：读到的不能是现推的那个数
  const derived = grandTotalWith({ a: { ...sources, active: 'imported' } })
  const placeholderSources = createAgentPanelSources()
  const noPanel = grandTotalWith({ a: placeholderSources })
  check(
    '有面板时结果 ≠ 无面板（未出现「按条数现推」口径）',
    derived !== noPanel,
    `${derived} vs ${noPanel}`,
  )
}

console.log('\n[4] 验收 4：切换激活后，详情与扫掠柱图同一次重算内一致')
{
  let sources = writePanelSource(undefined, 'imported', panelFromGame, { importedAt: 1 })
  sources = writePanelSource(sources, 'affixDerived', panelFromAffix, { importedAt: 2 })

  const readBoth = (active) => {
    const slotPanels = { a: setActivePanelSource(sources, active) }
    clearAffixEvalCache()
    const ctx = makeCtx({ activeSlotPanels: schemeActivePanels({ slotPanels }) })
    const detail = evaluateAffixCounts(ctx, countsAtk10).grandTotal
    const sweep = evaluateAffixCountsForSweep(ctx, countsAtk10).grandTotal
    return { detail, sweep }
  }
  const asImported = readBoth('imported')
  const asAffix = readBoth('affixDerived')
  check('详情与扫掠在「面板导入」下一致', asImported.detail === asImported.sweep, `${asImported.detail} / ${asImported.sweep}`)
  check('详情与扫掠在「词条导入」下一致', asAffix.detail === asAffix.sweep, `${asAffix.detail} / ${asAffix.sweep}`)
  check(
    '切换来源确实换了数字（不是两份都被忽略）',
    asImported.detail !== asAffix.detail,
    `${asImported.detail} vs ${asAffix.detail}`,
  )
}

console.log('\n[5] 验收 6：老方案迁移逐位一致（§6）')
{
  const legacyPanel = fillPanelStatsDefaults({ ...createDefaultExternalPanel(), atk: 2915.56, critDmg: 98 })
  const legacyCounts = { ...createEmptyAffixCounts(), atkPercent: 8, critRate: 4 }
  const legacyMains = { ...createDefaultAffixDriveDiscMainStats(), slot5MainStat: 'atkPercent' }

  // panelCalcMode = affix → 归到「词条导入」
  const asAffix = migrateLegacyPanelsToSources({
    legacyPanels: { a: legacyPanel },
    panelCalcMode: 'affix',
    teamSlots: [{ agentId: 'a', affixCounts: legacyCounts, affixDriveDiscMainStats: legacyMains }],
  })
  check('affix 模式归位到「词条导入」且激活它', asAffix.a.active === 'affixDerived')
  check('另一份保持空', !hasPanelSource(asAffix.a, 'imported'))
  check('词条数随来源记录一起迁移', asAffix.a.affixCounts.atkPercent === 8 && asAffix.a.affixCounts.critRate === 4)
  check('4/5/6 主属性随来源记录一起迁移', asAffix.a.affixDriveDiscMainStats.slot5MainStat === 'atkPercent')

  // panelCalcMode = panel → 归到「面板导入」
  const asPanel = migrateLegacyPanelsToSources({
    legacyPanels: { a: legacyPanel },
    panelCalcMode: 'panel',
    teamSlots: [],
  })
  check('panel 模式归位到「面板导入」且激活它', asPanel.a.active === 'imported')

  // 数值逐位一致：老结构（一份面板）与迁移后（取激活那份）算出来必须相等
  clearAffixEvalCache()
  const legacyTotal = evaluateAffixCounts(
    makeCtx({ activeSlotPanels: { a: legacyPanel } }),
    countsAtk10,
  ).grandTotal
  const migratedTotal = grandTotalWith(asAffix)
  check(
    '迁移前后总伤逐位一致',
    legacyTotal === migratedTotal,
    `${legacyTotal} vs ${migratedTotal}`,
  )

  // 单面板归位（供持久化层逐条调用）
  const one = migrateLegacyPanelIntoSource(undefined, legacyPanel, 'affix', {
    affixCounts: legacyCounts,
  })
  check('单面板归位函数与整表版一致', one.active === 'affixDerived' && one.affixCounts.atkPercent === 8)

  // 老方案字段读取兼容（脚本路径）
  const inputs = schemeAffixInputs(
    { activeSlotPanels: { a: legacyPanel }, panelCalcMode: 'affix', teamSlots: [{ agentId: 'a', affixCounts: legacyCounts }] },
    'a',
  )
  check('schemeAffixInputs 对老结构也能取到词条数', inputs.affixCounts?.atkPercent === 8)
}

console.log('\n[6] 词条数 / 主属性只服务「词条导入」这一路（§5 侧面约束）')
{
  let sources = writePanelSource(undefined, 'imported', panelFromGame, { importedAt: 1 })
  sources = writeAffixInputsIntoSource(sources, {
    affixCounts: { ...createEmptyAffixCounts(), mastery: 6 },
    affixDriveDiscMainStats: createDefaultAffixDriveDiscMainStats(),
  })
  check(
    '写词条输入不改「面板导入」那份的值',
    panelOfSource(sources, 'imported').atk === panelFromGame.atk,
  )
  check('写词条输入不改激活状态（面板页不会因此跳到词条页）', sources.active === 'imported')
  const same = writeAffixInputsIntoSource(sources, {})
  check('空补丁不产生变化', JSON.stringify(same) === JSON.stringify(sources))
}

console.log('\n[6.2] 草稿只读该份自己的数据：没有就是空，不拿别的数据顶替（2026-09-12）')
{
  /**
   * 所有者口径：**空就是空**。
   *
   * 老数据迁移后常只有一份面板（如「词条导入」那份），另一份是空的。
   * 若空的那份拿角色基础面板（攻击 626）或另一份面板顶替，用户会看到一组自己没导入过的数，
   * 以为「面板没加载」，点「确定导入」还会把这份假数据写成真面板。
   */
  const migrated = migrateLegacyPanelsToSources({
    legacyPanels: { claret: panelFromAffix },
    panelCalcMode: 'affix',
    teamSlots: [],
  })

  check(
    '该份没有数据时就是空（不回落角色基础面板）',
    panelOfSource(migrated.claret, 'imported') === undefined,
  )
  check(
    '该份有数据时读它自己那份',
    panelOfSource(
      writePanelSource(migrated.claret, 'imported', panelFromGame, { importedAt: 1 }),
      'imported',
    ).atk === panelFromGame.atk,
  )
  check(
    '另一份有数据也不参与这条读取（不跨来源顶替）',
    panelOfSource(migrated.claret, 'imported') === undefined &&
      panelOfSource(migrated.claret, 'affixDerived') !== undefined,
  )

  // 4-5-6 主属性同样：没有就是「未选择」，不塞爆伤/攻击/生命那组默认
  const empty = createEmptyAffixDriveDiscMainStats()
  check(
    '未选择状态：4-5-6 主属性为空，不是爆伤/攻击/生命',
    empty.slot4MainStat === '' && empty.slot5MainStat === '' && empty.slot6MainStat === '',
  )
  check(
    '空主属性算出来是「没有主属性贡献」（不是默认那套）',
    collectAffixDriveDiscMainStatContribution(empty).critDmg === 0 &&
      collectAffixDriveDiscMainStatContribution(empty).externalAtkPercent === 0,
  )
  const defaults = createDefaultAffixDriveDiscMainStats()
  check(
    '默认那套（爆伤/攻击/生命）只作为「用户自己选的」才有意义，与此区分',
    collectAffixDriveDiscMainStatContribution(defaults).critDmg === 48 &&
      collectAffixDriveDiscMainStatContribution(defaults).externalAtkPercent === 30,
  )
}

console.log('\n[6.1] 面板只能由「确定导入」写入：不存在自动写回（2026-09-12）')
{
  /**
   * 曾经有过两条自动写回：词条数一变就把现推面板写进「词条导入」那份、
   * live 编辑器变化再把值写进「面板导入」那份。它们会在用户没导入过的情况下
   * 凭空生成面板、也可能用陈旧值覆盖真面板（所有者要求：只有点了导入才生成面板）。
   *
   * 现在这些通道全部删除：写入面板的函数只剩两个 ——
   * `writePanelSource`（确定导入）与 `setActivePanelSource`（用户手动切换）。
   */
  const srcRoot = path.resolve(import.meta.dirname, '../src')
  const read = (rel) => fs.readFileSync(path.join(srcRoot, rel), 'utf8')
  const panelSection = read('components/calculator/PanelCalcSection.vue')
  const picker = read('components/calculator/UnifiedPresetPicker.vue')
  const page = read('components/calculator/DamageCalcPage.vue')

  check(
    '面板组件里没有任何面板写入（自动写回已删除）',
    !/writePanelSource|updatePanelSourceValues|setActivePanelSource/.test(panelSection),
  )
  check(
    '面板组件不再引用「更新数值」这条写回 API',
    !/updatePanelSourceValues/.test(picker) && !/updatePanelSourceValues/.test(panelSection),
  )
  check(
    '页面里写入面板的只有导入与手动切换两处',
    (page.match(/writePanelSource\(/g) || []).length === 2 &&
      (page.match(/setActivePanelSource\(/g) || []).length === 1,
  )
  check(
    '页面不再用角色基础面板兜底造面板',
    !/ensureAgentExternalPanel/.test(page) && !/createExternalPanelFromAgentBase/.test(page),
  )

  // 手动切换只改 active，两份面板本身逐位不动
  let sources = writePanelSource(undefined, 'imported', panelFromGame, { importedAt: 1 })
  sources = writePanelSource(sources, 'affixDerived', panelFromAffix, { importedAt: 2 })
  const switched = setActivePanelSource(sources, 'imported')
  check('用户手动切换后，两份面板逐位不动', JSON.stringify(switched.importedPanel) === JSON.stringify(sources.importedPanel) &&
    JSON.stringify(switched.affixDerivedPanel) === JSON.stringify(sources.affixDerivedPanel))
  check('切换后计算读到新选的那份', resolveActivePanel(switched).atk === panelFromGame.atk)
}

console.log('\n[7] 验收 5 / 8：代码审查（无来源分支、无推断逻辑）')
{
  const srcRoot = path.resolve(import.meta.dirname, '../src')
  const read = (rel) => fs.readFileSync(path.join(srcRoot, rel), 'utf8')

  /** 计算链路：只接收一份 PanelStats，不得查询来源 */
  const calcFiles = [
    'utils/optimalAffixAlloc.ts',
    'utils/panelBuffCalc.ts',
    'utils/affixPanelCalc.ts',
    'utils/affixBenefitAnalysis.ts',
    'utils/affixOptimizer.ts',
    'utils/damageCalc.ts',
    'utils/resolvedHit.ts',
  ]
  const provenanceLeaks = []
  for (const rel of calcFiles) {
    const text = read(rel)
    if (/provenance/.test(text)) provenanceLeaks.push(rel + '：出现 provenance')
    // 「不问来历」：不得按 active / imported / affixDerived 分支读面板
    if (/sources\.active|activePanelSourceKind|'affixDerived'|"affixDerived"/.test(text)) {
      provenanceLeaks.push(rel + '：出现来源分支判断')
    }
  }
  check('计算链路不出现来源信息与来源分支', provenanceLeaks.length === 0, provenanceLeaks.join('；'))

  const affixPanelCalc = read('utils/affixPanelCalc.ts')
  check('反推函数已删除（§7）', !/inferAffixCountsFromExternalPanel/.test(affixPanelCalc))

  const allSrc = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|vue)$/.test(e.name)) allSrc.push(p)
    }
  }
  walk(srcRoot)
  const leftover = allSrc.filter((f) => /inferAffixCountsFromExternalPanel/.test(fs.readFileSync(f, 'utf8')))
  check('全仓 src 无残留反推调用点', leftover.length === 0, leftover.join('；'))

  /**
   * 面板组件里**不得有任何面板写入**。
   *
   * 回归（2026-09-11）：`flushImportedPanelForAgent` 曾用 `writePanelSource`，切槽 / 保存草稿
   * 会把 live 值写成「面板导入」并**抢走激活**；同期的条数写回也会凭空生成「词条导入」面板。
   * 2026-09-12 所有者要求：**必须先点导入才会生成面板**，这些自动写回通道已全部删除。
   */
  const panelSection = read('components/calculator/PanelCalcSection.vue')
  const panelWrites = panelSection.match(/writePanelSource|updatePanelSourceValues|setActivePanelSource/g) ?? []
  check(
    '面板组件不含任何面板写入（自动写回通道已删除）',
    panelWrites.length === 0,
    panelWrites.length ? `仍出现：${panelWrites.join('、')}` : '',
  )

  /**
   * 老字段 `anomalySlotPanels` 只准留在「持久化 / 迁移 / 老草稿兼容读取」这几处，
   * 且每处都必须带兼容语义 —— 它**不得**再作为运行时存储使用（运行时是 `slotPanels`）。
   */
  const legacyAllowed = [
    'types/damageCalcHistory.ts',
    'utils/damageCalcHistory.ts',
    'utils/agentPanelSources.ts',
    'components/calculator/DamageCalcPage.vue',
    'utils/affixPanelCalc.ts',
  ]
  const offenders = []
  for (const abs of allSrc) {
    const rel = abs.replace(srcRoot + path.sep, '').replace(/\\/g, '/')
    const text = fs.readFileSync(abs, 'utf8')
    if (!/anomalySlotPanels/.test(text)) continue
    if (!legacyAllowed.includes(rel)) {
      offenders.push(rel + '：不在兼容白名单内')
      continue
    }
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!/anomalySlotPanels/.test(line)) return
      const prev = lines[i - 1] ?? ''
      const ok =
        /@deprecated|迁移|legacy|Legacy|deprecated|\*/.test(line) ||
        /@deprecated|迁移|legacy|Legacy|deprecated/.test(prev) ||
        /^\s*anomalySlotPanels\?:/.test(line) ||
        /sanitizeSchemeAnomalySlotPanels|entry\.anomalySlotPanels|scheme\.anomalySlotPanels|delete entry\.anomalySlotPanels|DamageCalcHistoryEntry\['anomalySlotPanels'\]/.test(
          line,
        )
      if (!ok) offenders.push(rel + ':' + (i + 1) + ' 用法不在兼容语义内：' + line.trim().slice(0, 80))
    })
  }
  check(
    '老字段只用于持久化/迁移/老草稿读取，不再当运行时存储',
    offenders.length === 0,
    offenders.join('；'),
  )

  const page = read('components/calculator/DamageCalcPage.vue')
  check(
    '运行时存储改用 slotPanels（每人两份来源）',
    /const slotPanels = reactive/.test(page) && /slotPanels: captureSchemeSlotPanels\(\)/.test(page),
  )

  /**
   * 面板快照里**不得**再带「当前角色词条数 / 4-5-6 主属性 / 每人一份词条数」。
   *
   * 回归（2026-09-12）：这三项**只有写、没有读** —— `loadSnapshot` 从不用前两项，
   * `affixStateByAgent` 还原进一个没有任何读取方的 map。实测盘上草稿里
   * `panelState.affixStateByAgent.koleda` = 全 0 词条 + `critDmg / externalAtkPercent /
   * externalHpPercent` 那套默认值，正是「珂蕾妲从没导入过词条，工具却替她写了一份配置」。
   * 所有者口径：没有就是没有，工具不得凭空造。
   */
  const snapshotType = read('types/damageCalcHistory.ts')
  const snapshotStart = snapshotType.indexOf('export interface DamageCalcPanelSnapshot')
  const snapshotRest = snapshotType.slice(snapshotStart + 1)
  const snapshotEnd = snapshotRest.indexOf('\nexport ')
  const snapshotBlock = snapshotRest.slice(0, snapshotEnd === -1 ? 800 : snapshotEnd)
  const snapshotAffixFields = ['affixCounts', 'affixDriveDiscMainStats', 'affixStateByAgent'].filter(
    (field) => new RegExp('\\b' + field + '\\s*:').test(snapshotBlock),
  )
  check(
    '面板快照不再携带词条字段（无人读取，写了就是凭空造配置）',
    snapshotAffixFields.length === 0,
    snapshotAffixFields.length ? `仍声明：${snapshotAffixFields.join('、')}` : '',
  )
  check(
    '面板组件不再凭空造 4/5/6 默认主属性（空就是空）',
    !/createDefaultAffixDriveDiscMainStats/.test(panelSection),
  )
}

console.log(`\n结果：${passed} PASS / ${failed} FAIL`)
if (failed > 0) process.exitCode = 1
