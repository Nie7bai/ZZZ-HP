/**
 * 属性异常字段作用范围回归（Spec §7 C1—C5、C7）。
 *
 * 契约（2026-10-30 口径统一）：
 * - 五个子类增伤字段各自只影响对应子类：属性异常增伤不再加算进乱流 / 紊乱 / 耀变 / 异放；
 * - 五子类暴击字段只吃自己的暴击率 / 爆伤；
 * - 消费记录（`onInputUsed`）里属性异常增伤只由属性异常事件报告；
 * - 中文名：属性异常子类一律「属性异常 X」，合集仍是「异常类 X」；
 * - Nanoka 工具槽位：「属性异常增伤 / 属性异常暴击率 / 属性异常暴击伤害」，
 *   旧槽位值「异常增伤 / 异常暴击率 / 异常暴击伤害」必须被拒绝。
 *
 * 运行：npx --no-install vite-node scripts/test-anomaly-field-scope.mjs
 */
import {
  fixedEffect,
  makePanel,
  makePanelCtx,
  mindscapeWithEffects,
  testAgent,
} from './_effectPipelineHarness.mjs'
import { computeDamageResult } from '../src/utils/damageCalc.ts'
import { pickEventDamage, DAMAGE_EVENT_KIND_OPTIONS } from '../src/utils/damageEvent.ts'
import { computeFinalPanel } from '../src/utils/panelBuffCalc.ts'
import { BUFF_STAT_FIELDS, AGENT_BASE_PANEL_FIELDS } from '../src/utils/calculatorUi.ts'
import { AFFIX_PANEL_DELTA_FIELD_LABELS } from '../src/utils/affixLibrary.ts'
import { AFFIX_TARGET_BRANCH_GROUPS } from '../src/utils/affixTargetBranches.ts'
import { BUFF_DAMAGE_TYPE_GROUPS, SKILL_CATEGORY_OPTIONS } from '../src/types/calculator.ts'
import { findBuffStatZoneById, statRowsForZone } from '../src/utils/buffStatZones.ts'
import { buildSkillCalcZoneRows } from '../src/utils/skillCalcZones.ts'
import { buildAlignedAnomalyFormulaGroups } from '../src/utils/anomalyFormulaDisplay.ts'
import {
  detectScope,
  extractKeywordEffects,
  enforceSlotWhitelist,
  mapKeywordsToEffect,
  resolveStatField,
  SCOPE_OPTIONS,
  SCOPE_SLOT_TO_ID,
  STAT_OPTIONS,
} from '../../zzz-hp-backend/src/services/nanoka/nanokaBuffExtractor.js'
import { smartMergeParse } from '../../zzz-hp-backend/src/services/nanokaBuffService.js'

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

const enemy = {
  level: 60,
  defense: 953,
  resistanceType: 'normal',
  vulnerableMultiplier: 1,
  staggerMultiplier: 1,
  specialMultiplier: 1,
}

const remielSelf = {
  agentLevel: 60,
  inCombatAtk: 2500,
  inCombatMastery: 300,
  mutationZone: 1,
  penRate: 0,
  pen: 0,
  resPen: 0,
  radianceResPen: 0,
  radianceDmgBonus: 0,
  attributeAnomalyDmgBonus: 0,
  resistanceElement: null,
  isMb: false,
}

/** 五子类倍率与基础都非零，避免零伤害掩盖字段影响 */
const BASE_PANEL = {
  atk: 2000,
  mastery: 100,
  attributeAnomalyMult: 713,
  anomalyDuration: 10,
  disorderBaseMult: 450,
  disorderCompMult: 7.5,
  turbulenceBaseMult: 450,
  turbulenceCompMult: 7.5,
  radianceMult: 360,
  specialMult: 100,
  anomalyReleaseMult: 700,
}

const SUBKINDS = ['attributeAnomaly', 'turbulence', 'disorder', 'radiance', 'anomalyRelease']
const SUBKIND_LABELS = {
  attributeAnomaly: '属性异常',
  turbulence: '乱流',
  disorder: '紊乱',
  radiance: '耀变',
  anomalyRelease: '异放',
}
/** 子类 → stat 前缀（属性异常是 attributeAnomaly，其余与子类 id 同名） */
const STAT_PREFIX = {
  attributeAnomaly: 'attributeAnomaly',
  turbulence: 'turbulence',
  disorder: 'disorder',
  radiance: 'radiance',
  anomalyRelease: 'anomalyRelease',
}

function panelOf(overrides = {}) {
  return makePanel({ ...BASE_PANEL, ...overrides })
}

