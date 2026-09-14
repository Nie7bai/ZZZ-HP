/**
 * 阶段 6：额外增益走 BuffEffect 适配器，与旧摊平逐字段双跑。
 * 运行：npx vite-node scripts/test-extra-gain-effect-adapt.mjs
 */
import { createEmptyBuffStatModifiers } from '../src/utils/calculatorUi.ts'
import {
  mergeExtraModsForEventDirect,
  mergeExtraModsViaEffects,
  extraGainToEffect,
} from '../src/utils/extraBuffCalc.ts'
import { collectAllBuffEffects, collectExtraGainEffects } from '../src/utils/panelBuffCalc.ts'
import { adaptAffixLibraryEntry, adaptBuffEffect } from '../src/utils/effectAdapters.ts'
import { applyAllocatedAffixEffects } from '../src/utils/panelPipeline.ts'
import {
  dummyBangboo,
  makePanel,
  makePanelCtx,
  testAgent,
  testSlot,
} from './_effectPipelineHarness.mjs'

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

function skillCtx(categoryId, extra = {}) {
  return {
    damageKind: 'direct',
    categoryId,
    subcategoryId: null,
    coords: [{ category: categoryId, subcategoryId: null }],
    element: '电',
    staggerPhase: 'stagger',
    isFollowUp: false,
    ...extra,
  }
}

function gain(partial) {
  return {
    id: partial.id ?? 'g',
    name: partial.name ?? '测',
    stat: partial.stat ?? 'dmgBonus',
    value: partial.value ?? 15,
    applySituation: partial.applySituation ?? 'global',
    scope: partial.scope ?? 'general',
    applyTarget: partial.applyTarget ?? 'self',
    applySlot: partial.applySlot ?? 0,
    ...partial,
  }
}

const agents = [
  testAgent('a', { profession: '强攻', name: '甲' }),
  testAgent('b', { profession: '支援', name: '乙' }),
]
const teamSlots = [testSlot('a'), testSlot('b')]

function opts(slotIndex, extra = {}) {
  return {
    slotIndex,
    slotAgentId: teamSlots[slotIndex].agentId,
    staggerPhase: extra.staggerPhase ?? 'stagger',
    resolveAgentProfession: (id) => agents.find((item) => item.id === id)?.profession,
    teamSlots,
    agents,
    ...extra,
  }
}

function sameMods(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (Math.abs((a[key] ?? 0) - (b[key] ?? 0)) > 1e-9) return `${key}: ${a[key]} vs ${b[key]}`
  }
  return null
}

function dual(name, gains, ctx, options) {
  const direct = mergeExtraModsForEventDirect(gains, ctx, options)
  const via = mergeExtraModsViaEffects(gains, ctx, options)
  const diff = sameMods(direct, via)
  check(name, diff == null, diff || JSON.stringify({ dmgBonus: via.dmgBonus, atk: via.atk, inCombatAtkPercent: via.inCombatAtkPercent }))
  return { direct, via }
}

console.log('\n[1] 通用 / 招式限定 / 槽位 / 全队')
{
  const c1 = dual(
    'C1 风格穿透率 +24',
    [gain({ id: 'c1', stat: 'penRate', value: 24 })],
    skillCtx('basic'),
    opts(0),
  )
  check('穿透率为 24', (c1.via.penRate ?? 0) === 24, `${c1.via.penRate}`)
  const global = dual('全局 +15 增伤', [gain({ value: 15 })], skillCtx('basic'), opts(0))
  check('全局增伤为 15', (global.via.dmgBonus ?? 0) === 15, `${global.via.dmgBonus}`)
  dual(
    '普攻限定只吃普攻',
    [gain({ scope: 'skill', skillCategory: 'basic', value: 15 })],
    skillCtx('basic'),
    opts(0),
  )
  const ult = dual(
    '普攻限定不吃终结技',
    [gain({ scope: 'skill', skillCategory: 'basic', value: 15 })],
    skillCtx('ultimate'),
    opts(0),
  )
  check('终结技增伤为 0', (ult.via.dmgBonus ?? 0) === 0, `${ult.via.dmgBonus}`)

  dual('槽位 0 吃自己的', [gain({ applySlot: 0, value: 10 })], skillCtx('basic'), opts(0))
  const other = dual('槽位 1 不吃槽位 0 的', [gain({ applySlot: 0, value: 10 })], skillCtx('basic'), opts(1))
  check('槽位 1 增伤为 0', (other.via.dmgBonus ?? 0) === 0)

  dual('全队两条槽都吃', [gain({ applySlot: 'team', applyTarget: 'team', value: 8 })], skillCtx('basic'), opts(1))
}

