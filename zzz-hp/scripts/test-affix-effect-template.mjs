/**
 * 词条预设效果模板：从 target 编出的 spec 必须与适配器同构。
 * 运行：npx vite-node scripts/test-affix-effect-template.mjs
 */
import { adaptAffixLibraryEntry } from '../src/utils/effectAdapters.ts'
import {
  buildAffixEffectTemplate,
  parseAffixEffectTemplate,
} from '../src/utils/affixEffectTemplate.ts'
import { parseAffixPresetEntries } from '../src/utils/affixLibrary.ts'
import { affixEntry } from './_effectPipelineHarness.mjs'

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

console.log('\n[1] stat: 仍是计数桶')
{
  const entry = affixEntry('substat:critRate', 'stat:critRate', 2.4)
  const template = buildAffixEffectTemplate(entry)
  const allocated = adaptAffixLibraryEntry(entry, 3)
  check('模板 allocation=count', template?.allocation === 'count')
  check('适配器仍是 count', allocated?.type === 'count')
  check('等效档数按每档折算', allocated?.type === 'count' && allocated.equivalentRolls === 3)
}

console.log('\n[2] panel: / gain: 模板与适配器同构')
{
  const panel = affixEntry('panel:penRate', 'panel:penRate', 24)
  const fromTarget = adaptAffixLibraryEntry(panel, 1)
  const stored = { ...panel, effectTemplate: buildAffixEffectTemplate(panel) ?? undefined }
  const fromStored = adaptAffixLibraryEntry(stored, 1)
  check('panel 模板是 effect', stored.effectTemplate?.allocation === 'effect')
  check('panel 阶段 external', stored.effectTemplate?.allocation === 'effect' && stored.effectTemplate.spec.stage === 'external')
  check('有无模板适配结果同构', JSON.stringify(fromTarget) === JSON.stringify(fromStored))
  check('panel 走 affix-panel', fromTarget?.type === 'effect' && fromTarget.instance.sourceFamily === 'affix-panel')

  const gain = {
    ...affixEntry('gain-basic', 'gain:dmgBonus', 15),
    scope: 'skill',
    skillCategory: 'basic',
  }
  const gainTemplate = buildAffixEffectTemplate(gain)
  const gainAlloc = adaptAffixLibraryEntry({ ...gain, effectTemplate: gainTemplate ?? undefined }, 1)
  check('gain 阶段 combatPreConvert', gainTemplate?.allocation === 'effect' && gainTemplate.spec.stage === 'combatPreConvert')
  check(
    '招式条件进 spec',
    gainTemplate?.allocation === 'effect' &&
      gainTemplate.spec.conditions.skillTargets?.[0]?.category === 'basic',
  )
  check('gain 走 affix-gain', gainAlloc?.type === 'effect' && gainAlloc.instance.sourceFamily === 'affix-gain')
}

console.log('\n[3] 读新优先：effectJson 条件能抬到条目上')
{
  const raw = [
    {
      id: 'gain-basic',
      label: '普攻增伤',
      target: 'gain:dmgBonus',
      perRoll: 15,
      cap: 1,
      group: '',
      rollCost: 1,
      enabledByDefault: true,
      effectJson: buildAffixEffectTemplate({
        id: 'gain-basic',
        label: '普攻增伤',
        target: 'gain:dmgBonus',
        perRoll: 15,
        cap: 1,
        group: '',
        rollCost: 1,
        enabledByDefault: true,
        scope: 'skill',
        skillCategory: 'basic',
      }),
    },
  ]
  const { entries, skipped } = parseAffixPresetEntries(raw)
  check('没有跳过', skipped === 0)
  check('抄上 scope=skill', entries[0]?.scope === 'skill')
  check('抄上招式大类', entries[0]?.skillCategory === 'basic')
}

console.log('\n[4] 坏模板回退 target')
{
  const entry = affixEntry('panel:penRate', 'panel:penRate', 24)
  const parsed = parseAffixEffectTemplate({ version: 1, allocation: 'nope' })
  const allocated = adaptAffixLibraryEntry({ ...entry, effectTemplate: parsed ?? undefined }, 1)
  check('坏模板 parse 失败', parsed === null)
  check('仍能从 target 编出 panel 效果', allocated?.type === 'effect')
}

if (failed) {
  console.log(`\n结果：${passed} passed, ${failed} failed`)
  process.exit(1)
}
console.log(`\n结果：${passed} passed, 0 failed`)
