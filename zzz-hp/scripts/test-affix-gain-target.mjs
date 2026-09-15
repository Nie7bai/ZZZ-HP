/**
 * 词条目标 `gain:`（增益字段）契约（步骤 58）。
 *
 * 背景（用户 2026-09-13）：
 * 「你想让词条能直接加局内攻击，可以正常计算收益 / 但是不能跳过转模 /
 *   我的想法就是，任何增益都可以被 分析！」
 *
 * 验证四件事：
 * 1) `gain:` 目标合法、能建条目、标签与「每档单位」正确；
 * 2) **能算收益**：`gain:inCombatAtkPercent` 条目在收益表里出正收益；
 * 3) **不跳过转模（等价性）**：同数值下，`gain:` 条目的总伤 == 用「额外增益」
 *    （`ctx.extraGains`）手工加同值的总伤 —— 两者走的是同一条链路；
 * 4) **不脏面板**：`applyPanelDeltas` 不把增益字段写进 `PanelStats`。
 *
 * 运行：npx vite-node scripts/test-affix-gain-target.mjs
 */
import {
  createEmptyAffixCounts,
  createDefaultAffixDriveDiscMainStats,
} from '../src/types/calculatorPanel.ts'
import { createEmptyAgentBasePanel } from '../src/utils/calculatorUi.ts'
import { BUFFS_JSON, readJson } from './_paths.mjs'
import {
  AFFIX_GAIN_FIELDS,
  AFFIX_GAIN_FIELD_LABELS,
  applyPanelDeltas,
  affixPerRollUnit,
  affixTargetLabel,
  createDefaultAffixLibrary,
  deltaFieldOfTarget,
  entryRollsToEvalInput,
  gainFieldOfTarget,
  gainTarget,
  isAffixLibraryEntryTarget,
  validateAffixLibraryEntry,
} from '../src/utils/affixLibrary.ts'
import {
  AFFIX_KNOWN_TARGET_IDS,
  groupsForAffixTargetTiming,
  pickAffixTargetForTiming,
  findAffixTargetBranchGroup,
} from '../src/utils/affixTargetBranches.ts'
import { computeDefenseZone } from '../src/utils/damageCalc.ts'
import { computeAffixBenefitTable } from '../src/utils/affixBenefitAnalysis.ts'
import {
  buildOptimalEvalContext,
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
          hp: 9000,
          atk: 900,
          def: 700,
          critRate: 5,
          critDmg: 50,
          anomalyControl: 100,
          energyRegen: 120,
          directDmgMult: 100,
          anomalyMult: 125,
        },
      },
    ],
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
    hits: undefined,
    ...overrides,
  })
}

// ---------- 1. 目标命名空间 ----------
console.log('\n[1] gain: 目标合法性与标签')
check('inCombatAtkPercent 是合法目标', isAffixLibraryEntryTarget(gainTarget('inCombatAtkPercent')))
check(
  '不存在的增益字段被拒',
  !isAffixLibraryEntryTarget('gain:__not_a_field__'),
  'isAffixLibraryEntryTarget(\'gain:__not_a_field__\') === false',
)
check(
  'gainFieldOfTarget 认得增益字段',
  gainFieldOfTarget(gainTarget('inCombatAtkPercent')) === 'inCombatAtkPercent',
)
check(
  'deltaFieldOfTarget 认出增益字段',
  deltaFieldOfTarget(gainTarget('inCombatAtkPercent')) === 'inCombatAtkPercent',
)
check(
  '标签取增益词表（局内攻击力%）',
  affixTargetLabel(gainTarget('inCombatAtkPercent')) === AFFIX_GAIN_FIELD_LABELS.inCombatAtkPercent,
  `实际 "${affixTargetLabel(gainTarget('inCombatAtkPercent'))}"`,
)
check(
  '每档单位：百分比字段为 percent',
  affixPerRollUnit(gainTarget('inCombatAtkPercent')) === 'percent',
)
check(
  '每档单位：固定值字段为 flat（atk）',
  affixPerRollUnit(gainTarget('atk')) === 'flat',
)
check(
  '增益词表不是空的',
  AFFIX_GAIN_FIELDS.length > 50,
  `${AFFIX_GAIN_FIELDS.length} 个字段`,
)
check(
  '局内攻击力确实在词表里',
  AFFIX_GAIN_FIELDS.includes('inCombatAtkPercent'),
)
check(
  '条目校验通过',
  validateAffixLibraryEntry({
    label: '局内攻击力%',
    target: gainTarget('inCombatAtkPercent'),
    perRoll: 4,
  }) === null,
)