console.log('\n[2] 失衡 / 职业 / 队内人数')
{
  const staggerOn = dual(
    '失衡限定·失衡期',
    [gain({ applySituation: 'stagger', stat: 'critRate', value: 20 })],
    skillCtx('basic', { staggerPhase: 'stagger' }),
    opts(0, { staggerPhase: 'stagger' }),
  )
  check('失衡期暴击为 20', (staggerOn.via.critRate ?? 0) === 20, `${staggerOn.via.critRate}`)
  const normal = dual(
    '失衡限定·非失衡',
    [gain({ applySituation: 'stagger', stat: 'critRate', value: 20 })],
    skillCtx('basic', { staggerPhase: 'normal' }),
    opts(0, { staggerPhase: 'normal' }),
  )
  check('非失衡暴击为 0', (normal.via.critRate ?? 0) === 0)

  dual(
    '职业匹配强攻',
    [gain({ applyProfession: '强攻', stat: 'atk', value: 50 })],
    skillCtx('basic'),
    opts(0),
  )
  const mismatch = dual(
    '职业不匹配支援槽',
    [gain({ applyProfession: '强攻', stat: 'atk', value: 50 })],
    skillCtx('basic'),
    opts(1),
  )
  check('支援槽固定攻击为 0', (mismatch.via.atk ?? 0) === 0)

  dual(
    '队内至少 1 名强攻',
    [gain({ teamProfession: '强攻', teamProfessionValues: [1, 2, 3], stat: 'dmgBonus', value: 12 })],
    skillCtx('basic'),
    opts(0),
  )
}

console.log('\n[3] 适配器与 collectAllBuffEffects')
{
  const fx = extraGainToEffect(gain({ id: 'eg1', scope: 'skill', skillCategory: 'basic', value: 15 }))
  const spec = adaptBuffEffect(fx)
  check('stage=combatPreConvert', spec.stage === 'combatPreConvert')
  check('招式条件进 spec', spec.conditions.skillTargets?.[0]?.category === 'basic')
  check('enabledDefault 为 true', fx.enabledDefault === true)

  const ctx = makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [testAgent('a')],
    bangboo: dummyBangboo(),
    extraGains: [gain({ id: 'eg1', value: 15 })],
  })
  const collected = collectAllBuffEffects(ctx)
  check(
    'collectAllBuffEffects 不含额外增益（避免异放双算）',
    !collected.some((item) => item.effect.id === 'eg1'),
    collected.map((item) => item.effect.id).join(','),
  )
  const extraCollected = collectExtraGainEffects(ctx)
  check(
    'collectExtraGainEffects 含额外增益',
    extraCollected.some((item) => item.effect.id === 'eg1'),
    extraCollected.map((item) => item.effect.id).join(','),
  )

  const allocated = [adaptAffixLibraryEntry(
    {
      id: 'basic-gain',
      label: '普攻增伤',
      target: 'gain:dmgBonus',
      perRoll: 15,
      cap: 0,
      group: '',
      rollCost: 1,
      enabledByDefault: true,
      scope: 'skill',
      skillCategory: 'basic',
      appliesToAnomaly: false,
    },
    1,
  )].filter(Boolean)
  const applied = applyAllocatedAffixEffects(makePanel(), allocated, {}, 0)
  check('词条 gain 条件抄进 extraGains', applied.extraGains[0]?.skillCategory === 'basic')
  check('词条 gain 作用域为招式', applied.extraGains[0]?.scope === 'skill')
}

console.log('\n[4] 空 mods 形状')
{
  const empty = createEmptyBuffStatModifiers()
  const via = mergeExtraModsViaEffects([], skillCtx('basic'), opts(0))
  check('无增益时与空表同构', sameMods(empty, via) == null)
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
