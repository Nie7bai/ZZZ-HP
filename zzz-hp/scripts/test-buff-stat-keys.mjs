/**
 * 增益字段表与「零表」必须对齐，且缺键不能变成 NaN。
 *
 * 2026-10-18 事故：`buffEffect.BUFF_STAT_KEYS`（造零表 / 扁平↔效果 的字段来源）漏了
 * `turbulenceCritRate` 等 6 个子类暴击字段，而 `calculatorUi.BUFF_STAT_FIELDS`（合并时的
 * 遍历表）有它们 → `0 + undefined = NaN` → 局内面板 turbulenceCrit* 变 NaN →
 * 乱流期望伤害整条 NaN（页面显示「—」，且「乱流暴击区」被当成未启用而隐藏）。
 *
 * 运行：npm run test:buff-stat-keys
 */
import {
  fixedEffect,
  makePanel,
  makePanelCtx,
  mindscapeWithEffects,
  testAgent,
} from './_effectPipelineHarness.mjs'
import {
  effectsToFlatMods,
  flatModsToEffects,
  resolveEffectsToMods,
} from '../src/utils/buffEffect.ts'
import {
  BUFF_STAT_FIELDS,
  createEmptyAgentBasePanel,
  createEmptyBuffStatModifiers,
  mergeBuffStatModifiers,
} from '../src/utils/calculatorUi.ts'
import {
  createEmptyAffixCounts,
  createEmptyAffixDriveDiscMainStats,
} from '../src/types/calculatorPanel.ts'
import {
  computeExternalPanelFromAffixes,
} from '../src/utils/affixPanelCalc.ts'
import { computeFinalPanel } from '../src/utils/panelBuffCalc.ts'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { buildAlignedAnomalyFormulaGroups } from '../src/utils/anomalyFormulaDisplay.ts'

let passed = 0
let failed = 0
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const fieldKeys = BUFF_STAT_FIELDS.map((field) => field.key)

console.log('\n[1] 「零表」覆盖所有可配增益字段')
{
  const zero = resolveEffectsToMods([], {})
  const missing = fieldKeys.filter((key) => !(key in zero))
  check('BUFF_STAT_FIELDS 每个键都在零表里', missing.length === 0, missing.join(', ') || '无缺键')

  const nanKeys = fieldKeys.filter((key) => !finite(zero[key]))
  check('零表每格都是有限数字', nanKeys.length === 0, nanKeys.join(', ') || '全部有限')
}

console.log('\n[2] 每个可配字段都能通过效果解析生效')
{
  const bad = []
  for (const key of fieldKeys) {
    const mods = resolveEffectsToMods([fixedEffect(`eff-${key}`, key, 30)], {})
    if (mods[key] !== 30) bad.push(`${key}=${mods[key]}`)
  }
  check('每个字段都能被 fixed 效果写入 30', bad.length === 0, bad.join(', ') || '全部命中')
}

console.log('\n[3] 源对象缺键时合并按 0 处理（不产生 NaN）')
{
  const full = resolveEffectsToMods([fixedEffect('eff-dmg', 'dmgBonus', 20)], {})
  const partial = { ...full }
  delete partial.turbulenceCritDmg
  delete partial.radianceCritRate
  const merged = mergeBuffStatModifiers(createEmptyBuffStatModifiers(), partial)
  check('缺键合并后 dmgBonus 仍 +20', merged.dmgBonus === 20, `${merged.dmgBonus}`)
  check('缺键合并后 turbulenceCritDmg = 0', merged.turbulenceCritDmg === 0, `${merged.turbulenceCritDmg}`)
  check('缺键合并后 radianceCritRate = 0', merged.radianceCritRate === 0, `${merged.radianceCritRate}`)
  const nanKeys = fieldKeys.filter((key) => !finite(merged[key]))
  check('合并结果没有任何 NaN', nanKeys.length === 0, nanKeys.join(', ') || '全部有限')
}

console.log('\n[4] 扁平 mods ↔ 效果往返不丢子类暴击')
{
  const flat = { ...createEmptyBuffStatModifiers(), turbulenceCritDmg: 30, disorderCritRate: 12 }
  const roundTrip = effectsToFlatMods(flatModsToEffects(flat, 'self'))
  check('turbulenceCritDmg 往返仍是 30', roundTrip.turbulenceCritDmg === 30, `${roundTrip.turbulenceCritDmg}`)
  check('disorderCritRate 往返仍是 12', roundTrip.disorderCritRate === 12, `${roundTrip.disorderCritRate}`)
}

