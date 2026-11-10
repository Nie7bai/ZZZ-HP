/**
 * 事件增益投影回归（C2 / K1 / K2a / K2b / K10 的归属脚本）。
 *
 * 目的：证明「预览显示值 = 计算实际采用值」。
 * - K1：职业限制夹具（owner 强攻 / power 支援）。实际只有 power 吃到 25% 增伤，
 *   预览却因为「按 effect id 先到先得」写成 0。
 * - 断言分两组，互不替代：
 *   ① 统一断言：预览值 = 计算结果实际采用的贡献值；
 *   ② 计算断言：计算结果 = 规则对照表期望值（K1：伤害 4545，禁用后 3636）。
 *
 * 运行：npx vite-node scripts/test-event-buff-projection.mjs
 */
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { testAgent } from './_effectPipelineHarness.mjs'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { effectRecipientNote } from '../src/utils/flowBuffTable.ts'
import { collectAllBuffEffects, computeFinalPanel } from '../src/utils/panelBuffCalc.ts'
import {
  projectEventEffectRecords,
  resolveConfigurationParameters,
  evaluateAffixCounts,
  clearAffixEvalCache,
  withAffixLibraryExtraGains,
  resolveEventBuffPreviewInputs,
} from '../src/utils/optimalAffixAlloc.ts'
import { evaluateSkillFlowHit, createBuffCalculationRuntime } from '../src/utils/skillFlowCalculation.ts'
import { createEmptyAffixCounts } from '../src/types/calculatorPanel.ts'
import { entryRollsToEvalInput, gainTarget } from '../src/utils/affixLibrary.ts'
import { resolveSkillFlowPanelSource } from '../src/utils/skillFlowPanelSource.ts'
import { AFFIX_VALUE_PER_COUNT } from '../src/utils/affixPanelCalc.ts'
import { clearHitEvalCache } from '../src/utils/hitEvalCache.ts'

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

function near(actual, expected, tolerance = 1e-6) {
  return typeof actual === 'number' && Math.abs(actual - expected) <= tolerance
}

/** K1 夹具：团队固定增伤 25%，仅支援职业受益；属性异常事件，触发者为 owner。 */
function k1Fixture(mode) {
  const effect = createEmptyBuffEffect({
    id: 'support-bonus',
    stat: 'dmgBonus',
    value: 25,
    kind: 'fixed',
    enabledDefault: true,
    applyTarget: 'team',
    applyProfession: '支援',
  })
  const fixture = eventFixture({
    mode,
    damageType: 'attributeAnomaly',
    effects: [effect],
    agents: [testAgent('owner', { profession: '强攻' }), testAgent('power', { profession: '支援' })],
  })
  const hit = fixture.hits[0]
  hit.multOverrides = { ...hit.multOverrides, attributeAnomalyMult: 100 }
  const effectId = fixture.items.find((item) => item.effect.id.endsWith('support-bonus')).effect.id
  return { fixture, hit, effectId }
}

for (const mode of ['ordinary', 'extra-team']) {
  console.log(`== K1 职业限制（${mode}） ==`)
  const { fixture, hit, effectId } = k1Fixture(mode)

  const numeric = evaluateSkillFlowHit(fixture.context, null, hit)
  const detailed = evaluateSkillFlowHit(fixture.context, null, hit, true)
  const disabled = evaluateSkillFlowHit(fixture.context, null, {
    ...hit,
    buffOverride: { disabledEffectIds: [effectId] },
  })
  const preview = resolveEventBuffPreviewInputs(fixture.context, null, hit, 0)
  const previewAmount = preview.effectAmounts[effectId]

  // ② 计算断言：规则对照表期望值
  check('持有者(强攻)不吃职业限定增伤 → 0', near(numeric.finalPanel.dmgBonus, 0), String(numeric.finalPanel.dmgBonus))
  check(
    '强度提供者(支援)吃到 → 25',
    near(numeric.producerFinalPanel.dmgBonus, 25),
    String(numeric.producerFinalPanel.dmgBonus),
  )
  check('数字口径总伤 4545', near(numeric.total, 4545), String(numeric.total))
  check('详情口径总伤 4545', near(detailed.total, 4545), String(detailed.total))
  check('行级禁用后总伤 3636', near(disabled.total, 3636), String(disabled.total))

  // ① 统一断言：预览 = 计算实际采用值（缺陷所在）
  check(
    `预览显示 25（当前实现先到先得，写成了 ${previewAmount}）`,
    near(previewAmount, 25),
    String(previewAmount),
  )
  check(
    '预览值 = 强度提供者实际贡献 25',
    near(previewAmount, numeric.producerFinalPanel.dmgBonus),
    `preview=${previewAmount} power=${numeric.producerFinalPanel.dmgBonus}`,
  )
}