function run(kind, panelExtra = {}, inputExtra = {}) {
  const panel = panelOf(panelExtra)
  const subKind = SUBKINDS.includes(kind) ? kind : 'attributeAnomaly'
  return computeDamageResult({
    finalPanel: panel,
    piercePower: 3000,
    baseDamageSource: 'atk',
    isMbMainAgent: Boolean(inputExtra.isMbMainAgent),
    useSharpenFormula: Boolean(inputExtra.useSharpenFormula),
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: inputExtra.triggerFinalPanel ?? panel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: inputExtra.anomalyTriggerPanel ?? panel,
    anomalySubKind: subKind,
    eventDamageType: kind,
    eventCritMode: 'expected',
    ...inputExtra,
  })
}

const dmg = (kind, result) => pickEventDamage(result, kind, 'expected')
const zoneOf = (kind, result) => result[`${STAT_PREFIX[kind] ?? kind}DmgBonusZone`]

/* ===================== C1：正常增伤与跨子类边界 ===================== */
console.log('\n[C1] 属性异常增伤只影响属性异常子类')
{
  const zero = Object.fromEntries(SUBKINDS.map((kind) => [kind, dmg(kind, run(kind))]))
  const zeroDirect = {
    normal: dmg('direct', run('direct')),
    pierce: dmg('direct', run('direct', {}, { isMbMainAgent: true })),
    sharpen: dmg('sharpen', run('sharpen', {}, { useSharpenFormula: true })),
  }

  const withAttr = Object.fromEntries(SUBKINDS.map((kind) => [kind, run(kind, { attributeAnomalyDmgBonus: 30 })]))
  check('属性异常增伤区 = 1.3', withAttr.attributeAnomaly.attributeAnomalyDmgBonusZone === 1.3, `${withAttr.attributeAnomaly.attributeAnomalyDmgBonusZone}`)
  for (const kind of ['turbulence', 'disorder', 'radiance', 'anomalyRelease']) {
    check(
      `${SUBKIND_LABELS[kind]}增伤区仍为 1（不加属性异常增伤）`,
      zoneOf(kind, withAttr[kind]) === 1,
      `${zoneOf(kind, withAttr[kind])}`,
    )
    check(
      `${SUBKIND_LABELS[kind]}本事件最终伤害与基准相同`,
      dmg(kind, withAttr[kind]) === zero[kind],
      `${dmg(kind, withAttr[kind])} vs ${zero[kind]}`,
    )
  }
  check('属性异常本事件伤害上升', dmg('attributeAnomaly', withAttr.attributeAnomaly) > zero.attributeAnomaly, `${dmg('attributeAnomaly', withAttr.attributeAnomaly)} vs ${zero.attributeAnomaly}`)
  const directWithAttr = {
    normal: dmg('direct', run('direct', { attributeAnomalyDmgBonus: 30 })),
    pierce: dmg('direct', run('direct', { attributeAnomalyDmgBonus: 30 }, { isMbMainAgent: true })),
    sharpen: dmg('sharpen', run('sharpen', { attributeAnomalyDmgBonus: 30 }, { useSharpenFormula: true })),
  }
  check('直伤三类不受属性异常增伤影响', JSON.stringify(directWithAttr) === JSON.stringify(zeroDirect), JSON.stringify(directWithAttr))

  const mixed = Object.fromEntries(
    ['anomalyRelease', 'turbulence', 'radiance'].map((kind) => [
      kind,
      run(kind, {
        attributeAnomalyDmgBonus: 30,
        anomalyReleaseDmgBonus: 20,
        turbulenceDmgBonus: 20,
        radianceDmgBonus: 20,
      }),
    ]),
  )
  for (const kind of ['anomalyRelease', 'turbulence', 'radiance']) {
    check(
      `${SUBKIND_LABELS[kind]}增伤区 = 1.2（不是 1.5）`,
      zoneOf(kind, mixed[kind]) === 1.2,
      `${zoneOf(kind, mixed[kind])}`,
    )
  }
  // 展示侧：三类的增伤公式只出现自身字段，不出现属性异常增伤
  for (const kind of ['anomalyRelease', 'turbulence', 'radiance']) {
    const groups = buildAlignedAnomalyFormulaGroups(mixed[kind], kind, '紊乱伤害', String, String)
    const group = groups.find((item) => item.key === `${kind}Expected`)
    const text = (group?.terms ?? []).map((term) => `${term.label}=${term.value}`).join(' ')
    check(
      `${SUBKIND_LABELS[kind]}公式不含属性异常增伤`,
      !text.includes('属性异常增伤') && !text.includes('异常增伤区'),
      text,
    )
  }

  const disorderOnly = dmg('disorder', run('disorder', { disorderDmgBonus: 20 }))
  check('紊乱增伤区 0→20：区从 1 变 1.2', zoneOf('disorder', run('disorder', { disorderDmgBonus: 20 })) === 1.2)
  check('紊乱增伤上升', disorderOnly > zero.disorder, `${disorderOnly} vs ${zero.disorder}`)
  for (const kind of ['attributeAnomaly', 'turbulence', 'radiance', 'anomalyRelease']) {
    check(
      `紊乱增伤不影响 ${SUBKIND_LABELS[kind]}`,
      dmg(kind, run(kind, { disorderDmgBonus: 20 })) === zero[kind],
    )
  }
}

