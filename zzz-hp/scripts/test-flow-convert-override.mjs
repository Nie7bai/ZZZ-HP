/**
 * 转模基数的「全局 / 行级」两级 + 显示与结算一致性（2026-10-23 修 bug 的回归）。
 *
 * 背景（用户 2026-10-23 报）：
 * - 「选择局内 Buff」里手填的转模基数，结算用了，但流程增益表 / 本行例外弹窗仍按面板显示；
 * - 「本行例外」原来只给「自行设置」转模输入框，读局外/局内的转模在行级改不了基数。
 *
 * 断言（都走真实取值函数，不自己造公式）：
 * 1. 无手填：结算与表格文本都按面板值；
 * 2. 全局手填：结算 = 表格文本 = 手填值（`buildFlowBuffEffectTexts` 的 `convertInputFor`）；
 * 3. 行级手填覆盖全局：结算按行级（`rowBuffOverride.convertInputsByEffectId` > `buffSelection.convertInputs`）；
 * 4. 面板口径（不带行级例外）只反映全局值，不被行级影响。
 *
 * 用法：npx vite-node scripts/test-flow-convert-override.mjs
 */
import {
  buildBuffCatalog,
  collectAllBuffEffects,
  collectPanelBuffMods,
  resolveCollectedEffectParameters,
  invalidateBuffCatalogCache,
} from '../src/utils/panelBuffCalc.ts'
import { buildFlowBuffEffectText, buildFlowBuffEffectTexts, mergeFlowBuffOverride } from '../src/utils/flowBuffTable.ts'
import { resolveConvertValue } from '../src/utils/buffEffect.ts'
import { convertEffect, dummyBangboo, makePanelCtx, testAgent, testSlot } from './_effectPipelineHarness.mjs'

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

const EFFECT_ID = 'conv-atk-10'

/** 收集产物里的实例 id（`sourceKey::blockId::effectId`）—— 勾选状态与转模输入都按它存 */
function instancedId(ctx, suffix = EFFECT_ID) {
  const item = collectAllBuffEffects(ctx).find((entry) => entry.effect.id.endsWith(suffix))
  return item ? item.effect.id : null
}

/** 一个「读局外」的转模：攻击 10% → 攻击 */
function buildAgent() {
  const agent = testAgent('a', { name: '甲' })
  const effect = convertEffect(EFFECT_ID, 'atk', {
    from: 'atk',
    panelSource: 'external',
    ratioPercent: 10,
    initialBase: 0,
    cap: null,
    defaultBase: null,
  })
  agent.mindscapeBuffs[0] = {
    effectBlocks: [{ id: 'blk', name: '测', effects: [effect] }],
    effects: [effect],
    selfMods: {},
    teamMods: {},
  }
  return agent
}

function buildCtx(extra = {}) {
  const agent = buildAgent()
  return makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [agent],
    bangboo: dummyBangboo(),
    mainSlotIndex: 0,
    extraGains: [],
    // 面板：攻击 2000 → 转模 10% = 200
    panelSourceValues: { external: { atk: 2000 }, final: { atk: 2000 } },
    ...extra,
  })
}

function textOf(ctx, id, convertInputFor) {
  const texts = buildFlowBuffEffectTexts(collectAllBuffEffects(ctx), {
    selection: null,
    contextKind: 'global',
    configurationParameters: Object.fromEntries(collectAllBuffEffects(ctx).map(item=>[item.effect.id,resolveCollectedEffectParameters(item,ctx)])),
    slotIndex: 0,
    attrDefaults: { atk: 2000 },
    panelSourceValues: ctx.panelSourceValues,
    convertInputFor,
  })
  return texts[id] ?? ''
}

console.log('\n[1] 无手填：结算与表格文本都按面板值')
{
  invalidateBuffCatalogCache()
  const ctx = buildCtx()
  const id = instancedId(ctx)
  check('收集到转模条目', Boolean(id), String(id))
  const atk = collectPanelBuffMods(ctx).atk
  check('结算 atk=200', atk === 200, `实际 ${atk}`)
  const text = textOf(ctx, id, undefined)
  check('表格文本含 200', text.includes('200'), text)
}

