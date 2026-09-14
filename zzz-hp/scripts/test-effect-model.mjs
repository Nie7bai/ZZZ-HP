/**
 * 阶段 2：EffectSpec / 适配器 / 编译器。不切换生产路径。
 * 运行：npx vite-node scripts/test-effect-model.mjs
 */
import { adaptAffixLibraryEntry, adaptBuffEffect } from '../src/utils/effectAdapters.ts'
import { compileEffectPlan, compileCollectedBuffs } from '../src/utils/effectCompiler.ts'
import { affixPanelOperation, stageForAffixTarget, statCombineRule } from '../src/utils/effectStatRegistry.ts'
import { collectAllBuffEffects } from '../src/utils/panelBuffCalc.ts'
import {
  affixEntry,
  convertEffect,
  fixedEffect,
  makePanelCtx,
  mindscapeWithEffects,
  testAgent,
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

console.log('\n[1] 注册表')
check('penRate 加算', statCombineRule('penRate') === 'add')
check('energyRegen 按基础乘算', statCombineRule('energyRegen') === 'percentOfBase')
check('directDmgMultFactor 是倍率修正', statCombineRule('directDmgMultFactor') === 'multiplyFactor')
check('panel: 冲击力加算', affixPanelOperation('impact') === 'add')
check('panel: 异常掌控按基础', affixPanelOperation('anomalyControl') === 'percentOfBase')
check('gain: 阶段是 combatPreConvert', stageForAffixTarget('gain:inCombatAtkPercent') === 'combatPreConvert')
check('panel: 阶段是 external', stageForAffixTarget('panel:penRate') === 'external')

console.log('\n[2] BuffEffect 适配')
{
  const fx = fixedEffect('a', 'dmgBonus', 12, {
    scope: 'skill',
    skillTargets: [{ category: 'basic', subcategoryId: null }],
  })
  const spec = adaptBuffEffect(fx)
  check('固定效果 stage=combatPreConvert', spec.stage === 'combatPreConvert')
  check('stat 保留 dmgBonus', spec.stat === 'dmgBonus')
  check('招式条件带上', spec.conditions.skillTargets?.[0]?.category === 'basic')
  check('scope 招式进 conditions', spec.conditions.scope === 'skill')

  const cv = convertEffect('c', 'atk', { from: 'mastery', panelSource: 'final', ratioPercent: 80 })
  const cvSpec = adaptBuffEffect(cv)
  check('转模 operation=convert', cvSpec.operation === 'convert' && cvSpec.stage === 'convert')
  check('转模读 final', cvSpec.convert?.panelSource === 'final')
}

console.log('\n[3] 词条适配带命名空间')
{
  const panel = adaptAffixLibraryEntry(affixEntry('p', 'panel:penRate', 24), 1)
  const gain = adaptAffixLibraryEntry(affixEntry('g', 'gain:penRate', 24), 1)
  check('panel:penRate 是 effect', panel?.type === 'effect')
  check('gain:penRate 是 effect', gain?.type === 'effect')
  check(
    '同名字段不同 sourceFamily',
    panel?.type === 'effect' &&
      gain?.type === 'effect' &&
      panel.instance.sourceFamily === 'affix-panel' &&
      gain.instance.sourceFamily === 'affix-gain' &&
      panel.instance.stage === 'external' &&
      gain.instance.stage === 'combatPreConvert',
  )
  const scoped = adaptAffixLibraryEntry(
    { ...affixEntry('sc', 'gain:dmgBonus', 15), scope: 'skill', skillCategory: 'basic' },
    1,
  )
  check(
    'gain: 招式条件进适配器',
    scoped?.type === 'effect' && scoped.instance.conditions.skillTargets?.[0]?.category === 'basic',
  )
  const stat = adaptAffixLibraryEntry(affixEntry('s', 'stat:atkPercent', 3), 2)
  check('stat: 仍走计数桶', stat?.type === 'count' && stat.statKey === 'atkPercent')
}

console.log('\n[4] 编译器按阶段分桶且稳定')
{
  const fx = fixedEffect('z', 'critRate', 5)
  const cv = convertEffect('c', 'atk', { from: 'mastery', panelSource: 'external', ratioPercent: 10 })
  const ctx = makePanelCtx({
    agents: [testAgent('a', { mindscapeBuffs: mindscapeWithEffects([fx, cv]) })],
  })
  const plan = compileCollectedBuffs(collectAllBuffEffects(ctx))
  check('有 combatPreConvert', plan.byStage.combatPreConvert.length >= 1)
  check('有 convert', plan.byStage.convert.length >= 1)
  const again = compileEffectPlan([...plan.instances].reverse())
  check(
    '实例顺序稳定',
    again.instances.map((i) => i.instanceId).join('|') ===
      plan.instances.map((i) => i.instanceId).join('|'),
  )
}

console.log(`\n结果：${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
