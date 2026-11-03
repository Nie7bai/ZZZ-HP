/**
 * 方案的环境 Buff 勾选快照：抓取、按 id 精确恢复、按名称 + 数值重建、缺失计数。
 * 运行：npx vite-node scripts/test-scheme-env-buff.mjs
 */
import { readFileSync } from 'node:fs'
import {
  applySchemeEnvironmentBuffChecks,
  captureSchemeEnvironmentBuffChecks,
} from '../src/utils/schemeEnvironmentBuff.ts'
import { createEmptyMultiSlotBuffSelection, createEmptyBuffSelectionState } from '../src/utils/panelBuffCalc.ts'

let failed = 0
let passed = 0

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function catalogEntry({
  kind = 'crisis',
  id = '10',
  name = '强攻型',
  blockId = 'blk-a',
  blockName = '效果',
  effects = [
    { id: 'eff-1', stat: 'dmgBonus', value: 30 },
    { id: 'eff-2', stat: 'critRate', value: 10 },
  ],
} = {}) {
  const sourceKey = kind === 'crisis' ? `crisis-buff-${id}` : `defense-buff-${id}`
  return {
    kind,
    id: String(id),
    sourceKey,
    name,
    effectBlocks: [
      {
        id: blockId,
        name: blockName,
        effects: effects.map((effect) => ({ ...effect })),
      },
    ],
  }
}

console.log('[1] 抓取：只收环境 Buff，且按 team / 槽位分组')

const catalog = [catalogEntry()]
const selection = createEmptyMultiSlotBuffSelection()
selection.team.enabledIds['crisis-buff-10::blk-a::eff-1'] = true
selection.team.enabledIds['crisis-buff-10::blk-a::eff-2'] = true
selection.team.enabledIds['agent-0-mindscape-1::blk::eff'] = true
selection.bySlot[1] = createEmptyBuffSelectionState()
selection.bySlot[1].enabledIds['crisis-buff-10::blk-a::eff-2'] = true

const checks = captureSchemeEnvironmentBuffChecks(selection, catalog)
check('全队抓到 1 张卡', checks.team.length === 1)
check('全队抓到 2 条效果', checks.team[0]?.effects.length === 2)
check('非环境 id 不收', !JSON.stringify(checks.team).includes('agent-0'))
check('槽位 1 单独一组', checks.bySlot['1']?.[0]?.effects.length === 1)
check('卡片带名字与 kind', checks.team[0]?.name === '强攻型' && checks.team[0]?.kind === 'crisis')

console.log('[2] 恢复：同 id 精确命中')

const restored = createEmptyMultiSlotBuffSelection()
const exact = applySchemeEnvironmentBuffChecks(restored, checks, catalog)
check('applied=3 / remapped=0', exact.applied === 3 && exact.remapped === 0, JSON.stringify(exact))
check('全队勾选写回', restored.team.enabledIds['crisis-buff-10::blk-a::eff-1'] === true)
check('槽位勾选写回槽位', restored.bySlot[1]?.enabledIds['crisis-buff-10::blk-a::eff-2'] === true)
check('标记为用户手动（不再被默认同步覆盖）', restored.team.manualTouchedIds?.['crisis-buff-10::blk-a::eff-1'] === true)
check('槽位 1 没有多出全队那条', !restored.bySlot[1]?.enabledIds['crisis-buff-10::blk-a::eff-1'])

console.log('[3] 恢复：效果 id 漂移时按 stat + 数值重建')

const drifted = [catalogEntry({ blockId: 'blk-new', blockName: '第2间', effects: [
  { id: 'eff-new-1', stat: 'dmgBonus', value: 30 },
  { id: 'eff-new-2', stat: 'critRate', value: 10 },
] }) ]
const rebuilt = createEmptyMultiSlotBuffSelection()
const remapResult = applySchemeEnvironmentBuffChecks(rebuilt, checks, drifted)
check('remapped=3 / applied=0', remapResult.remapped === 3 && remapResult.applied === 0, JSON.stringify(remapResult))
check('重建到新 id', rebuilt.team.enabledIds['crisis-buff-10::blk-new::eff-new-1'] === true)

console.log('[4] 恢复：期数换行 id，卡片同名也能找回')

const renamed = [catalogEntry({ id: '99', blockId: 'blk-x', effects: [
  { id: 'eff-x-1', stat: 'dmgBonus', value: 30 },
  { id: 'eff-x-2', stat: 'critRate', value: 10 },
] })]
const remapped = createEmptyMultiSlotBuffSelection()
const nameResult = applySchemeEnvironmentBuffChecks(remapped, checks, renamed)
check('按名称命中并重建', nameResult.remapped === 3 && nameResult.missing === 0, JSON.stringify(nameResult))
check('写回新 sourceKey', remapped.team.enabledIds['crisis-buff-99::blk-x::eff-x-1'] === true)

console.log('[5] 同名片优先同 kind')

const mixed = [
  catalogEntry({ kind: 'defense', id: '7', name: '强攻型', blockId: 'blk-d', effects: [
    { id: 'eff-d-1', stat: 'dmgBonus', value: 30 },
    { id: 'eff-d-2', stat: 'critRate', value: 10 },
  ]}),
  catalogEntry({ id: '88', name: '强攻型', blockId: 'blk-z', effects: [
    { id: 'eff-z-1', stat: 'dmgBonus', value: 30 },
  ]}),
]
const mixedTarget = createEmptyMultiSlotBuffSelection()
applySchemeEnvironmentBuffChecks(mixedTarget, checks, mixed)
check('优先危局卡而不是防线卡', mixedTarget.team.enabledIds['crisis-buff-88::blk-z::eff-z-1'] === true)

console.log('[6] 缺失：期数整期没了')

const missingResult = createEmptyMultiSlotBuffSelection()
const empty = applySchemeEnvironmentBuffChecks(missingResult, checks, [])
check('missingCards=2 / missing=3', empty.missingCards === 2 && empty.missing === 3, JSON.stringify(empty))
check('没有任何勾选被写入', Object.keys(missingResult.team.enabledIds).length === 0)

console.log('[7] 空快照不改变现状')

const noop = applySchemeEnvironmentBuffChecks(createEmptyMultiSlotBuffSelection(), undefined, catalog)
check('未提供 checks 时全零', noop.applied === 0 && noop.missing === 0 && noop.cards === 0)

console.log('[8] 页面接线：保存写环境字段，加载按 checks 恢复')

const page = readFileSync(new URL('../src/components/calculator/DamageCalcPage.vue', import.meta.url), 'utf8')
check(
  '保存 / 覆盖都带上环境筛选与勾选',
  (page.match(/\.\.\.captureSchemeEnvironmentState\(\),/g) ?? []).length === 2,
)
check('加载时调用 applySchemeEnvironmentBuffChecks', page.includes('applySchemeEnvironmentBuffChecks(\n        multiSlotBuffSelection,'))
check(
  '期数不可用只在目录加载完后判定',
  page.includes('const envModeCatalogLoaded =') &&
    page.includes('envModeCatalogLoaded &&') &&
    page.includes('!envPhaseOptions.value.some((option) => option.id === entry.envBuffPhaseId)'),
)
check('提示写进环境筛选条 hint', page.includes('if (envSchemeNotice.value) return envSchemeNotice.value'))

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