console.log('\n[2] 全局手填 3000：结算与表格文本都按 3000')
{
  invalidateBuffCatalogCache()
  const probe = buildCtx()
  const id = instancedId(probe)
  const globalSelection = {
    enabledIds: {},
    stacksByEffectId: {},
    convertInputs: { [id]: 3000 },
    manualTouchedIds: {},
  }
  invalidateBuffCatalogCache()
  const ctx = buildCtx({ buffSelection: globalSelection })
  const atk = collectPanelBuffMods(ctx).atk
  check('结算 atk=300', atk === 300, `实际 ${atk}`)
  const text = textOf(ctx, id, (effect) => globalSelection.convertInputs[effect.id])
  check('表格文本含 300（修前恒按面板 200）', text.includes('300'), text)
}

console.log('\n[3] 行级手填 5000 覆盖全局 3000')
{
  invalidateBuffCatalogCache()
  const probe = buildCtx()
  const id = instancedId(probe)
  const globalSelection = {
    enabledIds: {},
    stacksByEffectId: {},
    convertInputs: { [id]: 3000 },
    manualTouchedIds: {},
  }
  invalidateBuffCatalogCache()
  const rowCtx = buildCtx({
    buffSelection: globalSelection,
    rowBuffOverride: { convertInputsByEffectId: { [id]: 5000 } },
  })
  const rowAtk = collectPanelBuffMods(rowCtx).atk
  check('行级结算 atk=500', rowAtk === 500, `实际 ${rowAtk}`)

  invalidateBuffCatalogCache()
  const panelCtx = buildCtx({ buffSelection: globalSelection })
  const panelAtk = collectPanelBuffMods(panelCtx).atk
  check('面板口径仍只反映全局（300），不被行级影响', panelAtk === 300, `实际 ${panelAtk}`)
}

console.log('\n[4] 技能等级来源：手填基数不生效（共享函数忽略）')
{
  invalidateBuffCatalogCache()
  const agent = testAgent('a', { name: '甲' })
  const effect = convertEffect('conv-level', 'dmgBonus', {
    from: 'skillLevelBasic',
    panelSource: 'external',
    ratioPercent: 10,
    initialBase: 0,
    cap: null,
    defaultBase: null,
  })
  agent.mindscapeBuffs[0] = {
    effectBlocks: [{ id: 'blk', name: '测', effects: [effect] }],
    effects: [effect],
    selfMods: {},
    teamMods: {},
  }
  const ctx = makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [agent],
    bangboo: dummyBangboo(),
    mainSlotIndex: 0,
    extraGains: [],
    skillTalentLevelsByAgent: { a: { basic: 12 } },
    buffSelection: {
      enabledIds: {},
      stacksByEffectId: {},
      convertInputs: { 'conv-level': 3000 },
      manualTouchedIds: {},
    },
  })
  const mods = collectPanelBuffMods(ctx)
  check('等级 12 × 10% = 1.2（不吃手填 3000）', Math.abs((mods.dmgBonus ?? 0) - 1.2) < 1e-6, `实际 ${mods.dmgBonus}`)
}

console.log('\n[5] G1 单元格按行取事件值（列级说明保留全局）')
{
  invalidateBuffCatalogCache()
  const probe = buildCtx()
  const id = instancedId(probe)
  const globalSelection = {
    enabledIds: {},
    stacksByEffectId: {},
    convertInputs: { [id]: 3000 },
    manualTouchedIds: {},
  }
  invalidateBuffCatalogCache()
  const ctx = buildCtx({ buffSelection: globalSelection })
  const items = collectAllBuffEffects(ctx)
  const textOptions = {
    contextKind: 'global',
    configurationParameters: Object.fromEntries(items.map(item=>[item.effect.id,resolveCollectedEffectParameters(item,ctx)])),
    selection: globalSelection,
    slotIndex: 0,
    attrDefaults: { atk: 2000 },
    panelSourceValues: ctx.panelSourceValues,
    convertInputFor: (effect) => globalSelection.convertInputs[effect.id],
  }
  const item = items.find((entry) => entry.effect.id === id)
  const columnText = buildFlowBuffEffectTexts(items, textOptions)[id]
  const rowOverride = {convertInputsByEffectId:{[id]:5000}}
  const rowText = buildFlowBuffEffectText(item, {...textOptions, contextKind:'event',effectAmounts:{[id]:collectPanelBuffMods({...ctx,rowBuffOverride:rowOverride}).atk}}, rowOverride)
  check('列级说明仍是全局 300', columnText.includes('300'), columnText)
  check('单元格按行取 500', rowText.includes('500'), rowText)
  check('两者不相等（不得用列级冒充事件值）', columnText !== rowText)
}