/* ===================== C2：15 字段 × 8 类伤害 ===================== */
console.log('\n[C2] 15 个字段 × 8 类伤害：只影响同子类')
{
  const columns = {
    normal: (ov) => ['direct', run('direct', ov)],
    pierce: (ov) => ['direct', run('direct', ov, { isMbMainAgent: true })],
    sharpen: (ov) => ['sharpen', run('sharpen', ov, { useSharpenFormula: true })],
    attributeAnomaly: (ov) => ['attributeAnomaly', run('attributeAnomaly', ov)],
    turbulence: (ov) => ['turbulence', run('turbulence', ov)],
    disorder: (ov) => ['disorder', run('disorder', ov)],
    radiance: (ov) => ['radiance', run('radiance', ov)],
    anomalyRelease: (ov) => ['anomalyRelease', run('anomalyRelease', ov)],
  }
  const baseline = Object.fromEntries(
    Object.entries(columns).map(([col, make]) => {
      const [kind, result] = make({})
      return [col, dmg(kind, result)]
    }),
  )
  check('8 类基准伤害均非零', Object.values(baseline).every((value) => value > 0), JSON.stringify(baseline))

  /** 15 个字段：每条给出「只应改变哪一列」的扰动 */
  const perturbations = [
    ...SUBKINDS.map((kind) => ({
      name: `${STAT_PREFIX[kind]}DmgBonus`,
      column: kind,
      patch: { [`${STAT_PREFIX[kind]}DmgBonus`]: 30 },
    })),
    ...SUBKINDS.map((kind) => ({
      // 暴击率列：同子类爆伤非零才看得出作用
      name: `${STAT_PREFIX[kind]}CritRate`,
      column: kind,
      patch: { [`${STAT_PREFIX[kind]}CritDmg`]: 50, [`${STAT_PREFIX[kind]}CritRate`]: 30 },
    })),
    ...SUBKINDS.map((kind) => ({
      // 爆伤列：同子类暴击率非零
      name: `${STAT_PREFIX[kind]}CritDmg`,
      column: kind,
      patch: { [`${STAT_PREFIX[kind]}CritRate`]: 20, [`${STAT_PREFIX[kind]}CritDmg`]: 150 },
    })),
  ]
  check('扰动共 15 条', perturbations.length === 15, `${perturbations.length}`)
  for (const item of perturbations) {
    const values = {}
    for (const [col, make] of Object.entries(columns)) {
      const [kind, result] = make(item.patch)
      values[col] = dmg(kind, result)
    }
    check(
      `${item.name} 改变 ${SUBKIND_LABELS[item.column] ?? item.column} 列`,
      values[item.column] !== baseline[item.column],
      `${values[item.column]} vs ${baseline[item.column]}`,
    )
    const others = Object.keys(columns).filter((col) => col !== item.column)
    const dirty = others.filter((col) => values[col] !== baseline[col])
    check(`${item.name} 不影响其他列`, dirty.length === 0, dirty.map((col) => `${col}:${values[col]}≠${baseline[col]}`).join(', '))
  }
}

/* ===================== C3：暴击边界 ===================== */
console.log('\n[C3] 子类暴击各自独立')
{
  for (const kind of SUBKINDS) {
    const prefix = STAT_PREFIX[kind]
    const own = run(kind, { [`${prefix}CritRate`]: 20, [`${prefix}CritDmg`]: 50 })
    check(
      `${SUBKIND_LABELS[kind]}：区 1.1 / 不暴击 1 / 必暴 1.5`,
      own[`${prefix}CritZone`] === 1.1 &&
        pickEventDamage(own, kind, 'noCrit') === own[`${prefix}ExpectedNoCrit`] &&
        own[`${prefix}FullCritZone`] === 1.5,
      `${own[`${prefix}CritZone`]} / ${own[`${prefix}FullCritZone`]}`,
    )
  }
  for (const kind of ['turbulence', 'disorder', 'radiance', 'anomalyRelease']) {
    const prefix = STAT_PREFIX[kind]
    const r = run(kind, {
      [`${prefix}CritRate`]: 20,
      [`${prefix}CritDmg`]: 50,
      attributeAnomalyCritRate: 80,
      attributeAnomalyCritDmg: 150,
    })
    check(
      `${SUBKIND_LABELS[kind]}：属性异常暴击 80/150 不叠加`,
      r[`${prefix}CritZone`] === 1.1 && r[`${prefix}FullCritZone`] === 1.5,
      `${r[`${prefix}CritZone`]} / ${r[`${prefix}FullCritZone`]}`,
    )
  }
  const anomaly = run('attributeAnomaly', { attributeAnomalyCritRate: 20, attributeAnomalyCritDmg: 50 })
  check('属性异常自己的暴击区 = 1.1', anomaly.attributeAnomalyCritZone === 1.1, `${anomaly.attributeAnomalyCritZone}`)
}

