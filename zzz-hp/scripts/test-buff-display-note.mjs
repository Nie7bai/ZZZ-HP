/**
 * 增益展示注释合并：采集早期把同一段原文同时写进影画注释与效果块注释，
 * 展示层要把「已被其它段完全覆盖」的那段丢掉，只留一份；各段都有独有行时都要留。
 */
import assert from 'node:assert/strict'
import { mergeBuffDisplayNotes } from '../src/utils/buffDisplayNote.ts'

let passed = 0
const results = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    results.push(`  PASS  ${name}`)
  } catch (error) {
    results.push(`  FAIL  ${name} — ${error.message}`)
  }
}

check('完全相同的两段只留一份', () => {
  assert.equal(mergeBuffDisplayNotes('同一句话', '同一句话'), '同一句话')
})

check('空白 / null 段直接忽略', () => {
  assert.equal(mergeBuffDisplayNotes(null, '  ', undefined, '甲'), '甲')
})

check('短段每一行都在长段里 → 只留长段（与传入顺序无关）', () => {
  const blockNote = '原文：每次闪避后攻击力提升 10%\n[攻击力%] 全局 +10'
  const mindscapeNote = '原文：每次闪避后攻击力提升 10%'
  assert.equal(mergeBuffDisplayNotes(mindscapeNote, blockNote), blockNote)
  assert.equal(mergeBuffDisplayNotes(blockNote, mindscapeNote), blockNote)
})

check('短段被更长段完全覆盖 → 只留长段（原文仍只有一份）', () => {
  const blockNote = '原文：每次闪避后攻击力提升 10%'
  const mindscapeNote = '原文：每次闪避后攻击力提升 10%\n额外：持续 10 秒'
  assert.equal(mergeBuffDisplayNotes(blockNote, mindscapeNote), mindscapeNote)
  assert.equal(mergeBuffDisplayNotes(mindscapeNote, blockNote), mindscapeNote)
})

check('各段都有独有行 → 全部保留（不能误删信息）', () => {
  assert.equal(mergeBuffDisplayNotes('甲\n乙', '甲\n丙'), '甲\n乙\n甲\n丙')
})

check('行内多余空白不影响判重', () => {
  assert.equal(
    mergeBuffDisplayNotes('攻击力   提升 10%', '攻击力 提升 10%'),
    '攻击力   提升 10%',
  )
})

console.log(results.join('\n'))
console.log(`\n结果：${passed} passed, ${results.length - passed} failed`)
if (passed !== results.length) process.exit(1)
