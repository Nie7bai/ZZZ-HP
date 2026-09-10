/**
 * 五大类技能等级 → 有效倍率 + nanoka 重导入只动倍率
 * 运行：npx vite-node scripts/test-skill-talent-levels.mjs
 */
import assert from 'node:assert/strict'
import {
  computeNanokaBaseMultPercent,
  createDefaultSkillTalentLevels,
  resolveEffectiveBaseMult,
  resolveSkillTalentLevelKey,
} from '../src/utils/skillTalentLevels.ts'
import {
  computeBaseMultPercent,
  planAgentImport,
} from '../../zzz-hp-backend/scripts/import-nanoka-skills.mjs'

let failed = 0
function check(name, actual, expected) {
  try {
    assert.deepEqual(actual, expected)
    console.log(`PASS  ${name}`)
  } catch (err) {
    failed += 1
    console.log(`FAIL  ${name}`)
    console.log(`  期望 ${JSON.stringify(expected)}`)
    console.log(`  实际 ${JSON.stringify(actual)}`)
    console.log(`  ${err instanceof Error ? err.message : err}`)
  }
}

console.log('=== 1. 类型 → 大类键 ===')
check('basic', resolveSkillTalentLevelKey(['basic']), 'basic')
check('dash→dodge', resolveSkillTalentLevelKey(['dash']), 'dodge')
check('dodgeCounter→dodge', resolveSkillTalentLevelKey(['dodgeCounter']), 'dodge')
check('specialEnhanced→special', resolveSkillTalentLevelKey(['specialEnhanced']), 'special')
check('chain→chainUltimate', resolveSkillTalentLevelKey(['chain']), 'chainUltimate')
check('ultimate→chainUltimate', resolveSkillTalentLevelKey(['ultimate']), 'chainUltimate')
check('followUp only → null', resolveSkillTalentLevelKey(['followUp']), null)
check('followUp+special → special', resolveSkillTalentLevelKey(['followUp', 'special']), 'special')

console.log('\n=== 2. nanoka L 公式（与导入脚本一致） ===')
const pct = 3120
const growth = 210
check('L1', computeNanokaBaseMultPercent(pct, growth, 1), 31.2)
check('L12', computeNanokaBaseMultPercent(pct, growth, 12), computeBaseMultPercent(pct, growth, 12))
check('L7', computeNanokaBaseMultPercent(pct, growth, 7), computeBaseMultPercent(pct, growth, 7))

console.log('\n=== 3. resolveEffectiveBaseMult ===')
const nanokaSkill = {
  baseMult: computeNanokaBaseMultPercent(pct, growth, 12),
  damageType: 'direct',
  skillTypes: ['special'],
  multSource: 'nanoka',
  damagePercentage: pct,
  damagePercentageGrowth: growth,
}
const levels = { ...createDefaultSkillTalentLevels(), special: 7 }
check(
  'nanoka special L7',
  resolveEffectiveBaseMult(nanokaSkill, levels).baseMult,
  computeNanokaBaseMultPercent(pct, growth, 7),
)
check('nanoka 缺省 L12', resolveEffectiveBaseMult(nanokaSkill, null).baseMult, nanokaSkill.baseMult)
check(
  '手建不缩放',
  resolveEffectiveBaseMult(
    { ...nanokaSkill, multSource: null, baseMult: 88 },
    levels,
  ).baseMult,
  88,
)
check(
  '异常不缩放',
  resolveEffectiveBaseMult(
    { ...nanokaSkill, damageType: 'anomaly', baseMult: 50 },
    levels,
  ).baseMult,
  50,
)
check(
  '仅 followUp 不缩放',
  resolveEffectiveBaseMult(
    { ...nanokaSkill, skillTypes: ['followUp'], baseMult: 40 },
    levels,
  ).baseMult,
  40,
)
check(
  'chain+ultimate 共用 chainUltimate',
  resolveEffectiveBaseMult(
    { ...nanokaSkill, skillTypes: ['ultimate'] },
    { ...levels, chainUltimate: 5 },
  ).baseMult,
  computeNanokaBaseMultPercent(pct, growth, 5),
)

console.log('\n=== 4. nanoka overwrite 只更新倍率相关 ===')
const existing = {
  id: 'sk-a',
  agentId: 'agent-a',
  name: '普攻伤害倍率',
  damageType: 'direct',
  skillTypes: ['basic'],
  buffAnchorId: 'anchor-manual',
  element: '火',
  note: '手改备注',
  baseMult: 10,
  baseMultFactor: 100,
  settlementMult: 0,
  multSource: null,
}
const { report, planned } = planAgentImport({
  agentId: 'agent-a',
  agentElement: '冰',
  segments: [
    {
      displayName: '普攻伤害倍率',
      baseMult: 40,
      damagePercentage: 3000,
      damagePercentageGrowth: 100,
      skillTypes: ['special'],
      nanokaSkillId: 'n1',
      paramName: '伤害倍率',
      category: 'basic',
      skillName: '普攻',
      titleCore: '普攻',
    },
  ],
  existingSkills: [existing],
  subcategories: [],
})
check('overwrite 条数', report.overwrite.length, 1)
const doc = planned[0]?.doc
check('保留 skillTypes', doc?.skillTypes, ['basic'])
check('保留 element', doc?.element, '火')
check('保留 buffAnchorId', doc?.buffAnchorId, 'anchor-manual')
check('保留 note', doc?.note, '手改备注')
check('写入 multSource', doc?.multSource, 'nanoka')
check('写入 damagePercentage', doc?.damagePercentage, 3000)
check('写入 growth', doc?.damagePercentageGrowth, 100)
check('写入 baseMult', doc?.baseMult, 40)

if (failed) {
  console.error(`\n${failed} 项失败`)
  process.exitCode = 1
} else {
  console.log('\n全部通过')
}