console.log('')
console.log('== K3 全局与行级隔离（普通 / 额外各一次） ==')
for (const mode of ['ordinary', 'extra-team']) {
  const effect = createEmptyBuffEffect({
    id: 'global-atk',
    stat: 'atk',
    value: 50,
    kind: 'fixed',
    enabledDefault: true,
    applyTarget: 'team',
  })
  const fixture = eventFixture({
    mode,
    damageType: 'attributeAnomaly',
    effects: [effect],
    agents: [testAgent('owner', { profession: '强攻' }), testAgent('power', { profession: '支援' })],
  })
  const hit = fixture.hits[0]
  const effectId = fixture.items.find((item) => item.effect.id.endsWith('global-atk')).effect.id
  const external = fixture.panels.owner

  // 全局面板：行级例外恒为 null（Spec §2.1 第 5 项）
  const globalCtx = { ...fixture.panelContext, rowBuffOverride: null }
  const globalPanel = computeFinalPanel(external, globalCtx, { includeDetails: false }).finalPanel

  const eventA = evaluateSkillFlowHit(fixture.context, null, hit)
  const eventADisabled = evaluateSkillFlowHit(fixture.context, null, {
    ...hit,
    buffOverride: { disabledEffectIds: [effectId] },
  })
  // 行级禁用不反写全局：再算一次全局面板必须还是 1050
  const globalAfter = computeFinalPanel(external, globalCtx, { includeDetails: false }).finalPanel

  check(`${mode}｜局外 1000 + 全局攻击 50 → 全局 1050`, near(globalPanel.atk, 1050), String(globalPanel.atk))
  check(`${mode}｜事件 A 未禁用 → 1050`, near(eventA.finalPanel.atk, 1050), String(eventA.finalPanel.atk))
  check(`${mode}｜事件 A 禁用该效果 → 1000`, near(eventADisabled.finalPanel.atk, 1000), String(eventADisabled.finalPanel.atk))
  check(`${mode}｜行级禁用不反写全局 → 仍 1050`, near(globalAfter.atk, 1050), String(globalAfter.atk))
}

console.log('')
console.log('== K1 记录级断言（逐受益者、状态、来源说明） ==')
for (const mode of ['ordinary', 'extra-team']) {
  const { fixture, hit, effectId } = k1Fixture(mode)
  const detail = evaluateSkillFlowHit(fixture.context, null, hit, true)
  const disabledDetail = evaluateSkillFlowHit(fixture.context, null, {
    ...hit,
    buffOverride: { disabledEffectIds: [effectId] },
  }, true)
  const summaries = projectEventEffectRecords(detail.effectRecords ?? [])
  const summary = summaries[effectId]
  const disabledSummary = projectEventEffectRecords(disabledDetail.effectRecords ?? [])[effectId]
  const ownerRecord = detail.effectRecords?.find(
    (record) => record.beneficiarySlot === 0 && record.effectId === effectId,
  )
  const powerRecord = detail.effectRecords?.find(
    (record) => record.beneficiarySlot === 1 && record.effectId === effectId,
  )

  check(`${mode}｜持有者记录为 profession-mismatch / 0 / 无采用项`,
    ownerRecord?.status === 'profession-mismatch' && ownerRecord.amount === 0 && ownerRecord.usedInputs.length === 0,
    JSON.stringify(ownerRecord && { status: ownerRecord.status, amount: ownerRecord.amount, used: ownerRecord.usedInputs.length }))
  check(`${mode}｜强度提供者记录 applied / 25 / 采用 powerProviderPanel+dmgBonus`,
    powerRecord?.status === 'applied' && near(powerRecord.amount, 25) &&
      powerRecord.usedInputs.some((usage) => usage.usedView === 'powerProviderPanel' && usage.field === 'dmgBonus'),
    JSON.stringify(powerRecord && { status: powerRecord.status, amount: powerRecord.amount, views: powerRecord.usedViews }))
  check(`${mode}｜summary 只有 power 一个实际受益者、状态 single、金额 25`,
    summary?.state === 'single' && summary.recipients.length === 1 &&
      summary.recipients[0].slotIndex === 1 && near(summary.amount, 25),
    JSON.stringify(summary && { state: summary.state, amount: summary.amount, recipients: summary.recipients.length }))
  check(`${mode}｜查看槽 0 说明「来源：支援·power」，槽 1 无多余说明`,
    effectRecipientNote(summary, 0) === '来源：支援·power' && effectRecipientNote(summary, 1) === '',
    `${effectRecipientNote(summary, 0)} / ${effectRecipientNote(summary, 1)}`)
  check(`${mode}｜禁用后两候选均 disabled、recipients 空、状态 inactive、金额 0、说明「已禁用」`,
    disabledSummary?.state === 'inactive' &&
      disabledSummary.recipients.length === 0 &&
      (disabledSummary.candidates ?? []).every((candidate) => candidate.status === 'disabled') &&
      disabledSummary.amount == null &&
      effectRecipientNote(disabledSummary, 0) === '已禁用',
    JSON.stringify(disabledSummary && { state: disabledSummary.state, note: effectRecipientNote(disabledSummary, 0) }))
}