console.log('\n[6] G2 成员读父组数值、写回只写本层')
{
  const group = { convertInputsByEffectId: { conv: 5000 }, stacksByEffectId: { stk: 4 } }
  const memberEmpty = null
  const memberOwn = { convertInputsByEffectId: { conv: 7000 }, stacksByEffectId: { stk: 1 } }
  const mergedInherit = mergeFlowBuffOverride(group, memberEmpty)
  const mergedOwn = mergeFlowBuffOverride(group, memberOwn)
  check('成员无覆盖 → 合并后取父组基数', mergedInherit?.convertInputsByEffectId?.conv === 5000)
  check('成员无覆盖 → 合并后取父组层数', mergedInherit?.stacksByEffectId?.stk === 4)
  check('成员有覆盖 → 基数取成员', mergedOwn?.convertInputsByEffectId?.conv === 7000)
  check('成员有覆盖 → 层数取成员', mergedOwn?.stacksByEffectId?.stk === 1)
  check('父组记录未被改动', group.convertInputsByEffectId.conv === 5000 && group.stacksByEffectId.stk === 4)
}

console.log('\n[7] G4 manual 技能等级转模接受手填基数；非 manual 忽略')
{
  const effect = convertEffect('conv-level-manual', 'dmgBonus', {
    from: 'skillLevelBasic',
    panelSource: 'manual',
    ratioPercent: 10,
    initialBase: 0,
    cap: null,
    defaultBase: 30,
  })
  const manualValue = resolveConvertValue(effect, {}, 50, undefined, null)
  check('manual 基数 50 × 10% = 5', Math.abs(manualValue - 5) < 1e-6, `实际 ${manualValue}`)
  const nonManual = convertEffect('conv-level-ext', 'dmgBonus', {
    from: 'skillLevelBasic',
    panelSource: 'external',
    ratioPercent: 10,
    initialBase: 0,
    cap: null,
    defaultBase: null,
  })
  const levelValue = resolveConvertValue(nonManual, {}, 50, undefined, { basic: 12 })
  check('非 manual 仍按等级 12 × 10% = 1.2（忽略手填）', Math.abs(levelValue - 1.2) < 1e-6, `实际 ${levelValue}`)
}

console.log('\n[8] 同一转模配置：常规增益与额外 Buff 结果一致（§7.2 第 23 项）')
{
  const { createExtraBuffGain } = await import('../src/utils/extraBuffCalc.ts')
  const { createEmptyBuffEffect } = await import('../src/utils/buffEffect.ts')

  const sharedConvert = {
    from: 'atk',
    panelSource: 'external',
    ratioPercent: 10,
    initialBase: 0,
    cap: null,
    defaultBase: null,
  }

  invalidateBuffCatalogCache()
  const normalCtx = buildCtx()
  const normalMods = collectPanelBuffMods(normalCtx)

  invalidateBuffCatalogCache()
  const extraCtx = makePanelCtx({
    teamSlots: [testSlot('a')],
    agents: [testAgent('a')],
    bangboo: dummyBangboo(),
    mainSlotIndex: 0,
    panelSourceValues: { external: { atk: 2000 }, final: { atk: 2000 } },
    extraGains: [
      createExtraBuffGain({
        id: 'equiv-conv',
        name: '等价转模',
        applySlot: 0,
        sourceSlot: 0,
        effects: [
          createEmptyBuffEffect({
            id: 'equiv-conv-eff',
            kind: 'convert',
            stat: 'atk',
            convert: sharedConvert,
          }),
        ],
      }),
    ],
  })
  const extraMods = collectPanelBuffMods(extraCtx)
  check(
    '常规与额外 Buff 的攻击增量相同（都是 200）',
    normalMods.atk === 200 && extraMods.atk === 200,
    `常规 ${normalMods.atk} / 额外 ${extraMods.atk}`,
  )
}