/* ===================== C4：消费记录 ===================== */
console.log('\n[C4] 消费记录：属性异常增伤只由属性异常事件报告')
{
  const overrides = {
    attributeAnomalyDmgBonus: 30,
    anomalyReleaseDmgBonus: 20,
    turbulenceDmgBonus: 20,
    radianceDmgBonus: 20,
    disorderDmgBonus: 20,
  }
  for (const kind of SUBKINDS) {
    const used = []
    const result = run(kind, overrides, { onInputUsed: (item) => used.push(item) })
    const reports = used.some((item) => item.field === 'attributeAnomalyDmgBonus')
    const ownField = `${STAT_PREFIX[kind]}DmgBonus`
    check(
      `${SUBKIND_LABELS[kind]}事件${kind === 'attributeAnomaly' ? '记录' : '不记录'}属性异常增伤`,
      kind === 'attributeAnomaly' ? reports : !reports,
      used.filter((item) => String(item.field).includes('DmgBonus')).map((item) => item.field).join(','),
    )
    check(`${SUBKIND_LABELS[kind]}事件记录自身增伤字段`, used.some((item) => item.field === ownField), ownField)
    check(`${SUBKIND_LABELS[kind]}事件伤害可算`, dmg(kind, result) > 0, `${dmg(kind, result)}`)
  }
  // 消费记录的 KEY 都是新名
  const allFields = new Set()
  for (const kind of SUBKINDS) {
    run(kind, overrides, { onInputUsed: (item) => allFields.add(item.field) })
  }
  const legacyFields = [...allFields].filter((field) => /^anomaly(DmgBonus|CritRate|CritDmg|Mult|MultFactor)$/.test(String(field)))
  check('消费记录不含旧字段名', legacyFields.length === 0, legacyFields.join(','))
}