console.log('')
console.log('== K2a 采用筛选（两个面板都 applied，只有一边被事件采用） ==')
{
  // 已启用的无主环境团队转模：atk 局外 1% → dmgBonus。owner 1000 / power 2000 两块面板
  // 会分别得到 10 / 20，但异常事件的通用增伤只取强度提供者 → 正确预览是 20 且不是 multiple。
  const convert = createEmptyBuffEffect({
    id: 'env-convert',
    kind: 'convert',
    stat: 'dmgBonus',
    enabledDefault: true,
    applyTarget: 'team',
    convert: { from: 'atk', panelSource: 'external', ratioPercent: 1, initialBase: 0, cap: null },
  })
  const fixture = eventFixture({
    damageType: 'attributeAnomaly',
    effects: [],
    agents: [testAgent('owner', { profession: '强攻' }), testAgent('power', { profession: '强攻' })],
  })
  fixture.context.panelContext.environmentBuffs = [
    {
      kind: 'crisis',
      id: 'recipient',
      sourceKey: 'crisis-buff-recipient',
      name: 'fixture',
      effectBlocks: [{ id: 'block', name: 'fixture', effects: [convert] }],
    },
  ]
  const hit = fixture.hits[0]
  hit.multOverrides = { ...hit.multOverrides, attributeAnomalyMult: 100 }
  const effectId = collectAllBuffEffects(fixture.context.panelContext)[0].effect.id
  fixture.context.panelContext.buffSelection = {
    enabledIds: { [effectId]: true },
    stacksByEffectId: {},
    convertInputs: {},
  }
  const numeric = evaluateSkillFlowHit(fixture.context, null, hit)
  const detail = evaluateSkillFlowHit(fixture.context, null, hit, true)
  const summary = projectEventEffectRecords(detail.effectRecords ?? [])[effectId]
  const records = (detail.effectRecords ?? []).filter((record) => record.effectId === effectId)
  const ownerRecord = records.find((record) => record.beneficiarySlot === 0)
  const powerRecord = records.find((record) => record.beneficiarySlot === 1)

  check('两边面板分别得到 10 / 20',
    near(ownerRecord?.amount ?? -1, 10) && near(powerRecord?.amount ?? -1, 20),
    `${ownerRecord?.amount} / ${powerRecord?.amount}`)
  check('两条 applied 记录都保留（候选不丢）',
    records.filter((record) => record.status === 'applied').length === 2,
    String(records.length))
  check('实际受益者只有 power（owner 的 usedInputs 为空）',
    ownerRecord?.usedInputs.length === 0 && (powerRecord?.usedInputs.length ?? 0) > 0,
    `${ownerRecord?.usedInputs.length} / ${powerRecord?.usedInputs.length}`)
  check('summary 不是 multiple，金额取被采用的那 20',
    summary?.state === 'single' && near(summary.amount, 20),
    JSON.stringify(summary && { state: summary.state, amount: summary.amount }))
  check('事件总伤 4363（两面板都生效，仅 power 被采用）', near(numeric.total, 4363), String(numeric.total))
}

console.log('')
console.log('== K2b 投影边界（纯函数，两条合法记录） ==')
{
  const base = {
    eventId: 'evt', effectId: 'eff-1', stat: 'dmgBonus', sourceKey: 'agent-0-0', blockId: 'block',
    providerName: 'owner', providerSlot: 0, sourceSlot: 0, beneficiarySlot: 0,
    beneficiaryAgentId: 'owner', beneficiaryName: 'owner', beneficiaryLabel: '强攻·owner',
    policy: 'default', stage: 'preConvert', usedViews: ['ownerPanel'], usedZones: [],
    status: 'applied', stacks: 1, matchElement: null,
    usedInputs: [{ inputKey: 'finalPanel', field: 'dmgBonus', resultKey: 'dmgMultiplier', usedZones: [], viewKey: 'v', slotIndex: 0, policy: 'default', usedView: 'ownerPanel' }],
  }
  const makeRecord = (viewKey, slotIndex, label, amount) => ({
    ...base, viewKey, amount, beneficiarySlot: slotIndex, beneficiaryLabel: label,
  })
  const multiple = projectEventEffectRecords([
    makeRecord('v1', 0, '强攻·owner', 10),
    makeRecord('v2', 1, '支援·power', 20),
  ])['eff-1']
  check('两条不同金额的实际使用项 → multiple，金额缺省',
    multiple?.state === 'multiple' && multiple.amount == null,
    JSON.stringify({ state: multiple?.state, amount: multiple?.amount }))
  check('multiple 的完整说明逐个列出，不求和',
    effectRecipientNote(multiple, 0) === '多受益：强攻·owner + 10、支援·power + 20',
    effectRecipientNote(multiple, 0))
  const same = projectEventEffectRecords([
    makeRecord('v1', 0, '强攻·owner', 20),
    makeRecord('v2', 1, '支援·power', 20),
  ])['eff-1']
  check('两条相同金额 → same，金额 20（不是 40）',
    same?.state === 'same' && near(same.amount, 20),
    JSON.stringify({ state: same?.state, amount: same?.amount }))
  const sameSlot = projectEventEffectRecords([
    { ...makeRecord('v1', 0, '强攻·owner', 20), policy: 'default' },
    { ...makeRecord('v2', 0, '强攻·owner', 20), policy: 'remiel-self-radiance', usedViews: ['radianceSelfPanel'] },
  ])['eff-1']
  check('同槽位不同政策并存（两条都保留，说明带视图区分）',
    sameSlot?.recipients.length === 2 && effectRecipientNote(sameSlot, 0).includes('本人耀变受限面板'),
    effectRecipientNote(sameSlot, 0))
}