console.log('\n[七类修复 R4–R6] 真实成员组件及预览边界')
{
  const { mountVueSetup } = await import('./_vueSetupHarness.mjs')
  const { nextTick } = await import('vue')
  const imports = {
    '@/utils/panelBuffCalc': await import('../src/utils/panelBuffCalc.ts'),
    '@/utils/buffEffect': await import('../src/utils/buffEffect.ts'),
    '@/utils/flowBuffTable': await import('../src/utils/flowBuffTable.ts'),
    '@/utils/calculatorUi': await import('../src/utils/calculatorUi.ts'),
    '@/utils/buffStatZones': await import('../src/utils/buffStatZones.ts'),
    '@/utils/calcNumberFormat': await import('../src/utils/calcNumberFormat.ts'),
    '@/utils/skillTalentLevels': await import('../src/utils/skillTalentLevels.ts'),
    '@/composables/useMaskClose': await import('../src/composables/useMaskClose.ts'),
  }
  const effect = convertEffect('component-convert', 'atk', { from: 'atk', panelSource: 'manual', ratioPercent: 10, defaultBase: 3000, initialBase: 0, cap: null })
  const stacked = imports['@/utils/buffEffect'].createEmptyBuffEffect({ id: 'component-stack', stat: 'atk', kind: 'stacked', valuePerStack: 10, defaultStacks: 2, maxStacks: 5, enabledDefault: true })
  const item = { effect, sourceKey: 'agent-0-0', blockId: 'component-block', blockName: '测', group: '角色', providerSlot: 0, applicableSlots: [0] }
  const parent = { convertInputsByEffectId: { [effect.id]: 5000 }, stacksByEffectId: { [stacked.id]: 4 } }
  const parametersForDraft = rowOverride => {
    const ctx=makePanelCtx({rowBuffOverride:rowOverride})
    return Object.fromEntries([item,{...item,effect:stacked}].map(i=>[i.effect.id,resolveCollectedEffectParameters(i,ctx)]))
  }
  const mounted = mountVueSetup(new URL('../src/components/calculator/SkillBuffOverrideModal.vue', import.meta.url), {
    imports, expose: ['stacksModel', 'convertBaseModel', 'convertResult', 'effectResultText', 'restoreEffectInherit'],
    props: { effects: [item], open: true, override: null, parentOverride: parent,
      globalConvertInput: () => 3000, globalStacksFor: () => 2,
      // 真实页面会给的「待选配置参数」：本夹具用共享解析器按草稿 override 现算（不是 UI 自算）
      convertResolveInputs: (_slotIndex, rowOverride) => ({
        contextKind: 'global',
        attrDefaults: {},
        configurationParameters: parametersForDraft(rowOverride),
      }) },
  })
  try {
    check('R4 真实组件输入继承父组 5000', mounted.vm.convertBaseModel(item) === 5000)
    check('R4 真实组件结果继承父组 500', mounted.vm.convertResult(item) === 500)
    check('R4 真实组件层数继承父组 4', mounted.vm.stacksModel(stacked) === 4)
    check('R4 真实组件叠层摘要显示 40', mounted.vm.effectResultText({ ...item, effect: stacked }).includes('40'))
    mounted.props.override = { convertInputsByEffectId: { [effect.id]: 7000 } }
    await nextTick()
    check('R4 成员自己的模型覆盖为 700', mounted.vm.convertResult(item) === 700)
    mounted.vm.restoreEffectInherit(effect)
    await nextTick()
    check('R4 恢复继承后回到 500', mounted.vm.convertResult(item) === 500)
    check('R4 恢复没有改写父组记录', parent.convertInputsByEffectId[effect.id] === 5000)
  } finally { mounted.unmount() }
  const extraMounted = mountVueSetup(new URL('../src/components/calculator/SkillBuffOverrideModal.vue', import.meta.url), {
    imports, expose: ['stacksModel', 'convertBaseModel', 'convertResult', 'effectResultText'],
    props: { effects: [], open: true, override: null, parentOverride: parent,
      globalConvertInput: () => 9000, globalStacksFor: () => 9,
      // 真实页面会给的「待选配置参数」：本夹具用共享解析器按草稿 override 现算（不是 UI 自算）
      convertResolveInputs: (_slotIndex, rowOverride) => ({
        contextKind: 'global',
        attrDefaults: {},
        configurationParameters: parametersForDraft(rowOverride),
      }) },
  })
  try {
    const extra = { ...item, effect: { ...effect, extraGain: true } }
    check('R4 额外 Buff 成员输入及结果继承父组', extraMounted.vm.convertBaseModel(extra) === 5000 && extraMounted.vm.convertResult(extra) === 500)
    check('R4 额外 Buff 层数和摘要继承父组', extraMounted.vm.stacksModel({ ...stacked, extraGain: true }) === 4 && extraMounted.vm.effectResultText({ ...item, effect: { ...stacked, extraGain: true } }) === '攻击力（数值） + 40')
    extraMounted.props.override = { stacksByEffectId: { [stacked.id]: 8 } }
    await nextTick()
    check('R6 真实弹窗摘要按最大层数夹紧', extraMounted.vm.effectResultText({ ...item, effect: { ...stacked, extraGain: true } }) === '攻击力（数值） + 50')
  } finally { extraMounted.unmount() }
  const extraItem = { ...item, effect: { ...effect, extraGain: true }, sourceKey: 'extra-component', extraGainSourceSlot: 1 }
  const previewContext=makePanelCtx({buffSelection:{enabledIds:{},stacksByEffectId:{},convertInputs:{[effect.id]:9000}},attrValues:{atk:1000}})
  const configOptions=i=>({contextKind:'global',selection:null,slotIndex:0,configurationParameters:{[i.effect.id]:resolveCollectedEffectParameters(i,previewContext)}})
  check('R2 预览忽略额外 Buff 的选择器残留', buildFlowBuffEffectText(extraItem, configOptions(extraItem)).replace(/\s+/g, '').includes('+300'))
  const emptySource = { ...extraItem, effect: { ...extraItem.effect, convert: { ...effect.convert, panelSource: 'external' } } }
  check('R5 空来源不能回落受益者攻击', buildFlowBuffEffectText(emptySource, configOptions(emptySource)).endsWith(' 0'))
  for (const [stacks, expected] of [[8, 50], [1.33, 13.3], [0, 0]]) {
    for (const extraGain of [false, true]) {
      const stackItem={...item,effect:{...stacked,extraGain}}
      const ctx=makePanelCtx({rowBuffOverride:{stacksByEffectId:{[stacked.id]:stacks}}})
      const text = buildFlowBuffEffectText(stackItem,{contextKind:'global',selection:null,slotIndex:0,configurationParameters:{[stacked.id]:resolveCollectedEffectParameters(stackItem,ctx)}})
      // 文本格式已统一到 formatCalcSigned（`+ 50` 带空格），比对时忽略空白
      check(`R6 ${extraGain ? '额外' : '普通'} ${stacks} 层显示 ${expected}`, text.replace(/\s+/g, '').endsWith(`${expected ? '+' : ''}${expected}`), text)
    }
  }
}

