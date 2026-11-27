/**
 * 行级增益例外（按流程行禁用增益）的守卫测试。
 *
 * 三件事必须钉住：
 * 1. **展开器**：块禁用 → 该块下所有效果；单条禁用 → 该条；空 → null（调用方据此零开销跳过）
 * 2. **指纹**：`buffOverride` 必须进结算记忆表的键 —— 否则两行会互相命中对方的缓存，
 *    数字看着像对的但是错的，且不会有任何报错
 * 3. **归一**：缺省与显式 null 等价（老数据零迁移）
 *
 * 运行：npx vite-node scripts/test-buff-row-override.mjs
 */
import {
  expandBuffOverrideToEffectIds,
  formatBuffEffectResultText,
  resolveEffectsToMods,
} from '../src/utils/buffEffect.ts'
import { availableBuffGroupTabs, rowBuffSelectionOverlay } from '../src/utils/panelBuffCalc.ts'
import {
  effectiveRowOverride,
  mergeFlowBuffOverride,
  ownRowOverride,
  setFlowBuffEffectDisabled,
} from '../src/utils/flowBuffTable.ts'
import { buildHitEvalFingerprint } from '../src/utils/hitEvalCache.ts'
import { formatCalcSigned } from '../src/utils/calcNumberFormat.ts'
import { resolveFlow } from '../src/utils/resolvedHit.ts'

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` —— ${detail}` : ''}`)
  }
}

function sorted(set) {
  return set ? [...set].sort().join(',') : 'null'
}

console.log('=== 1. 展开器 expandBuffOverrideToEffectIds ===')

const items = [
  { effect: { id: 'e1' }, blockKey: 'src-a-b1' },
  { effect: { id: 'e2' }, blockKey: 'src-a-b1' },
  { effect: { id: 'e3' }, blockKey: 'src-b-b2' },
]

check(
  '块禁用 → 展开成该块下全部效果',
  sorted(expandBuffOverrideToEffectIds({ disabledBlockIds: ['src-a-b1'] }, items)) === 'e1,e2',
  sorted(expandBuffOverrideToEffectIds({ disabledBlockIds: ['src-a-b1'] }, items)),
)

check(
  '单条禁用 → 只有该条',
  sorted(expandBuffOverrideToEffectIds({ disabledEffectIds: ['e3'] }, items)) === 'e3',
)

check(
  '块 + 单条混合 → 并集',
  sorted(
    expandBuffOverrideToEffectIds({ disabledBlockIds: ['src-b-b2'], disabledEffectIds: ['e1'] }, items),
  ) === 'e1,e3',
)

check('缺省（undefined）→ null', expandBuffOverrideToEffectIds(undefined, items) === null)
check('空对象 → null', expandBuffOverrideToEffectIds({}, items) === null)
check(
  '禁用了不存在的 id → null（调用方零开销跳过）',
  expandBuffOverrideToEffectIds({ disabledEffectIds: ['nope'] }, items) === null,
)
check(
  '没给 blockKey 的条目不会被块禁用误伤',
  sorted(expandBuffOverrideToEffectIds({ disabledBlockIds: ['src-a-b1'] }, [{ effect: { id: 'x' } }])) ===
    'null',
)

console.log('=== 2. 结算指纹必须随行级例外变化 ===')

const testSkill = {
  id: 'dev-1',
  name: '测试招式',
  agentId: 'velina',
  source: 'preset',
  damageType: 'attributeAnomaly',
  baseMult: 100,
  skillTypes: [],
  buffAnchorId: null,
}
const { hits: [baseHit] } = resolveFlow({
  slots: [{
    prepared: [{
      id: 'prepared-1',
      skillId: testSkill.id,
      anomalyPowerAgentId: 'piper',
      triggerAgentId: 'remiel',
    }],
    flow: [{ id: 'flow-1', preparedId: 'prepared-1', count: 3, staggerPhase: 'stagger' }],
  }],
  teamSlots: [{ agentId: testSkill.agentId }],
  findSkill: (id) => id === testSkill.id ? testSkill : null,
})

const fNone = buildHitEvalFingerprint(baseHit)
const fNull = buildHitEvalFingerprint({ ...baseHit, buffOverride: null })
const fE1 = buildHitEvalFingerprint({ ...baseHit, buffOverride: { disabledEffectIds: ['e1'] } })
const fE1Again = buildHitEvalFingerprint({ ...baseHit, buffOverride: { disabledEffectIds: ['e1'] } })
const fE2 = buildHitEvalFingerprint({ ...baseHit, buffOverride: { disabledEffectIds: ['e2'] } })
const fBlock = buildHitEvalFingerprint({ ...baseHit, buffOverride: { disabledBlockIds: ['src-a-b1'] } })

check('缺省 vs 显式 null → 指纹相同（归一）', fNone === fNull)
check('无例外 vs 有例外 → 指纹不同', fNone !== fE1)
check('相同例外 → 指纹相同（同配置的行仍共用缓存）', fE1 === fE1Again)
check('不同例外 → 指纹不同（两行不互串）', fE1 !== fE2)
check('块禁用 vs 单条禁用 → 指纹不同', fBlock !== fE1)

// 第一轮遗留待办：层数 / 转模覆盖也必须在指纹里，否则「同一例外、不同层数」的两行会串缓存
const fStacks3 = buildHitEvalFingerprint({
  ...baseHit,
  buffOverride: { stacksByEffectId: { e1: 3 } },
})
const fStacks5 = buildHitEvalFingerprint({
  ...baseHit,
  buffOverride: { stacksByEffectId: { e1: 5 } },
})
const fConvert = buildHitEvalFingerprint({
  ...baseHit,
  buffOverride: { convertInputsByEffectId: { e1: 2000 } },
})

check('缺省层数 vs 行级层数 → 指纹不同', fNone !== fStacks3)
check('同一条不同层数 → 指纹不同（不串缓存）', fStacks3 !== fStacks5)
check('行级转模输入 → 指纹不同', fNone !== fConvert)

console.log('=== 3. 层数 / 转模覆盖合并到全局勾选（rowBuffSelectionOverlay） ===')

const globalSelection = {
  enabledIds: { e1: true },
  stacksByEffectId: { e1: 1, e2: 4 },
  convertInputs: { e1: 100 },
}

check(
  '没有覆盖键 → null（调用方零开销沿用全局）',
  rowBuffSelectionOverlay({ disabledEffectIds: ['e2'] }, globalSelection) === null,
)
check('缺省 override → null', rowBuffSelectionOverlay(null, globalSelection) === null)

const mergedStacks = rowBuffSelectionOverlay({ stacksByEffectId: { e1: 6 } }, globalSelection)
check('行级层数叠加在全局之上', mergedStacks?.stacksByEffectId?.e1 === 6, JSON.stringify(mergedStacks))
check('未覆盖的条目保持全局值', mergedStacks?.stacksByEffectId?.e2 === 4)
check('只有层数时不动全局转模输入', mergedStacks?.convertInputs?.e1 === 100)

const mergedConvert = rowBuffSelectionOverlay(
  { convertInputsByEffectId: { e1: 2500 } },
  globalSelection,
)
check('行级转模输入叠加在全局之上', mergedConvert?.convertInputs?.e1 === 2500)
check('只有转模时保持全局层数', mergedConvert?.stacksByEffectId?.e1 === 1)

console.log('=== 4. 效果行文案（与局内增益共用实现） ===')

const staggerEffect = {
  id: 'b1',
  stat: 'dmgBonus',
  kind: 'add',
  value: 20,
  applyTarget: 'team',
  scope: 'common',
  applySituation: 'stagger',
  applyProfession: '强攻',
}

// 叠层总值：每层 × 当前层数（本行弹窗的层数步进器改的就是它）
const stackedEffect = {
  id: 's1',
  stat: 'critDmg',
  kind: 'stacked',
  valuePerStack: 5,
  maxStacks: 10,
  applyTarget: 'self',
  scope: 'common',
}

// 属性名走 label 表（与组件里 `statLabel` 同一份输入）
const statLabel = (stat) => ({ dmgBonus: '增伤%', critDmg: '暴击伤害%' })[stat] ?? stat

check(
  '失衡期：作用情况紧随 [强攻] 之后',
  formatBuffEffectResultText(staggerEffect, '+20', {
    statLabelFn: statLabel,
    applySituation: true,
  }) === '[强攻][失衡期] 增伤% +20',
  formatBuffEffectResultText(staggerEffect, '+20', {
    statLabelFn: statLabel,
    applySituation: true,
  }),
)
check(
  '关掉 applySituation → 老口径（不加前缀）',
  formatBuffEffectResultText(staggerEffect, '+20', { statLabelFn: statLabel }) ===
    '[强攻] 增伤% +20',
  formatBuffEffectResultText(staggerEffect, '+20', { statLabelFn: statLabel }),
)
check(
  '层数变 → 文案里的总值跟着变（每层 5 × 3 层 = 15）',
  formatBuffEffectResultText(stackedEffect, formatCalcSigned(5 * 3), {
    statLabelFn: statLabel,
    applySituation: true,
  }) === '暴击伤害% + 15',
  formatBuffEffectResultText(stackedEffect, formatCalcSigned(5 * 3), {
    statLabelFn: statLabel,
    applySituation: true,
  }),
)

console.log('=== 5. 分类 tab（BUFF_GROUP_TABS 唯一事实来源） ===')

check(
  '只出现实际有的分类 + 全部，顺序照表',
  availableBuffGroupTabs(['队友', '自身', '邦布']).join(',') === '全部,自身,队友,邦布',
  availableBuffGroupTabs(['队友', '自身', '邦布']).join(','),
)
check('没有任何分组 → 只剩全部', availableBuffGroupTabs([]).join(',') === '全部')
check(
  '表外分组（额外 Buff）不单开 tab，但不会让别的 tab 掉队',
  availableBuffGroupTabs(['额外 Buff', '自身']).join(',') === '全部,自身',
  availableBuffGroupTabs(['额外 Buff', '自身']).join(','),
)

console.log('=== 6. 勾选写回不得吞掉层数 / 转模覆盖（setFlowBuffEffectDisabled） ===')

const overrideEntry = {
  id: 'flow-1',
  buffOverrides: { stacksByEffectId: { s1: 3 }, convertInputsByEffectId: { c1: 800 } },
}
setFlowBuffEffectDisabled({
  entry: overrideEntry,
  effectId: 'e9',
  blockKey: 'src-a-b1',
  siblingEffectIds: ['e9'],
  disabled: true,
})
check(
  '关一条：数值覆盖原样保留',
  overrideEntry.buffOverrides?.stacksByEffectId?.s1 === 3 &&
    overrideEntry.buffOverrides?.convertInputsByEffectId?.c1 === 800,
  JSON.stringify(overrideEntry.buffOverrides),
)
check(
  '关一条：禁用名单写进去了',
  overrideEntry.buffOverrides?.disabledEffectIds?.join(',') === 'e9',
)

setFlowBuffEffectDisabled({
  entry: overrideEntry,
  effectId: 'e9',
  blockKey: 'src-a-b1',
  siblingEffectIds: ['e9'],
  disabled: false,
})
check(
  '开回来：数值覆盖仍在（不是整份清成 null）',
  overrideEntry.buffOverrides?.stacksByEffectId?.s1 === 3,
  JSON.stringify(overrideEntry.buffOverrides),
)
check(
  '开回来：禁用名单清空',
  (overrideEntry.buffOverrides?.disabledEffectIds ?? []).length === 0,
)

const plainEntry = { id: 'flow-2', buffOverrides: { disabledEffectIds: ['e1'] } }
setFlowBuffEffectDisabled({
  entry: plainEntry,
  effectId: 'e1',
  blockKey: 'src-a-b1',
  siblingEffectIds: ['e1'],
  disabled: false,
})
check('没有数值覆盖 → 清空后仍是 null（老口径不变）', plainEntry.buffOverrides === null)

const groupEntry = {
  id: 'flow-3',
  memberOverrides: [
    { memberKey: 'k1', skillId: 'sk', buffOverrides: { stacksByEffectId: { s2: 5 } } },
  ],
}
setFlowBuffEffectDisabled({
  entry: groupEntry,
  effectId: 'e5',
  blockKey: 'src-a-b1',
  siblingEffectIds: ['e5'],
  disabled: true,
  memberKey: 'k1',
  skillId: 'sk',
})
check(
  '组成员行：数值覆盖原样保留',
  groupEntry.memberOverrides[0].buffOverrides?.stacksByEffectId?.s2 === 5,
  JSON.stringify(groupEntry.memberOverrides[0].buffOverrides),
)

console.log('=== 7. 行级覆盖 → 结算 mods（层数 / 转模这两跳的护栏） ===')

// 叠层：`options.stacksByEffectId[effect.id]` → resolveEffectBaseValue = 每层 × 层数
const stackedProbe = {
  id: 'st1',
  stat: 'dmgBonus',
  scope: 'general',
  applyTarget: 'self',
  kind: 'stacked',
  valuePerStack: 5,
  defaultStacks: 1,
  maxStacks: 10,
}
const stackedMods = (stacksByEffectId) =>
  resolveEffectsToMods([stackedProbe], { applyTargets: ['self'], stacksByEffectId })

check('层数 3 → mods 里就是 15', stackedMods({ st1: 3 }).dmgBonus === 15, String(stackedMods({ st1: 3 }).dmgBonus))
check(
  '行级层数叠在全局之上（全局 1、行级 3） → mods 15',
  resolveEffectsToMods([stackedProbe], {
    applyTargets: ['self'],
    stacksByEffectId: rowBuffSelectionOverlay(
      { stacksByEffectId: { st1: 3 } },
      { stacksByEffectId: { st1: 1 } },
    )?.stacksByEffectId,
  }).dmgBonus === 15,
)

// 转模（自行设置）：`options.convertInputs[effect.id]` → resolveConvertValue 的 overrideBase = 输入 × 比例
const manualConvertProbe = {
  id: 'mc1',
  stat: 'dmgBonus',
  scope: 'general',
  applyTarget: 'self',
  kind: 'convert',
  convert: { from: 'atk', panelSource: 'manual', ratioPercent: 5, defaultBase: 100 },
}
const convertMods = (convertInputs) =>
  resolveEffectsToMods([manualConvertProbe], { applyTargets: ['self'], convertInputs })

check('不给输入 → 走 defaultBase：100 × 5% = 5', convertMods(undefined).dmgBonus === 5, String(convertMods(undefined).dmgBonus))
check('输入 2000 → 2000 × 5% = 100', convertMods({ mc1: 2000 }).dmgBonus === 100, String(convertMods({ mc1: 2000 }).dmgBonus))
check(
  '行级转模输入叠在全局之上（全局 2000、行级 4000） → 4000 × 5% = 200',
  resolveEffectsToMods([manualConvertProbe], {
    applyTargets: ['self'],
    convertInputs: rowBuffSelectionOverlay(
      { convertInputsByEffectId: { mc1: 4000 } },
      { convertInputs: { mc1: 2000 } },
    )?.convertInputs,
  }).dmgBonus === 200,
)

console.log('=== 8. 组成员例外 = 整组 + 本段（合并，本段只叠加） ===')

const groupOverride = {
  disabledBlockIds: ['blk-g'],
  disabledEffectIds: ['eg'],
  stacksByEffectId: { s1: 2 },
  convertInputsByEffectId: { c1: 100 },
}
const memberOverride = {
  disabledEffectIds: ['em'],
  stacksByEffectId: { s2: 5 },
  convertInputsByEffectId: { c1: 400 },
}
const mergedOverride = mergeFlowBuffOverride(groupOverride, memberOverride)

check(
  '关闭项取并集（整组 + 本段）',
  mergedOverride.disabledEffectIds.join(',') === 'eg,em' &&
    mergedOverride.disabledBlockIds.join(',') === 'blk-g',
  JSON.stringify(mergedOverride),
)
check(
  '层数逐效果覆盖：本段没写的继承整组、写了的用本段',
  mergedOverride.stacksByEffectId.s1 === 2 && mergedOverride.stacksByEffectId.s2 === 5,
)
check('同一效果的转模：本段覆盖整组', mergedOverride.convertInputsByEffectId.c1 === 400)
check(
  '本段为空 → 原样继承整组',
  mergeFlowBuffOverride(groupOverride, null) === groupOverride,
)
check(
  '整组为空 → 用本段',
  mergeFlowBuffOverride(null, memberOverride) === memberOverride,
)
check('两边都空 → null（全部继承）', mergeFlowBuffOverride(null, null) === null)

// 读 / 写两个基准不能混：读用合并，写只动本段自己那份
const mergeEntry = {
  id: 'f1',
  buffOverrides: groupOverride,
  memberOverrides: [{ memberKey: '0:s1', skillId: 's1', buffOverrides: memberOverride }],
}
check(
  'effectiveRowOverride（读）= 合并结果',
  effectiveRowOverride(mergeEntry, '0:s1')?.disabledEffectIds.join(',') === 'eg,em',
  JSON.stringify(effectiveRowOverride(mergeEntry, '0:s1')),
)
check(
  'ownRowOverride（写基准）= 只有本段自己那份',
  ownRowOverride(mergeEntry, '0:s1')?.disabledEffectIds.join(',') === 'em',
)
check(
  '本轮修的就是这个：整组关 eg + 本段只改层数 → eg 仍关着、层数按本段',
  (() => {
    const entry = {
      id: 'f3',
      buffOverrides: { disabledEffectIds: ['eg'] },
      memberOverrides: [{ memberKey: '0:s1', skillId: 's1', buffOverrides: { stacksByEffectId: { s1: 3 } } }],
    }
    const eff = effectiveRowOverride(entry, '0:s1')
    return eff?.disabledEffectIds?.includes('eg') === true && eff.stacksByEffectId.s1 === 3
  })(),
)

const memberWriteEntry = {
  id: 'f2',
  buffOverrides: { disabledEffectIds: ['eg'] },
  memberOverrides: [{ memberKey: '0:s1', skillId: 's1', buffOverrides: null }],
}
setFlowBuffEffectDisabled({
  entry: memberWriteEntry,
  effectId: 'em',
  blockKey: 'blk-m',
  siblingEffectIds: ['em'],
  disabled: true,
  memberKey: '0:s1',
  skillId: 's1',
})
check(
  '成员写回只写自己那份（不把继承的整组内容实体化进来）',
  memberWriteEntry.memberOverrides[0].buffOverrides?.disabledEffectIds?.join(',') === 'em',
  JSON.stringify(memberWriteEntry.memberOverrides[0].buffOverrides),
)
check(
  '整组那份原样不动',
  memberWriteEntry.buffOverrides?.disabledEffectIds?.join(',') === 'eg',
)
check(
  '读出来是合并结果（整组 eg + 本段 em）',
  effectiveRowOverride(memberWriteEntry, '0:s1')?.disabledEffectIds.sort().join(',') === 'eg,em',
)

console.log('')
console.log(`=== 结果：passed = ${passed}, failed = ${failed} ===`)
if (failed > 0) process.exit(1)