console.log('')
console.log('== K8 数字模式与追踪模式同源 ==')
for (const mode of ['ordinary', 'extra-team']) {
  const { fixture, hit } = k1Fixture(mode)
  const numeric = evaluateSkillFlowHit(fixture.context, null, hit, false)
  const detailed = evaluateSkillFlowHit(fixture.context, null, hit, true)
  check(`${mode}｜totalMods 逐属性相等`,
    Object.keys(numeric.breakdown.totalMods)
      .filter((key) => typeof numeric.breakdown.totalMods[key] === 'number')
      .every((key) =>
        near(numeric.breakdown.totalMods[key] ?? 0, detailed.breakdown.totalMods[key] ?? 0)),
    JSON.stringify({ numeric: numeric.breakdown.totalMods, detailed: detailed.breakdown.totalMods }))
  check(`${mode}｜totalMods.custom 相等`,
    JSON.stringify(numeric.breakdown.totalMods.custom ?? {}) ===
      JSON.stringify(detailed.breakdown.totalMods.custom ?? {}),
    '')
  check(`${mode}｜finalPanel 逐属性相等`,
    Object.keys(numeric.finalPanel).every((key) =>
      typeof numeric.finalPanel[key] !== 'number' || near(numeric.finalPanel[key], detailed.finalPanel[key])),
    '')
  check(`${mode}｜perHit / total 相等`,
    near(numeric.perHit, detailed.perHit) && near(numeric.total, detailed.total),
    `${numeric.perHit}/${detailed.perHit}`)
  check(`${mode}｜数字模式不生成记录`, !('effectRecords' in numeric) || numeric.effectRecords == null,
    JSON.stringify(Object.keys(numeric)))
  check(`${mode}｜追踪模式三个记录数组齐全`,
    Array.isArray(detailed.effectRecords) && Array.isArray(detailed.panelStageTraces) && Array.isArray(detailed.damageInputUsages),
    '')
}

console.log('')
console.log('== K9 身份与恰好一次（固定攻击 +50，全局 1000 → 1050） ==')
{
  const effect = createEmptyBuffEffect({
    id: 'exactly-once', stat: 'atk', value: 50, kind: 'fixed', enabledDefault: true, applyTarget: 'self',
  })
  const fixture = eventFixture({
    mode: 'ordinary', damageType: 'direct', effects: [effect],
    agents: [testAgent('owner', { profession: '强攻' })],
  })
  const hit = fixture.hits[0]
  const detail = evaluateSkillFlowHit(fixture.context, null, hit, true)
  check('最终面板攻击 1050（不是 1100）', near(detail.finalPanel.atk, 1050), String(detail.finalPanel.atk))
  const atkRecords = (detail.effectRecords ?? []).filter((record) => record.stat === 'atk' && record.status === 'applied')
  const identities = new Set(atkRecords.map((record) => [record.viewKey, record.stage, record.sourceKey, record.blockId, record.effectId].join('|')))
  check('每条效果每个视图只有一条最终贡献（身份唯一）', identities.size === atkRecords.length,
    `${identities.size} / ${atkRecords.length}`)
}

console.log('')
console.log('== K10 普通与额外对等（数值/状态/实际采用） ==')
{
  const build = (mode) => {
    const { fixture, hit, effectId } = k1Fixture(mode)
    const detail = evaluateSkillFlowHit(fixture.context, null, hit, true)
    const summary = projectEventEffectRecords(detail.effectRecords ?? [])[effectId]
    return { detail, summary }
  }
  const ordinary = build('ordinary')
  const extra = build('extra-team')
  check('同一受益事件两条链总伤相同', near(ordinary.detail.total, extra.detail.total),
    `${ordinary.detail.total} / ${extra.detail.total}`)
  check('受益者、金额、状态、采用视图一致',
    ordinary.summary?.state === extra.summary?.state &&
      near(ordinary.summary?.amount ?? -1, extra.summary?.amount ?? -2) &&
      ordinary.summary?.recipients[0]?.slotIndex === extra.summary?.recipients[0]?.slotIndex &&
      JSON.stringify(ordinary.summary?.recipients[0]?.usedViews) === JSON.stringify(extra.summary?.recipients[0]?.usedViews),
    JSON.stringify({ ordinary: ordinary.summary?.recipients, extra: extra.summary?.recipients }))
  check('同一查看槽位的来源说明一致',
    effectRecipientNote(ordinary.summary, 0) === effectRecipientNote(extra.summary, 0),
    `${effectRecipientNote(ordinary.summary, 0)} / ${effectRecipientNote(extra.summary, 0)}`)
  check('入口身份差异按对应关系比较（effectId 允许不同，不伪造相同）',
    ordinary.summary?.effectId !== extra.summary?.effectId,
    `${ordinary.summary?.effectId} / ${extra.summary?.effectId}`)
}