console.log('\n[七类修复 R2/R5] 页面默认同步与事件来源面板的真实接线')
{
  const { bindVueFunctions, mountVueSetup } = await import('./_vueSetupHarness.mjs')
  const { ref, nextTick } = await import('vue')
  const core = await import('../src/utils/panelBuffCalc.ts')
  const buff = await import('../src/utils/buffEffect.ts')
  const { buildSkillContextFromHit, resolveEventElement } = await import('../src/utils/resolvedHit.ts')
  const pageUrl = new URL('../src/components/calculator/DamageCalcPage.vue', import.meta.url)
  const blankSelection = () => ({ enabledIds: {}, stacksByEffectId: {}, convertInputs: {}, manualTouchedIds: {} })
  const state = { team: blankSelection(), bySlot: [blankSelection()] }
  const normal = convertEffect('sync-normal', 'atk', { from: 'atk', panelSource: 'manual', ratioPercent: 10, defaultBase: 1000 })
  const extra = { ...normal, convert: { ...normal.convert }, id: 'sync-extra', extraGain: true }
  const sync = bindVueFunctions(pageUrl, ['syncManualConvertDefaults'], {
    restoringWorkingState: false, buffPickerSlotOptions: ref([{ index: 0 }]),
    buildBuffCollectContext: () => ({}), collectAllBuffEffects: () => [{ effect: normal }, { effect: extra }], multiSlotBuffSelection: state,
  })
  sync.syncManualConvertDefaults()
  extra.convert.defaultBase = 2000
  sync.syncManualConvertDefaults()
  check('R2 真实默认同步保留普通默认值', state.bySlot[0].convertInputs[normal.id] === 1000)
  check('R2 真实默认同步不写额外 Buff，改默认后也不写', !Object.hasOwn(state.bySlot[0].convertInputs, extra.id))

  const { r5Fixture, eventRuntimeInput } = await import('./_eventElementHarness.mjs')
  const { resolveEventBuffPreviewInputs, resolveConfigurationParameters } = await import('../src/utils/optimalAffixAlloc.ts')
  const { buildHitEvalFingerprint, internHitEvalContext, hitEvalCacheKey } = await import('../src/utils/hitEvalCache.ts')
  const { createBuffCalculationRuntime, evaluateSkillFlowHit, resolveSkillFlowCalculationDetail } = await import('../src/utils/skillFlowCalculation.ts')
  for (const mode of ['ordinary', 'extra-slot']) for (const damageType of ['direct', 'anomalyRelease']) {
    const fixture = r5Fixture(mode, damageType)
    const { context, hits, items, agents } = fixture
    const hit = hits[0], convertItem = items.find(item => item.effect.id.endsWith('convert'))
    const override = hit.buffOverride
    const runtime=createBuffCalculationRuntime(eventRuntimeInput(fixture))
    const panel = bindVueFunctions(new URL('../src/components/calculator/PanelCalcSection.vue', import.meta.url), ['getEventBuffPreviewInputs'], {
      props:{flowCalculationRuntime:runtime},
    })
    // 组件对页面暴露的「待选配置参数」入口：本文用**真实的共享解析**按同一份上下文算，
    // 与 PanelCalcSection.getConfigurationParametersForSlot 同语义（它不是被测对象，是输入供给）
    panel.getConfigurationParametersForSlot = (slotIndex) => {
      const shared = resolveConfigurationParameters(context, hit, slotIndex)
      return shared
    }
    const page = bindVueFunctions(pageUrl, ['buffConvertResolveInputsForSlot', 'flowBuffEffectTextFor'], {
      hits: ref(hits), agents: ref(agents), buildSkillContextFromHit, resolveEventElement,
      activeSlot: ref(0), collectedEffectsForFlowTable: ref(items), flowBuffTextOptions: ref({ selection: null, slotIndex: 0 }), buildFlowBuffEffectText,
      panelCalcSectionRef: ref(panel),
      flowCalculationRuntime:ref(runtime),configurationCalculationRuntime:ref(runtime),
    })
    check(`R5 ${mode} ${damageType} 同一有效事件复用预览结果`, panel.getEventBuffPreviewInputs(0, hit, override) === panel.getEventBuffPreviewInputs(0, hit, override))
    const actual = evaluateSkillFlowHit(context, null, hit, true)
    const detailed = resolveSkillFlowCalculationDetail(context, null, hit).evaluation
    const total = damageType === 'direct' ? actual.finalPanel.dmgBonus : actual.defenseTriggerFinalPanel.anomalyReleaseMult
    check(`R5 ${mode} ${damageType} 独立实际计算 A 正确`, total === (damageType === 'direct' ? 100 : 150))
    check(`R5 ${mode} ${damageType} 详情与计算同源`, JSON.stringify(actual.result) === JSON.stringify(detailed.result))
    check(`R5 ${mode} ${damageType} 真实页面 A 文本为100`, page.flowBuffEffectTextFor(convertItem.effect.id, override, hit.id).replace(/\s+/g, '').endsWith('+100'))
    check(`R5 ${mode} ${damageType} 真实页面 B 文本为150`, page.flowBuffEffectTextFor(convertItem.effect.id, null, hits[1].id).replace(/\s+/g, '').endsWith('+150'))
    check(`R5 ${mode} ${damageType} 组头无伪造数值`, page.flowBuffEffectTextFor(convertItem.effect.id, {}, null).includes('数值见成员'))
    const imports = {
      '@/utils/panelBuffCalc': core, '@/utils/buffEffect': buff,
      '@/utils/flowBuffTable': await import('../src/utils/flowBuffTable.ts'),
      '@/utils/calculatorUi': await import('../src/utils/calculatorUi.ts'),
      '@/utils/buffStatZones': await import('../src/utils/buffStatZones.ts'),
      '@/utils/calcNumberFormat': await import('../src/utils/calcNumberFormat.ts'),
      '@/utils/skillTalentLevels': await import('../src/utils/skillTalentLevels.ts'),
      '@/composables/useMaskClose': await import('../src/composables/useMaskClose.ts'),
    }
    const mounted = mountVueSetup(new URL('../src/components/calculator/SkillBuffOverrideModal.vue', import.meta.url), {
      imports, expose: ['convertResult', 'effectResultText'], props: { effects: items, open: true, override: null, rowKey: hit.id, convertResolveInputs: page.buffConvertResolveInputsForSlot },
    })
    try {
      check(`R5 ${mode} ${damageType} 弹窗初值150`, mounted.vm.convertResult(convertItem) === 150)
      mounted.props.override = override
      await nextTick()
      check(`R5 ${mode} ${damageType} 弹窗实时改来源100`, mounted.vm.convertResult(convertItem) === 100)
      check(`R5 ${mode} ${damageType} 弹窗贡献与独立详情对应`, mounted.vm.effectResultText(convertItem).replace(/\s/g, '').includes('+100'), mounted.vm.effectResultText(convertItem))
      const eid = convertItem.effect.id
      mounted.props.override = { ...override, convertInputsByEffectId: { [eid]: 0 } }
      await nextTick()
      check(`R5 ${mode} ${damageType} 显式零值`, mounted.vm.convertResult(convertItem) === 0 && evaluateSkillFlowHit(context, null, { ...hit, buffOverride: mounted.props.override }, true).breakdown.totalMods[convertItem.effect.stat] === 0)
    } finally { mounted.unmount() }
  }

  const { r3Fixture } = await import('./_eventElementHarness.mjs')
  for (const mode of ['ordinary', 'extra-slot', 'extra-team']) {
    const f = r3Fixture(mode)
    const hit = f.hits[0], item = f.items.find(candidate => candidate.effect.id.endsWith('release'))
    const inputs = (_slot, rowOverride) => resolveEventBuffPreviewInputs(f.context, null, { ...hit, buffOverride: rowOverride }, 0)
    const mounted = mountVueSetup(new URL('../src/components/calculator/SkillBuffOverrideModal.vue', import.meta.url), {
      imports: {
        '@/utils/panelBuffCalc': core, '@/utils/buffEffect': buff,
        '@/utils/flowBuffTable': await import('../src/utils/flowBuffTable.ts'),
        '@/utils/calculatorUi': await import('../src/utils/calculatorUi.ts'),
        '@/utils/buffStatZones': await import('../src/utils/buffStatZones.ts'),
        '@/utils/calcNumberFormat': await import('../src/utils/calcNumberFormat.ts'),
        '@/utils/skillTalentLevels': await import('../src/utils/skillTalentLevels.ts'),
        '@/composables/useMaskClose': await import('../src/composables/useMaskClose.ts'),
      }, expose: ['convertResult'], props: { effects: f.items, open: true, override: null, convertResolveInputs: inputs },
    })
    try {
      check(`R3 ${mode} 跨元素真实弹窗贡献1.2`, mounted.vm.convertResult(item) === 1.2)
      mounted.props.override = { disabledEffectIds: [item.effect.id] }
      await nextTick()
      check(`R3 ${mode} 关闭后弹窗/实际贡献同时归零`, mounted.vm.convertResult(item) === 0 && evaluateSkillFlowHit(f.context, null, { ...hit, buffOverride: mounted.props.override }).defenseTriggerFinalPanel.anomalyReleaseMult === 50)
    } finally { mounted.unmount() }
  }
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