// ---------- 2. 不脏面板 ----------
console.log('\n[2] applyPanelDeltas 不把增益字段写进面板')
const basePanel = {
  hp: 9000,
  atk: 900,
  def: 700,
  critRate: 5,
  critDmg: 50,
  dmgBonus: 0,
  penRate: 0,
  mastery: 0,
  anomalyControl: 100,
  energyRegen: 120,
}
const beforeKeys = Object.keys(basePanel).sort()
const dirtyPanel = applyPanelDeltas(
  basePanel,
  { inCombatAtkPercent: 4, dmgBonus: 10 },
  { anomalyControl: 100, energyRegen: 120 },
)
const afterKeys = Object.keys(dirtyPanel).sort()
check(
  '面板键集合不变（增益字段被过滤）',
  beforeKeys.join(',') === afterKeys.join(','),
  `${beforeKeys.length} → ${afterKeys.length} 个键`,
)
check('增益字段没有落进面板', dirtyPanel.inCombatAtkPercent === undefined)
check('同表的局外字段照常落进去', dirtyPanel.dmgBonus === 10, `dmgBonus=${dirtyPanel.dmgBonus}`)

// ---------- 3. 能算收益 ----------
console.log('\n[3] gain: 条目能算出正收益')
const ctx = makeCtx()
const gainEntry = {
  id: 'test:gain-inCombatAtk',
  label: '局内攻击力%',
  target: gainTarget('inCombatAtkPercent'),
  perRoll: 4,
  cap: 0,
  group: '',
  rollCost: 1,
  enabledByDefault: true,
}
const zeros = createEmptyAffixCounts()
const table = computeAffixBenefitTable({
  ctx,
  baseCounts: zeros,
  entries: [gainEntry],
  includeSeries: false,
})
const baseline = table.baselineDamage
const row = table.rows[0]
check('基线总伤 > 0', baseline > 0, `基线 ${baseline}`)
check('该行有收益（damageDelta > 0）', row.damageDelta > 0, `+${Math.round(row.damageDelta)}`)
check('收益率 > 0', row.percentDelta > 0, `+${row.percentDelta.toFixed(3)}%`)

// ---------- 4. 等价性：与「额外增益」同一条链路 ----------
console.log('\n[4] 等价性：gain: 条目 == 额外增益（同链路，非旁路）')
const viaLib = entryRollsToEvalInput([gainEntry], { [gainEntry.id]: 1 })
const viaEntry = evaluateAffixCounts(
  ctx,
  viaLib.counts,
  viaLib.deltas,
  viaLib.valuePerCount,
  viaLib.extraGains,
)
check('库路径把 gain: 写成 extraGains，不写 deltas', viaLib.extraGains.length === 1 && viaLib.deltas.inCombatAtkPercent == null)
// 4b. 增益路径：手工把同样 4 个百分点塞进 extraGains
const ctxWithGain = makeCtx({
  extraGains: [
    {
      id: 'manual:inCombatAtk',
      name: '手工局内攻击',
      stat: 'inCombatAtkPercent',
      value: 4,
      applySituation: 'global',
      scope: 'general',
      applyTarget: 'self',
      applySlot: 0,
    },
  ],
})
const viaGain = evaluateAffixCounts(ctxWithGain, zeros, undefined)
check(
  '总伤完全一致（同一条链路）',
  Math.abs(viaEntry.grandTotal - viaGain.grandTotal) < 1e-6,
  `条目 ${viaEntry.grandTotal} vs 增益 ${viaGain.grandTotal}`,
)
check(
  '局内攻击力确实变了（说明生效）',
  viaEntry.finalPanel.atk > evaluateAffixCounts(ctx, zeros, undefined).finalPanel.atk,
  `${evaluateAffixCounts(ctx, zeros, undefined).finalPanel.atk} → ${viaEntry.finalPanel.atk}`,
)