console.log('')
console.log('== K4 配置参数路径（未启用也能解析；基数与折算量分开） ==')
{
  const manual = createEmptyBuffEffect({
    id: 'manual-convert',
    kind: 'convert',
    stat: 'dmgBonus',
    enabledDefault: true,
    applyTarget: 'team',
    convert: { from: 'atk', panelSource: 'manual', defaultBase: 1000, ratioPercent: 10, initialBase: 0, cap: null },
  })
  const fixture = eventFixture({
    damageType: 'direct',
    effects: [manual],
    agents: [testAgent('owner', { profession: '强攻' })],
  })
  const hit = fixture.hits[0]
  const effectId = fixture.items.find((item) => item.effect.id.endsWith('manual-convert')).effect.id
  const params = resolveConfigurationParameters(fixture.context, hit, 0)
  const shared = params[effectId]
  check('K4 手动转模：配置基数 = defaultBase 1000', near(shared?.convertBase?.value ?? -1, 1000),
    JSON.stringify(shared))
  check('K4 手动转模：配置折算值 = 100（不是基数）', near(shared?.amount ?? -1, 100), String(shared?.amount))

  // 未启用：事件侧不产生贡献，但配置参数照样可解析
  const disabled = evaluateSkillFlowHit(fixture.context, null, {
    ...hit,
    buffOverride: { disabledEffectIds: [effectId] },
  }, true)
  const disabledSummary = projectEventEffectRecords(disabled.effectRecords ?? [])[effectId]
  check('K4 未启用/被禁用：实际状态不是 applied', disabledSummary?.state === 'inactive',
    JSON.stringify({ state: disabledSummary?.state }))
  const disabledPreview = resolveEventBuffPreviewInputs(fixture.context, null, {
    ...hit,
    buffOverride: { disabledEffectIds: [effectId] },
  }, 0)
  check('K4 未启用/被禁用：配置参数仍然给出（输入框不会变空）',
    near(disabledPreview.configurationParameters?.[effectId]?.convertBase?.value ?? -1, 1000),
    JSON.stringify(disabledPreview.configurationParameters?.[effectId]))
  check('K4 配置折算值不进 effectAmounts 的实际贡献位',
    (disabledPreview.effectAmounts?.[effectId] ?? 0) === 0, String(disabledPreview.effectAmounts?.[effectId]))

  // 技能等级非 manual：以体系等级为基数，忽略手填
  const levelConvert = createEmptyBuffEffect({
    id: 'level-convert',
    kind: 'convert',
    stat: 'dmgBonus',
    enabledDefault: true,
    applyTarget: 'self',
    convert: { from: 'skillLevelBasic', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null },
  })
  const levelFixture = eventFixture({
    damageType: 'direct',
    effects: [levelConvert],
    agents: [testAgent('owner', { profession: '强攻' })],
  })
  const levelHit = levelFixture.hits[0]
  const levelId = levelFixture.items.find((item) => item.effect.id.endsWith('level-convert')).effect.id
  levelFixture.context.panelContext.skillTalentLevelsByAgent = { owner: { basic: 12 } }
  levelFixture.context.panelContext.rowBuffOverride = {
    convertInputsByEffectId: { [levelId]: 3000 },
  }
  const levelParams = resolveConfigurationParameters(levelFixture.context, levelHit, 0)
  check('K4 技能等级非 manual：基数取体系等级 12、忽略手填 3000',
    near(levelParams[levelId]?.convertBase?.value ?? -1, 12), JSON.stringify(levelParams[levelId]))
  check('K4 技能等级非 manual：折算值 1.2', near(levelParams[levelId]?.amount ?? -1, 1.2),
    String(levelParams[levelId]?.amount))
}