/* ===================== C5：中文与不变项 ===================== */
console.log('\n[C5] 中文名与不变项')
{
  const buffLabel = (key) => BUFF_STAT_FIELDS.find((field) => field.key === key)
  const expectBuff = [
    ['attributeAnomalyDmgBonus', '属性异常增伤'],
    ['attributeAnomalyCritRate', '属性异常暴击'],
    ['attributeAnomalyCritDmg', '属性异常爆伤'],
    ['attributeAnomalyMult', '属性异常倍率提升'],
    ['attributeAnomalyMultFactor', '属性异常倍率修正'],
  ]
  for (const [key, label] of expectBuff) {
    check(`增益字段标签 ${key} = ${label}`, buffLabel(key)?.label === label, `${buffLabel(key)?.label}`)
  }
  for (const key of ['attributeAnomalyDmgBonus', 'attributeAnomalyCritRate', 'attributeAnomalyCritDmg', 'attributeAnomalyMult']) {
    check(`${key} 的 hint 说明仅属性异常`, String(buffLabel(key)?.hint ?? '').includes('仅属性异常'), String(buffLabel(key)?.hint ?? ''))
  }
  check('异放/乱流/耀变 hint 不再说与（属性）异常增伤相加', ['radianceDmgBonus', 'turbulenceDmgBonus', 'anomalyReleaseDmgBonus'].every((key) => {
    const hint = String(buffLabel(key)?.hint ?? '')
    return !hint.includes('异常增伤加算') && !hint.includes('综合增伤')
  }))

  const expectAffix = [
    ['attributeAnomalyDmgBonus', '属性异常增伤%'],
    ['attributeAnomalyCritRate', '属性异常暴击率%'],
    ['attributeAnomalyCritDmg', '属性异常暴击伤害%'],
  ]
  for (const [key, label] of expectAffix) {
    check(`词条标签 ${key} = ${label}`, AFFIX_PANEL_DELTA_FIELD_LABELS[key] === label, `${AFFIX_PANEL_DELTA_FIELD_LABELS[key]}`)
  }

  const baseLabel = (key) => AGENT_BASE_PANEL_FIELDS.find((field) => field.key === key)
  const expectBase = [
    ['attributeAnomalyDmgBonus', '初始属性异常增伤'],
    ['attributeAnomalyCritRate', '初始属性异常暴击'],
    ['attributeAnomalyCritDmg', '初始属性异常爆伤'],
    ['attributeAnomalyMult', '初始属性异常倍率'],
  ]
  for (const [key, label] of expectBase) {
    check(`初始面板标签 ${key} = ${label}`, baseLabel(key)?.label === label, `${baseLabel(key)?.label}`)
  }
  check('不新增初始面板字段 attributeAnomalyMultFactor', baseLabel('attributeAnomalyMultFactor') === undefined)

  // F05 区名
  const zoneRow = (kind, label) =>
    buildSkillCalcZoneRows(
      run(kind, {
        attributeAnomalyDmgBonus: 30,
        anomalyReleaseDmgBonus: 20,
        turbulenceDmgBonus: 20,
        radianceDmgBonus: 20,
        disorderDmgBonus: 20,
      }),
      kind,
    ).some((row) => row.label === label)
  check('属性异常增伤区', zoneRow('attributeAnomaly', '属性异常增伤区'))
  check('属性异常倍率区', zoneRow('attributeAnomaly', '属性异常倍率区'))
  check('属性异常暴击区（有暴击时）', buildSkillCalcZoneRows(run('attributeAnomaly', { attributeAnomalyCritRate: 100, attributeAnomalyCritDmg: 50 }), 'attributeAnomaly').some((row) => row.label === '属性异常暴击区'))
  check('异放增伤区', zoneRow('anomalyRelease', '异放增伤区'))
  check('乱流增伤区', zoneRow('turbulence', '乱流增伤区'))
  check('耀变增伤区', zoneRow('radiance', '耀变增伤区'))
  check('不再出现「乱流增伤区+异常增伤区」', !buildSkillCalcZoneRows(run('turbulence'), 'turbulence').some((row) => row.label.includes('+')))
  check('不再出现「综合增伤区」', !['turbulence', 'anomalyRelease', 'radiance'].some((kind) => buildSkillCalcZoneRows(run(kind), kind).some((row) => row.label.includes('综合增伤区'))))

  // F11 小节名：类型标签
  check('伤害类型选项里属性异常标签 = 属性异常', DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === 'attributeAnomaly')?.label === '属性异常')
  check('不再有 id=anomaly 的类型选项', !DAMAGE_EVENT_KIND_OPTIONS.some((item) => item.id === 'anomaly'))
  check('异常类分组 id = anomalyClass', BUFF_DAMAGE_TYPE_GROUPS.find((group) => group.label === '异常类')?.id === 'anomalyClass')
  check('异常类分组顺序：直伤 3 + 异常 5', BUFF_DAMAGE_TYPE_GROUPS.length === 2 && BUFF_DAMAGE_TYPE_GROUPS[1].types.length === 5)
  check('词条目标分组「异放」', AFFIX_TARGET_BRANCH_GROUPS.some((group) => group.label === '异放') && !AFFIX_TARGET_BRANCH_GROUPS.some((group) => group.label === '异常放'))

  // §3.3 保留项
  check('类级行仍叫「异常类增伤」', findBuffStatZoneById('zone:anomalyDmg')?.label === '异常类增伤', findBuffStatZoneById('zone:anomalyDmg')?.label)
  check('类级行仍叫「异常类暴击率」', findBuffStatZoneById('zone:attributeAnomalyCritRate')?.label === '异常类暴击率')
  check('类级行仍叫「异常类爆伤」', findBuffStatZoneById('zone:attributeAnomalyCritDmg')?.label === '异常类爆伤')
  check('保留「初始异常持续时间」', baseLabel('anomalyDuration')?.label === '初始异常持续时间')
  check('保留「异常掌控」', baseLabel('anomalyControl')?.label === '初始异常掌控')
  check('保留「非直伤易伤」标签', buffLabel('anomalyVulnerable')?.label !== undefined)
  // 所有者 2026-11-01：增益显示要能看出是哪一种易伤（通用 / 直伤 / 非直伤），不能只写「易伤」
  check('通用易伤字段标签写明「通用易伤」', buffLabel('vulnerable')?.label === '通用易伤', buffLabel('vulnerable')?.label)
  check('三个易伤字段标签互不相同', new Set(['vulnerable', 'directVulnerable', 'anomalyVulnerable'].map((key) => buffLabel(key)?.label)).size === 3)

  // statRowsForZone：空选择 → 5 条；只选属性异常+紊乱 → 2 条
  const dmgZone = findBuffStatZoneById('zone:anomalyDmg')
  const all = statRowsForZone(dmgZone, [])
  check('空类型选择生成 5 条子类增伤字段', all.length === 5 && all.map((row) => row.stat).join(',') === 'attributeAnomalyDmgBonus,turbulenceDmgBonus,disorderDmgBonus,radianceDmgBonus,anomalyReleaseDmgBonus', all.map((row) => row.stat).join(','))
  const two = statRowsForZone(dmgZone, ['attributeAnomaly', 'disorder'])
  check('只选属性异常+紊乱生成 2 条', two.length === 2 && two[0].stat === 'attributeAnomalyDmgBonus' && two[1].stat === 'disorderDmgBonus', two.map((row) => row.stat).join(','))
  check('类级行仍显示「异常类增伤」', dmgZone.label === '异常类增伤')

  // B01：新槽位值可解析、映射到新 stat
  for (const [slot, stat] of [
    ['属性异常增伤', 'attributeAnomalyDmgBonus'],
    ['属性异常暴击率', 'attributeAnomalyCritRate'],
    ['属性异常暴击伤害', 'attributeAnomalyCritDmg'],
  ]) {
    check(`B01 槽位「${slot}」在选项里`, STAT_OPTIONS.includes(slot), slot)
    check(`B01 resolveStatField「${slot}」→ ${stat}`, resolveStatField({ stat: slot, action: '提升', unit: '%' }) === stat, resolveStatField({ stat: slot, action: '提升', unit: '%' }))
  }
  check('B01 作用域选项为「属性异常」', SCOPE_OPTIONS.includes('属性异常') && !SCOPE_OPTIONS.includes('异常'))
  check('B01 detectScope 产出「属性异常」槽位值', detectScope('仅对属性异常伤害生效') === '属性异常', detectScope('仅对属性异常伤害生效'))
  check('B01 作用域槽位值映射到 attributeAnomaly', SCOPE_SLOT_TO_ID['属性异常'] === 'attributeAnomaly', SCOPE_SLOT_TO_ID['属性异常'])
  check('B01 字典里不再有旧槽位', !STAT_OPTIONS.includes('异常增伤') && !STAT_OPTIONS.includes('异常暴击率') && !STAT_OPTIONS.includes('异常暴击伤害'))

  // 原文解析：原文逐字不变，产出的槽位是新值
  const rawCases = [
    ['自身造成的属性异常伤害提升30%', '属性异常增伤', 'attributeAnomalyDmgBonus', 30],
    ['属性异常伤害的暴击率提升20%', '属性异常暴击率', 'attributeAnomalyCritRate', 20],
    ['属性异常伤害的暴击伤害提升50%', '属性异常暴击伤害', 'attributeAnomalyCritDmg', 50],
  ]
  for (const [text, slot, stat, value] of rawCases) {
    const { effects } = extractKeywordEffects({ text })
    const slots = effects[0]?.slots
    const mapped = mapKeywordsToEffect({ slots })
    check(`解析「${text}」→ 槽位 ${slot}`, slots?.stat === slot, `${slots?.stat}`)
    check(`解析「${text}」→ ${stat}=${value}`, mapped.ok && mapped.effect?.stat === stat && mapped.effect?.value === value, JSON.stringify({ ok: mapped.ok, stat: mapped.effect?.stat, value: mapped.effect?.value }))
  }

  // 旧槽位值必须被拒绝
  for (const oldSlot of ['异常增伤', '异常暴击率', '异常暴击伤害']) {
    const slots = {
      stat: oldSlot,
      elements: ['无'],
      action: '提升',
      value: 30,
      unit: '%',
      target: '全队',
      conditions: ['无'],
      scope: '无',
      stacks: '无',
      duration: '无',
      object: '无',
    }
    check(`resolveStatField 拒绝旧槽位「${oldSlot}」`, resolveStatField({ stat: oldSlot, action: '提升', unit: '%' }) === '', oldSlot)
    const mapped = mapKeywordsToEffect({ slots })
    check(`mapKeywordsToEffect 拒绝旧槽位「${oldSlot}」`, mapped.ok === false && mapped.effect === null, `${mapped.ok}`)
    const whitelisted = enforceSlotWhitelist({ ...slots })
    check(`白名单把旧槽位「${oldSlot}」标成无法提取`, whitelisted.slots.stat === '无法提取' && whitelisted.violations.some((item) => item.slot === 'stat'), JSON.stringify(whitelisted.slips ?? whitelisted.slots.stat))
    const merged = smartMergeParse({ rows: [{ key: 'k', effect: {} }], keywords: [{ key: 'k', slots }] })
    check(`smartMergeParse 把旧槽位「${oldSlot}」标为待补/阻断`, merged.rows[0]?.blocked === true || merged.blocked > 0, JSON.stringify(merged.rows[0]?.blockReason ?? ''))
    // 附带合法原文也不能让旧槽位被接受
    const { effects } = extractKeywordEffects({ text: '自身造成的属性异常伤害提升30%' })
    const withRaw = mapKeywordsToEffect({ slots: { ...effects[0]?.slots, stat: oldSlot }, text: '自身造成的属性异常伤害提升30%' })
    check(`附带原文不能让旧槽位「${oldSlot}」被接受`, withRaw.ok === false && withRaw.effect === null, `${withRaw.ok}`)
  }
}