// ---------- 5. 真实转模消费者：音擎「血髓秘匣」读局内暴击 ----------
console.log('\n[5] 真实验证：词条增益进转模链路（音擎「血髓秘匣」读局内暴击）')
{
  /**
   * 这是「不跳过转模」的**真实证据**，不是等价性推理：
   * 血髓秘匣（锋御专用）的转模是 `from: critRate, panelSource: 'final'` ——
   * 读**局内**暴击，超出 100% 的部分按 0.48%/点转成增伤。
   * 若词条增益绕过了转模（只写最终结果），这条转模就读不到它。
   */
  const buffs = readJson(BUFFS_JSON)
  const wengine = buffs.wengines.find((w) => w.id === 'BloodCasket')
  check('测试数据里找到血髓秘匣', Boolean(wengine), wengine ? `限 ${wengine.profession}` : '未找到')
  const convert = wengine?.refinementBuffs?.[0]?.effectBlocks?.[0]?.effects?.[0]?.convert
  check(
    '它的转模确实是 from=critRate / panelSource=final',
    convert?.from === 'critRate' && convert?.panelSource === 'final',
    JSON.stringify(convert),
  )

  const enabledIds = {}
  for (const buf of wengine.refinementBuffs ?? []) {
    for (const blk of buf.effectBlocks ?? []) for (const e of blk.effects ?? []) enabledIds[e.id] = true
    for (const e of buf.effects ?? []) enabledIds[e.id] = true
  }
  const fyAgent = {
    id: 'fy-probe',
    name: '锋御探针',
    element: '电',
    profession: wengine.profession,
    basePanel: {
      ...createEmptyAgentBasePanel(),
      hp: 9000,
      atk: 900,
      def: 700,
      critRate: 105,
      critDmg: 50,
      anomalyControl: 100,
      energyRegen: 120,
      directDmgMult: 100,
      anomalyMult: 125,
    },
  }
  const fyCtx = makeCtx({
    isFengYu: true,
    baseDamageSource: 'def',
    teamSlots: [
      {
        agentId: 'fy-probe',
        wengineId: wengine.id,
        wengineRefine: 1,
        twoPieceDriveDiscId: 'none',
        fourPieceDriveDiscId: 'none',
      },
    ],
    agents: [fyAgent],
    wengines: [wengine],
    buffSelection: { enabledIds, stacksByEffectId: {}, convertInputs: {} },
  })

  const noGain = evaluateAffixCounts(fyCtx, zeros, undefined)
  const withGain = evaluateAffixCounts(fyCtx, zeros, { critRate: 20 })
  const critDelta = withGain.finalPanel.critRate - noGain.finalPanel.critRate
  const dmgDelta = withGain.finalPanel.dmgBonus - noGain.finalPanel.dmgBonus
  const expected = (20 * convert.ratioPercent) / 100

  check('词条增益确实抬高了局内暴击', Math.abs(critDelta - 20) < 1e-6, `+${critDelta}`)
  check(
    '转模产出的增伤随词条增益增加（说明转模读到了它）',
    dmgDelta > 0,
    `增伤 ${noGain.finalPanel.dmgBonus} → ${withGain.finalPanel.dmgBonus}`,
  )
  check(
    '增量与转模公式吻合：20 × 0.48% = 0.096',
    Math.abs(dmgDelta - expected) < 1e-9,
    `实算 +${dmgDelta}，预期 +${expected}`,
  )
}

// ---------- 6. 局外字段路径未受影响 ----------
console.log('\n[6] 回归：panel: 条目行为不变')
const panelEntry = {
  id: 'test:panel-dmgBonus',
  label: '增伤%',
  target: 'panel:dmgBonus',
  perRoll: 10,
  cap: 0,
  group: '',
  rollCost: 1,
  enabledByDefault: true,
}
const panelTable = computeAffixBenefitTable({
  ctx,
  baseCounts: zeros,
  entries: [panelEntry],
  includeSeries: false,
})
check('panel: 条目仍有正收益', panelTable.rows[0].percentDelta > 0, `+${panelTable.rows[0].percentDelta.toFixed(3)}%`)
const noDelta = evaluateAffixCounts(ctx, zeros, undefined)
const withDelta = evaluateAffixCounts(ctx, zeros, { dmgBonus: 10 })
check('panel: 增量仍改变总伤', withDelta.grandTotal !== noDelta.grandTotal)
check(
  'panel: 增量不改局内攻击（走局外面板）',
  withDelta.finalPanel.atk === noDelta.finalPanel.atk,
  `${noDelta.finalPanel.atk} → ${withDelta.finalPanel.atk}`,
)

