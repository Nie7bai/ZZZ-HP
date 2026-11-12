/**
 * 乘区公式说明覆盖率（管理端只读展示的数据完整性）。
 *
 * 断言：
 * - `catalog.ts` 里每条内置乘区都在 `formulaNotes.ts` 有公式说明（新增乘区必须补）；
 * - `formulaNotes.ts` 不含已从 catalog 移除的孤立 key；
 * - 每个分组都有总式，且带 `CALCULATOR_FORMULAS.md` 章节号；
 * - 角色专属乘区（蕾米埃尔本人耀变）标记了 `appliesWhen`。
 *
 * 只校验数据完整性，不校验公式数值是否正确 —— 数值正确性由 `test:zone-golden` 等守住。
 *
 * 运行：npx vite-node scripts/test-zone-formula-notes.mjs
 */
import assert from 'node:assert/strict'

import { ZONE_DEFINITIONS } from '../src/zones/catalog.ts'
import { ZONE_GROUP_FORMULAS, ZONE_FORMULA_NOTES } from '../src/zones/formulaNotes.ts'

let passed = 0
let failed = 0
function check(name, run) {
  try {
    run()
    passed += 1
    console.log(`  PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`  FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log('[1] 覆盖率')

check('每条内置乘区都有公式说明', () => {
  const missing = ZONE_DEFINITIONS.filter((zone) => !ZONE_FORMULA_NOTES[zone.key]).map(
    (zone) => zone.key,
  )
  assert.deepEqual(missing, [], `缺少公式说明：${missing.join(', ')}`)
})

check('没有 catalog 之外的孤立公式条目', () => {
  const known = new Set(ZONE_DEFINITIONS.map((zone) => zone.key))
  const orphans = Object.keys(ZONE_FORMULA_NOTES).filter((key) => !known.has(key))
  assert.deepEqual(orphans, [], `孤立条目：${orphans.join(', ')}`)
})

console.log('[2] 内容完整性')

check('每条公式有正文且非空', () => {
  for (const [key, note] of Object.entries(ZONE_FORMULA_NOTES)) {
    assert.ok(note.formula.trim().length > 0, `${key} 公式为空`)
  }
})

check('每条公式标注了文档章节号', () => {
  const missing = Object.entries(ZONE_FORMULA_NOTES)
    .filter(([, note]) => !note.docSection)
    .map(([key]) => key)
  assert.deepEqual(missing, [], `缺章节号：${missing.join(', ')}`)
})

check('角色专属乘区标记了适用条件', () => {
  const radianceSelf = ZONE_DEFINITIONS.filter((zone) => zone.group === 'radianceSelf')
  assert.ok(radianceSelf.length > 0, '缺少 radianceSelf 分组')
  for (const zone of radianceSelf) {
    const note = ZONE_FORMULA_NOTES[zone.key]
    assert.ok(note?.appliesWhen, `${zone.key} 应标记 appliesWhen`)
  }
})

console.log('[3] 分组总式')

check('每个分组都有总式', () => {
  const groups = [...new Set(ZONE_DEFINITIONS.map((zone) => zone.group))]
  const missing = groups.filter((group) => !ZONE_GROUP_FORMULAS[group])
  assert.deepEqual(missing, [], `缺总式：${missing.join(', ')}`)
})

check('分组总式非空且带章节号', () => {
  for (const [group, note] of Object.entries(ZONE_GROUP_FORMULAS)) {
    assert.ok(note.formula.trim().length > 0, `${group} 总式为空`)
    assert.ok(note.docSection, `${group} 缺章节号`)
  }
})

console.log(`\n${failed === 0 ? '✅ all passed' : '❌ failed'}（${passed} passed / ${failed} failed）`)
if (failed) process.exit(1)