console.log('\n[5] 端到端：面板带一条 Buff 时五类异常都出有限伤害')
{
  const ctx = makePanelCtx({
    agents: [
      testAgent('a', {
        mindscapeBuffs: mindscapeWithEffects([fixedEffect('eff-dmg', 'dmgBonus', 20)]),
      }),
    ],
  })
  const external = makePanel({
    atk: 2000,
    mastery: 100,
    dmgBonus: 10,
    turbulenceBaseMult: 800,
    turbulenceCompMult: 7.5,
    anomalyDuration: 10,
    attributeAnomalyMult: 713,
  })
  const { finalPanel } = computeFinalPanel(external, ctx)

  check('局内 turbulenceCritRate 是 0 不是 NaN', finalPanel.turbulenceCritRate === 0, `${finalPanel.turbulenceCritRate}`)
  check('局内 turbulenceCritDmg 是 0 不是 NaN', finalPanel.turbulenceCritDmg === 0, `${finalPanel.turbulenceCritDmg}`)
  const nanPanelKeys = fieldKeys.filter((key) => key in finalPanel && !finite(finalPanel[key]))
  check(
    '局内面板里所有增益字段都是有限数字',
    nanPanelKeys.length === 0,
    nanPanelKeys.join(', ') || '全部有限',
  )

  const enemy = {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
  }
  const input = {
    finalPanel,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: finalPanel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: finalPanel,
  }
  const turbulence = computeDamageResult({ ...input, anomalySubKind: 'turbulence' })
  check('乱流期望伤害是有限数字', finite(turbulence.turbulenceExpected), `${turbulence.turbulenceExpected}`)
  check('乱流期望伤害 > 0', turbulence.turbulenceExpected > 0, `${turbulence.turbulenceExpected}`)
  check('乱流倍率区 = 800% + 10×0.075×100', Math.abs(turbulence.turbulenceZone - 8.75) < 1e-9, `${turbulence.turbulenceZone}`)

  for (const kind of ['attributeAnomaly', 'disorder', 'anomalyRelease', 'radiance']) {
    const r = computeDamageResult({ ...input, anomalySubKind: kind })
    const value =
      kind === 'attributeAnomaly'
        ? r.attributeAnomalyExpected
        : kind === 'disorder'
          ? r.disorderExpected
          : kind === 'anomalyRelease'
            ? r.anomalyReleaseExpected
            : r.radianceExpected
    check(`${kind} 期望伤害是有限数字`, finite(value), `${value}`)
  }
}

console.log('\n[6] 乱流暴击区：没爆伤时 = 1（不展示），有爆伤时按爆伤放大')
{
  const enemy = {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
  }
  const base = (extra) => {
    const panel = makePanel({
      atk: 2000,
      mastery: 100,
      turbulenceBaseMult: 800,
      turbulenceCompMult: 7.5,
      anomalyDuration: 10,
      ...extra,
    })
    return computeDamageResult({
      finalPanel: panel,
      piercePower: 0,
      baseDamageSource: 'atk',
      isMbMainAgent: false,
      enemyInput: enemy,
      combatVulnerable: 0,
      combatStaggerVulnerable: 0,
      combatSpecial: 0,
      staggerPhase: 'normal',
      ownerAgentLevel: 60,
      triggerFinalPanel: panel,
      triggerAgentLevel: 60,
      anomalyTriggerPanel: panel,
      anomalySubKind: 'turbulence',
    })
  }
  const none = base({})
  check('无乱流爆伤 → 乱流暴击区 = 1', none.turbulenceFullCritZone === 1, `${none.turbulenceFullCritZone}`)
  check('无乱流爆伤 → 期望 = 不暴击期望', none.turbulenceExpected === none.turbulenceExpectedNoCrit, `${none.turbulenceExpected}`)
  const withCrit = base({ turbulenceCritRate: 100, turbulenceCritDmg: 50 })
  check('乱流爆伤 50 → 暴击区 1.5', withCrit.turbulenceFullCritZone === 1.5, `${withCrit.turbulenceFullCritZone}`)
  check(
    '乱流暴击 100% / 爆伤 50 → 期望 = 不暴击 × 1.5',
    Math.abs(withCrit.turbulenceExpected - withCrit.turbulenceExpectedNoCrit * 1.5) < 1,
    `${withCrit.turbulenceExpected} vs ${withCrit.turbulenceExpectedNoCrit}`,
  )
}