console.log('')
console.log('== K11 real candidate generation and source selection ==')
for (const mode of ['ordinary', 'extra-team']) {
  for (const sourceMode of ['config', 'allocation', 'sweep']) {
    const effect = createEmptyBuffEffect({ id: 'source-convert', kind: 'convert', stat: 'dmgBonus', enabledDefault: true, applyTarget: 'team',
      convert: { from: 'atk', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null } })
    const fixture = eventFixture({ mode, damageType: 'direct', effects: [effect] })
    const counts = createEmptyAffixCounts()
    counts.atkFlat = sourceMode === 'allocation' ? 1000 / 19 : 2000 / 19
    const generated = entryRollsToEvalInput([{ id: 'candidate-gain', label: 'candidate', target: gainTarget('dmgBonus'), perRoll: 10 }], { 'candidate-gain': sourceMode === 'allocation' ? 1 : 2 })
    clearAffixEvalCache()
    const candidate = evaluateAffixCounts(fixture.context, counts, undefined, { ...AFFIX_VALUE_PER_COUNT, atkFlat: 19 }, generated.extraGains)
    const resolved = resolveSkillFlowPanelSource({ mode: sourceMode, currentSignature: 'current', options: sourceMode === 'config' ? {} : {
      [sourceMode]: { mode: sourceMode, signature: 'current', mainExternal: candidate.external, extraGains: generated.extraGains, baseDamageSource: 'atk' },
    } })
    const context = withAffixLibraryExtraGains(fixture.context, resolved.extraGains ?? [])
    const hit = fixture.hits[0]
    const detailed = evaluateSkillFlowHit(context, resolved.mainExternal, hit, true)
    const numeric = evaluateSkillFlowHit(context, resolved.mainExternal, hit, false)
    const id = fixture.items[0].effect.id
    const preview = resolveEventBuffPreviewInputs(context, resolved.mainExternal, hit, 0, detailed)
    const expectedBase = sourceMode === 'config' ? 1000 : sourceMode === 'allocation' ? 2000 : 3000
    const expectedGain = sourceMode === 'config' ? 0 : sourceMode === 'allocation' ? 10 : 20
    check(mode + '/' + sourceMode + ' actual candidate panel', near(detailed.external.atk, expectedBase), String(detailed.external.atk))
    check(mode + '/' + sourceMode + ' paired candidate gains', near(detailed.finalPanel.dmgBonus, expectedBase / 10 + expectedGain), String(detailed.finalPanel.dmgBonus))
    check(mode + '/' + sourceMode + ' configuration and contribution use selected panel',
      near(preview.configurationParameters[id]?.convertBase?.value, expectedBase) && near(preview.effectAmounts[id], expectedBase / 10))
    check(mode + '/' + sourceMode + ' numeric equals detailed total', near(numeric.total, detailed.total))
    if (sourceMode !== 'config') {
      const stale = resolveSkillFlowPanelSource({ mode: sourceMode, currentSignature: 'changed', options: {
        [sourceMode]: { mode: sourceMode, signature: 'current', mainExternal: candidate.external, extraGains: generated.extraGains, baseDamageSource: 'atk' },
      } })
      check(mode + '/' + sourceMode + ' stale candidate clears both inputs', !stale.active && stale.mainExternal === null && stale.extraGains === null)
    }
  }
}

