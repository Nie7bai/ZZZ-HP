/**
 * 招式结算记忆表（`utils/hitEvalCache.ts`）的守卫测试。
 *
 * 这张表是「按输入分键」的：键漏掉任何一个影响结果的字段，就会命中过期结果 ——
 * 数字看着像对的但是错的，且不会有任何报错。所以这里逐字段验证**键会随输入变化**。
 *
 * 运行：npx vite-node scripts/test-hit-eval-cache.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'
import { computed, reactive, ref } from 'vue'
import { FRONTEND_ROOT } from './_paths.mjs'
import { eventFixture, eventRuntimeInput } from './_eventElementHarness.mjs'
import { createEmptyBuffEffect } from '../src/utils/buffEffect.ts'
import { createBuffCalculationRuntime, evaluateSkillFlowHit } from '../src/utils/skillFlowCalculation.ts'
import { skillTalentLevelBoundsForRank } from '../src/utils/skillTalentLevels.ts'
import { buildSkillFlowHitContextSignature } from '../src/utils/skillFlowPanelSource.ts'
import {
  buildHitEvalContextSignature,
  buildHitEvalFingerprint,
  clearHitEvalCache,
  hitEvalCacheDebugStats,
  hitEvalCacheKey,
  internHitEvalContext,
  readHitEvalCache,
  writeHitEvalCache,
} from '../src/utils/hitEvalCache.ts'

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

const baseHit = {
  id: 'flow-1',
  // 与真实命中同形：`ResolvedHit` 的字段全部带上（可为 null），避免夹具与生产形状不一致
  elementOverride: null,
  buffOverride: null,
  ownerAgentId: 'velina',
  anomalyPowerAgentId: 'piper',
  triggerAgentId: 'remiel',
  count: 3,
  staggerPhase: 'stagger',
  critMode: 'expected',
  damageKind: 'anomaly',
  anomalySubKind: 'attributeAnomaly',
  directSubKind: 'normal',
  coords: [],
  isFollowUp: false,
  multOverrides: null,
  panelMods: null,
  effectiveBaseMult: 100,
  skillTalentLevel: 12,
  skill: {
    id: 'dev-1',
    name: '测试招式',
    damageType: 'attributeAnomaly',
    baseMult: 100,
    skillTypes: [],
    buffAnchorId: null,
    baseMultFactor: 100,
    settlementMult: 0,
  },
}

const basePanel = { hp: 10000, atk: 2000, critRate: 50, critDmg: 100, mastery: 100 }

console.log('== 招式指纹 ==')
{
  const a = buildHitEvalFingerprint(baseHit)
  const b = buildHitEvalFingerprint({ ...baseHit })
  check('同一招式 → 指纹相同', a === b)

  const changed = [
    ['count', { count: 4 }],
    ['ownerAgentId', { ownerAgentId: 'piper' }],
    ['anomalyPowerAgentId', { anomalyPowerAgentId: 'velina' }],
    ['triggerAgentId', { triggerAgentId: 'velina' }],
    ['staggerPhase', { staggerPhase: 'normal' }],
    ['critMode', { critMode: 'crit' }],
    ['anomalySubKind', { anomalySubKind: 'disorder' }],
    ['effectiveBaseMult', { effectiveBaseMult: 101 }],
    ['skillTalentLevel', { skillTalentLevel: 11 }],
    ['multOverrides', { multOverrides: { directDmgMult: 1 } }],
    ['panelMods', { panelMods: { dmgBonus: 1 } }],
    ['skill.id', { skill: { ...baseHit.skill, id: 'dev-2' } }],
    ['skill.damageType', { skill: { ...baseHit.skill, damageType: 'direct' } }],
    ['skill.baseMult', { skill: { ...baseHit.skill, baseMult: 101 } }],
    ['skill.baseMultFactor', { skill: { ...baseHit.skill, baseMultFactor: 101 } }],
    ['skill.settlementMult', { skill: { ...baseHit.skill, settlementMult: 1 } }],
    ['skill.buffAnchorId', { skill: { ...baseHit.skill, buffAnchorId: 'x' } }],
    ['skill.skillTypes', { skill: { ...baseHit.skill, skillTypes: ['ultimate'] } }],
    ['hit.id', { id: 'flow-2' }],
  ]
  for (const [label, patch] of changed) {
    check(`改 ${label} → 指纹变化`, buildHitEvalFingerprint({ ...baseHit, ...patch }) !== a)
  }
}

console.log('== 键：招式 + 上下文 + 面板 + 是否带明细 ==')
{
  const fp = buildHitEvalFingerprint(baseHit)
  const ctxSig = internHitEvalContext('ctx-A')
  const key = hitEvalCacheKey(fp, ctxSig, basePanel, false)

  check('同输入 → 同键', hitEvalCacheKey(fp, ctxSig, { ...basePanel }, false) === key)
  check(
    '换主 C 面板 → 键不同（这就是「用哪份面板」那根轴）',
    hitEvalCacheKey(fp, ctxSig, { ...basePanel, atk: 2001 }, false) !== key,
  )
  check(
    '上下文签名不同 → 键不同',
    hitEvalCacheKey(fp, internHitEvalContext('ctx-B'), basePanel, false) !== key,
  )
  check(
    '同一份上下文 → 同一令牌（两个消费者必须拿到同一个）',
    internHitEvalContext('ctx-A') === ctxSig,
  )
  check(
    '同招式同面板、一个要明细一个不要 → 键不同',
    hitEvalCacheKey(fp, ctxSig, basePanel, true) !== key,
  )
}

console.log('== 表读写与容量 ==')
{
  clearHitEvalCache()
  const fp = buildHitEvalFingerprint(baseHit)
  const key = hitEvalCacheKey(fp, internHitEvalContext('ctx-A'), basePanel, false)
  const entry = { hitId: baseHit.id, perHit: 10, total: 30, result: { ok: true } }

  check('未写入时读不到', readHitEvalCache(key) === null)
  writeHitEvalCache(key, entry)
  check('写入后读到同一条', readHitEvalCache(key) === entry)

  const before = hitEvalCacheDebugStats()
  check('命中计数 +1', before.hits === 1 && before.misses === 1, JSON.stringify(before))

  clearHitEvalCache()
  check('清空后读不到', readHitEvalCache(key) === null)
  check('清空后计数归零', hitEvalCacheDebugStats().size === 0)

  // 容量上限：超限后最早写入的被淘汰，最新写入的还在
  const limit = hitEvalCacheDebugStats().limit
  for (let i = 0; i < limit + 10; i += 1) {
    writeHitEvalCache(`k-${i}`, { hitId: `h-${i}`, perHit: i, total: i, result: {} })
  }
  check('条目数不超过上限', hitEvalCacheDebugStats().size === limit)
  check('最早的已被淘汰', readHitEvalCache('k-0') === null)
  check('最新的仍在', readHitEvalCache(`k-${limit + 9}`) != null)
  clearHitEvalCache()
}

console.log('== 令牌表：同内容必须得到同令牌 ==')
{
  const a = internHitEvalContext('sig-1')
  const b = internHitEvalContext('sig-1')
  const c = internHitEvalContext('sig-2')
  check('同签名 → 同令牌（两个消费者靠这个共用同一行）', a === b)
  check('不同签名 → 不同令牌', a !== c)
}

{
  const auto = buildHitEvalFingerprint({ ...baseHit, elementOverride: null })
  const fire = buildHitEvalFingerprint({ ...baseHit, elementOverride: '火' })
  const ice = buildHitEvalFingerprint({ ...baseHit, elementOverride: '冰' })
  check('E8 event override changes fingerprint', auto !== fire && fire !== ice)
  check('E8 clearing override restores automatic fingerprint', auto === buildHitEvalFingerprint({ ...baseHit }))
}

/**
 * K17：来源角色技能等级必须进上下文身份（C7 已隔离复现的缺陷）。
 *
 * 为什么不用手抄的字段表：那样测的是抄件，不是组件里跑的那份签名。
 * 这里直接从 `PanelCalcSection.vue` 抽取 `hitCalcGlobalSignature` 的 computed 表达式
 * 在内存里编译执行，配 Vue 响应式 props，改 `skillTalentLevelsByAgent` 观察是否重算。
 */