console.log('\n[7] 伤害详情公式表：乱流那一格读乱流暴击区，不是属性异常暴击区')
{
  const enemy = {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
  }
  const panel = makePanel({
    atk: 2000,
    mastery: 100,
    turbulenceBaseMult: 800,
    turbulenceCompMult: 7.5,
    anomalyDuration: 10,
    attributeAnomalyCritRate: 30,
    attributeAnomalyCritDmg: 90,
    turbulenceCritRate: 100,
    turbulenceCritDmg: 50,
  })
  const input = {
    finalPanel: panel,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: panel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: panel,
  }
  const fmt = (v) => String(Math.round(v * 1000) / 1000)
  const turbulence = computeDamageResult({ ...input, anomalySubKind: 'turbulence' })
  const [, turbulenceGroup] = buildAlignedAnomalyFormulaGroups(
    turbulence,
    'turbulence',
    '紊乱',
    fmt,
    (v) => String(v),
  )
  const critTerm = turbulenceGroup.terms.find((term) => term.tipsKey === 'turbulenceCritZone')
  check('乱流公式里有「乱流暴击区」这一项', Boolean(critTerm), critTerm?.label ?? '缺失')
  check('乱流暴击区标签不是「属性异常暴击区」', critTerm?.label === '乱流暴击区', critTerm?.label)
  // 2026-10-18：乘区显示**期望区**（1 + 率×爆伤），不再是「1 / 满暴击区」两档
  check('乱流暴击区取期望 turbulenceCritZone（1.5）', critTerm?.value === '1.5', critTerm?.value)

  const anomaly = computeDamageResult({ ...input, anomalySubKind: 'attributeAnomaly' })
  const [, anomalyGroup] = buildAlignedAnomalyFormulaGroups(
    anomaly,
    'attributeAnomaly',
    '紊乱',
    fmt,
    (v) => String(v),
  )
  const anomalyTerm = anomalyGroup.terms.find((term) => term.tipsKey === 'attributeAnomalyCritZone')
  check('属性异常仍用「属性异常暴击区」', anomalyTerm?.label === '属性异常暴击区', anomalyTerm?.label)
  check('属性异常取期望 attributeAnomalyCritZone（1.27）', anomalyTerm?.value === '1.27', anomalyTerm?.value)

  // 所有者 2026-11-01：易伤区 / 直伤易伤区 / 非直伤易伤区是同一个乘区，来源是异常类触发者，
  // 所以它虽参与「异常基础期望」连乘，公式行里也要单独标出触发者，不能算到提供者头上
  const [labelledBase] = buildAlignedAnomalyFormulaGroups(
    anomaly,
    'attributeAnomaly',
    '紊乱',
    fmt,
    (v) => String(v),
    { baseAgent: '异常强度提供者 · 甲', bonusAgent: '异常类触发者 · 乙' },
  )
  const vulnerableTerm = labelledBase.terms.find((term) => term.tipsKey === 'anomalyVulnerableMultiplier')
  check('非直伤易伤区在公式里标成异常类触发者', vulnerableTerm?.ownerLabel === '异常类触发者 · 乙', vulnerableTerm?.ownerLabel)
}