console.log('== K4 真实 SFC 输入模型（行级弹窗读共享参数） ==')
{
  const { bindVueFunctions } = await import('./_vueSetupHarness.mjs')
  const vue = await import('vue')
  const buff = await import('../src/utils/buffEffect.ts')
  const { formatCalcSigned } = await import('../src/utils/calcNumberFormat.ts')
  const { formatBuffEffectResultText } = buff
  const modalUrl = new URL('../src/components/calculator/SkillBuffOverrideModal.vue', import.meta.url)

  const convert = createEmptyBuffEffect({
    id: 'sfc-convert',
    kind: 'convert',
    stat: 'dmgBonus',
    enabledDefault: true,
    applyTarget: 'self',
    convert: { from: 'atk', panelSource: 'external', ratioPercent: 10, initialBase: 0, cap: null },
  })
  const item = { effect: convert, sourceKey: 'agent-0-0', blockId: 'blk', providerSlot: 0 }

  const sharedBase = {
    amount: 250,
    stacks: 1,
    convertBase: { from: 'atk', value: 2500, source: 'external', stage: 'external' },
  }
  const props = { slotIndex: 0, skillSubcategories: [], globalConvertInput: () => undefined }
  const bindings = {
    props,
    effectiveOverride: vue.ref(null),
    resolveInputs: vue.ref({
      contextKind: 'event',
      attrDefaults: {},
      configurationParameters: { 'sfc-convert': sharedBase },
      effectSummaries: {
        'sfc-convert': {
          effectId: 'sfc-convert',
          stat: 'dmgBonus',
          sourceKey: 'agent-0-0',
          blockId: 'blk',
          providerName: 'owner',
          candidates: [],
          recipients: [
            { viewKey: 'v', slotIndex: 0, agentId: 'owner', label: '强攻·owner', policy: 'default', stage: 'convert', amount: 250, status: 'applied', usedViews: ['ownerPanel'], usedZones: [] },
          ],
          state: 'single',
          amount: 250,
        },
      },
    }),
    statLabel: (stat) => String(stat),
    formatBuffEffectResultText,
    formatCalcSigned,
    buildEffectRecipientNote: effectRecipientNote,
    isStackable: (effect) => effect.kind === 'stacked' || Boolean(effect.stackable),
    stacksModel: (effect) => effect.defaultStacks ?? 1,
  }
  let model = null
  try {
    model = bindVueFunctions(modalUrl, ['convertBaseModel', 'convertResult', 'effectResultText', 'effectRecipientNote'], bindings)
  } catch (error) {
    check('K4 能绑定弹窗真实函数', false, String(error?.message ?? error))
  }
  if (model) {
    check('K4 弹窗输入框基数读共享 convertBase（2500，不是 UI 自算）', model.convertBaseModel(item) === 2500,
      String(model.convertBaseModel(item)))
    check('K4 弹窗结果文本读 summary.amount（250）',
      model.effectResultText(item).includes('250'), model.effectResultText(item))
    check('K4 弹窗来源说明走共享函数（槽 0 自己是受益者 → 空串 / 或多受益）',
      typeof model.effectRecipientNote(item) === 'string', model.effectRecipientNote(item))
  }

  // 整组配置：没有唯一事件值 → 只给「整组配置；数值见成员」，不伪造成员值
  const groupModel = (() => {
    try {
      return bindVueFunctions(modalUrl, ['effectResultText'], {
        props: { slotIndex: 0, skillSubcategories: [], globalConvertInput: () => undefined },
        effectiveOverride: vue.ref(null),
        resolveInputs: vue.ref({ contextKind: 'group', attrDefaults: {}, configurationParameters: {}, configurationOnly: true }),
        statLabel: (stat) => String(stat),
        formatBuffEffectResultText,
        formatCalcSigned,
        isStackable: () => false,
        stacksModel: () => 1,
        convertResult: () => 0,
        buildEffectRecipientNote: effectRecipientNote,
      })
    } catch (error) {
      check('K4 能绑定整组配置场景', false, String(error?.message ?? error))
      return null
    }
  })()
  if (groupModel) {
    check('K4 整组配置：文案指向成员、不给伪造数值',
      groupModel.effectResultText(item).includes('整组配置') &&
        groupModel.effectResultText(item).includes('数值见成员'),
      groupModel.effectResultText(item))
  }
  // 禁用行：配置参数仍可解析（行级禁用不得把配置参数一起过滤掉）
  const disabledFixture = eventFixture({
    damageType: 'direct',
    effects: [
      createEmptyBuffEffect({
        id: 'row-disabled',
        kind: 'convert',
        stat: 'dmgBonus',
        enabledDefault: true,
        applyTarget: 'self',
        convert: { from: 'atk', panelSource: 'manual', defaultBase: 800, ratioPercent: 10, initialBase: 0, cap: null },
      }),
    ],
    agents: [testAgent('owner', { profession: '强攻' })],
  })
  const dh = disabledFixture.hits[0]
  const did = disabledFixture.items[0].effect.id
  const preview = resolveEventBuffPreviewInputs(disabledFixture.context, null, {
    ...dh,
    buffOverride: { disabledEffectIds: [did] },
  }, 0)
  check('K4 行级禁用后配置参数仍在（基数 800）',
    near(preview.configurationParameters?.[did]?.convertBase?.value ?? -1, 800),
    JSON.stringify(preview.configurationParameters?.[did]))
  // 不可结算：异常事件的触发者在队伍里不存在 → 正式求值返回 null，只给配置参数
  const { fixture: anomalyFixture, hit: anomalyHit } = k1Fixture('ordinary')
  const blocked = resolveEventBuffPreviewInputs(anomalyFixture.context, null, { ...anomalyHit, triggerAgentId: 'nobody' }, 0)
  check('K4 不可结算事件只给配置参数、不伪造金额',
    blocked.configurationOnly === true && blocked.effectSummaries == null && Object.keys(blocked.configurationParameters ?? {}).length > 0,
    JSON.stringify({ configurationOnly: blocked.configurationOnly, summaries: blocked.effectSummaries != null, params: Object.keys(blocked.configurationParameters ?? {}).length }))
  const explicitNull = resolveEventBuffPreviewInputs(anomalyFixture.context, null, anomalyHit, 0, null)
  check('K4 显式传 null 快照：不重试、不补造结果',
    explicitNull.configurationOnly === true && explicitNull.effectSummaries == null,
    JSON.stringify({ configurationOnly: explicitNull.configurationOnly }))
}

console.log('')
console.log('== K12 预览投影缓存 128 条上限（组件调用页级运行期） ==')
{
  const { bindVueFunctions } = await import('./_vueSetupHarness.mjs')
  const panelUrl = new URL('../src/components/calculator/PanelCalcSection.vue', import.meta.url)
  const { fixture, hit } = k1Fixture('ordinary')
  const runtime = createBuffCalculationRuntime(eventRuntimeInput(fixture))
  let panel = null
  try {
    panel = bindVueFunctions(panelUrl, ['getEventBuffPreviewInputs'], {
      props: { flowCalculationRuntime: runtime },
    })
  } catch (error) {
    check('K12 能绑定组件预览函数', false, String(error?.message ?? error))
  }
  if (panel) {
    const firstHit = { ...hit, id: 'proj-0' }
    const first = panel.getEventBuffPreviewInputs(0, firstHit, null)
    check('K12 首次预览是实际事件投影', first.contextKind === 'event')
    check('K12 同输入再取 → 复用同一投影对象', panel.getEventBuffPreviewInputs(0, firstHit, null) === first)
    for (let i = 1; i < 128; i += 1) {
      panel.getEventBuffPreviewInputs(0, { ...hit, id: `proj-${i}` }, null)
    }
    check('K12 第128条后首条仍在缓存', panel.getEventBuffPreviewInputs(0, firstHit, null) === first)
    panel.getEventBuffPreviewInputs(0, { ...hit, id: 'proj-128' }, null)
    const again = panel.getEventBuffPreviewInputs(0, firstHit, null)
    check('K12 被淘汰的输入重新计算（不再返回旧投影对象）', again !== first)
  }
  clearHitEvalCache()
}