// ---------- 7. 既有默认库未被污染 ----------
console.log('\n[7] 回归：默认词条库都是 panel: 局外，无 gain:')
const lib = createDefaultAffixLibrary()
check(
  '默认库 10 条，且无 gain: 条目',
  lib.length === 10 &&
    lib.every((entry) => String(entry.target).startsWith('panel:') && !String(entry.target).startsWith('gain:')),
  `${lib.length} 条`,
)

// ---------- 8. 局外/增益重叠字段不得双算（2026-09-14） ----------
console.log('\n[8] 重叠字段（penRate / dmgBonus）只加一次')
{
  const base = evaluateAffixCounts(ctx, zeros, undefined)
  const plusPen = evaluateAffixCounts(ctx, zeros, { penRate: 24 })
  const plusDmg = evaluateAffixCounts(ctx, zeros, { dmgBonus: 30 })
  check(
    '+24 穿透率 → 局内只 +24（不是 +48）',
    Math.abs(plusPen.finalPanel.penRate - base.finalPanel.penRate - 24) < 1e-6,
    `${base.finalPanel.penRate} → ${plusPen.finalPanel.penRate}`,
  )
  check(
    '+30 增伤 → 局内只 +30（不是 +60）',
    Math.abs(plusDmg.finalPanel.dmgBonus - base.finalPanel.dmgBonus - 30) < 1e-6,
    `${base.finalPanel.dmgBonus} → ${plusDmg.finalPanel.dmgBonus}`,
  )

  const shredCtx = makeCtx({
    extraGains: [
      {
        id: 'test-shred',
        name: '减防',
        stat: 'reduceDefense',
        value: 41,
        applySituation: 'global',
        scope: 'general',
        applyTarget: 'self',
        applySlot: 0,
      },
    ],
  })
  const shredBase = evaluateAffixCounts(shredCtx, zeros, undefined)
  const shredPen = evaluateAffixCounts(shredCtx, zeros, { penRate: 24 })
  check('基线吃到 41% 减防', Math.abs(shredBase.finalPanel.reduceDefense - 41) < 1e-6, `${shredBase.finalPanel.reduceDefense}`)
  const zone0 = computeDefenseZone({
    defensePanel: shredBase.finalPanel,
    isMb: false,
    enemyDefense: 952.8,
  })
  const zone24 = computeDefenseZone({
    defensePanel: shredPen.finalPanel,
    isMb: false,
    enemyDefense: 952.8,
  })
  const zoneGain = (zone24.defenseMultiplier / zone0.defenseMultiplier - 1) * 100
  check(
    '减防 41% 时 +24 穿透的防御区增益约 11%（双算时约 25%）',
    zoneGain > 10 && zoneGain < 13,
    `${zoneGain.toFixed(3)}%  区 ${zone0.defenseMultiplier.toFixed(4)} → ${zone24.defenseMultiplier.toFixed(4)}`,
  )
}

console.log('\n[picker] 时机 + 局外重复')
{
  const shared = findAffixTargetBranchGroup('panel:critRate')
  check('暴击局外在「局外重复」', shared?.id === 'shared' && shared.label === '局外重复')
  check(
    '局外重复含局内暴击/爆伤/增伤/精通',
    ['gain:critRate', 'gain:critDmg', 'gain:dmgBonus', 'gain:mastery'].every((id) =>
      shared?.options.some((option) => option.id === id),
    ),
  )
  check(
    '切时机暴击 panel→gain 仍在局外重复',
    pickAffixTargetForTiming('panel:critRate', 'gain') === 'gain:critRate',
  )
  check(
    '选局外时没有属性异常组',
    !groupsForAffixTargetTiming('panel').some((group) => group.id === 'anomaly'),
  )
  check('选单不含已隐藏的局外抗穿', !AFFIX_KNOWN_TARGET_IDS.has('panel:resPen'))
  check('选单不含局外减防/无视防御', !AFFIX_KNOWN_TARGET_IDS.has('panel:reduceDefense') && !AFFIX_KNOWN_TARGET_IDS.has('panel:ignoreDefense'))
  check('选单仍有局内抗穿', AFFIX_KNOWN_TARGET_IDS.has('gain:resPen'))
  check('选单仍有局内减防', AFFIX_KNOWN_TARGET_IDS.has('gain:reduceDefense'))
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