console.log('\n[8] 子类暴击互相独立：属性异常暴击不是父类，不会串到异放/乱流/耀变/紊乱')
{
  const external = makePanel({
    attributeAnomalyCritRate: 50,
    attributeAnomalyCritDmg: 100,
    anomalyReleaseCritRate: 40,
    anomalyReleaseCritDmg: 80,
    turbulenceCritRate: 20,
    turbulenceCritDmg: 30,
    radianceCritRate: 10,
    disorderCritRate: 5,
  })
  const { finalPanel } = computeFinalPanel(external, makePanelCtx())

  check('属性异常暴击保留自己的值 50', finalPanel.attributeAnomalyCritRate === 50, `${finalPanel.attributeAnomalyCritRate}`)
  check('属性异常爆伤保留自己的值 100', finalPanel.attributeAnomalyCritDmg === 100, `${finalPanel.attributeAnomalyCritDmg}`)
  check('异放暴击不吃属性异常暴击 → 40', finalPanel.anomalyReleaseCritRate === 40, `${finalPanel.anomalyReleaseCritRate}`)
  check('乱流暴击不吃属性异常暴击 → 20', finalPanel.turbulenceCritRate === 20, `${finalPanel.turbulenceCritRate}`)
  check('乱流爆伤不吃属性异常爆伤 → 30', finalPanel.turbulenceCritDmg === 30, `${finalPanel.turbulenceCritDmg}`)
  check('耀变暴击不吃属性异常暴击 → 10', finalPanel.radianceCritRate === 10, `${finalPanel.radianceCritRate}`)
  check('耀变爆伤默认 0', finalPanel.radianceCritDmg === 0, `${finalPanel.radianceCritDmg}`)
  check('紊乱暴击不吃属性异常暴击 → 5', finalPanel.disorderCritRate === 5, `${finalPanel.disorderCritRate}`)
  check('紊乱爆伤默认 0', finalPanel.disorderCritDmg === 0, `${finalPanel.disorderCritDmg}`)

  // 增益侧同样互不串：只给「异常暴击」的增益，不得抬高任何子类
  const ctxWithBuff = makePanelCtx({
    agents: [
      testAgent('a', {
        mindscapeBuffs: mindscapeWithEffects([fixedEffect('eff-acr', 'attributeAnomalyCritRate', 30)]),
      }),
    ],
  })
  const withBuff = computeFinalPanel(makePanel({ attributeAnomalyCritRate: 10 }), ctxWithBuff).finalPanel
  check('增益属性异常暴击 +30 只抬属性异常暴击 → 40', withBuff.attributeAnomalyCritRate === 40, `${withBuff.attributeAnomalyCritRate}`)
  check('增益属性异常暴击不影响异放暴击', withBuff.anomalyReleaseCritRate === 0, `${withBuff.anomalyReleaseCritRate}`)
  check('增益属性异常暴击不影响乱流暴击', withBuff.turbulenceCritRate === 0, `${withBuff.turbulenceCritRate}`)
  check('增益属性异常暴击不影响耀变暴击', withBuff.radianceCritRate === 0, `${withBuff.radianceCritRate}`)
  check('增益属性异常暴击不影响紊乱暴击', withBuff.disorderCritRate === 0, `${withBuff.disorderCritRate}`)

  // 结算侧：只有属性异常暴击时，四类子类的暴击区都必须还是 1
  const panels = makePanel({
    atk: 2000,
    mastery: 100,
    attributeAnomalyCritRate: 50,
    attributeAnomalyCritDmg: 100,
    turbulenceBaseMult: 800,
    turbulenceCompMult: 7.5,
    anomalyDuration: 10,
  })
  const enemy = {
    level: 60,
    defense: 953,
    resistanceType: 'normal',
    vulnerableMultiplier: 1,
    staggerMultiplier: 1,
    specialMultiplier: 1,
  }
  const damageInput = {
    finalPanel: panels,
    piercePower: 0,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: panels,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: panels,
  }
  const byKind = (kind) => computeDamageResult({ ...damageInput, anomalySubKind: kind })
  check('只有属性异常暴击 → 异放暴击区 = 1', byKind('anomalyRelease').anomalyReleaseFullCritZone === 1, `${byKind('anomalyRelease').anomalyReleaseFullCritZone}`)
  check('只有属性异常暴击 → 乱流暴击区 = 1', byKind('turbulence').turbulenceFullCritZone === 1, `${byKind('turbulence').turbulenceFullCritZone}`)
  check('只有属性异常暴击 → 耀变暴击区 = 1', byKind('radiance').radianceFullCritZone === 1, `${byKind('radiance').radianceFullCritZone}`)
  check('只有属性异常暴击 → 紊乱暴击区 = 1', byKind('disorder').disorderFullCritZone === 1, `${byKind('disorder').disorderFullCritZone}`)
  const anomalyHit = byKind('attributeAnomaly')
  check('只有属性异常暴击 → 属性异常暴击区 = 1 + 100% = 2（自己的生效）', anomalyHit.attributeAnomalyFullCritZone === 2, `${anomalyHit.attributeAnomalyFullCritZone}`)
}