/* ===================== C7：面板来源、耀变分支、倍率隔离、类级集成 ===================== */
console.log('\n[C7] 面板来源 / 耀变分支 / 倍率隔离 / 类级集成')
{
  const ownerPanel = panelOf({ attributeAnomalyDmgBonus: 10, turbulenceDmgBonus: 10, disorderDmgBonus: 10, radianceDmgBonus: 10, anomalyReleaseDmgBonus: 10 })
  const powerPanel = panelOf({ attributeAnomalyDmgBonus: 20, turbulenceDmgBonus: 20, disorderDmgBonus: 20, radianceDmgBonus: 20, anomalyReleaseDmgBonus: 20 })
  const triggerPanel = panelOf({ attributeAnomalyDmgBonus: 30, turbulenceDmgBonus: 30, disorderDmgBonus: 30, radianceDmgBonus: 30, anomalyReleaseDmgBonus: 30 })
  const routingInput = {
    piercePower: 3000,
    baseDamageSource: 'atk',
    isMbMainAgent: false,
    enemyInput: enemy,
    combatVulnerable: 0,
    combatStaggerVulnerable: 0,
    combatSpecial: 0,
    staggerPhase: 'normal',
    ownerAgentLevel: 60,
    triggerFinalPanel: powerPanel,
    triggerAgentLevel: 60,
    anomalyTriggerPanel: triggerPanel,
    eventCritMode: 'expected',
  }
  for (const kind of SUBKINDS) {
    const used = []
    const result = computeDamageResult({
      ...routingInput,
      finalPanel: ownerPanel,
      anomalySubKind: kind,
      eventDamageType: kind,
      onInputUsed: (item) => used.push(item),
    })
    check(`${SUBKIND_LABELS[kind]}增伤区取触发者面板 → 1.3`, zoneOf(kind, result) === 1.3, `${zoneOf(kind, result)}`)
    check(
      `${SUBKIND_LABELS[kind]}消费记录指向 anomalyTriggerPanel 的自身子类字段`,
      used.some((item) => item.field === `${STAT_PREFIX[kind]}DmgBonus` && item.inputKey === 'anomalyTriggerPanel'),
      used.filter((item) => String(item.field).includes('DmgBonus')).map((item) => `${item.inputKey}:${item.field}`).join(','),
    )
  }
  // 只改另外两份面板的子类增伤，各事件伤害不变
  const baseDamages = Object.fromEntries(
    SUBKINDS.map((kind) => [
      kind,
      dmg(
        kind,
        computeDamageResult({ ...routingInput, finalPanel: ownerPanel, anomalySubKind: kind, eventDamageType: kind }),
      ),
    ]),
  )
  for (const kind of SUBKINDS) {
    const changed = computeDamageResult({
      ...routingInput,
      finalPanel: panelOf({ attributeAnomalyDmgBonus: 90, turbulenceDmgBonus: 90, disorderDmgBonus: 90, radianceDmgBonus: 90, anomalyReleaseDmgBonus: 90 }),
      triggerFinalPanel: panelOf({ attributeAnomalyDmgBonus: 90, turbulenceDmgBonus: 90, disorderDmgBonus: 90, radianceDmgBonus: 90, anomalyReleaseDmgBonus: 90 }),
      anomalyTriggerPanel: triggerPanel,
      anomalySubKind: kind,
      eventDamageType: kind,
    })
    check(`${SUBKIND_LABELS[kind]}伤害不受持有者/强度面板子类增伤影响`, dmg(kind, changed) === baseDamages[kind], `${dmg(kind, changed)} vs ${baseDamages[kind]}`)
  }

  // 耀变：普通链与本人链的增伤区都只含耀变增伤
  for (const [name, extra] of [
    ['普通耀变', {}],
    ['蕾米本人耀变', { remielSelfRadianceCalc: remielSelf }],
  ]) {
    const input = {
      ...routingInput,
      finalPanel: panelOf(),
      triggerFinalPanel: panelOf(),
      anomalyTriggerPanel: panelOf({ attributeAnomalyDmgBonus: 30, radianceDmgBonus: 20 }),
      anomalySubKind: 'radiance',
      eventDamageType: 'radiance',
      ...extra,
    }
    const withAttr = computeDamageResult(input)
    const used = []
    const withoutAttr = computeDamageResult({
      ...input,
      anomalyTriggerPanel: panelOf({ attributeAnomalyDmgBonus: 0, radianceDmgBonus: 20 }),
      onInputUsed: (item) => used.push(item),
    })
    check(`${name}：耀变增伤区 = 1.2`, withAttr.radianceDmgBonusZone === 1.2, `${withAttr.radianceDmgBonusZone}`)
    check(`${name}：属性异常增伤 30→0 不改变耀变伤害`, withAttr.radianceExpected === withoutAttr.radianceExpected, `${withAttr.radianceExpected} vs ${withoutAttr.radianceExpected}`)
    check(`${name}：不报告属性异常增伤参与`, !used.some((item) => item.field === 'attributeAnomalyDmgBonus'), used.filter((item) => String(item.field).includes('DmgBonus')).map((item) => item.field).join(','))
  }

  // 倍率隔离：属性异常倍率只影响属性异常
  const multBase = Object.fromEntries(SUBKINDS.map((kind) => [kind, dmg(kind, run(kind, { attributeAnomalyMult: 100, attributeAnomalyMultFactor: 100 }))]))
  const multDouble = Object.fromEntries(SUBKINDS.map((kind) => [kind, run(kind, { attributeAnomalyMult: 200, attributeAnomalyMultFactor: 100 })]))
  check('属性异常倍率区 1 → 2', multDouble.attributeAnomaly.attributeAnomalyMultZone === 2, `${multDouble.attributeAnomaly.attributeAnomalyMultZone}`)
  check('属性异常伤害随之翻倍', dmg('attributeAnomaly', multDouble.attributeAnomaly) === multBase.attributeAnomaly * 2, `${dmg('attributeAnomaly', multDouble.attributeAnomaly)} vs ${multBase.attributeAnomaly * 2}`)
  for (const kind of ['turbulence', 'disorder', 'radiance', 'anomalyRelease']) {
    check(`属性异常倍率不影响${SUBKIND_LABELS[kind]}`, dmg(kind, multDouble[kind]) === multBase[kind], `${dmg(kind, multDouble[kind])} vs ${multBase[kind]}`)
  }
  const directBase = {
    normal: dmg('direct', run('direct', { attributeAnomalyMult: 100, attributeAnomalyMultFactor: 100 })),
    pierce: dmg('direct', run('direct', { attributeAnomalyMult: 100, attributeAnomalyMultFactor: 100 }, { isMbMainAgent: true })),
    sharpen: dmg('sharpen', run('sharpen', { attributeAnomalyMult: 100, attributeAnomalyMultFactor: 100 }, { useSharpenFormula: true })),
  }
  const directDouble = {
    normal: dmg('direct', run('direct', { attributeAnomalyMult: 200, attributeAnomalyMultFactor: 100 })),
    pierce: dmg('direct', run('direct', { attributeAnomalyMult: 200, attributeAnomalyMultFactor: 100 }, { isMbMainAgent: true })),
    sharpen: dmg('sharpen', run('sharpen', { attributeAnomalyMult: 200, attributeAnomalyMultFactor: 100 }, { useSharpenFormula: true })),
  }
  check('属性异常倍率不影响直伤三类', JSON.stringify(directBase) === JSON.stringify(directDouble), JSON.stringify(directDouble))

  // 类级集成：一行「异常类增伤」→ statRowsForZone → 正式面板聚合 → 结算
  const zoneDmg = findBuffStatZoneById('zone:anomalyDmg')
  for (const [name, selected, expectZone, expectOthers] of [
    ['空选择：五子类各 1.3', [], 1.3, 1.3],
    ['只选属性异常+紊乱', ['attributeAnomaly', 'disorder'], 1.3, 1],
  ]) {
    const rows = statRowsForZone(zoneDmg, selected)
    const effects = rows.map((row, index) => fixedEffect(`eff-${index}`, row.stat, 30))
    const ctx = makePanelCtx({
      agents: [testAgent('a', { mindscapeBuffs: mindscapeWithEffects(effects) })],
    })
    const finalPanel = computeFinalPanel(panelOf({ attributeAnomalyDmgBonus: 0, turbulenceDmgBonus: 0, disorderDmgBonus: 0, radianceDmgBonus: 0, anomalyReleaseDmgBonus: 0 }), ctx).finalPanel
    for (const kind of SUBKINDS) {
      const hit = computeDamageResult({
        ...routingInput,
        finalPanel,
        triggerFinalPanel: finalPanel,
        anomalyTriggerPanel: finalPanel,
        anomalySubKind: kind,
        eventDamageType: kind,
      })
      const expected = kind === 'attributeAnomaly' || (name.startsWith('只选') && kind === 'disorder') ? expectZone : expectOthers
      check(`类级集成（${name}）${SUBKIND_LABELS[kind]}增伤区 = ${expected}`, zoneOf(kind, hit) === expected, `${zoneOf(kind, hit)}`)
    }
    for (const [col, extra] of [['normal', {}], ['pierce', { isMbMainAgent: true }], ['sharpen', { useSharpenFormula: true }]]) {
      const withRow = computeDamageResult({ ...routingInput, finalPanel, triggerFinalPanel: finalPanel, anomalyTriggerPanel: finalPanel, ...extra })
      const withoutRow = computeDamageResult({ ...routingInput, finalPanel: panelOf(), triggerFinalPanel: panelOf(), anomalyTriggerPanel: panelOf(), ...extra })
      check(
        `类级集成（${name}）直伤 ${col} 不变`,
        dmg(col === 'sharpen' ? 'sharpen' : 'direct', withRow) === dmg(col === 'sharpen' ? 'sharpen' : 'direct', withoutRow),
      )
    }
  }
}

console.log(`\n${failed ? `❌ ${failed} failed, ${passed} passed` : `✅ all passed（${passed}）`}`)
if (failed) process.exit(1)