console.log('')
console.log('== K6 详情实际采用：乘区角色由记录决定（不按伤害子类猜） ==')
{
  const buildUsage = (damageType) => {
    const effect = createEmptyBuffEffect({
      id: 'usage-bonus',
      stat: 'dmgBonus',
      value: 25,
      kind: 'fixed',
      enabledDefault: true,
      applyTarget: 'team',
      applyProfession: '支援',
    })
    const fixture = eventFixture({
      damageType,
      effects: [effect],
      agents: [testAgent('owner', { profession: '强攻' }), testAgent('power', { profession: '支援' })],
    })
    const detail = evaluateSkillFlowHit(fixture.context, null, fixture.hits[0], true)
    return detail.damageInputUsages ?? []
  }
  const disorder = buildUsage('disorder')
  const anomaly = buildUsage('attributeAnomaly')
  const has = (list, view, field) => list.some((usage) => usage.usedView === view && String(usage.field) === field)

  check('K6 紊乱：倍率面板字段标在强度提供者视图上',
    has(disorder, 'powerProviderPanel', 'disorderCompMult') &&
      has(disorder, 'powerProviderPanel', 'disorderBaseMultFactor'),
    JSON.stringify(disorder.filter((u) => String(u.field).includes('disorder')).map((u) => [u.usedView, String(u.field)])))
  check('K6 属性异常：不把紊乱/乱流倍率标成已采用',
    !disorder.length ? false : !has(anomaly, 'powerProviderPanel', 'disorderCompMult') &&
      !has(anomaly, 'powerProviderPanel', 'turbulenceCompMult'),
    JSON.stringify(anomaly.filter((u) => String(u.field).includes('Mult')).map((u) => [u.usedView, String(u.field)])))
  check('K6 防御区混拼：穿透与减防分别标到各自角色',
    has(anomaly, 'powerProviderPanel', 'penRate') &&
      (has(anomaly, 'anomalyTriggerPanel', 'ignoreDefense') || has(anomaly, 'ownerPanel', 'ignoreDefense')),
    JSON.stringify(anomaly.filter((u) => u.usedView === 'powerProviderPanel').map((u) => String(u.field))))
  check('K6 通用增伤/基础/精通都落在强度提供者视图',
    has(anomaly, 'powerProviderPanel', 'dmgBonus') &&
      has(anomaly, 'powerProviderPanel', 'atk') &&
      has(anomaly, 'powerProviderPanel', 'mastery'),
    '')
  const release = buildUsage('anomalyRelease')
  // 触发者 === 持有者时面板是同一个对象，按 owner 记（不伪造第二份归属）
  const bonusRoleFields = release
    .filter((usage) => usage.usedView === 'anomalyTriggerPanel' || usage.usedView === 'ownerPanel' || usage.usedView === 'releaseMult')
    .map((usage) => String(usage.field))
  check('K6 异放：类型增伤/倍率/暴击都标在触发者（或同一份 owner）视图上',
    bonusRoleFields.includes('anomalyReleaseDmgBonus') &&
      bonusRoleFields.includes('anomalyReleaseMult') &&
      bonusRoleFields.includes('anomalyReleaseCritDmg') &&
      !release.some((usage) => usage.usedView === 'powerProviderPanel' && String(usage.field).startsWith('anomalyRelease')),
    JSON.stringify(release.filter((u) => String(u.field).startsWith('anomalyRelease')).map((u) => [u.usedView, String(u.field)])))
  check('K6 异放不把紊乱/乱流字段标成已采用',
    !has(release, 'powerProviderPanel', 'disorderCompMult') &&
      !has(release, 'anomalyTriggerPanel', 'disorderDmgBonus'),
    JSON.stringify(release.map((u) => String(u.field))))
  check('K6 抗穿回退：接受触者/提供者任一侧，但必须有记录',
    anomaly.some((usage) => String(usage.field) === 'resPen'),
    JSON.stringify(anomaly.map((u) => String(u.field))))
}

console.log('')
console.log(`结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
if (failed > 0) process.exitCode = 1
if (failed > 0) process.exitCode = 1
if (failed > 0) process.exitCode = 1
if (failed > 0) process.exitCode = 1