console.log('\n[9] 异常掌控是唯一保留整数的属性（舍弃小数，不是四舍五入）')
{
  // 局外：94 × (1 + 8%) = 101.52 → 101（floor，不是 round 到 101.52）
  const externalFromAffixes = computeExternalPanelFromAffixes({
    agentBase: { ...createEmptyAgentBasePanel(), anomalyControl: 94, energyRegen: 1.2 },
    wengineBaseAtk: 0,
    wengineAdvanced: {
      critRate: 0,
      critDmg: 0,
      anomalyControlPercent: 8,
      energyRegen: 8,
      mastery: 0,
      externalAtkPercent: 0,
      externalHpPercent: 0,
      externalDefPercent: 0,
      penRate: 0,
    },
    affixCounts: createEmptyAffixCounts(),
    driveDiscSelection: { twoPieceDriveDiscId: 'none', fourPieceDriveDiscId: 'none' },
    driveDiscMainStats: createEmptyAffixDriveDiscMainStats(),
    driveDiscs: [],
  })
  check(
    '局外 94 × 1.08 = 101.52 → 异常掌控 101',
    externalFromAffixes.anomalyControl === 101,
    `${externalFromAffixes.anomalyControl}`,
  )
  check(
    '局外 异常掌控 是整数（Number.isInteger）',
    Number.isInteger(externalFromAffixes.anomalyControl),
    `${externalFromAffixes.anomalyControl}`,
  )
  // 对照：能量回复效率**不**取整（只有异常掌控保留整数）；1.2 + 1.2×8% = 1.296 → 两位 1.3
  check(
    '能量回复效率不取整（1.296 → 1.3，而不是 1）',
    Math.abs(externalFromAffixes.energyRegen - 1.3) < 1e-9,
    `${externalFromAffixes.energyRegen}`,
  )

  // 局内：182 + 94×8% = 189.52 → 189
  const ctxPercent = makePanelCtx({
    agents: [testAgent('a', { mindscapeBuffs: mindscapeWithEffects([fixedEffect('eff-acp', 'anomalyControlPercent', 8)]) })],
  })
  const buffed = computeFinalPanel(makePanel({ anomalyControl: 182 }), ctxPercent).finalPanel
  check('局内 182 + 94×8% = 189.52 → 189', buffed.anomalyControl === 189, `${buffed.anomalyControl}`)
  check('局内 异常掌控 是整数', Number.isInteger(buffed.anomalyControl), `${buffed.anomalyControl}`)

  // 固定值 + 百分比：182 + 7 + 94×8% = 196.52 → 196
  const ctxBoth = makePanelCtx({
    agents: [
      testAgent('a', {
        mindscapeBuffs: mindscapeWithEffects([
          fixedEffect('eff-acf', 'anomalyControl', 7),
          fixedEffect('eff-acp', 'anomalyControlPercent', 8),
        ]),
      }),
    ],
  })
  const both = computeFinalPanel(makePanel({ anomalyControl: 182 }), ctxBoth).finalPanel
  check('局内 182+7+7.52 = 196.52 → 196', both.anomalyControl === 196, `${both.anomalyControl}`)

  // 本来就是整数时不受影响
  const plain = computeFinalPanel(makePanel({ anomalyControl: 255 }), makePanelCtx()).finalPanel
  check('本来就是整数 255 → 仍 255', plain.anomalyControl === 255, `${plain.anomalyControl}`)

  // 转模输入因此永远是整数：209.76 这种值不可能再出现
  const dirty = 209.76
  const clean = Math.floor(dirty)
  check(
    '转模输入不再带小数（209.76 → 209，输出 0.7 倍后只有一位小数）',
    Number.isInteger(clean) && Math.abs(((clean - 155) * 70) / 100 - 37.8) < 1e-9,
    `${clean} → ${((clean - 155) * 70) / 100}`,
  )
}

console.log(`\n${failed ? `❌ ${failed} failed, ${passed} passed` : `✅ all passed（${passed}）`}`)
if (failed) process.exit(1)