function buildPanelSignatureRunner() {
  const componentFile = path.join(FRONTEND_ROOT, 'src', 'components', 'calculator', 'PanelCalcSection.vue')
  const setup = parse(fs.readFileSync(componentFile, 'utf8')).descriptor.scriptSetup?.content
  if (!setup) throw new Error(`读不到 script setup：${componentFile}`)
  const ast = ts.createSourceFile('setup.ts', setup, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = ast.statements
    .filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .find((node) => node.name.getText(ast) === 'hitCalcGlobalSignature')
  if (!declaration?.initializer) {
    throw new Error('PanelCalcSection.vue 里找不到 hitCalcGlobalSignature 的 computed 声明，K17 需要更新抽取方式')
  }
  const body =
    ts.transpileModule(`const value = ${declaration.initializer.getText(ast)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText + '\nreturn value;'
  return (bindings) => {
    const runtime = computed(() => createBuffCalculationRuntime(eventRuntimeInput(bindings.fixture, {
      contextInput: { teamSlots:bindings.props.teamSlots, agents:bindings.props.agents,
        skillTalentLevelsByAgent:bindings.props.skillTalentLevelsByAgent,
        extraGains:bindings.extraGains.value, environmentBuffs:bindings.props.environmentBuffs ?? [],
        bangbooRefine:bindings.props.bangbooRefine, activeSlotPanels:bindings.resolvedActiveSlotPanels.value,
      }, mainExternal:bindings.externalPanel, globalDamageKind:bindings.props.damageKind, staggerPhase:bindings.props.staggerPhase,
    })))
    Object.defineProperty(bindings.props,'flowCalculationRuntime',{get:()=>runtime.value,configurable:true})
    return new Function(...Object.keys(bindings), body)(...Object.values(bindings))
  }
}

console.log('== K17：来源角色技能等级 → 上下文身份（真实 Panel 签名 + 生产缓存） ==')
{
  let runSignature = null
  try {
    runSignature = buildPanelSignatureRunner()
  } catch (error) {
    check('能抽取 PanelCalcSection 的签名表达式', false, String(error?.message ?? error))
  }

  for (const mode of ['ordinary', 'extra-team']) {
    clearHitEvalCache()
    const effect = createEmptyBuffEffect({
      id: 'level-convert',
      kind: 'convert',
      stat: 'dmgBonus',
      enabledDefault: true,
      applyTarget: 'team',
      convert: { from: 'skillLevelBasic', panelSource: 'external', ratioPercent: 100, initialBase: 0, cap: null },
    })
    const fixture = eventFixture({ mode, damageType: 'direct', sourceSlot: 1, effects: [effect] })
    const hit = fixture.hits[0]
    hit.multOverrides = { ...hit.multOverrides, directDmgMult: 100 }

    // 影画 0 的合法等级范围是 1–12：8 → 12 两个值都合法（12→20 超界，不能当用户输入）
    const bounds = skillTalentLevelBoundsForRank(0)
    check(
      `${mode}｜8 与 12 都在影画0合法范围内`,
      (bounds?.min ?? 1) <= 8 && 12 <= (bounds?.max ?? 12),
      JSON.stringify(bounds),
    )

    const levels = reactive({ power: { basic: 8 } })
    fixture.context.panelContext.skillTalentLevelsByAgent = levels
    fixture.context.skillTalentLevelsByAgent = levels
    const props = reactive({
      agents: fixture.agents,
      teamSlots: structuredClone(fixture.teamSlots),
      editedSlotIndex: 0,
      selectedBangbooId: 'none',
      bangbooRefine: 1,
      calcMode: 'panel',
      staggerPhase: 'stagger',
      damageKind: 'direct',
      skillTalentLevelsByAgent: levels,
    })
    const bindings = {
      fixture,
      computed,
      props,
      resolveActivePanel: () => null,
      baseDamageSource: ref('atk'),
      slotBuffSelectionsSignature: ref('{}'),
      convertSlotPanelsSignature: ref('{}'),
      resolvedActiveSlotPanels: ref(fixture.panels),
      extraGains: ref(fixture.extraGains),
      enemyInput: ref(fixture.context.enemyInput),
      externalPanel: fixture.panels.owner,
      affixCounts: {},
      affixDriveDiscMainStats: {},
      buildSkillFlowHitContextSignature,
      skillTalentLevelsByAgent: levels,
    }
    if (!runSignature) continue

    let signature
    try {
      signature = runSignature(bindings)
    } catch (error) {
      check(`${mode}｜签名表达式可在测试内执行`, false, String(error?.message ?? error))
      continue
    }

    const external = fixture.panels.owner
    const oldSignature = signature.value
    const oldFingerprint = buildHitEvalFingerprint(hit)
    const oldKey = hitEvalCacheKey(oldFingerprint, internHitEvalContext(oldSignature), external, false)
    const oldResult = evaluateSkillFlowHit(fixture.context, external, hit)
    writeHitEvalCache(oldKey, { hitId: hit.id, ...oldResult })

    // 只改来源角色的普攻等级；影画、hit 指纹、主槽面板都不动
    props.skillTalentLevelsByAgent.power.basic = 12
    const newSignature = signature.value
    const newFingerprint = buildHitEvalFingerprint(hit)
    const newKey = hitEvalCacheKey(newFingerprint, internHitEvalContext(newSignature), external, false)
    const fresh = evaluateSkillFlowHit(fixture.context, external, hit)
    const stale = readHitEvalCache(newKey)

    check(`${mode}｜旧：增伤 8 / 伤害 1006`, Math.abs(oldResult.finalPanel.dmgBonus - 8) < 1e-6 && Math.abs(oldResult.total - 1006) < 1e-6,
      `bonus=${oldResult.finalPanel.dmgBonus} total=${oldResult.total}`)
    check(`${mode}｜新：增伤 12 / 伤害 1044`, Math.abs(fresh.finalPanel.dmgBonus - 12) < 1e-6 && Math.abs(fresh.total - 1044) < 1e-6,
      `bonus=${fresh.finalPanel.dmgBonus} total=${fresh.total}`)
    check(`${mode}｜改等级前后 hit 指纹不变（隔离其他键轴）`, oldFingerprint === newFingerprint)
    check(`${mode}｜改来源技能等级 → 上下文签名必须变化`, oldSignature !== newSignature,
      oldSignature === newSignature ? '签名未变，技能等级没进身份' : undefined)
    check(`${mode}｜改来源技能等级 → 缓存键必须变化`, oldKey !== newKey,
      oldKey === newKey ? '键未变，会命中旧结果' : undefined)
    check(`${mode}｜新键不得命中旧结果`, stale == null, stale ? `读到 total=${stale.total}` : undefined)

    // 反例对照：本来就该变化的两个轴必须仍然变化（不是靠全局失效凑绿）
    props.teamSlots[1].rank = 3
    check(`${mode}｜对照：改影画 rank → 签名变化`, signature.value !== newSignature)
    props.teamSlots[1].rank = 0
    const multFingerprint = buildHitEvalFingerprint({
      ...hit,
      effectiveBaseMult: hit.effectiveBaseMult + 1,
      skillTalentLevel: hit.skillTalentLevel === 8 ? 12 : 8,
    })
    check(`${mode}｜对照：改事件自身倍率/等级 → hit 指纹变化`, multFingerprint !== newFingerprint)
  }
  clearHitEvalCache()
}

console.log('== K12：逐轴失效（真实 Panel 签名 + 生产键） ==')
{
  let runSignature = null
  try {
    runSignature = buildPanelSignatureRunner()
  } catch (error) {
    check('K12 能抽取 Panel 签名表达式', false, String(error?.message ?? error))
  }
  if (runSignature) {
    const effect = createEmptyBuffEffect({
      id: 'axis-convert',
      kind: 'convert',
      stat: 'dmgBonus',
      enabledDefault: true,
      applyTarget: 'team',
      convert: { from: 'skillLevelBasic', panelSource: 'external', ratioPercent: 100, initialBase: 0, cap: null },
    })
    const fixture = eventFixture({ mode: 'ordinary', damageType: 'direct', sourceSlot: 1, effects: [effect] })
    const hit = fixture.hits[0]
    hit.multOverrides = { ...hit.multOverrides, directDmgMult: 100 }
    const levels = reactive({ power: { basic: 8 } })
    fixture.context.panelContext.skillTalentLevelsByAgent = levels
    const props = reactive({
      agents: fixture.agents,
      teamSlots: structuredClone(fixture.teamSlots),
      editedSlotIndex: 0,
      selectedBangbooId: 'none',
      bangbooRefine: 1,
      calcMode: 'panel',
      staggerPhase: 'stagger',
      damageKind: 'direct',
      skillTalentLevelsByAgent: levels,
    })
    const envBuffs = reactive([])
    const extraGains = ref(fixture.extraGains)
    const externalPanel = reactive({ ...fixture.panels.owner })
    const bindings = {
      fixture,
      computed,
      props,
      resolveActivePanel: () => null,
      baseDamageSource: ref('atk'),
      slotBuffSelectionsSignature: ref('{}'),
      convertSlotPanelsSignature: ref('{}'),
      resolvedActiveSlotPanels: ref(fixture.panels),
      extraGains,
      enemyInput: ref(fixture.context.enemyInput),
      externalPanel,
      affixCounts: {},
      affixDriveDiscMainStats: {},
      buildSkillFlowHitContextSignature,
      skillTalentLevelsByAgent: levels,
    }
    props.environmentBuffs = envBuffs
    const signature = runSignature(bindings)
    const baselineSignature = signature.value
    const baselineKey = hitEvalCacheKey(
      buildHitEvalFingerprint(hit),
      internHitEvalContext(baselineSignature),
      externalPanel,
      false,
    )

    // 1) 角色属性轴（元素）
    props.agents[0].element = '冰'
    check('K12 改元素 → 签名变化', signature.value !== baselineSignature)
    props.agents[0].element = '电'

    // 2) 精炼 / 音擎（只在 teamSlots 里体现）
    props.teamSlots[1].wengineRefine = 3
    check('K12 改精炼 → 签名变化', signature.value !== baselineSignature)
    props.teamSlots[1].wengineRefine = 1

    // 3) 来源面板（主槽 external 进键，也进签名）
    externalPanel.atk = externalPanel.atk + 10
    const panelKey = hitEvalCacheKey(
      buildHitEvalFingerprint(hit),
      internHitEvalContext(signature.value),
      externalPanel,
      false,
    )
    check('K12 改主槽面板 → 键变化', panelKey !== baselineKey)
    externalPanel.atk = externalPanel.atk - 10

    // 4) 环境 Buff
    envBuffs.push({ id: 'env-x' })
    check('K12 改环境 → 签名变化', signature.value !== baselineSignature)
    envBuffs.pop()

    // 5) 额外/候选增益
    extraGains.value = [{ ...fixture.extraGains[0], id: 'extra-changed' }]
    check('K12 改额外增益 → 签名变化', signature.value !== baselineSignature)
    extraGains.value = fixture.extraGains

    // 6) 行级例外（hit 指纹轴）
    const rowHit = { ...hit, buffOverride: { disabledEffectIds: ['x'] } }
    check(
      'K12 改行级例外 → hit 指纹变化',
      buildHitEvalFingerprint(rowHit) !== buildHitEvalFingerprint(hit),
    )

    // 7) 计算方式 / 招式类别
    props.damageKind = 'anomaly'
    check('K12 改伤害类别 → 签名变化', signature.value !== baselineSignature)
    props.damageKind = 'direct'

    check('K12 全部复原后签名回到基线', signature.value === baselineSignature)
  }
  clearHitEvalCache()
}

console.log('== K12：上下文令牌表 50 条容量 ==')
{
  const first = internHitEvalContext('ctx-evict-A')
  check('K12 未溢出时同签名 → 同令牌', internHitEvalContext('ctx-evict-A') === first)
  for (let i = 0; i < 55; i += 1) internHitEvalContext(`ctx-evict-filler-${i}`)
  const again = internHitEvalContext('ctx-evict-A')
  check('K12 令牌表溢出后旧令牌被淘汰（不再可寻址）', again !== first, `${first} → ${again}`)
  const newest = internHitEvalContext('ctx-evict-filler-54')
  check('K12 最新令牌仍在', typeof newest === 'string' && newest.startsWith('ctx-'))
}

console.log('')
console.log(`结果：${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
if (failed > 0) process.exitCode = 1
